import { ProjectInvoiceStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { deriveInvoiceCollectionStatus } from "@/lib/project-revenue-realization";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; invoiceId: string }> }
) {
  const auth = await requireAnyApiPermission(request, ["projects:view", "finance:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId, invoiceId } = await params;
  const invoice = await prisma.projectInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      projectId: true
    }
  });
  if (!invoice || invoice.projectId !== projectId) {
    return NextResponse.json({ message: "Invoice not found for this project." }, { status: 404 });
  }

  const payments = await prisma.projectInvoicePayment.findMany({
    where: { invoiceId },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({ data: payments });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; invoiceId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId, invoiceId } = await params;
  const body = await request.json().catch(() => null);
  const paymentDate = parseDate(body?.paymentDate);
  const amount = parsePositiveNumber(body?.amount);
  const paymentReference = normalizeText(body?.paymentReference);
  const paymentMethod = normalizeText(body?.paymentMethod);
  const notes = normalizeText(body?.notes);

  if (!paymentDate) {
    return NextResponse.json({ message: "Valid paymentDate is required." }, { status: 400 });
  }
  if (amount === null) {
    return NextResponse.json({ message: "amount must be greater than zero." }, { status: 400 });
  }

  const existingInvoice = await prisma.projectInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: {
        select: {
          id: true,
          name: true
        }
      },
      payments: {
        select: {
          id: true,
          amount: true
        }
      }
    }
  });
  if (!existingInvoice || existingInvoice.projectId !== projectId) {
    return NextResponse.json({ message: "Invoice not found for this project." }, { status: 404 });
  }
  if (existingInvoice.status === ProjectInvoiceStatus.VOID) {
    return NextResponse.json({ message: "Payments cannot be posted to void invoices." }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.projectInvoicePayment.create({
      data: {
        invoiceId,
        paymentDate,
        amount,
        paymentReference,
        paymentMethod,
        notes
      }
    });

    const totalPaid = roundCurrency(
      existingInvoice.payments.reduce((sum, row) => sum + row.amount, 0) + payment.amount
    );
    const nextStatus = deriveInvoiceCollectionStatus({
      invoiceAmount: existingInvoice.amount,
      totalPaid,
      existingStatus: existingInvoice.status
    });

    const updatedInvoice =
      nextStatus !== existingInvoice.status
        ? await tx.projectInvoice.update({
            where: { id: invoiceId },
            data: {
              status: nextStatus
            }
          })
        : existingInvoice;

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project_invoice_payment",
      entityId: payment.id,
      action: "create",
      description: `${auth.session.name} recorded payment on invoice ${existingInvoice.invoiceNumber} for project ${existingInvoice.project.name}.`,
      after: {
        invoiceId,
        paymentDate: payment.paymentDate.toISOString(),
        amount: payment.amount,
        paymentReference: payment.paymentReference,
        paymentMethod: payment.paymentMethod,
        notes: payment.notes
      },
      actor: auditActorFromSession(auth.session)
    });

    if (updatedInvoice.status !== existingInvoice.status) {
      await recordAuditLog({
        db: tx,
        module: "projects",
        entityType: "project_invoice",
        entityId: existingInvoice.id,
        action: "status_transition",
        description: `${auth.session.name} moved invoice ${existingInvoice.invoiceNumber} to ${updatedInvoice.status}.`,
        before: {
          status: existingInvoice.status
        },
        after: {
          status: updatedInvoice.status,
          totalPaid
        },
        actor: auditActorFromSession(auth.session)
      });
    }

    return payment;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return roundCurrency(parsed);
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
