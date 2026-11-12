# LaunchLoop — Product-Launch Campaign Autopilot (Buffer Commit)

**One launch date in → a 14-day, multi-channel campaign scheduled in Buffer.**

Founders waste hours every launch writing and scheduling the same posts across
every social channel — teaser, countdown, launch day, follow-up — and either
post everything at random times or give up halfway. LaunchLoop is the single
best solution to that one problem: enter the product details and launch date,
get a complete 14-day posting calendar with optimal posting times, edit every
post, and schedule the whole campaign through the Buffer API in one click.

Built for the **Buffer Commit** challenge
([buffer.com/api/commit](https://buffer.com/api/commit) — $25,600 pool, submit
by **Fri Nov 13, 2026, 11:59 PM PT**, winners Dec 7).
**Nothing has been submitted yet — submission is a separate, user-approved step.**

## What it does

- **Campaign generator** — 14 posts over 14 days: teaser (T-13), problem (T-10),
  behind-the-scenes (T-7), 2× feature spotlights (T-5, T-3), countdowns (T-2, T-1),
  **2 posts on launch day** (09:00 + 18:00), thank-you/social proof (T+1), how-to
  (T+2), FAQ (T+3), roadmap (T+5), one-week recap (T+7).
- **Optimal posting times** — weekdays 09:00–10:00, weekends 11:00, launch day
  09:00 + 18:00, in your chosen timezone, converted to exact UTC `dueAt`
  timestamps for Buffer (DST-aware, tested for PST/PDT and PKT).
- **Edit flow** — every post is editable inline, with a live character count and
  a ≤280-char "fits everywhere" indicator, per-post include/exclude, and
  reset-to-generated text.
- **Progress tracker** — scheduled / demo / failed / included counts with a
  progress bar; per-post Buffer post IDs and per-post error messages.
- **Schedule or draft in Buffer** — "Schedule entire campaign" creates each post
  at its exact time; "Save all as Buffer drafts" saves them unscheduled.
- **Verify in Buffer** — loads the real scheduled queue from Buffer.
- **Honest demo mode** — with no token, the UI says so clearly and scheduling
  is *refused* (HTTP 409). A separate, explicitly labelled **Simulate (demo
  only)** button tests the flow with fake `demo-…` ids. Demo results are never
  presented as real scheduling.

## How the Buffer API is used

All Buffer calls are server-side only, in `src/lib/buffer.ts`, via the
**current GraphQL API** (docs: `developers.buffer.com`, read 2026-11-09).
The legacy REST API (`api.bufferapp.com/1`) is deprecated (Feb 2027) and is
**not used anywhere**.

| Operation | Call |
|---|---|
| Auth | `POST https://api.buffer.com`, header `Authorization: Bearer <token>`, body `{ "query": … }` — token is the **OAuth access token** from the encrypted session cookie when connected via OAuth (required for the contest), else the personal API key `BUFFER_ACCESS_TOKEN` fallback |
| Account + orgs | `query { account { id email name organizations { id name } } }` |
| Channels | `query { channels(input: { organizationId }) { id name service avatar isQueuePaused } }` |
| Scheduled queue | `query { posts(first: 50, input: { organizationId, filter: { status: [scheduled], channelIds }, sort: [{ field: dueAt, direction: asc }] }) { edges { node { id text status dueAt channelId } } pageInfo { hasNextPage endCursor } } }` |
| Schedule a post | `mutation { createPost(input: { text, channelId, schedulingType: automatic, mode: customScheduled, dueAt: "<ISO-8601 UTC>" }) { … on PostActionSuccess { post { id text dueAt status } } … on MutationError { message } } }` |
| Save as draft | Same mutation with `mode: addToQueue, saveToDraft: true` (status becomes `draft`) |
| Delete a post | `mutation { deletePost(input: { id }) { … } }` |

Notes:

- GraphQL **always returns HTTP 200**, so every response is checked for the
  `errors` array and for the `PostActionSuccess` / `MutationError` union —
  a 200 never means "it worked".
- `createPost` takes **one `channelId`** — multi-channel scheduling sends one
  mutation per post per channel.
- **OAuth (contest-required, implemented 2026-11-12):** Authorization Code
  flow + PKCE — `GET /api/auth/buffer` redirects to `auth.buffer.com/auth`,
  `GET /api/auth/buffer/callback` exchanges the code at
  `auth.buffer.com/token`, tokens live in an encrypted HttpOnly session
  cookie (AES-256-GCM, `BUFFER_SESSION_SECRET`), auto-refreshed with the
  single-use refresh token. Scopes: `account:read posts:read posts:write
  offline_access`. Client registered at Buffer Settings → API → App Clients;
  the **client ID goes in the submission** (Terms §1 step 5). See
  `OAUTH-RESEARCH.md` (docs, quotes, verdict) and `DEPLOY-README.md`.
- The personal-key fallback is read **only** from the env var
  `BUFFER_ACCESS_TOKEN` (server-side, never in the browser, never logged,
  never returned by any API — `/api/status` returns only the auth method,
  never a value). No token is hardcoded anywhere.
- A 15-second timeout guards every Buffer call so an unreachable API fails
  fast with a clear message instead of hanging.
- **Resolved 2026-11-12 from the live official reference
  (`developers.buffer.com/reference.html`):** `deletePost` takes
  `input: { id }` and returns the deleted `id`; errors are selected via the
  `MutationError` interface (the code was updated from the fragile
  `VoidMutationError` fragment). The `status` filter **still exists** in
  `PostsFiltersInput` — a third-party claim that Buffer removed it is
  contradicted by the official reference. Live behaviour is still
  unverified (no real token yet) — the first real-token run must record the
  raw responses (see `DEPLOY-README.md`).
  `editPost` exists in the reference index but its input fields were not
  verified, so this app does **not** call it: posts are edited locally before
  scheduling. Do not add an `editPost` call without verifying it first.
  Media upload was not needed for this text-first campaign and was not
  implemented.

## The steps only the user can do: OAuth client + deploy

The app is complete, but **no real Buffer scheduling is possible until the
user registers the OAuth client and deploys** — there is no token, client
ID, or client secret on this machine and none was invented.

1. Log in to [Buffer](https://buffer.com) as **umarshareef0165@gmail.com** and
   connect at least one social channel.
2. Deploy first (see `DEPLOY-README.md` — `npx vercel`, then
   `npx vercel --prod`), note the production domain.
3. Go to **Settings → API** (`publish.buffer.com/settings/api`) → **App
   Clients** tab → **New Client**: name `LaunchLoop`, type
   **private/confidential**, scopes `account:read`, `posts:read`,
   `posts:write`, `offline_access`, redirect URI
   `https://<your-vercel-domain>/api/auth/buffer/callback` (exact match).
   Copy the client ID + client secret.
4. In Vercel → Project → Settings → Environment Variables (Production) set
   `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`, `BUFFER_REDIRECT_URI`, and
   `BUFFER_SESSION_SECRET` (a fresh random string), then redeploy.
   (Optional fallback for local testing: also create a personal API key in
   Settings → API and set `BUFFER_ACCESS_TOKEN` — it does NOT replace OAuth
   for the contest.)
5. Open the app, click **Connect with Buffer (OAuth)**, approve on Buffer,
   and the banner turns green — your real channels appear, and scheduling
   goes to real Buffer.

Never paste a key, client ID, or client secret into chat or any form field.
No credential is ever committed (`.env*` is gitignored). Full checklist:
`DEPLOY-README.md`.

## Run locally

```bash
cd buffer-commit
npm install
cp .env.example .env.local   # add BUFFER_ACCESS_TOKEN (optional for demo mode)
npm run dev                  # http://localhost:3000
npm test                     # vitest
npm run build && npm start   # production
```

## Deploy (Vercel, free Hobby tier)

See **`DEPLOY-README.md`** for the full procedure (OAuth client first,
env vars, live-verification checklist). Short version:

```bash
npx vercel            # or: import the repo in vercel.com → New Project
npx vercel --prod
# then set BUFFER_CLIENT_ID, BUFFER_CLIENT_SECRET, BUFFER_REDIRECT_URI and
# BUFFER_SESSION_SECRET in Vercel → Settings → Environment Variables,
# redeploy, and run the live-verification checklist.
```

## Tests — 51/51 passing

`npm test` (Vitest, `src/lib/campaign.test.ts` + `src/lib/oauth.test.ts`):

- Plan shape: 14 posts, offsets T-13…T+7, two launch-day posts, sorted by
  `dueAt`, unique ids, every sample post ≤ 280 chars.
- Posting times: launch day 09:00/18:00, Saturday 11:00, Tuesday 10:00,
  Friday 09:00.
- Timezone math: LA winter (PST, UTC-8) 09:00 → 17:00Z; LA summer (PDT,
  UTC-7) 10:00 → 17:00Z; Karachi (PKT, UTC+5) 10:00 → 05:00Z; leap-day and
  month/year boundaries.
- Validation: missing name, past/malformed date, unknown timezone, bad URL,
  empty/>2000-char post text.
- Progress counting and demo-id format; token reader reads only
  `BUFFER_ACCESS_TOKEN` and is empty when unset.

OAuth (`src/lib/oauth.test.ts`, 20 tests):

- PKCE: verifier format (43 base64url chars), challenge matches the RFC 7636
  Appendix B test vector, challenge format.
- State: 32 hex chars, unique per call.
- Authorize URL carries every parameter the Buffer docs require
  (`client_id`, `redirect_uri`, `response_type=code`, scopes including
  `offline_access`, `state`, `code_challenge`, `code_challenge_method=S256`).
- Token bodies: authorization_code exchange sends `client_secret` + verifier
  for a confidential client; public clients omit `client_secret`; refresh
  grant sends `grant_type=refresh_token`.
- Session encryption (AES-256-GCM): round-trip, random salt/IV per
  encryption, tampered ciphertext and wrong secret fail closed (null).
- Expiry: 60 s safety margin; `sessionFromTokens` converts `expires_in` to
  epoch-ms expiry.
- Config: missing vars reported by name; session-secret fallback to the
  client secret.

## Live-tested end to end (2026-11-09, production build)

- `npm run build` ✅; homepage `GET /` → **HTTP 200**.
- Demo mode (no token): `/api/status` → `connected:false, mode:"demo"`;
  `/api/channels` → 3 labelled demo channels; `POST /api/schedule` →
  **HTTP 409, nothing scheduled**; `/api/queue` → empty demo list;
  `POST /api/simulate` → 2 results with `demo-…` ids, `isDemo:true`.
- Fake-token mode: `/api/status` → `connected:true` (routes are dynamic, so
  the env var is read at request time, not baked in at build);
  `POST /api/simulate` → **HTTP 409** (simulation disabled once a token exists);
  `POST /api/schedule` → per-post failure recorded honestly, no crash.
- **Not verifiable from this VM:** a real Buffer call. Direct `curl` to
  `https://api.buffer.com` from this machine times out (12s, HTTP 000), and
  the app's Buffer calls fail fast with a clean 15s-timeout 504 instead of
  hanging. **The first real-token verification must happen after deploy**
  (or from a network that reaches `api.buffer.com`): set the real
  `BUFFER_ACCESS_TOKEN`, reload, confirm real channels load, schedule one
  test post, and confirm it appears in Buffer's dashboard queue.

## Project structure

```
src/
  lib/
    campaign.ts     # pure campaign engine: 14-day plan, optimal times, TZ math, validation
    campaign.test.ts# 31 tests
    buffer.ts       # server-side Buffer GraphQL client (create/schedule/draft/delete, queue)
    demo.ts         # clearly-labelled demo channels + demo ids (no-token mode only)
  app/
    page.tsx        # the whole UI: form, channels, calendar, editor, tracker, queue
                    # + Connect with Buffer (OAuth) / Disconnect buttons in the banner
    layout.tsx / globals.css
    api/
      status/route.ts    # GET connection state (authMethod: oauth | personal-key | none — never the token)
      channels/route.ts  # GET real channels, or demo channels when no token
      schedule/route.ts  # POST schedule-as-timed / save-as-draft (409 in demo mode)
      queue/route.ts     # GET scheduled posts from Buffer
      simulate/route.ts  # POST labelled local simulation (demo mode only)
      auth/buffer/route.ts            # GET start OAuth (PKCE + state, 302 to auth.buffer.com)
      auth/buffer/callback/route.ts  # GET verify state, exchange code, set session cookie
      auth/buffer/disconnect/route.ts # POST clear the OAuth session
  lib/
    oauth.ts        # pure OAuth helpers: PKCE, authorize URL, token exchange/refresh, session crypto
    oauth.test.ts   # 20 OAuth tests
    session.ts      # server-only encrypted HttpOnly session cookie + auto-refresh
```

## Status / still to do

- ✅ App built, tested (51/51), production build passes, live-tested locally.
- ✅ **OAuth implemented 2026-11-12** (Authorization Code + PKCE, encrypted
  session cookie, auto-refresh) — the contest's eligibility requirement.
  Verified up to the Buffer redirect with dummy config; the live exchange
  needs a real registered client (user step below).
- ✅ Docs: `OAUTH-RESEARCH.md`, `DEPLOY-README.md`, `SUMMARY-DRAFT.md`
  (301 words), `VIDEO-SCRIPT.md` (1:55), `STATUS-2026-11-12.md`.
- ⏳ **User steps:** register the OAuth app client in Buffer (App Clients
  tab) and report the result; deploy to Vercel; set the env vars; run the
  live-verification checklist (one real test post, confirm in the Buffer
  dashboard queue, delete it). Registration for Buffer Commit itself is
  still unverified.
- ⏳ **User step:** record the ≤2:00 demo video on the live app
  (`VIDEO-SCRIPT.md`).
- ⏳ **Submit** to Buffer Commit before Fri Nov 13, 2026, 11:59 PM PT —
  **only with the user's approval**; nothing has been submitted.
