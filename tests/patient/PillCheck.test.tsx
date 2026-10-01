import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })), close: vi.fn() };
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => landmarker) },
}));

import { CAMERA_CONSENT_KEY, CameraIndicator } from "../../components/patient/CameraIndicator";
import { getMedicationSchedule } from "../../lib/medication/schedule";

const medication = getMedicationSchedule("tanaka-haruko")[0]!; // 리리베아캡슐 50mg

function mockCamera() {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { getUserMedia, track };
}

function medicationPosts() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => url === "/api/medication" && (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

/** 개발용 인식기로 약을 보여주고, 판정에 필요한 1초가 지나도록 시간을 넘긴다. */
async function showPill(button: string) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

describe("알약 확인 모드", () => {
  let clock = 0;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("manifest") ? new Response("", { status: 404 }) : new Response("{}"))));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    // jsdom에는 실제 영상이 없으므로 영상이 준비된 것처럼 만든다
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
    // 판정은 같은 약이 1초 이어져야 하므로, 호출할 때마다 0.5초씩 흐르게 한다
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 500));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  function renderPillCheck(onTaken = vi.fn(), onClose = vi.fn()) {
    render(
      <CameraIndicator
        patientId="tanaka-haruko"
        pillCheck={{ medication, debug: true, onClose, onTaken }}
      />,
    );
    return { onTaken, onClose };
  }

  it("맞는 약이면 [먹었어요]를 눌러야 복용으로 기록한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    const { onTaken } = renderPillCheck();
    expect(screen.getByText("리리베아캡슐 50mg 1캡슐")).toBeInTheDocument();
    await screen.findByRole("button", { name: "맞는 약" });

    await showPill("맞는 약");
    expect(await screen.findByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
    expect(medicationPosts()).toHaveLength(0); // 비추기만으로는 기록하지 않음

    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(await screen.findByText("복용을 기록했어요.")).toBeInTheDocument();
    expect(medicationPosts()).toEqual([{ patientId: "tanaka-haruko", medicationId: medication.id, event: "taken" }]);
    expect(onTaken).toHaveBeenCalled();
  });

  it("다른 약이면 안내하고, 같은 약을 계속 비춰도 의료진 기록은 한 번만 남긴다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    renderPillCheck();
    await screen.findByRole("button", { name: "다른 약" });

    await showPill("다른 약");
    expect(await screen.findByText(/지금 드실 약이 아니에요. 리리베아캡슐 50mg\(흰색 길쭉한 캡슐 \(DWB PGN50\)\)을 비춰 주세요/)).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const mismatches = medicationPosts();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ event: "mismatch", detectedDrugCode: "pending:other" });
    expect(screen.queryByRole("button", { name: "먹었어요" })).not.toBeInTheDocument();
  });

  it("여러 알이나 애매한 약이면 다시 비춰 달라고 한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    renderPillCheck();
    await screen.findByRole("button", { name: "여러 알" });
    await showPill("여러 알");
    expect(await screen.findByText("한 번에 한 알씩 비춰 주세요.")).toBeInTheDocument();
    await showPill("애매함");
    expect(await screen.findByText(/잘 모르겠어요/)).toBeInTheDocument();
  });

  it("표정 카메라에 동의하지 않았으면 이번 확인에만 카메라를 쓸지 먼저 묻는다", async () => {
    const { getUserMedia } = mockCamera();
    renderPillCheck();
    expect(screen.getByText(/이번 확인에만 쓰고/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "카메라 켜고 확인하기" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "맞는 약" });
    // 표정 관찰에 동의하지 않았으므로 표정 결과는 보내지 않는다
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/camera")).toBe(false);
  });

  it("학습한 모델이 아직 없으면 준비 전이라고 안내한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medication, onClose: vi.fn(), onTaken: vi.fn() }} />);
    expect(await screen.findByText(/모델이 아직 준비되지 않았어요/)).toBeInTheDocument();
  });

  it("그만하기를 누르면 닫는다", () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    const { onClose } = renderPillCheck();
    fireEvent.click(screen.getByRole("button", { name: "그만하기" }));
    expect(onClose).toHaveBeenCalled();
  });
});
