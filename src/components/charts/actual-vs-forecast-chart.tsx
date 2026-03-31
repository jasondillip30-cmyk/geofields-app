"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { cn } from "@/lib/utils";

interface ActualVsForecastChartProps<T extends object> {
  data: T[];
  xKey: keyof T & string;
  actualKey: keyof T & string;
  forecastKey: keyof T & string;
  onElementClick?: (payload: T, index: number) => void;
  onBackgroundClick?: () => void;
  clickHint?: string;
}

export function ActualVsForecastChart<T extends object>({
  data,
  xKey,
  actualKey,
  forecastKey,
  onElementClick,
  onBackgroundClick,
  clickHint
}: ActualVsForecastChartProps<T>) {
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
        <LineChart
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
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} stroke="#64748b" />
          <YAxis stroke="#64748b" />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey={actualKey}
            stroke="#15803d"
            strokeWidth={2}
            name="Actual Profit"
            dot={onElementClick ? { r: 2.5, cursor: "pointer" } : false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey={forecastKey}
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="6 4"
            name="Forecast Profit"
            dot={onElementClick ? { r: 2.5, cursor: "pointer" } : false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
