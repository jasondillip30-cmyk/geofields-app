import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { EntryApprovalStatus, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { isSupportedExpenseCategory } from "@/lib/expense-categories";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const expenseInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  rig: { select: { id: true, rigCode: true } },
  enteredBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

type SubmissionMode = "draft" | "submit";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDate(request.nextUrl.searchParams.get("from") || "");
  const toDate = parseDate(request.nextUrl.searchParams.get("to") || "");
  const expenseId = nullableFilter(request.nextUrl.searchParams.get("expenseId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const category = nullableFilter(request.nextUrl.searchParams.get("category"));
  const status = parseApprovalStatus(request.nextUrl.searchParams.get("status"));
  const appliedFilters = {
    from: fromDate ? startOfDayUtc(fromDate).toISOString() : null,
    to: toDate ? endOfDayUtc(toDate).toISOString() : null,
    expenseId: expenseId || "all",
    clientId: clientId || "all",
    rigId: rigId || "all",
    projectId: projectId || "all",
    category: category || "all",
    status: status || "all"
  };

  const where: Prisma.ExpenseWhereInput = expenseId
    ? { id: expenseId }
    : {
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(category ? { category } : {}),
        ...(status ? { approvalStatus: status } : {}),
        ...(fromDate || toDate
          ? {
              date: {
                ...(fromDate ? { gte: startOfDayUtc(fromDate) } : {}),
                ...(toDate ? { lte: endOfDayUtc(toDate) } : {})
              }
            }
          : {})
      };

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: expenseInclude
  });

  const statusCounts: Record<EntryApprovalStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0
  };
  let totalExpenses = 0;
  let approvedExpenses = 0;

  for (const expense of expenses) {
    totalExpenses += expense.amount;
    statusCounts[expense.approvalStatus] += 1;
    if (expense.approvalStatus === "APPROVED") {
      approvedExpenses += expense.amount;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[expense-visibility][expenses-list]", {
      appliedFilters,
      expenseRecordCount: expenses.length,
      totalExpenses,
      approvedExpenses,
      statusCounts
    });
  }

  return NextResponse.json({
    data: expenses.map(serializeExpenseForClient),
    meta: {
      appliedFilters,
      expenseRecordCount: expenses.length,
      totalExpenses,
      approvedExpenses,
      statusCounts
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const input = await parseExpenseInput(request);
  if (!input.ok) {
    return input.response;
  }

  const validation = await validateClientProject(input.value.clientId, input.value.projectId);
  if (!validation.ok) {
    return validation.response;
  }

  const initialApproval = resolveInitialApprovalStatus(auth.session.role, input.value.submissionMode);

  const created = await prisma.$transaction(async (tx) => {
    const createData: Prisma.ExpenseCreateInput = {
      date: new Date(input.value.date),
      category: input.value.category,
      subcategory: input.value.subcategory,
      amount: Number(input.value.amount),
      quantity: input.value.quantity,
      unitCost: input.value.unitCost,
      receiptNumber: input.value.receiptNumber,
      vendor: input.value.vendor,
      notes: input.value.notes,
      receiptUrl: input.value.receiptUrl,
      receiptFileName: input.value.receiptFileName,
      entrySource: "MANUAL",
      approvalStatus: initialApproval.status,
      submittedAt: initialApproval.submittedAt,
      enteredBy: { connect: { id: auth.session.userId } }
    };

    if (validation.value.clientId) {
      createData.client = { connect: { id: validation.value.clientId } };
    }

    if (validation.value.projectId) {
      createData.project = { connect: { id: validation.value.projectId } };
    }

    if (input.value.rigId) {
      createData.rig = { connect: { id: input.value.rigId } };
    }

    const inserted = await tx.expense.create({
      data: createData,
      include: expenseInclude
    });

    await recordAuditLog({
      db: tx,
      module: "expenses",
      entityType: "expense",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Expense ${inserted.id}.`,
      after: expenseAuditSnapshot(inserted),
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: serializeExpenseForClient(created) }, { status: 201 });
}

async function parseExpenseInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const fileUpload = form.get("receipt");
    const uploadedReceipt = fileUpload instanceof File ? await saveReceiptFile(fileUpload) : null;

    const expenseDate = parseDate(asString(form.get("date")));
    const amount = parseAmount(asString(form.get("amount")));
    const quantity = parsePositiveNumber(asString(form.get("quantity")));
    const unitCost = parsePositiveNumber(asString(form.get("unitCost")));
    const resolvedAmount = resolveExpenseAmount({
      amount,
      quantity,
      unitCost
    });
    const category = asString(form.get("category"));

    if (!expenseDate || resolvedAmount === null || !category || !isSupportedExpenseCategory(category)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { message: "Valid date, amount, and category are required." },
          { status: 400 }
        )
      };
    }

    return {
      ok: true as const,
      value: {
        date: expenseDate,
        clientId: nullableString(asString(form.get("clientId"))),
        projectId: nullableString(asString(form.get("projectId"))),
        rigId: nullableString(asString(form.get("rigId"))),
        category,
        subcategory: nullableString(asString(form.get("subcategory"))),
        amount: resolvedAmount,
        quantity,
        unitCost,
        receiptNumber: nullableString(asString(form.get("receiptNumber"))),
        vendor: nullableString(asString(form.get("vendor"))),
        notes: nullableString(asString(form.get("notes"))),
        receiptUrl: uploadedReceipt?.receiptUrl || nullableString(asString(form.get("receiptUrl"))),
        receiptFileName: uploadedReceipt?.receiptFileName || null,
        submissionMode: parseSubmissionMode(asString(form.get("submissionMode")))
      }
    };
  }

  const body = await request.json().catch(() => null);

  const expenseDate = parseDate(typeof body?.date === "string" ? body.date : "");
  const amount = parseAmount(body?.amount);
  const quantity = parsePositiveNumber(body?.quantity);
  const unitCost = parsePositiveNumber(body?.unitCost);
  const resolvedAmount = resolveExpenseAmount({
    amount,
    quantity,
    unitCost
  });
  const category = typeof body?.category === "string" ? body.category : "";

  if (!expenseDate || resolvedAmount === null || !category || !isSupportedExpenseCategory(category)) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Valid date, amount, and category are required." }, { status: 400 })
    };
  }

  return {
    ok: true as const,
    value: {
      date: expenseDate,
      clientId: nullableString(typeof body?.clientId === "string" ? body.clientId.trim() : ""),
      projectId: nullableString(typeof body?.projectId === "string" ? body.projectId.trim() : ""),
      rigId: nullableString(typeof body?.rigId === "string" ? body.rigId : ""),
      category,
      subcategory: nullableString(typeof body?.subcategory === "string" ? body.subcategory : ""),
      amount: resolvedAmount,
      quantity,
      unitCost,
      receiptNumber: nullableString(typeof body?.receiptNumber === "string" ? body.receiptNumber : ""),
      vendor: nullableString(typeof body?.vendor === "string" ? body.vendor : ""),
      notes: nullableString(typeof body?.notes === "string" ? body.notes : ""),
      receiptUrl: nullableString(typeof body?.receiptUrl === "string" ? body.receiptUrl : ""),
      receiptFileName: null,
      submissionMode: parseSubmissionMode(typeof body?.submissionMode === "string" ? body.submissionMode : "")
    }
  };
}

async function validateClientProject(clientId: string | null, projectId: string | null) {
  let normalizedClientId = clientId;
  let normalizedProjectId = projectId;

  if (normalizedProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: normalizedProjectId },
      select: { id: true, clientId: true }
    });

    if (!project) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "Project not found." }, { status: 404 })
      };
    }

    if (normalizedClientId && project.clientId !== normalizedClientId) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { message: "Selected project does not belong to selected client." },
          { status: 400 }
        )
      };
    }

    normalizedClientId = project.clientId;
    normalizedProjectId = project.id;
  }

  if (normalizedClientId) {
    const client = await prisma.client.findUnique({
      where: { id: normalizedClientId },
      select: { id: true }
    });
    if (!client) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "Client not found." }, { status: 404 })
      };
    }
  }

  return {
    ok: true as const,
    value: {
      clientId: normalizedClientId,
      projectId: normalizedProjectId
    }
  };
}

async function saveReceiptFile(receipt: File) {
  if (receipt.size <= 0) {
    return null;
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "receipts");
  await mkdir(uploadsDir, { recursive: true });
  const extension = receipt.name.includes(".") ? receipt.name.split(".").pop() : "bin";
  const safeFileName = `${Date.now()}-${randomUUID()}.${extension}`;
  const absoluteFilePath = path.join(uploadsDir, safeFileName);
  const arrayBuffer = await receipt.arrayBuffer();
  await writeFile(absoluteFilePath, Buffer.from(arrayBuffer));

  return {
    receiptUrl: `/uploads/receipts/${safeFileName}`,
    receiptFileName: receipt.name
  };
}

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: string) {
  return value ? value : null;
}

function parseAmount(value: unknown) {
  const parsed = Number(value ?? 0);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveExpenseAmount({
  amount,
  quantity,
  unitCost
}: {
  amount: number | null;
  quantity: number | null;
  unitCost: number | null;
}) {
  if (amount !== null) {
    return amount;
  }
  if (quantity !== null && unitCost !== null) {
    return Number((quantity * unitCost).toFixed(2));
  }
  return null;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function startOfDayUtc(date: Date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function endOfDayUtc(date: Date) {
  const value = new Date(date);
  value.setUTCHours(23, 59, 59, 999);
  return value;
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseApprovalStatus(value: string | null): EntryApprovalStatus | null {
  if (value === "DRAFT" || value === "SUBMITTED" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function parseSubmissionMode(value: string): SubmissionMode | null {
  if (value === "draft" || value === "submit") {
    return value;
  }
  return null;
}

function resolveInitialApprovalStatus(role: string, mode: SubmissionMode | null): {
  status: EntryApprovalStatus;
  submittedAt: Date | null;
} {
  if (mode === "draft") {
    return {
      status: "DRAFT",
      submittedAt: null
    };
  }
  if (mode === "submit") {
    return {
      status: "SUBMITTED",
      submittedAt: new Date()
    };
  }

  if (role === "ADMIN") {
    return {
      status: "DRAFT",
      submittedAt: null
    };
  }
  return {
    status: "SUBMITTED",
    submittedAt: new Date()
  };
}

function serializeExpenseForClient(expense: {
  id: string;
  date: Date;
  amount: number;
  category: string;
  subcategory: string | null;
  entrySource: string;
  vendor: string | null;
  receiptNumber: string | null;
  quantity: number | null;
  unitCost: number | null;
  receiptUrl: string | null;
  receiptFileName: string | null;
  enteredByUserId: string | null;
  submittedAt: Date | null;
  approvedById: string | null;
  approvalStatus: string;
  approvedAt: Date | null;
  rejectionReason: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  client?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  rig?: { id: string; rigCode: string } | null;
  enteredBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
}) {
  const fallback = splitLegacySubcategoryFromNotes(expense.notes);

  return {
    id: expense.id,
    date: expense.date,
    amount: expense.amount,
    category: expense.category,
    subcategory: expense.subcategory || fallback.subcategory,
    entrySource: expense.entrySource,
    vendor: expense.vendor,
    receiptNumber: expense.receiptNumber,
    quantity: expense.quantity,
    unitCost: expense.unitCost,
    receiptUrl: expense.receiptUrl,
    receiptFileName: expense.receiptFileName,
    enteredByUserId: expense.enteredByUserId,
    submittedAt: expense.submittedAt,
    approvedById: expense.approvedById,
    approvalStatus: expense.approvalStatus,
    approvedAt: expense.approvedAt,
    rejectionReason: expense.rejectionReason,
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId,
    notes: fallback.cleanedNotes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    client: expense.client || null,
    project: expense.project || null,
    rig: expense.rig || null,
    enteredBy: expense.enteredBy || null,
    approvedBy: expense.approvedBy || null
  };
}

function splitLegacySubcategoryFromNotes(notes: string | null) {
  if (!notes) {
    return { subcategory: null as string | null, cleanedNotes: null as string | null };
  }

  const matcher = /^Subcategory:\s*(.+?)(?:\r?\n|$)/i;
  const match = notes.match(matcher);
  if (!match) {
    return { subcategory: null as string | null, cleanedNotes: notes };
  }

  const subcategory = match[1]?.trim() || null;
  const cleanedNotes = notes.replace(matcher, "").trim();
  return { subcategory, cleanedNotes: cleanedNotes || null };
}

function expenseAuditSnapshot(expense: {
  id: string;
  date: Date;
  amount: number;
  category: string;
  subcategory: string | null;
  vendor: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  receiptNumber?: string | null;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
}) {
  return {
    id: expense.id,
    date: expense.date,
    amount: expense.amount,
    category: expense.category,
    subcategory: expense.subcategory,
    vendor: expense.vendor,
    quantity: expense.quantity ?? null,
    unitCost: expense.unitCost ?? null,
    receiptNumber: expense.receiptNumber ?? null,
    approvalStatus: expense.approvalStatus,
    submittedAt: expense.submittedAt,
    approvedAt: expense.approvedAt,
    rejectionReason: expense.rejectionReason,
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId
  };
}
