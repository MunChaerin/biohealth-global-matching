import type { MedicationStatus, TodayMedication } from "./intakeStore";

// 시간이 되면 환자 화면에서 약 확인을 저절로 연다 (어르신이 [복용했어요] -> 카메라 켜기를 누르지 않아도 되게).

/** 한국·일본 시간(UTC+9) "HH:MM" */
export function clockTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** 이번에 자동으로 열 복용 시간: 자동 열림 시각이 지났고 아직 안 먹은 약이 있으며 오늘 아직 자동으로 연 적 없는 시간 중 가장 늦은 것 */
export function dueGroup(today: TodayMedication, now: string, opened: ReadonlySet<string>): { time: string; items: MedicationStatus[] } | null {
  const due = (today.reminders ?? [])
    .filter((reminder) => reminder.openAt <= now && !opened.has(`${today.date}|${reminder.time}`))
    .map((reminder) => ({ time: reminder.time, items: today.items.filter((item) => item.time === reminder.time && item.status === "pending") }))
    .filter((group) => group.items.length > 0);
  return due.length ? due[due.length - 1]! : null;
}
