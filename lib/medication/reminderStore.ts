import { getMedicationSchedule } from "./schedule";

// 복용 시간마다 환자 화면에서 약 확인을 자동으로 여는 시각. 의료진 화면에서 바꾼다 (기본은 복용 시간과 같음).
// 지금은 서버 메모리 (복약 기록처럼 데모용 - 서버 재시작 시 기본값으로 돌아감).

export interface MedicationReminder {
  time: string; // 복용 시간 (일정의 time, 예: "08:00")
  openAt: string; // 약 확인을 자동으로 여는 시각 "HH:MM" (한국·일본 시간)
}

type Store = Map<string, Map<string, string>>;
const root = globalThis as typeof globalThis & { __medicationReminders?: Store };
const store: Store = (root.__medicationReminders ??= new Map());

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 환자의 복용 시간별 자동 열림 시각 (복용 시간 순) */
export function getReminders(patientId: string): MedicationReminder[] {
  const times = [...new Set(getMedicationSchedule(patientId).map((item) => item.time))].sort();
  const saved = store.get(patientId);
  return times.map((time) => ({ time, openAt: saved?.get(time) ?? time }));
}

/** 자동 열림 시각을 바꾼다. 일정에 없는 복용 시간이거나 형식이 틀리면 false. */
export function setReminder(patientId: string, time: string, openAt: string): boolean {
  if (!TIME_PATTERN.test(openAt) || !getReminders(patientId).some((reminder) => reminder.time === time)) return false;
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
