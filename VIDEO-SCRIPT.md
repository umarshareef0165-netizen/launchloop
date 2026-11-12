# LaunchLoop — Demo Video Script (≤ 2:00, for the live app against the live Buffer API)

**Rules for the recording (from Terms §1):** video must show the project
working end to end against the **live Buffer API**. Slides are not a
substitute. Record the screen with the deployed app open and a real Buffer
account connected via OAuth. Total run time: **1:55 max** — leave 5 seconds
of margin under the 2:00 limit. One continuous take is best; if you cut,
keep every API moment visible and unbroken (no jump-cut across a schedule
click). Do not show any token, client secret, or password on screen at any
point — the OAuth consent screen is fine to show.

**Setup before recording (5 min):**
- Deploy is live; you are connected via OAuth (banner says "Connected to
  Buffer via OAuth").
- At least one real channel connected in Buffer.
- A fresh campaign ready to generate (product: a real or clearly-labelled
  example launch; use the defaults or your own product).
- Buffer dashboard open in a second tab (publish.buffer.com) for the queue
  proof at the end.
- Close unrelated tabs; hide bookmarks bar if it shows personal items.

## Shot list (with timings — total 1:55)

### 0:00–0:30 — Usefulness: the problem, in one launch (30 s)
- **0:00–0:08 — Say (to camera or voiceover):** "A launch isn't one post.
  It's fourteen days of posting — teaser, countdown, launch day, follow-up
  — and founders either rewrite the same posts for hours or go quiet."
  *On screen: the empty LaunchLoop form.*
- **0:08–0:20 — Say:** "LaunchLoop turns one launch date into the whole
  campaign." Type the product name, tagline, launch date, timezone, and
  click **Generate 14-day campaign**.
  *On screen: the generated calendar appears — 14 posts, T-13 to T+7.*
- **0:20–0:30 — Say:** "Teaser, countdown, two posts on launch day, and the
  follow-up — every post timed: weekdays nine, weekends eleven."
  *On screen: scroll the calendar; pause on the two launch-day posts.*

### 0:30–1:30 — Execution: edit, schedule, verify against live Buffer (60 s)
- **0:30–0:48 — Say:** "Every post is editable before it goes anywhere."
  Click one post, edit its text live, show the character count and the
  fits-everywhere indicator; exclude one post with its checkbox.
  *On screen: the edit happening, count updating.*
- **0:48–0:58 — Say:** "One click schedules the whole campaign through
  Buffer." Click **Schedule entire campaign in Buffer**.
  *On screen: the progress tracker fills — scheduled counts rising, real
  Buffer post IDs appearing per post. Do not cut during this.*
- **0:58–1:12 — Say:** "And here is the proof it is real." Switch to the
  **Buffer dashboard tab**: the scheduled queue shows the LaunchLoop posts
  with the right text, channel, and times.
  *On screen: Buffer's own queue, posts visible.*
- **1:12–1:30 — Say:** "Back in LaunchLoop, the queue read confirms it —
  and one click deletes a post if plans change." Click **Verify in Buffer**
  (queue loads), then delete the single test post and show it gone.
  *On screen: the app's queue list, then the delete confirmation.*

### 1:30–1:55 — Creativity: why this is not a scheduler (25 s)
- **1:30–1:42 — Say:** "Buffer schedules posts. LaunchLoop plans the
  launch — the arc, the timing, the per-post editing — then hands it to
  Buffer. That planning is the work Buffer doesn't do."
  *On screen: the campaign calendar, arc visible (teaser → countdown →
  launch day → follow-up).*
- **1:42–1:55 — Say:** "Connect with Buffer OAuth, generate, edit,
  schedule. Fourteen days, one click." Click **Disconnect Buffer**? No —
  end on the connected banner: "LaunchLoop — your launch, planned."
  *On screen: the green "Connected to Buffer via OAuth" banner + calendar.
  Hold 2 seconds, end.*

## Narration notes
- Speak plainly and at normal speed; the timings above assume ~150 words
  per minute. Total script is ~330 words — rehearse once against a timer.
- Name the three criteria in order (usefulness → execution → creativity)
  so the judges can map what they see to what they score.
- If a live call is slow (cold start, network), keep recording and narrate
  the wait honestly — a real delay is better than a cut that looks staged.
- After recording: watch it back once, confirm (a) no secret is visible,
  (b) the Buffer queue is legible, (c) run time ≤ 2:00. Upload as
  **public/unlisted** (whatever the submission form accepts) and keep the
  link — it goes in the submission next to the deployed URL and the
  client ID.

## If the live API is not ready when recording time comes
Do **not** record the demo-mode simulation and present it as live — the
Terms require the live API, and demo results are labelled demo-only for a
reason. Record only after DEPLOY-README.md's live-verification checklist
is fully ticked.
