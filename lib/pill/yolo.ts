// YOLO(v8/11, Ultralytics) ONNX 출력 후처리. 출력 모양은 [1, 4 + 클래스 수, 후보 수]이고
// 앞 4개는 입력 이미지 기준 박스 중심 x, y, 너비, 높이(픽셀), 나머지는 클래스별 점수다.

import type { PillDetection } from "./verdict";

export interface Letterbox {
  scale: number; // 원본 -> 입력 크기 배율
  padX: number; // 입력 이미지 안에서 원본이 시작하는 x (픽셀)
  padY: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 원본 이미지를 비율 그대로 정사각형 입력(size)에 넣을 때의 배율·여백. */
export function letterbox(sourceWidth: number, sourceHeight: number, size: number): Letterbox {
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  return {
    scale,
    padX: (size - sourceWidth * scale) / 2,
    padY: (size - sourceHeight * scale) / 2,
    sourceWidth,
    sourceHeight,
  };
}

interface RawBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classIndex: number;
}

function iou(a: RawBox, b: RawBox): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * 모델 출력 -> 알약 검출 목록 (원본 이미지 기준 정규화 박스).
 * 같은 알약에 겹친 박스는 클래스와 상관없이 하나만 남긴다 (한 알에 여러 약 이름이 붙는 것 방지).
 */
export function decodeYoloOutput(
  data: ArrayLike<number>,
  dims: readonly number[],
  classes: readonly string[],
  box: Letterbox,
  minScore = 0.25,
  iouThreshold = 0.5,
): PillDetection[] {
  const [, channels, count] = dims as [number, number, number];
  const classCount = channels - 4;
  if (classCount !== classes.length) throw new Error(`모델 클래스 수(${classCount})와 manifest 클래스 수(${classes.length})가 다릅니다.`);

  const candidates: RawBox[] = [];
  for (let i = 0; i < count; i += 1) {
    let best = 0;
    let bestClass = 0;
    for (let c = 0; c < classCount; c += 1) {
      const score = data[(4 + c) * count + i]!;
      if (score > best) {
        best = score;
        bestClass = c;
      }
    }
    if (best < minScore) continue;
    const cx = data[i]!;
    const cy = data[count + i]!;
    const w = data[2 * count + i]!;
    const h = data[3 * count + i]!;
    candidates.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: best, classIndex: bestClass });
  }

  candidates.sort((a, b) => b.score - a.score);
  const kept: RawBox[] = [];
  for (const candidate of candidates) {
    if (kept.every((other) => iou(candidate, other) < iouThreshold)) kept.push(candidate);
  }

  return kept.map((item) => {
    const x1 = (item.x1 - box.padX) / box.scale;
    const y1 = (item.y1 - box.padY) / box.scale;
    const x2 = (item.x2 - box.padX) / box.scale;
    const y2 = (item.y2 - box.padY) / box.scale;
    return {
      drugCode: classes[item.classIndex]!,
      confidence: item.score,
      box: [x1 / box.sourceWidth, y1 / box.sourceHeight, (x2 - x1) / box.sourceWidth, (y2 - y1) / box.sourceHeight] as const,
    };
  });
}
