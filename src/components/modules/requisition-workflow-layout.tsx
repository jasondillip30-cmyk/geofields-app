"use client";

import { Dispatch, KeyboardEvent, SetStateAction } from "react";

import { Card } from "@/components/ui/card";
import {
  RequisitionHistorySection,
  RequisitionStepFourSection,
  RequisitionStepOneSection,
  RequisitionStepProgress,
  RequisitionStepThreeSection,
  RequisitionStepTwoSection,
  RequisitionWizardFooterActions
} from "./requisition-workflow-sections";
import type {
  BreakdownLinkOption,
  InventoryItemSuggestion,
  InventoryLocationOption,
  MaintenanceLinkOption,
  RequisitionCategoryOption,
  RequisitionFormState,
  RequisitionRow,
  RequisitionStatus,
  RequisitionSubcategoryOption,
  RequisitionWizardStep,
  RequisitionWorkflowCardProps,
  VendorSuggestion
} from "./requisition-workflow-types";

interface RequisitionWizardAutocompleteState {
  activeSuggestionIndex: number;
  activeSubcategorySuggestionIndex: number;
  activeVendorSuggestionIndex: number;
  applyCategorySelection: (categoryId: string) => void;
  applyInventorySuggestion: (suggestion: InventoryItemSuggestion) => void;
  applySubcategorySuggestion: (subcategory: RequisitionSubcategoryOption) => void;
  applyVendorSuggestion: (suggestion: VendorSuggestion) => void;
  closeItemSuggestions: () => void;
  closeSubcategorySuggestions: () => void;
  closeVendorSuggestions: () => void;
  createSubcategoryFromInput: () => Promise<void>;
  createVendorFromInput: () => Promise<void>;
  creatingSubcategory: boolean;
  creatingVendor: boolean;
  filteredSubcategorySuggestions: RequisitionSubcategoryOption[];
  handleItemNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  handleSubcategoryKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  handleVendorNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inventorySuggestionLoading: boolean;
  inventorySuggestions: InventoryItemSuggestion[];
  setActiveSubcategorySuggestionIndex: Dispatch<SetStateAction<number>>;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  setActiveVendorSuggestionIndex: Dispatch<SetStateAction<number>>;
  setItemNameFocused: Dispatch<SetStateAction<boolean>>;
  setSubcategoryFocused: Dispatch<SetStateAction<boolean>>;
  setVendorFocused: Dispatch<SetStateAction<boolean>>;
  showCreateSubcategoryOption: boolean;
  showCreateVendorOption: boolean;
  showItemSuggestions: boolean;
  showSubcategorySuggestions: boolean;
  showVendorSuggestions: boolean;
  vendorSuggestionLoading: boolean;
  vendorSuggestions: VendorSuggestion[];
}

interface RequisitionWorkflowLayoutProps {
  notice: string | null;
  onDismissNotice: () => void;
  error: string | null;
  requestCardTitle: string;
  wizardStep: RequisitionWizardStep;
  minimumWizardStep: RequisitionWizardStep;
  currentStepError: string | null;
  saving: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
  form: RequisitionFormState;
  setForm: Dispatch<SetStateAction<RequisitionFormState>>;
  lockedRequestTypeCard: {
    title: string;
    description: string;
  } | null;
  showMaintenanceTypeOption: boolean;
  allowProjectPurchaseOption: boolean;
  allowInventoryStockUpOption: boolean;
  rigs: RequisitionWorkflowCardProps["rigs"];
  projects: RequisitionWorkflowCardProps["projects"];
  hasBreakdownEntryContext: boolean;
  breakdownOptions: BreakdownLinkOption[];
  maintenanceOptions: MaintenanceLinkOption[];
  maintenanceLoading: boolean;
  locationOptions: InventoryLocationOption[];
  lockProjectContext: boolean;
  lockedProjectName: string;
  derivedClientName: string;
  derivedRigName: string;
  selectedLocationName: string;
  estimatedTotal: number;
  setupLoading: boolean;
  categoryOptions: RequisitionCategoryOption[];
  unitOptions: string[];
  hasStartedRequest: boolean;
  loading: boolean;
  rows: RequisitionRow[];
  pendingCount: number;
  approvedReadyCount: number;
  completedCount: number;
  statusFilter: RequisitionStatus | "all";
  setStatusFilter: Dispatch<SetStateAction<RequisitionStatus | "all">>;
  requisitionRows: Array<Array<React.ReactNode>>;
  autocomplete: RequisitionWizardAutocompleteState;
}

