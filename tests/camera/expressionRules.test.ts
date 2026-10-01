import { describe, expect, it } from "vitest";
import { ExpressionMonitor, CALIBRATION_MS } from "../../lib/camera/expressionMonitor";
import {
  SleepDetector,
  SLEEP_MIN_MS,
  eyesClosed,
  extractMetrics,
  metricDeltas,
  proxyFromDeltas,
} from "../../lib/camera/expressionRules";
import type { FaceMetrics, LandmarkPoints } from "../../lib/camera/types";
import fixture from "./fixtures/expressionRules.python.json";

// 기대값은 Python 프로토타입(camera-model/face-emotion/expression_rules.py)으로 만든 것
// (tests/camera/fixtures/generate_expression_fixture.py). TS 규칙이 Python과 같은 결과를 내는지 확인한다.

type PyPoints = Record<string, number[]>;

function toPoints(raw: PyPoints): LandmarkPoints {
  const points: LandmarkPoints = {};
  for (const [key, [x, y]] of Object.entries(raw)) points[Number(key)] = [x!, y!];
  return points;
}

const pyToTs: Record<string, keyof FaceMetrics> = {
  eye_open: "eyeOpen",
  brow_height: "browHeight",
  brow_gap: "browGap",
  nose_lip: "noseLip",
  mouth_open: "mouthOpen",
  mouth_width: "mouthWidth",
  corner_lift: "cornerLift",
};

const pyActionToTs: Record<string, string> = {
  eye_narrow: "eyeNarrow",
  eye_widen: "eyeWiden",
  brow_lower: "browLower",
  brow_raise: "browRaise",
  brow_squeeze: "browSqueeze",
  lip_raise: "lipRaise",
  corner_up: "cornerUp",
  corner_down: "cornerDown",
  mouth_widen: "mouthWiden",
};

const baseline = extractMetrics(toPoints(fixture.baseline as PyPoints));

describe("expressionRules - Python 프로토타입과 같은 결과", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const metrics = extractMetrics(toPoints(c.points as PyPoints));
    for (const [pyKey, value] of Object.entries(c.metrics)) {
      expect(metrics[pyToTs[pyKey]!]).toBeCloseTo(value as number, 9);
    }

    const closed = eyesClosed(metrics, baseline);
    expect(closed).toBe(c.closed);

    const result = proxyFromDeltas(metricDeltas(metrics, baseline), closed);
    // Python round()와 Math.round()의 반올림 차이만 허용 (소수 셋째 자리 1단위)
    for (const [pyKey, value] of Object.entries(c.actions)) {
      expect(result.actions[pyActionToTs[pyKey] as keyof typeof result.actions]).toBeCloseTo(value as number, 2);
    }
    expect(result.scores.pain).toBeCloseTo(c.scores.pain, 2);
    expect(result.scores.anxiety).toBeCloseTo(c.scores.anxiety, 2);
    expect(result.scores.lethargy).toBeCloseTo(c.scores.lethargy, 2);
    expect(result.scores.calm).toBeCloseTo(c.scores.calm, 2);
    expect(result.smile).toBeCloseTo(c.smile, 2);
    expect(result.frown).toBeCloseTo(c.frown, 2);
    expect(result.dominant).toBe(c.dominant);
  });
});

describe("SleepDetector", () => {
  it("편하게 눈을 감고 10초가 지나야 sleeping", () => {
    const detector = new SleepDetector();
    expect(detector.update(0, true, 0)).toBe("eyesClosed");
    expect(detector.update(SLEEP_MIN_MS - 1, true, 0)).toBe("eyesClosed");
    expect(detector.update(SLEEP_MIN_MS, true, 0)).toBe("sleeping");
    expect(detector.update(SLEEP_MIN_MS + 500, false, 0)).toBe("awake");
  });

  it("눈을 감고 찡그리면 수면이 아니다 (통증 표정)", () => {
    const detector = new SleepDetector();
    for (let t = 0; t <= SLEEP_MIN_MS * 2; t += 500) expect(detector.update(t, true, 0.5)).toBe("awake");
  });
});

describe("ExpressionMonitor", () => {
  const neutral = baseline;
  const closedEyes: FaceMetrics = { ...baseline, eyeOpen: baseline.eyeOpen * 0.1 };

  it("캘리브레이션이 끝나기 전에는 판정하지 않는다", () => {
    const monitor = new ExpressionMonitor();
    expect(monitor.addFrame(0, neutral)).toBeNull();
    expect(monitor.addFrame(CALIBRATION_MS - 1, neutral)).toBeNull();
    expect(monitor.isCalibrated).toBe(false);
    expect(monitor.trend()).toBeNull();
  });

  it("기준선과 같은 얼굴은 none, 오래 눈을 감으면 sleeping으로 집계된다", () => {
    const monitor = new ExpressionMonitor();
    monitor.addFrame(0, neutral);
    monitor.addFrame(CALIBRATION_MS, neutral); // 캘리브레이션 완료
    expect(monitor.isCalibrated).toBe(true);

    let t = CALIBRATION_MS;
    for (let i = 0; i < 10; i += 1) expect(monitor.addFrame((t += 500), neutral)?.analysis.dominant).toBe("none");
    // 기준선과 똑같은 얼굴만 이어졌으므로 저활성 표정
    expect(monitor.trend()?.flatExpressionFlag).toBe(true);

    let last = null;
    for (let i = 0; i < 30; i += 1) last = monitor.addFrame((t += 500), closedEyes);
    expect(last?.analysis.dominant).toBe("sleeping");

    const trend = monitor.trend();
    expect(trend?.sampleCount).toBe(40);
    expect(trend?.sleepingRatio).toBeGreaterThan(0);
    expect(trend?.dominantRatio.none).toBeCloseTo(10 / 40, 3);
  });
});
