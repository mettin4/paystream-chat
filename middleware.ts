// Ensures every request has a signed `ps_sid` cookie. Runs in Edge runtime
// so it can rewrite Set-Cookie before the response leaves the server — means
// the cookie is available on the very first page load, not after a refresh.

import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  newSessionId,
  signSessionCookie,
  verifySessionCookie,
} from "@/lib/session-cookie";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function middleware(req: NextRequest) {
  const current = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified = await verifySessionCookie(current);
  if (verified) return NextResponse.next();

  const id = newSessionId();
  const value = await signSessionCookie(id);
  const res = NextResponse.next();
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

// Skip static assets and Next internals — they don't need a session.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
