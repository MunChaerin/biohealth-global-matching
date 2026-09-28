# 개발 구조 및 GitHub 컨벤션

## 1. 문서 목적

본 문서는 프로젝트의 개발 방향, 파일 구조, GitHub 저장소 운영 방식, 브랜치 및 커밋 규칙을 정의한다.

본 프로젝트는 환자용 UI, 의료진용 UI, 챗봇, 카메라 모듈을 하나의 GitHub 레포지토리에서 통합 관리한다.

## 2. 프로젝트 개발 방향

본 프로젝트는 환자와 대화하며 주관적 상태인 S 정보를 수집하고, 카메라·센서 등 외부 모듈에서 수집한 객관적 상태인 O 정보를 결합하여 SOAP 초안을 생성하는 웹 기반 서비스이다.

```text
환자용 UI
 ├─ 텍스트·음성 대화
 └─ 카메라 측정
        ↓
 S 정보 + O 정보
        ↓
 챗봇 엔진
        ↓
 안전 신호 판단
        ↓
 SOAP 초안 생성
        ↓
 의료진용 웹
```

### 환자용 화면

- 아이패드 Safari 접속
- 텍스트·음성으로 챗봇과 대화
- 카메라 측정 실행
- 증상 요약 확인
- 대화 일시정지 및 재개

### 의료진용 화면

- 노트북 또는 데스크톱 웹 접속
- 환자 목록 확인
- S/O 정보 확인
- 안전 위험 신호 확인
- SOAP 초안 검토
- AI 결과 수정 및 확인

### 개발 원칙

- UI, 챗봇, 카메라 모듈을 하나의 레포지토리에서 관리한다.
- 기능별로 폴더와 모듈을 분리한다.
- 초기에는 Mock 데이터로 전체 흐름을 검증한다.
- OpenAI API는 서버에서만 호출한다.
- 실제 환자 데이터 대신 시나리오 데이터를 사용한다.
- 챗봇과 카메라 모듈은 Provider 구조로 구현한다.
- AI 결과는 의료진 검토 전 초안으로 표시한다.
- 측정되지 않은 정보는 추정하지 않는다.
- 위험 신호 발생 시 일반 대화보다 안전 대응을 우선한다.

## 3. 기술 구성

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Next.js, React, TypeScript |
| 스타일 | CSS Modules 또는 Tailwind CSS |
| 환자 화면 | 반응형 웹, PWA |
| 의료진 화면 | 웹 대시보드 |
| 챗봇 | MockChatbotProvider, OpenAiChatbotProvider |
| 음성 입력 | Web Speech API |
| 음성 출력 | Speech Synthesis |
| 카메라 | Browser Camera API |
| 개발 데이터 | JSON, SQLite |
| 배포 | Vercel |
| 버전 관리 | GitHub |
| 테스트 | Vitest 또는 Jest |

## 4. GitHub 레포지토리 운영

전체 프로젝트는 다음 하나의 레포지토리에서 관리한다.

```text
biohealth-global-matching/
```

하나의 레포 안에서 다음 기능을 함께 관리한다.

- 환자용 UI
- 의료진용 UI
- 챗봇 엔진
- 카메라 모듈
- 음성 모듈
- SOAP 초안 생성
- 데이터 저장
- 테스트 코드
- 개발 문서

## 5. 브랜치 전략

### 기본 브랜치

```text
main
```

`main` 브랜치는 항상 실행 가능한 상태를 유지한다. 직접 작업하거나 직접 Push하지 않는다.

### 개발 브랜치

```text
develop
```

개발 중인 기능을 통합하는 브랜치이다.

### 기능 브랜치

```text
feature/patient-ui
feature/clinician-ui
feature/chatbot
feature/camera
feature/soap
feature/audio
```

### 버그 수정 브랜치

```text
fix/chatbot-repeat-question
fix/camera-permission
fix/soap-format
```

### 긴급 수정 브랜치

```text
hotfix/api-key-error
hotfix/production-build
```

### 일반 작업 흐름

```text
1. develop에서 최신 코드 받기
2. 기능 브랜치 생성
3. 기능 개발
4. 테스트 실행
5. 커밋 작성
6. GitHub Push
7. Pull Request 생성
8. 코드 리뷰
9. develop 병합
10. 안정화 후 main 병합
```

## 6. 파일 구조

