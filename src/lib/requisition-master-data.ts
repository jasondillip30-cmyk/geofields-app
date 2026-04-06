import { normalizeNameForComparison, normalizeNameForStorage } from "@/lib/name-normalization";

export const PURCHASE_REQUISITION_SETUP_REPORT_TYPE = "PURCHASE_REQUISITION_SETUP";

export type RequisitionMasterDataSource = "setup_seed" | "setup" | "request_flow";

export interface RequisitionCategorySetupRecord {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  createdByUserId: string | null;
  source: RequisitionMasterDataSource;
}

export interface RequisitionSubcategorySetupRecord {
  id: string;
  name: string;
  categoryId: string;
  isActive: boolean;
  createdAt: string;
  createdByUserId: string | null;
  source: RequisitionMasterDataSource;
}

export interface PurchaseRequisitionSetupPayload {
  schemaVersion: 1;
  categories: RequisitionCategorySetupRecord[];
  subcategories: RequisitionSubcategorySetupRecord[];
}

const FALLBACK_CATEGORIES = ["Materials", "Services", "Tools", "Fuel"];

export function buildDefaultRequisitionSetupPayload(options?: {
  createdByUserId?: string | null;
  now?: Date;
}): PurchaseRequisitionSetupPayload {
  const nowIso = (options?.now || new Date()).toISOString();
  const createdByUserId = options?.createdByUserId || null;
  const categories = FALLBACK_CATEGORIES.map((name) => ({
    id: buildStableMasterId(name),
    name,
    isActive: true,
    createdAt: nowIso,
    createdByUserId,
    source: "setup_seed" as const
  }));

  return {
    schemaVersion: 1,
    categories,
    subcategories: []
  };
}

export function parsePurchaseRequisitionSetupPayload(
  payloadJson: string | null
): PurchaseRequisitionSetupPayload | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const root = asRecord(parsed);
    if (!root) {
      return null;
    }

    const categories = Array.isArray(root.categories)
      ? root.categories
          .map((entry) => parseCategoryRecord(entry))
          .filter((entry): entry is RequisitionCategorySetupRecord => Boolean(entry))
      : [];
    const subcategories = Array.isArray(root.subcategories)
      ? root.subcategories
          .map((entry) => parseSubcategoryRecord(entry))
          .filter((entry): entry is RequisitionSubcategorySetupRecord => Boolean(entry))
      : [];

    return {
      schemaVersion: 1,
      categories,
      subcategories
    };
  } catch {
    return null;
  }
}

export function normalizeMasterDataName(value: string) {
  return normalizeNameForStorage(value);
}

export function normalizeMasterDataKey(value: string) {
  return normalizeNameForComparison(value);
}

function parseCategoryRecord(value: unknown): RequisitionCategorySetupRecord | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }

  const name = normalizeMasterDataName(asString(row.name));
  const id = asString(row.id);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    isActive: row.isActive !== false,
    createdAt: asString(row.createdAt) || new Date(0).toISOString(),
    createdByUserId: asNullableString(row.createdByUserId),
    source: parseSource(row.source)
  };
}

function parseSubcategoryRecord(value: unknown): RequisitionSubcategorySetupRecord | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }

  const name = normalizeMasterDataName(asString(row.name));
  const id = asString(row.id);
  const categoryId = asString(row.categoryId);
  if (!id || !name || !categoryId) {
    return null;
  }

  return {
    id,
    name,
    categoryId,
    isActive: row.isActive !== false,
    createdAt: asString(row.createdAt) || new Date(0).toISOString(),
    createdByUserId: asNullableString(row.createdByUserId),
    source: parseSource(row.source)
  };
}

function parseSource(value: unknown): RequisitionMasterDataSource {
  if (value === "setup" || value === "request_flow" || value === "setup_seed") {
    return value;
  }
  return "setup_seed";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function buildStableMasterId(name: string) {
  return `cat-${normalizeMasterDataKey(name).replace(/[^a-z0-9]+/g, "-")}`;
}
