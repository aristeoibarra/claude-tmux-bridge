import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface BridgeConfig {
  /** tmux target pane id, e.g. "%7". When null, the server resolves it at send time. */
  targetPane: string | null;
  /** HTTP port the bridge listens on. */
  port: number;
}

export const DEFAULT_PORT = 7331;

const CONFIG_DIR = join(homedir(), ".config", "claude-tmux-bridge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: BridgeConfig = {
  targetPane: null,
  port: DEFAULT_PORT,
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
