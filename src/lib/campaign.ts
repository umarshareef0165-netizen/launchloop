// LaunchLoop campaign engine — pure functions, no Buffer calls, no I/O.
// A campaign is a 14-day, 14-post launch plan: 7 posts before launch day,
// 2 on launch day, 5 after. Every post gets an optimal local posting time in
// the campaign timezone, converted to an exact UTC ISO timestamp for Buffer.

export type CampaignPhase =
  | "teaser"
  | "problem"
  | "behind-the-scenes"
  | "feature"
  | "countdown"
  | "launch"
  | "social-proof"
  | "how-to"
  | "faq"
  | "roadmap"
  | "recap";

export type PostStatus = "draft" | "scheduled" | "failed" | "demo";

export interface CampaignInput {
  productName: string;
  tagline: string;
  /** One line: the painful problem the product solves. */
  problem: string;
  /** Who it is for, e.g. "indie founders". */
  audience: string;
  benefit1: string;
  benefit2: string;
  /** Public URL, e.g. https://example.com (optional). */
  url: string;
  /** Launch day, YYYY-MM-DD. */
  launchDate: string;
  /** IANA timezone, e.g. America/Los_Angeles. */
  timezone: string;
}

export interface CampaignPost {
  /** Stable local id, e.g. "launchloop-t-13-teaser". */
  id: string;
  phase: CampaignPhase;
  /** Days relative to launch: negative = before, 0 = launch day. */
  dayOffset: number;
  /** Local calendar date in the campaign timezone, YYYY-MM-DD. */
  localDate: string;
  /** Local posting time, "HH:MM" in the campaign timezone. */
  localTime: string;
  /** Exact UTC ISO timestamp sent to Buffer as `dueAt`. */
  dueAt: string;
  title: string;
  text: string;
  /** Character count of `text`. */
  charCount: number;
  /** True when the text fits X's 280-char limit (safe everywhere). */
  fitsEverywhere: boolean;
  /** Local editing / scheduling state. */
  status: PostStatus;
  /** Buffer post id once really scheduled (never set in demo mode). */
  bufferPostId?: string;
  /** Buffer / validation error for this post, if any. */
  error?: string;
  included: boolean;
}

export const MAX_CHARS_EVERYWHERE = 280;

/** Optimal posting hour (local time) per weekday. 0 = Sunday … 6 = Saturday. */
export function optimalHourForWeekday(weekday: number): number {
  // Weekend audiences scroll later; mid-week B2B peaks mid-morning.
  if (weekday === 0 || weekday === 6) return 11;
  if (weekday === 1 || weekday === 5) return 9;
  return 10;
}

