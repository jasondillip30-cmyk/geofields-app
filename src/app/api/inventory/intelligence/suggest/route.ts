import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  buildLearningContextFromAuditLogs,
  confidenceLabel,
  formatCategoryLabel,
  inferCategorySuggestion,
  suggestSimilarCategoryNames
} from "@/lib/inventory-intelligence";
import { parseInventoryCategory } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() || "";
  const sku = request.nextUrl.searchParams.get("sku")?.trim() || "";
  const description = request.nextUrl.searchParams.get("description")?.trim() || "";
  const supplierId = request.nextUrl.searchParams.get("supplierId")?.trim() || "";
  const selectedCategory = parseInventoryCategory(request.nextUrl.searchParams.get("selectedCategory"));
  const customCategoryInput = request.nextUrl.searchParams.get("customCategory")?.trim() || "";

  if (!name && !sku && !description) {
    return NextResponse.json({
      suggestedCategory: null,
      confidence: "NONE",
      confidenceLabel: confidenceLabel("NONE"),
      reason: "Enter item details to get a category suggestion.",
      matchedKeywords: [],
      similarItems: [],
      alternatives: [],
      mismatchWarning: null,
      existingCategoryNames: [],
      similarCategoryNames: []
    });
  }

  const [items, supplier, learningLogs] = await Promise.all([
    prisma.inventoryItem.findMany({
      select: {
        id: true,
        name: true,
        category: true
      }
    }),
    supplierId
      ? prisma.inventorySupplier.findUnique({
          where: { id: supplierId },
          select: { id: true, name: true }
        })
      : Promise.resolve(null),
    prisma.auditLog.findMany({
      where: {
        module: "inventory",
        entityType: "inventory_item",
        action: { in: ["edit", "merge"] }
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        action: true,
        beforeValueJson: true,
        afterValueJson: true
      }
    })
  ]);

  const learningContext = buildLearningContextFromAuditLogs(learningLogs);

  const suggestion = inferCategorySuggestion({
    name,
    sku,
    description,
    supplierName: supplier?.name || null,
    existingItems: items,
    learningContext
  });

  const mismatchWarning =
    selectedCategory &&
    suggestion.suggestedCategory &&
    suggestion.confidence !== "NONE" &&
    selectedCategory !== suggestion.suggestedCategory
      ? `This item is usually categorized as ${formatCategoryLabel(suggestion.suggestedCategory)}. Keep or switch?`
      : null;

  const existingCategoryNames = Array.from(
    new Set(items.map((item) => formatCategoryLabel(item.category)))
  ).sort((a, b) => a.localeCompare(b));

  const similarCategoryNames = customCategoryInput
    ? suggestSimilarCategoryNames(customCategoryInput, existingCategoryNames)
    : [];

  return NextResponse.json({
    suggestedCategory: suggestion.suggestedCategory,
    confidence: suggestion.confidence,
    confidenceLabel: confidenceLabel(suggestion.confidence),
    reason: suggestion.reason,
    matchedKeywords: suggestion.matchedKeywords,
    similarItems: suggestion.similarItems.slice(0, 5),
    alternatives: suggestion.alternatives.map((entry) => ({
      category: entry.category,
      label: formatCategoryLabel(entry.category),
      score: entry.score
    })),
    mismatchWarning,
    existingCategoryNames,
    similarCategoryNames
  });
}