```text
biohealth-global-matching/
├─ app/
│  ├─ page.tsx
│  ├─ layout.tsx
│  ├─ patient/
│  │  ├─ page.tsx
│  │  └─ camera/page.tsx
│  ├─ clinician/
│  │  ├─ page.tsx
│  │  └─ patients/[id]/page.tsx
│  └─ api/
│     ├─ chat/route.ts
│     ├─ soap/route.ts
│     ├─ camera/route.ts
│     └─ session/route.ts
│
├─ components/
│  ├─ patient/
│  ├─ clinician/
│  ├─ chatbot/
│  ├─ camera/
│  └─ common/
│
├─ lib/
│  ├─ chatbot/
│  │  ├─ types.ts
│  │  ├─ schemas.ts
│  │  ├─ stateMachine.ts
│  │  ├─ questionPolicy.ts
│  │  ├─ safetyRules.ts
│  │  ├─ subjectiveExtractor.ts
│  │  ├─ soapGenerator.ts
│  │  ├─ mockProvider.ts
│  │  ├─ openaiProvider.ts
│  │  └─ prompts/
│  ├─ camera/
│  ├─ audio/
│  ├─ data/
│  └─ config.ts
│
├─ tests/
│  ├─ chatbot/
│  ├─ camera/
│  ├─ safety/
│  └─ soap/
│
├─ docs/
│  ├─ development-and-github-convention.md
│  ├─ chatbot-design.md
│  └─ camera-module-design.md
│
├─ public/
├─ .env.example
├─ .gitignore
├─ package.json
├─ next.config.ts
├─ tsconfig.json
└─ README.md
```

## 7. 폴더별 역할

### `app`

페이지와 API 라우트를 관리한다.

- `app/patient`: 환자용 화면
- `app/patient/camera`: 카메라 측정 화면
- `app/clinician`: 의료진용 화면
- `app/api/chat`: 챗봇 대화 API
- `app/api/soap`: SOAP 생성 API
- `app/api/camera`: 카메라 데이터 API
- `app/api/session`: 세션 데이터 API

### `components`

화면에 표시되는 재사용 가능한 UI 컴포넌트를 관리한다.

### `lib`

서비스의 핵심 로직을 관리한다.

- 챗봇 상태 머신
- 질문 생성 규칙
- 안전 신호 판단
- S/O 데이터 처리
- 카메라 분석
- 음성 처리
- SOAP 생성
- 데이터 저장

### `tests`

각 기능의 단위 테스트와 통합 테스트를 관리한다.

### `docs`

프로젝트 설계 문서와 개발 규칙을 관리한다.

## 8. 파일 및 폴더 네이밍 규칙

### 폴더명

- 소문자를 사용한다.
- 여러 단어는 하이픈으로 연결한다.

```text
patient
clinician
chatbot
camera-module
```

### React 컴포넌트

- PascalCase를 사용한다.

```text
ChatInterface.tsx
CameraPreview.tsx
SafetyAlert.tsx
```

### 일반 TypeScript 파일

- camelCase를 사용한다.

```text
stateMachine.ts
soapGenerator.ts
objectiveMapper.ts
```

### 테스트 파일

원본 파일명 뒤에 `.test.ts`를 붙인다.

```text
stateMachine.test.ts
soapGenerator.test.ts
```

## 9. Git 컨벤션 규칙

### Commit Type

| Gitmoji | Type | 설명 |
|---|---|---|
| ✨ | `feat` | 새로운 기능 추가 |
| 🔧 | `fix` | 버그 수정 |
| 🐛 | `bug` | 버그 이슈 수정 |
| 📋 | `docs` | 문서 추가, 수정, 삭제 |
| ✅ | `test` | 테스트 코드 추가, 수정, 삭제 |
| ♻️ | `refactor` | 코드 리팩토링 |
| ⚙️ | `chore` | 설정 및 기타 변경사항 |
| 🔄 | `ci-cd` | CI/CD 관련 설정 수정 |

### Commit Message Format

```text
<타입>(스코프): <주제>
```

본문과 바닥글은 선택적으로 작성한다.

```text
<타입>(스코프): <주제>

<본문>

<바닥글>
```

### Commit Header 규칙

- 현재형으로 작성한다.
- 주제는 간결하게 작성한다.
- 문장 끝에 마침표를 사용하지 않는다.
- 한 커밋에는 하나의 목적만 포함한다.
- 관련 없는 수정사항을 하나의 커밋에 섞지 않는다.
- 스코프에는 변경 영역을 작성한다.

### Scope 예시

```text
patient
clinician
chatbot
camera
audio
soap
api
data
test
config
docs
```

### Commit 예시

