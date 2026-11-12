"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { useRole } from "@/components/layout/role-provider";
import { canCreateShortageReplenishment } from "@/lib/inventory-shortage-workflow";
import type { RequisitionStatus } from "@/lib/requisition-workflow";
import { formatNumber } from "@/lib/utils";

interface WorkshopShortageRow {
  id: string;
  quantity: number;
  reason: string;
  replenishmentRequisitionId: string | null;
  replenishmentStatus: RequisitionStatus | null;
  replenishmentRequisitionCode: string | null;
  item: {
    name: string;
    sku: string;
    quantityInStock: number;
  };
  rig: { rigCode: string } | null;
  maintenanceRequest: { requestCode: string } | null;
  requestedBy: { fullName: string } | null;
}

const replenishmentLabels: Record<RequisitionStatus, string> = {
  SUBMITTED: "Replenishment submitted",
  APPROVED: "Replenishment approved · awaiting receipt",
  REJECTED: "Replenishment rejected",
  PURCHASE_COMPLETED: "Replenishment received"
};

export function WorkshopShortagesPanel({ refreshToken }: { refreshToken: number }) {
  const { role } = useRole();
  const canPrepareReplenishment = role === "ADMIN" || role === "MANAGER" || role === "OFFICE";
  const [rows, setRows] = useState<WorkshopShortageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/inventory/usage-requests?status=WAITING_FOR_STOCK", {
      cache: "no-store"
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { data?: WorkshopShortageRow[]; message?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to load workshop shortages.");
        }
        if (!cancelled) {
          setRows(Array.isArray(payload?.data) ? payload.data : []);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setRows([]);
          setError(loadError instanceof Error ? loadError.message : "Failed to load workshop shortages.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <Card title="Workshop Shortages">
      <p className="text-xs text-slate-600">
        Maintenance needs waiting for stock. Creating a replenishment request does not issue stock or post a project cost.
      </p>
      {loading ? <p className="mt-3 text-sm text-slate-600">Loading shortages...</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600">
          No inventory shortages are waiting for replenishment.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-3 space-y-2">
          {rows.map((row) => {
            const shortage = Math.max(0, row.quantity - row.item.quantityInStock);
            const canPrepare = canPrepareReplenishment && canCreateShortageReplenishment(row);
            const rejected = row.replenishmentStatus === "REJECTED";
            return (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {row.item.name} <span className="font-normal text-slate-500">({row.item.sku})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-700">
                    Need {formatNumber(row.quantity)} • On hand {formatNumber(row.item.quantityInStock)} • Replenish at least {formatNumber(shortage)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {row.maintenanceRequest?.requestCode || row.rig?.rigCode || "Operational usage"}
                    {row.requestedBy?.fullName ? ` • ${row.requestedBy.fullName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.replenishmentRequisitionId ? (
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      rejected ? "border-rose-200 bg-rose-50 text-rose-700" : "border-blue-200 bg-blue-50 text-blue-700"
                    }`}>
                      {row.replenishmentStatus
                        ? replenishmentLabels[row.replenishmentStatus]
                        : "Replenishment status unavailable"}
                      {rejected && row.replenishmentRequisitionCode ? ` (${row.replenishmentRequisitionCode})` : ""}
                    </span>
                  ) : null}
                  {canPrepare ? (
                    <Link
                      href={`/expenses?workspace=workshop&shortageRequestId=${encodeURIComponent(row.id)}`}
                      className="gf-btn-primary shrink-0 px-3 py-1.5 text-xs"
                    >
                      {rejected ? "Prepare replacement request" : "Prepare stock-up request"}
                    </Link>
                  ) : !row.replenishmentRequisitionId ? (
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                      Waiting for Office
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
