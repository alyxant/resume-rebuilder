import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  authIsEnabled,
  passwordIsValid,
  sessionToken,
} from "@/lib/auth/session";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

export async function POST(request: NextRequest) {
  if (!authIsEnabled()) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured on the server" },
      { status: 503 }
    );
  }

  const key = clientKey(request);
  if (isRateLimited(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;

  if (!passwordIsValid(body?.password)) {
    return NextResponse.json(
      { error: "Incorrect password" },
      { status: 401 }
    );
  }

  attempts.delete(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
