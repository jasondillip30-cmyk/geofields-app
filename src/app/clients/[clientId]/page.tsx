import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";

export default async function ClientWorkspacePage({
  params
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true
        }
      }
    }
  });

  if (!client) {
    notFound();
  }

  const scopedProjectId = client.projects[0]?.id || "";
  const spendingHref = scopedProjectId
    ? `/spending?projectId=${encodeURIComponent(scopedProjectId)}`
    : "/spending";

  return (
    <AccessGate permission="clients:view">
      <div className="gf-page-stack">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">{client.name}</h2>
            <p className="text-sm text-ink-600">{client.description || "Client profile details"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AccessGate permission="clients:manage">
              <Link
                href={`/clients/setup?clientId=${client.id}`}
                className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
              >
                Edit client setup
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
            <Link href="/clients" className="text-sm text-brand-700 underline-offset-2 hover:underline">
              Back to clients
            </Link>
          </div>
        </section>

        <Card title="Client details">
          <DataTable
            compact
            columns={["Detail", "Value"]}
            rows={[
              ["Client", client.name],
              ["Contact", client.contactPerson || "-"],
              ["Email", client.email || "-"],
              ["Phone", client.phone || "-"],
              ["Address", client.address || "-"],
              ["Description", client.description || "-"]
            ]}
          />

          <div className="mt-4 flex flex-wrap gap-3">
            {client.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.logoUrl}
                alt={`${client.name} logo`}
                className="h-16 w-auto rounded border border-slate-200 object-contain"
              />
            ) : null}
            {client.profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.profilePhotoUrl}
                alt={`${client.name} profile`}
                className="h-16 w-16 rounded-full border border-slate-200 object-cover"
              />
            ) : null}
          </div>
        </Card>
      </div>
    </AccessGate>
  );
}
