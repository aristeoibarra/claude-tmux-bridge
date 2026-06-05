import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

import type { BridgeConfig } from "./config.ts";
import { detectClaudePanes, injectToPane } from "./tmux.ts";
import { formatPrompt, isSendPayload } from "./format.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDGET_ENTRY = join(__dirname, "..", "client", "widget.ts");
const MAX_BODY_BYTES = 1_000_000;

export function createServer(config: BridgeConfig) {
  let widgetCache: string | null = null;

  async function buildWidget(): Promise<string> {
    if (widgetCache) return widgetCache;
    const result = await esbuild.build({
      entryPoints: [WIDGET_ENTRY],
      bundle: true,
      format: "iife",
      target: "es2020",
      write: false,
      define: {
        __BRIDGE_ORIGIN__: JSON.stringify(`http://localhost:${config.port}`),
      },
    });
    const file = result.outputFiles[0];
    widgetCache = file ? file.text : "";
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

    const url = req.url ?? "/";

    if (req.method === "GET" && url.startsWith("/health")) {
      sendJson(res, 200, { ok: true, targetPane: config.targetPane });
      return;
    }

    if (req.method === "GET" && url.startsWith("/widget.js")) {
      const code = await buildWidget();
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      res.end(code);
      return;
    }

    if (req.method === "POST" && url.startsWith("/send")) {
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
      sendJson(res, 400, { ok: false, error: "missing message/url" });
      return;
    }

    const target = await resolveTarget(config);
    if (!target) {
      sendJson(res, 409, {
        ok: false,
        error:
          "No target pane. Run `claude-tmux-bridge target` from this Claude Code session, or set one explicitly.",
      });
      return;
    }

    const prompt = formatPrompt(parsed);
    await injectToPane(target, prompt);
    sendJson(res, 200, { ok: true, targetPane: target });
  }
}

async function resolveTarget(config: BridgeConfig): Promise<string | null> {
  if (config.targetPane) return config.targetPane;
  const claudePanes = await detectClaudePanes();
  return claudePanes.length === 1 ? (claudePanes[0]?.id ?? null) : null;
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
