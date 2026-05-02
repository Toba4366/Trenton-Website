// World Generation (BYOW) — runs Trenton's CS 61B Engine.java in-browser via CheerpJ.
//
// His Engine.interactWithInputString(seed) does the world generation: rooms,
// connecting hallways, gold-apple placement. Returns a Java TETile[][].
// We grab a string snapshot via TETile.toString(world) (one fast call, not
// 3025 per-tile awaits), then render to canvas in JS.
//
// Avatar placement and movement happen in JS — the original Engine couples
// them to StdDraw, which we stub. The interesting algorithmic work — room
// generation + connectivity — is all Trenton's Java.

(() => {
  const W = 55, H = 55;
  const JAR_VERSION = "2";
  const JAR_URL = `/app/games/dist/worldgen.jar?v=${JAR_VERSION}`;
  const MAX_SEED_RETRIES = 5;
  const CHEERPJ_LOADER = "https://cjrtnc.leaningtech.com/3.0/cj3loader.js";

  let cheerpReady = null;
  let lib = null;
  let EngineClass = null;
  let TETileClass = null;

  let modal, canvas, ctx, seedEl, coinsEl, totalCoinsEl, loadingEl;
  let grid = null;       // 2D char array, [row][col], row 0 is top
  let avatar = null;     // {col, row}
  let coins = 0;
  let totalCoins = 0;
  let busy = false;
  let currentSeed = null;
  let tileSize = 12;

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
      EngineClass = await lib.byow.Core.Engine;
      TETileClass = await lib.byow.TileEngine.TETile;
    })();
    return cheerpReady;
  }

  function randomSeed() {
    return String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000);
  }

  // ── World generation ────────────────────────────────────────────────
  async function generateWorld(seed) {
    await ensureRuntime();
    const engine = await new EngineClass();

    // Some seeds make the connectivity loops bail (we capped them in the patched
    // Engine.java); silently retry with a fresh seed if that happens.
    let world = null;
    let usedSeed = seed;
    for (let attempt = 0; attempt < MAX_SEED_RETRIES; attempt++) {
      try {
        world = await engine.interactWithInputString(`n${usedSeed}s`);
        break;
      } catch (e) {
        console.warn("[worldgen] seed " + usedSeed + " failed to converge, retrying", e);
        if (attempt === MAX_SEED_RETRIES - 1) throw e;
        usedSeed = randomSeed();
      }
    }
    currentSeed = usedSeed;
    seedEl.textContent = usedSeed;

    const worldStr = await TETileClass.toString(world);

    // Parse string into 2D char array. First line = top row.
    const lines = worldStr.split("\n").filter(l => l.length > 0);
    grid = lines.map(line => line.split(""));

    // Place avatar at first FLOOR tile we find (top-down).
    avatar = null;
    coins = 0;
    totalCoins = 0;
    for (let r = 0; r < grid.length && !avatar; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === "·") { avatar = { col: c, row: r }; break; }
      }
    }
    // Count gold apples
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === "g") totalCoins++;
      }
    }
    coinsEl.textContent = "0";
    totalCoinsEl.textContent = totalCoins;

    sizeCanvas();
    render();
  }

  // ── Rendering ───────────────────────────────────────────────────────
  function sizeCanvas() {
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    const available = Math.min(wrapper.clientWidth, 720);
    const dpr = window.devicePixelRatio || 1;
    tileSize = Math.floor(available / W);
    const pxW = tileSize * W;
    const pxH = tileSize * H;
    canvas.style.width = pxW + "px";
    canvas.style.height = pxH + "px";
    canvas.width = pxW * dpr;
    canvas.height = pxH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  // Site-matched palette for tile types
  const TILE_PAINT = {
    "#": (x, y, s) => {                                    // WALL
      ctx.fillStyle = "#3d3650";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#241f30";
      ctx.fillRect(x, y, s, 1);
      ctx.fillRect(x, y + s - 1, s, 1);
    },
    "·": (x, y, s) => {                                    // FLOOR
      ctx.fillStyle = "#f5edd6";
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#dccfa0";
      ctx.fillRect(x + s/2 - 1, y + s/2 - 1, 2, 2);
    },
    " ": (x, y, s) => {                                    // NOTHING (void)
      ctx.fillStyle = "#1a1325";
      ctx.fillRect(x, y, s, s);
    },
    "g": (x, y, s) => {                                    // GoldenApple
      ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#fdb515";
      ctx.beginPath();
      ctx.arc(x + s/2, y + s/2, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#003262"; ctx.lineWidth = 1;
      ctx.stroke();
    },
    "\"": (x, y, s) => {                                   // GRASS
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#3d8c3d";
      ctx.fillRect(x + 2, y + s - 4, 1, 2);
      ctx.fillRect(x + s - 3, y + s - 5, 1, 3);
    },
    "≈": (x, y, s) => {                                    // WATER
      ctx.fillStyle = "#1d4e8c"; ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = "#5f8fc2";
      ctx.beginPath();
      ctx.moveTo(x + 1, y + s/2);
      ctx.quadraticCurveTo(x + s/4, y + s/2 - 2, x + s/2, y + s/2);
      ctx.quadraticCurveTo(x + 3*s/4, y + s/2 + 2, x + s - 1, y + s/2);
      ctx.stroke();
    },
    "❀": (x, y, s) => {                                    // FLOWER
      ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#f25c54";
      ctx.beginPath();
      ctx.arc(x + s/2, y + s/2, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    },
    "█": (x, y, s) => {                                    // LOCKED_DOOR
      ctx.fillStyle = "#fc9c2d"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#241f30"; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    },
    "▢": (x, y, s) => {                                    // UNLOCKED_DOOR
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = "#fc9c2d"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    },
    "▒": (x, y, s) => {                                    // SAND
      ctx.fillStyle = "#e8c98a"; ctx.fillRect(x, y, s, s);
    },
    "▲": (x, y, s) => {                                    // MOUNTAIN
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#7a7388";
      ctx.beginPath();
      ctx.moveTo(x + s/2, y + 2);
      ctx.lineTo(x + s - 2, y + s - 2);
      ctx.lineTo(x + 2, y + s - 2);
      ctx.fill();
    },
    "♠": (x, y, s) => {                                    // TREE
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#2d6a2d";
      ctx.beginPath();
      ctx.arc(x + s/2, y + s/2, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    },
  };

  function paintTile(ch, col, row) {
    const x = col * tileSize, y = row * tileSize, s = tileSize;
    const paint = TILE_PAINT[ch];
    if (paint) paint(x, y, s);
    else { ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s); }
  }

  function paintAvatar() {
    const x = avatar.col * tileSize, y = avatar.row * tileSize, s = tileSize;
    // Floor underneath
    ctx.fillStyle = "#f5edd6";
    ctx.fillRect(x, y, s, s);
    // Avatar marker — coral dot with navy ring
    ctx.fillStyle = "#f25c54";
    ctx.beginPath();
    ctx.arc(x + s/2, y + s/2, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#003262";
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.stroke();
  }

  function render() {
    if (!grid) return;
    // Clear
    ctx.fillStyle = "#0e0a18";
    ctx.fillRect(0, 0, W * tileSize, H * tileSize);
    for (let r = 0; r < H; r++) {
      const line = grid[r];
      if (!line) continue;
      for (let c = 0; c < W; c++) paintTile(line[c] || " ", c, r);
    }
    paintAvatar();
  }

  // ── Movement ────────────────────────────────────────────────────────
  function tryMove(dCol, dRow) {
    if (!avatar || !grid) return;
    const nc = avatar.col + dCol;
    const nr = avatar.row + dRow;
    if (nr < 0 || nr >= H || nc < 0 || nc >= W) return;
    const target = grid[nr][nc];
    if (target !== "·" && target !== "g") return;
    if (target === "g") {
      coins++;
      coinsEl.textContent = coins;
      grid[nr][nc] = "·";
    }
    avatar.col = nc;
    avatar.row = nr;
    render();
  }

  // ── Input ───────────────────────────────────────────────────────────
  // In Java coords, y goes up. In our grid (rows from top), pressing UP
  // means going to a smaller row index. So:
  //   Up    → dRow = -1
  //   Down  → dRow = +1
  //   Left  → dCol = -1
  //   Right → dCol = +1
  const KEY_MAP = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1], k: [0, -1], K: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1], j: [0, 1], J: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], h: [-1, 0], H: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0], l: [1, 0], L: [1, 0],
  };
  function onKeyDown(e) {
    if (!modal || modal.hidden) return;
    if (e.key === "Escape") { closeGame(); return; }
    const dir = KEY_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir[0], dir[1]);
  }

  // touch swipe
  let touchStart = null;
  function onTouchStart(e) { touchStart = [e.touches[0].clientX, e.touches[0].clientY]; }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart[0];
    const dy = e.changedTouches[0].clientY - touchStart[1];
    touchStart = null;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 18) return;
    const dir = adx > ady ? [dx > 0 ? 1 : -1, 0] : [0, dy > 0 ? 1 : -1];
    tryMove(dir[0], dir[1]);
  }

  // ── Modal ───────────────────────────────────────────────────────────
  function cacheEls() {
    canvas        = document.getElementById("wg-canvas");
    ctx           = canvas.getContext("2d");
    seedEl        = document.getElementById("wg-seed");
    coinsEl       = document.getElementById("wg-coins");
    totalCoinsEl  = document.getElementById("wg-total-coins");
    loadingEl     = document.getElementById("wg-loading");
  }

  async function openGame() {
    if (!modal) modal = document.getElementById("wg-modal");
    cacheEls();
    modal.hidden = false;
    document.body.classList.add("game-open");
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = "Booting Java in your browser & generating world…";
    }
    canvas.hidden = true;

    try {
      await generateWorld(randomSeed());
      loadingEl.hidden = true;
      canvas.hidden = false;
    } catch (err) {
      console.error("[worldgen]", err);
      let msg;
      try {
        msg = err && (err.detailMessage || err.message || (err.getMessage && await err.getMessage()) || String(err));
      } catch (_) { msg = String(err); }
      loadingEl.hidden = false;
      loadingEl.textContent = "Couldn't load: " + msg;
    }
  }

  function closeGame() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("game-open");
  }

  async function newWorld() {
    if (busy) return;
    busy = true;
    try {
      loadingEl.hidden = false;
      loadingEl.textContent = "Generating new world…";
      canvas.hidden = true;
      await generateWorld(randomSeed());
      loadingEl.hidden = true;
      canvas.hidden = false;
    } catch (err) {
      console.error("[worldgen]", err);
    } finally {
      busy = false;
    }
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    modal = document.getElementById("wg-modal");
    document.querySelectorAll("[data-game='world']").forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove("card-link-muted");
      btn.textContent = "Play in browser ↗";
      btn.addEventListener("click", openGame);
    });
    const closeBtn = document.getElementById("wg-close");
    const restartBtn = document.getElementById("wg-restart");
    if (closeBtn) closeBtn.addEventListener("click", closeGame);
    if (restartBtn) restartBtn.addEventListener("click", newWorld);
    if (modal) {
      modal.querySelectorAll("[data-close]").forEach((el) => {
        el.addEventListener("click", closeGame);
      });
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", () => {
      if (modal && !modal.hidden && grid) {
        sizeCanvas();
        render();
      }
    });
    const c = document.getElementById("wg-canvas");
    if (c) {
      c.addEventListener("touchstart", onTouchStart, { passive: true });
      c.addEventListener("touchend", onTouchEnd, { passive: true });
    }
  });
})();
