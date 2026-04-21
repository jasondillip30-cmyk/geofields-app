export function extractTraSupplierName(text: string) {
  const readableText = text.replace(/\r/g, "\n");
  const fromReceiptHeader = extractTraSupplierFromLegalReceiptHeader(readableText);
  if (fromReceiptHeader) {
    return fromReceiptHeader;
  }

  const fromHeading = extractTraSupplierFromHeadingBlock(readableText);
  if (fromHeading) {
    return fromHeading;
  }

  const fromRaw = extractTraSupplierFromRawText(readableText);
  if (fromRaw) {
    return fromRaw;
  }

  return "";
}

export function extractTraSupplierFromLegalReceiptHeader(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const legalReceiptIndex = lines.findIndex((line) => /LEGAL\s+RECEIPT/i.test(line));
  if (legalReceiptIndex < 0) {
    return "";
  }

  const afterHeader = lines.slice(legalReceiptIndex + 1, legalReceiptIndex + 10);
  const supplier = extractFirstLikelySupplierFromLines(afterHeader);
  if (supplier) {
    return supplier;
  }

  const beforeHeader = lines.slice(Math.max(0, legalReceiptIndex - 6), legalReceiptIndex);
  return extractFirstLikelySupplierFromLines(beforeHeader);
}

export function extractTraSupplierFromHeadingBlock(html: string) {
  const blockMatch = html.match(/<h4[^>]*class=["'][^"']*text-uppercase[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i);
  if (!blockMatch) {
    return "";
  }
  const blockText = blockMatch[1]
    .replace(/<br\s*\/?>(?:\s*)?/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "\n");
  const lines = blockText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return extractFirstLikelySupplierFromLines(lines);
}

export function extractTraSupplierFromRawText(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const keywords = ["supplier", "business", "company", "trading", "limited", "ltd", "enterprise"];
  const keywordLine = lines.find((line) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });
  if (keywordLine) {
    const normalized = normalizeSupplierCandidate(keywordLine);
    if (normalized && isLikelySupplierName(normalized)) {
      return normalized;
    }
  }
  return extractFirstLikelySupplierFromLines(lines.slice(0, 20));
}

export function isLikelyTraPlaceholderText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    normalized === "page is loading" ||
    normalized.startsWith("page is loading") ||
    normalized.includes("please wait") ||
    normalized.includes("processing request") ||
    normalized.includes("javascript is required") ||
    normalized.includes("receipt verification portal")
  );
}

function extractFirstLikelySupplierFromLines(lines: string[]) {
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) {
      continue;
    }
    const lower = line.toLowerCase();
    if (looksLikeSupplierStopLine(lower)) {
      continue;
    }

    const normalized = normalizeSupplierCandidate(line);
    if (!normalized) {
      continue;
    }

    if (isLikelySupplierName(normalized)) {
      return normalized;
    }
  }
  return "";
}

function looksLikeSupplierStopLine(lowerLine: string) {
  if (!lowerLine) {
    return true;
  }
  return (
    isLikelyTraPlaceholderText(lowerLine) ||
    lowerLine.includes("tax office") ||
    lowerLine.includes("tin") ||
    lowerLine.includes("vrn") ||
    lowerLine.includes("serial") ||
    lowerLine.includes("verification") ||
    lowerLine.includes("receipt") ||
    lowerLine.includes("invoice") ||
    lowerLine.includes("customer") ||
    lowerLine.includes("phone") ||
    lowerLine.includes("tel") ||
    lowerLine.includes("address") ||
    lowerLine.includes("branch") ||
    lowerLine.includes("qty") ||
    lowerLine.includes("price") ||
    lowerLine.includes("amount") ||
    lowerLine.includes("total") ||
    lowerLine.includes("item") ||
    lowerLine.includes("name") ||
    lowerLine.includes("date") ||
    lowerLine.includes("time") ||
    /^\d+$/.test(lowerLine)
  );
}

function normalizeSupplierCandidate(value: string) {
  const normalized = value
    .replace(/^(supplier|business|company)\s*[:\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (isLikelyTraPlaceholderText(normalized)) {
    return "";
  }
  return normalized;
}

export function isLikelySupplierName(value: string) {
  if (!value || value.length < 3) {
    return false;
  }
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (isLikelyTraPlaceholderText(lower)) {
    return false;
  }
  if (looksLikeSupplierStopLine(lower)) {
    return false;
  }
  const alphaCount = normalized.replace(/[^a-zA-Z]/g, "").length;
  if (alphaCount < 3) {
    return false;
  }
  if (/^[A-Z]{2,6}\d{2,}$/.test(normalized)) {
    return false;
  }
  return true;
}
