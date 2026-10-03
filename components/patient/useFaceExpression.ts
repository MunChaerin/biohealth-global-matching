"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { applyGamma, frameBrightness, gammaFor, previewBrightness } from "../../lib/camera/brightness";
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

let infoLogFilterInstalled = false;

/**
 * MediaPipe wasm은 "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." 같은 안내 로그를
 * console.error로 찍어서, Next.js 개발 모드 화면에 빨간 오류처럼 뜬다. 실제 오류는 아니므로 "INFO:"로
 * 시작하는 메시지만 걸러낸다. wasm이 처음 로드될 때 console.error를 bind해 두기 때문에 모델을 불러오기
 * 전에 설치해야 하고, 되돌리지 않는다 (나머지 메시지는 원래 console.error로 그대로 전달).
 */
export function filterMediapipeInfoLogs() {
  if (infoLogFilterInstalled) return;
  infoLogFilterInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO:")) return;
    original(...args);
  };
}

function cameraErrorStatus(error: unknown): CameraStatus {
  const name = (error as { name?: string })?.name;
  return name === "NotAllowedError" || name === "SecurityError" ? "permissionDenied" : "unavailable";
}

export async function sendReport(report: CameraReport): Promise<void> {
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
 * enabled(환자가 동의하고 켠 상태)인 동안 웹캠으로 표정을 계속 분석하고, 판정 결과(숫자)만 /api/camera로 보낸다.
 * enabled가 false면 카메라를 아예 켜지 않고, 켜져 있었다면 카메라·분석·전송을 모두 멈춘다.
 * 영상은 브라우저 밖으로 나가지 않는다. 반환한 videoRef는 미리보기 video 요소에 연결하고,
 * previewFilter(밝기 배율)는 어두운 영상일 때 미리보기를 밝게 보여주는 데 쓴다.
 */
export type MouthAssistStatus = "waiting" | "ready" | "speaking" | "noFace";

/**
 * 카메라가 켜져 있을 때 표정 분석을 어떻게 할지.
 * - on: 표정 분석·전송
 * - paused: 표정 관찰에 동의했지만 알약 확인 중 -> 분석 멈춤, 의료진 화면에는 "paused" 상태만 전송
 * - off: 표정 관찰에 동의하지 않고 알약 확인용으로만 카메라를 켬 -> 분석·전송 모두 안 함
 * 카메라를 껐다 켜지 않도록 effect가 아니라 ref로 읽는다.
 */
export type ExpressionAnalysis = "on" | "paused" | "off";

// 카메라 해상도. 표정 분석은 640x480이면 충분하지만, 알약 확인은 각인을 읽어야 해서 가능한 한 높게 받는다
// (640x480에서는 알약을 얼굴 앞까지 가져와야 글씨가 보였음). 카메라를 새로 켜지 않고 쓰던 카메라의 설정만 바꾼다.
const EXPRESSION_RESOLUTION = { width: { ideal: 640 }, height: { ideal: 480 } };
const PILL_RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1080 } };

/** 카메라 해상도를 바꾸고 실제로 받은 크기를 돌려준다. 기기가 못 맞추면 되는 값으로 내려간다. */
async function setResolution(stream: MediaStream, pill: boolean): Promise<{ width: number; height: number } | null> {
  const track = stream.getVideoTracks?.()[0];
  if (!track) return null;
  try {
    await track.applyConstraints?.(pill ? PILL_RESOLUTION : EXPRESSION_RESOLUTION);
  } catch (error) {
    console.warn("[카메라] 해상도를 바꾸지 못했습니다.", error);
  }
  const { width, height } = track.getSettings?.() ?? {};
  return width && height ? { width, height } : null;
}

