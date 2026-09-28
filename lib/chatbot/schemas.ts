import type { ChatbotTurnOutput, ConversationState } from "./types";
import { conversationStates } from "./types";

export function isConversationState(value: unknown): value is ConversationState {
  return typeof value === "string" && conversationStates.includes(value as ConversationState);
}

export function validateChatbotTurnOutput(value: unknown): asserts value is ChatbotTurnOutput {
  if (!value || typeof value !== "object") {
    throw new Error("챗봇 출력은 객체여야 합니다.");
  }

  const output = value as Record<string, unknown>;
  if (typeof output.patientReply !== "string" || typeof output.speechText !== "string") {
    throw new Error("patientReply와 speechText는 문자열이어야 합니다.");
  }

  if (!isConversationState(output.conversationState)) {
    throw new Error("유효하지 않은 conversationState입니다.");
  }

  if (!output.subjectivePatch || typeof output.subjectivePatch !== "object") {
    throw new Error("subjectivePatch가 필요합니다.");
  }

  if (!Array.isArray(output.missingFields) || !output.missingFields.every((item) => typeof item === "string")) {
    throw new Error("missingFields는 문자열 배열이어야 합니다.");
  }

  if (!Array.isArray(output.safetyFlags)) {
    throw new Error("safetyFlags는 배열이어야 합니다.");
  }

  if (!['continue', 'pause', 'handoff', 'complete'].includes(String(output.sessionAction))) {
    throw new Error("유효하지 않은 sessionAction입니다.");
  }
}
