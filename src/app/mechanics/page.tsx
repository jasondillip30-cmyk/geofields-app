"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Badge } from "@/components/ui/badge";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { MechanicDirectoryRow, MechanicsDirectoryPayload } from "@/lib/mechanics-directory";
import { formatNumber } from "@/lib/utils";

const emptyPayload: MechanicsDirectoryPayload = {
  filters: {
    from: null,
    to: null,
    clientId: "all",
    rigId: "all"
  },
  summary: {
    totalMechanics: 0,
    activeRequests: 0,
    completedRequests: 0,
    urgentOpenItems: 0,
    overdueOpenItems: 0,
    rigsCovered: 0,
    specializationsTracked: 0,
    unresolvedDowntimeHours: 0
  },
  data: [],
  availability: {
    mechanicProfiles: "UNAVAILABLE",
    userRoleLinkage: "UNAVAILABLE",
    specialization: "UNAVAILABLE",
    maintenanceWorkload: "UNAVAILABLE",
    rigHistory: "UNAVAILABLE",
    downtimeActivity: "UNAVAILABLE",
    workshopRepairActivity: "UNAVAILABLE"
  },
  notes: []
};

export default function MechanicsPage() {
  const { filters } = useAnalyticsFilters();
  const [payload, setPayload] = useState<MechanicsDirectoryPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams();
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.clientId !== "all") params.set("clientId", filters.clientId);
        if (filters.rigId !== "all") params.set("rigId", filters.rigId);

        const query = params.toString();
        const response = await fetch(`/api/mechanics/directory${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          const message =
            response.status === 403
              ? "You do not have permission to view mechanics directory data."
              : "Failed to load mechanics directory.";
          throw new Error(message);
        }
        const nextPayload = (await response.json()) as MechanicsDirectoryPayload;
        setPayload(nextPayload || emptyPayload);
      } catch (loadError) {
        setPayload(emptyPayload);
        setError(loadError instanceof Error ? loadError.message : "Failed to load mechanics directory.");
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const matrixRows = useMemo(
    () =>
      payload.data.map((entry) => [
        entry.name,
        entry.specialization || "Not yet tracked",
        entry.currentAssignment || "Not assigned",
        `${entry.currentOpenRequests}`,
        `${entry.completedMaintenanceCount}`,
        `${entry.urgentOpenItems} / ${entry.overdueOpenItems}`,
        entry.rigsWorkedOn.length > 0 ? entry.rigsWorkedOn.join(", ") : "None in scope"
      ]),
    [payload.data]
  );

  return (
    <AccessGate permission="mechanics:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        {error ? <div className="gf-feedback-error">{error}</div> : null}

        <section className="gf-section">
          <SectionHeader
            title="Mechanics Directory"
            description="Live workshop and maintenance workload visibility by mechanic profile."
            action={
              <button type="button" onClick={() => void loadDirectory(true)} className="gf-btn-subtle inline-flex items-center gap-1">
                <RotateCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard label="Total Mechanics" value={String(payload.summary.totalMechanics)} />
            <MetricCard label="Active Requests" value={String(payload.summary.activeRequests)} tone="warn" />
            <MetricCard label="Completed Requests" value={String(payload.summary.completedRequests)} tone="good" />
            <MetricCard label="Specializations" value={String(payload.summary.specializationsTracked)} />
          </div>
        </section>

        <Card title="Mechanic Profiles" subtitle="Specialization, assignment, and maintenance workload from live records.">
          {loading ? (
            <p className="text-sm text-ink-600">Loading mechanics directory...</p>
          ) : payload.data.length === 0 ? (
            <p className="gf-empty-state">No mechanic profiles available for the selected scope.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {payload.data.map((entry) => (
                <MechanicProfileCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Mechanic Workload Matrix">
          {loading ? (
            <p className="text-sm text-ink-600">Loading workload matrix...</p>
          ) : matrixRows.length === 0 ? (
            <p className="gf-empty-state">No mechanic workload data found in the selected filters.</p>
          ) : (
            <DataTable
              columns={[
                "Mechanic",
                "Specialization",
                "Current Assignment",
                "Active Requests",
                "Completed Requests",
                "Urgent / Overdue",
                "Rigs Worked On"
              ]}
              rows={matrixRows}
            />
          )}
        </Card>

        <Card title="Data Coverage">
          <DataTable
            columns={["Signal", "Status"]}
            rows={[
              ["Mechanic profiles", payload.availability.mechanicProfiles],
              ["User role linkage", payload.availability.userRoleLinkage],
              ["Specialization data", payload.availability.specialization],
              ["Maintenance workload", payload.availability.maintenanceWorkload],
              ["Rig work history", payload.availability.rigHistory],
              ["Downtime activity", payload.availability.downtimeActivity],
              ["Workshop repair stage activity", payload.availability.workshopRepairActivity]
            ]}
          />
          {payload.notes.length > 0 ? (
            <div className="mt-3 space-y-2">
              {payload.notes.map((note) => (
                <p key={note} className="gf-inline-note">
                  {note}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </AccessGate>
  );
}

function MechanicProfileCard({ entry }: { entry: MechanicDirectoryRow }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-900">
          {initials(entry.name)}
        </div>
        <div>
          <h3 className="font-semibold text-ink-900">{entry.name}</h3>
          <p className="text-sm text-ink-600">{entry.specialization || "Specialization not yet tracked"}</p>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm text-ink-700">
        <p>{entry.phone || "Phone not tracked"}</p>
        <p>{entry.email || "Email not tracked"}</p>
        <p>Role: {entry.roleType}</p>
        <p>Current assignment: {entry.currentAssignment || "Not assigned"}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={statusTone(entry.status)}>{formatStatusLabel(entry.status)}</Badge>
        <Badge tone="slate">{`${entry.currentOpenRequests} active request(s)`}</Badge>
        <Badge tone="slate">{`${entry.completedMaintenanceCount} completed`}</Badge>
        {entry.urgentOpenItems > 0 ? <Badge tone="amber">{`${entry.urgentOpenItems} urgent`}</Badge> : null}
        {entry.overdueOpenItems > 0 ? <Badge tone="red">{`${entry.overdueOpenItems} overdue`}</Badge> : null}
      </div>

      <p className="mt-3 text-xs text-ink-600">
        Rigs worked on: {entry.rigsWorkedOn.length > 0 ? entry.rigsWorkedOn.join(", ") : "None in scope"}
      </p>
      <p className="mt-1 text-xs text-ink-600">
        Repair activity: {entry.repairActivityHistoryIndicator}. Open downtime: {formatNumber(entry.totalEstimatedDowntimeOpenHours)}h
      </p>
      <p className="mt-1 text-xs text-ink-600">
        Open requests: {entry.openRequestReferences.length > 0 ? entry.openRequestReferences.join(", ") : "None"}
      </p>
    </article>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function statusTone(status: string): "blue" | "green" | "amber" | "red" | "slate" {
  if (status === "AVAILABLE") {
    return "green";
  }
  if (status === "ON_JOB" || status === "IN_PROGRESS") {
    return "blue";
  }
  if (status === "OFF_DUTY") {
    return "amber";
  }
  if (status === "UNAVAILABLE") {
    return "red";
  }
  return "slate";
}
