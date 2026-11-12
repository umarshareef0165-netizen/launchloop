// Buffer OAuth 2.0 (Authorization Code flow + PKCE) — pure, framework-free
// helpers. No Next.js imports here so this module is unit-testable in Vitest.
//
// Docs (fetched 2026-11-12, developers.buffer.com):
//   - Authentication guide: "Buffer supports OAuth 2.0 so you can build apps
//     that access Buffer accounts on behalf of your users. This guide walks
//     you through the Authorization Code flow with PKCE, which is required
//     for all Buffer OAuth clients."
//   - Building Apps guide: register the client at Settings → API → App
//     Clients tab; a confidential (private) client receives a client_id and
//     a client_secret; a public client receives only a client_id and
//     authenticates using PKCE alone.
//   - Auth endpoint:  GET  https://auth.buffer.com/auth
//   - Token endpoint: POST https://auth.buffer.com/token
//     (Content-Type: application/x-www-form-urlencoded)
//   - Access tokens live ~1 hour (expires_in: 3600); a refresh_token is only
//     returned when the `offline_access` scope is requested. Refresh tokens
//     are SINGLE-USE: every refresh returns a new one and invalidates the
//     old one; reusing an old refresh token revokes the whole grant.
//   - "Store the tokens securely on your server." — tokens in this app live
//     in an encrypted, HttpOnly session cookie (see src/lib/session.ts),
//     never in localStorage and never sent to the browser JS.
//
// This app is a confidential client: it runs on a server (Vercel) that can
// keep a secret, so it sends BOTH client_secret and code_verifier at the
// token endpoint. A public client would omit client_secret.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

export const BUFFER_AUTH_URL = "https://auth.buffer.com/auth";
export const BUFFER_TOKEN_URL = "https://auth.buffer.com/token";

/** Scopes LaunchLoop needs — nothing more. `offline_access` is what buys
 *  the refresh token, so the app stays connected through judging (Dec 7)
 *  instead of forcing a re-authorize every hour. */
export const OAUTH_SCOPES = "account:read posts:read posts:write offline_access";

export const OAUTH_STATE_COOKIE = "ll_oauth_state";
export const OAUTH_SESSION_COOKIE = "ll_session";

export interface OAuthConfig {
  clientId: string;
  /** Undefined for public clients (PKCE only). Present for this app. */
  clientSecret?: string;
  redirectUri: string;
  /** Secret that encrypts the session cookie. */
  sessionSecret: string;
  /** True when every required value is present. */
  configured: boolean;
  /** Names of the missing env vars (empty when configured). */
  missing: string[];
}

/**
 * Read the OAuth configuration from the environment. Names only — values
 * are never logged or returned to the browser.
 *
 * Required: BUFFER_CLIENT_ID, BUFFER_REDIRECT_URI.
 * BUFFER_CLIENT_SECRET: required for a confidential client (this app);
 *   omit it only if the registered client is public (PKCE only).
 * BUFFER_SESSION_SECRET: encrypts the session cookie. If unset, the client
 *   secret is used as the encryption key instead (documented fallback for a
 *   single-user demo deploy; set a dedicated random secret in production).
 */
export function getOAuthConfig(): OAuthConfig {
  const clientId = (process.env.BUFFER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.BUFFER_CLIENT_SECRET ?? "").trim() || undefined;
  const redirectUri = (process.env.BUFFER_REDIRECT_URI ?? "").trim();
  const sessionSecret =
    (process.env.BUFFER_SESSION_SECRET ?? "").trim() || clientSecret || "";
  const missing: string[] = [];
  if (!clientId) missing.push("BUFFER_CLIENT_ID");
  if (!redirectUri) missing.push("BUFFER_REDIRECT_URI");
  if (!sessionSecret) missing.push("BUFFER_SESSION_SECRET (or BUFFER_CLIENT_SECRET)");
  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    configured: missing.length === 0,
    missing,
  };
}

/** PKCE code_verifier: 32 random bytes, base64url, no padding (43 chars). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

/** PKCE code_challenge: base64url(SHA-256(verifier)), method S256. */
export function generateCodeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

/** One-time CSRF token for the authorize round trip (16 random bytes, hex). */
export function generateState(): string {
  return randomBytes(16).toString("hex");
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string;
}

/** Step 2 of the docs: the URL the user is redirected to at Buffer. */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.scopes ?? OAUTH_SCOPES,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${BUFFER_AUTH_URL}?${params.toString()}`;
}

export interface TokenExchangeInput {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/** Step 4 of the docs: form body for the authorization_code exchange.
 *  Public clients must NOT send a client_secret — it is omitted when absent. */
export function buildTokenExchangeBody(input: TokenExchangeInput): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  return body;
}

export interface RefreshInput {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

/** Refresh-token grant body. Same rule: no client_secret for public clients. */
export function buildRefreshBody(input: RefreshInput): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  return body;
}

export interface BufferTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

async function postToTokenEndpoint(body: URLSearchParams): Promise<BufferTokens> {
  let res: Response;
  try {
    res = await fetch(BUFFER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new OAuthError(
      "token_endpoint_unreachable",
      `Could not reach ${BUFFER_TOKEN_URL}: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
  } & Partial<BufferTokens>;
  if (!res.ok || json.error || !json.access_token) {
    throw new OAuthError(
      json.error ?? "token_exchange_failed",
      json.error_description ??
        `Buffer token endpoint returned HTTP ${res.status} without an access token.`,
      res.status >= 400 && res.status < 500 ? res.status : 502,
    );
  }
  return json as BufferTokens;
}

/** Step 4: exchange the authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(input: TokenExchangeInput): Promise<BufferTokens> {
  return postToTokenEndpoint(buildTokenExchangeBody(input));
}

/** Refresh grant. Returns a NEW refresh_token — the caller must store it
 *  and discard the old one (reusing the old one revokes the whole grant). */
export async function refreshAccessToken(input: RefreshInput): Promise<BufferTokens> {
  return postToTokenEndpoint(buildRefreshBody(input));
}

// ---------------------------------------------------------------------------
// Session encryption — AES-256-GCM, key derived with scrypt from the session
// secret. The encrypted blob is what goes into the HttpOnly cookie, so even
// if the cookie is read, the tokens inside are not usable without the secret.
// Format: "v1.<salt b64url>.<iv b64url>.<authTag b64url>.<ciphertext b64url>"
// ---------------------------------------------------------------------------

export interface OAuthSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  scope?: string;
}

export function encryptSession(secret: string, session: OAuthSession): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    base64Url(salt),
    base64Url(iv),
    base64Url(tag),
    base64Url(ciphertext),
  ].join(".");
}

/** Returns null when the blob is malformed, tampered with, or encrypted
 *  under a different secret — never throws. */
export function decryptSession(secret: string, encoded: string): OAuthSession | null {
  try {
    const parts = encoded.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") return null;
    const [, saltB64, ivB64, tagB64, cipherB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(cipherB64, "base64");
    const key = scryptSync(secret, salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as OAuthSession;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) return null;
    if (typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when the access token is expired or will expire within `marginMs`
 *  (default 60 s — never start an API call with a token about to die). */
export function isAccessTokenExpired(
  expiresAt: number,
  nowMs: number = Date.now(),
  marginMs = 60_000,
): boolean {
  return expiresAt - marginMs <= nowMs;
}

/** Build the session record from a fresh token response. */
export function sessionFromTokens(tokens: BufferTokens, nowMs: number = Date.now()): OAuthSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: nowMs + tokens.expires_in * 1000,
    scope: tokens.scope,
  };
}
