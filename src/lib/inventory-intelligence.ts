import type { InventoryCategory, InventoryMovement, InventoryItem, InventorySupplier } from "@prisma/client";

type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
type IssueSeverity = "HIGH" | "MEDIUM" | "LOW";

interface ParsedNameSignature {
  displaySignature: string;
  normalized: string;
  tokens: string[];
  tokenSetSignature: string;
  orderSignature: string;
  compactSignature: string;
  baseTokens: string[];
  baseSignature: string;
}

type NamingEntry = {
  item: Pick<InventoryItem, "id" | "name" | "category">;
  signature: ParsedNameSignature;
};

interface InventoryLearningContext {
  categoryByNameKey: Map<string, { category: InventoryCategory; count: number }>;
  canonicalNameByKey: Map<string, { canonical: string; count: number }>;
}

export interface CategorySuggestionResult {
  suggestedCategory: InventoryCategory | null;
  confidence: SuggestionConfidence;
  reason: string;
  matchedKeywords: string[];
  similarItems: Array<{ id: string; name: string; category: InventoryCategory }>;
  alternatives: Array<{ category: InventoryCategory; score: number }>;
}

export interface InventoryIssue {
  id: string;
  type: "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY";
  severity: IssueSeverity;
  title: string;
  message: string;
  suggestion: string;
  itemIds: string[];
  suggestedCategory?: InventoryCategory;
  suggestedName?: string;
  confidence?: SuggestionConfidence;
  autoFixSafe?: boolean;
  affectedCategory?: InventoryCategory;
}

const categoryKeywords: Record<InventoryCategory, string[]> = {
  DRILLING: ["drill", "bit", "rod", "hammer", "shroud", "bore", "rc", "core", "reamer"],
  HYDRAULIC: ["hydraulic", "hose", "pump", "seal", "ram", "valve", "cylinder"],
  ELECTRICAL: ["electrical", "relay", "wiring", "cable", "alternator", "battery", "sensor", "switch"],
  CONSUMABLES: ["grease", "glove", "cleaner", "cloth", "sealant", "compound", "consumable"],
  TIRES: ["tire", "tyre", "wheel", "rim"],
  OILS: ["oil", "lubricant", "engine oil", "hydraulic oil", "gear oil", "compressor oil"],
  FILTERS: ["filter", "fuel filter", "oil filter", "air filter", "strainer"],
  SPARE_PARTS: ["spare", "bearing", "belt", "kit", "bushing", "coupling", "gasket", "shaft", "fan"],
  OTHER: ["other", "misc", "general"]
};

const allCategories = Object.keys(categoryKeywords) as InventoryCategory[];
const connectorTokens = new Set(["for", "and", "with", "the", "of"]);
const vagueNamePatterns = [/^(item|items|stuff|misc|unknown|test|sample)$/i, /^(item|part|stuff|misc)[\s_-]*\d+$/i, /^part\d+$/i];

