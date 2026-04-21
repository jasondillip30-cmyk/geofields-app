import { roundCurrency } from "@/lib/inventory-server";
import {
  cleanupDescription,
  containsAny,
  findDate,
  findTime,
  lineSkipKeywords,
  normalizeName,
  normalizeWhitespace,
  parseNumberSafe
} from "@/lib/inventory-receipt-intake-parse-utils";
import {
  extractTraSupplierFromHeadingBlock,
  extractTraSupplierFromLegalReceiptHeader,
  extractTraSupplierFromRawText,
  extractTraSupplierName,
  isLikelySupplierName,
  isLikelyTraPlaceholderText
} from "@/lib/inventory-receipt-intake-tra-supplier";
import { debugLog } from "@/lib/observability";
import type {
  ReceiptHeaderExtraction,
  ReceiptLineCandidate
} from "@/lib/inventory-receipt-intake";

export function extractTraCriticalFields({
  selectedText,
  fullText,
  selectedHtml,
  fullHtml
}: {
  selectedText: string;
  fullText: string;
  selectedHtml: string;
  fullHtml: string;
}) {
  const criticalTextPool = [
    selectedText,
    fullText,
    extractReadableTraText(selectedHtml, { keepScripts: true }),
    extractReadableTraText(fullHtml, { keepScripts: true })
  ]
    .filter(Boolean)
    .join("\n");

  const lineAwareTextPool = [
    selectedText,
    fullText,
    extractReadableTraTextWithLineBreaks(selectedHtml, { keepScripts: true }),
    extractReadableTraTextWithLineBreaks(fullHtml, { keepScripts: true })
  ]
    .filter(Boolean)
    .join("\n");

  const supplierCandidateFromHeader = extractTraSupplierFromLegalReceiptHeader(lineAwareTextPool);
  const supplierCandidateFromHeading = extractTraSupplierFromHeadingBlock(fullHtml || selectedHtml);
  const supplierCandidateFromRawText = extractTraSupplierFromRawText(lineAwareTextPool || criticalTextPool);
  const supplierName =
    supplierCandidateFromHeader ||
    supplierCandidateFromHeading ||
    supplierCandidateFromRawText ||
    extractTraSupplierName(criticalTextPool);

  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][tra-lookup][supplier-candidates]", {
      supplierCandidateFromHeader,
      supplierCandidateFromRawText,
      supplierSelectedFinal: supplierName || "",
      supplierSource: supplierCandidateFromHeader
        ? "LEGAL_RECEIPT_HEADER"
        : supplierCandidateFromHeading
          ? "HEADING_BLOCK"
          : supplierCandidateFromRawText
            ? "RAW_TEXT_FALLBACK"
            : supplierName
              ? "LEGACY_PATTERN"
              : "NONE"
    });
  }

  const verificationCode = extractTraVerificationCode(criticalTextPool);

  return {
    supplierName,
    verificationCode
  };
}

