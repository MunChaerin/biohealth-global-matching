import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })), close: vi.fn() };
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => landmarker) },
}));

import { CAMERA_CONSENT_KEY, CameraIndicator } from "../../components/patient/CameraIndicator";
import { getMedicationSchedule } from "../../lib/medication/schedule";

// 아침 08:00: 리리베아캡슐 50mg + 타이레놀정 500mg
const morning = getMedicationSchedule("tanaka-haruko").filter((item) => item.time === "08:00");
const [lyribea, tylenol] = morning as [(typeof morning)[number], (typeof morning)[number]];

function mockCamera() {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { getUserMedia, track };
}

function medicationPosts(event?: string) {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => url === "/api/medication" && (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    .filter((body) => !event || body.event === event);
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
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("model-metadata") ? new Response("", { status: 404 }) : new Response("{}"))));
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
        pillCheck={{ medications: morning, debug: true, onClose, onTaken }}
      />,
    );
    return { onTaken, onClose };
  }

  it("같은 시간의 2알을 한 알씩: 맞는 약은 [먹었어요]를 눌러야 기록하고, 남은 약을 이어서 확인한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    const { onTaken } = renderPillCheck();
    expect(screen.getByText("리리베아캡슐 50mg 1캡슐")).toBeInTheDocument();
    expect(screen.getByText("타이레놀정 500mg 1알")).toBeInTheDocument();
    await screen.findByRole("button", { name: "타이레놀정 500mg" });

    // 타이레놀부터 (순서 상관없음)
    await showPill("타이레놀정 500mg");
    expect(await screen.findByText(/맞아요! 타이레놀정 500mg이에요/)).toBeInTheDocument();
    expect(medicationPosts("taken")).toHaveLength(0); // 비추기만으로는 복용 기록을 하지 않음
    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(await screen.findByText(/복용을 기록했어요. 이제 리리베아캡슐 50mg/)).toBeInTheDocument();
    expect(onTaken).toHaveBeenCalledWith(tylenol);

    // 방금 먹은 타이레놀을 계속 비춰도 다른 약으로 기록하지 않는다
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(medicationPosts("recognition").filter((body) => body.result.status === "mismatched")).toHaveLength(0);

    // 리리베아
    await showPill("리리베아캡슐 50mg");
    expect(await screen.findByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
    expect(await screen.findByText("이번 약을 모두 드셨어요. 기록했어요.")).toBeInTheDocument();
    expect(medicationPosts("taken")).toEqual([
      { patientId: "tanaka-haruko", medicationId: tylenol.id, event: "taken", method: "camera" },
      { patientId: "tanaka-haruko", medicationId: lyribea.id, event: "taken", method: "camera" },
    ]);
    // 맞는 약 인식 결과는 약마다 한 번씩, 사진 없이 규격 필드만
    const matched = medicationPosts("recognition");
    expect(matched.map((body) => [body.medicationId, body.result.status, body.result.medicationCode])).toEqual([
      [tylenol.id, "matched", tylenol.drugCode],
      [lyribea.id, "matched", lyribea.drugCode],
    ]);
    expect(Object.keys(matched[0].result).sort()).toEqual(["confidence", "expectedMedicationCode", "measuredAt", "medicationCode", "modelVersion", "patientId", "status"]);
    expect(matched[0].result).toMatchObject({ patientId: "tanaka-haruko", expectedMedicationCode: tylenol.drugCode, confidence: 0.92, modelVersion: "debug" });
  });

  it("맞는 약으로 한 번 판정되면 약이 안 보이거나 애매해져도 [먹었어요]를 유지하고, 다른 약이면 없앤다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    renderPillCheck();
    await screen.findByRole("button", { name: "타이레놀정 500mg" });

    await showPill("타이레놀정 500mg");
    expect(await screen.findByRole("button", { name: "먹었어요" })).toBeInTheDocument();
    await showPill("없음");
    await showPill("애매함");
    await showPill("여러 알");
    expect(screen.getByText(/맞아요! 타이레놀정 500mg이에요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "먹었어요" })).toBeInTheDocument();

    await showPill("다른 약");
    expect(await screen.findByText(/이 약은 무스판정이에요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "먹었어요" })).not.toBeInTheDocument();
  });

  it("다른 약이면 안내하고, 같은 약을 계속 비춰도 의료진 기록은 한 번만 남긴다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    renderPillCheck();
    await screen.findByRole("button", { name: "다른 약" });

    await showPill("다른 약");
    expect(await screen.findByText(/이 약은 무스판정이에요. 지금 드실 약이 아니에요./)).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const results = medicationPosts("recognition");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      medicationId: lyribea.id,
      result: { status: "mismatched", medicationCode: "K-005849", expectedMedicationCode: lyribea.drugCode, confidence: 0.9 },
    });
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
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    // 표정 관찰에 동의하지 않았으므로 표정 결과는 보내지 않는다
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/camera")).toBe(false);
  });

  it("학습한 모델이 아직 없으면 준비 전이라고 안내한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, onClose: vi.fn(), onTaken: vi.fn() }} />);
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
