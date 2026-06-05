import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TmuxPane {
  id: string;
  command: string;
  path: string;
  title: string;
  active: boolean;
}

/** Claude Code renames its pane process to its semver version, e.g. "2.1.165". */
const CLAUDE_COMMAND_RE = /^\d+\.\d+\.\d+/;

export function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX);
}

/** The pane this process is attached to, if any (set by tmux as $TMUX_PANE). */
export function currentPane(): string | null {
  return process.env.TMUX_PANE ?? null;
}

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function listPanes(): Promise<TmuxPane[]> {
  const format = [
    "#{pane_id}",
    "#{pane_current_command}",
    "#{pane_current_path}",
    "#{pane_title}",
    "#{pane_active}",
  ].join("\t");
  const { stdout } = await execFileAsync("tmux", ["list-panes", "-a", "-F", format]);
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [id, command, path, title, active] = line.split("\t");
      return {
        id: id ?? "",
        command: command ?? "",
        path: path ?? "",
        title: title ?? "",
        active: active === "1",
      } satisfies TmuxPane;
    });
}

/** Heuristic: panes whose running command looks like a Claude Code version string. */
export async function detectClaudePanes(): Promise<TmuxPane[]> {
  const panes = await listPanes();
  return panes.filter(
    (pane) => CLAUDE_COMMAND_RE.test(pane.command) || /claude/i.test(pane.title),
  );
}

/**
 * Inject text into a pane as a bracketed paste, then press Enter to submit.
 * Bracketed paste keeps multi-line content as a single block instead of
 * submitting on every newline — exactly how Claude Code expects a paste.
 */
export async function injectToPane(pane: string, text: string): Promise<void> {
  const bufferName = "claude-tmux-bridge";

  await loadBuffer(bufferName, text);
  // -p: bracketed paste, -d: delete buffer afterwards.
  await execFileAsync("tmux", ["paste-buffer", "-b", bufferName, "-t", pane, "-d", "-p"]);
  await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
}

function loadBuffer(name: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", ["load-buffer", "-b", name, "-"]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
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
