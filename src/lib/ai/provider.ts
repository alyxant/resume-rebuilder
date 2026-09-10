import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * A single seam between this app and whichever model provider is configured.
 *
 * Both AI calls in this codebase want the same thing — a system prompt, a user
 * prompt, and strict JSON back — so the provider surface stays deliberately
 * narrow. Swapping providers is then an env change rather than a rewrite,
 * which matters when one account runs out of credits mid-job-search.
 */

export type Effort = "low" | "medium" | "high";

export type CompletionRequest = {
  system: string;
  user: string;
  maxTokens: number;
  /** Reasoning depth, where the provider exposes it. */
  effort?: Effort;
  /** Hint that the response must be a JSON object. */
  json?: boolean;
};

export type CompletionResult = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * The model that actually served this request. Differs from the provider's
   * configured model whenever a quota fallback kicked in, and callers logging
   * the configured name would otherwise misreport which model wrote the output.
   */
  servedBy?: string;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /**
   * True when firing two requests at once risks being throttled. Free tiers
   * meter by requests-per-minute and can silently degrade one of a concurrent
   * pair rather than returning an error.
   */
  readonly prefersSerialCalls: boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Ceiling on any single model call. Without one, a provider that stalls leaves
 * the UI on a spinner indefinitely with no way to tell a slow model from a
 * dead one — far worse than a clear failure.
 */
// Measured legitimate responses run 45-130s on Gemini once thinking tokens are
// counted, so a 90s ceiling cut off calls that were about to succeed.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 180_000;

/** Marker so a timeout is never mistaken for a provider-side failure. */
class TimeoutError extends Error {
  readonly isTimeout = true;
}

export function isTimeout(error: unknown): boolean {
  return (error as TimeoutError)?.isTimeout === true;
}

async function withTimeout<T>(
  work: Promise<T>,
  label: string,
  ms = TIMEOUT_MS
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `${label} did not respond within ${Math.round(ms / 1000)}s. ` +
              `The model may be queueing or generating unusually long output — ` +
              `try another model via GEMINI_MODEL, or another provider via ` +
              `AI_PROVIDER.`
          )
        ),
      ms
    );
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Transient server-side capacity failures. Google returns 500 "experiencing
 * high demand" for a model that is up but oversubscribed — retrying the same
 * model does not help, but another model usually serves fine.
 */
export function isCapacityFailure(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  return /high demand|overloaded|unavailable|try again later/i.test(message);
}

/** True for the throttling responses worth waiting out rather than failing. */
export function isRateLimited(error: unknown): boolean {
  const e = error as { status?: number; code?: number; message?: string };
  if (e?.status === 429 || e?.code === 429) return true;
  return /\b429\b|quota|rate.?limit|too many requests/i.test(e?.message ?? "");
}

/**
 * Seconds the provider asked us to wait, if it said. Google returns both a
 * prose "Please retry in 54.06s" and a `retryDelay` field depending on path.
 */
