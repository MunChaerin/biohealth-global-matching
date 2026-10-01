"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { MOTION_THRESHOLDS, type MotionReport, type MotionStatus, type MotionThresholds } from "../../lib/motion/types";

const WASM_URL = process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_URL ?? "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = process.env.NEXT_PUBLIC_FACE_LANDMARKER_MODEL_URL ?? "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useMotionTracking(patientId: string, enabled = true, thresholds: MotionThresholds = MOTION_THRESHOLDS) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [report, setReport] = useState<MotionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFaceAt: number | null = null;
    let absenceStartedAt: number | null = null;
    let lastMovementAt: number | null = null;
    let previousNose: { x: number; y: number } | null = null;
    let lastReportAt = 0;

    const send = (next: MotionReport) => {
      setReport(next);
      if (Date.now() - lastReportAt < 2500 && next.status !== "away" && next.status !== "still") return;
      lastReportAt = Date.now();
      void fetch("/api/motion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => undefined);
    };

    const makeReport = (status: MotionStatus, level: MotionReport["movementLevel"], now: number): MotionReport => {
      const lastDetectedAt = lastFaceAt ? new Date(lastFaceAt).toISOString() : null;
      const lastMovement = lastMovementAt ? new Date(lastMovementAt).toISOString() : null;
      return { patientId, measuredAt: new Date(now).toISOString(), status, movementLevel: level, stillnessSeconds: lastMovementAt ? Math.max(0, Math.floor((now - lastMovementAt) / 1000)) : 0, absenceSeconds: absenceStartedAt ? Math.max(0, Math.floor((now - absenceStartedAt) / 1000)) : 0, lastDetectedAt, lastMovementAt: lastMovement, cameraConnected: true };
    };

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const now = Date.now();
      if (video && landmarker && video.readyState >= 2) {
        const landmarks = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0];
        if (!landmarks) {
          absenceStartedAt ??= now;
          const absence = (now - absenceStartedAt) / 1000;
          send(makeReport(absence >= thresholds.absenceSeconds ? "away" : "noFace", "unknown", now));
        } else {
          lastFaceAt = now;
          absenceStartedAt = null;
          const nose = landmarks[1] ?? landmarks[4];
          const distance = previousNose && nose ? Math.hypot(nose.x - previousNose.x, nose.y - previousNose.y) : 1;
          const moved = distance > 0.008;
          if (moved || !lastMovementAt) lastMovementAt = now;
          if (nose) previousNose = { x: nose.x, y: nose.y };
          const stillness = (now - lastMovementAt) / 1000;
          const status: MotionStatus = stillness >= thresholds.stillSeconds ? "still" : stillness >= thresholds.lowMovementSeconds ? "lowMovement" : "present";
          send(makeReport(status, moved ? "moving" : stillness >= thresholds.lowMovementSeconds ? "low" : "none", now));
        }
      }
      timer = setTimeout(tick, 1000);
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저에서는 웹캠을 사용할 수 없습니다.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarker = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1 });
        const video = videoRef.current;
        if (!video || cancelled) return;
        video.srcObject = stream;
        await video.play();
        setLoading(false);
        tick();
      } catch (cause) {
        if (!cancelled) { setLoading(false); setError(cause instanceof Error ? cause.message : "웹캠을 시작하지 못했습니다."); }
      }
    }
    void start();
    return () => { cancelled = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); landmarker?.close(); };
  }, [enabled, patientId, thresholds.absenceSeconds, thresholds.lowMovementSeconds, thresholds.stillSeconds]);

  return { videoRef, report, loading, error };
}
