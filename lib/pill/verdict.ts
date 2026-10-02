// 알약 인식 결과(프레임마다) -> "맞는 약 / 다른 약 / 잘 모르겠어요" 판정.
// 한 프레임 결과로 바로 판정하지 않고, 같은 약이 STABLE_MS 동안 이어질 때만 판정해서 오인을 줄인다.

export interface PillDetection {
  drugCode: string; // 모델 클래스에 해당하는 약 코드
  confidence: number; // 0~1
  box?: readonly [number, number, number, number]; // 정규화 좌표 [x, y, w, h]
}

export const DETECT_MIN_CONFIDENCE = 0.4; // 이보다 낮은 검출은 알약으로 보지 않음
export const CONFIDENT = 0.6; // 이보다 낮으면 어떤 약인지 "잘 모르겠어요" (학습한 10종 밖의 약 오인 방지)
export const STABLE_MS = 1_000; // 같은 약이 이만큼 이어져야 판정

export type PillReading =
  | { kind: "noPill" }
  | { kind: "multiple" }
  | { kind: "unsure" }
  | { kind: "pill"; drugCode: string; confidence: number; box?: PillDetection["box"] };

export type PillVerdict =
  | { kind: "noPill" } // 알약이 안 보임
  | { kind: "multiple" } // 여러 알이 보임 -> 한 알씩
  | { kind: "unsure" } // 어떤 약인지 확신이 낮음
  | { kind: "checking"; drugCode: string } // 같은 약이 보이는 중, 판정 대기
  | { kind: "match"; drugCode: string; confidence?: number; box?: PillDetection["box"] } // box: 화면에서 알약을 확대해 보여줄 때 사용
  | { kind: "mismatch"; drugCode: string; confidence?: number; box?: PillDetection["box"] };

/** 한 프레임의 검출 결과를 읽는다. */
export function readDetections(detections: readonly PillDetection[]): PillReading {
  const found = detections.filter((item) => item.confidence >= DETECT_MIN_CONFIDENCE);
  if (found.length === 0) return { kind: "noPill" };
  if (found.length > 1) return { kind: "multiple" };
  const [pill] = found;
  if (pill!.confidence < CONFIDENT) return { kind: "unsure" };
  return { kind: "pill", drugCode: pill!.drugCode, confidence: pill!.confidence, box: pill!.box };
}

export class PillVerdictTracker {
  private candidate: { drugCode: string; since: number } | null = null;
  private expected: Set<string>;

  /** expected: 지금 먹어야 하는 약 코드 (같은 시간에 여러 알이면 여러 개 - 그중 하나면 맞음) */
  constructor(expected: string | readonly string[]) {
    this.expected = new Set(typeof expected === "string" ? [expected] : expected);
  }

  /** 한 알을 먹고 나서 남은 약으로 바꿀 때. 보고 있던 약의 판정은 처음부터 다시 센다. */
  setExpected(expected: readonly string[]): void {
    this.expected = new Set(expected);
    this.candidate = null;
  }

  update(timeMs: number, detections: readonly PillDetection[]): PillVerdict {
    const reading = readDetections(detections);
    if (reading.kind !== "pill") {
      this.candidate = null;
      return reading;
    }
    if (this.candidate?.drugCode !== reading.drugCode) {
      this.candidate = { drugCode: reading.drugCode, since: timeMs };
    }
    if (timeMs - this.candidate.since < STABLE_MS) return { kind: "checking", drugCode: reading.drugCode };
    return this.expected.has(reading.drugCode)
      ? { kind: "match", drugCode: reading.drugCode, confidence: reading.confidence, box: reading.box }
      : { kind: "mismatch", drugCode: reading.drugCode, confidence: reading.confidence, box: reading.box };
  }

  reset(): void {
    this.candidate = null;
  }
}
