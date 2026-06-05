/**
 * claude-tmux-bridge browser widget.
 * Injected via <script src="http://localhost:PORT/widget.js"> in development.
 * Select DOM elements, add context, and send to a Claude Code tmux pane.
 */

import { domToPng } from "modern-screenshot";

import { buildElementPayload, type ElementPayload } from "./capture.ts";

declare const __BRIDGE_ORIGIN__: string;

interface PickedItem {
  element: Element;
  payload: ElementPayload;
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
        width: 360px; max-height: 80vh; overflow-y: auto;
        background: #1a1a1a; color: #f5f5f5; border-radius: 12px;
        padding: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.4); display: none;
      }
      .panel.open { display: block; }
      .focused { border: 1px solid #3a3a3a; border-radius: 8px; padding: 8px; margin-bottom: 10px; }
      .focused .name { font-size: 13px; font-weight: 700; color: #f5b78f; }
      .focused .meta { font-size: 11px; color: #b9b9b9; margin-top: 2px; word-break: break-all; }
      .nav { display: flex; gap: 6px; margin-top: 8px; }
      .nav button {
        flex: 1; border: 1px solid #3a3a3a; background: #0f0f0f; color: #ddd;
        border-radius: 6px; padding: 5px; font-size: 11px; cursor: pointer;
      }
      .nav .add { background: #2a2a2a; color: #f5b78f; border-color: #4a3a30; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .chip {
        display: inline-flex; align-items: center; gap: 4px;
        background: #2a2a2a; border-radius: 6px; padding: 3px 6px; font-size: 11px; color: #ddd;
      }
      .chip button { border: none; background: none; color: #ff8a8a; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
      textarea {
        width: 100%; min-height: 64px; resize: vertical; border-radius: 8px;
        border: 1px solid #3a3a3a; background: #0f0f0f; color: #f5f5f5;
        padding: 8px; font-size: 13px; outline: none;
      }
      textarea:focus { border-color: #d97757; }
      .toggles { display: flex; gap: 14px; margin: 8px 0; font-size: 12px; color: #ccc; }
      .toggles label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
      .row { display: flex; gap: 8px; margin-top: 4px; }
      .row button { flex: 1; border: none; border-radius: 8px; padding: 9px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .send { background: #d97757; color: #fff; }
      .send:disabled { opacity: .5; cursor: default; }
      .cancel { background: #2a2a2a; color: #ddd; }
      .status { font-size: 12px; margin-top: 8px; min-height: 16px; }
      .status.ok { color: #6ee7a8; }
      .status.err { color: #ff8a8a; }
      .dest { font-size: 11px; margin-bottom: 8px; color: #8a8a8a; }
      .dest.ok { color: #6ee7a8; }
      .dest.err { color: #ff8a8a; }
    </style>
    <button class="fab">◎ Select → Claude</button>
    <div class="overlay"></div>
    <div class="panel">
      <div class="dest"></div>
      <div class="chips"></div>
      <div class="focused" hidden>
        <div class="name"></div>
        <div class="meta"></div>
        <div class="nav">
          <button class="parent">↑ parent</button>
          <button class="child">↓ child</button>
          <button class="add">+ add another</button>
        </div>
      </div>
      <textarea placeholder="Describe the change you want…"></textarea>
      <div class="toggles">
        <label title="Send immediately. Uncheck to paste into Claude's prompt so you can review/edit before sending."><input type="checkbox" class="autosend" checked> auto-send</label>
        <label title="Attach a PNG of the selected element so Claude can see how it renders."><input type="checkbox" class="shot"> 📷 screenshot</label>
      </div>
      <div class="row">
        <button class="cancel">Cancel</button>
        <button class="send">Send to Claude</button>
      </div>
      <div class="status"></div>
    </div>
  `;

  const q = <T extends Element>(sel: string): T => shadow.querySelector(sel) as T;
  const fab = q<HTMLButtonElement>(".fab");
  const overlay = q<HTMLDivElement>(".overlay");
  const panel = q<HTMLDivElement>(".panel");
  const chips = q<HTMLDivElement>(".chips");
  const focusedBox = q<HTMLDivElement>(".focused");
  const nameEl = q<HTMLDivElement>(".name");
  const metaEl = q<HTMLDivElement>(".meta");
  const textarea = q<HTMLTextAreaElement>("textarea");
  const autosend = q<HTMLInputElement>(".autosend");
  const shot = q<HTMLInputElement>(".shot");
  const sendBtn = q<HTMLButtonElement>(".send");
  const status = q<HTMLDivElement>(".status");
  const dest = q<HTMLDivElement>(".dest");

  const PREFS_KEY = "ctb-prefs";
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
      autoSend?: boolean;
      shot?: boolean;
    };
    if (typeof prefs.autoSend === "boolean") autosend.checked = prefs.autoSend;
    if (typeof prefs.shot === "boolean") shot.checked = prefs.shot;
  } catch {
    /* ignore */
  }
  const savePrefs = (): void => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ autoSend: autosend.checked, shot: shot.checked }),
      );
    } catch {
      /* ignore */
    }
  };

  async function updateDest(): Promise<void> {
    dest.textContent = "resolving…";
    dest.className = "dest";
    try {
      const r = await fetch(`${__BRIDGE_ORIGIN__}/resolve?url=${encodeURIComponent(location.href)}`);
      const d = (await r.json()) as { ok: boolean; project?: string };
      dest.textContent = d.ok ? `→ ${d.project}` : "→ no Claude pane for this project";
      dest.className = d.ok ? "dest ok" : "dest err";
    } catch {
      dest.textContent = "→ bridge offline";
      dest.className = "dest err";
    }
  }

  let selecting = false;
  let focused: Element | null = null;
  const picked: PickedItem[] = [];

  const isOwn = (node: EventTarget | null): boolean =>
    node instanceof Node && host.contains(node);

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
  }

  function drawOverlay(el: Element | null): void {
    if (!el) {
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

  function onMove(e: MouseEvent): void {
    if (!selecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    drawOverlay(el && !isOwn(el) ? el : null);
  }

  function onClick(e: MouseEvent): void {
    if (!selecting || isOwn(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOwn(el)) return;
    stopSelect();
    setFocused(el);
    panel.classList.add("open");
    setStatus("", "");
    void updateDest();
    textarea.focus();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      stopSelect();
      panel.classList.remove("open");
      drawOverlay(null);
    }
    // e.code is layout/modifier independent — on macOS Alt+C yields "ç" in e.key.
    if (e.altKey && e.code === "KeyC") {
      e.preventDefault();
      startSelect();
    }
  }

  function setFocused(el: Element): void {
    focused = el;
    const p = buildElementPayload(el);
    focusedBox.hidden = false;
    nameEl.textContent = p.component
      ? `<${p.component}>`
      : `${p.tag}${p.id ? `#${p.id}` : ""}`;
    metaEl.textContent =
      p.componentStack.length > 1 ? p.componentStack.join(" › ") : p.selector;
    drawOverlay(el);
  }

  function focusParent(): void {
    const parent = focused?.parentElement;
    if (parent && !isOwn(parent)) setFocused(parent);
  }

  function focusChild(): void {
    const child = focused?.firstElementChild;
    if (child && !isOwn(child)) setFocused(child);
  }

  function addAnother(): void {
    if (focused) {
      picked.push({ element: focused, payload: buildElementPayload(focused) });
      focused = null;
      focusedBox.hidden = true;
      renderChips();
    }
    startSelect();
  }

  function renderChips(): void {
    chips.replaceChildren();
    picked.forEach((item, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const label = item.payload.component ?? item.payload.tag;
      chip.append(label);
      const x = document.createElement("button");
      x.textContent = "✕";
      x.addEventListener("click", () => {
        picked.splice(i, 1);
        renderChips();
      });
      chip.append(x);
      chips.append(chip);
    });
  }

  async function send(): Promise<void> {
    const elements = [...picked.map((p) => p.payload)];
    if (focused) elements.push(buildElementPayload(focused));
    if (elements.length === 0) {
      setStatus("Select an element first.", "err");
      return;
    }
    const message = textarea.value.trim();
    if (!message) {
      setStatus("Write what you want changed.", "err");
      return;
    }

    sendBtn.disabled = true;
    setStatus("Sending…", "");

    let screenshot: string | null = null;
    const area = (el: Element): number => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    const shotCandidates = [...picked.map((p) => p.element), ...(focused ? [focused] : [])];
    const shotTarget = shotCandidates.reduce<Element | null>(
      (best, el) => (best && area(best) >= area(el) ? best : el),
      null,
    );
    if (shot.checked && shotTarget) {
      try {
        screenshot = await domToPng(shotTarget, { scale: 1, backgroundColor: "#ffffff" });
      } catch {
        screenshot = null;
      }
    }

    try {
      const res = await fetch(`${__BRIDGE_ORIGIN__}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          url: location.href,
          elements,
          screenshot,
          autoSubmit: autosend.checked,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus("Sent to Claude.", "ok");
        textarea.value = "";
        picked.length = 0;
        focused = null;
        renderChips();
        focusedBox.hidden = true;
        drawOverlay(null);
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
  q<HTMLButtonElement>(".parent").addEventListener("click", focusParent);
  q<HTMLButtonElement>(".child").addEventListener("click", focusChild);
  q<HTMLButtonElement>(".add").addEventListener("click", addAnother);
  q<HTMLButtonElement>(".cancel").addEventListener("click", () => {
    panel.classList.remove("open");
    drawOverlay(null);
  });
  sendBtn.addEventListener("click", () => void send());
  autosend.addEventListener("change", savePrefs);
  shot.addEventListener("change", savePrefs);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", () => focused && drawOverlay(focused), true);

  console.info("[claude-tmux-bridge] widget ready — Alt+C or the button to select an element.");
})();
