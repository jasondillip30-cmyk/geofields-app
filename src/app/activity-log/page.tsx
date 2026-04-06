"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";

interface AuditLogRow {
  id: string;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  description: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}

export default function ActivityLogPage() {
  const pathname = usePathname();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    userId: "all",
    module: "all",
    action: "all",
    entityType: "all"
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    setFilters((current) => ({
      ...current,
      from: searchParams.get("from") || "",
      to: searchParams.get("to") || "",
      userId: searchParams.get("userId") || "all",
      module: searchParams.get("module") || "all",
      action: searchParams.get("action") || "all",
      entityType: searchParams.get("entityType") || "all"
    }));
  }, [pathname]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.userId !== "all") search.set("userId", filters.userId);
      if (filters.module !== "all") search.set("module", filters.module);
      if (filters.action !== "all") search.set("action", filters.action);
      if (filters.entityType !== "all") search.set("entityType", filters.entityType);
      search.set("limit", "400");

      const response = await fetch(`/api/audit-logs?${search.toString()}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : { data: [], filterOptions: { users: [] } };
      setLogs((payload.data || []) as AuditLogRow[]);
      setUsers((payload.filterOptions?.users || []) as UserOption[]);
    } catch {
      setLogs([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [filters.action, filters.entityType, filters.from, filters.module, filters.to, filters.userId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const moduleOptions = useMemo(
    () => uniqueValues(logs.map((item) => item.module)),
    [logs]
  );
  const actionOptions = useMemo(
    () => uniqueValues(logs.map((item) => item.action)),
    [logs]
  );
  const entityTypeOptions = useMemo(
    () => uniqueValues(logs.map((item) => item.entityType)),
    [logs]
  );

  return (
    <AccessGate permission="reports:view">
      <div className="gf-page-stack">
        <Card title="Activity Log" subtitle="Full audit trail for operational and financial actions.">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Input
              label="From"
              type="date"
              value={filters.from}
              onChange={(value) => setFilters((current) => ({ ...current, from: value }))}
            />
            <Input
              label="To"
              type="date"
              value={filters.to}
              onChange={(value) => setFilters((current) => ({ ...current, to: value }))}
            />
            <Select
              label="User"
              value={filters.userId}
              onChange={(value) => setFilters((current) => ({ ...current, userId: value }))}
              options={users.map((user) => ({
                value: user.id,
                label: `${user.name} (${user.role})`
              }))}
            />
            <Select
              label="Module"
              value={filters.module}
              onChange={(value) => setFilters((current) => ({ ...current, module: value }))}
              options={moduleOptions.map((value) => ({ value, label: formatLabel(value) }))}
            />
            <Select
              label="Action"
              value={filters.action}
              onChange={(value) => setFilters((current) => ({ ...current, action: value }))}
              options={actionOptions.map((value) => ({ value, label: formatLabel(value) }))}
            />
            <Select
              label="Entity Type"
              value={filters.entityType}
              onChange={(value) => setFilters((current) => ({ ...current, entityType: value }))}
              options={entityTypeOptions.map((value) => ({ value, label: formatLabel(value) }))}
            />
          </div>
        </Card>

        <Card title="Recent Audit Entries">
          {loading ? (
            <p className="text-sm text-ink-600">Loading activity log...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-ink-600">No audit entries found for the selected filters.</p>
          ) : (
            <DataTable
              columns={["Timestamp", "User", "Module", "Action", "Entity", "Description"]}
              rows={logs.map((entry) => [
                formatDateTime(entry.createdAt),
                entry.actorName || "System",
                formatLabel(entry.module),
                formatLabel(entry.action),
                renderEntityCell(entry),
                entry.description || buildFallbackDescription(entry)
              ])}
            />
          )}
        </Card>
      </div>
    </AccessGate>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter((value) => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildFallbackDescription(entry: AuditLogRow) {
  return `${entry.actorName || "User"} ${entry.action.toLowerCase()} ${entry.entityType} ${entry.entityId}.`;
}

function renderEntityCell(entry: AuditLogRow) {
  if (entry.entityType === "expense") {
    return (
      <Link
        href={`/expenses?expenseId=${encodeURIComponent(entry.entityId)}`}
        className="text-brand-700 underline-offset-2 hover:underline"
      >
        Expense #{entry.entityId.slice(-8)} (Open)
      </Link>
    );
  }

  return `${formatLabel(entry.entityType)} #${entry.entityId.slice(0, 8)}`;
}
