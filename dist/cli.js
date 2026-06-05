#!/usr/bin/env node

// src/server.ts
import { createServer as createHttpServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";

// src/tmux.ts
import { execFile } from "child_process";
import { spawn } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var CLAUDE_COMMAND_RE = /^\d+\.\d+\.\d+/;
function isInsideTmux() {
  return Boolean(process.env.TMUX);
}
function currentPane() {
  return process.env.TMUX_PANE ?? null;
}
async function isTmuxAvailable() {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}
async function listPanes() {
  const format = [
    "#{pane_id}",
    "#{pane_current_command}",
    "#{pane_current_path}",
    "#{pane_title}",
    "#{pane_active}"
  ].join("	");
  const { stdout } = await execFileAsync("tmux", ["list-panes", "-a", "-F", format]);
  return stdout.split("\n").filter((line) => line.trim().length > 0).map((line) => {
    const [id, command, path, title, active] = line.split("	");
    return {
      id: id ?? "",
      command: command ?? "",
      path: path ?? "",
      title: title ?? "",
      active: active === "1"
    };
  });
}
async function detectClaudePanes() {
  const panes2 = await listPanes();
  return panes2.filter(
    (pane) => CLAUDE_COMMAND_RE.test(pane.command) || /claude/i.test(pane.title)
  );
}
async function cwdForPort(port) {
  if (!/^\d+$/.test(port)) return null;
  try {
    const { stdout: pidOut } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t"
    ]);
    const pid = pidOut.split("\n")[0]?.trim();
    if (!pid) return null;
    const { stdout: cwdOut } = await execFileAsync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]);
    const line = cwdOut.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}
