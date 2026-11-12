"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/components/layout/role-provider";
import { canCloseProject } from "@/lib/project-status-policy";

export function ProjectCloseAction({ projectId }: { projectId: string }) {
  const { role } = useRole();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!canCloseProject(role)) return null;

  async function closeProject() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/close`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Could not close the project. Try again.");
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not close the project.");
      setSaving(false);
    }
  }

  if (!confirming) {
    return <button type="button" className="gf-btn-secondary" onClick={() => setConfirming(true)}>End project early</button>;
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>Close this project now? New drilling reports will be blocked. Existing records will stay available.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="gf-btn-primary" disabled={saving} onClick={() => void closeProject()}>
          {saving ? "Closing..." : "Confirm close"}
        </button>
        <button type="button" className="gf-btn-secondary" disabled={saving} onClick={() => { setConfirming(false); setError(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