function retryAfterSeconds(error: unknown): number | null {
  const message = (error as { message?: string })?.message ?? "";
  const prose = message.match(/retry in ([\d.]+)s/i);
  if (prose) return Math.ceil(Number(prose[1]));
  const field = message.match(/"?retryDelay"?[:\s]+"?(\d+)s/i);
  if (field) return Math.ceil(Number(field[1]));
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait out rate limits instead of surfacing them.
 *
 * Free tiers meter aggressively and say exactly how long to wait, so a throttle
 * is a pause rather than a failure. Honouring the provider's own delay avoids
 * hammering a quota that is already exhausted.
 */
async function withRateLimitRetry<T>(
  work: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= attempts) {
        if (isRateLimited(error)) {
          throw new Error(
            `${label} is rate limited and did not recover after ${attempts} attempts. ` +
              `Free tiers cap requests per minute — wait a minute and try again, ` +
              `or set AI_PROVIDER=anthropic to switch back.`
          );
        }
        throw error;
      }

      // Cap the wait so a long quota window doesn't stall the request forever.
      const waitSeconds = Math.min(retryAfterSeconds(error) ?? 20 * attempt, 60);
      console.warn(
        `[ai] ${label} rate limited; waiting ${waitSeconds}s (attempt ${attempt}/${attempts - 1})`
      );
      await sleep(waitSeconds * 1000);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly prefersSerialCalls = false;
  readonly model: string;
  private client: Anthropic;

  constructor(model = process.env.ANTHROPIC_MODEL || "claude-opus-5") {
    this.model = model;
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await withRateLimitRetry(
      () =>
        withTimeout(
          // Streaming keeps large max_tokens from tripping the HTTP timeout.
          // The stream is created inside the retry so each attempt is fresh.
          this.client.messages
            .stream({
              model: this.model,
              max_tokens: request.maxTokens,
              ...(request.effort
                ? { output_config: { effort: request.effort } }
                : {}),
              system: request.system,
              messages: [{ role: "user", content: request.user }],
            })
            .finalMessage(),
          `Anthropic (${this.model})`
        ),
      `Anthropic (${this.model})`
    );

    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined to process this request");
    }

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return {
      text: block.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Google Gemini                                                       */
/* ------------------------------------------------------------------ */

class GeminiProvider implements AiProvider {
  // The free tier throttles concurrent requests, and a throttled tailoring
  // call comes back empty rather than erroring — silently producing a resume
  // with zero edits. Serialising costs a few seconds and avoids that.
  readonly name = "gemini";
  readonly prefersSerialCalls = true;
  readonly model: string;
  /**
   * Ordered models to try after the primary. Quotas are metered per model and
   * capacity outages hit one model at a time, so a peer-quality alternative
   * comes before the weaker lightweight one.
   */
  private readonly fallbackModels: string[];
  private client: GoogleGenAI;

  /**
   * How long to stay on a fallback before re-testing the primary.
   *
   * Kept short: on a billed tier a throttle clears in seconds, and the primary
   * is the higher-quality model, so pinning to a fallback for long costs more
   * in output quality than the occasional wasted probe costs in latency.
   */
  private static readonly COOLDOWN_MS = 2 * 60_000;
  /** Shared across instances: the quota belongs to the key, not the object. */
  private static primaryExhaustedUntil = 0;

  // gemini-3.7-flash is the newest stable Flash but stalls past 60s on the
  // free tier; 3.5-flash answers the same prompt in ~2.6s. The 2.5 line now
  // 404s for new keys. Measured 2026-08-25.
  constructor(model = process.env.GEMINI_MODEL || "gemini-3.5-flash") {
    this.model = model;
    this.fallbackModels = (
      process.env.GEMINI_FALLBACK_MODELS ||
      "gemini-3.6-flash,gemini-3.5-flash-lite"
    )
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m && m !== model);
    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    });
  }

  private async call(
    model: string,
    request: CompletionRequest
  ): Promise<CompletionResult> {
    // Gemini has no separate system field on this endpoint; the instructions
    // are prepended to the input instead.
    const input = `${request.system}\n\n---\n\n${request.user}`;

    // Deliberately no backoff-retry here. Retrying a throttled model before
    // trying an unthrottled one costs a minute of waiting to learn what the
    // next model answers instantly; complete() owns that ordering instead.
    const interaction = await withTimeout(
      this.client.interactions.create({
        model,
        input,
        ...(request.json
          ? {
              response_format: {
                type: "text",
                mime_type: "application/json",
              },
            }
          : {}),
      }),
      `Gemini (${model})`
    );

    const text = interaction.output_text;
    if (!text) throw new Error("Empty response from Gemini");

    const usage = (interaction as { usage?: Record<string, number> }).usage;
    // Gemini reports thinking separately from the visible answer, but bills it
    // as output — so it belongs in the output count or cost estimates come out
    // far too low. On this model thinking dominates: a one-word reply cost 1
    // output token and 111 thought tokens.
    const output =
      (usage?.total_output_tokens ?? 0) + (usage?.total_thought_tokens ?? 0);
    return {
      text,
      servedBy: model,
      inputTokens: usage?.total_input_tokens,
      outputTokens: output || undefined,
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const chain =
      Date.now() < GeminiProvider.primaryExhaustedUntil
        ? // Primary is known bad: skip straight past it rather than paying the
          // full retry-and-backoff cost to rediscover that on every call.
          this.fallbackModels
        : [this.model, ...this.fallbackModels];

    let lastError: unknown;

    /** One pass over the chain, failing fast so a working model is reached. */
    const sweep = async (): Promise<CompletionResult | null> => {
      for (const model of chain) {
        try {
          return await this.call(model, request);
        } catch (error) {
          const recoverable =
            isRateLimited(error) || isCapacityFailure(error) || isTimeout(error);
          if (!recoverable) throw error;

          lastError = error;
          // Only a genuine quota block means the model is unusable for a while.
          // A timeout or a capacity blip says nothing about remaining quota, so
          // it must not pin later calls to the weaker fallback.
          if (model === this.model && isRateLimited(error)) {
            GeminiProvider.primaryExhaustedUntil =
              Date.now() + GeminiProvider.COOLDOWN_MS;
          }
          const reason = isTimeout(error)
            ? "timeout"
            : isCapacityFailure(error)
              ? "capacity"
              : "quota";
          console.warn(`[ai] ${model} unavailable (${reason}); trying next model`);
        }
      }
      return null;
    };

    // Fast path: whichever model is healthy answers immediately.
    const first = await sweep();
    if (first) return first;

    // Everything is throttled or oversubscribed at once. Only now is waiting
    // worthwhile — honour the provider's own retry hint before one more pass.
    const waitSeconds = Math.min(retryAfterSeconds(lastError) ?? 20, 60);
    console.warn(
      `[ai] all Gemini models unavailable; waiting ${waitSeconds}s before retrying`
    );
    await sleep(waitSeconds * 1000);

    const second = await sweep();
    if (second) return second;

    throw lastError;
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible endpoints (Groq, Cerebras, OpenRouter, …)         */
/* ------------------------------------------------------------------ */

/**
 * Most hosted providers expose OpenAI's /chat/completions shape, so they differ
 * only by base URL, key, and model name. Sharing one implementation means a new
 * provider is a few lines of config rather than another API integration.
 */
class OpenAICompatibleProvider implements AiProvider {
  // These meter by tokens or requests per day rather than degrading concurrent
  // calls the way a per-minute request cap does.
  readonly prefersSerialCalls = false;

  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  /**
   * Ceiling on requested completion tokens.
   *
   * Providers that meter tokens-per-minute count the *requested* maximum, not
   * what gets generated — so asking for 16k to produce 3k can blow a TPM budget
   * on its own and fail with 413 before the model runs.
   */
  private readonly maxCompletionTokens: number;

  // Written as explicit fields rather than parameter properties so the module
  // stays loadable by type-stripping runtimes, which reject the shorthand.
  constructor(
    name: string,
    model: string,
    baseUrl: string,
    apiKey: string | undefined,
    maxCompletionTokens = Infinity
  ) {
    this.name = name;
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.maxCompletionTokens = maxCompletionTokens;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const label = `${this.name} (${this.model})`;

    const response = await withRateLimitRetry(
      () =>
        withTimeout(
          fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              max_completion_tokens: Math.min(
                request.maxTokens,
                this.maxCompletionTokens
              ),
              // json_object mode requires stream:false, which we already use.
              ...(request.json
                ? { response_format: { type: "json_object" } }
                : {}),
              messages: [
                { role: "system", content: request.system },
                { role: "user", content: request.user },
              ],
            }),
          }),
          label
        ),
      label
    );

    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
      // Surface the body: context-length overruns, quota exhaustion, and
      // billing problems all arrive as 4xx and are otherwise indistinguishable.
      throw new Error(`${this.name} returned ${response.status}: ${detail}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Empty response from ${this.name}`);

    return {
      text,
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    };
  }
}

