/**
 * claude-tmux-bridge browser widget.
 * Injected via <script src="http://localhost:PORT/widget.js"> in development.
 * Lets you pick a DOM element and send it, with a request, to a Claude Code tmux pane.
 */

// Replaced at serve time by esbuild `define`.
declare const __BRIDGE_ORIGIN__: string;

interface ElementPayload {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  html: string;
  source: string | null;
}

(function initWidget(): void {
  const ROOT_ID = "claude-tmux-bridge-root";
  if (document.getElementById(ROOT_ID)) return;

  const host = document.createElement("div");
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
      .fab {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
        background: #d97757; color: #fff; border: none; border-radius: 999px;
        padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
      }
      .fab.armed { background: #1a1a1a; }
      .overlay {
        position: fixed; z-index: 2147483645; pointer-events: none;
        border: 2px solid #d97757; background: rgba(217,119,87,.12);
        border-radius: 3px; display: none;
      }
      .panel {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
        width: 340px; background: #1a1a1a; color: #f5f5f5; border-radius: 12px;
        padding: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.4); display: none;
      }
      .panel.open { display: block; }
      .desc { font-size: 12px; color: #b9b9b9; margin: 0 0 8px; word-break: break-all; }
      .desc b { color: #f5f5f5; }
      textarea {
        width: 100%; min-height: 70px; resize: vertical; border-radius: 8px;
        border: 1px solid #3a3a3a; background: #0f0f0f; color: #f5f5f5;
        padding: 8px; font-size: 13px; outline: none;
      }
      textarea:focus { border-color: #d97757; }
      .row { display: flex; gap: 8px; margin-top: 10px; }
      .row button { flex: 1; border: none; border-radius: 8px; padding: 9px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .send { background: #d97757; color: #fff; }
      .send:disabled { opacity: .5; cursor: default; }
      .cancel { background: #2a2a2a; color: #ddd; }
      .status { font-size: 12px; margin-top: 8px; min-height: 16px; }
      .status.ok { color: #6ee7a8; }
      .status.err { color: #ff8a8a; }
    </style>
    <button class="fab" part="fab">◎ Select → Claude</button>
    <div class="overlay"></div>
    <div class="panel">
      <p class="desc"></p>
      <textarea placeholder="Describe the change you want…"></textarea>
      <div class="row">
        <button class="cancel">Cancel</button>
        <button class="send">Send to Claude</button>
      </div>
      <div class="status"></div>
    </div>
  `;

  const fab = shadow.querySelector(".fab") as HTMLButtonElement;
  const overlay = shadow.querySelector(".overlay") as HTMLDivElement;
  const panel = shadow.querySelector(".panel") as HTMLDivElement;
  const desc = shadow.querySelector(".desc") as HTMLParagraphElement;
  const textarea = shadow.querySelector("textarea") as HTMLTextAreaElement;
  const sendBtn = shadow.querySelector(".send") as HTMLButtonElement;
  const cancelBtn = shadow.querySelector(".cancel") as HTMLButtonElement;
  const status = shadow.querySelector(".status") as HTMLDivElement;

  let selecting = false;
  let picked: { element: Element; payload: ElementPayload } | null = null;

  function isOwn(node: EventTarget | null): boolean {
    return node instanceof Node && host.contains(node as Node);
  }

  function startSelect(): void {
    selecting = true;
    fab.classList.add("armed");
    fab.textContent = "Esc to cancel";
    panel.classList.remove("open");
  }

  function stopSelect(): void {
    selecting = false;
    fab.classList.remove("armed");
    fab.textContent = "◎ Select → Claude";
    overlay.style.display = "none";
  }

  function onMove(e: MouseEvent): void {
    if (!selecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOwn(el)) {
      overlay.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = `${r.left}px`;
    overlay.style.top = `${r.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  }

  function onClick(e: MouseEvent): void {
    if (!selecting || isOwn(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOwn(el)) return;
    pick(el);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      stopSelect();
      panel.classList.remove("open");
    }
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      startSelect();
    }
  }

  function pick(el: Element): void {
    stopSelect();
    const payload = buildPayload(el);
    picked = { element: el, payload };
    const idPart = payload.id ? `#${payload.id}` : "";
    const classPart = payload.classes.length ? `.${payload.classes.slice(0, 2).join(".")}` : "";
    desc.innerHTML = `<b>${payload.tag}${idPart}${classPart}</b>${
      payload.source ? `<br>${payload.source}` : ""
    }`;
    panel.classList.add("open");
    status.textContent = "";
    status.className = "status";
    textarea.focus();
  }

  async function send(): Promise<void> {
    if (!picked) return;
    const message = textarea.value.trim();
    if (!message) {
      setStatus("Write what you want changed.", "err");
      return;
    }
    sendBtn.disabled = true;
    setStatus("Sending…", "");
    try {
      const res = await fetch(`${__BRIDGE_ORIGIN__}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          url: location.href,
          element: picked.payload,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus("Sent to Claude.", "ok");
        textarea.value = "";
        setTimeout(() => panel.classList.remove("open"), 800);
      } else {
        setStatus(data.error ?? "Failed.", "err");
      }
    } catch {
      setStatus(`Bridge not reachable at ${__BRIDGE_ORIGIN__}.`, "err");
    } finally {
      sendBtn.disabled = false;
    }
  }

  function setStatus(text: string, kind: "ok" | "err" | ""): void {
    status.textContent = text;
    status.className = `status ${kind}`.trim();
  }

  fab.addEventListener("click", () => (selecting ? stopSelect() : startSelect()));
  cancelBtn.addEventListener("click", () => panel.classList.remove("open"));
  sendBtn.addEventListener("click", () => void send());
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);

  console.info("[claude-tmux-bridge] widget ready — Alt+C or the button to select an element.");
})();

function buildPayload(el: Element): ElementPayload {
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    text: (el.textContent ?? "").trim(),
    html: el.outerHTML,
    source: reactSource(el),
  };
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 6) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    let selector = node.tagName.toLowerCase();
    const cls = Array.from(node.classList).slice(0, 2);
    if (cls.length) selector += `.${cls.join(".")}`;
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) selector += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(selector);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}

/** Best-effort React source location from the dev fiber (`_debugSource`). */
function reactSource(el: Element): string | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  type Fiber = {
    _debugSource?: { fileName?: string; lineNumber?: number };
    return?: Fiber;
  };
  let fiber = (el as unknown as Record<string, Fiber>)[key];
  let hops = 0;
  while (fiber && hops < 10) {
    const src = fiber._debugSource;
    if (src?.fileName) {
      const file = src.fileName.replace(/^.*\/(src\/)/, "$1");
      return src.lineNumber ? `${file}:${src.lineNumber}` : file;
    }
    fiber = fiber.return as Fiber;
    hops += 1;
  }
  return null;
}
