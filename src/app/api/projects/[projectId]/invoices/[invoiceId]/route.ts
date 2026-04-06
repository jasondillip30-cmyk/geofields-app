import { ProjectInvoiceStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; invoiceId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId, invoiceId } = await params;
  const body = await request.json().catch(() => null);
  const hasStatus = typeof body?.status === "string";
  const hasDueDate = Object.prototype.hasOwnProperty.call(body || {}, "dueDate");
  const hasNotes = Object.prototype.hasOwnProperty.call(body || {}, "notes");

  if (!hasStatus && !hasDueDate && !hasNotes) {
    return NextResponse.json(
      { message: "Provide at least one editable field: status, dueDate, or notes." },
      { status: 400 }
    );
  }

  const nextStatus = hasStatus ? parseStatus(body?.status) : null;
  if (hasStatus && !nextStatus) {
    return NextResponse.json({ message: "Invalid invoice status." }, { status: 400 });
  }

  const nextDueDate = hasDueDate ? parseNullableDate(body?.dueDate) : undefined;
  if (hasDueDate && nextDueDate === "INVALID") {
    return NextResponse.json({ message: "dueDate must be a valid date or null." }, { status: 400 });
  }

  const nextNotes = hasNotes ? parseNullableText(body?.notes) : undefined;

  const existing = await prisma.projectInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json({ message: "Invoice not found for this project." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.projectInvoice.update({
      where: { id: invoiceId },
      data: {
        ...(hasStatus && nextStatus ? { status: nextStatus } : {}),
        ...(hasDueDate ? { dueDate: nextDueDate === null ? null : nextDueDate } : {}),
        ...(hasNotes ? { notes: nextNotes } : {})
      },
      include: {
        payments: {
          orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }]
        }
      }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project_invoice",
      entityId: invoice.id,
      action: "edit",
      description: `${auth.session.name} updated invoice ${invoice.invoiceNumber} on project ${existing.project.name}.`,
      before: {
        status: existing.status,
        dueDate: existing.dueDate ? existing.dueDate.toISOString() : null,
        notes: existing.notes
      },
      after: {
        status: invoice.status,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
        notes: invoice.notes
      },
      actor: auditActorFromSession(auth.session)
    });

    return invoice;
  });

  return NextResponse.json({ data: updated });
}

function parseStatus(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const upper = value.toUpperCase();
  if (!(upper in ProjectInvoiceStatus)) {
    return null;
  }
  return ProjectInvoiceStatus[upper as keyof typeof ProjectInvoiceStatus];
}

function parseNullableDate(value: unknown): Date | null | "INVALID" {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "INVALID";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "INVALID";
  }
  return parsed;
}

function parseNullableText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
