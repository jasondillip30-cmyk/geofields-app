import type {
  ExpenseOnlyCategory,
  ReceiptClassification,
  ReceiptPurpose,
  ReceiptWorkflowChoice,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";

export function normalizeReceiptPurpose(value: string): ReceiptPurpose {
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

export function normalizeReceiptClassification(value: string): ReceiptClassification {
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

export function normalizeReceiptWorkflowChoice(value: string): ReceiptWorkflowChoice | null {
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

export function resolveWorkflowSelectionConfig(choice: ReceiptWorkflowChoice): {
  classification: ReceiptClassification;
  receiptPurpose: ReceiptPurpose;
  createExpense: boolean;
} {
  if (choice === "MAINTENANCE_PURCHASE") {
    return {
      classification: "MAINTENANCE_LINKED_PURCHASE",
      receiptPurpose: "INVENTORY_AND_EXPENSE",
      createExpense: true
    };
  }
  if (choice === "STOCK_PURCHASE") {
    return {
      classification: "INVENTORY_PURCHASE",
      receiptPurpose: "INVENTORY_PURCHASE",
      createExpense: false
    };
  }
  if (choice === "INTERNAL_TRANSFER") {
    return {
      classification: "INTERNAL_TRANSFER",
      receiptPurpose: "INVENTORY_PURCHASE",
      createExpense: false
    };
  }
  return {
    classification: "INVENTORY_PURCHASE",
    receiptPurpose: "INVENTORY_AND_EXPENSE",
    createExpense: true
  };
}

export function resolveWorkflowChoiceFromClassification({
  receiptClassification,
  receiptPurpose,
  createExpense
}: {
  receiptClassification: ReceiptClassification;
  receiptPurpose: ReceiptPurpose;
  createExpense?: boolean;
}): ReceiptWorkflowChoice {
  if (receiptClassification === "INTERNAL_TRANSFER") {
    return "INTERNAL_TRANSFER";
  }
  if (receiptClassification === "MAINTENANCE_LINKED_PURCHASE") {
    return "MAINTENANCE_PURCHASE";
  }
  if (receiptClassification === "INVENTORY_PURCHASE") {
    if (!createExpense || receiptPurpose === "INVENTORY_PURCHASE") {
      return "STOCK_PURCHASE";
    }
    return "PROJECT_PURCHASE";
  }
  return "PROJECT_PURCHASE";
}

export function resolveWorkflowChoiceFromReview(
  review: Pick<
    ReviewState,
    "receiptWorkflowChoice" | "receiptClassification" | "receiptPurpose" | "createExpense" | "requisitionType"
  >
): ReceiptWorkflowChoice {
  if (review.requisitionType) {
    return mapRequisitionTypeToWorkflowChoice(review.requisitionType);
  }
  const explicit = normalizeReceiptWorkflowChoice(review.receiptWorkflowChoice);
  if (explicit) {
    return explicit;
  }
  return resolveWorkflowChoiceFromClassification({
    receiptClassification: review.receiptClassification,
    receiptPurpose: review.receiptPurpose,
    createExpense: review.createExpense
  });
}

export function applyWorkflowSelectionUpdate(
  current: ReviewState,
  workflowConfig: {
    classification: ReceiptClassification;
    receiptPurpose: ReceiptPurpose;
    createExpense: boolean;
  }
): ReviewState {
  const workflowChoice = resolveWorkflowChoiceFromClassification({
    receiptClassification: workflowConfig.classification,
    receiptPurpose: workflowConfig.receiptPurpose,
    createExpense: workflowConfig.createExpense
  });

  return {
    ...current,
    receiptClassification: workflowConfig.classification,
    receiptPurpose: workflowConfig.receiptPurpose,
    createExpense: workflowConfig.createExpense,
    receiptWorkflowChoice: workflowChoice,
    projectId:
      workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
        ? current.projectId
        : "",
    clientId:
      workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
        ? current.clientId
        : "",
    rigId:
      workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
        ? current.rigId
        : "",
    maintenanceRequestId:
      workflowChoice === "MAINTENANCE_PURCHASE" ? current.maintenanceRequestId : "",
    locationFromId: workflowChoice === "INTERNAL_TRANSFER" ? current.locationFromId : "",
    expenseOnlyCategory: workflowConfig.classification === "EXPENSE_ONLY" ? current.expenseOnlyCategory : "",
    lines: applyReceiptClassificationLineDefaults(current.lines, workflowConfig.classification)
  };
}

export function formatReceiptPurposeLabel(value: string) {
  const normalized = normalizeReceiptPurpose(value);
  if (normalized === "BUSINESS_EXPENSE_ONLY") return "Business expense only";
  if (normalized === "INVENTORY_AND_EXPENSE") return "Inventory + expense";
  if (normalized === "EVIDENCE_ONLY") return "Evidence only";
  if (normalized === "OTHER_MANUAL") return "Other / manual decision";
  return "Inventory purchase";
}

export function resolveCreateExpenseForPurpose(review: ReviewState) {
  if (review.receiptClassification === "INTERNAL_TRANSFER") {
    return false;
  }
  if (review.receiptClassification === "EXPENSE_ONLY") {
    return true;
  }
  if (review.receiptPurpose === "EVIDENCE_ONLY" || review.receiptPurpose === "OTHER_MANUAL") {
    return false;
  }
  return review.createExpense;
}

export function resolveExpenseOnlyCategory(value: string): ExpenseOnlyCategory | null {
  if (value === "TRAVEL" || value === "FOOD" || value === "FUEL" || value === "MISC") {
    return value;
  }
  return null;
}

export function applyReceiptClassificationLineDefaults(
  lines: ReviewLineState[],
  classification: ReceiptClassification
) {
  if (classification === "EXPENSE_ONLY") {
    return lines.map((line) => ({
      ...line,
      mode: "EXPENSE_ONLY" as const,
      selectedItemId: ""
    }));
  }
  if (classification === "INTERNAL_TRANSFER") {
    return lines.map((line) => ({
      ...line,
      mode: "MATCH" as const
    }));
  }
  return lines.map((line) => {
    if (line.mode !== "EXPENSE_ONLY") {
      return line;
    }
    const fallbackMode: ReviewLineState["mode"] = line.selectedItemId ? "MATCH" : "NEW";
    return {
      ...line,
      mode: fallbackMode
    };
  });
}

export function resolveReceiptConfig(receiptClassification: ReceiptClassification): {
  receiptPurpose: ReceiptPurpose;
  createExpense: boolean;
} {
  if (
    receiptClassification === "INVENTORY_PURCHASE" ||
    receiptClassification === "MAINTENANCE_LINKED_PURCHASE"
  ) {
    return {
      receiptPurpose: "INVENTORY_AND_EXPENSE",
      createExpense: true
    };
  }
  if (receiptClassification === "EXPENSE_ONLY") {
    return {
      receiptPurpose: "BUSINESS_EXPENSE_ONLY",
      createExpense: true
    };
  }
  return {
    receiptPurpose: "INVENTORY_PURCHASE",
    createExpense: false
  };
}

export function resolveReceiptConfigForRequisitionType(
  requisitionType: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE"
): {
  receiptPurpose: ReceiptPurpose;
  createExpense: boolean;
} {
  if (requisitionType === "INVENTORY_STOCK_UP") {
    return {
      receiptPurpose: "INVENTORY_PURCHASE",
      createExpense: false
    };
  }
  return {
    receiptPurpose: "INVENTORY_AND_EXPENSE",
    createExpense: true
  };
}

export function mapRequisitionTypeToReceiptClassification(
  requisitionType: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE"
): ReceiptClassification {
  if (requisitionType === "MAINTENANCE_PURCHASE") {
    return "MAINTENANCE_LINKED_PURCHASE";
  }
  return "INVENTORY_PURCHASE";
}

export function mapRequisitionTypeToWorkflowChoice(
  requisitionType: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE"
): ReceiptWorkflowChoice {
  if (requisitionType === "MAINTENANCE_PURCHASE") {
    return "MAINTENANCE_PURCHASE";
  }
  if (requisitionType === "INVENTORY_STOCK_UP") {
    return "STOCK_PURCHASE";
  }
  return "PROJECT_PURCHASE";
}
