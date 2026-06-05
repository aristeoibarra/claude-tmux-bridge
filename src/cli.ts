import { createServer } from "./server.ts";
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

function printHelp(): void {
  log(
    [
      "claude-tmux-bridge — send selected browser elements into a Claude Code tmux pane",
      "",
      "Usage:",
      "  claude-tmux-bridge start [--port N] [--project PATH]",
      "      Start the bridge server (default :" + DEFAULT_PORT + ")",
      "  claude-tmux-bridge target [%id|--clear]",
      "      Pin the target pane (defaults to the current pane), or clear it",
      "  claude-tmux-bridge panes",
      "      List tmux panes and guess which run Claude Code",
      "",
      "Typical setup (single project):",
      "  1. In your Claude Code pane:  npx claude-tmux-bridge target",
      "  2. In a second pane:          npx claude-tmux-bridge start",
      "",
      "Multiple Claude sessions: skip the pin and run `start` from each project dir —",
      "the bridge routes by the pane's working directory.",
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
