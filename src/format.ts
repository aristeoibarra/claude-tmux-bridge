export interface ElementPayload {
  selector: string;
  tag: string;
  id: string | null;
  component: string | null;
  componentStack: string[];
  source: string | null;
  role: string | null;
  accessibleName: string | null;
  text: string;
  styles: Record<string, string>;
  box: { x: number; y: number; w: number; h: number };
  html: string;
}

export interface SendPayload {
  message: string;
  url: string;
  elements: ElementPayload[];
  screenshot: string | null;
  autoSubmit: boolean;
  /** Per-tab override: pane id picked in the widget's Settings. null/absent = auto-route. */
  targetPane?: string | null;
}

export function isSendPayload(value: unknown): value is SendPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.message === "string" &&
    typeof v.url === "string" &&
    Array.isArray(v.elements)
  );
}

/** Build a clean, Claude-friendly prompt from selected elements + request. */
export function formatPrompt(payload: SendPayload, screenshotPath: string | null): string {
  const lines: string[] = ["[claude-tmux-bridge] UI change request from the browser", ""];

  lines.push(`Request: ${payload.message.trim() || "(no message provided)"}`);
  lines.push(`Page: ${payload.url}`);
  if (screenshotPath) lines.push(`Screenshot: ${screenshotPath}`);
  lines.push("");

  payload.elements.forEach((el, i) => {
    const heading = el.component ? `<${el.component}>` : `${el.tag}${el.id ? `#${el.id}` : ""}`;
    lines.push(`Element ${i + 1}: ${heading}`);
    if (el.componentStack.length > 0) {
      lines.push(`- Component path: ${el.componentStack.join(" › ")}`);
    }
    lines.push(`- Selector: ${el.selector}`);
    if (el.source) lines.push(`- Source: ${el.source}`);
    if (el.role || el.accessibleName) {
      lines.push(`- Role/name: ${[el.role, el.accessibleName].filter(Boolean).join(" / ")}`);
    }
    lines.push(`- Box: ${el.box.w}×${el.box.h} at (${el.box.x}, ${el.box.y})`);
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

function formatStyles(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}
