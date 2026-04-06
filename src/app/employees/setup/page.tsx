"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";

interface Employee {
  id: string;
  fullName: string;
  email: string;
  role: "ADMIN" | "OFFICE" | "MECHANIC" | "FIELD";
  phone: string | null;
  title: string | null;
  profileImageUrl: string | null;
  currentAssignment: string | null;
  isActive: boolean;
}

const emptyForm = {
  id: "",
  fullName: "",
  email: "",
  password: "",
  role: "FIELD",
  phone: "",
  title: "",
  profileImageUrl: "",
  currentAssignment: "",
  isActive: true
};

export default function EmployeeSetupPage() {
  return (
    <Suspense fallback={<EmployeeSetupFallback />}>
      <EmployeeSetupPageContent />
    </Suspense>
  );
}

function EmployeeSetupPageContent() {
  const searchParams = useSearchParams();
  const queryEmployeeId = searchParams.get("employeeId")?.trim() || "";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydratedEmployeeId, setHydratedEmployeeId] = useState("");

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/employees", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      setEmployees(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (!queryEmployeeId) {
      if (hydratedEmployeeId) {
        setHydratedEmployeeId("");
      }
      return;
    }
    if (queryEmployeeId === hydratedEmployeeId) {
      return;
    }

    const match = employees.find((employee) => employee.id === queryEmployeeId);
    if (!match) {
      if (!loading) {
        setError("Employee was not found for editing.");
      }
      return;
    }

    setForm({
      id: match.id,
      fullName: match.fullName,
      email: match.email,
      password: "",
      role: match.role,
      phone: match.phone || "",
      title: match.title || "",
      profileImageUrl: match.profileImageUrl || "",
      currentAssignment: match.currentAssignment || "",
      isActive: match.isActive
    });
    setNotice(`Editing employee: ${match.fullName}`);
    setError(null);
    setHydratedEmployeeId(queryEmployeeId);
  }, [employees, hydratedEmployeeId, loading, queryEmployeeId]);

  async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const isUpdate = Boolean(form.id);
      const endpoint = isUpdate ? `/api/employees/${form.id}` : "/api/employees";
      const method = isUpdate ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Failed to save employee." }));
        setError(payload.message || "Failed to save employee.");
        return;
      }

      setForm(emptyForm);
      setHydratedEmployeeId("");
      await loadEmployees();
      setNotice(isUpdate ? "Employee updated successfully." : "Employee created successfully.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGate permission="employees:manage">
      <div className="gf-page-stack">
        <section className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink-900">{form.id ? "Edit Employee" : "Create Employee"}</h1>
          <Link
            href="/employees"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-ink-700 hover:bg-slate-50"
          >
            Back to Employees
          </Link>
        </section>

        <Card title={form.id ? "Edit Employee" : "Create Employee"}>
          {loading ? <p className="text-sm text-ink-600">Loading employee setup...</p> : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          ) : null}
          {notice ? (
            <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}

          <form onSubmit={saveEmployee} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              label="Full Name"
              value={form.fullName}
              onChange={(value) => setForm((current) => ({ ...current, fullName: value }))}
              required
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
              required
            />
            <Input
              label={form.id ? "New Password (optional)" : "Password"}
              type="password"
              value={form.password}
              onChange={(value) => setForm((current) => ({ ...current, password: value }))}
              required={!form.id}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(value) => setForm((current) => ({ ...current, role: value as Employee["role"] }))}
              options={["ADMIN", "OFFICE", "MECHANIC", "FIELD"]}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
            />
            <Input
              label="Job Title / Specialization"
              value={form.title}
              onChange={(value) => setForm((current) => ({ ...current, title: value }))}
            />
            <Input
              label="Current Assignment"
              value={form.currentAssignment}
              onChange={(value) => setForm((current) => ({ ...current, currentAssignment: value }))}
            />
            <Input
              label="Profile Photo URL"
              value={form.profileImageUrl}
              onChange={(value) => setForm((current) => ({ ...current, profileImageUrl: value }))}
            />
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active account
            </label>
            <div className="flex gap-2 lg:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : form.id ? "Update Employee" : "Create Employee"}
              </button>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyForm);
                    setHydratedEmployeeId("");
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

function EmployeeSetupFallback() {
  return (
    <AccessGate permission="employees:manage">
      <div className="gf-page-stack">
        <Card title="Create Employee">
          <p className="text-sm text-ink-600">Loading employee setup...</p>
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none ring-brand-300 focus:ring"
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
  options: string[];
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
