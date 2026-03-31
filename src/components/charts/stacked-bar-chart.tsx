"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { cn } from "@/lib/utils";

interface StackDefinition {
  key: string;
  label: string;
  color: string;
}

interface StackedBarChartProps<T extends object> {
  data: T[];
  xKey: keyof T & string;
  stacks: StackDefinition[];
  onElementClick?: (payload: T, index: number) => void;
  onBackgroundClick?: () => void;
  clickHint?: string;
}

export function StackedBarChart<T extends object>({
  data,
  xKey,
  stacks,
  onElementClick,
  onBackgroundClick,
  clickHint
}: StackedBarChartProps<T>) {
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
          <Legend />
          {stacks.map((stack) => (
            <Bar
              key={stack.key}
              dataKey={stack.key}
              stackId="cost"
              fill={stack.color}
              name={stack.label}
              radius={[4, 4, 0, 0]}
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
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
