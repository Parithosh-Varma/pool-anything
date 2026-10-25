// Provider registry mapping. Pure: the Node server feeds it data/providers.json
// read from disk; the Worker imports the same JSON at bundle time.

export type Provider = {
  id: string;
  name: string;
  quota: string;
  keyFields: string[];
  hint: string;
  baseUrl: string;
  keyHeader: string;
  keyPrefix: string;
  extraHeaders: Record<string, string>;
  docsUrl?: string;
  logoFile?: string;
  poolable?: boolean | string;
};

export const FALLBACK_PROVIDERS: Provider[] = [
  {
    id: "cartesia",
    name: "Cartesia",
    quota: "20,000 free tokens",
    keyFields: ["api_key"],
    hint: "Paste a Cartesia API key. Add key 1, key 2… to pool them.",
    baseUrl: "https://api.cartesia.ai",
    keyHeader: "X-API-Key",
    keyPrefix: "",
    extraHeaders: { "Cartesia-Version": "2024-06-10" },
  },
  {
    id: "groq",
    name: "Groq",
    quota: "free tier",
    keyFields: ["api_key"],
    hint: "Paste a Groq API key (gsk_…). Add key 1, key 2… to pool them.",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHeader: "Authorization",
    keyPrefix: "Bearer ",
    extraHeaders: {},
  },
  {
    id: "custom",
    name: "Custom",
    quota: "bring your own",
    keyFields: ["api_key"],
    hint: "Anything we don't provide: name it, add keys + info.",
    baseUrl: "",
    keyHeader: "X-API-Key",
    keyPrefix: "",
    extraHeaders: {},
  },
];

/** Basename without node:path (works in any runtime). */
function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Map one raw registry entry to a Provider, or null when it is unusable. */
export function mapProvider(p: Record<string, unknown>): Provider | null {
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.baseUrl !== "string") return null;
  return {
    id: p.id,
    name: p.name,
    quota: String(p.quota ?? ""),
    keyFields:
      Array.isArray(p.keyFields) && (p.keyFields as unknown[]).every((k) => typeof k === "string")
        ? (p.keyFields as string[])
        : ["api_key"],
    hint: String(p.hint ?? ""),
    baseUrl: p.baseUrl,
    keyHeader: String(p.keyHeader ?? "X-API-Key"),
    keyPrefix: String(p.keyPrefix ?? ""),
    extraHeaders:
      p.extraHeaders !== null && typeof p.extraHeaders === "object" && !Array.isArray(p.extraHeaders)
        ? (Object.fromEntries(
            Object.entries(p.extraHeaders as Record<string, unknown>).filter(([, v]) => typeof v === "string")
          ) as Record<string, string>)
        : {},
    docsUrl: typeof p.docsUrl === "string" ? p.docsUrl : undefined,
    logoFile: typeof p.logo === "string" && p.logo ? baseName(p.logo) : undefined,
    poolable: (p.poolable ?? true) as boolean | string,
  };
}

/** Build the registry from a parsed providers.json value. Throws when not an array. */
export function loadProviders(raw: unknown): Provider[] {
  if (!Array.isArray(raw)) throw new Error("not an array");
  return raw
    .map((p) => (p !== null && typeof p === "object" ? mapProvider(p as Record<string, unknown>) : null))
    .filter((p): p is Provider => p !== null);
}
