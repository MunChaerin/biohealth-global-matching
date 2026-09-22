r"""
카메라 기반 표정 분석 - 랜드마크/규칙 기반 버전 (v1, 직접 설계)
담당: 김도현 (카메라 관련 모델 개발)

배경
- 사전학습 FER 모델(emotion_trend_tracker.py)은 조명에 민감하고 오분류가 잦아 채택 보류.
- 이 버전은 MediaPipe FaceMesh(468/478 랜드마크)로 "표정이 얼마나 변하고 있는지"를 먼저
  정량화하고, 그 변화 방향을 통증/불안/무기력/평온 프록시로 해석한다.
- "표정 변화가 있는지 없는지"를 가장 먼저 보자는 방향에 맞춰, expression_activity(전체
  변화량)를 핵심 지표로 두고 세부 감정 프록시는 그 위에 얹는 구조.

*** 중요: mediapipe API 버전 이슈 ***
mediapipe 0.10.31 / 1.0.x부터 예전 방식(`mp.solutions.face_mesh`)이 완전히 제거되고
새 Tasks API(`mediapipe.tasks.python.vision.FaceLandmarker`)로 바뀌었다. 이 스크립트는
Tasks API 기준으로 작성되어 있고, 아래처럼 랜드마커 모델 파일(.task)을 별도로 받아야 한다
(예전 solutions API와 달리 모델이 패키지 안에 내장돼 있지 않음).

설치 및 모델 다운로드 (콘다 프롬프트에서, device_bash가 아니라 본인 터미널에서 실행):
    pip install mediapipe opencv-python numpy
    mkdir %USERPROFILE%\mediapipe_models
    curl -L -o %USERPROFILE%\mediapipe_models\face_landmarker.task ^
      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

    *** 반드시 사용자 홈 폴더 아래(예: C:\Users\<이름>\mediapipe_models\)에 받을 것 ***
    Windows에서 mediapipe Tasks API의 내부 C++ 로더가 경로에 한글(비-ASCII) 문자가
    섞여 있으면 파일이 실제로 존재해도 "Unable to open file" 에러를 낸다(실측 확인됨,
    2026-09-22). 이 저장소 경로 자체가 `...\바헬 글로벌 매칭\...`로 한글을 포함하므로
    모델 파일만은 이 저장소 밖, 한글 없는 경로에 둬야 한다. 스크립트는 아래 순서로
    자동으로 찾는다: ①환경변수 FACE_LANDMARKER_MODEL_PATH ②%USERPROFILE%\mediapipe_models\
    ③스크립트와 같은 폴더(경로에 한글이 없는 팀원 컴퓨터라면 이것도 가능).

사용법:
    python landmark_expression_tracker.py                       # 웹캠
    python landmark_expression_tracker.py video.mp4             # 영상 파일
    python landmark_expression_tracker.py --label frown         # 웹캠 + 라벨(찡그림)
    python landmark_expression_tracker.py video.mp4 --label sad # 영상 파일 + 라벨

    --label은 이번 실행에서 의도적으로 지어본 표정을 적어두는 용도다(예: frown, smile,
    wide_eyes). summary.json에 그대로 기록되므로, 나중에 "실제로 이 표정을 지었을 때
    규칙이 뭘로 판정했는지" 비교하며 pain/anxiety/lethargy/calm 가중치를 튜닝할 때 쓴다.

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
 입꼬리 61/291, 윗/아랫입술 중앙 13/14) - Tasks API에서도 동일한 랜드마크 번호 체계 사용.

저장 위치
    face-emotion/README.md에 정리된 것과 동일하게 runs/ 폴더에 실행별로 저장된다:
      runs/landmark_run_<타임스탬프>.jsonl
      runs/landmark_run_<타임스탬프>_summary.json
"""

import argparse
import json
import os
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision


# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
def _resolve_model_path() -> Path:
    """모델(.task) 파일 위치를 찾는다.

    Windows에서 mediapipe Tasks API의 내부 C++ 로더가 경로에 한글(비-ASCII) 문자가
    섞여 있으면 파일이 실제로 존재해도 "Unable to open file" 에러를 내는 경우가
    확인됨(이 저장소 경로 `...\\바헬 글로벌 매칭\\...`가 그 케이스). 그래서 한글이
    섞이지 않은 위치를 최우선으로 찾고, 없으면 스크립트와 같은 폴더를 본다.
    우선순위:
      1) 환경변수 FACE_LANDMARKER_MODEL_PATH
      2) <사용자 홈 폴더>/mediapipe_models/face_landmarker.task (한글 경로 회피용 권장 위치)
      3) 이 스크립트와 같은 폴더의 face_landmarker.task (경로에 비-ASCII가 없는 팀원용)
    """
    env_path = os.environ.get("FACE_LANDMARKER_MODEL_PATH")
    if env_path:
        return Path(env_path)

    home_candidate = Path.home() / "mediapipe_models" / "face_landmarker.task"
    if home_candidate.exists():
        return home_candidate

    return Path(__file__).parent / "face_landmarker.task"