async function injectToPane(pane, text, submit) {
  const bufferName = "claude-tmux-bridge";
  await loadBuffer(bufferName, text);
  await execFileAsync("tmux", ["paste-buffer", "-b", bufferName, "-t", pane, "-d", "-p"]);
  if (submit) await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
}
function loadBuffer(name, text) {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", ["load-buffer", "-b", name, "-"]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tmux load-buffer exited with ${code}: ${stderr}`));
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

// src/format.ts
function isSendPayload(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.message === "string" && typeof v.url === "string" && Array.isArray(v.elements);
}
function formatPrompt(payload, screenshotPath) {
  const lines = ["[claude-tmux-bridge] UI change request from the browser", ""];
  lines.push(`Request: ${payload.message.trim() || "(no message provided)"}`);
  lines.push(`Page: ${payload.url}`);
  if (screenshotPath) lines.push(`Screenshot: ${screenshotPath}`);
  lines.push("");
  payload.elements.forEach((el, i) => {
    const heading = el.component ? `<${el.component}>` : `${el.tag}${el.id ? `#${el.id}` : ""}`;
    lines.push(`Element ${i + 1}: ${heading}`);
    if (el.componentStack.length > 0) {
      lines.push(`- Component path: ${el.componentStack.join(" \u203A ")}`);
    }
    lines.push(`- Selector: ${el.selector}`);
    if (el.source) lines.push(`- Source: ${el.source}`);
    if (el.role || el.accessibleName) {
      lines.push(`- Role/name: ${[el.role, el.accessibleName].filter(Boolean).join(" / ")}`);
    }
    lines.push(`- Box: ${el.box.w}\xD7${el.box.h} at (${el.box.x}, ${el.box.y})`);
    const styles = formatStyles(el.styles);
    if (styles) lines.push(`- Key styles: ${styles}`);
    if (el.text) lines.push(`- Text: "${truncate(el.text, 200)}"`);
    lines.push("- HTML:");
    lines.push("```html");
    lines.push(truncate(el.html, 1500));
    lines.push("```");
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
function formatStyles(styles) {
  return Object.entries(styles).map(([k, v]) => `${k}: ${v}`).join("; ");
}
function truncate(value, max) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}\u2026` : normalized;
}

// src/bookmarklet.ts
function bookmarkletCode(port) {
  return `javascript:(function(){var d=document;if(d.getElementById('claude-tmux-bridge-root'))return;var s=d.createElement('script');s.src='http://localhost:${port}/widget.js?t='+Date.now();s.onerror=function(){alert('claude-tmux-bridge: bridge not reachable on :` + port + "');};d.body.appendChild(s);})();";
}
function bookmarkletPage(port) {
  const code = bookmarkletCode(port).replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-tmux-bridge \u2014 setup</title>
<style>
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; background: #121212; color: #eee;
         max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { color: #d97757; font-size: 22px; }
  code { background: #1f1f1f; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .bm { display: inline-block; background: #d97757; color: #fff; text-decoration: none;
        padding: 10px 18px; border-radius: 999px; font-weight: 700; margin: 10px 0; cursor: grab; }
  ol { padding-left: 20px; } li { margin: 8px 0; }
  .status { margin-top: 16px; font-size: 13px; }
  .ok { color: #6ee7a8; } .err { color: #ff8a8a; }
  hr { border: none; border-top: 1px solid #2a2a2a; margin: 24px 0; }
  small { color: #999; }
</style>
</head>
<body>
  <h1>claude-tmux-bridge</h1>
  <p>Bridge is running on <code>http://localhost:${port}</code> <span id="st" class="status"></span></p>

  <p><strong>1.</strong> Drag this button to your bookmarks bar:</p>
  <a class="bm" href="${code}">\u25CE Select \u2192 Claude</a>

  <p><strong>2.</strong> Use it on any local dev app:</p>
  <ol>
    <li>Open your app (e.g. <code>http://localhost:3000</code>)</li>
    <li>Make sure Claude Code runs in a tmux pane <em>inside that project's directory</em></li>
    <li>Click the bookmark \u2014 the toolbar appears</li>
    <li><code>Alt+C</code> or the button to select an element, then send</li>
  </ol>

  <hr>
  <p><small>Routing is automatic: the bridge maps the dev-server port to its project
  directory and finds the matching Claude pane. No per-project setup needed.</small></p>

<script>
  fetch('/health').then(r=>r.json()).then(d=>{
    document.getElementById('st').innerHTML = d.ok ? '<span class="ok">\u25CF connected</span>' : '';
  }).catch(()=>{ document.getElementById('st').innerHTML='<span class="err">\u25CF offline</span>'; });
</script>
</body>
</html>`;
}

// src/server.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var WIDGET_CANDIDATES = [
  join(__dirname, "widget.global.js"),
  join(__dirname, "..", "dist", "widget.global.js")
];
var MAX_BODY_BYTES = 5e6;
function createServer(config) {
  let widgetCache = null;
  async function loadWidget() {
    if (widgetCache) return widgetCache;
    const file = WIDGET_CANDIDATES.find((p) => existsSync(p));
    if (!file) throw new Error("widget.global.js not found \u2014 run `npm run build`");
    widgetCache = await readFile(file, "utf8");
    return widgetCache;
  }
  return createHttpServer((req, res) => {
    void handle(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: errorMessage(error) });
    });
  });
  async function handle(req, res) {
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
    if (req.method === "GET" && pathname === "/resolve") {
      const resolved = await resolveTarget(config, searchParams.get("url") ?? "");
      sendJson(res, 200, resolved ? { ok: true, project: basename(resolved.project), pane: resolved.pane } : { ok: false });
      return;
    }
    if (req.method === "POST" && pathname === "/send") {
      await handleSend(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: "not found" });
  }
  async function handleSend(req, res) {
    const body = await readBody(req);
    let parsed;
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
    const resolved = await resolveTarget(config, parsed.url);
    if (!resolved) {
      sendJson(res, 409, {
        ok: false,
        error: "No Claude pane found for this project. Open Claude Code in a tmux pane inside the project dir, or pin one with `claude-tmux-bridge target`."
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
      screenshot: screenshotPath
    });
  }
}
async function resolveTarget(config, requestUrl) {
  const claude = await detectClaudePanes();
  if (claude.length === 0) return null;
  if (config.targetPane) {
    const pinned = claude.find((p) => p.id === config.targetPane);
    if (pinned) return { pane: pinned.id, project: pinned.path };
  }
  const port = safePort(requestUrl);
  if (port) {
    const cwd = await cwdForPort(port);
    if (cwd) {
      const matched = claude.filter((p) => pathMatches(cwd, p.path));
      if (matched.length === 1 && matched[0]) return { pane: matched[0].id, project: matched[0].path };
    }
  }
  const projectPath = config.projectPath;
  if (projectPath) {
    const matched = claude.filter((p) => pathMatches(projectPath, p.path));
    if (matched.length === 1 && matched[0]) return { pane: matched[0].id, project: matched[0].path };
  }
  if (claude.length === 1 && claude[0]) return { pane: claude[0].id, project: claude[0].path };
  return null;
}
function pathMatches(project, pane) {
  return pane === project || pane.startsWith(`${project}/`) || project.startsWith(`${pane}/`);
}
function safePort(raw) {
  try {
    return new URL(raw).port || null;
  } catch {
    return null;
  }
}
async function saveScreenshot(dataUrl) {
  const match = /^data:image\/(?:png|jpeg);base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1]) return null;
  const dir = join(tmpdir(), "claude-tmux-bridge");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `shot-${Date.now()}.png`);
  await writeFile(file, Buffer.from(match[1], "base64"));
  return file;
}
function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
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
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/service.ts
import { homedir } from "os";
import { join as join2, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { mkdir as mkdir2, writeFile as writeFile2, rm } from "fs/promises";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
var LABEL = "com.aristeoibarra.claude-tmux-bridge";
var PLIST = join2(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
var LOG_DIR = join2(homedir(), "Library", "Logs", "claude-tmux-bridge");
function binPath() {
  return join2(dirname2(fileURLToPath2(import.meta.url)), "cli.js");
}
function plistContent() {
  const path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${binPath()}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join2(LOG_DIR, "bridge.log")}</string>
  <key>StandardErrorPath</key><string>${join2(LOG_DIR, "bridge.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${path}</string></dict>
</dict>
</plist>
`;
}
async function installService() {
  await mkdir2(dirname2(PLIST), { recursive: true });
  await mkdir2(LOG_DIR, { recursive: true });
  await writeFile2(PLIST, plistContent(), "utf8");
  await execFileAsync2("launchctl", ["unload", PLIST]).catch(() => {
  });
  await execFileAsync2("launchctl", ["load", "-w", PLIST]);
  return PLIST;
}
async function uninstallService() {
  await execFileAsync2("launchctl", ["unload", PLIST]).catch(() => {
  });
  await rm(PLIST, { force: true });
}
async function serviceStatus() {
  try {
    const { stdout } = await execFileAsync2("launchctl", ["list", LABEL]);
    return `loaded
${stdout.trim()}`;
  } catch {
    return "not loaded";
  }
}

// src/config.ts
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
import { mkdir as mkdir3, readFile as readFile2, writeFile as writeFile3 } from "fs/promises";
var DEFAULT_PORT = 7331;
var CONFIG_DIR = join3(homedir2(), ".config", "claude-tmux-bridge");
var CONFIG_FILE = join3(CONFIG_DIR, "config.json");
var DEFAULT_CONFIG = {
  targetPane: null,
  projectPath: null,
  port: DEFAULT_PORT
};
async function loadConfig() {
  try {
    const raw = await readFile2(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
async function saveConfig(config) {
  await mkdir3(CONFIG_DIR, { recursive: true });
  await writeFile3(CONFIG_FILE, `${JSON.stringify(config, null, 2)}
`, "utf8");
}

// src/cli.ts
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!await isTmuxAvailable()) {
    fail("tmux is not installed or not on PATH.");
  }
  switch (command) {
    case "start":
      await start(rest);
      return;
    case "panes":
      await panes();
      return;
    case "target":
      await target(rest);
      return;
    case "service":
      await service(rest);
      return;
    case void 0:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      fail(`Unknown command: ${command}
`);
  }
}
async function start(args) {
  const config = await loadConfig();
  const portArg = readFlag(args, "--port");
  if (portArg) config.port = Number.parseInt(portArg, 10);
  const projectArg = readFlag(args, "--project");
  if (projectArg) config.projectPath = projectArg;
  const server = createServer(config);
  server.listen(config.port, () => {
    log(`bridge listening on http://localhost:${config.port}`);
    log(`widget:  http://localhost:${config.port}/widget.js`);
    if (config.targetPane) {
      log(`target:  pane ${config.targetPane} (pinned)`);
    } else {
      const project = config.projectPath ?? process.cwd();
      log(`target:  auto-detect Claude pane by project path (${project})`);
      log("         tip: pin one with `claude-tmux-bridge target` if detection is ambiguous.");
    }
  });
}
async function panes() {
  const all = await listPanes();
  const claude = new Set((await detectClaudePanes()).map((p) => p.id));
  const here = currentPane();
  log("tmux panes:");
  for (const pane of all) {
    const tags = [
      claude.has(pane.id) ? "claude?" : "",
      pane.id === here ? "this-pane" : "",
      pane.active ? "active" : ""
    ].filter(Boolean).join(",");
    log(`  ${pane.id.padEnd(6)} ${pane.command.padEnd(14)} ${pane.path}${tags ? `  [${tags}]` : ""}`);
  }
}
async function target(args) {
  const config = await loadConfig();
  if (args.includes("--clear")) {
    config.targetPane = null;
    await saveConfig(config);
    log("target pane cleared \u2014 bridge will auto-detect by project path.");
    return;
  }
  const explicit = args.find((a) => a.startsWith("%"));
  const pane = explicit ?? currentPane();
  if (!pane) {
    fail(
      "Could not determine a target pane.\nRun this inside the Claude Code tmux pane, or pass one explicitly: `target %7`."
    );
  }
  if (!isInsideTmux() && !explicit) {
    fail("Not inside tmux. Pass a pane id explicitly: `target %7`.");
  }
  config.targetPane = pane;
  await saveConfig(config);
  log(`target pane set to ${pane}`);
  log(`saved to ${CONFIG_FILE}`);
}
async function service(args) {
  if (process.platform !== "darwin") fail("`service` (launchd) is macOS-only.");
  switch (args[0]) {
    case "install": {
      const plist = await installService();
      log("service installed and started (runs at login, restarts if it dies).");
      log(`plist: ${plist}`);
      log("logs:  ~/Library/Logs/claude-tmux-bridge/");
      return;
    }
    case "uninstall":
      await uninstallService();
      log("service stopped and removed.");
      return;
    case "status":
      log(await serviceStatus());
      return;
    default:
      fail("Usage: claude-tmux-bridge service <install|uninstall|status>");
  }
}
function printHelp() {
  log(
    [
      "claude-tmux-bridge \u2014 send selected browser elements into a Claude Code tmux pane",
      "",
      "Usage:",
      "  start [--port N] [--project PATH]    Start the bridge (default :" + DEFAULT_PORT + ")",
      "  service <install|uninstall|status>  Run the bridge as a launchd service (macOS)",
      "  target [%id|--clear]               Pin/clear a target pane (rarely needed)",
      "  panes                              List tmux panes and guess which run Claude",
      "",
      "Setup (once):",
      "  1. npm link                  Make the CLI global",
      "  2. claude-tmux-bridge start  (or `service install` to auto-start at login)",
      "  3. open http://localhost:" + DEFAULT_PORT + "  and drag the bookmarklet to your bar",
      "",
      "Then in any project: run the dev server, open Claude Code in a tmux pane inside",
      "the project dir, click the bookmarklet, select, send. Routing is automatic",
      "(dev-server port -> project dir -> matching Claude pane)."
    ].join("\n")
  );
}
function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) return args[index + 1] ?? null;
  return null;
}
function log(message) {
  process.stdout.write(`${message}
`);
}
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
void main();
