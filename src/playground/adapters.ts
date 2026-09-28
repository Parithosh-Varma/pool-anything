// Playground provider adapters — single source of truth for how the admin
// Playground talks to each provider through the key-pool proxy.
//
// The proxy forwards {path, method, headers?, body?, query?, form?} to
// baseUrl + path with auth injected server-side, so each adapter only needs:
// which path to hit, which body shape to send, and where to find the output.
// Placeholders in templates: <<MODEL>> <<TEXT>> <<QUERY>> <<VOICE>> <<SIZE>>
// <<ORG>> <<SID>> <<DOMAIN>>. Filled client-side (see playgroundPage).
//
// Researched against official docs (2026) in 6 parallel batches; keep this
// table in sync with data/providers.json — every provider id must appear.

export type ChatStyle = "openai" | "anthropic" | "gemini";
export type ModelsStyle = "openai" | "gemini";
export type AdapterKind =
  | "openai-chat"
  | "native-chat"
  | "tts"
  | "image"
  | "search"
  | "rest";

export type ProbeSpec = {
  path: string;
  method: string;
  query?: Record<string, string> | null;
  body?: unknown;
};

export type MediaSpec = {
  path: string;
  /** Alternate path when the model id matches altMatch (e.g. Deepgram Flux). */
  altPath?: string;
  altMatch?: string;
  query?: Record<string, string> | null;
  /** Body template; <<MODEL>> <<TEXT>> <<VOICE>> <<SIZE>> filled client-side. */
  body: unknown;
};

export type Adapter = {
  kind: AdapterKind;
  /** POST path for chat, or null when the provider has no chat API. */
  chatPath: string | null;
  chatStyle: ChatStyle | null;
  /** GET path for live model auto-list, or null when unsupported. */
  modelsPath: string | null;
  modelsStyle?: ModelsStyle;
  /** JSON paths (dot-separated, numeric segments = array indices) to try in order. */
  textPaths: string[];
  vision: boolean;
  audioIn: boolean;
  /** Video-bytes input (Gemini video models). */
  videoIn?: boolean;
  image: MediaSpec | null;
  audio: MediaSpec | null;
  video: MediaSpec | null;
  voiceDefault?: string;
  probe: ProbeSpec | null;
  /** Upstream only accepts form-encoding (proxy sends form for these). */
  formOnly?: boolean;
  defaults: { chat?: string; image?: string; audio?: string };
  notes: string;
};

