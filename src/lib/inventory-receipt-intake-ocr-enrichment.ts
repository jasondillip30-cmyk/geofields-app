import { existsSync } from "node:fs";
import { createWorker } from "tesseract.js";

import { buildImageOcrVariants, roundTo, scoreOcrCandidate } from "@/lib/inventory-receipt-intake-ocr";
import { resolveNextDistDir, resolveNextDistPath } from "@/lib/next-dist-dir";
import { debugLog } from "@/lib/observability";

interface PdfParseInstance {
  getText: () => Promise<{ text?: string }>;
  destroy?: () => Promise<void> | void;
}

type PdfParseCtor = new (options: { data: Buffer }) => PdfParseInstance;

export const OCR_ENRICHMENT_TIMEOUT_MS = 4000;

export async function extractRawText({
  fileBuffer,
  mimeType,
  timeoutMs = OCR_ENRICHMENT_TIMEOUT_MS
}: {
  fileBuffer: Buffer;
  mimeType: string;
  timeoutMs?: number;
}) {
  if (mimeType.includes("pdf")) {
    const parsed = await parsePdfTextSafely(fileBuffer, "ocr");
    if (parsed.ok) {
      return {
        text: parsed.text,
        method: "PDF_TEXT" as const,
        preprocessingApplied: [] as string[],
        warning: "",
        debugCandidates: [] as Array<{
          label: string;
          confidence: number;
          score: number;
          textLength: number;
        }>
      };
    }
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: parsed.message || "PDF OCR text extraction unavailable.",
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  const variants = await buildImageOcrVariants(fileBuffer);
  if (variants.length === 0) {
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: "Image OCR preprocessing produced no usable variants.",
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  if (!isTesseractWorkerLikelyAvailable()) {
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning:
        `OCR enrichment worker module is unavailable (${resolveNextDistDir()}/worker-script/node/index.js). Skipping optional OCR enrichment.`,
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  try {
    const worker = await createWorker("eng");
    const startedAt = Date.now();
    let timedOut = false;
    const candidates: Array<{
      label: string;
      text: string;
      confidence: number;
      score: number;
      textLength: number;
      preprocessingApplied: string[];
    }> = [];

    for (const variant of variants) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        timedOut = true;
        break;
      }
      try {
        const result = await withTimeout(
          worker.recognize(variant.buffer),
          remainingMs,
          `OCR enrichment timed out after ${timeoutMs}ms`
        );
        const text = (result.data.text || "").trim();
        const confidence = Number(result.data.confidence || 0);
        const score = scoreOcrCandidate(text, confidence);
        candidates.push({
          label: variant.label,
          text,
          confidence: roundTo(confidence, 2),
          score: roundTo(score, 3),
          textLength: text.length,
          preprocessingApplied: variant.preprocessingApplied
        });
      } catch (error) {
        const reason = normalizeOcrEnrichmentError(error);
        if (reason.toLowerCase().includes("timed out")) {
          timedOut = true;
          break;
        }
        candidates.push({
          label: variant.label,
          text: "",
          confidence: 0,
          score: 0,
          textLength: 0,
          preprocessingApplied: variant.preprocessingApplied
        });
      }
    }

    await worker.terminate().catch(() => undefined);

    if (timedOut) {
      return {
        text: "",
        method: "NONE" as const,
        preprocessingApplied: [] as string[],
        warning: `OCR enrichment timed out after ${timeoutMs}ms`,
        debugCandidates: candidates.map((candidate) => ({
          label: candidate.label,
          confidence: candidate.confidence,
          score: candidate.score,
          textLength: candidate.textLength
        }))
      };
    }

    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    if (!best || !best.text) {
      return {
        text: "",
        method: "NONE" as const,
        preprocessingApplied: [] as string[],
        warning: "OCR did not return readable text from processed variants.",
        debugCandidates: candidates.map((candidate) => ({
          label: candidate.label,
          confidence: candidate.confidence,
          score: candidate.score,
          textLength: candidate.textLength
        }))
      };
    }

    const usedPreprocessing = best.preprocessingApplied.filter((step) => step !== "original");
    return {
      text: best.text,
      method: usedPreprocessing.length > 0 ? ("OCR_IMAGE_PREPROCESSED" as const) : ("OCR_IMAGE" as const),
      preprocessingApplied: usedPreprocessing,
      warning: "",
      debugCandidates: candidates.map((candidate) => ({
        label: candidate.label,
        confidence: candidate.confidence,
        score: candidate.score,
        textLength: candidate.textLength
      }))
    };
  } catch (error) {
    const reason = normalizeOcrEnrichmentError(error);
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: reason,
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }
}

function isTesseractWorkerLikelyAvailable() {
  const workerPath = resolveNextDistPath("worker-script", "node", "index.js");
  return existsSync(workerPath);
}

export function normalizeOcrEnrichmentError(error: unknown) {
  const reason = error instanceof Error ? error.message : "Optional OCR enrichment failed.";
  if (reason.includes("/worker-script/node/index.js")) {
    return "OCR enrichment worker module is unavailable (dist worker-script path missing).";
  }
  return reason;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function parsePdfTextSafely(
  fileBuffer: Buffer,
  context: "qr" | "ocr"
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const parserCtor = await loadPdfParserCtor();
    if (!parserCtor) {
      const message = "PDF parser module could not be loaded.";
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][pdf][error]", {
          stage: "module_import",
          context,
          message
        });
      }
      return {
        ok: false,
        message
      };
    }

    const parser = new parserCtor({ data: fileBuffer });
    const parsed = await parser.getText();
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
    return {
      ok: true,
      text: parsed.text || ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF parsing failed.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][pdf][error]", {
        stage: "parse",
        context,
        message
      });
    }
    return {
      ok: false,
      message
    };
  }
}

async function loadPdfParserCtor(): Promise<PdfParseCtor | null> {
  try {
    const pdfModule = await import("pdf-parse");
    const candidate = ("PDFParse" in pdfModule ? pdfModule.PDFParse : null) as unknown;
    if (typeof candidate === "function") {
      return candidate as PdfParseCtor;
    }
    return null;
  } catch {
    return null;
  }
}
