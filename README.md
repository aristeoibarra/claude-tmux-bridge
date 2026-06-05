# claude-tmux-bridge

Select DOM elements in your browser, describe a change, and have it land **in the
prompt of the Claude Code session running in the matching tmux pane** — with the React
component name, a clean selector, computed styles, and an optional screenshot.

Built for working across **many Next.js + React + TS projects** with zero per-project
setup: one global bridge, one bookmarklet, automatic routing.

```
  localhost:3000 (project A) ┐
  localhost:3001 (project B) ┼──▶ bridge :7331 ──▶ port→cwd→Claude pane ──▶ paste
  localhost:3002 (project C) ┘
```

Unlike tools that spawn a fresh headless Claude, this injects into the **interactive
session you already have open**, so Claude keeps its loaded context.

## How routing works

The widget sends the page URL. The bridge reads the dev-server **port**, finds the
process listening on it (`lsof`), takes its **working directory**, and matches the
Claude Code tmux pane whose cwd is inside that project. No pinning, no config — open as
many projects as you like at once.

Resolution cascade: pinned pane (if it still exists) → port→cwd→pane → configured
project → the only Claude pane. It never hard-fails on a stale pane id.

## Requirements

- macOS (the `service` command is macOS-only; the rest works anywhere with tmux)
- tmux — your Claude Code sessions run inside tmux panes
- Node 20+
- `lsof` (preinstalled on macOS)

## Setup (once)

```bash
git clone <repo> ~/claude-tmux-bridge && cd ~/claude-tmux-bridge
npm install
npm link                       # makes `claude-tmux-bridge` global

claude-tmux-bridge start       # run it (or: claude-tmux-bridge service install)
```

Then open **http://localhost:7331** and **drag the bookmarklet** to your bookmarks bar.

### Keep it always running (optional)

```bash
claude-tmux-bridge service install     # launchd: starts at login, restarts if it dies
claude-tmux-bridge service status
claude-tmux-bridge service uninstall
```

## Daily use (any project)

1. Run your dev server (`npm run dev`)
2. Open Claude Code in a **tmux pane inside that project's directory**
3. Click the **◎ Select → Claude** bookmark
4. **Alt+C** or the button → hover → click an element
5. Refine with **↑ parent / ↓ child**, **+ add another** for multiple elements
6. Type the change, **Send** — it routes to the right Claude pane automatically

The panel shows **→ <project>** so you know where it will go before sending.

## What it captures

Per element: **component name + ancestry** (`ProfileCard › ProfileGrid › AppShell`,
walked from the React fiber, framework wrappers filtered out), a **clean selector**
(`@medv/finder`, strips Tailwind noise), **computed styles**, role/accessible name,
bounding box, text, and outer HTML. Optionally a **screenshot** (largest selected
element) saved to a temp file and referenced by path so Claude can read the image.

Toggles (remembered across reloads): **auto-send** (off = paste for review first) and
**📷 screenshot**.

## Commands

| Command | What it does |
| --- | --- |
| `start [--port N] [--project PATH]` | Start the bridge (default `:7331`) |
| `service <install\|uninstall\|status>` | Run as a launchd service (macOS) |
| `target [%id\|--clear]` | Pin/clear a target pane (rarely needed) |
| `panes` | List tmux panes and guess which run Claude Code |

## Loading the widget without the bookmarklet

If a project ships a strict dev-mode CSP that blocks the bookmarklet's script, mount
the widget from the project instead — copy [`examples/ClaudeBridge.tsx`](examples/ClaudeBridge.tsx)
into the repo and render `<ClaudeBridge />` in the root layout (dev-only).

## Optional: exact `file:line` via Babel

Component name + grep is usually enough. For deterministic source locations, add a
Babel plugin that injects `data-source` on every element — the widget reads it
automatically. **Trade-off:** a Babel config makes Next 16 fall back from Turbopack to
Babel, slowing dev. Enable only when needed. See `client/capture.ts` for the reader.

## Security

Development-only. The bridge binds to `localhost`, accepts any local origin, and pastes
what it receives into your pane. Run it only on a machine you control; don't expose the
port.

## License

MIT
