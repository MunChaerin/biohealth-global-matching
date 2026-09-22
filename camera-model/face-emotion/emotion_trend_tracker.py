"""
카메라 기반 감정/표정 분석 + 정서 변화 추이(trend) 프로토타입
담당: 김도현 (카메라 관련 모델 개발)

요구사항 대응
1. 표정 분석, 감정 상태 분류 -> 사전학습된 FER(Facial Expression Recognition) 모델로
   7가지 기본 감정(분노/혐오/공포/행복/슬픔/놀람/중립)을 실시간 분류(커스텀 학습 불필요)한 뒤,
   임상적으로 의미 있는 4종(통증/불안/무기력/평온)으로 프록시 환원한다.
2. 최근 일정 기간 동안의 감정 변화 비율 기록 -> 매 추론 결과를 이벤트로 로그에 저장하고,
   슬라이딩 윈도우(기본 1시간) 기준으로 카테고리별 비율을 집계한다.
3. AI Hub 감정 분류 데이터셋 -> 1차는 아래 FER 사전학습 모델로 데모하고,
   추후 한국인/일본인 대상 데이터로 파인튜닝할 때 이 스크립트의 모델 로딩부만 교체하면 됨.

중요한 한계 (docs/표정감정_설계.md 참고)
- 파킨슨 환자의 가면양 얼굴(hypomimia), 일본 문화권의 표정 표현 억제(display rule) 등
  이유로 실제 정서 상태와 무관하게 표정 변화 자체가 거의 없을 수 있다.
- 그래서 이 스크립트는 "표정 변화가 낮음" 자체를 저활성 표정(flat affect) 플래그로 별도
  탐지하고, 이 플래그가 뜨면 표정 결과만으로 판단하지 말고 챗봇 S 데이터·생체신호 O 데이터와
  반드시 교차검증하라는 신호를 이벤트에 함께 실어 보낸다.

설치:
    pip install fer opencv-python tensorflow

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
SAMPLE_INTERVAL_SEC = 2.0          # 매 프레임 분석은 과부하 -> 이 간격으로 샘플링
LOG_PATH = Path("emotion_events.jsonl")
TREND_WINDOW_SEC = 60 * 60          # 최근 1시간 기준 추이 계산 (데모 시 짧게 조정 가능)

# FER 7종 원시 신호 -> 임상 타깃 4종 프록시 매핑 (docs/표정감정_설계.md 표 참고)
PAIN_PROXY_EMOTIONS = {"angry", "disgust"}        # 미간 찌푸림 등 AU 유사성 근거
ANXIETY_PROXY_EMOTIONS = {"fear", "surprise"}
LETHARGY_PROXY_EMOTIONS = {"sad", "neutral"}
CALM_PROXY_EMOTIONS = {"happy"}

# 저활성 표정(flat affect) 판단 기준
FLAT_AFFECT_MAX_SCORE_THRESHOLD = 0.35   # 이 값보다 top emotion 확률이 낮으면 "표정이 약함"
FLAT_AFFECT_RATIO_THRESHOLD = 0.7         # 윈도우 내 이런 프레임이 이 비율 이상이면 플래그 발생


@dataclass
class EmotionMonitor:
    history: deque = field(default_factory=deque)  # (timestamp, emotion_scores dict)

    def add(self, timestamp: float, scores: dict) -> None:
        self.history.append((timestamp, scores))
        self._trim(timestamp)

    def _trim(self, now_ts: float) -> None:
        while self.history and now_ts - self.history[0][0] > TREND_WINDOW_SEC:
            self.history.popleft()

    @staticmethod
    def proxy_scores(scores: dict) -> dict:
        """FER 7종 확률 -> 통증/불안/무기력/평온 4종 프록시 점수(합산, 0~합계 범위)."""
        return {
            "pain": round(sum(scores.get(e, 0.0) for e in PAIN_PROXY_EMOTIONS), 3),
            "anxiety": round(sum(scores.get(e, 0.0) for e in ANXIETY_PROXY_EMOTIONS), 3),
            "lethargy": round(sum(scores.get(e, 0.0) for e in LETHARGY_PROXY_EMOTIONS), 3),
            "calm": round(sum(scores.get(e, 0.0) for e in CALM_PROXY_EMOTIONS), 3),
        }

    def trend_ratio(self) -> dict:
        """윈도우 내 원시 감정 평균 + 4종 프록시 평균 + 저활성 표정(flat affect) 플래그."""
        if not self.history:
            return {}

        totals: dict[str, float] = {}
        flat_count = 0
        for _, scores in self.history:
            for emo, val in scores.items():
                totals[emo] = totals.get(emo, 0.0) + val
            if max(scores.values(), default=0.0) < FLAT_AFFECT_MAX_SCORE_THRESHOLD:
                flat_count += 1

        n = len(self.history)
        avg_raw = {emo: val / n for emo, val in totals.items()}
        avg_proxy = self.proxy_scores(avg_raw)

        flat_ratio = flat_count / n
        flat_affect_flag = flat_ratio >= FLAT_AFFECT_RATIO_THRESHOLD

        result = {
            "window_sec": TREND_WINDOW_SEC,
            "sample_count": n,
            "avg_emotion_ratio_raw": {k: round(v, 3) for k, v in avg_raw.items()},
            "avg_proxy_ratio": avg_proxy,
            "flat_affect_ratio": round(flat_ratio, 3),
            "flat_affect_flag": flat_affect_flag,
        }
        if flat_affect_flag:
            # 파킨슨(가면양 얼굴) / 일본 문화권(표현 억제) 등으로 표정 자체가 약할 수 있음.
            # 표정 결과 단독으로 판단하지 말라는 명시적 경고를 이벤트에 함께 싣는다.
            result["caution"] = (
                "표정 변화가 지속적으로 낮게 관찰됨 - 표정 결과만으로 정서 상태를 단정하지 말고 "
                "챗봇 대화(S) 및 생체신호(O) 데이터와 함께 교차검증 필요"
            )
        return result


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
            proxy = EmotionMonitor.proxy_scores(scores)
            emit_event(
                "facial",
                "emotion_classified",
                {
                    "top_emotion": top_emotion,
                    "raw_scores": {k: round(v, 3) for k, v in scores.items()},
                    "proxy_scores": proxy,
                    "low_expressivity": max(scores.values(), default=0.0) < FLAT_AFFECT_MAX_SCORE_THRESHOLD,
                },
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
