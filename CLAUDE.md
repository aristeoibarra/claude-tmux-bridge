# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dev-only bridge that lets you select DOM elements in any localhost app and send them — with React component name/ancestry, a clean selector, computed styles, and an optional screenshot — into the **interactive Claude Code session running in the matching tmux pane**. One global bridge serves every project; routing from browser tab to the correct pane is automatic (dev-server port → cwd → Claude pane). macOS-first (only `service` is macOS-only).

## Commands

```bash
npm run build      # tsup: produces dist/cli.js AND dist/widget.global.js
npm run dev        # tsx src/cli.ts start — runs the server from source, no build step
npm run typecheck  # tsc --noEmit (the ONLY check — there are no tests and no linter)
```

There is no test runner and no ESLint/Prettier config. `npm run typecheck` is the gate before committing.

Runtime CLI (after `npm link` or install): `claude-tmux-bridge <start|panes|target|service>`. Useful while developing:
- `claude-tmux-bridge panes` — list tmux panes and which ones look like Claude (debugging routing)
- the server also exposes `GET /debug?port=N` and `GET /resolve?url=...` for inspecting resolution

**Gotcha:** `npm run dev` runs the server from source via tsx, but the server still serves the widget from the **pre-built** `dist/widget.global.js`. After editing anything under `client/`, re-run `npm run build` (or at least the widget build) or the browser gets stale JS. Editing `src/` only needs a dev restart.

## Two build targets, two source trees

`tsup.config.ts` emits two independent bundles, and the source is split to match:

- **`src/` → `dist/cli.js`** — the Node side: CLI, HTTP server, tmux control, config, launchd service. ESM, no runtime deps, executable shebang. This is the package `bin`.
- **`client/` → `dist/widget.global.js`** — the browser widget: an IIFE with `@medv/finder` and `modern-screenshot` inlined. Served at `GET /widget.js`. These deps are `devDependencies` precisely because they're bundled into the widget at build time, never required at runtime.

Imports use explicit `.ts` extensions (`allowImportingTsExtensions` + Bundler resolution); keep that style. `verbatimModuleSyntax` is on, so use `import type` for type-only imports.

## Request flow (the core path)

1. Browser widget (`client/widget.ts`) captures one or more elements via `client/capture.ts` (component name/ancestry **and serialized props** from the fiber), optionally rasterizes a screenshot with `modern-screenshot` (largest element, or the viewport with the selection outlined — toggled per send from the panel, persisted in `prefs.shot`/`prefs.shotTarget`), and `POST`s `{message, url, elements, screenshot, autoSubmit, targetPane, diagnostics}` to `/send`. `diagnostics` is a ring buffer of recent console errors / uncaught exceptions / failed fetches kept by `client/diagnostics.ts` (hooks installed at widget load; the extension injects at `document_start` so they run before app code).
2. `src/server.ts` `resolveTarget()` picks the destination pane (cascade below), `formatPrompt()` (`src/format.ts`) renders the agent-facing prompt, and a base64 screenshot is written to a temp file so Claude can read it by path.
3. `injectToPane()` (`src/tmux.ts`) loads the prompt into a named tmux buffer and `paste-buffer -p` (bracketed paste) into the pane, then optionally `send-keys Enter`. Bracketed paste is required so multi-line prompts stay one block instead of submitting per newline.
4. After an auto-send the widget polls `GET /pane-title?pane=...` once: Claude Code mirrors its current task into the tmux pane title, which is the only "did Claude pick it up?" feedback channel.

## Routing cascade (`resolveTarget` in src/server.ts)

The design goal is **zero per-project config**, tolerant of ephemeral tmux pane ids. Order:

1. **Pinned pane** (`config.targetPane`) — only if it still exists.
2. **port → cwd → pane** — parse the dev-server port from the page URL, `lsof` the process listening on it, take its cwd, and match the Claude pane whose path is deepest/most-specific under it (so a Claude open in `$HOME` never shadows one in the actual project dir — see `bestMatch`).
3. **Configured `projectPath`**.
4. **The only Claude pane**, if exactly one exists.

`pathMatches` treats either path being a prefix of the other as a match; `bestMatch` then sorts by path length so the most specific wins.

## tmux specifics that bite

- **Claude pane detection** (`detectClaudePanes`) is a heuristic: Claude Code renames its pane process to its semver version, so `pane_current_command` matching `^\d+\.\d+\.\d+` is the primary signal (fallback: title contains "claude"). If detection logic changes, this regex is the thing to revisit.
- **`FIELD_SEP` workaround**: under launchd there's no tty, and tmux sanitizes control chars (like TAB) in `-F` format output. So `listPanes` joins fields with a printable improbable separator (`@@CTB@@`), not a tab.

## launchd service (src/service.ts)

`service install` writes `~/Library/LaunchAgents/com.aristeoibarra.claude-tmux-bridge.plist` and `launchctl bootstrap`s it (boots out first to reload). The plist hardcodes a `PATH` (`/opt/homebrew/bin:...`) because launchd starts with a minimal PATH and the server shells out to `tmux`/`lsof`. `ProgramArguments` points at `dist/cli.js` (resolved from `import.meta.url` at runtime). The node binary is resolved via `nodePath()`: under fnm it prefers the stable `aliases/default/bin/node` symlink over the versioned `process.execPath`, so a Node upgrade doesn't silently kill the service.

