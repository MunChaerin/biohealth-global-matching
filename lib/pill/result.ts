// 알약 인식 결과의 공통 형식 (팀 배포 규격). 서버에는 이 결과만 보내고 사진·영상·프레임은 담지 않는다.

import type { PillVerdict } from "./verdict";

export type PillRecognitionStatus =
  | "matched" // 지금 먹을 약이 맞음 (같은 약이 1초 이상 확신 0.6 이상)
  | "mismatched" // 다른 약 (학습한 10종 중 지금 먹을 약이 아닌 약)
  | "unknown" // 확신이 낮거나 여러 알이 보여서 판정할 수 없음 (학습하지 않은 약을 억지로 분류하지 않음)
  | "noPill" // 알약이 안 보임
  | "modelLoading"
  | "modelError";

export interface PillRecognitionResult {
  patientId: string;
  medicationCode: string | null; // 카메라로 알아본 약 코드 (모르면 null)
  expectedMedicationCode: string; // 지금 먹어야 하는 약 코드
  confidence: number | null;
  status: "matched" | "mismatched" | "unknown" | "noPill";
  modelVersion: string;
  measuredAt: string; // ISO 시각
}

/** 화면 판정 -> 규격 상태. 판정 대기 중(같은 약이 1초 미만으로 보임)은 아직 확정 전이라 unknown으로 본다. */
export function toRecognitionStatus(phase: "loading" | "notReady" | "error" | "running", verdict: PillVerdict): PillRecognitionStatus {
  if (phase === "loading") return "modelLoading";
  if (phase !== "running") return "modelError";
  switch (verdict.kind) {
    case "match":
      return "matched";
    case "mismatch":
      return "mismatched";
    case "noPill":
      return "noPill";
    default:
      return "unknown";
  }
}

const statuses = ["matched", "mismatched", "unknown", "noPill"] as const;

export function validateRecognitionResult(value: unknown): asserts value is PillRecognitionResult {
  if (!value || typeof value !== "object") throw new Error("result는 객체여야 합니다.");
  const r = value as Record<string, unknown>;
  if (typeof r.patientId !== "string" || !r.patientId) throw new Error("result.patientId가 필요합니다.");
  if (r.medicationCode !== null && typeof r.medicationCode !== "string") throw new Error("result.medicationCode는 문자열 또는 null이어야 합니다.");
  if (typeof r.expectedMedicationCode !== "string" || !r.expectedMedicationCode) throw new Error("result.expectedMedicationCode가 필요합니다.");
  if (r.confidence !== null && (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1)) throw new Error("result.confidence는 0~1 또는 null이어야 합니다.");
  if (!statuses.includes(r.status as (typeof statuses)[number])) throw new Error("result.status가 올바르지 않습니다.");
  if (typeof r.modelVersion !== "string" || !r.modelVersion) throw new Error("result.modelVersion이 필요합니다.");
  if (typeof r.measuredAt !== "string" || Number.isNaN(Date.parse(r.measuredAt))) throw new Error("result.measuredAt은 ISO 시각이어야 합니다.");
  // 사진·영상이 섞여 들어오지 않도록 정해진 필드만 허용
  const allowed = new Set(["patientId", "medicationCode", "expectedMedicationCode", "confidence", "status", "modelVersion", "measuredAt"]);
  const extra = Object.keys(r).filter((key) => !allowed.has(key));
  if (extra.length) throw new Error(`result에 허용되지 않은 필드가 있습니다: ${extra.join(", ")}`);
}
