import type { InventoryCategory, Prisma } from "@prisma/client";

import {
  parseInventoryCategory,
  parseNumeric,
  resolveExpenseCategoryFromInventoryCategory,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

import type {
  DuplicateLinkedRecord,
  DuplicateReviewPayload,
  IntakeAllocationStatus,
  IntakeLinePayload,
  NormalizedIntakeLine,
  ReceiptDuplicateFingerprint,
  ReceiptDuplicateMatch,
  ReceiptPurpose,
  ReceiptType,
  ReceiptWorkflowType,
  ResolveIntakeItemExistingRow,
  SkippedIntakeLine
} from "./commit-types";

export function normalizeLines(lines: IntakeLinePayload[]): {
  normalized: NormalizedIntakeLine[];
  skipped: SkippedIntakeLine[];
} {
  const normalized: NormalizedIntakeLine[] = [];
  const skipped: SkippedIntakeLine[] = [];

  for (const [index, line] of lines.entries()) {
    const lineId =
      typeof line.id === "string" && line.id.trim().length > 0
        ? line.id
        : `line-${index + 1}`;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const quantity = parseNumeric(line.quantity);
    const unitPrice = parseNumeric(line.unitPrice);
    const lineTotal = parseNumeric(line.lineTotal);
    const selectedItemId = typeof line.selectedItemId === "string" && line.selectedItemId.trim() ? line.selectedItemId : null;
    const requestedMode =
      line.mode === "NEW" ? "NEW" : line.mode === "EXPENSE_ONLY" ? "EXPENSE_ONLY" : "MATCH";
    const mode: "MATCH" | "NEW" | "EXPENSE_ONLY" =
      requestedMode === "MATCH" && !selectedItemId ? "NEW" : requestedMode;
    const selectedCategory = typeof line.selectedCategory === "string" ? line.selectedCategory : null;
    const normalizedLineTotal =
      lineTotal && lineTotal > 0
        ? lineTotal
        : quantity && unitPrice
          ? quantity * unitPrice
          : 0;

    if (!description) {
      skipped.push({
        lineId,
        description: "",
        reason: "Missing description."
      });
      continue;
    }
    if (!quantity || quantity <= 0) {
      skipped.push({
        lineId,
        description,
        reason: "Missing or invalid quantity."
      });
      continue;
    }
    if ((!unitPrice || unitPrice <= 0) && (!lineTotal || lineTotal <= 0)) {
      skipped.push({
        lineId,
        description,
        reason: "Missing line total and unit price."
      });
      continue;
    }
    const safeUnitPrice = unitPrice && unitPrice > 0 ? unitPrice : normalizedLineTotal / Math.max(1, quantity);
    const safeLineTotal = normalizedLineTotal > 0 ? normalizedLineTotal : safeUnitPrice * quantity;
    if (!Number.isFinite(safeUnitPrice) || !Number.isFinite(safeLineTotal)) {
      skipped.push({
        lineId,
        description,
        reason: "Invalid unit price or line total."
      });
      continue;
    }

    normalized.push({
      lineId,
      description,
      quantity: roundCurrency(quantity),
      unitPrice: roundCurrency(Math.max(0, safeUnitPrice)),
      lineTotal: roundCurrency(Math.max(0, safeLineTotal)),
      selectedItemId,
      selectedCategory,
      newItem: line.newItem || null,
      mode
    });
  }

  return { normalized, skipped };
}

export async function resolveSupplier({
  tx,
  existingSupplierId,
  supplierName
}: {
  tx: Prisma.TransactionClient;
  existingSupplierId: string | null;
  supplierName: string;
}) {
  if (existingSupplierId) {
    return tx.inventorySupplier.findUnique({
      where: { id: existingSupplierId },
      select: { id: true, name: true }
    });
  }
  const normalizedName = supplierName.trim();
  if (!normalizedName) {
    return null;
  }

  const existing = await tx.inventorySupplier.findFirst({
    where: {
      name: normalizedName
    },
    select: { id: true, name: true }
  });
  if (existing) {
    return existing;
  }

  return tx.inventorySupplier.create({
    data: {
      name: normalizedName
    },
    select: { id: true, name: true }
  });
}

export async function resolveIntakeItem({
  tx,
  line,
  existingItemById,
  supplierId,
  locationToId
}: {
  tx: Prisma.TransactionClient;
  line: NormalizedIntakeLine;
  existingItemById: Map<string, ResolveIntakeItemExistingRow>;
  supplierId: string | null;
  locationToId: string | null;
}) {
  if (line.mode === "MATCH" && line.selectedItemId) {
    const existing = existingItemById.get(line.selectedItemId);
    if (existing) {
      return {
        ...existing,
        resolution: "MATCHED_EXISTING" as const
      };
    }
  }

  const newItemName = line.newItem?.name?.trim() || line.description;
  const newItemCategory = parseInventoryCategory(line.newItem?.category || line.selectedCategory || "") || "OTHER";
  const newItemSku =
    line.newItem?.sku?.trim().toUpperCase() || buildGeneratedSku(newItemName);
  const minimumStockLevel = parseNumeric(line.newItem?.minimumStockLevel);

  const skuConflict = await tx.inventoryItem.findUnique({
    where: { sku: newItemSku },
    select: { id: true }
  });
  const finalSku = skuConflict ? `${newItemSku}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` : newItemSku;

  const created = await tx.inventoryItem.create({
    data: {
      name: newItemName,
      sku: finalSku,
      category: newItemCategory,
      description: `Created from receipt intake: ${line.description}`,
      quantityInStock: 0,
      minimumStockLevel: minimumStockLevel && minimumStockLevel >= 0 ? minimumStockLevel : 0,
      unitCost: line.unitPrice,
      supplierId,
      locationId: locationToId || line.newItem?.locationId || null,
      status: line.newItem?.status || "ACTIVE",
      notes: line.newItem?.notes || null
    },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      quantityInStock: true,
      minimumStockLevel: true,
      unitCost: true,
      status: true
    }
  });

  return {
    ...created,
    resolution: "AUTO_CREATED" as const
  };
}

