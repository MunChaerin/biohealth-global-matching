// 표정 판정 규칙 - camera-model/face-emotion/expression_rules.py(Python 프로토타입, #4)를 그대로 옮긴 것.
// 규칙 근거와 실험 결과는 camera-model/docs/표정감정_설계.md 참고.
// 규칙을 바꿀 때는 Python 쪽과 같이 바꾸고 tests/camera/expressionRules.test.ts의 기대값도 갱신한다.

import type {
  ActionKey,
  ActionScores,
  ExpressionAnalysis,
  FaceMetrics,
  LandmarkPoints,
  ProxyKey,
  SleepState,
} from "./types";

// MediaPipe Face Mesh 랜드마크 인덱스 (468/478 토폴로지)
export const IDX = {
  eyeOuterL: 33,
  eyeOuterR: 263,
  eyeInnerL: 133,
  eyeInnerR: 362,
  eyeUpL: 159,
  eyeDownL: 145,
  eyeUpR: 386,
  eyeDownR: 374,
  browInL: 107,
  browInR: 336,
  subnasale: 2,
  mouthL: 61,
  mouthR: 291,
  lipUp: 13,
  lipDown: 14,
} as const;

export const KEY_LANDMARKS: readonly number[] = Object.values(IDX);

// delta(기준선 대비 변화량, 두 눈 바깥쪽 거리 단위)를 0~1 점수로 바꾸는 구간 [lo, hi]
// lo 미만은 노이즈로 보고 0, hi 이상은 1
export const RULE_RANGES: Record<ActionKey, readonly [number, number]> = {
  eyeNarrow: [0.015, 0.06], // 눈 가늘어짐/감김 (AU6/7/43)
  eyeWiden: [0.012, 0.045], // 눈 크게 뜸 (AU5)
  browLower: [0.01, 0.04], // 눈썹 내려옴 (AU4)
  browRaise: [0.015, 0.05], // 눈썹 올라감 (AU1+2)
  browSqueeze: [0.005, 0.03], // 미간 좁아짐 (AU4)
  lipRaise: [0.008, 0.03], // 코밑~윗입술 짧아짐 (AU9/10, 판정에는 안 씀)
  cornerUp: [0.01, 0.04], // 입꼬리 올라감 (AU12)
  cornerDown: [0.01, 0.04], // 입꼬리 내려감 (AU15)
  mouthWiden: [0.02, 0.1], // 입 옆으로 벌어짐 (미소)
};

// 눈을 감으면 찡그리지 않아도 눈썹이 내려오고 미간이 좁아져서, 눈 감은 프레임은 기준을 올린다.
export const CLOSED_EYE_RANGES: Partial<Record<ActionKey, readonly [number, number]>> = {
  browLower: [0.045, 0.08],
  browSqueeze: [0.025, 0.05],
};

export const PROXY_KEYS: readonly ProxyKey[] = ["pain", "anxiety", "lethargy", "calm"];
export const DOMINANT_MIN_SCORE = 0.2; // 가장 높은 점수가 이보다 낮으면 "none"

export const EYE_CLOSED_RATIO = 0.4; // 눈 뜬 정도가 기준선의 이 비율 미만이면 눈 감음
export const SLEEP_MIN_MS = 10_000; // 눈 감음이 이만큼 이어지면 sleeping (데모용 값, 실제 운영은 수 분 권장)
export const SLEEP_MAX_FROWN = 0.2; // 눈 감고 찡그리는 건 통증 표정이라 수면으로 보지 않음

interface NormalizedPoint {
  x: number;
  y: number;
}

/** MediaPipe 정규화 좌표 -> 규칙용 좌표. x에 화면 가로/세로 비율을 곱해 가로·세로 단위를 맞춘다. */
export function pointsFromLandmarks(landmarks: readonly NormalizedPoint[], aspect: number): LandmarkPoints {
  const points: LandmarkPoints = {};
  for (const index of KEY_LANDMARKS) {
    const landmark = landmarks[index];
    if (!landmark) throw new Error(`랜드마크 ${index}번이 없습니다.`);
    points[index] = [landmark.x * aspect, landmark.y];
  }
  return points;
}

function point(points: LandmarkPoints, index: number): readonly [number, number] {
  const value = points[index];
  if (!value) throw new Error(`랜드마크 ${index}번이 없습니다.`);
  return value;
}

/**
 * 얼굴 지표 계산. 거리/높이는 두 눈 바깥쪽 거리(iod)로 나누고,
 * "높이"는 두 눈을 잇는 축에 수직인 방향(아래가 +)으로 재서 고개 기울기에 덜 민감하게 한다.
 */
export function extractMetrics(points: LandmarkPoints): FaceMetrics {
  const p = (index: number) => point(points, index);
  const [ax, ay] = [p(IDX.eyeOuterR)[0] - p(IDX.eyeOuterL)[0], p(IDX.eyeOuterR)[1] - p(IDX.eyeOuterL)[1]];
  const iod = Math.hypot(ax, ay) + 1e-6;
  const down: readonly [number, number] = [-ay / iod, ax / iod];

  const dist = (a: number, b: number) => Math.hypot(p(a)[0] - p(b)[0], p(a)[1] - p(b)[1]) / iod;
  const below = (a: number, ref: number) =>
    ((p(a)[0] - p(ref)[0]) * down[0] + (p(a)[1] - p(ref)[1]) * down[1]) / iod;

  const lipCenter: readonly [number, number] = [
    (p(IDX.lipUp)[0] + p(IDX.lipDown)[0]) / 2,
    (p(IDX.lipUp)[1] + p(IDX.lipDown)[1]) / 2,
  ];
  const cornerDrop = (corner: number) =>
    (lipCenter[0] - p(corner)[0]) * down[0] + (lipCenter[1] - p(corner)[1]) * down[1];

  return {
    eyeOpen: (dist(IDX.eyeUpL, IDX.eyeDownL) + dist(IDX.eyeUpR, IDX.eyeDownR)) / 2,
    browHeight: (below(IDX.eyeInnerL, IDX.browInL) + below(IDX.eyeInnerR, IDX.browInR)) / 2,
    browGap: dist(IDX.browInL, IDX.browInR),
    noseLip: dist(IDX.subnasale, IDX.lipUp),
    mouthOpen: dist(IDX.lipUp, IDX.lipDown),
    mouthWidth: dist(IDX.mouthL, IDX.mouthR),
    cornerLift: (cornerDrop(IDX.mouthL) + cornerDrop(IDX.mouthR)) / 2 / iod,
  };
}

