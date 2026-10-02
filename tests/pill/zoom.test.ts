import { describe, expect, it, vi } from "vitest";
import type { PillRecognizer } from "../../lib/pill/recognizer";
import type { PillDetection } from "../../lib/pill/verdict";
import { describeDetections, detectWithZoom, guideRegion, toFrameBox, zoomRegionAround } from "../../lib/pill/zoom";

const frame = { width: 640, height: 480 } as HTMLCanvasElement;

function fakeRecognizer(inGuide: PillDetection[], zoomed: PillDetection[]) {
  const guide = guideRegion(640, 480);
  const detect = vi.fn(async (_frame: unknown, region?: unknown) => (region === undefined || JSON.stringify(region) === JSON.stringify(guide) ? inGuide : zoomed));
  return { recognizer: { modelVersion: "test", detect, close: vi.fn() } as PillRecognizer, detect };
}

describe("가이드 네모와 확대 영역", () => {
  it("가이드 네모는 화면 가운데, 짧은 변의 60% 정사각형", () => {
    // 640x480 -> 한 변 288px
    [176 / 640, 96 / 480, 288 / 640, 288 / 480].forEach((value, i) => expect(guideRegion(640, 480)[i]).toBeCloseTo(value));
  });

  it("작은 알약 주변을 알약이 30%를 차지하도록 정사각형으로 자른다", () => {
    // 폭 48px(7.5%) 알약 -> 한 변 160px
    const region = zoomRegionAround([0.5, 0.5, 0.075, 0.05], 640, 480)!;
    expect(region[2] * 640).toBeCloseTo(160);
    expect(region[3] * 480).toBeCloseTo(160);
    expect((region[0] + region[2] / 2) * 640).toBeCloseTo((0.5 + 0.0375) * 640);
  });

  it("확대 영역은 가이드 네모 밖(얼굴 등)으로 나가지 않는다", () => {
    const guide = guideRegion(640, 480);
    const region = zoomRegionAround([0.68, 0.75, 0.04, 0.04], 640, 480, guide)!;
    expect(region[0] + region[2]).toBeCloseTo(guide[0] + guide[2]);
    expect(region[1] + region[3]).toBeCloseTo(guide[1] + guide[3]);
  });

  it("이미 충분히 큰 알약은 확대하지 않는다", () => {
    expect(zoomRegionAround([0.3, 0.2, 0.3, 0.4], 640, 480)).toBeNull();
  });

  it("영역 안 박스를 프레임 기준으로 바꾼다", () => {
    [0.4, 0.6, 0.1, 0.1].forEach((value, i) => expect(toFrameBox([0.5, 0.5, 0.25, 0.25], [0.2, 0.4, 0.4, 0.4])[i]).toBeCloseTo(value));
  });
});

describe("detectWithZoom", () => {
  const tylenol = { drugCode: "K-004378", confidence: 0.88, box: [0.45, 0.45, 0.05, 0.05] as const };
  const muspan = { drugCode: "K-005849", confidence: 0.7, box: [0.45, 0.45, 0.075, 0.05] as const };
  const weak = { drugCode: "K-003727", confidence: 0.45, box: [0.3, 0.3, 0.05, 0.05] as const };

  it("가이드 네모 안만 보고, 작은 알약은 확대해서 다시 본 결과를 쓴다", async () => {
    const { recognizer, detect } = fakeRecognizer([muspan], [tylenol]);
    const result = await detectWithZoom(recognizer, frame);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(detect.mock.calls[0]![1]).toEqual(guideRegion(640, 480));
    expect(result.detections).toEqual([tylenol]);
    expect(describeDetections(result, (code) => (code === tylenol.drugCode ? "타이레놀" : "무스판"))).toBe("네모 무스판 0.70 -> 확대 타이레놀 0.88");
  });

  it("옆의 약한 박스는 알약으로 세지 않으므로 확대가 켜진다", async () => {
    const { recognizer, detect } = fakeRecognizer([tylenol, weak], [tylenol]);
    expect((await detectWithZoom(recognizer, frame)).zoomed).toEqual([tylenol]);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("여러 알이 보이거나 확대해도 한 알이 아니면 네모 결과를 쓴다", async () => {
    const two = fakeRecognizer([muspan, tylenol], [tylenol]);
    expect((await detectWithZoom(two.recognizer, frame)).detections).toHaveLength(2);
    expect(two.detect).toHaveBeenCalledTimes(1);

    const none = fakeRecognizer([muspan], []);
    expect((await detectWithZoom(none.recognizer, frame)).detections).toEqual([muspan]);
  });
});
