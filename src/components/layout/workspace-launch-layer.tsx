"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

let markerCache: { markers: WorkspaceLaunchMarker[]; hasLive: boolean } | null = null;

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
  const touchStartedOnInteractiveControlRef = useRef(false);
  const wheelUnlockDirectionRef = useRef<1 | -1 | 0>(0);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (open) {
      setIsInteracting(false);
      setProgress(0);
      progressRef.current = 0;
      wheelUnlockDirectionRef.current = 0;
      return;
    }
    setIsInteracting(false);
    setProgress(1);
    progressRef.current = 1;
    wheelUnlockDirectionRef.current = 0;
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
    if (role && canAccess(role, "inventory:view")) {
      return "/inventory";
    }
    if (role && canAccess(role, "maintenance:view")) {
      return "/maintenance";
    }
    return "/rigs";
  }, [role]);

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
    const params = withSharedDateQuery();
    params.set("workspace", "workshop");
    params.set("projectId", "all");
    params.set("clientId", "all");
    params.set("rigId", "all");
    closeAndNavigate(`${workshopDestination}?${params.toString()}`, {
      workspaceMode: "workshop",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from: filters.from,
      to: filters.to
    });
  }, [closeAndNavigate, filters.from, filters.to, withSharedDateQuery, workshopDestination]);

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
      closeAndNavigate(`/spending?${params.toString()}`, {
        workspaceMode: "project",
        projectId: marker.id,
        clientId: "all",
        rigId: "all",
        from: filters.from,
        to: filters.to
      });
    },
    [closeAndNavigate, filters.from, filters.to, hasLiveProjectMarkers, markers, withSharedDateQuery]
  );

  const finalizeGesture = useCallback(() => {
    if (!open || commitInFlightRef.current) {
      return;
    }
    setIsInteracting(false);
    if (progressRef.current >= UNLOCK_THRESHOLD) {
      handleUnlockToAllProjects();
      return;
    }
    setProgress(0);
    progressRef.current = 0;
    wheelUnlockDirectionRef.current = 0;
  }, [handleUnlockToAllProjects, open]);

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
    (deltaY: number, target: EventTarget | null, preventDefault?: () => void) => {
      if (!open || commitInFlightRef.current) {
        return;
      }
      if (isInteractiveGestureTarget(target)) {
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
      adjustProgress(progressRef.current + normalizedDelta * PROGRESS_PER_WHEEL_PIXEL);
      scheduleFinalizeGesture();
    },
    [adjustProgress, open, scheduleFinalizeGesture]
  );

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!open || commitInFlightRef.current) {
      return;
    }
    touchStartedOnInteractiveControlRef.current = isInteractiveGestureTarget(event.target);
    touchLastYRef.current = event.touches[0]?.clientY ?? null;
    setIsInteracting(true);
  }, [open]);

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!open || commitInFlightRef.current) {
        return;
      }
      if (touchStartedOnInteractiveControlRef.current) {
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
      adjustProgress(progressRef.current + -deltaY * PROGRESS_PER_TOUCH_PIXEL);
    },
    [adjustProgress, open]
  );

  const handleTouchEnd = useCallback(() => {
    if (!open || commitInFlightRef.current) {
      return;
    }
    touchLastYRef.current = null;
    if (touchStartedOnInteractiveControlRef.current) {
      touchStartedOnInteractiveControlRef.current = false;
      setIsInteracting(false);
      return;
    }
    finalizeGesture();
  }, [finalizeGesture, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleWindowWheel = (event: WheelEvent) => {
      processWheelIntent(event.deltaY, event.target, () => event.preventDefault());
    };
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWindowWheel);
    };
  }, [open, processWheelIntent]);

  useEffect(() => {
    return () => {
      if (finalizeTimerRef.current !== null) {
        window.clearTimeout(finalizeTimerRef.current);
      }
    };
  }, []);

  const visible = open || progress < 0.995;

  return (
    <div
      data-testid="workspace-launch-layer"
      className={`
        fixed inset-0 z-[80] bg-app-gradient
        ${visible ? "pointer-events-auto" : "pointer-events-none"}
      `}
      style={{
        transform: `translateY(${-progress * 100}%)`,
        transition: isInteracting ? "none" : "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)",
        touchAction: "none"
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          <h1 className="mb-5 text-center font-display text-2xl text-ink-900 md:text-[32px]">
            Choose your operations view
          </h1>
          <GlobeInteractive
            markers={markers}
            markerSelectableById={markerSelectableById}
            onWorkshopClick={handleOpenWorkshop}
            onMarkerSelect={handleOpenProjectOperations}
            className="mx-auto"
          />
        </div>
      </main>
    </div>
  );
}

function isInteractiveGestureTarget(target: EventTarget | null) {
  const element = target as Element | null;
  if (!element) {
    return false;
  }
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
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
