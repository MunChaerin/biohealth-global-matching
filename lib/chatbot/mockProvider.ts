import { detectSafetyFlags } from "./safetyRules";
import { stateForQuestion } from "./stateMachine";
import type {
  ChatbotContext,
  ChatbotProvider,
  ChatbotTurnInput,
  ChatbotTurnOutput,
  QuestionTarget,
} from "./types";

const questionFlow: Array<{ target: QuestionTarget; field?: string; question: string }> = [
  { target: "identity", question: "본인이 맞는지 확인해도 될까요?" },
  { target: "consent", question: "현재 상태에 대해 몇 가지 질문을 드려도 될까요?" },
  { target: "safety", question: "지금 당장 위험하거나 급하게 도움이 필요한 증상이 있나요?" },
  { target: "chiefConcern", field: "chiefConcern", question: "오늘 가장 불편한 점은 무엇인가요?" },
  { target: "location", field: "location", question: "그 불편함은 어디에서 느껴지나요?" },
  { target: "severityNrs", field: "severityNrs", question: "불편한 정도를 0에서 10까지 중 숫자로 표현하면 어느 정도인가요?" },
  { target: "onset", field: "onset", question: "그 증상은 언제부터 시작되었나요?" },
  { target: "functionalImpact", field: "functionalImpact", question: "이 증상 때문에 일상생활에서 어려운 점이 있나요?" },
  { target: "mood", field: "mood", question: "최근 기분이나 의욕에 변화가 있었나요?" },
  { target: "summary", question: "지금까지 말씀하신 내용을 정리해드려도 될까요?" },
];

function normalizeUnknown(text: string): string | "unknown" {
  return /^(모르겠|잘 모르|기억이 안|없어요|없음|모름)/.test(text.trim()) ? "unknown" : text.trim();
}

function nextStep(context: ChatbotContext): { target: QuestionTarget; field?: string; question: string } {
  return questionFlow.find((step) => step.field && context.subjective[step.field as keyof typeof context.subjective] === undefined)
    ?? questionFlow.find((step) => step.target === "summary")
    ?? questionFlow[0]!;
}

function safetyResponse(): ChatbotTurnOutput {
  const reply = "지금 말씀하신 내용은 바로 확인이 필요한 신호일 수 있습니다. 일반 질문을 중단하고 의료진 또는 기관의 안전 대응 담당자에게 연결하겠습니다.";
  return {
    patientReply: reply,
    speechText: reply,
    conversationState: "SAFETY_HOLD",
    subjectivePatch: {},
    missingFields: [],
    safetyFlags: [],
    sessionAction: "handoff",
  };
}

export class MockChatbotProvider implements ChatbotProvider {
  async runTurn(input: ChatbotTurnInput): Promise<ChatbotTurnOutput> {
    const safetyFlags = detectSafetyFlags(input.patientText);
    if (safetyFlags.length > 0) {
      return { ...safetyResponse(), safetyFlags };
    }

    if (input.context.state === "READY" && input.context.messages.length === 0 && Object.keys(input.context.subjective).length === 0) {
      const firstQuestion = questionFlow.find((step) => step.target === "chiefConcern")!;
      return {
        patientReply: firstQuestion.question,
        speechText: firstQuestion.question,
        conversationState: "CHIEF_CONCERN",
        subjectivePatch: {},
        nextQuestionTarget: firstQuestion.target,
        missingFields: [firstQuestion.field!],
        safetyFlags: [],
        sessionAction: "continue",
      };
    }

    const step = nextStep(input.context);
    const value = normalizeUnknown(input.patientText);
    const subjectivePatch = step.field ? { [step.field]: value } : {};
    const nextContext = {
      ...input.context,
      subjective: { ...input.context.subjective, ...subjectivePatch },
    };
    const next = nextStep(nextContext);
    const isComplete = next.target === "summary" && step.target === "summary";
    const patientReply = isComplete
      ? "대화 내용을 정리했습니다. 의료진 검토를 위한 SOAP 초안을 준비할 수 있습니다."
      : next.question;

    return {
      patientReply,
      speechText: patientReply,
      conversationState: isComplete ? "READY_FOR_SOAP" : stateForQuestion(next.target),
      subjectivePatch,
      nextQuestionTarget: isComplete ? undefined : next.target,
      missingFields: isComplete ? [] : [next.field ?? next.target],
      safetyFlags: [],
      sessionAction: isComplete ? "complete" : "continue",
    };
  }
}
