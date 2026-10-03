import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const landmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [] })), close: vi.fn() };
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => landmarker) },
}));

// 흰 캡슐 각인 OCR은 실제 사진이 없으므로 결과만 정해 둔다
const ocr = vi.hoisted(() => ({ drugCode: null as string | null }));
vi.mock("../../lib/pill/capsuleOcr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pill/capsuleOcr")>()),
  cropGray: vi.fn(() => ({ data: new Uint8Array(4), width: 2, height: 2 })),
  readCapsuleImprint: vi.fn(async () => ({ drugCode: ocr.drugCode, texts: [] })),
}));

import { CAMERA_CONSENT_KEY, CameraIndicator } from "../../components/patient/CameraIndicator";
import { resetRearCameraMemory } from "../../components/patient/useRearCamera";
import { readCapsuleImprint } from "../../lib/pill/capsuleOcr";
import { getMedicationSchedule } from "../../lib/medication/schedule";

// 아침 08:00: 리리베아캡슐 50mg + 타이레놀정 500mg
const morning = getMedicationSchedule("tanaka-haruko").filter((item) => item.time === "08:00");
const [lyribea, tylenol] = morning as [(typeof morning)[number], (typeof morning)[number]];

const wantsRear = (constraints: MediaStreamConstraints) =>
  typeof constraints.video === "object" && JSON.stringify(constraints.video.facingMode) === JSON.stringify({ exact: "environment" });

/** 카메라 흉내. 기본은 후면 카메라가 없는 노트북 (후면 요청은 실패, 전면만 켜짐). */
function mockCamera() {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    if (wantsRear(constraints)) throw new DOMException("no rear camera", "OverconstrainedError");
    return { getTracks: () => [track] };
  });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { getUserMedia, track };
}

