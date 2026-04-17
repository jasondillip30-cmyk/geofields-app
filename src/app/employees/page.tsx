"use client";

import Link from "next/link";
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

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function deleteEmployee(id: string) {
    if (!window.confirm("Delete this employee account?")) {
      return;
    }

    setNotice(null);
    setError(null);
    const response = await fetch(`/api/employees/${id}`, {
      method: "DELETE"
    });
    if (response.ok) {
      await loadEmployees();
      setNotice("Employee deleted.");
      return;
    }
    setError("Unable to delete employee.");
  }

  return (
    <AccessGate denyBehavior="redirect" permission="employees:view">
      <div className="gf-page-stack">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Total Employees" value={String(employees.length)} />
          <MetricCard label="Admins" value={String(employees.filter((employee) => employee.role === "ADMIN").length)} />
          <MetricCard label="Office Staff" value={String(employees.filter((employee) => employee.role === "OFFICE").length)} />
          <MetricCard
            label="Mechanics + Field"
            value={String(
              employees.filter((employee) => employee.role === "MECHANIC" || employee.role === "FIELD").length
            )}
          />
        </section>

        <AccessGate permission="employees:manage">
          <section className="flex justify-end">
            <Link
              href="/employees/setup"
              className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
            >
              Create employee
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
                  <AccessGate permission="employees:manage">
                    <Link
                      href={`/employees/setup?employeeId=${employee.id}`}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                    >
                      Edit
                    </Link>
                  </AccessGate>
                  <AccessGate permission="employees:manage">
                    <button
                      type="button"
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      onClick={() => void deleteEmployee(employee.id)}
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
