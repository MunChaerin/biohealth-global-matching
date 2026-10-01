import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FacialObservation } from "../../components/clinician/FacialObservation";
import type { CameraReport } from "../../lib/camera/report";

function respond(report: (CameraReport & { receivedAt: string }) | null) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ report })));
}

const base = { patientId: "demo-patient-01", measuredAt: new Date().toISOString() };

describe("FacialObservation", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("보고가 없으면 연결 없음 안내", async () => {
    respond(null);
    render(<FacialObservation />);
    expect(await screen.findByText("연결 없음")).toBeInTheDocument();
    expect(screen.getByText("환자 화면에서 카메라가 켜지면 표정 관찰 결과가 표시됩니다.")).toBeInTheDocument();
  });

  it("측정 중이면 현재 상태와 최근 비율을 보여준다", async () => {
    respond({
      ...base,
      receivedAt: new Date().toISOString(),
      status: "measuring",
      current: { dominant: "pain", state: "awake" },
      trend: { windowMinutes: 10, sampleCount: 100, dominantRatio: { calm: 0.7, pain: 0.2, none: 0.1 }, sleepingRatio: 0, flatExpressionFlag: false },
    });
    render(<FacialObservation />);
    expect(await screen.findByText("측정 중")).toBeInTheDocument();
    expect(screen.getByText("통증 표정", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("최근 10분")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.queryByText(/표정 변화가 거의 없어요/)).not.toBeInTheDocument();
  });

  it("저활성 표정이면 교차검증 안내를 보여준다", async () => {
    respond({
      ...base,
      receivedAt: new Date().toISOString(),
      status: "measuring",
      current: { dominant: "none", state: "awake" },
      trend: { windowMinutes: 10, sampleCount: 100, dominantRatio: { none: 1 }, sleepingRatio: 0, flatExpressionFlag: true },
    });
    render(<FacialObservation />);
    expect(await screen.findByText(/표정 변화가 거의 없어요/)).toBeInTheDocument();
  });

  it("권한이 꺼져 있으면 판정 없이 상태만 보여준다", async () => {
    respond({ ...base, receivedAt: new Date().toISOString(), status: "permissionDenied" });
    render(<FacialObservation />);
    expect(await screen.findByText("카메라 권한 꺼짐")).toBeInTheDocument();
    expect(screen.queryByText(/^지금/)).not.toBeInTheDocument();
  });

  it("환자가 카메라를 끄면 판정 없이 그 상태만 보여준다", async () => {
    respond({ ...base, receivedAt: new Date().toISOString(), status: "off" });
    render(<FacialObservation />);
    expect(await screen.findByText("환자가 카메라를 끔")).toBeInTheDocument();
    expect(screen.queryByText(/^지금/)).not.toBeInTheDocument();
  });

  it("30초 넘게 소식이 없으면 연결 끊김으로 보고 현재 상태를 숨긴다", async () => {
    respond({
      ...base,
      receivedAt: new Date(Date.now() - 60_000).toISOString(),
      status: "measuring",
      current: { dominant: "calm", state: "awake" },
      trend: { windowMinutes: 10, sampleCount: 100, dominantRatio: { calm: 1 }, sleepingRatio: 0, flatExpressionFlag: false },
    });
    render(<FacialObservation />);
    expect(await screen.findByText("연결 끊김")).toBeInTheDocument();
    expect(screen.getByText("마지막 기록")).toBeInTheDocument();
    expect(screen.queryByText("평온", { selector: "strong" })).not.toBeInTheDocument();
  });
});