const frontCalls = (getUserMedia: { mock: { calls: unknown[][] } }) =>
  getUserMedia.mock.calls.filter(([constraints]) => !wantsRear(constraints as MediaStreamConstraints)).length;

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
    resetRearCameraMemory();
    ocr.drugCode = null;
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
    ocr.drugCode = tylenol.drugCode; // 리리베아가 남아 있는 동안 타이레놀은 각인 확인을 거친다
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

  it("맞는 약으로 한 번 판정되면 약이 안 보이거나 애매해져도 [먹었어요]를 유지하고, 다른 약이 확실히 보이면 없앤다", async () => {
    ocr.drugCode = tylenol.drugCode; // 리리베아가 남아 있는 동안 타이레놀은 각인 확인을 거친다
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "먹었어요" })).not.toBeInTheDocument());
    expect(screen.queryByText(/무스판정/)).not.toBeInTheDocument(); // 일정 밖의 약 이름은 말하지 않음
  });

  describe("같이 먹는 약 착각 방지 (아침: 리리베아 + 타이레놀)", () => {
    it("모델이 타이레놀로 봐도 리리베아 각인(DWB PGN 50)이 읽히면 리리베아로 바로잡고, 타이레놀 '맞아요'를 내지 않는다", async () => {
      ocr.drugCode = lyribea.drugCode;
      window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
      mockCamera();
      renderPillCheck();
      await screen.findByRole("button", { name: "타이레놀정 500mg" });
      await showPill("타이레놀정 500mg");
      expect(await screen.findByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
      expect(screen.queryByText(/맞아요! 타이레놀/)).not.toBeInTheDocument();
      expect(readCapsuleImprint).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "먹었어요" }));
      await waitFor(() => expect(medicationPosts("taken")).toEqual([{ patientId: "tanaka-haruko", medicationId: lyribea.id, event: "taken", method: "camera" }]));
    });

    it("각인을 못 읽으면 타이레놀로 확정하지 않고 '잘 모르겠어요'로 둔다 (어르신에게 고르게 하지 않음)", async () => {
      ocr.drugCode = null;
      window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
      mockCamera();
      renderPillCheck();
      await screen.findByRole("button", { name: "타이레놀정 500mg" });
      await showPill("타이레놀정 500mg");
      expect(await screen.findByText(/어떤 약인지 잘 모르겠어요/)).toBeInTheDocument();
      expect(screen.queryByText(/골라 주세요/)).not.toBeInTheDocument();
      expect(screen.queryByText(/맞아요! 타이레놀/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "먹었어요" })).not.toBeInTheDocument();
    });

    it("타이레놀 각인이 읽히면 타이레놀로 확정한다", async () => {
      ocr.drugCode = tylenol.drugCode;
      window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
      mockCamera();
      renderPillCheck();
      await screen.findByRole("button", { name: "타이레놀정 500mg" });
      await showPill("타이레놀정 500mg");
      expect(await screen.findByText(/맞아요! 타이레놀정 500mg이에요/)).toBeInTheDocument();
    });

    it("리리베아를 먹고 나면(남은 약이 타이레놀뿐) 각인 확인 없이 판정한다", async () => {
      window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
      mockCamera();
      renderPillCheck();
      await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
      await showPill("리리베아캡슐 50mg");
      fireEvent.click(await screen.findByRole("button", { name: "먹었어요" }));
      await screen.findByText(/복용을 기록했어요/);
      vi.mocked(readCapsuleImprint).mockClear();
      await showPill("타이레놀정 500mg");
      expect(await screen.findByText(/맞아요! 타이레놀정 500mg이에요/)).toBeInTheDocument();
      expect(readCapsuleImprint).not.toHaveBeenCalled();
    });
  });

  it("각인을 읽는 중에 약 확인을 닫았다 다시 열면 각인 확인을 다시 한다 (busy로 남지 않음)", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    vi.mocked(readCapsuleImprint).mockImplementationOnce(() => new Promise(() => {})); // 첫 번째는 끝나지 않음
    const request = { medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() };
    const { rerender } = render(<CameraIndicator patientId="tanaka-haruko" pillCheck={request} />);
    await screen.findByRole("button", { name: "타이레놀정 500mg" });
    await showPill("타이레놀정 500mg"); // 리리베아가 남아 있어 확정 전 각인 확인 (끝나지 않음)
    await waitFor(() => expect(readCapsuleImprint).toHaveBeenCalledTimes(1));
    rerender(<CameraIndicator patientId="tanaka-haruko" />); // 닫기
    ocr.drugCode = tylenol.drugCode;
    rerender(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ ...request }} />); // 다시 열기
    await screen.findByRole("button", { name: "타이레놀정 500mg" });
    await showPill("타이레놀정 500mg");
    expect(await screen.findByText(/맞아요! 타이레놀정 500mg이에요/)).toBeInTheDocument();
    expect(readCapsuleImprint).toHaveBeenCalledTimes(2);
  });

  it("약 확인을 닫았다 다시 열고 같은 약을 비추면 근거 사진을 새로 보여 준다", async () => {
    let shot = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => `data:image/jpeg;base64,SHOT${(shot += 1)}`);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((_type: string, options?: unknown) =>
      options ? null : { drawImage: vi.fn() }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    const request = { medications: [lyribea], debug: true, onClose: vi.fn(), onTaken: vi.fn() };
    const { rerender } = render(<CameraIndicator patientId="tanaka-haruko" pillCheck={request} />);
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    await showPill("리리베아캡슐 50mg");
    expect(await screen.findByAltText("카메라로 본 약")).toBeInTheDocument();
    rerender(<CameraIndicator patientId="tanaka-haruko" />);
    rerender(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ ...request }} />);
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    await showPill("리리베아캡슐 50mg");
    expect(await screen.findByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
    expect(await screen.findByAltText("카메라로 본 약")).toBeInTheDocument(); // 전에는 같은 약이라 다시 찍지 않아 사진이 없었음
  });

  describe("흰 캡슐 (모델이 리리베아로 보지만 기준 0.75에 못 미침)", () => {
    async function showWhiteCapsule() {
      window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
      mockCamera();
      renderPillCheck();
      await screen.findByRole("button", { name: "흰 캡슐" });
      await showPill("흰 캡슐");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
    }

    it("각인을 한 번만 읽고, 리리베아 각인이면 맞는 약", async () => {
      ocr.drugCode = "K-045037";
      await showWhiteCapsule();
      expect(await screen.findByText(/맞아요! 리리베아캡슐 50mg이에요/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "먹었어요" })).toBeInTheDocument();
      expect(readCapsuleImprint).toHaveBeenCalledTimes(1); // 매 프레임 읽지 않음
    });

    it("일정 밖의 약(독립목클린) 각인이어도 '다른 약'이라 하지 않고 '잘 모르겠어요'", async () => {
      ocr.drugCode = "K-045269";
      await showWhiteCapsule();
      expect(await screen.findByText(/어떤 약인지 잘 모르겠어요/)).toBeInTheDocument();
      expect(screen.queryByText(/독립목클린/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "먹었어요" })).not.toBeInTheDocument();
    });

    it("각인으로 못 정하면 고르게 하지 않고 다시 비춰 달라고 한다", async () => {
      ocr.drugCode = null;
      await showWhiteCapsule();
      expect(await screen.findByText(/어떤 약인지 잘 모르겠어요/)).toBeInTheDocument();
      expect(screen.queryByText(/골라 주세요/)).not.toBeInTheDocument();
      expect(readCapsuleImprint).toHaveBeenCalledTimes(1);
    });
  });

  it("일정 밖의 약은 '다른 약'이라 하지 않고 '잘 모르겠어요', 의료진 기록은 unknown 한 번만", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    mockCamera();
    renderPillCheck();
    await screen.findByRole("button", { name: "다른 약" });

    await showPill("다른 약");
    expect(await screen.findByText(/어떤 약인지 잘 모르겠어요/)).toBeInTheDocument();
    expect(screen.queryByText(/무스판정/)).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const results = medicationPosts("recognition");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      medicationId: lyribea.id,
      result: { status: "unknown", medicationCode: "K-005849", expectedMedicationCode: lyribea.drugCode, confidence: 0.9 },
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

  it("들어오자마자 카메라 권한을 받아 두어, 약 확인이 열리면 [카메라 켜고 확인하기] 없이 바로 켠다", async () => {
    const { getUserMedia } = mockCamera();
    render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    expect(screen.queryByRole("button", { name: "카메라 켜고 확인하기" })).not.toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }); // 권한 받기
    // 표정 관찰에 동의하지 않았으므로 표정 결과는 보내지 않는다
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/camera")).toBe(false);
  });

  it("카메라를 끈 환자(표정 관찰 off)에게는 들어올 때 권한을 묻지 않고, 약 확인 때 버튼으로 한 번 묻고 기억한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "off");
    const { getUserMedia } = mockCamera();
    const first = render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    expect(screen.getByText(/한 번 허용하면 다음부터는 바로 켜져요/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "카메라 켜고 확인하기" }));
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    first.unmount();
    render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    expect(screen.queryByRole("button", { name: "카메라 켜고 확인하기" })).not.toBeInTheDocument();
  });

  it("알약 확인 중에는 카메라 해상도를 높이고(카메라는 그대로), 끝나면 표정 관찰용으로 되돌린다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    let settings = { width: 640, height: 480 };
    const track = {
      stop: vi.fn(),
      applyConstraints: vi.fn(async (c: { width: { ideal: number } }) => {
        settings = c.width.ideal === 1920 ? { width: 1920, height: 1080 } : { width: 640, height: 480 };
      }),
      getSettings: () => settings,
    };
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (wantsRear(constraints)) throw new DOMException("no rear camera", "OverconstrainedError");
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    resetRearCameraMemory();
    // 후면이 없다는 걸 이미 알고 있는 노트북: 약 확인 때 전면 카메라를 끄지 않고 해상도만 바꾼다
    const first = render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    await waitFor(() => expect(getUserMedia.mock.calls.some(([c]) => wantsRear(c))).toBe(true));
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    first.unmount();
    getUserMedia.mockClear();
    track.applyConstraints.mockClear();
    track.stop.mockClear();

    const { rerender } = render(<CameraIndicator patientId="tanaka-haruko" />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    rerender(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    expect(await screen.findByText("1920x1080")).toBeInTheDocument();
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ width: { ideal: 1920 }, height: { ideal: 1080 } });

    rerender(<CameraIndicator patientId="tanaka-haruko" />);
    await waitFor(() => expect(track.applyConstraints).toHaveBeenLastCalledWith({ width: { ideal: 640 }, height: { ideal: 480 } }));
    expect(getUserMedia).toHaveBeenCalledTimes(1); // 카메라를 새로 켜지 않음
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("후면 카메라가 있는 기기(아이패드)는 약 확인 때 후면으로 바꾸고, 끝나면 전면(표정 관찰)으로 돌아간다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    const front = { stop: vi.fn() };
    const rearTrack = { stop: vi.fn(), getSettings: () => ({ width: 1920, height: 1080 }) };
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
      wantsRear(constraints) ? { getTracks: () => [rearTrack], getVideoTracks: () => [rearTrack] } : { getTracks: () => [front] },
    );
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

    const { rerender } = render(<CameraIndicator patientId="tanaka-haruko" />);
    await waitFor(() => expect(frontCalls(getUserMedia)).toBe(1));
    rerender(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    expect(await screen.findByText("후면 1920x1080")).toBeInTheDocument();
    expect(front.stop).toHaveBeenCalled(); // 한 번에 카메라 하나만
    expect(screen.getByLabelText("약 확인 카메라 미리보기").className).toMatch(/rearPreview/); // 거울 모드 아님
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" }); // 후면 영상으로 약 확인 진행

    rerender(<CameraIndicator patientId="tanaka-haruko" />);
    await waitFor(() => expect(rearTrack.stop).toHaveBeenCalled());
    await waitFor(() => expect(frontCalls(getUserMedia)).toBe(2)); // 표정 관찰 카메라 다시 켬
  });

  it("iOS: 늦게 도착하는 전면 요청이 끝나고 전면을 끈 뒤에만 후면을 요청한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    const front = { stop: vi.fn() };
    const rearTrack = Object.assign(new EventTarget(), { stop: vi.fn(), getSettings: () => ({ width: 1080, height: 1920 }) });
    let resolveFront: (stream: unknown) => void = () => {};
    const order: string[] = [];
    front.stop.mockImplementation(() => order.push("front stop"));
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      if (wantsRear(constraints)) {
        order.push("rear request");
        return Promise.resolve({ getTracks: () => [rearTrack], getVideoTracks: () => [rearTrack] });
      }
      order.push("front request");
      return new Promise((resolve) => (resolveFront = resolve)); // 응답이 늦게 옴
    });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

    const { rerender } = render(<CameraIndicator patientId="tanaka-haruko" />);
    await waitFor(() => expect(order).toEqual(["front request"]));
    // 전면 응답이 오기 전에 약 확인 시작
    rerender(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(order).toEqual(["front request"]); // 아직 후면을 요청하지 않음
    await act(async () => resolveFront({ getTracks: () => [front] }));
    await waitFor(() => expect(order).toEqual(["front request", "front stop", "rear request"]));
    expect(await screen.findByText("후면 1080x1920")).toBeInTheDocument();
  });

  it("iOS가 후면 트랙을 끊으면 한 번 다시 요청하고, 또 끊기면 전면으로 대신한다", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    const tracks: (EventTarget & { stop: () => void })[] = [];
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (!wantsRear(constraints)) return { getTracks: () => [{ stop: vi.fn() }] };
      const track = Object.assign(new EventTarget(), { stop: vi.fn(), getSettings: () => ({ width: 1920, height: 1080 }) });
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

    render(<CameraIndicator patientId="tanaka-haruko" pillCheck={{ medications: morning, debug: true, onClose: vi.fn(), onTaken: vi.fn() }} />);
    await waitFor(() => expect(tracks).toHaveLength(1));
    await act(async () => void tracks[0]!.dispatchEvent(new Event("ended")));
    await waitFor(() => expect(tracks).toHaveLength(2)); // 한 번 다시 요청
    await act(async () => void tracks[1]!.dispatchEvent(new Event("ended")));
    await waitFor(() => expect(frontCalls(getUserMedia)).toBe(1)); // 전면으로 대신
    // [회귀] 전면으로 대신하는 중에 다시 후면을 기다리거나 요청하지 않는다 (전면<->후면 반복 전환 방지)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(tracks).toHaveLength(2);
    expect(frontCalls(getUserMedia)).toBe(1);
    expect(screen.getByLabelText("약 확인 카메라 미리보기").className).not.toMatch(/rearPreview/);
  });

  it("[회귀] 후면 카메라 권한이 거부되면 이 화면 동안 다시 요청하지 않고 전면으로 대신한다 (반복 전환 없음)", async () => {
    window.localStorage.setItem(CAMERA_CONSENT_KEY, "on");
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (wantsRear(constraints)) throw new DOMException("denied", "NotAllowedError");
      return { getTracks: () => [{ stop: vi.fn() }] };
    });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    renderPillCheck();
    await screen.findByRole("button", { name: "리리베아캡슐 50mg" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    expect(getUserMedia.mock.calls.filter(([c]) => wantsRear(c as MediaStreamConstraints))).toHaveLength(1);
    expect(frontCalls(getUserMedia)).toBe(1);
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
