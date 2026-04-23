"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";

import type { CameraScanConfirmPayload, CameraSessionState } from "@/components/inventory/receipt-intake-panel-types";

type BarcodeCandidate = {
  rawValue?: string;
  boundingBox?: DOMRectReadOnly;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeCandidate[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

function getBarcodeDetectorCtor() {
  return (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

function isInsideRoi(x: number, y: number, roi: { x: number; y: number; width: number; height: number }) {
  return x >= roi.x && x <= roi.x + roi.width && y >= roi.y && y <= roi.y + roi.height;
}

function trimPayload(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

interface ReceiptIntakeCameraScannerProps {
  open: boolean;
  sessionState: CameraSessionState;
  sessionError: string | null;
  detectedPayload: string;
  onSessionStateChange: (state: CameraSessionState) => void;
  onSessionErrorChange: (message: string | null) => void;
  onDetectedPayloadChange: (payload: string) => void;
  onConfirmPayload: (payload: CameraScanConfirmPayload) => Promise<boolean>;
  onCancelPendingConfirm: () => void;
  onClose: () => void;
  onEnterManually: () => void;
  onUseUploadFallback: () => void;
}

export function ReceiptIntakeCameraScanner({
  open,
  sessionState,
  sessionError,
  detectedPayload,
  onSessionStateChange,
  onSessionErrorChange,
  onDetectedPayloadChange,
  onConfirmPayload,
  onCancelPendingConfirm,
  onClose,
  onEnterManually,
  onUseUploadFallback
}: ReceiptIntakeCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const lastCandidateRef = useRef("");
  const stableHitsRef = useRef(0);
  const sessionStateRef = useRef<CameraSessionState>(sessionState);
  const openRef = useRef(open);
  const activeStartAttemptRef = useRef(0);
  const capturedFrameFileRef = useRef<File | null>(null);
  const frozenFrameUrlRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [frozenFrameUrl, setFrozenFrameUrl] = useState("");

  const statusText = useMemo(() => {
    if (sessionState === "requesting") {
      return "Requesting camera access...";
    }
    if (sessionState === "detected") {
      return "QR captured. Confirm to continue.";
    }
    if (sessionState === "error") {
      return sessionError || "Camera unavailable. Use manual or upload fallback.";
    }
    if (sessionState === "ready") {
      return "Align QR code within frame";
    }
    return "Start camera to scan receipt QR";
  }, [sessionError, sessionState]);

  const stopCameraStream = useCallback(() => {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    barcodeDetectorRef.current = null;
    scanBusyRef.current = false;
  }, []);

  const cancelPendingStart = useCallback(() => {
    activeStartAttemptRef.current += 1;
  }, []);

  const resetDetectionStability = useCallback(() => {
    lastCandidateRef.current = "";
    stableHitsRef.current = 0;
  }, []);

  const clearCapturedFrame = useCallback(() => {
    capturedFrameFileRef.current = null;
    const previousUrl = frozenFrameUrlRef.current;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      frozenFrameUrlRef.current = null;
    }
    setFrozenFrameUrl("");
  }, []);

  const captureCurrentFrameFile = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92);
    });
    if (!blob) {
      return null;
    }
    const file = new File([blob], `camera-qr-capture-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
    const nextUrl = URL.createObjectURL(file);
    const previousUrl = frozenFrameUrlRef.current;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    frozenFrameUrlRef.current = nextUrl;
    capturedFrameFileRef.current = file;
    setFrozenFrameUrl(nextUrl);
    return file;
  }, []);

  const detectCandidateWithBarcodeDetector = useCallback(async () => {
    const detector = barcodeDetectorRef.current;
    const video = videoRef.current;
    if (!detector || !video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return "";
    }

    const roi = {
      x: video.videoWidth * 0.18,
      y: video.videoHeight * 0.25,
      width: video.videoWidth * 0.64,
      height: video.videoHeight * 0.5
    };
    const roiCenterX = roi.x + roi.width / 2;
    const roiCenterY = roi.y + roi.height / 2;

    const detections = await detector.detect(video);
    let winningPayload = "";
    let winningDistance = Number.POSITIVE_INFINITY;

    for (const detection of detections) {
      const payload = trimPayload(detection.rawValue);
      if (!payload) {
        continue;
      }
      const box = detection.boundingBox;
      if (!box) {
        continue;
      }
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      if (!isInsideRoi(centerX, centerY, roi)) {
        continue;
      }
      const distance = Math.hypot(centerX - roiCenterX, centerY - roiCenterY);
      if (distance < winningDistance) {
        winningDistance = distance;
        winningPayload = payload;
      }
    }

    return winningPayload;
  }, []);

  const detectCandidateWithJsQr = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return "";
    }

    const roiWidth = Math.max(1, Math.floor(video.videoWidth * 0.64));
    const roiHeight = Math.max(1, Math.floor(video.videoHeight * 0.5));
    const roiX = Math.max(0, Math.floor((video.videoWidth - roiWidth) / 2));
    const roiY = Math.max(0, Math.floor(video.videoHeight * 0.25));

    canvas.width = roiWidth;
    canvas.height = roiHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return "";
    }

    context.drawImage(video, roiX, roiY, roiWidth, roiHeight, 0, 0, roiWidth, roiHeight);
    const imageData = context.getImageData(0, 0, roiWidth, roiHeight);
    const result = jsQR(imageData.data, roiWidth, roiHeight, { inversionAttempts: "attemptBoth" });
    return trimPayload(result?.data);
  }, []);

  const handleStableDetection = useCallback(
    async (payload: string) => {
      await captureCurrentFrameFile();
      onDetectedPayloadChange(payload);
      onSessionErrorChange(null);
      onSessionStateChange("detected");
      stopCameraStream();
    },
    [captureCurrentFrameFile, onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, stopCameraStream]
  );

  const runScanTick = useCallback(async () => {
    if (scanBusyRef.current || sessionStateRef.current !== "ready") {
      return;
    }
    scanBusyRef.current = true;
    try {
      let candidate = "";
      const BarcodeDetector = getBarcodeDetectorCtor();
      if (BarcodeDetector) {
        candidate = await detectCandidateWithBarcodeDetector();
      }
      if (!candidate) {
        candidate = detectCandidateWithJsQr();
      }

      if (!candidate) {
        resetDetectionStability();
        return;
      }

      if (candidate === lastCandidateRef.current) {
        stableHitsRef.current += 1;
      } else {
        lastCandidateRef.current = candidate;
        stableHitsRef.current = 1;
      }

      if (stableHitsRef.current >= 3) {
        await handleStableDetection(candidate);
      }
    } catch (error) {
      resetDetectionStability();
      if (process.env.NODE_ENV !== "production") {
        console.warn("Receipt scanner tick failed", error);
      }
    } finally {
      scanBusyRef.current = false;
    }
  }, [detectCandidateWithBarcodeDetector, detectCandidateWithJsQr, handleStableDetection, resetDetectionStability]);

  const startCameraSession = useCallback(async () => {
    const attemptId = activeStartAttemptRef.current + 1;
    activeStartAttemptRef.current = attemptId;
    stopCameraStream();
    resetDetectionStability();
    clearCapturedFrame();
    onDetectedPayloadChange("");
    onSessionErrorChange(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      onSessionStateChange("error");
      onSessionErrorChange("Camera is not available on this device/browser.");
      return;
    }

    onSessionStateChange("requesting");

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });

      if (activeStartAttemptRef.current !== attemptId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("Camera preview element is unavailable.");
      }
      video.srcObject = stream;
      await video.play();

      if (activeStartAttemptRef.current !== attemptId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        video.pause();
        video.srcObject = null;
        return;
      }

      const BarcodeDetector = getBarcodeDetectorCtor();
      if (BarcodeDetector) {
        barcodeDetectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });
      } else {
        barcodeDetectorRef.current = null;
      }

      onSessionStateChange("ready");
      scanIntervalRef.current = window.setInterval(() => {
        void runScanTick().catch((error) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Receipt scanner tick promise rejected", error);
          }
        });
      }, 220);
    } catch (error) {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (activeStartAttemptRef.current !== attemptId || !openRef.current) {
        return;
      }
      stopCameraStream();
      onSessionStateChange("error");
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access or use upload/manual fallback."
          : error instanceof DOMException && error.name === "AbortError"
            ? "Camera start was interrupted. Please retry scan."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No rear camera found on this device."
            : error instanceof Error
              ? error.message
              : "Unable to start camera scanner.";
      onSessionErrorChange(message);
    }
  }, [clearCapturedFrame, onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, resetDetectionStability, runScanTick, stopCameraStream]);

  const handleConfirm = useCallback(async () => {
    if (!detectedPayload || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onConfirmPayload({
        rawPayload: detectedPayload,
        capturedFrameFile: capturedFrameFileRef.current
      });
      if (ok) {
        stopCameraStream();
        onSessionStateChange("idle");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }, [detectedPayload, onClose, onConfirmPayload, onSessionStateChange, stopCameraStream, submitting]);

  const handleScanAgain = useCallback(() => {
    onCancelPendingConfirm();
    void startCameraSession();
  }, [onCancelPendingConfirm, startCameraSession]);

  const closeOverlay = useCallback(() => {
    onCancelPendingConfirm();
    cancelPendingStart();
    stopCameraStream();
    resetDetectionStability();
    clearCapturedFrame();
    onSessionStateChange("idle");
    onSessionErrorChange(null);
    onDetectedPayloadChange("");
    onClose();
  }, [cancelPendingStart, clearCapturedFrame, onCancelPendingConfirm, onClose, onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, resetDetectionStability, stopCameraStream]);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      cancelPendingStart();
    }
  }, [cancelPendingStart, open]);

  useEffect(() => {
    if (!open) {
      onCancelPendingConfirm();
      cancelPendingStart();
      stopCameraStream();
      resetDetectionStability();
      clearCapturedFrame();
      onSessionStateChange("idle");
      return;
    }
    void startCameraSession();
    return () => {
      onCancelPendingConfirm();
      cancelPendingStart();
      stopCameraStream();
      clearCapturedFrame();
    };
  }, [cancelPendingStart, clearCapturedFrame, onCancelPendingConfirm, open, onSessionStateChange, resetDetectionStability, startCameraSession, stopCameraStream]);

  useEffect(() => {
    return () => {
      onCancelPendingConfirm();
      cancelPendingStart();
      stopCameraStream();
      clearCapturedFrame();
    };
  }, [cancelPendingStart, clearCapturedFrame, onCancelPendingConfirm, stopCameraStream]);

  if (!open) {
    return null;
  }
  const showFrozenFrame = Boolean(frozenFrameUrl) && (sessionState === "detected" || submitting);

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/95 text-white">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <div className="flex h-full min-h-0 flex-col h-[100dvh]">
        <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
          <div>
            <p className="text-base font-semibold">Scan Receipt QR</p>
            <p className="text-xs text-slate-200">Align QR code within frame</p>
          </div>
          <button
            type="button"
            onClick={closeOverlay}
            className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-black">
              {showFrozenFrame && frozenFrameUrl ? (
                <div
                  aria-label="Captured QR frame"
                  className="h-[48svh] min-h-[220px] max-h-[440px] w-full bg-cover bg-center sm:h-[56vh] sm:min-h-[300px]"
                  style={{ backgroundImage: `url("${frozenFrameUrl}")` }}
                />
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="h-[48svh] min-h-[220px] max-h-[440px] w-full object-cover sm:h-[56vh] sm:min-h-[300px]"
                />
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[52%] w-[68%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
              </div>
            </div>

            <p className="mt-3 text-center text-sm text-slate-100">{statusText}</p>
            <p className="mt-1 text-center text-xs text-slate-300">
              Some mobile browsers may ask for camera permission each time you open this scanner.
            </p>

            {detectedPayload ? (
              <div className="mt-3 rounded-lg border border-emerald-300/40 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                <p className="font-semibold text-emerald-200">Detected payload</p>
                <p className="mt-1 max-h-20 overflow-auto break-all">{detectedPayload}</p>
              </div>
            ) : null}

            {sessionError ? (
              <div className="mt-3 rounded-lg border border-rose-300/40 bg-rose-500/10 p-3 text-xs text-rose-100">
                {sessionError}
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/15 bg-slate-950/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={sessionState !== "detected" || !detectedPayload || submitting}
                className="rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Continuing..." : "Continue"}
              </button>
              <button
                type="button"
                onClick={handleScanAgain}
                disabled={submitting}
                className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Scan again
              </button>
              <button
                type="button"
                onClick={() => {
                  closeOverlay();
                  onEnterManually();
                }}
                disabled={submitting}
                className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enter manually
              </button>
              <button
                type="button"
                onClick={() => {
                  closeOverlay();
                  onUseUploadFallback();
                }}
                disabled={submitting}
                className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload fallback
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