export const ADAPTERS: Record<string, Adapter> = {
  groq: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: true, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "openai/gpt-oss-20b" },
    notes: "temperature 0 becomes 1e-8; vision model-dependent.",
  },
  openrouter: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "meta-llama/llama-3.3-70b-instruct" },
    notes: "Router passthrough; vision model-dependent.",
  },
  mistral: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "mistral-small-latest" },
    notes: "Vision via image_url on capable models.",
  },
  cohere: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: false, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "command-a-plus-05-2026" },
    notes: "Compatibility API; no image_url on compat endpoint.",
  },
  fireworks: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false,
    image: { path: "/images/generations", body: { model: "<<MODEL>>", prompt: "<<TEXT>>", n: 1 } },
    audio: null, video: null, probe: null,
    defaults: { chat: "accounts/fireworks/models/llama-v3p1-8b-instruct", image: "accounts/fireworks/models/flux-1-schnell" },
    notes: "Model ids are full accounts/fireworks/models/... paths.",
  },
  together: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false,
    image: { path: "/images/generations", body: { model: "<<MODEL>>", prompt: "<<TEXT>>", n: 1 } },
    audio: null, video: null, probe: null,
    defaults: { chat: "Qwen/Qwen3.5-9B", image: "FLUX.1-schnell" },
    notes: "Namespaced model ids (org/Model).",
  },
  huggingface: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false,
    image: { path: "/images/generations", body: { model: "<<MODEL>>", prompt: "<<TEXT>>", n: 1 } },
    audio: null, video: null, probe: null,
    defaults: { chat: "openai/gpt-oss-120b", image: "black-forest-labs/FLUX.1-schnell" },
    notes: "Inference Providers router; chat-only + images.",
  },
  openai: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: true,
    image: { path: "/images/generations", body: { model: "<<MODEL>>", prompt: "<<TEXT>>", n: 1 } },
    audio: { path: "/audio/speech", body: { model: "<<MODEL>>", input: "<<TEXT>>", voice: "<<VOICE>>" } },
    video: null, probe: null, voiceDefault: "alloy",
    defaults: { chat: "gpt-4o-mini", image: "gpt-image-1", audio: "gpt-4o-mini-tts" },
    notes: "TTS returns binary audio, not JSON.",
  },
  perplexity: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai",
    textPaths: ["choices.0.message.content", "citations", "search_results"],
    vision: true, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "sonar-pro" },
    notes: "/chat/completions aliases the Sonar API.",
  },
  anyscale: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: false, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "meta-llama/Llama-3.1-70B-Instruct" },
    notes: "Model ids rotate; auto-list via GET /models.",
  },
  custom: {
    kind: "openai-chat", chatPath: "/chat/completions", chatStyle: "openai",
    modelsPath: "/models", modelsStyle: "openai", textPaths: ["choices.0.message.content"],
    vision: true, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "gpt-4o-mini" },
    notes: "Generic OpenAI-chat default for user baseUrl.",
  },
  anthropic: {
    kind: "native-chat", chatPath: "/messages", chatStyle: "anthropic",
    modelsPath: null, textPaths: ["content.0.text"],
    vision: true, audioIn: false, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "claude-sonnet-5" },
    notes: "Body {model,max_tokens,messages[,system]}; version header injected server-side.",
  },
  gemini: {
    kind: "native-chat", chatPath: "/models/<<MODEL>>:generateContent", chatStyle: "gemini",
    modelsPath: "/models", modelsStyle: "gemini", textPaths: ["candidates.0.content.parts.0.text"],
    vision: true, audioIn: true, videoIn: true, image: null, audio: null, video: null, probe: null,
    defaults: { chat: "gemini-3.8-flash" },
    notes: "Model embedded in path; key via x-goog-api-key header.",
  },
  replicate: {
    kind: "image", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["output", "output.0"],
    vision: false, audioIn: false,
    image: { path: "/models/black-forest-labs/flux-schnell/predictions", body: { input: { prompt: "<<TEXT>>" } } },
    audio: null, video: null, probe: null,
    defaults: { image: "black-forest-labs/flux-schnell" },
    notes: "Async: POST returns {id,status}; poll GET /predictions/{id} until succeeded.",
  },
  elevenlabs: {
    kind: "tts", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: [],
    vision: false, audioIn: false, image: null,
    audio: { path: "/text-to-speech/<<VOICE>>", body: { text: "<<TEXT>>", model_id: "<<MODEL>>" } },
    video: null, probe: null, voiceDefault: "JBFqnCBsd6RMkjVDRZzb",
    defaults: { audio: "eleven_multilingual_v2" },
    notes: "Returns binary audio; voice id in path.",
  },
  cartesia: {
    kind: "tts", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: [],
    vision: false, audioIn: false, image: null,
    audio: { path: "/tts/bytes", body: { model_id: "<<MODEL>>", transcript: "<<TEXT>>", voice: { mode: "id", id: "<<VOICE>>" }, output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 } } },
    video: null, probe: null, voiceDefault: "09f6bad8-2340-4eac-89ec-74885c34d189",
    defaults: { audio: "sonic-3.6" },
    notes: "Returns binary audio; Cartesia-Version header injected server-side.",
  },
  deepgram: {
    kind: "tts", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["results.channels.0.alternatives.0.transcript"],
    vision: false, audioIn: true, image: null,
    audio: { path: "/v1/speak", altPath: "/v2/speak", altMatch: "flux", query: { model: "<<MODEL>>" }, body: { text: "<<TEXT>>" } },
    video: null, probe: null,
    defaults: { audio: "aura-2-thalia-en" },
    notes: "TTS model is a query param, returns binary audio. Paths carry the version explicitly because the base URL is the host root (so /v2/speak resolves correctly). Flux-variant models route to /v2/speak, which requires a flux- voice model. STT: POST /v1/listen (not wired).",
  },
  tavily: {
    kind: "search", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["answer", "results.0.content", "results.0.url", "results.0.title"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/search", method: "POST", body: { query: "<<QUERY>>", topic: "<<TOPIC>>", time_range: "<<TIME_RANGE>>", max_results: "<<MAX_RESULTS>>", include_answer: "<<ANSWER>>", chunks_per_source: "<<CHUNKS>>", auto_parameters: "<<AUTO>>", include_domains: "<<INCL_DOMAINS>>", exclude_domains: "<<EXCL_DOMAINS>>", search_depth: "<<DEPTH>>" } },
    defaults: {},
    notes: "Search-only; siblings /extract /crawl /map.",
  },
  "brave-search": {
    kind: "search", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["web.results.0.title", "web.results.0.url", "web.results.0.description"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/web/search", method: "GET", query: { q: "<<QUERY>>", count: "5" } },
    defaults: {},
    notes: "Token header injected server-side.",
  },
  serper: {
    kind: "search", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["organic.0.title", "organic.0.link", "organic.0.snippet"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/search", method: "POST", query: {}, body: { q: "<<QUERY>>" } },
    defaults: {},
    notes: "Response also carries knowledgeGraph/answerBox.",
  },
  scrapingbee: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["$"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/", method: "GET", query: { url: "<<QUERY>>", render_js: "false" } },
    defaults: {},
    notes: "Returns raw HTML, not JSON; api_key injected server-side as query param.",
  },
  finnhub: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["c", "pc", "d", "dp"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/quote", method: "GET", query: { symbol: "<<QUERY>>" } },
    defaults: {},
    notes: "Query is a stock symbol, e.g. AAPL.",
  },
  mapbox: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["features.0.place_name", "features.0.center"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/geocoding/v5/mapbox.places/<<QUERY>>.json", method: "GET", query: { limit: "5" } },
    defaults: {},
    notes: "access_token injected server-side as query param.",
  },
  googlemaps: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["status", "results.0.formatted_address", "results.0.geometry.location"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/geocode/json", method: "GET", query: { address: "<<QUERY>>" } },
    defaults: {},
    notes: "key injected server-side as query param.",
  },
  resend: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["id"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/emails", method: "POST", body: { from: "test@example.com", to: ["to@example.com"], subject: "<<TEXT>>", text: "<<TEXT>>" } },
    defaults: {},
    notes: "Sends a real email; 200 returns {id}.",
  },
  sendgrid: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: [],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/mail/send", method: "POST", body: { personalizations: [{ to: [{ email: "to@example.com" }] }], from: { email: "test@example.com" }, subject: "<<TEXT>>", content: [{ type: "text/plain", value: "<<TEXT>>" }] } },
    defaults: {},
    notes: "Sends a real email; success is 202 with empty body.",
  },
  mailgun: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["id", "message"],
    vision: false, audioIn: false, image: null, audio: null, video: null, formOnly: true,
    probe: { path: "/<<DOMAIN>>/messages", method: "POST", body: { from: "test@example.com", to: "to@example.com", subject: "<<TEXT>>", text: "<<TEXT>>" } },
    defaults: {},
    notes: "Form-only upstream; proxy sends form. <<DOMAIN>> is your mailgun domain.",
  },
  postmark: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["MessageID"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/email", method: "POST", body: { From: "test@example.com", To: "to@example.com", Subject: "<<TEXT>>", TextBody: "<<TEXT>>", MessageStream: "outbound" } },
    defaults: {},
    notes: "Sends a real email; 200 returns {MessageID,...}.",
  },
  twilio: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["sid", "status", "uri"],
    vision: false, audioIn: false, image: null, audio: null, video: null, formOnly: true,
    probe: { path: "/Accounts/<<SID>>/Messages.json", method: "POST", body: { To: "+15558675310", From: "+15557122661", Body: "<<TEXT>>" } },
    defaults: {},
    notes: "Form-only upstream; proxy sends form. <<SID>> is your Account SID.",
  },
  openweather: {
    kind: "search", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["name", "main.temp", "weather"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/weather", method: "GET", query: { q: "<<QUERY>>", units: "metric" } },
    defaults: {},
    notes: "appid injected server-side as query param; query is a city name.",
  },
  supabase: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["0"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/tablename", method: "GET", query: { select: "*" } },
    defaults: {},
    notes: "PostgREST; replace tablename. Per-project URL resolved per key.",
  },
  neon: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["projects", "projects.0.id"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/projects", method: "GET", query: {} },
    defaults: {},
    notes: "Response {projects:[...]}.",
  },
  upstash: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["0", "0.database_id"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/redis/databases", method: "GET", query: {} },
    defaults: {},
    notes: "Bare array of Database objects.",
  },
  turso: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["databases", "databases.0.Name", "databases.0.DbId"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/organizations/<<ORG>>/databases", method: "GET", query: {} },
    defaults: {},
    notes: "<<ORG>> is your organization slug.",
  },
  appwrite: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["databases", "databases.0.$id", "total"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/databases", method: "GET", query: {} },
    defaults: {},
    notes: "Project header injected server-side; endpoint resolved per key.",
  },
  cloudflare: {
    kind: "rest", chatPath: null, chatStyle: null,
    modelsPath: null, textPaths: ["result", "result.0.id", "result_info", "success"],
    vision: false, audioIn: false, image: null, audio: null, video: null,
    probe: { path: "/zones", method: "GET", query: { per_page: "5" } },
    defaults: {},
    notes: "Envelope {success,result[],result_info}.",
  },
};

/** Placeholder tokens filled client-side from playground inputs. */
export const PLACEHOLDERS = ["<<MODEL>>", "<<TEXT>>", "<<QUERY>>", "<<VOICE>>", "<<SIZE>>", "<<ORG>>", "<<SID>>", "<<DOMAIN>>"] as const;
