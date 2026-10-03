import type { PillRecognitionResult } from "../pill/result";
import { getReminders, type MedicationReminder } from "./reminderStore";
import { getMedicationSchedule, type MedicationItem } from "./schedule";
import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

// 오늘 복약 기록. 로컬에서는 메모리를, 배포 환경에서는 Supabase를 사용한다.
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
  reminders: MedicationReminder[]; // 복용 시간별 약 확인 자동 열림 시각 (의료진이 조정)
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

async function loadDayRecords(patientId: string, date: string): Promise<Map<string, IntakeRecord>> {
  requireProductionStorage();
  if (!isSupabaseConfigured()) return dayRecords(patientId, date);
  const { data, error } = await getSupabaseAdmin().from("medication_intakes").select("medication_id, record").eq("patient_id", patientId).eq("intake_date", date);
  assertSupabaseResult(error);
  return new Map((data ?? []).map((item) => [item.medication_id, item.record as IntakeRecord]));
}

async function saveRecord(patientId: string, date: string, medicationId: string, record: IntakeRecord): Promise<void> {
  if (!isSupabaseConfigured()) {
    dayRecords(patientId, date).set(medicationId, record);
    return;
  }
  const { error } = await getSupabaseAdmin().from("medication_intakes").upsert({ patient_id: patientId, intake_date: date, medication_id: medicationId, record, updated_at: new Date().toISOString() });
  assertSupabaseResult(error);
}

export async function getTodayMedication(patientId: string, now: Date = new Date()): Promise<TodayMedication> {
  const date = dateKey(now);
  const records = await loadDayRecords(patientId, date);
  const items: MedicationStatus[] = getMedicationSchedule(patientId).map((item) => {
    const record = records.get(item.id) ?? { mismatchCount: 0 };
    return { ...item, ...record, status: record.takenAt ? "taken" : "pending" };
  });
  const next = items.find((item) => item.status === "pending") ?? null;
  const nextGroup = next ? items.filter((item) => item.status === "pending" && item.time === next.time) : [];
  return { date, items, next, nextGroup, reminders: await getReminders(patientId) };
}

/** [먹었어요]. 이미 기록돼 있으면 처음 시각을 유지한다. 인식만으로는 기록하지 않는다. */
export async function recordTaken(patientId: string, medicationId: string, method: IntakeMethod = "camera", now: Date = new Date()): Promise<void> {
  const date = dateKey(now);
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseAdmin().rpc("record_medication_taken", {
      p_patient_id: patientId,
      p_intake_date: date,
      p_medication_id: medicationId,
      p_taken_at: now.toISOString(),
      p_method: method,
    });
    assertSupabaseResult(error);
    return;
  }
  const records = await loadDayRecords(patientId, date);
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  if (!record.takenAt) await saveRecord(patientId, date, medicationId, { ...record, takenAt: now.toISOString(), method });
}

/** 알약 인식 결과(사진 없음). 다른 약(mismatched)이면 의료진 화면에 보이도록 횟수와 마지막 약을 센다. */
export async function recordRecognition(patientId: string, medicationId: string, result: PillRecognitionResult, now: Date = new Date()): Promise<void> {
  const date = dateKey(now);
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const isMismatch = result.status === "mismatched" && Boolean(result.medicationCode);
    const { error } = await getSupabaseAdmin().rpc("record_medication_recognition", {
      p_patient_id: patientId,
      p_intake_date: date,
      p_medication_id: medicationId,
      p_result: result,
      p_is_mismatch: isMismatch,
      p_detected_drug_code: isMismatch ? result.medicationCode : null,
      p_measured_at: result.measuredAt,
    });
    assertSupabaseResult(error);
    return;
  }
  const records = await loadDayRecords(patientId, date);
  const record = records.get(medicationId) ?? { mismatchCount: 0 };
  const next: IntakeRecord = { ...record, lastRecognition: result };
  if (result.status === "mismatched" && result.medicationCode) {
    next.mismatchCount = record.mismatchCount + 1;
    next.lastMismatch = { detectedDrugCode: result.medicationCode, at: result.measuredAt };
  }
  await saveRecord(patientId, date, medicationId, next);
}

export function clearMedicationIntakes(): void {
  store.clear();
}
