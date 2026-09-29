// 환자 화면 -> 서버 -> 의료진 화면으로 보내는 카메라 결과. 얼굴 영상이나 좌표는 담지 않고 판정 결과 숫자만 담는다.

import type { DominantState, ExpressionTrend, SleepState } from "./types";

export const DEMO_PATIENT_ID = "demo-patient-01";

/** 환자 화면이 보고하는 카메라 상태. measuring일 때만 판정 결과가 있다(측정 못 한 값은 만들지 않음). */
export type CameraStatus =
  | "starting" // 모델 로딩 / 카메라 켜는 중
  | "calibrating" // 평상시 표정 기준선 수집 중
  | "measuring" // 판정 중
  | "noFace" // 얼굴이 안 보임
  | "permissionDenied" // 카메라 권한 거부
  | "unavailable"; // 카메라 없음 / 모델 로딩 실패 등

export interface CameraReport {
  patientId: string;
  measuredAt: string; // ISO 시각 (환자 기기 기준)
  status: CameraStatus;
  current?: { dominant: DominantState; state: SleepState };
  trend?: ExpressionTrend & { windowMinutes: number };
}

const statuses: readonly CameraStatus[] = [
  "starting",
  "calibrating",
  "measuring",
  "noFace",
  "permissionDenied",
  "unavailable",
];
const dominantStates: readonly DominantState[] = ["pain", "anxiety", "lethargy", "calm", "none", "sleeping"];
const sleepStates: readonly SleepState[] = ["awake", "eyesClosed", "sleeping"];

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateCameraReport(value: unknown): asserts value is CameraReport {
  if (!value || typeof value !== "object") throw new Error("카메라 결과는 객체여야 합니다.");
  const report = value as Record<string, unknown>;

  if (typeof report.patientId !== "string" || !report.patientId) throw new Error("patientId가 필요합니다.");
  if (typeof report.measuredAt !== "string" || Number.isNaN(Date.parse(report.measuredAt))) {
    throw new Error("measuredAt은 ISO 시각이어야 합니다.");
  }
  if (!statuses.includes(report.status as CameraStatus)) throw new Error("유효하지 않은 status입니다.");

  if (report.current !== undefined) {
    const current = report.current as Record<string, unknown>;
    if (!dominantStates.includes(current?.dominant as DominantState) || !sleepStates.includes(current?.state as SleepState)) {
      throw new Error("유효하지 않은 current입니다.");
    }
  }

  if (report.trend !== undefined) {
    const trend = report.trend as Record<string, unknown>;
    const ratio = trend?.dominantRatio as Record<string, unknown> | undefined;
    const validRatio =
      !!ratio &&
      typeof ratio === "object" &&
      Object.entries(ratio).every(([key, item]) => dominantStates.includes(key as DominantState) && isRatio(item));
    if (
      !validRatio ||
      typeof trend.sampleCount !== "number" ||
      !isRatio(trend.sleepingRatio) ||
      typeof trend.flatExpressionFlag !== "boolean" ||
      typeof trend.windowMinutes !== "number"
    ) {
      throw new Error("유효하지 않은 trend입니다.");
    }
  }

  if (report.status !== "measuring" && (report.current !== undefined || report.trend !== undefined)) {
    throw new Error("측정 중이 아닐 때는 판정 결과를 보낼 수 없습니다.");
  }
}
