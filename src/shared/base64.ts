// Runtime-neutral byte helpers: same behaviour on Node and Workers.
// (No Buffer, no node:* imports.)

/**
 * Bytes -> base64. Chunks are multiples of 3 so each chunk encodes without
 * padding (except the last) and the concatenation is valid base64.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 8190; // 8190 = 3 * 2730
  let out = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    let bin = "";
    for (let j = 0; j < part.length; j += 0x2000) {
      bin += String.fromCharCode(...part.subarray(j, Math.min(j + 0x2000, part.length)));
    }
    out += btoa(bin);
  }
  return out;
}

/** UTF-8 byte length without Node's Buffer. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** UTF-8 text -> base64 (matches Buffer.from(s, "utf8").toString("base64")). */
export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}
