import { describe, expect, it } from "vitest";
import { preventPatientEcho } from "../../lib/chatbot/openaiProvider.js";
import type { ChatbotTurnOutput } from "../../lib/chatbot/types.js";

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
