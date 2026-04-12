"use client";

import type { ComponentProps } from "react";

import { ReceiptIntakePanelFeedback } from "@/components/inventory/receipt-intake-panel-feedback";
import { ReceiptIntakeDuplicateReview } from "@/components/inventory/receipt-intake-duplicate-review";
import { ReceiptIntakeMismatchStep } from "@/components/inventory/receipt-intake-mismatch-step";
import { ReceiptIntakeGuidedStages } from "@/components/inventory/receipt-intake-guided-stages";
import { ReceiptIntakeFocusedOverlay } from "@/components/inventory/receipt-intake-focused-overlay";

interface ReceiptIntakePanelContentProps {
  panelFeedbackProps: ComponentProps<typeof ReceiptIntakePanelFeedback>;
  duplicateReviewProps: ComponentProps<typeof ReceiptIntakeDuplicateReview>;
  mismatchStepProps: ComponentProps<typeof ReceiptIntakeMismatchStep>;
  guidedStagesProps: ComponentProps<typeof ReceiptIntakeGuidedStages>;
  focusedOverlayProps: ComponentProps<typeof ReceiptIntakeFocusedOverlay>;
}

export function ReceiptIntakePanelContent({
  panelFeedbackProps,
  duplicateReviewProps,
  mismatchStepProps,
  guidedStagesProps,
  focusedOverlayProps
}: ReceiptIntakePanelContentProps) {
  return (
    <div className="space-y-4">
      <ReceiptIntakePanelFeedback {...panelFeedbackProps} />
      <ReceiptIntakeDuplicateReview {...duplicateReviewProps} />
      <ReceiptIntakeMismatchStep {...mismatchStepProps} />
      <ReceiptIntakeGuidedStages {...guidedStagesProps} />
      <ReceiptIntakeFocusedOverlay {...focusedOverlayProps} />
    </div>
  );
}
