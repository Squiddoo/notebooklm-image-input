(() => {
  "use strict";

  if (window.__nlmImageInput) return;
  window.__nlmImageInput = true;

  const MAX_FILES = 8;
  const MAX_IMAGE_EDGE = 2200;
  const MIN_OCR_EDGE = 1600;
  const CONTEXT_TOKENS = 1000000;
  const TOKENS_PER_WORD = 1.35;
  const DEFAULT_SETTINGS = { autoSend: false, maxChars: 3900 };
  const SEND_RE = /(^|\b)(send|submit|verzend|verstuur|versturen|invoeren)(\b|$)/i;
  const TEXT_EXT_RE = /\.(txt|md|markdown|csv|json|log|yml|yaml|xml|html?)$/i;

  const state = {
    pending: [],
    editable: null,
    busy: false,
    host: null,
    shadow: null,
    chips: null,
    addBtn: null,
    toast: null,
    meter: null,
    gear: null,
    panel: null,
    switchBtn: null,
    maxInput: null,
    fileInput: null,
    settings: { ...DEFAULT_SETTINGS },
    toastTimer: 0,
    maxCharsSaveTimer: null,
    raf: 0,
    lastProgress: -1
  };

  /* ---------- helpers ---------- */

  function isEditable(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", ""].includes(t) && !el.disabled && !el.readOnly;
    }
    return el.isContentEditable;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 8) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function eventTarget(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    return path.length ? path[0] : e.target;
  }

  function eventEditable(e) {
    const t = eventTarget(e);
    if (isEditable(t)) return t;
    if (isEditable(document.activeElement)) return document.activeElement;
    return null;
  }

  function deepQuery(selector, limit = 4000) {
    const out = [];
    let seen = 0;
    const walk = (root) => {
      root.querySelectorAll(selector).forEach((el) => out.push(el));
      root.querySelectorAll("*").forEach((el) => {
        if (seen++ > limit) return;
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    };
    walk(document);
    return out;
  }

  function detectDark() {
    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
    } catch {
      /* matchMedia not available */
    }
    const classes = [];
    if (document.documentElement) classes.push(document.documentElement.getAttribute("class") || "");
    if (document.body) classes.push(document.body.getAttribute("class") || "");
    const joined = classes.join(" ");
    return /(?:^|\s)(dark|theme-dark|mdc-theme-dark|dark-theme)(?:\s|$)/i.test(joined);
  }

  function applyTheme() {
    if (state.host) {
      state.host.style.colorScheme = detectDark() ? "dark" : "light";
    }
  }

  function composerBottomOk(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 40 && r.height >= 8 && r.bottom > window.innerHeight * 0.35;
  }

  function findComposer() {
    const active = document.activeElement;
    if (isEditable(active) && isVisible(active) && composerBottomOk(active)) {
      state.composerEl = active;
      state.editable = active;
      return active;
    }

    if (state.composerEl && composerBottomOk(state.composerEl)) {
      const okEditable =
        isEditable(state.composerEl) ||
        state.composerEl.tagName === "TEXTAREA" ||
        state.composerEl.tagName === "INPUT";
      if (okEditable) {
        state.editable = state.composerEl;
        return state.composerEl;
      }
    }

    let nodes = Array.from(
      document.querySelectorAll(
        'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input[type="search"]'
      )
    ).filter((el) => isEditable(el) && isVisible(el) && composerBottomOk(el));

    if (!nodes.length) {
      nodes = deepQuery(
        'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input[type="search"]'
      ).filter((el) => isEditable(el) && isVisible(el) && composerBottomOk(el));
    }

    if (!nodes.length) {
      state.composerEl = null;
      state.editable = null;
      return null;
    }

    nodes.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.bottom - ra.bottom || rb.width - ra.width;
    });

    state.composerEl = nodes[0];
    state.editable = nodes[0];
    return nodes[0];
  }

  function isSendButton(btn) {
    if (!(btn instanceof Element)) return false;
    const label = [
      btn.getAttribute("aria-label"),
      btn.getAttribute("title"),
      btn.getAttribute("data-testid"),
      btn.getAttribute("data-tooltip"),
      btn.textContent
    ]
      .filter(Boolean)
      .join(" ");
    if (SEND_RE.test(label)) return true;
    const icon = btn.querySelector("mat-icon, svg, i");
    const iconText = icon ? icon.textContent || "" : "";
    return /(^|[\s_-])(send|arrow_upward|arrow_forward|north)([\s_-]|$)/i.test(iconText);
  }

  function findSendButton(scope) {
    if (scope) {
      let node = scope;
      for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
        const btns = Array.from(node.querySelectorAll('button, [role="button"]')).filter(
          (b) => isVisible(b) && isSendButton(b)
        );
        if (btns.length) return btns[btns.length - 1];
      }
    }
    const all = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
      (b) => isVisible(b) && isSendButton(b)
    );
    return all.length ? all[all.length - 1] : null;
  }

  function isSupportedFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith("image/")) return true;
    return TEXT_EXT_RE.test(file.name || "");
  }

  function makeItem(file) {
    const isImage = !!file.type && file.type.startsWith("image/");
    return {
      id: Math.random().toString(36).slice(2),
      file,
      name: file.name || (isImage ? "screenshot.png" : "bestand.txt"),
      kind: isImage ? "image" : "text",
      url: isImage ? URL.createObjectURL(file) : null
    };
  }

  /* ---------- UI ---------- */

  function buildUi() {
    if (state.host && state.host.isConnected) return;

    const host = document.createElement("div");
    host.id = "nlm-image-input-host";
    const shadow = host.attachShadow({ mode: "open" });

    const css = `
      :host { all: initial; color-scheme: light dark; font-family: Roboto, 'Google Sans', system-ui, sans-serif; }
      .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
      .chips {
        position: fixed; display: none; align-items: center; gap: 6px;
        max-width: 60vw; overflow-x: auto; padding: 0;
        background: transparent; pointer-events: auto;
      }
      .chips.show { display: flex; }
      .chip {
        position: relative; width: 40px; height: 40px; flex: 0 0 auto;
        border-radius: 8px; overflow: hidden; background: Canvas;
        border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      }
      .chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .chip .ext {
        display: flex; width: 100%; height: 100%; align-items: center; justify-content: center;
        font: 600 10px/1 Roboto, 'Google Sans', system-ui, sans-serif; letter-spacing: .04em;
        color: color-mix(in srgb, CanvasText 60%, transparent);
      }
      .chip .x {
        position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; padding: 0;
        border: 0; border-radius: 50%; background: rgba(32,33,36,.72); color: #fff;
        font: 11px/1 system-ui, sans-serif; cursor: pointer;
      }
      .chip .x:hover { background: #d93025; }
      .icon-btn {
        position: fixed; display: none; width: 34px; height: 34px; padding: 0;
        align-items: center; justify-content: center; cursor: pointer;
        border: 0; border-radius: 50%; background: transparent;
        color: color-mix(in srgb, CanvasText 60%, transparent);
        pointer-events: auto;
      }
      .icon-btn.show { display: flex; }
      .icon-btn svg { display: block; width: 20px; height: 20px; }
      .icon-btn:hover {
        background: color-mix(in srgb, CanvasText 8%, transparent);
        color: CanvasText;
      }
      .icon-btn:active { background: color-mix(in srgb, CanvasText 12%, transparent); }
      .icon-btn.open { background: color-mix(in srgb, CanvasText 8%, transparent); color: CanvasText; }
      .add.drag { box-shadow: inset 0 0 0 2px #1a73e8; color: #1a73e8; }
      .panel {
        position: fixed; display: none; width: 260px; padding: 12px 14px;
        border-radius: 10px; background: Canvas; color: CanvasText;
        border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        box-shadow: 0 2px 10px rgba(0,0,0,.16); pointer-events: auto;
        font: 12.5px/1.4 Roboto, 'Google Sans', system-ui, sans-serif;
      }
      .panel.show { display: block; }
      .panel .row { display: flex; align-items: center; gap: 10px; }
      .panel .txt { flex: 1 1 auto; }
      .panel .txt strong { display: block; font-weight: 600; font-size: 12px; }
      .panel .txt span {
        display: block; margin-top: 2px; font-size: 11px;
        color: color-mix(in srgb, CanvasText 62%, transparent);
      }
      .panel .hint {
        margin-top: 8px; padding-top: 8px; font-size: 11px;
        color: color-mix(in srgb, CanvasText 62%, transparent);
        border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
      }
      .switch {
        position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 0;
        border: 0; border-radius: 999px; cursor: pointer;
        background: color-mix(in srgb, CanvasText 18%, Canvas);
      }
      .switch span {
        position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: Canvas;
        box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s;
      }
      .switch.on { background: #1a73e8; }
      .switch.on span { transform: translateX(16px); background: #fff; }
      .toast {
        position: fixed; display: none; max-width: 60vw; padding: 8px 14px; border-radius: 8px;
        background: #303134; color: #e8eaed; pointer-events: none;
        font: 12.5px/1.35 Roboto, 'Google Sans', system-ui, sans-serif;
        box-shadow: 0 4px 10px rgba(0,0,0,.28);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .toast.show { display: block; }
      .meter {
        position: fixed; display: none; max-width: 65vw; padding: 3px 8px; border-radius: 999px;
        background: Canvas; color: CanvasText;
        border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
        font: 11px/1.4 Roboto, 'Google Sans', system-ui, sans-serif;
        font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
      }
      .meter.show { display: block; }
      .meter.warn { color: #b06000; border-color: #b0600055; }
      .meter.danger { color: #b3261e; border-color: #b3261e66; }
      .file { display: none; }
    `;

    const layer = document.createElement("div");
    layer.className = "layer";

    const chips = document.createElement("div");
    chips.className = "chips";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "icon-btn add";
    addBtn.title = "Add image or file";
    addBtn.setAttribute("aria-label", "Add image or file");
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "icon-btn gear";
    gear.title = "Settings";
    gear.setAttribute("aria-label", "Settings");
    gear.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">' +
      '<path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7z' +
      'm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>';

    const toast = document.createElement("div");
    toast.className = "toast";

    const meter = document.createElement("div");
    meter.className = "meter";

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="row">
        <div class="txt">
          <strong>Send automatically after OCR</strong>
          <span>On: submits right after OCR</span>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="false"
          aria-label="Send automatically after OCR"><span></span></button>
      </div>
      <div class="row">
        <div class="txt">
          <strong>Max input characters</strong>
          <span>Adjust to your input field's character limit.</span>
        </div>
        <input class="max-input" type="number" min="100" step="100" value="4096" style="width:70px">
      </div>
      <div class="hint">The counter stays accurate when this matches the input's limit.</div>
    `;
    const switchBtn = panel.querySelector(".switch");
    const maxInput = panel.querySelector(".max-input");
    maxInput.value = state.settings.maxChars;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "file";
    fileInput.multiple = true;
    fileInput.accept = "image/*,.txt,.md,.markdown,.csv,.json,.log,.yml,.yaml,.xml,.html";

    layer.append(chips, addBtn, gear, meter, toast, panel, fileInput);

    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
      styled = true;
    } catch {
      /* fall through to a style element */
    }
    if (!styled) {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    }
    shadow.appendChild(layer);
    document.documentElement.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.chips = chips;
    state.addBtn = addBtn;
    state.toast = toast;
    state.meter = meter;
    state.gear = gear;
    state.panel = panel;
    state.switchBtn = switchBtn;
    state.maxInput = maxInput;
    state.fileInput = fileInput;

    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      addFiles(Array.from(fileInput.files || []));
      fileInput.value = "";
    });

    chips.addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest(".x") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      removeItem(btn.getAttribute("data-id"));
    });

    gear.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = panel.classList.toggle("show");
      gear.classList.toggle("open", open);
      scheduleLayout();
    });

    switchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.settings.autoSend = !state.settings.autoSend;
      applySwitch();
      saveSettings();
    });

    maxInput.addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) {
        state.settings.maxChars = v;
        applyMaxInput();
        saveSettings();
      }
    });
  }

  function renderChips() {
    if (!state.chips) return;
    state.chips.textContent = "";

    for (const item of state.pending) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.title = item.name;

      if (item.kind === "image" && item.url) {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.name;
        chip.appendChild(img);
      } else {
        const ext = document.createElement("div");
        ext.className = "ext";
        ext.textContent = (item.name.split(".").pop() || "TXT").toUpperCase().slice(0, 4);
        chip.appendChild(ext);
      }

      const x = document.createElement("button");
      x.type = "button";
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove";
      x.setAttribute("data-id", item.id);
      chip.appendChild(x);

      state.chips.appendChild(chip);
    }

    state.chips.classList.toggle("show", state.pending.length > 0);
  }

  function setToast(text, ms = 2500) {
    if (!state.toast) return;
    clearTimeout(state.toastTimer);
    state.toast.textContent = text;
    state.toast.classList.add("show");
    if (ms > 0) {
      state.toastTimer = setTimeout(() => state.toast.classList.remove("show"), ms);
    }
  }

  function layout() {
    state.raf = 0;
    buildUi();

    const el = findComposer();
    if (!el) {
      state.addBtn.classList.remove("show");
      state.gear.classList.remove("show");
      state.panel.classList.remove("show");
      state.toast.classList.remove("show");
      state.meter.classList.remove("show");
      return;
    }

    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const px = (n) => Math.max(4, Math.min(n, vw - 34));
    const py = (n) => Math.max(4, Math.min(n, vh - 34));

    const sideRoom = r.left >= 96;
    const btnTop = Math.max(4, Math.min(sideRoom ? r.top + (r.height - 34) / 2 : r.top - 38, vh - 34));

    state.addBtn.classList.add("show");
    state.gear.classList.add("show");
    state.addBtn.style.top = btnTop + "px";
    state.gear.style.top = btnTop + "px";
    state.addBtn.style.left = px(sideRoom ? r.left - 42 : r.left + 2) + "px";
    state.gear.style.left = px(sideRoom ? r.left - 80 : r.left + 40) + "px";

    if (state.panel.classList.contains("show")) {
      state.panel.style.left = Math.max(8, Math.min(r.left - 248, vw - 268)) + "px";
      state.panel.style.top = Math.max(8, btnTop - 108) + "px";
    }

    state.chips.style.left = px(r.left) + "px";
    state.chips.style.top = py(r.top - 58) + "px";

    state.toast.style.left = px(r.left) + "px";
    state.toast.style.top = py(r.top - 96) + "px";

    state.meter.style.left = "auto";
    state.meter.style.right = Math.max(4, vw - r.right) + "px";
    state.meter.style.top = py(r.top - 28) + "px";
    updateMeter(el);
  }

  function scheduleLayout() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(layout);
  }

  /* ---------- pending files ---------- */

  function addFiles(files) {
    const accepted = files.filter(isSupportedFile);
    if (!accepted.length) {
      setToast("Only images or text files");
      return;
    }

    for (const file of accepted) {
      if (state.pending.length >= MAX_FILES) {
        setToast("Max 8 files");
        break;
      }
      state.pending.push(makeItem(file));
    }

    renderChips();
    scheduleLayout();
    setToast(
      state.pending.length === 1
        ? "1 file ready — press Enter to send"
        : `${state.pending.length} files ready — press Enter to send`,
      2200
    );
  }

  function removeItem(id) {
    const idx = state.pending.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = state.pending.splice(idx, 1);
    if (item.url) URL.revokeObjectURL(item.url);
    renderChips();
    scheduleLayout();
  }

  function clearPending() {
    for (const item of state.pending) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    state.pending = [];
    renderChips();
    scheduleLayout();
  }

  /* ---------- settings ---------- */

  function applySwitch() {
    if (!state.switchBtn) return;
    const on = !!state.settings.autoSend;
    state.switchBtn.classList.toggle("on", on);
    state.switchBtn.setAttribute("aria-checked", String(on));
  }

  function applyMaxInput() {
    if (!state.maxInput) return;
    state.maxInput.value = String(state.settings.maxChars);
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
      state.settings = { ...DEFAULT_SETTINGS, ...stored };
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    applySwitch();
    applyMaxInput();
  }

  function debouncedSaveMaxChars() {
    if (state.maxCharsSaveTimer) clearTimeout(state.maxCharsSaveTimer);
    state.maxCharsSaveTimer = setTimeout(() => {
      state.maxCharsSaveTimer = null;
      saveSettings();
    }, 1500);
  }

  function attemptRaiseMaxChars(el, claimedLen) {
    if (!el || claimedLen <= state.settings.maxChars) return;
    const previous = state.settings.maxChars;
    if (state.sendConfirmTimer) clearTimeout(state.sendConfirmTimer);
    state.settings.maxChars = claimedLen;
    applyMaxInput();
    state.sendConfirmTimer = setTimeout(() => {
      state.sendConfirmTimer = null;
      const now = composerText(el).length;
      const cleared = now === 0 || now <= Math.max(1, previous * 0.5);
      if (!cleared) {
        state.settings.maxChars = previous;
        applyMaxInput();
      }
      saveSettings();
    }, 1000);
  }
  function saveSettings() {
    try {
      chrome.storage.local.set({ autoSend: !!state.settings.autoSend, maxChars: state.settings.maxChars });
    } catch {
      /* storage unavailable */
    }
  }

  /* ---------- OCR ---------- */

  function imageToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const max = MAX_IMAGE_EDGE;
          const dim = Math.max(img.naturalWidth, img.naturalHeight);
          const scale = dim < MIN_OCR_EDGE ? MIN_OCR_EDGE / dim : Math.min(1, max / dim);
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          resolve(binarizeCanvas(canvas));
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image could not be read"));
      };
      img.src = url;
    });
  }

  function scoreText(text) {
    return ((text || "").match(/[A-Za-z0-9]{2,}/g) || []).length;
  }

  function stripReactionPills(text) {
    return (text || "")
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (!t) return false;
        if (/^[\W_]{0,4}\d{1,4}[\W_]{0,4}$/.test(t)) return false; // reaction pills like "❤️ 1"
        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function processCanvas(canvas, mode) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    if (mode === "gray") {
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = g;
        d[i + 1] = g;
        d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL("image/png");
    }

    let dark = 0;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (g < 128) dark++;
      else bright++;
    }
    const invert = dark > bright;

    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (invert) g = 255 - g;
      const v = g < 160 ? 0 : 255;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function imageCanvas(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const dim = Math.max(img.naturalWidth, img.naturalHeight);
          const scale = dim < MIN_OCR_EDGE ? MIN_OCR_EDGE / dim : Math.min(1, MAX_IMAGE_EDGE / dim);
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Image could not be read"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function recognize(dataUrl, psm) {
    return chrome.runtime.sendMessage({ type: "ocr", dataUrl, psm });
  }

  async function ocrImage(file) {
    const canvas = await imageCanvas(file);

    const candidates = [];
    for (const psm of ["6", "11"]) {
      const rb = await recognize(processCanvas(canvas, "binary"), psm);
      const tb = (rb && rb.ok && rb.text) || "";
      candidates.push({ text: stripReactionPills(tb), score: scoreText(tb) });

      const rg = await recognize(processCanvas(canvas, "gray"), psm);
      const tg = (rg && rg.ok && rg.text) || "";
      candidates.push({ text: stripReactionPills(tg), score: scoreText(tg) });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || !best.text) throw new Error("OCR returned no text");
    return best.text;
  }

  async function readItem(item) {
    if (item.kind === "text") return item.file.text();
    return ocrImage(item.file);
  }

  function formatBlock(item, text, index) {
    const kind = item.kind === "image" ? "Image" : "File";
    const label = `[${kind} ${index}: ${item.name}]`;
    const body = (text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return body ? `${label}\n${body}` : `${label} (no text recognized)`;
  }

  function insertInto(el, text) {
    const block = (text || "").trim();
    if (!block) return;
    el.focus({ preventScroll: true });

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const current = el.value || "";
      const sep = current && !/\s$/.test(current) ? "\n\n" : "";
      const next = current + sep + block;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        el.setSelectionRange(next.length, next.length);
      } catch {
        /* some inputs disallow selection */
      }
      return;
    }

    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const existing = (el.innerText || "").trim();
    document.execCommand("insertText", false, (existing ? "\n\n" : "") + block);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function submitPending(target) {
    if (state.busy || !state.pending.length) return;

    const items = state.pending.slice();
    state.busy = true;
    state.lastProgress = -1;
    buildUi();

    try {
      const blocks = [];
      for (let i = 0; i < items.length; i++) {
        setToast(`OCR ${i + 1}/${items.length}…`, 0);
        const text = await readItem(items[i]);
        blocks.push(formatBlock(items[i], text, i + 1));
      }

      insertInto(target, blocks.join("\n\n"));
      clearPending();

      if (!state.settings.autoSend) {
        setToast("Inserted as text — press Enter to send", 3500);
        return;
      }

      setToast("Inserted as text", 1800);

      setTimeout(() => {
        const btn = findSendButton(target);
        if (btn) {
          btn.click();
        } else {
          setToast("Text inserted — press send", 4000);
        }
      }, 120);
    } catch (err) {
      setToast("OCR failed: " + ((err && err.message) || err), 5000);
    } finally {
      state.busy = false;
    }
  }

  /* ---------- text / token counting ---------- */

  function composerText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return el.innerText || "";
  }

  function countWords(text) {
    const m = text.match(/\S+/g);
    return m ? m.length : 0;
  }

  function estimateTokens(text, words) {
    return Math.max(Math.ceil(words * TOKENS_PER_WORD), Math.ceil(text.length / 4));
  }

  function formatTokens(n) {
    if (n >= 1e6) {
      return (n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "M";
    }
    if (n >= 1e3) {
      return (n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "k";
    }
    return String(n);
  }

  function updateMeter(el) {
    if (!state.meter) return;
    const text = composerText(el);
    if (!text.trim()) {
      state.meter.classList.remove("show", "warn", "danger");
      return;
    }

    const words = countWords(text);
      const chars = text.length;
    const maxChars = (el && el.maxLength > 0 ? el.maxLength : state.settings.maxChars);
    const tokens = estimateTokens(text, words);
    const remainingChars = Math.max(0, maxChars - chars);
    const remainingTokens = Math.max(0, CONTEXT_TOKENS - tokens);
    const remainingWords = Math.floor(remainingTokens / TOKENS_PER_WORD);

    state.meter.textContent =
      chars.toLocaleString("en-US") +
      " / " +
      maxChars.toLocaleString("en-US") +
      " chars · ~" +
      formatTokens(tokens) +
      " tokens · " +
      remainingChars.toLocaleString("en-US") +
      " left";
    state.meter.classList.add("show");

    const lowChars = remainingChars < maxChars * 0.1;
    state.meter.classList.toggle("warn", lowChars || remainingTokens < CONTEXT_TOKENS * 0.1);
    state.meter.classList.toggle("danger", remainingChars === 0 || remainingTokens < CONTEXT_TOKENS * 0.02);
  }

  /* ---------- events ---------- */

  document.addEventListener(
    "paste",
    (e) => {
      const el = eventEditable(e);
      if (!el) return;
      const dt = e.clipboardData;
      if (!dt) return;

      let files = Array.from(dt.files || []).filter(isSupportedFile);
      if (!files.length) {
        files = Array.from(dt.items || [])
          .filter((it) => it.kind === "file")
          .map((it) => it.getAsFile())
          .filter((f) => isSupportedFile(f));
      }
      if (!files.length) return;

      e.preventDefault();
      e.stopPropagation();
      state.editable = el;
      addFiles(files);
      scheduleLayout();
    },
    true
  );

  document.addEventListener(
    "dragover",
    (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = Array.from(dt.types || []);
      if (!types.includes("Files")) return;
      if (!findComposer()) return;
      e.preventDefault();
      dt.dropEffect = "copy";
      if (state.addBtn) state.addBtn.classList.add("drag");
      scheduleLayout();
    },
    true
  );

  document.addEventListener(
    "dragleave",
    () => {
      if (state.addBtn) state.addBtn.classList.remove("drag");
    },
    true
  );

  document.addEventListener(
    "drop",
    (e) => {
      if (state.addBtn) state.addBtn.classList.remove("drag");
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      const el = eventEditable(e) || findComposer();
      if (!el) return;
      const files = Array.from(dt.files).filter(isSupportedFile);
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      state.editable = el;
      void submitPending(el);
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target instanceof Element ? e.target.closest('button, [role="button"]') : null;
      if (!btn || !isSendButton(btn)) return;
      const el = findComposer();
      if (!el) return;
      attemptRaiseMaxChars(el, composerText(el).length);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      if (state.busy || !state.pending.length) return;
      const el = eventEditable(e) || findComposer();
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      state.editable = el;
      void submitPending(el);
    },
    true
  );

  document.addEventListener(
    "input",
    (e) => {
      const el = eventEditable(e);
      if (!el) return;
      state.editable = el;
      updateMeter(el);
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (state.busy || !state.pending.length) return;
      const btn = e.target instanceof Element ? e.target.closest('button, [role="button"]') : null;
      if (!btn || !isSendButton(btn)) return;
      const el = findComposer();
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      state.editable = el;
      void submitPending(el);
    },
    true
  );

  document.addEventListener(
    "focusin",
    (e) => {
      if (isEditable(eventTarget(e))) {
        state.editable = eventTarget(e);
        scheduleLayout();
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!state.panel || !state.panel.classList.contains("show")) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.includes(state.host)) return;
      state.panel.classList.remove("show");
      state.gear.classList.remove("open");
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (!state.panel || !state.panel.classList.contains("show")) return;
      state.panel.classList.remove("show");
      state.gear.classList.remove("open");
    },
    true
  );

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.target !== "content" || msg.type !== "ocr-progress") return;
      if (!state.busy) return;
      setToast(`OCR… ${msg.progress}%`, 0);
    });
  }

  window.addEventListener("resize", scheduleLayout);
  document.addEventListener("scroll", scheduleLayout, true);

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "class") {
        applyTheme();
      }
    }
    scheduleLayout();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  setInterval(scheduleLayout, 1500);

  buildUi();
  applyTheme();
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  } catch {
    /* listener not supported */
  }
  loadSettings();
  scheduleLayout();
})();
