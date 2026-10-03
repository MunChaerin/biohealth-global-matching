// 흰 캡슐 각인 읽기 (리리베아 vs 독립목클린). 두 캡슐은 글자 없는 면이 똑같아서 모델만으로는 헷갈리므로,
// 모델이 둘 중 하나로 보는 상태가 1초 이어지면 확대 사진에 OCR(tesseract.js)을 한 번만 돌려 각인으로 정한다.
// 사진은 브라우저 안에서만 쓰고 저장·전송하지 않는다 (OCR 실행 파일·언어 데이터만 CDN에서 받음).
//
// 전처리 (camera-model/pill-recognition에서 데이터셋 사진으로 맞춘 것과 같은 순서):
//   회색조 -> 평균보다 밝은 곳 = 캡슐 -> 긴 축을 수평으로 돌림 -> 줄마다 캡슐 양 끝 사이만 남기고 바깥은 흰색
//   -> 폭 800px로 키움 -> 주변 밝기보다 확실히 어두운 곳만 검정(글씨). 캡슐 둥근 면의 그림자는 주변과 같이 어두워서 빠진다.

export const LYRIBEA = "K-045037"; // 리리베아캡슐 50mg, 각인 DWB / PGN 50
export const DOKRIP = "K-045269"; // 독립목클린캡슐 200mg, 각인 DLB / ACC
export const WHITE_CAPSULES: readonly string[] = [LYRIBEA, DOKRIP];

// OCR이 실제로 읽은 글자 조각 (데이터셋 사진 144장에서 확인). 거꾸로 놓인 각인을 읽은 모양(8MQ, 810 등)도 포함.
const LYRIBEA_TOKENS = new Set(["PGN", "PG", "PEN", "PCN", "DWB", "OWB", "0WB", "DW8", "8MQ", "8M", "8M3", "BMQ", "SMA"]);
const DOKRIP_TOKENS = new Set(["ACC", "OLB", "DLB", "0LB", "DL8", "DIB", "810", "81Q", "O0V", "00V"]);

/** OCR 글자 -> 약 코드. 둘 다 보이거나 아무것도 없으면 null (사람이 확인). */
export function classifyImprintText(texts: readonly string[]): string | null {
  const tokens = new Set(texts.join(" ").toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(" ").filter(Boolean));
  const lyribea = [...tokens].some((token) => LYRIBEA_TOKENS.has(token));
  const dokrip = [...tokens].some((token) => DOKRIP_TOKENS.has(token));
  if (lyribea === dokrip) return null;
  return lyribea ? LYRIBEA : DOKRIP;
}

export interface GrayImage {
  data: Uint8Array; // 0~255, 한 줄씩
  width: number;
  height: number;
}

export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  }
  return { data, width, height };
}

/** 밝은 부분(캡슐)의 긴 축 각도(라디안, 이미지 좌표). */
function capsuleAxis(image: GrayImage, threshold: number): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[y * image.width + x]! > threshold) {
        n += 1;
        sx += x;
        sy += y;
      }
    }
  }
  if (!n) return 0;
  const mx = sx / n;
  const my = sy / n;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[y * image.width + x]! > threshold) {
        a += (x - mx) ** 2;
        b += (x - mx) * (y - my);
        c += (y - my) ** 2;
      }
    }
  }
  return 0.5 * Math.atan2(2 * b, a - c);
}

/** angle만큼 돌린 좌표계로 다시 그린다 (긴 축이 수평이 되도록). 밖은 fill. */
function rotate(image: GrayImage, angle: number, fill: number, nearest = false): GrayImage {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const width = Math.ceil(Math.abs(image.width * cos) + Math.abs(image.height * sin));
  const height = Math.ceil(Math.abs(image.width * sin) + Math.abs(image.height * cos));
  const data = new Uint8Array(width * height);
  const cx = image.width / 2;
  const cy = image.height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // 출력 (x, y)는 원본에서 긴 축 방향으로 (x - w/2), 수직 방향으로 (y - h/2) 떨어진 점
      const dx = x - width / 2;
      const dy = y - height / 2;
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;
      data[y * width + x] = sample(image, sx, sy, fill, nearest);
    }
  }
  return { data, width, height };
}

function sample(image: GrayImage, x: number, y: number, fill: number, nearest: boolean): number {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return fill;
  if (nearest) return image.data[Math.round(y) * image.width + Math.round(x)]!;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => image.data[yy * image.width + xx]!;
  return Math.round(at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy);
}

function resize(image: GrayImage, width: number): GrayImage {
  const scale = width / image.width;
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = sample(image, Math.min((x + 0.5) / scale - 0.5, image.width - 1), Math.min((y + 0.5) / scale - 0.5, image.height - 1), 255, false);
    }
  }
  return { data, width, height };
}

