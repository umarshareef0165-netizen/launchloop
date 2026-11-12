"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  campaignProgress,
  dayLabel,
  formatShortDate,
  generateCampaign,
  validatePostText,
  type CampaignInput,
  type CampaignPost,
} from "@/lib/campaign";

const TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

const STORAGE_KEY = "launchloop-campaign-v1";

interface Channel {
  id: string;
  name: string;
  service: string;
  organizationId: string;
  demo?: boolean;
}

interface StatusInfo {
  connected: boolean;
  mode: "live" | "demo";
  authMethod?: "oauth" | "personal-key" | "none";
  oauthConfigured?: boolean;
  message: string;
  howToConnect?: string;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Buffer connection was not approved — LaunchLoop cannot schedule until you approve it on Buffer.",
  invalid_state: "The Buffer sign-in was interrupted (state mismatch). Please try connecting again.",
  invalid_grant: "Buffer rejected the sign-in code (it may have expired). Please try connecting again.",
  not_configured: "Buffer OAuth is not configured on this deployment — the client ID / redirect URI are missing. See DEPLOY-README.md.",
  buffer_error: "Buffer returned an error during sign-in. Please try again.",
  exchange_failed: "The sign-in could not be completed. Please try connecting again.",
};

function defaultLaunchDate(): string {
  const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_INPUT: CampaignInput = {
  productName: "LaunchLoop",
  tagline: "Turn one launch date into a 14-day campaign on every channel.",
  problem: "founders waste hours every launch writing and scheduling the same posts across every social channel",
  audience: "indie founders",
  benefit1: "a full 14-day posting calendar in one click",
  benefit2: "every post scheduled at the best time for each day",
  url: "https://example.com",
  launchDate: defaultLaunchDate(),
  timezone: "America/Los_Angeles",
};

function loadSaved(): { input: CampaignInput; posts: CampaignPost[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { input: CampaignInput; posts: CampaignPost[] };
    if (!parsed?.input || !Array.isArray(parsed.posts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function Home() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [input, setInput] = useState<CampaignInput>(DEFAULT_INPUT);
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Array<{ id: string; text: string; dueAt?: string | null; status: string }> | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Restore saved campaign, then load live connection status + channels.
  // Also surface the result of a Buffer OAuth round trip (?connected=buffer
  // or ?oauth_error=…) once, then clean the URL.
  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setInput(saved.input);
      setPosts(saved.posts);
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("connected") === "buffer") {
        setNotice("Connected to Buffer via OAuth — your real channels are below. Scheduling now goes to real Buffer.");
      } else if (params.get("oauth_error")) {
        setError(OAUTH_ERROR_MESSAGES[params.get("oauth_error") as string] ?? "The Buffer sign-in could not be completed. Please try connecting again.");
      }
      if (params.has("connected") || params.has("oauth_error")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch {
      // Non-browser environment — ignore.
    }
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: StatusInfo) => setStatus(s))
      .catch(() => setStatus({ connected: false, mode: "demo", message: "Could not reach the status endpoint." }));
    fetch("/api/channels")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setChannelsError(d.error as string);
          return;
        }
        setChannels(d.channels as Channel[]);
        setOrganizations(d.organizations ?? []);
        setSelectedChannels((d.channels as Channel[]).map((c) => c.id));
      })
      .catch(() => setChannelsError("Could not load channels."));
  }, []);

  // Persist campaign locally (browser only — never sent anywhere except Buffer).
  useEffect(() => {
    if (posts.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, posts }));
    } catch {
      // Storage full/blocked — the campaign still works in memory.
    }
  }, [input, posts]);

  const progress = useMemo(() => campaignProgress(posts), [posts]);

  const generate = useCallback(() => {
    setError(null);
    setNotice(null);
    const result = generateCampaign(input);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPosts(result.posts);
    setNotice(`Generated ${result.posts.length} posts for ${input.productName}, ${formatShortDate(input.launchDate, input.timezone)} (${dayLabel(0)}). Review, edit, then schedule.`);
  }, [input]);

  const updatePost = useCallback((id: string, patch: Partial<CampaignPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, charCount: (patch.text ?? p.text).length, fitsEverywhere: (patch.text ?? p.text).length <= 280 } : p)));
  }, []);

  const resetPostText = useCallback((id: string) => {
    const result = generateCampaign(input);
    if ("error" in result) return;
    const fresh = result.posts.find((p) => p.id === id);
    if (fresh) updatePost(id, { text: fresh.text, error: undefined });
  }, [input, updatePost]);

  const includedPosts = useMemo(() => posts.filter((p) => p.included), [posts]);

  async function runSchedule(mode: "schedule" | "draft" | "simulate") {
    setError(null);
    setNotice(null);
    if (includedPosts.length === 0) {
      setError("Generate a campaign first — there are no posts to schedule.");
      return;
    }
    if (selectedChannels.length === 0) {
      setError("Select at least one channel.");
      return;
    }
    for (const p of includedPosts) {
      const v = validatePostText(p.text);
      if (v) {
        setError(`"${p.title}": ${v}`);
        return;
      }
      if (mode === "schedule" && Date.parse(p.dueAt) <= Date.now()) {
        setError(`"${p.title}" is scheduled in the past (${p.localDate} ${p.localTime}). Pick a later launch date or drop that post.`);
        return;
      }
    }
    setBusy(mode);
    try {
      const endpoint = mode === "simulate" ? "/api/simulate" : "/api/schedule";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posts: includedPosts.map((p) => ({ localId: p.id, text: p.text, dueAt: p.dueAt })),
          channelIds: selectedChannels,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      const results = (data.results ?? []) as Array<{ localId: string; channelId: string; ok: boolean; bufferPostId?: string; isDemo?: boolean; error?: string }>;
      setPosts((prev) =>
        prev.map((p) => {
          const mine = results.filter((r) => r.localId === p.id);
          if (mine.length === 0) return p;
          if (mine.every((r) => r.ok)) {
            return {
              ...p,
              status: mode === "simulate" || mine[0].isDemo ? "demo" : "scheduled",
              bufferPostId: mine[0].bufferPostId,
              error: undefined,
            };
          }
          return { ...p, status: "failed", error: mine.find((r) => !r.ok)?.error ?? "Unknown error" };
        }),
      );
      if (mode === "simulate") {
        setNotice(`DEMO ONLY — ${data.succeeded} simulated post(s). Nothing was sent to Buffer. ${data.notice ?? ""}`);
      } else if (mode === "draft") {
        setNotice(`Saved ${data.succeeded} of ${data.attempted} draft(s) to Buffer. Drafts are NOT scheduled — open them in Buffer to schedule.`);
      } else {
        setNotice(`Scheduled ${data.succeeded} of ${data.attempted} post(s) in Buffer. ${data.failed > 0 ? `${data.failed} failed — see the error on each post.` : "Check the queue below to verify."}`);
      }
    } catch (e) {
      setError(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function loadQueue() {
    setQueueError(null);
    setQueue(null);
    const org = organizations[0];
    if (!org) {
      setQueueError("No organization loaded yet.");
      return;
    }
    try {
      const res = await fetch(`/api/queue?organizationId=${encodeURIComponent(org.id)}&channelIds=${encodeURIComponent(selectedChannels.join(","))}`);
      const data = await res.json();
      if (!res.ok) {
        setQueueError(data.error ?? `Queue request failed (HTTP ${res.status}).`);
        return;
      }
      setQueue(data.posts ?? []);
      if (data.mode === "demo") setQueueError(data.notice ?? "Demo mode.");
    } catch (e) {
      setQueueError(`Queue request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const demoMode = status?.mode === "demo";

  return (
    <main className="wrap">
      <h1>🚀 LaunchLoop</h1>
      <p className="muted">
        A product-launch campaign autopilot, built on the Buffer API. Enter a launch date and product details —
        get a 14-day, multi-channel posting calendar (teaser → countdown → launch day → follow-up), edit every
        post, then schedule the whole campaign through Buffer with optimal posting times.
      </p>

      {status && (
        <div className={`banner ${status.mode}`}>
          <strong>
            {status.authMethod === "oauth"
              ? "✅ Connected to Buffer via OAuth — live mode"
              : status.mode === "live"
                ? "✅ Connected to Buffer (personal API key) — live mode"
                : "⚠️ Demo mode — connect your Buffer account to schedule for real"}
          </strong>
          <span className="small">{status.message}</span>
          {status.howToConnect && <span className="small"><br />{status.howToConnect}</span>}
          <span className="small">
            <br />
            {status.authMethod === "oauth" ? (
              <button
                onClick={async () => {
                  await fetch("/api/auth/buffer/disconnect", { method: "POST" });
                  window.location.reload();
                }}
              >
                Disconnect Buffer
              </button>
            ) : status.oauthConfigured ? (
              <a href="/api/auth/buffer">
                <button>Connect with Buffer (OAuth)</button>
              </a>
            ) : null}
          </span>
        </div>
      )}

      {error && (
        <div className="banner error"><strong>Something needs attention</strong><span className="small">{error}</span></div>
      )}
      {notice && (
        <div className="banner live"><strong>Done</strong><span className="small">{notice}</span></div>
      )}

      <h2>1 · Your launch</h2>
      <div className="card">
        <div className="grid">
          <div>
            <label htmlFor="productName">Product name</label>
            <input id="productName" type="text" value={input.productName} onChange={(e) => setInput({ ...input, productName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tagline">Tagline</label>
            <input id="tagline" type="text" value={input.tagline} onChange={(e) => setInput({ ...input, tagline: e.target.value })} />
          </div>
          <div>
            <label htmlFor="audience">Audience (who is it for?)</label>
            <input id="audience" type="text" value={input.audience} onChange={(e) => setInput({ ...input, audience: e.target.value })} />
          </div>
          <div>
            <label htmlFor="url">Website URL</label>
            <input id="url" type="url" value={input.url} onChange={(e) => setInput({ ...input, url: e.target.value })} placeholder="https://example.com" />
          </div>
          <div>
            <label htmlFor="problem">The painful problem it solves</label>
            <input id="problem" type="text" value={input.problem} onChange={(e) => setInput({ ...input, problem: e.target.value })} />
          </div>
          <div>
            <label htmlFor="launchDate">Launch date</label>
            <input id="launchDate" type="date" value={input.launchDate} onChange={(e) => setInput({ ...input, launchDate: e.target.value })} />
          </div>
          <div>
            <label htmlFor="benefit1">Benefit #1</label>
            <input id="benefit1" type="text" value={input.benefit1} onChange={(e) => setInput({ ...input, benefit1: e.target.value })} />
          </div>
          <div>
            <label htmlFor="benefit2">Benefit #2</label>
            <input id="benefit2" type="text" value={input.benefit2} onChange={(e) => setInput({ ...input, benefit2: e.target.value })} />
          </div>
          <div>
            <label htmlFor="timezone">Posting timezone</label>
            <select id="timezone" value={input.timezone} onChange={(e) => setInput({ ...input, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: "1rem" }}>
          <button onClick={generate}>Generate 14-day campaign</button>
        </div>
        <p className="small muted">
          Optimal posting times are applied automatically: weekdays 09:00–10:00, weekends 11:00, launch day 09:00 + 18:00
          (local time in your timezone, converted to exact UTC for Buffer).
        </p>
      </div>

      <h2>2 · Channels</h2>
      <div className="card">
        {channelsError && <p className="small" style={{ color: "#f87171" }}>{channelsError}</p>}
        {channels.length === 0 && !channelsError && <p className="muted small">Loading channels…</p>}
        {channels.map((c) => (
          <label key={c.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedChannels.includes(c.id)}
              onChange={(e) =>
                setSelectedChannels((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
              }
            />
            <span>{c.name} <span className="muted small">({c.service})</span></span>
            {c.demo && <span className="badge demo">DEMO — not a real channel</span>}
          </label>
        ))}
        <p className="small muted">
          Each post is created once per selected channel (Buffer&apos;s <code>createPost</code> takes a single{" "}
          <code>channelId</code>). {demoMode && "Demo channels are stand-ins — scheduling to them is refused until a real token is set."}
        </p>
      </div>

      <h2>3 · Campaign calendar — {posts.length > 0 ? `${posts.length} posts` : "not generated yet"}</h2>
      {posts.length > 0 && (
        <div className="card">
          <div className="spread">
            <div>
              <strong>Progress</strong>
              <div className="progress"><div style={{ width: `${progress.percentScheduled}%` }} /></div>
              <span className="small muted">
                {progress.scheduled} scheduled · {progress.demo} demo · {progress.failed} failed · {progress.included} of {progress.total} included
              </span>
            </div>
            <div className="row">
              <button onClick={() => runSchedule("draft")} disabled={!!busy || demoMode}>
                {busy === "draft" ? "Saving drafts…" : "Save all as Buffer drafts"}
              </button>
              <button onClick={() => runSchedule("schedule")} disabled={!!busy || demoMode}>
                {busy === "schedule" ? "Scheduling…" : "Schedule entire campaign in Buffer"}
              </button>
              {demoMode && (
                <button className="secondary" onClick={() => runSchedule("simulate")} disabled={!!busy}>
                  {busy === "simulate" ? "Simulating…" : "Simulate (demo only)"}
                </button>
              )}
            </div>
          </div>
          {demoMode && (
            <p className="small muted">
              Scheduling is disabled in demo mode — the buttons above refuse to schedule until a Buffer token is set.
              Use <strong>Simulate (demo only)</strong> to test the flow; simulated posts are clearly labelled DEMO and never touch Buffer.
            </p>
          )}
        </div>
      )}

      {posts.map((p) => (
        <article key={p.id} className="card">
          <div className="post-head">
            <h3>{p.title}</h3>
            <span className="row">
              <span className="badge">{dayLabel(p.dayOffset)} · {formatShortDate(p.localDate, input.timezone)} · {p.localTime} local</span>
              {p.dayOffset === 0 && <span className="badge launch">LAUNCH</span>}
              <span className={`badge ${p.status}`}>{p.status === "scheduled" ? "✅ scheduled in Buffer" : p.status === "demo" ? "DEMO — not scheduled" : p.status === "failed" ? "❌ failed" : "draft"}</span>
            </span>
          </div>
          <p className="small muted">
            Buffer <code>dueAt</code> (UTC): <code>{p.dueAt}</code>
            {p.bufferPostId && (<> · Buffer post id: <code>{p.bufferPostId}</code></>)}
          </p>
          <textarea
            aria-label={`Post text for ${p.title}`}
            value={p.text}
            onChange={(e) => updatePost(p.id, { text: e.target.value })}
          />
          <div className="spread" style={{ marginTop: "0.5rem" }}>
            <span className={`charcount ${p.fitsEverywhere ? "" : "over"}`}>
              {p.charCount} chars {p.fitsEverywhere ? "· fits everywhere (≤ 280)" : "· over 280 — fine for LinkedIn/Facebook, too long for X"}
            </span>
            <span className="row">
              <label className="checkbox-row" style={{ padding: 0 }}>
                <input type="checkbox" checked={p.included} onChange={(e) => updatePost(p.id, { included: e.target.checked })} />
                Include
              </label>
              <button className="secondary" onClick={() => resetPostText(p.id)}>Reset text</button>
            </span>
          </div>
          {p.error && <p className="small" style={{ color: "#f87171" }}>Buffer error: {p.error}</p>}
          {p.status === "demo" && <p className="small" style={{ color: "#fbbf24" }}>DEMO result — this post was NOT sent to Buffer.</p>}
        </article>
      ))}

      <h2>4 · Verify in Buffer — scheduled queue</h2>
      <div className="card">
        <div className="row">
          <button className="secondary" onClick={loadQueue} disabled={demoMode}>Load scheduled queue from Buffer</button>
          {demoMode && <span className="small muted">Disabled in demo mode — there is no live queue without a token.</span>}
        </div>
        {queueError && <p className="small" style={{ color: "#fbbf24" }}>{queueError}</p>}
        {queue && queue.length === 0 && !queueError && <p className="small muted">No scheduled posts found for the selected channels.</p>}
        {queue && queue.length > 0 && (
          <pre>{JSON.stringify(queue, null, 2)}</pre>
        )}
      </div>

      <h2>How to connect Buffer (the one step only you can do)</h2>
      <div className="card">
        <ol className="steps">
          <li>Log in to <a href="https://buffer.com" target="_blank" rel="noreferrer">Buffer</a> as umarshareef0165@gmail.com and connect at least one social channel.</li>
          <li>Go to <strong>Settings → API</strong> (<code>publish.buffer.com/settings/api</code>) and create a new API key.</li>
          <li>Locally: copy <code>.env.example</code> to <code>.env.local</code> and set <code>BUFFER_ACCESS_TOKEN=&lt;your key&gt;</code>. Deployed: set the same variable in Vercel → Project → Settings → Environment Variables, then redeploy.</li>
          <li>Reload this page — the banner turns green, your real channels appear, and scheduling goes to real Buffer.</li>
        </ol>
        <p className="small muted">
          The key is read server-side only, from the environment — it is never shown in the UI, never stored in the
          browser, and never committed to git. Never paste the key into chat or a form field.
        </p>
      </div>
    </main>
  );
}
