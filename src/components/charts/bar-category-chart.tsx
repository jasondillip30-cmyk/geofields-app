"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { cn } from "@/lib/utils";

interface BarCategoryChartProps<T extends object> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  color?: string;
  onElementClick?: (payload: T, index: number) => void;
  onBackgroundClick?: () => void;
  clickHint?: string;
  requireTouchConfirm?: boolean;
  getTouchConfirmKey?: (payload: T, index: number) => string;
  touchConfirmWindowMs?: number;
}

export function BarCategoryChart<T extends object>({
  data,
  xKey,
  yKey,
  color = "#1e63f5",
  onElementClick,
  onBackgroundClick,
  clickHint,
  requireTouchConfirm = false,
  getTouchConfirmKey,
  touchConfirmWindowMs = 2200
}: BarCategoryChartProps<T>) {
  const interactive = Boolean(onElementClick || onBackgroundClick);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [armedAt, setArmedAt] = useState(0);
  const coarsePointerRef = useRef(false);
  const lastPointerTypeRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => {
      coarsePointerRef.current = mediaQuery.matches;
    };
    update();
    mediaQuery.addEventListener("change", update);
    return () => {
      mediaQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!armedKey) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setArmedKey(null);
      setArmedAt(0);
    }, touchConfirmWindowMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [armedKey, touchConfirmWindowMs]);

  return (
    <div
      className={cn("h-72 w-full", interactive && "cursor-pointer")}
      onPointerDown={(event) => {
        lastPointerTypeRef.current = event.pointerType || null;
      }}
      onClick={(event) => {
        if (!onBackgroundClick) {
          return;
        }
        event.stopPropagation();
        onBackgroundClick();
      }}
      title={clickHint}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} stroke="#64748b" />
          <YAxis stroke="#64748b" />
          <Tooltip />
          <Bar
            dataKey={yKey}
            fill={color}
            radius={[8, 8, 0, 0]}
            cursor={onElementClick ? "pointer" : undefined}
            onClick={(entry: { payload?: T } | undefined, index: number, event: unknown) => {
              if (!onElementClick || !entry?.payload) {
                return;
              }
              const candidate = event as { stopPropagation?: () => void };
              candidate.stopPropagation?.();
              const isTouchLikePointer =
                lastPointerTypeRef.current === "touch" ||
                lastPointerTypeRef.current === "pen" ||
                coarsePointerRef.current;

              if (!requireTouchConfirm || !isTouchLikePointer) {
                onElementClick(entry.payload, index);
                setArmedKey(null);
                setArmedAt(0);
                return;
              }

              const entryKey =
                getTouchConfirmKey?.(entry.payload, index) ??
                String(index);
              const now = Date.now();
              const isSecondTap = armedKey === entryKey && now - armedAt <= touchConfirmWindowMs;

              if (!isSecondTap) {
                setArmedKey(entryKey);
                setArmedAt(now);
                return;
              }

              setArmedKey(null);
              setArmedAt(0);
              onElementClick(entry.payload, index);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
