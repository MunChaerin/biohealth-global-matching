import { NextResponse } from "next/server";
import { getCareExplanation, saveCareExplanation } from "../../../../lib/care/careStore";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId가 필요합니다." }, { status: 400 });
  return NextResponse.json({ explanation: getCareExplanation(sessionId) });
}

export async function POST(request: Request) {
  const body = await request.json() as { sessionId?: string; text?: string; language?: "ko" | "ja" };
  if (!body.sessionId || !body.text?.trim()) return NextResponse.json({ error: "sessionId와 설명이 필요합니다." }, { status: 400 });
  const explanation = saveCareExplanation({ sessionId: body.sessionId, text: body.text.trim(), language: body.language ?? "ko", updatedAt: new Date().toISOString() });
  return NextResponse.json({ explanation });
}
