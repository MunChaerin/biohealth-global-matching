// 알약 인식 결과(프레임마다) -> "맞는 약 / 다른 약 / 잘 모르겠어요" 판정.
// 한 프레임 결과로 바로 판정하지 않고, 같은 약이 STABLE_MS 동안 이어질 때만 판정해서 오인을 줄인다.

export interface PillDetection {
  drugCode: string; // 모델 클래스에 해당하는 약 코드
  confidence: number; // 0~1
  box?: readonly [number, number, number, number]; // 정규화 좌표 [x, y, w, h]
  second?: { drugCode: string; confidence: number }; // 같은 박스에서 두 번째로 높은 약
}

export const DETECT_MIN_CONFIDENCE = 0.4; // 이보다 낮은 검출은 알약으로 보지 않음
export const CONFIDENT = 0.6; // 이보다 낮으면 어떤 약인지 "잘 모르겠어요" (학습한 10종 밖의 약 오인 방지)
export const STABLE_MS = 1_000; // 같은 약이 이만큼 이어져야 판정
// 이번 시간에 먹는 약이 2개 이상일 때 1등·2등이 모두 이번 시간 약이면, 점수 차이가 이만큼 날 때만 판정한다
// (v3 아이패드 테스트: 리리베아 앞면을 타이레놀로 판정 -> 아침에 둘 다 먹으므로 "맞아요! 타이레놀"로 잘못 기록될 수 있었음)
export const GROUP_MARGIN = 0.3;
// 판정 중인 약이 한 프레임만 흔들려도(기준 아래·잠깐 안 보임) 처음부터 다시 세면, 한 번 판정에 시간이 걸리는 기기
// (아이패드: 1초에 1~2프레임)에서는 판정이 거의 안 난다. 이만큼 연속으로 흔들릴 때까지는 이어서 센다.
export const MAX_MISSES = 1;
// "다른 약"은 더 엄격하게: 배경(잠옷 무늬 등)을 0.7대로 꾸준히 약으로 착각한 경우가 있었고,
// 잘못된 "다른 약" 기록이 의료진에게 가는 게 가장 비싼 실수라서. 기준에 못 미치면 "잘 모르겠어요"로 둔다.
// v2 웹캠 테스트에서 0.8·2초 기준에 0.81~0.86이 가끔 닿아 0.9·3초로 올렸다.
export const MISMATCH_CONFIDENT = 0.9;
export const MISMATCH_STABLE_MS = 3_000;
export const RELATIVE_MIN = 0.75; // 가장 확신 높은 박스의 이 비율보다 약한 박스는 다른 알약으로 세지 않음 (배경 착각 등)

export type PillReading =
  | { kind: "noPill" }
  | { kind: "multiple" }
  | { kind: "unsure" }
  | { kind: "pill"; drugCode: string; confidence: number; box?: PillDetection["box"]; second?: PillDetection["second"] };

export type PillVerdict =
  | { kind: "noPill" } // 알약이 안 보임
  | { kind: "multiple" } // 여러 알이 보임 -> 한 알씩
  | { kind: "unsure" } // 어떤 약인지 확신이 낮음
  | { kind: "checking"; drugCode: string } // 같은 약이 보이는 중, 판정 대기
  | { kind: "match"; drugCode: string; confidence?: number; box?: PillDetection["box"]; byPerson?: boolean; byOcr?: boolean } // box: 확대 사진용, byPerson: 사진을 보고 환자가 정함, byOcr: 각인으로 바로잡음
  | { kind: "mismatch"; drugCode: string; confidence?: number; box?: PillDetection["box"] };

/** 알약으로 셀 검출만 남긴다 (확신 높은 순). 0.83 옆의 0.48처럼 많이 약한 박스는 버린다. */
export function pillsInFrame(detections: readonly PillDetection[]): PillDetection[] {
  const found = detections.filter((item) => item.confidence >= DETECT_MIN_CONFIDENCE).sort((a, b) => b.confidence - a.confidence);
  const top = found[0]?.confidence ?? 0;
  return found.filter((item) => item.confidence >= top * RELATIVE_MIN);
}

/** 한 프레임의 검출 결과를 읽는다. */
export function readDetections(detections: readonly PillDetection[]): PillReading {
  const found = pillsInFrame(detections);
  if (found.length === 0) return { kind: "noPill" };
  if (found.length > 1) return { kind: "multiple" };
  const [pill] = found;
  if (pill!.confidence < CONFIDENT) return { kind: "unsure" };
  return { kind: "pill", drugCode: pill!.drugCode, confidence: pill!.confidence, box: pill!.box, second: pill!.second };
}

