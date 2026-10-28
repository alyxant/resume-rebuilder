import { NextResponse, type NextRequest } from "next/server";
import { requestIsAuthorized } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  if (requestIsAuthorized(request)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)",
  ],
};
