import { buildObjectKey, putObject, type StoredObjectRecord } from "./object-store";

export interface ArtifactRecord {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

export interface ExtractionArtifactManifest {
  extractionId: string;
  createdAt: string;
  source: {
    fileName: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  };
  normalized: {
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    normalizationPath: string;
    normalizationApplied: boolean;
    preprocessingPrimary: string[];
    preprocessingQrEnhanced: string[];
  };
  artifacts: {
    raw: ArtifactRecord;
    primary: ArtifactRecord;
    qrEnhanced: ArtifactRecord | null;
  };
  diagnostics: {
    serviceVersion: string;
    timingMs: {
      total: number;
      ingest: number;
      extract: number;
      persist: number;
    };
  };
}

function toManifestArtifact(
  objectRecord: StoredObjectRecord,
  dimensions: { width: number | null; height: number | null }
): ArtifactRecord {
  return {
    key: objectRecord.key,
    url: objectRecord.url,
    mimeType: objectRecord.mimeType,
    size: objectRecord.size,
    width: dimensions.width,
    height: dimensions.height,
    sha256: objectRecord.sha256
  };
}

export async function persistArtifactManifest({
  extractionId,
  source,
  normalized,
  raw,
  primary,
  qrEnhanced,
  diagnostics
}: {
  extractionId: string;
  source: ExtractionArtifactManifest["source"];
  normalized: ExtractionArtifactManifest["normalized"];
  raw: {
    object: StoredObjectRecord;
    width: number | null;
    height: number | null;
  };
  primary: {
    object: StoredObjectRecord;
    width: number | null;
    height: number | null;
  };
  qrEnhanced: {
    object: StoredObjectRecord;
    width: number | null;
    height: number | null;
  } | null;
  diagnostics: ExtractionArtifactManifest["diagnostics"];
}) {
  const manifest: ExtractionArtifactManifest = {
    extractionId,
    createdAt: new Date().toISOString(),
    source,
    normalized,
    artifacts: {
      raw: toManifestArtifact(raw.object, {
        width: raw.width,
        height: raw.height
      }),
      primary: toManifestArtifact(primary.object, {
        width: primary.width,
        height: primary.height
      }),
      qrEnhanced: qrEnhanced
        ? toManifestArtifact(qrEnhanced.object, {
            width: qrEnhanced.width,
            height: qrEnhanced.height
          })
        : null
    },
    diagnostics
  };

  const buffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const key = buildObjectKey({
    extractionId,
    variant: "manifest",
    extension: "json"
  });
  const storedManifest = await putObject({
    key,
    buffer,
    mimeType: "application/json"
  });

  return {
    manifest,
    storedManifest
  };
}
