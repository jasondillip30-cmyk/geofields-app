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
  description: string | null;
  address: string | null;
  logoUrl: string | null;
  profilePhotoUrl: string | null;
  activeProjects: number;
}

const emptyForm = {
  id: "",
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  description: "",
  address: "",
  logoUrl: "",
  profilePhotoUrl: ""
};

export default function ClientsPage() {
  const { filters } = useAnalyticsFilters();
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function saveClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const isUpdate = Boolean(form.id);
      const endpoint = isUpdate ? `/api/clients/${form.id}` : "/api/clients";
      const response = await fetch(endpoint, {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Failed to save client." }));
        alert(payload.message || "Failed to save client.");
        return;
      }

      setForm(emptyForm);
      await loadClients();
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(id: string) {
    if (!window.confirm("Delete this client?")) {
      return;
    }

    const response = await fetch(`/api/clients/${id}`, {
      method: "DELETE"
    });
    if (response.ok) {
      await loadClients();
    }
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
          <Card title={form.id ? "Edit Client" : "Create Client"}>
            <form onSubmit={saveClient} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Input label="Client Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} required />
              <Input label="Contact Person" value={form.contactPerson} onChange={(value) => setForm((current) => ({ ...current, contactPerson: value }))} />
              <Input label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
              <Input label="Phone" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
              <Input label="Address" value={form.address} onChange={(value) => setForm((current) => ({ ...current, address: value }))} />
              <Input label="Logo URL" value={form.logoUrl} onChange={(value) => setForm((current) => ({ ...current, logoUrl: value }))} />
              <Input label="Profile Photo URL" value={form.profilePhotoUrl} onChange={(value) => setForm((current) => ({ ...current, profilePhotoUrl: value }))} />
              <label className="text-sm text-ink-700 lg:col-span-3">
                <span className="mb-1 block">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <div className="lg:col-span-3 flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving..." : form.id ? "Update Client" : "Create Client"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    onClick={() => setForm(emptyForm)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </Card>
        </AccessGate>

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
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                    onClick={() =>
                      setForm({
                        id: client.id,
                        name: client.name,
                        contactPerson: client.contactPerson || "",
                        email: client.email || "",
                        phone: client.phone || "",
                        description: client.description || "",
                        address: client.address || "",
                        logoUrl: client.logoUrl || "",
                        profilePhotoUrl: client.profilePhotoUrl || ""
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => void deleteClient(client.id)}
                  >
                    Delete
                  </button>
                </div>
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
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}
