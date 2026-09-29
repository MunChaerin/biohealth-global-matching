import type { CameraReport } from "./report";

// 환자별 최신 카메라 결과. 지금은 서버 메모리에만 둔다 (로컬 시연용 - 서버를 재시작하면 사라지고,
// 서버리스 배포에서는 인스턴스마다 따로 가질 수 있음). DB가 생기면 이 파일만 바꾸면 된다.
// 개발 서버의 코드 재로딩 때도 유지되도록 globalThis에 둔다.
const store: Map<string, CameraReport & { receivedAt: string }> =
  ((globalThis as Record<string, unknown>).__cameraReports as Map<string, CameraReport & { receivedAt: string }>) ??
  new Map();
(globalThis as Record<string, unknown>).__cameraReports = store;

export function saveCameraReport(report: CameraReport): void {
  store.set(report.patientId, { ...report, receivedAt: new Date().toISOString() });
}

export function getCameraReport(patientId: string): (CameraReport & { receivedAt: string }) | null {
  return store.get(patientId) ?? null;
}

export function clearCameraReports(): void {
  store.clear();
}