/**
 * 판정 범위는 "이번 복용 시간의 약"이다.
 * - 아직 안 먹은 약(expected)이면 맞음
 * - 이번 시간에 이미 먹은 약(taken)이면 "방금 드셨어요" (다른 약 판정, 0.9·3초)
 * - 그 밖의 클래스는 "다른 약"이라고 하지 않고 "잘 모르겠어요" (일정 밖의 약을 학습한 10종 중 하나로 억지로 부르지 않음)
 */
export class PillVerdictTracker {
  private candidate: { drugCode: string; since: number } | null = null;
  private expected: Set<string>;
  private taken = new Set<string>();
  private misses = 0; // 판정 중인 약이 연속으로 흔들린 프레임 수
  // 약별 "맞는 약" 기준 (model-metadata.json thresholds.classConfidence). 글자 없는 면이 다른 약과 똑같아
  // 그 약을 이 약으로 높게 확신하는 경우가 있는 약만 더 높게 둔다 (예: 리리베아 0.8 - 독립목클린 뒷면을 0.7대로 리리베아라고 봄).
  private classConfidence: Readonly<Record<string, number>> = {};

  /** expected: 지금 먹어야 하는 약 코드 (같은 시간에 여러 알이면 여러 개 - 그중 하나면 맞음) */
  constructor(expected: string | readonly string[]) {
    this.expected = new Set(typeof expected === "string" ? [expected] : expected);
  }

  /** 한 알을 먹고 나서 남은 약으로 바꿀 때. 보고 있던 약의 판정은 처음부터 다시 센다. */
  setExpected(expected: readonly string[]): void {
    this.expected = new Set(expected);
    this.candidate = null;
    this.misses = 0;
  }

  /** 판정 중인 약이 있으면 흔들린 프레임을 MAX_MISSES번까지 봐주고 "확인 중"을 유지한다. 넘으면 처음부터. */
  private miss(fallback: PillVerdict): PillVerdict {
    if (this.candidate && this.misses < MAX_MISSES) {
      this.misses += 1;
      return { kind: "checking", drugCode: this.candidate.drugCode };
    }
    this.candidate = null;
    this.misses = 0;
    return fallback;
  }

  /** 이번 복용 시간에 이미 먹은 약 (다시 비추면 "방금 드셨어요") */
  setTaken(taken: readonly string[]): void {
    this.taken = new Set(taken);
  }

  setClassConfidence(classConfidence: Readonly<Record<string, number>>): void {
    this.classConfidence = classConfidence;
  }

  update(timeMs: number, detections: readonly PillDetection[]): PillVerdict {
    const reading = readDetections(detections);
    if (reading.kind !== "pill") return this.miss(reading);
    const expected = this.expected.has(reading.drugCode);
    if (!expected && !this.taken.has(reading.drugCode)) return this.miss({ kind: "unsure" });
    const needed = expected ? (this.classConfidence[reading.drugCode] ?? CONFIDENT) : MISMATCH_CONFIDENT;
    if (reading.confidence < needed) return this.miss({ kind: "unsure" });
    // 같이 먹는 약끼리 헷갈림: 1등·2등이 모두 이번 시간 약이면 점수 차이가 GROUP_MARGIN 이상일 때만
    const group = new Set([...this.expected, ...this.taken]);
    const second = reading.second;
    if (group.size >= 2 && second && second.drugCode !== reading.drugCode && group.has(second.drugCode) && reading.confidence - second.confidence < GROUP_MARGIN) {
      return this.miss({ kind: "unsure" });
    }
    this.misses = 0;
    if (this.candidate?.drugCode !== reading.drugCode) {
      this.candidate = { drugCode: reading.drugCode, since: timeMs };
    }
    if (timeMs - this.candidate.since < (expected ? STABLE_MS : MISMATCH_STABLE_MS)) return { kind: "checking", drugCode: reading.drugCode };
    return expected
      ? { kind: "match", drugCode: reading.drugCode, confidence: reading.confidence, box: reading.box }
      : { kind: "mismatch", drugCode: reading.drugCode, confidence: reading.confidence, box: reading.box };
  }

  reset(): void {
    this.candidate = null;
    this.misses = 0;
  }
}
