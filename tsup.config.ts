import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI + server bundle — Node, no runtime deps, executable shebang.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist",
  },
  {
    // Browser widget — IIFE with finder + modern-screenshot inlined → dist/widget.global.js
    entry: { widget: "client/widget.ts" },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    minify: true,
    outDir: "dist",
  },
]);
