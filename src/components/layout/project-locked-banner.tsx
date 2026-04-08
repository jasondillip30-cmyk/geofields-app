"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, MoveRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface ProjectLockedBannerProps {
  projectId: string | null | undefined;
  projectName?: string | null;
  className?: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

export function ProjectLockedBanner({
  projectId,
  projectName,
  className
}: ProjectLockedBannerProps) {
  const [resolvedName, setResolvedName] = useState<string>("");

  useEffect(() => {
    if (!projectId || projectId === "all") {
      setResolvedName("");
      return;
    }

    if (projectName && projectName.trim()) {
      setResolvedName(projectName.trim());
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadProjectName() {
      try {
        const response = await fetch("/api/projects", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | { data?: ProjectRow[] }
          | null;
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const matched = rows.find((entry) => entry.id === projectId);
        if (!cancelled) {
          setResolvedName(matched?.name || "");
        }
      } catch {
        if (!cancelled) {
          setResolvedName("");
        }
      }
    }

    void loadProjectName();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, projectName]);

  const displayName = useMemo(() => {
    if (!projectId || projectId === "all") {
      return "";
    }
    if (projectName && projectName.trim()) {
      return projectName.trim();
    }
    if (resolvedName) {
      return resolvedName;
    }
    return "Selected project";
  }, [projectId, projectName, resolvedName]);

  if (!projectId || projectId === "all") {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-brand-300 bg-gradient-to-r from-brand-100 via-brand-50 to-white px-4 py-3 text-brand-950 shadow-[0_1px_2px_rgba(37,99,235,0.14),0_10px_22px_rgba(37,99,235,0.12)]",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-brand-300/80 bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-brand-900">
          <LockKeyhole size={12} />
          Locked scope
        </span>
        <p className="text-sm font-semibold">Project locked: {displayName}</p>
      </div>
      <p className="mt-1 text-xs text-brand-900">All data and actions in this view are limited to this project.</p>
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-800">
        Use the top bar Project selector to switch context.
        <MoveRight size={12} />
      </p>
    </div>
  );
}