export function inferCategorySuggestion({
  name,
  sku,
  description,
  supplierName,
  existingItems,
  learningContext
}: {
  name: string;
  sku?: string | null;
  description?: string | null;
  supplierName?: string | null;
  existingItems: Array<Pick<InventoryItem, "id" | "name" | "category">>;
  learningContext?: InventoryLearningContext;
}): CategorySuggestionResult {
  const textName = normalizeText(name);
  const textSku = normalizeText(sku || "");
  const textDescription = normalizeText(description || "");
  const textSupplier = normalizeText(supplierName || "");
  const fullText = `${textName} ${textSku} ${textDescription} ${textSupplier}`.trim();

  const categoryScore = new Map<InventoryCategory, number>();
  const keywordHits = new Map<InventoryCategory, Set<string>>();
  for (const category of allCategories) {
    categoryScore.set(category, 0);
    keywordHits.set(category, new Set());
  }

  for (const category of allCategories) {
    const keywords = categoryKeywords[category];
    for (const keyword of keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) {
        continue;
      }

      let points = 0;
      if (containsKeywordPhrase(textName, normalizedKeyword)) {
        points += 5;
      }
      if (containsKeywordPhrase(textSku, normalizedKeyword)) {
        points += 3;
      }
      if (containsKeywordPhrase(textDescription, normalizedKeyword)) {
        points += 2;
      }
      if (containsKeywordPhrase(textSupplier, normalizedKeyword)) {
        points += 1;
      }

      if (points > 0) {
        categoryScore.set(category, (categoryScore.get(category) || 0) + points);
        keywordHits.get(category)?.add(keyword);
      }
    }
  }

  const similarItems = findSimilarItems({ name, existingItems }).slice(0, 6);
  if (similarItems.length > 0) {
    const byCategory = new Map<InventoryCategory, number>();
    for (const item of similarItems) {
      byCategory.set(item.category, (byCategory.get(item.category) || 0) + 1);
    }
    for (const [category, count] of byCategory.entries()) {
      categoryScore.set(category, (categoryScore.get(category) || 0) + count * 4);
    }
  }

  const learnedCategory = learningContext?.categoryByNameKey.get(normalizedNameKey(name));
  if (learnedCategory && learnedCategory.count > 0) {
    categoryScore.set(
      learnedCategory.category,
      (categoryScore.get(learnedCategory.category) || 0) + learnedCategory.count * 4
    );
  }

  const ranked = allCategories
    .map((category) => ({
      category,
      score: categoryScore.get(category) || 0
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  const noStrongSignal = !top || top.score <= 0 || !fullText;

  if (noStrongSignal) {
    return {
      suggestedCategory: null,
      confidence: "NONE",
      reason: "No strong category match found.",
      matchedKeywords: [],
      similarItems,
      alternatives: ranked.slice(0, 3)
    };
  }

  const scoreGap = top.score - (second?.score || 0);
  let confidence: SuggestionConfidence = "LOW";
  if (top.score >= 8 && scoreGap >= 4) {
    confidence = "HIGH";
  } else if (top.score >= 5 && scoreGap >= 2) {
    confidence = "MEDIUM";
  }

  const matchedKeywords = Array.from(keywordHits.get(top.category) || []);
  const lowConfidenceAmbiguous =
    confidence === "LOW" &&
    matchedKeywords.length <= 1 &&
    similarItems.length === 0 &&
    top.score < 6;
  if (lowConfidenceAmbiguous) {
    return {
      suggestedCategory: null,
      confidence: "NONE",
      reason: "Low confidence category signal. Keep as Uncategorized and confirm manually.",
      matchedKeywords,
      similarItems,
      alternatives: ranked.slice(0, 3)
    };
  }
  const reasonParts: string[] = [];
  if (matchedKeywords.length > 0) {
    reasonParts.push(`Based on keywords: ${matchedKeywords.slice(0, 4).join(", ")}`);
  }
  if (similarItems.length > 0) {
    reasonParts.push(`Based on ${similarItems.length} similar item(s)`);
  }

  return {
    suggestedCategory: top.category,
    confidence,
    reason: reasonParts.join(". ") || "Based on item pattern.",
    matchedKeywords,
    similarItems,
    alternatives: ranked.slice(0, 3)
  };
}

export function detectInventoryIssues({
  items,
  movements,
  suppliersById,
  learningContext
}: {
  items: Array<
    Pick<InventoryItem, "id" | "name" | "sku" | "category" | "quantityInStock" | "minimumStockLevel" | "unitCost" | "status" | "supplierId" | "createdAt"> & {
      description?: string | null;
    }
  >;
  movements: Array<Pick<InventoryMovement, "id" | "itemId" | "movementType" | "quantity" | "unitCost" | "date">>;
  suppliersById: Map<string, Pick<InventorySupplier, "id" | "name">>;
  learningContext?: InventoryLearningContext;
}) {
  const issues: InventoryIssue[] = [];
  const usageByItem = new Map<string, number>();
  const inCostsByItem = new Map<string, number[]>();

  for (const movement of movements) {
    if (movement.movementType === "OUT") {
      usageByItem.set(movement.itemId, (usageByItem.get(movement.itemId) || 0) + Math.max(0, movement.quantity));
    }
    if (movement.movementType === "IN" && movement.unitCost !== null && movement.unitCost !== undefined) {
      const current = inCostsByItem.get(movement.itemId) || [];
      current.push(movement.unitCost);
      inCostsByItem.set(movement.itemId, current);
    }
  }

  const byNormalizedName = new Map<string, typeof items>();
  const byNormalizedSku = new Map<string, typeof items>();
  for (const item of items) {
    const key = normalizedNameKey(item.name);
    const bucket = byNormalizedName.get(key) || [];
    bucket.push(item);
    byNormalizedName.set(key, bucket);

    const skuKey = normalizedSkuKey(item.sku || "");
    if (skuKey) {
      const skuBucket = byNormalizedSku.get(skuKey) || [];
      skuBucket.push(item);
      byNormalizedSku.set(skuKey, skuBucket);
    }
  }

  for (const [, group] of byNormalizedName.entries()) {
    if (group.length < 2) {
      continue;
    }
    const distinctCategories = new Set(group.map((entry) => entry.category));
    if (distinctCategories.size > 1) {
      const primary = group[0];
      const suggestion = inferCategorySuggestion({
        name: primary.name,
        description: primary.description || "",
        existingItems: items.map((entry) => ({ id: entry.id, name: entry.name, category: entry.category })),
        supplierName: primary.supplierId ? suppliersById.get(primary.supplierId)?.name || null : null,
        learningContext
      });
      const combinedUsage = group.reduce((sum, entry) => sum + (usageByItem.get(entry.id) || 0), 0);
      const conflictSeverity: IssueSeverity = combinedUsage > 0 ? "HIGH" : "MEDIUM";

      issues.push({
        id: `category-conflict-${group.map((entry) => entry.id).join("-")}`,
        type: "CATEGORY_CONFLICT",
        severity: conflictSeverity,
        title: "Category inconsistency detected",
        message: `${group.length} similar items are assigned to different categories.`,
        suggestion:
          suggestion.suggestedCategory && suggestion.confidence !== "NONE"
            ? `Consider standardizing to ${formatCategoryLabel(suggestion.suggestedCategory)}.`
            : "Review similar items and standardize category assignment.",
        itemIds: group.map((entry) => entry.id),
        suggestedCategory: suggestion.suggestedCategory || undefined,
        confidence: suggestion.confidence,
        affectedCategory: primary.category
      });
    }

    const duplicateSeverity: IssueSeverity = group.some((entry) => (usageByItem.get(entry.id) || 0) > 0) ? "HIGH" : "MEDIUM";
    issues.push({
      id: `duplicate-${group.map((entry) => entry.id).join("-")}`,
      type: "DUPLICATE_ITEM",
      severity: duplicateSeverity,
      title: "Possible duplicate item records",
      message: `${group.length} items have very similar names.`,
      suggestion: "Review duplicates and merge or rename records to maintain one canonical item.",
      itemIds: group.map((entry) => entry.id),
      confidence: group.length >= 3 ? "HIGH" : "MEDIUM",
      affectedCategory: group[0]?.category
    });

    const groupedCosts = group.map((entry) => entry.unitCost).filter((value) => value > 0);
    if (groupedCosts.length >= 2) {
      const min = Math.min(...groupedCosts);
      const max = Math.max(...groupedCosts);
      const avg = groupedCosts.reduce((sum, value) => sum + value, 0) / groupedCosts.length;
      const ratio = avg > 0 ? (max - min) / avg : 0;
      if (ratio >= 0.5) {
        issues.push({
          id: `price-group-${group.map((entry) => entry.id).join("-")}`,
          type: "PRICE_ANOMALY",
          severity: ratio >= 1 ? "HIGH" : "MEDIUM",
          title: "Price mismatch across similar items",
          message: `${group.length} similar items have significantly different unit costs.`,
          suggestion: "Review supplier pricing and standardize item records to a consistent cost baseline.",
          itemIds: group.map((entry) => entry.id),
          confidence: ratio >= 1 ? "HIGH" : "MEDIUM",
          affectedCategory: group[0]?.category
        });
      }
    }
  }

  for (const [skuKey, group] of byNormalizedSku.entries()) {
    if (!skuKey || group.length < 2) {
      continue;
    }
    issues.push({
      id: `duplicate-sku-${skuKey}-${group.map((entry) => entry.id).join("-")}`,
      type: "DUPLICATE_ITEM",
      severity: "HIGH",
      title: "Duplicate SKU detected",
      message: `${group.length} items share the same SKU pattern.`,
      suggestion: "Merge duplicate records or update SKU values to keep each item uniquely identifiable.",
      itemIds: group.map((entry) => entry.id),
      confidence: "HIGH",
      affectedCategory: group[0]?.category
    });
  }

  issues.push(
    ...detectNamingIssues(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category
      })),
      learningContext
    )
  );

  for (const item of items) {
    if (item.quantityInStock < 0) {
      issues.push({
        id: `stock-negative-${item.id}`,
        type: "STOCK_ANOMALY",
        severity: "HIGH",
        title: "Negative stock detected",
        message: `${item.name} has negative quantity in stock (${item.quantityInStock}).`,
        suggestion: "Audit stock movements and apply a correction adjustment.",
        itemIds: [item.id],
        confidence: "HIGH",
        affectedCategory: item.category
      });
    }

    const usage = usageByItem.get(item.id) || 0;
    if (item.status === "ACTIVE" && usage === 0) {
      issues.push({
        id: `stock-unused-${item.id}`,
        type: "STOCK_ANOMALY",
        severity: "LOW",
        title: "Active item has no usage history",
        message: `${item.name} is active but has no recorded usage.`,
        suggestion: "Confirm if this item should remain active or verify movement logging.",
        itemIds: [item.id],
        confidence: "LOW",
        affectedCategory: item.category
      });
    }

    if (usage > 0 && item.quantityInStock > usage * 8) {
      issues.push({
        id: `stock-high-${item.id}`,
        type: "STOCK_ANOMALY",
        severity: "LOW",
        title: "Stock level appears unusually high",
        message: `${item.name} stock is much higher than recent consumption.`,
        suggestion: "Review reorder policy and consider reducing overstock for this item.",
        itemIds: [item.id],
        confidence: "LOW",
        affectedCategory: item.category
      });
    }

    const costs = inCostsByItem.get(item.id) || [];
    if (costs.length >= 2) {
      const min = Math.min(...costs);
      const max = Math.max(...costs);
      const avg = costs.reduce((sum, value) => sum + value, 0) / costs.length;
      const varianceRatio = avg > 0 ? (max - min) / avg : 0;
      if (varianceRatio >= 0.5) {
        issues.push({
          id: `price-anomaly-${item.id}`,
          type: "PRICE_ANOMALY",
          severity: varianceRatio >= 1 ? "HIGH" : "MEDIUM",
          title: "Price inconsistency detected",
          message: `${item.name} unit cost varies significantly across purchases.`,
          suggestion: "Review supplier pricing and negotiate stable rates or standardize sourcing.",
          itemIds: [item.id],
          confidence: varianceRatio >= 1 ? "HIGH" : "MEDIUM",
          affectedCategory: item.category
        });
      }
    }
  }

  return dedupeIssues(issues);
}

