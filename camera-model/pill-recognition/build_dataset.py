r"""
AI Hub 경구약제 이미지(우리 10종) + 라벨 JSON -> YOLO 학습 데이터
담당: 김도현 (카메라 관련 모델 개발)

사용법:
    python build_dataset.py --images C:\Users\DM501TGA\aihub_pill\pill_images ^
        --labels "C:\Users\DM501TGA\aihub_pill\166.약품식별_인공지능_개발을_위한_경구약제_이미지_데이터\01.데이터" ^
        --out C:\Users\DM501TGA\aihub_pill\yolo_dataset

나누기 (같은 알약을 조금씩 돌려 찍은 사진이 많아서 무작위로 나누면 정확도가 부풀려진다)
    사진 이름 = K코드_상태_배경_앞뒤_조명_위아래각도_돌린각도_크기
    돌린 각도(0~340, 20도 간격 18개) 중 VAL_LO는 검증용, TEST_LO는 시험용 -> 학습 때 본 적 없는 각도로 평가

배경 합성 (시연 환경 대비)
    AI Hub 사진은 검정·파랑·연회색 단색 배경뿐인데 시연은 손바닥·책상 위다.
    단색 배경을 이용해 알약만 오려 내서 피부색·나무결·종이·무늬 배경에 크기·위치·회전을 바꿔 붙인 사진을
    학습용에 추가한다 (검증·시험에는 넣지 않음 - 원본 조건 그대로 평가).
"""

import argparse
import json
import random
import zipfile
from pathlib import Path

import cv2
import numpy as np

CLASSES_JSON = Path(__file__).with_name("classes.json")
VAL_LO = {"100", "280"}
TEST_LO = {"040", "220"}
IMG_LONG_SIDE = 640
COMPOSITES_PER_IMAGE = 1  # 학습 사진 1장당 합성 사진 수 (확률적으로 만듦)
COMPOSITE_PROB = 0.6
# 사진이 적은 약(AI Hub 검증용 묶음에만 있는 324장짜리 - 시연 약 리리베아 포함)은 합성을 더 많이 만들어
# 사진이 많은 약(1,296장)과 학습 비중을 맞춘다
FEW_IMAGES = 500
FEW_COMPOSITES_PER_IMAGE = 4


