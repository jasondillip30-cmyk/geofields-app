import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from "react";

import { DataTable } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { SelectInput, TextInput, VendorTypeaheadInput } from "./requisition-workflow-inputs";
import {
  formatInventoryReasonLabel,
  formatMaintenancePriorityLabel,
  formatRequisitionType
} from "./requisition-workflow-helpers";
import type {
  BreakdownLinkOption,
  InventoryItemSuggestion,
  InventoryLocationOption,
  InventoryReason,
  MaintenanceLinkOption,
  MaintenancePriority,
  RequisitionCategoryOption,
  RequisitionFormState,
  RequisitionStatus,
  RequisitionSubcategoryOption,
  RequisitionWizardStep,
  VendorSuggestion
} from "./requisition-workflow-types";

interface RequisitionStepProgressProps {
  wizardStep: RequisitionWizardStep;
}

export function RequisitionStepProgress({ wizardStep }: RequisitionStepProgressProps) {
  return (
    <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
      {([
        { step: 1, label: "Request type" },
        { step: 2, label: "Request context" },
        { step: 3, label: "Item details" },
        { step: 4, label: "Review" }
      ] as Array<{ step: RequisitionWizardStep; label: string }>).map((entry) => (
        <div
          key={entry.step}
          className={`rounded-lg border px-2 py-1.5 ${
            wizardStep === entry.step
              ? "border-brand-300 bg-brand-50 text-brand-900"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          <p className="font-semibold">
            {entry.step}. {entry.label}
          </p>
        </div>
      ))}
    </div>
  );
}

interface RequisitionStepOneSectionProps {
  form: RequisitionFormState;
  setForm: Dispatch<SetStateAction<RequisitionFormState>>;
  lockedRequestTypeCard: {
    title: string;
    description: string;
  } | null;
  showMaintenanceTypeOption: boolean;
  allowProjectPurchaseOption: boolean;
  allowInventoryStockUpOption: boolean;
}

export function RequisitionStepOneSection({
  form,
  setForm,
  lockedRequestTypeCard,
  showMaintenanceTypeOption,
  allowProjectPurchaseOption,
  allowInventoryStockUpOption
}: RequisitionStepOneSectionProps) {
  const optionCount =
    (showMaintenanceTypeOption ? 1 : 0) +
    (allowProjectPurchaseOption ? 1 : 0) +
    (allowInventoryStockUpOption ? 1 : 0);
  const gridClass =
    optionCount >= 3
      ? "md:grid-cols-3"
      : optionCount === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-1";

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-900">What is this request for?</p>
      {lockedRequestTypeCard ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-3 text-sm text-brand-900">
          <p className="font-semibold">{lockedRequestTypeCard.title}</p>
          <p className="mt-1 text-xs text-brand-800">
            {lockedRequestTypeCard.description}
          </p>
        </div>
      ) : (
        <div className={`grid gap-2 ${gridClass}`}>
          {showMaintenanceTypeOption && (
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  type: "MAINTENANCE_PURCHASE",
                  liveProjectSpendType: "",
                  clientId: "",
                  projectId: current.projectId,
                  rigId: current.rigId,
                  maintenanceRequestId: current.maintenanceRequestId,
                  breakdownReportId: current.breakdownReportId,
                  stockLocationId: "",
                  inventoryReason: "",
                  maintenancePriority: current.maintenancePriority
                }))
              }
              className={`rounded-lg border px-3 py-3 text-left text-sm ${
                form.type === "MAINTENANCE_PURCHASE"
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <p className="font-semibold">Maintenance-linked Purchase</p>
              <p className="mt-1 text-xs text-slate-600">Available only from a maintenance case.</p>
            </button>
          )}
          {allowProjectPurchaseOption && (
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  type: "LIVE_PROJECT_PURCHASE",
                  liveProjectSpendType: "NORMAL_EXPENSE",
                  projectId: "",
                  clientId: "",
                  rigId: "",
                  maintenanceRequestId: "",
                  breakdownReportId: "",
                  stockLocationId: "",
                  inventoryReason: "",
                  maintenancePriority: ""
                }))
              }
              className={`rounded-lg border px-3 py-3 text-left text-sm ${
                form.type === "LIVE_PROJECT_PURCHASE"
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <p className="font-semibold">Project Purchase</p>
              <p className="mt-1 text-xs text-slate-600">Purchase linked to a project.</p>
            </button>
          )}
          {allowInventoryStockUpOption && (
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  type: "INVENTORY_STOCK_UP",
                  liveProjectSpendType: "",
                  projectId: "",
                  clientId: "",
                  rigId: "",
                  maintenanceRequestId: "",
                  breakdownReportId: "",
                  stockLocationId: "",
                  inventoryReason: "",
                  maintenancePriority: ""
                }))
              }
              className={`rounded-lg border px-3 py-3 text-left text-sm ${
                form.type === "INVENTORY_STOCK_UP"
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <p className="font-semibold">Inventory Stock-up</p>
              <p className="mt-1 text-xs text-slate-600">Replenish stock for warehouse/site use.</p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface RequisitionStepTwoSectionProps {
  form: RequisitionFormState;
  setForm: Dispatch<SetStateAction<RequisitionFormState>>;
  rigs: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string; assignedRigId?: string | null }>;
  hasBreakdownEntryContext: boolean;
  breakdownOptions: BreakdownLinkOption[];
  maintenanceOptions: MaintenanceLinkOption[];
  maintenanceLoading: boolean;
  locationOptions: InventoryLocationOption[];
  lockProjectContext: boolean;
  lockedProjectName: string;
  derivedClientName: string;
  derivedRigName: string;
  onVendorFocus: () => void;
  closeVendorSuggestions: () => void;
  handleVendorNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  showVendorSuggestions: boolean;
  vendorSuggestionLoading: boolean;
  creatingVendor: boolean;
  vendorSuggestions: VendorSuggestion[];
  activeVendorSuggestionIndex: number;
  setActiveVendorSuggestionIndex: Dispatch<SetStateAction<number>>;
  applyVendorSuggestion: (suggestion: VendorSuggestion) => void;
  showCreateVendorOption: boolean;
  createVendorFromInput: () => Promise<void>;
}

export function RequisitionStepTwoSection({
  form,
  setForm,
  rigs,
  projects,
  hasBreakdownEntryContext,
  breakdownOptions,
  maintenanceOptions,
  maintenanceLoading,
  locationOptions,
  lockProjectContext,
  lockedProjectName,
  derivedClientName,
  derivedRigName,
  onVendorFocus,
  closeVendorSuggestions,
  handleVendorNameKeyDown,
  showVendorSuggestions,
  vendorSuggestionLoading,
  creatingVendor,
  vendorSuggestions,
  activeVendorSuggestionIndex,
  setActiveVendorSuggestionIndex,
  applyVendorSuggestion,
  showCreateVendorOption,
  createVendorFromInput
}: RequisitionStepTwoSectionProps) {
  return (
    <div className="space-y-3">
      {form.type === "MAINTENANCE_PURCHASE" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectInput
            label="Rig"
            value={form.rigId}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                rigId: value,
                maintenanceRequestId: current.rigId === value ? current.maintenanceRequestId : ""
              }))
            }
            options={[
              { value: "", label: "Select rig" },
              ...rigs.map((rig) => ({ value: rig.id, label: rig.name }))
            ]}
          />
          <VendorTypeaheadInput
            value={form.requestedVendorName}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                requestedVendorName: value,
                requestedVendorId: ""
              }))
            }
            onFocus={onVendorFocus}
            onBlur={() => {
              window.setTimeout(() => closeVendorSuggestions(), 120);
            }}
            onKeyDown={handleVendorNameKeyDown}
            showSuggestions={showVendorSuggestions}
            loading={vendorSuggestionLoading || creatingVendor}
            suggestions={vendorSuggestions}
            activeSuggestionIndex={activeVendorSuggestionIndex}
            onSuggestionHover={setActiveVendorSuggestionIndex}
            onSuggestionSelect={applyVendorSuggestion}
            showCreateOption={showCreateVendorOption}
            onCreateOptionSelect={() => {
              void createVendorFromInput();
            }}
          />
          {form.rigId && maintenanceOptions.length === 1 && !maintenanceLoading ? (
            <label className="text-sm text-ink-700">
              Linked maintenance case
              <input
                value={`${maintenanceOptions[0].requestCode} (auto-linked)`}
                readOnly
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </label>
          ) : (
            <SelectInput
              label="Linked maintenance case"
              value={form.maintenanceRequestId}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  maintenanceRequestId: value
                }))
              }
              disabled={!form.rigId || maintenanceLoading}
              options={[
                {
                  value: "",
                  label:
                    !form.rigId
                      ? "Select rig first"
                      : maintenanceLoading
                        ? "Loading maintenance requests..."
                        : maintenanceOptions.length > 0
                          ? "Select maintenance case"
                          : "No open maintenance case"
                },
                ...maintenanceOptions.map((entry) => ({
                  value: entry.id,
                  label: `${entry.requestCode} - ${entry.issueDescription || "Maintenance case"}`
                }))
              ]}
            />
          )}
          <SelectInput
            label="Priority"
            value={form.maintenancePriority}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                maintenancePriority: (value as MaintenancePriority | "") || ""
              }))
            }
            options={[
              { value: "", label: "No priority" },
              { value: "LOW", label: "Low" },
              { value: "MEDIUM", label: "Medium" },
              { value: "HIGH", label: "High" }
            ]}
          />
          <TextInput
            label="Short reason"
            value={form.shortReason}
            onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
          />
          {form.rigId && !maintenanceLoading && maintenanceOptions.length === 0 && (
            <p className="md:col-span-2 xl:col-span-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No open maintenance case exists for this rig. Report maintenance first, then create a
              maintenance-linked purchase request.
            </p>
          )}
          {form.rigId &&
            !maintenanceLoading &&
            maintenanceOptions.length > 1 &&
            !form.maintenanceRequestId && (
              <p className="md:col-span-2 xl:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Multiple open maintenance cases found. Select the case this purchase belongs to.
              </p>
            )}
        </div>
      )}

      {form.type === "LIVE_PROJECT_PURCHASE" && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {lockProjectContext ? (
              <label className="text-sm text-ink-700">
                Project
                <input
                  value={lockedProjectName || "Locked project"}
                  readOnly
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
            ) : (
              <SelectInput
                label="Project"
                value={form.projectId}
                onChange={(value) => {
                  const nextProject = projects.find((project) => project.id === value);
                  setForm((current) => ({
                    ...current,
                    projectId: value,
                    clientId: nextProject?.clientId || "",
                    rigId: nextProject?.assignedRigId || "",
                    breakdownReportId: current.projectId === value ? current.breakdownReportId : ""
                  }));
                }}
                disabled={
                  hasBreakdownEntryContext && Boolean(form.breakdownReportId) && Boolean(form.projectId)
                }
                options={[
                  { value: "", label: "Select project" },
                  ...projects.map((project) => ({ value: project.id, label: project.name }))
                ]}
              />
            )}
            <VendorTypeaheadInput
              value={form.requestedVendorName}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  requestedVendorName: value,
                  requestedVendorId: ""
                }))
              }
              onFocus={onVendorFocus}
              onBlur={() => {
                window.setTimeout(() => closeVendorSuggestions(), 120);
              }}
              onKeyDown={handleVendorNameKeyDown}
              showSuggestions={showVendorSuggestions}
              loading={vendorSuggestionLoading || creatingVendor}
              suggestions={vendorSuggestions}
              activeSuggestionIndex={activeVendorSuggestionIndex}
              onSuggestionHover={setActiveVendorSuggestionIndex}
              onSuggestionSelect={applyVendorSuggestion}
              showCreateOption={showCreateVendorOption}
              onCreateOptionSelect={() => {
                void createVendorFromInput();
              }}
            />
            {hasBreakdownEntryContext ? (
              <label className="text-sm text-ink-700">
                Linked breakdown
                <input
                  value={
                    breakdownOptions.find((entry) => entry.id === form.breakdownReportId)
                      ? `${breakdownOptions.find((entry) => entry.id === form.breakdownReportId)?.title} (context linked)`
                      : form.breakdownReportId || "Loading breakdown context..."
                  }
                  readOnly
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
            ) : null}
            <TextInput
              label="Short reason"
              value={form.shortReason}
              onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
            />
          </div>
          {form.projectId && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Client context:</span> {derivedClientName}
              </p>
              <p>
                <span className="font-semibold">Rig context:</span> {derivedRigName}
              </p>
              {form.breakdownReportId && (
                <p>
                  <span className="font-semibold">Linked breakdown:</span>{" "}
                  {breakdownOptions.find((entry) => entry.id === form.breakdownReportId)?.title ||
                    form.breakdownReportId}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {form.type === "INVENTORY_STOCK_UP" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {locationOptions.length > 0 ? (
            <SelectInput
              label="Warehouse / Stock Location"
              value={form.stockLocationId}
              onChange={(value) => setForm((current) => ({ ...current, stockLocationId: value }))}
              options={[
                { value: "", label: "Select location" },
                ...locationOptions.map((location) => ({
                  value: location.id,
                  label: location.name
                }))
              ]}
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              No active stock location is configured yet.
            </div>
          )}
          <VendorTypeaheadInput
            value={form.requestedVendorName}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                requestedVendorName: value,
                requestedVendorId: ""
              }))
            }
            onFocus={onVendorFocus}
            onBlur={() => {
              window.setTimeout(() => closeVendorSuggestions(), 120);
            }}
            onKeyDown={handleVendorNameKeyDown}
            showSuggestions={showVendorSuggestions}
            loading={vendorSuggestionLoading || creatingVendor}
            suggestions={vendorSuggestions}
            activeSuggestionIndex={activeVendorSuggestionIndex}
            onSuggestionHover={setActiveVendorSuggestionIndex}
            onSuggestionSelect={applyVendorSuggestion}
            showCreateOption={showCreateVendorOption}
            onCreateOptionSelect={() => {
              void createVendorFromInput();
            }}
          />
          <SelectInput
            label="Reason"
            value={form.inventoryReason}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                inventoryReason: (value as InventoryReason | "") || ""
              }))
            }
            options={[
              { value: "", label: "No reason" },
              { value: "LOW_STOCK", label: "Low stock" },
              { value: "RESTOCK", label: "Restock" },
              { value: "EMERGENCY", label: "Emergency" },
              { value: "OTHER", label: "Other" }
            ]}
          />
          <TextInput
            label="Short reason"
            value={form.shortReason}
            onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
          />
        </div>
      )}
    </div>
  );
}

