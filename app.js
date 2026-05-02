// Trenton-Website · interactivity
// custom cursor · scroll reveals · magnetic buttons · word rotator
// hero blob parallax · konami easter egg

(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // ── console wink ──────────────────────────────────────────
  console.log(
    "%cHey 👋",
    "font: 700 22px ui-serif, Georgia; color: #003262;"
  );
  console.log(
    "%cIf you're reading this you've probably either built a site too or you're poking around. Either way — say hi: toba4366@berkeley.edu",
    "font: 14px ui-sans-serif, system-ui; color: #15131c;"
  );

  // ── custom cursor ────────────────────────────────────────
  if (finePointer && !reduced) {
    const dot = document.querySelector(".cursor-dot");
    const ring = document.querySelector(".cursor-ring");
    let mx = 0, my = 0;
    let rx = 0, ry = 0;

    window.addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
    });

    const tick = () => {
      // ring lags slightly for a soft trail
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(tick);
    };
    tick();

    const hoverables = "a, button, .magnetic, .card, .poster, .scroll-nudge, .timeline li";
    document.querySelectorAll(hoverables).forEach((el) => {
      el.addEventListener("mouseenter", () => ring.classList.add("is-hover"));
      el.addEventListener("mouseleave", () => ring.classList.remove("is-hover"));
    });

    // hide when cursor leaves window
    document.addEventListener("mouseleave", () => {
      dot.style.opacity = "0"; ring.style.opacity = "0";
    });
    document.addEventListener("mouseenter", () => {
      dot.style.opacity = ""; ring.style.opacity = "";
    });
  }

  // ── scroll reveals ───────────────────────────────────────
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-in"));
  }

  // ── word rotator ─────────────────────────────────────────
  const words = Array.from(document.querySelectorAll(".rotator-word"));
  if (words.length > 1 && !reduced) {
    let i = 0;
    setInterval(() => {
      const current = words[i];
      const next = words[(i + 1) % words.length];
      current.classList.remove("is-active");
      current.classList.add("is-leaving");
      setTimeout(() => current.classList.remove("is-leaving"), 500);
      next.classList.add("is-active");
      i = (i + 1) % words.length;
    }, 2200);
  }

  // ── magnetic buttons ─────────────────────────────────────
  if (finePointer && !reduced) {
    const strength = 18;
    document.querySelectorAll(".magnetic").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        el.style.transform = `translate(${(dx / rect.width) * strength}px, ${(dy / rect.height) * strength}px)`;
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
      });
    });
  }

  // ── hero parallax (mouse + scroll) ───────────────────────
  if (!reduced) {
    const blobs = document.querySelectorAll(".blob");
    const hero = document.querySelector(".hero");
    if (hero && blobs.length) {
      hero.addEventListener("mousemove", (e) => {
        const x = (e.clientX / window.innerWidth) - 0.5;
        const y = (e.clientY / window.innerHeight) - 0.5;
        blobs.forEach((b, idx) => {
          const depth = (idx + 1) * 18;
          b.style.transform = `translate(${x * depth}px, ${y * depth}px)`;
        });
      });
    }
  }

  // ── KONAMI-ish: ↑↑↓↓←→←→ T O B → confetti rain ─────────
  const KONAMI = [
    "ArrowUp","ArrowUp","ArrowDown","ArrowDown",
    "ArrowLeft","ArrowRight","ArrowLeft","ArrowRight",
    "t","o","b"
  ];
  let buf = [];
  const colors = ["#fdb515", "#003262", "#f25c54", "#6c4ab6", "#15131c"];

  window.addEventListener("keydown", (e) => {
    buf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (buf.length > KONAMI.length) buf.shift();
    if (buf.length === KONAMI.length && buf.every((k, i) => k === KONAMI[i])) {
      buf = [];
      partyTime();
    }
  });

  function partyTime() {
    console.log("%cGO BEARS 🐻💛", "font: 700 18px ui-serif; color: #fdb515; background: #003262; padding: 4px 10px; border-radius: 4px;");
    const N = 140;
    for (let i = 0; i < N; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[(Math.random() * colors.length) | 0];
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);

      const dx = (Math.random() - 0.5) * 600;
      const dur = 2200 + Math.random() * 1800;
      const delay = Math.random() * 400;

      piece.animate(
        [
          { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${dx}px, ${window.innerHeight + 80}px) rotate(${Math.random() * 1080}deg)`, opacity: 0.9 }
        ],
        { duration: dur, delay, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
      ).onfinish = () => piece.remove();
    }
  }
})();

// Timeline year marker — updates as user scrolls through the wall.
// The marker itself is `position: sticky` (CSS); JS just swaps the year
// text to whichever research piece is closest to the marker's vertical
// center on the viewport.
(() => {
  const yearEl = document.getElementById("timeline-year");
  if (!yearEl) return;
  const pieces = Array.from(document.querySelectorAll(".research-piece[data-year]"));
  if (pieces.length === 0) return;
  const marker = document.querySelector(".timeline-marker");

  let raf = null;
  function update() {
    raf = null;
    const halfMarker = (marker?.offsetHeight || 56) / 2;
    const markerY = window.innerHeight * 0.38 + halfMarker;
    let active = pieces[0];
    let bestScore = -Infinity;
    for (const p of pieces) {
      const rect = p.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const center = rect.top + rect.height / 2;
      const score = -Math.abs(center - markerY);
      if (score > bestScore) {
        bestScore = score;
        active = p;
      }
    }
    const target = active.dataset.year;
    if (yearEl.textContent !== target) {
      yearEl.textContent = target;
      if (marker) {
        marker.classList.add("tick");
        setTimeout(() => marker.classList.remove("tick"), 260);
      }
    }
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", update);
  } else {
    update();
  }
})();

// Coding-samples + page-wide parallax:
//   1. Giant 01/02 numerals behind each sample piece drift opposite to scroll
//   2. Image inside each sample-frame drifts subtly (existing effect)
//   3. Site-wide stacked depth layers (blobs / dots / glyphs) translate at
//      different speeds for a deeper background.
(() => {
  const pieces = Array.from(document.querySelectorAll(".sample-piece"));
  const blobs  = document.querySelector(".bg-depth-blobs");
  const dots   = document.querySelector(".bg-depth-dots");
  const glyphs = document.querySelector(".bg-depth-glyphs");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  let raf = null;
  function update() {
    raf = null;
    const vh = window.innerHeight;
    const viewCenter = vh / 2;

    // Sample-piece numerals + image drift
    for (const p of pieces) {
      const rect = p.getBoundingClientRect();
      if (rect.bottom < -300 || rect.top > vh + 300) continue;
      const center = rect.top + rect.height / 2;
      const offset = (center - viewCenter) / vh; // -1..+1ish

      // Giant numeral: drift opposite to scroll direction (deeper than text)
      p.style.setProperty("--numeral-y", (-offset * 80) + "px");

      // Image inside frame: smaller drift, same direction
      const img = p.querySelector(".sample-frame img");
      if (img) img.style.setProperty("--parallax-y", (-offset * 30) + "px");
    }

    // Site-wide stacked depth layers — different speeds = "depth"
    const y = window.scrollY;
    if (blobs)  blobs.style.transform  = `translateY(${(-y * 0.18).toFixed(1)}px)`;
    if (dots)   dots.style.transform   = `translateY(${(-y * 0.45).toFixed(1)}px)`;
    if (glyphs) glyphs.style.transform = `translateY(${(-y * 0.72).toFixed(1)}px)`;
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(update); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", update);
  } else {
    update();
  }
})();

// Pinned-poster videos: autoplay (muted) when scrolled into view, pause when out.
// Video starts muted because browsers block unmuted autoplay; the native
// controls expose a volume button so the user can unmute manually.
(() => {
  const videos = document.querySelectorAll(".poster-media-video video");
  if (videos.length === 0 || !("IntersectionObserver" in window)) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const v = entry.target;
      if (entry.isIntersecting) {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.45 });
  videos.forEach((v) => io.observe(v));
})();
