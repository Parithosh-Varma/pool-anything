// Free-tier quota tables + window rules. Pure: shared by the Node server,
// the CLI and the Cloudflare Worker so rotation spends the same budget.

/** Countable free-tier quotas per provider. `null` = no countable total. */
export const QUOTA: Record<string, number | null> = {
  cartesia: 20000, // "20,000 free tokens" — countable tokens
  elevenlabs: 10000, // "10k credits/mo free" — countable credits
  tavily: 1000, // "1,000 credits/mo free" — countable credits
  "brave-search": 2000, // "2,000 queries/mo free" — countable queries
  serper: 2500, // "2,500 queries one-time" — countable queries
  scrapingbee: 1000, // "1,000 free credits" — countable credits
  resend: 3000, // "3,000/mo ... free" — countable emails/mo
  mailgun: 5000, // "5k/3mo trial" — countable emails per trial
  postmark: 100, // "100/mo trial" — countable emails/mo
  upstash: 500000, // "500k cmds/mo free" — countable commands/mo
  custom: null,
  // Null with reason — rate-limits belong to cooldown, not QUOTA:
  groq: null, // "30 req/min, 14.4k req/day" — rate-limit only
  openrouter: null, // "~20 RPM / 200 RPD" — rate-limit only
  gemini: null, // "15 RPM / 1500 RPD" — rate-limit only
  finnhub: null, // "60/min free" — rate-limit only
  openweather: null, // "1,000/day, 60/min" — daily/minute rate, belongs to cooldown
  sendgrid: null, // "100/day free (60-day trial)" — daily rate + time-boxed trial
  cloudflare: null, // "100k req/day" — daily rate, belongs to cooldown
  huggingface: null, // "hourly limits" — rate-limit, no countable total
  cohere: null, // "trial key, rate-limited" — no numeric total
  // Null with reason — dollar-denominated, not comparable to token/credit/request counts:
  fireworks: null, // "$1 credit" — dollars, not countable units
  together: null, // "$1 credit" — dollars
  replicate: null, // "~$5 trial, per-second GPU" — dollars + usage-based
  openai: null, // "PAYG, $5 min prepay" — PAYG dollars
  anthropic: null, // "$5 credit" — dollars
  perplexity: null, // "$5 credit" — dollars
  deepgram: null, // "$200 credit" — dollars
  twilio: null, // "$15 credit trial" — dollars
  // Null with reason — non-countable, vague, or mixed units:
  mistral: null, // "trial credits, then PAYG" — no numeric total
  anyscale: null, // "legacy, deprecated" — no quota
  supabase: null, // "500MB DB, 5GB egress, 50k MAU" — storage/bandwidth/users, not tokens/credits/emails/queries
  neon: null, // "0.5GB, 100 CU-hrs/mo" — storage/compute, not comparable units
  turso: null, // "5-9GB, 500M reads/mo" — mixed storage range + reads, no single quota
  appwrite: null, // "75k MAU, 2 projects" — users/projects, not countable consumption units
  mapbox: null, // "100k geocode/mo, 50k loads/mo" — mixed units, no single quota
  googlemaps: null, // "~10k/SKU/mo under $200 credit" — approximate, SKU-varying, dollar-backed
};

/** Quota window: "month" resets each calendar month (UTC), "day" resets each UTC day, "all" accumulates lifetime. */
export type QuotaWindow = "month" | "day" | "all";

export const QUOTA_WINDOW: Record<string, QuotaWindow> = {
  cartesia: "all", // token grant per key, no monthly reset documented
  elevenlabs: "month",
  tavily: "month",
  "brave-search": "month",
  serper: "all", // one-time grant
  scrapingbee: "all", // one-time credits
  resend: "month",
  mailgun: "all", // trial grant
  postmark: "month",
  upstash: "month",
  custom: "all",
  // Null-quota providers: window is irrelevant (no limit enforced), recorded as "all".
  groq: "all",
  openrouter: "all",
  gemini: "all",
  finnhub: "all",
  openweather: "all",
  sendgrid: "all",
  cloudflare: "all",
  huggingface: "all",
  cohere: "all",
  fireworks: "all",
  together: "all",
  replicate: "all",
  openai: "all",
  anthropic: "all",
  perplexity: "all",
  deepgram: "all",
  twilio: "all",
  mistral: "all",
  anyscale: "all",
  supabase: "all",
  neon: "all",
  turso: "all",
  appwrite: "all",
  mapbox: "all",
  googlemaps: "all",
};

export function quotaForProvider(provider: string): { limit: number | null; window: QuotaWindow } {
  return { limit: QUOTA[provider] ?? null, window: QUOTA_WINDOW[provider] ?? "all" };
}

/**
 * Daily caps enforced in addition to the primary quota. A key is eligible
 * only when it is under *every* applicable limit (e.g. resend: 3000/mo AND
 * 100/day). Primary `QUOTA` stays the legacy single-limit view; this table
 * adds the second dimension without breaking `quotaForProvider` callers.
 */
export const QUOTA_DAILY: Record<string, number> = {
  groq: 14400, // "14.4k req/day"
  openrouter: 200, // "~200 RPD"
  gemini: 1500, // "1500 RPD"
  openweather: 1000, // "1,000/day"
  sendgrid: 100, // "100/day"
  cloudflare: 100000, // "100k req/day"
  resend: 100, // "100/day" in addition to 3000/mo
};

/** All enforceable limits for a provider (primary + daily). Empty = unlimited. */
export function quotaLimitsForProvider(provider: string): { limit: number; window: QuotaWindow }[] {
  const out: { limit: number; window: QuotaWindow }[] = [];
  const primary = quotaForProvider(provider);
  if (primary.limit !== null) out.push({ limit: primary.limit, window: primary.window });
  const daily = QUOTA_DAILY[provider];
  if (typeof daily === "number" && daily > 0) {
    // Avoid duplicating when the primary limit already is the daily one.
    if (!(primary.limit === daily && primary.window === "day")) out.push({ limit: daily, window: "day" });
  }
  return out;
}

/** SQL fragment restricting joined usage rows to the quota window (UTC, matches datetime('now')). */
export function quotaWindowFilter(window: QuotaWindow, column = "u.created_at"): string {
  if (column !== "u.created_at" && column !== "created_at") throw new Error("invalid quota column");
  if (window === "month") return ` AND ${column} >= date('now','start of month')`;
  if (window === "day") return ` AND ${column} >= date('now')`;
  return "";
}
