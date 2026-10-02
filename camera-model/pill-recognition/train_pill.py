r"""
알약 인식 모델 학습 + 시험 + 웹용 ONNX 내보내기
담당: 김도현 (카메라 관련 모델 개발)

환경: conda env "pill-train" (PyTorch CUDA 12.8 + ultralytics, RTX 5060 Ti)
사용법:
    conda activate pill-train
    python train_pill.py --data C:\Users\DM501TGA\aihub_pill\yolo_dataset\data.yaml
    python train_pill.py --data ... --export-only runs/pill/weights/best.pt   # 내보내기만

결과:
    runs/pill/                  학습 기록, 혼동행렬, best.pt
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


def train(data: Path, epochs: int) -> Path:
    model = YOLO("yolo11n.pt")  # COCO로 미리 학습된 가장 작은 모델에서 시작
    model.train(
        data=str(data),
        epochs=epochs,
        imgsz=IMG_SIZE,
        batch=32,
        workers=4,
        project=str(HERE / "runs"),
        name="pill",
        exist_ok=True,
        patience=15,
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
        close_mosaic=10,
    )
    return HERE / "runs" / "pill" / "weights" / "best.pt"


def evaluate(weights: Path, data: Path, classes: list[dict]) -> dict:
    """시험용 사진(학습 때 안 본 각도)으로 평가: 검출 지표 + 웹과 같은 기준의 '판정' 정확도."""
    model = YOLO(str(weights))
    metrics = model.val(data=str(data), split="test", imgsz=IMG_SIZE, plots=True, project=str(HERE / "runs"), name="pill_test", exist_ok=True)

    # 웹 판정 기준: 확신 CONFIDENT 이상인 알약이 정확히 하나이고 그 약이 정답이면 맞음
    test_dir = Path(data).parent / "test"
    per_class = Counter()
    correct = Counter()
    wrong_as = Counter()
    unsure = Counter()
    for image in sorted((test_dir / "images").glob("*.jpg")):
        truth = int((test_dir / "labels" / f"{image.stem}.txt").read_text().split()[0])
        per_class[truth] += 1
        result = model.predict(str(image), imgsz=IMG_SIZE, conf=0.4, verbose=False)[0]
        found = [(int(c), float(p)) for c, p in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist())]
        if len(found) == 1 and found[0][1] >= CONFIDENT:
            if found[0][0] == truth:
                correct[truth] += 1
            else:
                wrong_as[(truth, found[0][0])] += 1
        else:
            unsure[truth] += 1

    report = {
        "mAP50": round(float(metrics.box.map50), 4),
        "mAP50_95": round(float(metrics.box.map), 4),
        "verdict": {
            classes[i]["name"]: {
                "images": per_class[i],
                "correct": round(correct[i] / per_class[i], 3) if per_class[i] else None,
                "unsure": round(unsure[i] / per_class[i], 3) if per_class[i] else None,
            }
            for i in range(len(classes))
        },
        "confusions": {f"{classes[t]['name']} -> {classes[p]['name']}": n for (t, p), n in wrong_as.most_common()},
        "overall_correct": round(sum(correct.values()) / max(1, sum(per_class.values())), 4),
        "overall_wrong_pill": round(sum(wrong_as.values()) / max(1, sum(per_class.values())), 4),
    }
    (HERE / "runs" / "pill_test_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


MODEL_VERSION = "pill-yolo11n-10cls-v1"


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

    report_path = HERE / "runs" / "pill_test_report.json"
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
            "format": "후보 8400개 x (cx, cy, w, h [입력 픽셀 기준] + 클래스별 점수 0~1). NMS는 웹에서 (클래스 구분 없이, IoU 0.5)",
        },
        "classOrder": [c["code"] for c in classes],
        "thresholds": {
            "detect": 0.4,  # 이보다 낮은 검출은 알약으로 보지 않음
            "confidence": CONFIDENT,  # 이보다 낮으면 unknown (학습하지 않은 약 억지 분류 방지)
            "stableMs": 1000,  # 같은 결과가 이만큼 이어져야 판정
        },
        "trainedAt": date.fromtimestamp(Path(weights).stat().st_mtime).isoformat(),
        "exportedAt": date.today().isoformat(),
        "dataset": "AI Hub 경구약제 이미지 데이터(576) 중 10종 (TS_3, VS_10) + 배경 합성. 돌린 각도 기준 학습/검증/시험 분리",
        "testMetrics": {k: report.get(k) for k in ("mAP50", "mAP50_95", "overall_correct", "overall_wrong_pill")},
    }
    (WEB_MODEL_DIR / "model-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[웹 모델] {WEB_MODEL_DIR}")


def main():
    parser = argparse.ArgumentParser(description="알약 인식 모델 학습")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--export-only", type=Path, default=None)
    args = parser.parse_args()
    classes = json.loads(CLASSES_JSON.read_text(encoding="utf-8"))["classes"]

    weights = args.export_only or train(args.data, args.epochs)
    if not args.export_only:
        report = evaluate(weights, args.data, classes)
        print(json.dumps(report, ensure_ascii=False, indent=1))
    export_for_web(weights, classes)


if __name__ == "__main__":
    main()