## React fiber walking (client/react-fiber.ts)

Resolves the owning component name + ancestry by walking `__reactFiber$*`, mirroring React DevTools' name resolution (memo/forwardRef/lazy). `getComponentProps` snapshots the owner's `memoizedProps` as flat strings (scalars verbatim; functions/objects/elements summarized, never deep-serialized — keep it that way, props can hold huge object graphs). React 19 removed `_debugSource`, so file:line is **not** available from the fiber — component identity is what lets the agent grep to the file. `FRAMEWORK_RE` is a **pattern** (not an exact list) that filters Next.js/App-Router internal wrappers, because Next renames them across versions; extend the pattern rather than hardcoding names. Exact `file:line` is only available if a project opts into a `data-source` Babel plugin (read in `capture.ts`).

## Dictation (client/dictation.ts + src/transcribe.ts)

Record in the browser, transcribe on the bridge with whisper.cpp. **Don't "simplify" this back to the Web Speech API**: it's Google's hosted recognizer, Chromium-only in practice, and Brave disables it — it fails `not-allowed` with no permission prompt, which is exactly what this replaced.

- **Client**: `getUserMedia` → `AudioContext({ sampleRate: 16000 })` → `ScriptProcessorNode` accumulating Float32 chunks → 16-bit mono WAV (what whisper wants) → base64 → `POST /transcribe`. The processor is connected through a **muted gain node** because a ScriptProcessor only runs while connected to the graph, and going straight to `destination` would echo the mic. `generation` is bumped on `cancel()` so a late transcription can't land in a composer the user already closed. `encodeWav` is exported only so the WAV header can be round-tripped through whisper from a script.
- **Server**: `resolveSetup` finds the binary (`whisper-cli`, then `whisper-cpp`) and the best model, and caches the pair. Model ranking prefers `small` for latency and skips `.en` models (they'd mistranscribe Spanish). Both halves are overridable via `whisperBin`/`whisperModel` in the config.
- `GET /dictation` reports availability so the widget can hide the mic instead of failing on click; the widget forwards the final verdict (browser support + page policy + bridge) to the extension, which is what the popup displays. `/transcribe` gets its own 40 MB body cap — audio dwarfs the 5 MB JSON limit.

## Widget delivery & config

- Three ways to load the widget, all hitting the same `/widget.js`: the **browser extension** (`extension/`, MV3 content script, auto-injects on `localhost`/`127.0.0.1`, skips port 7331), the **bookmarklet** (`src/bookmarklet.ts`, served at `/`), or mounting `examples/ClaudeBridge.tsx` from a project (CSP-strict fallback).
- The widget derives the bridge origin from its own `<script src>`, so it works on any port with no build-time define.
- Config lives at `~/.config/claude-tmux-bridge/config.json` (`src/config.ts`); default port `7331`. Optional `whisperBin`/`whisperModel` override dictation's auto-detection. This is machine config — user settings are a separate thing, see below.
- The server is intentionally permissive (CORS `*`, accepts any local origin) — it's localhost-only dev tooling. Don't add auth/origin checks expecting production hardening; that's out of scope by design.
- `extension/` is hand-written JS, not a build target: `content.js`/`popup.js` are loaded verbatim by MV3 and so are outside `tsconfig`/tsup. Keep them small and plain; anything that wants types belongs in `client/`.

## User settings live in the extension popup

The widget has **no Settings UI** — `extension/popup.html`+`popup.js` own it, and the widget only reads. Don't re-add a gear to the widget.

- Storage is `chrome.storage.local`, split by scope: `global` (`autoSend`, `dictationLang`, `hotkey` — user preferences) and `pane:<origin>` (`{id, label}` — which Claude pane this project pins, hence per-origin). Splitting them is the point: nobody wants to re-record the shortcut per project.
- The widget runs in the page's **MAIN world** (it's a `<script src>`), so `window.postMessage` is the only channel to `content.js`. Protocol: widget → `prefs:get`, `pin:clear`, `dictation`; extension → `prefs`. `content.js` re-pushes on `chrome.storage.onChanged`, so popup edits land live in every open tab.
- Loaded without the extension, nothing answers `prefs:get` and the widget keeps the values in its own `localStorage` (`ctb-prefs`) — still written on every change so removing the extension doesn't reset anything. `content.js` seeds `chrome.storage` from that same key once, which is the migration path from when Settings lived in the widget.
- The pinned pane's **label** is stored alongside its id precisely so the widget never has to call `/sessions`; only the popup does.
- Dictation availability is decided in the widget (browser support + the page's Permissions-Policy + `/dictation`) and reported to `content.js`, which answers the popup's `ctb:dictation` runtime message. The page-local reason is invisible to both the popup and the bridge, which is why it flows this direction.

## Releasing

Pushing a `vX.Y.Z` tag triggers `.github/workflows/publish.yml`, which builds and publishes to GitHub Packages. Keep `version` in `package.json`, `extension/manifest.json`, and the tag in sync.

## Conventions

Conventional commits with a scope reflecting the layer touched (`routing`, `fiber`, `service`, `tmux`). Strict TypeScript: no `any`, no `as` (prefer `satisfies`), named exports, `interface` for object shapes.