interface RequisitionStepThreeSectionProps {
  form: RequisitionFormState;
  setForm: Dispatch<SetStateAction<RequisitionFormState>>;
  onItemNameFocus: () => void;
  closeItemSuggestions: () => void;
  handleItemNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  showItemSuggestions: boolean;
  inventorySuggestionLoading: boolean;
  inventorySuggestions: InventoryItemSuggestion[];
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  applyInventorySuggestion: (suggestion: InventoryItemSuggestion) => void;
  unitOptions: string[];
  estimatedTotal: number;
  categoryOptions: RequisitionCategoryOption[];
  setupLoading: boolean;
  applyCategorySelection: (categoryId: string) => void;
  onSubcategoryFocus: () => void;
  closeSubcategorySuggestions: () => void;
  handleSubcategoryKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  showSubcategorySuggestions: boolean;
  filteredSubcategorySuggestions: RequisitionSubcategoryOption[];
  activeSubcategorySuggestionIndex: number;
  setActiveSubcategorySuggestionIndex: Dispatch<SetStateAction<number>>;
  applySubcategorySuggestion: (subcategory: RequisitionSubcategoryOption) => void;
  showCreateSubcategoryOption: boolean;
  createSubcategoryFromInput: () => Promise<void>;
  creatingSubcategory: boolean;
}

