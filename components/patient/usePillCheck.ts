"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MedicationItem } from "../../lib/medication/schedule";
import { DebugPillRecognizer, loadPillRecognizer, type PillRecognizer } from "../../lib/pill/recognizer";
import type { PillRecognitionResult } from "../../lib/pill/result";
import { describeDetections, detectWithZoom } from "../../lib/pill/zoom";
import { pillName } from "../../lib/pill/catalog";
import { PillVerdictTracker, STABLE_MS, pillsInFrame, type PillDetection, type PillVerdict } from "../../lib/pill/verdict";
import { WHITE_CAPSULES, cropGray, readCapsuleImprint } from "../../lib/pill/capsuleOcr";

const DETECT_INTERVAL_MS = 250;
const LOG_INTERVAL_MS = 1_000; // 개발 중 콘솔에 인식 결과를 찍는 간격
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

/** 흰 캡슐 각인 확인 상태: 읽는 중 / 각인으로 못 정해서 환자에게 사진을 보여 주고 묻는 중 */
export type CapsuleCheck =
  | { kind: "reading" }
  | { kind: "ask"; drugCode: string; image: string | null; confidence: number; box?: PillDetection["box"] };

type HeldVerdict = Extract<PillVerdict, { kind: "match" | "mismatch" }>;

