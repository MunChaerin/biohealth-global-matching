import OpenAI from "openai";
import { validateChatbotTurnOutput } from "./schemas";
import type {
  ChatLanguage,
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
6. 환자에게 보여줄 문장은 현재 응답 언어 규칙에 맞춰 쉽고 짧게 작성한다.
7. 출력은 반드시 제공된 JSON Schema를 따른다.
8. patientReply에 환자의 말을 그대로 반복하지 않는다. 이번 답변에서 확인된 내용은 subjectivePatch에 기록하고, patientReply에는 공감 표현 한 문장과 다음 미수집 항목을 묻는 질문 하나만 쓴다.
9. 예: 환자가 "허리 아파"라고 답하면 chiefConcern에 기록하고 "허리가 불편하시군요. 어느 부위가 가장 아픈가요?"처럼 다음 질문을 한다.
`;

const languageInstructions: Record<ChatLanguage, string> = {
  ko: "응답 언어는 한국어다. patientReply와 speechText의 모든 문장을 쉽고 짧은 한국어로 작성한다.",
  ja: "応答言語は日本語です。patientReplyとspeechTextのすべての文を、やさしく短い日本語だけで作成してください。韓国語を混ぜないでください。医療用語は避けてください。",
};

const questionByTarget: Record<string, string> = {
  identity: "본인이 맞는지 확인해도 될까요?",
  consent: "현재 상태에 대해 몇 가지 질문을 드려도 될까요?",
  safety: "지금 당장 급하게 도움이 필요한 증상이 있나요?",
  chiefConcern: "오늘 가장 불편한 점은 무엇인가요?",
  location: "불편함은 어느 부위에서 느껴지나요?",
  severityNrs: "불편한 정도를 0에서 10 사이 숫자로 말씀해 주시겠어요?",
  onset: "그 증상은 언제부터 시작됐나요?",
  functionalImpact: "그 증상 때문에 일상생활에서 어려운 점이 있나요?",
  mood: "최근 기분이나 의욕에 변화가 있었나요?",
  summary: "지금까지 말씀하신 내용을 정리해드려도 될까요?",
};

const japaneseQuestionByTarget: Record<string, string> = {
  identity: "ご本人であることを確認してもよろしいですか？",
  consent: "今の状態について、いくつか質問してもよろしいですか？",
  safety: "今すぐ助けが必要な症状はありますか？",
  chiefConcern: "今日、いちばんつらいことは何ですか？",
  location: "そのつらさは、どのあたりで感じますか？",
  severityNrs: "つらさを0から10で表すと、どのくらいですか？",
  onset: "その症状はいつから始まりましたか？",
  functionalImpact: "その症状で、日常生活に困っていることはありますか？",
  mood: "最近、気分や意欲に変化はありましたか？",
  summary: "ここまでのお話をまとめてもよろしいですか？",
};

function normalizedText(value: string): string {
  return value.replace(/[\s.,!?~"'’“”]/g, "").toLowerCase();
}

export function preventPatientEcho(
  output: ChatbotTurnOutput,
  patientText: string,
  language: ChatLanguage = "ko",
): ChatbotTurnOutput {
  const reply = normalizedText(output.patientReply);
  const patient = normalizedText(patientText);
  if (!patient || reply !== patient) {
    return { ...output, speechText: output.patientReply };
  }

  const fallback = output.nextQuestionTarget
    ? (language === "ja" ? japaneseQuestionByTarget[output.nextQuestionTarget] : questionByTarget[output.nextQuestionTarget])
    : undefined;
  const patientReply = fallback ?? (language === "ja" ? "お話しいただいた内容を確認しました。もう少し詳しく教えてください。" : "말씀해 주신 내용을 확인했습니다. 조금 더 자세히 말씀해 주시겠어요?");
  return { ...output, patientReply, speechText: patientReply };
}

function buildInput(input: ChatbotTurnInput): string {
  const context: ChatbotContext = input.context;
  return JSON.stringify(
    {
      conversationState: context.state,
      subjective: context.subjective,
      safetyFlags: context.safetyFlags,
      recentMessages: context.messages.slice(-8),
      patientText: input.patientText,
      language: context.language ?? "ko",
      personaSummary: context.personaSummary,
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
      instructions: `${systemInstructions}\n\n현재 응답 언어 규칙: ${languageInstructions[input.context.language ?? "ko"]}`,
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
    return preventPatientEcho(parsed, input.patientText, input.context.language ?? "ko");
  }
}
