import { NextResponse } from "next/server";
import { isDemoPatient } from "./camera/report";

// 데모 전용 API 공통 제한 (카메라 표정 결과, 복약 기록).
// 아직 로그인/기관 권한이 없어서 환자 소유권을 확인할 수 없으므로
// ① 등록된 데모 환자만 받고 ② 배포(production)에서는 CAMERA_DEMO_MODE=true일 때만 켠다.
// 실제 환자 데이터를 다루려면 세션/기관 권한으로 patientId 접근 권한을 확인하도록 바꿔야 한다.
export function demoModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.CAMERA_DEMO_MODE === "true";
}

/** 막아야 하면 에러 응답, 통과하면 null */
export function demoGuard(patientId: string | null | undefined): NextResponse | null {
  if (!demoModeEnabled()) {
    return NextResponse.json({ error: "데모 모드에서만 사용할 수 있습니다." }, { status: 404 });
  }
  if (!patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  if (!isDemoPatient(patientId)) {
    return NextResponse.json({ error: "데모 환자만 사용할 수 있습니다." }, { status: 403 });
  }
  return null;
}
