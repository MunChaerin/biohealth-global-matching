import { describe, expect, it, vi } from "vitest";
import type { PillRecognizer } from "../../lib/pill/recognizer";
import type { PillDetection } from "../../lib/pill/verdict";
import { centerRegion, describeDetections, detectWithZoom, toFrameBox, zoomRegionAround } from "../../lib/pill/zoom";

const frame = { width: 1280, height: 720 } as HTMLCanvasElement;

function fakeRecognizer(full: PillDetection[], zoomed: PillDetection[]) {
  const detect = vi.fn(async (_frame: unknown, region?: unknown) => (region ? zoomed : full));
  return { recognizer: { modelVersion: "test", detect, close: vi.fn() } as PillRecognizer, detect };
}

describe("확대 영역", () => {
  it("작은 알약 주변을 알약이 30%를 차지하도록 정사각형으로 자른다", () => {
    // 1280x720 화면에서 폭 96px(7.5%) 알약 -> 한 변 320px
    const region = zoomRegionAround([0.5, 0.5, 0.075, 0.1], 1280, 720)!;
    expect(region[2] * 1280).toBeCloseTo(320);
    expect(region[3] * 720).toBeCloseTo(320);
    // 알약 중심이 영역 중심
    expect((region[0] + region[2] / 2) * 1280).toBeCloseTo((0.5 + 0.0375) * 1280);
  });

  it("화면 가장자리의 알약은 영역을 화면 안으로 밀어 넣는다", () => {
    const region = zoomRegionAround([0.95, 0.9, 0.04, 0.06], 1280, 720)!;
    expect(region[0] + region[2]).toBeCloseTo(1);
    expect(region[1] + region[3]).toBeCloseTo(1);
  });

  it("이미 충분히 큰 알약은 확대하지 않는다", () => {
    expect(zoomRegionAround([0.3, 0.2, 0.3, 0.4], 1280, 720)).toBeNull();
  });

  it("화면 가운데 영역과 박스 좌표 변환", () => {
    const region = centerRegion(1280, 720);
    // 짧은 변(720)의 절반 = 360px 정사각형
    [0.359375, 0.25, 0.28125, 0.5].forEach((value, i) => expect(region[i]).toBeCloseTo(value));
    [0.4, 0.6, 0.1, 0.1].forEach((value, i) => expect(toFrameBox([0.5, 0.5, 0.25, 0.25], [0.2, 0.4, 0.4, 0.4])[i]).toBeCloseTo(value));
  });
});

describe("detectWithZoom", () => {
  const tylenol = { drugCode: "K-004378", confidence: 0.88, box: [0.4, 0.4, 0.05, 0.05] as const };
  const muspan = { drugCode: "K-005849", confidence: 0.7, box: [0.4, 0.4, 0.075, 0.1] as const };

  it("작은 알약은 확대해서 다시 보고, 한 알이 보이면 확대 결과를 쓴다", async () => {
    const { recognizer, detect } = fakeRecognizer([muspan], [tylenol]);
    const result = await detectWithZoom(recognizer, frame);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(result.detections).toEqual([tylenol]);
    expect(describeDetections(result, (code) => (code === tylenol.drugCode ? "타이레놀" : "무스판"))).toBe("전체 무스판 0.70 -> 확대 타이레놀 0.88");
  });

  it("아무것도 못 찾으면 화면 가운데를 확대해 본다", async () => {
    const { recognizer, detect } = fakeRecognizer([], [tylenol]);
    expect((await detectWithZoom(recognizer, frame)).detections).toEqual([tylenol]);
    expect(detect.mock.calls[1]![1]).toEqual(centerRegion(1280, 720));
  });

  it("여러 알이 보이거나 확대해도 한 알이 아니면 전체 결과를 쓴다", async () => {
    const two = fakeRecognizer([muspan, tylenol], [tylenol]);
    expect((await detectWithZoom(two.recognizer, frame)).detections).toHaveLength(2);
    expect(two.detect).toHaveBeenCalledTimes(1);

    const none = fakeRecognizer([muspan], []);
    expect((await detectWithZoom(none.recognizer, frame)).detections).toEqual([muspan]);
  });
});
