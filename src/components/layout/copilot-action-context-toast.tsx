"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";

import {
  readLatestCopilotFocusTarget,
  subscribeCopilotFocusTarget,
  type CopilotFocusTarget
} from "@/components/layout/copilot-focus-target";

const DISPLAY_MS = 5200;
const MAX_AGE_MS = 5 * 60 * 1000;

export function CopilotActionContextToast() {
  const [target, setTarget] = useState<CopilotFocusTarget | null>(null);

  useEffect(() => {
    const initial = readLatestCopilotFocusTarget();
    if (isDisplayableTarget(initial)) {
      setTarget(initial);
    }
    const unsubscribe = subscribeCopilotFocusTarget((nextTarget) => {
      if (!isDisplayableTarget(nextTarget)) {
        return;
      }
      setTarget(nextTarget);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!target) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setTarget(null);
    }, DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [target]);

  const heading = useMemo(
    () => target?.actionLabel?.trim() || "Opened from Atlas Copilot",
    [target?.actionLabel]
  );
  const targetLabel = useMemo(() => target?.label?.trim() || null, [target?.label]);

  if (!target || !isDisplayableTarget(target)) {
    return null;
  }

  return (
    <aside className="pointer-events-none fixed right-5 top-20 z-[92] w-[min(430px,calc(100vw-2rem))]">
      <div className="pointer-events-auto relative overflow-hidden rounded-2xl border border-brand-100/90 bg-white/96 px-3.5 py-3.5 shadow-[0_18px_42px_rgba(15,23,42,0.18)] backdrop-blur-sm transition-all duration-200 ease-out">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500/90 via-indigo-500/85 to-cyan-500/80" />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700">
              <Sparkles size={11} />
              Atlas Copilot
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-900">{heading}</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setTarget(null)}
            aria-label="Dismiss action context"
          >
            <X size={12} />
          </button>
        </div>
        {targetLabel ? (
          <p className="mt-1 text-xs text-slate-600">
            Target: <span className="font-semibold text-slate-800">{targetLabel}</span>
          </p>
        ) : null}
        {target.reason ? <p className="mt-1.5 text-sm leading-5 text-slate-800">{target.reason}</p> : null}
        {target.inspectHint ? (
          <p className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Inspect next:</span> {target.inspectHint}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function isDisplayableTarget(target: CopilotFocusTarget | null) {
  if (!target) {
    return false;
  }
  if (Date.now() - target.requestedAt > MAX_AGE_MS) {
    return false;
  }
  return Boolean(
    (target.reason && target.reason.trim().length > 0) ||
      (target.inspectHint && target.inspectHint.trim().length > 0) ||
      (target.actionLabel && target.actionLabel.trim().length > 0)
  );
}