function extractReadableTraTextWithLineBreaks(value: string, options?: { keepScripts?: boolean }) {
  if (!value) {
    return "";
  }
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6|table|section|article)\s*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutScripts = options?.keepScripts ? withBreaks : withBreaks.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const stripped = withoutScripts.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTraVerificationCode(text: string) {
  if (!text) {
    return "";
  }
  const patterns = [
    /\b(?:receipt\s*)?verification\s*(?:code|no|number|#)?\s*[:\-]?\s*([0-9A-Z\-]{6,24})\b/i,
    /\bverify\s*(?:code|no|number|#)?\s*[:\-]?\s*([0-9A-Z\-]{6,24})\b/i,
    /\bverification\s*code\s*(?:\n|\r|\s{2,})([0-9A-Z\-]{6,24})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = (match?.[1] || "").trim().toUpperCase();
    if (!candidate) {
      continue;
    }
    if (!/[0-9]/.test(candidate) || !/[A-Z]/.test(candidate)) {
      continue;
    }
    return candidate;
  }
  return "";
}

export function buildTraParseContext(html: string) {
  const structureSummary = summarizeTraHtmlStructure(html);
  const candidates = extractTraParseCandidates(html);
  const selected =
    [...candidates].sort((a, b) => b.score - a.score)[0] || {
      source: "full-body",
      html,
      text: extractReadableTraText(html),
      score: 0,
      keywordHits: [] as string[]
    };

  return {
    selectedHtml: selected.html || html,
    selectedText: selected.text || extractReadableTraText(selected.html || html),
    fullText: extractReadableTraText(html),
    selectedSource: selected.source,
    selectedScore: roundTo(selected.score, 2),
    selectedKeywordHits: selected.keywordHits,
    candidateSummaries: candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((candidate) => ({
        source: candidate.source,
        score: roundTo(candidate.score, 2),
        keywordHits: candidate.keywordHits,
        textLength: candidate.text.length
      })),
    structureSummary
  };
}

function extractTraParseCandidates(html: string) {
  const candidates: Array<{ source: string; html: string; text: string; score: number; keywordHits: string[] }> = [];
  const seen = new Set<string>();
  const normalizedHtml = html || "";

  const pushCandidate = ({
    source,
    htmlSegment,
    textSegment
  }: {
    source: string;
    htmlSegment?: string;
    textSegment?: string;
  }) => {
    const resolvedHtml = htmlSegment ?? normalizedHtml;
    const resolvedText = (textSegment ?? extractReadableTraText(resolvedHtml))
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!resolvedText || resolvedText.length < 24) {
      return;
    }
    const dedupeKey = `${source}:${resolvedText.slice(0, 180)}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    const scoring = scoreTraParseText(resolvedText);
    candidates.push({
      source,
      html: resolvedHtml,
      text: resolvedText,
      score: scoring.score,
      keywordHits: scoring.keywordHits
    });
  };

  pushCandidate({
    source: "full-body",
    htmlSegment: normalizedHtml
  });

  const markerSlice = extractMarkerSlice(normalizedHtml, "start of legal receipt", "end of legal receipt");
  if (markerSlice) {
    pushCandidate({
      source: "legal-receipt-marker",
      htmlSegment: markerSlice
    });
  }

  const purchasedSlice = extractMarkerSlice(normalizedHtml, "purchased items", "end of legal receipt");
  if (purchasedSlice) {
    pushCandidate({
      source: "purchased-items-marker",
      htmlSegment: purchasedSlice
    });
  }

  const keywordWindows = ["efd receipt verification", "start of legal receipt", "purchased items", "receipt no", "tin", "vrn"];
  for (const keyword of keywordWindows) {
    const windowSlice = extractKeywordWindow(normalizedHtml, keyword, 3500, 28000);
    if (!windowSlice) {
      continue;
    }
    pushCandidate({
      source: `keyword-window:${keyword}`,
      htmlSegment: windowSlice
    });
  }

  const tableMatches = Array.from(normalizedHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi))
    .map((entry) => entry[0] || "")
    .filter(Boolean)
    .slice(0, 120);
  for (const tableHtml of tableMatches) {
    const text = extractReadableTraText(tableHtml);
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "purchased", "subtotal", "total"])) {
      continue;
    }
    pushCandidate({
      source: "table-candidate",
      htmlSegment: tableHtml,
      textSegment: text
    });
  }

  const preMatches = Array.from(normalizedHtml.matchAll(/<(pre|textarea)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[2] || "").replace(/<[^>]+>/g, " "))))
    .filter(Boolean)
    .slice(0, 24);
  for (const text of preMatches) {
    pushCandidate({
      source: "preformatted-text",
      htmlSegment: normalizedHtml,
      textSegment: text
    });
  }

  const scriptCandidates = extractTraScriptTextCandidates(normalizedHtml);
  for (const scriptCandidate of scriptCandidates) {
    pushCandidate({
      source: scriptCandidate.source,
      htmlSegment: normalizedHtml,
      textSegment: scriptCandidate.text
    });
  }

  return candidates;
}

function summarizeTraHtmlStructure(html: string) {
  const headings = Array.from(html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi))
    .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[1] || "").replace(/<[^>]+>/g, " "))))
    .filter(Boolean)
    .slice(0, 10);
  const markers = {
    hasEfdHeader: /efd\s*receipt\s*verification/i.test(html),
    hasStartLegalReceipt: /start\s+of\s+legal\s+receipt/i.test(html),
    hasPurchasedItems: /purchased\s+items/i.test(html),
    hasReceiptNo: /receipt\s*(no|number|#)/i.test(html),
    hasTin: /\btin\b/i.test(html),
    hasVrn: /\bvrn\b/i.test(html)
  };
  return {
    htmlLength: html.length,
    tableCount: (html.match(/<table\b/gi) || []).length,
    formCount: (html.match(/<form\b/gi) || []).length,
    scriptCount: (html.match(/<script\b/gi) || []).length,
    headingPreview: headings,
    markers
  };
}

function scoreTraParseText(text: string) {
  const lower = text.toLowerCase();
  const weightedKeywords: Array<{ keyword: string; score: number }> = [
    { keyword: "start of legal receipt", score: 8 },
    { keyword: "purchased items", score: 7 },
    { keyword: "efd receipt verification", score: 6 },
    { keyword: "receipt no", score: 5 },
    { keyword: "receipt number", score: 5 },
    { keyword: "tin", score: 4 },
    { keyword: "vrn", score: 4 },
    { keyword: "serial", score: 3 },
    { keyword: "verification code", score: 4 },
    { keyword: "total incl", score: 4 },
    { keyword: "tax", score: 2 }
  ];
  const keywordHits: string[] = [];
  let score = 0;
  for (const entry of weightedKeywords) {
    if (lower.includes(entry.keyword)) {
      score += entry.score;
      keywordHits.push(entry.keyword);
    }
  }
  const labelLikeLines = (text.match(/\b(?:tin|vrn|receipt|serial|total|tax|subtotal|verification)\b[^\n:]{0,28}[:]/gi) || [])
    .length;
  score += Math.min(7, labelLikeLines * 0.7);
  const rows = text.split(/\r?\n/g).filter((line) => normalizeWhitespace(line).length > 0).length;
  if (rows > 6) {
    score += Math.min(3, rows / 12);
  }
  if (text.length < 70) {
    score -= 3;
  }
  if (containsAny(lower, ["submit", "verification portal"]) && keywordHits.length <= 1) {
    score -= 3;
  }

  return {
    score,
    keywordHits
  };
}

export function isLikelyTraLoadingShellText(text: string) {
  const normalized = normalizeWhitespace(decodeHtmlEntities(text)).toLowerCase();
  if (!normalized) {
    return true;
  }
  const loadingPhrases = [
    "page is loading",
    "please wait",
    "processing request",
    "javascript is required",
    "verification portal",
    "loading..."
  ];
  const hasLoadingPhrase = loadingPhrases.some((phrase) => normalized.includes(phrase));
  const strongReceiptSignals = [
    "start of legal receipt",
    "end of legal receipt",
    "purchased items",
    "receipt no",
    "verification code",
    "total incl",
    "total excl",
    "tin",
    "vrn"
  ];
  const strongSignalHits = strongReceiptSignals.filter((signal) => normalized.includes(signal)).length;
  if (hasLoadingPhrase && strongSignalHits < 2) {
    return true;
  }
  if (normalized.length < 220 && hasLoadingPhrase) {
    return true;
  }
  if (normalized.includes("receipt verification portal") && strongSignalHits === 0) {
    return true;
  }
  return false;
}

export function isLikelyTraLoadingShellHtml(html: string) {
  const text = extractReadableTraTextWithLineBreaks(html, { keepScripts: true });
  return isLikelyTraLoadingShellText(text);
}

function extractMarkerSlice(html: string, startMarker: string, endMarker: string) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(startMarker);
  if (start < 0) {
    return "";
  }
  const endSearchStart = start + startMarker.length;
  const endIndex = lower.indexOf(endMarker, endSearchStart);
  const resolvedEnd = endIndex >= 0 ? endIndex + endMarker.length : Math.min(html.length, start + 42000);
  const from = Math.max(0, start - 2400);
  const to = Math.min(html.length, resolvedEnd + 3200);
  return html.slice(from, to);
}

function extractKeywordWindow(html: string, keyword: string, before: number, after: number) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(keyword.toLowerCase());
  if (start < 0) {
    return "";
  }
  const from = Math.max(0, start - Math.max(600, before));
  const to = Math.min(html.length, start + Math.max(1200, after));
  return html.slice(from, to);
}

function extractTraScriptTextCandidates(html: string) {
  const results: Array<{ source: string; text: string }> = [];
  const scriptMatches = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).slice(0, 50);
  for (const [index, match] of scriptMatches.entries()) {
    const scriptBody = decodeHtmlEntities(match[1] || "");
    if (!scriptBody) {
      continue;
    }
    const lower = scriptBody.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "verification", "purchased", "legal"])) {
      continue;
    }
    const directText = normalizeWhitespace(scriptBody.replace(/<[^>]+>/g, " "));
    if (directText.length >= 40) {
      results.push({
        source: `script-body-${index + 1}`,
        text: directText
      });
    }

    const stringLiteralRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
    const literals = scriptBody.match(stringLiteralRegex) || [];
    for (const literal of literals.slice(0, 80)) {
      const unescaped = safelyUnescapeJsString(literal);
      if (!unescaped || unescaped.length < 40) {
        continue;
      }
      const lowered = unescaped.toLowerCase();
      if (!containsAny(lowered, ["receipt", "tin", "vrn", "verification", "purchased", "subtotal", "total"])) {
        continue;
      }
      results.push({
        source: `script-literal-${index + 1}`,
        text: normalizeWhitespace(unescaped.replace(/<[^>]+>/g, " "))
      });
    }
  }
  return results.slice(0, 60);
}

function safelyUnescapeJsString(value: string) {
  if (!value || value.length < 2) {
    return "";
  }
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) {
    return "";
  }
  const inner = value.slice(1, -1);
  if (!inner) {
    return "";
  }
  try {
    const normalized = quote === "'" ? `"${inner.replace(/"/g, "\\\"")}"` : value;
    const parsed = JSON.parse(normalized);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    const fallback = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'");
    return decodeHtmlEntities(fallback);
  }
}

