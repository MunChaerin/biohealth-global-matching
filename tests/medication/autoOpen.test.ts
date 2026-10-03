import { describe, expect, it } from "vitest";
import { clockTime, dueGroup, openedKey } from "../../lib/medication/autoOpen";
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
    expect(dueGroup(day(items), "09:00", new Set([openedKey("2026-10-03", "08:00", "08:00")]))).toBeNull();
    const taken = [item("a-am", "08:00", "taken"), item("a-pm", "18:00", "pending")];
    expect(dueGroup(day(taken), "09:00", new Set())).toBeNull();
  });

  it("아침을 못 먹었어도 저녁 시각이 되면 저녁 약을 연다", () => {
    expect(dueGroup(day(items), "18:05", new Set([openedKey("2026-10-03", "08:00", "08:00")]))?.time).toBe("18:00");
  });

  it("오늘 이미 열었어도 의료진이 시각을 바꾸면 새 시각에 다시 연다", () => {
    const opened = new Set([openedKey("2026-10-03", "18:00", "18:00")]); // 기본 18:00에 이미 열림
    const changed = day(items, [{ time: "08:00", openAt: "08:00" }, { time: "18:00", openAt: "19:06" }]);
    expect(dueGroup(changed, "19:05", new Set([...opened, openedKey("2026-10-03", "08:00", "08:00")]))).toBeNull();
    expect(dueGroup(changed, "19:06", new Set([...opened, openedKey("2026-10-03", "08:00", "08:00")]))?.time).toBe("18:00");
  });

  it("[회귀] 08:00을 놓친 채 19:00에 18:00 약을 열면 08:00도 열었음으로 남겨, 닫은 뒤 08:00이 이어서 열리지 않는다", () => {
    const first = dueGroup(day(items), "19:00", new Set())!;
    expect(first.time).toBe("18:00");
    expect(first.markKeys).toEqual([openedKey("2026-10-03", "08:00", "08:00"), openedKey("2026-10-03", "18:00", "18:00")]);
    expect(dueGroup(day(items), "19:00", new Set(first.markKeys))).toBeNull();
  });

  it("의료진이 바꾼 시각을 따른다", () => {
    expect(dueGroup(day(items, [{ time: "08:00", openAt: "07:30" }, { time: "18:00", openAt: "18:00" }]), "07:31", new Set())?.time).toBe("08:00");
  });

  it("시각은 한국·일본 시간", () => {
    expect(clockTime(new Date("2026-10-02T23:05:00Z"))).toBe("08:05");
  });
});
