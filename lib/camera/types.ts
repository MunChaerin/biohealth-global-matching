/** 규칙에 쓰는 랜드마크 좌표 {인덱스: [x, y]} (x는 화면 비율을 곱한 값) */
export type LandmarkPoints = Record<number, readonly [number, number]>;

export interface FaceMetrics {
  eyeOpen: number; // 눈 뜬 정도
  browHeight: number; // 눈 안쪽 모서리선 대비 눈썹 높이 (클수록 올라감)
  browGap: number; // 양 눈썹 안쪽 사이 거리 (작아지면 미간 찌푸림)
  noseLip: number; // 코밑~윗입술 거리
  mouthOpen: number; // 입 벌어진 정도
  mouthWidth: number; // 입 좌우 폭
  cornerLift: number; // 입 중앙 대비 입꼬리 높이 (클수록 웃는 쪽)
}

export type ActionKey =
  | "eyeNarrow"
  | "eyeWiden"
  | "browLower"
  | "browRaise"
  | "browSqueeze"
  | "lipRaise"
  | "cornerUp"
  | "cornerDown"
  | "mouthWiden";

export type ActionScores = Record<ActionKey, number>;

export type ProxyKey = "pain" | "anxiety" | "lethargy" | "calm";

export type DominantState = ProxyKey | "none" | "sleeping";

export type SleepState = "awake" | "eyesClosed" | "sleeping";

export interface ExpressionAnalysis {
  scores: Record<ProxyKey, number>;
  dominant: DominantState;
  smile: number;
  frown: number;
  actions: ActionScores;
  state: SleepState;
}

export interface ExpressionSample {
  timeMs: number;
  activity: number; // 기준선 대비 전체 변화량
  analysis: ExpressionAnalysis;
}

export interface ExpressionTrend {
  sampleCount: number;
  dominantRatio: Partial<Record<DominantState, number>>;
  sleepingRatio: number;
  flatExpressionFlag: boolean; // 표정 변화가 계속 거의 없음 (파킨슨 가면양 얼굴, 문화적 표현 억제 등)
}
