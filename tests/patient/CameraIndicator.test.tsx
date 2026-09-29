import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })), close: vi.fn() };
const createFromOptions = vi.fn(async () => landmarker);

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...(args as [])) },
}));

import { CameraIndicator } from "../../components/patient/CameraIndicator";

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function postedReports() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === "/api/camera")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("CameraIndicator", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    createFromOptions.mockImplementation(async () => landmarker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  it("카메라 기능이 없는 환경에서는 켜지 않고 보고도 하지 않는다", async () => {
    render(<CameraIndicator />);
    expect(await screen.findByText("카메라를 사용할 수 없어 표정 관찰을 하지 않아요")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("카메라 권한을 거부하면 안내하고 의료진 화면에 상태만 보낸다", async () => {
    const error = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockRejectedValue(error) },
      configurable: true,
    });
    render(<CameraIndicator />);
    expect(await screen.findByText("카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요")).toBeInTheDocument();
    await waitFor(() => expect(postedReports()).toHaveLength(1));
    expect(postedReports()[0]).toMatchObject({ status: "permissionDenied" });
    expect(postedReports()[0].current).toBeUndefined();
  });

  it("모델을 못 불러오면 카메라를 끄고 unavailable로 보고한다", async () => {
    const { stream, track } = fakeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    createFromOptions.mockRejectedValue(new Error("model download failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<CameraIndicator />);
    expect(await screen.findByText("카메라를 사용할 수 없어 표정 관찰을 하지 않아요")).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
    expect(postedReports()[0]).toMatchObject({ status: "unavailable" });
  });

  it("카메라가 켜지면 작동 중 표시, 화면을 닫으면 카메라와 모델을 정리한다", async () => {
    const { stream, track } = fakeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });

    const { unmount } = render(<CameraIndicator />);
    expect(await screen.findByText("표정 관찰 카메라 작동 중")).toBeInTheDocument();
    expect(postedReports()[0]).toMatchObject({ status: "calibrating" });

    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(landmarker.close).toHaveBeenCalled();
  });
});
