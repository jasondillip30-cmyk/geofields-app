import { Prisma, ProjectInvoiceStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireAnyApiPermission(request, ["projects:view", "finance:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true }
  });
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const invoices = await prisma.projectInvoice.findMany({
    where: { projectId },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    include: {
      payments: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }]
      }
    }
  });

  return NextResponse.json({
    data: invoices.map((invoice) => {
      const totalPaid = roundCurrency(
        invoice.payments.reduce((sum, payment) => sum + payment.amount, 0)
      );
      const outstandingAmount =
        invoice.status === ProjectInvoiceStatus.VOID
          ? 0
          : roundCurrency(Math.max(0, invoice.amount - totalPaid));
      return {
        ...invoice,
        totalPaid,
        outstandingAmount
      };
    })
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const invoiceNumber =
    typeof body?.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
  const issueDate = parseDate(body?.issueDate);
  const dueDate = parseOptionalDate(body?.dueDate);
  const amount = parsePositiveNumber(body?.amount);
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const status = parseCreateStatus(body?.status);

  if (!invoiceNumber) {
    return NextResponse.json({ message: "invoiceNumber is required." }, { status: 400 });
  }
  if (!issueDate) {
    return NextResponse.json({ message: "Valid issueDate is required." }, { status: 400 });
  }
  if (amount === null) {
    return NextResponse.json({ message: "amount must be greater than zero." }, { status: 400 });
  }
  if (typeof body?.dueDate === "string" && body.dueDate.trim() && !dueDate) {
    return NextResponse.json({ message: "dueDate must be a valid date." }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true }
  });
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const invoice = await tx.projectInvoice.create({
        data: {
          projectId,
          invoiceNumber,
          issueDate,
          dueDate,
          amount,
          status,
          notes: notes || null
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
        action: "create",
        description: `${auth.session.name} created invoice ${invoice.invoiceNumber} for project ${project.name}.`,
        after: {
          projectId: invoice.projectId,
          invoiceNumber: invoice.invoiceNumber,
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
          amount: invoice.amount,
          status: invoice.status,
          notes: invoice.notes
        },
        actor: auditActorFromSession(auth.session)
      });

      return invoice;
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { message: "Invoice number already exists. Use a unique invoice number." },
        { status: 409 }
      );
    }
    throw error;
  }
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

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return parseDate(value);
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return roundCurrency(parsed);
}

function parseCreateStatus(value: unknown) {
  if (typeof value !== "string") {
    return ProjectInvoiceStatus.ISSUED;
  }
  const upper = value.toUpperCase();
  if (upper === ProjectInvoiceStatus.DRAFT || upper === ProjectInvoiceStatus.ISSUED) {
    return ProjectInvoiceStatus[upper as keyof typeof ProjectInvoiceStatus];
  }
  return ProjectInvoiceStatus.ISSUED;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
