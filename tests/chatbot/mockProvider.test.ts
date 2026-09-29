import { describe, expect, it } from "vitest";
import { MockChatbotProvider } from "../../lib/chatbot/mockProvider.js";
import type { ChatbotContext } from "../../lib/chatbot/types.js";

function createContext(): ChatbotContext {
  return {
    sessionId: "session-1",
    patientId: "patient-1",
    state: "READY",
    messages: [],
    subjective: {},
    safetyFlags: [],
  };
}

describe("MockChatbotProvider", () => {
  it("asks a question and stores the patient's answer as a subjective patch", async () => {
    const provider = new MockChatbotProvider();
    const output = await provider.runTurn({
      context: {
        ...createContext(),
        state: "CHIEF_CONCERN",
        messages: [{ role: "assistant", text: "오늘 가장 불편한 점은 무엇인가요?", createdAt: "2026-09-28T00:00:00.000Z" }],
      },
      patientText: "허리가 아파요.",
    });

    expect(output.patientReply).toContain("어디");
    expect(output.subjectivePatch).toEqual({ chiefConcern: "허리가 아파요." });
    expect(output.conversationState).toBe("SYMPTOM_DETAIL");
  });

  it("starts with the chief concern question", async () => {
    const provider = new MockChatbotProvider();
    const output = await provider.runTurn({
      context: createContext(),
      patientText: "",
    });

    expect(output.patientReply).toContain("불편한 점");
    expect(output.subjectivePatch).toEqual({});
    expect(output.nextQuestionTarget).toBe("chiefConcern");
  });

  it("hands off immediately when a high-risk signal is detected", async () => {
    const provider = new MockChatbotProvider();
    const output = await provider.runTurn({
      context: createContext(),
      patientText: "죽고 싶다는 생각이 들어요.",
    });

    expect(output.conversationState).toBe("SAFETY_HOLD");
    expect(output.sessionAction).toBe("handoff");
    expect(output.safetyFlags[0]?.type).toBe("suicide");
  });

  it("preserves unknown answers instead of guessing", async () => {
    const provider = new MockChatbotProvider();
    const output = await provider.runTurn({
      context: {
        ...createContext(),
        subjective: { chiefConcern: "허리가 아파요." },
      },
      patientText: "잘 모르겠어요.",
    });

    expect(output.subjectivePatch.location).toBe("unknown");
  });
});
