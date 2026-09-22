# face-emotion 실행 방법 & 저장 구조

## 실행

```bash
conda activate biohealth-camera
python emotion_trend_tracker.py            # 웹캠으로 실행
python emotion_trend_tracker.py video.mp4  # 저장된 영상 파일로 실행
```

창이 뜨면 `q`를 눌러 종료한다. 종료하는 순간 요약이 자동 저장된다(아래 참고).

## 저장되는 위치

실행할 때마다 `runs/` 폴더 아래에 **그 실행 전용 파일**이 새로 생긴다(이전 실행 결과와 안 섞임):

```
runs/
├── emotion_run_20260922_160705.jsonl          # 매 프레임 분류 결과 + 트렌드 집계, 한 줄에 하나씩(JSON Lines)
└── emotion_run_20260922_160705_summary.json   # 종료 시점 요약 (총 샘플 수, 최종 트렌드, 실행 시간 등)
```

`runs/` 폴더는 `.gitignore`에 등록되어 있어서 **git에는 안 올라간다** — 각자 테스트한 원본 로그는 로컬에만 쌓이고, 공유할 필요가 있는 결과만 따로 캡처해서 올리면 된다.

### emotion_events.jsonl은 뭐였나?

초기 버전(runs/ 폴더 도입 전)에는 실행할 때마다 `emotion_events.jsonl` 파일 하나에 계속 이어붙이는 방식이었다. 그래서 여러 번 실행하면 이전 테스트 결과와 이번 테스트 결과가 한 파일에 섞이는 문제가 있었음. 지금은 `runs/` 방식으로 바뀌면서 이 파일은 더 이상 만들어지지 않는다(예전에 생성됐던 파일은 삭제함).

## 로그 한 줄(JSONL)의 의미

`emotion_run_*.jsonl`은 한 줄이 이벤트 하나다. 두 종류가 있다:

- `event_type: "emotion_classified"` — 프레임 하나를 분석한 결과. `raw_scores`(FER 7종 원시 확률), `proxy_scores`(통증/불안/무기력/평온 4종 프록시), `frame_brightness`(프레임 평균 밝기, 0~255), `low_light_frame`(밝기가 기준치보다 낮은지) 포함
- `event_type: "emotion_trend_update"` — 최근 1시간(기본값) 윈도우 기준으로 집계한 평균/추이. `flat_affect_flag`(표정 변화가 계속 약했는지), `low_light_condition`(윈도우 평균 밝기가 낮았는지)와 그에 따른 `caution`/`caution_lighting` 경고 문구 포함

## 참고

- 설계 배경, 한계점, 개발 목록은 `../docs/표정감정_설계.md` 참고
- 2026-09-22 실측: 조명이 어두운 상태에서 웃는 얼굴인데도 sad/neutral이 우세하게 나오는 오분류 확인 → 현재 FER 사전학습 모델은 그대로 채택하기 어렵다고 판단, 보류 중
