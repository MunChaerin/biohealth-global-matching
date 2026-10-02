"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MedicationItem } from "../../lib/medication/schedule";
import { DebugPillRecognizer, loadPillRecognizer, type PillRecognizer } from "../../lib/pill/recognizer";
import { PillVerdictTracker, type PillDetection, type PillVerdict } from "../../lib/pill/verdict";

const DETECT_INTERVAL_MS = 250;
const EVIDENCE_SIZE = 200; // 확인 화면에 보여줄 알약 확대 사진 크기 (px)

/** 판정에 쓴 화면에서 알약 부분만 잘라 확대 사진(data URL)을 만든다. 화면에만 쓰고 저장·전송하지 않는다. */
function cropEvidence(frame: HTMLVideoElement | HTMLCanvasElement, box: readonly [number, number, number, number]): string | null {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
  const canvas = document.createElement("canvas");
  canvas.width = EVIDENCE_SIZE;
  canvas.height = EVIDENCE_SIZE;
  const context = canvas.getContext("2d");
  if (!context || !width || !height) return null;
  const [x, y, w, h] = box;
  const side = Math.max(w * width, h * height) * 1.4; // 알약 주변을 조금 넉넉하게, 정사각형으로
  const cx = (x + w / 2) * width;
  const cy = (y + h / 2) * height;
  context.drawImage(frame, cx - side / 2, cy - side / 2, side, side, 0, 0, EVIDENCE_SIZE, EVIDENCE_SIZE);
  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

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
  // 판정 근거로 보여줄, 카메라로 본 알약 확대 사진
  const [evidence, setEvidence] = useState<{ drugCode: string; image: string } | null>(null);
  const debugRecognizerRef = useRef<DebugPillRecognizer | null>(null);

  useEffect(() => {
    if (!active || !medication) return;
    let cancelled = false;
    let recognizer: PillRecognizer | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reportedMismatch: string | null = null;
    let evidenceCode: string | null = null;
    const tracker = new PillVerdictTracker(medication.drugCode);
    setPhase("loading");
    setVerdict({ kind: "noPill" });
    setEvidence(null);

    async function tick() {
      if (cancelled || !recognizer) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        let detections: PillDetection[] = [];
        const frame = correctedFrame.current?.(video) ?? video;
        try {
          detections = await recognizer.detect(frame);
        } catch (error) {
          console.error("pill detection error", error);
        }
        if (cancelled) return;
        const next = tracker.update(performance.now(), detections);
        setVerdict(next);
        if ((next.kind === "match" || next.kind === "mismatch") && next.box && evidenceCode !== next.drugCode) {
          evidenceCode = next.drugCode;
          const image = cropEvidence(frame, next.box);
          if (image) setEvidence({ drugCode: next.drugCode, image });
        } else if (next.kind === "noPill") {
          evidenceCode = null;
        }
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

  return { phase, verdict, evidence, confirmTaken, debugShow };
}
