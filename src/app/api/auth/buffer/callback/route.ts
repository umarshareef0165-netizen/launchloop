import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  getOAuthConfig,
  sessionFromTokens,
  type OAuthError,
} from "@/lib/oauth";
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  writeOAuthSessionCookie,
} from "@/lib/session";

// Must be dynamic: the callback depends on query params + runtime env vars.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/buffer/callback — Buffer redirects here after the user
 * approves (docs Step 3 + 4): ?code=…&state=…
 *
 * 1. Verify `state` against the value stored when the flow started; a
 *    mismatch means the return trip did not begin with this app — refuse.
 * 2. Exchange the one-time code + saved PKCE verifier for access and
 *    refresh tokens at https://auth.buffer.com/token (server-to-server).
 * 3. Store the tokens in the encrypted HttpOnly session cookie and send the
 *    user back to the app, now connected.
 *
 * On any failure the user is sent back to the homepage with
 * ?oauth_error=<code> instead of a stack trace — the homepage shows the
 * plain-language reason. The authorization code is single-use and is never
 * logged or stored.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = (params: Record<string, string>) => {
    const target = new URL("/", req.url);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    return NextResponse.redirect(target);
  };

  const denied = url.searchParams.get("error");
  if (denied) {
    clearOAuthStateCookie();
    return home({ oauth_error: denied === "access_denied" ? "access_denied" : "buffer_error" });
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const saved = readOAuthStateCookie();
  clearOAuthStateCookie();

  if (!code || !returnedState || !saved || returnedState !== saved.state) {
    return home({ oauth_error: "invalid_state" });
  }

  const config = getOAuthConfig();
  if (!config.configured) {
    return home({ oauth_error: "not_configured" });
  }

  try {
    const tokens = await exchangeCodeForTokens({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: config.redirectUri,
      codeVerifier: saved.codeVerifier,
    });
    writeOAuthSessionCookie(sessionFromTokens(tokens));
    return home({ connected: "buffer" });
  } catch (err) {
    const code = (err as OAuthError)?.code ?? "exchange_failed";
    return home({ oauth_error: code });
  }
}
