// World Generation (BYOW) — runs Trenton's CS 61B Engine.java in-browser via CheerpJ.
//
// His Engine.interactWithInputString(seed) does the world generation: rooms,
// connecting hallways, gold-apple placement. Returns a Java TETile[][].
// We grab a string snapshot via TETile.toString(world) (one fast call, not
// 3025 per-tile awaits), then render to canvas in JS.
//
// Avatar + chaser pathfinding happen in JS — Engine couples movement to StdDraw,
// which we stub. The interesting algorithmic work — room generation + apple
// placement — is all Trenton's Java.

(() => {
  const W = 55, H = 55;
  const JAR_VERSION = "2";
  const JAR_URL = `/app/games/dist/worldgen.jar?v=${JAR_VERSION}`;
  const MAX_SEED_RETRIES = 5;
  const MUSIC_URL = "games/dist/bulletsong.mp3";
  const MUSIC_PREF_KEY = "trenton-wg-music";  // "on" | "off"
  const CHEERPJ_LOADER = "https://cjrtnc.leaningtech.com/3.0/cj3loader.js";
  const MIN_CHASER_DIST = Math.max(16, Math.floor(Math.min(W, H) * 0.32));  // 18 for 55x55

  let cheerpReady = null;
  let lib = null;
  let EngineClass = null;
  let TETileClass = null;

  // DOM
  let modal, canvas, ctx;
  let seedEl, coinsEl, totalCoinsEl, stepsEl, modeChasersEl, loadingEl, statusEl, musicBtn;
  let audio = null;

  // Game state
  let grid = null;       // 2D char array, [row][col], row 0 is top
  let avatar = null;     // {col, row}
  let coins = 0;
  let totalCoins = 0;
  let steps = 0;
  let chasers = [];      // [{col, row, algo, apples}]
  let gameOver = false;
  let busy = false;
  let currentSeed = null;
  let tileSize = 12;

  // Mode config
  let mode = "free";        // "free" | "chase" | "survive"
  let algorithm = "bfs";    // "greedy" | "dfs" | "bfs" | "astar"
  let hardMode = false;     // chaser eats apples too (chase mode only)

  // ── Boot ────────────────────────────────────────────────────────────
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

  // ── Geometry helpers ────────────────────────────────────────────────
  const keyOf = (p) => p.col + "," + p.row;
  const parseKey = (k) => { const [c, r] = k.split(",").map(Number); return { col: c, row: r }; };
  const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  function neighbors4(p) {
    return [
      { col: p.col,     row: p.row - 1 },
      { col: p.col,     row: p.row + 1 },
      { col: p.col - 1, row: p.row     },
      { col: p.col + 1, row: p.row     },
    ];
  }
  function walkable(c, r) {
    if (r < 0 || r >= H || c < 0 || c >= W) return false;
    const t = grid[r][c];
    return t === "·" || t === "g";
  }

  // BFS from a seed cell, returning Map<key,distance>.
  function bfsDistances(from) {
    const dists = new Map();
    dists.set(keyOf(from), 0);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      const d = dists.get(keyOf(cur));
      for (const n of neighbors4(cur)) {
        const k = keyOf(n);
        if (dists.has(k)) continue;
        if (!walkable(n.col, n.row)) continue;
        dists.set(k, d + 1);
        q.push(n);
      }
    }
    return dists;
  }

  // ── Pathfinding (4 flavors) ─────────────────────────────────────────
  // All return the chaser's next-step cell {col,row}, or null if unreachable.

  function greedyStep(chaser, target) {
    let best = null, bestD = Infinity;
    for (const n of neighbors4(chaser)) {
      if (!walkable(n.col, n.row)) continue;
      const d = manhattan(n, target);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function bfsStep(chaser, target) {
    if (chaser.col === target.col && chaser.row === target.row) return null;
    const parent = new Map();
    parent.set(keyOf(chaser), null);
    const q = [chaser];
    while (q.length) {
      const cur = q.shift();
      if (cur.col === target.col && cur.row === target.row) {
        return reconstructFirstStep(cur, parent, chaser);
      }
      for (const n of neighbors4(cur)) {
        const k = keyOf(n);
        if (parent.has(k)) continue;
        if (!walkable(n.col, n.row)) continue;
        parent.set(k, cur);
        q.push(n);
      }
    }
    return null;
  }

  function dfsStep(chaser, target) {
    if (chaser.col === target.col && chaser.row === target.row) return null;

    // DFS chasers COMMIT to the path they find. Recomputing every step from
    // scratch lets DFS pick a different "deep" branch each turn, which made
    // the chaser flip-flop between two tiles. Now: follow the queued path
    // until consumed, then replan from current position.
    const stillValid = chaser._dfsPath && chaser._dfsPath.length > 0;
    if (stillValid) {
      const next = chaser._dfsPath.shift();
      return next;
    }

    // Plan a fresh DFS path from chaser → target.
    const parent = new Map();
    parent.set(keyOf(chaser), null);
    const stack = [chaser];
    const visited = new Set([keyOf(chaser)]);
    let foundEnd = null;
    while (stack.length) {
      const cur = stack.pop();
      if (cur.col === target.col && cur.row === target.row) {
        foundEnd = cur;
        break;
      }
      for (const n of neighbors4(cur)) {
        const k = keyOf(n);
        if (visited.has(k)) continue;
        if (!walkable(n.col, n.row)) continue;
        visited.add(k);
        parent.set(k, cur);
        stack.push(n);
      }
    }
    if (!foundEnd) return null;

    // Reconstruct full path from chaser to target.
    const path = [];
    let step = foundEnd;
    while (step && (step.col !== chaser.col || step.row !== chaser.row)) {
      path.unshift(step);
      step = parent.get(keyOf(step));
    }
    chaser._dfsPath = path;
    return chaser._dfsPath.length > 0 ? chaser._dfsPath.shift() : null;
  }

  function astarStep(chaser, target) {
    if (chaser.col === target.col && chaser.row === target.row) return null;
    const open = [{ node: chaser, g: 0, f: manhattan(chaser, target) }];
    const parent = new Map();
    parent.set(keyOf(chaser), null);
    const gScore = new Map();
    gScore.set(keyOf(chaser), 0);
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const { node } = open.shift();
      if (node.col === target.col && node.row === target.row) {
        return reconstructFirstStep(node, parent, chaser);
      }
      for (const n of neighbors4(node)) {
        if (!walkable(n.col, n.row)) continue;
        const ng = gScore.get(keyOf(node)) + 1;
        const k = keyOf(n);
        if (gScore.has(k) && gScore.get(k) <= ng) continue;
        gScore.set(k, ng);
        parent.set(k, node);
        open.push({ node: n, g: ng, f: ng + manhattan(n, target) });
      }
    }
    return null;
  }

  // Walks parent pointers from `goal` back to `start`, returns the step
  // immediately after `start`.
  function reconstructFirstStep(goal, parent, start) {
    let step = goal;
    let p = parent.get(keyOf(step));
    while (p && (p.col !== start.col || p.row !== start.row)) {
      step = p;
      p = parent.get(keyOf(step));
    }
    if (!p) return null; // goal == start
    return step;
  }

  const ALGORITHMS = {
    greedy: greedyStep,
    dfs:    dfsStep,
    bfs:    bfsStep,
    astar:  astarStep,
  };

  const CHASER_VIS = {
    greedy: { color: "#e63946", shape: "square",   label: "Greedy" },
    dfs:    { color: "#6c4ab6", shape: "triangle", label: "DFS" },
    bfs:    { color: "#1d8a7a", shape: "diamond",  label: "BFS" },
    astar:  { color: "#003262", shape: "hexagon",  label: "A*" },
  };

  // ── Chaser spawning ─────────────────────────────────────────────────
  function pickFarTile(dists, minDist, exclude) {
    const candidates = [];
    for (const [k, d] of dists) {
      if (exclude && exclude.has(k)) continue;
      if (d >= minDist) candidates.push(k);
    }
    if (candidates.length === 0) {
      // Fallback: farthest reachable tile.
      let max = -1, far = null;
      for (const [k, d] of dists) {
        if (exclude && exclude.has(k)) continue;
        if (d > max) { max = d; far = k; }
      }
      if (!far) return null;
      return parseKey(far);
    }
    return parseKey(candidates[Math.floor(Math.random() * candidates.length)]);
  }

  function spawnChasersForMode() {
    chasers = [];
    if (mode === "free") return;
    const dists = bfsDistances(avatar);
    if (mode === "chase") {
      const spawn = pickFarTile(dists, MIN_CHASER_DIST);
      if (spawn) chasers.push({ ...spawn, algo: algorithm, apples: 0 });
    } else if (mode === "survive") {
      const algos = ["greedy", "dfs", "bfs", "astar"];
      const used = new Set();
      // In survive mode chasers spawn slightly closer to keep the heat on.
      const minDist = Math.max(12, Math.floor(MIN_CHASER_DIST * 0.7));
      for (const algo of algos) {
        const spawn = pickFarTile(dists, minDist, used);
        if (spawn) {
          chasers.push({ ...spawn, algo, apples: 0 });
          used.add(keyOf(spawn));
        }
      }
    }
  }

  // ── World generation ────────────────────────────────────────────────
  async function generateWorld(seed) {
    await ensureRuntime();
    const engine = await new EngineClass();

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
    const seedInput = document.getElementById("wg-seed-input");
    if (seedInput) seedInput.value = usedSeed;

    const worldStr = await TETileClass.toString(world);
    const lines = worldStr.split("\n").filter(l => l.length > 0);
    grid = lines.map(line => line.split(""));

    // Place avatar at first FLOOR tile (top-down search).
    avatar = null;
    coins = 0;
    totalCoins = 0;
    steps = 0;
    gameOver = false;
    for (let r = 0; r < grid.length && !avatar; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === "·") { avatar = { col: c, row: r }; break; }
      }
    }
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === "g") totalCoins++;
      }
    }

    spawnChasersForMode();

    sizeCanvas();
    updateHUD();
    render();
  }

  // ── Rendering ───────────────────────────────────────────────────────
  function sizeCanvas() {
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    const verticalReserve = 380; // header + controls + collapsed-howto + footer + credit + padding
    const maxFromHeight = Math.max(240, window.innerHeight - verticalReserve);
    const available = Math.min(wrapper.clientWidth, maxFromHeight, 720);
    const dpr = window.devicePixelRatio || 1;
    tileSize = Math.max(8, Math.floor(available / W));
    const pxW = tileSize * W;
    const pxH = tileSize * H;
    canvas.style.width = pxW + "px";
    canvas.style.height = pxH + "px";
    canvas.width = pxW * dpr;
    canvas.height = pxH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  const TILE_PAINT = {
    "#": (x, y, s) => {
      ctx.fillStyle = "#3d3650"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#241f30";
      ctx.fillRect(x, y, s, 1);
      ctx.fillRect(x, y + s - 1, s, 1);
    },
    "·": (x, y, s) => {
      ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#dccfa0";
      ctx.fillRect(x + s/2 - 1, y + s/2 - 1, 2, 2);
    },
    " ": (x, y, s) => {
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
    },
    "g": (x, y, s) => {
      ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#fdb515";
      ctx.beginPath(); ctx.arc(x + s/2, y + s/2, s * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#003262"; ctx.lineWidth = 1; ctx.stroke();
    },
    "\"": (x, y, s) => {
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#3d8c3d";
      ctx.fillRect(x + 2, y + s - 4, 1, 2);
      ctx.fillRect(x + s - 3, y + s - 5, 1, 3);
    },
    "≈": (x, y, s) => {
      ctx.fillStyle = "#1d4e8c"; ctx.fillRect(x, y, s, s);
    },
    "❀": (x, y, s) => {
      ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#f25c54";
      ctx.beginPath(); ctx.arc(x + s/2, y + s/2, s * 0.3, 0, Math.PI * 2); ctx.fill();
    },
    "█": (x, y, s) => { ctx.fillStyle = "#fc9c2d"; ctx.fillRect(x, y, s, s); ctx.fillStyle = "#241f30"; ctx.fillRect(x + 2, y + 2, s - 4, s - 4); },
    "▢": (x, y, s) => { ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s); ctx.strokeStyle = "#fc9c2d"; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, s - 4, s - 4); },
    "▒": (x, y, s) => { ctx.fillStyle = "#e8c98a"; ctx.fillRect(x, y, s, s); },
    "▲": (x, y, s) => {
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#7a7388";
      ctx.beginPath(); ctx.moveTo(x + s/2, y + 2); ctx.lineTo(x + s - 2, y + s - 2); ctx.lineTo(x + 2, y + s - 2); ctx.fill();
    },
    "♠": (x, y, s) => {
      ctx.fillStyle = "#1a1325"; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#2d6a2d";
      ctx.beginPath(); ctx.arc(x + s/2, y + s/2, s * 0.4, 0, Math.PI * 2); ctx.fill();
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
    ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = "#f25c54";
    ctx.beginPath(); ctx.arc(x + s/2, y + s/2, s * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#003262";
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.stroke();
  }

  function paintChaser(chaser) {
    const x = chaser.col * tileSize, y = chaser.row * tileSize, s = tileSize;
    const v = CHASER_VIS[chaser.algo];
    ctx.fillStyle = "#f5edd6"; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = v.color;
    ctx.strokeStyle = "#1a1325";
    ctx.lineWidth = Math.max(1, s * 0.08);
    if (v.shape === "square") {
      const inset = s * 0.18;
      ctx.fillRect(x + inset, y + inset, s - 2*inset, s - 2*inset);
      ctx.strokeRect(x + inset, y + inset, s - 2*inset, s - 2*inset);
    } else if (v.shape === "triangle") {
      ctx.beginPath();
      ctx.moveTo(x + s/2, y + s * 0.88);
      ctx.lineTo(x + s * 0.85, y + s * 0.18);
      ctx.lineTo(x + s * 0.15, y + s * 0.18);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (v.shape === "diamond") {
      ctx.beginPath();
      ctx.moveTo(x + s/2,        y + s * 0.1);
      ctx.lineTo(x + s * 0.9,    y + s/2);
      ctx.lineTo(x + s/2,        y + s * 0.9);
      ctx.lineTo(x + s * 0.1,    y + s/2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (v.shape === "hexagon") {
      const cx = x + s/2, cy = y + s/2, r = s * 0.42;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i + Math.PI / 6;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  function render() {
    if (!grid) return;
    ctx.fillStyle = "#0e0a18"; ctx.fillRect(0, 0, W * tileSize, H * tileSize);
    for (let r = 0; r < H; r++) {
      const line = grid[r];
      if (!line) continue;
      for (let c = 0; c < W; c++) paintTile(line[c] || " ", c, r);
    }
    paintAvatar();
    for (const c of chasers) paintChaser(c);
  }

  // ── Movement + chaser step ──────────────────────────────────────────
  function tryMove(dCol, dRow) {
    if (gameOver || !avatar || !grid) return;
    const nc = avatar.col + dCol;
    const nr = avatar.row + dRow;
    if (nr < 0 || nr >= H || nc < 0 || nc >= W) return;
    const target = grid[nr][nc];
    if (target !== "·" && target !== "g") return;
    if (target === "g") {
      coins++;
      grid[nr][nc] = "·";
    }
    avatar.col = nc;
    avatar.row = nr;
    steps++;

    // Chasers respond
    stepChasers();

    // Resolve outcomes
    resolveGameState();

    updateHUD();
    render();
  }

  function stepChasers() {
    if (chasers.length === 0) return;
    for (const c of chasers) {
      const fn = ALGORITHMS[c.algo];
      const next = fn(c, avatar);
      if (!next) continue;
      c.col = next.col;
      c.row = next.row;
      // Hard chase mode: chasers eat apples too (NOT in survive mode)
      if (mode === "chase" && hardMode && grid[c.row][c.col] === "g") {
        c.apples++;
        grid[c.row][c.col] = "·";
      }
    }
  }

  function resolveGameState() {
    // Caught?
    for (const c of chasers) {
      if (c.col === avatar.col && c.row === avatar.row) {
        gameOver = true;
        if (mode === "survive") {
          showStatus(`💀 Caught after ${steps} steps · ${coins}/${totalCoins} apples · Hit “New world” for another run.`);
        } else {
          const algo = CHASER_VIS[c.algo].label;
          showStatus(`💀 ${algo} caught you. ${coins}/${totalCoins} apples in ${steps} steps. Hit “New world” to retry.`);
        }
        return;
      }
    }

    // All apples gone — endgame check
    const remaining = totalCoins - coins - chasers.reduce((s, c) => s + c.apples, 0);
    if (remaining <= 0 && totalCoins > 0) {
      gameOver = true;
      if (mode === "chase" && hardMode) {
        const chaserApples = chasers[0] ? chasers[0].apples : 0;
        if (chaserApples >= coins) {
          showStatus(`🐍 Chaser ate ${chaserApples} apples to your ${coins}. You lose. Hit “New world”.`);
        } else {
          showStatus(`🍎 Out-ate the chaser ${coins}–${chaserApples} in ${steps} steps. You win!`);
        }
      } else if (mode === "free") {
        showStatus(`🍎 You ate every apple in ${steps} steps. Hit “New world” for a new map.`);
      } else if (mode === "chase") {
        showStatus(`🍎 You ate every apple in ${steps} steps. Hit “New world” to play again.`);
      }
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────────
  function updateHUD() {
    if (!coinsEl) return;
    coinsEl.textContent = coins;
    totalCoinsEl.textContent = totalCoins;
    if (stepsEl) stepsEl.textContent = steps;
    if (modeChasersEl) {
      if (mode === "free") {
        modeChasersEl.textContent = "—";
      } else if (mode === "chase") {
        const c = chasers[0];
        if (!c) {
          modeChasersEl.textContent = CHASER_VIS[algorithm].label;
        } else {
          const dist = manhattan(c, avatar);
          modeChasersEl.innerHTML =
            `<span class="wg-chaser-chip wg-chaser-${c.algo}"></span>${CHASER_VIS[c.algo].label} · ${dist}`
            + (hardMode ? ` · ate ${c.apples}` : "");
        }
      } else if (mode === "survive") {
        modeChasersEl.innerHTML = chasers.map(c =>
          `<span class="wg-chaser-chip wg-chaser-${c.algo}" title="${CHASER_VIS[c.algo].label} · ${manhattan(c, avatar)}"></span>`
        ).join("");
      }
    }
  }

  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = false;
  }
  function hideStatus() { if (statusEl) statusEl.hidden = true; }

  // ── Music ───────────────────────────────────────────────────────────
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(MUSIC_URL);
    audio.loop = true; audio.volume = 0.35; audio.preload = "none";
    return audio;
  }
  function musicWanted() { return (localStorage.getItem(MUSIC_PREF_KEY) || "on") === "on"; }
  function setMusicPref(on) { localStorage.setItem(MUSIC_PREF_KEY, on ? "on" : "off"); syncMusicButton(); }
  function syncMusicButton() {
    if (!musicBtn) return;
    const on = musicWanted();
    musicBtn.textContent = on ? "♪ Music: on" : "♪ Music: off";
    musicBtn.setAttribute("aria-pressed", String(on));
  }
  function playMusic() {
    if (!musicWanted()) return;
    const a = ensureAudio();
    const p = a.play();
    if (p && p.catch) p.catch((err) => console.warn("[worldgen] music autoplay blocked:", err));
  }
  function stopMusic() { if (audio) { audio.pause(); audio.currentTime = 0; } }
  function toggleMusic() {
    const on = !musicWanted();
    setMusicPref(on);
    if (on) playMusic(); else stopMusic();
  }

  // ── Input ───────────────────────────────────────────────────────────
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

  // ── Mode UI ─────────────────────────────────────────────────────────
  function applyModeUI() {
    document.querySelectorAll("[data-wg-mode]").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.wgMode === mode ? "true" : "false");
    });
    document.querySelectorAll("[data-wg-algo]").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.wgAlgo === algorithm ? "true" : "false");
    });
    const hardBtn = document.getElementById("wg-hard");
    if (hardBtn) hardBtn.setAttribute("aria-pressed", String(hardMode));
    const algoRow = document.getElementById("wg-algo-row");
    const hardRow = document.getElementById("wg-hard-row");
    if (algoRow) algoRow.hidden = mode !== "chase";
    if (hardRow) hardRow.hidden = mode !== "chase";
  }

  function changeMode(newMode) {
    mode = newMode;
    applyModeUI();
    if (grid) regenerateGame(currentSeed);
  }
  function changeAlgo(newAlgo) {
    algorithm = newAlgo;
    applyModeUI();
    if (grid && mode === "chase") regenerateGame(currentSeed);
  }
  function toggleHard() {
    hardMode = !hardMode;
    applyModeUI();
    if (grid && mode === "chase") regenerateGame(currentSeed);
  }

  async function regenerateGame(seed) {
    // Reuse same seed (re-spawn everything fresh on same map)
    if (busy) return;
    busy = true;
    hideStatus();
    try {
      loadingEl.hidden = false;
      loadingEl.textContent = "Resetting…";
      canvas.hidden = true;
      await generateWorld(seed || randomSeed());
      loadingEl.hidden = true;
      canvas.hidden = false;
    } catch (err) {
      console.error("[worldgen]", err);
    } finally {
      busy = false;
    }
  }

  // ── Modal ───────────────────────────────────────────────────────────
  function cacheEls() {
    canvas         = document.getElementById("wg-canvas");
    ctx            = canvas.getContext("2d");
    seedEl         = document.getElementById("wg-seed");
    coinsEl        = document.getElementById("wg-coins");
    totalCoinsEl   = document.getElementById("wg-total-coins");
    stepsEl        = document.getElementById("wg-steps");
    modeChasersEl  = document.getElementById("wg-chasers-info");
    loadingEl      = document.getElementById("wg-loading");
    statusEl       = document.getElementById("wg-status");
    musicBtn       = document.getElementById("wg-music-toggle");
  }

  async function openGame() {
    if (!modal) modal = document.getElementById("wg-modal");
    cacheEls();
    modal.hidden = false;
    document.body.classList.add("game-open");
    syncMusicButton();
    playMusic();
    hideStatus();
    applyModeUI();
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
    stopMusic();
  }

  async function newWorld() {
    if (busy) return;
    busy = true;
    hideStatus();
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
    const mBtn = document.getElementById("wg-music-toggle");
    if (mBtn) mBtn.addEventListener("click", toggleMusic);
    if (modal) {
      modal.querySelectorAll("[data-close]").forEach((el) => {
        el.addEventListener("click", closeGame);
      });
      modal.querySelectorAll("[data-wg-mode]").forEach((b) => {
        b.addEventListener("click", () => changeMode(b.dataset.wgMode));
      });
      modal.querySelectorAll("[data-wg-algo]").forEach((b) => {
        b.addEventListener("click", () => changeAlgo(b.dataset.wgAlgo));
      });
      const hardBtn = document.getElementById("wg-hard");
      if (hardBtn) hardBtn.addEventListener("click", toggleHard);
      const seedUseBtn = document.getElementById("wg-seed-use");
      const seedRandBtn = document.getElementById("wg-seed-random");
      const seedInput = document.getElementById("wg-seed-input");
      if (seedUseBtn) seedUseBtn.addEventListener("click", () => {
        const v = (seedInput.value || "").trim();
        if (!/^\d+$/.test(v)) return;
        regenerateGame(v);
      });
      if (seedInput) seedInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const v = (seedInput.value || "").trim();
          if (/^\d+$/.test(v)) regenerateGame(v);
        }
      });
      if (seedRandBtn) seedRandBtn.addEventListener("click", () => {
        regenerateGame(randomSeed());
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
