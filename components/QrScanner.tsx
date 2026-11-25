"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CameraOff, Loader2 } from "lucide-react";

interface QrScannerProps {
  /** Called once with the first decoded value that passes `accept`. */
  onResult: (value: string) => void;
  /** Return true for values worth handing back; others keep scanning. */
  accept?: (value: string) => boolean;
  /** Shown when a QR code is read but `accept` rejects it. */
  rejectHint?: string;
}

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow it in your browser’s site settings, or paste the value instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera found on this device. Paste the value instead.";
  }
  if (name === "NotReadableError") {
    return "Your camera is in use by another app. Close it and try again.";
  }
  return "Couldn’t start the camera. Paste the value instead.";
}

/**
 * Live camera QR scanner. Decoding happens entirely in the browser with
 * jsQR; frames never leave the device. The camera stream is stopped as
 * soon as a value is accepted or the component unmounts.
 */
export default function QrScanner({
  onResult,
  accept,
  rejectHint,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onResultRef = useRef(onResult);
  const acceptRef = useRef(accept);
  onResultRef.current = onResult;
  acceptRef.current = accept;

  const [status, setStatus] = useState<"starting" | "scanning" | "error">(
    "starting",
  );
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let done = false;

    const stop = () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const tick = () => {
      if (done) return;
      const video = videoRef.current;
      if (video && video.readyState >= video.HAVE_ENOUGH_DATA) {
        const canvas = (canvasRef.current ??= document.createElement("canvas"));
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            const image = ctx.getImageData(0, 0, width, height);
            const code = jsQR(image.data, width, height, {
              inversionAttempts: "dontInvert",
            });
            const value = code?.data?.trim();
            if (value) {
              if (!acceptRef.current || acceptRef.current(value)) {
                stop();
                onResultRef.current(value);
                return;
              }
              setRejected(true);
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          window.isSecureContext
            ? "This browser can’t access a camera. Paste the value instead."
            : "Camera access needs a secure (https) connection. Paste the value instead.",
        );
        setStatus("error");
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (done) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play();
        setStatus("scanning");
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (done) return;
        setError(describeCameraError(err));
        setStatus("error");
      }
    })();

    return stop;
  }, []);

  if (status === "error") {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-300">
        <CameraOff size={16} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Starting camera…
          </div>
        )}
        <div className="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/70" />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
        {rejected && rejectHint
          ? rejectHint
          : "Point your camera at the QR code. Scanning happens on this device."}
      </p>
    </div>
  );
}
