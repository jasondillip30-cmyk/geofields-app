"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent
} from "react";
import { useRouter } from "next/navigation";

import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { GlobeInteractive } from "@/components/ui/cobe-globe-interactive";
import {
  applyScopeIntentToSession,
  type AnalyticsScopeIntent
} from "@/lib/analytics-scope";
import { canAccess } from "@/lib/auth/permissions";
import {
  buildWorkshopScopedHref,
  canUseWorkshopFromLaunch,
  canUnlockAllProjectsFromLaunch,
  resolveProjectLaunchDestination,
  resolveWorkshopLaunchDestination
} from "@/lib/auth/workspace-launch-access";
import {
  buildDeterministicProjectMarkers,
  FALLBACK_WORKSPACE_MARKERS,
  type WorkspaceLaunchMarker
} from "@/lib/workspace-launch-markers";

interface WorkspaceLaunchLayerProps {
  open: boolean;
  onRequestClose: () => void;
}

interface ApiProjectRow {
  id: string;
  name: string;
  status?: string | null;
}

const UNLOCK_THRESHOLD = 0.5;
const PROGRESS_PER_WHEEL_PIXEL = 1 / 320;
const PROGRESS_PER_TOUCH_PIXEL = 1 / 340;
const TOUCH_UNLOCK_DELTA_PX = 120;
const BOTTOM_EDGE_SWIPE_ZONE_PX = 96;

let markerCache: { markers: WorkspaceLaunchMarker[]; hasLive: boolean } | null = null;
let safeAreaProbeElement: HTMLDivElement | null = null;

