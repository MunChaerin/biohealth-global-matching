import { NextResponse } from "next/server";
import { demoGuard, demoModeEnabled } from "../../../lib/demoGuard";
import { getTodayMedication, recordRecognition, recordTaken } from "../../../lib/medication/intakeStore";
import { validateRecognitionResult } from "../../../lib/pill/result";
import { setReminder } from "../../../lib/medication/reminderStore";
import { findMedication } from "../../../lib/medication/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 데모 전용 복약 API (lib/demoGuard.ts 참고). 시각은 서버 기준으로 기록한다.

// 환자·의료진 화면이 오늘 복약 목록과 복용 여부를 가져간다.
export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = demoGuard(patientId);
  if (denied) return denied;
  return NextResponse.json(await getTodayMedication(patientId!));
}

interface MedicationEventBody {
  patientId?: unknown;
  medicationId?: unknown;
  event?: unknown;
  method?: unknown;
  result?: unknown;
  time?: unknown;
  openAt?: unknown;
}

// event:
//   "taken"       [먹었어요] - method "camera"(모델이 맞는 약으로 판정) | "confirmed"(사진을 보고 환자가 확인) | "manual"(직접 기록)
//   "recognition" 알약 인식 결과 PillRecognitionResult (사진·영상 없이 판정 결과만)
//   "reminder"    의료진: 복용 시간(time)의 약 확인 자동 열림 시각(openAt "HH:MM") 변경 (medicationId 없음)
export async function POST(request: Request) {
  if (!demoModeEnabled()) return demoGuard(null)!;

  let body: MedicationEventBody;
  try {
    body = (await request.json()) as MedicationEventBody;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const patientId = typeof body.patientId === "string" ? body.patientId : null;
  const denied = demoGuard(patientId);
  if (denied) return denied;

  // 의료진 화면: 복용 시간별 약 확인 자동 열림 시각 변경
  if (body.event === "reminder") {
    if (typeof body.time !== "string" || typeof body.openAt !== "string" || !(await setReminder(patientId!, body.time, body.openAt))) {
      return NextResponse.json({ error: "time은 이 환자의 복용 시간, openAt은 HH:MM이어야 합니다." }, { status: 400 });
    }
    return NextResponse.json(await getTodayMedication(patientId!));
  }

  if (typeof body.medicationId !== "string" || !findMedication(patientId!, body.medicationId)) {
    return NextResponse.json({ error: "이 환자의 복약 일정에 없는 약입니다." }, { status: 400 });
  }

  if (body.event === "taken") {
    const method = body.method ?? "camera";
    if (method !== "camera" && method !== "confirmed" && method !== "manual") {
      return NextResponse.json({ error: "method는 camera, confirmed, manual 중 하나여야 합니다." }, { status: 400 });
    }
    await recordTaken(patientId!, body.medicationId, method);
  } else if (body.event === "recognition") {
    try {
      validateRecognitionResult(body.result);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    if (body.result.patientId !== patientId) {
      return NextResponse.json({ error: "result.patientId가 patientId와 다릅니다." }, { status: 400 });
    }
    await recordRecognition(patientId!, body.medicationId, body.result);
  } else {
    return NextResponse.json({ error: "event는 taken, recognition, reminder 중 하나여야 합니다." }, { status: 400 });
  }

  return NextResponse.json(await getTodayMedication(patientId!));
}
