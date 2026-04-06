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
  activeProjects: number;
}

export default function ClientsPage() {
  const { filters } = useAnalyticsFilters();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);

      const query = search.toString();
      const response = await fetch(`/api/clients${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = await response.json();
      setClients(payload.data || []);
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const selectedClientName = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    return clients.find((client) => client.id === filters.clientId)?.name || null;
  }, [clients, filters.clientId]);

  const isScoped = hasActiveScopeFilters(filters);

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
    <AccessGate permission="clients:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} clientLabel={selectedClientName} />

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

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        ) : null}
        {notice ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        <Card title="Client Directory">
          {loading ? (
            <p className="text-sm text-ink-600">Loading clients...</p>
          ) : (
            <DataTable
              columns={["Client", "Contact", "Email", "Phone", "Active Projects", "Actions"]}
              rows={clients.map((client) => [
                <Link key={client.id} href={`/clients/${client.id}`} className="text-brand-700 underline-offset-2 hover:underline">
                  {client.name}
                </Link>,
                client.contactPerson || "-",
                client.email || "-",
                client.phone || "-",
                String(client.activeProjects),
                <div key={`actions-${client.id}`} className="flex gap-2">
                  <AccessGate permission="clients:manage">
                    <Link
                      href={`/clients/setup?clientId=${client.id}`}
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
      </div>
    </AccessGate>
  );
}
