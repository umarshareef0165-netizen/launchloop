// Tests for the LaunchLoop campaign engine + token handling.
// Run: npm test
import { describe, expect, it, afterEach } from "vitest";
import {
  addDays,
  campaignProgress,
  dayLabel,
  generateCampaign,
  optimalHourForWeekday,
  validatePostText,
  weekdayOf,
  zonedTimeToUtc,
  type CampaignInput,
  type CampaignPost,
} from "./campaign";
import { demoPostId } from "./demo";
import { getBufferToken, isBufferConnected } from "./buffer";

const SAMPLE: CampaignInput = {
  productName: "Acme",
  tagline: "The fastest way to do the thing.",
  problem: "teams waste hours on manual work",
  audience: "busy founders",
  benefit1: "a full campaign in one click",
  benefit2: "every post at the best time",
  url: "https://acme.example.com",
  launchDate: "2027-01-15", // a Friday
  timezone: "America/Los_Angeles",
};

function samplePosts(): CampaignPost[] {
  const r = generateCampaign(SAMPLE);
  if ("error" in r) throw new Error(r.error);
  return r.posts;
}

describe("generateCampaign — plan shape", () => {
  it("generates exactly 14 posts", () => {
    expect(samplePosts()).toHaveLength(14);
  });

  it("covers the 14-day arc: T-13 … launch day (x2) … T+7", () => {
    const offsets = samplePosts().map((p) => p.dayOffset);
    expect(offsets).toEqual([-13, -10, -7, -5, -3, -2, -1, 0, 0, 1, 2, 3, 5, 7]);
  });

  it("is sorted by dueAt ascending", () => {
    const due = samplePosts().map((p) => p.dueAt);
    expect([...due].sort()).toEqual(due);
  });

  it("puts exactly two posts on launch day", () => {
    expect(samplePosts().filter((p) => p.localDate === "2027-01-15")).toHaveLength(2);
  });

  it("starts 13 days before launch", () => {
    expect(samplePosts()[0].localDate).toBe("2027-01-02");
  });

  it("ends 7 days after launch", () => {
    const posts = samplePosts();
    expect(posts[posts.length - 1].localDate).toBe("2027-01-22");
  });

  it("gives every post a unique id", () => {
    const ids = samplePosts().map((p) => p.id);
    expect(new Set(ids).size).toBe(14);
  });

  it("keeps every sample post within 280 chars and reports charCount honestly", () => {
    for (const p of samplePosts()) {
      expect(p.charCount).toBe(p.text.length);
      expect(p.text.length).toBeLessThanOrEqual(280);
      expect(p.fitsEverywhere).toBe(true);
    }
  });

  it("includes the product name and URL in the launch-day post", () => {
    const launch = samplePosts().find((p) => p.dayOffset === 0 && p.localTime === "09:00");
    expect(launch?.text).toContain("Acme");
    expect(launch?.text).toContain("https://acme.example.com");
  });

  it("drops the URL cleanly when no URL is given (no dangling arrow)", () => {
    const r = generateCampaign({ ...SAMPLE, url: "" });
    if ("error" in r) throw new Error(r.error);
    for (const p of r.posts) expect(p.text).not.toMatch(/→\s*$/);
  });
});

describe("posting times", () => {
  it("launch day posts go at 09:00 and 18:00 local", () => {
    const launch = samplePosts().filter((p) => p.dayOffset === 0);
    expect(launch.map((p) => p.localTime).sort()).toEqual(["09:00", "18:00"]);
  });

  it("Saturday teaser posts at 11:00 (weekend optimal time)", () => {
    // 2027-01-02 is a Saturday.
    expect(weekdayOf("2027-01-02")).toBe(6);
    expect(optimalHourForWeekday(6)).toBe(11);
    expect(samplePosts()[0].localTime).toBe("11:00");
  });

  it("Tuesday posts at 10:00 and Friday posts at 09:00", () => {
    expect(weekdayOf("2027-01-05")).toBe(2); // Tuesday, T-10
    expect(samplePosts()[1].localTime).toBe("10:00");
    expect(weekdayOf("2027-01-08")).toBe(5); // Friday, T-7
    expect(samplePosts()[2].localTime).toBe("09:00");
  });

  it("optimalHourForWeekday covers the whole week", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(optimalHourForWeekday)).toEqual([11, 9, 10, 10, 10, 9, 11]);
  });
});