export function RequisitionStepThreeSection({
  form,
  setForm,
  onItemNameFocus,
  closeItemSuggestions,
  handleItemNameKeyDown,
  showItemSuggestions,
  inventorySuggestionLoading,
  inventorySuggestions,
  activeSuggestionIndex,
  setActiveSuggestionIndex,
  applyInventorySuggestion,
  unitOptions,
  estimatedTotal,
  categoryOptions,
  setupLoading,
  applyCategorySelection,
  onSubcategoryFocus,
  closeSubcategorySuggestions,
  handleSubcategoryKeyDown,
  showSubcategorySuggestions,
  filteredSubcategorySuggestions,
  activeSubcategorySuggestionIndex,
  setActiveSubcategorySuggestionIndex,
  applySubcategorySuggestion,
  showCreateSubcategoryOption,
  createSubcategoryFromInput,
  creatingSubcategory
}: RequisitionStepThreeSectionProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Item name</span>
          <div className="relative">
            <input
              value={form.itemName}
              onChange={(event) =>
                setForm((current) => ({ ...current, itemName: event.target.value }))
              }
              onFocus={() => {
                onItemNameFocus();
                setActiveSuggestionIndex(-1);
              }}
              onBlur={() => {
                window.setTimeout(() => closeItemSuggestions(), 120);
              }}
              onKeyDown={handleItemNameKeyDown}
              aria-haspopup="listbox"
              aria-controls="requisition-item-suggestion-list"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            />
            {showItemSuggestions && (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {inventorySuggestionLoading ? (
                  <p className="px-3 py-2 text-xs text-slate-600">Searching inventory...</p>
                ) : inventorySuggestions.length > 0 ? (
                  <ul
                    id="requisition-item-suggestion-list"
                    role="listbox"
                    className="max-h-52 overflow-auto py-1.5"
                  >
                    {inventorySuggestions.map((suggestion, index) => (
                      <li key={suggestion.id}>
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyInventorySuggestion(suggestion);
                          }}
                          onMouseEnter={() => setActiveSuggestionIndex(index)}
                          className={`w-full px-3 py-2 text-left ${
                            activeSuggestionIndex === index
                              ? "bg-slate-100"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                          <p className="text-xs text-slate-600">
                            {suggestion.sku ? `${suggestion.sku} • ` : ""}
                            {suggestion.category}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-xs text-slate-600">No matching inventory item.</p>
                )}
              </div>
            )}
          </div>
        </label>
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Quantity</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.quantity}
            onChange={(event) =>
              setForm((current) => ({ ...current, quantity: event.target.value }))
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Unit</span>
          <input
            list="requisition-unit-options"
            value={form.unit}
            onChange={(event) =>
              setForm((current) => ({ ...current, unit: event.target.value }))
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
          <datalist id="requisition-unit-options">
            {unitOptions.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </label>
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Estimated unit cost</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.estimatedUnitCost}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                estimatedUnitCost: event.target.value
              }))
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Category</span>
          <select
            value={form.categoryId}
            onChange={(event) => applyCategorySelection(event.target.value)}
            disabled={setupLoading || categoryOptions.length === 0}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
          >
            <option value="">
              {setupLoading
                ? "Loading categories..."
                : categoryOptions.length === 0
                  ? "No setup categories"
                  : "Select category"}
            </option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {!setupLoading && categoryOptions.length === 0 && (
            <p className="mt-1 text-xs text-amber-800">
              No categories are configured in setup yet. Add setup categories before submitting
              requests.
            </p>
          )}
        </label>
        <label className="text-sm text-ink-700">
          <span className="mb-1 block">Subcategory</span>
          <div className="relative">
            <input
              disabled={!form.categoryId}
              value={form.subcategory}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  subcategory: event.target.value,
                  subcategoryId: ""
                }));
                setActiveSubcategorySuggestionIndex(-1);
              }}
              onFocus={() => {
                onSubcategoryFocus();
                setActiveSubcategorySuggestionIndex(-1);
              }}
              onBlur={() => {
                window.setTimeout(() => closeSubcategorySuggestions(), 120);
              }}
              onKeyDown={handleSubcategoryKeyDown}
              aria-haspopup="listbox"
              aria-controls="requisition-subcategory-suggestion-list"
              placeholder={form.categoryId ? "Search or enter subcategory" : "Select category first"}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
            />
            {showSubcategorySuggestions && (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {filteredSubcategorySuggestions.length > 0 ? (
                  <ul
                    id="requisition-subcategory-suggestion-list"
                    role="listbox"
                    className="max-h-48 overflow-auto py-1.5"
                  >
                    {filteredSubcategorySuggestions.map((subcategory, index) => (
                      <li key={subcategory.id}>
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applySubcategorySuggestion(subcategory);
                          }}
                          onMouseEnter={() => setActiveSubcategorySuggestionIndex(index)}
                          className={`w-full px-3 py-2 text-left text-sm ${
                            activeSubcategorySuggestionIndex === index
                              ? "bg-slate-100 text-slate-900"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {subcategory.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : showCreateSubcategoryOption ? (
                  <div className="py-1.5">
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void createSubcategoryFromInput();
                      }}
                      onMouseEnter={() => setActiveSubcategorySuggestionIndex(0)}
                      className={`w-full px-3 py-2 text-left text-sm ${
                        activeSubcategorySuggestionIndex === 0
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {creatingSubcategory
                        ? "Creating subcategory..."
                        : `+ Create "${form.subcategory.trim()}"`}
                    </button>
                  </div>
                ) : (
                  <p className="px-3 py-2 text-xs text-slate-600">No matching subcategory.</p>
                )}
              </div>
            )}
          </div>
        </label>
      </div>
      <label className="text-sm text-ink-700">
        <span className="mb-1 block">Optional note</span>
        <textarea
          value={form.itemNote}
          onChange={(event) =>
            setForm((current) => ({ ...current, itemNote: event.target.value }))
          }
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
          rows={2}
        />
      </label>
      <p className="text-sm text-slate-700">
        Estimated cost: <span className="font-semibold">{formatCurrency(estimatedTotal)}</span>
      </p>
    </div>
  );
}

interface RequisitionStepFourSectionProps {
  form: RequisitionFormState;
  rigs: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  selectedLocationName: string;
  derivedClientName: string;
  derivedRigName: string;
  breakdownOptions: BreakdownLinkOption[];
  maintenanceOptions: MaintenanceLinkOption[];
  estimatedTotal: number;
}

export function RequisitionStepFourSection({
  form,
  rigs,
  projects,
  selectedLocationName,
  derivedClientName,
  derivedRigName,
  breakdownOptions,
  maintenanceOptions,
  estimatedTotal
}: RequisitionStepFourSectionProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <p>
          <span className="font-semibold">Request type:</span>{" "}
          {formatRequisitionType(form.type, {
            breakdownLinked:
              form.type === "LIVE_PROJECT_PURCHASE" && Boolean(form.breakdownReportId)
          })}
        </p>
        <p>
          <span className="font-semibold">Context:</span>{" "}
          {form.type === "MAINTENANCE_PURCHASE"
            ? rigs.find((rig) => rig.id === form.rigId)?.name || "-"
            : form.type === "LIVE_PROJECT_PURCHASE"
              ? projects.find((project) => project.id === form.projectId)?.name || "-"
              : selectedLocationName || "-"}
        </p>
        {form.type === "LIVE_PROJECT_PURCHASE" && (
          <>
            <p>
              <span className="font-semibold">Client context:</span> {derivedClientName}
            </p>
            <p>
              <span className="font-semibold">Rig context:</span> {derivedRigName}
            </p>
            {form.breakdownReportId && (
              <p>
                <span className="font-semibold">Linked breakdown:</span>{" "}
                {breakdownOptions.find((entry) => entry.id === form.breakdownReportId)?.title ||
                  form.breakdownReportId}
              </p>
            )}
          </>
        )}
        {form.type === "MAINTENANCE_PURCHASE" && form.maintenancePriority && (
          <p>
            <span className="font-semibold">Priority:</span>{" "}
            {formatMaintenancePriorityLabel(form.maintenancePriority)}
          </p>
        )}
        {form.type === "MAINTENANCE_PURCHASE" && form.maintenanceRequestId && (
          <p>
            <span className="font-semibold">Linked maintenance:</span>{" "}
            {maintenanceOptions.find((entry) => entry.id === form.maintenanceRequestId)?.requestCode ||
              form.maintenanceRequestId}
          </p>
        )}
        {form.type === "INVENTORY_STOCK_UP" && form.inventoryReason && (
          <p>
            <span className="font-semibold">Reason:</span>{" "}
            {formatInventoryReasonLabel(form.inventoryReason)}
          </p>
        )}
        {form.shortReason.trim() && (
          <p>
            <span className="font-semibold">Reason:</span> {form.shortReason.trim()}
          </p>
        )}
        {form.requestedVendorName.trim() && (
          <p>
            <span className="font-semibold">Vendor:</span> {form.requestedVendorName.trim()}
          </p>
        )}
        <p>
          <span className="font-semibold">Item:</span> {form.itemName.trim() || "-"}
        </p>
        <p>
          <span className="font-semibold">Quantity:</span> {form.quantity || "-"} {form.unit || ""}
        </p>
        <p>
          <span className="font-semibold">Estimated unit cost:</span>{" "}
          {form.estimatedUnitCost ? formatCurrency(Number(form.estimatedUnitCost) || 0) : "-"}
        </p>
        <p>
          <span className="font-semibold">Category:</span> {form.category || "-"}
          {form.subcategory ? ` / ${form.subcategory}` : ""}
        </p>
        {form.itemNote.trim() && (
          <p>
            <span className="font-semibold">Item note:</span> {form.itemNote.trim()}
          </p>
        )}
        <p>
          <span className="font-semibold">Estimated cost:</span> {formatCurrency(estimatedTotal)}
        </p>
      </div>
    </div>
  );
}

interface RequisitionWizardFooterActionsProps {
  wizardStep: RequisitionWizardStep;
  minimumWizardStep: RequisitionWizardStep;
  currentStepError: string | null;
  saving: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
}

export function RequisitionWizardFooterActions({
  wizardStep,
  minimumWizardStep,
  currentStepError,
  saving,
  onBack,
  onContinue,
  onSubmit
}: RequisitionWizardFooterActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
      {wizardStep > minimumWizardStep && (
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          Back
        </button>
      )}
      {wizardStep < 4 ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={Boolean(currentStepError)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Continue
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Submitting..." : "Submit request"}
        </button>
      )}
      {wizardStep < 4 && currentStepError && <p className="text-xs text-amber-800">{currentStepError}</p>}
    </div>
  );
}

interface RequisitionHistorySectionProps {
  loading: boolean;
  rowsCount: number;
  pendingCount: number;
  approvedReadyCount: number;
  completedCount: number;
  statusFilter: RequisitionStatus | "all";
  setStatusFilter: Dispatch<SetStateAction<RequisitionStatus | "all">>;
  requisitionRows: Array<Array<ReactNode>>;
}

export function RequisitionHistorySection({
  loading,
  rowsCount,
  pendingCount,
  approvedReadyCount,
  completedCount,
  statusFilter,
  setStatusFilter,
  requisitionRows
}: RequisitionHistorySectionProps) {
  return (
    <details open className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
        Requisition History
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
            Pending approval: {pendingCount}
          </span>
          <span className="rounded-full border border-indigo-300 bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
            Approved, awaiting receipt: {approvedReadyCount}
          </span>
          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
            Posted cost complete: {completedCount}
          </span>
          <label className="ml-auto flex items-center gap-2">
            <span className="uppercase tracking-wide text-slate-500">Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value === "all" ? "all" : (event.target.value as RequisitionStatus)
                )
              }
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            >
              <option value="all">All</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="PURCHASE_COMPLETED">Purchase completed</option>
            </select>
          </label>
        </div>
        {loading ? (
          <p className="text-sm text-slate-600">Loading requisitions...</p>
        ) : rowsCount === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            No requisitions found for the selected filters.
          </p>
        ) : (
          <DataTable
            columns={["Requisition", "Status", "Summary", "Estimated", "Submitted", "Actions"]}
            rows={requisitionRows}
          />
        )}
      </div>
    </details>
  );
}