export function useFaceExpression(
  enabled: boolean,
  patientId: string = DEMO_PATIENT_ID,
  onMouthStatus?: (status: MouthAssistStatus) => void,
  analysis: ExpressionAnalysis = "on",
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>(enabled ? "starting" : "off");
  const [previewFilter, setPreviewFilter] = useState(1);
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  // 알약 확인도 같은 밝기 보정을 쓰도록 바깥에 꺼내 둔다 (카메라가 켜져 있을 때만 값이 있음)
  const correctedFrameRef = useRef<((video: HTMLVideoElement) => HTMLVideoElement | HTMLCanvasElement) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraSize, setCameraSize] = useState<{ width: number; height: number } | null>(null);
  // analysis가 "on"이 아니면 알약 확인 중 (CameraIndicator 참고)
  const pillMode = analysis !== "on";
  const pillModeRef = useRef(pillMode);
  pillModeRef.current = pillMode;

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      onMouthStatus?.("waiting");
      return;
    }
    // 카메라 기능이 없는 환경(테스트, 오래된 브라우저, https가 아닌 주소)에서는 켜지 않고 보고도 하지 않는다
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    setStatus("starting");

    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentStatus: CameraStatus = "starting";
    let lastSample: ExpressionSample | null = null;
    let lastReportAt = 0;
    let canvas: HTMLCanvasElement | undefined;
    let context: CanvasRenderingContext2D | null | undefined;
    let lastPreviewBrightness = 1;
    const monitor = new ExpressionMonitor();

    function report(nextStatus: CameraStatus, force = false) {
      const statusChanged = nextStatus !== currentStatus;
      currentStatus = nextStatus;
      setStatus(nextStatus);
      if (analysisRef.current === "off") return; // 표정 관찰에 동의하지 않았으면 아무것도 보내지 않는다
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

    /** 분석할 프레임. 어두우면 캔버스에 옮겨 감마 보정한 것을, 아니면 video를 그대로 쓴다. */
    function correctedFrame(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
      canvas ??= document.createElement("canvas");
      context ??= canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return video;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const brightness = frameBrightness(image.data);
      const nextPreview = Math.round(previewBrightness(brightness) * 10) / 10;
      if (nextPreview !== lastPreviewBrightness) {
        lastPreviewBrightness = nextPreview;
        setPreviewFilter(nextPreview);
      }
      const gamma = gammaFor(brightness);
      if (gamma === 1) return video;
      applyGamma(image.data, gamma);
      context.putImageData(image, 0, 0);
      return canvas;
    }

    correctedFrameRef.current = correctedFrame;

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      if (analysisRef.current !== "on") {
        // 알약 확인 중: 카메라는 켜 둔 채 표정 분석만 멈춘다
        if (analysisRef.current === "paused") report("paused");
        else setStatus(currentStatus = "paused");
      } else if (video && landmarker && video.readyState >= 2 && video.videoWidth > 0) {
        const timeMs = performance.now();
        const result = landmarker.detectForVideo(correctedFrame(video), timeMs);
        const landmarks = result.faceLandmarks[0];
        if (!landmarks) {
          report("noFace");
          onMouthStatus?.("noFace");
        } else {
          const metrics = extractMetrics(pointsFromLandmarks(landmarks, video.videoWidth / video.videoHeight));
          onMouthStatus?.(metrics.mouthOpen > 0.055 ? "speaking" : "ready");
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
        filterMediapipeInfoLogs();
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
      streamRef.current = stream;
      if (pillModeRef.current) {
        // 알약 확인을 하려고 카메라를 켠 경우: 처음부터 높은 해상도로
        const size = await setResolution(stream, true);
        if (cancelled) return;
        setCameraSize(size);
        if (size) console.info(`[카메라] 알약 확인 해상도 ${size.width}x${size.height}`);
      }
      if (analysisRef.current === "on") report("calibrating", true);
      tick();
    }

    void start();

    return () => {
      cancelled = true;
      correctedFrameRef.current = null;
      streamRef.current = null;
      setCameraSize(null);
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
    };
  }, [enabled, patientId, onMouthStatus]);

  // 알약 확인을 시작·종료하면 해상도만 바꾼다 (카메라는 그대로)
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    let cancelled = false;
    void setResolution(stream, pillMode).then((size) => {
      if (cancelled) return;
      setCameraSize(size);
      if (size) console.info(`[카메라] ${pillMode ? "알약 확인" : "표정 관찰"} 해상도 ${size.width}x${size.height}`);
    });
    return () => {
      cancelled = true;
    };
  }, [pillMode]);

  return { videoRef, status, previewFilter, correctedFrame: correctedFrameRef, cameraSize };
}