export function chooseDominantCategory(categories: InventoryCategory[]) {
  if (categories.length === 0) {
    return null;
  }
  const counts = new Map<InventoryCategory, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function buildGeneratedSku(name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCPT-${base || "ITEM"}-${suffix}`;
}

export function buildReceiptMetadataNote({
  tin,
  vrn,
  serialNumber,
  receiptNumber,
  verificationCode,
  verificationUrl,
  rawQrValue,
  receiptTime,
  paymentMethod,
  taxOffice,
  ocrTextPreview,
  allocationStatus,
  duplicateFingerprint,
  receiptPurpose
}: {
  tin: string;
  vrn: string;
  serialNumber: string;
  receiptNumber: string;
  verificationCode: string;
  verificationUrl: string;
  rawQrValue: string;
  receiptTime: string;
  paymentMethod: string;
  taxOffice: string;
  ocrTextPreview: string;
  allocationStatus: IntakeAllocationStatus;
  duplicateFingerprint: string;
  receiptPurpose: ReceiptPurpose;
}) {
  const parts: string[] = [];
  if (tin) parts.push(`TIN=${tin}`);
  if (vrn) parts.push(`VRN=${vrn}`);
  if (serialNumber) parts.push(`Serial=${serialNumber}`);
  if (receiptNumber) parts.push(`ReceiptNo=${receiptNumber}`);
  if (verificationCode) parts.push(`VerificationCode=${verificationCode}`);
  if (verificationUrl) parts.push(`VerificationURL=${verificationUrl}`);
  if (receiptTime) parts.push(`Time=${receiptTime}`);
  if (paymentMethod) parts.push(`PaymentMethod=${paymentMethod}`);
  if (taxOffice) parts.push(`TaxOffice=${taxOffice}`);
  if (allocationStatus) parts.push(`AllocationStatus=${allocationStatus}`);
  if (receiptPurpose) parts.push(`ReceiptPurpose=${receiptPurpose}`);
  if (duplicateFingerprint) parts.push(`Fingerprint=${duplicateFingerprint}`);
  if (rawQrValue) {
    const compact = rawQrValue.length > 320 ? `${rawQrValue.slice(0, 317)}...` : rawQrValue;
    parts.push(`RawQR=${compact}`);
  }
  if (ocrTextPreview) {
    const compactOcr = ocrTextPreview.length > 320 ? `${ocrTextPreview.slice(0, 317)}...` : ocrTextPreview;
    parts.push(`OCR=${compactOcr}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `Receipt metadata: ${parts.join(" | ")}`;
}

export function resolveIntakeAllocationStatus({
  clientId,
  projectId
}: {
  clientId: string | null;
  projectId: string | null;
}): IntakeAllocationStatus {
  if (clientId && projectId) {
    return "ALLOCATED";
  }
  if (clientId || projectId) {
    return "PARTIALLY_ALLOCATED";
  }
  return "UNALLOCATED";
}

export function resolveReceiptPurpose(value: unknown): ReceiptPurpose {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "BUSINESS_EXPENSE_ONLY" ||
    value === "INVENTORY_AND_EXPENSE" ||
    value === "EVIDENCE_ONLY" ||
    value === "OTHER_MANUAL"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

export function resolveReceiptType(value: unknown): ReceiptType {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "MAINTENANCE_LINKED_PURCHASE" ||
    value === "EXPENSE_ONLY" ||
    value === "INTERNAL_TRANSFER"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

export function resolveReceiptWorkflowType(value: unknown): ReceiptWorkflowType | null {
  if (
    value === "PROJECT_PURCHASE" ||
    value === "MAINTENANCE_PURCHASE" ||
    value === "STOCK_PURCHASE" ||
    value === "INTERNAL_TRANSFER"
  ) {
    return value;
  }
  return null;
}

export function deriveWorkflowTypeFromContext({
  receiptType,
  receiptPurpose,
  createExpense,
  projectId
}: {
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  createExpense: boolean;
  projectId: string | null;
}): ReceiptWorkflowType {
  if (receiptType === "INTERNAL_TRANSFER") {
    return "INTERNAL_TRANSFER";
  }
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE") {
    return "MAINTENANCE_PURCHASE";
  }
  if (
    receiptType === "INVENTORY_PURCHASE" &&
    (!createExpense || receiptPurpose === "INVENTORY_PURCHASE") &&
    !projectId
  ) {
    return "STOCK_PURCHASE";
  }
  return "PROJECT_PURCHASE";
}

export function mapRequisitionTypeToWorkflowType(
  requisitionType: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE"
): ReceiptWorkflowType {
  if (requisitionType === "MAINTENANCE_PURCHASE") {
    return "MAINTENANCE_PURCHASE";
  }
  if (requisitionType === "INVENTORY_STOCK_UP") {
    return "STOCK_PURCHASE";
  }
  return "PROJECT_PURCHASE";
}

export function formatWorkflowTypeLabel(value: ReceiptWorkflowType) {
  if (value === "PROJECT_PURCHASE") return "Project Purchase";
  if (value === "MAINTENANCE_PURCHASE") return "Maintenance Purchase (Rig Repair)";
  if (value === "STOCK_PURCHASE") return "Stock Purchase (Inventory)";
  return "Internal Transfer";
}

export function resolveCreateExpenseByPurpose({
  receiptType,
  receiptPurpose,
  requestedCreateExpense
}: {
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  requestedCreateExpense: boolean;
}) {
  if (receiptType === "INTERNAL_TRANSFER") {
    return false;
  }
  if (receiptType === "EXPENSE_ONLY") {
    return true;
  }
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE") {
    return true;
  }

  if (receiptPurpose === "BUSINESS_EXPENSE_ONLY" || receiptPurpose === "INVENTORY_AND_EXPENSE") {
    return requestedCreateExpense;
  }
  return false;
}

export function resolveExpenseOnlyCategory(value: unknown) {
  if (value === "TRAVEL" || value === "FOOD" || value === "FUEL" || value === "MISC") {
    return value;
  }
  return null;
}

export function resolveExpenseCategoryForReceiptType({
  receiptType,
  expenseOnlyCategory,
  dominantCategory,
  isEvidenceOnlyPurpose
}: {
  receiptType: ReceiptType;
  expenseOnlyCategory: "TRAVEL" | "FOOD" | "FUEL" | "MISC" | null;
  dominantCategory: InventoryCategory | null;
  isEvidenceOnlyPurpose: boolean;
}) {
  if (isEvidenceOnlyPurpose) {
    return resolveExpenseCategoryFromInventoryCategory("OTHER");
  }
  if (receiptType === "EXPENSE_ONLY") {
    if (expenseOnlyCategory === "TRAVEL") return "Travel";
    if (expenseOnlyCategory === "FOOD") return "Food";
    if (expenseOnlyCategory === "FUEL") return "Fuel";
    if (expenseOnlyCategory === "MISC") return "Misc";
    return "Misc";
  }
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE") {
    return "Maintenance";
  }
  return resolveExpenseCategoryFromInventoryCategory(dominantCategory || "OTHER");
}

