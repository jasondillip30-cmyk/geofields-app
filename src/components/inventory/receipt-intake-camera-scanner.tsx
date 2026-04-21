"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import jsQR from "jsqr";

import type { CameraSessionState } from "@/components/inventory/receipt-intake-panel-types";

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
  onConfirmPayload: (payload: string) => Promise<boolean>;
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
  onClose,
  onEnterManually,
  onUseUploadFallback
}: ReceiptIntakeCameraScannerProps) {
  const pathname = usePathname();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const lastCandidateRef = useRef("");
  const stableHitsRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);

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
    scanBusyRef.current = false;
  }, []);

  const resetDetectionStability = useCallback(() => {
    lastCandidateRef.current = "";
    stableHitsRef.current = 0;
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
    (payload: string) => {
      onDetectedPayloadChange(payload);
      onSessionErrorChange(null);
      onSessionStateChange("detected");
      stopCameraStream();
    },
    [onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, stopCameraStream]
  );

  const runScanTick = useCallback(async () => {
    if (scanBusyRef.current || sessionState !== "ready") {
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
        handleStableDetection(candidate);
      }
    } finally {
      scanBusyRef.current = false;
    }
  }, [detectCandidateWithBarcodeDetector, detectCandidateWithJsQr, handleStableDetection, resetDetectionStability, sessionState]);

  const startCameraSession = useCallback(async () => {
    stopCameraStream();
    resetDetectionStability();
    onDetectedPayloadChange("");
    onSessionErrorChange(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      onSessionStateChange("error");
      onSessionErrorChange("Camera is not available on this device/browser.");
      return;
    }

    onSessionStateChange("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("Camera preview element is unavailable.");
      }
      video.srcObject = stream;
      await video.play();

      const BarcodeDetector = getBarcodeDetectorCtor();
      if (BarcodeDetector) {
        barcodeDetectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });
      } else {
        barcodeDetectorRef.current = null;
      }

      onSessionStateChange("ready");
      scanIntervalRef.current = window.setInterval(() => {
        void runScanTick();
      }, 220);
    } catch (error) {
      stopCameraStream();
      onSessionStateChange("error");
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access or use upload/manual fallback."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No rear camera found on this device."
            : error instanceof Error
              ? error.message
              : "Unable to start camera scanner.";
      onSessionErrorChange(message);
    }
  }, [onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, resetDetectionStability, runScanTick, stopCameraStream]);

  const handleConfirm = useCallback(async () => {
    if (!detectedPayload || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onConfirmPayload(detectedPayload);
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
    void startCameraSession();
  }, [startCameraSession]);

  const closeOverlay = useCallback(() => {
    stopCameraStream();
    resetDetectionStability();
    onSessionStateChange("idle");
    onSessionErrorChange(null);
    onDetectedPayloadChange("");
    onClose();
  }, [onClose, onDetectedPayloadChange, onSessionErrorChange, onSessionStateChange, resetDetectionStability, stopCameraStream]);

  useEffect(() => {
    if (!open) {
      stopCameraStream();
      resetDetectionStability();
      onSessionStateChange("idle");
      return;
    }
    void startCameraSession();
    return () => {
      stopCameraStream();
    };
  }, [open, onSessionStateChange, resetDetectionStability, startCameraSession, stopCameraStream]);

  useEffect(() => {
    if (!open) {
      return;
    }
    stopCameraStream();
  }, [open, pathname, stopCameraStream]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/95 text-white">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <div className="flex h-full flex-col">
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

        <div className="flex flex-1 flex-col px-4 py-4">
          <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="h-[60vh] min-h-[320px] w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[52%] w-[68%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
            </div>
          </div>

          <p className="mt-3 text-center text-sm text-slate-100">{statusText}</p>

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

          <div className="mt-auto grid grid-cols-2 gap-2 pt-4 text-sm">
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
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
            >
              Scan again
            </button>
            <button
              type="button"
              onClick={() => {
                closeOverlay();
                onEnterManually();
              }}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
            >
              Enter manually
            </button>
            <button
              type="button"
              onClick={() => {
                closeOverlay();
                onUseUploadFallback();
              }}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
            >
              Upload fallback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
