// Signed session cookie for pinning users to a stable sessionId.
//
// Format: `<uuid>.<base64url(hmac_sha256(uuid))>`. Uses the Web Crypto API
// so this works in both Edge middleware and Node route handlers.
//
// The HMAC is signed with SESSION_COOKIE_SECRET. Without it, a dev-only
// fallback key is used so local setup is frictionless; in production the
// secret MUST be provided (see `requireProductionSecret`).

export const SESSION_COOKIE_NAME = "ps_sid";

const DEV_SECRET = "paystream-dev-only-insecure-secret";

function getSecret(): string {
  const s = process.env.SESSION_COOKIE_SECRET;
  if (s && s.trim() !== "") return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_COOKIE_SECRET is not set. Required in production to sign session cookies."
    );
  }
  return DEV_SECRET;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toBase64Url(sig);
}

// Constant-time string compare so we don't leak timing info on HMAC verify.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSessionCookie(sessionId: string): Promise<string> {
  const sig = await hmac(sessionId);
  return `${sessionId}.${sig}`;
}

/**
 * Parse a signed cookie value and return the sessionId if valid, else null.
 * Treats any malformed/unsigned/tampered value as "no session" — the caller
 * should mint a fresh one.
 */
export async function verifySessionCookie(
  value: string | undefined | null
): Promise<string | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await hmac(id);
  return safeEqual(sig, expected) ? id : null;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