export function confidenceLabel(confidence: SuggestionConfidence) {
  if (confidence === "HIGH") return "High";
  if (confidence === "MEDIUM") return "Medium";
  if (confidence === "LOW") return "Low";
  return "No match";
}

export function formatCategoryLabel(category: InventoryCategory) {
  return category
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function suggestSimilarCategoryNames(input: string, existing: string[]) {
  const normalizedInput = normalizeText(input);
  if (!normalizedInput) {
    return [];
  }
  return existing
    .map((name) => ({
      name,
      score: similarityScore(normalizedInput, normalizeText(name))
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.name);
}

export function buildLearningContextFromAuditLogs(
  logs: Array<{ action: string; beforeValueJson: string | null; afterValueJson: string | null }>
) {
  const categoryVote = new Map<string, Map<InventoryCategory, number>>();
  const canonicalVote = new Map<string, Map<string, number>>();

  for (const log of logs) {
    const before = safeParseJson(log.beforeValueJson);
    const after = safeParseJson(log.afterValueJson);
    if (!before && !after) {
      continue;
    }

    const beforeName = readString(before, ["name"]) || readString(before, ["primary", "name"]);
    const afterName = readString(after, ["name"]) || readString(after, ["primary", "name"]);
    const beforeCategory = readCategory(before, ["category"]) || readCategory(before, ["primary", "category"]);
    const afterCategory = readCategory(after, ["category"]) || readCategory(after, ["primary", "category"]);
    const canonicalName = afterName || beforeName;

    if (canonicalName) {
      const key = normalizedNameKey(canonicalName);
      if (afterName && beforeName && normalizeText(afterName) !== normalizeText(beforeName)) {
        pushVote(canonicalVote, key, standardizeInventoryItemName(afterName).name, 1);
      } else if (afterName) {
        pushVote(canonicalVote, key, standardizeInventoryItemName(afterName).name, 0.5);
      }
    }

    if (canonicalName && (afterCategory || beforeCategory)) {
      const key = normalizedNameKey(canonicalName);
      const category = afterCategory || beforeCategory;
      if (category) {
        pushCategoryVote(categoryVote, key, category, afterCategory && beforeCategory && afterCategory !== beforeCategory ? 2 : 1);
      }
    }

    if (log.action === "merge") {
      const mergedIds = readArray(after, ["mergedDuplicateIds"]);
      const mergedObjects = readArray(before, ["duplicates"]);
      const duplicates = mergedIds.length > 0 ? mergedIds : mergedObjects;
      if (duplicates.length > 0 && canonicalName) {
        const key = normalizedNameKey(canonicalName);
        pushVote(canonicalVote, key, standardizeInventoryItemName(canonicalName).name, duplicates.length);
      }
    }
  }

  const categoryByNameKey = new Map<string, { category: InventoryCategory; count: number }>();
  for (const [key, votes] of categoryVote.entries()) {
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) {
      continue;
    }
    categoryByNameKey.set(key, {
      category: best[0],
      count: best[1]
    });
  }

  const canonicalNameByKey = new Map<string, { canonical: string; count: number }>();
  for (const [key, votes] of canonicalVote.entries()) {
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) {
      continue;
    }
    canonicalNameByKey.set(key, {
      canonical: best[0],
      count: best[1]
    });
  }

  return {
    categoryByNameKey,
    canonicalNameByKey
  } satisfies InventoryLearningContext;
}

export function standardizeInventoryItemName(value: string, learningContext?: InventoryLearningContext) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { name: "", changed: false, safe: true };
  }

  const learned = learningContext?.canonicalNameByKey.get(normalizedNameKey(trimmed));
  if (learned?.canonical && learned.count >= 2) {
    return {
      name: learned.canonical,
      changed: normalizeText(trimmed) !== normalizeText(learned.canonical),
      safe: true
    };
  }

  const tokens = trimmed
    .split(/\s+/g)
    .filter(Boolean)
    .map((token) => formatNamingToken(token));
  const formatted = tokens.join(" ").replace(/\s+/g, " ").trim();
  return {
    name: formatted,
    changed: normalizeText(trimmed) !== normalizeText(formatted) || trimmed !== formatted,
    safe: true
  };
}

