"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { ExpressionMonitor, TREND_WINDOW_MS } from "../../lib/camera/expressionMonitor";
import { extractMetrics, pointsFromLandmarks } from "../../lib/camera/expressionRules";
import { DEMO_PATIENT_ID, type CameraReport, type CameraStatus } from "../../lib/camera/report";
import type { ExpressionSample } from "../../lib/camera/types";

// MediaPipe 실행 파일(wasm)과 얼굴 랜드마크 모델. 인터넷이 없는 곳에서 시연하려면 public/ 아래에 두고
// 환경변수로 경로를 바꾼다. wasm 버전은 package.json의 @mediapipe/tasks-vision 버전과 맞춰야 한다.
const WASM_URL =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_URL ?? "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_LANDMARKER_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const SAMPLE_INTERVAL_MS = 500; // 표정 판정 간격
const REPORT_INTERVAL_MS = 10_000; // 의료진 화면으로 보내는 간격 (상태가 바뀌면 바로 보냄)

function cameraErrorStatus(error: unknown): CameraStatus {
  const name = (error as { name?: string })?.name;
  return name === "NotAllowedError" || name === "SecurityError" ? "permissionDenied" : "unavailable";
}

async function sendReport(report: CameraReport): Promise<void> {
  try {
    await fetch("/api/camera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    // 전송 실패는 다음 주기에 다시 보낸다
  }
}

/**
 * 환자 화면이 열려 있는 동안 웹캠으로 표정을 계속 분석하고, 판정 결과(숫자)만 /api/camera로 보낸다.
 * 영상은 브라우저 밖으로 나가지 않는다. 반환한 videoRef는 화면에 보이지 않는 video 요소에 연결한다.
 */
export function useFaceExpression(patientId: string = DEMO_PATIENT_ID) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>("starting");

  useEffect(() => {
    // 카메라 기능이 없는 환경(테스트, 오래된 브라우저, https가 아닌 주소)에서는 켜지 않고 보고도 하지 않는다
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentStatus: CameraStatus = "starting";
    let lastSample: ExpressionSample | null = null;
    let lastReportAt = 0;
    const monitor = new ExpressionMonitor();

    function report(nextStatus: CameraStatus, force = false) {
      const statusChanged = nextStatus !== currentStatus;
      currentStatus = nextStatus;
      setStatus(nextStatus);
      const now = Date.now();
      if (!force && !statusChanged && now - lastReportAt < REPORT_INTERVAL_MS) return;
      lastReportAt = now;

      const payload: CameraReport = { patientId, measuredAt: new Date(now).toISOString(), status: nextStatus };
      const trend = monitor.trend();
      if (nextStatus === "measuring" && lastSample && trend) {
        payload.current = { dominant: lastSample.analysis.dominant, state: lastSample.analysis.state };
        payload.trend = { ...trend, windowMinutes: TREND_WINDOW_MS / 60_000 };
      }
      void sendReport(payload);
    }

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && landmarker && video.readyState >= 2 && video.videoWidth > 0) {
        const timeMs = performance.now();
        const result = landmarker.detectForVideo(video, timeMs);
        const landmarks = result.faceLandmarks[0];
        if (!landmarks) {
          report("noFace");
        } else {
          const metrics = extractMetrics(pointsFromLandmarks(landmarks, video.videoWidth / video.videoHeight));
          const sample = monitor.addFrame(timeMs, metrics);
          if (sample) {
            lastSample = sample;
            report("measuring");
          } else {
            report("calibrating");
          }
        }
      }
      timer = setTimeout(tick, SAMPLE_INTERVAL_MS);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (error) {
        if (!cancelled) report(cameraErrorStatus(error), true);
        return;
      }
      // 기다리는 동안 화면이 닫혔으면(또는 개발 모드에서 effect가 두 번 실행되면) 바로 끈다
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const created = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (cancelled) {
          created.close();
          return;
        }
        landmarker = created;
      } catch (error) {
        console.error("face landmarker load error", error);
        stream.getTracks().forEach((track) => track.stop()); // 분석을 못 하면 카메라도 끈다
        if (!cancelled) report("unavailable", true);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        if (!cancelled) report(cameraErrorStatus(error), true);
        return;
      }
      report("calibrating", true);
      tick();
    }

    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
    };
  }, [patientId]);

  return { videoRef, status };
}
