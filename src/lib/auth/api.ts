import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requestIsAuthorized } from "./session";

export function rejectUnauthorized(
  request: NextRequest
): NextResponse | null {
  if (requestIsAuthorized(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
