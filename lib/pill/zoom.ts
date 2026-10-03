// 화면 가운데 가이드 네모 안만 보고, 알약이 작으면 그 주변을 더 확대해서 본다.
// - 표정 카메라라 얼굴·옷·머리카락이 화면에 들어오는데, 알약만 있는 사진으로 학습해서 이를 색깔 약으로 착각한다.
//   환자 화면에 네모 가이드를 그리고 모델에는 그 부분만 넣는다.
// - 학습 사진에서는 알약이 화면 폭의 25~30%를 차지하는데 웹캠에서는 훨씬 작아 각인이 뭉개진다.
//   네모 안에서도 알약이 작으면 그 주변을 잘라 학습 때 크기로 키워서 한 번 더 판정한다.

import type { PillRecognizer } from "./recognizer";
import { CONFIDENT, pillsInFrame, type PillDetection } from "./verdict";

/** 프레임 기준 정규화 영역 [x, y, 너비, 높이] */
export type Region = readonly [number, number, number, number];

export const GUIDE_FRACTION = 0.6; // 가이드 네모 한 변 (화면 짧은 변 대비). 화면의 네모(.pillGuide)와 같아야 한다
// 확대·축소한 화면에서 알약이 차지할 비율. v3를 아이패드 후면 사진으로 크기별로 재 보면 타이레놀은 12~30%에서 모두 맞지만
// 리리베아는 클수록 나빠지고(30%: 32장 중 2장) 16% 근처에서는 타이레놀로 착각이 많았다(10장). 그래서 확대는 20%까지만,
// 가까이 대서 너무 큰 알약은 25%(리리베아를 타이레놀로 본 경우 0)로 축소한다.
export const ZOOM_TARGET = 0.2;
export const ZOOM_OUT_TARGET = 0.25;
// 알약 크기(긴 변) / 가이드 네모 한 변.
// - ZOOM_OUT_FROM보다 크면 알약 주변을 더 넓게 잘라(축소) 학습 때 크기로 맞춰 다시 판정한다 (가까이 대서 너무 크게 보임)
// - TOO_CLOSE 이상 / TOO_FAR 미만이면 거리 안내 ("조금 멀리 떼 주세요" / "조금 가까이")
export const ZOOM_OUT_FROM = 0.45;
export const TOO_CLOSE = 0.6;
export const TOO_FAR = 0.1;
export type DistanceHint = "tooClose" | "tooFar";

/** 알약 크기(긴 변) / 가이드 네모 한 변 */
export function pillSizeInGuide(box: Region, width: number, height: number): number {
  return Math.max(box[2] * width, box[3] * height) / (Math.min(width, height) * GUIDE_FRACTION);
}

export function distanceHint(size: number | null): DistanceHint | null {
  if (size === null) return null;
  if (size >= TOO_CLOSE) return "tooClose";
  if (size < TOO_FAR) return "tooFar";
  return null;
}

/** 큰 알약 주변을 알약이 ZOOM_OUT_TARGET만큼 차지하도록 넓게 자른 영역 (프레임 안에서). 네모보다 크게 넓힐 수 없으면 null. */
export function zoomOutRegion(box: Region, width: number, height: number): Region | null {
  const side = Math.min(Math.max(box[2] * width, box[3] * height) / ZOOM_OUT_TARGET, width, height);
  if (side <= Math.min(width, height) * GUIDE_FRACTION * 1.05) return null;
  return squareRegion((box[0] + box[2] / 2) * width, (box[1] + box[3] / 2) * height, side, width, height);
}

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
  zoomed: PillDetection[] | null; // 확대(또는 축소)해서 다시 찾은 것 (안 했으면 null)
  zoomKind?: "in" | "out";
  size: number | null; // 네모 안 알약 크기 (알약 긴 변 / 네모 한 변), 한 알이 아니면 null
}

/**
 * 가이드 네모 안에서 찾고, 알약이 한 알인데 작으면 그 주변을 더 확대해서, 너무 크면(가까이 댐) 더 넓게 잘라 다시 찾는다.
 * 확대는 알약이 네모의 18%(= 0.9 x ZOOM_TARGET)보다 작을 때만 들어간다.
 * 확대·축소 결과는 같은 약일 때만 쓴다. 다른 약으로 바뀌는 건 네모에서 본 약이 애매(0.6 미만)했을 때만 허용한다
 * (리리베아가 확대에서 타이레놀로 바뀌는 식의 같이 먹는 약 착각을 막기 위해).
 * 확대한 쪽에서 한 알이 보이고, 네모에서 본 약과 같거나 확신이 더 높을 때만 확대 결과를 쓴다
 * (네모 리리베아 0.78 -> 확대 무스판정 0.62처럼 맞는 답이 더 약한 틀린 답으로 뒤집히는 것 방지).
 */
export async function detectWithZoom(recognizer: PillRecognizer, frame: HTMLVideoElement | HTMLCanvasElement): Promise<ZoomedDetections> {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
  const guide = guideRegion(width, height);
  const inGuide = await recognizer.detect(frame, guide);
  const pills = pillsInFrame(inGuide);
  const box = pills.length === 1 ? pills[0]!.box : undefined;
  const size = box ? pillSizeInGuide(box, width, height) : null;
  const zoomKind = size === null ? undefined : size > ZOOM_OUT_FROM ? "out" : "in";
  const region = !box ? null : zoomKind === "out" ? zoomOutRegion(box, width, height) : zoomRegionAround(box, width, height, guide);
  if (!region) return { detections: inGuide, guide: inGuide, zoomed: null, size };

  const zoomed = await recognizer.detect(frame, region);
  const [zoomedPill, ...others] = pillsInFrame(zoomed);
  const before = pills[0]!;
  const useZoomed =
    Boolean(zoomedPill) &&
    others.length === 0 &&
    (zoomedPill!.drugCode === before.drugCode || (before.confidence < CONFIDENT && zoomedPill!.confidence > before.confidence));
  return { detections: useZoomed ? zoomed : inGuide, guide: inGuide, zoomed, zoomKind, size };
}

/** 개발용 로그 한 줄: "네모 무스판정 0.70 (2등 타이레놀정 0.41) -> 확대 타이레놀정 0.88 (2등 …)" */
export function describeDetections(result: ZoomedDetections, name: (code: string) => string): string {
  const show = (items: PillDetection[]) =>
    items.length
      ? items
          .map((item) => `${name(item.drugCode)} ${item.confidence.toFixed(2)}${item.second ? ` (2등 ${name(item.second.drugCode)} ${item.second.confidence.toFixed(2)})` : ""}`)
          .join(", ")
      : "없음";
  const size = result.size === null ? "" : ` [크기 ${Math.round(result.size * 100)}%]`;
  return `네모 ${show(result.guide)}${size}${result.zoomed ? ` -> ${result.zoomKind === "out" ? "축소" : "확대"} ${show(result.zoomed)}` : ""}`;
}
