#!/usr/bin/env node
import { register } from "tsx/esm/api";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Run the TypeScript CLI directly via the tsx ESM loader — no build step.
register();

const here = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(here, "..", "src", "cli.ts")).href);
