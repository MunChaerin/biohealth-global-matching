import type { PillModelManifest, PillRecognizer } from "./recognizer";
import { decodeYoloOutput, letterbox } from "./yolo";

// onnxruntime-web 실행 파일(wasm). package.json의 onnxruntime-web 버전과 맞춰야 한다.
const ORT_WASM_URL =
  process.env.NEXT_PUBLIC_ORT_WASM_URL ?? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

/** 학습한 YOLO ONNX 모델로 알약을 찾는다. 영상은 브라우저 밖으로 나가지 않는다. */
export async function createOnnxPillRecognizer(manifest: PillModelManifest, manifestUrl: string): Promise<PillRecognizer> {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = ORT_WASM_URL;
  const modelUrl = new URL(manifest.model, new URL(manifestUrl, window.location.href)).toString();
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] });

  const size = manifest.inputSize;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("캔버스를 사용할 수 없습니다.");
  const input = new Float32Array(3 * size * size);

  return {
    async detect(frame) {
      const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
      const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
      if (!width || !height) return [];

      // 비율을 유지한 채 정사각형으로 (YOLO 학습 때와 같은 회색 여백)
      const box = letterbox(width, height, size);
      context.fillStyle = "rgb(114,114,114)";
      context.fillRect(0, 0, size, size);
      context.drawImage(frame, box.padX, box.padY, width * box.scale, height * box.scale);
      const pixels = context.getImageData(0, 0, size, size).data;
      const area = size * size;
      for (let i = 0; i < area; i += 1) {
        input[i] = pixels[i * 4]! / 255;
        input[area + i] = pixels[i * 4 + 1]! / 255;
        input[2 * area + i] = pixels[i * 4 + 2]! / 255;
      }

      const results = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, size, size]) });
      const output = results[session.outputNames[0]!]!;
      return decodeYoloOutput(output.data as Float32Array, output.dims, manifest.classes, box);
    },
    close() {
      void session.release();
    },
  };
}
