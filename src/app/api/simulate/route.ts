import { NextResponse } from "next/server";
import { isConnected } from "@/lib/buffer";
import { demoPostId } from "@/lib/demo";

/**
 * POST /api/simulate — clearly-labelled LOCAL simulation for testing the UI
 * end to end without a token. Returns fake ids prefixed "demo-" and
 * isDemo: true on every result. It ONLY works in demo mode: once a real
 * token is configured, simulation is refused so a demo result can never be
 * confused with a real schedule.
 */
export async function POST(req: Request) {
  if (await isConnected()) {
    return NextResponse.json(
      {
        error: "Simulation is disabled while a real Buffer token is configured — use the real Schedule button instead.",
      },
      { status: 409 },
    );
  }
  let body: { posts?: Array<{ localId: string; text: string; dueAt?: string }>; channelIds?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return NextResponse.json({ error: "No posts supplied." }, { status: 400 });
  }
  if (!Array.isArray(body.channelIds) || body.channelIds.length === 0) {
    return NextResponse.json({ error: "Select at least one demo channel." }, { status: 400 });
  }
  const results = body.posts.flatMap((post) =>
    body.channelIds!.map((channelId) => ({
      localId: post.localId,
      channelId,
      ok: true,
      isDemo: true,
      bufferPostId: demoPostId(post.localId, channelId),
      dueAt: post.dueAt ?? null,
    })),
  );
  return NextResponse.json({
    mode: "demo",
    isDemo: true,
    attempted: results.length,
    succeeded: results.length,
    failed: 0,
    notice: "DEMO ONLY — these posts were NOT sent to Buffer. No real posts were created.",
    results,
  });
}
