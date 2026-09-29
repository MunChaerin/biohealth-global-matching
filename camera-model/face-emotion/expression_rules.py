"""
표정 규칙 모듈 - 랜드마크 -> 얼굴 지표 -> 통증/불안/무기력/평온 프록시
담당: 김도현 (카메라 관련 모델 개발)

landmark_expression_tracker.py(실시간 실행)와 evaluate_runs.py(저장된 로그 재채점)가
같은 규칙을 쓰도록 분리한 모듈. mediapipe/cv2 없이 numpy만으로 동작한다.

v2 규칙 (2026-09-28) - v1 테스트 로그(9/23, label별 실측)에서 확인된 문제를 반영
1. 찡그림(frown)이 pain으로 거의 안 잡힘
   - v1의 brow_raise는 "눈썹 ~ 윗눈꺼풀" 거리라서, 찡그릴 때 눈도 같이 가늘어지면
     (눈꺼풀도 같이 내려오면) 거리가 거의 안 변했다. frown 실행에서 median ±0.005 수준.
   - v2: 눈썹 높이를 "눈 안쪽 모서리를 잇는 선" 기준으로 잰다(눈꺼풀 움직임과 분리).
   - v2: 윗입술 올라감/코 찡그림(AU9/10)을 코밑~윗입술 거리(nose_lip)로 추가.
2. 처진 표정(droopy)이 anxiety로 오판
   - 눈꺼풀이 처지면 v1 brow_raise(눈썹~눈꺼풀 거리)가 오히려 커져서 anxiety 가중치를 탔다.
   - 1번과 같은 방식으로 해결(눈썹 높이를 눈꺼풀과 분리).
3. corner_y(입꼬리 높이)가 화면 절대좌표라서 고개만 움직여도 값이 변함
   - baseline이 실행마다 3.00~3.56으로 흔들렸고, neutral 실행에서도 +0.07 drift.
   - v2: corner_lift = 입 중앙(윗/아랫입술 중점) 대비 입꼬리 높이 -> 고개 위치와 무관.
4. 모든 "높이"를 두 눈 축에 수직인 방향으로 재서 고개 기울기(roll)에 덜 민감하게 함.
   또 정규화 좌표의 x에 화면 가로/세로 비율(aspect)을 곱해 가로·세로 거리 단위를 맞춤.

프록시 설계 근거: PSPI(Prkachin & Solomon Pain Intensity)
   PSPI = AU4(눈썹 내림) + max(AU6, AU7)(눈 주위 조임) + max(AU9, AU10)(코 찡그림/윗입술 올림) + AU43(눈 감음)
   - 여기서는 AU4 -> brow_lower/brow_squeeze, AU6/7/43 -> eye_narrow로 근사.
     AU9/10 -> lip_raise도 계산하지만 입을 옆으로 늘리면 같이 반응해서 판정에는 안 쓴다(v2.1).
   - 웃을 때도 AU6(눈 조임)과 눈썹 내림이 같이 나오므로, 입꼬리 웃음(AU12) 만큼 찡그림을 깎는다(v2.1).
   - 단, "눈 가늘어짐"만 있고 찡그림(AU4, AU9/10)이 없으면 통증보다는 졸림/무기력에 가깝다고
     보고, 찡그림이 있을 때만 eye_narrow가 pain 쪽으로 가도록 gate를 둔다.

*** 주의: 아래 RULE_RANGES 값은 v1 로그와 추정으로 잡은 잠정치이며 임상 검증되지 않았다.
    v2부터는 로그에 핵심 랜드마크 좌표가 저장되므로, 재녹화 없이 evaluate_runs.py로
    값을 바꿔가며 재채점해 튜닝할 수 있다. ***
"""

import numpy as np

