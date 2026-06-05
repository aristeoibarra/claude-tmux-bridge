import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LABEL = "com.aristeoibarra.claude-tmux-bridge";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library", "Logs", "claude-tmux-bridge");

function binPath(): string {
  // service.ts is bundled into dist/cli.js, so __dirname is dist/ at runtime.
  return join(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function plistContent(): string {
  // launchd starts with a minimal PATH; include common locations for tmux/lsof/node.
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
  <key>StandardOutPath</key><string>${join(LOG_DIR, "bridge.log")}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, "bridge.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${path}</string></dict>
</dict>
</plist>
`;
}

export async function installService(): Promise<string> {
  await mkdir(dirname(PLIST), { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(PLIST, plistContent(), "utf8");
  await execFileAsync("launchctl", ["unload", PLIST]).catch(() => {});
  await execFileAsync("launchctl", ["load", "-w", PLIST]);
  return PLIST;
}

export async function uninstallService(): Promise<void> {
  await execFileAsync("launchctl", ["unload", PLIST]).catch(() => {});
  await rm(PLIST, { force: true });
}

export async function serviceStatus(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list", LABEL]);
    return `loaded\n${stdout.trim()}`;
  } catch {
    return "not loaded";
  }
}
