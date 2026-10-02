// 확대해서 다시 보기. 학습 사진에서는 알약이 화면 폭의 25~30%를 차지하는데, 웹캠에서 손에 든 알약은
// 그보다 훨씬 작아 각인이 뭉개진다. 알약 주변(못 찾으면 화면 가운데)을 잘라 학습 때 크기로 키워서 한 번 더 판정한다.

import type { PillRecognizer } from "./recognizer";
import type { PillDetection } from "./verdict";

/** 프레임 기준 정규화 영역 [x, y, 너비, 높이] */
export type Region = readonly [number, number, number, number];

export const ZOOM_TARGET = 0.3; // 확대한 화면에서 알약이 차지할 비율 (학습 사진과 비슷하게)
export const CENTER_FRACTION = 0.5; // 알약을 못 찾았을 때 확대해 볼 화면 가운데 크기 (짧은 변 기준)

/** 정사각형 영역(픽셀)을 프레임 안으로 밀어 넣어 정규화 영역으로 만든다. */
function squareRegion(centerX: number, centerY: number, side: number, width: number, height: number): Region {
  const s = Math.min(side, width, height);
  const x = Math.min(Math.max(centerX - s / 2, 0), width - s);
  const y = Math.min(Math.max(centerY - s / 2, 0), height - s);
  return [x / width, y / height, s / width, s / height];
}

/** 찾은 알약 주변을 알약이 ZOOM_TARGET만큼 차지하도록 자른 영역. 이미 충분히 크면 null. */
export function zoomRegionAround(box: Region, width: number, height: number): Region | null {
  const pillSide = Math.max(box[2] * width, box[3] * height);
  const side = pillSide / ZOOM_TARGET;
  if (side >= Math.min(width, height) * 0.9) return null;
  return squareRegion((box[0] + box[2] / 2) * width, (box[1] + box[3] / 2) * height, side, width, height);
}

/** 화면 가운데 정사각형 영역. */
export function centerRegion(width: number, height: number, fraction = CENTER_FRACTION): Region {
  return squareRegion(width / 2, height / 2, Math.min(width, height) * fraction, width, height);
}

/** 영역 안 기준 정규화 박스 -> 프레임 기준 정규화 박스. */
export function toFrameBox(box: Region, region: Region): Region {
  return [region[0] + box[0] * region[2], region[1] + box[1] * region[3], box[2] * region[2], box[3] * region[3]];
}

export interface ZoomedDetections {
  detections: PillDetection[]; // 판정에 쓸 검출 (프레임 기준 박스)
  full: PillDetection[]; // 화면 전체에서 찾은 것
  zoomed: PillDetection[] | null; // 확대해서 찾은 것 (확대 안 했으면 null)
}

/**
 * 화면 전체에서 찾고, 알약이 한 알인데 작거나 아무것도 못 찾았으면 확대해서 다시 찾는다.
 * 확대한 쪽에서 딱 한 알이 보이면 그 결과를 쓴다 (학습 때와 같은 크기라 더 믿을 만함). 여러 알이면 그대로 둔다.
 */
export async function detectWithZoom(recognizer: PillRecognizer, frame: HTMLVideoElement | HTMLCanvasElement): Promise<ZoomedDetections> {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
  const full = await recognizer.detect(frame);
  let region: Region | null = null;
  if (full.length === 0) region = centerRegion(width, height);
  else if (full.length === 1 && full[0]!.box) region = zoomRegionAround(full[0]!.box, width, height);
  if (!region) return { detections: full, full, zoomed: null };

  const zoomed = await recognizer.detect(frame, region);
  return { detections: zoomed.length === 1 ? zoomed : full, full, zoomed };
}

/** 개발용 로그 한 줄: "전체 타이레놀 0.42 -> 확대 타이레놀 0.81" */
export function describeDetections(result: ZoomedDetections, name: (code: string) => string): string {
  const show = (items: PillDetection[]) => (items.length ? items.map((item) => `${name(item.drugCode)} ${item.confidence.toFixed(2)}`).join(", ") : "없음");
  return `전체 ${show(result.full)}${result.zoomed ? ` -> 확대 ${show(result.zoomed)}` : ""}`;
}
