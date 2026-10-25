// Rotation config read from Worker vars. Node fails startup on an unknown
// POOL_ROTATION_STRATEGY; an edge isolate cannot exit, so it warns once and
// falls back to round-robin.

import { isStrategyName, parseRotationOptions, type RotationOptions, type StrategyName } from "../../src/pool/strategy.js";
import type { Env } from "./env.js";

let warnedStrategy = "";
let warnedOptions = "";

export function defaultStrategy(env: Env): StrategyName {
  const raw = (env.POOL_ROTATION_STRATEGY ?? "round-robin").trim().toLowerCase();
  if (isStrategyName(raw)) return raw;
  if (warnedStrategy !== raw) {
    console.warn(`[warn] ignoring invalid POOL_ROTATION_STRATEGY="${raw}"; using round-robin`);
    warnedStrategy = raw;
  }
  return "round-robin";
}

export function rotationOptions(env: Env): RotationOptions {
  const parsed = parseRotationOptions(env.POOL_ROTATION_OPTIONS);
  if (!parsed.ok) {
    if (warnedOptions !== parsed.error) {
      console.warn(`[warn] ignoring POOL_ROTATION_OPTIONS: ${parsed.error}`);
      warnedOptions = parsed.error;
    }
  }
  return parsed.value;
}
