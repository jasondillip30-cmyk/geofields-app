export function trimTrailingPeriod(value: string) {
  return value.trim().replace(/[.\s]+$/, "");
}

export function condenseReason(value: string, maxLength = 100) {
  const cleaned = trimTrailingPeriod(value).replace(/\s+/g, " ");
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function compactSummaryLine(summary: string, maxLength = 145) {
  if (!summary) {
    return "";
  }
  const normalized = summary
    .replace(/^Atlas\s+(whole-app|related-data)\s+view:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return condenseReason(normalized, maxLength);
}

export function conciseFocusLine(item: { label: string; reason: string }, maxReasonLength = 90) {
  return `${item.label}: ${condenseReason(item.reason, maxReasonLength)}`;
}

export function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function dedupeText(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(key);
  }
  return next;
}
