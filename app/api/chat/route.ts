import { NextResponse } from "next/server";
import { OpenAiChatbotProvider } from "../../../lib/chatbot/openaiProvider";
import type { ChatbotTurnInput } from "../../../lib/chatbot/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as ChatbotTurnInput;
    if (!body?.context || typeof body.patientText !== "string") {
      return NextResponse.json(
        { error: "context와 patientText가 필요합니다." },
        { status: 400 },
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