export function WorkspaceLaunchLayer({ open, onRequestClose }: WorkspaceLaunchLayerProps) {
  const router = useRouter();
  const { role } = useRole();
  const { filters, applyScope } = useAnalyticsFilters();

  const [markers, setMarkers] = useState<WorkspaceLaunchMarker[]>(
    markerCache?.markers || FALLBACK_WORKSPACE_MARKERS
  );
  const [hasLiveProjectMarkers, setHasLiveProjectMarkers] = useState(Boolean(markerCache?.hasLive));
  const [progress, setProgress] = useState(open ? 0 : 1);
  const [isInteracting, setIsInteracting] = useState(false);
  const progressRef = useRef(progress);
  const commitInFlightRef = useRef(false);
  const finalizeTimerRef = useRef<number | null>(null);
  const touchLastYRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const suppressMarkerClicksUntilRef = useRef(0);
  const touchStartedOnInteractiveControlRef = useRef(false);
  const touchGestureArmedRef = useRef(false);
  const lastPointerYRef = useRef<number | null>(null);
  const wheelUnlockDirectionRef = useRef<1 | -1 | 0>(0);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (open) {
      commitInFlightRef.current = false;
      setIsInteracting(false);
      setProgress(0);
      progressRef.current = 0;
      wheelUnlockDirectionRef.current = 0;
      touchGestureArmedRef.current = false;
      touchStartYRef.current = null;
      touchMovedRef.current = false;
      suppressMarkerClicksUntilRef.current = 0;
      return;
    }
    commitInFlightRef.current = false;
    setIsInteracting(false);
    setProgress(1);
    progressRef.current = 1;
    wheelUnlockDirectionRef.current = 0;
    touchGestureArmedRef.current = false;
    touchStartYRef.current = null;
    touchMovedRef.current = false;
    suppressMarkerClicksUntilRef.current = 0;
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadProjectNodes() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          if (!cancelled) {
            setMarkers(FALLBACK_WORKSPACE_MARKERS);
            setHasLiveProjectMarkers(false);
            markerCache = { markers: FALLBACK_WORKSPACE_MARKERS, hasLive: false };
          }
          return;
        }

        const payload = (await response.json()) as { data?: ApiProjectRow[] };
        const projects = Array.isArray(payload.data) ? payload.data : [];
        const projectMarkers = buildDeterministicProjectMarkers(projects);
        if (projectMarkers.length === 0) {
          if (!cancelled) {
            setMarkers(FALLBACK_WORKSPACE_MARKERS);
            setHasLiveProjectMarkers(false);
            markerCache = { markers: FALLBACK_WORKSPACE_MARKERS, hasLive: false };
          }
          return;
        }

        if (!cancelled) {
          setMarkers(projectMarkers);
          setHasLiveProjectMarkers(true);
          markerCache = { markers: projectMarkers, hasLive: true };
        }
      } catch {
        if (!cancelled) {
          setMarkers(FALLBACK_WORKSPACE_MARKERS);
          setHasLiveProjectMarkers(false);
          markerCache = { markers: FALLBACK_WORKSPACE_MARKERS, hasLive: false };
        }
      }
    }

    void loadProjectNodes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const markerSelectableById = useMemo(
    () => Object.fromEntries(markers.map((marker) => [marker.id, hasLiveProjectMarkers])),
    [hasLiveProjectMarkers, markers]
  );

  const allProjectsDestination = useMemo(() => {
    if (role && canAccess(role, "dashboard:view")) {
      return "/";
    }
    if (role && canAccess(role, "projects:view")) {
      return "/projects";
    }
    return "/rigs";
  }, [role]);

  const workshopDestination = useMemo(() => {
    return resolveWorkshopLaunchDestination(role);
  }, [role]);
  const canUseWorkshopEntry = useMemo(() => canUseWorkshopFromLaunch(role), [role]);
  const canUnlockAllProjects = useMemo(() => canUnlockAllProjectsFromLaunch(role), [role]);

  const withSharedDateQuery = useCallback(
    (baseParams?: URLSearchParams) => {
      const params = baseParams || new URLSearchParams();
      if (filters.from) {
        params.set("from", filters.from);
      }
      if (filters.to) {
        params.set("to", filters.to);
      }
      return params;
    },
    [filters.from, filters.to]
  );

  const closeAndNavigate = useCallback(
    (href: string, intent: AnalyticsScopeIntent) => {
      if (commitInFlightRef.current) {
        return;
      }
      commitInFlightRef.current = true;
      applyScopeIntentToSession(intent);
      applyScope(intent);
      setIsInteracting(false);
      setProgress(1);
      progressRef.current = 1;
      wheelUnlockDirectionRef.current = 0;
      window.setTimeout(() => {
        onRequestClose();
        router.push(href);
        if (typeof window !== "undefined") {
          const targetUrl = new URL(href, window.location.origin);
          const targetPathWithQuery = `${targetUrl.pathname}${targetUrl.search}`;
          window.setTimeout(() => {
            const currentPathWithQuery = `${window.location.pathname}${window.location.search}`;
            if (currentPathWithQuery !== targetPathWithQuery) {
              window.location.assign(targetPathWithQuery);
            }
          }, 420);
        }
        commitInFlightRef.current = false;
      }, 210);
    },
    [applyScope, onRequestClose, router]
  );

  const handleUnlockToAllProjects = useCallback(() => {
    const params = withSharedDateQuery();
    params.set("workspace", "all-projects");
    params.set("projectId", "all");
    params.set("clientId", "all");
    params.set("rigId", "all");
    closeAndNavigate(`${allProjectsDestination}?${params.toString()}`, {
      workspaceMode: "all-projects",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from: filters.from,
      to: filters.to
    });
  }, [allProjectsDestination, closeAndNavigate, filters.from, filters.to, withSharedDateQuery]);

  const handleOpenWorkshop = useCallback(() => {
    if (!canUseWorkshopEntry) {
      return;
    }
    closeAndNavigate(
      buildWorkshopScopedHref(workshopDestination, {
        from: filters.from,
        to: filters.to
      }),
      {
      workspaceMode: "workshop",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from: filters.from,
      to: filters.to
      }
    );
  }, [canUseWorkshopEntry, closeAndNavigate, filters.from, filters.to, workshopDestination]);

  const handleOpenProjectOperations = useCallback(
    (markerId: string) => {
      if (!hasLiveProjectMarkers || commitInFlightRef.current) {
        return;
      }
      const marker = markers.find((entry) => entry.id === markerId);
      if (!marker) {
        return;
      }
      const params = withSharedDateQuery();
      params.set("workspace", "project");
      params.set("projectId", marker.id);
      params.set("clientId", "all");
      params.set("rigId", "all");
      const destination = resolveProjectLaunchDestination(role);
      closeAndNavigate(`${destination}?${params.toString()}`, {
        workspaceMode: "project",
        projectId: marker.id,
        clientId: "all",
        rigId: "all",
        from: filters.from,
        to: filters.to
      });
    },
    [closeAndNavigate, filters.from, filters.to, hasLiveProjectMarkers, markers, role, withSharedDateQuery]
  );

  const finalizeGesture = useCallback(() => {
    if (!open || commitInFlightRef.current) {
      return;
    }
    setIsInteracting(false);
    if (!canUnlockAllProjects) {
      setProgress(0);
      progressRef.current = 0;
      wheelUnlockDirectionRef.current = 0;
      return;
    }
    if (progressRef.current >= UNLOCK_THRESHOLD) {
      handleUnlockToAllProjects();
      return;
    }
    setProgress(0);
    progressRef.current = 0;
    wheelUnlockDirectionRef.current = 0;
  }, [canUnlockAllProjects, handleUnlockToAllProjects, open]);

  const scheduleFinalizeGesture = useCallback(() => {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
    }
    finalizeTimerRef.current = window.setTimeout(() => {
      finalizeTimerRef.current = null;
      finalizeGesture();
    }, 140);
  }, [finalizeGesture]);

  const adjustProgress = useCallback((nextValue: number) => {
    const clamped = clamp(nextValue, 0, 1);
    setProgress(clamped);
    progressRef.current = clamped;
  }, []);

  const processWheelIntent = useCallback(
    (deltaY: number, clientY: number, target: EventTarget | null, preventDefault?: () => void) => {
      if (!open || commitInFlightRef.current) {
        return;
      }
      if (!canUnlockAllProjects) {
        return;
      }
      if (isInteractiveGestureTarget(target)) {
        return;
      }
      const effectiveClientY = resolveGestureClientY(clientY, lastPointerYRef.current);
      if (requiresBottomZoneForWheelUnlock() && !isWithinBottomEdgeGestureZone(effectiveClientY)) {
        return;
      }
      if (Math.abs(deltaY) < 0.5) {
        return;
      }
      preventDefault?.();
      setIsInteracting(true);
      if (wheelUnlockDirectionRef.current === 0) {
        wheelUnlockDirectionRef.current = deltaY >= 0 ? 1 : -1;
      }
      const normalizedDelta = deltaY * wheelUnlockDirectionRef.current;
      if (progressRef.current <= 0.02 && normalizedDelta < 0) {
        wheelUnlockDirectionRef.current = deltaY >= 0 ? 1 : -1;
      }
      const nextProgress = clamp(progressRef.current + normalizedDelta * PROGRESS_PER_WHEEL_PIXEL, 0, 1);
      adjustProgress(nextProgress);
      if (nextProgress >= UNLOCK_THRESHOLD && wheelUnlockDirectionRef.current === 1) {
        handleUnlockToAllProjects();
        return;
      }
      scheduleFinalizeGesture();
    },
    [adjustProgress, canUnlockAllProjects, handleUnlockToAllProjects, open, scheduleFinalizeGesture]
  );

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!open || commitInFlightRef.current) {
      return;
    }
    if (!canUnlockAllProjects) {
      setIsInteracting(false);
      touchGestureArmedRef.current = false;
      return;
    }
    touchStartedOnInteractiveControlRef.current = isInteractiveGestureTarget(event.target);
    const touchStartY = event.touches[0]?.clientY ?? null;
    touchLastYRef.current = touchStartY;
    touchStartYRef.current = touchStartY;
    touchMovedRef.current = false;
    lastPointerYRef.current = touchStartY;
    touchGestureArmedRef.current = false;
    if (
      touchStartedOnInteractiveControlRef.current ||
      touchStartY === null ||
      !isWithinBottomEdgeGestureZone(touchStartY)
    ) {
      setIsInteracting(false);
      return;
    }
    touchGestureArmedRef.current = true;
    setIsInteracting(true);
  }, [canUnlockAllProjects, open]);

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!open || commitInFlightRef.current) {
        return;
      }
      if (touchStartedOnInteractiveControlRef.current || !touchGestureArmedRef.current) {
        return;
      }
      const currentY = event.touches[0]?.clientY ?? null;
      const previousY = touchLastYRef.current;
      if (currentY === null || previousY === null) {
        return;
      }
      event.preventDefault();
      const deltaY = currentY - previousY;
      touchLastYRef.current = currentY;
      if (Math.abs(deltaY) > 2) {
        touchMovedRef.current = true;
      }
      adjustProgress(progressRef.current + -deltaY * PROGRESS_PER_TOUCH_PIXEL);
    },
    [adjustProgress, open]
  );

  const finalizeTouchGesture = useCallback(
    (touchEndY: number | null) => {
      if (!open || commitInFlightRef.current) {
        return;
      }
      if (!canUnlockAllProjects) {
        touchMovedRef.current = false;
        touchLastYRef.current = null;
        touchStartYRef.current = null;
        touchStartedOnInteractiveControlRef.current = false;
        touchGestureArmedRef.current = false;
        setIsInteracting(false);
        return;
      }
      const touchStartY = touchStartYRef.current;
      const resolvedTouchEndY =
        typeof touchEndY === "number" ? touchEndY : touchLastYRef.current;
      if (touchMovedRef.current) {
        suppressMarkerClicksUntilRef.current = Date.now() + 420;
      }
      touchMovedRef.current = false;
      touchLastYRef.current = null;
      touchStartYRef.current = null;
      if (touchStartedOnInteractiveControlRef.current || !touchGestureArmedRef.current) {
        touchStartedOnInteractiveControlRef.current = false;
        touchGestureArmedRef.current = false;
        setIsInteracting(false);
        return;
      }
      touchStartedOnInteractiveControlRef.current = false;
      touchGestureArmedRef.current = false;
      if (
        typeof touchStartY === "number" &&
        typeof resolvedTouchEndY === "number" &&
        touchStartY - resolvedTouchEndY >= TOUCH_UNLOCK_DELTA_PX
      ) {
        handleUnlockToAllProjects();
        return;
      }
      finalizeGesture();
    },
    [canUnlockAllProjects, finalizeGesture, handleUnlockToAllProjects, open]
  );

  const handleTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      finalizeTouchGesture(event.changedTouches[0]?.clientY ?? null);
    },
    [finalizeTouchGesture]
  );

  const handleTouchCancel = useCallback(() => {
    touchMovedRef.current = false;
    finalizeTouchGesture(null);
  }, [finalizeTouchGesture]);

  const isMarkerClickSuppressed = useCallback(
    () => Date.now() < suppressMarkerClicksUntilRef.current,
    []
  );

  useEffect(() => {
    return () => {
      if (finalizeTimerRef.current !== null) {
        window.clearTimeout(finalizeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleWindowTouchEnd = (event: TouchEvent) => {
      finalizeTouchGesture(event.changedTouches[0]?.clientY ?? null);
    };
    const handleWindowTouchCancel = () => {
      finalizeTouchGesture(null);
    };
    window.addEventListener("touchend", handleWindowTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleWindowTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchend", handleWindowTouchEnd);
      window.removeEventListener("touchcancel", handleWindowTouchCancel);
    };
  }, [finalizeTouchGesture, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleWindowWheel = (event: WheelEvent) => {
      processWheelIntent(event.deltaY, event.clientY, event.target, () => event.preventDefault());
    };
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!Number.isFinite(event.clientY) || event.clientY <= 0) {
        return;
      }
      lastPointerYRef.current = event.clientY;
    };
    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!Number.isFinite(event.clientY) || event.clientY <= 0) {
        return;
      }
      lastPointerYRef.current = event.clientY;
    };
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: true });
    window.addEventListener("mousemove", handleWindowMouseMove, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleWindowWheel);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("mousemove", handleWindowMouseMove);
    };
  }, [open, processWheelIntent]);

  const visible = open || progress < 0.995;

  return (
    <div
      data-testid="workspace-launch-layer"
      data-open={open ? "1" : "0"}
      className={`
        fixed inset-0 z-[80] bg-app-gradient
        ${visible ? "pointer-events-auto" : "pointer-events-none"}
      `}
      style={{
        transform: `translateY(${-progress * 100}%)`,
        transition: isInteracting ? "none" : "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)",
        touchAction: "none",
        visibility: visible ? "visible" : "hidden"
      }}
      aria-hidden={!visible}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          <h1 className="mb-5 text-center font-display text-2xl text-ink-900 md:text-[32px]">
            Choose your operations view
          </h1>
          <GlobeInteractive
            markers={markers}
            markerSelectableById={markerSelectableById}
            isMarkerClickSuppressed={isMarkerClickSuppressed}
            onWorkshopClick={canUseWorkshopEntry ? handleOpenWorkshop : undefined}
            onMarkerSelect={handleOpenProjectOperations}
            className="mx-auto"
          />
        </div>
      </main>
      {canUnlockAllProjects ? (
        <>
          <div
            data-testid="workspace-launch-gesture-zone"
            className="absolute inset-x-0 bottom-0 z-40"
            style={{
              height: `calc(${BOTTOM_EDGE_SWIPE_ZONE_PX}px + env(safe-area-inset-bottom) + 16px)`,
              touchAction: "none"
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex justify-center pb-3"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
          >
            <span
              data-testid="workspace-launch-swipe-handle"
              className="h-1.5 w-28 rounded-full bg-slate-900/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function isInteractiveGestureTarget(target: EventTarget | null) {
  const element = target as Element | null;
  if (!element) {
    return false;
  }
  return Boolean(
    element.closest(
      "input, textarea, select, button, a, [role='button'], [contenteditable='true'], [data-marker-id], [data-testid='workspace-launch-workshop-button'], [data-workspace-launch-ignore-unlock='true']"
    )
  );
}

function isWithinBottomEdgeGestureZone(clientY: number) {
  if (typeof window === "undefined" || !Number.isFinite(clientY)) {
    return false;
  }
  const safeAreaInset = readSafeAreaInsetBottom();
  const startY = window.innerHeight - (BOTTOM_EDGE_SWIPE_ZONE_PX + safeAreaInset);
  return clientY >= Math.max(0, startY);
}

function requiresBottomZoneForWheelUnlock() {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 1023px)").matches
  );
}

function readSafeAreaInsetBottom() {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) {
    return 0;
  }
  if (!safeAreaProbeElement) {
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "fixed";
    probe.style.pointerEvents = "none";
    probe.style.visibility = "hidden";
    probe.style.height = "0";
    probe.style.paddingBottom = "env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
    safeAreaProbeElement = probe;
  }
  const computed = window.getComputedStyle(safeAreaProbeElement);
  const parsed = Number.parseFloat(computed.paddingBottom || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveGestureClientY(clientY: number, fallbackY: number | null) {
  if (Number.isFinite(clientY) && clientY > 0) {
    return clientY;
  }
  if (typeof fallbackY === "number" && Number.isFinite(fallbackY) && fallbackY > 0) {
    return fallbackY;
  }
  return Number.NaN;
}

function clamp(value: number, min: number, max: number) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
