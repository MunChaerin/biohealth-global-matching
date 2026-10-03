import { describe, expect, it } from "vitest";
import { DOKRIP, LYRIBEA, TYLENOL, classifyImprintText, prepareImprint, rotate180, type GrayImage } from "../../lib/pill/capsuleOcr";

describe("classifyImprintText", () => {
  it("각인 조각으로 리리베아 / 독립목클린을 정한다 (거꾸로 읽힌 모양 포함)", () => {
    expect(classifyImprintText(["OB PGN", ""])).toBe(LYRIBEA);
    expect(classifyImprintText(["I84 8MQ", "NN"])).toBe(LYRIBEA); // DWB가 거꾸로 읽힘
    expect(classifyImprintText(["OLB ACC", "O0V 810"])).toBe(DOKRIP);
    expect(classifyImprintText(["TYLENOL", ""])).toBe(TYLENOL);
  });

  it("'50'만으로는 리리베아로 정하지 않는다 (타이레놀 500을 50으로 잘못 읽는 경우)", () => {
    expect(classifyImprintText(["50", ""])).toBeNull();
    expect(classifyImprintText(["TYLENOL", "DWB"])).toBeNull(); // 두 약이 같이 보이면 못 정함
  });

  it("아무것도 없거나 둘 다 보이면 못 정한다 (사람이 확인)", () => {
    expect(classifyImprintText(["", "NN 4"])).toBeNull();
    expect(classifyImprintText(["PGN ACC"])).toBeNull();
    expect(classifyImprintText([])).toBeNull();
  });
});

/** 어두운 바탕에 기울어진 흰 캡슐 + 가운데 검은 글씨 막대 */
function tiltedCapsule(): GrayImage {
  const width = 200;
  const height = 160;
  const data = new Uint8Array(width * height).fill(20);
  const angle = (25 * Math.PI) / 180;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const u = dx * Math.cos(angle) + dy * Math.sin(angle); // 긴 축
      const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if ((u / 80) ** 2 + (v / 28) ** 2 <= 1) data[y * width + x] = 230;
      if (Math.abs(u) < 30 && Math.abs(v) < 6) data[y * width + x] = 40; // 글씨
    }
  }
  return { data, width, height };
}

describe("prepareImprint", () => {
  it("기울어진 캡슐을 수평으로 돌려 폭 800의 흑백 사진으로 만들고, 글씨는 검정으로 남긴다", () => {
    const out = prepareImprint(tiltedCapsule())!;
    expect(out.width).toBe(800);
    expect(out.height).toBeLessThan(out.width / 2); // 수평으로 길쭉함
    expect(new Set(out.data)).toEqual(new Set([0, 255]));
    // 가운데 줄에 글씨(검정)가 있다
    const middle = out.data.slice(Math.floor(out.height / 2) * out.width, Math.floor(out.height / 2 + 1) * out.width);
    expect(middle.filter((value) => value === 0).length).toBeGreaterThan(50);
  });

  it("캡슐이 없으면(전부 같은 밝기) null, 180도 돌리기", () => {
    expect(prepareImprint({ data: new Uint8Array(100).fill(128), width: 10, height: 10 })).toBeNull();
    expect(Array.from(rotate180({ data: Uint8Array.from([1, 2, 3, 4]), width: 2, height: 2 }).data)).toEqual([4, 3, 2, 1]);
  });
});