export function RequisitionWorkflowLayout({
  notice,
  onDismissNotice,
  error,
  requestCardTitle,
  wizardStep,
  minimumWizardStep,
  currentStepError,
  saving,
  onBack,
  onContinue,
  onSubmit,
  form,
  setForm,
  lockedRequestTypeCard,
  showMaintenanceTypeOption,
  allowProjectPurchaseOption,
  allowInventoryStockUpOption,
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
  selectedLocationName,
  estimatedTotal,
  setupLoading,
  categoryOptions,
  unitOptions,
  hasStartedRequest,
  loading,
  rows,
  pendingCount,
  approvedReadyCount,
  completedCount,
  statusFilter,
  setStatusFilter,
  requisitionRows,
  autocomplete
}: RequisitionWorkflowLayoutProps) {
  return (
    <section id="expenses-requisition-workflow" className="space-y-4">
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3.5 py-2.5 text-sm text-emerald-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            <p className="font-medium">{notice}</p>
          </div>
          <button
            type="button"
            onClick={onDismissNotice}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <Card title={requestCardTitle}>
        <RequisitionStepProgress wizardStep={wizardStep} />

        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
          className="space-y-3"
        >
          {wizardStep === 1 && (
            <RequisitionStepOneSection
              form={form}
              setForm={setForm}
              lockedRequestTypeCard={lockedRequestTypeCard}
              showMaintenanceTypeOption={showMaintenanceTypeOption}
              allowProjectPurchaseOption={allowProjectPurchaseOption}
              allowInventoryStockUpOption={allowInventoryStockUpOption}
            />
          )}

          {wizardStep === 2 && (
            <RequisitionStepTwoSection
              form={form}
              setForm={setForm}
              rigs={rigs}
              projects={projects}
              hasBreakdownEntryContext={hasBreakdownEntryContext}
              breakdownOptions={breakdownOptions}
              maintenanceOptions={maintenanceOptions}
              maintenanceLoading={maintenanceLoading}
              locationOptions={locationOptions}
              lockProjectContext={lockProjectContext}
              lockedProjectName={lockedProjectName}
              derivedClientName={derivedClientName}
              derivedRigName={derivedRigName}
              onVendorFocus={() => autocomplete.setVendorFocused(true)}
              closeVendorSuggestions={autocomplete.closeVendorSuggestions}
              handleVendorNameKeyDown={autocomplete.handleVendorNameKeyDown}
              showVendorSuggestions={autocomplete.showVendorSuggestions}
              vendorSuggestionLoading={autocomplete.vendorSuggestionLoading}
              creatingVendor={autocomplete.creatingVendor}
              vendorSuggestions={autocomplete.vendorSuggestions}
              activeVendorSuggestionIndex={autocomplete.activeVendorSuggestionIndex}
              setActiveVendorSuggestionIndex={autocomplete.setActiveVendorSuggestionIndex}
              applyVendorSuggestion={autocomplete.applyVendorSuggestion}
              showCreateVendorOption={autocomplete.showCreateVendorOption}
              createVendorFromInput={autocomplete.createVendorFromInput}
            />
          )}

          {wizardStep === 3 && (
            <RequisitionStepThreeSection
              form={form}
              setForm={setForm}
              onItemNameFocus={() => autocomplete.setItemNameFocused(true)}
              closeItemSuggestions={autocomplete.closeItemSuggestions}
              handleItemNameKeyDown={autocomplete.handleItemNameKeyDown}
              showItemSuggestions={autocomplete.showItemSuggestions}
              inventorySuggestionLoading={autocomplete.inventorySuggestionLoading}
              inventorySuggestions={autocomplete.inventorySuggestions}
              activeSuggestionIndex={autocomplete.activeSuggestionIndex}
              setActiveSuggestionIndex={autocomplete.setActiveSuggestionIndex}
              applyInventorySuggestion={autocomplete.applyInventorySuggestion}
              unitOptions={unitOptions}
              estimatedTotal={estimatedTotal}
              categoryOptions={categoryOptions}
              setupLoading={setupLoading}
              applyCategorySelection={autocomplete.applyCategorySelection}
              onSubcategoryFocus={() => autocomplete.setSubcategoryFocused(true)}
              closeSubcategorySuggestions={autocomplete.closeSubcategorySuggestions}
              handleSubcategoryKeyDown={autocomplete.handleSubcategoryKeyDown}
              showSubcategorySuggestions={autocomplete.showSubcategorySuggestions}
              filteredSubcategorySuggestions={autocomplete.filteredSubcategorySuggestions}
              activeSubcategorySuggestionIndex={autocomplete.activeSubcategorySuggestionIndex}
              setActiveSubcategorySuggestionIndex={autocomplete.setActiveSubcategorySuggestionIndex}
              applySubcategorySuggestion={autocomplete.applySubcategorySuggestion}
              showCreateSubcategoryOption={autocomplete.showCreateSubcategoryOption}
              createSubcategoryFromInput={autocomplete.createSubcategoryFromInput}
              creatingSubcategory={autocomplete.creatingSubcategory}
            />
          )}

          {wizardStep === 4 && (
            <RequisitionStepFourSection
              form={form}
              rigs={rigs}
              projects={projects}
              selectedLocationName={selectedLocationName}
              derivedClientName={derivedClientName}
              derivedRigName={derivedRigName}
              breakdownOptions={breakdownOptions}
              maintenanceOptions={maintenanceOptions}
              estimatedTotal={estimatedTotal}
            />
          )}

          <RequisitionWizardFooterActions
            wizardStep={wizardStep}
            minimumWizardStep={minimumWizardStep}
            currentStepError={currentStepError}
            saving={saving}
            onBack={onBack}
            onContinue={onContinue}
            onSubmit={onSubmit}
          />
        </form>
      </Card>

      {!hasStartedRequest && (
        <RequisitionHistorySection
          loading={loading}
          rowsCount={rows.length}
          pendingCount={pendingCount}
          approvedReadyCount={approvedReadyCount}
          completedCount={completedCount}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          requisitionRows={requisitionRows}
        />
      )}
    </section>
  );
}
