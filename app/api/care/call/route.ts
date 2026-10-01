import { NextResponse } from "next/server";
import { acknowledgeCareCall, getCareCall, requestCareCall } from "../../../../lib/care/careStore";

export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  return NextResponse.json({ call: getCareCall(patientId) });
}

export async function POST(request: Request) {
  const body = await request.json() as { patientId?: string; sessionId?: string; action?: "request" | "acknowledge" };
  if (!body.patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  if (body.action === "acknowledge") return NextResponse.json({ call: acknowledgeCareCall(body.patientId) });
  return NextResponse.json({ call: requestCareCall(body.patientId, body.sessionId ?? "") });
}
