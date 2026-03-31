"use client";

import { useEffect, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";

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

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadEmployees() {
    setLoading(true);
    try {
      const response = await fetch("/api/employees", { cache: "no-store" });
      const payload = await response.json();
      setEmployees(payload.data || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
  }, []);

  async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
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
        alert(payload.message || "Failed to save employee.");
        return;
      }

      setForm(emptyForm);
      await loadEmployees();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmployee(id: string) {
    if (!window.confirm("Delete this employee account?")) {
      return;
    }
    const response = await fetch(`/api/employees/${id}`, {
      method: "DELETE"
    });
    if (response.ok) {
      await loadEmployees();
    }
  }

  return (
    <AccessGate permission="employees:view">
      <div className="gf-page-stack">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Total Employees" value={String(employees.length)} />
          <MetricCard label="Admins" value={String(employees.filter((employee) => employee.role === "ADMIN").length)} />
          <MetricCard label="Office Staff" value={String(employees.filter((employee) => employee.role === "OFFICE").length)} />
          <MetricCard label="Mechanics + Field" value={String(employees.filter((employee) => employee.role === "MECHANIC" || employee.role === "FIELD").length)} />
        </section>

        <AccessGate permission="employees:manage">
          <Card title={form.id ? "Edit Employee" : "Create Employee"}>
            <form onSubmit={saveEmployee} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Input label="Full Name" value={form.fullName} onChange={(value) => setForm((current) => ({ ...current, fullName: value }))} required />
              <Input label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} required />
              <Input label={form.id ? "New Password (optional)" : "Password"} type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} required={!form.id} />
              <Select
                label="Role"
                value={form.role}
                onChange={(value) => setForm((current) => ({ ...current, role: value as Employee["role"] }))}
                options={["ADMIN", "OFFICE", "MECHANIC", "FIELD"]}
              />
              <Input label="Phone" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
              <Input label="Job Title / Specialization" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />
              <Input label="Current Assignment" value={form.currentAssignment} onChange={(value) => setForm((current) => ({ ...current, currentAssignment: value }))} />
              <Input label="Profile Photo URL" value={form.profileImageUrl} onChange={(value) => setForm((current) => ({ ...current, profileImageUrl: value }))} />
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                />
                Active account
              </label>
              <div className="lg:col-span-3 flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving..." : form.id ? "Update Employee" : "Create Employee"}
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

        <Card title="Employee Directory">
          {loading ? (
            <p className="text-sm text-ink-600">Loading employees...</p>
          ) : (
            <DataTable
              columns={["Name", "Email", "Role", "Title", "Assignment", "Active", "Actions"]}
              rows={employees.map((employee) => [
                employee.fullName,
                employee.email,
                employee.role,
                employee.title || "-",
                employee.currentAssignment || "-",
                employee.isActive ? "Yes" : "No",
                <div key={`actions-${employee.id}`} className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                    onClick={() =>
                      setForm({
                        id: employee.id,
                        fullName: employee.fullName,
                        email: employee.email,
                        password: "",
                        role: employee.role,
                        phone: employee.phone || "",
                        title: employee.title || "",
                        profileImageUrl: employee.profileImageUrl || "",
                        currentAssignment: employee.currentAssignment || "",
                        isActive: employee.isActive
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => void deleteEmployee(employee.id)}
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
