"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import {
  scrollToFocusElement,
  useCopilotFocusTarget,
  type CopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useRole } from "@/components/layout/role-provider";
import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import type { UserRole } from "@/lib/types";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type SourceRecordType = "EXPENSE" | "INVENTORY_MOVEMENT";
type LinkageType = "RIG" | "PROJECT" | "MAINTENANCE";
type LinkageSuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";

interface MissingLinkageRow {
  id: string;
  sourceRecordType: SourceRecordType;
  linkageType: LinkageType;
  recordId: string;
  reference: string;
  date: string;
  amount: number;
  currentContext: string;
  recommendedAction: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
}

interface LinkageAiSuggestion {
  rowId: string;
  linkageType: LinkageType;
  suggestedRigId: string | null;
  suggestedRigName: string | null;
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  suggestedMaintenanceRequestId: string | null;
  suggestedMaintenanceRequestCode: string | null;
  confidence: LinkageSuggestionConfidence;
  score: number;
  reasoning: string;
}

interface LinkageCenterPayload {
  filters: {
    clientId: string;
    rigId: string;
    from: string | null;
    to: string | null;
  };
  summary: {
    missingRigCount: number;
    missingProjectCount: number;
    missingMaintenanceCount: number;
    totalRecognizedCostAffected: number;
    fixedToday: number;
  };
  rows: {
    missingRig: MissingLinkageRow[];
    missingProject: MissingLinkageRow[];
    missingMaintenance: MissingLinkageRow[];
  };
  lookups: {
    rigs: Array<{
      id: string;
      name: string;
      status: string;
    }>;
    projects: Array<{
      id: string;
      name: string;
      status: string;
      clientId: string;
      clientName: string;
    }>;
    maintenanceRequests: Array<{
      id: string;
      requestCode: string;
      status: string;
      requestDate: string;
      clientId: string | null;
      clientName: string;
      projectId: string | null;
      projectName: string;
      rigId: string | null;
      rigCode: string;
    }>;
  };
}

const emptyPayload: LinkageCenterPayload = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  summary: {
    missingRigCount: 0,
    missingProjectCount: 0,
    missingMaintenanceCount: 0,
    totalRecognizedCostAffected: 0,
    fixedToday: 0
  },
  rows: {
    missingRig: [],
    missingProject: [],
    missingMaintenance: []
  },
  lookups: {
    rigs: [],
    projects: [],
    maintenanceRequests: []
  }
};

