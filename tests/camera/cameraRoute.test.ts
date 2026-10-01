// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/camera/route";
import { DEMO_PATIENT_ID, type CameraReport } from "../../lib/camera/report";
import { clearCameraReports } from "../../lib/camera/reportStore";

function post(body: unknown) {
  return POST(new Request("http://localhost/api/camera", { method: "POST", body: JSON.stringify(body) }));
}

async function latest(patientId = DEMO_PATIENT_ID) {
  const response = await GET(new Request(`http://localhost/api/camera?patientId=${patientId}`));
  return (await response.json()) as { report: (CameraReport & { receivedAt: string }) | null };
}

const measuring: CameraReport = {
  patientId: DEMO_PATIENT_ID,
  measuredAt: "2026-09-29T08:00:00.000Z",
  status: "measuring",
  current: { dominant: "calm", state: "awake" },
  trend: {
    windowMinutes: 10,
    sampleCount: 120,
    dominantRatio: { calm: 0.7, pain: 0.2, none: 0.1 },
    sleepingRatio: 0,
    flatExpressionFlag: false,
  },
};

describe("/api/camera", () => {
  beforeEach(() => clearCameraReports());

  it("보고가 없으면 null", async () => {
    expect((await latest()).report).toBeNull();
  });

  it("판정 결과를 저장하고 최신 값을 돌려준다", async () => {
    expect((await post(measuring)).status).toBe(200);
    await post({ ...measuring, current: { dominant: "pain", state: "awake" } });
    const { report } = await latest();
    expect(report?.current?.dominant).toBe("pain");
    expect(report?.trend?.dominantRatio.calm).toBe(0.7);
    expect(report?.receivedAt).toEqual(expect.any(String));
  });

  it("측정 중이 아닐 때 판정 결과를 같이 보내면 거부한다 (임의 값 생성 방지)", async () => {
    const response = await post({ ...measuring, status: "noFace" });
    expect(response.status).toBe(400);
  });

  it("카메라 권한 거부 상태는 판정 없이 저장된다", async () => {
    await post({ patientId: DEMO_PATIENT_ID, measuredAt: measuring.measuredAt, status: "permissionDenied" });
    const { report } = await latest();
    expect(report?.status).toBe("permissionDenied");
    expect(report?.current).toBeUndefined();
  });

  it("형식이 잘못된 값은 거부한다", async () => {
    expect((await post({ ...measuring, status: "unknown" })).status).toBe(400);
    expect((await post({ ...measuring, trend: { ...measuring.trend, dominantRatio: { pain: 3 } } })).status).toBe(400);
    expect((await post({ ...measuring, measuredAt: "어제" })).status).toBe(400);
    const badJson = await POST(new Request("http://localhost/api/camera", { method: "POST", body: "{" }));
    expect(badJson.status).toBe(400);
  });

  it("patientId 없이 조회하면 400", async () => {
    const response = await GET(new Request("http://localhost/api/camera"));
    expect(response.status).toBe(400);
  });

  it("데모 환자가 아니면 조회도 저장도 거부한다", async () => {
    expect((await latest("other-patient")).report).toBeUndefined();
    const getResponse = await GET(new Request("http://localhost/api/camera?patientId=other-patient"));
    expect(getResponse.status).toBe(403);
    expect((await post({ ...measuring, patientId: "other-patient" })).status).toBe(403);
  });

  it("늦게 도착한 더 오래된 측정은 최신 값을 덮어쓰지 않는다 (예: 끈 뒤에 도착한 측정)", async () => {
    await post({ patientId: DEMO_PATIENT_ID, measuredAt: "2026-09-29T08:00:10.000Z", status: "off" });
    await post({ ...measuring, measuredAt: "2026-09-29T08:00:05.000Z" });
    expect((await latest()).report?.status).toBe("off");
  });

  describe("배포(production) 환경", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("CAMERA_DEMO_MODE가 없으면 API를 막는다", async () => {
      vi.stubEnv("NODE_ENV", "production");
      expect((await post(measuring)).status).toBe(404);
      const response = await GET(new Request(`http://localhost/api/camera?patientId=${DEMO_PATIENT_ID}`));
      expect(response.status).toBe(404);
    });

    it("CAMERA_DEMO_MODE=true면 데모 환자만 허용한다", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CAMERA_DEMO_MODE", "true");
      expect((await post(measuring)).status).toBe(200);
      expect((await latest()).report?.status).toBe("measuring");
    });
  });
});
