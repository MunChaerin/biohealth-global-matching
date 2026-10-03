import type { PillRecognitionResult } from "../pill/result";
import { getMedicationSchedule, type MedicationItem } from "./schedule";

// 오늘 복약 기록. 지금은 서버 메모리 (카메라 결과처럼 데모용 - 서버 재시작 시 사라짐).
// 날짜는 한국·일본 시간(UTC+9) 기준으로 나눈다.

// camera: 모델이 맞는 약으로 판정한 뒤 기록 / confirmed: 모델이 애매해서 확대 사진을 보고 환자가 [맞아요]로 정한 뒤 기록
// manual: 카메라·모델을 쓸 수 없어 직접 기록
export type IntakeMethod = "camera" | "confirmed" | "manual";

export interface IntakeRecord {
  takenAt?: string; // [먹었어요]를 누른 시각
  method?: IntakeMethod;
  mismatchCount: number; // 다른 약을 비춘 횟수
  lastMismatch?: { detectedDrugCode: string; at: string };
  lastRecognition?: PillRecognitionResult; // 이 약을 확인할 때 마지막으로 받은 인식 결과
}

export interface MedicationStatus extends MedicationItem, IntakeRecord {
  status: "taken" | "pending";
}

export interface TodayMedication {
  date: string; // YYYY-MM-DD
  items: MedicationStatus[];
  next: MedicationStatus | null; // 아직 안 먹은 약 중 가장 이른 것
  nextGroup: MedicationStatus[]; // next와 같은 시간에 먹을, 아직 안 먹은 약들 (한 번에 확인)
}

type Store = Map<string, Map<string, IntakeRecord>>;
const root = globalThis as typeof globalThis & { __medicationIntakes?: Store };
const store: Store = (root.__medicationIntakes ??= new Map());

export function dateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

function dayRecords(patientId: string, date: string): Map<string, IntakeRecord> {
  const key = `${patientId}|${date}`;
  let records = store.get(key);
  if (!records) {
    records = new Map();
    store.set(key, records);
  }
  return records;
}

export function getTodayMedication(patientId: string, now: Date = new Date()): TodayMedication {
  const date = dateKey(now);
  const records = dayRecords(patientId, date);
  const items: MedicationStatus[] = getMedicationSchedule(patientId).map((item) => {
    const record = records.get(item.id) ?? { mismatchCount: 0 };
    return { ...item, ...record, status: record.takenAt ? "taken" : "pending" };
  });
  const next = items.find((item) => item.status === "pending") ?? null;
  const nextGroup = next ? items.filter((item) => item.status === "pending" && item.time === next.time) : [];
  return { date, items, next, nextGroup };
}

/** [먹었어요]. 이미 기록돼 있으면 처음 시각을 유지한다. 인식만으로는 기록하지 않는다. */
export function recordTaken(patientId: string, medicationId: string, method: IntakeMethod = "camera", now: Date = new Date()): void {
  const records = dayRecords(patientId, dateKey(now));
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  if (!record.takenAt) records.set(medicationId, { ...record, takenAt: now.toISOString(), method });
}

/** 알약 인식 결과(사진 없음). 다른 약(mismatched)이면 의료진 화면에 보이도록 횟수와 마지막 약을 센다. */
export function recordRecognition(patientId: string, medicationId: string, result: PillRecognitionResult, now: Date = new Date()): void {
  const records = dayRecords(patientId, dateKey(now));
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  const next: IntakeRecord = { ...record, lastRecognition: result };
  if (result.status === "mismatched" && result.medicationCode) {
    next.mismatchCount = record.mismatchCount + 1;
    next.lastMismatch = { detectedDrugCode: result.medicationCode, at: result.measuredAt };
  }
  records.set(medicationId, next);
}

export function clearMedicationIntakes(): void {
  store.clear();
}
