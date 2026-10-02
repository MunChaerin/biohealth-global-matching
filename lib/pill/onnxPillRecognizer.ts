import type { PillModelMetadata, PillRecognizer } from "./recognizer";
import { decodeYoloOutput, letterbox } from "./yolo";
import { toFrameBox } from "./zoom";

// onnxruntime-web 실행 파일(wasm). package.json의 onnxruntime-web 버전과 맞춰야 한다.
const ORT_WASM_URL =
  process.env.NEXT_PUBLIC_ORT_WASM_URL ?? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

type Ort = typeof import("onnxruntime-web");

/**
 * 추론 세션을 만든다. 화면이 멈추지 않도록 먼저 Web Worker(proxy)에서 돌리고,
 * 그 브라우저에서 Worker 방식이 안 되면 일반 방식으로 다시 시도한다. 실행은 CPU(WASM)라 GPU가 없어도 동작한다.
 */
async function createSession(ort: Ort, modelUrl: string) {
  ort.env.wasm.wasmPaths = ORT_WASM_URL;
  try {
    ort.env.wasm.proxy = true;
    return { session: await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] }), worker: true };
  } catch (error) {
    console.warn("[알약 인식] Worker 실행을 쓸 수 없어 일반 방식으로 실행합니다.", error);
    ort.env.wasm.proxy = false;
    return { session: await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] }), worker: false };
  }
}

/** 학습한 YOLO ONNX 모델로 알약을 찾는다. 전처리는 model-metadata.json 기준 (RGB, /255, 회색 114 레터박스). */
export async function createOnnxPillRecognizer(metadata: PillModelMetadata, modelUrl: string): Promise<PillRecognizer> {
  const ort = await import("onnxruntime-web");
  const { session, worker } = await createSession(ort, modelUrl);

  const size = metadata.input.shape[3];
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("캔버스를 사용할 수 없습니다.");
  let firstInference = true;

  return {
    modelVersion: metadata.modelVersion,
    async detect(frame, region) {
      const frameWidth = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
      const frameHeight = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
      if (!frameWidth || !frameHeight) return [];
      // 확대할 부분 (없으면 화면 전체)
      const sx = region ? region[0] * frameWidth : 0;
      const sy = region ? region[1] * frameHeight : 0;
      const width = region ? region[2] * frameWidth : frameWidth;
      const height = region ? region[3] * frameHeight : frameHeight;
      const started = performance.now();

      // 비율을 유지한 채 정사각형으로 (YOLO 학습 때와 같은 회색 여백)
      const box = letterbox(width, height, size);
      context.fillStyle = "rgb(114,114,114)";
      context.fillRect(0, 0, size, size);
      context.drawImage(frame, sx, sy, width, height, box.padX, box.padY, width * box.scale, height * box.scale);
      const pixels = context.getImageData(0, 0, size, size).data;
      const area = size * size;
      // 매 프레임 새로 만든다: Worker 방식은 run() 때 입력 버퍼를 Worker로 넘겨서(transfer) 원래 배열이 비워진다
      const input = new Float32Array(3 * area);
      for (let i = 0; i < area; i += 1) {
        input[i] = pixels[i * 4]! / 255;
        input[area + i] = pixels[i * 4 + 1]! / 255;
        input[2 * area + i] = pixels[i * 4 + 2]! / 255;
      }

      const results = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, size, size]) });
      const output = results[session.outputNames[0]!]!;
      if (firstInference) {
        firstInference = false;
        console.info(`[알약 인식] 첫 추론 ${Math.round(performance.now() - started)}ms (${worker ? "Worker" : "메인 스레드"})`);
      }
      const detections = decodeYoloOutput(output.data as Float32Array, output.dims, metadata.classOrder, box, 0.25, 0.5);
      return region ? detections.map((item) => (item.box ? { ...item, box: toFrameBox(item.box, region) } : item)) : detections;
    },
    close() {
      void session.release();
    },
  };
}
