import {
  normalizeInventoryUsageReasonType,
  type InventoryUsageReasonType
} from "@/lib/inventory-usage-context";

/**
 * Legacy parser for metadata-tagged reason strings from pre-FK inventory usage linkage.
 * Only used by backfill/maintenance scripts.
 */
export function parseLegacyInventoryUsageReason(raw: string | null | undefined) {
  if (!raw) {
    return {
      reasonType: "OTHER" as InventoryUsageReasonType,
      breakdownReportId: null,
      reasonDetails: ""
    };
  }

  const reasonType = extractLegacyReasonType(raw);
  const breakdownReportId = extractLegacyBreakdownId(raw);
  const reasonDetails = stripLegacyInventoryUsageMetadata(raw);

  return {
    reasonType,
    breakdownReportId,
    reasonDetails
  };
}

function stripLegacyInventoryUsageMetadata(raw: string) {
  return raw
    .replace(/\[usageReasonType:[^\]]+\]\s*/gi, "")
    .replace(/\[breakdown:[^\]\s]+\]\s*/gi, "")
    .trim();
}

function extractLegacyReasonType(raw: string): InventoryUsageReasonType {
  const match = raw.match(/\[usageReasonType:([^\]]+)\]/i);
  if (!match) {
    return "OTHER";
  }
  return normalizeInventoryUsageReasonType(match[1]);
}

function extractLegacyBreakdownId(raw: string) {
  const match = raw.match(/\[breakdown:([^\]\s]+)\]/i);
  if (!match) {
    return null;
  }
  const trimmed = match[1]?.trim() || "";
  return trimmed.length > 0 ? trimmed : null;
}
