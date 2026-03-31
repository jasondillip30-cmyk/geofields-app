"use client";

import { useEffect } from "react";

const STORAGE_KEY = "gf:copilot-focus-target";
const EVENT_NAME = "gf:copilot-focus-target";
const MAX_AGE_MS = 5 * 60 * 1000;

export interface CopilotFocusTarget {
  pageKey: string;
  targetId?: string | null;
  sectionId?: string | null;
  label?: string | null;
  actionLabel?: string | null;
  reason?: string | null;
  inspectHint?: string | null;
  source?: string | null;
  href?: string | null;
  requestedAt: number;
}

export function setCopilotFocusTarget(target: Omit<CopilotFocusTarget, "requestedAt">) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: CopilotFocusTarget = {
    ...target,
    requestedAt: Date.now()
  };

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

export function subscribeCopilotFocusTarget(listener: (target: CopilotFocusTarget) => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<CopilotFocusTarget>;
    if (!customEvent.detail) {
      return;
    }
    listener(customEvent.detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener);
  };
}

export function readLatestCopilotFocusTarget() {
  return readStoredFocusTarget();
}

export function useCopilotFocusTarget({
  pageKey,
  onFocus
}: {
  pageKey: string;
  onFocus: (target: CopilotFocusTarget) => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const maybeApply = (target: CopilotFocusTarget | null, consume: boolean) => {
      if (!target) {
        return;
      }
      if (!isFreshTarget(target)) {
        if (consume) {
          window.sessionStorage.removeItem(STORAGE_KEY);
        }
        return;
      }
      if (target.pageKey !== pageKey) {
        return;
      }
      onFocus(target);
      if (consume) {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    };

    maybeApply(readStoredFocusTarget(), true);

    const handleFocusEvent = (event: Event) => {
      const customEvent = event as CustomEvent<CopilotFocusTarget>;
      maybeApply(customEvent.detail || null, false);
    };

    window.addEventListener(EVENT_NAME, handleFocusEvent as EventListener);
    return () => {
      window.removeEventListener(EVENT_NAME, handleFocusEvent as EventListener);
    };
  }, [onFocus, pageKey]);
}

function readStoredFocusTarget() {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as CopilotFocusTarget;
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function isFreshTarget(target: CopilotFocusTarget) {
  return Date.now() - target.requestedAt <= MAX_AGE_MS;
}

export function scrollToFocusElement({
  sectionId,
  targetId
}: {
  sectionId?: string | null;
  targetId?: string | null;
}) {
  if (typeof window === "undefined") {
    return;
  }

  const selector = targetId
    ? `#ai-focus-${escapeId(targetId)}`
    : sectionId
      ? `#${escapeId(sectionId)}`
      : null;

  if (!selector) {
    return;
  }

  const element = window.document.querySelector(selector);
  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function escapeId(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9\-_]/g, "\\$&");
}
