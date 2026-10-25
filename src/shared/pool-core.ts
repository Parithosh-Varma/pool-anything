// Key masking, credential validation and call-body capping. Pure: shared by
// the Node server and the Worker so both enforce identical rules.

import type { Provider } from "./providers.js";

export function providerKeyFields(providers: Provider[], provider: string): string[] {
  return providers.find((x) => x.id === provider)?.keyFields ?? ["api_key"];
}

export function isMultiFieldProvider(providers: Provider[], provider: string): boolean {
  const f = providerKeyFields(providers, provider);
  return !(f.length === 1 && (f[0] === "api_key" || f[0] === "apiToken"));
}

export function mask(key: unknown): string {
  if (typeof key !== "string" || key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

function cleanFieldValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 4096 || /[\r\n\0]/.test(t)) return null;
  return t;
}

/** Validate + normalize a credentials object for the given provider fields. */
export function normalizeCredentials(
  fields: string[],
  input: unknown
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: false, error: `missing credentials: ${fields.join(", ")} required` };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "credentials must be an object" };
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = cleanFieldValue((input as Record<string, unknown>)[f]);
    if (v === null) return { ok: false, error: `field ${f} required (non-empty, <=4096 chars, no CR/LF)` };
    out[f] = v;
  }
  return { ok: true, value: out };
}

export function parseCredentials(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw || raw === "{}") return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o !== null && typeof o === "object" && !Array.isArray(o)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(k)) out[k] = v;
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}

export function maskCredentials(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) out[k] = mask(v);
  return out;
}

export type CallCaps = { textChars: number; mediaChars: number };

/** Pick the storage slice for a relay body: text stays small, binary media keeps more. */
export function callBodyForStorage(
  relayBody: string,
  encoding: string,
  truncated: boolean,
  caps: CallCaps
): { body: string; truncated: boolean } {
  const cap = encoding === "base64" ? caps.mediaChars : caps.textChars;
  if (relayBody.length <= cap) return { body: relayBody, truncated };
  return { body: relayBody.slice(0, cap), truncated: true };
}
