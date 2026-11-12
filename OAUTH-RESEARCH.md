# Buffer OAuth Research — LaunchLoop (Buffer Commit)

Researched 2026-11-12 from the official Buffer developer docs
(`developers.buffer.com`, pages crawled 2026-11-12 14:27 UTC), the official
Buffer Commit page + Terms (`buffer.com/api/commit`, `/api/commit/terms`),
and the live official GraphQL reference (`developers.buffer.com/reference.html`).

## Verdict

**OAuth is REQUIRED, and it is POSSIBLE.** The win-strategy audit's critical
finding is confirmed — and the fix is buildable:

1. **Terms §1, step 5:** the submission must "Provide the Project's Buffer
   API app client ID, so Buffer can verify the app is built on and connected
   to the Buffer API."
2. **Terms §3:** "To be eligible, a submitted Project must be publicly
   available at the time of Submission and through the judging period, must
   be connectable to a Buffer account, **must authenticate users through
   Buffer OAuth**, and must make at least one successful call to the Buffer
   API. … Submissions that do not meet these requirements by the close of
   the Submission Window **are ineligible and will not be considered for a
   prize**."
3. The contest page itself: "To be eligible, every build needs to: Work end
   to end, **connect through Buffer OAuth**, and make real API calls."
4. **A personal API key alone is an eligibility fail** — it is not OAuth, and
   there is no client ID to put in the submission. LaunchLoop as built on
   Nov 9 (personal key only) could not have won.

**But a new OAuth app CAN be registered right now.** The official
"Building Apps" guide says: "To register a client open Settings → API in
Buffer and select the App Clients tab", then "Click New Client and fill in
the details" — name, logo, privacy policy link, public/private choice,
permissions (scopes), redirect URI — and "Save the configuration and you
will get your app's credentials — a client ID and a client secret."
Buffer founder Joel Gascoigne's announcement post says the same in plain
words: "You can create a personal token or OAuth app right away."

## What the OAuth flow requires (docs, quoted/paraphrased exactly)

From the official Authentication guide
(`developers.buffer.com/guides/authentication.html`):

> "Buffer supports OAuth 2.0 so you can build apps that access Buffer
> accounts on behalf of your users. This guide walks you through the
> **Authorization Code flow with PKCE**, which is required for all Buffer
> OAuth clients."

Prerequisites: "A **Buffer account**… A **registered OAuth client**. Visit
Settings → API to register your app. Confidential clients (apps that can
keep a secret on a server) receive a `client_id` and `client_secret`.
Public clients (mobile, desktop, and single-page apps that can't safely
store a secret) receive only a `client_id` and authenticate using PKCE
alone." Plus "A **redirect URI**. The URL in your app where Buffer sends
users after they approve access. It must match the URI you registered."

The five steps:

1. Generate a PKCE code verifier (random) + code challenge (SHA-256,
   base64url, method `S256`). "Store the `codeVerifier` in your session."
