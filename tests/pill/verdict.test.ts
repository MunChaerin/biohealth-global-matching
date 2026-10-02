import { describe, expect, it } from "vitest";
import { MISMATCH_STABLE_MS, PillVerdictTracker, STABLE_MS, readDetections, type PillDetection } from "../../lib/pill/verdict";

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

  it("가장 확신 높은 박스보다 많이 약한 박스(배경 착각 등)는 다른 알약으로 세지 않는다", () => {
    // 로그: 리리베아 0.83, 듀오락스 0.62, 퍼킨정 0.48 -> 리리베아 한 알
    expect(readDetections([amlodipine(0.83), metformin(0.62), metformin(0.48)])).toMatchObject({ kind: "pill", drugCode: "A" });
    expect(readDetections([amlodipine(0.83), metformin(0.7)])).toEqual({ kind: "multiple" });
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
    expect(tracker.update(STABLE_MS, [amlodipine()])).toMatchObject({ kind: "match", drugCode: "A", confidence: expect.any(Number) });
  });

  it("다른 약은 확신 0.8 이상이 2초 이어져야 다른 약으로 판정한다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [metformin()]);
    expect(tracker.update(STABLE_MS, [metformin()]).kind).toBe("checking");
    expect(tracker.update(MISMATCH_STABLE_MS, [metformin()])).toMatchObject({ kind: "mismatch", drugCode: "B" });
  });

  it("다른 약이 0.8보다 약하면 다른 약이라고 하지 않고 잘 모르겠어요 (배경 착각 방지)", () => {
    const tracker = new PillVerdictTracker("A");
    for (let t = 0; t <= 5_000; t += 250) expect(tracker.update(t, [metformin(0.75)]).kind).toBe("unsure");
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

  it("같은 시간에 먹을 약이 여러 개면 그중 하나면 맞음, 남은 약이 바뀌면 다시 센다", () => {
    const tracker = new PillVerdictTracker(["A", "B"]);
    tracker.update(0, [metformin()]);
    expect(tracker.update(STABLE_MS, [metformin()])).toMatchObject({ kind: "match", drugCode: "B" });
    tracker.setExpected(["A"]); // B를 먹음
    expect(tracker.update(STABLE_MS + 100, [metformin()]).kind).toBe("checking");
    expect(tracker.update(STABLE_MS + 100 + MISMATCH_STABLE_MS, [metformin()])).toMatchObject({ kind: "mismatch", drugCode: "B" });
  });
});
