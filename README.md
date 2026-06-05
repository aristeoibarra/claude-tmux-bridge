# claude-tmux-bridge

Select a DOM element in your browser, write what you want changed, and have it land
**directly in the prompt of a Claude Code session running in a tmux pane**.

```
Browser widget  ──HTTP──▶  bridge server  ──tmux paste-buffer──▶  your Claude Code pane
```

Unlike tools that spawn a fresh, headless Claude invocation, this injects into the
**interactive session you already have open** — so Claude keeps all its loaded context.

## Requirements

- tmux (your Claude Code session must run inside a tmux pane)
- Node 20+
- A React/Next dev app (the widget is framework-agnostic, but the example is Next.js)

## How it works

1. The bridge serves a small browser widget at `http://localhost:7331/widget.js`.
2. You load that script in your dev app (only in development).
3. You pick an element; the widget POSTs it to the bridge.
4. The bridge formats a prompt and pastes it into the target tmux pane via
   `load-buffer` + `paste-buffer -p` (bracketed paste) + `Enter`.

Bracketed paste means multi-line prompts arrive as a single block — Claude Code
treats it as a paste, not as many submitted lines.

## Setup

```bash
# 1. In the SAME pane where Claude Code runs, pin it as the target:
npx claude-tmux-bridge target
#    (defaults to $TMUX_PANE — the pane you run it from)
#    or pin one explicitly:  npx claude-tmux-bridge target %7

# 2. In a SECOND pane, start the bridge:
npx claude-tmux-bridge start
```

If you don't pin a target, the bridge auto-detects the Claude pane at send time —
but only when exactly one pane looks like Claude Code. With several, pin it.

Inspect panes anytime:

```bash
npx claude-tmux-bridge panes
```

## Wire into a Next.js app

Copy [`examples/ClaudeBridge.tsx`](examples/ClaudeBridge.tsx) into your project and
mount it in your root layout. It only injects the script when
`NODE_ENV === "development"`, so production is untouched.

```tsx
// app/layout.tsx
import { ClaudeBridge } from "@/components/ClaudeBridge";

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

- Click the **◎ Select → Claude** button (bottom-right) or press **Alt+C**.
- Hover to highlight, click to pick an element.
- Type the change you want, hit **Send to Claude**.
- The request + element context appears in your Claude Code prompt and submits.

## What gets sent

A formatted prompt with: your request, the page URL, a CSS selector, the element
descriptor (`tag#id.class`), a best-effort React source location (`src/...:line`,
when the dev fiber exposes it), trimmed text content, and the element's outer HTML.

## Commands

| Command | What it does |
| --- | --- |
| `start [--port N]` | Start the bridge server (default `:7331`) |
| `target [%id]` | Pin the target pane (defaults to the current pane) |
| `panes` | List tmux panes and guess which run Claude Code |

## Security

Development-only by design. The bridge binds to `localhost`, accepts requests from
any local origin (CORS `*`), and pastes whatever it receives into your pane — so
only run it on a machine you control, and don't expose the port.

## License

MIT