function extractReadableTraText(value: string, options?: { keepScripts?: boolean }) {
  if (!value) {
    return "";
  }
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6)\s*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutScripts = options?.keepScripts ? withBreaks : withBreaks.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const stripped = withoutScripts.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  if (!value) {
    return "";
  }
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function extractTraLabelValuePairs(html: string, text: string) {
  const pairs: Array<{ label: string; value: string; source: string; confidence: number }> = [];

  const sections = collectTraLabelSections(html);
  for (const section of sections) {
    const rowMatches = section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1] || "";
      const cells = Array.from(rowHtml.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
        .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[1] || "").replace(/<[^>]+>/g, " "))))
        .filter(Boolean);
      if (cells.length < 2) {
        continue;
      }

      if (cells.length >= 4 && cells.length % 2 === 0) {
        for (let index = 0; index < cells.length - 1; index += 2) {
          const label = cells[index];
          const value = cells[index + 1];
          if (!label || !value || !looksLikeTraLabel(label)) {
            continue;
          }
          pairs.push({
            label,
            value,
            source: "html-table-paired",
            confidence: 0.9
          });
        }
        continue;
      }

      const label = cells[0];
      const value = cells.slice(1).join(" ");
      if (!looksLikeTraLabel(label)) {
        continue;
      }
      pairs.push({
        label,
        value,
        source: "html-table",
        confidence: 0.85
      });
    }
  }

  const inlinePairs = html.matchAll(
    /<(?:span|label|strong|b)[^>]*>\s*([^<]{2,80})\s*<\/(?:span|label|strong|b)>\s*<(?:span|div|p|td)[^>]*>\s*([^<]{1,180})\s*<\/(?:span|div|p|td)>/gi
  );
  for (const inlinePair of inlinePairs) {
    const label = normalizeWhitespace(decodeHtmlEntities((inlinePair[1] || "").replace(/<[^>]+>/g, " ")));
    const value = normalizeWhitespace(decodeHtmlEntities((inlinePair[2] || "").replace(/<[^>]+>/g, " ")));
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "html-inline-pair",
      confidence: 0.76
    });
  }

  const definitionMatches = html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi);
  for (const definition of definitionMatches) {
    const label = normalizeWhitespace(decodeHtmlEntities((definition[1] || "").replace(/<[^>]+>/g, " ")));
    const value = normalizeWhitespace(decodeHtmlEntities((definition[2] || "").replace(/<[^>]+>/g, " ")));
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "html-definition",
      confidence: 0.82
    });
  }

  const textLines = text.split(/\r?\n/g).map((line) => normalizeWhitespace(line)).filter(Boolean);
  for (const line of textLines) {
    const kv = line.match(/^([^:]{2,80})\s*:\s*(.+)$/);
    if (!kv) {
      continue;
    }
    const label = normalizeWhitespace(kv[1] || "");
    const value = normalizeWhitespace(kv[2] || "");
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "text-label",
      confidence: 0.72
    });
  }

  return pairs;
}

