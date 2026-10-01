import { getMedicationSchedule, type MedicationItem } from "./schedule";

// 오늘 복약 기록. 지금은 서버 메모리 (카메라 결과처럼 데모용 - 서버 재시작 시 사라짐).
// 날짜는 한국·일본 시간(UTC+9) 기준으로 나눈다.

export interface IntakeRecord {
  takenAt?: string; // [먹었어요]를 누른 시각
  mismatchCount: number; // 다른 약을 비춘 횟수
  lastMismatch?: { detectedDrugCode: string; at: string };
}

export interface MedicationStatus extends MedicationItem, IntakeRecord {
  status: "taken" | "pending";
}

export interface TodayMedication {
  date: string; // YYYY-MM-DD
  items: MedicationStatus[];
  next: MedicationStatus | null; // 아직 안 먹은 약 중 가장 이른 것
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
  return { date, items, next: items.find((item) => item.status === "pending") ?? null };
}

/** [먹었어요]. 이미 기록돼 있으면 처음 시각을 유지한다. */
export function recordTaken(patientId: string, medicationId: string, now: Date = new Date()): void {
  const records = dayRecords(patientId, dateKey(now));
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  if (!record.takenAt) records.set(medicationId, { ...record, takenAt: now.toISOString() });
}

/** 지금 먹어야 하는 약이 아닌 다른 약을 비췄을 때. */
export function recordMismatch(patientId: string, medicationId: string, detectedDrugCode: string, now: Date = new Date()): void {
  const records = dayRecords(patientId, dateKey(now));
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  records.set(medicationId, {
    ...record,
    mismatchCount: record.mismatchCount + 1,
    lastMismatch: { detectedDrugCode, at: now.toISOString() },
  });
}

export function clearMedicationIntakes(): void {
  store.clear();
}
