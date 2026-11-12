// Tests for the Buffer OAuth helpers (src/lib/oauth.ts).
// Pure functions only — no network calls, no Next.js request context.
// The PKCE test vector is the RFC 7636 Appendix B example.
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  buildRefreshBody,
  buildTokenExchangeBody,
  decryptSession,
  encryptSession,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getOAuthConfig,
  isAccessTokenExpired,
  sessionFromTokens,
  BUFFER_AUTH_URL,
  OAUTH_SCOPES,
} from "./oauth";

describe("PKCE (RFC 7636)", () => {
  it("verifier is 43 base64url chars, no padding", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateCodeVerifier()).not.toBe(verifier);
  });

  it("challenge matches the RFC 7636 Appendix B test vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(generateCodeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("challenge is base64url with no padding", () => {
    expect(generateCodeChallenge(generateCodeVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("state", () => {
  it("is 32 lowercase hex chars and unique per call", () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(generateState()).not.toBe(state);
  });
});

describe("authorize URL", () => {
  it("carries every parameter the Buffer docs require", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "test-client-id",
        redirectUri: "https://launchloop.example.com/api/auth/buffer/callback",
        state: "abc123state",
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(BUFFER_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://launchloop.example.com/api/auth/buffer/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPES);
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("state")).toBe("abc123state");
    expect(url.searchParams.get("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("token endpoint bodies", () => {
  it("authorization_code exchange sends client_secret + verifier for a confidential client", () => {
    const body = buildTokenExchangeBody({
      clientId: "cid",
      clientSecret: "shh",
      code: "auth-code",
      redirectUri: "https://app.example.com/callback",
      codeVerifier: "verifier-value",
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(body.get("code_verifier")).toBe("verifier-value");
  });

  it("public clients must NOT send a client_secret", () => {
    const body = buildTokenExchangeBody({
      clientId: "cid",
      code: "auth-code",
      redirectUri: "https://app.example.com/callback",
      codeVerifier: "verifier-value",
    });
    expect(body.has("client_secret")).toBe(false);
  });

  it("refresh grant sends grant_type=refresh_token and the refresh token", () => {
    const body = buildRefreshBody({
      clientId: "cid",
      clientSecret: "shh",
      refreshToken: "v1.refresh-token",
    });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("v1.refresh-token");
    expect(body.get("client_secret")).toBe("shh");
  });
});

describe("session encryption (AES-256-GCM)", () => {
  const session = {
    accessToken: "eyJhbGciOi.test-access-token",
    refreshToken: "v1.test-refresh-token",
    expiresAt: Date.now() + 3_600_000,
    scope: OAUTH_SCOPES,
  };

  it("round-trips through encrypt/decrypt", () => {
    const encoded = encryptSession("test-session-secret", session);
    expect(encoded.startsWith("v1.")).toBe(true);
    expect(decryptSession("test-session-secret", encoded)).toEqual(session);
  });

  it("two encryptions of the same session differ (random salt + IV)", () => {
    expect(encryptSession("s3cret", session)).not.toBe(encryptSession("s3cret", session));
  });

  it("tampered ciphertext fails closed (returns null, never throws)", () => {
    const encoded = encryptSession("s3cret", session);
    const parts = encoded.split(".");
    parts[4] = parts[4].slice(0, -2) + "AA";
    expect(decryptSession("s3cret", parts.join("."))).toBeNull();
  });

  it("wrong secret fails closed", () => {
    const encoded = encryptSession("correct-secret", session);
    expect(decryptSession("wrong-secret", encoded)).toBeNull();
  });

  it("malformed blobs fail closed", () => {
    expect(decryptSession("s3cret", "")).toBeNull();
    expect(decryptSession("s3cret", "not-a-session")).toBeNull();
    expect(decryptSession("s3cret", "v1.a.b")).toBeNull();
  });
});

describe("token expiry", () => {
  const now = 1_700_000_000_000;

  it("a token expiring in an hour is not expired", () => {
    expect(isAccessTokenExpired(now + 3_600_000, now)).toBe(false);
  });

  it("an already-expired token is expired", () => {
    expect(isAccessTokenExpired(now - 1_000, now)).toBe(true);
  });

  it("a token expiring within the 60 s safety margin counts as expired", () => {
    expect(isAccessTokenExpired(now + 30_000, now)).toBe(true);
    expect(isAccessTokenExpired(now + 120_000, now)).toBe(false);
  });

  it("sessionFromTokens converts expires_in seconds to an epoch-ms expiry", () => {
    const s = sessionFromTokens(
      { access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 3600 },
      now,
    );
    expect(s).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: now + 3_600_000,
      scope: undefined,
    });
  });
});

describe("getOAuthConfig", () => {
  const saved = { ...process.env };

  it("reports missing vars by name when nothing is set", () => {
    delete process.env.BUFFER_CLIENT_ID;
    delete process.env.BUFFER_CLIENT_SECRET;
    delete process.env.BUFFER_REDIRECT_URI;
    delete process.env.BUFFER_SESSION_SECRET;
    const config = getOAuthConfig();
    expect(config.configured).toBe(false);
    expect(config.missing).toContain("BUFFER_CLIENT_ID");
    expect(config.missing).toContain("BUFFER_REDIRECT_URI");
    process.env = { ...saved };
  });

  it("is configured when client id + redirect URI + a secret are present", () => {
    process.env.BUFFER_CLIENT_ID = "cid";
    process.env.BUFFER_REDIRECT_URI = "https://app.example.com/callback";
    process.env.BUFFER_SESSION_SECRET = "session-secret";
    const config = getOAuthConfig();
    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.clientId).toBe("cid");
    process.env = { ...saved };
  });

  it("falls back to the client secret as the session secret (documented)", () => {
    process.env.BUFFER_CLIENT_ID = "cid";
    process.env.BUFFER_CLIENT_SECRET = "client-secret";
    process.env.BUFFER_REDIRECT_URI = "https://app.example.com/callback";
    delete process.env.BUFFER_SESSION_SECRET;
    const config = getOAuthConfig();
    expect(config.configured).toBe(true);
    expect(config.sessionSecret).toBe("client-secret");
    process.env = { ...saved };
  });
});
