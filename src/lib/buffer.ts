// Buffer API client — server-side only. The token NEVER leaves the server:
// it is read from process.env.BUFFER_ACCESS_TOKEN and sent only to
// https://api.buffer.com as an Authorization: Bearer header.
//
// API surface used (all from the official docs at developers.buffer.com,
// fetched 2026-11-09):
//   - Base: POST https://api.buffer.com, Content-Type: application/json,
//     body { query }, header Authorization: Bearer <API key>
//   - Auth: personal API key from Buffer Settings -> API
//     (publish.buffer.com/settings/api), OR OAuth 2.0 Authorization Code +
//     PKCE (auth.buffer.com/auth + /token) — see src/lib/oauth.ts and
//     src/lib/session.ts. OAuth is the REQUIRED auth for the Buffer Commit
//     contest (Terms §1 step 5 + §3: the submission must provide the app's
//     Buffer API app client ID, and the project "must authenticate users
//     through Buffer OAuth"). Token resolution order in bufferGraphQL:
//     (1) OAuth access token from the encrypted session cookie (refreshed
//     automatically when near expiry), (2) personal API key from
//     BUFFER_ACCESS_TOKEN. The personal key is a single-user fallback only;
//     it does NOT satisfy the contest's OAuth requirement on its own.
//   - account { id email name organizations { id name } }
//   - channels(input: { organizationId }) { id name service avatar isQueuePaused }
//   - posts(first, input: { organizationId, filter: { status: [scheduled],
//     channelIds }, sort: [{ field: dueAt, direction: asc }] })
//     { edges { node { id text status dueAt channelId } } pageInfo { hasNextPage endCursor } }
//   - createPost(input: { text, channelId, schedulingType: automatic,
//     mode: customScheduled, dueAt }) — schedule one post at an exact time.
//     mode: addToQueue adds to the next queue slot; mode: shareNow posts now.
//   - createPost(input: { ..., saveToDraft: true }) — save as a draft
//     (status 'draft', not published until explicitly scheduled).
//   - deletePost(input: { id }) — deletes a post by id. RESOLVED 2026-11-12
//     against the live official reference (developers.buffer.com/reference.html):
//     DeletePostInput has exactly one field, `id : PostId!`; the success
//     payload returns the deleted post's `id`. The error side is selected
//     with the `MutationError` interface, per the reference's own guidance:
//     "Select `... on MutationError { message }` rather than naming concrete
//     error types. Every error member implements that interface, so the
//     selection keeps working across the change." (An earlier version of this
//     file selected `... on VoidMutationError`; that concrete name is fragile
//     and has been replaced.)
//   - posts filter `status: [scheduled]` — RESOLVED 2026-11-12: the live
//     official reference still lists `status : [PostStatus!]` in
//     PostsFiltersInput ("When set, it will filter posts by status"). A
//     third-party note claiming Buffer removed `status` from PostsInput in a
//     2026 update is contradicted by the official reference. The queue query
//     below keeps the migration-guide form. If the live API ever rejects it,
//     the raw Buffer error is surfaced by listScheduledPosts.
//   - One channel per createPost call: multi-channel = one mutation per channel.
//   - The legacy REST API (api.bufferapp.com/1) is deprecated (Feb 2027)
//     and is NOT used anywhere in this app.
//
// KNOWN UNCERTAINTIES (not guessed — surfaced honestly):
//   - The two GraphQL details flagged in the Nov 12 win-strategy audit are
//     now RESOLVED from the live official reference (see the header above):
//     `deletePost` takes `input: { id }` and returns the deleted id; the
//     `status` filter still exists in PostsFiltersInput. What is NOT yet
//     verified is the LIVE behaviour — no real token has ever been used
//     against this app, so the first real-token run must still record the
//     raw Buffer responses (see DEPLOY-README.md).
//   - editPost exists in Buffer's reference index, but its input fields were
//     not verified, so this app does NOT call it: posts are edited locally
//     before scheduling. Do not add an editPost call without verifying it
//     against the live reference first.
//   - Media upload was not needed for this text-first campaign and was not
//     implemented.

