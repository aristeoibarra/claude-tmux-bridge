import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface BridgeConfig {
  /** tmux target pane id, e.g. "%7". When null, the server resolves it at send time. */
  targetPane: string | null;
  /** Project path used to match the right Claude pane when no pane is pinned. */
  projectPath: string | null;
  /** HTTP port the bridge listens on. */
  port: number;
  /** Path to whisper.cpp's CLI. Null = look it up in PATH / the usual prefixes. */
  whisperBin: string | null;
  /** Path to a ggml model. Null = pick the best one found on disk. */
  whisperModel: string | null;
}

export const DEFAULT_PORT = 7331;

const CONFIG_DIR = join(homedir(), ".config", "claude-tmux-bridge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: BridgeConfig = {
  targetPane: null,
  projectPath: null,
  port: DEFAULT_PORT,
  whisperBin: null,
  whisperModel: null,
};

export async function loadConfig(): Promise<BridgeConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: BridgeConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export { CONFIG_FILE };
