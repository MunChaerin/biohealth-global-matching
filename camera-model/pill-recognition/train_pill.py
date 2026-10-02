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
    ../../public/models/pill/   웹에서 쓰는 pill-detector.onnx + manifest.json
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


def export_for_web(weights: Path, classes: list[dict]) -> None:
    """브라우저(onnxruntime-web)용 ONNX와 manifest를 public/models/pill/에 둔다."""
    model = YOLO(str(weights))
    onnx_path = Path(model.export(format="onnx", imgsz=IMG_SIZE, opset=12, simplify=True, dynamic=False))
    WEB_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(onnx_path, WEB_MODEL_DIR / "pill-detector.onnx")
    manifest = {"model": "pill-detector.onnx", "inputSize": IMG_SIZE, "classes": [c["code"] for c in classes]}
    (WEB_MODEL_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