export default function DataQualityLinkageCenterPage() {
  const { filters } = useAnalyticsFilters();
  const { user } = useRole();
  const [payload, setPayload] = useState<LinkageCenterPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingRowId, setUpdatingRowId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, LinkageAiSuggestion>>({});
  const [aiLoadingRows, setAiLoadingRows] = useState<Record<string, boolean>>({});
  const [aiRowMessages, setAiRowMessages] = useState<Record<string, string>>({});
  const [confirmAiApplyRowId, setConfirmAiApplyRowId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);
  const canCorrect = isManagerOrAdmin(user?.role);
  const isScoped = hasActiveScopeFilters(filters);
  const alertsCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/alerts-center${query ? `?${query}` : ""}`;
  }, [filters]);
  const costTrackingHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/cost-tracking${query ? `?${query}` : ""}`;
  }, [filters]);
  const linkageCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/data-quality/linkage-center${query ? `?${query}` : ""}`;
  }, [filters]);

  useCopilotFocusTarget({
    pageKey: "data-quality-linkage-center",
    onFocus: (target) => {
      setAssistTarget(target);
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      requestAnimationFrame(() => {
        scrollToFocusElement({
          targetId: target.targetId || null,
          sectionId: target.sectionId || null
        });
      });
    }
  });

  useEffect(() => {
    if (!focusedRowId && !focusedSectionId) {
      return;
    }
    const timer = setTimeout(() => {
      setFocusedRowId(null);
      setFocusedSectionId(null);
    }, 2400);
    return () => clearTimeout(timer);
  }, [focusedRowId, focusedSectionId]);

  useEffect(() => {
    if (!assistTarget) {
      return;
    }
    const timer = setTimeout(() => setAssistTarget(null), 7000);
    return () => clearTimeout(timer);
  }, [assistTarget]);

  const loadLinkageCenter = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const params = buildFiltersQuery(filters);
        const query = params.toString();
        const response = await fetch(`/api/data-quality/linkage-center${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message || "Failed to load linkage center data.");
        }

        const data = (await response.json()) as LinkageCenterPayload;
        setPayload(data || emptyPayload);
        setError(null);
      } catch (loadError) {
        setPayload(emptyPayload);
        setError(loadError instanceof Error ? loadError.message : "Failed to load linkage center data.");
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    void loadLinkageCenter();
  }, [loadLinkageCenter]);

  const applyLinkageUpdate = useCallback(
    async (row: MissingLinkageRow, targetIdOverride?: string) => {
      if (!canCorrect) {
        setError("Only Admin and Manager roles can apply linkage corrections.");
        return;
      }

      const targetId = targetIdOverride || selectedTargets[row.id];
      if (!targetId) {
        setRowErrors((current) => ({
          ...current,
          [row.id]: "Please select a linkage target before saving."
        }));
        return;
      }

      setUpdatingRowId(row.id);
      setNotice(null);
      setError(null);
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });

      try {
        const response = await fetch("/api/data-quality/linkage-center", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sourceRecordType: row.sourceRecordType,
            linkageType: row.linkageType,
            recordId: row.recordId,
            targetId
          })
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          const message = payload?.message || "Failed to update linkage.";
          setRowErrors((current) => ({
            ...current,
            [row.id]: message
          }));
          return;
        }

        setNotice("Linkage updated successfully.");
        setSelectedTargets((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        await loadLinkageCenter(true);
      } catch (updateError) {
        setRowErrors((current) => ({
          ...current,
          [row.id]: updateError instanceof Error ? updateError.message : "Failed to update linkage."
        }));
      } finally {
        setUpdatingRowId(null);
      }
    },
    [canCorrect, loadLinkageCenter, selectedTargets]
  );

  const allRows = useMemo(
    () => [...payload.rows.missingRig, ...payload.rows.missingProject, ...payload.rows.missingMaintenance],
    [payload.rows.missingMaintenance, payload.rows.missingProject, payload.rows.missingRig]
  );

  const selectedItemRows = useMemo(() => {
    const rowMap = new Map(allRows.map((row) => [row.id, row]));
    return Object.entries(selectedTargets)
      .filter(([, targetId]) => Boolean(targetId))
      .map(([rowId]) => rowMap.get(rowId))
      .filter((row): row is MissingLinkageRow => Boolean(row));
  }, [allRows, selectedTargets]);

  const fetchAiSuggestions = useCallback(
    async (rows: MissingLinkageRow[]) => {
      if (rows.length === 0) {
        return;
      }

      const rowIds = rows.map((row) => row.id);
      setAiLoadingRows((current) => {
        const next = { ...current };
        for (const rowId of rowIds) {
          next[rowId] = true;
        }
        return next;
      });
      setAiRowMessages((current) => {
        const next = { ...current };
        for (const rowId of rowIds) {
          delete next[rowId];
        }
        return next;
      });

      try {
        const response = await fetch("/api/ai/copilot/linkage-suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            rows,
            lookups: payload.lookups
          })
        });

        const payloadJson = (await response.json().catch(() => null)) as
          | { message?: string; suggestions?: LinkageAiSuggestion[] }
          | null;
        if (!response.ok) {
          throw new Error(payloadJson?.message || "Failed to generate AI linkage suggestions.");
        }

        const suggestions = Array.isArray(payloadJson?.suggestions) ? payloadJson.suggestions : [];
        setAiSuggestions((current) => {
          const next = { ...current };
          for (const suggestion of suggestions) {
            next[suggestion.rowId] = suggestion;
          }
          return next;
        });

        const suggestedRowIds = new Set(suggestions.map((entry) => entry.rowId));
        setAiRowMessages((current) => {
          const next = { ...current };
          for (const row of rows) {
            if (!suggestedRowIds.has(row.id)) {
              next[row.id] = "AI could not produce a strong recommendation for this row.";
            }
          }
          return next;
        });
      } catch (suggestionError) {
        const message =
          suggestionError instanceof Error ? suggestionError.message : "Failed to generate AI linkage suggestions.";
        setAiRowMessages((current) => {
          const next = { ...current };
          for (const rowId of rowIds) {
            next[rowId] = message;
          }
          return next;
        });
      } finally {
        setAiLoadingRows((current) => {
          const next = { ...current };
          for (const rowId of rowIds) {
            delete next[rowId];
          }
          return next;
        });
      }
    },
    [payload.lookups]
  );

  useEffect(() => {
    if (loading) {
      return;
    }
    if (allRows.length === 0) {
      setAiSuggestions({});
      setAiLoadingRows({});
      setAiRowMessages({});
      return;
    }
    void fetchAiSuggestions(allRows);
  }, [allRows, fetchAiSuggestions, loading]);

  const applyAiSuggestion = useCallback(
    async (row: MissingLinkageRow) => {
      const suggestion = aiSuggestions[row.id];
      if (!suggestion) {
        setAiRowMessages((current) => ({
          ...current,
          [row.id]: "No AI suggestion available for this row yet."
        }));
        return;
      }
      const targetId = resolveAiSuggestedTargetId(row, suggestion);
      if (!targetId) {
        setAiRowMessages((current) => ({
          ...current,
          [row.id]: "AI suggestion has no applicable target for this linkage type."
        }));
        return;
      }

      setSelectedTargets((current) => ({
        ...current,
        [row.id]: targetId
      }));
      setConfirmAiApplyRowId(null);
      await applyLinkageUpdate(row, targetId);
    },
    [aiSuggestions, applyLinkageUpdate]
  );

  const rigRows = useMemo(
    () =>
      payload.rows.missingRig.map((row) => [
        <SourceRecordBadge key={`${row.id}-source`} sourceRecordType={row.sourceRecordType} />,
        <div key={`${row.id}-reference`} className="space-y-1">
          <p className="font-medium text-ink-900">{row.reference}</p>
          <p className="text-xs text-slate-500">{row.recordId}</p>
        </div>,
        formatDisplayDate(row.date),
        <span key={`${row.id}-amount`} className="font-medium text-ink-900">
          {formatCurrency(row.amount)}
        </span>,
        row.currentContext || "Unlinked context",
        row.recommendedAction,
        <RowActionCell
          key={`${row.id}-action`}
          row={row}
          options={payload.lookups.rigs.map((entry) => ({
            id: entry.id,
            label: entry.name
          }))}
          placeholder="Select rig"
          value={selectedTargets[row.id] || ""}
          disabled={!canCorrect || updatingRowId === row.id}
          saving={updatingRowId === row.id}
          error={rowErrors[row.id]}
          onChange={(value) => {
            setSelectedTargets((current) => ({
              ...current,
              [row.id]: value
            }));
          }}
          onSave={() => void applyLinkageUpdate(row)}
          aiSuggestion={aiSuggestions[row.id]}
          aiLoading={Boolean(aiLoadingRows[row.id])}
          aiMessage={aiRowMessages[row.id]}
          canApplyAi={canCorrect}
          confirmApplyAi={confirmAiApplyRowId === row.id}
          onGenerateAi={() => void fetchAiSuggestions([row])}
          onRequestApplyAi={() => setConfirmAiApplyRowId(row.id)}
          onConfirmApplyAi={() => void applyAiSuggestion(row)}
          onCancelApplyAi={() => setConfirmAiApplyRowId((current) => (current === row.id ? null : current))}
        />
      ]),
    [
      aiLoadingRows,
      aiRowMessages,
      aiSuggestions,
      applyAiSuggestion,
      applyLinkageUpdate,
      canCorrect,
      confirmAiApplyRowId,
      fetchAiSuggestions,
      payload.lookups.rigs,
      payload.rows.missingRig,
      rowErrors,
      selectedTargets,
      updatingRowId
    ]
  );

  const projectRows = useMemo(
    () =>
      payload.rows.missingProject.map((row) => [
        <SourceRecordBadge key={`${row.id}-source`} sourceRecordType={row.sourceRecordType} />,
        <div key={`${row.id}-reference`} className="space-y-1">
          <p className="font-medium text-ink-900">{row.reference}</p>
          <p className="text-xs text-slate-500">{row.recordId}</p>
        </div>,
        formatDisplayDate(row.date),
        <span key={`${row.id}-amount`} className="font-medium text-ink-900">
          {formatCurrency(row.amount)}
        </span>,
        row.currentContext || "Unlinked context",
        row.recommendedAction,
        <RowActionCell
          key={`${row.id}-action`}
          row={row}
          options={projectOptionsForRow(row, payload.lookups.projects).map((entry) => ({
            id: entry.id,
            label: entry.clientName ? `${entry.name} (${entry.clientName})` : entry.name
          }))}
          placeholder="Select project"
          value={selectedTargets[row.id] || ""}
          disabled={!canCorrect || updatingRowId === row.id}
          saving={updatingRowId === row.id}
          error={rowErrors[row.id]}
          onChange={(value) => {
            setSelectedTargets((current) => ({
              ...current,
              [row.id]: value
            }));
          }}
          onSave={() => void applyLinkageUpdate(row)}
          aiSuggestion={aiSuggestions[row.id]}
          aiLoading={Boolean(aiLoadingRows[row.id])}
          aiMessage={aiRowMessages[row.id]}
          canApplyAi={canCorrect}
          confirmApplyAi={confirmAiApplyRowId === row.id}
          onGenerateAi={() => void fetchAiSuggestions([row])}
          onRequestApplyAi={() => setConfirmAiApplyRowId(row.id)}
          onConfirmApplyAi={() => void applyAiSuggestion(row)}
          onCancelApplyAi={() => setConfirmAiApplyRowId((current) => (current === row.id ? null : current))}
        />
      ]),
    [
      aiLoadingRows,
      aiRowMessages,
      aiSuggestions,
      applyAiSuggestion,
      applyLinkageUpdate,
      canCorrect,
      confirmAiApplyRowId,
      fetchAiSuggestions,
      payload.lookups.projects,
      payload.rows.missingProject,
      rowErrors,
      selectedTargets,
      updatingRowId
    ]
  );

  const maintenanceRows = useMemo(
    () =>
      payload.rows.missingMaintenance.map((row) => [
        <SourceRecordBadge key={`${row.id}-source`} sourceRecordType={row.sourceRecordType} />,
        <div key={`${row.id}-reference`} className="space-y-1">
          <p className="font-medium text-ink-900">{row.reference}</p>
          <p className="text-xs text-slate-500">{row.recordId}</p>
        </div>,
        formatDisplayDate(row.date),
        <span key={`${row.id}-amount`} className="font-medium text-ink-900">
          {formatCurrency(row.amount)}
        </span>,
        row.currentContext || "Unlinked context",
        row.recommendedAction,
        <RowActionCell
          key={`${row.id}-action`}
          row={row}
          options={maintenanceOptionsForRow(row, payload.lookups.maintenanceRequests).map((entry) => ({
            id: entry.id,
            label: `${entry.requestCode}${entry.rigCode ? ` • ${entry.rigCode}` : ""}`
          }))}
          placeholder="Select maintenance request"
          value={selectedTargets[row.id] || ""}
          disabled={!canCorrect || updatingRowId === row.id}
          saving={updatingRowId === row.id}
          error={rowErrors[row.id]}
          onChange={(value) => {
            setSelectedTargets((current) => ({
              ...current,
              [row.id]: value
            }));
          }}
          onSave={() => void applyLinkageUpdate(row)}
          aiSuggestion={aiSuggestions[row.id]}
          aiLoading={Boolean(aiLoadingRows[row.id])}
          aiMessage={aiRowMessages[row.id]}
          canApplyAi={canCorrect}
          confirmApplyAi={confirmAiApplyRowId === row.id}
          onGenerateAi={() => void fetchAiSuggestions([row])}
          onRequestApplyAi={() => setConfirmAiApplyRowId(row.id)}
          onConfirmApplyAi={() => void applyAiSuggestion(row)}
          onCancelApplyAi={() => setConfirmAiApplyRowId((current) => (current === row.id ? null : current))}
        />
      ]),
    [
      aiLoadingRows,
      aiRowMessages,
      aiSuggestions,
      applyAiSuggestion,
      applyLinkageUpdate,
      canCorrect,
      confirmAiApplyRowId,
      fetchAiSuggestions,
      payload.lookups.maintenanceRequests,
      payload.rows.missingMaintenance,
      rowErrors,
      selectedTargets,
      updatingRowId
    ]
  );

  const rigRowIds = useMemo(
    () => payload.rows.missingRig.map((row) => `ai-focus-${row.id}`),
    [payload.rows.missingRig]
  );
  const projectRowIds = useMemo(
    () => payload.rows.missingProject.map((row) => `ai-focus-${row.id}`),
    [payload.rows.missingProject]
  );
  const maintenanceRowIds = useMemo(
    () => payload.rows.missingMaintenance.map((row) => `ai-focus-${row.id}`),
    [payload.rows.missingMaintenance]
  );

  const rigRowClassNames = useMemo(
    () =>
      payload.rows.missingRig.map((row) =>
        row.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedRowId, payload.rows.missingRig]
  );
  const projectRowClassNames = useMemo(
    () =>
      payload.rows.missingProject.map((row) =>
        row.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedRowId, payload.rows.missingProject]
  );
  const maintenanceRowClassNames = useMemo(
    () =>
      payload.rows.missingMaintenance.map((row) =>
        row.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedRowId, payload.rows.missingMaintenance]
  );

  const focusedLinkageRow = useMemo(
    () => allRows.find((row) => row.id === focusedRowId) || null,
    [allRows, focusedRowId]
  );

  useEffect(() => {
    if (!focusedLinkageRow) {
      return;
    }
    const suggestion = aiSuggestions[focusedLinkageRow.id];
    if (!suggestion || suggestion.confidence === "LOW") {
      return;
    }
    const targetId = resolveAiSuggestedTargetId(focusedLinkageRow, suggestion);
    if (!targetId || selectedTargets[focusedLinkageRow.id]) {
      return;
    }
    setSelectedTargets((current) => ({
      ...current,
      [focusedLinkageRow.id]: targetId
    }));
    setAiRowMessages((current) => ({
      ...current,
      [focusedLinkageRow.id]: "Suggested target prefilled for review (not saved)."
    }));
  }, [aiSuggestions, focusedLinkageRow, selectedTargets]);

  const linkageWorkflowAssist = useMemo<WorkflowAssistModel | null>(() => {
    if (!assistTarget && !focusedLinkageRow) {
      return null;
    }

    const row = focusedLinkageRow;
    const suggestion = row ? aiSuggestions[row.id] : null;
    const missingContext: string[] = [];
    if (row && !row.currentContext) {
      missingContext.push("Current context is missing.");
    }
    if (row && !row.recordId) {
      missingContext.push("Source record reference is missing.");
    }
    if (!suggestion) {
      missingContext.push("No AI suggestion generated yet for this row.");
    }
    if (suggestion?.confidence === "LOW") {
      missingContext.push("AI confidence is low; manual validation is required before saving.");
    }

    const roleLabel = user?.role === "ADMIN" || user?.role === "MANAGER" ? "Manager linkage assist" : "Linkage assist";
    const confidenceLabel = suggestion?.confidence ? suggestion.confidence.toLowerCase() : "not available";
    const suggestedTarget =
      row && suggestion ? formatSuggestedTargetLabel(row.linkageType, suggestion) : null;
    return {
      heading: "Linkage Workflow Assist",
      roleLabel,
      tone: suggestion?.confidence === "LOW" ? "amber" : "indigo",
      whyThisMatters:
        assistTarget?.reason ||
        (row
          ? `${row.linkageType} linkage is missing on ${row.sourceRecordType.toLowerCase()} record ${row.recordId}, which affects recognized-cost attribution${suggestedTarget ? `. Suggested target: ${suggestedTarget}` : ""}.`
          : "This linkage target was prioritized to improve reporting accuracy."),
      inspectFirst: [
        "Review source record reference, vendor/description context, and amount.",
        "Compare suggested target to historical pattern match.",
        `Validate confidence (${confidenceLabel}) before applying any correction.`
      ],
      missingContext,
      checklist: [
        "Verify amount",
        "Confirm source record",
        "Inspect suggested target",
        "Review confidence rationale",
        "Validate downstream reporting impact"
      ],
      recommendedNextStep: row
        ? suggestion?.confidence === "HIGH"
          ? "Apply the suggestion if it matches source context, then refresh linked dashboards."
          : "Use manual target selection and confirm with record context before saving."
        : "Open a highlighted linkage row and complete a confidence-checked correction."
    };
  }, [aiSuggestions, assistTarget, focusedLinkageRow, user?.role]);

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "data-quality-linkage-center",
      pageName: "Data Quality / Linkage Center",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "missingRigLinkage", label: "Records Needing Rig Linkage", value: payload.summary.missingRigCount },
        { key: "missingProjectLinkage", label: "Records Needing Project Linkage", value: payload.summary.missingProjectCount },
        { key: "missingMaintenanceLinkage", label: "Records Needing Maintenance Linkage", value: payload.summary.missingMaintenanceCount },
        {
          key: "totalRecognizedCostAffected",
          label: "Total Recognized Cost Affected",
          value: payload.summary.totalRecognizedCostAffected
        },
        { key: "fixedToday", label: "Fixed Today", value: payload.summary.fixedToday }
      ],
      tablePreviews: [
        {
          key: "missing-rig",
          title: "Missing Rig Linkage",
          rowCount: payload.rows.missingRig.length,
          columns: ["RowId", "Reference", "Amount", "Date", "RecordId", "Confidence"],
          rows: payload.rows.missingRig.slice(0, 8).map((row) => ({
            rowId: row.id,
            id: row.id,
            reference: row.reference,
            amount: row.amount,
            date: row.date,
            recordId: row.recordId,
            confidence: aiSuggestions[row.id]?.confidence || null,
            suggestionConfidence: aiSuggestions[row.id]?.confidence || null,
            href: linkageCenterHref,
            targetId: row.id,
            sectionId: "missing-rig-section",
            targetPageKey: "data-quality-linkage-center"
          }))
        },
        {
          key: "missing-project",
          title: "Missing Project Linkage",
          rowCount: payload.rows.missingProject.length,
          columns: ["RowId", "Reference", "Amount", "Date", "RecordId", "Confidence"],
          rows: payload.rows.missingProject.slice(0, 8).map((row) => ({
            rowId: row.id,
            id: row.id,
            reference: row.reference,
            amount: row.amount,
            date: row.date,
            recordId: row.recordId,
            confidence: aiSuggestions[row.id]?.confidence || null,
            suggestionConfidence: aiSuggestions[row.id]?.confidence || null,
            href: linkageCenterHref,
            targetId: row.id,
            sectionId: "missing-project-section",
            targetPageKey: "data-quality-linkage-center"
          }))
        },
        {
          key: "missing-maintenance",
          title: "Missing Maintenance Linkage",
          rowCount: payload.rows.missingMaintenance.length,
          columns: ["RowId", "Reference", "Amount", "Date", "RecordId", "Confidence"],
          rows: payload.rows.missingMaintenance.slice(0, 8).map((row) => ({
            rowId: row.id,
            id: row.id,
            reference: row.reference,
            amount: row.amount,
            date: row.date,
            recordId: row.recordId,
            confidence: aiSuggestions[row.id]?.confidence || null,
            suggestionConfidence: aiSuggestions[row.id]?.confidence || null,
            href: linkageCenterHref,
            targetId: row.id,
            sectionId: "missing-maintenance-section",
            targetPageKey: "data-quality-linkage-center"
          }))
        }
      ],
      selectedItems: selectedItemRows.map((row) => ({
        id: row.id,
        type: "linkage-row",
        label: row.reference
      })),
      priorityItems: allRows
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          label: row.reference,
          reason: `${row.linkageType} linkage missing • ${row.sourceRecordType.toLowerCase()} record ${row.recordId}`,
          severity: row.amount >= 50000 ? ("HIGH" as const) : row.amount >= 10000 ? ("MEDIUM" as const) : ("LOW" as const),
          amount: row.amount,
          href: linkageCenterHref,
          issueType: `${row.linkageType}_LINKAGE`,
          confidence: aiSuggestions[row.id]?.confidence || null,
          targetId: row.id,
          sectionId:
            row.linkageType === "RIG"
              ? "missing-rig-section"
              : row.linkageType === "PROJECT"
                ? "missing-project-section"
                : "missing-maintenance-section",
          targetPageKey: "data-quality-linkage-center"
        })),
      navigationTargets: [
        { label: "Open Alerts Center", href: alertsCenterHref, reason: "Review linkage-related alert pressure.", pageKey: "alerts-center" },
        { label: "Open Cost Tracking", href: costTrackingHref, reason: "Validate spend context after fixes.", pageKey: "cost-tracking" }
      ],
      notes: [
        canCorrect
          ? "Linkage updates are manager/admin controlled and apply immediately."
          : "Current access is read-only for linkage corrections."
      ]
    }),
    [
      alertsCenterHref,
      canCorrect,
      costTrackingHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      payload.rows.missingMaintenance,
      payload.rows.missingProject,
      payload.rows.missingRig,
      payload.summary.fixedToday,
      payload.summary.missingMaintenanceCount,
      payload.summary.missingProjectCount,
      payload.summary.missingRigCount,
      payload.summary.totalRecognizedCostAffected,
      selectedItemRows,
      allRows,
      aiSuggestions,
      linkageCenterHref
    ]
  );

  useRegisterCopilotContext(copilotContext);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        {notice ? <div className="gf-feedback-success">{notice}</div> : null}
        {error ? <div className="gf-feedback-error">{error}</div> : null}

        <section
          id="missing-rig-section"
          className={cn(
            "gf-section",
            focusedSectionId === "missing-rig-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Data Quality / Linkage Center"
            description="Identify recognized spend records missing operational linkage and apply targeted corrections."
            action={
              <button
                type="button"
                onClick={() => void loadLinkageCenter(true)}
                className="gf-btn-subtle inline-flex items-center gap-1"
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />

          <div className="gf-kpi-grid-primary">
            <MetricCard
              label="Records Needing Rig Linkage"
              value={formatNumber(payload.summary.missingRigCount)}
            />
            <MetricCard
              label="Records Needing Project Linkage"
              value={formatNumber(payload.summary.missingProjectCount)}
            />
            <MetricCard
              label="Records Needing Maintenance Linkage"
              value={formatNumber(payload.summary.missingMaintenanceCount)}
            />
            <MetricCard
              label={isScoped ? "Recognized Cost Affected in Scope" : "Total Recognized Cost Affected"}
              value={formatCurrency(payload.summary.totalRecognizedCostAffected)}
              tone="warn"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Fixed Today" value={formatNumber(payload.summary.fixedToday)} tone="good" />
            <Card className="p-4 md:p-4 lg:p-4">
              <p className="text-sm text-slate-600">
                {canCorrect
                  ? "Admin and Manager roles can apply linkage corrections directly from these queues."
                  : "You currently have read-only access. Admin and Manager roles can apply linkage corrections."}
              </p>
              <p className="mt-2 text-xs text-indigo-700">
                AI suggestions are advisory only and use existing record patterns from approved operational data.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Use this linkage queue to prioritize page-level fixes first, then use global assistant routing only when you need cross-page context.
              </p>
            </Card>
          </div>
        </section>

        <section className="gf-section">
          <WorkflowAssistPanel model={linkageWorkflowAssist} />
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Missing Rig Linkage"
            description="Approved spend records not assigned to any rig."
          />
          <LinkageSection
            loading={loading}
            rows={rigRows}
            rowIds={rigRowIds}
            rowClassNames={rigRowClassNames}
            emptyMessage="No approved records are currently missing rig linkage in this scope."
          />
        </section>

        <section
          id="missing-project-section"
          className={cn(
            "gf-section",
            focusedSectionId === "missing-project-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Missing Project Linkage"
            description="Approved spend records not assigned to any project."
          />
          <LinkageSection
            loading={loading}
            rows={projectRows}
            rowIds={projectRowIds}
            rowClassNames={projectRowClassNames}
            emptyMessage="No approved records are currently missing project linkage in this scope."
          />
        </section>

        <section
          id="missing-maintenance-section"
          className={cn(
            "gf-section",
            focusedSectionId === "missing-maintenance-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Missing Maintenance Linkage"
            description="Approved inventory stock-out records without maintenance request context."
          />
          <LinkageSection
            loading={loading}
            rows={maintenanceRows}
            rowIds={maintenanceRowIds}
            rowClassNames={maintenanceRowClassNames}
            emptyMessage="No approved inventory movements are currently missing maintenance linkage in this scope."
          />
        </section>
      </div>
    </AccessGate>
  );
}

function LinkageSection({
  loading,
  rows,
  rowIds,
  rowClassNames,
  emptyMessage
}: {
  loading: boolean;
  rows: ReactNode[][];
  rowIds: string[];
  rowClassNames: string[];
  emptyMessage: string;
}) {
  return (
    <Card>
      {loading ? (
        <p className="text-sm text-slate-600">Loading records...</p>
      ) : rows.length === 0 ? (
        <div className="gf-empty-state">{emptyMessage}</div>
      ) : (
        <DataTable
          columns={[
            "Source",
            "Reference",
            "Date",
            "Amount",
            "Current Context",
            "Recommended Action",
            "Assign & Save"
          ]}
          rows={rows}
          rowIds={rowIds}
          rowClassNames={rowClassNames}
        />
      )}
    </Card>
  );
}

function RowActionCell({
  row,
  options,
  placeholder,
  value,
  disabled,
  saving,
  error,
  aiSuggestion,
  aiLoading,
  aiMessage,
  canApplyAi,
  confirmApplyAi,
  onChange,
  onSave,
  onGenerateAi,
  onRequestApplyAi,
  onConfirmApplyAi,
  onCancelApplyAi
}: {
  row: MissingLinkageRow;
  options: Array<{ id: string; label: string }>;
  placeholder: string;
  value: string;
  disabled: boolean;
  saving: boolean;
  error?: string;
  aiSuggestion?: LinkageAiSuggestion;
  aiLoading: boolean;
  aiMessage?: string;
  canApplyAi: boolean;
  confirmApplyAi: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onGenerateAi: () => void;
  onRequestApplyAi: () => void;
  onConfirmApplyAi: () => void;
  onCancelApplyAi: () => void;
}) {
  const hasOptions = options.length > 0;
  const suggestedLabel = formatSuggestedTargetLabel(row.linkageType, aiSuggestion);

  return (
    <div className="min-w-[250px] space-y-2" data-card-ignore-click="true">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || !hasOptions}
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        <option value="">{hasOptions ? placeholder : "No options available"}</option>
        {options.map((option) => (
          <option key={`${row.id}-${option.id}`} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || !value || !hasOptions}
        className="gf-btn-subtle w-full text-xs"
      >
        {saving ? "Saving..." : "Save linkage"}
      </button>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">AI suggestion (advisory)</p>
        {aiLoading ? (
          <p className="mt-1 text-xs text-slate-600">Generating suggestion...</p>
        ) : aiSuggestion ? (
          <div className="mt-1 space-y-1.5">
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Suggested target:</span> {suggestedLabel || "No target"}
            </p>
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Confidence:</span>{" "}
              <ConfidenceBadge confidence={aiSuggestion.confidence} />
            </p>
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Reasoning:</span> {aiSuggestion.reasoning}
            </p>
            {!confirmApplyAi ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={onGenerateAi} className="gf-btn-subtle text-xs" disabled={disabled}>
                  Refresh AI
                </button>
                <button
                  type="button"
                  onClick={onRequestApplyAi}
                  className="gf-btn-subtle text-xs"
                  disabled={!canApplyAi || !resolveAiSuggestedTargetId(row, aiSuggestion) || disabled}
                >
                  Apply AI suggestion
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs text-slate-700">Confirm applying this AI suggestion?</p>
                <button type="button" onClick={onConfirmApplyAi} className="gf-btn-subtle text-xs" disabled={disabled}>
                  Confirm
                </button>
                <button type="button" onClick={onCancelApplyAi} className="gf-btn-subtle text-xs">
                  Cancel
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1 space-y-1">
            <p className="text-xs text-slate-600">No AI suggestion generated yet.</p>
            <button type="button" onClick={onGenerateAi} className="gf-btn-subtle text-xs" disabled={disabled}>
              Generate AI suggestion
            </button>
          </div>
        )}
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {aiMessage ? <p className="text-xs text-slate-600">{aiMessage}</p> : null}
    </div>
  );
}

function SourceRecordBadge({ sourceRecordType }: { sourceRecordType: SourceRecordType }) {
  const label = sourceRecordType === "EXPENSE" ? "Expense" : "Inventory Movement";
  const tone =
    sourceRecordType === "EXPENSE"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-violet-200 bg-violet-50 text-violet-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

function projectOptionsForRow(
  row: MissingLinkageRow,
  projects: LinkageCenterPayload["lookups"]["projects"]
) {
  if (row.clientId) {
    const scoped = projects.filter((project) => project.clientId === row.clientId);
    if (scoped.length > 0) {
      return scoped;
    }
  }
  return projects;
}

function maintenanceOptionsForRow(
  row: MissingLinkageRow,
  maintenanceRequests: LinkageCenterPayload["lookups"]["maintenanceRequests"]
) {
  const scoped = maintenanceRequests.filter((request) => {
    if (row.rigId && request.rigId && request.rigId !== row.rigId) {
      return false;
    }
    if (row.projectId && request.projectId && request.projectId !== row.projectId) {
      return false;
    }
    if (row.clientId && request.clientId && request.clientId !== row.clientId) {
      return false;
    }
    return true;
  });
  return scoped.length > 0 ? scoped : maintenanceRequests;
}

function formatDisplayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium"
  }).format(parsed);
}

function buildFiltersQuery(filters: { clientId: string; rigId: string; from: string; to: string }) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

function isManagerOrAdmin(role: UserRole | null | undefined) {
  return role === "ADMIN" || role === "MANAGER";
}

function resolveAiSuggestedTargetId(row: MissingLinkageRow, suggestion: LinkageAiSuggestion) {
  if (row.linkageType === "RIG") {
    return suggestion.suggestedRigId;
  }
  if (row.linkageType === "PROJECT") {
    return suggestion.suggestedProjectId;
  }
  return suggestion.suggestedMaintenanceRequestId;
}

function formatSuggestedTargetLabel(linkageType: LinkageType, suggestion?: LinkageAiSuggestion) {
  if (!suggestion) {
    return null;
  }
  if (linkageType === "RIG") {
    return suggestion.suggestedRigName;
  }
  if (linkageType === "PROJECT") {
    return suggestion.suggestedProjectName;
  }
  return suggestion.suggestedMaintenanceRequestCode;
}

function ConfidenceBadge({ confidence }: { confidence: LinkageSuggestionConfidence }) {
  const tone =
    confidence === "HIGH"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidence === "MEDIUM"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {confidence}
    </span>
  );
}