2. Redirect the user to:
   `GET https://auth.buffer.com/auth?client_id=…&redirect_uri=…&response_type=code&scope=…&state=…&code_challenge=…&code_challenge_method=S256&prompt=consent`
   ("The user will see a Buffer login screen (if needed), then a consent
   screen showing your app and the requested permissions.")
3. Buffer redirects back: `https://yourapp.com/callback?code=…&state=…`
   (or `?error=access_denied&state=…`). "Verify the `state` matches what
   you stored in Step 2, then extract the `code`."
4. Exchange the code: `POST https://auth.buffer.com/token`
   (`application/x-www-form-urlencoded`) with `client_id`, `client_secret`
   (confidential only — "Public clients authenticate with the
   `code_verifier` alone and must **not** send a `client_secret`"),
   `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`.
   Response: `{ access_token, refresh_token, token_type: "Bearer",
   expires_in: 3600, scope }`. "Store the tokens securely on your server."
5. Call the API with `Authorization: Bearer <access_token>` against
   `https://api.buffer.com` — the same GraphQL endpoint the personal key
   uses, so the existing GraphQL client works unchanged behind the new
   auth layer.

Token rules that shape the implementation:

- "The access token is short-lived. It is good for about an hour."
- "The refresh token is long-lived, and only arrives if you configure the
  required scope server-side. Include `offline_access` in the scopes on
  the authorization request and Buffer returns a refresh token alongside
  the access token. Without it, your app sends the user back through the
  consent screen every hour."
- "Refresh tokens are single-use. Every successful refresh returns a new
  refresh_token and invalidates the one you sent. Always save the latest
  refresh token and discard the old one. **Reusing an old refresh token
  revokes all tokens for that grant** — your user will need to re-authorize."
- "Tokens are credentials for someone else's account, so they belong on
  your server. Never put them in localStorage, sessionStorage, or a cookie
  that page JavaScript can read." The docs' recommended starting point is
  "an encrypted, HttpOnly session cookie" — which is what LaunchLoop uses.
- Redirect URIs: "Buffer only redirects to URIs you register in advance
  and compares them character for character", "HTTPS is required,
  including on localhost", and "A client can hold several URIs. You can
  register a localhost URI for development and a public URI for production,
  and keep both."

Scopes used by LaunchLoop: `account:read posts:read posts:write
offline_access` — the narrowest set that covers account + channels +
queue + create/delete posts + long-lived access. (`ideas:*`, `snippets:*`,
`notes:*`, `account:write` are not requested.)

## What the submission must contain (Terms §1)

1. Demo video ≤ 2 min, working end to end against the live Buffer API
   (slides are not a substitute).
2. Link to the publicly hosted application.
3. Written summary, ~300 words (problem, audience, API surface, next
   steps).
4. Entrant's full legal name(s), email(s), social handles.
5. **The project's Buffer API app client ID.**
6. Build-in-public trail (optional, max 5 links, Oct 15 – Nov 13) — only
   needed for the Build-in-Public Award, not for eligibility.

## Can a personal-key app be "registered as an OAuth app"?

No — they are two different credential types in Buffer's model, and the
docs' own table ("Personal Access Tokens vs App Clients") draws the line:

| | Personal Access Token | App client |
|---|---|---|
| Acts for | You, the person who created it | Any user who connects their account |
| Good for | Personal scripts, internal automations, one-off workflows | Apps other people sign in to |
| How it authenticates | A key in the `Authorization` header | OAuth 2.0 Authorization Code flow with PKCE |
| Setup | Create a key and use it | Register a client, then each user approves it |

"So if you'd like to build apps or integrations that other people will
use — you should build an app client." A personal key cannot be converted
into an OAuth client; the OAuth client is a **separate registration** in
the same Settings → API page (App Clients tab). Both can coexist on one
account: the personal key stays useful for local testing, while the OAuth
client is what the contest requires. LaunchLoop keeps the personal key as
a fallback, with OAuth taking precedence whenever a session exists.

## A conflicting third-party claim — checked, not followed

One third-party article (zernio.com, "Buffer API: docs, pricing, keys,
and alternatives [2026]") claims "Buffer stopped accepting new developer
app registrations, so you can't get a `client_id`" and "third-party OAuth
… isn't enabled yet." That claim is about the **legacy REST API**
(`api.bufferapp.com/1`), whose developer-app registration closed in 2019.
It does **not** describe the current GraphQL API on `developers.buffer.com`,
whose Authentication and Building Apps guides (crawled 2026-11-12)
document live OAuth client registration, and whose contest the founder
announces with "create … [an] OAuth app right away". The official docs
win over the third-party article. The one thing that can still only be
settled inside his Buffer account is whether the App Clients tab actually
renders for his (free) account — that is the ~15-minute check in
STATUS-2026-11-12.md. If the tab is missing, the fallback is to ask
Buffer in the Commit Discord; the personal key alone must never be
submitted as if it were compliant.

## What was implemented (2026-11-12)

- `src/lib/oauth.ts` — pure PKCE + authorize-URL + token-exchange/refresh
  builders, AES-256-GCM session encryption, config reader. 20 unit tests.
- `src/lib/session.ts` — encrypted HttpOnly session cookie, PKCE state
  cookie, auto-refresh with single-use refresh-token rotation.
- `src/app/api/auth/buffer/route.ts` — start flow (503 with missing env
  names when unconfigured; 302 to `auth.buffer.com/auth` when configured).
- `src/app/api/auth/buffer/callback/route.ts` — state verification, code
  exchange, session write, redirect home with `?connected=buffer` or
  `?oauth_error=…`.
- `src/app/api/auth/buffer/disconnect/route.ts` — clear the session.
- `src/lib/buffer.ts` — token resolution is now OAuth-first, personal-key
  fallback; the GraphQL client itself is unchanged.
- UI: "Connect with Buffer (OAuth)" / "Disconnect Buffer" in the banner;
  `/api/status` reports `authMethod: oauth | personal-key | none`.

Verified locally 2026-11-12 (production build, no real credentials):
tests 51/51; build OK; `/api/auth/buffer` with dummy config returns a
307 to `auth.buffer.com/auth` with all required params and sets the
HttpOnly state cookie; `/api/status` reports `oauthConfigured: true`
while still in demo mode. The live end-to-end exchange (real client ID,
real approval, real token, real API call) is **not yet verified** — it
needs his Buffer account + the deployed URL. See DEPLOY-README.md.

## GraphQL details resolved from the official reference (same research pass)

Both audit items are resolved from the live official GraphQL reference
(`developers.buffer.com/reference.html`, crawled 2026-11-12):

1. **`deletePost` union members — RESOLVED.** `DeletePostInput` has exactly
   one field: `id : PostId!` ("deletePost mutation deletes a post by id").
   The success payload "returns the post id that was deleted" (field
   `id : PostId!`). The reference's own guidance for error members:
   "Select `... on MutationError { message }` rather than naming concrete
   error types. Every error member implements that interface, so the
   selection keeps working across the change." LaunchLoop now selects
   `... on DeletePostSuccess { id }` + `... on MutationError { message }`
   (the earlier `... on VoidMutationError` concrete name was replaced).
   Note: some third-party guides show `deletePost(input: { postId: … })`
   or `DeletePostSuccess { post { id } }` — both contradict the official
   reference and are not used.
2. **`status` filter — RESOLVED (it EXISTS).** `PostsFiltersInput` still
   lists `status : [PostStatus!]` — "When set, it will filter posts by
   status" — and `PostsInput` has exactly three fields (`filter`,
   `organizationId`, `sort`). The third-party claim that Buffer removed
   `status` (and `after`) from `PostsInput` in a 2026 update is contradicted
   by the live official reference. LaunchLoop's queue query
   (`filter: { status: [scheduled], channelIds }`, `sort: [{ field: dueAt,
   direction: asc }]`) is correct as written. Live behaviour is still
   unverified (no real token yet) — the first real-token run must record
   the raw responses.