# MediaPipe Face Mesh 랜드마크 인덱스 (Tasks API도 동일한 468/478 토폴로지 사용)
IDX_EYE_OUTER_L, IDX_EYE_OUTER_R = 33, 263          # 정규화 기준(두 눈 바깥쪽 거리) + 눈 축
IDX_EYE_INNER_L, IDX_EYE_INNER_R = 133, 362          # 눈 안쪽 모서리 (눈썹 높이 기준선)
IDX_EYE_UP_L, IDX_EYE_DOWN_L = 159, 145              # 왼쪽 눈 위/아래
IDX_EYE_UP_R, IDX_EYE_DOWN_R = 386, 374              # 오른쪽 눈 위/아래
IDX_BROW_IN_L, IDX_BROW_IN_R = 107, 336              # 눈썹 안쪽
IDX_SUBNASALE = 2                                    # 코밑 (AU9/10 기준점)
IDX_MOUTH_L, IDX_MOUTH_R = 61, 291                   # 입꼬리
IDX_LIP_UP, IDX_LIP_DOWN = 13, 14                    # 윗/아랫입술 중앙

KEY_LANDMARKS = (
    IDX_EYE_OUTER_L, IDX_EYE_OUTER_R, IDX_EYE_INNER_L, IDX_EYE_INNER_R,
    IDX_EYE_UP_L, IDX_EYE_DOWN_L, IDX_EYE_UP_R, IDX_EYE_DOWN_R,
    IDX_BROW_IN_L, IDX_BROW_IN_R, IDX_SUBNASALE,
    IDX_MOUTH_L, IDX_MOUTH_R, IDX_LIP_UP, IDX_LIP_DOWN,
)

# delta(기준선 대비 변화량, 두 눈 바깥쪽 거리 단위)를 0~1 점수로 바꾸는 구간 (lo, hi)
#   lo 미만 -> 0 (노이즈로 보고 무시), hi 이상 -> 1, 그 사이는 선형
#   lo는 v1 neutral 실행의 흔들림(p10~p90)보다 크게 잡아서 가만히 있을 때 점수가 안 뜨게 한다.
RULE_RANGES = {
    "eye_narrow":   (0.015, 0.06),   # 눈 가늘어짐/감김 (AU6/7/43)
    "eye_widen":    (0.012, 0.045),  # 눈 크게 뜸 (AU5)
    "brow_lower":   (0.010, 0.04),   # 눈썹 내려옴 (AU4)
    "brow_raise":   (0.015, 0.05),   # 눈썹 올라감 (AU1+2)
    "brow_squeeze": (0.005, 0.03),   # 미간 좁아짐 (AU4)
    "lip_raise":    (0.008, 0.03),   # 코밑~윗입술 짧아짐 (AU9/10)
    "corner_up":    (0.010, 0.04),   # 입꼬리 올라감 (AU12)
    "corner_down":  (0.010, 0.04),   # 입꼬리 내려감 (AU15)
    "mouth_widen":  (0.020, 0.10),   # 입 옆으로 벌어짐 (미소)
}

# 눈을 감으면 찡그리지 않아도 눈썹이 내려오고 미간이 좁아진다.
# (9/29 sleep 녹화: 편하게 감았을 때 brow_height -0.031~-0.041, brow_gap -0.015~-0.021
#  vs 눈 감고 찡그림 brow_height 중앙값 -0.073) -> 눈 감았을 땐 이 구간으로 판정
CLOSED_EYE_RANGES = {
    "brow_lower":   (0.045, 0.08),
    "brow_squeeze": (0.025, 0.05),
}

PROXY_KEYS = ("pain", "anxiety", "lethargy", "calm")
DOMINANT_MIN_SCORE = 0.2   # 가장 높은 프록시가 이 값 미만이면 dominant = "none"

# 수면(눈 감음) 판정 - 와상 환자는 눈 감고 있는 시간이 길어서, 이걸 따로 안 빼면
# 눈 가늘어짐 규칙 때문에 자는 동안 내내 lethargy로 기록된다.
EYE_CLOSED_RATIO = 0.4     # 눈 뜬 정도가 기준선의 이 비율 미만이면 "눈 감음"
SLEEP_MIN_SEC = 10.0       # 눈 감음이 이 시간 이상 이어지면 "sleeping" (데모용 값. 실제 운영은 수 분 권장)
SLEEP_MAX_FROWN = 0.2      # 눈 감고 찡그리는 건 통증 표정(PSPI AU43+AU4)이라 수면으로 보지 않음


