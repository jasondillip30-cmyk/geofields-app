"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface ProjectCommercialsPanelProps {
  projectId: string;
  contractTerms: {
    contractType: string;
    contractTypeLabel: string;
    contractRatePerM: number;
    contractDayRate: number;
    contractLumpSumValue: number;
    estimatedMeters: number;
    estimatedDays: number;
  };
  revenueSnapshot: {
    revenueFormula: string;
    baseContractValue: number | null;
    changeOrderTotalValue: number;
    changeOrderAdjustedContractValue: number | null;
    earnedRevenue: number;
    remainingRevenue: number | null;
    progressPercent: number | null;
    progressBasis: "METERS" | "DAYS" | "STATUS" | "NONE";
    totalMetersDrilled: number;
    workedDays: number;
    approvedReportCount: number;
    adjustedEstimatedMeters: number;
    adjustedEstimatedDays: number;
  };
  changeOrders: Array<{
    id: string;
    description: string;
    addedValue: number;
    addedMeters: number | null;
    addedDays: number | null;
    createdAt: string;
  }>;
}

export function ProjectCommercialsPanel({
  projectId,
  contractTerms,
  revenueSnapshot,
  changeOrders
}: ProjectCommercialsPanelProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [addedValue, setAddedValue] = useState("");
  const [addedMeters, setAddedMeters] = useState("");
  const [addedDays, setAddedDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commercialRateLabel = useMemo(() => {
    if (contractTerms.contractType === "DAY_RATE") {
      return "Day rate";
    }
    if (contractTerms.contractType === "LUMP_SUM") {
      return "Lump-sum value";
    }
    return "Meter rate";
  }, [contractTerms.contractType]);

  const commercialRateValue = useMemo(() => {
    if (contractTerms.contractType === "DAY_RATE") {
      return contractTerms.contractDayRate;
    }
    if (contractTerms.contractType === "LUMP_SUM") {
      return contractTerms.contractLumpSumValue;
    }
    return contractTerms.contractRatePerM;
  }, [contractTerms.contractDayRate, contractTerms.contractLumpSumValue, contractTerms.contractRatePerM, contractTerms.contractType]);

  async function submitChangeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const addedValueNumber = Number(addedValue);
    if (!description.trim()) {
      setError("Change order description is required.");
      return;
    }
    if (!Number.isFinite(addedValueNumber) || addedValueNumber <= 0) {
      setError("Added value must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/commercials/change-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          description: description.trim(),
          addedValue: addedValueNumber,
          addedMeters: addedMeters.trim() ? Number(addedMeters) : null,
          addedDays: addedDays.trim() ? Number(addedDays) : null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to add change order.");
        return;
      }

      setDescription("");
      setAddedValue("");
      setAddedMeters("");
      setAddedDays("");
      setNotice("Change order added.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add change order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-ink-900">Project Commercials</h3>
          <p className="text-sm text-ink-600">
            Revenue terms and earned revenue derived from approved work progress.
          </p>
        </div>
        <Link
          href={`/projects/setup?editProjectId=${projectId}`}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-slate-50"
        >
          Edit commercial terms
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Contract Value (Adjusted)"
          value={
            revenueSnapshot.changeOrderAdjustedContractValue !== null
              ? formatCurrency(revenueSnapshot.changeOrderAdjustedContractValue)
              : "Variable"
          }
        />
        <MetricCard label="Earned Revenue" value={formatCurrency(revenueSnapshot.earnedRevenue)} tone="good" />
        <MetricCard
          label="Remaining Revenue"
          value={
            revenueSnapshot.remainingRevenue !== null
              ? formatCurrency(revenueSnapshot.remainingRevenue)
              : "Not derivable"
          }
          tone="warn"
        />
        <MetricCard
          label="Progress"
          value={revenueSnapshot.progressPercent !== null ? formatPercent(revenueSnapshot.progressPercent) : "-"}
          change={
            revenueSnapshot.progressBasis === "METERS"
              ? "Based on drilled meters"
              : revenueSnapshot.progressBasis === "DAYS"
                ? "Based on worked days"
                : revenueSnapshot.progressBasis === "STATUS"
                  ? "Based on project completion status"
                  : "Progress basis unavailable"
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Commercial Terms">
          <DataTable
            columns={["Field", "Value"]}
            rows={[
              ["Contract type", contractTerms.contractTypeLabel],
              [commercialRateLabel, formatCurrency(commercialRateValue)],
              ["Estimated meters", contractTerms.estimatedMeters > 0 ? formatNumber(contractTerms.estimatedMeters) : "-"],
              ["Estimated days", contractTerms.estimatedDays > 0 ? formatNumber(contractTerms.estimatedDays) : "-"],
              ["Adjusted estimated meters", revenueSnapshot.adjustedEstimatedMeters > 0 ? formatNumber(revenueSnapshot.adjustedEstimatedMeters) : "-"],
              ["Adjusted estimated days", revenueSnapshot.adjustedEstimatedDays > 0 ? formatNumber(revenueSnapshot.adjustedEstimatedDays) : "-"]
            ]}
          />
          <p className="mt-3 text-xs text-ink-600">{revenueSnapshot.revenueFormula}</p>
        </Card>

        <Card title="Work Progress Inputs">
          <DataTable
            columns={["Input", "Value"]}
            rows={[
              ["Approved drilling reports", formatNumber(revenueSnapshot.approvedReportCount)],
              ["Drilled meters", formatNumber(revenueSnapshot.totalMetersDrilled)],
              ["Worked days", formatNumber(revenueSnapshot.workedDays)],
              ["Base contract value", revenueSnapshot.baseContractValue !== null ? formatCurrency(revenueSnapshot.baseContractValue) : "Not derivable"],
              ["Change-order value", formatCurrency(revenueSnapshot.changeOrderTotalValue)],
              [
                "Adjusted contract value",
                revenueSnapshot.changeOrderAdjustedContractValue !== null
                  ? formatCurrency(revenueSnapshot.changeOrderAdjustedContractValue)
                  : "Not derivable"
              ]
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Change Orders" subtitle="Added value and optional added scope for project commercials.">
          {changeOrders.length === 0 ? (
            <p className="text-sm text-ink-600">No change orders recorded yet.</p>
          ) : (
            <DataTable
              columns={["Date", "Description", "Added Value", "Added Meters", "Added Days"]}
              rows={changeOrders.map((order) => [
                order.createdAt.slice(0, 10),
                order.description,
                formatCurrency(order.addedValue),
                order.addedMeters !== null ? formatNumber(order.addedMeters) : "-",
                order.addedDays !== null ? formatNumber(order.addedDays) : "-"
              ])}
            />
          )}
        </Card>

        <Card title="Add Change Order">
          <form onSubmit={submitChangeOrder} className="space-y-3">
            {error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
            ) : null}
            {notice ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>
            ) : null}
            <label className="block text-xs text-ink-700">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                rows={3}
                required
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-xs text-ink-700">
                Added value
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={addedValue}
                  onChange={(event) => setAddedValue(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="block text-xs text-ink-700">
                Added meters (optional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addedMeters}
                  onChange={(event) => setAddedMeters(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-ink-700">
                Added days (optional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addedDays}
                  onChange={(event) => setAddedDays(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Add change order"}
            </button>
          </form>
        </Card>
      </div>
    </section>
  );
}
