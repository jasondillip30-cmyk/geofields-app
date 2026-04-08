export const lineSkipKeywords = [
  "subtotal",
  "total",
  "grand total",
  "vat",
  "tax",
  "receipt",
  "invoice",
  "amount due",
  "balance",
  "cash",
  "change",
  "payment",
  "operator",
  "tra",
  "tin",
  "tel",
  "phone"
];

export function normalizeName(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[._,/\\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompactName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export function splitNormalizedTokens(value: string) {
  if (!value) {
    return [];
  }
  return value.split(" ").filter(Boolean);
}

export function tokenOverlapScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

export function cleanupDescription(value: string) {
  return normalizeWhitespace(value)
    .replace(/^[x@\-:|]+/g, "")
    .replace(/\bqty\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseNumberSafe(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

export function toStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function findPattern(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

export function findDate(text: string) {
  const iso = text.match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dmy = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

export function findTime(text: string) {
  const twelveHour = text.match(/\b(0?[1-9]|1[0-2]):([0-5]\d)\s*([ap]m)\b/i);
  if (twelveHour) {
    const [, hour, minute, meridiem] = twelveHour;
    return `${hour.padStart(2, "0")}:${minute} ${meridiem.toUpperCase()}`;
  }

  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  if (twentyFour) {
    const [, hour, minute] = twentyFour;
    return `${hour.padStart(2, "0")}:${minute}`;
  }

  return "";
}

export function findPaymentMethod(text: string) {
  const lower = text.toLowerCase();
  if (containsAny(lower, ["cash", "paid cash"])) {
    return "Cash";
  }
  if (containsAny(lower, ["mpesa", "m-pesa"])) {
    return "M-Pesa";
  }
  if (containsAny(lower, ["card", "visa", "mastercard", "pos"])) {
    return "Card";
  }
  if (containsAny(lower, ["bank transfer", "eft", "transfer"])) {
    return "Bank Transfer";
  }
  if (containsAny(lower, ["credit"])) {
    return "Credit";
  }
  return "";
}

export function findItemCount(text: string) {
  const countMatch = text.match(/\b(?:items?|qty|quantity)\s*[:\-]?\s*(\d{1,4})\b/i);
  if (countMatch?.[1]) {
    return Number(countMatch[1]);
  }

  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const probableItemLines = lines.filter((line) => {
    if (containsAny(line.toLowerCase(), lineSkipKeywords)) {
      return false;
    }
    const amounts = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    return amounts.length >= 1 && /[a-z]/i.test(line);
  });

  if (probableItemLines.length === 0) {
    return 0;
  }
  return Math.min(probableItemLines.length, 999);
}

export function findCurrency(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("USD")) return "USD";
  if (upper.includes("TZS") || upper.includes("T SH") || upper.includes("TSH")) return "TZS";
  if (upper.includes("KES")) return "KES";
  if (upper.includes("EUR")) return "EUR";
  return "USD";
}

export function findLabeledAmount(text: string, labels: string[]) {
  const rows = text.split(/\r?\n/g);
  for (const row of rows) {
    const normalized = row.toLowerCase();
    if (!containsAny(normalized, labels)) {
      continue;
    }
    const amounts = row.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    if (amounts.length === 0) {
      continue;
    }
    const value = parseNumberSafe(amounts[amounts.length - 1]);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

export function findTotalAmount(text: string, fallbackTotal: number) {
  const rows = text.split(/\r?\n/g);
  const candidateTotals: number[] = [];
  for (const row of rows) {
    const normalized = row.toLowerCase();
    if (!containsAny(normalized, ["total", "grand total", "amount due"])) {
      continue;
    }
    const amounts = row.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    if (amounts.length === 0) {
      continue;
    }
    const value = parseNumberSafe(amounts[amounts.length - 1]);
    if (value > 0) {
      candidateTotals.push(value);
    }
  }

  if (candidateTotals.length === 0) {
    return fallbackTotal > 0 ? fallbackTotal : 0;
  }

  return Math.max(...candidateTotals);
}

export function containsAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

export function similarityScore(a: string, b: string) {
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
