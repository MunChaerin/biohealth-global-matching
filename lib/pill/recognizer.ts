import type { PillDetection } from "./verdict";

/** 카메라 프레임에서 알약을 찾아 어떤 약인지 알려주는 모델. 브라우저 안에서만 돈다(영상은 서버로 보내지 않음). */
export interface PillRecognizer {
  modelVersion: string;
  detect(frame: HTMLVideoElement | HTMLCanvasElement): Promise<PillDetection[]>;
  close(): void;
}

// 모델 위치. Vercel·로컬 모두 같은 코드로 동작하도록 절대 주소를 쓰지 않고, 필요하면 환경변수로 바꾼다.
export const PILL_MODEL_URL = process.env.NEXT_PUBLIC_PILL_MODEL_URL ?? "/models/pill/pill_classifier.onnx";
// 메타데이터는 따로 지정하지 않으면 모델과 같은 폴더의 model-metadata.json
export const PILL_MODEL_METADATA_URL = process.env.NEXT_PUBLIC_PILL_MODEL_METADATA_URL ?? null;

/** public/models/pill/model-metadata.json (camera-model/pill-recognition/train_pill.py가 만든다) */
export interface PillModelMetadata {
  modelVersion: string;
  input: { shape: [number, number, number, number]; colorOrder: "RGB"; normalization: string; resize: string };
  output: { shape: [number, number, number] };
  classOrder: string[]; // 클래스 번호 순서대로 약 코드
  thresholds: { detect: number; confidence: number; stableMs: number };
}

export type PillRecognizerLoad =
  | { kind: "ready"; recognizer: PillRecognizer; loadMs: number }
  | { kind: "notReady" } // 모델 파일이 아직 없음 (404)
  | { kind: "error"; error: unknown };

export function metadataUrlFor(modelUrl: string, base: string): string {
  return PILL_MODEL_METADATA_URL
    ? new URL(PILL_MODEL_METADATA_URL, base).toString()
    : new URL("model-metadata.json", new URL(modelUrl, base)).toString();
}

/** 알약 인식 모델을 불러온다. 모델·메타데이터가 없으면 notReady, 그 밖의 실패는 error. */
export async function loadPillRecognizer(): Promise<PillRecognizerLoad> {
  const started = performance.now();
  try {
    const base = window.location.href;
    const response = await fetch(metadataUrlFor(PILL_MODEL_URL, base), { cache: "no-store" });
    if (response.status === 404) return { kind: "notReady" };
    if (!response.ok) throw new Error(`model-metadata.json HTTP ${response.status}`);
    const metadata = (await response.json()) as PillModelMetadata;
    const { createOnnxPillRecognizer } = await import("./onnxPillRecognizer");
    const recognizer = await createOnnxPillRecognizer(metadata, new URL(PILL_MODEL_URL, base).toString());
    const loadMs = Math.round(performance.now() - started);
    console.info(`[알약 인식] 모델 ${metadata.modelVersion} 로딩 ${loadMs}ms`);
    return { kind: "ready", recognizer, loadMs };
  } catch (error) {
    if (String(error).includes("404")) return { kind: "notReady" };
    return { kind: "error", error };
  }
}

/** 모델 없이 화면 흐름을 확인하는 개발용 인식기 (?pillDebug=1). 버튼으로 보이는 약을 정한다. */
export class DebugPillRecognizer implements PillRecognizer {
  modelVersion = "debug";
  current: PillDetection[] = [];

  async detect(): Promise<PillDetection[]> {
    return this.current;
  }

  close(): void {
    this.current = [];
  }
}
