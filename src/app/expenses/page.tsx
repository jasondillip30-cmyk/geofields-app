"use client";

import { Suspense, useCallback, useEffect, useState } from "react";

import { RequisitionWorkflowCard } from "@/components/modules/requisition-workflow-card";
import { AccessGate } from "@/components/layout/access-gate";
import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
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
  const filters: AnalyticsFilters = {
    clientId: "all",
    rigId: "all",
    from: "",
    to: ""
  };
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadReferenceData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [clientsRes, projectsRes, rigsRes] = await Promise.all([
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" })
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
      setClients([]);
      setProjects([]);
      setRigs([]);
      setErrorMessage(
        loadError instanceof Error ? loadError.message : "Failed to load requisition setup data."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  return (
    <AccessGate permission="expenses:manual">
      <div className="gf-page-stack">
        {errorMessage && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {errorMessage}
          </div>
        )}

        <section className="gf-page-header">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900 md:text-[1.7rem]">
              Purchase Requests
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Create requisitions, track approval status, and continue approved requests into receipt intake.
            </p>
          </div>
          <div className="mt-3 border-t border-slate-200/80" />
        </section>

        <section id="expenses-requisition-section" className="gf-section">
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
              onWorkflowChanged={loadReferenceData}
            />
          )}
        </section>
      </div>
    </AccessGate>
  );
}

function ExpensesPageFallback() {
  return (
    <AccessGate permission="expenses:manual">
      <div className="gf-page-stack">
        <Card title="Purchase Requests">
          <p className="text-sm text-ink-600">Loading purchase request workflow...</p>
        </Card>
      </div>
    </AccessGate>
  );
}
