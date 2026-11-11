"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { RequisitionWorkflowCard } from "@/components/modules/requisition-workflow-card";
import { WorkshopShortagesPanel } from "@/components/modules/workshop-shortages-panel";
import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card } from "@/components/ui/card";

interface ClientOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  clientId: string;
  assignedRigId: string | null;
}

interface RigOption {
  id: string;
  name: string;
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<ExpensesPageFallback />}>
      <ExpensesPageContent />
    </Suspense>
  );
}

function ExpensesPageContent() {
  const searchParams = useSearchParams();
  const { filters } = useAnalyticsFilters();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shortagesRefreshToken, setShortagesRefreshToken] = useState(0);
  const isProjectLocked = filters.workspaceMode === "project" && filters.projectId !== "all";

  const loadReferenceData = useCallback(async (options?: { preserveUi?: boolean }) => {
    const preserveUi = options?.preserveUi === true;
    if (!preserveUi) {
      setLoading(true);
      setErrorMessage(null);
    }
    try {
      const scopedQuery = new URLSearchParams();
      if (isProjectLocked) {
        scopedQuery.set("projectId", filters.projectId);
      }
      const scopedSuffix = scopedQuery.toString() ? `?${scopedQuery.toString()}` : "";
      const [clientsRes, projectsRes, rigsRes] = await Promise.all([
        fetch(`/api/clients${scopedSuffix}`, { cache: "no-store" }),
        fetch(`/api/projects${scopedSuffix}`, { cache: "no-store" }),
        fetch(`/api/rigs${scopedSuffix}`, { cache: "no-store" })
      ]);

      const clientsPayload = clientsRes.ok ? await clientsRes.json() : { data: [] };
      const projectsPayload = projectsRes.ok ? await projectsRes.json() : { data: [] };
      const rigsPayload = rigsRes.ok ? await rigsRes.json() : { data: [] };

      setClients(
        (clientsPayload.data || []).map((entry: { id: string; name: string }) => ({
          id: entry.id,
          name: entry.name
        }))
      );
      setProjects(
        (projectsPayload.data || []).map(
          (entry: { id: string; name: string; clientId: string; assignedRigId?: string | null }) => ({
            id: entry.id,
            name: entry.name,
            clientId: entry.clientId,
            assignedRigId: entry.assignedRigId || null
          })
        )
      );
      setRigs(
        (rigsPayload.data || []).map((entry: { id: string; rigCode?: string; name?: string }) => ({
          id: entry.id,
          name: entry.name || entry.rigCode || "Unnamed Rig"
        }))
      );
    } catch (loadError) {
      if (!preserveUi) {
        setClients([]);
        setProjects([]);
        setRigs([]);
      }
      setErrorMessage(
        loadError instanceof Error ? loadError.message : "Failed to load requisition setup data."
      );
    } finally {
      if (!preserveUi) {
        setLoading(false);
      }
    }
  }, [filters.projectId, isProjectLocked]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  return (
    <AccessGate permission="requisitions:view">
      <div className="gf-page-stack">
        {errorMessage && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {errorMessage}
          </div>
        )}

        <section className="gf-page-header">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900 md:text-[1.7rem]">
              Workshop Purchase Requests
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Replenish workshop inventory, track approval status, and complete approved purchases through receipt intake.
            </p>
          </div>
          <div className="mt-3 border-t border-slate-200/80" />
        </section>

        <section id="expenses-requisition-section" className="gf-section">
          <WorkshopShortagesPanel refreshToken={shortagesRefreshToken} />
          {loading ? (
            <Card title="Loading Purchase Request Workspace">
              <p className="text-sm text-ink-600">Loading clients, projects, rigs, and requisition history...</p>
            </Card>
          ) : (
            <RequisitionWorkflowCard
              filters={filters}
              clients={clients}
              projects={projects}
              rigs={rigs}
              initialContext={{
                shortageRequestId: searchParams.get("shortageRequestId") || undefined
              }}
              onWorkflowChanged={async () => {
                setShortagesRefreshToken((current) => current + 1);
                await loadReferenceData({ preserveUi: true });
              }}
            />
          )}
        </section>
      </div>
    </AccessGate>
  );
}

function ExpensesPageFallback() {
  return (
    <AccessGate permission="requisitions:view">
      <div className="gf-page-stack">
        <Card title="Workshop Purchase Requests">
          <p className="text-sm text-ink-600">Loading workshop stock replenishment workflow...</p>
        </Card>
      </div>
    </AccessGate>
  );
}
