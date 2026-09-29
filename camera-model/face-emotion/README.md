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

## landmark_expression_tracker.py (규칙 기반, 현재 메인)

FER 모델의 조명 민감성 문제로 대안으로 만든 버전. MediaPipe FaceMesh 랜드마크로
직접 규칙을 짜서 판단한다. 지표 정의와 규칙은 `expression_rules.py`에 분리돼 있다(v2).

```bash
pip install mediapipe opencv-python numpy
python landmark_expression_tracker.py                 # 웹캠
python landmark_expression_tracker.py --label frown   # 의도한 표정 라벨을 붙여 테스트
```

동작 순서:
1. 실행 후 5초간 "캘리브레이션" — 환자가 평상시 표정을 유지한 상태를 기준선으로 저장
2. 이후 매 프레임 기준선 대비 변화량(delta) 계산 -> `expression_activity`로 종합
3. `expression_activity`가 계속 낮으면 `flat_expression_flag: true` — **표정 변화가
   있는지 없는지를 가장 먼저 보여주는 지표**(파킨슨 가면양 얼굴, 문화적 표현 억제 감지 목적)
4. delta 조합으로 통증/불안/무기력/평온 프록시 추정 + 가장 높은 상태를 `dominant`로 기록
   (PSPI 참고 규칙, 임상 검증 안 됨 - 튜닝 필요)

저장 방식은 FER 버전과 동일하게 `runs/landmark_run_<타임스탬프>.jsonl` + `_summary.json`.

로그 이벤트 종류:
- `calibration_sample` — 캘리브레이션 프레임의 핵심 랜드마크 좌표 (재채점용)
- `landmark_expression` — 프레임별 `deltas`, `expression_activity`, `proxy_scores`
  (4종 점수 + `dominant` + `raw_expression`(smile/frown) + `actions`(AU 유사 동작 점수)), `key_landmarks`
- `expression_trend_update` — 윈도우 집계: `avg_proxy_ratio`(프레임별 점수 평균),
  `dominant_ratio`(상태별 프레임 비율), `flat_expression_flag` 등

`key_landmarks`는 얼굴 영상이 아니라 규칙에 쓰는 랜드마크 15개의 좌표뿐이다.

### 수면(눈 감음) 상태

와상 환자는 눈 감고 있는 시간이 길어서, 따로 빼지 않으면 자는 동안 내내 lethargy로 기록된다.
- 눈 뜬 정도가 기준선의 40% 미만이면 "눈 감음", 이게 **10초 이상** 이어지면 `sleeping`
  (`expression_rules.py`의 `SLEEP_MIN_SEC`, 데모용 값 - 실제 운영은 수 분 권장)
- 눈을 감았어도 **찡그리고 있으면 수면으로 보지 않음** (눈 질끈 감기 + 찡그림은 통증 표정)
- `sleeping` 동안은 감정 점수를 0으로 두고 `dominant: "sleeping"`, 트렌드의 평균/저활성 계산에서도 제외
  (`sleeping_ratio`로 따로 집계)
- 실행 화면 왼쪽 위에 현재 판정(`dominant (state)`)이 표시된다


**FER 버전과의 차이**: FER은 사전학습된 블랙박스 모델의 확률을 그대로 쓰지만, 이 버전은
"기준선 대비 뭐가 얼마나 변했는지"를 직접 계산하기 때문에 조명보다는 얼굴 검출 자체가
되는지에 더 좌우된다(라이트박스 정도 조명이면 충분).

## 규칙 튜닝 (evaluate_runs.py)

```bash
# 1. 표정별로 라벨 붙여 테스트 (각 20~30초, 처음 5초는 무표정 유지)
python landmark_expression_tracker.py --label neutral
python landmark_expression_tracker.py --label frown       # -> pain 기대
python landmark_expression_tracker.py --label smile       # -> calm 기대
python landmark_expression_tracker.py --label wide_eyes   # -> anxiety 기대
python landmark_expression_tracker.py --label droopy      # -> lethargy 기대
python landmark_expression_tracker.py --label sleep       # -> sleeping 기대 (눈 감고 30초 이상, 처음 10초는 eyes_closed)

# 2. 재채점 - 라벨별 평균 점수, 최다 dominant, 프레임 정답률 출력
python evaluate_runs.py

# 3. expression_rules.py의 RULE_RANGES / 가중치 수정 후 2번 반복 (재녹화 불필요)
```

v2 이전(9/23까지) 로그는 좌표가 없어서 재채점 대상에서 자동으로 빠진다.
v1 -> v2에서 무엇을 왜 바꿨는지는 `../docs/표정감정_설계.md`의 "규칙 v2" 참고.
