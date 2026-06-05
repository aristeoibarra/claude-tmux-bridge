import { finder } from "@medv/finder";

import { getComponentStack, getOwnerComponentName } from "./react-fiber.ts";

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

const STYLE_PROPS = [
  "display", "position", "boxSizing", "width", "height", "padding", "margin", "gap",
  "flexDirection", "justifyContent", "alignItems", "flexWrap",
  "gridTemplateColumns", "gridTemplateRows",
  "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign",
  "fontFamily", "textTransform", "whiteSpace",
  "color", "backgroundColor", "backgroundImage", "opacity",
  "borderRadius", "borderWidth", "borderStyle", "borderColor", "boxShadow", "outline",
  "transform", "transition", "overflow", "zIndex", "cursor",
] as const;

const SKIP_VALUES = new Set(["none", "normal", "auto", "0px", "0s", "rgba(0, 0, 0, 0)"]);

function captureStyles(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = cs.getPropertyValue(camelToKebab(prop)).trim();
    if (value && !SKIP_VALUES.has(value)) out[prop] = value;
  }
  return out;
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Stable, readable selector — finder strips Tailwind utility noise for us. */
function buildSelector(el: Element): string {
  try {
    return finder(el, {
      idName: (name) => /^[a-zA-Z][\w-]{2,}$/.test(name) && !/^:r/.test(name),
      attr: (name) =>
        name === "data-testid" ||
        name === "data-test" ||
        name === "role" ||
        name === "aria-label" ||
        name === "name",
      className: (name) =>
        !/^[a-z]+-/.test(name) &&
        !/[:[\]/#.]/.test(name) &&
        !/^[A-Za-z0-9_-]{1,2}$/.test(name) &&
        !/_[A-Za-z0-9]{5,}$/.test(name),
      timeoutMs: 1000,
    });
  } catch {
    return el.tagName.toLowerCase();
  }
}

function accessibleName(el: Element): string | null {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  // Only short text reads as a "name"; long text is container noise (already in `text`).
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text && text.length <= 50 ? text : null;
}

export function buildElementPayload(el: Element): ElementPayload {
  const rect = el.getBoundingClientRect();
  // data-source is only present if the optional Babel plugin is enabled.
  const sourceEl = el.closest("[data-source]");
  return {
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    component: getOwnerComponentName(el),
    componentStack: getComponentStack(el),
    source: sourceEl?.getAttribute("data-source") ?? null,
    role: el.getAttribute("role"),
    accessibleName: accessibleName(el),
    text: (el.textContent ?? "").trim(),
    styles: captureStyles(el),
    box: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
    html: el.outerHTML,
  };
}
