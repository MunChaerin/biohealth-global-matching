import { NextResponse } from "next/server";
import { OpenAiChatbotProvider } from "../../../lib/chatbot/openaiProvider";
import { detectSafetyFlags } from "../../../lib/chatbot/safetyRules";
import type { ChatbotTurnInput } from "../../../lib/chatbot/types";

export const runtime = "nodejs";

function safetyHoldResponse(flags: ReturnType<typeof detectSafetyFlags>) {
  const reply = "지금 말씀하신 내용은 바로 확인이 필요한 신호일 수 있습니다. 일반 질문을 중단하고 의료진 또는 기관의 안전 대응 담당자에게 연결하겠습니다.";
  return {
    patientReply: reply,
    speechText: reply,
    conversationState: "SAFETY_HOLD" as const,
    subjectivePatch: {},
    missingFields: [],
    safetyFlags: flags,
    sessionAction: "handoff" as const,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatbotTurnInput;
    if (!body?.context || typeof body.patientText !== "string") {
      return NextResponse.json(
        { error: "context와 patientText가 필요합니다." },
        { status: 400 },
      );
    }

    if (body.context.state === "SAFETY_HOLD" || body.context.safetyFlags?.length) {
      return NextResponse.json({ error: "안전 대응 상태에서는 일반 대화를 계속할 수 없습니다." }, { status: 409 });
    }

    const safetyFlags = detectSafetyFlags(body.patientText);
    if (safetyFlags.length > 0) {
      return NextResponse.json(safetyHoldResponse(safetyFlags));
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 503 },
      );
    }

    const provider = new OpenAiChatbotProvider();
    const output = await provider.runTurn(body);
    return NextResponse.json(output);
  } catch (error) {
    console.error("chat api error", error);
    return NextResponse.json(
      { error: "챗봇 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
