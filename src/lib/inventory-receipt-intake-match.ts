import {
  normalizeCompactName,
  normalizeName,
  similarityScore,
  splitNormalizedTokens,
  tokenOverlapScore
} from "@/lib/inventory-receipt-intake-parse-utils";
import { roundCurrency } from "@/lib/inventory-server";

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface InventoryMatchItem {
  id: string;
  name: string;
  sku: string;
}

export interface ReceiptLineMatchSuggestionResult {
  itemId: string | null;
  itemName: string | null;
  confidence: MatchConfidence;
  score: number;
}

export function suggestInventoryMatch(
  description: string,
  items: InventoryMatchItem[]
): ReceiptLineMatchSuggestionResult {
  const normalizedDescription = normalizeName(description);
  const compactDescription = normalizeCompactName(description);
  const descriptionTokens = splitNormalizedTokens(normalizedDescription);
  const hasStrongDescriptionSignal =
    normalizedDescription.length >= 3 || descriptionTokens.some((token) => token.length >= 3);
  const hasSpecificDescriptionSignal =
    descriptionTokens.filter((token) => token.length >= 3).length >= 2;
  if (!normalizedDescription || items.length === 0) {
    return {
      itemId: null,
      itemName: null,
      confidence: "NONE",
      score: 0
    };
  }
  if (!hasStrongDescriptionSignal) {
    return {
      itemId: null,
      itemName: null,
      confidence: "NONE",
      score: 0
    };
  }

  let best: { id: string; name: string; score: number } | null = null;
  let secondBest: { id: string; name: string; score: number } | null = null;
  for (const item of items) {
    if (!item.id || !item.name) {
      continue;
    }
    const normalizedName = normalizeName(item.name);
    const normalizedSku = normalizeName(item.sku);
    const compactName = normalizeCompactName(item.name);
    const compactSku = normalizeCompactName(item.sku);
    if (!normalizedName && !normalizedSku) {
      continue;
    }
    const itemTokens = splitNormalizedTokens(normalizedName);
    let score = similarityScore(normalizedDescription, normalizedName);
    score = Math.max(score, tokenOverlapScore(descriptionTokens, itemTokens));

    if (normalizedDescription === normalizedName) {
      score = 1;
    } else if (compactDescription && compactName && compactDescription === compactName) {
      score = Math.max(score, 0.96);
    } else if (
      hasSpecificDescriptionSignal &&
      compactDescription &&
      compactName &&
      (compactDescription.includes(compactName) || compactName.includes(compactDescription))
    ) {
      score = Math.max(score, 0.9);
    } else if (
      hasSpecificDescriptionSignal &&
      (normalizedDescription.includes(normalizedName) || normalizedName.includes(normalizedDescription))
    ) {
      score = Math.max(score, 0.85);
    } else if (normalizedSku && normalizedDescription.includes(normalizedSku)) {
      score = Math.max(score, 0.78);
    } else if (
      compactSku &&
      compactDescription &&
      (compactDescription.includes(compactSku) || compactSku.includes(compactDescription))
    ) {
      score = Math.max(score, 0.8);
    }

    if (!best || score > best.score) {
      secondBest = best;
      best = {
        id: item.id,
        name: item.name,
        score
      };
    } else if (!secondBest || score > secondBest.score) {
      secondBest = {
        id: item.id,
        name: item.name,
        score
      };
    }
  }

  if (!best || best.score < 0.72 || isAmbiguousTopMatch(best.score, secondBest?.score || null)) {
    return {
      itemId: null,
      itemName: null,
      confidence: "NONE",
      score: roundCurrency(best?.score || 0)
    };
  }

  const confidence: MatchConfidence = best.score >= 0.88 ? "HIGH" : "MEDIUM";
  return {
    itemId: best.id,
    itemName: best.name,
    confidence,
    score: roundCurrency(best.score)
  };
}

function isAmbiguousTopMatch(bestScore: number, secondScore: number | null) {
  if (secondScore === null) {
    return false;
  }
  const scoreGap = bestScore - secondScore;
  if (!Number.isFinite(scoreGap)) {
    return false;
  }
  return bestScore < 0.88 && scoreGap < 0.015;
}
