import { NextResponse } from "next/server";
import { validateCameraReport } from "../../../lib/camera/report";
import { getCameraReport, saveCameraReport } from "../../../lib/camera/reportStore";
import { demoGuard, demoModeEnabled } from "../../../lib/demoGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 데모 전용 API (lib/demoGuard.ts 참고)

// 환자 화면이 표정 판정 결과(숫자)만 보낸다. 얼굴 영상/좌표는 받지 않는다.
export async function POST(request: Request) {
  if (!demoModeEnabled()) return demoGuard(null)!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  try {
    validateCameraReport(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const denied = demoGuard(body.patientId);
  if (denied) return denied;

  saveCameraReport(body);
  return NextResponse.json({ ok: true });
}

// 의료진 화면이 환자의 최신 결과를 가져간다. 아직 보고가 없으면 report: null.
export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = demoGuard(patientId);
  if (denied) return denied;
  return NextResponse.json({ report: getCameraReport(patientId!) });
}