export function sanitizeSubmissionLines(lines: IntakeLinePayload[]) {
  return lines.map((line, index) => {
    const quantity = parseNumeric(line.quantity);
    const unitPrice = parseNumeric(line.unitPrice);
    const lineTotal = parseNumeric(line.lineTotal);
    return {
      id:
        typeof line.id === "string" && line.id.trim().length > 0
          ? line.id.trim()
          : `line-${index + 1}`,
      description: typeof line.description === "string" ? line.description.trim() : "",
      quantity: quantity && quantity > 0 ? roundCurrency(quantity) : 0,
      unitPrice: unitPrice && unitPrice > 0 ? roundCurrency(unitPrice) : 0,
      lineTotal: lineTotal && lineTotal > 0 ? roundCurrency(lineTotal) : 0,
      selectedItemId:
        typeof line.selectedItemId === "string" && line.selectedItemId.trim().length > 0
          ? line.selectedItemId.trim()
          : null,
      selectedCategory:
        typeof line.selectedCategory === "string" && line.selectedCategory.trim().length > 0
          ? line.selectedCategory.trim()
          : null,
      mode: line.mode === "NEW" || line.mode === "EXPENSE_ONLY" ? line.mode : "MATCH",
      newItem:
        line.newItem && typeof line.newItem === "object"
          ? {
              name: typeof line.newItem.name === "string" ? line.newItem.name.trim() : "",
              sku: typeof line.newItem.sku === "string" ? line.newItem.sku.trim() : "",
              category:
                typeof line.newItem.category === "string" ? line.newItem.category.trim() : "",
              minimumStockLevel: parseNumeric(line.newItem.minimumStockLevel) || 0,
              locationId:
                typeof line.newItem.locationId === "string" && line.newItem.locationId.trim().length > 0
                  ? line.newItem.locationId.trim()
                  : null,
              status: line.newItem.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
              notes: typeof line.newItem.notes === "string" ? line.newItem.notes.trim() : ""
            }
          : null
    };
  });
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toReceiptFingerprintRecord(input: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}): ReceiptDuplicateFingerprint {
  return {
    supplierName: normalizeText(input.supplierName),
    tin: normalizeCode(input.tin),
    vrn: normalizeCode(input.vrn),
    receiptNumber: normalizeCode(input.receiptNumber),
    serialNumber: normalizeCode(input.serialNumber),
    receiptDate: normalizeCode(input.receiptDate),
    total: roundCurrency(input.total || 0),
    verificationCode: normalizeCode(input.verificationCode),
    traReceiptNumber: normalizeCode(input.traReceiptNumber),
    receiptUrl: input.receiptUrl.trim()
  };
}

