import type { MaintenanceStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type LinkageType = "RIG" | "PROJECT" | "MAINTENANCE";
export type SourceRecordType = "EXPENSE" | "INVENTORY_MOVEMENT";
export type LinkageSuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface LinkageSuggestionInputRow {
  id: string;
  sourceRecordType: SourceRecordType;
  linkageType: LinkageType;
  recordId: string;
  date: string;
  reference: string;
  currentContext: string;
  amount: number;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
}

export interface LinkageSuggestionLookups {
  rigs: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string; clientName: string }>;
  maintenanceRequests: Array<{
    id: string;
    requestCode: string;
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    requestDate: string;
    status?: string;
    rigCode?: string;
  }>;
}

export interface LinkageAiSuggestion {
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

const ACTIVE_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "OPEN",
  "IN_REPAIR",
  "WAITING_FOR_PARTS",
  "COMPLETED"
];

interface CandidateScore {
  score: number;
  reasons: string[];
}

function boostCandidate(
  map: Map<string, CandidateScore>,
  candidateId: string,
  increment: number,
  reason: string
) {
  const current = map.get(candidateId) || { score: 0, reasons: [] };
  current.score += increment;
  if (!current.reasons.includes(reason)) {
    current.reasons.push(reason);
  }
  map.set(candidateId, current);
}

function normalizeForCompare(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function toConfidence(score: number): LinkageSuggestionConfidence {
  if (score >= 0.75) {
    return "HIGH";
  }
  if (score >= 0.45) {
    return "MEDIUM";
  }
  return "LOW";
}

function formatScore(score: number) {
  return Math.max(0, Math.min(1, score));
}

function buildNoSuggestion(row: LinkageSuggestionInputRow): LinkageAiSuggestion {
  return {
    rowId: row.id,
    linkageType: row.linkageType,
    suggestedRigId: null,
    suggestedRigName: null,
    suggestedProjectId: null,
    suggestedProjectName: null,
    suggestedMaintenanceRequestId: null,
    suggestedMaintenanceRequestCode: null,
    confidence: "LOW",
    score: 0,
    reasoning: "No strong historical pattern was found. Use manual linkage selection."
  };
}

function pickTopCandidate(map: Map<string, CandidateScore>) {
  let topId: string | null = null;
  let top: CandidateScore | null = null;
  for (const [candidateId, candidate] of map.entries()) {
    if (!top || candidate.score > top.score) {
      topId = candidateId;
      top = candidate;
    }
  }
  return topId && top ? { candidateId: topId, candidate: top } : null;
}

function vendorMatches(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) {
    return false;
  }
  return left === right;
}

function daysBetween(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / 86400000;
}

function buildReasoning(reasons: string[]) {
  if (reasons.length === 0) {
    return "AI used available record fields and found weak matching signals.";
  }
  return reasons.slice(0, 3).join(" ");
}

export async function generateLinkageSuggestions({
  rows,
  lookups
}: {
  rows: LinkageSuggestionInputRow[];
  lookups: LinkageSuggestionLookups;
}) {
  const suggestions = await Promise.all(rows.map((row) => suggestRowLinkage({ row, lookups })));
  return suggestions;
}

async function suggestRowLinkage({
  row,
  lookups
}: {
  row: LinkageSuggestionInputRow;
  lookups: LinkageSuggestionLookups;
}): Promise<LinkageAiSuggestion> {
  if (row.linkageType === "RIG" && row.sourceRecordType === "EXPENSE") {
    return suggestRigForExpense({ row, lookups });
  }
  if (row.linkageType === "PROJECT" && row.sourceRecordType === "EXPENSE") {
    return suggestProjectForExpense({ row, lookups });
  }
  if (row.linkageType === "MAINTENANCE" && row.sourceRecordType === "INVENTORY_MOVEMENT") {
    return suggestMaintenanceForMovement({ row, lookups });
  }
  return buildNoSuggestion(row);
}

