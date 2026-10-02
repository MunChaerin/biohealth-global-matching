import { describe, expect, it } from "vitest";
import { toRecognitionStatus, validateRecognitionResult } from "../../lib/pill/result";

const valid = {
  patientId: "tanaka-haruko",
  medicationCode: "K-045037",
  expectedMedicationCode: "K-045037",
  confidence: 0.93,
  status: "matched",
  modelVersion: "pill-yolo11n-10cls-v1",
  measuredAt: "2026-10-01T23:05:00.000Z",
};

describe("toRecognitionStatus", () => {
  it("화면 판정을 팀 규격 상태 이름으로 바꾼다", () => {
    expect(toRecognitionStatus("loading", { kind: "noPill" })).toBe("modelLoading");
    expect(toRecognitionStatus("error", { kind: "noPill" })).toBe("modelError");
    expect(toRecognitionStatus("notReady", { kind: "noPill" })).toBe("modelError");
    expect(toRecognitionStatus("running", { kind: "match", drugCode: "K-045037" })).toBe("matched");
    expect(toRecognitionStatus("running", { kind: "mismatch", drugCode: "K-005849" })).toBe("mismatched");
    expect(toRecognitionStatus("running", { kind: "noPill" })).toBe("noPill");
    expect(toRecognitionStatus("running", { kind: "unsure" })).toBe("unknown");
    expect(toRecognitionStatus("running", { kind: "multiple" })).toBe("unknown");
  });
});

describe("validateRecognitionResult", () => {
  it("규격에 맞는 결과는 통과하고, 모르는 약은 코드·확신도를 null로 보낼 수 있다", () => {
    expect(() => validateRecognitionResult(valid)).not.toThrow();
    expect(() => validateRecognitionResult({ ...valid, status: "unknown", medicationCode: null, confidence: null })).not.toThrow();
  });

  it("빠진 값, 잘못된 값, 정해지지 않은 필드(사진 등)는 거부한다", () => {
    expect(() => validateRecognitionResult(null)).toThrow();
    expect(() => validateRecognitionResult({ ...valid, status: "modelError" })).toThrow(/status/);
    expect(() => validateRecognitionResult({ ...valid, confidence: 1.5 })).toThrow(/confidence/);
    expect(() => validateRecognitionResult({ ...valid, measuredAt: "어제" })).toThrow(/measuredAt/);
    expect(() => validateRecognitionResult({ ...valid, modelVersion: "" })).toThrow(/modelVersion/);
    expect(() => validateRecognitionResult({ ...valid, image: "data:image/jpeg;base64,AAAA" })).toThrow(/image/);
  });
});
