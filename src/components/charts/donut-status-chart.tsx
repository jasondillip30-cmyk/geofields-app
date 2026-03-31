"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { cn } from "@/lib/utils";

interface DonutStatusChartProps<T extends object> {
  data: T[];
  nameKey: keyof T & string;
  valueKey: keyof T & string;
  palette?: string[];
  onElementClick?: (payload: T, index: number) => void;
  onBackgroundClick?: () => void;
  clickHint?: string;
}

export const DONUT_PALETTE = ["#1e63f5", "#f59e0b", "#0f766e", "#dc2626", "#6366f1", "#14b8a6", "#64748b"];

export function DonutStatusChart<T extends object>({
  data,
  nameKey,
  valueKey,
  palette = DONUT_PALETTE,
  onElementClick,
  onBackgroundClick,
  clickHint
}: DonutStatusChartProps<T>) {
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
        <PieChart>
          <Pie
            data={data}
            innerRadius={64}
            outerRadius={98}
            paddingAngle={2}
            dataKey={valueKey}
            nameKey={nameKey}
            onClick={(entry: { payload?: T } | undefined, index: number, event: unknown) => {
              if (!onElementClick || !entry?.payload) {
                return;
              }
              const candidate = event as { stopPropagation?: () => void };
              candidate.stopPropagation?.();
              onElementClick(entry.payload, index);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`slice-${String(entry[nameKey])}-${index}`}
                fill={palette[index % palette.length]}
                cursor={onElementClick ? "pointer" : undefined}
              />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
