export type InventoryShortageStatus =
  | "SUBMITTED"
  | "PENDING"
  | "WAITING_FOR_STOCK"
  | "READY_TO_ISSUE"
  | "APPROVED"
  | "REJECTED";

export function deriveInitialUsageRequestStatus({
  quantityRequested,
  quantityInStock
}: {
  quantityRequested: number;
  quantityInStock: number;
}): InventoryShortageStatus {
  return quantityRequested > quantityInStock ? "WAITING_FOR_STOCK" : "SUBMITTED";
}

export function calculateReplenishmentQuantity({
  quantityRequested,
  quantityInStock
}: {
  quantityRequested: number;
  quantityInStock: number;
}) {
  return Math.max(0, quantityRequested - quantityInStock);
}

export function derivePostReceiptUsageStatus({
  currentStatus,
  quantityRequested,
  quantityInStock
}: {
  currentStatus: InventoryShortageStatus;
  quantityRequested: number;
  quantityInStock: number;
}): InventoryShortageStatus {
  if (currentStatus !== "WAITING_FOR_STOCK") {
    return currentStatus;
  }
  return quantityInStock >= quantityRequested ? "READY_TO_ISSUE" : "WAITING_FOR_STOCK";
}