export function buildDuplicateFingerprint(input: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}) {
  const normalized = toReceiptFingerprintRecord(input);
  const entries = [
    ["supplier", normalized.supplierName] as const,
    ["tin", normalized.tin] as const,
    ["vrn", normalized.vrn] as const,
    ["receiptNo", normalized.receiptNumber] as const,
    ["serial", normalized.serialNumber] as const,
    ["date", normalized.receiptDate] as const,
    ["total", normalized.total > 0 ? normalized.total.toFixed(2) : ""] as const,
    ["verification", normalized.verificationCode] as const,
    ["traReceiptNo", normalized.traReceiptNumber] as const,
    ["receiptUrl", normalized.receiptUrl] as const
  ].filter((entry) => entry[1].trim().length > 0);
  return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

function parseMetadataValue(notes: string | null | undefined, key: string) {
  if (!notes) {
    return "";
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}=([^|\\n]+)`, "i");
  const match = notes.match(regex);
  return match?.[1] ? normalizeCode(match[1]) : "";
}

function compareDateOnly(left: Date, rightDateOnly: string) {
  if (!rightDateOnly) {
    return false;
  }
  return formatDateOnly(left) === rightDateOnly;
}

function compareTotals(left: number | null | undefined, right: number) {
  if (!left || left <= 0 || !right || right <= 0) {
    return false;
  }
  return Math.abs(left - right) <= Math.max(1, right * 0.02);
}

function buildDuplicateReason(matchedFields: string[]) {
  if (matchedFields.includes("verificationCode")) {
    return "Matched verification code from a previously processed receipt.";
  }
  if (matchedFields.includes("traReceiptNumber")) {
    return "Matched TRA receipt number from a previously processed receipt.";
  }
  if (
    matchedFields.includes("receiptNumber") &&
    matchedFields.includes("receiptDate") &&
    matchedFields.includes("supplierName")
  ) {
    return "Matched supplier, receipt number, and receipt date.";
  }
  return `Matched fields: ${matchedFields.join(", ")}.`;
}

function isStrongDuplicate(fields: string[]) {
  if (fields.includes("verificationCode")) {
    return true;
  }
  if (fields.includes("traReceiptNumber")) {
    return true;
  }
  if (fields.includes("receiptNumber") && fields.includes("supplierName") && fields.includes("receiptDate")) {
    return true;
  }
  if (fields.includes("receiptNumber") && fields.includes("tin") && fields.includes("receiptDate")) {
    return true;
  }
  return false;
}

export async function detectReceiptDuplicates(fingerprintInput: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}): Promise<ReceiptDuplicateMatch[]> {
  const fingerprint = toReceiptFingerprintRecord(fingerprintInput);
  const movementOr: Prisma.InventoryMovementWhereInput[] = [];
  const expenseOr: Prisma.ExpenseWhereInput[] = [];

  if (fingerprint.verificationCode) {
    movementOr.push({ notes: { contains: `VerificationCode=${fingerprint.verificationCode}` } });
    expenseOr.push({ notes: { contains: `VerificationCode=${fingerprint.verificationCode}` } });
  }
  if (fingerprint.traReceiptNumber) {
    movementOr.push({ traReceiptNumber: fingerprint.traReceiptNumber });
    expenseOr.push({ receiptNumber: fingerprint.traReceiptNumber });
  }
  if (fingerprint.receiptNumber) {
    movementOr.push({ supplierInvoiceNumber: fingerprint.receiptNumber });
    expenseOr.push({ receiptNumber: fingerprint.receiptNumber });
  }
  if (fingerprint.receiptUrl) {
    movementOr.push({ receiptUrl: fingerprint.receiptUrl });
    expenseOr.push({ receiptUrl: fingerprint.receiptUrl });
  }
  if (movementOr.length === 0 && expenseOr.length === 0) {
    return [];
  }

  const [movements, expenses] = await Promise.all([
    movementOr.length
      ? prisma.inventoryMovement.findMany({
          where: { OR: movementOr },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            date: true,
            totalCost: true,
            traReceiptNumber: true,
            supplierInvoiceNumber: true,
            receiptUrl: true,
            notes: true,
            expenseId: true,
            supplier: { select: { name: true } },
            item: {
              select: {
                id: true,
                name: true
              }
            }
          }
        })
      : Promise.resolve([]),
    expenseOr.length
      ? prisma.expense.findMany({
          where: { OR: expenseOr },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            date: true,
            amount: true,
            vendor: true,
            receiptNumber: true,
            receiptUrl: true,
            notes: true
          }
        })
      : Promise.resolve([])
  ]);

  const matches: ReceiptDuplicateMatch[] = [];

  for (const movement of movements) {
    const matchedFields: string[] = [];
    const noteTin = parseMetadataValue(movement.notes, "TIN");
    const noteVrn = parseMetadataValue(movement.notes, "VRN");
    const noteSerial = parseMetadataValue(movement.notes, "Serial");
    const noteVerification = parseMetadataValue(movement.notes, "VerificationCode");
    const noteReceipt = parseMetadataValue(movement.notes, "ReceiptNo");
    const noteReceiptPurpose = parseMetadataValue(movement.notes, "ReceiptPurpose");
    const movementSupplierName = normalizeText(movement.supplier?.name || "");
    const movementReceiptNumber = normalizeCode(movement.supplierInvoiceNumber || noteReceipt);
    const movementTraReceiptNo = normalizeCode(movement.traReceiptNumber || "");

    if (fingerprint.supplierName && movementSupplierName === fingerprint.supplierName) matchedFields.push("supplierName");
    if (fingerprint.tin && noteTin === fingerprint.tin) matchedFields.push("tin");
    if (fingerprint.vrn && noteVrn === fingerprint.vrn) matchedFields.push("vrn");
    if (fingerprint.serialNumber && noteSerial === fingerprint.serialNumber) matchedFields.push("serialNumber");
    if (fingerprint.receiptNumber && movementReceiptNumber === fingerprint.receiptNumber) matchedFields.push("receiptNumber");
    if (fingerprint.verificationCode && noteVerification === fingerprint.verificationCode) matchedFields.push("verificationCode");
    if (fingerprint.traReceiptNumber && movementTraReceiptNo === fingerprint.traReceiptNumber) matchedFields.push("traReceiptNumber");
    if (fingerprint.receiptUrl && movement.receiptUrl === fingerprint.receiptUrl) matchedFields.push("receiptUrl");
    if (compareDateOnly(movement.date, fingerprint.receiptDate)) matchedFields.push("receiptDate");
    if (compareTotals(movement.totalCost, fingerprint.total)) matchedFields.push("total");

    if (!isStrongDuplicate(matchedFields)) {
      continue;
    }
    const movementReceiptDate = formatDateOnly(movement.date);
    const movementTotal = roundCurrency(movement.totalCost || 0);
    const supplierNameDisplay = movement.supplier?.name?.trim() || fingerprint.supplierName;
    matches.push({
      source: "inventory_movement",
      id: movement.id,
      matchedFields,
      reason: buildDuplicateReason(matchedFields),
      viewUrl: `/inventory/stock-movements?movementId=${movement.id}`,
      createdAt: movement.createdAt,
      supplierName: supplierNameDisplay,
      receiptNumber: movementReceiptNumber || fingerprint.receiptNumber,
      verificationCode: noteVerification || fingerprint.verificationCode,
      serialNumber: noteSerial || fingerprint.serialNumber,
      receiptDate: movementReceiptDate || fingerprint.receiptDate,
      total: movementTotal > 0 ? movementTotal : fingerprint.total,
      traReceiptNumber: movementTraReceiptNo || fingerprint.traReceiptNumber,
      stockMovementId: movement.id,
      expenseId: movement.expenseId || null,
      itemId: movement.item?.id || null,
      itemName: movement.item?.name || null,
      receiptPurpose: noteReceiptPurpose || "UNKNOWN"
    });
  }

  for (const expense of expenses) {
    const matchedFields: string[] = [];
    const noteTin = parseMetadataValue(expense.notes, "TIN");
    const noteVrn = parseMetadataValue(expense.notes, "VRN");
    const noteSerial = parseMetadataValue(expense.notes, "Serial");
    const noteVerification = parseMetadataValue(expense.notes, "VerificationCode");
    const noteReceiptPurpose = parseMetadataValue(expense.notes, "ReceiptPurpose");
    const expenseVendor = normalizeText(expense.vendor || "");
    const expenseReceiptNo = normalizeCode(expense.receiptNumber || "");

    if (fingerprint.supplierName && expenseVendor === fingerprint.supplierName) matchedFields.push("supplierName");
    if (fingerprint.tin && noteTin === fingerprint.tin) matchedFields.push("tin");
    if (fingerprint.vrn && noteVrn === fingerprint.vrn) matchedFields.push("vrn");
    if (fingerprint.serialNumber && noteSerial === fingerprint.serialNumber) matchedFields.push("serialNumber");
    if (fingerprint.receiptNumber && expenseReceiptNo === fingerprint.receiptNumber) matchedFields.push("receiptNumber");
    if (fingerprint.verificationCode && noteVerification === fingerprint.verificationCode) matchedFields.push("verificationCode");
    if (fingerprint.receiptUrl && expense.receiptUrl === fingerprint.receiptUrl) matchedFields.push("receiptUrl");
    if (compareDateOnly(expense.date, fingerprint.receiptDate)) matchedFields.push("receiptDate");
    if (compareTotals(expense.amount, fingerprint.total)) matchedFields.push("total");

    if (!isStrongDuplicate(matchedFields)) {
      continue;
    }
    const expenseReceiptDate = formatDateOnly(expense.date);
    const expenseTotal = roundCurrency(expense.amount || 0);
    matches.push({
      source: "expense",
      id: expense.id,
      matchedFields,
      reason: buildDuplicateReason(matchedFields),
      viewUrl: `/expenses?expenseId=${expense.id}`,
      createdAt: expense.createdAt,
      supplierName: expense.vendor?.trim() || fingerprint.supplierName,
      receiptNumber: expenseReceiptNo || fingerprint.receiptNumber,
      verificationCode: noteVerification || fingerprint.verificationCode,
      serialNumber: noteSerial || fingerprint.serialNumber,
      receiptDate: expenseReceiptDate || fingerprint.receiptDate,
      total: expenseTotal > 0 ? expenseTotal : fingerprint.total,
      traReceiptNumber: fingerprint.traReceiptNumber,
      stockMovementId: null,
      expenseId: expense.id,
      itemId: null,
      itemName: null,
      receiptPurpose: noteReceiptPurpose || "UNKNOWN"
    });
  }

  const dedupedByKey = new Map<string, ReceiptDuplicateMatch>();
  for (const match of matches) {
    const key = `${match.source}:${match.id}`;
    const existing = dedupedByKey.get(key);
    if (!existing || match.matchedFields.length > existing.matchedFields.length) {
      dedupedByKey.set(key, match);
    }
  }

  return Array.from(dedupedByKey.values()).sort((a, b) => b.matchedFields.length - a.matchedFields.length);
}

function toMatchedFieldLabel(field: string) {
  const map: Record<string, string> = {
    supplierName: "Supplier",
    tin: "TIN",
    vrn: "VRN",
    receiptNumber: "Receipt Number",
    serialNumber: "Serial Number",
    receiptDate: "Receipt Date",
    total: "Total",
    verificationCode: "Verification Code",
    traReceiptNumber: "TRA Receipt Number",
    receiptUrl: "Receipt URL"
  };
  return map[field] || field;
}

export function inferDuplicateConfidence(fields: string[]): "HIGH" | "MEDIUM" | "LOW" {
  if (fields.includes("verificationCode") || fields.includes("traReceiptNumber")) {
    return "HIGH";
  }
  if (fields.length >= 4) {
    return "MEDIUM";
  }
  return "LOW";
}

export function buildDuplicateReview({
  matches,
  fingerprint
}: {
  matches: ReceiptDuplicateMatch[];
  fingerprint: {
    supplierName: string;
    tin: string;
    vrn: string;
    receiptNumber: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    verificationCode: string;
    traReceiptNumber: string;
    receiptUrl: string;
  };
}): DuplicateReviewPayload | null {
  if (matches.length === 0) {
    return null;
  }

  const primary = matches[0];

  const receiptIntakeMap = new Map<string, DuplicateLinkedRecord>();
  const inventoryItemsMap = new Map<string, DuplicateLinkedRecord>();
  const stockMovementsMap = new Map<string, DuplicateLinkedRecord>();
  const expensesMap = new Map<string, DuplicateLinkedRecord>();

  for (const match of matches) {
    if (match.stockMovementId) {
      if (!receiptIntakeMap.has(match.stockMovementId)) {
        receiptIntakeMap.set(match.stockMovementId, {
          id: match.stockMovementId,
          label: `Receipt intake ${match.stockMovementId.slice(-8)}`,
          type: "RECEIPT_INTAKE",
          url: `/purchasing/receipt-follow-up?movementId=${match.stockMovementId}`
        });
      }
      if (!stockMovementsMap.has(match.stockMovementId)) {
        stockMovementsMap.set(match.stockMovementId, {
          id: match.stockMovementId,
          label: `Stock movement ${match.stockMovementId.slice(-8)}`,
          type: "STOCK_MOVEMENT",
          url: `/inventory/stock-movements?movementId=${match.stockMovementId}`
        });
      }
    }
    if (match.itemId) {
      inventoryItemsMap.set(match.itemId, {
        id: match.itemId,
        label: match.itemName || `Inventory item ${match.itemId.slice(-8)}`,
        type: "INVENTORY_ITEM",
        url: `/inventory/items?itemId=${match.itemId}`
      });
    }
    if (match.expenseId) {
      expensesMap.set(match.expenseId, {
        id: match.expenseId,
        label: `Expense ${match.expenseId.slice(-8)}`,
        type: "EXPENSE",
        url: `/expenses?expenseId=${match.expenseId}`
      });
    }
  }

  const receiptIntake = Array.from(receiptIntakeMap.values());
  const inventoryItems = Array.from(inventoryItemsMap.values());
  const stockMovements = Array.from(stockMovementsMap.values());
  const expenses = Array.from(expensesMap.values());

  const primaryRecord =
    receiptIntake[0] ||
    stockMovements[0] ||
    inventoryItems[0] ||
    expenses[0] ||
    null;

  return {
    summary: {
      supplierName: primary.supplierName || fingerprint.supplierName,
      receiptNumber: primary.receiptNumber || fingerprint.receiptNumber,
      verificationCode: primary.verificationCode || fingerprint.verificationCode,
      serialNumber: primary.serialNumber || fingerprint.serialNumber,
      receiptDate: primary.receiptDate || fingerprint.receiptDate,
      total: primary.total > 0 ? primary.total : fingerprint.total,
      traReceiptNumber: primary.traReceiptNumber || fingerprint.traReceiptNumber,
      processedAt: primary.createdAt.toISOString(),
      duplicateConfidence: inferDuplicateConfidence(primary.matchedFields),
      matchReason: primary.reason,
      matchedFields: primary.matchedFields.map(toMatchedFieldLabel),
      receiptPurpose: primary.receiptPurpose || "UNKNOWN"
    },
    primaryRecord,
    linkedRecords: {
      receiptIntake,
      inventoryItems,
      stockMovements,
      expenses
    }
  };
}
