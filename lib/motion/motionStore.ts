import type { MotionReport } from "./types";
import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

const root = globalThis as typeof globalThis & { __motionReports?: Map<string, MotionReport> };
// 로컬에서는 메모리를, 배포 환경에서는 Supabase를 사용한다.
const reports = root.__motionReports ??= new Map();

export async function saveMotionReport(report: MotionReport): Promise<boolean> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().rpc("save_motion_report_if_newer", {
      p_patient_id: report.patientId,
      p_report: report,
      p_measured_at: report.measuredAt,
      p_updated_at: new Date().toISOString(),
    });
    assertSupabaseResult(error);
    return data === true;
  }
  const existing = reports.get(report.patientId);
  if (existing && Date.parse(existing.measuredAt) > Date.parse(report.measuredAt)) return false;
  reports.set(report.patientId, report);
  return true;
}

export async function getMotionReport(patientId: string): Promise<MotionReport | null> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("motion_reports").select("report").eq("patient_id", patientId).maybeSingle();
    assertSupabaseResult(error);
    return data ? data.report as MotionReport : null;
  }
  return reports.get(patientId) ?? null;
}
