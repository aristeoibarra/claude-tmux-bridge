import { createServer } from "./server.ts";
import { installService, uninstallService, serviceStatus } from "./service.ts";
import { loadConfig, saveConfig, CONFIG_FILE, DEFAULT_PORT } from "./config.ts";
import {
  currentPane,
  detectClaudePanes,
  isInsideTmux,
  isTmuxAvailable,
  listPanes,
} from "./tmux.ts";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!(await isTmuxAvailable())) {
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
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      fail(`Unknown command: ${command}\n`);
  }
}

async function start(args: string[]): Promise<void> {
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

async function panes(): Promise<void> {
  const all = await listPanes();
  const claude = new Set((await detectClaudePanes()).map((p) => p.id));
  const here = currentPane();

  log("tmux panes:");
  for (const pane of all) {
    const tags = [
      claude.has(pane.id) ? "claude?" : "",
      pane.id === here ? "this-pane" : "",
      pane.active ? "active" : "",
    ]
      .filter(Boolean)
      .join(",");
    log(`  ${pane.id.padEnd(6)} ${pane.command.padEnd(14)} ${pane.path}${tags ? `  [${tags}]` : ""}`);
  }
}

async function target(args: string[]): Promise<void> {
  const config = await loadConfig();

  if (args.includes("--clear")) {
    config.targetPane = null;
    await saveConfig(config);
    log("target pane cleared — bridge will auto-detect by project path.");
    return;
  }

  const explicit = args.find((a) => a.startsWith("%"));
  const pane = explicit ?? currentPane();
  if (!pane) {
    fail(
      "Could not determine a target pane.\n" +
        "Run this inside the Claude Code tmux pane, or pass one explicitly: `target %7`.",
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

async function service(args: string[]): Promise<void> {
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

function printHelp(): void {
  log(
    [
      "claude-tmux-bridge — send selected browser elements into a Claude Code tmux pane",
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
      "(dev-server port -> project dir -> matching Claude pane).",
    ].join("\n"),
  );
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) return args[index + 1] ?? null;
  return null;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

void main();
