"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { cn } from "@/lib/utils";

interface LineTrendChartProps<T extends object> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  color?: string;
  secondaryKey?: keyof T & string;
  secondaryColor?: string;
  onElementClick?: (payload: T, index: number) => void;
  onBackgroundClick?: () => void;
  clickHint?: string;
}

export function LineTrendChart<T extends object>({
  data,
  xKey,
  yKey,
  color = "#347eff",
  secondaryKey,
  secondaryColor = "#f59e0b",
  onElementClick,
  onBackgroundClick,
  clickHint
}: LineTrendChartProps<T>) {
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
        <AreaChart
          data={data}
          onClick={(state: { activePayload?: Array<{ payload?: T }>; activeTooltipIndex?: number }, event: unknown) => {
            if (!onElementClick) {
              return;
            }
            const payload = state.activePayload?.[0]?.payload;
            if (!payload) {
              return;
            }
            const candidate = event as { stopPropagation?: () => void };
            candidate.stopPropagation?.();
            onElementClick(payload, state.activeTooltipIndex ?? -1);
          }}
        >
          <defs>
            <linearGradient id="primaryArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.45} />
              <stop offset="95%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="secondaryArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={secondaryColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={secondaryColor} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} stroke="#64748b" />
          <YAxis stroke="#64748b" />
          <Tooltip />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={color}
            fill="url(#primaryArea)"
            strokeWidth={2}
            dot={onElementClick ? { r: 2.5, cursor: "pointer", fill: color } : false}
            activeDot={onElementClick ? { r: 4, cursor: "pointer" } : false}
          />
          {secondaryKey && (
            <Area
              type="monotone"
              dataKey={secondaryKey}
              stroke={secondaryColor}
              fill="url(#secondaryArea)"
              strokeWidth={2}
              dot={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
