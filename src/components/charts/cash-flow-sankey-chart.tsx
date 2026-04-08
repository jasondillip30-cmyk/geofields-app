"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

import { formatCurrency } from "@/lib/utils";

export interface CashFlowSankeyNode {
  name: string;
  value: number;
  kind: "revenue" | "expenses" | "profit" | "category" | "categoryHub";
  percent?: number | null;
  displayValue?: number | null;
  hideLabel?: boolean;
}

export interface CashFlowSankeyLink {
  source: number;
  target: number;
  value: number;
}

interface CashFlowSankeyChartProps {
  nodes: CashFlowSankeyNode[];
  links: CashFlowSankeyLink[];
}

const NODE_COLORS: Record<CashFlowSankeyNode["kind"], string> = {
  revenue: "#0f766e",
  expenses: "#84cc16",
  profit: "#9333ea",
  category: "#38bdf8",
  categoryHub: "#7dd3fc"
};

export function CashFlowSankeyChart({ nodes, links }: CashFlowSankeyChartProps) {
  if (nodes.length === 0 || links.length === 0) {
    return null;
  }

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodePadding={20}
          margin={{ top: 24, right: 220, bottom: 18, left: 56 }}
          node={(props) => renderNode(props as SankeyNodeRenderProps)}
          link={(props) => renderLink(props as SankeyLinkRenderProps)}
        >
          <Tooltip
            formatter={(value: number) => formatCurrency(value)}
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

interface SankeyNodeRenderProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: CashFlowSankeyNode;
}

function renderNode({ x, y, width, height, payload }: SankeyNodeRenderProps) {
  if (payload.hideLabel) {
    return renderNodeRect({ x, y, width, height, payload });
  }

  const fill = NODE_COLORS[payload.kind] || "#64748b";
  const minWidth = Math.max(10, width);
  const centerY = y + height / 2;
  const isRightSideNode =
    payload.kind === "profit" || payload.kind === "category" || payload.kind === "categoryHub";
  const labelX = isRightSideNode ? x - 8 : x + minWidth + 8;
  const textAnchor = isRightSideNode ? "end" : "start";
  const titleY = Math.max(16, centerY - 6);
  const valueY = Math.max(30, centerY + 10);
  const displayValue =
    typeof payload.displayValue === "number" && Number.isFinite(payload.displayValue)
      ? payload.displayValue
      : payload.value;
  const percentageLabel =
    typeof payload.percent === "number" && Number.isFinite(payload.percent)
      ? ` (${payload.percent.toFixed(2)}%)`
      : "";

  return (
    <g>
      <rect x={x} y={y} width={minWidth} height={height} rx={5} fill={fill} fillOpacity={0.9} />
      <text
        x={labelX}
        y={titleY}
        fill="#0f172a"
        fontSize={11}
        fontWeight={600}
        textAnchor={textAnchor}
        style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {payload.name}
      </text>
      <text x={labelX} y={valueY} fill="#334155" fontSize={12} fontWeight={500} textAnchor={textAnchor}>
        {`${formatCurrency(displayValue)}${percentageLabel}`}
      </text>
    </g>
  );
}

function renderNodeRect({
  x,
  y,
  width,
  height,
  payload
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: CashFlowSankeyNode;
}) {
  const fill = NODE_COLORS[payload.kind] || "#64748b";
  const minWidth = Math.max(10, width);
  return <rect x={x} y={y} width={minWidth} height={height} rx={5} fill={fill} fillOpacity={0.9} />;
}

interface SankeyLinkRenderProps {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
}

function renderLink({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  linkWidth
}: SankeyLinkRenderProps) {
  const half = linkWidth / 2;
  const path = `M${sourceX},${sourceY - half} C${sourceControlX},${sourceY - half} ${
    targetControlX
  },${targetY - half} ${targetX},${targetY - half} L${targetX},${targetY + half} C${
    targetControlX
  },${targetY + half} ${sourceControlX},${sourceY + half} ${sourceX},${sourceY + half} Z`;

  return <path d={path} fill="rgba(148, 163, 184, 0.32)" stroke="none" />;
}
