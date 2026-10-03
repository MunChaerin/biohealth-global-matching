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

  it("같이 먹는 약이 둘 이상일 때 1등·2등이 모두 이번 시간 약이면 점수 차이가 0.3 이상일 때만 맞음", () => {
    const close = { drugCode: "B", confidence: 0.8, second: { drugCode: "A", confidence: 0.6 } }; // 리리베아를 타이레놀로 보는 식
    const tracker = new PillVerdictTracker(["A", "B"]);
    for (let t = 0; t <= 3_000; t += 250) expect(tracker.update(t, [close]).kind).not.toBe("match");
    const clear = { drugCode: "B", confidence: 0.9, second: { drugCode: "A", confidence: 0.5 } };
    tracker.update(4_000, [clear]);
    expect(tracker.update(5_000, [clear]).kind).toBe("match");
    // 2등이 일정 밖의 약이거나, 이번 시간 약이 하나뿐이면 점수 차이를 보지 않는다
    const other = new PillVerdictTracker(["A", "B"]);
    const outside = { drugCode: "B", confidence: 0.8, second: { drugCode: "Z", confidence: 0.7 } };
    other.update(0, [outside]);
    expect(other.update(1_000, [outside]).kind).toBe("match");
    const single = new PillVerdictTracker("B");
    single.update(0, [close]);
    expect(single.update(1_000, [close]).kind).toBe("match");
  });

  it("일정 밖의 약은 확신이 높아도 다른 약이라고 하지 않고 잘 모르겠어요", () => {
    const tracker = new PillVerdictTracker("A");
    for (let t = 0; t <= 5_000; t += 250) expect(tracker.update(t, [metformin(0.95)]).kind).toBe("unsure");
  });

  it("이번 시간에 이미 먹은 약은 확신 0.9 이상이 3초 이어져야 다시 비췄다고 판정한다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.setTaken(["B"]);
    expect(tracker.update(0, [metformin(0.86)]).kind).toBe("unsure"); // 웹캠 테스트에서 가끔 닿던 값
    tracker.update(0, [metformin()]);
    expect(tracker.update(STABLE_MS, [metformin()]).kind).toBe("checking");
    expect(tracker.update(MISMATCH_STABLE_MS, [metformin()])).toMatchObject({ kind: "mismatch", drugCode: "B" });
  });

  it("약별 기준이 있으면 그 약은 더 높은 확신에서만 맞음 (글자 없는 면이 다른 약과 같은 캡슐)", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.setClassConfidence({ A: 0.8 });
    expect(tracker.update(0, [amlodipine(0.75)]).kind).toBe("unsure");
    tracker.update(100, [amlodipine(0.85)]);
    expect(tracker.update(100 + STABLE_MS, [amlodipine(0.85)]).kind).toBe("match");
  });

  it("이미 먹은 약도 0.9보다 약하면 잘 모르겠어요", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.setTaken(["B"]);
    for (let t = 0; t <= 5_000; t += 250) expect(tracker.update(t, [metformin(0.75)]).kind).toBe("unsure");
  });

  it("판정 중인 약이 바뀌면 처음부터 다시 센다", () => {
    const tracker = new PillVerdictTracker(["A", "B"]);
    tracker.update(0, [metformin()]);
    tracker.update(600, [amlodipine()]); // 바뀜
    expect(tracker.update(1_200, [amlodipine()]).kind).toBe("checking"); // 600부터 600ms
    expect(tracker.update(1_600, [amlodipine()]).kind).toBe("match");
  });

  it("한 프레임만 흔들리면(기준 아래·잠깐 안 보임) 이어서 센다 - 1초에 1~2프레임인 기기 대비", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [amlodipine()]);
    expect(tracker.update(500, [amlodipine(0.5)])).toEqual({ kind: "checking", drugCode: "A" });
    expect(tracker.update(1_000, [amlodipine()]).kind).toBe("match"); // 0부터 1초
    tracker.reset();
    tracker.update(2_000, [amlodipine()]);
    expect(tracker.update(2_500, []).kind).toBe("checking"); // 잠깐 안 보임
    expect(tracker.update(3_000, [amlodipine()]).kind).toBe("match");
  });

  it("두 프레임 연속으로 흔들리면 처음부터 다시 센다", () => {
    const tracker = new PillVerdictTracker("A");
    tracker.update(0, [amlodipine()]);
    tracker.update(400, [amlodipine(0.5)]);
    expect(tracker.update(800, [amlodipine(0.5)]).kind).toBe("unsure");
    expect(tracker.update(1_200, [amlodipine()]).kind).toBe("checking"); // 1200부터 다시
    expect(tracker.update(2_200, [amlodipine()]).kind).toBe("match");
  });

  it("같은 시간에 먹을 약이 여러 개면 그중 하나면 맞음, 남은 약이 바뀌면 다시 센다", () => {
    const tracker = new PillVerdictTracker(["A", "B"]);
    tracker.update(0, [metformin()]);
    expect(tracker.update(STABLE_MS, [metformin()])).toMatchObject({ kind: "match", drugCode: "B" });
    tracker.setExpected(["A"]); // B를 먹음
    tracker.setTaken(["B"]);
    expect(tracker.update(STABLE_MS + 100, [metformin()]).kind).toBe("checking");
    expect(tracker.update(STABLE_MS + 100 + MISMATCH_STABLE_MS, [metformin()])).toMatchObject({ kind: "mismatch", drugCode: "B" });
  });
});