function cerebrasProvider(): AiProvider {
  return new OpenAICompatibleProvider(
    "cerebras",
    process.env.CEREBRAS_MODEL || "gpt-oss-120b",
    "https://api.cerebras.ai/v1",
    process.env.CEREBRAS_API_KEY
  );
}

function groqProvider(): AiProvider {
  return new OpenAICompatibleProvider(
    "groq",
    // Queried from the account's own /models list on 2026-08-25. The Llama
    // line is no longer served here; gpt-oss-120b is the largest available and
    // the strongest at the strict-JSON instruction following this app needs.
    process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    "https://api.groq.com/openai/v1",
    process.env.GROQ_API_KEY,
    // Measured completions run 1.4k-3.2k; 4k avoids truncating JSON mid-object.
    // Note the free tier's 8k tokens/min counts this requested maximum, which
    // is why Groq is opt-in rather than auto-selected.
    Number(process.env.GROQ_MAX_TOKENS) || 4000
  );
}

/* ------------------------------------------------------------------ */
/* Ollama (local)                                                      */
/* ------------------------------------------------------------------ */

class OllamaProvider implements AiProvider {
  readonly name = "ollama";
  // Runs on local hardware, so there is no quota to trip and nothing to
  // serialise around.
  readonly prefersSerialCalls = false;
  readonly model: string;
  private readonly host: string;

