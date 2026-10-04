import { NextResponse } from "next/server";
import { deleteChatSession, getChatSession, saveChatSession } from "../../../../lib/chatbot/sessionStore";
import type { ChatbotContext } from "../../../../lib/chatbot/types";
import { demoGuard } from "../../../../lib/demoGuard";
import { getChatSessionId } from "../../../../lib/chatbot/soapDraft";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId가 필요합니다." }, { status: 400 });

  const context = await getChatSession(sessionId);
  return NextResponse.json({ context: context ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const context = (await request.json()) as ChatbotContext;
    if (!context?.sessionId || !context.patientId || !Array.isArray(context.messages)) {
      return NextResponse.json({ error: "유효한 챗봇 컨텍스트가 필요합니다." }, { status: 400 });
    }
    await saveChatSession(context);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "챗봇 세션을 저장하지 못했습니다." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { patientId?: string; sessionId?: string };
    const denied = demoGuard(body.patientId);
    if (denied) return denied;
    if (!body.sessionId || body.sessionId !== getChatSessionId(body.patientId!)) {
      return NextResponse.json({ error: "유효한 데모 세션이 필요합니다." }, { status: 400 });
    }
    await deleteChatSession(body.sessionId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "챗봇 세션을 초기화하지 못했습니다." }, { status: 400 });
  }
}
