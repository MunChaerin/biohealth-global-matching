// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/medication/route";
import { clearMedicationIntakes, dateKey, type TodayMedication } from "../../lib/medication/intakeStore";

const patientId = "tanaka-haruko";

function recognition(status: string, medicationCode: string | null, extra: Record<string, unknown> = {}) {
  return {
    patientId,
    medicationCode,
    expectedMedicationCode: "K-045037",
    confidence: 0.91,
    status,
    modelVersion: "pill-yolo11n-10cls-v1",
    measuredAt: "2026-10-01T23:05:00.000Z",
    ...extra,
  };
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/medication", { method: "POST", body: JSON.stringify(body) }));
}

async function today(id = patientId) {
  const response = await GET(new Request(`http://localhost/api/medication?patientId=${id}`));
  return { status: response.status, body: (await response.json()) as TodayMedication };
}

describe("/api/medication", () => {
  beforeEach(() => clearMedicationIntakes());

  it("오늘 복약 목록을 시간순으로, 처음엔 모두 미복용으로 돌려준다", async () => {
    const { body } = await today();
    expect(body.items.map((item) => item.time)).toEqual(["08:00", "08:00", "18:00", "18:00"]);
    expect(body.items.every((item) => item.status === "pending" && item.mismatchCount === 0)).toBe(true);
    expect(body.next?.id).toBe("tanaka-lyribea-am");
    expect(body.nextGroup.map((item) => item.id)).toEqual(["tanaka-lyribea-am", "tanaka-tylenol-am"]);
  });

  it("먹었어요를 기록하면 복용으로 바뀌고 다음 약으로 넘어간다", async () => {
    const response = await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken" });
    expect(response.status).toBe(200);
    const { body } = await today();
    const taken = body.items.find((item) => item.id === "tanaka-lyribea-am");
    expect(taken?.status).toBe("taken");
    expect(taken?.takenAt).toEqual(expect.any(String));
    expect(taken?.method).toBe("camera"); // method를 안 보내면 카메라 확인
    expect(body.next?.id).toBe("tanaka-tylenol-am");
    expect(body.nextGroup.map((item) => item.id)).toEqual(["tanaka-tylenol-am"]); // 아침에 남은 약
  });

  it("두 번 눌러도 처음 복용 시각을 유지한다", async () => {
    await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken" });
    const first = (await today()).body.items[0]?.takenAt;
    await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken" });
    expect((await today()).body.items[0]?.takenAt).toBe(first);
  });

  it("인식이 안 될 때 직접 기록하면 method가 manual로 남는다", async () => {
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken", method: "manual" })).status).toBe(200);
    const item = (await today()).body.items[0];
    expect(item?.status).toBe("taken");
    expect(item?.method).toBe("manual");
  });

  it("인식 결과(PillRecognitionResult)를 받아 다른 약을 비춘 횟수와 마지막 결과를 기록한다", async () => {
    await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition", result: recognition("mismatched", "K-004378") });
    await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition", result: recognition("unknown", null, { confidence: null }) });
    await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition", result: recognition("mismatched", "K-005849") });
    const item = (await today()).body.items[0];
    expect(item?.mismatchCount).toBe(2); // unknown은 세지 않음
    expect(item?.lastMismatch?.detectedDrugCode).toBe("K-005849");
    expect(item?.lastRecognition?.status).toBe("mismatched");
    expect(item?.status).toBe("pending"); // 인식 결과만으로는 복용 처리하지 않음
  });

  it("인식 결과에 정해진 필드 외의 값(예: 사진)이 있으면 거부한다", async () => {
    const withImage = recognition("matched", "K-045037", { image: "data:image/jpeg;base64,AAAA" });
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition", result: withImage })).status).toBe(400);
    const otherPatient = recognition("matched", "K-045037", { patientId: "kim-minsu" });
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition", result: otherPatient })).status).toBe(400);
  });

  it("잘못된 요청은 거부한다", async () => {
    expect((await post({ patientId, medicationId: "kim-zolpidem-night", event: "taken" })).status).toBe(400); // 다른 환자의 약
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "eaten" })).status).toBe(400);
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "recognition" })).status).toBe(400);
    expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken", method: "guess" })).status).toBe(400);
    expect((await post({ patientId: "someone", medicationId: "x", event: "taken" })).status).toBe(403);
    expect((await today("someone")).status).toBe(403);
    const badJson = await POST(new Request("http://localhost/api/medication", { method: "POST", body: "{" }));
    expect(badJson.status).toBe(400);
  });

  it("날짜가 바뀌면 새로 시작한다 (한국·일본 시간 기준)", () => {
    expect(dateKey(new Date("2026-10-01T14:59:00Z"))).toBe("2026-10-01");
    expect(dateKey(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-02");
  });

  describe("배포(production) 환경", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("CAMERA_DEMO_MODE가 없으면 막는다", async () => {
      vi.stubEnv("NODE_ENV", "production");
      expect((await today()).status).toBe(404);
      expect((await post({ patientId, medicationId: "tanaka-lyribea-am", event: "taken" })).status).toBe(404);
    });
  });
});
