import type { MedicationStatus, TodayMedication } from "./intakeStore";

// 시간이 되면 환자 화면에서 약 확인을 저절로 연다 (어르신이 [복용했어요] -> 카메라 켜기를 누르지 않아도 되게).

/** 한국·일본 시간(UTC+9) "HH:MM" */
export function clockTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** 오늘 이 복용 시간을 이 자동 열림 시각으로 열었다는 기록 키. 의료진이 시각을 바꾸면 키가 달라져 새 시각에 다시 열린다. */
export function openedKey(date: string, time: string, openAt: string): string {
  return `${date}|${time}|${openAt}`;
}

/** 이번에 자동으로 열 복용 시간: 자동 열림 시각이 지났고 아직 안 먹은 약이 있으며 오늘 그 시각으로 아직 연 적 없는 시간 중 가장 늦은 것 */
export function dueGroup(today: TodayMedication, now: string, opened: ReadonlySet<string>): { time: string; openAt: string; items: MedicationStatus[] } | null {
  const due = (today.reminders ?? [])
    .filter((reminder) => reminder.openAt <= now && !opened.has(openedKey(today.date, reminder.time, reminder.openAt)))
    .map((reminder) => ({ time: reminder.time, openAt: reminder.openAt, items: today.items.filter((item) => item.time === reminder.time && item.status === "pending") }))
    .filter((group) => group.items.length > 0);
  return due.length ? due[due.length - 1]! : null;
}
