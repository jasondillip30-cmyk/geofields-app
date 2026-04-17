"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";

interface Client {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  description: string | null;
  logoUrl: string | null;
  profilePhotoUrl: string | null;
  activeProjects: number;
}

export default function ClientsPage() {
  const { filters } = useAnalyticsFilters();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.projectId !== "all") {
        search.set("projectId", filters.projectId);
      } else {
        if (filters.clientId !== "all") search.set("clientId", filters.clientId);
        if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      }

      const query = search.toString();
      const response = await fetch(`/api/clients${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = await response.json();
      setClients(payload.data || []);
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const selectedClient = useMemo(() => {
    if (isSingleProjectScope) {
      return clients[0] || null;
    }
    if (filters.clientId === "all") {
      return null;
    }
    return clients.find((client) => client.id === filters.clientId) || null;
  }, [clients, filters.clientId, isSingleProjectScope]);

  const isScoped = hasActiveScopeFilters(filters);

  const spendingHref = useMemo(() => {
    const params = new URLSearchParams();
    if (scopeProjectId) params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    return query ? `/spending?${query}` : "/spending";
  }, [filters.from, filters.to, scopeProjectId]);

  async function deleteClient(id: string) {
    if (!window.confirm("Delete this client?")) {
      return;
    }

    setError(null);
    setNotice(null);
    const response = await fetch(`/api/clients/${id}`, {
      method: "DELETE"
    });
    if (response.ok) {
      await loadClients();
      setNotice("Client deleted.");
      return;
    }
    setError("Unable to delete client.");
  }

  return (
    <AccessGate denyBehavior="redirect" permission="clients:view">
      <div className="gf-page-stack">
        <FilterScopeBanner
          filters={filters}
          clientLabel={selectedClient?.name || null}
        />
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        ) : null}
        {notice ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        {isSingleProjectScope ? (
          <Card
            title="Client profile"
            action={
              <AccessGate permission="clients:manage">
                <Link
                  href="/clients/setup"
                  className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  New
                </Link>
              </AccessGate>
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading client profile...</p>
            ) : selectedClient ? (
              <div className="space-y-4">
                <DataTable
                  compact
                  columns={["Detail", "Value"]}
                  rows={[
                    ["Client", selectedClient.name],
                    ["Contact", selectedClient.contactPerson || "-"],
                    ["Email", selectedClient.email || "-"],
                    ["Phone", selectedClient.phone || "-"],
                    ["Address", selectedClient.address || "-"],
                    ["Description", selectedClient.description || "-"]
                  ]}
                />

                <div className="flex flex-wrap gap-2">
                  <AccessGate permission="clients:manage">
                    <Link
                      href={`/clients/setup?editClientId=${selectedClient.id}`}
                      className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
                    >
                      Edit client setup
                    </Link>
                  </AccessGate>
                  <AccessGate permission="projects:view">
                    <Link
                      href={`/projects/${scopeProjectId}`}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
                    >
                      Open project
                    </Link>
                  </AccessGate>
                  <AccessGate anyOf={["finance:view", "drilling:view"]}>
                    <Link
                      href={spendingHref}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
                    >
                      Open spending
                    </Link>
                  </AccessGate>
                </div>

                {selectedClient.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedClient.logoUrl}
                    alt={`${selectedClient.name} logo`}
                    className="h-16 w-auto rounded border border-slate-200 object-contain"
                  />
                ) : null}
                {selectedClient.profilePhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedClient.profilePhotoUrl}
                    alt={`${selectedClient.name} profile`}
                    className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-700">
                No client is linked to the selected project. Check project setup and try again.
              </p>
            )}
          </Card>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <MetricCard label={isScoped ? "Clients in Scope" : "Total Clients"} value={String(clients.length)} />
              <MetricCard
                label="Clients with Active Projects"
                value={String(clients.filter((client) => client.activeProjects > 0).length)}
              />
              <MetricCard
                label="Top Active Client"
                value={[...clients].sort((a, b) => b.activeProjects - a.activeProjects)[0]?.name || "N/A"}
              />
            </section>

            <AccessGate permission="clients:manage">
              <section className="flex justify-end">
                <Link
                  href="/clients/setup"
                  className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Create client
                </Link>
              </section>
            </AccessGate>

            <Card title="Client Directory">
              {loading ? (
                <p className="text-sm text-ink-600">Loading clients...</p>
              ) : (
                <DataTable
                  columns={["Client", "Contact", "Email", "Phone", "Active Projects", "Actions"]}
                  rows={clients.map((client) => [
                    <Link
                      key={client.id}
                      href={`/clients/${client.id}`}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {client.name}
                    </Link>,
                    client.contactPerson || "-",
                    client.email || "-",
                    client.phone || "-",
                    String(client.activeProjects),
                    <div key={`actions-${client.id}`} className="flex gap-2">
                      <AccessGate permission="clients:manage">
                        <Link
                          href={`/clients/setup?editClientId=${client.id}`}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                      </AccessGate>
                      <AccessGate permission="clients:manage">
                        <button
                          type="button"
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          onClick={() => void deleteClient(client.id)}
                        >
                          Delete
                        </button>
                      </AccessGate>
                    </div>
                  ])}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </AccessGate>
  );
}
