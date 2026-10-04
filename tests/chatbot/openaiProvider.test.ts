import { describe, expect, it } from "vitest";
import { OpenAiChatbotProvider, preventPatientEcho } from "../../lib/chatbot/openaiProvider.js";
import type { ChatbotContext, ChatbotTurnOutput } from "../../lib/chatbot/types.js";

function output(overrides: Partial<ChatbotTurnOutput> = {}): ChatbotTurnOutput {
  return {
    patientReply: "허리 아파",
    speechText: "허리 아파",
    conversationState: "SYMPTOM_DETAIL",
    subjectivePatch: { chiefConcern: "허리 아파" },
    nextQuestionTarget: "location",
    missingFields: ["location"],
    safetyFlags: [],
    sessionAction: "continue",
    ...overrides,
  };
}

describe("preventPatientEcho", () => {
  it("replaces an echoed patient message with the next question", () => {
    const result = preventPatientEcho(output(), "허리 아파");

    expect(result.patientReply).toBe("불편함은 어느 부위에서 느껴지나요?");
    expect(result.speechText).toBe(result.patientReply);
  });

  it("keeps a useful response and synchronizes its speech text", () => {
    const original = output({
      patientReply: "허리가 불편하시군요. 어디가 가장 아픈가요?",
      speechText: "화면과 다른 낭독 문장",
    });
    const result = preventPatientEcho(original, "허리 아파");

    expect(result.patientReply).toBe(original.patientReply);
    expect(result.speechText).toBe(result.patientReply);
  });
});

describe("OpenAiChatbotProvider conversation flow", () => {
  it("extracts the highest NRS and advances past an already answered severity question", async () => {
    const modelOutput = output({
      patientReply: "이해했습니다. 통증 정도는 어떤가요?",
      speechText: "이해했습니다. 통증 정도는 어떤가요?",
      subjectivePatch: {},
      nextQuestionTarget: "severityNrs",
      missingFields: ["severityNrs", "onset"],
    });
    const client = {
      responses: { create: async () => ({ output_text: JSON.stringify(modelOutput) }) },
    };
    const context: ChatbotContext = {
      sessionId: "session-1",
      patientId: "tanaka-haruko",
      state: "SYMPTOM_DETAIL",
      messages: [],
      subjective: { chiefConcern: "허리 통증", location: "허리 아래쪽" },
      safetyFlags: [],
      language: "ko",
    };

    const result = await new OpenAiChatbotProvider({ client: client as never }).runTurn({
      context,
      patientText: "가만히 있을 때는 4점 정도인데, 움직일 때는 7점 정도예요.",
    });

    expect(result.subjectivePatch.severityNrs).toBe(7);
    expect(result.nextQuestionTarget).toBe("onset");
    expect(result.patientReply).toContain("언제부터 시작됐나요?");
    expect(result.missingFields).not.toContain("severityNrs");
  });
});
