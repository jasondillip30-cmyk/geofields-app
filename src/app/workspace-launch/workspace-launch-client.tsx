"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { GlobeInteractive } from "@/components/ui/cobe-globe-interactive";
import { canAccess } from "@/lib/auth/permissions";
import { useRole } from "@/components/layout/role-provider";
import { navigateWithSheetTransition } from "@/lib/sheet-transition";
import { applyScopeIntentToSession } from "@/lib/analytics-scope";
import {
  buildDeterministicProjectMarkers,
  FALLBACK_WORKSPACE_MARKERS,
  type WorkspaceLaunchMarker
} from "@/lib/workspace-launch-markers";

interface ApiProjectRow {
  id: string;
  name: string;
  status?: string | null;
}

const BOTTOM_EDGE_SWIPE_ZONE_PX = 96;
let safeAreaProbeElement: HTMLDivElement | null = null;

export function WorkspaceLaunchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role } = useRole();
  const [markers, setMarkers] = useState<WorkspaceLaunchMarker[]>(FALLBACK_WORKSPACE_MARKERS);
  const [hasLiveProjectMarkers, setHasLiveProjectMarkers] = useState(false);
  const hasTriggeredWheelNavigation = useRef(false);
  const wheelIntentAccumulator = useRef(0);
  const wheelAccumulatorResetTimeout = useRef<number | null>(null);
  const wheelUnlockDirectionRef = useRef<1 | -1 | 0>(0);
  const touchStartY = useRef<number | null>(null);
  const touchLastY = useRef<number | null>(null);
  const touchMoved = useRef(false);
  const suppressMarkerClicksUntilRef = useRef(0);
  const touchStartedOnInteractiveControl = useRef(false);
  const touchGestureArmed = useRef(false);
  const lastPointerY = useRef<number | null>(null);

  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadProjectNodes() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          setMarkers(FALLBACK_WORKSPACE_MARKERS);
          setHasLiveProjectMarkers(false);
          return;
        }
        const payload = (await response.json()) as { data?: ApiProjectRow[] };
        const projects = Array.isArray(payload.data) ? payload.data : [];
        const projectMarkers = buildDeterministicProjectMarkers(projects);
        if (projectMarkers.length === 0) {
          setMarkers(FALLBACK_WORKSPACE_MARKERS);
          setHasLiveProjectMarkers(false);
          return;
        }

        if (!cancelled) {
          setMarkers(projectMarkers);
          setHasLiveProjectMarkers(true);
        }
      } catch {
        if (!cancelled) {
          setMarkers(FALLBACK_WORKSPACE_MARKERS);
          setHasLiveProjectMarkers(false);
        }
      } finally {
        // no blocking loader on globe launch
      }
    }

    void loadProjectNodes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const querySuffix = useMemo(() => {
    const query = new URLSearchParams();
    if (from) {
      query.set("from", from);
    }
    if (to) {
      query.set("to", to);
    }
    const serialized = query.toString();
    return serialized ? `&${serialized}` : "";
  }, [from, to]);

  const getAllProjectsDestination = useCallback(() => {
    if (role && canAccess(role, "dashboard:view")) {
      return "/";
    }
    if (role && canAccess(role, "projects:view")) {
      return "/projects";
    }
    return "/rigs";
  }, [role]);

  const getAllProjectsHref = useCallback(() => {
    const destination = getAllProjectsDestination();
    return `${destination}?workspace=all-projects&projectId=all${querySuffix}`;
  }, [getAllProjectsDestination, querySuffix]);

  const handleOpenAllProjectsWithTransition = useCallback(() => {
    applyScopeIntentToSession({
      workspaceMode: "all-projects",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from,
      to
    });
    navigateWithSheetTransition({
      direction: "up",
      onNavigate: () => router.push(getAllProjectsHref())
    });
  }, [from, getAllProjectsHref, router, to]);

  const handleOpenWorkshop = useCallback(() => {
    applyScopeIntentToSession({
      workspaceMode: "workshop",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from,
      to
    });
    const destination =
      role && canAccess(role, "inventory:view")
        ? "/inventory"
        : role && canAccess(role, "maintenance:view")
          ? "/maintenance"
          : "/rigs";
    router.push(`${destination}?workspace=workshop&projectId=all&clientId=all&rigId=all${querySuffix}`);
  }, [from, querySuffix, role, router, to]);

  const buildProjectOperationsHref = useCallback(
    (projectId: string) => {
      const params = new URLSearchParams();
      params.set("workspace", "project");
      params.set("projectId", projectId);
      params.set("clientId", "all");
      params.set("rigId", "all");
      if (from) {
        params.set("from", from);
      }
      if (to) {
        params.set("to", to);
      }
      return `/spending?${params.toString()}`;
    },
    [from, to]
  );

  const markerSelectableById = useMemo(
    () => Object.fromEntries(markers.map((marker) => [marker.id, hasLiveProjectMarkers])),
    [hasLiveProjectMarkers, markers]
  );

  const handleProjectMarkerSelect = useCallback(
    (markerId: string) => {
      if (!hasLiveProjectMarkers) {
        return;
      }
      const marker = markers.find((entry) => entry.id === markerId);
      if (!marker) {
        return;
      }
      const projectId = marker.id;
      applyScopeIntentToSession({
        workspaceMode: "project",
        projectId,
        clientId: "all",
        rigId: "all",
        from,
        to
      });
      navigateWithSheetTransition({
        direction: "up",
        onNavigate: () => router.push(buildProjectOperationsHref(projectId))
      });
    },
    [buildProjectOperationsHref, from, hasLiveProjectMarkers, markers, router, to]
  );

  const processWheelUnlock = useCallback(
    (deltaY: number, clientY: number, target: EventTarget | null) => {
      if (hasTriggeredWheelNavigation.current || isInteractiveGestureTarget(target)) {
        return;
      }
      const effectiveClientY = resolveGestureClientY(clientY, lastPointerY.current);
      if (requiresBottomZoneForWheelUnlock() && !isWithinBottomEdgeGestureZone(effectiveClientY)) {
        return;
      }
      if (Math.abs(deltaY) < 0.5) {
        return;
      }
      if (wheelUnlockDirectionRef.current === 0) {
        wheelUnlockDirectionRef.current = deltaY >= 0 ? 1 : -1;
      }
      const normalizedDelta = deltaY * wheelUnlockDirectionRef.current;
      if (normalizedDelta <= 0) {
        wheelIntentAccumulator.current = 0;
        if (wheelAccumulatorResetTimeout.current !== null) {
          window.clearTimeout(wheelAccumulatorResetTimeout.current);
          wheelAccumulatorResetTimeout.current = null;
        }
        return;
      }

      wheelIntentAccumulator.current += normalizedDelta;
      if (wheelAccumulatorResetTimeout.current !== null) {
        window.clearTimeout(wheelAccumulatorResetTimeout.current);
      }
      wheelAccumulatorResetTimeout.current = window.setTimeout(() => {
        wheelIntentAccumulator.current = 0;
        wheelAccumulatorResetTimeout.current = null;
      }, 240);

      if (wheelIntentAccumulator.current < 90) {
        return;
      }

      wheelIntentAccumulator.current = 0;
      hasTriggeredWheelNavigation.current = true;
      handleOpenAllProjectsWithTransition();
      window.setTimeout(() => {
        hasTriggeredWheelNavigation.current = false;
        wheelUnlockDirectionRef.current = 0;
      }, 600);
    },
    [handleOpenAllProjectsWithTransition]
  );

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const startY = event.touches[0]?.clientY ?? null;
    touchStartY.current = startY;
    touchLastY.current = startY;
    touchMoved.current = false;
    lastPointerY.current = startY;
    touchStartedOnInteractiveControl.current = isInteractiveGestureTarget(event.target);
    touchGestureArmed.current = false;
    if (
      touchStartedOnInteractiveControl.current ||
      startY === null ||
      !isWithinBottomEdgeGestureZone(startY)
    ) {
      return;
    }
    touchGestureArmed.current = true;
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY ?? null;
    if (currentY === null) {
      return;
    }
    touchLastY.current = currentY;
    if (touchStartY.current !== null && Math.abs(currentY - touchStartY.current) > 2) {
      touchMoved.current = true;
    }
    lastPointerY.current = currentY;
  }, []);

  const finalizeTouchUnlock = useCallback(
    (touchEndY: number | null) => {
      if (hasTriggeredWheelNavigation.current) {
        return;
      }
      const startY = touchStartY.current;
      const resolvedTouchEndY = typeof touchEndY === "number" ? touchEndY : touchLastY.current;
      if (touchMoved.current) {
        suppressMarkerClicksUntilRef.current = Date.now() + 420;
      }
      touchMoved.current = false;
      touchStartY.current = null;
      touchLastY.current = null;
      const startedOnInteractive = touchStartedOnInteractiveControl.current;
      const wasArmed = touchGestureArmed.current;
      touchStartedOnInteractiveControl.current = false;
      touchGestureArmed.current = false;
      if (startY === null || startedOnInteractive || !wasArmed) {
        return;
      }
      const delta = startY - (typeof resolvedTouchEndY === "number" ? resolvedTouchEndY : startY);
      if (delta < 72) {
        return;
      }

      hasTriggeredWheelNavigation.current = true;
      handleOpenAllProjectsWithTransition();
      window.setTimeout(() => {
        hasTriggeredWheelNavigation.current = false;
        wheelUnlockDirectionRef.current = 0;
      }, 700);
    },
    [handleOpenAllProjectsWithTransition]
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      finalizeTouchUnlock(event.changedTouches[0]?.clientY ?? null);
    },
    [finalizeTouchUnlock]
  );

  const handleTouchCancel = useCallback(() => {
    touchStartY.current = null;
    touchLastY.current = null;
    touchMoved.current = false;
    touchStartedOnInteractiveControl.current = false;
    touchGestureArmed.current = false;
  }, []);

  const isMarkerClickSuppressed = useCallback(
    () => Date.now() < suppressMarkerClicksUntilRef.current,
    []
  );

  useEffect(() => {
    return () => {
      if (wheelAccumulatorResetTimeout.current !== null) {
        window.clearTimeout(wheelAccumulatorResetTimeout.current);
      }
      wheelUnlockDirectionRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const handleWindowTouchEnd = (event: TouchEvent) => {
      finalizeTouchUnlock(event.changedTouches[0]?.clientY ?? null);
    };
    const handleWindowTouchCancel = () => {
      touchStartY.current = null;
      touchLastY.current = null;
      touchMoved.current = false;
      touchStartedOnInteractiveControl.current = false;
      touchGestureArmed.current = false;
    };
    window.addEventListener("touchend", handleWindowTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleWindowTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchend", handleWindowTouchEnd);
      window.removeEventListener("touchcancel", handleWindowTouchCancel);
    };
  }, [finalizeTouchUnlock]);

  useEffect(() => {
    const handleWindowWheel = (event: WheelEvent) => {
      processWheelUnlock(event.deltaY, event.clientY, event.target);
    };
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!Number.isFinite(event.clientY) || event.clientY <= 0) {
        return;
      }
      lastPointerY.current = event.clientY;
    };
    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!Number.isFinite(event.clientY) || event.clientY <= 0) {
        return;
      }
      lastPointerY.current = event.clientY;
    };
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: true });
    window.addEventListener("mousemove", handleWindowMouseMove, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleWindowWheel);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("mousemove", handleWindowMouseMove);
    };
  }, [processWheelUnlock]);

  return (
    <AccessGate permission="rigs:view">
      <main
        className="relative flex min-h-screen flex-col items-center justify-center bg-app-gradient px-4 py-8"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div className="w-full max-w-3xl">
          <h1 className="mb-5 text-center font-display text-2xl text-ink-900 md:text-[32px]">
            Choose your operations view
          </h1>
          <GlobeInteractive
            markers={markers}
            markerSelectableById={markerSelectableById}
            isMarkerClickSuppressed={isMarkerClickSuppressed}
            onWorkshopClick={handleOpenWorkshop}
            onMarkerSelect={handleProjectMarkerSelect}
            className="mx-auto"
          />
        </div>
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
      </main>
    </AccessGate>
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