```text
✨ feat(patient): 환자용 대화 화면 추가
✨ feat(chatbot): 챗봇 상태 머신 구현
✨ feat(camera): 카메라 측정 화면 추가
🔧 fix(chatbot): 반복 질문 발생 문제 수정
🐛 bug(camera): 카메라 권한 거부 처리 오류 수정
📋 docs(chatbot): 챗봇 설계 문서 작성
✅ test(safety): 자살 위험 신호 분기 테스트 추가
♻️ refactor(soap): SOAP 생성 로직 분리
⚙️ chore(config): 환경변수 예시 파일 추가
🔄 ci-cd(github): 자동 테스트 워크플로 추가
```

### 본문 포함 예시

```text
✨ feat(chatbot): 환자 응답 기반 S 정보 추출 추가

- 환자 원문 응답 저장
- 증상 위치와 강도 정규화
- 알 수 없는 응답을 unknown으로 저장
- 다음 질문 대상 자동 결정

Refs: #12
```

## 10. Issue 규칙

### Issue 제목 형식

```text
[타입] 작업 내용
```

### Issue Type

```text
[Feature] 새로운 기능
[Fix] 버그 수정
[Docs] 문서 작업
[Test] 테스트 작업
[Refactor] 리팩토링
[Chore] 설정 작업
```

### Issue 본문

```md
## 작업 목적

이 작업을 수행하는 이유를 작성한다.

## 작업 내용

- [ ] 세부 작업 1
- [ ] 세부 작업 2
- [ ] 세부 작업 3

## 완료 조건

- 작업 완료 여부를 판단할 수 있는 기준을 작성한다.

## 관련 문서

- `docs/chatbot-design.md`
- `docs/camera-module-design.md`
```

## 11. Pull Request 규칙

### Pull Request 제목

커밋 메시지와 동일한 형식을 사용한다.

```text
✨ feat(chatbot): 챗봇 상태 머신 구현
```

### Pull Request 본문

```md
## 변경 사항

- 챗봇 상태 머신 추가
- 질문 단계별 상태 정의
- 대화 일시정지 상태 추가

## 테스트

- [ ] 정상 대화 흐름 확인
- [ ] 질문 반복 여부 확인
- [ ] 위험 신호 분기 확인
- [ ] API 오류 상황 확인

## 관련 Issue

Closes #12
```

### Pull Request 규칙

- 하나의 PR에는 하나의 기능 또는 하나의 목적만 포함한다.
- PR 생성 전에 로컬 테스트를 실행한다.
- 변경된 파일과 기능을 본문에 작성한다.
- UI 변경 시 화면 캡처를 첨부한다.
- 설계 변경 시 관련 문서를 함께 수정한다.
- `main`에 직접 Push하지 않는다.
- 리뷰 없이 `main`에 병합하지 않는다.

## 12. 환경변수 및 데이터 관리

환경변수는 `.env.local`에 저장한다.

```text
OPENAI_API_KEY=
DATABASE_URL=
NEXT_PUBLIC_APP_ENV=development
```

실제 키가 포함된 `.env.local` 파일은 GitHub에 업로드하지 않는다. GitHub에는 `.env.example`만 업로드한다.

```text
.env.local
.env
```

실제 환자 개인정보와 얼굴 영상도 GitHub에 업로드하지 않는다. 개발 단계에서는 가상 환자 데이터와 시나리오 데이터를 사용한다.

## 13. 개발 완료 전 확인 사항

### 코드

- [ ] TypeScript 오류가 없는가
- [ ] 불필요한 `console.log`가 제거되었는가
- [ ] 컴포넌트와 로직이 적절히 분리되었는가
- [ ] 파일명이 네이밍 규칙에 맞는가

### 챗봇

- [ ] 질문이 반복되지 않는가
- [ ] 환자가 모른다고 답했을 때 처리되는가
- [ ] 위험 신호가 우선 처리되는가
- [ ] 환자의 원문 응답이 보존되는가

### 카메라

- [ ] 카메라 권한 거부 상황이 처리되는가
- [ ] 측정 실패 시 임의의 값이 생성되지 않는가
- [ ] 데이터 출처와 품질이 저장되는가
- [ ] Mock 모드로도 테스트 가능한가

### GitHub

- [ ] 커밋 타입이 규칙에 맞는가
- [ ] 하나의 커밋에 하나의 목적만 포함되는가
- [ ] Issue와 Pull Request가 연결되어 있는가
- [ ] 환경변수와 개인정보가 포함되지 않았는가
- [ ] 테스트 후 Pull Request를 생성했는가
