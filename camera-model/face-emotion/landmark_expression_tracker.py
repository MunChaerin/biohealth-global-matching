"""
카메라 기반 표정 분석 - 랜드마크/규칙 기반 버전 (v1, 직접 설계)
담당: 김도현 (카메라 관련 모델 개발)

배경
- 사전학습 FER 모델(emotion_trend_tracker.py)은 조명에 민감하고 오분류가 잦아 채택 보류.
- 이 버전은 MediaPipe FaceMesh로 얼굴 468개 랜드마크를 뽑아서, "표정이 얼마나 변하고
  있는지"를 먼저 정량화하고, 그 변화 방향을 통증/불안/무기력/평온 프록시로 해석한다.
- "표정 변화가 있는지 없는지"를 가장 먼저 보자는 방향에 맞춰, expression_activity(전체
  변화량)를 핵심 지표로 두고 세부 감정 프록시는 그 위에 얹는 구조.

동작 방식
1. 시작 후 CALIBRATION_SEC 동안 "평상시(캘리브레이션) 얼굴 상태"를 평균내서 기준선으로 저장.
   (환자가 카메라 앞에서 특별한 표정을 짓지 않은 상태를 가정)
2. 이후 매 프레임마다 기준선 대비 변화량(delta)을 계산.
   - eye_open: 눈 뜬 정도 (위/아래 눈꺼풀 거리)
   - brow_raise: 눈썹이 눈에서 얼마나 떨어져 있는지 (올라갔는지)
   - brow_gap: 양쪽 눈썹 안쪽 사이 거리 (좁아지면 미간 찌푸림)
   - mouth_open: 입이 벌어진 정도
   - mouth_width: 입 좌우 폭
   - corner_y: 입꼬리 높이 (기준선보다 위로 올라가면 음수 delta = 웃는 쪽)
   모든 거리는 두 눈 바깥쪽 모서리 거리(inter-ocular distance)로 나눠서
   카메라와의 거리/얼굴 크기 차이에 영향을 덜 받게 정규화한다.
3. expression_activity = 각 delta의 절대값 합 -> "지금 표정이 기준선에서 얼마나
   벗어나 있는지"를 나타내는 단일 수치. 이게 지속적으로 낮으면 저활성 표정
   (flat affect - 파킨슨 가면양 얼굴, 문화적 표현 억제 등) 신호로 본다.
4. delta 조합으로 통증/불안/무기력/평온 프록시를 규칙 기반으로 추정한다.
   *** 주의: 이 규칙과 가중치는 1차 추정치이며 임상적으로 검증되지 않았다.
   실제 환자/배우 데이터로 튜닝이 필요하다 (개발 목록 참고). ***

랜드마크 인덱스 출처: MediaPipe Face Mesh 468/478 landmark 공개 레퍼런스
(눈 바깥쪽 33/263, 눈꺼풀 상하 159·145 / 386·374, 눈썹 안쪽 107/336,
 입꼬리 61/291, 윗/아랫입술 중앙 13/14)

설치:
    pip install mediapipe opencv-python numpy

사용법:
    python landmark_expression_tracker.py            # 웹캠
    python landmark_expression_tracker.py video.mp4  # 영상 파일

저장 위치
    face-emotion/README.md에 정리된 것과 동일하게 runs/ 폴더에 실행별로 저장된다:
      runs/landmark_run_<타임스탬프>.jsonl
      runs/landmark_run_<타임스탬프>_summary.json
"""

import sys
import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp


# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
CALIBRATION_SEC = 5.0        # 시작 후 이 시간 동안은 기준선 수집 (환자에게 안내 문구 필요)
SAMPLE_INTERVAL_SEC = 0.5     # 랜드마크 추출은 FER보다 가벼워서 더 자주 샘플링 가능
TREND_WINDOW_SEC = 60 * 60

FLAT_ACTIVITY_THRESHOLD = 0.05   # expression_activity가 이 값 미만이면 "변화 거의 없음"
FLAT_RATIO_THRESHOLD = 0.7        # 윈도우 내 이런 프레임 비율이 이 이상이면 flat affect 플래그

RUNS_DIR = Path("runs")
RUNS_DIR.mkdir(exist_ok=True)
RUN_ID = time.strftime("%Y%m%d_%H%M%S")
LOG_PATH = RUNS_DIR / f"landmark_run_{RUN_ID}.jsonl"
SUMMARY_PATH = RUNS_DIR / f"landmark_run_{RUN_ID}_summary.json"

mp_face_mesh = mp.solutions.face_mesh

