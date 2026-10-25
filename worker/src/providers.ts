// Providers bundled at build time from the same data/providers.json the Node
// server reads at runtime.

import providersJson from "../../data/providers.json";
import { FALLBACK_PROVIDERS, loadProviders, type Provider } from "../../src/shared/providers.js";

export const PROVIDERS: Provider[] = (() => {
  try {
    return loadProviders(providersJson);
  } catch {
    return FALLBACK_PROVIDERS;
  }
})();
