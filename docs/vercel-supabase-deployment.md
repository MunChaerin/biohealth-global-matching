# Vercel + Supabase 배포 가이드

이 문서는 팀 내부 원격 테스트용 데모 배포를 기준으로 합니다. 실제 환자 정보는 저장하지 않고 가상 환자 데이터만 사용합니다.

## 배포 구성

- Vercel: Next.js 화면과 API Route 실행
- Supabase: 챗봇 세션, 카메라·모션 결과, 돌봄 요청, 복약 기록 저장
- OpenAI API: 챗봇 응답 생성
- 브라우저: 알약 인식 ONNX 모델, 표정 인식, 모션 트래킹 실행

알약 인식 모델은 `public/models/pill`에서 브라우저로 내려받아 실행됩니다. 원본 사진이나 카메라 영상은 서버 또는 Supabase로 전송하지 않고 구조화된 판정 결과만 저장합니다.

## 1. Supabase 프로젝트 준비

1. Supabase에서 Free 플랜 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/migrations/202610030001_initial_demo_storage.sql`의 전체 내용을 실행합니다.
3. Project Settings의 API 항목에서 Project URL과 Secret key를 확인합니다.

마이그레이션은 다음 테이블을 생성합니다.

- `chat_sessions`
- `camera_reports`
- `motion_reports`
- `care_calls`
- `care_explanations`
- `medication_intakes`
- `medication_reminders`

모든 테이블은 RLS를 활성화하고 브라우저 역할의 직접 접근을 차단합니다. 서버의 Secret key만 데이터에 접근합니다.

## 2. Vercel 프로젝트 준비

1. Vercel에서 GitHub 저장소를 Import합니다.
2. Framework Preset은 Next.js를 사용합니다.
3. Install Command는 `npm install`, Build Command는 `npm run build`를 사용합니다.
4. Production Branch는 `main`으로 지정합니다.

Vercel의 Project Settings > Environment Variables에 다음 값을 등록합니다.

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
SUPABASE_URL=https://...supabase.co
SUPABASE_SECRET_KEY=...
DEMO_ACCESS_USERNAME=팀에서 사용할 아이디
DEMO_ACCESS_PASSWORD=충분히 긴 임의의 비밀번호
CAMERA_DEMO_MODE=true
```

`OPENAI_API_KEY`, `SUPABASE_SECRET_KEY`, `DEMO_ACCESS_PASSWORD`에는 절대로 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다. Production과 Preview에 같은 접근 계정을 설정하고 팀원에게는 배포 URL과 데모 계정만 별도 전달합니다. 팀 테스트용 Preview에도 같은 저장소를 쓸 경우 가상 데이터만 사용합니다.

## 3. 최초 배포 확인

배포 후 아래 화면을 확인합니다.

- `/patient`: 챗봇, 음성 입출력, 표정 인식, 복약 확인
- `/clinician`: 의료진 대시보드
- `/motiontracking`: 모션 트래킹
- `/pill-capture`: 알약 인식 단독 확인

기능 확인 순서는 다음과 같습니다.

1. 배포 URL을 열었을 때 브라우저 인증 창이 나타나며 잘못된 계정으로는 접근할 수 없는지 확인합니다.
2. 환자 화면에서 메시지를 전송하고 새로고침 후에도 서버 세션 조회가 되는지 확인합니다.
3. 알약 촬영 화면에서 카메라 권한을 허용하고 모델이 로드되는지 확인합니다.
4. 인식 완료 후 의료진 화면에 복약 상태가 표시되는지 확인합니다.
5. 표정과 모션 결과가 의료진 화면에 반영되는지 확인합니다.
6. 위험 신호 테스트 문장에는 일반 대화 대신 짧은 의료진 연결 안내가 표시되는지 확인합니다.

## 비용과 운영 주의사항

Vercel과 Supabase의 Free 플랜 한도 안에서는 별도 요금 없이 팀 테스트를 시작할 수 있습니다. 다만 무료 사용량을 초과하거나 유료 플랜으로 전환하면 비용이 발생할 수 있으며, OpenAI API 호출은 별도로 과금됩니다.

- Vercel과 Supabase 대시보드에서 사용량 알림을 설정합니다.
- OpenAI 프로젝트에 월 사용 한도와 예산 알림을 설정합니다.
- 공개 URL과 데모 접근 계정을 무제한 공유하지 않습니다. 접근 보호가 없으면 제3자가 OpenAI 비용을 발생시키거나 데모 기록을 변경할 수 있습니다.
- 실제 환자 이름, 음성, 사진, 영상, 진료 정보는 입력하거나 저장하지 않습니다.
- 팀 테스트가 끝나면 Preview 배포와 테스트 데이터를 정리합니다.

## 로컬 검증

```bash
npm install
npm run typecheck
npm test
npm run build
```

로컬 개발에서는 Supabase 환경변수가 없으면 메모리 저장소를 사용합니다. Vercel 운영 환경에서는 Supabase 설정이 없을 경우 저장 API가 실패하도록 구성되어 있습니다.
