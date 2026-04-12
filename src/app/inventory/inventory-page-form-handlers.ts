import type { FormEvent, MutableRefObject } from "react";

import {
  createInventoryItem,
  createInventoryLocation,
  createInventoryMovement,
  createInventorySupplier
} from "./inventory-page-actions";
import type {
  CategorySuggestionState,
  ItemFormState,
  LocationFormState,
  MovementFormState,
  SupplierFormState
} from "./inventory-page-types";

export const defaultItemFormState: ItemFormState = {
  name: "",
  sku: "",
  category: "SPARE_PARTS",
  customCategoryLabel: "",
  description: "",
  quantityInStock: "0",
  minimumStockLevel: "5",
  unitCost: "0",
  supplierId: "",
  locationId: "",
  compatibleRigId: "",
  compatibleRigType: "",
  partNumber: "",
  status: "ACTIVE",
  notes: ""
};

type CreateInventoryFormHandlersParams = {
  itemForm: ItemFormState;
  movementForm: MovementFormState;
  supplierForm: SupplierFormState;
  locationForm: LocationFormState;
  movementSubmitInFlightRef: MutableRefObject<boolean>;
  setSavingItem: (value: boolean) => void;
  setSavingMovement: (value: boolean) => void;
  setSavingSupplier: (value: boolean) => void;
  setSavingLocation: (value: boolean) => void;
  setNotice: (value: string | null) => void;
  setErrorMessage: (value: string | null) => void;
  setItemForm: (value: ItemFormState) => void;
  setCategorySuggestion: (value: CategorySuggestionState) => void;
  defaultSuggestion: CategorySuggestionState;
  loadInventoryData: () => Promise<void>;
  loadReferenceData: () => Promise<void>;
  setManualMovementModalOpen: (value: boolean) => void;
  setMovementForm: (updater: (current: MovementFormState) => MovementFormState) => void;
  loadSelectedItemDetails: () => Promise<void>;
  setSupplierForm: (value: SupplierFormState) => void;
  setLocationForm: (value: LocationFormState) => void;
};

export function createInventoryFormHandlers({
  itemForm,
  movementForm,
  supplierForm,
  locationForm,
  movementSubmitInFlightRef,
  setSavingItem,
  setSavingMovement,
  setSavingSupplier,
  setSavingLocation,
  setNotice,
  setErrorMessage,
  setItemForm,
  setCategorySuggestion,
  defaultSuggestion,
  loadInventoryData,
  loadReferenceData,
  setManualMovementModalOpen,
  setMovementForm,
  loadSelectedItemDetails,
  setSupplierForm,
  setLocationForm
}: CreateInventoryFormHandlersParams) {
  async function submitItemForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingItem(true);
    setNotice(null);
    setErrorMessage(null);

    try {
      await createInventoryItem(itemForm);
      setNotice("Inventory item created.");
      setItemForm({ ...defaultItemFormState });
      setCategorySuggestion(defaultSuggestion);
      await loadInventoryData();
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create inventory item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function submitMovementForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (movementSubmitInFlightRef.current) {
      return;
    }
    movementSubmitInFlightRef.current = true;
    setSavingMovement(true);
    setNotice(null);
    setErrorMessage(null);

    try {
      await createInventoryMovement(movementForm);

      setNotice("Stock movement recorded and inventory updated.");
      setManualMovementModalOpen(false);
      setMovementForm((current) => ({
        ...current,
        quantity: "",
        unitCost: "",
        totalCost: "",
        notes: "",
        traReceiptNumber: "",
        supplierInvoiceNumber: "",
        receiptUrl: "",
        receiptFile: null
      }));
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create stock movement.");
    } finally {
      setSavingMovement(false);
      movementSubmitInFlightRef.current = false;
    }
  }

  async function submitSupplierForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSupplier(true);
    setErrorMessage(null);

    try {
      await createInventorySupplier(supplierForm);
      setNotice("Supplier created.");
      setSupplierForm({ name: "", contactPerson: "", email: "", phone: "", notes: "" });
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  async function submitLocationForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingLocation(true);
    setErrorMessage(null);

    try {
      await createInventoryLocation(locationForm);
      setNotice("Location created.");
      setLocationForm({ name: "", description: "" });
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create location.");
    } finally {
      setSavingLocation(false);
    }
  }

  return {
    submitItemForm,
    submitMovementForm,
    submitSupplierForm,
    submitLocationForm
  };
}
