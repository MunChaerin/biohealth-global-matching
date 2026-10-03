r"""
알약 인식 모델 학습 + 시험 + 웹용 ONNX 내보내기
담당: 김도현 (카메라 관련 모델 개발)

환경: conda env "pill-train" (PyTorch CUDA 12.8 + ultralytics, RTX 5060 Ti)
사용법:
    conda activate pill-train
    python add_backgrounds.py --coco ...\val2017 --dataset ...\yolo_dataset          # 배경(알약 없음) 사진 넣기
    python train_pill.py --data C:\Users\DM501TGA\aihub_pill\yolo_dataset\data.yaml --from runs/pill/weights/best.pt --epochs 20
    python train_pill.py --data ... --eval-only runs/pill/weights/best.pt            # 시험만 (v1과 비교할 때)
    python train_pill.py --data ... --export-only runs/pill_v2/weights/best.pt       # 내보내기만

결과:
    runs/pill_v2/               학습 기록, 혼동행렬, best.pt (v1은 runs/pill/)
    ../../public/models/pill/   웹에서 쓰는 pill_classifier.onnx + classes.json + model-metadata.json
"""

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

HERE = Path(__file__).parent
CLASSES_JSON = HERE / "classes.json"
WEB_MODEL_DIR = HERE.parent.parent / "public" / "models" / "pill"
IMG_SIZE = 640
CONFIDENT = 0.6  # 웹(lib/pill/verdict.ts)의 CONFIDENT와 같은 값
MISMATCH_CONFIDENT = 0.9  # 웹의 MISMATCH_CONFIDENT (다른 약 판정 기준)
DETECT_MIN = 0.4  # 웹의 DETECT_MIN_CONFIDENCE
# 약별 "맞는 약" 기준. 리리베아는 글자 없는 뒷면이 독립목클린 뒷면과 똑같아서, v2가 독립목클린 뒷면을
# 리리베아로 0.70~0.78 확신했다 (리리베아 진짜 사진은 앞면 0.89~0.92, 뒷면 대부분 0.8 이상).
# v3(아이패드 후면 사진 추가)에서는 0.75: 아이패드 사진 리리베아 7/10 (0.8이면 5/10), 독립목클린을 리리베아로 받음 0/36 (0.7이면 2/36).
CLASS_CONFIDENCE = {"K-045037": 0.75}
RUN_NAME = "pill_v2"


