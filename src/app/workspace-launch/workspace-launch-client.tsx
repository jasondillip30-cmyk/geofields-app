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
  const touchStartedOnInteractiveControl = useRef(false);

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

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (hasTriggeredWheelNavigation.current || isInteractiveGestureTarget(event.target)) {
        return;
      }
      if (Math.abs(event.deltaY) < 0.5) {
        return;
      }
      if (wheelUnlockDirectionRef.current === 0) {
        wheelUnlockDirectionRef.current = event.deltaY >= 0 ? 1 : -1;
      }
      const normalizedDelta = event.deltaY * wheelUnlockDirectionRef.current;
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
    touchStartY.current = event.touches[0]?.clientY ?? null;
    touchStartedOnInteractiveControl.current = isInteractiveGestureTarget(event.target);
  }, []);

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (hasTriggeredWheelNavigation.current) {
        return;
      }
      const startY = touchStartY.current;
      touchStartY.current = null;
      if (startY === null) {
        return;
      }
      if (touchStartedOnInteractiveControl.current) {
        touchStartedOnInteractiveControl.current = false;
        return;
      }
      const endY = event.changedTouches[0]?.clientY ?? startY;
      const delta = startY - endY;
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

  useEffect(() => {
    return () => {
      if (wheelAccumulatorResetTimeout.current !== null) {
        window.clearTimeout(wheelAccumulatorResetTimeout.current);
      }
      wheelUnlockDirectionRef.current = 0;
    };
  }, []);

  return (
    <AccessGate permission="rigs:view">
      <main
        className="flex min-h-screen flex-col items-center justify-center bg-app-gradient px-4 py-8"
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="w-full max-w-3xl">
          <h1 className="mb-5 text-center font-display text-2xl text-ink-900 md:text-[32px]">
            Choose your operations view
          </h1>
          <GlobeInteractive
            markers={markers}
            markerSelectableById={markerSelectableById}
            onWorkshopClick={handleOpenWorkshop}
            onMarkerSelect={handleProjectMarkerSelect}
            className="mx-auto"
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
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}
