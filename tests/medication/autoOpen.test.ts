import { describe, expect, it } from "vitest";
import { clockTime, dueGroup } from "../../lib/medication/autoOpen";
import type { MedicationStatus, TodayMedication } from "../../lib/medication/intakeStore";

const item = (id: string, time: string, status: "taken" | "pending") => ({ id, time, status, mismatchCount: 0 }) as unknown as MedicationStatus;

function day(items: MedicationStatus[], reminders = [{ time: "08:00", openAt: "08:00" }, { time: "18:00", openAt: "18:00" }]): TodayMedication {
  return { date: "2026-10-03", items, next: null, nextGroup: [], reminders };
}

describe("약 확인 자동 열기", () => {
  const items = [item("a-am", "08:00", "pending"), item("b-am", "08:00", "pending"), item("a-pm", "18:00", "pending")];

  it("자동 열림 시각이 되면 그 시간의 안 먹은 약을 연다", () => {
    expect(dueGroup(day(items), "07:59", new Set())).toBeNull();
    expect(dueGroup(day(items), "08:00", new Set())?.items.map((i) => i.id)).toEqual(["a-am", "b-am"]);
  });

  it("오늘 이미 자동으로 연 시간이거나 다 먹은 시간은 다시 열지 않는다", () => {
    expect(dueGroup(day(items), "09:00", new Set(["2026-10-03|08:00"]))).toBeNull();
    const taken = [item("a-am", "08:00", "taken"), item("a-pm", "18:00", "pending")];
    expect(dueGroup(day(taken), "09:00", new Set())).toBeNull();
  });

  it("아침을 못 먹었어도 저녁 시각이 되면 저녁 약을 연다", () => {
    expect(dueGroup(day(items), "18:05", new Set(["2026-10-03|08:00"]))?.time).toBe("18:00");
  });

  it("의료진이 바꾼 시각을 따른다", () => {
    expect(dueGroup(day(items, [{ time: "08:00", openAt: "07:30" }, { time: "18:00", openAt: "18:00" }]), "07:31", new Set())?.time).toBe("08:00");
  });

  it("시각은 한국·일본 시간", () => {
    expect(clockTime(new Date("2026-10-02T23:05:00Z"))).toBe("08:05");
  });
});
