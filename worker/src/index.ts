// Worker entry. All state lives in one SQLite-backed Durable Object so that
// rotation, quota accounting and failover are serialized without D1. The
// Worker itself is a thin, globally distributed front door.

import type { Env } from "./env.js";

export { PoolDB } from "./durable.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.POOL_DB.idFromName("pool-anything");
    return env.POOL_DB.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
