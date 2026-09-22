"""
카메라 기반 감정/표정 분석 + 정서 변화 추이(trend) 프로토타입
담당: 김도현 (카메라 관련 모델 개발)

요구사항 대응
1. 표정 분석, 감정 상태 분류 -> 사전학습된 FER(Facial Expression Recognition) 모델로
   7가지 기본 감정(분노/혐오/공포/행복/슬픔/놀람/중립)을 실시간 분류 (커스텀 학습 불필요)
2. 최근 일정 기간 동안의 감정 변화 비율 기록 -> 매 추론 결과를 이벤트로 로그에 저장하고,
   슬라이딩 윈도우(예: 최근 1시간/오늘 하루) 기준으로 감정별 비율을 집계
3. AI Hub 감정 분류 데이터셋 -> 1차는 아래 FER 사전학습 모델로 데모하고,
   추후 한국인 대상 데이터로 파인튜닝할 때 이 스크립트의 모델 로딩부만 교체하면 됨

설치:
    pip install fer opencv-python pandas tensorflow

사용법:
    python emotion_trend_tracker.py            # 웹캠
    python emotion_trend_tracker.py video.mp4  # 영상 파일
"""

import sys
import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import cv2
from fer import FER


# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
SAMPLE_INTERVAL_SEC = 2.0        # 매 프레임 분석은 과부하 -> 이 간격으로 샘플링
LOG_PATH = Path("emotion_events.jsonl")
TREND_WINDOW_SEC = 60 * 60        # 최근 1시간 기준 추이 계산 (데모 시 짧게 조정 가능)

# 기본 7 감정 -> 임상적으로 의미 있는 프록시로 매핑 (설계 문서 3장 참고)
ANXIETY_PROXY_EMOTIONS = {"fear", "surprise"}
LETHARGY_PROXY_EMOTIONS = {"sad", "neutral"}


@dataclass
class EmotionMonitor:
    history: deque = field(default_factory=deque)  # (timestamp, emotion_scores dict)

    def add(self, timestamp: float, scores: dict) -> None:
        self.history.append((timestamp, scores))
        self._trim(timestamp)

    def _trim(self, now_ts: float) -> None:
        while self.history and now_ts - self.history[0][0] > TREND_WINDOW_SEC:
            self.history.popleft()

    def trend_ratio(self) -> dict:
        """윈도우 내 감정별 평균 점수 비율 + 불안/무기력 프록시 스코어."""
        if not self.history:
            return {}

        totals: dict[str, float] = {}
        for _, scores in self.history:
            for emo, val in scores.items():
                totals[emo] = totals.get(emo, 0.0) + val

        n = len(self.history)
        avg = {emo: val / n for emo, val in totals.items()}

        anxiety_proxy = sum(avg.get(e, 0.0) for e in ANXIETY_PROXY_EMOTIONS)
        lethargy_proxy = sum(avg.get(e, 0.0) for e in LETHARGY_PROXY_EMOTIONS)

        return {
            "window_sec": TREND_WINDOW_SEC,
            "sample_count": n,
            "avg_emotion_ratio": {k: round(v, 3) for k, v in avg.items()},
            "anxiety_proxy": round(anxiety_proxy, 3),
            "lethargy_proxy": round(lethargy_proxy, 3),
        }


def emit_event(module: str, event_type: str, evidence: dict) -> None:
    """실제로는 FastAPI로 POST. 프로토타입에서는 표준 이벤트 스키마로 JSONL 저장 + 콘솔 출력."""
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


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 0
    cap = cv2.VideoCapture(source)

    detector = FER(mtcnn=True)  # MTCNN 얼굴 검출 + 감정 분류 결합 (사전학습, 추가 학습 불필요)
    monitor = EmotionMonitor()

    last_sample_time = 0.0

    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break

        now = time.time()
        if now - last_sample_time < SAMPLE_INTERVAL_SEC:
            cv2.imshow("emotion-trend-tracker (q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            continue
        last_sample_time = now

        results = detector.detect_emotions(frame)
        if results:
            # 침상 카메라는 환자 1인 기준이므로 첫 번째 검출 결과만 사용
            scores = results[0]["emotions"]  # 예: {"angry":0.01,"happy":0.7,...}
            monitor.add(now, scores)

            top_emotion = max(scores, key=scores.get)
            emit_event(
                "facial",
                "emotion_classified",
                {"top_emotion": top_emotion, "scores": {k: round(v, 3) for k, v in scores.items()}},
            )

            trend = monitor.trend_ratio()
            if trend:
                emit_event("facial", "emotion_trend_update", trend)

        cv2.imshow("emotion-trend-tracker (q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