export function ramp(x: number, lo: number, hi: number): number {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  return (x - lo) / (hi - lo);
}

export function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function metricDeltas(metrics: FaceMetrics, baseline: FaceMetrics): FaceMetrics {
  return {
    eyeOpen: metrics.eyeOpen - baseline.eyeOpen,
    browHeight: metrics.browHeight - baseline.browHeight,
    browGap: metrics.browGap - baseline.browGap,
    noseLip: metrics.noseLip - baseline.noseLip,
    mouthOpen: metrics.mouthOpen - baseline.mouthOpen,
    mouthWidth: metrics.mouthWidth - baseline.mouthWidth,
    cornerLift: metrics.cornerLift - baseline.cornerLift,
  };
}

export function eyesClosed(metrics: FaceMetrics, baseline: FaceMetrics): boolean {
  return metrics.eyeOpen < baseline.eyeOpen * EYE_CLOSED_RATIO;
}

/** delta -> 개별 표정 동작(AU 유사) 점수 0~1. closed(눈 감음)면 눈썹 동작은 CLOSED_EYE_RANGES로 판정. */
export function actionScores(d: FaceMetrics, closed = false): ActionScores {
  const signed: Record<ActionKey, number> = {
    eyeNarrow: -d.eyeOpen,
    eyeWiden: d.eyeOpen,
    browLower: -d.browHeight,
    browRaise: d.browHeight,
    browSqueeze: -d.browGap,
    lipRaise: -d.noseLip,
    cornerUp: d.cornerLift,
    cornerDown: -d.cornerLift,
    mouthWiden: d.mouthWidth,
  };
  const scores = {} as ActionScores;
  for (const key of Object.keys(signed) as ActionKey[]) {
    const [lo, hi] = (closed ? CLOSED_EYE_RANGES[key] : undefined) ?? RULE_RANGES[key];
    scores[key] = round3(ramp(signed[key], lo, hi));
  }
  return scores;
}

/** delta -> 통증/불안/무기력/평온 점수 (PSPI 참고 규칙, 임상 검증 전) */
export function proxyFromDeltas(d: FaceMetrics, closed = false): Omit<ExpressionAnalysis, "state"> {
  const a = actionScores(d, closed);

  // 웃음은 입꼬리가 올라가야 인정 (입만 옆으로 벌어지는 건 처진 표정에서도 나옴)
  const smile = clip01(a.cornerUp * (0.4 + 0.6 * a.mouthWiden));
  // 찡그림(AU4). 진짜 웃음은 눈이 가늘어지고 눈썹도 내려와서 웃음만큼 깎는다.
  const frown = clip01(Math.max(a.browLower, a.browSqueeze) * 0.7 * (1 - smile));
  const gate = Math.min(1, frown * 2); // 찡그림이 있어야 눈 가늘어짐을 통증 쪽으로 해석

  const scores: Record<ProxyKey, number> = {
    pain: clip01(frown * 0.7 + a.eyeNarrow * gate * 0.3),
    anxiety: clip01(a.browRaise * 0.5 + a.eyeWiden * 0.5),
    lethargy: clip01(a.eyeNarrow * (1 - gate) * 0.7 + a.cornerDown * 0.6),
    calm: clip01(smile * (1 - frown)),
  };

  let top: ProxyKey = "pain";
  for (const key of PROXY_KEYS) if (scores[key] > scores[top]) top = key;

  return {
    scores: {
      pain: round3(scores.pain),
      anxiety: round3(scores.anxiety),
      lethargy: round3(scores.lethargy),
      calm: round3(scores.calm),
    },
    dominant: scores[top] >= DOMINANT_MIN_SCORE ? top : "none",
    smile: round3(smile),
    frown: round3(frown),
    actions: a,
  };
}

/**
 * 프레임마다 "awake" / "eyesClosed"(감은 지 SLEEP_MIN_MS 미만) / "sleeping"을 돌려준다.
 * 잠깐 눈 감은 건 감정 판정을 그대로 하고(눈 질끈 감기는 통증 신호일 수 있음), sleeping일 때만 멈춘다.
 */
export class SleepDetector {
  private closedSince: number | null = null;

  update(timeMs: number, closed: boolean, frown: number): SleepState {
    if (!(closed && frown < SLEEP_MAX_FROWN)) {
      this.closedSince = null;
      return "awake";
    }
    this.closedSince ??= timeMs;
    return timeMs - this.closedSince >= SLEEP_MIN_MS ? "sleeping" : "eyesClosed";
  }
}

/** 수면 중이면 감정 점수를 0으로 두고 dominant를 "sleeping"으로 바꾼다. */
export function applyState(analysis: Omit<ExpressionAnalysis, "state">, state: SleepState): ExpressionAnalysis {
  if (state !== "sleeping") return { ...analysis, state };
  return {
    ...analysis,
    state,
    scores: { pain: 0, anxiety: 0, lethargy: 0, calm: 0 },
    dominant: "sleeping",
  };
}