function collectTraLabelSections(html: string) {
  const sections: string[] = [];
  const seen = new Set<string>();
  const push = (section: string) => {
    const normalized = section.trim();
    if (!normalized) {
      return;
    }
    const key = normalized.slice(0, 240);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sections.push(normalized);
  };

  push(html);
  const legalSlice = extractMarkerSlice(html, "start of legal receipt", "end of legal receipt");
  if (legalSlice) {
    push(legalSlice);
  }
  const purchasedSlice = extractMarkerSlice(html, "purchased items", "end of legal receipt");
  if (purchasedSlice) {
    push(purchasedSlice);
  }

  const tableSlices = Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi))
    .map((entry) => entry[0] || "")
    .filter(Boolean)
    .slice(0, 120);
  for (const tableSlice of tableSlices) {
    const lower = tableSlice.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "verification", "total", "tax", "serial"])) {
      continue;
    }
    push(tableSlice);
  }

  return sections;
}

function looksLikeTraLabel(label: string) {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized || normalized.length > 80) {
    return false;
  }
  if (/^\d[\d,.\s-]*$/.test(normalized)) {
    return false;
  }
  return containsAny(normalized, [
    "supplier",
    "merchant",
    "store",
    "tin",
    "vrn",
    "serial",
    "receipt",
    "verification",
    "verify",
    "z number",
    "tax office",
    "invoice",
    "reference",
    "payment",
    "subtotal",
    "tax",
    "vat",
    "total",
    "currency",
    "item count",
    "customer"
  ]);
}