/** 주변(한 변 2r+1 상자) 평균보다 offset 이상 어두우면 검정, 아니면 흰색. */
function adaptiveThreshold(image: GrayImage, radius: number, offset: number): GrayImage {
  const { width, height } = image;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += image.data[y * width + x]!;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1]! + row;
    }
  }
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = integral[y1 * (width + 1) + x1]! - integral[y0 * (width + 1) + x1]! - integral[y1 * (width + 1) + x0]! + integral[y0 * (width + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      data[y * width + x] = image.data[y * width + x]! < mean - offset ? 0 : 255;
    }
  }
  return { data, width, height };
}

export const OCR_WIDTH = 800;

/** 알약 부분을 자른 회색조 사진 -> OCR용 흑백 사진 (글씨 검정, 나머지 흰색). 캡슐을 못 찾으면 null. */
export function prepareImprint(crop: GrayImage): GrayImage | null {
  let sum = 0;
  for (const value of crop.data) sum += value;
  const threshold = sum / crop.data.length;
  const angle = capsuleAxis(crop, threshold);

  const gray = rotate(crop, angle, 0);
  const mask = rotate({ ...crop, data: crop.data.map((value) => (value > threshold ? 255 : 0)) }, angle, 0, true);

  // 수평으로 놓인 캡슐은 볼록하므로 줄마다 가장 왼쪽~오른쪽 밝은 점 사이를 캡슐로 (글씨·띠도 포함)
  const counts = new Array<number>(mask.height).fill(0);
  for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) if (mask.data[y * mask.width + x]) counts[y]! += 1;
  const maxCount = Math.max(...counts);
  if (maxCount === 0) return null;
  const keep = new Uint8Array(gray.width * gray.height);
  let top = Infinity;
  let bottom = -1;
  let left = Infinity;
  let right = -1;
  for (let y = 0; y < mask.height; y += 1) {
    if (counts[y]! <= maxCount * 0.5) continue;
    let first = -1;
    let last = -1;
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    const margin = Math.floor((last - first) * 0.04);
    for (let x = first + margin; x < last - margin; x += 1) keep[y * gray.width + x] = 1;
    if (last - margin > first + margin) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, first + margin);
      right = Math.max(right, last - margin - 1);
    }
  }
  if (bottom < 0) return null;

  const width = right - left + 1;
  const height = bottom - top + 1;
  const capsule = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y + top) * gray.width + x + left;
      capsule[y * width + x] = keep[i] ? gray.data[i]! : 255;
    }
  }
  return adaptiveThreshold(resize({ data: capsule, width, height }, OCR_WIDTH), 60, 25);
}

/** 180도 돌린 사진 (각인이 거꾸로 놓였을 때). */
export function rotate180(image: GrayImage): GrayImage {
  return { ...image, data: image.data.slice().reverse() };
}

function toCanvas(image: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(image.width, image.height);
  for (let i = 0; i < image.data.length; i += 1) {
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = image.data[i]!;
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** 프레임에서 알약 부분(여백 10%)을 잘라 회색조로. */
export function cropGray(frame: HTMLVideoElement | HTMLCanvasElement, box: readonly [number, number, number, number]): GrayImage | null {
  const frameWidth = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
  const frameHeight = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
  const [bx, by, bw, bh] = box;
  const x0 = Math.max(0, (bx - bw * 0.1) * frameWidth);
  const y0 = Math.max(0, (by - bh * 0.1) * frameHeight);
  const x1 = Math.min(frameWidth, (bx + bw * 1.1) * frameWidth);
  const y1 = Math.min(frameHeight, (by + bh * 1.1) * frameHeight);
  const width = Math.round(x1 - x0);
  const height = Math.round(y1 - y0);
  if (width < 8 || height < 8) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(frame, x0, y0, x1 - x0, y1 - y0, 0, 0, width, height);
  return toGray(context.getImageData(0, 0, width, height).data, width, height);
}

type OcrWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let workerPromise: Promise<OcrWorker> | null = null;

function ocrWorker(): Promise<OcrWorker> {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ", tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return worker;
  })().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

export interface ImprintReading {
  drugCode: string | null; // 각인으로 정한 약 (못 정하면 null)
  texts: string[]; // OCR이 읽은 글자 (바로 / 180도)
}

/** 잘라 둔 알약 사진의 각인을 읽는다. 바로 놓인 것과 180도 돌린 것 두 번 읽는다. */
export async function readCapsuleImprint(crop: GrayImage): Promise<ImprintReading> {
  const prepared = prepareImprint(crop);
  if (!prepared) return { drugCode: null, texts: [] };
  const worker = await ocrWorker();
  const texts: string[] = [];
  for (const image of [prepared, rotate180(prepared)]) {
    const { data } = await worker.recognize(toCanvas(image));
    texts.push(data.text.replace(/\s+/g, " ").trim());
  }
  return { drugCode: classifyImprintText(texts), texts };
}
