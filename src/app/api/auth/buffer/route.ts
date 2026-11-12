import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getOAuthConfig,
} from "@/lib/oauth";
import { setOAuthStateCookie } from "@/lib/session";

// Must be dynamic: the redirect depends on runtime env vars.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/buffer — start the Buffer OAuth flow (docs Step 1 + 2).
 * Generates a fresh PKCE pair + CSRF state, stores the verifier server-side
 * (HttpOnly cookie), and redirects the browser to Buffer's authorization
 * page. Nothing here needs a token yet — that is the whole point: the user
 * approves on Buffer's own screen, and Buffer sends them back with a code.
 *
 * If the OAuth client is not configured (no client ID / redirect URI in the
 * environment), this returns 503 with the exact missing env var names
 * instead of redirecting to a broken Buffer URL.
 */
export async function GET() {
  const config = getOAuthConfig();
  if (!config.configured) {
    return NextResponse.json(
      {
        error: "Buffer OAuth is not configured on this deployment.",
        missing: config.missing,
        setup:
          "Register an app client at Buffer → Settings → API → App Clients, then set BUFFER_CLIENT_ID, BUFFER_CLIENT_SECRET, BUFFER_REDIRECT_URI (and BUFFER_SESSION_SECRET) in the deployment environment. See DEPLOY-README.md.",
      },
      { status: 503 },
    );
  }
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  setOAuthStateCookie({ state, codeVerifier });
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge,
  });
  return NextResponse.redirect(authorizeUrl);
}
