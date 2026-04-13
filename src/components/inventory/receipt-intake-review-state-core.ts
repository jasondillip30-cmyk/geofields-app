export {
  asRecord,
  asString,
  extractReceiptPurposeFromDetails,
  formatDateTimeText,
  formatMoneyText,
  readNumericFieldValue,
  readNumericFieldValueOptional,
  readStringFieldValue,
  toNumericString
} from "@/components/inventory/receipt-intake-review-state-primitives";

export {
  deriveAllocationStatus,
  isDuplicateCommitPayload,
  isReceiptCommitSuccessPayload,
  isReceiptExtractSuccessPayload,
  normalizeAllocationStatus,
  readDuplicateReviewPayload
} from "@/components/inventory/receipt-intake-review-state-payloads";

export {
  hasMeaningfulExtractedPayload,
  hasMeaningfulReviewData,
  isMeaningfulSnapshotLine,
  mapExtractedLines
} from "@/components/inventory/receipt-intake-review-state-lines";

export {
  mapRequisitionCategoryToInventoryCategory,
  mapRequisitionLineItems,
  normalizeSupplierName,
  resolveRequisitionEstimatedTotal,
  resolveRequisitionLink,
  resolveReviewLinesWithRequisitionFallback
} from "@/components/inventory/receipt-intake-review-state-domain";

export {
  applySupplierFieldOverrides,
  buildManualAssistReview,
  buildReviewStateFromPayload,
  buildReviewStateFromSubmission,
  resolveSupplierName
} from "@/components/inventory/receipt-intake-review-state-builders";
