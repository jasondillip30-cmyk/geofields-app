"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import createGlobe from "cobe";
import { Home } from "lucide-react";

import type { WorkspaceLaunchMarker } from "@/lib/workspace-launch-markers";
import { cn } from "@/lib/utils";

interface GlobeInteractiveProps {
  markers: WorkspaceLaunchMarker[];
  className?: string;
  speed?: number;
  markerSelectableById?: Record<string, boolean>;
  isMarkerClickSuppressed?: () => boolean;
  onMarkerSelect?: (markerId: string) => void;
  onWorkshopClick?: () => void;
}

export function GlobeInteractive({
  markers,
  className,
  speed = 0.0026,
  markerSelectableById,
  isMarkerClickSuppressed,
  onMarkerSelect,
  onWorkshopClick
}: GlobeInteractiveProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);
  const [expandedMarkerId, setExpandedMarkerId] = useState<string | null>(null);
  const resolvedMarkers = useMemo(
    () => markers.map((marker) => ({ ...marker, users: Number.isFinite(marker.users) ? marker.users : 0 })),
    [markers]
  );
  const shortTagByMarkerId = useMemo(() => buildShortTagsByMarkerId(resolvedMarkers), [resolvedMarkers]);

  const updateMarkerPositionStyles = useCallback(
    (phi: number, theta: number) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const size = Math.min(container.clientWidth, container.clientHeight);
      if (size <= 0) {
        return;
      }
      const radius = size / 2;
      const centerX = radius;
      const centerY = radius;

      for (const marker of resolvedMarkers) {
        const markerElement = markerRefs.current.get(marker.id);
        if (!markerElement) {
          continue;
        }

        const projection = projectMarker(marker.location, phi, theta);
        const x = centerX + projection.x * radius * 0.88;
        const y = centerY - projection.y * radius * 0.88;
        const visibility = clamp((projection.z + 0.4) / 1.4, 0.24, 1);
        const opacity = projection.z <= -0.22 ? 0 : visibility;
        const scale = 0.92 + visibility * 0.14;
        const selectable = markerSelectableById ? Boolean(markerSelectableById[marker.id]) : true;

        markerElement.style.left = `${x}px`;
        markerElement.style.top = `${y}px`;
        markerElement.style.opacity = `${opacity.toFixed(3)}`;
        markerElement.style.filter = "none";
        markerElement.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        markerElement.style.pointerEvents = selectable && opacity > 0.22 ? "auto" : "none";
      }
    },
    [markerSelectableById, resolvedMarkers]
  );

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerInteracting.current = { x: event.clientX, y: event.clientY };
    setExpandedMarkerId(null);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grabbing";
    }
    isPausedRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerInteracting.current = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grab";
    }
    isPausedRef.current = false;
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerInteracting.current) {
        return;
      }
      dragOffset.current = {
        phi: (event.clientX - pointerInteracting.current.x) / 320,
        theta: (event.clientY - pointerInteracting.current.y) / 1200
      };
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerUp]);

  useEffect(() => {
    if (!expandedMarkerId) {
      return;
    }
    if (resolvedMarkers.some((marker) => marker.id === expandedMarkerId)) {
      return;
    }
    setExpandedMarkerId(null);
  }, [expandedMarkerId, resolvedMarkers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    let globe: ReturnType<typeof createGlobe> | null = null;
    let animationFrameId = 0;
    let currentPhi = 0;
    let resizeObserver: ResizeObserver | null = null;

    const initialize = () => {
      const size = Math.floor(Math.min(container.clientWidth, container.clientHeight));
      if (size <= 0) {
        return;
      }

      globe?.destroy();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: size,
        height: size,
        phi: 0,
        theta: 0.2,
        dark: 0,
        diffuse: 1.4,
        mapSamples: 15000,
        mapBrightness: 8,
        baseColor: [1, 1, 1],
        markerColor: [0.1, 0.3, 0.62],
        glowColor: [0.92, 0.94, 0.99],
        markerElevation: 0,
        markers: [],
        arcs: [],
        opacity: 1
      });

      const animate = () => {
        if (!isPausedRef.current) {
          currentPhi += speed;
        }
        const phi = currentPhi + phiOffsetRef.current + dragOffset.current.phi;
        const theta = 0.2 + thetaOffsetRef.current + dragOffset.current.theta;
        globe?.update({ phi, theta });
        updateMarkerPositionStyles(phi, theta);
        animationFrameId = requestAnimationFrame(animate);
      };
      animate();

      canvas.style.opacity = "1";
      canvas.style.cursor = "grab";
    };

    initialize();
    resizeObserver = new ResizeObserver(() => initialize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver?.disconnect();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      globe?.destroy();
    };
  }, [resolvedMarkers, speed, updateMarkerPositionStyles]);

  const openMarker = (markerId: string) => {
    if (isMarkerClickSuppressed?.()) {
      return;
    }
    if (expandedMarkerId !== markerId) {
      setExpandedMarkerId(markerId);
      return;
    }
    onMarkerSelect?.(markerId);
  };

  const handleSurfaceClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    if (!target) {
      return;
    }
    if (target.closest("[data-marker-id], [data-testid='workspace-launch-workshop-button']")) {
      return;
    }
    setExpandedMarkerId(null);
  }, []);

  return (
    <section
      data-testid="workspace-launch-globe"
      className={cn("relative aspect-square w-full max-w-[640px] select-none", className)}
      onClickCapture={handleSurfaceClickCapture}
    >
      <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-full">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          style={{
            width: "100%",
            height: "100%",
            opacity: 0,
            transition: "opacity 800ms ease",
            touchAction: "none"
          }}
        />

        <button
          type="button"
          onClick={onWorkshopClick}
          data-testid="workspace-launch-workshop-button"
          className="absolute left-1/2 top-1/2 z-30 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-brand-200 bg-white/95 text-brand-700 shadow-[0_8px_28px_rgba(37,99,235,0.28)] transition hover:scale-105 hover:bg-white"
          aria-label="Open workshop workspace"
          title="Workshop"
        >
          <Home size={20} />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-0 z-30">
        {resolvedMarkers.map((marker) => {
          const isExpanded = expandedMarkerId === marker.id;
          const selectable = markerSelectableById ? Boolean(markerSelectableById[marker.id]) : true;
          return (
            <button
              key={marker.id}
              ref={(node) => {
                if (!node) {
                  markerRefs.current.delete(marker.id);
                  return;
                }
                markerRefs.current.set(marker.id, node);
              }}
              type="button"
              disabled={!selectable}
              data-testid={`workspace-launch-marker-${marker.id}`}
              data-marker-id={marker.id}
              data-marker-name={marker.name}
              data-marker-expanded={isExpanded ? "true" : "false"}
              onClick={() => {
                if (!selectable) {
                  return;
                }
                openMarker(marker.id);
              }}
              title={marker.name}
              aria-label={marker.name}
              className={cn(
                "pointer-events-auto absolute inline-flex items-center justify-center rounded-[8px] border border-[#0c1021] bg-[#171a2d] px-3 py-1.5 text-white shadow-[0_6px_14px_rgba(0,0,0,0.28)] transition-all duration-150",
                isExpanded ? "max-w-[220px] px-3.5 py-2" : "",
                selectable ? "cursor-pointer hover:scale-[1.03]" : "cursor-default opacity-70"
              )}
              style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", opacity: 0 }}
            >
              <p
                className={cn(
                  "[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation_Mono,Courier_New,monospace]",
                  isExpanded
                    ? "text-center text-[12px] font-semibold leading-tight tracking-[0.04em]"
                    : "whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em]"
                )}
              >
                {isExpanded ? marker.name : shortTagByMarkerId[marker.id]}
              </p>
              <span className="pointer-events-none absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-0.5 rounded-full border border-[#14317a] bg-[#1f4fb8]" />
            </button>
          );
        })}
      </div>

    </section>
  );
}

