import { NextResponse } from "next/server";
import { isDemoPatient, validateCameraReport } from "../../../lib/camera/report";
import { getCameraReport, saveCameraReport } from "../../../lib/camera/reportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 데모 전용 API. 아직 로그인/기관 권한이 없어서 환자 소유권을 확인할 수 없으므로
// ① 등록된 데모 환자만 받고 ② 배포(production)에서는 CAMERA_DEMO_MODE=true일 때만 켠다.
// 실제 환자 데이터를 다루려면 세션/기관 권한으로 patientId 접근 권한을 확인하도록 바꿔야 한다.
function demoModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.CAMERA_DEMO_MODE === "true";
}

function guard(patientId: string | null): NextResponse | null {
  if (!demoModeEnabled()) {
    return NextResponse.json({ error: "카메라 API는 데모 모드에서만 사용할 수 있습니다." }, { status: 404 });
  }
  if (!patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  if (!isDemoPatient(patientId)) {
    return NextResponse.json({ error: "데모 환자만 사용할 수 있습니다." }, { status: 403 });
  }
  return null;
}

// 환자 화면이 표정 판정 결과(숫자)만 보낸다. 얼굴 영상/좌표는 받지 않는다.
export async function POST(request: Request) {
  if (!demoModeEnabled()) return guard(null)!;

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

  const denied = guard(body.patientId);
  if (denied) return denied;

  saveCameraReport(body);
  return NextResponse.json({ ok: true });
}

// 의료진 화면이 환자의 최신 결과를 가져간다. 아직 보고가 없으면 report: null.
export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = guard(patientId);
  if (denied) return denied;
  return NextResponse.json({ report: getCameraReport(patientId!) });
}
