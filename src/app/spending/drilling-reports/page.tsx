"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canAccess } from "@/lib/auth/permissions";
import {
  buildDrillOperationalKpiSummary,
  buildDrillReportDirectCostSummary
} from "@/lib/drilling-direct-cost-summary";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  emptyDrillingSummary,
  type SpendingDrillingSummaryPayload
} from "../spending-page-types";
import { deriveScopedPeriodRange, scaledBarHeight } from "../spending-page-utils";

interface SpendingDrillingReportRow {
  id: string;
  date: string;
  holeNumber: string;
  rigCode: string;
  totalMetersDrilled: number;
  workHours: number;
  delayHours: number;
  rigMoves: number;
  crew: string;
  submittedById: string | null;
}

interface SpendingDrillingReportDetail {
  id: string;
  date: string;
  holeNumber: string;
  areaLocation: string;
  fromMeter: number;
  toMeter: number;
  totalMetersDrilled: number;
  workHours: number;
  rigMoves: number;
  standbyHours: number;
  delayHours: number;
  delayReasonCategory: string | null;
  delayReasonNote: string | null;
  holeContinuityOverrideReason: string | null;
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
  billableAmount: number;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  project: { id: string; name: string; status: string };
  client: { id: string; name: string };
  rig: { id: string; rigCode: string; status: string };
  submittedBy: { id: string; fullName: string } | null;
  inventoryMovements: Array<{
    id: string;
    date: string;
    quantity: number;
    totalCost: number;
    item: { id: string; name: string; sku: string } | null;
  }>;
}

interface SpendingDrillingReportsPayload {
  rows: SpendingDrillingReportRow[];
}

const emptyRows: SpendingDrillingReportRow[] = [];

