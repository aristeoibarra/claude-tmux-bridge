export interface ElementPayload {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  html: string;
  source: string | null;
}

export interface SendPayload {
  message: string;
  url: string;
  element: ElementPayload | null;
}

export function isSendPayload(value: unknown): value is SendPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.message === "string" && typeof v.url === "string";
}

/** Build a clean, Claude-friendly prompt from a selected element + request. */
export function formatPrompt(payload: SendPayload): string {
  const lines: string[] = ["[claude-tmux-bridge] UI change request from the browser", ""];

  lines.push(`Request: ${payload.message.trim() || "(no message provided)"}`, "");

  const el = payload.element;
  if (el) {
    const descriptor = [
      el.tag,
      el.id ? `#${el.id}` : "",
      el.classes.length > 0 ? `.${el.classes.join(".")}` : "",
    ].join("");

    lines.push("Selected element:");
    lines.push(`- Page: ${payload.url}`);
    lines.push(`- Selector: ${el.selector}`);
    lines.push(`- Element: ${descriptor}`);
    if (el.source) lines.push(`- Source: ${el.source}`);
    if (el.text) lines.push(`- Text: "${truncate(el.text, 200)}"`);
    lines.push("");
    lines.push("HTML:");
    lines.push("```html");
    lines.push(truncate(el.html, 1500));
    lines.push("```");
  } else {
    lines.push(`Page: ${payload.url}`);
  }

  return lines.join("\n");
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}
