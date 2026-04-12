import type { ExpenseQueueFilter, ExpenseQueueStatus, InventoryExpenseRow } from "./inventory-expenses-types";

export function queueFilterLabel(filter: ExpenseQueueStatus | ExpenseQueueFilter) {
  if (filter === "NEEDS_RECOGNITION") return "Needs recognition";
  if (filter === "PENDING_APPROVAL") return "Pending approval";
  if (filter === "COST_RECOGNIZED") return "Cost recognized";
  if (filter === "UNLINKED") return "Unlinked cost";
  return "All";
}

export function recognitionChipClass(status: ExpenseQueueStatus, isActive: boolean) {
  if (status === "UNLINKED") {
    return isActive
      ? "border-red-400 bg-red-100 text-red-900 shadow-sm"
      : "border-red-300 bg-red-50 text-red-800 hover:bg-red-100";
  }
  if (status === "NEEDS_RECOGNITION") {
    return isActive
      ? "border-amber-400 bg-amber-100 text-amber-900 shadow-sm"
      : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100";
  }
  if (status === "PENDING_APPROVAL") {
    return isActive
      ? "border-blue-400 bg-blue-100 text-blue-900 shadow-sm"
      : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100";
  }
  return isActive
    ? "border-emerald-400 bg-emerald-100 text-emerald-900 shadow-sm"
    : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
}

export function deriveExpenseTitle(expense: InventoryExpenseRow) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.item?.name) {
    return primaryMovement.item.name;
  }
  if (expense.subcategory?.trim()) {
    return expense.subcategory.trim();
  }
  return formatCategoryLabel(expense.category);
}

export function deriveExpenseSource(expense: InventoryExpenseRow) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.movementType === "OUT") {
    return "Inventory usage";
  }
  if (primaryMovement?.movementType === "IN") {
    return "Receipt intake";
  }
  if (expense.receiptUrl || expense.receiptNumber) {
    return "Receipt intake";
  }
  if ((expense.entrySource || "").toUpperCase() === "INVENTORY") {
    return "Inventory movement";
  }
  return "Operational activity";
}

export function buildOperationalContextLine(expense: InventoryExpenseRow, status: ExpenseQueueStatus) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  const project = expense.project?.name || primaryMovement?.project?.name || "No project";
  const rig = expense.rig?.rigCode || primaryMovement?.rig?.rigCode || "No rig";
  const maintenance = primaryMovement?.maintenanceRequest?.requestCode || "No maintenance case";
  const baseContext = `${project} • ${rig} • ${maintenance}`;
  if (status === "UNLINKED") {
    return `${baseContext} • Link this cost to restore operational traceability.`;
  }
  return baseContext;
}

export function deriveExpenseWhyThisCost(expense: InventoryExpenseRow, status: ExpenseQueueStatus) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (expense.purposeTraceability && status !== "UNLINKED") {
    return expense.purposeTraceability;
  }
  if (status === "UNLINKED") {
    return "This cost is not linked to a movement, receipt, or issue record yet.";
  }
  if (primaryMovement?.maintenanceRequest?.requestCode) {
    return `Created from maintenance usage linked to ${primaryMovement.maintenanceRequest.requestCode}.`;
  }
  if (primaryMovement?.movementType === "OUT") {
    return "Created when stock was issued out of inventory for operational use.";
  }
  if (primaryMovement?.movementType === "IN") {
    return "Created from stock replenishment captured during receipt intake.";
  }
  if (expense.receiptNumber || expense.receiptUrl) {
    return "Created from receipt-linked purchase intake.";
  }
  if (status === "COST_RECOGNIZED") {
    return "Recognized from a confirmed operational expense record.";
  }
  if (status === "PENDING_APPROVAL") {
    return "Waiting for approval before it can move into recognized financial totals.";
  }
  return "Approved intent exists; posting confirmation is still required for recognition.";
}

export function truncateExpenseExplanation(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function deriveExpenseQueueStatus(expense: InventoryExpenseRow): ExpenseQueueStatus {
  if (!hasOperationalExpenseLink(expense)) {
    return "UNLINKED";
  }
  if (expense.recognized) {
    return "COST_RECOGNIZED";
  }
  if (expense.approvalStatus === "APPROVED") {
    return "NEEDS_RECOGNITION";
  }
  return "PENDING_APPROVAL";
}

export function hasOperationalExpenseLink(expense: InventoryExpenseRow) {
  if (expense.inventoryMovements.length > 0) {
    return true;
  }
  if (expense.receiptNumber || expense.receiptUrl) {
    return true;
  }
  const contextText = `${expense.entrySource || ""} ${expense.notes || ""}`.toLowerCase();
  return contextText.includes("issue");
}

export function deriveExpenseContextLink(expense: InventoryExpenseRow): { href: string; label: string } | null {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.maintenanceRequest?.id) {
    return { href: "/maintenance", label: "Open Maintenance" };
  }
  if (expense.project?.id || primaryMovement?.project?.id) {
    const projectId = expense.project?.id || primaryMovement?.project?.id;
    return projectId ? { href: `/projects/${projectId}`, label: "Open Project" } : null;
  }
  if (expense.rig?.id || primaryMovement?.rig?.id) {
    const rigId = expense.rig?.id || primaryMovement?.rig?.id;
    return rigId ? { href: `/rigs/${rigId}`, label: "Open Rig" } : null;
  }
  return null;
}

export function canSubmitExpenseActions(role: string | null | undefined) {
  return role === "ADMIN" || role === "MANAGER" || role === "OFFICE";
}

export function expenseDecisionSuccessText(action: "submit" | "approve" | "reject" | "reopen") {
  if (action === "submit") {
    return "Expense submitted for approval.";
  }
  if (action === "approve") {
    return "Expense approved successfully.";
  }
  if (action === "reject") {
    return "Expense rejected successfully.";
  }
  return "Expense reopened to draft.";
}

function formatCategoryLabel(category: string) {
  return category
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toISOString().slice(0, 10);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  const raw = (await clone.text().catch(() => "")).trim();
  if (raw) {
    return raw;
  }
  return `${fallbackMessage} (HTTP ${response.status})`;
}
