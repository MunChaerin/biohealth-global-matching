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

  it("stores an explicit mood answer and replaces an unrelated fatigue question with summary confirmation", async () => {
    const modelOutput = output({
      patientReply: "조금 피곤하지만 쉬면 괜찮으시군요. 최근의 피로감은 어느 정도인가요?",
      speechText: "조금 피곤하지만 쉬면 괜찮으시군요. 최근의 피로감은 어느 정도인가요?",
      subjectivePatch: { fatigue: "조금 지침" },
      nextQuestionTarget: "summary",
      missingFields: [],
    });
    const client = {
      responses: { create: async () => ({ output_text: JSON.stringify(modelOutput) }) },
    };
    const context: ChatbotContext = {
      sessionId: "session-2",
      patientId: "tanaka-haruko",
      state: "MOOD_CHECK",
      messages: [],
      subjective: {
        chiefConcern: "허리 통증",
        location: "허리 아래쪽",
        severityNrs: 7,
        onset: "어젯밤",
        functionalImpact: "의자에서 일어나거나 허리를 숙이기 힘듦",
      },
      safetyFlags: [],
      language: "ko",
    };
    const patientText = "통증 때문에 조금 지치기는 했지만, 기분이나 의욕에는 큰 변화가 없어요.";

    const result = await new OpenAiChatbotProvider({ client: client as never }).runTurn({ context, patientText });

    expect(result.subjectivePatch.mood).toBe(patientText);
    expect(result.nextQuestionTarget).toBe("summary");
    expect(result.patientReply).toContain("지금까지 말씀하신 내용을 정리해드려도 될까요?");
    expect(result.patientReply).not.toContain("피로감");
  });
});
