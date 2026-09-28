import type { ConversationState, QuestionTarget } from "./types";

const nextStateByTarget: Partial<Record<QuestionTarget, ConversationState>> = {
  identity: "IDENTITY_CHECK",
  consent: "SAFETY_CHECK",
  safety: "CHIEF_CONCERN",
  chiefConcern: "SYMPTOM_DETAIL",
  location: "SYMPTOM_DETAIL",
  severityNrs: "SYMPTOM_DETAIL",
  onset: "FUNCTION_CHECK",
  functionalImpact: "MOOD_CHECK",
  mood: "SUMMARY_CONFIRMATION",
  summary: "READY_FOR_SOAP",
};

export function stateForQuestion(target: QuestionTarget): ConversationState {
  return nextStateByTarget[target] ?? "READY";
}

export function isSafetyHold(state: ConversationState): boolean {
  return state === "SAFETY_HOLD";
}

export function transitionAfterSafety(hasSafetyFlag: boolean): ConversationState {
  return hasSafetyFlag ? "SAFETY_HOLD" : "CHIEF_CONCERN";
}

export function nextMissingField(
  collected: Record<string, unknown>,
  requiredFields: readonly string[],
): string | undefined {
  return requiredFields.find((field) => collected[field] === undefined);
}
