import type { CameraReport } from "./report";
import { assertSupabaseResult, getSupabaseAdmin, isSupabaseConfigured, requireProductionStorage } from "../supabase/server";

// 로컬에서는 메모리를, 배포 환경에서는 Supabase를 사용해 환자별 최신 카메라 결과를 보관한다.
// 개발 서버의 코드 재로딩 때도 유지되도록 globalThis에 둔다.
const store: Map<string, CameraReport & { receivedAt: string }> =
  ((globalThis as Record<string, unknown>).__cameraReports as Map<string, CameraReport & { receivedAt: string }>) ??
  new Map();
(globalThis as Record<string, unknown>).__cameraReports = store;

/** 최신 결과로 저장한다. 네트워크 지연으로 더 오래된 측정이 늦게 도착하면 무시한다(예: 끈 뒤에 도착한 측정값). */
export async function saveCameraReport(report: CameraReport): Promise<boolean> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const { data: existing, error: readError } = await supabase.from("camera_reports").select("measured_at").eq("patient_id", report.patientId).maybeSingle();
    assertSupabaseResult(readError);
    if (existing && Date.parse(existing.measured_at) > Date.parse(report.measuredAt)) return false;
    const receivedAt = new Date().toISOString();
    const { error } = await supabase.from("camera_reports").upsert({ patient_id: report.patientId, report, measured_at: report.measuredAt, received_at: receivedAt });
    assertSupabaseResult(error);
    return true;
  }
  const existing = store.get(report.patientId);
  if (existing && Date.parse(existing.measuredAt) > Date.parse(report.measuredAt)) return false;
  store.set(report.patientId, { ...report, receivedAt: new Date().toISOString() });
  return true;
}

export async function getCameraReport(patientId: string): Promise<(CameraReport & { receivedAt: string }) | null> {
  requireProductionStorage();
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseAdmin().from("camera_reports").select("report, received_at").eq("patient_id", patientId).maybeSingle();
    assertSupabaseResult(error);
    return data ? { ...(data.report as CameraReport), receivedAt: data.received_at } : null;
  }
  return store.get(patientId) ?? null;
}

export function clearCameraReports(): void {
  store.clear();
}