function findSimilarItems({
  name,
  existingItems
}: {
  name: string;
  existingItems: Array<Pick<InventoryItem, "id" | "name" | "category">>;
}) {
  const normalizedInput = normalizeText(name);
  if (!normalizedInput) {
    return [];
  }
  return existingItems
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      score: similarityScore(normalizedInput, normalizeText(item.name))
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score);
}

function dedupeIssues(issues: InventoryIssue[]) {
  const seen = new Set<string>();
  const output: InventoryIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.id)) {
      continue;
    }
    seen.add(issue.id);
    output.push(issue);
  }
  return output;
}

function detectNamingIssues(
  items: Array<Pick<InventoryItem, "id" | "name" | "category">>,
  learningContext?: InventoryLearningContext
) {
  const issues: InventoryIssue[] = [];
  const entries: NamingEntry[] = items.map((item) => ({
    item,
    signature: parseNameSignature(item.name)
  }));

  for (const entry of entries) {
    if (!entry.signature.normalized) {
      continue;
    }
    if (isLikelyPoorName(entry.signature)) {
      const standardized = standardizeInventoryItemName(entry.signature.displaySignature, learningContext);
      issues.push({
        id: `naming-quality-${entry.item.id}`,
        type: "NAMING_INCONSISTENCY",
        severity: "LOW",
        title: "Low naming quality",
        message: "Name is too generic or unclear for operational reporting.",
        suggestion: "Use a descriptive format like: [Item Type] [Specification] (for example: Engine Oil 15W-40).",
        itemIds: [entry.item.id],
        suggestedName: standardized.name || undefined,
        confidence: "LOW",
        autoFixSafe: standardized.safe,
        affectedCategory: entry.item.category
      });
    }
  }

  const byContext = new Map<string, NamingEntry[]>();
  for (const entry of entries) {
    const contextSignature = entry.signature.baseSignature || entry.signature.tokenSetSignature;
    if (!contextSignature) {
      continue;
    }
    const key = `${entry.item.category}::${contextSignature}`;
    const bucket = byContext.get(key) || [];
    bucket.push(entry);
    byContext.set(key, bucket);
  }

  for (const [, contextEntries] of byContext.entries()) {
    if (contextEntries.length < 2) {
      continue;
    }

    const byTokenSet = new Map<string, NamingEntry[]>();
    for (const entry of contextEntries) {
      const tokenKey = entry.signature.tokenSetSignature || entry.signature.compactSignature;
      if (!tokenKey) {
        continue;
      }
      const bucket = byTokenSet.get(tokenKey) || [];
      bucket.push(entry);
      byTokenSet.set(tokenKey, bucket);
    }

    for (const [, group] of byTokenSet.entries()) {
      if (group.length < 2) {
        continue;
      }

      const confidence = namingConsistencyConfidence(group.map((entry) => entry.signature));
      if (confidence === "LOW") {
        continue;
      }

      const distinctPresentation = new Set(group.map((entry) => entry.signature.displaySignature));
      const distinctOrder = new Set(group.map((entry) => entry.signature.orderSignature));
      const hasCompressed = group.some((entry) => isCompressedFormat(entry.signature));
      const hasFormattingVariance = distinctPresentation.size > 1 || distinctOrder.size > 1 || hasCompressed;
      if (!hasFormattingVariance) {
        continue;
      }

      const canonical = chooseCanonicalNamingEntry(group);
      for (const candidate of group) {
        if (candidate.item.id === canonical.item.id) {
          continue;
        }

        if (candidate.signature.displaySignature === canonical.signature.displaySignature) {
          continue;
        }

        const standardized = standardizeInventoryItemName(candidate.signature.displaySignature, learningContext);
        issues.push({
          id: `naming-format-${canonical.item.id}-${candidate.item.id}`,
          type: "NAMING_INCONSISTENCY",
          severity: distinctOrder.size > 1 || isCompressedFormat(candidate.signature) ? "MEDIUM" : "LOW",
          title: "Naming format inconsistency",
          message: "Naming format differs from similar items in this category.",
          suggestion: `This item name can be standardized for easier search and reporting.`,
          itemIds: [candidate.item.id, canonical.item.id],
          suggestedName: standardized.name || canonical.signature.displaySignature,
          confidence: distinctOrder.size > 1 ? "MEDIUM" : "LOW",
          autoFixSafe: standardized.safe,
          affectedCategory: candidate.item.category
        });
      }
    }
  }

  return issues;
}

