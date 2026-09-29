"""
라벨 붙인 테스트 실행(runs/)을 현재 규칙(expression_rules.py)으로 재채점해서
"의도한 표정 -> 규칙이 판정한 상태"가 맞는지 확인하는 스크립트.
담당: 김도현 (카메라 관련 모델 개발)

사용법 (face-emotion 폴더에서):
    python evaluate_runs.py            # runs/ 안의 라벨 있는 실행 전부
    python evaluate_runs.py runs_dir   # 다른 폴더 지정

튜닝 흐름:
    1. landmark_expression_tracker.py --label <표정> 으로 표정별 테스트 실행
    2. expression_rules.py의 RULE_RANGES / 프록시 가중치 수정
    3. 이 스크립트로 재채점 -> 정답률 확인 (재녹화 불필요)

v1 로그(key_landmarks 없음)는 규칙이 달라 재채점할 수 없어서 건너뛴다.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

from expression_rules import (
    PROXY_KEYS,
    SleepDetector,
    apply_state,
    extract_metrics,
    eyes_closed,
    proxy_from_deltas,
)

# --label 값 -> 규칙이 내야 하는 dominant 상태
EXPECTED = {
    "neutral": "none",
    "frown": "pain",
    "pain": "pain",
    "smile": "calm",
    "wide_eyes": "anxiety",
    "anxiety": "anxiety",
    "droopy": "lethargy",
    "lethargy": "lethargy",
    "sleep": "sleeping",     # 눈 감고 편하게 가만히 (SLEEP_MIN_SEC 이후부터 sleeping)
}


def load_frames(jsonl_path: Path) -> tuple[list[dict], list[tuple[float, dict]]]:
    """(캘리브레이션 프레임 key_landmarks 목록, 분석 프레임 (시각(초), key_landmarks) 목록)

    시각은 evidence의 t_sec을 쓰고, 없는 예전 로그(9/29 이전)는 timestamp(초 단위)로 대신한다.
    """
    calib, frames = [], []
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            event = json.loads(line)
            evidence = event.get("evidence", {})
            if "key_landmarks" not in evidence:
                continue
            if event.get("event_type") == "calibration_sample":
                calib.append(evidence["key_landmarks"])
            elif event.get("event_type") == "landmark_expression":
                t = evidence.get("t_sec")
                if t is None:
                    t = datetime.fromisoformat(event["timestamp"]).timestamp()
                frames.append((t, evidence["key_landmarks"]))
    return calib, frames


def rescore(calib: list[dict], frames: list[tuple[float, dict]]) -> list[dict]:
    """저장된 좌표로 지표/기준선을 현재 규칙 정의대로 다시 계산해 프레임별 프록시를 낸다."""
    calib_metrics = [extract_metrics(c) for c in calib]
    baseline = {k: sum(m[k] for m in calib_metrics) / len(calib_metrics) for k in calib_metrics[0]}
    sleep = SleepDetector()
    result = []
    for t, points in frames:
        m = extract_metrics(points)
        closed = eyes_closed(m, baseline)
        proxy = proxy_from_deltas({k: m[k] - baseline[k] for k in m}, closed)
        state = sleep.update(t, closed, proxy["raw_expression"]["frown"])
        result.append(apply_state(proxy, state))
    return result


def main():
    runs_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("runs")
    rows = []
    skipped = []
    for summary_path in sorted(runs_dir.glob("landmark_run_*_summary.json")):
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        label = summary.get("label")
        if not label:
            continue
        calib, frames = load_frames(summary_path.with_name(summary_path.name.replace("_summary.json", ".jsonl")))
        if not calib or not frames:
            skipped.append(f"{summary['run_id']} ({label})")
            continue
        rows.append((summary["run_id"], label, rescore(calib, frames)))

    if skipped:
        print(f"[건너뜀 - v1 로그이거나 데이터 부족] {', '.join(skipped)}\n")
    if not rows:
        print("재채점할 수 있는 라벨 실행이 없습니다. "
              "landmark_expression_tracker.py --label <표정> 으로 새로 테스트해주세요.")
        return

    header = f"{'run_id':<20}{'label':<11}{'expected':<10}" + "".join(f"{k:>9}" for k in PROXY_KEYS)
    print(header + f"{'dominant(최다)':>16}{'정답률':>8}")
    total_hit = total_n = 0
    for run_id, label, proxies in rows:
        n = len(proxies)
        avg = {k: sum(p[k] for p in proxies) / n for k in PROXY_KEYS}
        counts = {}
        for p in proxies:
            counts[p["dominant"]] = counts.get(p["dominant"], 0) + 1
        top = max(counts, key=counts.get)
        expected = EXPECTED.get(label)
        if expected:
            hit = counts.get(expected, 0)
            total_hit += hit
            total_n += n
            acc = f"{hit / n:.0%}"
        else:
            acc = "-"
        print(f"{run_id:<20}{label:<11}{expected or '?':<10}"
              + "".join(f"{avg[k]:>9.3f}" for k in PROXY_KEYS)
              + f"{top + f' {counts[top] / n:.0%}':>16}{acc:>8}")
    if total_n:
        print(f"\n전체 프레임 정답률: {total_hit / total_n:.1%} ({total_hit}/{total_n})")


if __name__ == "__main__":
    main()
