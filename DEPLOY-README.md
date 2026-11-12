# Deploying LaunchLoop — Vercel (free Hobby tier)

## 0. What must exist first (his-only, ~15 min, in his Buffer account)

Do this **before** deploying, because the deploy's redirect URI must match
what is registered in Buffer character for character:

1. Log in to Buffer as **umarshareef0165@gmail.com** and connect at least
   one social channel (needed for any real scheduling).
2. Go to **Settings → API** (`publish.buffer.com/settings/api`) → **App
   Clients** tab → **New Client**.
   - Name: `LaunchLoop`
   - Type: **Private / confidential** (this app has a server that keeps a
     secret — Vercel). A public client would get no secret and would
     authenticate with PKCE alone; the code supports both, but private is
     the intended setup.
   - Permissions (scopes): enable `account:read`, `posts:read`,
     `posts:write`, and `offline_access` (the last one is what returns a
     refresh token, so the app stays connected through judging).
   - Redirect URI: the **production** URL of the deployed app, exactly:
     `https://<your-vercel-domain>/api/auth/buffer/callback`
     (you only know the domain after step 1 below, so register the client
     after the first deploy, or add the URI afterwards — a client can hold
     several URIs; you can also add a localhost one for local testing, but
     note Buffer requires HTTPS even on localhost).
3. Copy the **client ID** and **client secret** Buffer shows you.
   **Never paste them in chat, in a form, or in any file that gets
   committed.** They go only into Vercel environment variables (step 2).
4. Also create a **personal API key** in the same Settings → API page
   (optional, but useful as a fallback for local testing). Same rule:
   never paste it anywhere except the env var.

**Check to report back:** does the App Clients tab actually appear on his
(free) account, and did client creation succeed? If the tab is missing,
stop and ask Buffer in the Commit Discord — do not proceed as if the
personal key alone were enough (it is not; see OAUTH-RESEARCH.md).

## 1. Deploy

```bash
cd ~/workspace/buffer-commit
npx vercel            # first run: link/create the project, accept defaults
npx vercel --prod     # deploy production
```

Or: import the repo in vercel.com → New Project → Deploy. No build
settings need changing (Next.js preset; `npm run build`).

Note the production domain Vercel gives you (e.g.
`launchloop-xyz.vercel.app`). If you deployed before registering the
OAuth client, go back and set the redirect URI to exactly
`https://<that-domain>/api/auth/buffer/callback`, then redeploy is **not**
needed for the URI change — but the env vars in step 2 are, so do them
now.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

Names only — **never put values in a file, in chat, or in git**. Set each
for the **Production** environment, then redeploy (`npx vercel --prod`).

| Variable | Value (where it comes from) | Required? |
|---|---|---|
| `BUFFER_CLIENT_ID` | OAuth app client — App Clients tab | **Yes — contest requirement** |
| `BUFFER_CLIENT_SECRET` | OAuth app client secret (confidential client) | Yes for a private client; omit only for a public client |
| `BUFFER_REDIRECT_URI` | `https://<your-vercel-domain>/api/auth/buffer/callback` — must match the registered URI character for character | **Yes** |
| `BUFFER_SESSION_SECRET` | A long random string you generate (e.g. `openssl rand -base64 32`) — encrypts the session cookie. Generate a fresh one for production, never reuse a local one. | Yes (falls back to the client secret if unset — set a dedicated one) |
| `BUFFER_ACCESS_TOKEN` | Personal API key (Settings → API → Create a new API key) | Optional fallback for local testing; not a substitute for OAuth |

`.env*` is gitignored. For local runs, copy `.env.example` to
`.env.local` and fill it in there.

## 3. Live verification checklist (do all of these, in order, after deploy)

Do this **before** recording the demo video — the video must show the live
app against the live API.

- [ ] `GET https://<domain>/api/status` returns
      `{"connected":true,"authMethod":"oauth","mode":"live",…}`.
      If `authMethod` is `personal-key`, OAuth is not active — fix the env
      vars / client registration before going further.
- [ ] Open the app in a browser, click **Connect with Buffer (OAuth)**,
      approve on Buffer's consent screen, and land back on the app with
      "Connected to Buffer via OAuth". (This is the exact flow the judges
      will use.)
- [ ] Real channels load: the Channels section lists your actual Buffer
      channels (not the labelled demo channels).
- [ ] Schedule **ONE real test post** (a harmless test text, e.g.
      "LaunchLoop test — please ignore", due in ~10 minutes) to one
      channel. Confirm it appears in the **Buffer dashboard queue**
      (publish.buffer.com) with the right text, channel, and time.
- [ ] Read the queue back in the app ("Verify in Buffer") and confirm the
      test post shows up there too — this exercises the
      `filter: { status: [scheduled] }` query live.
- [ ] **Delete the test post** from the Buffer dashboard (or via the app's
      delete path) and confirm it is gone — this exercises `deletePost`
      live.
- [ ] Record the **raw responses** of the first real calls (status,
      channels, one createPost, one queue read, one deletePost) into a
      note — they are the first live proof of the `deletePost` union and
      the `status` filter, which until now are only verified against the
      docs, not against the live API.
- [ ] Confirm the app stays connected after an hour (access token refresh:
      reload the page ~65 minutes after connecting; channels must still
      load without re-approving — that proves the refresh token works).
- [ ] Keep the deployment **live through Dec 7** (winners announced) —
      the Terms require the project to stay publicly available through
      judging (Nov 16–20). Do not delete, rename, or redeploy-breaking
      the project in that window. Vercel Hobby is free; the app has no
      database and no paid dependency.

## 4. If something fails

| Symptom | Likely cause / fix |
|---|---|
| `/api/auth/buffer` returns 503 with `missing: [...]` | An env var is missing in Vercel. Add it (Production), redeploy. |
| Buffer shows "could not connect" on approval | `BUFFER_REDIRECT_URI` does not match a registered URI character for character (trailing slash, http vs https, wrong domain). Fix the registered URI or the env var so they are identical. |
| Callback lands on `?oauth_error=invalid_state` | The authorize round trip was interrupted, or cookies are blocked. Retry; allow cookies for the app domain. |
| Callback lands on `?oauth_error=invalid_grant` | The code expired or was already used (codes are single-use). Retry the connect flow once. |
| `/api/status` says `authMethod: personal-key` | An OAuth session cookie is not present — you connected with the key, or the OAuth session expired and refresh failed. Click Connect with Buffer (OAuth). |
| API calls return 401 | Token rejected. OAuth: reconnect. Personal key: rotate the key at Settings → API. |
| `api.buffer.com` unreachable / timeouts | The 15 s timeout returns a clean 504. Check network/Vercel status and retry — do not hammer the API (rate limits are per client). |

## 5. What NOT to do

- Do not commit `.env.local`, any key, client secret, or token to git.
- Do not paste any credential in chat, email, or a form.
- Do not submit the personal-key-only setup as contest-compliant — the
  Terms require OAuth + a client ID in the submission.
- Do not deploy from a machine state you cannot reproduce: the deploy
  source is this directory (`~/workspace/buffer-commit/`), tests 51/51,
  build green as of 2026-11-12.
