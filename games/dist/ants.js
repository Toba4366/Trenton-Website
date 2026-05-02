// Ants — runs Trenton's CS 61A ants.py implementation in-browser via Pyodide.
//
// His ants.py (compiled to opaque marshalled bytecode at games/dist/ants.bc)
// holds the Ant/Bee/Place class hierarchy, GameState, action methods. We
// stub `ucb` (a Berkeley course module that uses signal/inspect — not
// browser-friendly), bootstrap the ants module from the bytecode, then a
// thin Game wrapper drives one tick at a time so JS controls timing.
//
// The level / assault-plan definitions are written here in JS — we don't
// redistribute the staff's `ants_plans.py`. Sprites are course-staff
// material used per portfolio disclaimer in the modal.

(() => {
  const PYODIDE_VERSION = "0.25.1";
  const PYODIDE_LOADER = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
  const BC_URL = "games/dist/ants.bc?v=1";
  const TICK_MS = 1500;
  const MUSIC_PREF_KEY = "trenton-ants-music";

  let pyodide = null;
  let pyReady = null;
  let game = null;       // Python proxy
  let antTypes = [];     // [{name, cost, class_name}]
  let snapshot = null;   // last frame
  let timer = null;
  let busy = false;
  let selectedAnt = null;
  let difficulty = "normal";
  let water = false;

  // DOM
  let modal, gridEl, antBarEl, foodEl, timeEl, statusEl, loadingEl;
  let pauseBtn, restartBtn;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function ensurePyodide() {
    if (pyReady) return pyReady;
    pyReady = (async () => {
      if (typeof loadPyodide === "undefined") {
        await loadScript(PYODIDE_LOADER);
      }
      pyodide = await loadPyodide({
        indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
      });

      // Fetch & bootstrap Trenton's ants.py from bytecode.
      const bc = (await (await fetch(BC_URL)).text()).trim();
      pyodide.globals.set("__ANTS_BC__", bc);

      await pyodide.runPython(BOOTSTRAP_PY);
    })();
    return pyReady;
  }

  // Python bootstrap: stubs ucb, materialises ants module from bytecode,
  // defines a Game wrapper class. None of this is staff-derived code —
  // assault plans below are hand-written for portfolio demo purposes.
  const BOOTSTRAP_PY = `
import sys, types, marshal, base64

ucb_mod = types.ModuleType('ucb')
ucb_mod.main = lambda fn: fn
ucb_mod.interact = lambda *a, **kw: None
ucb_mod.trace = lambda fn: fn
sys.modules['ucb'] = ucb_mod

_code = marshal.loads(base64.b64decode(__ANTS_BC__))
ants = types.ModuleType('ants')
ants.__dict__['__name__'] = 'ants'
exec(_code, ants.__dict__)
sys.modules['ants'] = ants

class _Driver:
    def __init__(self, difficulty='normal', water=False, food=4):
        M = ants
        self.M = M
        plan = self._make_plan(difficulty)
        beehive = M.Hive(plan)
        layout_fn = M.wet_layout if water else M.dry_layout
        self.gamestate = M.GameState(
            strategy=lambda gs: None,
            beehive=beehive,
            ant_types=M.ant_types(),
            create_places=layout_fn,
            dimensions=(3, 9),
            food=food,
        )
        self.over = None
        self._plan = plan

    def _make_plan(self, difficulty):
        # Hand-rolled assault plans (not from staff ants_plans.py).
        # Each .add_wave(BeeType, health, time, count) just calls the public API
        # of AssaultPlan as defined in ants.py.
        M = ants
        P = M.AssaultPlan
        if difficulty == 'test':
            return P().add_wave(M.Bee, 3, 2, 1).add_wave(M.Bee, 3, 5, 1)
        if difficulty == 'easy':
            return (P()
                .add_wave(M.Bee, 3, 3, 2)
                .add_wave(M.Bee, 3, 6, 2)
                .add_wave(M.Bee, 3, 9, 3)
                .add_wave(M.Bee, 3, 12, 3))
        if difficulty == 'hard':
            return (P()
                .add_wave(M.Bee, 4, 2, 2)
                .add_wave(M.Bee, 4, 4, 3)
                .add_wave(M.Wasp, 4, 6, 1)
                .add_wave(M.Bee, 4, 8, 3)
                .add_wave(M.Hornet, 4, 10, 1)
                .add_wave(M.Bee, 4, 12, 3)
                .add_wave(M.Wasp, 4, 14, 2)
                .add_wave(M.Boss, 20, 16, 1))
        if difficulty == 'extra-hard':
            return (P()
                .add_wave(M.Bee, 5, 2, 3)
                .add_wave(M.Wasp, 5, 4, 2)
                .add_wave(M.Bee, 5, 6, 3)
                .add_wave(M.Hornet, 5, 8, 2)
                .add_wave(M.Bee, 5, 10, 4)
                .add_wave(M.Wasp, 5, 12, 2)
                .add_wave(M.Hornet, 5, 14, 2)
                .add_wave(M.Boss, 30, 16, 1)
                .add_wave(M.Bee, 5, 18, 4))
        # default: normal
        return (P()
            .add_wave(M.Bee, 3, 2, 2)
            .add_wave(M.Bee, 3, 4, 2)
            .add_wave(M.Wasp, 3, 6, 1)
            .add_wave(M.Bee, 3, 8, 3)
            .add_wave(M.Hornet, 3, 10, 1)
            .add_wave(M.Bee, 3, 12, 3)
            .add_wave(M.Boss, 20, 14, 1))

    def tick(self):
        if self.over:
            return self.over
        gs = self.gamestate
        try:
            gs.beehive.strategy(gs)
            for ant in gs.ants:
                if ant.health > 0:
                    ant.action(gs)
            for bee in gs.active_bees[:]:
                if bee.health > 0:
                    bee.action(gs)
                if bee.health <= 0:
                    gs.active_bees.remove(bee)
            gs.time += 1
            future = any(t >= gs.time for t in self._plan.keys())
            if not gs.active_bees and not future:
                self.over = 'win'
        except self.M.AntsLoseException:
            self.over = 'lose'
        except self.M.AntsWinException:
            self.over = 'win'
        return self.over

    def deploy(self, place_name, ant_name):
        gs = self.gamestate
        if ant_name not in gs.ant_types: return False
        ant_type = gs.ant_types[ant_name]
        if gs.food < ant_type.food_cost: return False
        place = gs.places.get(place_name)
        if place is None: return False
        try:
            ant = ant_type.construct(gs)
            if ant is None: return False
            place.add_insect(ant)
            gs.food -= ant.food_cost
            return True
        except Exception:
            return False

    def remove_ant(self, place_name):
        gs = self.gamestate
        place = gs.places.get(place_name)
        if not place or place.ant is None:
            return False
        try:
            place.remove_insect(place.ant)
            return True
        except Exception:
            return False

    def snapshot(self):
        gs = self.gamestate
        out_places = []
        for name, place in gs.places.items():
            ant = place.ant
            ant_data = None
            if ant is not None:
                contained = getattr(ant, 'ant_contained', None)
                contained_data = None
                if contained is not None:
                    contained_data = {
                        'type': type(contained).__name__,
                        'name': getattr(contained, 'name', type(contained).__name__),
                        'health': contained.health,
                    }
                ant_data = {
                    'type': type(ant).__name__,
                    'name': getattr(ant, 'name', type(ant).__name__),
                    'health': ant.health,
                    'is_container': bool(getattr(ant, 'is_container', False)),
                    'contained': contained_data,
                }
            bees = [
                {'type': type(b).__name__, 'health': b.health, 'id': id(b)}
                for b in place.bees
            ]
            out_places.append({
                'name': name,
                'ant': ant_data,
                'bees': bees,
                'is_water': isinstance(place, self.M.Water),
                'is_hive': bool(getattr(place, 'is_hive', False)),
                'is_base': name == 'Ant Home Base',
            })
        return {
            'time': gs.time,
            'food': gs.food,
            'places': out_places,
            'over': self.over,
            'pending_waves': sum(1 for t in self._plan.keys() if t >= gs.time),
        }

    def ant_types_info(self):
        return [
            {'name': name, 'cost': cls.food_cost, 'class_name': cls.__name__}
            for name, cls in self.gamestate.ant_types.items()
        ]

def make_game(difficulty, water):
    return _Driver(difficulty=difficulty, water=water)
`;

  // ── Game flow ───────────────────────────────────────────────────────
  async function newGame() {
    if (busy) return;
    busy = true;
    pause();
    showLoading("Setting up colony…");
    try {
      await ensurePyodide();
      const makeGame = pyodide.globals.get("make_game");
      if (game && game.destroy) game.destroy();
      game = makeGame(difficulty, water);
      makeGame.destroy();
      antTypes = game.ant_types_info().toJs({ dict_converter: Object.fromEntries });
      antTypes.forEach(t => t.cost = +t.cost);
      renderAntBar();
      readSnapshot();
      hideLoading();
      hideStatus();
      renderGrid();
      play();
    } catch (err) {
      console.error("[ants]", err);
      showLoading("Couldn't start: " + (err && err.message || err));
    } finally {
      busy = false;
    }
  }

  function readSnapshot() {
    const snap = game.snapshot();
    snapshot = snap.toJs({ dict_converter: Object.fromEntries });
    snap.destroy();
  }

  // ── Auto-tick ───────────────────────────────────────────────────────
  function play() {
    if (timer) return;
    pauseBtn.textContent = "⏸ Pause";
    timer = setInterval(stepGame, TICK_MS);
  }
  function pause() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    pauseBtn.textContent = "▶ Play";
  }
  function togglePlay() { timer ? pause() : play(); }

  function stepGame() {
    if (!game) return;
    game.tick();
    readSnapshot();
    renderGrid();
    renderHud();
    if (snapshot.over) {
      pause();
      const won = snapshot.over === "win";
      showStatus(won
        ? `🎉 Ants defended the colony in ${snapshot.time} ticks!`
        : `💀 The queen has perished. Hit “New game” to retry.`);
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────
  // Place naming convention from ants.py:
  //   "tunnel_{r}_{step}" or "water_{r}_{step}" — step 0 closest to base.
  //   "Ant Home Base"      — left side
  //   "Hive"               — right side
  function placeKind(name) {
    if (name === "Ant Home Base") return { kind: "base" };
    if (name === "Hive") return { kind: "hive" };
    const m = /^(tunnel|water)_(\d+)_(\d+)$/.exec(name);
    if (m) return { kind: m[1], row: +m[2], step: +m[3] };
    return { kind: "other" };
  }

  function renderHud() {
    foodEl.textContent = snapshot.food;
    timeEl.textContent = snapshot.time;
  }

  function renderAntBar() {
    antBarEl.innerHTML = "";
    for (const t of antTypes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ant-card";
      card.dataset.antName = t.name;
      const img = document.createElement("img");
      img.src = `games/dist/ants-img/ant_${t.class_name.toLowerCase().replace("ant", "")}.gif`;
      img.alt = t.name;
      img.onerror = () => {
        // fallback path: ant_<class>.gif if the simpler form isn't there
        img.onerror = null;
        img.src = `games/dist/ants-img/ant_${t.class_name.toLowerCase()}.gif`;
      };
      card.appendChild(img);
      const label = document.createElement("span");
      label.className = "ant-card-label";
      label.textContent = t.name;
      card.appendChild(label);
      const cost = document.createElement("span");
      cost.className = "ant-card-cost";
      cost.textContent = `🍃 ${t.cost}`;
      card.appendChild(cost);
      card.addEventListener("click", () => selectAnt(t.name));
      antBarEl.appendChild(card);
    }
    refreshAntBar();
  }

  function selectAnt(name) {
    selectedAnt = (selectedAnt === name ? null : name);
    refreshAntBar();
  }

  function refreshAntBar() {
    if (!antBarEl) return;
    const food = snapshot ? snapshot.food : 0;
    antBarEl.querySelectorAll(".ant-card").forEach(c => {
      const name = c.dataset.antName;
      const t = antTypes.find(x => x.name === name);
      c.classList.toggle("selected", selectedAnt === name);
      c.classList.toggle("disabled", food < t.cost);
    });
  }

  function renderGrid() {
    gridEl.innerHTML = "";
    // Group places by row; we want 3 rows (tunnels), each: [base, ...tunnel, hive].
    const rows = [[], [], []];
    let baseInfo = null, hiveInfo = null;
    for (const p of snapshot.places) {
      const k = placeKind(p.name);
      if (k.kind === "base") baseInfo = p;
      else if (k.kind === "hive") hiveInfo = p;
      else if (k.kind === "tunnel" || k.kind === "water") {
        rows[k.row] = rows[k.row] || [];
        rows[k.row][k.step] = { ...p, _kind: k.kind, _step: k.step };
      }
    }

    // Build row by row.
    for (let r = 0; r < rows.length; r++) {
      // Base column (only show on top-aligned cell that spans all rows visually).
      if (r === 0 && baseInfo) {
        const baseCell = makeCell(baseInfo, "base", r);
        baseCell.style.gridRow = `1 / span ${rows.length}`;
        gridEl.appendChild(baseCell);
      }
      const tunnel = rows[r] || [];
      // Tunnel cells: step 0 closest to base, increasing toward hive.
      for (let s = 0; s < tunnel.length; s++) {
        const cell = makeCell(tunnel[s], tunnel[s]._kind, r);
        gridEl.appendChild(cell);
      }
      if (r === 0 && hiveInfo) {
        const hiveCell = makeCell(hiveInfo, "hive", r);
        hiveCell.style.gridRow = `1 / span ${rows.length}`;
        gridEl.appendChild(hiveCell);
      }
    }

    // Set up grid template once we know dimensions.
    const tunnelLen = rows[0] ? rows[0].length : 9;
    gridEl.style.gridTemplateColumns = `auto repeat(${tunnelLen}, 1fr) auto`;
    gridEl.style.gridTemplateRows = `repeat(${rows.length}, 1fr)`;
  }

  function makeCell(p, kind, row) {
    const cell = document.createElement("div");
    cell.className = `ants-cell ants-cell-${kind}`;
    cell.dataset.placeName = p.name;

    if (kind === "tunnel" || kind === "water") {
      const skyN = ((rowSeed(p.name) % 3) + 1);
      const groundN = kind === "water" ? "water" : ((rowSeed(p.name) % 3) + 1);
      cell.style.backgroundImage =
        `url('games/dist/ants-img/tiles/sky/${skyN}.png'),` +
        `url('games/dist/ants-img/tiles/ground/${groundN}.png')`;
      cell.style.backgroundSize = "100% 50%, 100% 50%";
      cell.style.backgroundPosition = "top, bottom";
      cell.style.backgroundRepeat = "no-repeat, no-repeat";
      cell.addEventListener("click", () => onTileClick(p));
    } else if (kind === "base") {
      cell.classList.add("ants-base");
      cell.textContent = "🏠";
    } else if (kind === "hive") {
      cell.classList.add("ants-hive");
      cell.textContent = "🪺";
    }

    if (p.ant) {
      const ant = document.createElement("img");
      ant.className = "ants-sprite ants-ant";
      ant.src = antSpriteUrl(p.ant);
      ant.alt = p.ant.name;
      ant.title = `${p.ant.name} · HP ${p.ant.health}`;
      cell.appendChild(ant);
      if (p.ant.contained) {
        const contained = document.createElement("img");
        contained.className = "ants-sprite ants-ant-contained";
        contained.src = antSpriteUrl(p.ant.contained);
        contained.alt = p.ant.contained.name;
        contained.title = `${p.ant.contained.name} · HP ${p.ant.contained.health}`;
        cell.appendChild(contained);
      }
    }
    for (let i = 0; i < p.bees.length; i++) {
      const b = p.bees[i];
      const bee = document.createElement("img");
      bee.className = "ants-sprite ants-bee";
      bee.src = beeSpriteUrl(b);
      bee.alt = b.type;
      bee.title = `${b.type} · HP ${b.health}`;
      bee.style.transform = `translate(${(i % 3) * 8 - 8}px, ${(i % 2) * 6 - 3}px)`;
      cell.appendChild(bee);
    }
    return cell;
  }

  function rowSeed(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

  function antSpriteUrl(ant) {
    const cls = (ant.type || "").toLowerCase();
    // Strip trailing "ant" so HarvesterAnt → harvester
    let key = cls.replace(/ant$/, "");
    // Special cases
    if (key === "shortthrower") key = "shortthrower";
    if (key === "longthrower") key = "longthrower";
    return `games/dist/ants-img/ant_${key}.gif`;
  }
  function beeSpriteUrl(bee) {
    const t = (bee.type || "").toLowerCase();
    if (t === "boss") return "games/dist/ants-img/boss.gif";
    if (t === "hornet") return "games/dist/ants-img/hornet.gif";
    if (t === "wasp") return "games/dist/ants-img/hornet.gif"; // share if no wasp.gif
    return "games/dist/ants-img/bee.gif";
  }

  function onTileClick(p) {
    if (snapshot.over) return;
    if (selectedAnt === "Remover") {
      if (p.ant) game.remove_ant(p.name);
      readSnapshot();
      renderGrid();
      renderHud();
      refreshAntBar();
      return;
    }
    if (!selectedAnt) return;
    if (p.ant && !(p.ant.is_container && !p.ant.contained)) return;
    if (p.is_water) {
      const t = antTypes.find(x => x.name === selectedAnt);
      // Only Scuba is waterproof; others fail. Trust Python's deploy() check.
    }
    const ok = game.deploy(p.name, selectedAnt);
    if (ok) {
      readSnapshot();
      renderGrid();
      renderHud();
      refreshAntBar();
    }
  }

  // ── Modal lifecycle ─────────────────────────────────────────────────
  function cacheEls() {
    gridEl     = document.getElementById("ants-grid");
    antBarEl   = document.getElementById("ants-types");
    foodEl     = document.getElementById("ants-food");
    timeEl     = document.getElementById("ants-time");
    statusEl   = document.getElementById("ants-status");
    loadingEl  = document.getElementById("ants-loading");
    pauseBtn   = document.getElementById("ants-pause");
    restartBtn = document.getElementById("ants-restart");
  }

  function showLoading(text) {
    if (!loadingEl) return;
    loadingEl.hidden = false;
    loadingEl.textContent = text;
    if (gridEl) gridEl.hidden = true;
  }
  function hideLoading() {
    if (loadingEl) loadingEl.hidden = true;
    if (gridEl) gridEl.hidden = false;
  }
  function showStatus(text) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = text;
  }
  function hideStatus() { if (statusEl) statusEl.hidden = true; }

  async function openGame() {
    if (!modal) modal = document.getElementById("ants-modal");
    cacheEls();
    modal.hidden = false;
    document.body.classList.add("game-open");
    showLoading("Booting Python in your browser… (first load is ~12s)");
    try {
      await ensurePyodide();
      await newGame();
    } catch (err) {
      console.error("[ants]", err);
      showLoading("Couldn't start Python: " + (err && err.message || err));
    }
  }

  function closeGame() {
    if (!modal) return;
    pause();
    modal.hidden = true;
    document.body.classList.remove("game-open");
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    modal = document.getElementById("ants-modal");
    document.querySelectorAll("[data-game='ants']").forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove("card-link-muted");
      btn.textContent = "Play in browser ↗";
      btn.addEventListener("click", openGame);
    });
    const closeBtn = document.getElementById("ants-close");
    if (closeBtn) closeBtn.addEventListener("click", closeGame);
    if (modal) {
      modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeGame));
      modal.querySelectorAll("[data-ants-diff]").forEach((b) =>
        b.addEventListener("click", () => {
          difficulty = b.dataset.antsDiff;
          modal.querySelectorAll("[data-ants-diff]").forEach(x =>
            x.setAttribute("aria-pressed", x === b ? "true" : "false"));
          newGame();
        }));
      const waterBtn = document.getElementById("ants-water");
      if (waterBtn) waterBtn.addEventListener("click", () => {
        water = !water;
        waterBtn.setAttribute("aria-pressed", String(water));
        newGame();
      });
      const pauseB = document.getElementById("ants-pause");
      if (pauseB) pauseB.addEventListener("click", togglePlay);
      const restartB = document.getElementById("ants-restart");
      if (restartB) restartB.addEventListener("click", newGame);
    }
    window.addEventListener("keydown", (e) => {
      if (modal && !modal.hidden && e.key === "Escape") closeGame();
    });
  });
})();
