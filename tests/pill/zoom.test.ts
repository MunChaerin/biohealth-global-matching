import { describe, expect, it, vi } from "vitest";
import type { PillRecognizer } from "../../lib/pill/recognizer";
import type { PillDetection } from "../../lib/pill/verdict";
import { describeDetections, detectWithZoom, distanceHint, guideRegion, pillSizeInGuide, toFrameBox, zoomOutRegion, zoomRegionAround } from "../../lib/pill/zoom";

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

  it("작은 알약 주변을 알약이 20%를 차지하도록 정사각형으로 자른다", () => {
    // 폭 48px(7.5%) 알약 -> 한 변 240px
    const region = zoomRegionAround([0.5, 0.5, 0.075, 0.05], 640, 480)!;
    expect(region[2] * 640).toBeCloseTo(240);
    expect(region[3] * 480).toBeCloseTo(240);
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

  it("가이드 네모 안만 보고, 작은 알약은 확대해서 다시 본 결과를 쓴다 (네모에서 애매했으면 다른 약으로 바뀌어도 됨)", async () => {
    const vague = { ...muspan, confidence: 0.5 };
    const { recognizer, detect } = fakeRecognizer([vague], [tylenol]);
    const result = await detectWithZoom(recognizer, frame);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(detect.mock.calls[0]![1]).toEqual(guideRegion(640, 480));
    expect(result.detections).toEqual([tylenol]);
    expect(describeDetections(result, (code) => (code === tylenol.drugCode ? "타이레놀" : "무스판"))).toBe("네모 무스판 0.50 [크기 17%] -> 확대 타이레놀 0.88");
  });

  it("네모에서 확실히(0.6 이상) 본 약이 확대에서 다른 약으로 바뀌면 쓰지 않는다 (리리베아 -> 타이레놀 착각 방지)", async () => {
    const lyribea = { drugCode: "K-045037", confidence: 0.7, box: [0.45, 0.45, 0.075, 0.05] as const };
    const { recognizer } = fakeRecognizer([lyribea], [{ ...tylenol, confidence: 0.9 }]);
    expect((await detectWithZoom(recognizer, frame)).detections).toEqual([lyribea]);
  });

  it("로그에 2등 클래스와 점수도 같이 남긴다", () => {
    const withSecond = { ...tylenol, second: { drugCode: "K-045037", confidence: 0.61 } };
    const text = describeDetections({ detections: [withSecond], guide: [withSecond], zoomed: null, size: 0.5 }, (code) => (code === "K-045037" ? "리리베아" : "타이레놀"));
    expect(text).toBe("네모 타이레놀 0.88 (2등 리리베아 0.61) [크기 50%]");
  });

  it("가까이 대서 너무 크게 보이면 더 넓게 잘라(축소) 다시 본다", async () => {
    // 640x480, 네모 한 변 288px. 알약 긴 변 160px = 네모의 56% -> 축소 (한 변 160/0.3 = 533 -> 프레임 짧은 변 480으로 제한)
    const big = { drugCode: "K-045037", confidence: 0.5, box: [0.375, 0.4, 0.25, 0.2] as const };
    expect(pillSizeInGuide(big.box, 640, 480)).toBeCloseTo(160 / 288);
    const region = zoomOutRegion(big.box, 640, 480)!;
    expect(region[2] * 640).toBeCloseTo(480);
    const lyribea = { ...big, confidence: 0.85 };
    const { recognizer, detect } = fakeRecognizer([big], [lyribea]);
    const result = await detectWithZoom(recognizer, frame);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(result.zoomKind).toBe("out");
    expect(result.detections).toEqual([lyribea]);
    expect(describeDetections(result, () => "리리베아")).toBe("네모 리리베아 0.50 [크기 56%] -> 축소 리리베아 0.85");
  });

  it("알약이 네모의 27%~45%면 확대도 축소도 하지 않는다", async () => {
    const mid = { drugCode: "K-045037", confidence: 0.8, box: [0.4, 0.4, 0.15, 0.1] as const }; // 96px = 33%
    const { recognizer, detect } = fakeRecognizer([mid], []);
    expect((await detectWithZoom(recognizer, frame)).zoomed).toBeNull();
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("거리 안내: 네모의 60% 이상이면 너무 가깝고, 10% 미만이면 너무 멀다", () => {
    expect(distanceHint(0.65)).toBe("tooClose");
    expect(distanceHint(0.08)).toBe("tooFar");
    expect(distanceHint(0.3)).toBeNull();
    expect(distanceHint(null)).toBeNull();
  });

  it("옆의 약한 박스는 알약으로 세지 않으므로 확대가 켜진다", async () => {
    const { recognizer, detect } = fakeRecognizer([tylenol, weak], [tylenol]);
    expect((await detectWithZoom(recognizer, frame)).zoomed).toEqual([tylenol]);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("확대 결과가 다른 약이면서 더 약하면 쓰지 않는다 (맞는 답이 뒤집히는 것 방지)", async () => {
    const lyribea = { drugCode: "K-045037", confidence: 0.78, box: [0.45, 0.45, 0.05, 0.05] as const };
    const weakMuspan = { ...muspan, confidence: 0.62 };
    const { recognizer } = fakeRecognizer([lyribea], [weakMuspan]);
    expect((await detectWithZoom(recognizer, frame)).detections).toEqual([lyribea]);

    const sameDrug = fakeRecognizer([lyribea], [{ ...lyribea, confidence: 0.7 }]);
    expect((await detectWithZoom(sameDrug.recognizer, frame)).detections[0]!.confidence).toBe(0.7); // 같은 약이면 확대 쪽(정확한 박스)
  });

  it("여러 알이 보이거나 확대해도 한 알이 아니면 네모 결과를 쓴다", async () => {
    const two = fakeRecognizer([muspan, tylenol], [tylenol]);
    expect((await detectWithZoom(two.recognizer, frame)).detections).toHaveLength(2);
    expect(two.detect).toHaveBeenCalledTimes(1);

    const none = fakeRecognizer([muspan], []);
    expect((await detectWithZoom(none.recognizer, frame)).detections).toEqual([muspan]);
  });
});
