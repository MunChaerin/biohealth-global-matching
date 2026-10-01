import { describe, expect, it } from "vitest";
import { PillVerdictTracker, STABLE_MS, readDetections, type PillDetection } from "../../lib/pill/verdict";

const amlodipine = (confidence = 0.9): PillDetection => ({ drugCode: "A", confidence });
const metformin = (confidence = 0.9): PillDetection => ({ drugCode: "B", confidence });

describe("readDetections", () => {
  it("검출이 없거나 아주 약하면 알약 없음", () => {
    expect(readDetections([])).toEqual({ kind: "noPill" });
    expect(readDetections([amlodipine(0.2)])).toEqual({ kind: "noPill" });
  });

  it("여러 알이 보이면 한 알씩 비춰 달라고 한다", () => {
    expect(readDetections([amlodipine(), metformin()])).toEqual({ kind: "multiple" });
  });

  it("확신이 낮으면 잘 모르겠어요 (학습하지 않은 약 오인 방지)", () => {
    expect(readDetections([amlodipine(0.5)])).toEqual({ kind: "unsure" });
  });
});

describe("PillVerdictTracker", () => {
  it("같은 약이 1초 이어져야 맞음으로 판정한다", () => {
    const tracker = new PillVerdictTracker("A");
    expect(tracker.update(0, [amlodipine()])).toEqual({ kind: "checking", drugCode: "A" });
    expect(tracker.update(STABLE_MS - 1, [amlodipine()]).kind).toBe("checking");
    expect(tracker.update(STABLE_MS, [amlodipine()])).toEqual({ kind: "match", drugCode: "A" });
  });

  it("다른 약이 1초 이어지면 다른 약으로 판정한다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [metformin()]);
    expect(tracker.update(STABLE_MS, [metformin()])).toEqual({ kind: "mismatch", drugCode: "B" });
  });

  it("중간에 약이 바뀌거나 사라지면 처음부터 다시 센다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [metformin()]);
    tracker.update(600, [amlodipine()]); // 바뀜
    expect(tracker.update(1_200, [amlodipine()]).kind).toBe("checking"); // 600부터 600ms
    tracker.update(1_300, []); // 사라짐
    tracker.update(1_400, [amlodipine()]);
    expect(tracker.update(2_300, [amlodipine()]).kind).toBe("checking");
    expect(tracker.update(2_400, [amlodipine()]).kind).toBe("match");
  });

  it("확신이 낮은 프레임은 판정을 이어가지 않는다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [amlodipine()]);
    expect(tracker.update(500, [amlodipine(0.5)]).kind).toBe("unsure");
    expect(tracker.update(1_000, [amlodipine()]).kind).toBe("checking");
  });
});
