import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 각인 OCR은 실제 사진이 없으므로 결과만 정해 둔다
const ocr = vi.hoisted(() => ({ drugCode: null as string | null }));
vi.mock("../../lib/pill/capsuleOcr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pill/capsuleOcr")>()),
  cropGray: vi.fn(() => ({ data: new Uint8Array(4), width: 2, height: 2 })),
  readCapsuleImprint: vi.fn(async () => ({ drugCode: ocr.drugCode, texts: [] })),
}));

// 카메라 앞의 장면: 판정을 다시 시작해도(새 인식기) 알약은 계속 보이고 있다
const scene = vi.hoisted(() => ({ detections: [] as unknown[] }));
vi.mock("../../lib/pill/recognizer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pill/recognizer")>();
  class SceneRecognizer extends actual.DebugPillRecognizer {
    override async detect() {
      return scene.detections as Awaited<ReturnType<actual.DebugPillRecognizer["detect"]>>;
    }
  }
  return { ...actual, DebugPillRecognizer: SceneRecognizer };
});

import { usePillCheck } from "../../components/patient/usePillCheck";
import { readCapsuleImprint } from "../../lib/pill/capsuleOcr";
import { getMedicationSchedule } from "../../lib/medication/schedule";

const morning = getMedicationSchedule("tanaka-haruko").filter((item) => item.time === "08:00");
const [lyribea, tylenol] = morning as [(typeof morning)[number], (typeof morning)[number]];

/** 판정에 필요한 시간이 지나도록 기다린다 (performance.now는 호출마다 0.5초씩 흐름) */
const wait = (ms = 600) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));

describe("usePillCheck - 남은 약은 그대로인데 판정만 다시 시작될 때 (예: 카메라가 잠깐 끊겼다 다시 켜짐)", () => {
  let clock = 0;
  const videoRef = createRef<HTMLVideoElement>() as RefObject<HTMLVideoElement | null>;
  const correctedFrame = createRef<null>() as unknown as Parameters<typeof usePillCheck>[0]["correctedFrame"];

  beforeEach(() => {
    ocr.drugCode = null;
    scene.detections = [];
    vi.mocked(readCapsuleImprint).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    (videoRef as { current: HTMLVideoElement | null }).current = document.createElement("video");
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 500));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(medications = morning) {
    return renderHook(({ active }) => usePillCheck({ active, medications, patientId: "tanaka-haruko", videoRef, correctedFrame, debug: true }), {
      initialProps: { active: true },
    });
  }

  it("[회귀] 각인을 읽는 중에 정리되면 다시 시작했을 때 각인 확인을 다시 한다 (busy로 남아 계속 '확인 중'이 되지 않음)", async () => {
    vi.mocked(readCapsuleImprint).mockImplementationOnce(() => new Promise(() => {})); // 첫 번째는 끝나지 않음
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.phase).toBe("running"));
    scene.detections = [{ drugCode: tylenol.drugCode, confidence: 0.92, box: [0.4, 0.4, 0.2, 0.1] }];
    await wait();
    await waitFor(() => expect(readCapsuleImprint).toHaveBeenCalledTimes(1)); // 리리베아가 남아 있어 확정 전 각인 확인 (끝나지 않음)

    rerender({ active: false }); // 카메라가 잠깐 끊김
    ocr.drugCode = tylenol.drugCode;
    rerender({ active: true }); // 다시 켜짐 (남은 약은 그대로)
    await waitFor(() => expect(result.current.phase).toBe("running"));
    scene.detections = [{ drugCode: tylenol.drugCode, confidence: 0.92, box: [0.4, 0.4, 0.2, 0.1] }];
    await wait(1_200);
    await waitFor(() => expect(result.current.verdict).toMatchObject({ kind: "match", drugCode: tylenol.drugCode }));
    expect(readCapsuleImprint).toHaveBeenCalledTimes(2);
  });

  it("[회귀] 다시 시작한 뒤 같은 약이 보이면 근거 사진을 새로 찍는다 (지난 판정의 약이 남아 사진이 비지 않음)", async () => {
    let shot = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => `data:image/jpeg;base64,SHOT${(shot += 1)}`);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((_type: string, options?: unknown) =>
      options ? null : { drawImage: vi.fn() }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const { result, rerender } = setup([lyribea]);
    await waitFor(() => expect(result.current.phase).toBe("running"));
    scene.detections = [{ drugCode: lyribea.drugCode, confidence: 0.92, box: [0.4, 0.4, 0.2, 0.1] }];
    await waitFor(() => expect(result.current.evidence?.drugCode).toBe(lyribea.drugCode));

    rerender({ active: false }); // 카메라가 잠깐 끊김 (알약은 그대로 보이는 중)
    rerender({ active: true });
    await waitFor(() => expect(result.current.verdict).toMatchObject({ kind: "match", drugCode: lyribea.drugCode }));
    await waitFor(() => expect(result.current.evidence?.drugCode).toBe(lyribea.drugCode));
  });
});
