import { NextResponse } from "next/server";
import { isDemoPatient } from "../../../lib/camera/report";
import { getMotionReport, saveMotionReport } from "../../../lib/motion/motionStore";
import type { MotionReport, MotionStatus, MovementLevel } from "../../../lib/motion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(patientId: string | null) {
  if (!patientId) return NextResponse.json({ error: "patientId가 필요합니다." }, { status: 400 });
  if (!isDemoPatient(patientId)) return NextResponse.json({ error: "데모 환자만 사용할 수 있습니다." }, { status: 403 });
  return null;
}

const motionStatuses: MotionStatus[] = ["present", "noFace", "lowMovement", "still", "away", "cameraUnavailable"];
const movementLevels: MovementLevel[] = ["moving", "low", "none", "unknown"];

function isMotionReport(value: unknown): value is MotionReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<MotionReport>;
  return typeof report.patientId === "string"
    && typeof report.measuredAt === "string"
    && !Number.isNaN(Date.parse(report.measuredAt))
    && typeof report.status === "string"
    && motionStatuses.includes(report.status as MotionStatus)
    && typeof report.movementLevel === "string"
    && movementLevels.includes(report.movementLevel as MovementLevel)
    && [report.stillnessSeconds, report.absenceSeconds].every((seconds) => typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0)
    && (report.lastDetectedAt === null || typeof report.lastDetectedAt === "string")
    && (report.lastMovementAt === null || typeof report.lastMovementAt === "string")
    && typeof report.cameraConnected === "boolean";
}

export async function GET(request: Request) {
  const patientId = new URL(request.url).searchParams.get("patientId");
  const denied = guard(patientId);
  if (denied) return denied;
  return NextResponse.json({ report: getMotionReport(patientId!) });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 }); }
  if (!isMotionReport(body)) return NextResponse.json({ error: "올바른 모션 상태가 필요합니다." }, { status: 400 });
  const report = body as MotionReport;
  const denied = guard(report.patientId);
  if (denied) return denied;
  saveMotionReport(report);
  return NextResponse.json({ ok: true });
}
