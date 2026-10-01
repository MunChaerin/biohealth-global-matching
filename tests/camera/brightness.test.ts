import { describe, expect, it } from "vitest";
import { applyGamma, frameBrightness, gammaFor, previewBrightness, MIN_GAMMA } from "../../lib/camera/brightness";

function solidFrame(value: number, pixels = 16): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
  return data;
}

describe("brightness", () => {
  it("평균 밝기를 잰다", () => {
    expect(frameBrightness(solidFrame(40), 1)).toBeCloseTo(40, 5);
  });

  it("충분히 밝으면 보정하지 않는다", () => {
    expect(gammaFor(120)).toBe(1);
    expect(previewBrightness(120)).toBe(1);
  });

  it("어두우면 목표 밝기(110)에 가깝게 감마 보정한다 (Python brighten과 같은 식)", () => {
    const gamma = gammaFor(45);
    expect(gamma).toBeCloseTo(Math.log(110 / 255) / Math.log(45 / 255), 10);
    const data = solidFrame(45, 4);
    applyGamma(data, gamma);
    expect(frameBrightness(data, 1)).toBeCloseTo(110, -1);
    expect(data[3]).toBe(255); // 알파는 그대로
  });

  it("아주 어두운 영상은 과하게 밝히지 않는다", () => {
    expect(gammaFor(3)).toBe(MIN_GAMMA);
    expect(previewBrightness(3)).toBe(2.5);
    expect(gammaFor(0)).toBe(1); // 완전히 까만 화면(카메라 가림 등)은 보정 안 함
  });
});
