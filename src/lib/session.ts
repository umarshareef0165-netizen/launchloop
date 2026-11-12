// Server-only OAuth session handling (Next.js Route Handlers).
// Tokens live ONLY in an encrypted, HttpOnly cookie — never in browser JS,
// never in localStorage, never in a URL. Follows the Buffer docs' guidance:
// "Tokens are credentials for someone else's account, so they belong on your
// server. Never put them in localStorage, sessionStorage, or a cookie that
// page JavaScript can read" — an encrypted HttpOnly session cookie is the
// starting point the docs themselves recommend, and it works on serverless
// hosts because every instance can decrypt the same cookie from the shared
// secret (BUFFER_SESSION_SECRET).
//
// Single-user note: LaunchLoop is a one-person demo app for the Buffer
// Commit contest. There is no user table and no database; the cookie holds
// the one connected Buffer account. A multi-user production app should move
// tokens into a shared durable store (the docs' Redis/Postgres options).

import { cookies } from "next/headers";
import {
  decryptSession,
  encryptSession,
  getOAuthConfig,
  isAccessTokenExpired,
  refreshAccessToken,
  sessionFromTokens,
  OAUTH_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  type OAuthSession,
} from "./oauth";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days (refresh token lifetime)
const STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes (one authorize round trip)

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface OAuthState {
  state: string;
  codeVerifier: string;
}

/** Step 2: remember the PKCE verifier + CSRF state for the authorize round
 *  trip. HttpOnly so page JS can never read the verifier. */
export function setOAuthStateCookie(state: OAuthState): void {
  cookies().set(OAUTH_STATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/api/auth/buffer",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
}

export function readOAuthStateCookie(): OAuthState | null {
  const raw = cookies().get(OAUTH_STATE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthState;
    if (typeof parsed.state !== "string" || typeof parsed.codeVerifier !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthStateCookie(): void {
  cookies().set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/api/auth/buffer",
    maxAge: 0,
  });
}

export function writeOAuthSessionCookie(session: OAuthSession): void {
  const config = getOAuthConfig();
  const encrypted = encryptSession(config.sessionSecret, session);
  cookies().set(OAUTH_SESSION_COOKIE, encrypted, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function readOAuthSessionCookie(): OAuthSession | null {
  const config = getOAuthConfig();
  const raw = cookies().get(OAUTH_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decryptSession(config.sessionSecret, raw);
}

export function clearOAuthSessionCookie(): void {
  cookies().set(OAUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * The access token to call Buffer with, or null when no OAuth session
 * exists. Refreshes a nearly-expired token first (single-use refresh token:
 * the new pair is written back to the cookie immediately and the old
 * refresh token is discarded). Returns null — never throws — when there is
 * no session or the refresh fails, so callers can fall back to the personal
 * API key or report "not connected".
 */
export async function getOAuthAccessToken(): Promise<string | null> {
  const session = readOAuthSessionCookie();
  if (!session) return null;
  if (!isAccessTokenExpired(session.expiresAt)) return session.accessToken;
  if (!session.refreshToken) return null;
  const config = getOAuthConfig();
  if (!config.configured) return null;
  try {
    const tokens = await refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: session.refreshToken,
    });
    const next = sessionFromTokens(tokens);
    writeOAuthSessionCookie(next);
    return next.accessToken;
  } catch {
    // Refresh failed (revoked grant, reused refresh token, …). The session
    // is dead — clear it so the user gets a clean "connect again" state
    // instead of a stale cookie that fails every call.
    clearOAuthSessionCookie();
    return null;
  }
}

/** True when a usable OAuth session exists (valid token, or a refreshable
 *  one). Used by /api/status so the UI can show the OAuth state. */
export function hasOAuthSession(): boolean {
  const session = readOAuthSessionCookie();
  if (!session) return false;
  if (!isAccessTokenExpired(session.expiresAt)) return true;
  return Boolean(session.refreshToken);
}
