r"""
시연 기기로 직접 찍은 알약 사진(own_photos/)을 YOLO 데이터셋에 넣는다 (v3 재학습용).
담당: 김도현

사진은 웹 촬영 화면(개발 서버의 /pill-capture, 아이패드 후면 카메라 등)이나 capture_pills.py로 찍는다.
own_photos/<약 코드>/<시각>.jpg + .json (drugCode, box = 프레임 기준 정규화 [x, y, w, h]).
box가 없는 사진(찍을 때 모델이 알약 위치를 못 찾음)은 넣지 않고 개수만 알려 준다.

연속 촬영은 앞뒤 사진이 거의 같아서, 찍은 순서대로 10장씩 묶어 묶음 단위로 나눈다
(묶음 10개 중 1개는 own_test = 시연 환경 시험용, 1개는 val, 나머지는 train).
AI Hub 사진(약 17,000장)보다 훨씬 적으므로 train에는 --repeat번 반복해서 넣는다.

사용법:
    python add_own_photos.py --dataset C:\Users\DM501TGA\aihub_pill\yolo_dataset
    python train_pill.py --data ...\data.yaml --from runs/pill_v2/weights/best.pt --epochs 15 --run-name pill_v3 --model-version pill-yolo11n-10cls-v3
"""

import argparse
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
CHUNK = 10
MAX_SIDE = 1280


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--own", type=Path, default=HERE / "own_photos")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=3, help="train에 반복해서 넣는 횟수")
    args = parser.parse_args()

    classes = [c["code"] for c in json.loads((HERE / "classes.json").read_text(encoding="utf-8"))["classes"]]
    splits = {name: (args.dataset / name / "images", args.dataset / name / "labels") for name in ("train", "val", "own_test")}
    for images, labels in splits.values():
        images.mkdir(parents=True, exist_ok=True)
        labels.mkdir(parents=True, exist_ok=True)
        for old in list(images.glob("own_*")) + list(labels.glob("own_*")):
            old.unlink()

    summary = {}
    for code_dir in sorted(p for p in args.own.iterdir() if p.is_dir()):
        metas = []
        for meta_path in sorted(code_dir.glob("*.json")):
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("drugCode") in classes and meta_path.with_suffix(".jpg").exists():
                metas.append((meta_path, meta))
        with_box = [(p, m) for p, m in metas if m.get("box")]
        counts = {"photos": len(metas), "noBox": len(metas) - len(with_box), "train": 0, "val": 0, "own_test": 0}
        for i, (meta_path, meta) in enumerate(with_box):
            chunk = i // CHUNK
            split = "own_test" if chunk % 10 == 0 else "val" if chunk % 10 == 5 else "train"
            image = Image.open(meta_path.with_suffix(".jpg")).convert("RGB")
            scale = min(1.0, MAX_SIDE / max(image.size))
            if scale < 1:
                image = image.resize((round(image.width * scale), round(image.height * scale)), Image.BILINEAR)
            x, y, w, h = meta["box"]
            line = f"{classes.index(meta['drugCode'])} {x + w / 2:.6f} {y + h / 2:.6f} {w:.6f} {h:.6f}\n"
            images, labels = splits[split]
            for r in range(args.repeat if split == "train" else 1):
                name = f"own_{meta['drugCode']}_{meta_path.stem}_{r}"
                image.save(images / f"{name}.jpg", quality=92)
                (labels / f"{name}.txt").write_text(line)
            counts[split] += 1
        summary[code_dir.name] = counts
        print(f"{code_dir.name}: 사진 {counts['photos']}장 (위치 없음 {counts['noBox']}) -> train {counts['train']} x{args.repeat} / val {counts['val']} / own_test {counts['own_test']}")
    (args.dataset / "own_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    for cache in args.dataset.glob("*/labels.cache"):
        cache.unlink()  # 라벨이 바뀌었으므로 YOLO 캐시를 지운다


if __name__ == "__main__":
    main()
