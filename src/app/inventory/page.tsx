import InventoryPageContent from "./inventory-page-content";
export type {
  BreakdownContextOption,
  InventoryIssueRow,
  InventoryItemDetailsResponse,
  InventoryItemRow,
  InventoryLocation,
  InventoryMovementRow,
  InventorySupplier,
  MaintenanceContextOption,
  MovementFormState,
  UseRequestFormState
} from "./inventory-page-types";

export default function InventoryPageRoute() {
  return <InventoryPageContent />;
}
