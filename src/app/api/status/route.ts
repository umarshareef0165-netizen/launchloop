import { NextResponse } from "next/server";
import { getAuthMethod, isConnected } from "@/lib/buffer";
import { getOAuthConfig } from "@/lib/oauth";

// Must be dynamic: the response depends on runtime env vars + cookies.
export const dynamic = "force-dynamic";

/**
 * GET /api/status — connection state only. No token value is ever returned,
 * logged, or included in any response. `authMethod` tells the UI how the
 * app is connected: "oauth" (contest-compliant), "personal-key" (single-user
 * fallback — works, but does NOT satisfy the contest's OAuth requirement),
 * or "none" (demo mode).
 */
export async function GET() {
  const connected = await isConnected();
  const authMethod = await getAuthMethod();
  const oauthConfigured = getOAuthConfig().configured;
  return NextResponse.json({
    connected,
    authMethod,
    oauthConfigured,
    mode: connected ? "live" : "demo",
    message:
      authMethod === "oauth"
        ? "Connected to Buffer via OAuth — scheduling goes to your real Buffer channels."
        : authMethod === "personal-key"
          ? "Connected with a personal API key. Scheduling goes to real Buffer channels — but connect with Buffer OAuth for the contest-compliant setup."
          : "Demo mode — no Buffer credential configured. Connect with Buffer OAuth (or a personal API key) to schedule for real.",
    howToConnect: connected
      ? undefined
      : oauthConfigured
        ? "Click “Connect with Buffer” to approve LaunchLoop on Buffer (OAuth). Or use a personal key: Buffer dashboard → Settings → API → Create a new API key, then set BUFFER_ACCESS_TOKEN."
        : "Buffer dashboard → Settings → API → App Clients: register the LaunchLoop OAuth client, then set BUFFER_CLIENT_ID, BUFFER_CLIENT_SECRET and BUFFER_REDIRECT_URI (see DEPLOY-README.md). A personal API key (BUFFER_ACCESS_TOKEN) also works for testing, but OAuth is required for the contest.",
  });
}
