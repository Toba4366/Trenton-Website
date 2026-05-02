// Click-to-zoom lightbox for posters/diploma. Plain JS, no deps.
// Mouse wheel zooms; drag to pan when zoomed; pinch on touch.

(() => {
  let modal, img, scale = 1, tx = 0, ty = 0;
  let dragging = false, dragStart = null;
  let pinchStart = null;

  function init() {
    modal = document.createElement("div");
    modal.className = "poster-lightbox";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Poster viewer");
    modal.innerHTML = `
      <div class="poster-lightbox-bg" data-close></div>
      <button class="poster-lightbox-close" type="button" aria-label="Close">×</button>
      <div class="poster-lightbox-stage">
        <img alt="" draggable="false" />
      </div>
      <div class="poster-lightbox-controls">
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="reset" aria-label="Reset zoom">Fit</button>
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <span class="poster-lightbox-hint">Scroll to zoom · drag to pan · Esc to close</span>
      </div>
    `;
    document.body.appendChild(modal);
    img = modal.querySelector("img");

    modal.querySelectorAll("[data-close], .poster-lightbox-close").forEach(el =>
      el.addEventListener("click", close));
    modal.querySelector('[data-zoom="in"]').addEventListener("click", () => zoom(1.4));
    modal.querySelector('[data-zoom="out"]').addEventListener("click", () => zoom(1/1.4));
    modal.querySelector('[data-zoom="reset"]').addEventListener("click", reset);

    modal.addEventListener("wheel", onWheel, { passive: false });
    img.addEventListener("mousedown", onDragStart);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);

    img.addEventListener("touchstart", onTouchStart, { passive: false });
    img.addEventListener("touchmove", onTouchMove, { passive: false });
    img.addEventListener("touchend", onTouchEnd);

    img.addEventListener("dblclick", onDoubleClick);

    window.addEventListener("keydown", e => {
      if (modal.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "+" || e.key === "=") zoom(1.4);
      else if (e.key === "-" || e.key === "_") zoom(1/1.4);
      else if (e.key === "0") reset();
    });

    // Wire all poster-style images.
    const targets = "" +
      ".research-frame img, " +
      ".diploma-frame-inner img, " +
      ".poster-media img, " +
      ".card-with-media .card-media img";
    document.querySelectorAll(targets).forEach(el => {
      el.style.cursor = "zoom-in";
      // Some posters have pointer-events: none to prevent drag — bypass for click.
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        open(el.currentSrc || el.src, el.alt);
      });
      // The diploma img has pointer-events: none in CSS; also wire its parent.
      const wrap = el.closest(".diploma-frame-inner");
      if (wrap) wrap.addEventListener("click", () => open(el.currentSrc || el.src, el.alt));
    });
  }

  function open(src, alt) {
    if (!src) return;
    img.src = src;
    img.alt = alt || "";
    modal.hidden = false;
    document.body.classList.add("lightbox-open");
    reset();
  }
  function close() {
    modal.hidden = true;
    document.body.classList.remove("lightbox-open");
  }
  function reset() { scale = 1; tx = 0; ty = 0; apply(true); }
  function apply(snap) {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.transition = snap ? "transform 0.2s ease" : "none";
  }
  function clampScale(s) { return Math.max(0.5, Math.min(8, s)); }

  function zoom(factor) {
    const newScale = clampScale(scale * factor);
    if (newScale === scale) return;
    scale = newScale;
    if (scale === 1) { tx = 0; ty = 0; }
    apply(true);
  }
  function onWheel(e) {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(f);
  }
  function onDragStart(e) {
    if (scale <= 1) return;
    dragging = true;
    dragStart = [e.clientX - tx, e.clientY - ty];
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!dragging) return;
    tx = e.clientX - dragStart[0];
    ty = e.clientY - dragStart[1];
    apply(false);
  }
  function onDragEnd() { dragging = false; }
  function onDoubleClick() {
    if (scale > 1) reset();
    else { scale = 2.4; apply(true); }
  }

  function getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchStart = { dist: getPinchDist(e.touches), scale };
      dragging = false;
    } else if (e.touches.length === 1 && scale > 1) {
      dragging = true;
      dragStart = [e.touches[0].clientX - tx, e.touches[0].clientY - ty];
    }
  }
  function onTouchMove(e) {
    if (e.touches.length === 2 && pinchStart) {
      e.preventDefault();
      const newDist = getPinchDist(e.touches);
      scale = clampScale(pinchStart.scale * (newDist / pinchStart.dist));
      apply(false);
    } else if (e.touches.length === 1 && dragging) {
      e.preventDefault();
      tx = e.touches[0].clientX - dragStart[0];
      ty = e.touches[0].clientY - dragStart[1];
      apply(false);
    }
  }
  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      dragging = false;
      pinchStart = null;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