import { getOAuthAccessToken, hasOAuthSession } from "./session";

export const BUFFER_API_URL = "https://api.buffer.com";

/** The personal-key env var. The ONLY env var this app reads for a token.
 *  No fallback, no default. OAuth sessions (see session.ts) take precedence
 *  when one exists. */
export function getBufferToken(): string {
  return (process.env.BUFFER_ACCESS_TOKEN ?? "").trim();
}

export function isBufferConnected(): boolean {
  return getBufferToken().length > 0;
}

export type AuthMethod = "oauth" | "personal-key" | "none";

/** Which credential is actually in play for the current request: an OAuth
 *  session cookie first, else the personal API key, else none. */
export async function getAuthMethod(): Promise<AuthMethod> {
  if (hasOAuthSession()) return "oauth";
  if (isBufferConnected()) return "personal-key";
  return "none";
}

/** True when any credential (OAuth session or personal key) is available. */
export async function isConnected(): Promise<boolean> {
  return (await getAuthMethod()) !== "none";
}

/** Resolve the Bearer token for one Buffer call: OAuth access token first
 *  (auto-refreshed when near expiry), personal API key second. Returns ""
 *  when nothing is configured. */
async function resolveAccessToken(): Promise<string> {
  const oauthToken = await getOAuthAccessToken();
  if (oauthToken) return oauthToken;
  return getBufferToken();
}

