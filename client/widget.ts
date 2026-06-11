/**
 * claude-tmux-bridge browser widget.
 * Injected via <script src="http://localhost:PORT/widget.js"> in development.
 * Select DOM elements, add context, and send to a Claude Code tmux pane.
 */

import { domToPng } from "modern-screenshot";

import { buildElementPayload, type ElementPayload } from "./capture.ts";
import { getDiagnostics, installDiagnostics } from "./diagnostics.ts";

interface PickedItem {
  element: Element;
  payload: ElementPayload;
}

interface SessionInfo {
  id: string;
  label: string;
  path: string;
}

interface Prefs {
  autoSend: boolean;
  shot: boolean;
  /** Pane id chosen in Settings, or null for auto-routing. Persisted per origin. */
  targetPane: string | null;
}

// Inline SVGs (no external assets — the widget is a single bundle).
const ICON_AI =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2l1.7 5.4 5.4 1.7-5.4 1.7L12 16.4l-1.7-5.4L4.9 9.3l5.4-1.7z"/><path d="M18.6 13.6l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

(function initWidget(): void {
  const ROOT_ID = "claude-tmux-bridge-root";

  // Origin of the bridge that served this script — works on any port, no build-time define.
  const loader = document.currentScript as HTMLScriptElement | null;
  const BRIDGE_ORIGIN = loader?.src ? new URL(loader.src).origin : "http://localhost:7331";

  // Hook console/fetch/error before the app code runs (extension injects at
  // document_start), and before the double-injection guard below.
  installDiagnostics(BRIDGE_ORIGIN);

  if (document.getElementById(ROOT_ID)) return;

  const host = document.createElement("div");
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
      .hidden { display: none !important; }

      /* Launcher: two always-visible buttons, no menu to open. */
      .fab {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
        width: 52px; height: 52px; border-radius: 50%;
        background: #d97757; color: #fff; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
        transition: background .15s, transform .15s;
      }
      .fab:hover { transform: scale(1.06); }
      .fab.armed { background: #1a1a1a; }
      .fab svg { width: 24px; height: 24px; display: block; }
      .gear {
        position: fixed; right: 27px; bottom: 78px; z-index: 2147483646;
        width: 30px; height: 30px; border-radius: 50%;
        background: #2a2a2a; color: #cfcfcf; border: 1px solid #3a3a3a; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 3px 10px rgba(0,0,0,.3);
        transition: background .12s, transform .12s, color .12s;
      }
      .gear:hover { background: #353535; color: #f5b78f; transform: scale(1.08); }
      .gear svg { width: 16px; height: 16px; display: block; }

      .overlay {
        position: fixed; z-index: 2147483645; pointer-events: none;
        border: 2px solid #d97757; background: rgba(217,119,87,.12);
        border-radius: 3px; display: none;
      }

      .panel, .settings {
        position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
        width: 360px; max-height: 80vh; overflow-y: auto;
        background: #1a1a1a; color: #f5f5f5; border-radius: 14px;
        padding: 16px; box-shadow: 0 10px 34px rgba(0,0,0,.45); display: none;
      }
      .panel.open, .settings.open { display: block; }

      .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .head .title { font-size: 13px; font-weight: 700; color: #f5b78f; }
      .head .x { border: none; background: none; color: #999; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
      .head .x:hover { color: #fff; }

      .dest { font-size: 11px; margin-bottom: 10px; color: #8a8a8a; display: flex; align-items: center; gap: 5px; }
      .dest.ok { color: #6ee7a8; }
      .dest.err { color: #ff8a8a; }
      .dest.pin { color: #f5b78f; }

      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .chip {
        display: inline-flex; align-items: center; gap: 4px;
        background: #2a2a2a; border-radius: 6px; padding: 3px 6px; font-size: 11px; color: #ddd;
      }
      .chip button { border: none; background: none; color: #ff8a8a; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }

      .picked {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        background: #141414; border: 1px solid #2e2e2e; border-radius: 8px;
        padding: 8px 10px; margin-bottom: 10px;
      }
      .picked .name { font-size: 13px; font-weight: 700; color: #f5b78f; }
      .picked .meta { font-size: 11px; color: #9a9a9a; margin-top: 2px; word-break: break-all; }
      .picked .nav { display: flex; gap: 2px; flex-shrink: 0; }
      .picked .nav button {
        border: none; background: transparent; color: #9a9a9a; cursor: pointer;
        font-size: 11px; padding: 4px 7px; border-radius: 6px;
      }
      .picked .nav button:hover { background: #2a2a2a; color: #f5b78f; }

      textarea {
        width: 100%; min-height: 76px; resize: vertical; border-radius: 10px;
        border: 1px solid #3a3a3a; background: #0f0f0f; color: #f5f5f5;
        padding: 10px; font-size: 13px; outline: none;
      }
      textarea:focus { border-color: #d97757; }

      .row { display: flex; gap: 8px; margin-top: 10px; }
      .row .send { flex: 1; }
      button.send {
        border: none; border-radius: 10px; padding: 11px; font-size: 13px; font-weight: 700;
        background: #d97757; color: #fff; cursor: pointer;
      }
      button.send:hover { background: #c8693f; }
      button.send:disabled { opacity: .5; cursor: default; }
      button.ghost {
        border: 1px solid #3a3a3a; border-radius: 10px; padding: 11px 14px; font-size: 13px;
        background: transparent; color: #bbb; cursor: pointer;
      }
      button.ghost:hover { background: #242424; color: #fff; }

      .status { font-size: 12px; margin-top: 8px; min-height: 16px; }
      .status.ok { color: #6ee7a8; }
      .status.err { color: #ff8a8a; }

      .field { margin-bottom: 14px; }
      .field > label { display: block; font-size: 11px; color: #9a9a9a; margin-bottom: 6px; }
      select {
        width: 100%; border-radius: 10px; border: 1px solid #3a3a3a;
        background: #0f0f0f; color: #f5f5f5; padding: 10px; font-size: 13px; outline: none;
      }
      select:focus { border-color: #d97757; }
      .field .refresh {
        margin-top: 6px; border: none; background: none; color: #777;
        font-size: 11px; cursor: pointer; padding: 0;
      }
      .field .refresh:hover { color: #aaa; }
      .toggles { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: #ddd; }
      .toggles label { display: flex; align-items: center; gap: 9px; cursor: pointer; }
      .toggles .hint { color: #777; font-size: 11px; margin-left: auto; }
    </style>

    <button class="gear" title="Settings"></button>
    <button class="fab" title="Select an element (Alt+C)"></button>
    <div class="overlay"></div>

    <div class="panel">
      <div class="head">
        <span class="title">Send to Claude</span>
        <button class="x close-panel" title="Close">✕</button>
      </div>
      <div class="dest"></div>
      <div class="chips"></div>
      <div class="picked" hidden>
        <div>
          <div class="name"></div>
          <div class="meta"></div>
        </div>
        <div class="nav">
          <button class="parent" title="Select parent element">↑</button>
          <button class="child" title="Select child element">↓</button>
          <button class="add" title="Keep this and pick another">+ add</button>
        </div>
      </div>
      <textarea placeholder="Describe the change you want…"></textarea>
      <div class="row">
        <button class="send">Send to Claude</button>
      </div>
      <div class="status"></div>
    </div>

    <div class="settings">
      <div class="head">
        <span class="title">Settings</span>
        <button class="x close-settings" title="Close">✕</button>
      </div>
      <div class="field">
        <label>Target session</label>
        <select class="session"></select>
        <button class="refresh">↻ Refresh sessions</button>
      </div>
      <div class="field">
        <label>Defaults</label>
        <div class="toggles">
          <label title="Send immediately. Off = paste into Claude's prompt so you can review/edit before sending.">
            <input type="checkbox" class="autosend"> auto-send
            <span class="hint">off: paste only</span>
          </label>
          <label title="Attach a PNG of the selected element so Claude can see how it renders.">
            <input type="checkbox" class="shot"> screenshot
            <span class="hint">📷 attach PNG</span>
          </label>
        </div>
      </div>
    </div>
  `;

  const q = <T extends Element>(sel: string): T => shadow.querySelector(sel) as T;
  const fab = q<HTMLButtonElement>(".fab");
  const gear = q<HTMLButtonElement>(".gear");
  const overlay = q<HTMLDivElement>(".overlay");
  const panel = q<HTMLDivElement>(".panel");
  const settings = q<HTMLDivElement>(".settings");
  const chips = q<HTMLDivElement>(".chips");
  const pickedBox = q<HTMLDivElement>(".picked");
  const nameEl = q<HTMLDivElement>(".name");
  const metaEl = q<HTMLDivElement>(".meta");
  const textarea = q<HTMLTextAreaElement>("textarea");
  const autosend = q<HTMLInputElement>(".autosend");
  const shot = q<HTMLInputElement>(".shot");
  const sessionSelect = q<HTMLSelectElement>(".session");
  const sendBtn = q<HTMLButtonElement>(".send");
  const status = q<HTMLDivElement>(".status");
  const dest = q<HTMLDivElement>(".dest");

  fab.innerHTML = ICON_AI;
  gear.innerHTML = ICON_GEAR;

  const PREFS_KEY = "ctb-prefs";
  const prefs: Prefs = { autoSend: true, shot: false, targetPane: null };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    if (typeof saved.autoSend === "boolean") prefs.autoSend = saved.autoSend;
    if (typeof saved.shot === "boolean") prefs.shot = saved.shot;
    if (typeof saved.targetPane === "string") prefs.targetPane = saved.targetPane;
  } catch {
    /* ignore */
  }
  autosend.checked = prefs.autoSend;
  shot.checked = prefs.shot;

  const savePrefs = (): void => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  };

  let sessions: SessionInfo[] = [];

  async function loadSessions(): Promise<void> {
    try {
      const r = await fetch(`${BRIDGE_ORIGIN}/sessions`);
      const d = (await r.json()) as { ok: boolean; sessions?: SessionInfo[] };
      sessions = d.sessions ?? [];
    } catch {
      sessions = [];
    }
    renderSessionOptions();
  }

  function renderSessionOptions(): void {
    sessionSelect.replaceChildren();
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto (detect)";
    sessionSelect.append(auto);
    for (const s of sessions) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sessionSelect.append(opt);
    }
    // Restore the saved choice; if its pane is gone, fall back to Auto visually.
    sessionSelect.value = prefs.targetPane ?? "";
    if (sessionSelect.value !== (prefs.targetPane ?? "")) sessionSelect.value = "";
  }

  async function updateDest(): Promise<void> {
    if (prefs.targetPane) {
      const s = sessions.find((x) => x.id === prefs.targetPane);
      dest.textContent = `→ ${s ? s.label : `pane ${prefs.targetPane}`} (pinned)`;
      dest.className = "dest pin";
      return;
    }
    dest.textContent = "resolving…";
    dest.className = "dest";
    try {
      const r = await fetch(`${BRIDGE_ORIGIN}/resolve?url=${encodeURIComponent(location.href)}`);
      const d = (await r.json()) as { ok: boolean; project?: string };
      dest.textContent = d.ok ? `→ ${d.project}` : "→ no Claude pane for this project";
      dest.className = d.ok ? "dest ok" : "dest err";
    } catch {
      dest.textContent = "→ bridge offline";
      dest.className = "dest err";
    }
  }

  // ── State machine: idle ↔ selecting ↔ composing / settings ───────────────
  let selecting = false;
  let focused: Element | null = null;
  const picked: PickedItem[] = [];

  const isOwn = (node: EventTarget | null): boolean =>
    node instanceof Node && host.contains(node);

  function showLauncher(withGear: boolean): void {
    fab.classList.remove("hidden");
    gear.classList.toggle("hidden", !withGear);
  }

  function hideLauncher(): void {
    fab.classList.add("hidden");
    gear.classList.add("hidden");
  }

  /** Return to the resting state: launcher visible, nothing selected/open. */
  function goIdle(): void {
    selecting = false;
    fab.innerHTML = ICON_AI;
    fab.classList.remove("armed");
    fab.title = "Select an element (Alt+C)";
    panel.classList.remove("open");
    settings.classList.remove("open");
    drawOverlay(null);
    showLauncher(true);
  }

  function startSelect(): void {
    selecting = true;
    fab.innerHTML = ICON_CLOSE;
    fab.classList.add("armed");
    fab.title = "Esc to cancel";
    panel.classList.remove("open");
    settings.classList.remove("open");
    showLauncher(false); // keep the FAB (now a cancel button), hide the gear
  }

  function openPanel(): void {
    selecting = false;
    settings.classList.remove("open");
    hideLauncher();
    panel.classList.add("open");
  }

  function openSettings(): void {
    panel.classList.remove("open");
    hideLauncher();
    settings.classList.add("open");
    void loadSessions();
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
    setFocused(el);
    openPanel();
    setStatus("", "");
    void updateDest();
    textarea.focus();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      goIdle();
      return;
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
    pickedBox.hidden = false;
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
      pickedBox.hidden = true;
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
      const res = await fetch(`${BRIDGE_ORIGIN}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          url: location.href,
          elements,
          screenshot,
          autoSubmit: autosend.checked,
          targetPane: prefs.targetPane,
          diagnostics: getDiagnostics(),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus("Sent to Claude.", "ok");
        textarea.value = "";
        picked.length = 0;
        focused = null;
        renderChips();
        pickedBox.hidden = true;
        setTimeout(goIdle, 800);
      } else {
        setStatus(data.error ?? "Failed.", "err");
      }
    } catch {
      setStatus(`Bridge not reachable at ${BRIDGE_ORIGIN}.`, "err");
    } finally {
      sendBtn.disabled = false;
    }
  }

  function setStatus(text: string, kind: "ok" | "err" | ""): void {
    status.textContent = text;
    status.className = `status ${kind}`.trim();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  // FAB has exactly one meaning: select, or cancel while selecting.
  fab.addEventListener("click", () => (selecting ? goIdle() : startSelect()));
  gear.addEventListener("click", openSettings);
  q<HTMLButtonElement>(".close-panel").addEventListener("click", goIdle);
  q<HTMLButtonElement>(".close-settings").addEventListener("click", goIdle);
  q<HTMLButtonElement>(".refresh").addEventListener("click", () => void loadSessions());
  q<HTMLButtonElement>(".parent").addEventListener("click", focusParent);
  q<HTMLButtonElement>(".child").addEventListener("click", focusChild);
  q<HTMLButtonElement>(".add").addEventListener("click", addAnother);
  sendBtn.addEventListener("click", () => void send());
  autosend.addEventListener("change", () => {
    prefs.autoSend = autosend.checked;
    savePrefs();
  });
  shot.addEventListener("change", () => {
    prefs.shot = shot.checked;
    savePrefs();
  });
  sessionSelect.addEventListener("change", () => {
    prefs.targetPane = sessionSelect.value || null;
    savePrefs();
    if (panel.classList.contains("open")) void updateDest();
  });
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", () => focused && drawOverlay(focused), true);

  void loadSessions();
  console.info("[claude-tmux-bridge] widget ready — Alt+C or the button to select an element.");
})();
