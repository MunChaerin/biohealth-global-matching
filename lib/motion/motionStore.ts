import type { MotionReport } from "./types";

const root = globalThis as typeof globalThis & { __motionReports?: Map<string, MotionReport> };
// 로컬 시연용 저장소입니다. Vercel 배포에서 환자·의료진 간 영속 동기화가 필요하면 공유 DB/KV로 교체해야 합니다.
const reports = root.__motionReports ??= new Map();

export function saveMotionReport(report: MotionReport) {
  reports.set(report.patientId, report);
  return report;
}

export function getMotionReport(patientId: string) {
  return reports.get(patientId) ?? null;
}
