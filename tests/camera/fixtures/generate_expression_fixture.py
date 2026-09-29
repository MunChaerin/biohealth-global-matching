"""
tests/camera/expressionRules.test.ts가 쓰는 기대값(expressionRules.python.json)을 Python 규칙으로 만든다.
TS 규칙(lib/camera/expressionRules.ts)이 Python 프로토타입과 같은 결과를 내는지 확인하는 용도.

사용법 (Python 규칙을 바꿨으면 다시 실행해서 JSON을 갱신):
    python tests/camera/fixtures/generate_expression_fixture.py camera-model/face-emotion

얼굴 영상/실제 사람 좌표는 쓰지 않고, 정면 얼굴 좌표에 표정·고개 움직임을 합성한 값만 쓴다.
"""

import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else "camera-model/face-emotion")
from expression_rules import eyes_closed, extract_metrics, proxy_from_deltas  # noqa: E402

BASE = {
    33: (0.40, 0.40), 263: (0.60, 0.40), 133: (0.46, 0.40), 362: (0.54, 0.40),
    159: (0.43, 0.39), 145: (0.43, 0.41), 386: (0.57, 0.39), 374: (0.57, 0.41),
    107: (0.47, 0.35), 336: (0.53, 0.35), 2: (0.50, 0.49),
    61: (0.46, 0.54), 291: (0.54, 0.54), 13: (0.50, 0.535), 14: (0.50, 0.545),
}
IOD = 0.2


def express(pts, eye=0.0, brow_down=0.0, brow_in=0.0, lip_up=0.0, corner=0.0, widen=0.0):
    p = {k: list(v) for k, v in pts.items()}
    for i in (107, 336):
        p[i][1] += brow_down * IOD
    p[107][0] += brow_in * IOD / 2
    p[336][0] -= brow_in * IOD / 2
    for up, down in ((159, 145), (386, 374)):
        p[up][1] -= eye * IOD / 2
        p[down][1] += eye * IOD / 2
    p[13][1] -= lip_up * IOD
    p[14][1] -= lip_up * IOD / 2
    for i in (61, 291):
        p[i][1] -= corner * IOD
    p[61][0] -= widen * IOD / 2
    p[291][0] += widen * IOD / 2
    return p


def pose(p, dx=0.0, dy=0.0, roll=0.0):
    c, s = math.cos(roll), math.sin(roll)
    out = {}
    for k, (x, y) in p.items():
        x, y = x - 0.5, y - 0.45
        out[k] = (x * c - y * s + 0.5 + dx, x * s + y * c + 0.45 + dy)
    return out


def main():
    rng = random.Random(20260929)
    baseline = extract_metrics(BASE)
    named = {
        "neutral": {},
        "frown": dict(brow_down=0.04, brow_in=0.03, eye=-0.03, lip_up=0.02),
        "smile": dict(corner=0.05, widen=0.12, eye=-0.02),
        "wide_eyes": dict(eye=0.05, brow_up=0.0, brow_down=-0.05),
        "droopy": dict(eye=-0.05, corner=-0.04),
        "eyes_closed_relaxed": dict(eye=-0.09, brow_down=0.035, brow_in=0.02),
        "eyes_closed_frown": dict(eye=-0.09, brow_down=0.07, brow_in=0.03),
    }
    cases = []
    for name, kw in named.items():
        kw = {k: v for k, v in kw.items() if k != "brow_up"}
        cases.append((name, pose(express(BASE, **kw), 0.02, 0.03, 0.08)))
    for i in range(60):
        kw = dict(
            eye=rng.uniform(-0.1, 0.06), brow_down=rng.uniform(-0.06, 0.08), brow_in=rng.uniform(-0.02, 0.05),
            lip_up=rng.uniform(-0.02, 0.04), corner=rng.uniform(-0.06, 0.06), widen=rng.uniform(-0.05, 0.15),
        )
        cases.append((f"random_{i}", pose(express(BASE, **kw), rng.uniform(-0.05, 0.05),
                                          rng.uniform(-0.05, 0.05), rng.uniform(-0.25, 0.25))))

    out = {"baseline": {str(k): list(v) for k, v in BASE.items()}, "cases": []}
    for name, pts in cases:
        # JSON에 저장하는 좌표와 똑같은 값으로 계산해야 TS와 비교할 수 있다
        pts = {k: (round(v[0], 6), round(v[1], 6)) for k, v in pts.items()}
        m = extract_metrics(pts)
        closed = eyes_closed(m, baseline)
        proxy = proxy_from_deltas({k: m[k] - baseline[k] for k in m}, closed)
        out["cases"].append({
            "name": name,
            "points": {str(k): list(v) for k, v in pts.items()},
            "closed": closed,
            "metrics": m,
            "scores": {k: proxy[k] for k in ("pain", "anxiety", "lethargy", "calm")},
            "dominant": proxy["dominant"],
            "smile": proxy["raw_expression"]["smile"],
            "frown": proxy["raw_expression"]["frown"],
            "actions": proxy["actions"],
        })
    path = Path(__file__).with_name("expressionRules.python.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out['cases'])} cases -> {path}")


if __name__ == "__main__":
    main()
