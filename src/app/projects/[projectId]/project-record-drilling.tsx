"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const DrillingEntry = dynamic(() =>
  import("@/app/spending/spending-drilling-entry-modal").then((module) => module.SpendingDrillingEntryModal)
);

export function ProjectRecordDrilling({ projectId, reportsHref }: { projectId: string; reportsHref: string }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        className="gf-btn-primary min-h-11 w-full sm:w-auto"
        onClick={() => { setSubmitted(false); setOpen(true); }}
      >
        Record drilling
      </button>
      <a href="/offline-drilling.html" className="mt-2 block text-sm font-medium text-brand-700 underline sm:mt-1">
        Shift log / offline drilling
      </a>
      {submitted && (
        <p role="status" className="mt-2 text-sm text-emerald-800">
          Report submitted for approval. It will count toward revenue after approval.
        </p>
      )}
      {open && (
        <DrillingEntry
          open={open}
          projectId={projectId}
          reportsHref={reportsHref}
          onClose={() => setOpen(false)}
          onSaved={() => setSubmitted(true)}
        />
      )}
    </div>
  );
}