export function mapTraLabelToField(label: string): keyof ReceiptHeaderExtraction | null {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/\b(supplier|merchant|store|seller|trader|business\s*name|company\s*name|trader\s*name)\b/.test(normalized))
    return "supplierName";
  if (/\btin\b/.test(normalized)) return "tin";
  if (/\bvrn\b|\bvat\s*reg/.test(normalized)) return "vrn";
  if (/\bserial\b|\bs\/n\b/.test(normalized)) return "serialNumber";
  if (/\breceipt\b.*\b(no|number|#)\b|\brct\b.*\b(no|number)\b/.test(normalized)) return "receiptNumber";
  if (/\bz\s*(no|number|#)\b/.test(normalized)) return "traReceiptNumber";
  if (/\bverification\b.*\b(code|no|number|#)\b|\bverify\b.*\b(code|no|#)\b/.test(normalized)) return "verificationCode";
  if (/\breceipt\s*date\b|\bdate\b/.test(normalized)) return "receiptDate";
  if (/\breceipt\s*time\b|\btime\b/.test(normalized)) return "receiptTime";
  if (/\btax\s*office\b|\boffice\b/.test(normalized)) return "taxOffice";
  if (/\binvoice\b|\breference\b|\bref\b/.test(normalized)) return "invoiceReference";
  if (/\bpayment\b|\bmethod\b/.test(normalized)) return "paymentMethod";
  if (/\bcurrency\b/.test(normalized)) return "currency";
  if (/\bsub\s*total\b|\bsubtotal\b|\btotal\s*excl/.test(normalized)) return "subtotal";
  if (
    /\bgrand\s*total\b|\btotal\s*incl\b|\btotal\s*inc\b|\btotal\s*inclusive\b|\btotal\s*amount\b|\bamount\s*due\b|\bamount\s*payable\b|\btotal\b/.test(
      normalized
    )
  )
    return "total";
  if (/\b(?:tax|vat)\b/.test(normalized) && !/\btotal\b/.test(normalized)) return "tax";
  if (/\bitem\s*count\b|\bno\s*of\s*items\b/.test(normalized)) return "itemCount";
  return null;
}

export function sanitizeTraFieldValue(
  field: keyof ReceiptHeaderExtraction,
  value: string | number,
  labelHint: string
): string | number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (field === "itemCount") {
      return Math.max(0, Math.round(value));
    }
    if (field === "subtotal" || field === "tax" || field === "total") {
      return value > 0 ? roundCurrency(value) : null;
    }
    return value;
  }

  let cleaned = normalizeWhitespace(decodeHtmlEntities(value));
  if (!cleaned) {
    return null;
  }

  const normalizedLabel = normalizeWhitespace(labelHint).toLowerCase();
  if (normalizedLabel) {
    const escaped = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[:\\-]*\\s*`, "i"), "").trim();
  }

  cleaned = cleaned.replace(/^(receipt|verification|verify|code|portal)\s*[:\-#]?\s*/i, "").trim();
  if (!cleaned) {
    return null;
  }
  if (isLikelyTraPlaceholderText(cleaned)) {
    return null;
  }

  const lowered = cleaned.toLowerCase();
  const weakValues = new Set([
    "verification",
    "portal",
    "verification portal",
    "receipt",
    "receipt verification",
    "receipt verification code",
    "code"
  ]);
  if (weakValues.has(lowered)) {
    return null;
  }

  if (field === "receiptDate") {
    const date = normalizeQrDate(cleaned);
    return date || null;
  }
  if (field === "supplierName") {
    const supplier = normalizeWhitespace(cleaned).toUpperCase();
    if (!isLikelySupplierName(supplier)) {
      return null;
    }
    return supplier;
  }
  if (field === "receiptTime") {
    return findTime(cleaned) || null;
  }
  if (field === "currency") {
    const code = cleaned.toUpperCase().match(/\b(TZS|USD|KES|EUR|GBP)\b/)?.[1] || "";
    return code || null;
  }
  if (field === "subtotal" || field === "tax" || field === "total") {
    const amount = parseNumberSafe(cleaned);
    return amount > 0 ? roundCurrency(amount) : null;
  }
  if (field === "itemCount") {
    const amount = Number(cleaned.replace(/[^0-9]/g, ""));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
  }
  if (field === "tin") {
    const tin = cleaned.match(/\b[0-9]{8,15}\b/)?.[0] || "";
    return tin || null;
  }
  if (field === "vrn") {
    const vrn = cleaned.match(/\b[0-9a-z]{8,18}\b/i)?.[0] || "";
    return vrn || null;
  }
  if (field === "verificationCode") {
    const code = cleaned.match(/\b[0-9a-z\-]{6,}\b/i)?.[0] || "";
    if (!code || !/[0-9]/.test(code) || !/[a-z]/i.test(code)) {
      return null;
    }
    return code;
  }
  if (field === "traReceiptNumber") {
    const zNumber = cleaned.match(/\b\d{1,6}\b/)?.[0] || cleaned.match(/\b[0-9a-z\-\/]{1,12}\b/i)?.[0] || "";
    if (!zNumber || !/[0-9]/.test(zNumber)) {
      return null;
    }
    return zNumber;
  }
  if (field === "receiptNumber" || field === "serialNumber" || field === "invoiceReference") {
    const token = cleaned.match(/\b[0-9a-z\-\/]{4,}\b/i)?.[0] || "";
    if (!token || !/[0-9]/.test(token)) {
      return null;
    }
    return token;
  }

  return cleaned;
}

export function normalizeTraFinancialFields(
  parsed: Partial<ReceiptHeaderExtraction>,
  lineCandidates: ReceiptLineCandidate[] = []
) {
  const next: Partial<ReceiptHeaderExtraction> = { ...parsed };
  const lineTotalSum = sumTraLineTotals(lineCandidates);
  const subtotal = toPositiveMoney(next.subtotal);
  const tax = toPositiveMoney(next.tax);
  const total = toPositiveMoney(next.total);

  if (total <= 0 && lineTotalSum > 0) {
    next.total = lineTotalSum;
  }

  if (subtotal > 0 && total > 0) {
    const impliedTax = roundCurrency(total - subtotal);
    if (impliedTax >= 0 && (tax <= 0 || approximatelyEqual(tax, total, 0.01) || tax > total)) {
      next.tax = impliedTax;
    }
  }

  const normalizedSubtotal = toPositiveMoney(next.subtotal);
  const normalizedTax = toPositiveMoney(next.tax);
  const normalizedTotal = toPositiveMoney(next.total);
  if (normalizedSubtotal > 0 && normalizedTax > 0 && normalizedTotal <= 0) {
    next.total = roundCurrency(normalizedSubtotal + normalizedTax);
  }
  if (normalizedTotal > 0 && normalizedTax > 0 && normalizedSubtotal <= 0 && normalizedTotal >= normalizedTax) {
    next.subtotal = roundCurrency(normalizedTotal - normalizedTax);
  }
  const finalSubtotal = toPositiveMoney(next.subtotal);
  const finalTax = toPositiveMoney(next.tax);
  const finalTotal = toPositiveMoney(next.total);
  if (finalSubtotal <= 0 && lineTotalSum > 0 && (finalTotal <= 0 || approximatelyEqual(finalTotal, lineTotalSum, 0.25))) {
    next.subtotal = lineTotalSum;
  }
  if (finalTax <= 0 && finalTotal > 0 && finalSubtotal > 0 && approximatelyEqual(finalTotal, finalSubtotal, 0.25)) {
    next.tax = 0;
  }

  return next;
}

function toPositiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundCurrency(parsed) : 0;
}

function approximatelyEqual(a: number, b: number, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

function sumTraLineTotals(lineCandidates: ReceiptLineCandidate[]) {
  if (!Array.isArray(lineCandidates) || lineCandidates.length === 0) {
    return 0;
  }
  const total = lineCandidates.reduce((sum, line) => {
    const lineTotal = Number(line.lineTotal || 0);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      return sum;
    }
    return sum + lineTotal;
  }, 0);
  return total > 0 ? roundCurrency(total) : 0;
}

export function selectBestTraFieldCandidates(
  candidates: Array<{ field: keyof ReceiptHeaderExtraction; value: string | number; confidence: number; source: string }>
) {
  const next: Partial<ReceiptHeaderExtraction> = {};
  const bestScores = new Map<keyof ReceiptHeaderExtraction, number>();
  const writable = next as Record<string, unknown>;
  for (const candidate of candidates) {
    const existingScore = bestScores.get(candidate.field) ?? -1;
    if (candidate.confidence < existingScore) {
      continue;
    }
    writable[candidate.field] = candidate.value;
    bestScores.set(candidate.field, candidate.confidence);
  }
  return next;
}

export function extractTraLineCandidates(html: string, text: string) {
  const targetedHtml = extractTraPurchasedItemsSection(html) || html;
  const lineCandidates: ReceiptLineCandidate[] = [];
  lineCandidates.push(...extractTraTableLineCandidates(targetedHtml));
  lineCandidates.push(...extractTraNonTableLineCandidates(targetedHtml));
  lineCandidates.push(...extractTraScriptLineCandidates(html));
  if (lineCandidates.length > 0) {
    return mergeDuplicateLineCandidates(lineCandidates).slice(0, 40);
  }
  return extractLineCandidates(text).slice(0, 40);
}

function extractTraTableLineCandidates(html: string) {
  const lineCandidates: ReceiptLineCandidate[] = [];
  const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
    Array.from((row[1] || "").matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
      .map((cell) => normalizeWhitespace(decodeHtmlEntities((cell[1] || "").replace(/<[^>]+>/g, " "))))
      .filter(Boolean)
  );

  for (const row of rows) {
    if (row.length < 2) {
      continue;
    }
    const loweredJoined = row.join(" ").toLowerCase();
    if (
      containsAny(loweredJoined, [
        "subtotal",
        "grand total",
        "vat",
        "tax",
        "total inclusive",
        "total incl",
        "total excl",
        "amount due"
      ])
    ) {
      continue;
    }
    if (containsAny(loweredJoined, ["description", "qty", "quantity", "unit price", "line total", "amount"])) {
      continue;
    }
    const amountTokens = row.flatMap((cell) =>
      (cell.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((token) => parseNumberSafe(token))
    );
    const positiveAmounts = amountTokens.filter((value) => Number.isFinite(value) && value > 0);
    if (positiveAmounts.length === 0) {
      continue;
    }

    const descriptionCell =
      row.find((cell) => /[a-z]/i.test(cell) && !/^\d[\d,]*(?:\.\d+)?$/.test(cell)) || row[0] || "";
    const description = cleanupDescription(descriptionCell);
    if (!description || containsAny(description.toLowerCase(), lineSkipKeywords)) {
      continue;
    }

    const qty = positiveAmounts.length >= 2 && positiveAmounts[0] <= 1000 ? positiveAmounts[0] : 1;
    const lineTotal = positiveAmounts[positiveAmounts.length - 1];
    const unitPrice = positiveAmounts.length >= 3 ? positiveAmounts[positiveAmounts.length - 2] : lineTotal / Math.max(1, qty);

    lineCandidates.push({
      description,
      quantity: roundCurrency(Math.max(1, qty)),
      unitPrice: roundCurrency(Math.max(0, unitPrice)),
      lineTotal: roundCurrency(Math.max(0, lineTotal)),
      extractionConfidence: positiveAmounts.length >= 2 ? "HIGH" : "MEDIUM"
    });
  }
  return lineCandidates;
}

function extractTraNonTableLineCandidates(html: string) {
  const lineCandidates: ReceiptLineCandidate[] = [];
  const blocks = Array.from(html.matchAll(/<(?:li|div|p)[^>]*>([\s\S]{1,280}?)<\/(?:li|div|p)>/gi))
    .map((match) => normalizeWhitespace(decodeHtmlEntities((match[1] || "").replace(/<[^>]+>/g, " "))))
    .filter(Boolean)
    .slice(0, 700);
  for (const block of blocks) {
    const lower = block.toLowerCase();
    if (!/[a-z]/i.test(block) || !/\d/.test(block)) {
      continue;
    }
    if (isLikelyTraLoadingShellText(lower) || isLikelyLineSummaryText(lower)) {
      continue;
    }
    const explicit = parseExplicitLinePattern(block);
    if (explicit) {
      lineCandidates.push(explicit);
      continue;
    }
    const fallback = parseFallbackLinePattern(block);
    if (!fallback) {
      continue;
    }
    const hasLineHints = containsAny(lower, ["qty", "quantity", "unit price", "line total", "amount", "item"]);
    if (fallback.extractionConfidence === "LOW" && !hasLineHints) {
      continue;
    }
    lineCandidates.push(fallback);
  }
  return lineCandidates;
}

function extractTraScriptLineCandidates(html: string) {
  const lineCandidates: ReceiptLineCandidate[] = [];
  const scriptCandidates = extractTraScriptTextCandidates(html).slice(0, 40);
  for (const scriptCandidate of scriptCandidates) {
    const scriptText = normalizeWhitespace(scriptCandidate.text);
    if (!scriptText || isLikelyTraLoadingShellText(scriptText)) {
      continue;
    }
    lineCandidates.push(...extractLineCandidates(scriptText));
    const objectMatches = Array.from(scriptText.matchAll(/\{[^{}]{20,500}\}/g)).slice(0, 120);
    for (const objectMatch of objectMatches) {
      const parsed = parseStructuredScriptObjectLine(objectMatch[0] || "");
      if (!parsed) {
        continue;
      }
      lineCandidates.push(parsed);
    }
  }
  return lineCandidates;
}

function parseStructuredScriptObjectLine(raw: string): ReceiptLineCandidate | null {
  if (!raw || raw.length < 20) {
    return null;
  }
  const description = cleanupDescription(
    (raw.match(/(?:description|item(?:name)?|product|goods|name)\s*[:=]\s*["']?([a-z0-9][^,"'}]{1,80})/i)?.[1] || "")
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'")
  );
  if (!description) {
    return null;
  }
  const lowerDescription = description.toLowerCase();
  if (isLikelyLineSummaryText(lowerDescription) || containsAny(lowerDescription, lineSkipKeywords)) {
    return null;
  }
  const quantity = parseNumberSafe(raw.match(/(?:qty|quantity)\s*[:=]\s*["']?([0-9][0-9.,]{0,10})/i)?.[1] || "1");
  const unitPrice = parseNumberSafe(raw.match(/(?:unitprice|unit_price|price)\s*[:=]\s*["']?([0-9][0-9.,]{0,12})/i)?.[1] || "0");
  const lineTotalRaw =
    raw.match(/(?:linetotal|line_total|amount|total|value)\s*[:=]\s*["']?([0-9][0-9.,]{0,12})/i)?.[1] || "";
  const lineTotalParsed = parseNumberSafe(lineTotalRaw);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
  const safeLineTotal =
    Number.isFinite(lineTotalParsed) && lineTotalParsed > 0
      ? lineTotalParsed
      : safeUnitPrice > 0
        ? safeUnitPrice * safeQuantity
        : 0;
  if (safeLineTotal <= 0) {
    return null;
  }
  return {
    description,
    quantity: roundCurrency(Math.max(1, safeQuantity)),
    unitPrice: roundCurrency(Math.max(0, safeUnitPrice || safeLineTotal / Math.max(1, safeQuantity))),
    lineTotal: roundCurrency(safeLineTotal),
    extractionConfidence: safeUnitPrice > 0 ? "MEDIUM" : "LOW"
  };
}

function isLikelyLineSummaryText(loweredText: string) {
  return containsAny(loweredText, [
    "subtotal",
    "grand total",
    "vat",
    "tax",
    "total inclusive",
    "total incl",
    "total excl",
    "amount due",
    "description",
    "unit price",
    "line total",
    "page is loading",
    "please wait",
    "processing request"
  ]);
}

function extractTraPurchasedItemsSection(html: string) {
  const lower = html.toLowerCase();
  const start = lower.indexOf("purchased items");
  if (start < 0) {
    return "";
  }
  const endCandidates = [
    lower.indexOf("subtotal", start + 14),
    lower.indexOf("total excl", start + 14),
    lower.indexOf("total incl", start + 14),
    lower.indexOf("end of legal receipt", start + 14)
  ].filter((entry) => entry >= 0);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : Math.min(html.length, start + 32000);
  const from = Math.max(0, start - 1600);
  const to = Math.min(html.length, end + 2600);
  return html.slice(from, to);
}

export function countParsedFields(parsed: Partial<ReceiptHeaderExtraction>): number {
  return Object.values(parsed).reduce<number>((count, value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? count + 1 : count;
    }
    if (typeof value === "string") {
      return value.trim().length > 0 ? count + 1 : count;
    }
    return count;
  }, 0);
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeQrDate(value: string) {
  if (!value) {
    return "";
  }
  return findDate(value);
}

function extractLineCandidates(text: string): ReceiptLineCandidate[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ReceiptLineCandidate[] = [];
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!/[a-z]/i.test(line)) {
      continue;
    }
    if (containsAny(line.toLowerCase(), lineSkipKeywords)) {
      continue;
    }

    const explicit = parseExplicitLinePattern(line);
    if (explicit) {
      results.push(explicit);
      continue;
    }

    const fallback = parseFallbackLinePattern(line);
    if (fallback) {
      results.push(fallback);
    }
  }

  if (results.length === 0) {
    return [];
  }

  return mergeDuplicateLineCandidates(results);
}

function parseExplicitLinePattern(line: string): ReceiptLineCandidate | null {
  const match = line.match(
    /^(.*?)[\s\t]+(\d+(?:[.,]\d+)?)\s*(?:x|@)?\s*(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)$/i
  );
  if (!match) {
    return null;
  }

  const description = cleanupDescription(match[1] || "");
  const quantity = parseNumberSafe(match[2] || "");
  const unitPrice = parseNumberSafe(match[3] || "");
  const lineTotal = parseNumberSafe(match[4] || "");
  if (!description || quantity <= 0 || unitPrice < 0 || lineTotal < 0) {
    return null;
  }

  return {
    description,
    quantity,
    unitPrice: roundCurrency(unitPrice),
    lineTotal: roundCurrency(lineTotal),
    extractionConfidence: "HIGH"
  };
}

function parseFallbackLinePattern(line: string): ReceiptLineCandidate | null {
  const amountMatches = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  const amounts = amountMatches.map((token) => parseNumberSafe(token)).filter((value) => Number.isFinite(value) && value > 0);
  if (amounts.length === 0) {
    return null;
  }

  const description = cleanupDescription(line.replace(/-?\d[\d,]*(?:\.\d+)?/g, " "));
  if (!description || description.length < 3) {
    return null;
  }

  if (amounts.length >= 2) {
    const qtyCandidate = amounts[0] <= 1000 ? amounts[0] : 1;
    const lineTotal = amounts[amounts.length - 1];
    let unitPrice = amounts.length >= 3 ? amounts[amounts.length - 2] : lineTotal / Math.max(1, qtyCandidate);
    if (Math.abs(unitPrice - lineTotal) < 0.01 && qtyCandidate > 1) {
      unitPrice = lineTotal / qtyCandidate;
    }
    return {
      description,
      quantity: roundCurrency(Math.max(1, qtyCandidate)),
      unitPrice: roundCurrency(Math.max(0, unitPrice)),
      lineTotal: roundCurrency(Math.max(0, lineTotal)),
      extractionConfidence: "MEDIUM"
    };
  }

  return {
    description,
    quantity: 1,
    unitPrice: roundCurrency(amounts[0]),
    lineTotal: roundCurrency(amounts[0]),
    extractionConfidence: "LOW"
  };
}

function mergeDuplicateLineCandidates(lines: ReceiptLineCandidate[]) {
  const byDescription = new Map<string, ReceiptLineCandidate>();
  for (const line of lines) {
    const key = normalizeName(line.description);
    if (!key) {
      continue;
    }
    const existing = byDescription.get(key);
    if (!existing) {
      byDescription.set(key, line);
      continue;
    }
    const mergedQuantity = roundCurrency(existing.quantity + line.quantity);
    const mergedTotal = roundCurrency(existing.lineTotal + line.lineTotal);
    byDescription.set(key, {
      description: existing.description,
      quantity: mergedQuantity,
      unitPrice: mergedQuantity > 0 ? roundCurrency(mergedTotal / mergedQuantity) : existing.unitPrice,
      lineTotal: mergedTotal,
      extractionConfidence:
        existing.extractionConfidence === "LOW" || line.extractionConfidence === "LOW"
          ? "LOW"
          : existing.extractionConfidence === "MEDIUM" || line.extractionConfidence === "MEDIUM"
            ? "MEDIUM"
            : "HIGH"
    });
  }
  return Array.from(byDescription.values()).slice(0, 80);
}