def points_from_landmarks(landmarks, aspect: float) -> dict:
    """mediapipe 랜드마크 -> {인덱스: (x, y)}. x에 가로/세로 비율을 곱해 단위를 맞춘다."""
    return {i: (landmarks[i].x * aspect, landmarks[i].y) for i in KEY_LANDMARKS}


def extract_metrics(points: dict) -> dict:
    """얼굴 지표 계산. points: {인덱스: (x, y)} (points_from_landmarks 결과 또는 로그의 key_landmarks).

    모든 거리/높이는 두 눈 바깥쪽 거리(iod)로 나눠 카메라 거리 영향을 줄이고,
    "높이"는 두 눈을 잇는 축에 수직인 방향(아래쪽이 +)으로 재서 고개 기울기에 덜 민감하게 한다.
    """
    p = {int(k): np.asarray(v, dtype=float) for k, v in points.items()}
    axis = p[IDX_EYE_OUTER_R] - p[IDX_EYE_OUTER_L]
    iod = float(np.linalg.norm(axis)) + 1e-6
    down = np.array([-axis[1], axis[0]]) / iod   # 눈 축에 수직, 화면 아래쪽 방향

    def dist(a, b) -> float:
        return float(np.linalg.norm(p[a] - p[b])) / iod

    def below(a, ref) -> float:
        """a가 ref보다 (눈 축 기준) 얼마나 아래에 있는지."""
        return float(np.dot(p[a] - p[ref], down)) / iod

    eye_open = (dist(IDX_EYE_UP_L, IDX_EYE_DOWN_L) + dist(IDX_EYE_UP_R, IDX_EYE_DOWN_R)) / 2
    brow_height = (below(IDX_EYE_INNER_L, IDX_BROW_IN_L) + below(IDX_EYE_INNER_R, IDX_BROW_IN_R)) / 2
    brow_gap = dist(IDX_BROW_IN_L, IDX_BROW_IN_R)
    nose_lip = dist(IDX_SUBNASALE, IDX_LIP_UP)
    mouth_open = dist(IDX_LIP_UP, IDX_LIP_DOWN)
    mouth_width = dist(IDX_MOUTH_L, IDX_MOUTH_R)
    lip_center = (p[IDX_LIP_UP] + p[IDX_LIP_DOWN]) / 2
    corner_lift = float(np.mean([
        np.dot(lip_center - p[IDX_MOUTH_L], down),
        np.dot(lip_center - p[IDX_MOUTH_R], down),
    ])) / iod

    return {
        "eye_open": eye_open,        # 눈 뜬 정도
        "brow_height": brow_height,  # 눈 안쪽 모서리선 대비 눈썹 높이 (클수록 올라감)
        "brow_gap": brow_gap,        # 양 눈썹 안쪽 사이 거리 (작아지면 미간 찌푸림)
        "nose_lip": nose_lip,        # 코밑~윗입술 거리 (작아지면 윗입술 올림/코 찡그림)
        "mouth_open": mouth_open,    # 입 벌어진 정도
        "mouth_width": mouth_width,  # 입 좌우 폭
        "corner_lift": corner_lift,  # 입 중앙 대비 입꼬리 높이 (클수록 올라감 = 웃는 쪽)
    }


def ramp(x: float, lo: float, hi: float) -> float:
    if x <= lo:
        return 0.0
    if x >= hi:
        return 1.0
    return (x - lo) / (hi - lo)


def clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def eyes_closed(metrics: dict, baseline: dict) -> bool:
    return metrics["eye_open"] < baseline["eye_open"] * EYE_CLOSED_RATIO


