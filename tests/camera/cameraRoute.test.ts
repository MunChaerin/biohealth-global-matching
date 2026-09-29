// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
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
});