# MediaPipe Face Mesh 랜드마크 인덱스
IDX_EYE_OUTER_L, IDX_EYE_OUTER_R = 33, 263          # 정규화 기준(두 눈 바깥쪽 거리)
IDX_EYE_UP_L, IDX_EYE_DOWN_L = 159, 145              # 왼쪽 눈 위/아래
IDX_EYE_UP_R, IDX_EYE_DOWN_R = 386, 374              # 오른쪽 눈 위/아래
IDX_BROW_IN_L, IDX_BROW_IN_R = 107, 336              # 눈썹 안쪽
IDX_MOUTH_L, IDX_MOUTH_R = 61, 291                   # 입꼬리
IDX_LIP_UP, IDX_LIP_DOWN = 13, 14                    # 윗/아랫입술 중앙


def _dist(a, b) -> float:
    return float(np.linalg.norm(np.array([a.x, a.y]) - np.array([b.x, b.y])))


def extract_metrics(landmarks) -> dict:
    """정규화된 얼굴 지표 딕셔너리 반환 (모두 inter-ocular distance로 나눔)."""
    iod = _dist(landmarks[IDX_EYE_OUTER_L], landmarks[IDX_EYE_OUTER_R]) + 1e-6

    eye_open = (
        _dist(landmarks[IDX_EYE_UP_L], landmarks[IDX_EYE_DOWN_L])
        + _dist(landmarks[IDX_EYE_UP_R], landmarks[IDX_EYE_DOWN_R])
    ) / (2 * iod)
    brow_raise = (
        _dist(landmarks[IDX_BROW_IN_L], landmarks[IDX_EYE_UP_L])
        + _dist(landmarks[IDX_BROW_IN_R], landmarks[IDX_EYE_UP_R])
    ) / (2 * iod)
    brow_gap = _dist(landmarks[IDX_BROW_IN_L], landmarks[IDX_BROW_IN_R]) / iod
    mouth_open = _dist(landmarks[IDX_LIP_UP], landmarks[IDX_LIP_DOWN]) / iod
    mouth_width = _dist(landmarks[IDX_MOUTH_L], landmarks[IDX_MOUTH_R]) / iod
    corner_y = ((landmarks[IDX_MOUTH_L].y + landmarks[IDX_MOUTH_R].y) / 2) / iod

    return {
        "eye_open": eye_open,
        "brow_raise": brow_raise,
        "brow_gap": brow_gap,
        "mouth_open": mouth_open,
        "mouth_width": mouth_width,
        "corner_y": corner_y,
    }


def clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


@dataclass
class ExpressionMonitor:
    baseline: dict | None = None
    calibration_samples: list = field(default_factory=list)
    history: deque = field(default_factory=deque)  # (timestamp, deltas dict, activity)

    def add_calibration_sample(self, metrics: dict) -> None:
        self.calibration_samples.append(metrics)

    def finalize_calibration(self) -> None:
        keys = self.calibration_samples[0].keys()
        self.baseline = {
            k: sum(s[k] for s in self.calibration_samples) / len(self.calibration_samples)
            for k in keys
        }

    def deltas(self, metrics: dict) -> dict:
        return {k: round(metrics[k] - self.baseline[k], 4) for k in metrics}

    def add(self, timestamp: float, deltas: dict) -> float:
        activity = sum(abs(v) for v in deltas.values())
        self.history.append((timestamp, deltas, activity))
        self._trim(timestamp)
        return activity

    def _trim(self, now_ts: float) -> None:
        while self.history and now_ts - self.history[0][0] > TREND_WINDOW_SEC:
            self.history.popleft()

    @staticmethod
    def proxy_from_deltas(d: dict) -> dict:
        """delta 조합 -> 통증/불안/무기력/평온 프록시 (1차 추정 규칙, 튜닝 필요)."""
        pain = clip01(max(0.0, -d["brow_gap"]) * 4 + max(0.0, -d["mouth_width"]) * 2)
        anxiety = clip01(max(0.0, d["eye_open"]) * 3 + max(0.0, d["brow_raise"]) * 3)
        lethargy = clip01(max(0.0, -d["eye_open"]) * 3 + max(0.0, -d["mouth_open"]) * 1)
        calm = clip01(max(0.0, -d["corner_y"]) * 4)  # 입꼬리가 기준선보다 위로 - 웃는 쪽
        return {
            "pain": round(pain, 3),
            "anxiety": round(anxiety, 3),
            "lethargy": round(lethargy, 3),
            "calm": round(calm, 3),
        }

    def trend_ratio(self) -> dict:
        if not self.history:
            return {}
        n = len(self.history)
        avg_activity = sum(a for _, _, a in self.history) / n
        flat_count = sum(1 for _, _, a in self.history if a < FLAT_ACTIVITY_THRESHOLD)
        flat_ratio = flat_count / n
        flat_flag = flat_ratio >= FLAT_RATIO_THRESHOLD

        avg_deltas = {}
        for _, d, _ in self.history:
            for k, v in d.items():
                avg_deltas[k] = avg_deltas.get(k, 0.0) + v
        avg_deltas = {k: round(v / n, 4) for k, v in avg_deltas.items()}
        avg_proxy = self.proxy_from_deltas(avg_deltas)

        result = {
            "window_sec": TREND_WINDOW_SEC,
            "sample_count": n,
            "avg_expression_activity": round(avg_activity, 4),
            "avg_deltas": avg_deltas,
            "avg_proxy_ratio": avg_proxy,
            "flat_expression_ratio": round(flat_ratio, 3),
            "flat_expression_flag": flat_flag,
        }
        if flat_flag:
            result["caution"] = (
                "표정 변화 자체가 지속적으로 거의 없음(저활성) - 파킨슨 가면양 얼굴, "
                "문화적 표현 억제 등의 가능성 - 표정 결과 단독으로 판단하지 말고 "
                "챗봇 대화(S) 및 생체신호(O) 데이터와 교차검증 필요"
            )
        return result


