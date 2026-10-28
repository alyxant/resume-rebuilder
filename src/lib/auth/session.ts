import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "resume_rebuilder_session";
const SESSION_VALUE = "authorized";

function configuredPassword(): string | null {
  const password = process.env.APP_PASSWORD;
  return password && password.length > 0 ? password : null;
}

function signature(password: string): string {
  return createHmac("sha256", password)
    .update(`resume-rebuilder:${SESSION_VALUE}`)
    .digest("base64url");
}

function equalStrings(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authIsEnabled(): boolean {
  return configuredPassword() !== null;
}

export function passwordIsValid(candidate: unknown): boolean {
  const password = configuredPassword();
  return (
    password !== null &&
    typeof candidate === "string" &&
    equalStrings(candidate, password)
  );
}

export function sessionToken(): string {
  const password = configuredPassword();
  if (!password) throw new Error("APP_PASSWORD is not configured");
  return `${SESSION_VALUE}.${signature(password)}`;
}

export function sessionIsValid(token: string | undefined): boolean {
  const password = configuredPassword();
  if (!password) return true;
  if (!token) return false;
  return equalStrings(token, `${SESSION_VALUE}.${signature(password)}`);
}

export function requestIsAuthorized(request: NextRequest): boolean {
  // Local development remains frictionless. A production deployment fails
  // closed so forgetting APP_PASSWORD cannot expose the Gemini key publicly.
  if (!authIsEnabled()) return process.env.NODE_ENV !== "production";
  return sessionIsValid(request.cookies.get(SESSION_COOKIE)?.value);
}