async function suggestRigForExpense({
  row,
  lookups
}: {
  row: LinkageSuggestionInputRow;
  lookups: LinkageSuggestionLookups;
}): Promise<LinkageAiSuggestion> {
  const expense = await prisma.expense.findUnique({
    where: { id: row.recordId },
    select: {
      id: true,
      date: true,
      category: true,
      subcategory: true,
      vendor: true,
      notes: true,
      clientId: true,
      projectId: true,
      project: {
        select: {
          assignedRigId: true
        }
      }
    }
  });
  if (!expense) {
    return buildNoSuggestion(row);
  }

  const candidates = new Map<string, CandidateScore>();

  if (expense.project?.assignedRigId) {
    boostCandidate(candidates, expense.project.assignedRigId, 0.62, "Project has an assigned rig that matches this spend context.");
  }

  if (expense.projectId) {
    const sameProject = await prisma.expense.findMany({
      where: {
        approvalStatus: "APPROVED",
        projectId: expense.projectId,
        rigId: { not: null }
      },
      select: {
        rigId: true
      },
      orderBy: [{ date: "desc" }],
      take: 60
    });
    const byRig = new Map<string, number>();
    for (const entry of sameProject) {
      if (!entry.rigId) continue;
      byRig.set(entry.rigId, (byRig.get(entry.rigId) || 0) + 1);
    }
    for (const [rigId, count] of byRig.entries()) {
      const increment = Math.min(0.34, count * 0.08);
      boostCandidate(candidates, rigId, increment, `Historical approved expenses for the same project frequently use this rig (${count} similar records).`);
    }
  }

  const vendorCategoryMatches = await prisma.expense.findMany({
    where: {
      approvalStatus: "APPROVED",
      rigId: { not: null },
      ...(expense.clientId ? { clientId: expense.clientId } : {}),
      ...(expense.category ? { category: expense.category } : {}),
      ...(expense.subcategory ? { subcategory: expense.subcategory } : {})
    },
    select: {
      rigId: true,
      vendor: true,
      date: true
    },
    orderBy: [{ date: "desc" }],
    take: 80
  });

  for (const entry of vendorCategoryMatches) {
    if (!entry.rigId) continue;
    let increment = 0.08;
    if (vendorMatches(entry.vendor, expense.vendor)) {
      increment += 0.14;
    }
    const days = daysBetween(entry.date, expense.date);
    if (days <= 30) {
      increment += 0.06;
    } else if (days <= 90) {
      increment += 0.03;
    }
    boostCandidate(
      candidates,
      entry.rigId,
      Math.min(0.24, increment),
      "Similar approved records (vendor/category/date proximity) point to this rig."
    );
  }

  const top = pickTopCandidate(candidates);
  if (!top) {
    return buildNoSuggestion(row);
  }

  const rigName = lookups.rigs.find((rig) => rig.id === top.candidateId)?.name || "Suggested Rig";
  const score = formatScore(top.candidate.score);

  return {
    rowId: row.id,
    linkageType: row.linkageType,
    suggestedRigId: top.candidateId,
    suggestedRigName: rigName,
    suggestedProjectId: null,
    suggestedProjectName: null,
    suggestedMaintenanceRequestId: null,
    suggestedMaintenanceRequestCode: null,
    confidence: toConfidence(score),
    score,
    reasoning: buildReasoning(top.candidate.reasons)
  };
}

async function suggestProjectForExpense({
  row,
  lookups
}: {
  row: LinkageSuggestionInputRow;
  lookups: LinkageSuggestionLookups;
}): Promise<LinkageAiSuggestion> {
  const expense = await prisma.expense.findUnique({
    where: { id: row.recordId },
    select: {
      id: true,
      date: true,
      category: true,
      subcategory: true,
      vendor: true,
      notes: true,
      clientId: true,
      projectId: true,
      rigId: true
    }
  });
  if (!expense) {
    return buildNoSuggestion(row);
  }

  const candidates = new Map<string, CandidateScore>();

  if (expense.rigId) {
    const assignedRigProjects = lookups.projects.filter((project) => {
      if (expense.clientId && project.clientId !== expense.clientId) {
        return false;
      }
      return true;
    });
    for (const project of assignedRigProjects) {
      boostCandidate(candidates, project.id, 0.16, "Project is in the same client scope and available for this record.");
    }

    const sameRigHistory = await prisma.expense.findMany({
      where: {
        approvalStatus: "APPROVED",
        rigId: expense.rigId,
        projectId: { not: null },
        ...(expense.clientId ? { clientId: expense.clientId } : {})
      },
      select: {
        projectId: true,
        vendor: true,
        date: true
      },
      orderBy: [{ date: "desc" }],
      take: 90
    });
    const projectCounts = new Map<string, number>();
    for (const entry of sameRigHistory) {
      if (!entry.projectId) continue;
      projectCounts.set(entry.projectId, (projectCounts.get(entry.projectId) || 0) + 1);
      if (vendorMatches(entry.vendor, expense.vendor)) {
        boostCandidate(candidates, entry.projectId, 0.08, "Vendor match found in similar approved rig-linked records.");
      }
    }
    for (const [projectId, count] of projectCounts.entries()) {
      const increment = Math.min(0.36, count * 0.06);
      boostCandidate(
        candidates,
        projectId,
        increment,
        `Historical approved records for this rig/client commonly map to this project (${count} records).`
      );
    }
  }

  const categoryProjectHistory = await prisma.expense.findMany({
    where: {
      approvalStatus: "APPROVED",
      projectId: { not: null },
      ...(expense.clientId ? { clientId: expense.clientId } : {}),
      ...(expense.category ? { category: expense.category } : {}),
      ...(expense.subcategory ? { subcategory: expense.subcategory } : {})
    },
    select: {
      projectId: true
    },
    orderBy: [{ date: "desc" }],
    take: 80
  });
  const categoryCounts = new Map<string, number>();
  for (const entry of categoryProjectHistory) {
    if (!entry.projectId) continue;
    categoryCounts.set(entry.projectId, (categoryCounts.get(entry.projectId) || 0) + 1);
  }
  for (const [projectId, count] of categoryCounts.entries()) {
    boostCandidate(
      candidates,
      projectId,
      Math.min(0.25, count * 0.05),
      "Similar category/subcategory spend patterns point to this project."
    );
  }

  const top = pickTopCandidate(candidates);
  if (!top) {
    return buildNoSuggestion(row);
  }

  const projectLabel =
    lookups.projects.find((project) => project.id === top.candidateId)?.name || "Suggested Project";
  const score = formatScore(top.candidate.score);

  return {
    rowId: row.id,
    linkageType: row.linkageType,
    suggestedRigId: null,
    suggestedRigName: null,
    suggestedProjectId: top.candidateId,
    suggestedProjectName: projectLabel,
    suggestedMaintenanceRequestId: null,
    suggestedMaintenanceRequestCode: null,
    confidence: toConfidence(score),
    score,
    reasoning: buildReasoning(top.candidate.reasons)
  };
}

