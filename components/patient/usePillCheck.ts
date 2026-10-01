"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MedicationItem } from "../../lib/medication/schedule";
import { DebugPillRecognizer, loadPillRecognizer, type PillRecognizer } from "../../lib/pill/recognizer";
import { PillVerdictTracker, type PillDetection, type PillVerdict } from "../../lib/pill/verdict";

const DETECT_INTERVAL_MS = 250;

export type PillCheckPhase = "loading" | "notReady" | "error" | "running";

async function postMedicationEvent(body: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch("/api/medication", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 알약 확인 모드. 카메라 영상을 주기적으로 알약 인식 모델에 넣고, 지금 먹어야 하는 약과 비교한 판정을 돌려준다.
 * 다른 약으로 판정되면 그 약이 사라졌다 다시 나오기 전까지 한 번만 의료진 기록에 남긴다.
 * debug면 모델 대신 버튼으로 보이는 약을 정한다 (?pillDebug=1, 모델 학습 전 화면 흐름 확인용).
 */
export function usePillCheck(options: {
  active: boolean;
  medication: MedicationItem | null;
  patientId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  correctedFrame: RefObject<((video: HTMLVideoElement) => HTMLVideoElement | HTMLCanvasElement) | null>;
  debug?: boolean;
}) {
  const { active, medication, patientId, videoRef, correctedFrame, debug = false } = options;
  const [phase, setPhase] = useState<PillCheckPhase>("loading");
  const [verdict, setVerdict] = useState<PillVerdict>({ kind: "noPill" });
  const debugRecognizerRef = useRef<DebugPillRecognizer | null>(null);

  useEffect(() => {
    if (!active || !medication) return;
    let cancelled = false;
    let recognizer: PillRecognizer | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reportedMismatch: string | null = null;
    const tracker = new PillVerdictTracker(medication.drugCode);
    setPhase("loading");
    setVerdict({ kind: "noPill" });

    async function tick() {
      if (cancelled || !recognizer) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        let detections: PillDetection[] = [];
        try {
          detections = await recognizer.detect(correctedFrame.current?.(video) ?? video);
        } catch (error) {
          console.error("pill detection error", error);
        }
        if (cancelled) return;
        const next = tracker.update(performance.now(), detections);
        setVerdict(next);
        if (next.kind === "mismatch" && reportedMismatch !== next.drugCode) {
          reportedMismatch = next.drugCode;
          void postMedicationEvent({ patientId, medicationId: medication!.id, event: "mismatch", detectedDrugCode: next.drugCode });
        } else if (next.kind !== "mismatch" && next.kind !== "checking") {
          reportedMismatch = null; // 약을 내려놓으면 다음에 다시 비출 때 새로 센다
        }
      }
      timer = setTimeout(() => void tick(), DETECT_INTERVAL_MS);
    }

    async function start() {
      if (debug) {
        const debugRecognizer = new DebugPillRecognizer();
        debugRecognizerRef.current = debugRecognizer;
        recognizer = debugRecognizer;
      } else {
        const loaded = await loadPillRecognizer();
        if (cancelled) {
          if (loaded.kind === "ready") loaded.recognizer.close();
          return;
        }
        if (loaded.kind !== "ready") {
          if (loaded.kind === "error") console.error("pill model load error", loaded.error);
          setPhase(loaded.kind);
          return;
        }
        recognizer = loaded.recognizer;
      }
      setPhase("running");
      void tick();
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      recognizer?.close();
      debugRecognizerRef.current = null;
    };
  }, [active, medication, patientId, videoRef, correctedFrame, debug]);

  /** [먹었어요] - 맞는 약으로 판정됐을 때만 누를 수 있다. */
  async function confirmTaken(): Promise<boolean> {
    if (!medication) return false;
    return postMedicationEvent({ patientId, medicationId: medication.id, event: "taken" });
  }

  /** 개발용: 보이는 약을 직접 정한다. */
  function debugShow(detections: PillDetection[]) {
    if (debugRecognizerRef.current) debugRecognizerRef.current.current = detections;
  }

  return { phase, verdict, confirmTaken, debugShow };
}
