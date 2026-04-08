"use client";

import { useId } from "react";

import { formatCurrency } from "@/lib/utils";

interface SpendingProfitFlowCategory {
  name: string;
  value: number;
}

interface SpendingProfitFlowChartProps {
  revenue: number;
  expenses: number;
  profit: number;
  categories: SpendingProfitFlowCategory[];
}

const SVG_WIDTH = 1360;
const SVG_HEIGHT = 430;
const LEFT_RAIL_X = 86;
const EXPENSE_RAIL_X = 470;
const CATEGORY_HUB_X = 820;
const RIGHT_RAIL_X = 1160;
const RAIL_WIDTH = 18;
const CURVE = 0.38;

const CHART_TOP = 34;
const EXPENSE_TOP = 82;
const EXPENSE_BOTTOM = 386;
const TOP_LANE_HEIGHT = 30;
const LANE_SEPARATION = 20;

const SOURCE_PROFIT_TOP = EXPENSE_TOP;
const SOURCE_PROFIT_BOTTOM = SOURCE_PROFIT_TOP + TOP_LANE_HEIGHT;
const SOURCE_CATEGORY_TOP = SOURCE_PROFIT_BOTTOM + LANE_SEPARATION;
const SOURCE_CATEGORY_BOTTOM = EXPENSE_BOTTOM;
const SOURCE_CATEGORY_HEIGHT = SOURCE_CATEGORY_BOTTOM - SOURCE_CATEGORY_TOP;

const TARGET_PROFIT_TOP = CHART_TOP;
const RIGHT_LABEL_X = RIGHT_RAIL_X - 20;

const COLOR_RAIL_REVENUE = "#0f766e";
const COLOR_RAIL_EXPENSES = "#84cc16";
const COLOR_RAIL_CATEGORY = "#38bdf8";
const COLOR_RAIL_PROFIT = "#c026d3";
const COLOR_RAIL_LOSS = "#e11d48";

