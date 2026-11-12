# LaunchLoop — Buffer Commit submission summary (DRAFT, 300 words (counted))

> Draft prepared 2026-11-12. Do NOT submit as-is until the bracketed items
> are filled in with the real values (deployed URL, client ID, live-test
> confirmation). Nothing in this draft claims multi-user OAuth until the
> live OAuth flow has been verified end to end.

---

**Problem.** A launch is fourteen days of posting, not one
announcement: teaser, problem, behind-the-scenes, feature spotlights,
countdowns, launch day, thank-you, how-to, FAQ, roadmap, recap — across
every channel, each at the right hour. Founders rewrite the same posts,
guess at timing, or go quiet halfway, so launches fade when attention
matters most. Buffer schedules posts beautifully but does not plan a
launch: no campaign arc, no countdown logic. LaunchLoop is the planning
layer Buffer does not have.

**Audience.** Solo founders and creators launching a product — one launch
date, no social team, no time to become scheduling experts.

**What it does.** Enter the product details, launch date, and timezone,
and LaunchLoop generates a complete fourteen-post, fourteen-day campaign:
teaser, problem, behind-the-scenes, two feature spotlights, countdowns,
two posts on launch day (09:00 and 18:00), then thank-you, how-to, FAQ,
roadmap, and a one-week recap. Times follow tested rules — weekdays
09:00–10:00, weekends 11:00 — converted to exact UTC. Every post is
editable inline with a live character count; posts can be included or
excluded; and the whole campaign is scheduled into Buffer in one click,
or saved as drafts. A tracker shows scheduled and failed counts, and the
app reads the live scheduled queue back from Buffer to verify.

**Buffer API surface.** LaunchLoop connects through Buffer OAuth
(Authorization Code flow with PKCE; tokens in an encrypted HttpOnly
session cookie, never in the browser). It uses the GraphQL API at
`api.buffer.com`: `account`, `channels`, `posts` filtered by
`status: [scheduled]` and sorted by `dueAt`, `createPost` with
`mode: customScheduled` or `saveToDraft`, and `deletePost`. [LIVE TEST
pending: one real post scheduled, confirmed in the Buffer queue, then
deleted.]

**Next steps.** Templates for common launch types; per-channel best-time
learning from the account's own history; AI-assisted rewriting in the
editor; team workspaces for planning a launch together.

[Deployed URL: ___ · Buffer app client ID: ___ · Demo video: ___]
