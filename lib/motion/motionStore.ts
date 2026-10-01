import type { MotionReport } from "./types";

const root = globalThis as typeof globalThis & { __motionReports?: Map<string, MotionReport> };
const reports = root.__motionReports ??= new Map();

export function saveMotionReport(report: MotionReport) {
  reports.set(report.patientId, report);
  return report;
}

export function getMotionReport(patientId: string) {
  return reports.get(patientId) ?? null;
}