def action_scores(d: dict, closed: bool = False) -> dict:
    """delta -> 개별 표정 동작(AU 유사) 점수 0~1. 프록시로 가기 전 중간 단계라 디버깅용으로도 로깅한다.
    closed=True(눈 감음)면 눈썹 관련 동작은 CLOSED_EYE_RANGES 기준으로 판정."""
    signed = {
        "eye_narrow": -d["eye_open"],
        "eye_widen": d["eye_open"],
        "brow_lower": -d["brow_height"],
        "brow_raise": d["brow_height"],
        "brow_squeeze": -d["brow_gap"],
        "lip_raise": -d["nose_lip"],
        "corner_up": d["corner_lift"],
        "corner_down": -d["corner_lift"],
        "mouth_widen": d["mouth_width"],
    }
    ranges = {**RULE_RANGES, **CLOSED_EYE_RANGES} if closed else RULE_RANGES
    return {k: round(ramp(v, *ranges[k]), 3) for k, v in signed.items()}


def proxy_from_deltas(d: dict, closed: bool = False) -> dict:
    """delta -> 통증/불안/무기력/평온 프록시 (PSPI 참고 규칙, 임상 검증 전).
    closed: 눈을 감은 프레임인지 (eyes_closed()로 계산)."""
    a = action_scores(d, closed)

    # 웃음: 입꼬리가 올라가야 인정 (입만 옆으로 벌어지는 건 처진 표정에서도 나옴 - 9/29 droopy 로그)
    smile = clip01(a["corner_up"] * (0.4 + 0.6 * a["mouth_widen"]))

    # 찡그림 강도 (AU4). lip_raise(AU9/10 근사)는 입을 옆으로 늘리기만 해도 1.0이 떠서
    # (9/29 smile/droopy 로그 거의 전 프레임) 판정에서 뺐다 - actions에는 계속 기록.
    # 진짜 웃음(뒤센 미소)은 눈이 가늘어지고 눈썹도 내려와서 찡그림처럼 보이므로 웃음만큼 깎는다.
    frown = clip01(max(a["brow_lower"], a["brow_squeeze"]) * 0.7 * (1 - smile))
    gate = min(1.0, frown * 2)   # 찡그림이 있어야 눈 가늘어짐을 통증 쪽으로 해석

    pain = clip01(frown * 0.7 + a["eye_narrow"] * gate * 0.3)
    anxiety = clip01(a["brow_raise"] * 0.5 + a["eye_widen"] * 0.5)
    lethargy = clip01(a["eye_narrow"] * (1 - gate) * 0.7 + a["corner_down"] * 0.6)
    calm = clip01(smile * (1 - frown))

    scores = {"pain": pain, "anxiety": anxiety, "lethargy": lethargy, "calm": calm}
    top = max(scores, key=scores.get)
    return {
        **{k: round(v, 3) for k, v in scores.items()},
        "dominant": top if scores[top] >= DOMINANT_MIN_SCORE else "none",
        "raw_expression": {"smile": round(smile, 3), "frown": round(frown, 3)},
        "actions": a,
    }


class SleepDetector:
    """프레임마다 상태를 돌려준다: "awake" / "eyes_closed"(감은 지 SLEEP_MIN_SEC 미만) / "sleeping".

    - 깜빡임이나 잠깐 눈 감은 건 "eyes_closed"로만 표시하고 감정 판정은 그대로 한다
      (눈 질끈 감기는 통증 신호일 수 있으므로).
    - "sleeping"이면 호출하는 쪽에서 감정 판정을 멈추고 dominant를 "sleeping"으로 둔다.
    - 캘리브레이션을 눈 감은 상태에서 하면 기준선 자체가 감은 눈이라 판정이 안 된다(알려진 한계).
    """

    def __init__(self):
        self.closed_since = None

    def update(self, t_sec: float, closed: bool, frown: float) -> str:
        if not (closed and frown < SLEEP_MAX_FROWN):
            self.closed_since = None
            return "awake"
        if self.closed_since is None:
            self.closed_since = t_sec
        return "sleeping" if t_sec - self.closed_since >= SLEEP_MIN_SEC else "eyes_closed"


def apply_state(proxy: dict, state: str) -> dict:
    """수면 중이면 감정 점수를 0으로 두고 dominant를 "sleeping"으로 바꾼다."""
    proxy["state"] = state
    if state == "sleeping":
        for k in PROXY_KEYS:
            proxy[k] = 0.0
        proxy["dominant"] = "sleeping"
    return proxy
