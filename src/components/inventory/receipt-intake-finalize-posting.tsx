"use client";

import type { Dispatch, SetStateAction } from "react";

import { InputField, SelectField } from "@/components/inventory/receipt-intake-panel-fields";
import {
  formatFieldSource,
  formatQrContentType,
  formatQrDecodeStatus,
  formatQrLookupStatus,
  formatQrParseStatus,
  formatReadability,
  formatScanFailureStage,
  readabilityBadgeClass
} from "@/components/inventory/receipt-intake-scan-utils";
import {
  calmMessage
} from "@/components/inventory/receipt-intake-save-readiness";
import {
  normalizeReceiptWorkflowChoice,
  resolveExpenseOnlyCategory
} from "@/components/inventory/receipt-intake-workflow-utils";
import type {
  IntakeAllocationStatus,
  ReceiptIntakePanelProps,
  ReceiptWorkflowChoice,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";

const receiptFieldLabels: Array<{ key: keyof ReviewState["fieldConfidence"]; label: string }> = [
  { key: "supplierName", label: "Supplier" },
  { key: "tin", label: "TIN" },
  { key: "vrn", label: "VRN" },
  { key: "serialNumber", label: "Serial" },
  { key: "receiptNumber", label: "Receipt #" },
  { key: "verificationCode", label: "Verify Code" },
  { key: "receiptDate", label: "Date" },
  { key: "receiptTime", label: "Time" },
  { key: "subtotal", label: "Subtotal" },
  { key: "tax", label: "Tax" },
  { key: "total", label: "Total" },
  { key: "paymentMethod", label: "Payment" },
  { key: "taxOffice", label: "Tax Office" },
  { key: "itemCount", label: "Item Count" }
];

interface ReceiptIntakeFinalizePostingProps {
  review: ReviewState;
  mismatchDetected: boolean;
  showFinalizePostingOptions: boolean;
  setShowFinalizePostingOptions: Dispatch<SetStateAction<boolean>>;
  activeWorkflowChoice: ReceiptWorkflowChoice | "";
  applyWorkflowChoice: (choice: ReceiptWorkflowChoice) => void;
  requisitionContextLocked: boolean;
  suppliers: ReceiptIntakePanelProps["suppliers"];
  clients: ReceiptIntakePanelProps["clients"];
  projects: ReceiptIntakePanelProps["projects"];
  filteredProjects: ReceiptIntakePanelProps["projects"];
  rigs: ReceiptIntakePanelProps["rigs"];
  maintenanceRequests: ReceiptIntakePanelProps["maintenanceRequests"];
  locations: ReceiptIntakePanelProps["locations"];
  setReview: Dispatch<SetStateAction<ReviewState | null>>;
  requiresAllocation: boolean;
  allocationPreview: IntakeAllocationStatus | null;
  showDeveloperDebugUi: boolean;
  showTechnicalDetails: boolean;
  setShowTechnicalDetails: Dispatch<SetStateAction<boolean>>;
  debugMode: boolean;
  showMismatchInventoryHandling: boolean;
  setFollowUpStage: Dispatch<SetStateAction<"SCAN" | "REVIEW" | "FINALIZE">>;
  handleCommit: () => Promise<void>;
  saving: boolean;
  canManage: boolean;
  resetScanSessionState: () => void;
}

export function ReceiptIntakeFinalizePosting({
  review,
  mismatchDetected,
  showFinalizePostingOptions,
  activeWorkflowChoice,
  applyWorkflowChoice,
  requisitionContextLocked,
  suppliers,
  clients,
  projects,
  filteredProjects,
  rigs,
  maintenanceRequests,
  locations,
  setReview,
  requiresAllocation,
  allocationPreview,
  showDeveloperDebugUi,
  showTechnicalDetails,
  setShowTechnicalDetails,
  debugMode,
  showMismatchInventoryHandling,
  setFollowUpStage,
  handleCommit,
  saving,
  canManage,
  resetScanSessionState
}: ReceiptIntakeFinalizePostingProps) {
  return (
    <>
      {(!mismatchDetected || showFinalizePostingOptions) && (
        <>
          <div className="rounded-lg border border-slate-200/55 bg-white px-2.5 py-1.5">
            <p className="text-sm font-semibold text-slate-800">Posting Details</p>
            <div className="mt-1.5 grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-ink-700">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Supplier (existing)</span>
                <select
                  value={review.supplierId}
                  onChange={(event) =>
                    setReview((current) =>
                      current
                        ? {
                            ...current,
                            supplierId: event.target.value,
                            supplierName:
                              suppliers.find((supplier) => supplier.id === event.target.value)?.name || current.supplierName
                          }
                        : current
                    )
                  }
                  className="w-full rounded-lg border border-slate-200/70 px-3 py-1.5 text-sm"
                >
                  <option value="">No supplier match</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <InputField
                label="Supplier Name"
                value={review.supplierName}
                onChange={(value) =>
                  setReview((current) => (current ? { ...current, supplierName: value, supplierId: "" } : current))
                }
              />
              {!mismatchDetected && (
                <InputField
                  label="Receipt Number"
                  value={review.receiptNumber}
                  onChange={(value) => setReview((current) => (current ? { ...current, receiptNumber: value } : current))}
                />
              )}
              {!mismatchDetected && (
                <InputField
                  label="Receipt Date"
                  type="date"
                  value={review.receiptDate}
                  onChange={(value) => setReview((current) => (current ? { ...current, receiptDate: value } : current))}
                />
              )}
              <InputField
                label="Subtotal"
                type="number"
                value={review.subtotal}
                onChange={(value) => setReview((current) => (current ? { ...current, subtotal: value } : current))}
              />
              <InputField
                label="Tax / VAT"
                type="number"
                value={review.tax}
                onChange={(value) => setReview((current) => (current ? { ...current, tax: value } : current))}
              />
              <InputField
                label="Total"
                type="number"
                value={review.total}
                onChange={(value) => setReview((current) => (current ? { ...current, total: value } : current))}
              />
              <InputField
                label="Currency"
                value={review.currency}
                onChange={(value) => setReview((current) => (current ? { ...current, currency: value.toUpperCase() } : current))}
              />
              <SelectField
                label="Workflow Type"
                value={activeWorkflowChoice}
                onChange={(value) => {
                  const normalizedWorkflowChoice = normalizeReceiptWorkflowChoice(value);
                  if (!normalizedWorkflowChoice) {
                    return;
                  }
                  applyWorkflowChoice(normalizedWorkflowChoice);
                }}
                disabled={requisitionContextLocked}
                options={[
                  { value: "PROJECT_PURCHASE", label: "Project Purchase" },
                  { value: "MAINTENANCE_PURCHASE", label: "Maintenance Purchase" },
                  { value: "STOCK_PURCHASE", label: "Stock Purchase (Inventory)" },
                  { value: "INTERNAL_TRANSFER", label: "Internal Transfer" }
                ]}
              />
              <SelectField
                label={
                  activeWorkflowChoice === "PROJECT_PURCHASE"
                    ? "Client Context"
                    : "Link Client"
                }
                value={review.clientId}
                onChange={(value) =>
                  setReview((current) =>
                    current
                      ? {
                          ...current,
                          clientId: value,
                          projectId:
                            value &&
                            current.projectId &&
                            !projects.some((project) => project.id === current.projectId && project.clientId === value)
                              ? ""
                              : current.projectId
                        }
                      : current
                  )
                }
                disabled={
                  requisitionContextLocked ||
                  activeWorkflowChoice === "STOCK_PURCHASE" ||
                  activeWorkflowChoice === "INTERNAL_TRANSFER"
                }
                options={[
                  { value: "", label: "No client" },
                  ...clients.map((client) => ({ value: client.id, label: client.name }))
                ]}
              />
              <SelectField
                label="Link Project"
                value={review.projectId}
                onChange={(value) => setReview((current) => (current ? { ...current, projectId: value } : current))}
                disabled={
                  requisitionContextLocked ||
                  review.requisitionType === "INVENTORY_STOCK_UP" ||
                  activeWorkflowChoice === "STOCK_PURCHASE" ||
                  activeWorkflowChoice === "INTERNAL_TRANSFER"
                }
                options={[
                  {
                    value: "",
                    label:
                      review.requisitionType === "INVENTORY_STOCK_UP" ||
                      activeWorkflowChoice === "STOCK_PURCHASE" ||
                      activeWorkflowChoice === "INTERNAL_TRANSFER"
                        ? "Project not required for this workflow"
                        : "Select project (required)"
                  },
                  ...filteredProjects.map((project) => ({ value: project.id, label: project.name }))
                ]}
              />
              <SelectField
                label={
                  activeWorkflowChoice === "PROJECT_PURCHASE"
                    ? "Rig Context"
                    : "Link Rig"
                }
                value={review.rigId}
                onChange={(value) => setReview((current) => (current ? { ...current, rigId: value } : current))}
                disabled={
                  requisitionContextLocked ||
                  activeWorkflowChoice === "STOCK_PURCHASE" ||
                  activeWorkflowChoice === "INTERNAL_TRANSFER"
                }
                options={[
                  {
                    value: "",
                    label:
                      activeWorkflowChoice === "MAINTENANCE_PURCHASE"
                        ? "Select rig (required)"
                        : activeWorkflowChoice === "PROJECT_PURCHASE"
                          ? "No rig context"
                          : "No rig"
                  },
                  ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                ]}
              />
              {activeWorkflowChoice === "MAINTENANCE_PURCHASE" && (
                <SelectField
                  label="Maintenance Request (optional)"
                  value={review.maintenanceRequestId}
                  onChange={(value) =>
                    setReview((current) => (current ? { ...current, maintenanceRequestId: value } : current))
                  }
                  disabled={requisitionContextLocked}
                  options={[
                    { value: "", label: "No maintenance request selected" },
                    ...maintenanceRequests.map((request) => ({
                      value: request.id,
                      label: request.requestCode
                    }))
                  ]}
                />
              )}
              {review.receiptClassification === "EXPENSE_ONLY" && (
                <SelectField
                  label="Expense Category"
                  value={review.expenseOnlyCategory}
                  onChange={(value) =>
                    setReview((current) =>
                      current ? { ...current, expenseOnlyCategory: resolveExpenseOnlyCategory(value) || "" } : current
                    )
                  }
                  options={[
                    { value: "", label: "Select category" },
                    { value: "TRAVEL", label: "Travel" },
                    { value: "FOOD", label: "Food" },
                    { value: "FUEL", label: "Fuel" },
                    { value: "MISC", label: "Misc" }
                  ]}
                />
              )}
              {activeWorkflowChoice === "INTERNAL_TRANSFER" && (
                <SelectField
                  label="From Location"
                  value={review.locationFromId}
                  onChange={(value) => setReview((current) => (current ? { ...current, locationFromId: value } : current))}
                  options={[
                    { value: "", label: "Select source location" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
              )}
              <SelectField
                label={activeWorkflowChoice === "INTERNAL_TRANSFER" ? "To Location" : "Stock Location"}
                value={review.locationToId}
                onChange={(value) => setReview((current) => (current ? { ...current, locationToId: value } : current))}
                options={[
                  {
                    value: "",
                    label:
                      activeWorkflowChoice === "INTERNAL_TRANSFER"
                        ? "Select destination location"
                        : "No location"
                  },
                  ...locations.map((location) => ({ value: location.id, label: location.name }))
                ]}
              />
            </div>
            {requiresAllocation && allocationPreview !== "ALLOCATED" && (
              <p className="mt-1.5 rounded border border-amber-200/80 bg-amber-50/60 px-2 py-1 text-xs text-amber-900">
                Project/client link is incomplete. You can finalize now and complete linkage later.
              </p>
            )}
            {review.requisitionType === "INVENTORY_STOCK_UP" && (
              <p className="mt-1.5 rounded border border-sky-200/80 bg-sky-50/55 px-2 py-1 text-xs text-sky-900">
                Stock-up requisition linked. Posting as inventory replenishment.
              </p>
            )}
          </div>

          {showDeveloperDebugUi && (
            <>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails((current) => !current)}
                  className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  <span>{showTechnicalDetails ? "Hide debug details" : "Show debug details"}</span>
                  <span>{showTechnicalDetails ? "▾" : "▸"}</span>
                </button>
                {showTechnicalDetails && (
                  <div className="mt-2 space-y-3">
                    {review.warnings.length > 0 && (
                      <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        {review.warnings.map((warning) => (
                          <p key={warning}>• {calmMessage(warning)}</p>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                      <p className="font-semibold uppercase tracking-wide text-sky-700">Scan Diagnostics</p>
                      <div className="mt-2 grid gap-1 sm:grid-cols-2">
                        <p>
                          Stage:{" "}
                          <span className="font-medium">
                            {formatScanFailureStage(review.scanDiagnostics.failureStage)}
                          </span>
                        </p>
                        <p>
                          Content type:{" "}
                          <span className="font-medium">
                            {formatQrContentType(review.scanDiagnostics.qrContentType)}
                          </span>
                        </p>
                        <p>
                          QR detected:{" "}
                          <span className="font-medium">{review.scanDiagnostics.qrDetected ? "Yes" : "No"}</span>
                        </p>
                        <p>
                          Decode:{" "}
                          <span className="font-medium">
                            {formatQrDecodeStatus(review.scanDiagnostics.qrDecodeStatus)}
                            {review.scanDiagnostics.qrDecodePass
                              ? ` (${review.scanDiagnostics.qrDecodePass})`
                              : ""}
                          </span>
                        </p>
                        <p>
                          Parse:{" "}
                          <span className="font-medium">
                            {formatQrParseStatus(review.scanDiagnostics.qrParseStatus)}
                          </span>
                        </p>
                        <p>
                          Lookup:{" "}
                          <span className="font-medium">
                            {formatQrLookupStatus(review.scanDiagnostics.qrLookupStatus)}
                          </span>
                        </p>
                        <p>
                          OCR fallback:{" "}
                          <span className="font-medium">
                            {review.scanDiagnostics.ocrAttempted
                              ? review.scanDiagnostics.ocrSucceeded
                                ? "Attempted and succeeded"
                                : "Attempted with limited results"
                              : "Not attempted"}
                          </span>
                        </p>
                        <p>
                          Parsed fields:{" "}
                          <span className="font-medium">{review.scanDiagnostics.qrParsedFieldCount}</span>
                        </p>
                        <p>
                          Parsed lines:{" "}
                          <span className="font-medium">{review.scanDiagnostics.qrParsedLineItemsCount}</span>
                        </p>
                      </div>
                      <p className="mt-2 text-[11px] text-sky-800">{review.scanDiagnostics.failureMessage}</p>
                      {review.scanDiagnostics.qrLookupReason && (
                        <p className="mt-1 text-[11px] text-sky-800">
                          Lookup reason: {review.scanDiagnostics.qrLookupReason}
                        </p>
                      )}
                      {review.scanDiagnostics.ocrError && (
                        <p className="mt-1 text-[11px] text-sky-800">OCR note: {review.scanDiagnostics.ocrError}</p>
                      )}
                      {review.scanDiagnostics.qrVerificationUrl && (
                        <p className="mt-2">
                          Verification Link:{" "}
                          <a
                            href={review.scanDiagnostics.qrVerificationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-sky-800 underline"
                          >
                            Open verification URL
                          </a>
                        </p>
                      )}
                      {(review.scanDiagnostics.qrRawValue || review.scanDiagnostics.qrNormalizedRawValue) && (
                        <details className="mt-2 rounded border border-sky-300 bg-white/70 px-2 py-1.5">
                          <summary className="cursor-pointer text-[11px] font-semibold text-sky-800">
                            View raw scanned QR details
                          </summary>
                          <div className="mt-2 space-y-2 text-[11px] text-slate-800">
                            <p>
                              Raw length:{" "}
                              <span className="font-medium">{review.scanDiagnostics.qrRawValue.length}</span>
                            </p>
                            <p>
                              Normalized length:{" "}
                              <span className="font-medium">{review.scanDiagnostics.qrNormalizedRawValue.length}</span>
                            </p>
                            <div>
                              <p className="font-semibold text-slate-700">Raw payload</p>
                              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">
                                {review.scanDiagnostics.qrRawValue || "(empty)"}
                              </pre>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-700">Normalized payload</p>
                              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">
                                {review.scanDiagnostics.qrNormalizedRawValue || "(empty)"}
                              </pre>
                            </div>
                            {review.scanDiagnostics.attemptedPassCount > 0 && (
                              <div>
                                <p className="font-semibold text-slate-700">
                                  Decode attempts: {review.scanDiagnostics.attemptedPassCount}
                                </p>
                                <p className="mt-1 text-slate-600">
                                  {review.scanDiagnostics.attemptedPassSample.join(", ")}
                                </p>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <InputField
                        label="TIN"
                        value={review.tin}
                        onChange={(value) => setReview((current) => (current ? { ...current, tin: value } : current))}
                      />
                      <InputField
                        label="VRN"
                        value={review.vrn}
                        onChange={(value) => setReview((current) => (current ? { ...current, vrn: value } : current))}
                      />
                      <InputField
                        label="Serial Number"
                        value={review.serialNumber}
                        onChange={(value) => setReview((current) => (current ? { ...current, serialNumber: value } : current))}
                      />
                      <InputField
                        label="Verification Code"
                        value={review.verificationCode}
                        onChange={(value) => setReview((current) => (current ? { ...current, verificationCode: value } : current))}
                      />
                      <InputField
                        label="Verification URL"
                        value={review.verificationUrl}
                        onChange={(value) => setReview((current) => (current ? { ...current, verificationUrl: value } : current))}
                      />
                      <InputField
                        label="Receipt Time"
                        value={review.receiptTime}
                        onChange={(value) => setReview((current) => (current ? { ...current, receiptTime: value } : current))}
                      />
                      <InputField
                        label="TRA Receipt #"
                        value={review.traReceiptNumber}
                        onChange={(value) => setReview((current) => (current ? { ...current, traReceiptNumber: value } : current))}
                      />
                      <InputField
                        label="Invoice / Ref #"
                        value={review.invoiceReference}
                        onChange={(value) => setReview((current) => (current ? { ...current, invoiceReference: value } : current))}
                      />
                      <InputField
                        label="Payment Method"
                        value={review.paymentMethod}
                        onChange={(value) => setReview((current) => (current ? { ...current, paymentMethod: value } : current))}
                      />
                      <InputField
                        label="Tax Office"
                        value={review.taxOffice}
                        onChange={(value) => setReview((current) => (current ? { ...current, taxOffice: value } : current))}
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Field Confidence</p>
                      <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                        {receiptFieldLabels.map((entry) => (
                          <div key={entry.key} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                            <span>{entry.label}</span>
                            <span className={readabilityBadgeClass(review.fieldConfidence[entry.key])}>
                              {formatReadability(review.fieldConfidence[entry.key])} • {formatFieldSource(review.fieldSource[entry.key])}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {process.env.NODE_ENV !== "production" &&
                debugMode &&
                showTechnicalDetails &&
                review.debugCandidates.length > 0 && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">OCR Debug (Dev)</p>
                    <div className="mt-2 space-y-1 text-xs text-indigo-900">
                      {review.debugCandidates.map((candidate) => (
                        <p key={candidate.label}>
                          {candidate.label}: score {candidate.score.toFixed(3)}, confidence {candidate.confidence.toFixed(1)}, text{" "}
                          {candidate.textLength} chars
                        </p>
                      ))}
                    </div>
                  </div>
                )}
            </>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2">
        <button
          type="button"
          onClick={() => setFollowUpStage("REVIEW")}
          className="gf-btn-secondary"
        >
          {showMismatchInventoryHandling ? "Back to inventory" : "Back to items"}
        </button>
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={saving}
          className="gf-btn-primary"
        >
          {saving
            ? "Saving..."
            : !canManage
              ? "Submit for review"
              : "Finalize posting"}
        </button>
        <button
          type="button"
          onClick={() => {
            setReview(null);
            resetScanSessionState();
            setFollowUpStage("SCAN");
          }}
          className="gf-btn-secondary"
        >
          Start over
        </button>
      </div>
    </>
  );
}
