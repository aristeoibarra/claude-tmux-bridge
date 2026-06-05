# claude-tmux-bridge

Select DOM elements in your browser, describe a change, and have it land **directly
in the prompt of a Claude Code session running in a tmux pane** — with the React
component name, a clean selector, computed styles, and an optional screenshot.

```
Browser widget  ──HTTP──▶  bridge server  ──tmux paste-buffer──▶  your Claude Code pane
```

Unlike tools that spawn a fresh, headless Claude invocation, this injects into the
**interactive session you already have open** — so Claude keeps all its loaded context.

## Requirements

- tmux (your Claude Code session must run inside a tmux pane)
- Node 20+
- A React/Next dev app (the example is Next.js 16 + React 19)

## What it captures

For each selected element, the prompt includes:

- **Component name + ancestry** — `ProfileCard › ProfileGrid › HomePage`, walked from
  the React fiber. Robust on React 19 (which removed `_debugSource`). This is what
  lets the agent grep straight to the file.
- **Clean selector** — via [`@medv/finder`](https://github.com/antonmedv/finder),
  which strips Tailwind utility-class noise and prefers `id` / `data-testid` / `role`.
- **Computed styles** — a curated subset (sizing, layout, typography, color, border,
  effects) so "make it bigger" has real context.
- **Role / accessible name, bounding box, text, outer HTML.**
- **Source `file:line`** — only if you enable the optional Babel plugin (see below).
- **Screenshot** — optional; saved to a temp file and referenced by path so Claude
  can read the image.

## Setup

```bash
# 1. In the SAME pane where Claude Code runs, pin it as the target:
npx claude-tmux-bridge target

# 2. In a SECOND pane, start the bridge:
npx claude-tmux-bridge start
```

### Multiple Claude sessions

Skip the pin and start the bridge **from each project directory** — it routes to the
Claude pane whose working directory matches the project:

```bash
cd ~/my-project && npx claude-tmux-bridge start          # routes by cwd
npx claude-tmux-bridge target --clear                    # drop a pin to re-enable routing
npx claude-tmux-bridge start --project ~/my-project      # or pass it explicitly
```

Inspect panes anytime: `npx claude-tmux-bridge panes`.

## Wire into a Next.js app

Copy [`examples/ClaudeBridge.tsx`](examples/ClaudeBridge.tsx) into your project and
mount it in your root layout. It only injects the script when
`NODE_ENV === "development"`, so production is untouched.

```tsx
// app/layout.tsx
import { ClaudeBridge } from "@/components/dev/ClaudeBridge";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ClaudeBridge />
      </body>
    </html>
  );
}
```

## Using it

- Click **◎ Select → Claude** (bottom-right) or press **Alt+C**.
- Hover to highlight, click to pick an element.
- Refine with **↑ parent / ↓ child** (the click often lands on a deep child).
- **+ add another** to select multiple elements in one request.
- Toggle **auto-send** (off = paste into the prompt for you to review before sending)
  and **screenshot** (capture the focused element as an image).
- Type the change, hit **Send to Claude**.

## Optional: exact `file:line` via Babel

Component name + grep is usually enough. If you want deterministic source locations,
add a Babel plugin that injects `data-source` onto every element — the widget reads it
automatically (`el.closest("[data-source]")`).

> **Trade-off:** adding a Babel config makes Next.js 16 fall back from Turbopack to
> Babel, slowing dev builds. Enable it only when you need it.

```bash
npm i -D @locator/babel-jsx
```

```js
// babel.config.js — Next 16 auto-detects this and runs it through Turbopack's babel-loader
module.exports = {
  presets: ["next/babel"],
  plugins: process.env.NODE_ENV === "development" ? ["@locator/babel-jsx/dist"] : [],
};
```

(LocatorJS injects `data-locatorjs-id`; adapt the reader in `client/capture.ts` if you
use a plugin with a different attribute name.)

## Commands

| Command | What it does |
| --- | --- |
| `start [--port N] [--project PATH]` | Start the bridge server (default `:7331`) |
| `target [%id]` | Pin the target pane (defaults to the current pane) |
| `target --clear` | Remove the pin and auto-route by project path |
| `panes` | List tmux panes and guess which run Claude Code |

## Security

Development-only by design. The bridge binds to `localhost`, accepts requests from any
local origin (CORS `*`), and pastes whatever it receives into your pane — so only run
it on a machine you control, and don't expose the port.

## License

MIT