export default function SpendingDrillingReportsPage() {
  const { role } = useRole();
  const { filters } = useAnalyticsFilters();
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;
  const canViewFinance = Boolean(role && canAccess(role, "finance:view"));
  const [rows, setRows] = useState<SpendingDrillingReportRow[]>(emptyRows);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<SpendingDrillingReportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [timePeriodView, setTimePeriodView] = useState<"monthly" | "yearly">("monthly");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [timePeriodOffset, setTimePeriodOffset] = useState(0);
  const [periodSummary, setPeriodSummary] =
    useState<SpendingDrillingSummaryPayload>(emptyDrillingSummary);
  const [periodLoading, setPeriodLoading] = useState(false);
  const selectedPeriodRange = useMemo(() => {
    if (!selectedPeriodKey) {
      return null;
    }
    return deriveScopedPeriodRange({
      periodView: timePeriodView,
      bucketKey: selectedPeriodKey,
      baseFrom: filters.from,
      baseTo: filters.to
    });
  }, [filters.from, filters.to, selectedPeriodKey, timePeriodView]);
  const effectiveFrom = selectedPeriodRange?.from || filters.from;
  const effectiveTo = selectedPeriodRange?.to || filters.to;

  const spendingHref = useMemo(() => {
    const params = new URLSearchParams();
    if (isSingleProjectScope) {
      params.set("projectId", scopeProjectId);
    }
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    return query ? `/spending?${query}` : "/spending";
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);
  const periodBuckets =
    timePeriodView === "monthly" ? periodSummary.timePeriod.monthly : periodSummary.timePeriod.yearly;
  const visibleBucketCount = timePeriodView === "monthly" ? 10 : 6;
  const maxOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
  const safeOffset = Math.min(timePeriodOffset, maxOffset);
  const visibleBuckets = periodBuckets.slice(safeOffset, safeOffset + visibleBucketCount);
  const periodMaxMeters = periodBuckets.reduce((maxValue, bucket) => Math.max(maxValue, bucket.totalMeters), 0);
  const canGoPrev = safeOffset > 0;
  const canGoNext = safeOffset < maxOffset;
  const selectedPeriodLabel = useMemo(() => {
    if (!selectedPeriodKey) {
      return "";
    }
    const bucket = [...periodSummary.timePeriod.monthly, ...periodSummary.timePeriod.yearly].find(
      (entry) => entry.bucketKey === selectedPeriodKey
    );
    return bucket?.label || selectedPeriodKey;
  }, [periodSummary.timePeriod.monthly, periodSummary.timePeriod.yearly, selectedPeriodKey]);

  const loadRows = useCallback(async () => {
    if (!isSingleProjectScope) {
      setRows(emptyRows);
      setLoadingRows(false);
      return;
    }

    setLoadingRows(true);
    try {
      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (effectiveFrom) params.set("from", effectiveFrom);
      if (effectiveTo) params.set("to", effectiveTo);
      const response = await fetch(`/api/spending/drilling-reports?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = response.ok ? ((await response.json()) as SpendingDrillingReportsPayload) : { rows: [] };
      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(nextRows);
      setSelectedReportId((current) => {
        if (current && nextRows.some((row) => row.id === current)) {
          return current;
        }
        return nextRows[0]?.id || null;
      });
    } catch {
      setRows(emptyRows);
      setSelectedReportId(null);
    } finally {
      setLoadingRows(false);
    }
  }, [effectiveFrom, effectiveTo, isSingleProjectScope, scopeProjectId]);

  const loadDetail = useCallback(async () => {
    if (!isSingleProjectScope || !selectedReportId) {
      setSelectedReport(null);
      setLoadingDetail(false);
      setDetailError(null);
      return;
    }

    setLoadingDetail(true);
    setDetailError(null);
    try {
      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (effectiveFrom) params.set("from", effectiveFrom);
      if (effectiveTo) params.set("to", effectiveTo);
      const response = await fetch(
        `/api/spending/drilling-reports/${encodeURIComponent(selectedReportId)}?${params.toString()}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("Failed to load report detail.");
      }
      const payload = (await response.json()) as { data?: SpendingDrillingReportDetail };
      setSelectedReport(payload.data || null);
    } catch (error) {
      setSelectedReport(null);
      setDetailError(error instanceof Error ? error.message : "Failed to load report detail.");
    } finally {
      setLoadingDetail(false);
    }
  }, [effectiveFrom, effectiveTo, isSingleProjectScope, scopeProjectId, selectedReportId]);

  const loadPeriodSummary = useCallback(async () => {
    if (!isSingleProjectScope) {
      setPeriodSummary(emptyDrillingSummary);
      setPeriodLoading(false);
      return;
    }

    setPeriodLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const response = await fetch(`/api/spending/drilling-reports/summary?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = response.ok
        ? ((await response.json()) as SpendingDrillingSummaryPayload)
        : emptyDrillingSummary;
      setPeriodSummary(normalizeDrillingSummary(payload));
    } catch {
      setPeriodSummary(emptyDrillingSummary);
    } finally {
      setPeriodLoading(false);
    }
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    void loadPeriodSummary();
  }, [loadPeriodSummary]);

  useEffect(() => {
    const targetOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
    setTimePeriodOffset(targetOffset);
  }, [periodBuckets.length, timePeriodView, visibleBucketCount]);

  useEffect(() => {
    if (!selectedPeriodKey) {
      return;
    }
    if (!periodBuckets.some((bucket) => bucket.bucketKey === selectedPeriodKey)) {
      setSelectedPeriodKey("");
    }
  }, [periodBuckets, selectedPeriodKey]);

  const tableRows = useMemo(
    () =>
      rows.map((row) => [
        formatDate(row.date),
        row.holeNumber,
        row.rigCode,
        formatNumber(row.totalMetersDrilled),
        formatNumber(row.workHours),
        formatNumber(row.delayHours),
        formatNumber(row.rigMoves),
        row.crew
      ]),
    [rows]
  );

  const rowClassNames = useMemo(
    () => rows.map((row) => (row.id === selectedReportId ? "bg-brand-50/70" : "")),
    [rows, selectedReportId]
  );

  const reportDirectCost = useMemo(() => {
    if (!canViewFinance || !selectedReport) {
      return null;
    }
    return buildDrillReportDirectCostSummary({
      billableAmount: selectedReport.billableAmount,
      inventoryMovements: selectedReport.inventoryMovements || []
    });
  }, [canViewFinance, selectedReport]);

  const reportOperationalKpi = useMemo(() => {
    if (!selectedReport) {
      return null;
    }
    return buildDrillOperationalKpiSummary({
      totalMetersDrilled: selectedReport.totalMetersDrilled,
      workHours: selectedReport.workHours,
      inventoryMovements: selectedReport.inventoryMovements || []
    });
  }, [selectedReport]);

  const handleTimePeriodViewChange = useCallback((nextView: "monthly" | "yearly") => {
    setTimePeriodView(nextView);
    setSelectedPeriodKey("");
  }, []);

  const handleSelectPeriodBucket = useCallback((bucketKey: string) => {
    setSelectedPeriodKey((current) => (current === bucketKey ? "" : bucketKey));
  }, []);

  return (
    <AccessGate denyBehavior="redirect" anyOf={["finance:view", "drilling:view"]}>
      <div className="gf-page-stack">
        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Drilling reports in Project Operations are project-first. Choose one project in the top bar.
            </p>
          </Card>
        ) : (
          <section className="gf-section space-y-4">
            <Card>
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">TIME PERIOD</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1">
                    <select
                      value={timePeriodView}
                      onChange={(event) => {
                        handleTimePeriodViewChange(event.target.value as "monthly" | "yearly");
                      }}
                      className="rounded-full border-none bg-transparent px-2 py-0.5 text-base text-ink-900 focus:outline-none"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPeriodRange ? (
                      <button
                        type="button"
                        onClick={() => setSelectedPeriodKey("")}
                        className="inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 transition-colors hover:bg-brand-100/70"
                      >
                        Reset scope ({selectedPeriodLabel})
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setTimePeriodOffset((current) => Math.max(0, current - 1))}
                      disabled={!canGoPrev}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                        canGoPrev ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                      )}
                      aria-label="Previous period buckets"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimePeriodOffset((current) => Math.min(maxOffset, current + 1))}
                      disabled={!canGoNext}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                        canGoNext ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                      )}
                      aria-label="Next period buckets"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                {periodLoading ? (
                  <p className="text-sm text-slate-600">Loading drilling time period summary...</p>
                ) : visibleBuckets.length === 0 ? (
                  <p className="text-sm text-slate-600">No drilling time period data for this scope.</p>
                ) : (
                  <>
                    <div className="h-28 rounded-xl border border-slate-100 bg-slate-50/45 px-3 py-2">
                      <div className="flex h-full items-end justify-between gap-2">
                        {visibleBuckets.map((bucket) => (
                          <button
                            key={bucket.bucketKey}
                            type="button"
                            onClick={() => handleSelectPeriodBucket(bucket.bucketKey)}
                            aria-pressed={selectedPeriodKey === bucket.bucketKey}
                            className={cn(
                              "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg px-1 py-1 transition-all duration-200 ease-out",
                              selectedPeriodKey === bucket.bucketKey
                                ? "scale-[1.02] bg-brand-50/55 ring-1 ring-brand-300"
                                : "hover:bg-slate-100/70"
                            )}
                          >
                            <div className="flex h-20 items-end gap-1.5">
                              <div
                                className={cn(
                                  "w-5 rounded transition-all duration-200",
                                  selectedPeriodKey === bucket.bucketKey ? "bg-brand-500" : "bg-brand-500/35"
                                )}
                                style={{
                                  height: `${scaledBarHeight(bucket.totalMeters, periodMaxMeters)}px`
                                }}
                                title={`Meters: ${formatNumber(bucket.totalMeters)}`}
                              />
                            </div>
                            <p
                              className={cn(
                                "truncate text-xs transition-colors duration-200",
                                selectedPeriodKey === bucket.bucketKey ? "font-semibold text-ink-900" : "text-slate-500"
                              )}
                            >
                              {bucket.label}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded bg-brand-500/45" />
                        Meters drilled
                      </span>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card
              title="Project Operations / Drilling reports"
              subtitle={
                canViewFinance
                  ? "Report list and details in the same project operations workspace."
                  : "Report list and details in the same project drilling workspace."
              }
              action={
                <Link href={spendingHref} className="gf-btn-subtle">
                  Back to Project Operations
                </Link>
              }
            >
              <p className="text-sm text-slate-600">
                Browse daily drilling reports here. Use the Drilling workspace to record new report entries.
              </p>
            </Card>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
              <Card title="Drilling reports" subtitle="Select a report to view details">
                {loadingRows ? (
                  <p className="text-sm text-slate-600">Loading drilling reports...</p>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-slate-600">No drilling reports in this scope.</p>
                ) : (
                  <DataTable
                    columns={["Date", "Hole", "Rig", "Meters", "Work hours", "Delay hours", "Rig moves", "Crew"]}
                    rows={tableRows}
                    rowClassNames={rowClassNames}
                    onRowClick={(index) => setSelectedReportId(rows[index]?.id || null)}
                    compact
                  />
                )}
              </Card>

              <Card
                title="Report detail"
                subtitle={
                  selectedReport ? `Hole ${selectedReport.holeNumber}` : "Select a report from the list"
                }
              >
                {loadingDetail ? (
                  <p className="text-sm text-slate-600">Loading report detail...</p>
                ) : detailError ? (
                  <p className="text-sm text-red-700">{detailError}</p>
                ) : !selectedReport ? (
                  <p className="text-sm text-slate-600">Select a report to see detail.</p>
                ) : (
                  <div className="space-y-4 text-sm">
                    <div className="grid gap-1">
                      <DetailRow label="Date" value={formatDate(selectedReport.date)} />
                      <DetailRow label="Client" value={selectedReport.client.name} />
                      <DetailRow label="Project" value={selectedReport.project.name} />
                      <DetailRow label="Rig" value={selectedReport.rig.rigCode} />
                      <DetailRow label="Hole" value={selectedReport.holeNumber} />
                      <DetailRow label="Area" value={selectedReport.areaLocation} />
                      <DetailRow label="Start depth" value={formatNumber(selectedReport.fromMeter)} />
                      <DetailRow label="End depth" value={formatNumber(selectedReport.toMeter)} />
                      <DetailRow label="Meters drilled today" value={formatNumber(selectedReport.totalMetersDrilled)} />
                      <DetailRow label="Work hours" value={formatNumber(selectedReport.workHours)} />
                      <DetailRow label="Rig moves" value={formatNumber(selectedReport.rigMoves)} />
                      <DetailRow label="Standby hours" value={formatNumber(selectedReport.standbyHours)} />
                      <DetailRow label="Delay hours" value={formatNumber(selectedReport.delayHours)} />
                      <DetailRow label="Delay reason" value={formatDelayReason(selectedReport.delayReasonCategory)} />
                      <DetailRow label="Delay note" value={selectedReport.delayReasonNote || "-"} />
                      <DetailRow
                        label="Continuity override reason"
                        value={selectedReport.holeContinuityOverrideReason || "-"}
                      />
                      <DetailRow label="Lead operator" value={selectedReport.leadOperatorName || "-"} />
                      <DetailRow
                        label="Assistants"
                        value={formatNumber(Math.max(0, Number(selectedReport.assistantCount || 0)))}
                      />
                      <DetailRow label="Crew" value={formatCrewSummary(selectedReport)} />
                      {canViewFinance ? (
                        <DetailRow label="Revenue" value={formatCurrency(selectedReport.billableAmount)} />
                      ) : null}
                      <DetailRow label="Comments" value={selectedReport.comments || "-"} />
                      <DetailRow label="Recorded by" value={selectedReport.submittedBy?.fullName || "-"} />
                    </div>

                    {reportDirectCost ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Basic financial summary
                        </p>
                        <div className="mt-2 grid gap-1">
                          <DetailRow label="Revenue" value={formatCurrency(reportDirectCost.revenue)} />
                          <DetailRow
                            label="Consumables cost used"
                            value={formatCurrency(reportDirectCost.consumablesCostUsed)}
                          />
                          <DetailRow label="Simple result" value={formatCurrency(reportDirectCost.simpleResult)} />
                        </div>
                      </div>
                    ) : null}

                    {reportOperationalKpi ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Operational KPIs
                        </p>
                        <div className="mt-2 grid gap-1">
                          <DetailRow label="Meters drilled" value={formatNumber(reportOperationalKpi.metersDrilled)} />
                          <DetailRow label="Work hours" value={formatNumber(reportOperationalKpi.workHours)} />
                          <DetailRow
                            label="Meters per hour"
                            value={
                              reportOperationalKpi.metersPerHour === null
                                ? "—"
                                : formatNumber(reportOperationalKpi.metersPerHour)
                            }
                          />
                          {canViewFinance ? (
                            <>
                              <DetailRow
                                label="Consumables cost used"
                                value={formatCurrency(reportOperationalKpi.consumablesCostUsed)}
                              />
                              <DetailRow
                                label="Consumables cost per meter"
                                value={
                                  reportOperationalKpi.consumablesCostPerMeter === null
                                    ? "—"
                                    : formatCurrency(reportOperationalKpi.consumablesCostPerMeter)
                                }
                              />
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consumables used</p>
                      {selectedReport.inventoryMovements.length === 0 ? (
                        <p className="mt-1 text-xs text-slate-600">No consumables were recorded on this report.</p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {selectedReport.inventoryMovements.slice(0, 8).map((movement) => (
                            <div
                              key={movement.id}
                              className="grid gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:grid-cols-[minmax(0,1fr)_auto]"
                            >
                              <p className="truncate">
                                {formatNumber(movement.quantity)} x {movement.item?.name || "Item"}
                              </p>
                              {canViewFinance ? (
                                <p className="font-medium">{formatCurrency(movement.totalCost || 0)}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Need to add another daily report? Use the Drilling workspace to record it.
                    </p>
                  </div>
                )}
              </Card>
            </section>
          </section>
        )}
      </div>
    </AccessGate>
  );
}

function normalizeDrillingSummary(payload: SpendingDrillingSummaryPayload | null | undefined) {
  const nextSummary = payload || emptyDrillingSummary;
  return {
    ...emptyDrillingSummary,
    ...nextSummary,
    timePeriod: {
      monthly: Array.isArray(nextSummary.timePeriod?.monthly)
        ? nextSummary.timePeriod.monthly
            .map((entry) => ({
              bucketKey: `${entry.bucketKey || ""}`.trim(),
              label: `${entry.label || ""}`.trim(),
              totalMeters: Number.isFinite(entry.totalMeters) ? entry.totalMeters : 0,
              totalReports: Number.isFinite(entry.totalReports) ? entry.totalReports : 0,
              totalWorkHours: Number.isFinite(entry.totalWorkHours) ? entry.totalWorkHours : 0
            }))
            .filter((entry) => entry.bucketKey.length > 0)
        : [],
      yearly: Array.isArray(nextSummary.timePeriod?.yearly)
        ? nextSummary.timePeriod.yearly
            .map((entry) => ({
              bucketKey: `${entry.bucketKey || ""}`.trim(),
              label: `${entry.label || ""}`.trim(),
              totalMeters: Number.isFinite(entry.totalMeters) ? entry.totalMeters : 0,
              totalReports: Number.isFinite(entry.totalReports) ? entry.totalReports : 0,
              totalWorkHours: Number.isFinite(entry.totalWorkHours) ? entry.totalWorkHours : 0
            }))
            .filter((entry) => entry.bucketKey.length > 0)
        : []
    }
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-ink-900">{value}</p>
    </div>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDelayReason(value: string | null) {
  const normalized = `${value || ""}`.trim();
  if (!normalized) {
    return "None";
  }
  return normalized
    .split("_")
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatCrewSummary(report: {
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
}) {
  const leadOperatorName = report.leadOperatorName?.trim() || "";
  const operatorCrew = report.operatorCrew?.trim() || "";
  const assistantCount = Math.max(0, Math.round(Number(report.assistantCount || 0)));
  if (leadOperatorName && assistantCount > 0) {
    return `${leadOperatorName} + ${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (leadOperatorName) {
    return leadOperatorName;
  }
  if (assistantCount > 0) {
    return `${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (operatorCrew) {
    return operatorCrew;
  }
  return "Crew not recorded";
}
