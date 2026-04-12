import { readApiError } from "@/components/inventory/inventory-page-shared";
import type { InventoryIssueRow, ItemFormState, LocationFormState, MovementFormState, SupplierFormState } from "./inventory-page-types";

export async function createInventoryItem(form: ItemFormState) {
  const customCategoryLabel = form.customCategoryLabel.trim();
  const mergedNotes = [form.notes.trim(), customCategoryLabel ? `Category Label: ${customCategoryLabel}` : ""]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("/api/inventory/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.name,
      sku: form.sku,
      category: form.category,
      description: form.description || null,
      quantityInStock: Number(form.quantityInStock || 0),
      minimumStockLevel: Number(form.minimumStockLevel || 0),
      unitCost: Number(form.unitCost || 0),
      supplierId: form.supplierId || null,
      locationId: form.locationId || null,
      compatibleRigId: form.compatibleRigId || null,
      compatibleRigType: form.compatibleRigType || null,
      partNumber: form.partNumber || null,
      status: form.status,
      notes: mergedNotes || null
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to create inventory item."));
  }
}

export async function createInventoryMovement(form: MovementFormState) {
  const endpoint = "/api/inventory/movements";
  let response: Response;

  if (form.receiptFile) {
    const formData = new FormData();
    formData.set("itemId", form.itemId);
    formData.set("movementType", form.movementType);
    formData.set("quantity", form.quantity);
    formData.set("unitCost", form.unitCost);
    formData.set("totalCost", form.totalCost);
    formData.set("date", form.date);
    formData.set("clientId", form.clientId);
    formData.set("projectId", form.projectId);
    formData.set("rigId", form.rigId);
    formData.set("maintenanceRequestId", form.maintenanceRequestId);
    formData.set("supplierId", form.supplierId);
    formData.set("locationFromId", form.locationFromId);
    formData.set("locationToId", form.locationToId);
    formData.set("traReceiptNumber", form.traReceiptNumber);
    formData.set("supplierInvoiceNumber", form.supplierInvoiceNumber);
    formData.set("notes", form.notes);
    formData.set("createExpense", String(form.createExpense));
    formData.set("allowNegativeStock", String(form.allowNegativeStock));
    formData.set("receipt", form.receiptFile);
    response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });
  } else {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: form.itemId,
        movementType: form.movementType,
        quantity: Number(form.quantity),
        unitCost: form.unitCost ? Number(form.unitCost) : null,
        totalCost: form.totalCost ? Number(form.totalCost) : null,
        date: form.date,
        clientId: form.clientId || null,
        projectId: form.projectId || null,
        rigId: form.rigId || null,
        maintenanceRequestId: form.maintenanceRequestId || null,
        supplierId: form.supplierId || null,
        locationFromId: form.locationFromId || null,
        locationToId: form.locationToId || null,
        traReceiptNumber: form.traReceiptNumber || null,
        supplierInvoiceNumber: form.supplierInvoiceNumber || null,
        receiptUrl: form.receiptUrl || null,
        notes: form.notes || null,
        createExpense: form.createExpense,
        allowNegativeStock: form.allowNegativeStock
      })
    });
  }

  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to create stock movement."));
  }
}

export async function createInventorySupplier(form: SupplierFormState) {
  const response = await fetch("/api/inventory/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.name,
      contactPerson: form.contactPerson || null,
      email: form.email || null,
      phone: form.phone || null,
      notes: form.notes || null
    })
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to create supplier."));
  }
}

export async function createInventoryLocation(form: LocationFormState) {
  const response = await fetch("/api/inventory/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null
    })
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to create location."));
  }
}

export async function applyInventoryIssueQuickFix({
  issue,
  fix
}: {
  issue: InventoryIssueRow;
  fix: "category" | "name";
}) {
  const targetItemId = issue.itemIds[0];
  if (!targetItemId) {
    return;
  }

  const payload: Record<string, string> = {};
  if (fix === "category") {
    if (!issue.suggestedCategory) {
      return;
    }
    payload.category = issue.suggestedCategory;
  } else {
    if (!issue.suggestedName) {
      return;
    }
    payload.name = issue.suggestedName;
  }

  const response = await fetch(`/api/inventory/items/${targetItemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to apply quick fix."));
  }
}

export async function applyInventoryNamingAutoFix(fixes: Array<{ itemId: string; suggestedName: string }>) {
  const response = await fetch("/api/inventory/issues/auto-fix-naming", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fixes
    })
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to auto-fix naming."));
  }
  return response.json().catch(() => null);
}

export async function mergeDuplicateInventoryItems({
  primaryItemId,
  duplicateItemIds
}: {
  primaryItemId: string;
  duplicateItemIds: string[];
}) {
  const response = await fetch("/api/inventory/items/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primaryItemId, duplicateItemIds })
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to merge duplicate items."));
  }
}
