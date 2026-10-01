import { describe, expect, it } from "vitest";
import { decodeYoloOutput, letterbox } from "../../lib/pill/yolo";

/** [1, 4 + 클래스 수, 후보 수] 모양의 가짜 출력. candidates: [cx, cy, w, h, ...클래스 점수] */
function fakeOutput(candidates: number[][]) {
  const channels = candidates[0]!.length;
  const count = candidates.length;
  const data = new Float32Array(channels * count);
  candidates.forEach((values, i) => values.forEach((value, c) => (data[c * count + i] = value)));
  return { data, dims: [1, channels, count] };
}

describe("letterbox", () => {
  it("가로로 긴 640x480 영상은 위아래에 여백이 생긴다", () => {
    expect(letterbox(640, 480, 640)).toEqual({ scale: 1, padX: 0, padY: 80, sourceWidth: 640, sourceHeight: 480 });
    expect(letterbox(1280, 960, 640).scale).toBe(0.5);
  });
});

describe("decodeYoloOutput", () => {
  const classes = ["A", "B", "C"];
  const box = letterbox(640, 480, 640); // 위아래 80px 여백

  it("점수가 가장 높은 클래스로 약을 고르고 원본 기준 정규화 박스로 돌려준다", () => {
    const { data, dims } = fakeOutput([[320, 320, 64, 48, 0.1, 0.9, 0.2]]);
    const [pill] = decodeYoloOutput(data, dims, classes, box);
    expect(pill?.drugCode).toBe("B");
    expect(pill?.confidence).toBeCloseTo(0.9, 5);
    // 중심 (320, 320-80=240), 크기 64x48 -> 원본 640x480 기준
    expect(pill?.box?.[0]).toBeCloseTo((320 - 32) / 640, 5);
    expect(pill?.box?.[1]).toBeCloseTo((240 - 24) / 480, 5);
    expect(pill?.box?.[2]).toBeCloseTo(64 / 640, 5);
    expect(pill?.box?.[3]).toBeCloseTo(48 / 480, 5);
  });

  it("점수가 낮은 후보는 버리고, 같은 알약에 겹친 박스는 하나만 남긴다", () => {
    const { data, dims } = fakeOutput([
      [320, 320, 60, 60, 0.8, 0.1, 0.1], // A
      [322, 321, 60, 60, 0.1, 0.7, 0.1], // 같은 위치 B (겹침 -> 제거)
      [100, 300, 40, 40, 0.1, 0.1, 0.6], // 떨어진 C
      [500, 300, 40, 40, 0.1, 0.1, 0.1], // 점수 낮음
    ]);
    const pills = decodeYoloOutput(data, dims, classes, box);
    expect(pills.map((pill) => pill.drugCode)).toEqual(["A", "C"]);
  });

  it("모델 클래스 수와 manifest가 다르면 오류", () => {
    const { data, dims } = fakeOutput([[320, 320, 60, 60, 0.8, 0.1]]);
    expect(() => decodeYoloOutput(data, dims, classes, box)).toThrow(/클래스 수/);
  });
});
