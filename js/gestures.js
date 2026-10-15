// Pointer Events preserve native long-press selection and vertical scrolling.
export function swipeDirection(dx, dy, elapsed, width) {
  const threshold = Math.min(72, Math.max(42, width * 0.16));
  if (
    elapsed >= 450 ||
    Math.abs(dx) < threshold ||
    Math.abs(dx) < Math.abs(dy) * 1.5
  )
    return 0;
  return dx < 0 ? 1 : -1;
}
export function bindCardGestures(card, { flip, move, blocked = () => false }) {
  let gesture = null,
    suppressClick = false;
  const selected = () => !!window.getSelection()?.toString();
  const reset = () => {
    card.style.removeProperty("transform");
    card.classList.remove("dragging");
  };
  card.onpointerdown = (ev) => {
    if (
      ev.isPrimary === false ||
      (ev.pointerType === "mouse" && ev.button !== 0)
    ) {
      gesture = null;
      suppressClick = true;
      reset();
      return;
    }
    suppressClick = false;
    card.classList.remove("swipe-next", "swipe-previous", "flipping");
    if (blocked() || selected()) {
      suppressClick = true;
      return;
    }
    gesture = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      time: performance.now(),
      moved: false,
      cancelled: false,
    };
  };
  card.onpointermove = (ev) => {
    const g = gesture;
    if (!g || ev.pointerId !== g.id) return;
    const dx = ev.clientX - g.x,
      dy = ev.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) g.moved = true;
    if (
      performance.now() - g.time >= 450 ||
      selected() ||
      (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx))
    ) {
      g.cancelled = true;
      reset();
      return;
    }
    if (
      !g.cancelled &&
      Math.abs(dx) > 10 &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    ) {
      // Capture only after intent is horizontal; never cancel native selection.
      try {
        card.setPointerCapture(ev.pointerId);
      } catch {}
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const offset = Math.max(-56, Math.min(56, dx * 0.3));
        card.classList.add("dragging");
        card.style.transform = `translateX(${offset}px) rotate(${offset / 40}deg)`;
      }
    }
  };
  card.onpointerup = (ev) => {
    const g = gesture;
    gesture = null;
    reset();
    if (!g || ev.pointerId !== g.id) return;
    const elapsed = performance.now() - g.time;
    suppressClick = g.moved || g.cancelled || elapsed >= 450 || selected();
    if (g.cancelled || selected() || blocked()) return;
    const direction = swipeDirection(
      ev.clientX - g.x,
      ev.clientY - g.y,
      elapsed,
      card.clientWidth,
    );
    if (direction) {
      suppressClick = true;
      move(direction);
    } else if (!g.moved && elapsed < 450) {
      // Touch browsers may omit a compatibility click just after a swipe.
      // Commit the tap once here and ignore any later generated click.
      suppressClick = true;
      flip();
    }
  };
  card.onpointercancel = () => {
    gesture = null;
    suppressClick = true;
    reset();
  };
  card.onlostpointercapture = (ev) => {
    // Descendant text may relinquish implicit capture to the card mid-swipe.
    if (ev.target !== card) return;
    if (gesture) {
      gesture = null;
      suppressClick = true;
      reset();
    }
  };
  card.oncontextmenu = () => {
    if (gesture) gesture.cancelled = true;
    suppressClick = true;
    reset();
  };
  card.onclick = () => {
    if (!suppressClick && !selected() && !blocked()) flip();
  };
  card.onkeydown = (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || selected() || blocked())
      return;
    if (["Enter", " ", "ArrowLeft", "ArrowRight"].includes(ev.key)) {
      ev.preventDefault();
      if (ev.key === "ArrowLeft") move(1);
      else if (ev.key === "ArrowRight") move(-1);
      else flip();
    }
  };
}
