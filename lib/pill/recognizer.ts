import type { PillDetection } from "./verdict";

/** 카메라 프레임에서 알약을 찾아 어떤 약인지 알려주는 모델. 브라우저 안에서만 돈다. */
export interface PillRecognizer {
  detect(frame: HTMLVideoElement | HTMLCanvasElement): Promise<PillDetection[]>;
  close(): void;
}

// 학습한 모델은 public/models/pill/ 아래에 둔다 (manifest.json + onnx 파일).
export const PILL_MODEL_MANIFEST_URL =
  process.env.NEXT_PUBLIC_PILL_MODEL_MANIFEST_URL ?? "/models/pill/manifest.json";

export interface PillModelManifest {
  model: string; // onnx 파일 경로 (manifest 기준 상대 경로 또는 절대 URL)
  inputSize: number; // 정사각형 입력 크기 (예: 640)
  classes: string[]; // 클래스 순서대로 약 코드
}

export type PillRecognizerLoad =
  | { kind: "ready"; recognizer: PillRecognizer }
  | { kind: "notReady" } // 아직 학습한 모델이 없음
  | { kind: "error"; error: unknown };

/**
 * 알약 인식 모델을 불러온다. 모델 파일이 아직 없으면 notReady.
 * ONNX 모델 실행부는 모델을 학습한 뒤(onnxPillRecognizer) 이어서 붙인다.
 */
export async function loadPillRecognizer(): Promise<PillRecognizerLoad> {
  try {
    const response = await fetch(PILL_MODEL_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return { kind: "notReady" };
    const manifest = (await response.json()) as PillModelManifest;
    const { createOnnxPillRecognizer } = await import("./onnxPillRecognizer");
    return { kind: "ready", recognizer: await createOnnxPillRecognizer(manifest, PILL_MODEL_MANIFEST_URL) };
  } catch (error) {
    return { kind: "error", error };
  }
}

/** 모델 없이 화면 흐름을 확인하는 개발용 인식기 (?pillDebug=1). 버튼으로 보이는 약을 정한다. */
export class DebugPillRecognizer implements PillRecognizer {
  current: PillDetection[] = [];

  async detect(): Promise<PillDetection[]> {
    return this.current;
  }

  close(): void {
    this.current = [];
  }
}
