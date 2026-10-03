r"""
알약이 없는 배경 사진을 학습 데이터에 "알약 없음"(빈 라벨)으로 넣는다.
담당: 김도현

왜: 웹캠 테스트에서 표정 카메라에 함께 찍힌 잠옷 무늬·옷·얼굴을 알약(독립목클린 0.74~0.77, 퍼킨정 0.7대 등)으로 꾸준히 착각했다.
AI Hub 사진에는 알약 말고 다른 물체가 없어서 "이건 알약이 아니다"를 배운 적이 없기 때문이다.

배경: COCO val2017 (사람·옷·실내 등 일상 사진 5,000장, http://images.cocodataset.org/zips/val2017.zip)
웹은 화면 가운데 네모(짧은 변의 60%)만 잘라 모델에 넣으므로, 사진에서 여러 크기의 정사각형을 잘라 쓴다.
원본 사진은 학습/검증/배경시험으로 나눠 겹치지 않게 한다.

사용법:
    python add_backgrounds.py --coco C:\Users\DM501TGA\aihub_pill\negatives\val2017 --dataset C:\Users\DM501TGA\aihub_pill\yolo_dataset
결과:
    yolo_dataset/train/images/bg_*.jpg (+ 빈 labels/bg_*.txt)   2,000장
    yolo_dataset/val/images/bg_*.jpg   (+ 빈 라벨)               200장
    yolo_dataset/bg_test/images/bg_*.jpg                        500장 (오인식 비율 측정용, 학습에 안 씀)
"""

import argparse
import random
from pathlib import Path

from PIL import Image

SPLITS = {"train": 2000, "val": 200, "bg_test": 500}
OUT_SIZE = 640


def crops(image: Image.Image, count: int, rng: random.Random):
    """정사각형으로 count장 자른다. 크기는 짧은 변의 30~100% (가이드 네모로 얼굴·옷 일부만 보이는 경우까지)."""
    w, h = image.size
    for _ in range(count):
        side = int(min(w, h) * rng.uniform(0.3, 1.0))
        x = rng.randint(0, w - side)
        y = rng.randint(0, h - side)
        yield image.crop((x, y, x + side, y + side)).resize((OUT_SIZE, OUT_SIZE), Image.BILINEAR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coco", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    sources = sorted(args.coco.glob("*.jpg"))
    rng.shuffle(sources)

    # 원본 사진을 나눠 쓴다 (사진 한 장에서 최대 2장 자름)
    start = 0
    for split, total in SPLITS.items():
        need = (total + 1) // 2
        chunk = sources[start:start + need]
        start += need
        image_dir = args.dataset / split / "images"
        label_dir = args.dataset / split / "labels"
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        for old in image_dir.glob("bg_*.jpg"):
            old.unlink()
        for old in label_dir.glob("bg_*.txt"):
            old.unlink()

        written = 0
        for source in chunk:
            image = Image.open(source).convert("RGB")
            for i, crop in enumerate(crops(image, 2, rng)):
                if written >= total:
                    break
                name = f"bg_{source.stem}_{i}"
                crop.save(image_dir / f"{name}.jpg", quality=92)
                if split != "bg_test":
                    (label_dir / f"{name}.txt").write_text("")  # 빈 라벨 = 알약 없음
                written += 1
        print(f"{split}: 배경 {written}장")


if __name__ == "__main__":
    main()
