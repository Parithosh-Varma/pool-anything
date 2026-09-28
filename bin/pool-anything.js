#!/usr/bin/env node
// Global `pool-anything` shim — runs the compiled CLI. Keep this file free of
// dependencies so `npm i -g` works with zero install-time requirements.
import "../dist/cli.js";
