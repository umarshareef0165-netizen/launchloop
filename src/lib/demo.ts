// Demo stand-ins used ONLY when no Buffer token is configured, so the UI
// can be explored and tested locally. They are clearly labelled DEMO in
// every response and in the UI, and scheduling against them is ALWAYS
// refused — demo data must never be mistaken for real Buffer scheduling.

export interface DemoChannel {
  id: string;
  name: string;
  service: string;
  organizationId: string;
  demo: true;
}

export const DEMO_ORGANIZATION_ID = "demo-org";
export const DEMO_ORGANIZATION_NAME = "Demo workspace (no Buffer token)";

export const DEMO_CHANNELS: DemoChannel[] = [
  { id: "demo-channel-x", name: "Demo X / Twitter", service: "twitter", organizationId: DEMO_ORGANIZATION_ID, demo: true },
  { id: "demo-channel-linkedin", name: "Demo LinkedIn", service: "linkedin", organizationId: DEMO_ORGANIZATION_ID, demo: true },
  { id: "demo-channel-instagram", name: "Demo Instagram", service: "instagram", organizationId: DEMO_ORGANIZATION_ID, demo: true },
];

/** Fake ids returned by the clearly-labelled simulation endpoint. */
export function demoPostId(localId: string, channelId: string): string {
  return `demo-${channelId.replace("demo-channel-", "")}-${localId}`;
}
