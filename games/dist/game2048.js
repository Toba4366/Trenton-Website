// 2048 — runs Trenton's CS 61B Java logic in-browser via CheerpJ.
//
// His Model/Board/Tile/Side classes (compiled to game2048.jar) handle the
// rules + scoring. This file is the JS shell: lazy-loads CheerpJ, opens a
// modal, renders the board, sends keystrokes into Java, reads state out.
//
// Slide + bloom animations mirror the original BoardWidget.java behavior:
// - Each old Tile's .next() pointer (set by Board.move/merge during a tilt)
//   tells us where it goes. We update CSS transforms; transitions slide.
// - Tiles that share a destination are mid-merge — both old DOM elements
//   are removed and a single new tile is bloomed in at the destination.
// - Random spawn at end of move also blooms in.
//
// Java calls cross a WASM boundary so every method returns a Promise.

(() => {
  const SIZE = 4;
  const TILE2_PROBABILITY = 0.9;
  // Bump JAR_VERSION whenever game2048.jar is rebuilt to bust browser caches.
  const JAR_VERSION = "2";
  const JAR_URL = `/app/games/dist/game2048.jar?v=${JAR_VERSION}`;
  const CHEERPJ_LOADER = "https://cjrtnc.leaningtech.com/3.0/cj3loader.js";
  const BEST_KEY = "trenton-2048-best";

  const SLIDE_MS = 150;  // matches MOVE_DELTA = 10 cells/sec → ~100ms/cell, with overhead

  let cheerpReady = null;
  let lib = null;
  let ModelClass = null;
  let TileClass = null;
  let SideClass = null;
  let model = null;
  let busy = false;
  let modal = null;

  // JS-side mirror of currently-displayed tiles. Each entry holds the Java
  // Tile reference so we can later read .next() to find its post-tilt slot.
  let registry = [];  // [{id, col, row, value, javaTile, element}]
  let tileSeq = 0;

  // ── CheerpJ bootstrap (runs once, lazy) ─────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureRuntime() {
    if (cheerpReady) return cheerpReady;
    cheerpReady = (async () => {
      if (typeof cheerpjInit === "undefined") {
        await loadScript(CHEERPJ_LOADER);
      }
      // Share the cheerpjInit promise across all CheerpJ-using game scripts
      // (CheerpJ throws "Already initialized" if init is called twice).
      if (!window.__cheerpjInitPromise) {
        window.__cheerpjInitPromise = cheerpjInit({ status: "none" });
      }
      await window.__cheerpjInitPromise;
      lib = await cheerpjRunLibrary(JAR_URL);
      ModelClass = await lib.game2048.Model;
      TileClass = await lib.game2048.Tile;
      SideClass = await lib.game2048.Side;
    })();
    return cheerpReady;
  }

  // ── Game lifecycle ──────────────────────────────────────────────────
  async function newGame() {
    await ensureRuntime();
    if (!model) {
      model = await new ModelClass(SIZE);
    } else {
      await model.clear();
    }
    // Reset display
    boardEl.innerHTML = "";
    registry = [];
    paintBackgroundCells();
    // Add two starter tiles directly — they'll bloom in via fullRebuild
    await spawnRandomTile();
    await spawnRandomTile();
    await fullRebuild(true);
    await updateMeta();
  }

  async function emptyCells() {
    const empty = [];
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE; r++) {
        const t = await model.tile(c, r);
        if (t === null) empty.push([c, r]);
      }
    }
    return empty;
  }

  async function spawnRandomTile() {
    const empty = await emptyCells();
    if (empty.length === 0) return null;
    const [c, r] = empty[Math.floor(Math.random() * empty.length)];
    const value = Math.random() < TILE2_PROBABILITY ? 2 : 4;
    const tile = await TileClass.create(value, c, r);
    await model.addTile(tile);
    return { col: c, row: r, value };
  }

  async function snapshot() {
    const cells = new Array(SIZE * SIZE);
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE; r++) {
        const t = await model.tile(c, r);
        cells[c * SIZE + r] = t === null ? 0 : await t.value();
      }
    }
    return cells.join(",");
  }

  // ── Animated tilt ───────────────────────────────────────────────────
  // Strategy: use `.next()` chains for the visual SLIDE only; after the
  // animation, rebuild the DOM from Java's authoritative board state. This
  // prevents JS-side state from drifting if the underlying tilt algorithm
  // produces unusual `.next()` patterns (e.g., recursive tiltRow paths).
  async function animatedTilt(direction) {
    if (registry.length === 0) return;

    const before = await snapshot();
    const sideValue = await SideClass.valueOf(direction);
    await model.tilt(sideValue);
    const after = await snapshot();

    if (before === after) {
      await updateMeta();
      return;
    }

    // Animate slides (best-effort). Mark destinations where value changes
    // for the bloom pass.
    const bloomKeys = new Set();
    for (const reg of registry) {
      if (!reg.javaTile) continue;
      try {
        const next = await reg.javaTile.next();
        if (!next) continue;
        const newCol = await next.col();
        const newRow = await next.row();
        const newValue = await next.value();
        reg.element.style.transform = transformFor(newCol, newRow);
        if (newValue !== reg.value) bloomKeys.add(`${newCol},${newRow}`);
      } catch (_) {}
    }

    await sleep(SLIDE_MS + 10);

    // Spawn one random tile (Java side); bloom its position too.
    const spawn = await spawnRandomTile();
    if (spawn) bloomKeys.add(`${spawn.col},${spawn.row}`);

    // Rebuild DOM authoritatively from Java state — this is the trust line.
    await rebuildFromBoard(bloomKeys);

    await updateMeta();
  }

  async function rebuildFromBoard(bloomKeys) {
    // Tear down old tile elements (background cells stay).
    for (const reg of registry) {
      if (reg.element && reg.element.parentNode) reg.element.remove();
    }
    registry = [];

    // Walk current Java board and create fresh elements per tile.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = await model.tile(c, r);
        if (t === null) continue;
        const value = await t.value();
        const id = ++tileSeq;
        const shouldBloom = bloomKeys ? bloomKeys.has(`${c},${r}`) : false;
        const el = createTileElement(id, c, r, value, shouldBloom);
        boardEl.appendChild(el);
        registry.push({ id, col: c, row: r, value, javaTile: t, element: el });
      }
    }
  }

  // ── Rendering primitives ────────────────────────────────────────────
  let boardEl, scoreEl, bestEl, statusEl, loadingEl;

  function cacheEls() {
    boardEl   = document.getElementById("g2048-board");
    scoreEl   = document.getElementById("g2048-score");
    bestEl    = document.getElementById("g2048-best");
    statusEl  = document.getElementById("g2048-status");
    loadingEl = document.getElementById("g2048-loading");
  }

  function transformFor(col, row) {
    // tile width = 25% of board; translate works in own-size units
    return `translate(${col * 100}%, ${(SIZE - 1 - row) * 100}%)`;
  }

  function createTileElement(id, col, row, value, withBloom) {
    const el = document.createElement("div");
    el.className = "g2048-tile v" + value + (withBloom ? " bloom" : "");
    el.dataset.id = id;
    el.style.transform = transformFor(col, row);
    const inner = document.createElement("div");
    inner.className = "g2048-tile-inner";
    inner.textContent = value;
    el.appendChild(inner);
    if (withBloom) {
      // Drop the bloom class once the keyframe finishes
      setTimeout(() => el.classList.remove("bloom"), 350);
    }
    return el;
  }

  function paintBackgroundCells() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "g2048-cell";
        cell.style.transform = transformFor(c, r);
        const inner = document.createElement("div");
        inner.className = "g2048-cell-inner";
        cell.appendChild(inner);
        boardEl.appendChild(cell);
      }
    }
  }

  // Build registry + DOM from current Java state.
  // `withBloom` = true on initial open / restart so the starting tiles pop in.
  async function fullRebuild(withBloom) {
    if (loadingEl) loadingEl.hidden = true;
    boardEl.hidden = false;

    // Remove any existing tile elements (keep cells)
    for (const reg of registry) reg.element.remove();
    registry = [];

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = await model.tile(c, r);
        if (t !== null) {
          const value = await t.value();
          const id = ++tileSeq;
          const el = createTileElement(id, c, r, value, !!withBloom);
          boardEl.appendChild(el);
          registry.push({ id, col: c, row: r, value, javaTile: t, element: el });
        }
      }
    }
  }

  function getBest() { return +(localStorage.getItem(BEST_KEY) || 0); }
  function setBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

  async function updateMeta() {
    const score = await model.score();
    scoreEl.textContent = score;
    const best = Math.max(score, getBest());
    bestEl.textContent = best;

    if (await model.gameOver()) {
      setBest(best);
      let maxValue = 0;
      for (const reg of registry) if (reg.value > maxValue) maxValue = reg.value;
      statusEl.textContent = maxValue >= 2048 ? "🎉  You hit 2048!" : "Game over";
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Input ───────────────────────────────────────────────────────────
  const KEY_MAP = {
    ArrowUp: "NORTH", w: "NORTH", W: "NORTH", k: "NORTH", K: "NORTH",
    ArrowDown: "SOUTH", s: "SOUTH", S: "SOUTH", j: "SOUTH", J: "SOUTH",
    ArrowLeft: "WEST", a: "WEST", A: "WEST", h: "WEST", H: "WEST",
    ArrowRight: "EAST", d: "EAST", D: "EAST", l: "EAST", L: "EAST",
  };

  function onKeyDown(e) {
    if (!modal || modal.hidden) return;
    if (e.key === "Escape") { closeGame(); return; }
    const dir = KEY_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (busy) return;
    busy = true;
    animatedTilt(dir).finally(() => { busy = false; });
  }

  let touchStart = null;
  function onTouchStart(e) { touchStart = [e.touches[0].clientX, e.touches[0].clientY]; }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart[0];
    const dy = e.changedTouches[0].clientY - touchStart[1];
    touchStart = null;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) return;
    const dir = adx > ady ? (dx > 0 ? "EAST" : "WEST") : (dy > 0 ? "SOUTH" : "NORTH");
    if (busy) return;
    busy = true;
    animatedTilt(dir).finally(() => { busy = false; });
  }

  // ── Modal ───────────────────────────────────────────────────────────
  async function openGame() {
    if (!modal) modal = document.getElementById("g2048-modal");
    cacheEls();
    modal.hidden = false;
    document.body.classList.add("game-open");
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = "Booting Java in your browser… (first load ~10s)";
    }
    if (boardEl) boardEl.hidden = true;
    try {
      await newGame();
    } catch (err) {
      console.error("[2048]", err);
      if (loadingEl) {
        loadingEl.hidden = false;
        let msg;
        try {
          msg = err && (
            err.detailMessage ||
            err.message ||
            (err.getMessage && await err.getMessage()) ||
            String(err)
          );
        } catch (_) { msg = String(err); }
        loadingEl.textContent = "Couldn't load: " + msg;
      }
    }
  }

  function closeGame() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("game-open");
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    modal = document.getElementById("g2048-modal");
    document.querySelectorAll("[data-game='2048']").forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove("card-link-muted");
      btn.textContent = "Play in browser ↗";
      btn.addEventListener("click", openGame);
    });
    const closeBtn = document.getElementById("g2048-close");
    const restartBtn = document.getElementById("g2048-restart");
    if (closeBtn) closeBtn.addEventListener("click", closeGame);
    if (restartBtn) restartBtn.addEventListener("click", () => {
      if (busy) return;
      busy = true;
      newGame().finally(() => { busy = false; });
    });
    if (modal) {
      modal.querySelectorAll("[data-close]").forEach((el) => {
        el.addEventListener("click", closeGame);
      });
    }
    window.addEventListener("keydown", onKeyDown);
    const board = document.getElementById("g2048-board");
    if (board) {
      board.addEventListener("touchstart", onTouchStart, { passive: true });
      board.addEventListener("touchend", onTouchEnd, { passive: true });
    }
  });
})();
