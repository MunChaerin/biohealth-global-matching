// 캘리브레이션(평상시 얼굴 기준선) + 프레임별 판정 + 최근 구간 집계.
// camera-model/face-emotion/landmark_expression_tracker.py의 ExpressionMonitor를 옮긴 것.

import {
  SleepDetector,
  applyState,
  eyesClosed,
  metricDeltas,
  proxyFromDeltas,
} from "./expressionRules";
import type { DominantState, ExpressionSample, ExpressionTrend, FaceMetrics } from "./types";

export const CALIBRATION_MS = 5_000; // 시작 후 이 시간 동안 평상시 표정을 기준선으로 수집
export const TREND_WINDOW_MS = 10 * 60_000; // 의료진 화면에 보여줄 최근 구간
export const FLAT_ACTIVITY_THRESHOLD = 0.05; // 기준선 대비 변화량이 이보다 작으면 "변화 거의 없음"
export const FLAT_RATIO_THRESHOLD = 0.7; // 깨어 있는 프레임 중 이 비율 이상이 변화 없음이면 저활성 표정

const METRIC_KEYS: readonly (keyof FaceMetrics)[] = [
  "eyeOpen",
  "browHeight",
  "browGap",
  "noseLip",
  "mouthOpen",
  "mouthWidth",
  "cornerLift",
];

export class ExpressionMonitor {
  private calibrationSamples: FaceMetrics[] = [];
  private calibrationStartMs: number | null = null;
  private baseline: FaceMetrics | null = null;
  private history: ExpressionSample[] = [];
  private sleep = new SleepDetector();

  get isCalibrated(): boolean {
    return this.baseline !== null;
  }

  /**
   * 얼굴이 검출된 프레임마다 호출한다. 캘리브레이션 중이면 null, 끝난 뒤에는 판정 결과를 돌려준다.
   * timeMs는 단조 증가하는 시각(ms)이어야 한다.
   */
  addFrame(timeMs: number, metrics: FaceMetrics): ExpressionSample | null {
    if (!this.baseline) {
      this.calibrationStartMs ??= timeMs;
      this.calibrationSamples.push(metrics);
      if (timeMs - this.calibrationStartMs >= CALIBRATION_MS) this.finalizeCalibration();
      return null;
    }

    const deltas = metricDeltas(metrics, this.baseline);
    const activity = METRIC_KEYS.reduce((sum, key) => sum + Math.abs(deltas[key]), 0);
    const closed = eyesClosed(metrics, this.baseline);
    const proxy = proxyFromDeltas(deltas, closed);
    const state = this.sleep.update(timeMs, closed, proxy.frown);
    const sample: ExpressionSample = { timeMs, activity, analysis: applyState(proxy, state) };

    this.history.push(sample);
    while (this.history.length && timeMs - this.history[0]!.timeMs > TREND_WINDOW_MS) this.history.shift();
    return sample;
  }

  private finalizeCalibration(): void {
    const n = this.calibrationSamples.length;
    const baseline = {} as FaceMetrics;
    for (const key of METRIC_KEYS) {
      baseline[key] = this.calibrationSamples.reduce((sum, sample) => sum + sample[key], 0) / n;
    }
    this.baseline = baseline;
    this.calibrationSamples = [];
  }

  /** 최근 TREND_WINDOW_MS 동안의 상태 비율. 자는 동안은 저활성 계산에서 뺀다. */
  trend(): ExpressionTrend | null {
    const n = this.history.length;
    if (n === 0) return null;

    const counts: Partial<Record<DominantState, number>> = {};
    for (const sample of this.history) {
      const key = sample.analysis.dominant;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const dominantRatio: Partial<Record<DominantState, number>> = {};
    for (const [key, count] of Object.entries(counts) as [DominantState, number][]) {
      dominantRatio[key] = Math.round((count / n) * 1000) / 1000;
    }

    const awake = this.history.filter((sample) => sample.analysis.state !== "sleeping");
    const flatCount = awake.filter((sample) => sample.activity < FLAT_ACTIVITY_THRESHOLD).length;

    return {
      sampleCount: n,
      dominantRatio,
      sleepingRatio: Math.round((1 - awake.length / n) * 1000) / 1000,
      flatExpressionFlag: awake.length > 0 && flatCount / awake.length >= FLAT_RATIO_THRESHOLD,
    };
  }
}