describe("timezone math (dueAt sent to Buffer)", () => {
  it("converts LA winter time (PST, UTC-8): 09:00 local = 17:00 UTC", () => {
    const utc = zonedTimeToUtc("2027-01-15", "09:00", "America/Los_Angeles");
    expect(utc.toISOString()).toBe("2027-01-15T17:00:00.000Z");
  });

  it("converts LA summer time (PDT, UTC-7): 10:00 local = 17:00 UTC", () => {
    const utc = zonedTimeToUtc("2027-07-15", "10:00", "America/Los_Angeles");
    expect(utc.toISOString()).toBe("2027-07-15T17:00:00.000Z");
  });

  it("converts Karachi (PKT, UTC+5, no DST): 10:00 local = 05:00 UTC", () => {
    const utc = zonedTimeToUtc("2027-01-15", "10:00", "Asia/Karachi");
    expect(utc.toISOString()).toBe("2027-01-15T05:00:00.000Z");
  });

  it("launch-day dueAt in the campaign matches the LA conversion", () => {
    const launch = samplePosts().find((p) => p.dayOffset === 0 && p.localTime === "09:00");
    expect(launch?.dueAt).toBe("2027-01-15T17:00:00.000Z");
  });

  it("a summer campaign uses PDT, not PST", () => {
    const r = generateCampaign({ ...SAMPLE, launchDate: "2027-07-15" });
    if ("error" in r) throw new Error(r.error);
    const launch = r.posts.find((p) => p.dayOffset === 0 && p.localTime === "09:00");
    expect(launch?.dueAt).toBe("2027-07-15T16:00:00.000Z");
  });
});

describe("date helpers", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-15", -13)).toBe("2027-01-02");
  });

  it("addDays handles the leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("dayLabel formats offsets", () => {
    expect(dayLabel(-13)).toBe("T-13");
    expect(dayLabel(0)).toBe("Launch day");
    expect(dayLabel(7)).toBe("T+7");
  });
});

describe("input validation", () => {
  it("rejects a missing product name", () => {
    const r = generateCampaign({ ...SAMPLE, productName: "  " });
    expect("error" in r && r.error).toMatch(/Product name/);
  });

  it("rejects a launch date in the past", () => {
    const r = generateCampaign({ ...SAMPLE, launchDate: "2020-01-01" });
    expect("error" in r && r.error).toMatch(/past/);
  });

  it("rejects a malformed launch date", () => {
    const r = generateCampaign({ ...SAMPLE, launchDate: "15/01/2027" });
    expect("error" in r).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const r = generateCampaign({ ...SAMPLE, timezone: "Mars/Olympus" });
    expect("error" in r && r.error).toMatch(/timezone/);
  });

  it("rejects a URL without http(s)", () => {
    const r = generateCampaign({ ...SAMPLE, url: "acme.example.com" });
    expect("error" in r && r.error).toMatch(/URL/);
  });

  it("validatePostText rejects empty and >2000-char text", () => {
    expect(validatePostText("   ")).toMatch(/empty/);
    expect(validatePostText("x".repeat(2001))).toMatch(/2,000/);
    expect(validatePostText("Hello")).toBeNull();
  });
});

describe("campaignProgress", () => {
  it("counts scheduled / failed / demo / included correctly", () => {
    const posts = samplePosts();
    posts[0].status = "scheduled";
    posts[1].status = "failed";
    posts[2].status = "demo";
    posts[3].included = false;
    const p = campaignProgress(posts);
    expect(p.total).toBe(14);
    expect(p.included).toBe(13);
    expect(p.scheduled).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.demo).toBe(1);
    expect(p.percentScheduled).toBe(Math.round((1 / 13) * 100));
  });
});

describe("demo helpers + token handling", () => {
  it("demo post ids are prefixed demo- and never look like real Buffer ids", () => {
    expect(demoPostId("launchloop-t-13-teaser", "demo-channel-x")).toMatch(/^demo-/);
  });

  it("getBufferToken reads ONLY BUFFER_ACCESS_TOKEN and is empty when unset", () => {
    const prev = process.env.BUFFER_ACCESS_TOKEN;
    delete process.env.BUFFER_ACCESS_TOKEN;
    expect(getBufferToken()).toBe("");
    expect(isBufferConnected()).toBe(false);
    process.env.BUFFER_ACCESS_TOKEN = "test-token-123";
    expect(getBufferToken()).toBe("test-token-123");
    expect(isBufferConnected()).toBe(true);
    if (prev === undefined) delete process.env.BUFFER_ACCESS_TOKEN;
    else process.env.BUFFER_ACCESS_TOKEN = prev;
  });
});

afterEach(() => {
  delete process.env.BUFFER_ACCESS_TOKEN;
});
