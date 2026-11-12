import { NextResponse } from "next/server";
import { BufferApiError, createDraftPost, createScheduledPost, isConnected } from "@/lib/buffer";
import { validatePostText } from "@/lib/campaign";

interface ScheduleRequestPost {
  localId: string;
  text: string;
  /** Exact UTC ISO timestamp for mode "schedule". */
  dueAt?: string;
}

interface ScheduleRequestBody {
  posts: ScheduleRequestPost[];
  channelIds: string[];
  /** "schedule" = createPost customScheduled at dueAt; "draft" = saveToDraft. */
  mode: "schedule" | "draft";
}

interface PerPostResult {
  localId: string;
  channelId: string;
  ok: boolean;
  bufferPostId?: string;
  dueAt?: string | null;
  error?: string;
}

/**
 * POST /api/schedule — the real scheduling path.
 * Without a token this ALWAYS refuses with 409 demoMode: true. It never
 * pretends a post was scheduled. Use POST /api/simulate for the explicitly
 * labelled local demo instead.
 */
export async function POST(req: Request) {
  if (!(await isConnected())) {
    return NextResponse.json(
      {
        mode: "demo",
        demoMode: true,
        error:
          "Demo mode — nothing was scheduled. No Buffer access token is configured, so LaunchLoop refused to schedule. Set BUFFER_ACCESS_TOKEN and try again.",
      },
      { status: 409 },
    );
  }

  let body: ScheduleRequestBody;
  try {
    body = (await req.json()) as ScheduleRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return NextResponse.json({ error: "No posts supplied." }, { status: 400 });
  }
  if (!Array.isArray(body.channelIds) || body.channelIds.length === 0) {
    return NextResponse.json({ error: "Select at least one Buffer channel." }, { status: 400 });
  }
  if (body.mode !== "schedule" && body.mode !== "draft") {
    return NextResponse.json({ error: 'mode must be "schedule" or "draft".' }, { status: 400 });
  }
  if (body.posts.length > 50) {
    return NextResponse.json({ error: "Too many posts in one request (max 50)." }, { status: 400 });
  }
  if (body.channelIds.some((id) => typeof id !== "string" || id.startsWith("demo-"))) {
    return NextResponse.json({ error: "Demo channel ids cannot be scheduled to Buffer." }, { status: 400 });
  }

  for (const post of body.posts) {
    const textError = validatePostText(post.text ?? "");
    if (textError) {
      return NextResponse.json({ error: `Post ${post.localId}: ${textError}` }, { status: 400 });
    }
    if (body.mode === "schedule") {
      if (!post.dueAt || Number.isNaN(Date.parse(post.dueAt))) {
        return NextResponse.json({ error: `Post ${post.localId}: a valid dueAt timestamp is required to schedule.` }, { status: 400 });
      }
      if (Date.parse(post.dueAt) <= Date.now()) {
        return NextResponse.json({ error: `Post ${post.localId}: dueAt is in the past.` }, { status: 400 });
      }
    }
  }

  const results: PerPostResult[] = [];
  try {
    // One createPost mutation per post per channel — Buffer's createPost
    // takes a single channelId (see src/lib/buffer.ts).
    for (const post of body.posts) {
      for (const channelId of body.channelIds) {
        try {
          const r =
            body.mode === "schedule"
              ? await createScheduledPost(channelId, post.text, post.dueAt as string)
              : await createDraftPost(channelId, post.text);
          results.push({
            localId: post.localId,
            channelId,
            ok: r.ok,
            bufferPostId: r.post?.id,
            dueAt: r.post?.dueAt ?? post.dueAt ?? null,
            error: r.error,
          });
        } catch (err) {
          results.push({
            localId: post.localId,
            channelId,
            ok: false,
            error: err instanceof BufferApiError ? err.message : "Unexpected Buffer error.",
          });
        }
      }
    }
  } catch (err) {
    if (err instanceof BufferApiError) {
      return NextResponse.json({ mode: "live", error: err.message, results }, { status: err.status });
    }
    return NextResponse.json({ mode: "live", error: "Unexpected error talking to Buffer.", results }, { status: 502 });
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({
    mode: "live",
    attempted: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
}
