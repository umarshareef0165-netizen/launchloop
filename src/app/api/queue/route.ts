import { NextResponse } from "next/server";
import { BufferApiError, isConnected, listScheduledPosts } from "@/lib/buffer";

// Must be dynamic: the response depends on the runtime env var.
export const dynamic = "force-dynamic";

/**
 * GET /api/queue?organizationId=…&channelIds=a,b — scheduled posts in Buffer.
 * Demo mode returns an empty list with mode "demo" (never fake posts).
 */
export async function GET(req: Request) {
  if (!(await isConnected())) {
    return NextResponse.json({
      mode: "demo",
      posts: [],
      notice: "Demo mode — no live queue to show. Connect a Buffer access token to see your scheduled Buffer posts.",
    });
  }
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  const channelIds = (url.searchParams.get("channelIds") ?? "").split(",").filter(Boolean);
  if (!organizationId || channelIds.length === 0) {
    return NextResponse.json({ error: "organizationId and channelIds query params are required." }, { status: 400 });
  }
  try {
    const posts = await listScheduledPosts(organizationId, channelIds);
    return NextResponse.json({ mode: "live", posts });
  } catch (err) {
    if (err instanceof BufferApiError) {
      return NextResponse.json({ mode: "live", error: err.message }, { status: err.status });
    }
    return NextResponse.json({ mode: "live", error: "Unexpected error loading the Buffer queue." }, { status: 502 });
  }
}
