import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })), close: vi.fn() };
const createFromOptions = vi.fn(async () => landmarker);

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...(args as [])) },
}));

import { CAMERA_CONSENT_KEY, CameraIndicator } from "../../components/patient/CameraIndicator";

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function mockCamera(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
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
    landmarker.close.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  describe("동의 전", () => {
    it("안내와 켜기 버튼만 보여주고 카메라는 켜지 않는다", async () => {
      const getUserMedia = vi.fn();
      mockCamera(getUserMedia);
      render(<CameraIndicator />);
      expect(await screen.findByText("표정 관찰 카메라를 켤까요?")).toBeInTheDocument();
      expect(screen.getByText(/영상은 저장하거나 보내지 않아요/)).toBeInTheDocument();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("켜기를 누르면 카메라를 켜고 동의를 기억한다", async () => {
      const { stream } = fakeStream();
      const getUserMedia = vi.fn().mockResolvedValue(stream);
      mockCamera(getUserMedia);
      render(<CameraIndicator />);
      fireEvent.click(await screen.findByRole("button", { name: "카메라 켜기" }));
      expect(await screen.findByText("표정 관찰 카메라 작동 중")).toBeInTheDocument();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(CAMERA_CONSENT_KEY)).toBe("on");
    });
  });

  describe("동의 후", () => {
    beforeEach(() => window.localStorage.setItem(CAMERA_CONSENT_KEY, "on"));

    it("카메라 기능이 없는 환경에서는 켜지 않고 보고도 하지 않는다", async () => {
      render(<CameraIndicator />);
      expect(await screen.findByText("카메라를 사용할 수 없어 표정 관찰을 하지 않아요")).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("카메라 권한을 거부하면 안내하고 의료진 화면에 상태만 보낸다", async () => {
      mockCamera(vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
      render(<CameraIndicator />);
      expect(await screen.findByText("카메라 권한이 꺼져 있어 표정 관찰을 하지 않아요")).toBeInTheDocument();
      await waitFor(() => expect(postedReports()).toHaveLength(1));
      expect(postedReports()[0]).toMatchObject({ status: "permissionDenied" });
      expect(postedReports()[0].current).toBeUndefined();
    });

    it("모델을 못 불러오면 카메라를 끄고 unavailable로 보고한다", async () => {
      const { stream, track } = fakeStream();
      mockCamera(vi.fn().mockResolvedValue(stream));
      createFromOptions.mockRejectedValue(new Error("model download failed"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      render(<CameraIndicator />);
      expect(await screen.findByText("카메라를 사용할 수 없어 표정 관찰을 하지 않아요")).toBeInTheDocument();
      expect(track.stop).toHaveBeenCalled();
      expect(postedReports()[0]).toMatchObject({ status: "unavailable" });
    });

    it("페이지를 열면 바로 켜지고, 화면을 닫으면 카메라와 모델을 정리한다", async () => {
      const { stream, track } = fakeStream();
      mockCamera(vi.fn().mockResolvedValue(stream));

      const { unmount } = render(<CameraIndicator />);
      expect(await screen.findByText("표정 관찰 카메라 작동 중")).toBeInTheDocument();
      expect(screen.getByText("평소 표정으로 잠시 계셔 주세요")).toBeInTheDocument();
      expect(screen.getByLabelText("표정 관찰 카메라 미리보기")).toBeInTheDocument();
      expect(postedReports()[0]).toMatchObject({ status: "calibrating" });

      unmount();
      expect(track.stop).toHaveBeenCalled();
      expect(landmarker.close).toHaveBeenCalled();
    });

    it("끄기를 누르면 카메라·분석을 멈추고 '끔' 상태만 한 번 알린다", async () => {
      const { stream, track } = fakeStream();
      mockCamera(vi.fn().mockResolvedValue(stream));
      render(<CameraIndicator />);
      fireEvent.click(await screen.findByRole("button", { name: "끄기" }));

      expect(await screen.findByText("표정 관찰 카메라가 꺼져 있어요")).toBeInTheDocument();
      expect(track.stop).toHaveBeenCalled();
      expect(landmarker.close).toHaveBeenCalled();
      expect(window.localStorage.getItem(CAMERA_CONSENT_KEY)).toBe("off");
      const reports = postedReports();
      expect(reports.at(-1)).toMatchObject({ status: "off" });
      expect(reports.at(-1).current).toBeUndefined();
    });
  });

  it("끈 상태를 기억해서 다시 열어도 켜지 않는다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "off");
    const getUserMedia = vi.fn();
    mockCamera(getUserMedia);
    render(<CameraIndicator />);
    expect(await screen.findByRole("button", { name: "다시 켜기" })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
