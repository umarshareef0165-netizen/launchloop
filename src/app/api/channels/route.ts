import { NextResponse } from "next/server";
import { BufferApiError, getAllChannels, isConnected } from "@/lib/buffer";
import { DEMO_CHANNELS, DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_NAME } from "@/lib/demo";

// Must be dynamic: the response depends on the runtime env var.
export const dynamic = "force-dynamic";

/**
 * GET /api/channels — real Buffer channels when a token is set, otherwise
 * clearly-labelled demo channels (demo: true) for local UI testing only.
 */
export async function GET() {
  if (!(await isConnected())) {
    return NextResponse.json({
      mode: "demo",
      organizations: [{ id: DEMO_ORGANIZATION_ID, name: DEMO_ORGANIZATION_NAME }],
      channels: DEMO_CHANNELS,
      notice: "Demo channels — not real Buffer channels. Connect a Buffer access token to load your real channels.",
    });
  }
  try {
    const { account, channels } = await getAllChannels();
    return NextResponse.json({
      mode: "live",
      organizations: account.organizations,
      channels,
      account: { id: account.id, email: account.email, name: account.name },
    });
  } catch (err) {
    if (err instanceof BufferApiError) {
      return NextResponse.json({ mode: "live", error: err.message }, { status: err.status });
    }
    return NextResponse.json({ mode: "live", error: "Unexpected error loading Buffer channels." }, { status: 502 });
  }
}
