"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";

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

export default function ClientSetupPage() {
  return (
    <Suspense fallback={<ClientSetupFallback />}>
      <ClientSetupPageContent />
    </Suspense>
  );
}

function ClientSetupPageContent() {
  const searchParams = useSearchParams();
  const queryClientId = searchParams.get("editClientId")?.trim() || searchParams.get("clientId")?.trim() || "";

  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydratedClientId, setHydratedClientId] = useState("");

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      setClients(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (!queryClientId) {
      if (hydratedClientId) {
        setHydratedClientId("");
      }
      return;
    }
    if (queryClientId === hydratedClientId) {
      return;
    }

    const match = clients.find((client) => client.id === queryClientId);
    if (!match) {
      if (!loading) {
        setError("Client was not found for editing.");
      }
      return;
    }

    setForm({
      id: match.id,
      name: match.name,
      contactPerson: match.contactPerson || "",
      email: match.email || "",
      phone: match.phone || "",
      description: match.description || "",
      address: match.address || "",
      logoUrl: match.logoUrl || "",
      profilePhotoUrl: match.profilePhotoUrl || ""
    });
    setNotice(`Editing client: ${match.name}`);
    setError(null);
    setHydratedClientId(queryClientId);
  }, [clients, hydratedClientId, loading, queryClientId]);

  async function saveClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

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
        setError(payload.message || "Failed to save client.");
        return;
      }

      setForm(emptyForm);
      setHydratedClientId("");
      await loadClients();
      setNotice(isUpdate ? "Client updated successfully." : "Client created successfully.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGate permission="clients:manage">
      <div className="gf-page-stack">
        <section className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink-900">{form.id ? "Edit Client" : "Create Client"}</h1>
          <Link
            href="/clients"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-ink-700 hover:bg-slate-50"
          >
            Back to Clients
          </Link>
        </section>

        <Card title={form.id ? "Edit Client" : "Create Client"}>
          {loading ? <p className="text-sm text-ink-600">Loading client setup...</p> : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          ) : null}
          {notice ? (
            <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}

          <form onSubmit={saveClient} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              label="Client Name"
              value={form.name}
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              required
            />
            <Input
              label="Contact Person"
              value={form.contactPerson}
              onChange={(value) => setForm((current) => ({ ...current, contactPerson: value }))}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
            />
            <Input
              label="Address"
              value={form.address}
              onChange={(value) => setForm((current) => ({ ...current, address: value }))}
            />
            <Input
              label="Logo URL"
              value={form.logoUrl}
              onChange={(value) => setForm((current) => ({ ...current, logoUrl: value }))}
            />
            <Input
              label="Profile Photo URL"
              value={form.profilePhotoUrl}
              onChange={(value) => setForm((current) => ({ ...current, profilePhotoUrl: value }))}
            />
            <label className="text-sm text-ink-700 lg:col-span-3">
              <span className="mb-1 block">Description</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <div className="flex gap-2 lg:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : form.id ? "Update Client" : "Create Client"}
              </button>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyForm);
                    setHydratedClientId("");
                    setNotice(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
    </AccessGate>
  );
}

function ClientSetupFallback() {
  return (
    <AccessGate permission="clients:manage">
      <div className="gf-page-stack">
        <Card title="Create Client">
          <p className="text-sm text-ink-600">Loading client setup...</p>
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
