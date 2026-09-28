// Multimodal capability map + provider-specific message builders.
//
// Single source of truth for which providers/models accept media in/out.
// The Playground mirrors this table client-side (see playgroundPage); keep the
// two in sync when adding providers. Model-name heuristics refine the
// provider baseline (e.g. tts/whisper/embed models never take image input).

export type MediaCaps = {
  vision: boolean;
  audioIn: boolean;
  videoIn: boolean;
  imageOut: boolean;
  audioOut: boolean;
  videoOut: boolean;
};

export type MediaAttachment = { b64: string; mime: string; kind: "image" | "audio" | "video" };

export const MAX_MEDIA_FILE_BYTES = 8_000_000; // ~8MB per attachment (abuse cap)
export const MAX_PROXY_BODY_BYTES = 12_000_000; // proxy JSON cap incl. base64 media
// Upstream->caller relay cap (raised from 4000 for Studio media). Large!
// One media proxy transiently holds raw bytes + base64 (~2x); keep conservative.
export const MAX_RELAY_CHARS = 8_000_000;
export const MAX_UPSTREAM_MEDIA_BYTES = 12_000_000;

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ALLOWED_AUDIO_MIMES = ["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4"] as const;
export const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/webm"] as const;

const BASE_CAPS: Record<string, MediaCaps> = {
  openai: { vision: true, audioIn: true, videoIn: false, imageOut: true, audioOut: true, videoOut: false },
  anthropic: { vision: true, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  gemini: { vision: true, audioIn: true, videoIn: true, imageOut: true, audioOut: true, videoOut: true },
  groq: { vision: true, audioIn: true, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  openrouter: { vision: true, audioIn: false, videoIn: false, imageOut: true, audioOut: false, videoOut: false },
  mistral: { vision: true, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  fireworks: { vision: true, audioIn: false, videoIn: false, imageOut: true, audioOut: false, videoOut: false },
  together: { vision: true, audioIn: false, videoIn: false, imageOut: true, audioOut: false, videoOut: false },
  huggingface: { vision: true, audioIn: false, videoIn: false, imageOut: true, audioOut: false, videoOut: false },
  replicate: { vision: true, audioIn: false, videoIn: false, imageOut: true, audioOut: false, videoOut: true },
  perplexity: { vision: true, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  cohere: { vision: true, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  anyscale: { vision: false, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false },
  elevenlabs: { vision: false, audioIn: false, videoIn: false, imageOut: false, audioOut: true, videoOut: false },
  deepgram: { vision: false, audioIn: true, videoIn: false, imageOut: false, audioOut: true, videoOut: false },
  cartesia: { vision: false, audioIn: false, videoIn: false, imageOut: false, audioOut: true, videoOut: false },
};

const NONE: MediaCaps = { vision: false, audioIn: false, videoIn: false, imageOut: false, audioOut: false, videoOut: false };

const NO_VISION_MODEL = /tts|whisper|transcri|embed|image|flux|diffusion|imagen|dall|sonic|nova|stt|audit/i;
const IMAGE_GEN_MODEL = /image|flux|diffusion|imagen|dall|stable|midjourney/i;
const VIDEO_GEN_MODEL = /video|veo|pika|runway|sora/i;

/** Provider baseline refined by model-name heuristics. Pure + tested. */
export function capabilityFor(providerId: string, model = ""): MediaCaps {
  const base = BASE_CAPS[providerId] ?? NONE;
  if (!model) return { ...base };
  const m = model.toLowerCase();
  const noVision = NO_VISION_MODEL.test(m);
  if (/embed/.test(m)) return { ...NONE };
  if (IMAGE_GEN_MODEL.test(m)) return { ...base, vision: false, audioIn: false, videoIn: false };
  if (VIDEO_GEN_MODEL.test(m)) return { ...base, vision: false, audioIn: false, videoIn: false };
  if (/tts|sonic|eleven/.test(m)) return { ...base, vision: false, audioIn: false, videoIn: false };
  if (/whisper|transcri|^nova|stt/.test(m)) return { ...base, vision: false, videoIn: false };
  if (noVision) return { ...base, vision: false };
  return { ...base };
}

export function supports(providerId: string, model: string | undefined, cap: keyof MediaCaps): boolean {
  return capabilityFor(providerId, model ?? "")[cap];
}

/** OpenAI-compatible vision content parts (groq/openrouter/mistral/etc.). */
export function openAiVisionParts(text: string, images: MediaAttachment[]) {
  const parts: unknown[] = [{ type: "text", text }];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.b64}` } });
  }
  return parts;
}

/** Anthropic native vision content blocks (image source.type base64). */
export function anthropicVisionBlocks(text: string, images: MediaAttachment[]) {
  const blocks: unknown[] = [{ type: "text", text }];
  for (const img of images) {
    blocks.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.b64 } });
  }
  return blocks;
}

/**
 * Build chat messages for a provider given text + image attachments.
 * Anthropic uses native image blocks; everyone else uses the
 * OpenAI-compatible image_url data-URI shape (which groq, mistral,
 * together, fireworks, openrouter, gemini-compat, etc. all accept).
 */
export function buildVisionMessages(providerId: string, text: string, images: MediaAttachment[]) {
  if (images.length === 0) return [{ role: "user", content: text }];
  if (providerId === "anthropic") {
    return [{ role: "user", content: anthropicVisionBlocks(text, images) }];
  }
  return [{ role: "user", content: openAiVisionParts(text, images) }];
}

/** Human-readable gate note when a model lacks a capability. */
export function gateNote(cap: keyof MediaCaps, providerId: string, model: string): string {
  const label =
    cap === "vision" ? "image input" : cap === "audioIn" ? "audio input" : cap === "videoIn" ? "video input" : cap === "imageOut" ? "image output" : cap === "audioOut" ? "audio output" : "video output";
  return `this model doesn't support ${label} (${providerId} ${model || "default model"})`;
}

export function isAllowedMime(kind: MediaAttachment["kind"], mime: string): boolean {
  if (kind === "image") return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
  if (kind === "audio") return (ALLOWED_AUDIO_MIMES as readonly string[]).includes(mime);
  return (ALLOWED_VIDEO_MIMES as readonly string[]).includes(mime);
}