export class BufferApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "BufferApiError";
    this.status = status;
    this.details = details;
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function bufferGraphQL<T>(query: string): Promise<T> {
  const token = await resolveAccessToken();
  if (!token) {
    throw new BufferApiError(
      "No Buffer credential configured. Connect with Buffer OAuth (the Connect button) or set BUFFER_ACCESS_TOKEN to schedule for real.",
      401,
    );
  }
  let res: Response;
  try {
    res = await fetch(BUFFER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
      // Fail fast instead of hanging the request if Buffer is unreachable.
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new BufferApiError(
        `Timed out after 15s waiting for ${BUFFER_API_URL}. Buffer may be unreachable from this network — check connectivity and try again.`,
        504,
      );
    }
    throw new BufferApiError(
      `Could not reach ${BUFFER_API_URL}: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  if (res.status === 401) {
    throw new BufferApiError(
      "Buffer rejected the access token (401 Unauthorized). If you connected with OAuth, reconnect with the Connect button; if you use a personal key, check BUFFER_ACCESS_TOKEN — it may be expired or revoked. Create a fresh key at Buffer Settings → API.",
      401,
    );
  }
  if (!res.ok) {
    throw new BufferApiError(`Buffer API returned HTTP ${res.status}.`, res.status);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new BufferApiError(
      `Buffer API error: ${json.errors.map((e) => e.message).join("; ")}`,
      502,
      json.errors,
    );
  }
  if (!json.data) {
    throw new BufferApiError("Buffer API returned no data.", 502, json);
  }
  return json.data;
}

export interface BufferOrganization {
  id: string;
  name: string;
}

export interface BufferAccount {
  id: string;
  email: string;
  name: string;
  organizations: BufferOrganization[];
}

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  avatar?: string | null;
  displayName?: string | null;
  isQueuePaused?: boolean;
  organizationId: string;
  /** Always false for real channels; true only for local demo stand-ins. */
  demo?: false;
}

export async function getAccount(): Promise<BufferAccount> {
  const data = await bufferGraphQL<{ account: BufferAccount }>(`
    query GetAccount {
      account {
        id
        email
        name
        organizations { id name }
      }
    }
  `);
  return data.account;
}

export async function getChannels(organizationId: string): Promise<BufferChannel[]> {
  const data = await bufferGraphQL<{ channels: Omit<BufferChannel, "organizationId" | "demo">[] }>(`
    query GetChannels {
      channels(input: { organizationId: ${JSON.stringify(organizationId)} }) {
        id
        name
        service
        avatar
        isQueuePaused
      }
    }
  `);
  return data.channels.map((c) => ({ ...c, organizationId }));
}

/** All channels across all organizations on the account. */
export async function getAllChannels(): Promise<{ account: BufferAccount; channels: BufferChannel[] }> {
  const account = await getAccount();
  const channels: BufferChannel[] = [];
  for (const org of account.organizations) {
    const orgChannels = await getChannels(org.id);
    channels.push(...orgChannels);
  }
  return { account, channels };
}

export interface BufferPost {
  id: string;
  text: string;
  status: string;
  dueAt?: string | null;
  channelId?: string | null;
  sentAt?: string | null;
}

export async function listScheduledPosts(
  organizationId: string,
  channelIds: string[],
): Promise<BufferPost[]> {
  const data = await bufferGraphQL<{
    posts: { edges: Array<{ node: BufferPost }>; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
  }>(`
    query ListScheduledPosts {
      posts(
        first: 50
        input: {
          organizationId: ${JSON.stringify(organizationId)}
          filter: {
            status: [scheduled]
            channelIds: ${JSON.stringify(channelIds)}
          }
          sort: [{ field: dueAt, direction: asc }]
        }
      ) {
        edges { node { id text status dueAt channelId } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `);
  return data.posts.edges.map((e) => e.node);
}

export interface CreatePostResult {
  ok: boolean;
  post?: { id: string; text: string; dueAt?: string | null; status?: string | null };
  error?: string;
}

function parseCreatePost(data: unknown): CreatePostResult {
  const payload = (data as { createPost?: { post?: CreatePostResult["post"]; message?: string } | null })
    .createPost;
  if (payload?.post) return { ok: true, post: payload.post };
  return { ok: false, error: payload?.message ?? "Buffer returned an unknown createPost result." };
}

/**
 * Schedule ONE post to ONE channel at an exact UTC time (dueAt, ISO 8601).
 * Uses mode: customScheduled + schedulingType: automatic, per the docs.
 */
export async function createScheduledPost(
  channelId: string,
  text: string,
  dueAt: string,
): Promise<CreatePostResult> {
  const data = await bufferGraphQL<unknown>(`
    mutation CreateScheduledPost {
      createPost(input: {
        text: ${JSON.stringify(text)}
        channelId: ${JSON.stringify(channelId)}
        schedulingType: automatic
        mode: customScheduled
        dueAt: ${JSON.stringify(dueAt)}
      }) {
        ... on PostActionSuccess {
          post { id text dueAt status }
        }
        ... on MutationError {
          message
        }
      }
    }
  `);
  return parseCreatePost(data);
}

/** Save ONE post to ONE channel as a Buffer draft (not scheduled). */
export async function createDraftPost(channelId: string, text: string): Promise<CreatePostResult> {
  const data = await bufferGraphQL<unknown>(`
    mutation CreateDraftPost {
      createPost(input: {
        text: ${JSON.stringify(text)}
        channelId: ${JSON.stringify(channelId)}
        schedulingType: automatic
        mode: addToQueue
        saveToDraft: true
      }) {
        ... on PostActionSuccess {
          post { id text dueAt status }
        }
        ... on MutationError {
          message
        }
      }
    }
  `);
  return parseCreatePost(data);
}

/**
 * Delete a scheduled/draft post from Buffer by id.
 * Shape verified 2026-11-12 against the live official reference:
 * input is `id : PostId!`, success returns the deleted `id`, errors are
 * selected via the `MutationError` interface. The live API's raw error is
 * still surfaced if the shape is ever rejected.
 */
export async function deletePost(postId: string): Promise<{ ok: boolean; error?: string }> {
  const data = await bufferGraphQL<{ deletePost?: { id?: string; message?: string } | null }>(`
    mutation DeletePost {
      deletePost(input: { id: ${JSON.stringify(postId)} }) {
        ... on DeletePostSuccess {
          id
        }
        ... on MutationError {
          message
        }
      }
    }
  `);
  if (data.deletePost?.id) return { ok: true };
  return { ok: false, error: data.deletePost?.message ?? "Buffer returned an unknown deletePost result." };
}
