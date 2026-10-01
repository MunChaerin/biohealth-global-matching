import { NextResponse } from "next/server";
import { getChatSession, saveChatSession } from "../../../../lib/chatbot/sessionStore";
import type { ChatbotContext } from "../../../../lib/chatbot/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId가 필요합니다." }, { status: 400 });

  const context = getChatSession(sessionId);
  return NextResponse.json({ context: context ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const context = (await request.json()) as ChatbotContext;
    if (!context?.sessionId || !context.patientId || !Array.isArray(context.messages)) {
      return NextResponse.json({ error: "유효한 챗봇 컨텍스트가 필요합니다." }, { status: 400 });
    }
    saveChatSession(context);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "챗봇 세션을 저장하지 못했습니다." }, { status: 400 });
  }
}