def emit_event(module: str, event_type: str, evidence: dict) -> None:
    event = {
        "patient_id": "demo-patient-01",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "module": module,
        "event_type": event_type,
        "evidence": evidence,
    }
    print(json.dumps(event, ensure_ascii=False))
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def write_summary(monitor: ExpressionMonitor, run_started_at: float, source) -> None:
    summary = {
        "run_id": RUN_ID,
        "source": str(source),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(run_started_at)),
        "ended_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration_sec": round(time.time() - run_started_at, 1),
        "baseline": monitor.baseline,
        "total_samples": len(monitor.history),
        "final_trend": monitor.trend_ratio(),
        "log_file": str(LOG_PATH),
    }
    with SUMMARY_PATH.open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n[요약 저장 완료] {SUMMARY_PATH}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 0
    cap = cv2.VideoCapture(source)

    monitor = ExpressionMonitor()
    run_started_at = time.time()
    last_sample_time = 0.0
    calibrating = True

    print(f"[실행 시작] 로그: {LOG_PATH}")
    print(f"[캘리브레이션] {CALIBRATION_SEC}초 동안 평상시 표정을 유지해주세요...")

    with mp_face_mesh.FaceMesh(
        max_num_faces=1, refine_landmarks=True,
        min_detection_confidence=0.5, min_tracking_confidence=0.5,
    ) as face_mesh:
        try:
            while cap.isOpened():
                ok, frame = cap.read()
                if not ok:
                    break

                now = time.time()
                if now - last_sample_time < SAMPLE_INTERVAL_SEC:
                    cv2.imshow("landmark-expression-tracker (q to quit)", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                    continue
                last_sample_time = now

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = face_mesh.process(rgb)

                if result.multi_face_landmarks:
                    landmarks = result.multi_face_landmarks[0].landmark
                    metrics = extract_metrics(landmarks)

                    if calibrating:
                        monitor.add_calibration_sample(metrics)
                        if now - run_started_at >= CALIBRATION_SEC:
                            monitor.finalize_calibration()
                            calibrating = False
                            print(f"[캘리브레이션 완료] 기준선: {monitor.baseline}")
                    else:
                        deltas = monitor.deltas(metrics)
                        activity = monitor.add(now, deltas)
                        proxy = monitor.proxy_from_deltas(deltas)

                        emit_event(
                            "facial",
                            "landmark_expression",
                            {
                                "deltas": deltas,
                                "expression_activity": round(activity, 4),
                                "low_activity_frame": activity < FLAT_ACTIVITY_THRESHOLD,
                                "proxy_scores": proxy,
                            },
                        )

                        trend = monitor.trend_ratio()
                        if trend:
                            emit_event("facial", "expression_trend_update", trend)

                cv2.imshow("landmark-expression-tracker (q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
        finally:
            cap.release()
            cv2.destroyAllWindows()
            if monitor.baseline is not None:
                write_summary(monitor, run_started_at, source)
            else:
                print("[경고] 캘리브레이션이 끝나기 전에 종료되어 요약을 저장하지 않음.")


if __name__ == "__main__":
    main()
