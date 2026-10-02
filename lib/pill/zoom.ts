// 화면 가운데 가이드 네모 안만 보고, 알약이 작으면 그 주변을 더 확대해서 본다.
// - 표정 카메라라 얼굴·옷·머리카락이 화면에 들어오는데, 알약만 있는 사진으로 학습해서 이를 색깔 약으로 착각한다.
//   환자 화면에 네모 가이드를 그리고 모델에는 그 부분만 넣는다.
// - 학습 사진에서는 알약이 화면 폭의 25~30%를 차지하는데 웹캠에서는 훨씬 작아 각인이 뭉개진다.
//   네모 안에서도 알약이 작으면 그 주변을 잘라 학습 때 크기로 키워서 한 번 더 판정한다.

import type { PillRecognizer } from "./recognizer";
import { pillsInFrame, type PillDetection } from "./verdict";

/** 프레임 기준 정규화 영역 [x, y, 너비, 높이] */
export type Region = readonly [number, number, number, number];

export const GUIDE_FRACTION = 0.6; // 가이드 네모 한 변 (화면 짧은 변 대비). 화면의 네모(.pillGuide)와 같아야 한다
export const ZOOM_TARGET = 0.3; // 확대한 화면에서 알약이 차지할 비율 (학습 사진과 비슷하게)

/** 중심·한 변(픽셀)으로 정사각형을 만들고 bounds(픽셀 [x, y, w, h]) 안으로 밀어 넣는다. */
function squareRegion(centerX: number, centerY: number, side: number, width: number, height: number, bounds: Region = [0, 0, width, height]): Region {
  const s = Math.min(side, bounds[2], bounds[3]);
  const x = Math.min(Math.max(centerX - s / 2, bounds[0]), bounds[0] + bounds[2] - s);
  const y = Math.min(Math.max(centerY - s / 2, bounds[1]), bounds[1] + bounds[3] - s);
  return [x / width, y / height, s / width, s / height];
}

/** 화면 가운데 정사각형 가이드 영역. */
export function guideRegion(width: number, height: number, fraction = GUIDE_FRACTION): Region {
  return squareRegion(width / 2, height / 2, Math.min(width, height) * fraction, width, height);
}

/** 찾은 알약 주변을 알약이 ZOOM_TARGET만큼 차지하도록 자른 영역 (within 안에서). 이미 충분히 크면 null. */
export function zoomRegionAround(box: Region, width: number, height: number, within: Region = [0, 0, 1, 1]): Region | null {
  const bounds: Region = [within[0] * width, within[1] * height, within[2] * width, within[3] * height];
  const side = Math.max(box[2] * width, box[3] * height) / ZOOM_TARGET;
  if (side >= Math.min(bounds[2], bounds[3]) * 0.9) return null;
  return squareRegion((box[0] + box[2] / 2) * width, (box[1] + box[3] / 2) * height, side, width, height, bounds);
}

/** 영역 안 기준 정규화 박스 -> 프레임 기준 정규화 박스. */
export function toFrameBox(box: Region, region: Region): Region {
  return [region[0] + box[0] * region[2], region[1] + box[1] * region[3], box[2] * region[2], box[3] * region[3]];
}

export interface ZoomedDetections {
  detections: PillDetection[]; // 판정에 쓸 검출 (프레임 기준 박스)
  guide: PillDetection[]; // 가이드 네모 안에서 찾은 것
  zoomed: PillDetection[] | null; // 더 확대해서 찾은 것 (확대 안 했으면 null)
}

/**
 * 가이드 네모 안에서 찾고, 알약이 한 알인데 작으면 그 주변을 더 확대해서 다시 찾는다.
 * 확대한 쪽에서 한 알이 보이면 그 결과를 쓴다 (학습 때와 같은 크기라 더 믿을 만함).
 */
export async function detectWithZoom(recognizer: PillRecognizer, frame: HTMLVideoElement | HTMLCanvasElement): Promise<ZoomedDetections> {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
  const guide = guideRegion(width, height);
  const inGuide = await recognizer.detect(frame, guide);
  const pills = pillsInFrame(inGuide);
  const region = pills.length === 1 && pills[0]!.box ? zoomRegionAround(pills[0]!.box, width, height, guide) : null;
  if (!region) return { detections: inGuide, guide: inGuide, zoomed: null };

  const zoomed = await recognizer.detect(frame, region);
  return { detections: pillsInFrame(zoomed).length === 1 ? zoomed : inGuide, guide: inGuide, zoomed };
}

/** 개발용 로그 한 줄: "네모 무스판정 0.70 -> 확대 타이레놀정 0.88" */
export function describeDetections(result: ZoomedDetections, name: (code: string) => string): string {
  const show = (items: PillDetection[]) => (items.length ? items.map((item) => `${name(item.drugCode)} ${item.confidence.toFixed(2)}`).join(", ") : "없음");
  return `네모 ${show(result.guide)}${result.zoomed ? ` -> 확대 ${show(result.zoomed)}` : ""}`;
}
