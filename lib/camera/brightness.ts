// 어두운 카메라 영상 밝기 보정 - Python 트래커(landmark_expression_tracker.py)의 brighten()과 같은 방식.
// 웹캠 영상이 어두우면 얼굴 랜드마크가 흔들리므로, 분석용 프레임은 감마 보정하고 미리보기도 밝게 보여준다.

export const TARGET_BRIGHTNESS = 110; // 0~255
export const MIN_GAMMA = 0.4; // 보정 한계 (너무 어두운 영상을 과하게 밝히면 노이즈만 커짐)
const MAX_PREVIEW_BRIGHTNESS = 2.5;

/** RGBA 픽셀 배열의 평균 밝기 (0~255). step 픽셀마다 하나씩 샘플링한다. */
export function frameBrightness(data: Uint8ClampedArray, step = 4): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < data.length; i += 4 * step) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    count += 1;
  }
  return count ? sum / count : 0;
}

/** 평균 밝기가 목표보다 낮으면 적용할 감마 (1이면 보정 안 함). */
export function gammaFor(brightness: number): number {
  if (brightness >= TARGET_BRIGHTNESS * 0.9 || brightness < 1) return 1;
  return Math.max(MIN_GAMMA, Math.log(TARGET_BRIGHTNESS / 255) / Math.log(brightness / 255));
}

/** 감마 보정을 픽셀 배열에 직접 적용한다 (알파 채널은 그대로). */
export function applyGamma(data: Uint8ClampedArray, gamma: number): void {
  if (gamma === 1) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = Math.round(Math.pow(v / 255, gamma) * 255);
  for (let i = 0; i + 2 < data.length; i += 4) {
    data[i] = lut[data[i]!]!;
    data[i + 1] = lut[data[i + 1]!]!;
    data[i + 2] = lut[data[i + 2]!]!;
  }
}

/** 미리보기에 줄 CSS brightness 값 (보기용이라 단순 배율로 근사). */
export function previewBrightness(brightness: number): number {
  if (brightness >= TARGET_BRIGHTNESS * 0.9 || brightness < 1) return 1;
  return Math.min(MAX_PREVIEW_BRIGHTNESS, TARGET_BRIGHTNESS / brightness);
}