def train(data: Path, epochs: int, start: str) -> Path:
    # v1: COCO로 미리 학습된 가장 작은 모델(yolo11n.pt)에서 시작
    # v2: v1 가중치에서 이어서, 배경(알약 없음) 사진을 섞어 추가 학습
    model = YOLO(start)
    model.train(
        data=str(data),
        epochs=epochs,
        imgsz=IMG_SIZE,
        batch=32,
        workers=4,
        project=str(HERE / "runs"),
        name=RUN_NAME,
        exist_ok=True,
        patience=8,
        seed=2026,
        # 웹캠·손 위·방 조명에 대비한 증강 (AI Hub 사진은 스튜디오 촬영이라 차이를 메우는 용도)
        hsv_h=0.02,
        hsv_s=0.5,
        hsv_v=0.5,
        degrees=180,
        translate=0.2,
        scale=0.6,
        perspective=0.0005,
        flipud=0.5,
        fliplr=0.5,
        mosaic=1.0,
        mixup=0.1,
        close_mosaic=min(10, max(1, epochs // 4)),
    )
    return HERE / "runs" / RUN_NAME / "weights" / "best.pt"


def background_false_alarms(model: YOLO, bg_dir: Path) -> dict | None:
    """알약이 없는 배경 사진(bg_test, 학습에 안 씀)에서 알약을 잘못 찾는 비율. 웹 판정 기준과 같은 문턱으로 센다."""
    images = sorted((bg_dir / "images").glob("*.jpg")) if bg_dir.exists() else []
    if not images:
        return None
    box = pill = mismatch = 0
    for image in images:
        result = model.predict(str(image), imgsz=IMG_SIZE, conf=DETECT_MIN, verbose=False)[0]
        top = max(result.boxes.conf.tolist(), default=0.0)
        box += top >= DETECT_MIN
        pill += top >= CONFIDENT
        mismatch += top >= MISMATCH_CONFIDENT
    n = len(images)
    return {
        "images": n,
        "anyBox": round(box / n, 4),  # 알약 박스가 하나라도 나옴 (화면에 "잘 모르겠어요" 등)
        "pillLevel": round(pill / n, 4),  # 맞는 약 판정 문턱(0.6)을 넘음
        "mismatchLevel": round(mismatch / n, 4),  # 다른 약 판정 문턱(0.8)을 넘음
    }


def verdict_accuracy(model: YOLO, folder: Path, classes: list[dict]) -> dict | None:
    """웹 판정 기준: 확신 기준 이상인 알약이 정확히 하나이고 그 약이 정답이면 맞음."""
    images = sorted((folder / "images").glob("*.jpg")) if folder.exists() else []
    if not images:
        return None
    per_class = Counter()
    correct = Counter()
    wrong_as = Counter()
    unsure = Counter()
    top1_as = Counter()  # 기준과 상관없이 1등 클래스가 다른 약인 경우 (같이 먹는 약끼리 착각 보기)
    for image in images:
        truth = int((folder / "labels" / f"{image.stem}.txt").read_text().split()[0])
        per_class[truth] += 1
        result = model.predict(str(image), imgsz=IMG_SIZE, conf=DETECT_MIN, verbose=False)[0]
        found = [(int(c), float(p)) for c, p in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist())]
        if found and max(found, key=lambda f: f[1])[0] != truth:
            top1_as[(truth, max(found, key=lambda f: f[1])[0])] += 1
        if len(found) == 1 and found[0][1] >= CLASS_CONFIDENCE.get(classes[found[0][0]]["code"], CONFIDENT):
            if found[0][0] == truth:
                correct[truth] += 1
            else:
                wrong_as[(truth, found[0][0])] += 1
        else:
            unsure[truth] += 1
    return {
        "verdict": {
            classes[i]["name"]: {
                "images": per_class[i],
                "correct": round(correct[i] / per_class[i], 3),
                "unsure": round(unsure[i] / per_class[i], 3),
            }
            for i in range(len(classes)) if per_class[i]
        },
        "confusions": {f"{classes[t]['name']} -> {classes[p]['name']}": n for (t, p), n in wrong_as.most_common()},
        "overall_correct": round(sum(correct.values()) / max(1, sum(per_class.values())), 4),
        "overall_wrong_pill": round(sum(wrong_as.values()) / max(1, sum(per_class.values())), 4),
        "top1Confusions": {f"{classes[t]['name']} -> {classes[p]['name']}": n for (t, p), n in top1_as.most_common()},
        # 시연에서 가장 위험한 경우: 아침·저녁에 같이 먹는 리리베아를 타이레놀로 보는 비율 (기준과 상관없이 1등 기준)
        "lyribeaAsTylenol": round(top1_as[(0, 1)] / per_class[0], 3) if per_class[0] else None,
    }


def evaluate(weights: Path, data: Path, classes: list[dict], name: str = "pill_test") -> dict:
    """시험: 검출 지표 + 웹과 같은 기준의 '판정' 정확도 (AI Hub 시험 사진 / 시연 기기로 찍은 own_test) + 배경 오인식."""
    model = YOLO(str(weights))
    metrics = model.val(data=str(data), split="test", imgsz=IMG_SIZE, plots=True, project=str(HERE / "runs"), name=name, exist_ok=True)
    root = Path(data).parent
    report = {
        "mAP50": round(float(metrics.box.map50), 4),
        "mAP50_95": round(float(metrics.box.map), 4),
        **(verdict_accuracy(model, root / "test", classes) or {}),
        "background": background_false_alarms(model, root / "bg_test"),
        "ownTest": verdict_accuracy(model, root / "own_test", classes),  # 시연 기기(아이패드 후면 등)로 찍은 사진
    }
    (HERE / "runs" / f"{name}_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


MODEL_VERSION = "pill-yolo11n-10cls-v2"


def export_for_web(weights: Path, classes: list[dict]) -> None:
    """브라우저(onnxruntime-web)용 산출물을 public/models/pill/에 둔다.

    pill_classifier.onnx  모델
    classes.json          클래스 번호 순서대로 약 코드·이름
    model-metadata.json   웹 전처리·후처리에 필요한 정보 (입력 크기, RGB, 정규화, 클래스 순서, 기준값, 날짜 등)
    """
    from datetime import date

    model = YOLO(str(weights))
    onnx_path = Path(model.export(format="onnx", imgsz=IMG_SIZE, opset=12, simplify=True, dynamic=False))
    WEB_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for old in ("pill-detector.onnx", "manifest.json"):  # 예전 이름 정리
        (WEB_MODEL_DIR / old).unlink(missing_ok=True)
    shutil.copy(onnx_path, WEB_MODEL_DIR / "pill_classifier.onnx")

    (WEB_MODEL_DIR / "classes.json").write_text(json.dumps(
        [{"index": i, "code": c["code"], "name": c["name"]} for i, c in enumerate(classes)],
        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report_path = HERE / "runs" / f"{RUN_NAME}_test_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    metadata = {
        "modelVersion": MODEL_VERSION,
        "task": "detection",
        "architecture": "YOLO11n (Ultralytics), 알약 위치 + 10종 분류",
        "file": "pill_classifier.onnx",
        "fileSizeMB": round((WEB_MODEL_DIR / "pill_classifier.onnx").stat().st_size / 1e6, 1),
        "input": {
            "name": "images",
            "shape": [1, 3, IMG_SIZE, IMG_SIZE],
            "dtype": "float32",
            "layout": "NCHW",
            "colorOrder": "RGB",
            "normalization": "픽셀값 / 255 (0~1), 평균·표준편차 정규화 없음",
            "resize": f"비율 유지 레터박스 {IMG_SIZE}x{IMG_SIZE}, 가운데 배치, 여백은 회색 (114,114,114)",
        },
        "output": {
            "name": "output0",
            "shape": [1, 4 + len(classes), 8400],
            "format": "후보 8400개 x (cx, cy, w, h [입력 픽셀 기준] + 클래스별 점수 0~1). NMS는 웹에서 (클래스 구분 없이, IoU 0.5 또는 작은 박스가 70% 이상 포함)",
        },
        "classOrder": [c["code"] for c in classes],
        "thresholds": {
            "detect": 0.4,  # 이보다 낮은 검출은 알약으로 보지 않음
            "confidence": CONFIDENT,  # 이보다 낮으면 unknown (학습하지 않은 약 억지 분류 방지)
            "stableMs": 1000,  # 같은 결과가 이만큼 이어져야 판정
            "mismatchConfidence": MISMATCH_CONFIDENT,  # 다른 약은 더 엄격하게
            "mismatchStableMs": 3000,
            "classConfidence": CLASS_CONFIDENCE,  # 약별 맞는 약 기준 (없으면 confidence)
        },
        "trainedAt": date.fromtimestamp(Path(weights).stat().st_mtime).isoformat(),
        "exportedAt": date.today().isoformat(),
        "dataset": "AI Hub 경구약제 이미지 데이터(576) 중 10종 (TS_3, VS_10) + 배경 합성. 돌린 각도 기준 학습/검증/시험 분리. "
                   "v2: COCO val2017 일상 사진을 잘라 '알약 없음'(빈 라벨)으로 학습 2,000 / 검증 200장 추가, 배경 시험 500장",
        "testMetrics": {k: report.get(k) for k in ("mAP50", "mAP50_95", "overall_correct", "overall_wrong_pill", "background", "ownTest")},
    }
    (WEB_MODEL_DIR / "model-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[웹 모델] {WEB_MODEL_DIR}")


def main():
    global RUN_NAME, MODEL_VERSION
    parser = argparse.ArgumentParser(description="알약 인식 모델 학습")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--from", dest="start", default="yolo11n.pt", help="시작 가중치 (v2는 runs/pill/weights/best.pt)")
    parser.add_argument("--export-only", type=Path, default=None)
    parser.add_argument("--eval-only", type=Path, default=None, help="시험만 (예: v1과 비교)")
    parser.add_argument("--run-name", default=RUN_NAME, help="runs/ 아래 학습 폴더 이름 (v3: pill_v3)")
    parser.add_argument("--model-version", default=MODEL_VERSION, help="model-metadata.json의 modelVersion (v3: pill-yolo11n-10cls-v3)")
    args = parser.parse_args()
    RUN_NAME, MODEL_VERSION = args.run_name, args.model_version
    classes = json.loads(CLASSES_JSON.read_text(encoding="utf-8"))["classes"]

    if args.eval_only:
        report = evaluate(args.eval_only, args.data, classes, name=f"{args.eval_only.parent.parent.name}_test")
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return
    weights = args.export_only or train(args.data, args.epochs, args.start)
    if not args.export_only:
        report = evaluate(weights, args.data, classes, name=f"{RUN_NAME}_test")
        print(json.dumps(report, ensure_ascii=False, indent=1))
    export_for_web(weights, classes)


if __name__ == "__main__":
    main()
