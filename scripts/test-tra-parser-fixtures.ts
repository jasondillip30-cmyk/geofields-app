import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseQrFromUrl } from "@/lib/inventory-receipt-intake-qr";
import {
  buildTraParseContext,
  extractTraLabelValuePairs,
  extractTraLineCandidates,
  isLikelyTraLoadingShellHtml,
  mapTraLabelToField,
  normalizeTraFinancialFields,
  sanitizeTraFieldValue,
  selectBestTraFieldCandidates
} from "@/lib/inventory-receipt-intake-tra";
import { isLikelyTraPlaceholderText } from "@/lib/inventory-receipt-intake-tra-supplier";
import type { ReceiptHeaderExtraction } from "@/lib/inventory-receipt-intake-types";

function run(name: string, testFn: () => void) {
  try {
    testFn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function loadFixture(name: string) {
  const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/tra", name);
  return readFileSync(fixturePath, "utf8");
}

function parseTraFixture(html: string) {
  const parseContext = buildTraParseContext(html);
  const text = parseContext.selectedText;
  const lineCandidates = extractTraLineCandidates(parseContext.selectedHtml, text);
  const fieldCandidates: Array<{
    field: keyof ReceiptHeaderExtraction;
    value: string | number;
    confidence: number;
    source: string;
  }> = [];

  const labelPairs = extractTraLabelValuePairs(parseContext.selectedHtml, text);
  for (const pair of labelPairs) {
    const mappedField = mapTraLabelToField(pair.label);
    if (!mappedField) {
      continue;
    }
    const sanitized = sanitizeTraFieldValue(mappedField, pair.value, pair.label);
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: mappedField,
      value: sanitized,
      confidence: pair.confidence,
      source: pair.source
    });
  }

  const parsedFields = selectBestTraFieldCandidates(fieldCandidates);
  const normalizedFields = normalizeTraFinancialFields(parsedFields, lineCandidates);
  return {
    parseContext,
    lineCandidates,
    normalizedFields
  };
}

run("TRA URL token parsing infers verification/control ids", () => {
  const parsed = parseQrFromUrl(new URL("https://verify.tra.go.tz/0192C43691_190351"));
  assert.equal(parsed.verificationCode, "0192C43691");
  assert.equal(parsed.traReceiptNumber, "190351");
});

run("full TRA fixture yields supplier, totals, and line items", () => {
  const html = loadFixture("full-receipt.html");
  assert.equal(isLikelyTraLoadingShellHtml(html), false);

  const parsed = parseTraFixture(html);

  assert.equal(parsed.normalizedFields.supplierName, "PETROTZ FUEL STATION");
  assert.equal(Number(parsed.normalizedFields.subtotal || 0), 400);
  assert.equal(Number(parsed.normalizedFields.total || 0), 400);
  assert.ok(parsed.lineCandidates.length >= 1, "Expected at least one parsed line item.");
  assert.ok(
    parsed.lineCandidates.some((line) => line.description.toLowerCase().includes("fuel")),
    "Expected at least one parsed line item with fuel description."
  );
  assert.ok(
    parsed.lineCandidates.some((line) => Number(line.lineTotal) > 0),
    "Expected at least one parsed line item with a positive line total."
  );
});

run("loading-shell fixture is detected and placeholders are rejected", () => {
  const html = loadFixture("loading-shell.html");
  assert.equal(isLikelyTraLoadingShellHtml(html), true);

  const parsed = parseTraFixture(html);

  assert.ok(
    !parsed.normalizedFields.supplierName,
    "Supplier should stay empty for loading shell HTML."
  );
  assert.equal(parsed.lineCandidates.length, 0);
});

run("placeholder filter rejects standalone shell words", () => {
  assert.equal(isLikelyTraPlaceholderText("PLEASE"), true);
  assert.equal(isLikelyTraPlaceholderText("Close"), true);
  assert.equal(isLikelyTraPlaceholderText("PETROTZ"), false);
});

console.log("[tra-fixtures] all fixture checks passed.");
