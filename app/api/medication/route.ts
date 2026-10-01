import { NextResponse } from "next/server";
import { demoGuard, demoModeEnabled } from "../../../lib/demoGuard";
import { getTodayMedication, recordMismatch, recordTaken } from "../../../lib/medication/intakeStore";
import { findMedication } from "../../../lib/medication/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 데모 전용 복약 API (lib/demoGuard.ts 참고). 시각은 서버 기준으로 기록한다.

// 환자·의료진 화면이 오늘 복약 목록과 복용 여부를 가져간다.
export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = demoGuard(patientId);
  if (denied) return denied;
  return NextResponse.json(getTodayMedication(patientId!));
}

interface MedicationEventBody {
  patientId?: unknown;
  medicationId?: unknown;
  event?: unknown;
  detectedDrugCode?: unknown;
}

// event: "taken"(맞는 약 확인 후 [먹었어요]) | "mismatch"(다른 약을 비춤)
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

  if (typeof body.medicationId !== "string" || !findMedication(patientId!, body.medicationId)) {
    return NextResponse.json({ error: "이 환자의 복약 일정에 없는 약입니다." }, { status: 400 });
  }

  if (body.event === "taken") {
    recordTaken(patientId!, body.medicationId);
  } else if (body.event === "mismatch") {
    if (typeof body.detectedDrugCode !== "string" || !body.detectedDrugCode) {
      return NextResponse.json({ error: "detectedDrugCode가 필요합니다." }, { status: 400 });
    }
    recordMismatch(patientId!, body.medicationId, body.detectedDrugCode);
  } else {
    return NextResponse.json({ error: "event는 taken 또는 mismatch여야 합니다." }, { status: 400 });
  }

  return NextResponse.json(getTodayMedication(patientId!));
}
