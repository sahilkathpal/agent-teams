/**
 * Distribution Registry — maps platform names to their automation status.
 *
 * When a new distribution agent is built, register it here.
 * The pipeline uses this to route playbook items: automated channels
 * get executed, unbuilt channels get iceboxed.
 */

export interface ChannelRegistration {
  agent: string | null;
  status: "automated" | "icebox";
}

export const DISTRIBUTION_CHANNELS: Record<string, ChannelRegistration> = {
  blog:          { agent: "creator",     status: "automated" },
  devto:         { agent: "distributor", status: "automated" },
  hashnode:      { agent: "distributor", status: "automated" },
  reddit:        { agent: null,          status: "icebox" },
  x:             { agent: null,          status: "icebox" },
  twitter:       { agent: null,          status: "icebox" },
  linkedin:      { agent: null,          status: "icebox" },
  stackoverflow: { agent: null,          status: "icebox" },
  producthunt:   { agent: null,          status: "icebox" },
  alternativeto: { agent: null,          status: "icebox" },
};

/** Get channel registration. Unknown platforms default to icebox. */
export function getChannel(platform: string): ChannelRegistration {
  const key = platform.toLowerCase().replace(/[\s.-]/g, "");
  return DISTRIBUTION_CHANNELS[key] ?? { agent: null, status: "icebox" };
}

/** Check if a platform has an automated agent. */
export function isAutomated(platform: string): boolean {
  return getChannel(platform).status === "automated";
}