async function suggestMaintenanceForMovement({
  row,
  lookups
}: {
  row: LinkageSuggestionInputRow;
  lookups: LinkageSuggestionLookups;
}): Promise<LinkageAiSuggestion> {
  const movement = await prisma.inventoryMovement.findUnique({
    where: { id: row.recordId },
    select: {
      id: true,
      date: true,
      itemId: true,
      rigId: true,
      projectId: true,
      clientId: true,
      expense: {
        select: {
          category: true,
          subcategory: true,
          vendor: true,
          notes: true
        }
      }
    }
  });
  if (!movement) {
    return buildNoSuggestion(row);
  }

  const movementDate = movement.date;
  const candidateRequests = await prisma.maintenanceRequest.findMany({
    where: {
      status: { in: ACTIVE_MAINTENANCE_STATUSES },
      ...(movement.rigId ? { rigId: movement.rigId } : {}),
      ...(movement.clientId ? { clientId: movement.clientId } : {})
    },
    select: {
      id: true,
      requestCode: true,
      requestDate: true,
      rigId: true,
      projectId: true,
      clientId: true
    },
    orderBy: [{ requestDate: "desc" }],
    take: 120
  });

  const candidates = new Map<string, CandidateScore>();
  for (const request of candidateRequests) {
    if (movement.rigId && request.rigId === movement.rigId) {
      boostCandidate(candidates, request.id, 0.34, "Maintenance request is on the same rig.");
    }
    if (movement.projectId && request.projectId === movement.projectId) {
      boostCandidate(candidates, request.id, 0.26, "Maintenance request is on the same project.");
    }
    if (movement.clientId && request.clientId && request.clientId === movement.clientId) {
      boostCandidate(candidates, request.id, 0.14, "Maintenance request is on the same client.");
    }

    const days = daysBetween(request.requestDate, movementDate);
    if (days <= 7) {
      boostCandidate(candidates, request.id, 0.22, "Request date is very close to movement date.");
    } else if (days <= 30) {
      boostCandidate(candidates, request.id, 0.14, "Request date is near movement date.");
    } else if (days <= 90) {
      boostCandidate(candidates, request.id, 0.08, "Request date is in a similar timeframe.");
    }
  }

  if (movement.itemId) {
    const historicalLinked = await prisma.inventoryMovement.findMany({
      where: {
        movementType: "OUT",
        maintenanceRequestId: { not: null },
        itemId: movement.itemId,
        ...(movement.rigId ? { rigId: movement.rigId } : {}),
        ...(movement.projectId ? { projectId: movement.projectId } : {})
      },
      select: {
        maintenanceRequestId: true
      },
      orderBy: [{ date: "desc" }],
      take: 100
    });
    const requestCounts = new Map<string, number>();
    for (const entry of historicalLinked) {
      if (!entry.maintenanceRequestId) continue;
      requestCounts.set(entry.maintenanceRequestId, (requestCounts.get(entry.maintenanceRequestId) || 0) + 1);
    }
    for (const [requestId, count] of requestCounts.entries()) {
      boostCandidate(
        candidates,
        requestId,
        Math.min(0.28, count * 0.07),
        `Similar historical inventory movements for this item were linked to this maintenance request (${count} records).`
      );
    }
  }

  const top = pickTopCandidate(candidates);
  if (!top) {
    return buildNoSuggestion(row);
  }

  const requestLabel =
    lookups.maintenanceRequests.find((request) => request.id === top.candidateId)?.requestCode ||
    candidateRequests.find((request) => request.id === top.candidateId)?.requestCode ||
    "Suggested Maintenance Request";
  const score = formatScore(top.candidate.score);

  return {
    rowId: row.id,
    linkageType: row.linkageType,
    suggestedRigId: null,
    suggestedRigName: null,
    suggestedProjectId: null,
    suggestedProjectName: null,
    suggestedMaintenanceRequestId: top.candidateId,
    suggestedMaintenanceRequestCode: requestLabel,
    confidence: toConfidence(score),
    score,
    reasoning: buildReasoning(top.candidate.reasons)
  };
}