function projectMarker(location: [number, number], phi: number, theta: number) {
  const [latitude, longitude] = location;
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;

  const x = Math.cos(lat) * Math.cos(lon);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.sin(lon);

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const x1 = x * cosPhi + z * sinPhi;
  const z1 = -x * sinPhi + z * cosPhi;

  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const y2 = y * cosTheta - z1 * sinTheta;
  const z2 = y * sinTheta + z1 * cosTheta;

  return { x: x1, y: y2, z: z2 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildShortTagsByMarkerId(markers: WorkspaceLaunchMarker[]) {
  const tagsById: Record<string, string> = {};
  const used = new Set<string>();

  for (const marker of markers) {
    const base = createBaseTag(marker.name);
    let next = base;
    let index = 0;

    while (used.has(next)) {
      index += 1;
      const suffix = hashToBase36(`${marker.id}:${index}`).slice(0, 1);
      const head = base.slice(0, Math.max(2, 4 - suffix.length));
      next = `${head}${suffix}`;
    }

    used.add(next);
    tagsById[marker.id] = next;
  }

  return tagsById;
}

function createBaseTag(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim();
  if (!normalized) {
    return "NODE";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const initials = parts.slice(0, 3).map((part) => part[0]).join("");
    return initials.slice(0, 4) || "NODE";
  }

  return parts[0]!.slice(0, 4) || "NODE";
}

function hashToBase36(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase();
}
