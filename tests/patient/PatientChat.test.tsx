import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientChat } from "../../components/patient/PatientChat";
import type { ChatbotTurnOutput } from "../../lib/chatbot/types";

const normalOutput: ChatbotTurnOutput = {
  patientReply: "어디가 가장 불편한가요?",
  speechText: "어디가 가장 불편한가요?",
  conversationState: "SYMPTOM_DETAIL",
  subjectivePatch: { chiefConcern: "허리가 아파요." },
  nextQuestionTarget: "location",
  missingFields: ["location"],
  safetyFlags: [],
  sessionAction: "continue",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function send(text: string) {
  fireEvent.change(screen.getByLabelText("챗봇에게 보낼 내용"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
}

describe("PatientChat", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("약 확인 자동 열림 시각이 지나면 약 확인을 저절로 열고, 같은 날 다시 열지 않는다", async () => {
    window.localStorage.clear();
    const { getMedicationSchedule } = await import("../../lib/medication/schedule");
    const items = getMedicationSchedule("tanaka-haruko").map((item) => ({ ...item, status: "pending", mismatchCount: 0 }));
    const today = { date: "2026-10-03", items, next: items[0], nextGroup: items.slice(0, 2), reminders: [{ time: "08:00", openAt: "00:00" }, { time: "18:00", openAt: "23:59" }] };
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).startsWith("/api/medication") ? jsonResponse(today) : jsonResponse({})));
    const first = render(<PatientChat />);
    expect(await screen.findByRole("dialog", { name: "약 확인" })).toBeInTheDocument();
    expect(screen.getByText("리리베아캡슐 50mg 1캡슐")).toBeInTheDocument();
    first.unmount();

    render(<PatientChat />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("dialog", { name: "약 확인" })).not.toBeInTheDocument();
  });

  it("iOS 음성 잠금: 처음 터치할 때 소리 없는 문장을 한 번만 말해 둔다", () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), resume: vi.fn(), speaking: false, pending: false });
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      volume = 1;
      constructor(public text: string) {}
    });
    render(<PatientChat />);
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]![0]).toMatchObject({ text: " ", volume: 0 });
  });

  it("shows the first question", () => {
    render(<PatientChat />);
    expect(screen.getByText("오늘 가장 불편한 점은 무엇인가요?")).toBeTruthy();
  });

  it("adds the patient message and displays the chatbot response", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse(normalOutput));
    render(<PatientChat />);

    await send("허리가 아파요.");

    expect(screen.getByText("허리가 아파요.")).toBeTruthy();
    expect(await screen.findByText("어디가 가장 불편한가요?")).toBeTruthy();
  });

  it("puts recognized speech into the message field before sending", async () => {
    class MockRecognition {
      static current: MockRecognition;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror = null;
      onend: (() => void) | null = null;

      constructor() {
        MockRecognition.current = this;
      }

      start() {}
      stop() { this.onend?.(); }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    render(<PatientChat />);

    await waitFor(() => expect(screen.getByRole("button", { name: "말하기" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "말하기" }));
    act(() => {
      MockRecognition.current.onresult?.({ results: [{ 0: { transcript: "허리가 아파요" } }] });
      MockRecognition.current.onend?.();
    });

    expect(screen.getByLabelText("챗봇에게 보낼 내용")).toHaveValue("허리가 아파요");
  });

  it("reads exactly the same text shown in the chatbot response", async () => {
    const spokenTexts: string[] = [];
    const speak = vi.fn((utterance: { text: string; onstart?: () => void }) => {
      spokenTexts.push(utterance.text);
      utterance.onstart?.();
    });
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      lang = "";
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    });
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({
      ...normalOutput,
      speechText: "화면 답변과 다른 낭독 문장",
    }));
    render(<PatientChat />);

    await send("허리가 아파요.");

    // 처음 터치할 때 iOS 음성 잠금을 풀려고 말하는 빈 문장(" ")은 빼고 비교
    await waitFor(() => expect(spokenTexts.filter((text) => text.trim())).toHaveLength(1));
    expect(spokenTexts.filter((text) => text.trim())).toEqual([normalOutput.patientReply]);
  });

  it("prevents duplicate sends while loading", async () => {
    let resolveRequest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<PatientChat />);

    await send("허리가 아파요.");
    expect(screen.getByRole("button", { name: "전송 중" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "전송 중" }));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(1);

    await act(async () => resolveRequest(jsonResponse(normalOutput)));
  });

  it("shows a friendly API error", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: "server error" }, 500));
    render(<PatientChat />);

    await send("허리가 아파요.");

    expect(await screen.findByText("잠시 연결이 원활하지 않습니다. 잠시 후 다시 말씀해 주세요.")).toBeTruthy();
  });

  it.each([
    ["SAFETY_HOLD" as const, "continue" as const],
    ["SYMPTOM_DETAIL" as const, "handoff" as const],
  ])("shows safety guidance for %s or %s", async (conversationState, sessionAction) => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({
      ...normalOutput,
      patientReply: "의료진에게 연결하겠습니다.",
      conversationState,
      sessionAction,
      safetyFlags: conversationState === "SAFETY_HOLD"
        ? [{ type: "respiratory", severity: "high", evidence: "호흡 곤란 호소" }]
        : [],
    } satisfies ChatbotTurnOutput));
    render(<PatientChat />);

    await send("숨쉬기 어려워요.");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("의료진에게 연결하고 있습니다."));
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });
});