function normalizedNameKey(value: string) {
  const normalized = normalizeText(value);
  return normalized
    .replace(/\b(new|old|spare|part|parts|item|kit)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSkuKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsKeywordPhrase(text: string, keyword: string) {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedText || !normalizedKeyword) {
    return false;
  }
  const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escapedKeyword}\\b`, "i");
  return pattern.test(normalizedText);
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function parseNameSignature(value: string): ParsedNameSignature {
  const displaySignature = value.trim().replace(/\s+/g, " ");
  const normalized = normalizeNameForComparison(displaySignature);
  const tokens = normalized.split(" ").filter(Boolean);
  const tokenSetSignature = [...tokens].sort().join("|");
  const orderSignature = tokens.join("|");
  const compactSignature = tokens.join("");
  const baseTokens = tokens.filter((token) => !isSpecToken(token) && !connectorTokens.has(token));
  const baseSignature = [...baseTokens].sort().join("|");
  return {
    displaySignature,
    normalized,
    tokens,
    tokenSetSignature,
    orderSignature,
    compactSignature,
    baseTokens,
    baseSignature
  };
}

function normalizeNameForComparison(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[_/().,;-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isSpecToken(token: string) {
  if (!token) {
    return false;
  }
  if (/\d/.test(token)) {
    return true;
  }
  if (/^(mm|cm|m|l|lt|ltr|kg|g|bar|psi|kw|hp|v|ah|amp|amps|volts?)$/.test(token)) {
    return true;
  }
  return token.length === 1;
}

function isLikelyPoorName(signature: ParsedNameSignature) {
  if (!signature.normalized) {
    return false;
  }
  if (vagueNamePatterns.some((pattern) => pattern.test(signature.normalized))) {
    return true;
  }
  if (signature.tokens.length === 1) {
    const token = signature.tokens[0];
    if (/^(item|part|stuff|misc|unknown|test|sample)\d*$/i.test(token)) {
      return true;
    }
  }
  return false;
}

function namingConsistencyConfidence(signatures: ParsedNameSignature[]) {
  if (signatures.length >= 3) {
    return "HIGH";
  }
  if (signatures.length === 2 && signatures[0].tokens.length >= 2 && signatures[1].tokens.length >= 2) {
    return "MEDIUM";
  }
  return "LOW";
}

function chooseCanonicalNamingEntry(entries: NamingEntry[]) {
  return [...entries].sort((a, b) => namingQualityScore(b.signature) - namingQualityScore(a.signature))[0] || entries[0];
}

function namingQualityScore(signature: ParsedNameSignature) {
  let score = 0;
  if (signature.tokens.length >= 2) {
    score += 2;
  }
  if (!isCompressedFormat(signature)) {
    score += 2;
  }
  if (isPreferredNameCasing(signature.displaySignature)) {
    score += 2;
  }
  if (signature.displaySignature === toTitleCase(signature.displaySignature)) {
    score += 1;
  }
  if (isLikelyPoorName(signature)) {
    score -= 3;
  }
  return score;
}

function isCompressedFormat(signature: ParsedNameSignature) {
  const compact = signature.displaySignature.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  if (signature.tokens.length <= 1 && compact.length >= 10) {
    return true;
  }
  return !signature.displaySignature.includes(" ") && /[a-z]/i.test(compact) && /\d/.test(compact);
}

function isPreferredNameCasing(value: string) {
  const words = value
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  const alphaWords = words.filter((word) => /[A-Za-z]/.test(word) && !/\d/.test(word));
  if (alphaWords.length === 0) {
    return true;
  }

  const validCount = alphaWords.filter((word) => /^[A-Z][a-z]+$/.test(word) || /^[A-Z]{2,5}$/.test(word)).length;
  return validCount / alphaWords.length >= 0.7;
}

function similarityScore(a: string, b: string) {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function safeParseJson(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readString(root: unknown, path: string[]) {
  const value = readPath(root, path);
  return typeof value === "string" ? value : "";
}

function readArray(root: unknown, path: string[]) {
  const value = readPath(root, path);
  return Array.isArray(value) ? value : [];
}

function readCategory(root: unknown, path: string[]) {
  const value = readString(root, path).trim().toUpperCase();
  if (
    value === "DRILLING" ||
    value === "HYDRAULIC" ||
    value === "ELECTRICAL" ||
    value === "CONSUMABLES" ||
    value === "TIRES" ||
    value === "OILS" ||
    value === "FILTERS" ||
    value === "SPARE_PARTS" ||
    value === "OTHER"
  ) {
    return value as InventoryCategory;
  }
  return null;
}

function readPath(root: unknown, path: string[]) {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function pushVote(target: Map<string, Map<string, number>>, key: string, value: string, weight: number) {
  if (!key || !value) {
    return;
  }
  const bucket = target.get(key) || new Map<string, number>();
  bucket.set(value, (bucket.get(value) || 0) + weight);
  target.set(key, bucket);
}

function pushCategoryVote(
  target: Map<string, Map<InventoryCategory, number>>,
  key: string,
  category: InventoryCategory,
  weight: number
) {
  if (!key) {
    return;
  }
  const bucket = target.get(key) || new Map<InventoryCategory, number>();
  bucket.set(category, (bucket.get(category) || 0) + weight);
  target.set(key, bucket);
}

function formatNamingToken(token: string) {
  const clean = token.trim();
  if (!clean) {
    return "";
  }
  if (/^\d+[wW][-]?\d+$/.test(clean)) {
    const normalized = clean.toUpperCase().replace(/W(\d+)$/, "W-$1");
    return normalized.includes("-") ? normalized : normalized.replace(/W/, "W-");
  }
  if (/^\d+[vV]$/.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^\d+\/\d+$/.test(clean)) {
    return clean;
  }
  if (/^\d+[rR]\d+(\.\d+)?$/.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^[A-Z]{2,6}$/.test(clean)) {
    return clean;
  }
  if (/^(rc|pvc|api|gf)$/i.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^[a-zA-Z]+-\d+$/i.test(clean)) {
    const [left, right] = clean.split("-");
    return `${capitalizeWord(left)}-${right}`;
  }
  return capitalizeWord(clean.toLowerCase());
}

function capitalizeWord(value: string) {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