/** Offset of `timeZone` from UTC in minutes, at the given UTC instant. */
export function timezoneOffsetMinutes(timeZone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(utcDate);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcDate.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` (YYYY-MM-DD + HH:MM) to a UTC Date.
 * Iterates twice so DST transitions at the target date are handled.
 */
export function zonedTimeToUtc(dateStr: string, time: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  for (let i = 0; i < 2; i++) {
    const offset = timezoneOffsetMinutes(timeZone, guess);
    guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - offset * 60000);
  }
  return guess;
}

/** Add `days` to a YYYY-MM-DD date (UTC arithmetic, no DST drift). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatShortDate(dateStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function dayLabel(dayOffset: number): string {
  if (dayOffset < 0) return `T${dayOffset}`;
  if (dayOffset === 0) return "Launch day";
  return `T+${dayOffset}`;
}

function validateInput(input: CampaignInput): string | null {
  if (!input.productName.trim()) return "Product name is required.";
  if (!input.tagline.trim()) return "Tagline is required.";
  if (!input.problem.trim()) return "The problem your product solves is required.";
  if (!input.audience.trim()) return "Audience is required.";
  if (!input.benefit1.trim()) return "At least one benefit is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.launchDate)) return "Launch date must be YYYY-MM-DD.";
  const launch = new Date(`${input.launchDate}T00:00:00Z`);
  if (Number.isNaN(launch.getTime())) return "Launch date is not a real date.";
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (input.launchDate < todayStr) return "Launch date is in the past — pick today or a future date.";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    return `Unknown timezone: ${input.timezone}.`;
  }
  if (input.url && !/^https?:\/\/\S+$/.test(input.url.trim())) {
    return "Website URL must start with http:// or https://.";
  }
  return null;
}

interface PlanStep {
  dayOffset: number;
  phase: CampaignPhase;
  title: string;
  text: (c: CampaignInput, launchShort: string) => string;
  /** Fixed local hour, or null to use the optimal hour for that weekday. */
  hour: number | null;
  minute: number;
}

const PLAN: PlanStep[] = [
  {
    dayOffset: -13, phase: "teaser", title: "Teaser — something's coming",
    text: (c, l) => `Something new is coming. 👀\n\n${c.productName} — ${c.tagline}\n\nLaunching ${l}. Join the waitlist → ${c.url}`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -10, phase: "problem", title: "The problem — name the pain",
    text: (c) => `${c.audience} know this pain: ${c.problem}\n\nWe got tired of it too — so we built ${c.productName}. Launching soon. ${c.url}`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -7, phase: "behind-the-scenes", title: "Behind the scenes — build in public",
    text: (c) => `Building ${c.productName} in public.\n\nThis week: ${c.benefit1.toLowerCase()} — and we broke it twice before it worked. 😅\n\nLaunch day is one week away.`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -5, phase: "feature", title: "Feature spotlight #1",
    text: (c) => `What ${c.productName} does for ${c.audience}:\n\n✅ ${c.benefit1}\n\nNo setup marathons. No busywork. Just the result.\n\n${c.url}`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -3, phase: "feature", title: "Feature spotlight #2 + waitlist",
    text: (c) => `And there's more: ${c.benefit2}\n\n${c.productName} launches in 3 days. The waitlist gets first access → ${c.url}`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -2, phase: "countdown", title: "Countdown — 48 hours",
    text: (c, l) => `⏰ 48 hours until ${c.productName} launches (${l}).\n\n${c.tagline}\n\nGet notified the second we're live → ${c.url}`,
    hour: null, minute: 0,
  },
  {
    dayOffset: -1, phase: "countdown", title: "Countdown — 24 hours",
    text: (c) => `Tomorrow. 🚀\n\n${c.productName} goes live in 24 hours.\n\n${c.benefit1} — for ${c.audience} who are done with ${c.problem.toLowerCase()}\n\n${c.url}`,
    hour: 18, minute: 0,
  },
  {
    dayOffset: 0, phase: "launch", title: "LAUNCH DAY — we're live",
    text: (c) => `🚀 IT'S LIVE: ${c.productName} is here.\n\n${c.tagline}\n\n${c.benefit1}. ${c.benefit2}.\n\nTry it now → ${c.url}`,
    hour: 9, minute: 0,
  },
  {
    dayOffset: 0, phase: "launch", title: "Launch day — evening push",
    text: (c) => `Day 1 of ${c.productName} — and people are already using it. 🙌\n\nIf you haven't tried it yet, tonight's the night:\n\n${c.url}`,
    hour: 18, minute: 0,
  },
  {
    dayOffset: 1, phase: "social-proof", title: "Thank you + first reactions",
    text: (c) => `Thank you. ❤️\n\n24 hours after launching ${c.productName}, the messages from ${c.audience} keep coming in.\n\nYou asked for ${c.benefit1.toLowerCase()} — we're just getting started.`,
    hour: null, minute: 0,
  },
  {
    dayOffset: 2, phase: "how-to", title: "How to — get value in minutes",
    text: (c) => `New to ${c.productName}? Here's the 2-minute start:\n\n1. Open ${c.url}\n2. ${c.benefit1}\n3. ${c.benefit2}\n\nThat's it. No manual required.`,
    hour: null, minute: 0,
  },
  {
    dayOffset: 3, phase: "faq", title: "FAQ — answer the top objection",
    text: (c) => `"But what about ${c.problem.toLowerCase()}?"\n\nThat's exactly what ${c.productName} fixes — ${c.benefit1.toLowerCase()}, without the usual hassle.\n\nQuestions? Reply here, we answer everything. 👇`,
    hour: null, minute: 0,
  },
  {
    dayOffset: 5, phase: "roadmap", title: "What's next — roadmap",
    text: (c) => `Launch week isn't the end — it's the start.\n\nNext up for ${c.productName}: more of what ${c.audience} asked for, starting with ${c.benefit2.toLowerCase()}.\n\nWhat should we build next?`,
    hour: null, minute: 0,
  },
  {
    dayOffset: 7, phase: "recap", title: "One week later — recap",
    text: (c) => `One week ago, ${c.productName} launched. 🚀\n\nSince then: ${c.audience} are using it every day to ${c.benefit1.toLowerCase()}.\n\nMissed launch week? Start here → ${c.url}`,
    hour: null, minute: 0,
  },
];

function fillPost(step: PlanStep, input: CampaignInput): CampaignPost {
  const localDate = addDays(input.launchDate, step.dayOffset);
  const hour = step.hour ?? optimalHourForWeekday(weekdayOf(localDate));
  const localTime = `${String(hour).padStart(2, "0")}:${String(step.minute).padStart(2, "0")}`;
  const dueAt = zonedTimeToUtc(localDate, localTime, input.timezone).toISOString();
  const url = input.url.trim();
  const filled: CampaignInput = { ...input, url };
  const launchShort = formatShortDate(input.launchDate, input.timezone);
  const text = step.text(filled, launchShort).replace(/\s+→\s*$/g, "").trim();
  return {
    id: `launchloop-${step.dayOffset >= 0 ? `t-plus-${step.dayOffset}` : `t-minus-${-step.dayOffset}`}-${step.phase}-${localTime.replace(":", "")}`,
    phase: step.phase,
    dayOffset: step.dayOffset,
    localDate,
    localTime,
    dueAt,
    title: step.title,
    text,
    charCount: text.length,
    fitsEverywhere: text.length <= MAX_CHARS_EVERYWHERE,
    status: "draft",
    included: true,
  };
}

/** Build the full 14-post campaign, or return an error string for bad input. */
export function generateCampaign(input: CampaignInput): { posts: CampaignPost[] } | { error: string } {
  const error = validateInput(input);
  if (error) return { error };
  const posts = PLAN.map((step) => fillPost(step, input));
  posts.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return { posts };
}

/** Validate a single edited post before it may be scheduled. */
export function validatePostText(text: string): string | null {
  if (!text.trim()) return "Post text cannot be empty.";
  if (text.length > 2000) return "Post text is over 2,000 characters.";
  return null;
}

/** Progress summary for the tracker UI. */
export function campaignProgress(posts: CampaignPost[]): {
  total: number;
  included: number;
  scheduled: number;
  failed: number;
  demo: number;
  percentScheduled: number;
} {
  const included = posts.filter((p) => p.included);
  const scheduled = included.filter((p) => p.status === "scheduled").length;
  const failed = included.filter((p) => p.status === "failed").length;
  const demo = included.filter((p) => p.status === "demo").length;
  return {
    total: posts.length,
    included: included.length,
    scheduled,
    failed,
    demo,
    percentScheduled: included.length ? Math.round((scheduled / included.length) * 100) : 0,
  };
}
