import { NextResponse } from "next/server";
import { isDemoPatient } from "../../../lib/camera/report";
import { getMotionReport, saveMotionReport } from "../../../lib/motion/motionStore";
import type { MotionReport } from "../../../lib/motion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(patientId: string | null) {
  if (!patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  if (!isDemoPatient(patientId)) return NextResponse.json({ error: "데모 환자만 사용할 수 있습니다." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = guard(patientId);
  if (denied) return denied;
  return NextResponse.json({ report: getMotionReport(patientId!) });
}

export async function POST(request: Request) {
  let body: MotionReport;
  try { body = await request.json() as MotionReport; } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 }); }
  const denied = guard(body.patientId);
  if (denied) return denied;
  if (!body.measuredAt || !body.status || !body.movementLevel) return NextResponse.json({ error: "모션 상태가 필요합니다." }, { status: 400 });
  saveMotionReport(body);
  return NextResponse.json({ ok: true });
}
