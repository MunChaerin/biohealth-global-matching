export type MotionStatus = "present" | "noFace" | "lowMovement" | "still" | "away" | "cameraUnavailable";
export type MovementLevel = "moving" | "low" | "none" | "unknown";

export interface MotionThresholds {
  absenceSeconds: number;
  lowMovementSeconds: number;
  stillSeconds: number;
}

export interface MotionReport {
  patientId: string;
  measuredAt: string;
  status: MotionStatus;
  movementLevel: MovementLevel;
  stillnessSeconds: number;
  absenceSeconds: number;
  lastDetectedAt: string | null;
  lastMovementAt: string | null;
  cameraConnected: boolean;
}

export const MOTION_THRESHOLDS: MotionThresholds = {
  absenceSeconds: 30,
  lowMovementSeconds: 60,
  stillSeconds: 3 * 60,
} as const;

// 자리 비움은 화장실·검사·외출 등 정상적인 상황일 수 있으므로 자동 알림을 보내지 않는다.
// /motiontracking 화면에는 상태와 지속 시간만 표시하고, 실제 알림은 움직임 감소·장시간 정지에만 사용한다.
export const MOTION_ALERT_STATUSES: readonly MotionStatus[] = ["lowMovement", "still"];

export function shouldNotifyMotion(status: MotionStatus): boolean {
  return MOTION_ALERT_STATUSES.includes(status);
}
