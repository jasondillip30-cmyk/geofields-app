"use client";

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
}

export function BarCategoryChart<T extends object>({
  data,
  xKey,
  yKey,
  color = "#1e63f5",
  onElementClick,
  onBackgroundClick,
  clickHint
}: BarCategoryChartProps<T>) {
  const interactive = Boolean(onElementClick || onBackgroundClick);

  return (
    <div
      className={cn("h-72 w-full", interactive && "cursor-pointer")}
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
              onElementClick(entry.payload, index);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
