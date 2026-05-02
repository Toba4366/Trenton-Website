// 2048 — runs Trenton's CS 61B Java logic in-browser via CheerpJ.
//
// His Model/Board/Tile/Side classes (compiled to game2048.jar) handle the
// rules + scoring. This file is the JS shell: lazy-loads CheerpJ, opens a
// modal, renders the board, sends keystrokes into Java, reads state out.
//
// Java calls cross a WASM boundary so every method returns a Promise.

(() => {
  const SIZE = 4;
  const TILE2_PROBABILITY = 0.9;
  const JAR_URL = "/app/games/dist/game2048.jar";
  const CHEERPJ_LOADER = "https://cjrtnc.leaningtech.com/3.0/cj3loader.js";
  const BEST_KEY = "trenton-2048-best";

  let cheerpReady = null;
  let lib = null;
  let ModelClass = null;
  let TileClass = null;
  let SideClass = null;
  let model = null;
  let busy = false;
  let modal = null;

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
      await cheerpjInit({ status: "none" });
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
    await addRandomTile();
    await addRandomTile();
    await render();
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

  async function addRandomTile() {
    const empty = await emptyCells();
    if (empty.length === 0) return false;
    const [c, r] = empty[Math.floor(Math.random() * empty.length)];
    const value = Math.random() < TILE2_PROBABILITY ? 2 : 4;
    const tile = await TileClass.create(value, c, r);
    await model.addTile(tile);
    return true;
  }

  async function tilt(direction) {
    const before = await snapshot();
    const sideValue = await SideClass.valueOf(direction);
    await model.tilt(sideValue);
    const after = await snapshot();
    if (before !== after) await addRandomTile();
    await render();
  }

  // ── Rendering ───────────────────────────────────────────────────────
  let boardEl, scoreEl, bestEl, statusEl, loadingEl;

  function cacheEls() {
    boardEl   = document.getElementById("g2048-board");
    scoreEl   = document.getElementById("g2048-score");
    bestEl    = document.getElementById("g2048-best");
    statusEl  = document.getElementById("g2048-status");
    loadingEl = document.getElementById("g2048-loading");
  }

  function getBest() { return +(localStorage.getItem(BEST_KEY) || 0); }
  function setBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

  async function render() {
    if (!boardEl) cacheEls();
    if (loadingEl) loadingEl.hidden = true;
    boardEl.hidden = false;

    boardEl.innerHTML = "";
    let maxValue = 0;
    for (let r = SIZE - 1; r >= 0; r--) {
      for (let c = 0; c < SIZE; c++) {
        const t = await model.tile(c, r);
        const value = t === null ? 0 : await t.value();
        if (value > maxValue) maxValue = value;
        const cell = document.createElement("div");
        cell.className = "g2048-tile " + (value ? "v" + value : "v0");
        cell.textContent = value || "";
        boardEl.appendChild(cell);
      }
    }
    const score = await model.score();
    scoreEl.textContent = score;
    const best = Math.max(score, getBest());
    bestEl.textContent = best;

    if (await model.gameOver()) {
      setBest(best);
      statusEl.textContent = maxValue >= 2048 ? "🎉  You hit 2048!" : "Game over";
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

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
    tilt(dir).finally(() => { busy = false; });
  }

  // simple touch swipe
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
    tilt(dir).finally(() => { busy = false; });
  }

  // ── Modal ───────────────────────────────────────────────────────────
  async function openGame() {
    if (!modal) modal = document.getElementById("g2048-modal");
    cacheEls();
    modal.hidden = false;
    document.body.classList.add("game-open");
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = "Booting Java in your browser… (first load is ~10s)";
    }
    if (boardEl) boardEl.hidden = true;
    try {
      await newGame();
    } catch (err) {
      console.error(err);
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = "Couldn't load runtime: " + err.message + ". Try Chrome/Firefox/Safari latest.";
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
