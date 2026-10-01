# 알약 인식 (복약 확인) — 김도현

복약 시간에 어르신이 카메라에 약을 비추면 지금 먹어야 하는 약이 맞는지 알려주는 모델. 이슈 #12.

## 전체 흐름

```
AI Hub 경구약제 이미지 (10종만) + 직접 찍은 웹캠 사진
        ↓ 학습 (YOLO, 이 PC의 RTX 5060 Ti)
  ONNX 변환 → public/models/pill/ (manifest.json + onnx)
        ↓
웹 환자 화면: [복용했어요] → 카메라 카드가 커지며 알약 확인
  맞는 약 → [먹었어요] → /api/medication 기록 → 의료진 화면 "오늘 복약 현황"
```

- 학습 대상: 시연용 3종 + 다른 7종 = 10종
- 확신이 낮으면 "잘 모르겠어요" (10종 밖의 약 오인 방지), 같은 약이 약 1초 이어질 때만 판정
- 영상은 브라우저 안에서만 처리 (onnxruntime-web)

## 진행 상황

- [x] 웹: 복약 일정 데이터, `/api/medication`, 환자 알약 확인 화면, 의료진 복약 현황
- [x] 웹: ONNX 모델 실행부 + YOLO 출력 후처리 (모델 파일만 넣으면 동작)
- [x] 웹캠 촬영 도구 (`capture_pills.py`)
- [ ] 학습할 10종 확정 (품목기준코드) → `lib/medication/schedule.ts`의 `pending:` 코드 교체
- [ ] AI Hub 데이터 신청·승인 → 10종이 든 파일만 내려받기
- [ ] 데이터 변환 스크립트 (AI Hub JSON → YOLO 형식, train/val/test 분리)
- [ ] 학습 + 시연 환경(직접 찍은 사진) 기준 정확도 확인
- [ ] ONNX 변환 → `public/models/pill/`

## 모델 없이 화면 확인하기

개발 서버에서 `http://localhost:3000/patient?pillDebug=1` → [복용했어요] → 알약 확인 패널 아래 개발용 버튼
(맞는 약 / 다른 약 / 애매함 / 여러 알 / 없음)으로 흐름을 확인할 수 있다. 배포 환경에서는 동작하지 않는다.

## 직접 사진 찍기

```bash
conda activate biohealth-camera
cd camera-model/pill-recognition
python capture_pills.py --drug pending:amlodipine
```

`own_photos/<약 코드>/`에 사진과 위치 정보(json)가 저장된다. 손이 나올 수 있어 레포에는 올리지 않는다(`.gitignore`).
촬영 팁은 `capture_pills.py` 맨 위 설명 참고.

## 모델 파일 형식 (`public/models/pill/manifest.json`)

```json
{ "model": "pill-detector.onnx", "inputSize": 640, "classes": ["<약 코드 0>", "<약 코드 1>", "..."] }
```

`classes` 순서는 학습할 때의 클래스 번호와 같아야 하고, 값은 `lib/medication/schedule.ts`의 `drugCode`와 같아야 한다.
