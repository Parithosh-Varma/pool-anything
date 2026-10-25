// Node-facing wrappers around the shared (runtime-neutral) upstream builder.
// The Worker binds the same shared module to its bundled provider registry.

import { PROVIDERS } from "../pool/index.js";
import {
  buildUpstreamRequest,
  effectiveApiKey,
  resolveTarget as resolveTargetShared,
  resolveTargetForKey as resolveTargetForKeyShared,
  validateQueryParams,
  type ForwardOpts,
  type KeyLike,
  type PoolTargetInput,
  type Target,
} from "../shared/upstream.js";

export { buildUpstreamRequest, effectiveApiKey, validateQueryParams };
export type { ForwardOpts, KeyLike, Target };

export function resolveTarget(pool: PoolTargetInput): Target {
  return resolveTargetShared(PROVIDERS, pool);
}

export function resolveTargetForKey(pool: PoolTargetInput, key: KeyLike): Target {
  return resolveTargetForKeyShared(PROVIDERS, pool, key);
}
