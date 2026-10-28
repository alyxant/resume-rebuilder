"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Unable to sign in");
      }
      router.replace("/");
      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Unable to sign in"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-white p-7 shadow-sm space-y-5"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Resume Rebuilder
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter the shared password to continue.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
            className="mt-2 w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-primary"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