export function SpendingProfitFlowChart({ revenue, expenses, profit, categories }: SpendingProfitFlowChartProps) {
  const gradientSeed = useId().replace(/[:]/g, "");
  const safeRevenue = safeNumber(revenue);
  const safeExpenses = safeNumber(expenses);
  const safeProfit = safeNumber(profit);
  const positiveCategories = categories
    .map((entry) => ({
      name: normalizeLabel(entry.name, "Uncategorized"),
      value: safeNumber(entry.value)
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);

  if (safeRevenue <= 0 || safeExpenses <= 0) {
    return null;
  }

  const profitOrLossValue = Math.abs(safeProfit);
  const topFlowHeight =
    profitOrLossValue <= 0
      ? 0
      : clamp(12, 28, 12 + (profitOrLossValue / Math.max(safeExpenses, 1)) * 20);
  const targetProfitBottom = TARGET_PROFIT_TOP + topFlowHeight;
  const isLoss = safeProfit < 0;

  const categoryRows = buildCategoryRows({
    categories: positiveCategories,
    laneTop: SOURCE_CATEGORY_TOP,
    laneHeight: SOURCE_CATEGORY_HEIGHT
  });
  const labelCenters = buildLabelCenters({
    rows: categoryRows,
    minCenterGap: 46,
    minY: SOURCE_CATEGORY_TOP + 18,
    maxY: SOURCE_CATEGORY_BOTTOM - 14
  });

  const revenuePercent = 100;
  const expensesPercent = safeRevenue > 0 ? (safeExpenses / safeRevenue) * 100 : 0;
  const profitPercent = safeRevenue > 0 ? (safeProfit / safeRevenue) * 100 : 0;

  const mainBackbonePath = ribbonPath({
    x1: LEFT_RAIL_X + RAIL_WIDTH,
    x2: EXPENSE_RAIL_X,
    y1Top: EXPENSE_TOP,
    y1Bottom: EXPENSE_BOTTOM,
    y2Top: EXPENSE_TOP,
    y2Bottom: EXPENSE_BOTTOM
  });

  const expensesToHubPath = ribbonPath({
    x1: EXPENSE_RAIL_X + RAIL_WIDTH,
    x2: CATEGORY_HUB_X,
    y1Top: SOURCE_CATEGORY_TOP,
    y1Bottom: SOURCE_CATEGORY_BOTTOM,
    y2Top: SOURCE_CATEGORY_TOP,
    y2Bottom: SOURCE_CATEGORY_BOTTOM
  });

  const topBranchPath =
    topFlowHeight > 0
      ? ribbonPath({
          x1: EXPENSE_RAIL_X + RAIL_WIDTH,
          x2: RIGHT_RAIL_X,
          y1Top: SOURCE_PROFIT_TOP,
          y1Bottom: SOURCE_PROFIT_TOP + topFlowHeight,
          y2Top: TARGET_PROFIT_TOP,
          y2Bottom: targetProfitBottom
        })
      : null;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="h-[430px] w-full"
        role="img"
        aria-label="Cash flow from revenue to expenses and profit/loss, with expense category breakdown."
      >
        <defs>
          <linearGradient id={`flow-main-${gradientSeed}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d9e0ea" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#bdc8d8" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id={`flow-category-${gradientSeed}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#cfe8fb" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#a8d2f2" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id={`flow-profit-${gradientSeed}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f3d6f8" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#d9b5ee" stopOpacity="0.96" />
          </linearGradient>
          <linearGradient id={`flow-loss-${gradientSeed}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f9d4dc" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f3a4b3" stopOpacity="0.96" />
          </linearGradient>
        </defs>

        <path d={mainBackbonePath} fill={`url(#flow-main-${gradientSeed})`} />
        <path d={expensesToHubPath} fill={`url(#flow-main-${gradientSeed})`} />

        {topBranchPath ? (
          <path d={topBranchPath} fill={`url(#${isLoss ? `flow-loss-${gradientSeed}` : `flow-profit-${gradientSeed}`})`} />
        ) : null}

        {categoryRows.map((row) => (
          <path
            key={`cat-flow-${row.name}`}
            d={ribbonPath({
              x1: CATEGORY_HUB_X + RAIL_WIDTH,
              x2: RIGHT_RAIL_X,
              y1Top: row.sourceTop,
              y1Bottom: row.sourceBottom,
              y2Top: row.targetTop,
              y2Bottom: row.targetBottom
            })}
            fill={`url(#flow-category-${gradientSeed})`}
          />
        ))}

        <NodeRail x={LEFT_RAIL_X} y={EXPENSE_TOP} height={EXPENSE_BOTTOM - EXPENSE_TOP} color={COLOR_RAIL_REVENUE} />
        <NodeRail x={EXPENSE_RAIL_X} y={EXPENSE_TOP} height={EXPENSE_BOTTOM - EXPENSE_TOP} color={COLOR_RAIL_EXPENSES} />
        <NodeRail
          x={CATEGORY_HUB_X}
          y={SOURCE_CATEGORY_TOP}
          height={SOURCE_CATEGORY_BOTTOM - SOURCE_CATEGORY_TOP}
          color={COLOR_RAIL_CATEGORY}
        />
        {topFlowHeight > 0 ? (
          <NodeRail
            x={RIGHT_RAIL_X}
            y={TARGET_PROFIT_TOP}
            height={topFlowHeight}
            color={isLoss ? COLOR_RAIL_LOSS : COLOR_RAIL_PROFIT}
          />
        ) : null}
        {categoryRows.map((row) => (
          <NodeRail key={`cat-rail-${row.name}`} x={RIGHT_RAIL_X} y={row.targetTop} height={row.targetBottom - row.targetTop} color={COLOR_RAIL_CATEGORY} />
        ))}

        <TwoLineLabel
          x={LEFT_RAIL_X + RAIL_WIDTH + 22}
          y={EXPENSE_TOP + (EXPENSE_BOTTOM - EXPENSE_TOP) * 0.5}
          title="REVENUE"
          detail={`${formatCurrency(safeRevenue)} (${formatPercentText(revenuePercent)})`}
          anchor="start"
        />
        <TwoLineLabel
          x={EXPENSE_RAIL_X + RAIL_WIDTH + 22}
          y={EXPENSE_TOP + (EXPENSE_BOTTOM - EXPENSE_TOP) * 0.5}
          title="EXPENSES"
          detail={`${formatCurrency(safeExpenses)} (${formatPercentText(expensesPercent)})`}
          anchor="start"
        />

        <TwoLineLabel
          x={RIGHT_LABEL_X}
          y={TARGET_PROFIT_TOP + (topFlowHeight > 0 ? topFlowHeight / 2 : 12)}
          title={isLoss ? "LOSS" : "PROFIT"}
          detail={`${formatCurrency(safeProfit)} (${formatPercentText(profitPercent)})`}
          anchor="end"
        />

        {categoryRows.map((row, index) => (
          <TwoLineLabel
            key={`cat-label-${row.name}`}
            x={RIGHT_LABEL_X}
            y={labelCenters[index]}
            title={truncateText(row.name.toUpperCase(), 24)}
            detail={`${formatCurrency(row.value)} (${formatPercentText(row.percentOfExpenses)})`}
            anchor="end"
            tooltipTitle={row.name}
          />
        ))}
      </svg>
    </div>
  );
}

function buildCategoryRows({
  categories,
  laneTop,
  laneHeight
}: {
  categories: SpendingProfitFlowCategory[];
  laneTop: number;
  laneHeight: number;
}) {
  if (categories.length === 0 || laneHeight <= 0) {
    return [] as Array<{
      name: string;
      value: number;
      percentOfExpenses: number;
      sourceTop: number;
      sourceBottom: number;
      targetTop: number;
      targetBottom: number;
    }>;
  }

  const count = categories.length;
  const gap = count > 1 ? 10 : 0;
  const gapTotal = gap * Math.max(0, count - 1);
  const availableHeight = Math.max(1, laneHeight - gapTotal);
  const totalValue = categories.reduce((sum, entry) => sum + safeNumber(entry.value), 0);
  const rawHeights = categories.map((entry) => {
    const ratio = totalValue > 0 ? safeNumber(entry.value) / totalValue : 0;
    return ratio * availableHeight;
  });
  const minHeight = Math.min(22, Math.max(7, availableHeight / Math.max(1, count) * 0.5));
  const heights = normalizeHeights(rawHeights, availableHeight, minHeight);

  let cursor = laneTop;
  const rows: Array<{
    name: string;
    value: number;
    percentOfExpenses: number;
    sourceTop: number;
    sourceBottom: number;
    targetTop: number;
    targetBottom: number;
  }> = [];

  categories.forEach((entry, index) => {
    const height = heights[index] || 0;
    const top = cursor;
    const bottom = top + height;
    cursor = bottom + gap;

    rows.push({
      name: entry.name,
      value: safeNumber(entry.value),
      percentOfExpenses: totalValue > 0 ? (safeNumber(entry.value) / totalValue) * 100 : 0,
      sourceTop: top,
      sourceBottom: bottom,
      targetTop: top,
      targetBottom: bottom
    });
  });

  return rows;
}

function normalizeHeights(rawHeights: number[], total: number, minHeight: number) {
  const heights = rawHeights.map((height) => Math.max(minHeight, height));
  let currentTotal = heights.reduce((sum, entry) => sum + entry, 0);

  if (currentTotal <= 0 || total <= 0) {
    return rawHeights.map(() => 0);
  }

  if (currentTotal > total) {
    let overflow = currentTotal - total;
    while (overflow > 0.01) {
      const adjustableIndices = heights
        .map((height, index) => ({ height, index }))
        .filter((entry) => entry.height > minHeight + 0.01);
      if (adjustableIndices.length === 0) {
        const fallback = total / Math.max(1, heights.length);
        return heights.map(() => fallback);
      }
      const adjustableSpace = adjustableIndices.reduce((sum, entry) => sum + (entry.height - minHeight), 0);
      adjustableIndices.forEach((entry) => {
        const reducible = entry.height - minHeight;
        const delta = overflow * (reducible / adjustableSpace);
        heights[entry.index] = Math.max(minHeight, entry.height - delta);
      });
      currentTotal = heights.reduce((sum, entry) => sum + entry, 0);
      overflow = currentTotal - total;
    }
  } else if (currentTotal < total) {
    const deficit = total - currentTotal;
    const rawTotal = rawHeights.reduce((sum, entry) => sum + Math.max(0, entry), 0);
    heights.forEach((height, index) => {
      const ratio = rawTotal > 0 ? Math.max(0, rawHeights[index]) / rawTotal : 1 / heights.length;
      heights[index] = height + deficit * ratio;
    });
  }

  return heights;
}

function buildLabelCenters({
  rows,
  minCenterGap,
  minY,
  maxY
}: {
  rows: Array<{ targetTop: number; targetBottom: number }>;
  minCenterGap: number;
  minY: number;
  maxY: number;
}) {
  if (rows.length === 0) {
    return [] as number[];
  }

  const centers = rows.map((row) => (row.targetTop + row.targetBottom) / 2);
  for (let index = 0; index < centers.length; index += 1) {
    if (index === 0) {
      centers[index] = Math.max(minY, centers[index]);
      continue;
    }
    centers[index] = Math.max(centers[index], centers[index - 1] + minCenterGap);
  }

  const overflow = centers[centers.length - 1] - maxY;
  if (overflow > 0) {
    for (let index = 0; index < centers.length; index += 1) {
      centers[index] -= overflow;
    }
  }

  if (centers[0] < minY) {
    const pushDown = minY - centers[0];
    for (let index = 0; index < centers.length; index += 1) {
      centers[index] += pushDown;
    }
  }

  return centers;
}

function NodeRail({ x, y, height, color }: { x: number; y: number; height: number; color: string }) {
  return <rect x={x} y={y} width={RAIL_WIDTH} height={Math.max(8, height)} rx={8} fill={color} fillOpacity={0.96} />;
}

function TwoLineLabel({
  x,
  y,
  title,
  detail,
  anchor,
  tooltipTitle
}: {
  x: number;
  y: number;
  title: string;
  detail: string;
  anchor: "start" | "end";
  tooltipTitle?: string;
}) {
  return (
    <g>
      <title>{tooltipTitle || title}</title>
      <text
        x={x}
        y={Math.max(18, y - 7)}
        textAnchor={anchor}
        fill="#0f172a"
        fontSize={11}
        fontWeight={700}
        style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {title}
      </text>
      <text x={x} y={Math.max(31, y + 14)} textAnchor={anchor} fill="#334155" fontSize={12} fontWeight={500}>
        {detail}
      </text>
    </g>
  );
}

function ribbonPath({
  x1,
  x2,
  y1Top,
  y1Bottom,
  y2Top,
  y2Bottom
}: {
  x1: number;
  x2: number;
  y1Top: number;
  y1Bottom: number;
  y2Top: number;
  y2Bottom: number;
}) {
  const dx = x2 - x1;
  const c1 = x1 + dx * CURVE;
  const c2 = x2 - dx * CURVE;
  return `M${x1},${y1Top} C${c1},${y1Top} ${c2},${y2Top} ${x2},${y2Top} L${x2},${y2Bottom} C${c2},${y2Bottom} ${c1},${y1Bottom} ${x1},${y1Bottom} Z`;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, safeNumber(value)));
}

function formatPercentText(value: number) {
  return `${safeNumber(value).toFixed(2)}%`;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}
