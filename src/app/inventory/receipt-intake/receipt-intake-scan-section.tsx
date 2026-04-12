"use client";

import { ReceiptIntakePanel } from "@/components/inventory/receipt-intake-panel";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  ReceiptEntryMode,
  ReceiptInputMethod,
  ReceiptSubmissionDetail,
  ReferenceClient,
  ReferenceItem,
  ReferenceLocation,
  ReferenceMaintenanceRequest,
  ReferenceProject,
  ReferenceRig,
  ReferenceSupplier,
  RequisitionPrefill
} from "./receipt-intake-page-types";

interface ReceiptIntakeScanSectionProps {
  focusedSectionId: string | null;
  canManage: boolean;
  activeRequisitionPrefill: RequisitionPrefill | null;
  submissionLoading: boolean;
  canRenderReceiptPanel: boolean;
  entryMode: ReceiptEntryMode;
  receiptInputMethod: ReceiptInputMethod;
  items: ReferenceItem[];
  suppliers: ReferenceSupplier[];
  locations: ReferenceLocation[];
  maintenanceRequests: ReferenceMaintenanceRequest[];
  clients: ReferenceClient[];
  projects: ReferenceProject[];
  rigs: ReferenceRig[];
  activeSubmission: ReceiptSubmissionDetail | null;
  onGuidedStepChange: (step: 1 | 2 | 3 | 4) => void;
  onCompleted: () => Promise<void>;
}

export function ReceiptIntakeScanSection({
  focusedSectionId,
  canManage,
  activeRequisitionPrefill,
  submissionLoading,
  canRenderReceiptPanel,
  entryMode,
  receiptInputMethod,
  items,
  suppliers,
  locations,
  maintenanceRequests,
  clients,
  projects,
  rigs,
  activeSubmission,
  onGuidedStepChange,
  onCompleted
}: ReceiptIntakeScanSectionProps) {
  return (
    <section
      id="inventory-receipt-scan-section"
      className={cn(
        focusedSectionId === "inventory-receipt-scan-section" &&
          "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
      )}
    >
      <Card className="min-w-0" title={undefined} subtitle={undefined}>
        {!canManage && (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Saved as <span className="font-semibold">Pending review</span> until manager/admin finalization.
          </p>
        )}
        {activeRequisitionPrefill && (
          <p className="mb-2 text-[11px] text-slate-500">
            Requisition <span className="font-medium text-slate-700">{activeRequisitionPrefill.requisitionCode}</span>
          </p>
        )}
        {submissionLoading && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Loading selected submission...
          </p>
        )}
        {canRenderReceiptPanel ? (
          <ReceiptIntakePanel
            key={`${entryMode}:${receiptInputMethod}:${activeRequisitionPrefill?.id || "manual"}`}
            renderCard={false}
            canManage={canManage}
            items={items}
            suppliers={suppliers}
            locations={locations}
            maintenanceRequests={maintenanceRequests}
            clients={clients}
            projects={projects}
            rigs={rigs}
            defaultClientId={activeRequisitionPrefill?.clientId || ""}
            defaultRigId={activeRequisitionPrefill?.rigId || ""}
            initialRequisition={activeRequisitionPrefill}
            preferredInputMethod={receiptInputMethod || "SCAN"}
            activeSubmission={activeSubmission}
            onGuidedStepChange={onGuidedStepChange}
            onCompleted={onCompleted}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-3 py-3 text-sm text-indigo-900">
            Select an approved requisition to continue with receipt posting.
          </div>
        )}
      </Card>
    </section>
  );
}
