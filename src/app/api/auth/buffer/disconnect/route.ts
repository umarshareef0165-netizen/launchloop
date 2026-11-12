import { NextResponse } from "next/server";
import { clearOAuthSessionCookie } from "@/lib/session";

// Must be dynamic: this clears a per-user cookie.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/buffer/disconnect — sign the connected Buffer account out
 * of LaunchLoop by deleting the encrypted session cookie. This only forgets
 * the tokens on this app; it does not revoke the grant inside Buffer — the
 * user can also revoke LaunchLoop from Buffer → Settings → Connected Apps.
 */
export async function POST() {
  clearOAuthSessionCookie();
  return NextResponse.json({ ok: true, connected: false, mode: "demo" });
}
