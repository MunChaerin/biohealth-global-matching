"""
자세 변화 / 낙상 감지 프로토타입
담당: 김도현 (카메라 관련 모델 개발)

- MediaPipe Pose로 실시간 keypoint 추출 (별도 학습 불필요)
- 장시간 동일 자세 유지 감지 -> "체위 변경 알림" 이벤트
- 급격한 자세 붕괴(몸통 각도 + 무게중심 급락) 감지 -> "낙상 의심" 이벤트

실행 전 설치:
    pip install mediapipe opencv-python numpy

사용법:
    python posture_fall_detector.py            # 웹캠 사용
    python posture_fall_detector.py video.mp4  # 영상 파일 사용
"""

import sys
import time
import json
import math
from collections import deque

import cv2
import numpy as np
import mediapipe as mp


# ---------------------------------------------------------------------------
# 설정값 (임계값은 실제 침상/카메라 환경에 맞춰 튜닝 필요)
# ---------------------------------------------------------------------------
SAME_POSTURE_MOVEMENT_THRESHOLD = 0.015   # 정규화 좌표 기준, 이보다 작은 변화는 "정지"로 간주
SAME_POSTURE_DURATION_SEC = 60 * 30       # 30분 이상 정지 시 체위 변경 알림 (데모에서는 짧게 조정)
FALL_TORSO_ANGLE_DEG = 45                 # 몸통이 수평에 가까워지는 각도 기준
FALL_HIP_DROP_THRESHOLD = 0.25            # 짧은 시간 내 엉덩이 y좌표 급락 기준(정규화 좌표)
FALL_WINDOW_SEC = 1.5                     # 이 시간 안에 급락이 발생하면 낙상 후보
FALL_CONFIRM_STILL_SEC = 5                # 낙상 후보 이후 이 시간 동안 움직임 없으면 확정

mp_pose = mp.solutions.pose


def now() -> float:
    return time.time()


def emit_event(event_type: str, confidence: float, evidence: dict, urgent: bool):
    """실제로는 FastAPI 엔드포인트로 POST. 프로토타입에서는 표준 이벤트 스키마로 출력만 한다."""
    event = {
        "patient_id": "demo-patient-01",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "module": "posture",
        "event_type": event_type,
        "confidence": round(confidence, 3),
        "evidence": evidence,
        "requires_immediate_alert": urgent,
    }
    print(json.dumps(event, ensure_ascii=False))


def landmark_to_xy(landmark) -> np.ndarray:
    return np.array([landmark.x, landmark.y])


def torso_angle_deg(shoulder_mid: np.ndarray, hip_mid: np.ndarray) -> float:
    """몸통 벡터(어깨중점 -> 엉덩이중점)가 수직선과 이루는 각도. 0도=수직(서있음/누움 기준 조정 필요), 90도=수평."""
    vec = hip_mid - shoulder_mid
    vertical = np.array([0.0, 1.0])
    cos_theta = np.dot(vec, vertical) / (np.linalg.norm(vec) * np.linalg.norm(vertical) + 1e-9)
    angle = math.degrees(math.acos(np.clip(cos_theta, -1.0, 1.0)))
    return angle


class PostureFallMonitor:
    def __init__(self):
        self.last_keypoints: np.ndarray | None = None
        self.still_since: float | None = None
        self.same_posture_alerted = False

        self.hip_history: deque[tuple[float, float]] = deque()  # (timestamp, hip_y)
        self.fall_candidate_time: float | None = None
        self.fall_confirmed = False

    def update(self, landmarks) -> None:
        keypoints = np.array([landmark_to_xy(lm) for lm in landmarks])
        t = now()

        shoulder_mid = (landmark_to_xy(landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER])
                         + landmark_to_xy(landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER])) / 2
        hip_mid = (landmark_to_xy(landmarks[mp_pose.PoseLandmark.LEFT_HIP])
                   + landmark_to_xy(landmarks[mp_pose.PoseLandmark.RIGHT_HIP])) / 2

        self._check_same_posture(keypoints, t)
        self._check_fall(shoulder_mid, hip_mid, t)

        self.last_keypoints = keypoints

    # -- 동일 자세 유지 -----------------------------------------------------
    def _check_same_posture(self, keypoints: np.ndarray, t: float) -> None:
        if self.last_keypoints is None:
            self.still_since = t
            return

        movement = np.mean(np.linalg.norm(keypoints - self.last_keypoints, axis=1))

        if movement < SAME_POSTURE_MOVEMENT_THRESHOLD:
            if self.still_since is None:
                self.still_since = t
            elif not self.same_posture_alerted and (t - self.still_since) >= SAME_POSTURE_DURATION_SEC:
                emit_event(
                    "posture_alert",
                    confidence=1.0 - min(movement / SAME_POSTURE_MOVEMENT_THRESHOLD, 1.0),
                    evidence={"still_duration_sec": round(t - self.still_since, 1), "movement": round(float(movement), 5)},
                    urgent=False,
                )
                self.same_posture_alerted = True
        else:
            self.still_since = t
            self.same_posture_alerted = False

    # -- 낙상 감지 -----------------------------------------------------------
    def _check_fall(self, shoulder_mid: np.ndarray, hip_mid: np.ndarray, t: float) -> None:
        self.hip_history.append((t, float(hip_mid[1])))
        while self.hip_history and t - self.hip_history[0][0] > FALL_WINDOW_SEC:
            self.hip_history.popleft()

        angle = torso_angle_deg(shoulder_mid, hip_mid)

        if len(self.hip_history) >= 2:
            hip_drop = self.hip_history[-1][1] - self.hip_history[0][1]
        else:
            hip_drop = 0.0

        candidate = angle >= FALL_TORSO_ANGLE_DEG and hip_drop >= FALL_HIP_DROP_THRESHOLD

        if candidate and self.fall_candidate_time is None and not self.fall_confirmed:
            self.fall_candidate_time = t
            emit_event(
                "fall_candidate",
                confidence=min(angle / 90, 1.0),
                evidence={"torso_angle_deg": round(angle, 1), "hip_drop": round(hip_drop, 3)},
                urgent=False,
            )

        if self.fall_candidate_time is not None and not self.fall_confirmed:
            still_movement = (
                self.last_keypoints is not None
                and np.mean(np.linalg.norm(hip_mid - self.last_keypoints[mp_pose.PoseLandmark.LEFT_HIP.value:mp_pose.PoseLandmark.LEFT_HIP.value + 1], axis=1)) < SAME_POSTURE_MOVEMENT_THRESHOLD
            )
            if t - self.fall_candidate_time >= FALL_CONFIRM_STILL_SEC:
                emit_event(
                    "fall_detected",
                    confidence=0.9,
                    evidence={"torso_angle_deg": round(angle, 1), "hip_drop": round(hip_drop, 3)},
                    urgent=True,
                )
                self.fall_confirmed = True


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 0
    cap = cv2.VideoCapture(source)

    monitor = PostureFallMonitor()

    with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
        while cap.isOpened():
            ok, frame = cap.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)

            if result.pose_landmarks:
                monitor.update(result.pose_landmarks.landmark)
                mp.solutions.drawing_utils.draw_landmarks(
                    frame, result.pose_landmarks, mp_pose.POSE_CONNECTIONS
                )

            cv2.imshow("posture-fall-detector (q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