def load_json(raw: bytes) -> dict:
    for encoding in ("utf-8", "cp949"):
        try:
            return json.loads(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
    return json.loads(raw.decode("utf-8", "replace"))


def read_boxes(labels_root: Path, codes: set[str]) -> dict[str, list[float]]:
    """라벨 zip들에서 우리 약 사진의 bbox([x, y, w, h], 픽셀)를 읽는다. 키는 사진 파일 이름(확장자 제외)."""
    boxes: dict[str, list[float]] = {}
    for zip_path in labels_root.glob("*/라벨링데이터/단일경구약제_5000종/*.zip"):
        with zipfile.ZipFile(zip_path) as z:
            for name in z.namelist():
                code = name.split("/")[0].replace("_json", "")
                if code not in codes or not name.endswith(".json"):
                    continue
                data = load_json(z.read(name))
                anns = data.get("annotations") or []
                if len(anns) != 1:
                    continue  # 한 사진에 알약 하나만 있는 것만 사용
                boxes[Path(name).stem] = anns[0]["bbox"]
    return boxes


def split_of(stem: str) -> str:
    lo = stem.split("_")[6]
    return "val" if lo in VAL_LO else "test" if lo in TEST_LO else "train"


def resize(image: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    scale = IMG_LONG_SIDE / max(h, w)
    return cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA), scale


def yolo_line(class_id: int, box: list[float], width: int, height: int) -> str:
    x, y, w, h = box
    return f"{class_id} {(x + w / 2) / width:.6f} {(y + h / 2) / height:.6f} {w / width:.6f} {h / height:.6f}"


# ---------- 배경 합성 ----------

def pill_mask(image: np.ndarray, box: list[float]) -> np.ndarray | None:
    """단색 배경 사진에서 bbox 안의 알약 모양 마스크 (배경색과 다른 부분)."""
    x, y, w, h = (int(round(v)) for v in box)
    pad = max(6, int(0.08 * max(w, h)))
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(image.shape[1], x + w + pad), min(image.shape[0], y + h + pad)
    crop = image[y0:y1, x0:x1]
    lab = cv2.cvtColor(cv2.GaussianBlur(crop, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    border = np.concatenate([lab[:4].reshape(-1, 3), lab[-4:].reshape(-1, 3), lab[:, :4].reshape(-1, 3), lab[:, -4:].reshape(-1, 3)])
    background = np.median(border, axis=0)
    d_light = lab[..., 0] - background[0]  # 밝기 차이 (+면 배경보다 밝음)
    d_color = np.linalg.norm(lab[..., 1:] - background[1:], axis=2)  # 색 차이
    # 그림자는 배경과 색은 같고 더 어둡기만 하므로 빼고, 색이 다르거나 더 밝은 부분만 알약으로 본다
    mask = ((d_color > 10) | (d_light > 12)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    # 알약은 볼록한 모양이라, 각인·분할선 때문에 생긴 구멍이나 홈이 메워지도록 볼록 외곽선으로 감싼다
    hull = cv2.convexHull(np.vstack([c for c in contours if cv2.contourArea(c) > 0.02 * w * h] or [max(contours, key=cv2.contourArea)]))
    if cv2.contourArea(hull) < 0.25 * w * h or cv2.contourArea(hull) > 1.6 * w * h:  # 알약 모양을 제대로 못 찾음
        return None
    full = np.zeros(image.shape[:2], np.uint8)
    cv2.drawContours(full, [hull + [x0, y0]], -1, 255, thickness=cv2.FILLED)
    return cv2.GaussianBlur(full, (5, 5), 0)  # 가장자리 부드럽게


def random_background(rng: random.Random, h: int, w: int) -> np.ndarray:
    kind = rng.choice(["skin", "skin", "wood", "paper", "cloth", "gradient"])
    nprng = np.random.default_rng(rng.randrange(1 << 30))
    if kind == "skin":  # 손바닥 (밝은 살구색 ~ 어두운 살색)
        base = np.array([rng.randint(110, 190), rng.randint(140, 205), rng.randint(175, 240)], np.float32)  # BGR
        bg = np.ones((h, w, 3), np.float32) * base
        bg += cv2.GaussianBlur(nprng.normal(0, 18, (h, w)).astype(np.float32), (0, 0), 25)[..., None]
        bg += nprng.normal(0, 4, (h, w, 1))
        # 손금처럼 어두운 곡선 몇 개
        for _ in range(rng.randint(0, 3)):
            cx, cy, r = rng.randint(0, w), rng.randint(0, h), rng.randint(w // 4, w)
            cv2.ellipse(bg, (cx, cy), (r, r // 2), rng.uniform(0, 180), rng.uniform(0, 90), rng.uniform(100, 200), tuple(float(c) * 0.88 for c in base), rng.randint(1, 3))
        bg = cv2.GaussianBlur(bg, (3, 3), 0)
    elif kind == "wood":
        base = np.array([rng.randint(40, 120), rng.randint(70, 150), rng.randint(110, 200)], np.float32)
        stripes = np.sin(np.linspace(0, rng.uniform(20, 60), w) + nprng.normal(0, 0.3, w).cumsum() * 0.05)
        bg = np.ones((h, w, 3), np.float32) * base + (stripes[None, :, None] * 18)
        bg += nprng.normal(0, 5, (h, w, 1))
    elif kind == "paper":
        v = rng.randint(185, 250)
        bg = np.ones((h, w, 3), np.float32) * np.array([v - rng.randint(0, 15), v - rng.randint(0, 10), v], np.float32)
        bg += cv2.GaussianBlur(nprng.normal(0, 10, (h, w)).astype(np.float32), (0, 0), 30)[..., None]
    elif kind == "cloth":
        base = np.array([rng.randint(30, 230) for _ in range(3)], np.float32)
        bg = np.ones((h, w, 3), np.float32) * base
        bg += nprng.normal(0, 12, (h, w, 1))
        bg = cv2.GaussianBlur(bg, (3, 3), 0)
    else:
        a = np.array([rng.randint(30, 230) for _ in range(3)], np.float32)
        b = np.array([rng.randint(30, 230) for _ in range(3)], np.float32)
        t = np.linspace(0, 1, h)[:, None, None]
        bg = a * (1 - t) + b * t + np.zeros((h, w, 3), np.float32)
    return np.clip(bg, 0, 255).astype(np.uint8)


def composite(image: np.ndarray, mask: np.ndarray, box: list[float], rng: random.Random):
    """알약을 오려 새 배경(가로 4:3 웹캠 비율)에 붙인다. (합성 사진, 새 bbox) 반환."""
    x, y, w, h = (int(round(v)) for v in box)
    pad = 4
    x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(image.shape[1], x + w + pad), min(image.shape[0], y + h + pad)
    pill, alpha = image[y0:y1, x0:x1], mask[y0:y1, x0:x1]

    out_w, out_h = 640, 480
    target = rng.uniform(0.10, 0.35) * out_h  # 알약 긴 변이 화면 높이의 10~35% (손에 들고 비출 때 크기)
    scale = target / max(pill.shape[:2])
    pill = cv2.resize(pill, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(alpha, (pill.shape[1], pill.shape[0]), interpolation=cv2.INTER_AREA)

    angle = rng.uniform(0, 360)  # 회전 (잘리지 않게 캔버스를 키워서)
    ph, pw = pill.shape[:2]
    diag = int(np.ceil(np.hypot(ph, pw)))
    m = cv2.getRotationMatrix2D((pw / 2, ph / 2), angle, 1.0)
    m[0, 2] += (diag - pw) / 2
    m[1, 2] += (diag - ph) / 2
    pill = cv2.warpAffine(pill, m, (diag, diag))
    alpha = cv2.warpAffine(alpha, m, (diag, diag))
    ys, xs = np.nonzero(alpha > 40)
    if len(xs) == 0 or diag >= min(out_w, out_h):
        return None
    pill, alpha = pill[ys.min():ys.max() + 1, xs.min():xs.max() + 1], alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    bg = random_background(rng, out_h, out_w)
    ph, pw = pill.shape[:2]
    px, py = rng.randint(0, out_w - pw), rng.randint(0, out_h - ph)
    a = (alpha.astype(np.float32) / 255)[..., None]
    region = bg[py:py + ph, px:px + pw].astype(np.float32)
    bg[py:py + ph, px:px + pw] = (pill * a + region * (1 - a)).astype(np.uint8)
    return bg, [float(px), float(py), float(pw), float(ph)]


def main():
    parser = argparse.ArgumentParser(description="AI Hub 알약 사진 -> YOLO 데이터")
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()

    classes = json.loads(CLASSES_JSON.read_text(encoding="utf-8"))["classes"]
    class_ids = {c["code"]: i for i, c in enumerate(classes)}
    rng = random.Random(args.seed)

    print("[라벨 읽는 중]")
    boxes = read_boxes(args.labels, set(class_ids))
    print(f"  bbox {len(boxes)}개")

    counts = {split: {c["code"]: 0 for c in classes} for split in ("train", "val", "test", "train_composite")}
    skipped = 0
    for code, class_id in class_ids.items():
        image_paths = sorted((args.images / code).glob("*.png"))
        few = len(image_paths) < FEW_IMAGES
        n_composites, prob = (FEW_COMPOSITES_PER_IMAGE, 1.0) if few else (COMPOSITES_PER_IMAGE, COMPOSITE_PROB)
        for image_path in image_paths:
            stem = image_path.stem
            box = boxes.get(stem)
            if box is None:
                skipped += 1
                continue
            image = cv2.imread(str(image_path))
            if image is None:
                skipped += 1
                continue
            split = split_of(stem)
            small, scale = resize(image)
            small_box = [v * scale for v in box]
            out_dir = args.out / split
            (out_dir / "images").mkdir(parents=True, exist_ok=True)
            (out_dir / "labels").mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out_dir / "images" / f"{stem}.jpg"), small, [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out_dir / "labels" / f"{stem}.txt").write_text(yolo_line(class_id, small_box, small.shape[1], small.shape[0]) + "\n")
            counts[split][code] += 1

            if split == "train":
                for k in range(n_composites):
                    if rng.random() > prob:
                        continue
                    mask = pill_mask(small, small_box)
                    if mask is None:
                        continue
                    made = composite(small, mask, small_box, rng)
                    if made is None:
                        continue
                    comp, comp_box = made
                    name = f"{stem}_c{k}"
                    cv2.imwrite(str(out_dir / "images" / f"{name}.jpg"), comp, [cv2.IMWRITE_JPEG_QUALITY, 90])
                    (out_dir / "labels" / f"{name}.txt").write_text(yolo_line(class_id, comp_box, comp.shape[1], comp.shape[0]) + "\n")
                    counts["train_composite"][code] += 1
        print(f"  {code} {classes[class_id]['name']}: " + ", ".join(f"{s} {counts[s][code]}" for s in counts))

    data_yaml = args.out / "data.yaml"
    names = "\n".join(f"  {i}: '{c['code']}'" for i, c in enumerate(classes))
    data_yaml.write_text(f"path: {args.out.as_posix()}\ntrain: train/images\nval: val/images\ntest: test/images\nnames:\n{names}\n", encoding="utf-8")
    (args.out / "summary.json").write_text(json.dumps({"counts": counts, "skipped": skipped, "val_lo": sorted(VAL_LO), "test_lo": sorted(TEST_LO)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[완료] {args.out} (건너뜀 {skipped})")


if __name__ == "__main__":
    main()
