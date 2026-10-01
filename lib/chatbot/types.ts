export const conversationStates = [
  "READY",
  "IDENTITY_CHECK",
  "SAFETY_CHECK",
  "CHIEF_CONCERN",
  "SYMPTOM_DETAIL",
  "FUNCTION_CHECK",
  "MOOD_CHECK",
  "SUMMARY_CONFIRMATION",
  "READY_FOR_SOAP",
  "SAFETY_HOLD",
  "PAUSED",
] as const;

export type ConversationState = (typeof conversationStates)[number];

export type SessionAction = "continue" | "pause" | "handoff" | "complete";
export type ChatLanguage = "ko" | "ja";

export type QuestionTarget =
  | "identity"
  | "consent"
  | "safety"
  | "chiefConcern"
  | "location"
  | "severityNrs"
  | "onset"
  | "functionalImpact"
  | "mood"
  | "summary";

export type SubjectiveValue = string | number | boolean | "unknown";

export interface SubjectiveData {
  chiefConcern?: string | "unknown";
  location?: string | "unknown";
  laterality?: string | "unknown";
  severityNrs?: number | "unknown";
  baselineComparison?: string | "unknown";
  character?: string | "unknown";
  onset?: string | "unknown";
  duration?: string | "unknown";
  course?: string | "unknown";
  aggravatingFactors?: string | "unknown";
  relievingFactors?: string | "unknown";
  functionalImpact?: string | "unknown";
  sleep?: string | "unknown";
  fatigue?: string | "unknown";
  appetite?: string | "unknown";
  mood?: string | "unknown";
  anxiety?: string | "unknown";
  interest?: string | "unknown";
  patientGoal?: string | "unknown";
}

export interface SafetyFlag {
  type: "suicide" | "neurological" | "respiratory" | "delirium";
  severity: "high" | "medium";
  evidence: string;
}

export interface ChatbotContext {
  sessionId: string;
  patientId: string;
  state: ConversationState;
  messages: ChatMessage[];
  subjective: SubjectiveData;
  safetyFlags: SafetyFlag[];
  consentGiven?: boolean;
  language?: ChatLanguage;
  personaId?: string;
  personaSummary?: string;
}

export interface ChatMessage {
  role: "patient" | "assistant" | "system";
  text: string;
  createdAt: string;
}

export interface ChatbotTurnInput {
  context: ChatbotContext;
  patientText: string;
}

export interface ChatbotTurnOutput {
  patientReply: string;
  speechText: string;
  conversationState: ConversationState;
  subjectivePatch: Partial<SubjectiveData>;
  nextQuestionTarget?: QuestionTarget;
  missingFields: string[];
  safetyFlags: SafetyFlag[];
  sessionAction: SessionAction;
}

export interface ChatbotProvider {
  runTurn(input: ChatbotTurnInput): Promise<ChatbotTurnOutput>;
}