  constructor(model = process.env.OLLAMA_MODEL || "llama3.1:8b") {
    this.model = model;
    this.host = process.env.OLLAMA_HOST || "http://localhost:11434";
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Local generation is slower than a hosted API; give it proportionally
    // more room before the timeout fires.
    const response = await withTimeout(
      fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(request.json ? { format: "json" } : {}),
          options: { num_predict: request.maxTokens },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      }),
      `Ollama (${this.model})`,
      Number(process.env.AI_TIMEOUT_MS) || 300_000
    );

    if (!response.ok) {
      throw new Error(
        `Ollama returned ${response.status}. Is the server running ` +
          `(\`ollama serve\`) and the model pulled (\`ollama pull ${this.model}\`)?`
      );
    }

    const body = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const text = body.message?.content;
    if (!text) throw new Error("Empty response from Ollama");

    return {
      text,
      inputTokens: body.prompt_eval_count,
      outputTokens: body.eval_count,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

let cached: AiProvider | null = null;

/**
 * Pick a provider from AI_PROVIDER, falling back to whichever key is present.
 * Preferring an explicitly configured Gemini key keeps a zero-balance
 * Anthropic account from silently breaking every run.
 */
export function getProvider(): AiProvider {
  if (cached) return cached;

  const configured = (process.env.AI_PROVIDER || "").toLowerCase();
  const hasGemini = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  );
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasCerebras = Boolean(process.env.CEREBRAS_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);

  // Auto-selection only considers providers that work without a billing
  // setup. Cerebras is deliberately excluded: its no-card free tier ended in
  // August 2026 and an unbilled key returns 402 on every call, so picking it
  // automatically would break a working install. Opt in with
  // AI_PROVIDER=cerebras once billing is configured.
  // Auto-selection only picks providers whose free tier can actually sustain
  // this workload. Groq is excluded despite a valid key: its 8,000 tokens/min
  // free limit counts the *requested* completion maximum, and one tailoring
  // call plus one extraction call exceeds it — raising the token cap to keep
  // the JSON from truncating only makes the TPM overrun worse. Opt in with
  // AI_PROVIDER=groq on a paid tier.
  const choice =
    configured || (hasGemini ? "gemini" : hasAnthropic ? "anthropic" : "");

  if (choice === "groq") {
    if (!hasGroq) {
      throw new Error(
        "AI_PROVIDER=groq but no GROQ_API_KEY is set in .env.local"
      );
    }
    cached = groqProvider();
  } else if (choice === "cerebras") {
    if (!hasCerebras) {
      throw new Error(
        "AI_PROVIDER=cerebras but no CEREBRAS_API_KEY is set in .env.local"
      );
    }
    cached = cerebrasProvider();
  } else if (choice === "ollama") {
    // Local: no key to check, but the server has to be up.
    cached = new OllamaProvider();
  } else if (choice === "gemini") {
    if (!hasGemini) {
      throw new Error(
        "AI_PROVIDER=gemini but no GEMINI_API_KEY is set in .env.local"
      );
    }
    cached = new GeminiProvider();
  } else if (choice === "anthropic") {
    if (!hasAnthropic) {
      throw new Error(
        "AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set in .env.local"
      );
    }
    cached = new AnthropicProvider();
  } else {
    throw new Error(
      "No AI provider configured. Set GEMINI_API_KEY (free tier), " +
        "GROQ_API_KEY, ANTHROPIC_API_KEY, or AI_PROVIDER=ollama " +
        "(local, no key) in .env.local."
    );
  }

  console.log(`[ai] provider=${cached.name} model=${cached.model}`);
  return cached;
}

/** Test seam: forget the memoized provider so env changes take effect. */
export function resetProvider(): void {
  cached = null;
}
