import { getMedicationSchedule } from "./schedule";
import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

// 복용 시간마다 환자 화면에서 약 확인을 자동으로 여는 시각. 의료진 화면에서 바꾼다 (기본은 복용 시간과 같음).
// 로컬에서는 메모리를, 배포 환경에서는 Supabase를 사용한다.

export interface MedicationReminder {
  time: string; // 복용 시간 (일정의 time, 예: "08:00")
  openAt: string; // 약 확인을 자동으로 여는 시각 "HH:MM" (한국·일본 시간)
}

type Store = Map<string, Map<string, string>>;
const root = globalThis as typeof globalThis & { __medicationReminders?: Store };
const store: Store = (root.__medicationReminders ??= new Map());

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 환자의 복용 시간별 자동 열림 시각 (복용 시간 순) */
export async function getReminders(patientId: string): Promise<MedicationReminder[]> {
  const times = [...new Set(getMedicationSchedule(patientId).map((item) => item.time))].sort();
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("medication_reminders").select("medication_time, open_at").eq("patient_id", patientId);
    assertSupabaseResult(error);
    const saved = new Map((data ?? []).map((item) => [item.medication_time, item.open_at]));
    return times.map((time) => ({ time, openAt: saved.get(time) ?? time }));
  }
  const saved = store.get(patientId);
  return times.map((time) => ({ time, openAt: saved?.get(time) ?? time }));
}

/** 자동 열림 시각을 바꾼다. 일정에 없는 복용 시간이거나 형식이 틀리면 false. */
export async function setReminder(patientId: string, time: string, openAt: string): Promise<boolean> {
  if (!TIME_PATTERN.test(openAt) || !getMedicationSchedule(patientId).some((item) => item.time === time)) return false;
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseAdmin().from("medication_reminders").upsert({ patient_id: patientId, medication_time: time, open_at: openAt, updated_at: new Date().toISOString() });
    assertSupabaseResult(error);
    return true;
  }
  let saved = store.get(patientId);
  if (!saved) {
    saved = new Map();
    store.set(patientId, saved);
  }
  saved.set(time, openAt);
  return true;
}

export function clearReminders(): void {
  store.clear();
}
