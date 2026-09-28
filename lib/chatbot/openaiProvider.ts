import OpenAI from "openai";
import { validateChatbotTurnOutput } from "./schemas";
import type {
  ChatbotContext,
  ChatbotProvider,
  ChatbotTurnInput,
  ChatbotTurnOutput,
  SubjectiveData,
} from "./types";

const subjectiveFields = [
  "chiefConcern",
  "location",
  "laterality",
  "severityNrs",
  "baselineComparison",
  "character",
  "onset",
  "duration",
  "course",
  "aggravatingFactors",
  "relievingFactors",
  "functionalImpact",
  "sleep",
  "fatigue",
  "appetite",
  "mood",
  "anxiety",
  "interest",
  "patientGoal",
] as const;

const subjectivePatchSchema = Object.fromEntries(
  subjectiveFields.map((field) => [field, { type: ["string", "number", "boolean", "null"] }]),
);

const chatbotTurnSchema = {
  type: "object",
  properties: {
    patientReply: { type: "string" },
    speechText: { type: "string" },
    conversationState: {
      type: "string",
      enum: [
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
      ],
    },
    subjectivePatch: {
      type: "object",
      properties: subjectivePatchSchema,
      required: [...subjectiveFields],
      additionalProperties: false,
    },
    nextQuestionTarget: {
      type: ["string", "null"],
      enum: [
        "identity",
        "consent",
        "safety",
        "chiefConcern",
        "location",
        "severityNrs",
        "onset",
        "functionalImpact",
        "mood",
        "summary",
        null,
      ],
    },
    missingFields: { type: "array", items: { type: "string" } },
    safetyFlags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["suicide", "neurological", "respiratory", "delirium"] },
          severity: { type: "string", enum: ["high", "medium"] },
          evidence: { type: "string" },
        },
        required: ["type", "severity", "evidence"],
        additionalProperties: false,
      },
    },
    sessionAction: { type: "string", enum: ["continue", "pause", "handoff", "complete"] },
  },
  required: [
    "patientReply",
    "speechText",
    "conversationState",
    "subjectivePatch",
    "nextQuestionTarget",
    "missingFields",
    "safetyFlags",
    "sessionAction",
  ],
  additionalProperties: false,
} as const;

const systemInstructions = `
당신은 노인 환자의 상태 정보를 수집하는 의료 보조 챗봇이다.

핵심 규칙:
1. 한 번에 질문 하나만 한다.
2. 환자가 말한 내용만 subjectivePatch에 기록하고, 모르는 정보는 null로 둔다.
3. 환자가 말하지 않은 증상이나 수치를 추정하지 않는다.
4. 자살, 호흡 곤란, 급성 혼란, 갑작스러운 신경학적 변화가 의심되면 일반 질문을 중단하고 SAFETY_HOLD와 handoff로 전환한다.
5. 진단, 처방, 약물 변경을 확정하지 않는다.
6. 환자에게 보여줄 문장은 쉽고 짧은 한국어로 작성한다.
7. 출력은 반드시 제공된 JSON Schema를 따른다.
`;

function buildInput(input: ChatbotTurnInput): string {
  const context: ChatbotContext = input.context;
  return JSON.stringify(
    {
      conversationState: context.state,
      subjective: context.subjective,
      safetyFlags: context.safetyFlags,
      recentMessages: context.messages.slice(-8),
      patientText: input.patientText,
    },
    null,
    2,
  );
}

function removeNullSubjectiveValues(patch: Record<string, unknown>): Partial<SubjectiveData> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)) as Partial<SubjectiveData>;
}

export class OpenAiChatbotProvider implements ChatbotProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options?: { client?: OpenAI; model?: string }) {
    this.client = options?.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = options?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }

  async runTurn(input: ChatbotTurnInput): Promise<ChatbotTurnOutput> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: systemInstructions,
      input: buildInput(input),
      text: {
        format: {
          type: "json_schema",
          name: "chatbot_turn",
          strict: true,
          schema: chatbotTurnSchema,
        },
      },
    });

    if (!response.output_text) {
      throw new Error("OpenAI 응답에 출력 텍스트가 없습니다.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new Error("OpenAI 응답 JSON을 파싱할 수 없습니다.");
    }

    validateChatbotTurnOutput(parsed);
    parsed.subjectivePatch = removeNullSubjectiveValues(parsed.subjectivePatch as Record<string, unknown>);
    return parsed;
  }
}