MODEL_PATH = _resolve_model_path()
CALIBRATION_SEC = 5.0        # 시작 후 이 시간 동안은 기준선 수집 (환자에게 안내 문구 필요)
SAMPLE_INTERVAL_SEC = 0.5     # 랜드마크 추출은 FER보다 가벼워서 더 자주 샘플링 가능
TREND_WINDOW_SEC = 60 * 60

FLAT_ACTIVITY_THRESHOLD = 0.05   # expression_activity가 이 값 미만이면 "변화 거의 없음"
FLAT_RATIO_THRESHOLD = 0.7        # 윈도우 내 이런 프레임 비율이 이 이상이면 flat affect 플래그

RUNS_DIR = Path("runs")
RUNS_DIR.mkdir(exist_ok=True)
RUN_ID = time.strftime("%Y%m%d_%H-%M-%S")
LOG_PATH = RUNS_DIR / f"landmark_run_{RUN_ID}.jsonl"
SUMMARY_PATH = RUNS_DIR / f"landmark_run_{RUN_ID}_summary.json"

# MediaPipe Face Mesh 랜드마크 인덱스 (Tasks API도 동일한 468/478 토폴로지 사용)
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
        pain = clip01(
            max(0.0, -d["brow_gap"]) * 4       # 미간이 좁아짐 (눈썹이 서로 가까워짐)
            + max(0.0, -d["brow_raise"]) * 3    # 눈썹이 아래로 내려옴 (AU4, 찡그림의 핵심 신호)
            + max(0.0, -d["mouth_width"]) * 2   # 입이 오므라듦/힘이 들어감
        )
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


def write_summary(monitor: ExpressionMonitor, run_started_at: float, source, label: str | None) -> None:
    summary = {
        "run_id": RUN_ID,
        "source": str(source),
        "label": label,  # 테스트할 때 어떤 표정을 의도했는지(--label로 지정) - 나중에 규칙 튜닝할 때 정답지로 씀
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


def build_landmarker() -> mp_vision.FaceLandmarker:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"랜드마커 모델 파일이 없습니다: {MODEL_PATH}\n"
            "아래처럼 사용자 홈 폴더 아래(한글 경로 아닌 곳)에 받아두는 걸 권장합니다"
            "(Windows에서 경로에 한글이 섞이면 mediapipe가 파일을 못 여는 문제가 있음):\n"
            "  mkdir %USERPROFILE%\\mediapipe_models\n"
            "  curl -L -o %USERPROFILE%\\mediapipe_models\\face_landmarker.task "
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker/float16/1/face_landmarker.task"
        )
    base_options = mp_tasks.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_faces=1,
    )
    return mp_vision.FaceLandmarker.create_from_options(options)


def parse_args():
    parser = argparse.ArgumentParser(description="카메라 기반 표정 분석 (랜드마크/규칙 기반)")
    parser.add_argument(
        "source", nargs="?", default=0,
        help="영상 소스 (생략 시 웹캠, 또는 video.mp4 같은 파일 경로)",
    )
    parser.add_argument(
        "--label", default=None,
        help="이번 실행에서 의도한 표정 라벨 (예: --label frown, --label smile). "
             "summary.json에 함께 저장되어 나중에 규칙 튜닝할 때 정답지로 쓴다.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    source = args.source
    label = args.label
    cap = cv2.VideoCapture(source)

    landmarker = build_landmarker()
    monitor = ExpressionMonitor()
    run_started_at = time.time()
    last_sample_time = 0.0
    calibrating = True

    print(f"[실행 시작] 로그: {LOG_PATH}")
    print(f"[캘리브레이션] {CALIBRATION_SEC}초 동안 평상시 표정을 유지해주세요...")

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
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int((now - run_started_at) * 1000)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.face_landmarks:
                landmarks = result.face_landmarks[0]
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
        landmarker.close()
        if monitor.baseline is not None:
            write_summary(monitor, run_started_at, source, label)
        else:
            print("[경고] 캘리브레이션이 끝나기 전에 종료되어 요약을 저장하지 않음.")


if __name__ == "__main__":
    main()
