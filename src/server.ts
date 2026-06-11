import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

import type { BridgeConfig } from "./config.ts";
import { cwdForPort, detectClaudePanes, injectToPane, listPanes, type TmuxPane } from "./tmux.ts";
import { formatPrompt, isSendPayload } from "./format.ts";
import { bookmarkletPage } from "./bookmarklet.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Pre-built widget: bundled next to dist/cli.js, or under ../dist in dev (tsx).
const WIDGET_CANDIDATES = [
  join(__dirname, "widget.global.js"),
  join(__dirname, "..", "dist", "widget.global.js"),
];
const MAX_BODY_BYTES = 5_000_000;

interface Resolved {
  pane: string;
  project: string;
}

export function createServer(config: BridgeConfig) {
  let widgetCache: string | null = null;

  async function loadWidget(): Promise<string> {
    if (widgetCache) return widgetCache;
    const file = WIDGET_CANDIDATES.find((p) => existsSync(p));
    if (!file) throw new Error("widget.global.js not found — run `npm run build`");
    widgetCache = await readFile(file, "utf8");
    return widgetCache;
  }

  return createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { ok: false, error: errorMessage(error) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, targetPane: config.targetPane });
      return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(bookmarkletPage(config.port));
      return;
    }
    if (req.method === "GET" && pathname === "/widget.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      res.end(await loadWidget());
      return;
    }
    if (req.method === "GET" && pathname === "/debug") {
      try {
        const panes = await listPanes();
        const claude = await detectClaudePanes();
        const port = searchParams.get("port");
        const portCwd = port ? await cwdForPort(port) : null;
        sendJson(res, 200, { ok: true, cwd: process.cwd(), portCwd, panes, claude });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: errorMessage(error) });
      }
      return;
    }
    if (req.method === "GET" && pathname === "/resolve") {
      const resolved = await resolveTarget(config, searchParams.get("url") ?? "");
      sendJson(res, 200, resolved ? { ok: true, project: basename(resolved.project), pane: resolved.pane } : { ok: false });
      return;
    }
    if (req.method === "GET" && pathname === "/sessions") {
      try {
        const claude = await detectClaudePanes();
        const sessions = claude.map((p) => ({ id: p.id, label: sessionLabel(p), path: p.path }));
        sendJson(res, 200, { ok: true, sessions });
      } catch {
        // tmux server not running yet — degrade to an empty list so the widget shows "Auto".
        sendJson(res, 200, { ok: true, sessions: [] });
      }
      return;
    }
    if (req.method === "POST" && pathname === "/send") {
      await handleSend(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: "not found" });
  }

  async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON" });
      return;
    }
    if (!isSendPayload(parsed)) {
      sendJson(res, 400, { ok: false, error: "missing message/url/elements" });
      return;
    }

    const override = typeof parsed.targetPane === "string" ? parsed.targetPane : null;
    const resolved = await resolveTarget(config, parsed.url, override);
    if (!resolved) {
      sendJson(res, 409, {
        ok: false,
        error:
          "No Claude pane found for this project. Open Claude Code in a tmux pane inside the project dir, or pin one with `claude-tmux-bridge target`.",
      });
      return;
    }

    const screenshotPath = parsed.screenshot ? await saveScreenshot(parsed.screenshot) : null;
    const prompt = formatPrompt(parsed, screenshotPath);
    await injectToPane(resolved.pane, prompt, parsed.autoSubmit !== false);
    sendJson(res, 200, {
      ok: true,
      targetPane: resolved.pane,
      project: basename(resolved.project),
      screenshot: screenshotPath,
    });
  }
}

/** Resolve the destination pane in cascade, tolerant of ephemeral pane ids. */
async function resolveTarget(
  config: BridgeConfig,
  requestUrl: string,
  override?: string | null,
): Promise<Resolved | null> {
  const claude = await detectClaudePanes();
  if (claude.length === 0) return null;

  // 0. Per-tab override picked in the widget — only if that pane still exists.
  // Falls through to auto-routing when the chosen pane is gone (ephemeral id died).
  if (override) {
    const chosen = claude.find((p) => p.id === override);
    if (chosen) return { pane: chosen.id, project: chosen.path };
  }

  // 1. Explicit pin — only if the pinned pane still exists.
  if (config.targetPane) {
    const pinned = claude.find((p) => p.id === config.targetPane);
    if (pinned) return { pane: pinned.id, project: pinned.path };
  }

  // 2. Derive the project from the dev-server port → cwd → matching Claude pane.
  // Most specific (deepest path) match wins, so a Claude in $HOME doesn't shadow
  // one opened in the actual project dir.
  const port = safePort(requestUrl);
  if (port) {
    const cwd = await cwdForPort(port);
    const best = bestMatch(cwd, claude);
    if (best) return { pane: best.id, project: best.path };
  }

  // 3. Configured project path.
  const byConfig = bestMatch(config.projectPath, claude);
  if (byConfig) return { pane: byConfig.id, project: byConfig.path };

  // 4. Exactly one Claude pane anywhere.
  if (claude.length === 1 && claude[0]) return { pane: claude[0].id, project: claude[0].path };

  return null;
}

/** Human-recognizable label for the Settings session picker: "demo:1 · project". */
function sessionLabel(pane: TmuxPane): string {
  const project = basename(pane.path) || pane.path;
  const where = pane.session ? `${pane.session}:${pane.window}` : pane.id;
  return `${where} · ${project}`;
}

function pathMatches(project: string, pane: string): boolean {
  return pane === project || pane.startsWith(`${project}/`) || project.startsWith(`${pane}/`);
}

/** The matching pane with the deepest (most specific) path, or null. */
function bestMatch(project: string | null, panes: TmuxPane[]): TmuxPane | null {
  if (!project) return null;
  const matched = panes
    .filter((p) => pathMatches(project, p.path))
    .sort((a, b) => b.path.length - a.path.length);
  return matched[0] ?? null;
}

function safePort(raw: string): string | null {
  try {
    return new URL(raw).port || null;
  } catch {
    return null;
  }
}

async function saveScreenshot(dataUrl: string): Promise<string | null> {
  const match = /^data:image\/(?:png|jpeg);base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1]) return null;
  const dir = join(tmpdir(), "claude-tmux-bridge");
  await mkdir(dir, { recursive: true });
  // Random suffix: two quick sends can land on the same millisecond.
  const file = join(dir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await writeFile(file, Buffer.from(match[1], "base64"));
  return file;
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
