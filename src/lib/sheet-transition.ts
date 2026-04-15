export type SheetTransitionDirection = "up" | "down";

interface NavigateWithSheetTransitionOptions {
  direction: SheetTransitionDirection;
  onNavigate: () => void;
  navigateDelayMs?: number;
  durationMs?: number;
}

let transitionActive = false;

export function navigateWithSheetTransition({
  direction,
  onNavigate,
  navigateDelayMs = 220,
  durationMs = 440
}: NavigateWithSheetTransitionOptions) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    onNavigate();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onNavigate();
    return;
  }

  if (transitionActive) {
    return;
  }

  transitionActive = true;

  const overlay = document.createElement("div");
  overlay.className = `gf-sheet-transition-overlay gf-sheet-transition-${direction}`;
  document.body.appendChild(overlay);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    transitionActive = false;
    overlay.remove();
  };

  requestAnimationFrame(() => {
    overlay.classList.add("is-active");
  });

  const navigateTimer = window.setTimeout(() => {
    try {
      onNavigate();
    } catch {
      cleanup();
    }
  }, navigateDelayMs);

  const cleanupTimer = window.setTimeout(() => {
    cleanup();
    window.clearTimeout(navigateTimer);
  }, Math.max(durationMs + 100, navigateDelayMs + 240));

  window.addEventListener(
    "pagehide",
    () => {
      cleanup();
      window.clearTimeout(navigateTimer);
      window.clearTimeout(cleanupTimer);
    },
    { once: true }
  );
}