async function postMedicationEvent(body: Record<string, unknown>): Promise<boolean> {
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
 * 알약 확인 모드. 카메라 영상을 주기적으로 알약 인식 모델에 넣고, 지금 먹어야 하는 약(같은 시간에 여러 알이면
 * 아직 안 먹은 약 중 하나)과 비교한 판정을 돌려준다. 한 알씩 비추고, 한 알을 먹으면 남은 약으로 계속 확인한다.
 * 판정이 확정되면(matched / mismatched / 1초 넘게 unknown) 그 약이 사라졌다 다시 나오기 전까지
 * 한 번만 인식 결과(PillRecognitionResult, 사진 없음)를 서버에 보낸다. 방금 먹은 약을 다시 비춘 경우는 보내지 않는다.
 * 맞는 약으로 한 번 판정되면 [먹었어요]를 누르거나 다른 약으로 판정되기 전까지 그 판정을 유지한다
 * (손에 든 알약이 잠깐 안 잡혀도 [먹었어요] 버튼이 사라지지 않게).
 * 흰 캡슐(리리베아·독립목클린)은 글자 없는 면이 똑같아 모델이 헷갈리므로, 모델이 둘 중 하나로 보는 상태가
 * 1초 이어지면 확대 사진의 각인을 OCR로 한 번만 읽어 정한다. 각인으로도 못 정하면 사진을 보여 주고 환자에게 묻는다.
 * debug면 모델 대신 버튼으로 보이는 약을 정한다 (?pillDebug=1, 모델 학습 전 화면 흐름 확인용).
 */
export function usePillCheck(options: {
  active: boolean;
  medications: readonly MedicationItem[]; // 이번 복용 시간에 아직 안 먹은 약
  takenCodes?: readonly string[]; // 이번 확인에서 이미 먹었다고 누른 약 코드
  patientId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  correctedFrame: RefObject<((video: HTMLVideoElement) => HTMLVideoElement | HTMLCanvasElement) | null>;
  debug?: boolean;
}) {
  const { active, medications, takenCodes = [], patientId, videoRef, correctedFrame, debug = false } = options;
  // 남은 약은 한 알 먹을 때마다 바뀌지만 카메라·모델은 그대로 두어야 해서 ref로 읽는다
  const medicationsRef = useRef(medications);
  medicationsRef.current = medications;
  const takenRef = useRef(takenCodes);
  takenRef.current = takenCodes;
  const trackerRef = useRef<PillVerdictTracker | null>(null);
  // 유지 중인 판정: 맞는 약(먹었어요를 누르거나 다른 약이 보일 때까지) 또는 각인으로 정한 다른 약(약을 내려놓을 때까지)
  const heldRef = useRef<HeldVerdict | null>(null);
  // 흰 캡슐 각인 읽기: 모델이 흰 캡슐로 본 시각, 이번에 읽었는지 (약을 내려놓으면 다시 읽을 수 있음)
  const ocrRef = useRef<{ since: number | null; state: "idle" | "busy" | "done" }>({ since: null, state: "idle" });
  const [capsule, setCapsule] = useState<CapsuleCheck | null>(null);
  const expectedKey = medications.map((item) => item.drugCode).join(",");
  const hasMedications = medications.length > 0;
  const [phase, setPhase] = useState<PillCheckPhase>("loading");
  const [verdict, setVerdict] = useState<PillVerdict>({ kind: "noPill" });
  // 판정 근거로 보여줄, 카메라로 본 알약 확대 사진
  const [evidence, setEvidence] = useState<{ drugCode: string; image: string } | null>(null);
  const debugRecognizerRef = useRef<DebugPillRecognizer | null>(null);

  useEffect(() => {
    if (!active || !hasMedications) return;
    let cancelled = false;
    let recognizer: PillRecognizer | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reported: string | null = null; // 이번에 보낸 결과 (상태:약 코드) - 같은 결과는 다시 안 보냄
    let unsureSince: number | null = null;
    let evidenceCode: string | null = null;
    let loggedAt = 0;
    const tracker = new PillVerdictTracker(medicationsRef.current.map((item) => item.drugCode));
    trackerRef.current = tracker;
    heldRef.current = null;
    ocrRef.current = { since: null, state: "idle" };
    setPhase("loading");
    setVerdict({ kind: "noPill" });
    setEvidence(null);
    setCapsule(null);

    /** 각인을 읽은 결과로 판정한다. 못 정하면 남은 약에 흰 캡슐이 있을 때만 환자에게 묻는다. */
    function applyImprint(drugCode: string | null, seen: PillDetection, image: string | null) {
      const remaining = medicationsRef.current;
      if (drugCode) {
        heldRef.current = remaining.some((item) => item.drugCode === drugCode)
          ? { kind: "match", drugCode, confidence: seen.confidence, box: seen.box }
          : { kind: "mismatch", drugCode, confidence: seen.confidence, box: seen.box };
        setCapsule(null);
        return;
      }
      const expectedWhite = remaining.find((item) => WHITE_CAPSULES.includes(item.drugCode));
      setCapsule(expectedWhite ? { kind: "ask", drugCode: expectedWhite.drugCode, image, confidence: seen.confidence, box: seen.box } : null);
    }

    async function tick() {
      if (cancelled || !recognizer) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        let detections: PillDetection[] = [];
        const frame = correctedFrame.current?.(video) ?? video;
        try {
          const result = await detectWithZoom(recognizer, frame);
          detections = result.detections;
          if (process.env.NODE_ENV !== "production" && !debug && performance.now() - loggedAt > LOG_INTERVAL_MS) {
            loggedAt = performance.now();
            console.debug(`[알약 인식] ${describeDetections(result, (code) => pillName(code, "ko"))}`);
          }
        } catch (error) {
          console.error("pill detection error", error);
        }
        if (cancelled) return;
        const reading = tracker.update(performance.now(), detections);
        if (reading.kind === "match") heldRef.current = reading;
        else if (reading.kind === "mismatch") heldRef.current = null;
        else if (reading.kind === "noPill" && heldRef.current?.kind === "mismatch") heldRef.current = null;

        // 흰 캡슐: 모델이 리리베아·독립목클린으로 보는 상태가 1초 이어지면 각인을 한 번만 읽는다
        const pills = pillsInFrame(detections);
        const white = pills.length === 1 && WHITE_CAPSULES.includes(pills[0]!.drugCode) && pills[0]!.box ? pills[0]! : null;
        const ocr = ocrRef.current;
        const now = performance.now();
        if (white && reading.kind !== "match" && heldRef.current?.kind !== "match") {
          ocr.since ??= now;
          if (ocr.state === "idle" && now - ocr.since >= STABLE_MS) {
            ocr.state = "busy";
            setCapsule({ kind: "reading" });
            const crop = cropGray(frame, white.box!);
            const image = cropEvidence(frame, white.box!);
            (crop ? readCapsuleImprint(crop) : Promise.resolve({ drugCode: null, texts: [] }))
              .then((result) => {
                if (cancelled) return;
                console.info(`[알약 인식] 캡슐 각인 OCR: ${JSON.stringify(result.texts)} -> ${result.drugCode ? pillName(result.drugCode, "ko") : "못 정함"}`);
                ocr.state = "done";
                applyImprint(result.drugCode, white, image);
              })
              .catch((error) => {
                if (cancelled) return;
                console.error("capsule OCR error", error);
                ocr.state = "done";
                applyImprint(null, white, image);
              });
          }
        } else {
          ocr.since = null;
          if (reading.kind === "noPill" && ocr.state === "done") ocr.state = "idle"; // 내려놓았다가 다시 비추면 다시 읽음
        }

        const next = heldRef.current ?? reading;
        setVerdict(next);
        if ((next.kind === "match" || next.kind === "mismatch") && next.box && evidenceCode !== next.drugCode) {
          evidenceCode = next.drugCode;
          const image = cropEvidence(frame, next.box);
          if (image) setEvidence({ drugCode: next.drugCode, image });
        } else if (next.kind === "noPill") {
          evidenceCode = null;
        }
        // 인식 결과를 서버로 (판정 결과만, 사진·영상 없음)
        const remaining = medicationsRef.current;
        const top = detections.reduce<PillDetection | null>((best, item) => (!best || item.confidence > best.confidence ? item : best), null);
        let result: { status: "matched" | "mismatched" | "unknown"; code: string | null; confidence: number | null; item: MedicationItem } | null = null;
        if (next.kind === "unsure" || next.kind === "multiple") {
          unsureSince ??= now;
          if (now - unsureSince >= STABLE_MS && remaining[0]) {
            result = { status: "unknown", code: top?.drugCode ?? null, confidence: top?.confidence ?? null, item: remaining[0] };
          }
        } else {
          unsureSince = null;
        }
        if (next.kind === "match") {
          const item = remaining.find((candidate) => candidate.drugCode === next.drugCode);
          if (item) result = { status: "matched", code: next.drugCode, confidence: next.confidence ?? null, item };
        } else if (next.kind === "mismatch" && !takenRef.current.includes(next.drugCode) && remaining[0]) {
          result = { status: "mismatched", code: next.drugCode, confidence: next.confidence ?? null, item: remaining[0] };
        }
        const key = result ? (result.status === "unknown" ? "unknown" : `${result.status}:${result.code}`) : null;
        if (result && key !== reported) {
          reported = key;
          const body: PillRecognitionResult = {
            patientId,
            medicationCode: result.code,
            expectedMedicationCode: result.item.drugCode,
            confidence: result.confidence === null ? null : Math.round(result.confidence * 1000) / 1000,
            status: result.status,
            modelVersion: recognizer.modelVersion,
            measuredAt: new Date().toISOString(),
          };
          void postMedicationEvent({ patientId, medicationId: result.item.id, event: "recognition", result: body });
        } else if (next.kind === "noPill") {
          reported = null; // 약을 내려놓으면 다음에 다시 비출 때 새로 보낸다
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
      tracker.setClassConfidence(recognizer.classConfidence ?? {});
      setPhase("running");
      void tick();
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      recognizer?.close();
      debugRecognizerRef.current = null;
      trackerRef.current = null;
    };
  }, [active, hasMedications, patientId, videoRef, correctedFrame, debug]);

  // 한 알을 먹어서 남은 약이 바뀌면 판정 기준만 바꾼다 (보고 있던 약은 처음부터 다시 판정)
  useEffect(() => {
    trackerRef.current?.setExpected(expectedKey ? expectedKey.split(",") : []);
    heldRef.current = null;
    ocrRef.current = { since: null, state: "idle" };
    setEvidence(null);
    setCapsule(null);
  }, [expectedKey]);

  /** [먹었어요] - 맞는 약으로 판정됐을 때(camera) 또는 인식이 안 돼 직접 확인했을 때(manual) 복용으로 기록한다. */
  async function confirmTaken(item: MedicationItem, method: "camera" | "manual" = "camera"): Promise<boolean> {
    return postMedicationEvent({ patientId, medicationId: item.id, event: "taken", method });
  }

  /** 각인으로 못 정해 환자에게 물었을 때의 답. [맞아요]면 그 약으로 판정한다. */
  function answerCapsule(yes: boolean) {
    const asked = capsule?.kind === "ask" ? capsule : null;
    setCapsule(null);
    if (!yes || !asked) return;
    const held: HeldVerdict = { kind: "match", drugCode: asked.drugCode, confidence: asked.confidence, box: asked.box };
    heldRef.current = held;
    setVerdict(held);
  }

  /** 개발용: 보이는 약을 직접 정한다. */
  function debugShow(detections: PillDetection[]) {
    if (debugRecognizerRef.current) debugRecognizerRef.current.current = detections;
  }

  return { phase, verdict, evidence, capsule, answerCapsule, confirmTaken, debugShow };
}
