r"""
알약 학습용 웹캠 촬영 도구
담당: 김도현 (카메라 관련 모델 개발)

AI Hub 경구약제 이미지는 스튜디오 촬영이라, 시연 환경(어르신 손 위, 웹캠, 방 조명)과 다르다.
실제 시연 알약을 같은 웹캠으로 찍어 학습 데이터에 섞으면 시연 때 인식이 훨씬 안정적이다.

사용법 (camera-model/pill-recognition 폴더에서):
    python capture_pills.py --drug pending:amlodipine
    python capture_pills.py --drug pending:amlodipine --camera 1

    --drug: 약 코드 (lib/medication/schedule.ts의 drugCode와 같은 값, 실제 약이 정해지면 품목기준코드)

키:
    space  지금 화면 저장
    a      자동 저장 켜기/끄기 (0.5초마다 저장 - 각도·위치를 바꿔 가며 빠르게 많이 찍을 때)
    q      종료

저장 위치: own_photos/<약 코드>/<시각>.jpg + 같은 이름의 .json
    json에는 약 코드와, 흰 종이 같은 단색 배경 위에서 자동으로 찾은 알약 위치(box, 정규화 [x, y, w, h])가 들어간다.
    손 위처럼 배경이 복잡하면 자동으로 못 찾을 수 있어서 box가 null로 저장되고, 나중에 학습한 모델로 위치를 채운다.

촬영 팁 (약마다 50~100장):
    - 흰 종이 위 / 손바닥 위 / 손가락으로 집은 모습을 섞기
    - 흰 알약은 흰 종이 위에서 위치를 잘 못 찾으니 어두운 색 종이 위에서도 찍기 (화면에 초록 상자가 뜨면 찾은 것)
    - 앞면·뒷면, 각도, 거리(가까이·멀리), 조명(밝게·어둡게)을 바꿔 가며
    - 한 장에 한 알만
"""

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

OUT_DIR = Path("own_photos")
AUTO_INTERVAL_SEC = 0.5
TARGET_BRIGHTNESS = 110  # 표정 카메라와 같은 밝기 보정 기준
MIN_GAMMA = 0.4


def brighten(frame):
    """평균 밝기가 목표보다 낮으면 감마 보정 (웹 화면의 lib/camera/brightness.ts와 같은 방식)."""
    brightness = float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean())
    if brightness >= TARGET_BRIGHTNESS * 0.9 or brightness < 1:
        return frame
    gamma = max(MIN_GAMMA, np.log(TARGET_BRIGHTNESS / 255) / np.log(brightness / 255))
    lut = (np.linspace(0, 1, 256) ** gamma * 255).astype(np.uint8)
    return cv2.LUT(frame, lut)


def find_pill_box(frame):
    """단색 배경 위의 알약 위치를 찾는다 (정규화 [x, y, w, h]). 못 찾으면 None.

    배경과 색·밝기가 다른 가장 큰 덩어리를 알약으로 본다. 화면 가장자리 띠의 색을 배경으로 잡기 때문에
    알약이 화면 가운데쯤 있고 배경이 고르면 잘 맞고, 손 위처럼 복잡한 배경에서는 None이 되기 쉽다.
    """
    h, w = frame.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    border = np.concatenate([lab[:10].reshape(-1, 3), lab[-10:].reshape(-1, 3), lab[:, :10].reshape(-1, 3), lab[:, -10:].reshape(-1, 3)])
    background = np.median(border, axis=0)
    if np.std(border, axis=0).max() > 18:  # 가장자리가 고르지 않으면 단색 배경이 아님
        return None
    diff = np.linalg.norm(lab - background, axis=2)
    color_mask = (diff > 25).astype(np.uint8) * 255
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    # 흰 종이 위 흰 알약처럼 색 차이가 작으면 테두리(윤곽선)로 찾는다
    gray = cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 30, 90), np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(cv2.bitwise_or(color_mask, edges), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # 테두리만 있는 경우 안쪽을 채워서 알약 전체를 한 덩어리로
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    mask = np.zeros_like(mask)
    cv2.drawContours(mask, contours, -1, 255, thickness=cv2.FILLED)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    area_ratio = cv2.contourArea(largest) / (w * h)
    if not 0.002 <= area_ratio <= 0.4:  # 너무 작으면 잡음, 너무 크면 알약이 아님
        return None
    x, y, bw, bh = cv2.boundingRect(largest)
    pad = 4
    x, y = max(0, x - pad), max(0, y - pad)
    bw, bh = min(w - x, bw + 2 * pad), min(h - y, bh + 2 * pad)
    return [round(x / w, 5), round(y / h, 5), round(bw / w, 5), round(bh / h, 5)]


def save(frame, drug: str, out_dir: Path) -> tuple[Path, list | None]:
    stamp = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time() * 1000) % 1000:03d}"
    image_path = out_dir / f"{stamp}.jpg"
    cv2.imwrite(str(image_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
    box = find_pill_box(frame)
    meta = {"drugCode": drug, "box": box, "width": frame.shape[1], "height": frame.shape[0], "source": "own_webcam"}
    image_path.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return image_path, box


def parse_args():
    parser = argparse.ArgumentParser(description="알약 학습용 웹캠 촬영")
    parser.add_argument("--drug", required=True, help="약 코드 (예: pending:amlodipine 또는 품목기준코드)")
    parser.add_argument("--camera", type=int, default=0, help="웹캠 번호 (기본 0)")
    return parser.parse_args()


def main():
    args = parse_args()
    out_dir = OUT_DIR / args.drug.replace(":", "_")
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise SystemExit(f"[오류] {args.camera}번 카메라를 열 수 없습니다. 다른 프로그램이 카메라를 쓰고 있지 않은지 확인하세요.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    count = len(list(out_dir.glob("*.jpg")))
    auto = False
    last_auto = 0.0
    print(f"[촬영 시작] {args.drug} -> {out_dir} (이미 {count}장)")
    print("space: 저장 / a: 자동 저장 켜기·끄기 / q: 종료")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            frame = brighten(frame)

            key = cv2.waitKey(1) & 0xFF
            now = time.time()
            if key == ord("q"):
                break
            if key == ord("a"):
                auto = not auto
                print(f"[자동 저장] {'켜짐' if auto else '꺼짐'}")
            if key == ord(" ") or (auto and now - last_auto >= AUTO_INTERVAL_SEC):
                last_auto = now
                path, box = save(frame, args.drug, out_dir)
                count += 1
                print(f"[{count}] {path.name} {'위치 자동 표시' if box else '위치 못 찾음 (나중에 모델로 채움)'}")

            preview = frame.copy()
            box = find_pill_box(frame)
            if box:
                h, w = frame.shape[:2]
                x, y, bw, bh = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
                cv2.rectangle(preview, (x, y), (x + bw, y + bh), (0, 200, 0), 2)
            status = f"{args.drug}  {count} photos  {'AUTO' if auto else ''}"
            cv2.putText(preview, status, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)
            cv2.imshow("pill capture (space: save / a: auto / q: quit)", preview)
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print(f"[종료] {out_dir} 에 {count}장")


if __name__ == "__main__":
    main()
