# OpenMyHealth Extension Build Plan (2026-02-24)

## Checklist
- [x] 요구사항을 코드 기준으로 재정의하고 안전성/확장성/UX 기준을 명문화한다.
- [x] MV3 익스텐션 실행 가능한 루트 코드베이스(`src`, `scripts`, `static`)를 복원한다.
- [x] `Health Vault`(로컬 암호화 저장), `Source Adapter`(국가별 확장), `Approval Gate`(전송 전 사용자 승인) 코어를 구현한다.
- [x] ChatGPT와 분리된 `Side Panel` 중심 UX(코파일럿 가이드 + 전송 미리보기)를 구현한다.
- [x] KR HIRA 어댑터(가이드 스텝 + 코드 정규화 + FHIR 변환 기본) 1개를 구현한다.
- [x] 로컬 검색 파이프라인(최소 전송 후보 선정)과 민감정보 마스킹을 구현한다.
- [x] 단위 테스트와 확장 E2E 스모크 테스트를 추가한다.
- [x] 타입체크/린트/테스트/빌드/dist검증을 실행하고 Review에 증빙한다.

## Plan Validation
- [x] 사용자 요청(보안 중심, 글로벌 확장 가능한 UX, 실제 브라우저 QA)을 직접 만족하는 최소-완결 경로인지 검토했다.

## Progress Notes
- 초기 상태 점검 결과 루트에는 `src/` 및 `scripts/`가 부재해 현재 `pnpm build`가 불가능한 상태다.
- 따라서 구현은 기능 추가와 동시에 루트 빌드 파이프라인 복원까지 포함한다.
- 구현 완료: `background/content/sidepanel/shared` 모듈 구조와 MV3 빌드 파이프라인을 루트에 복원했다.
- UX 완료: Side Panel 독립 보안 UI, 소스 코파일럿 가이드, 전송 전 승인/미리보기 플로우를 구현했다.
- 보안 완료: AES-GCM 로컬 금고, 민감정보 마스킹, 승인된 레코드만 컨텍스트 생성 로직을 적용했다.
- 고도화 완료: 로컬 전송 이력(투명성 로그) 저장/표시, 소스 페이지 실시간 코파일럿 오버레이(진행률 + 하이라이트), 어댑터 템플릿/문서를 추가했다.
- 테스트 강화 완료: `crypto/contextBuilder` 테스트를 추가해 암호화·복호화 및 마스킹 컨텍스트 생성을 검증했다.
- CI 안정화 완료: `tests/visual` 기본 스펙을 추가해 `loop:full`의 `No tests found` 실패를 제거했고, 워크플로우에 확장 E2E 단계를 추가했다.
- 릴리즈 안정화 완료: CI 환경에서 `xvfb-run` 유무를 자동 처리하는 확장 E2E 래퍼를 추가했고, 로컬 릴리즈 드라이런 스크립트(`release:dry-run`)를 도입했다.

## Review
- `pnpm type-check` 통과.
- `pnpm lint` 통과.
- `pnpm test` 통과 (3 suites, 5 tests).
- `pnpm build` 통과 (`dist/background`, `dist/content`, `dist/sidepanel` 번들 생성).
- `pnpm validate:dist` 통과.
- `pnpm test:e2e:extension` 통과:
  - 시나리오: 금고 생성 → 수동 기록 추가 → 로컬 검색/선택 → 승인 미리보기 생성 → ChatGPT 입력창 주입.
- 통합 재검증(`pnpm type-check && pnpm lint && pnpm test && pnpm build && pnpm validate:dist && pnpm test:e2e:extension`) 1회 추가 실행, 전체 통과.
- 최종 재검증(고도화 반영 후) 동일 명령 1회 추가 실행, 전체 통과.
- `pnpm loop:full` 재검증 통과 (`test:visual` 포함).
- 워크플로우 대비 통합 재검증 통과:
  - `pnpm type-check && pnpm lint && pnpm test && pnpm build && pnpm validate:dist && pnpm test:visual && pnpm test:e2e:extension`
- `pnpm release:dry-run` 통과:
  - Full QA + 확장 E2E(CI 래퍼 경로) 완료
  - 아티팩트 생성: `openmyhealth-v0.1.1.zip`
  - 체크섬 생성/검증: `openmyhealth-v0.1.1.zip.sha256`

## Hotfix (2026-02-24, Side Panel Open)

### Checklist
- [x] 사이드패널이 열리지 않는 사용자 제보를 재현/원인 분석한다.
- [x] 액션 클릭 시 사이드패널 오픈 경로를 보강한다.
- [x] 탭 URL 기반 enable 상태 재적용 로직(onStartup/onInstalled/onActivated/onUpdated)을 안정화한다.
- [x] 사이드패널 enable 상태를 검증하는 E2E를 추가한다.
- [x] 전체 QA + 릴리즈 드라이런 후 아티팩트를 재생성한다.

### Review
- 원인: 액션 클릭 시 패널 자동 오픈 동작 보장이 없었고, 브라우저 생명주기 이벤트에서 enable 설정이 느슨했다.
- 조치:
  - `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` 적용
  - `chrome.action.onClicked`에서 `sidePanel.open` 직접 호출
  - side panel option 설정 로직 예외 내구성 강화
  - `onStartup` 시점 재설정 추가
- 검증:
  - `pnpm type-check && pnpm lint && pnpm test && pnpm build && pnpm test:e2e:extension` 통과
  - 신규 E2E: `tests/e2e/sidepanel-enable.spec.ts` 통과
- `pnpm release:dry-run` 통과 (visual + extension E2E + checksum)

## Hotfix (2026-02-25, WXT Dev Hot Reload)

### Checklist
- [x] 기존 릴리즈 빌드를 유지한 채 WXT 기반 dev 루프를 병행 추가한다.
- [x] 기존 `src` 코어 로직을 재사용하는 WXT entrypoint를 구성한다.
- [x] Side Panel은 기존 `static/sidepanel.html`을 단일 소스로 유지하도록 연결한다.
- [x] `pnpm dev`/`pnpm wxt:build` 스크립트를 추가한다.
- [x] README에 개발자용 UI 반복 작업 루프를 문서화한다.

### Review
- 추가 파일:
  - `wxt.config.ts`
  - `entrypoints/background.ts`
  - `entrypoints/*.content.ts` (chatgpt/gemini/claude/source-pages)
  - `entrypoints/sidepanel/index.html`, `entrypoints/sidepanel/main.ts`
- 스크립트 추가:
  - `dev`, `dev:firefox`, `wxt:build`, `wxt:zip`, `wxt:prepare`
- 검증:
  - `pnpm wxt:prepare` 통과
  - `pnpm wxt:build` 통과 (WXT 출력 생성)
  - `pnpm dev` 기동 확인 (manual runner, `.output/chrome-mv3-dev` 로드 안내 출력)
  - 기존 릴리즈 경로 영향 확인: `pnpm build` 통과

## Hotfix (2026-02-25, ChatGPT Only Side Panel Scope)

### Checklist
- [x] 사이드패널 허용 도메인을 ChatGPT 계열로 한정한다.
- [x] 탭 전환 시 비대상 탭에서는 패널을 즉시 닫도록 보강한다.
- [x] 비대상 탭에서 액션 아이콘 클릭 시 패널이 열리지 않도록 방어한다.
- [x] 타입체크/린트/테스트/빌드 검증을 다시 실행한다.
- [x] 사용자 로컬 테스트 폴더(`~/Downloads/openmyhealth-v0.1.1-unpacked`, `~/Downloads/chrome-mv3-dev`)를 최신 결과물로 동기화한다.

### Review
- 변경 파일: `src/background/index.ts`
  - `SIDE_PANEL_ALLOWED_URL_RE`를 `chatgpt.com`/`chat.openai.com`만 허용하도록 축소.
  - `maybeCloseSidePanel(tabId)` 추가.
  - `setPanelBehavior({ openPanelOnActionClick: false })`로 조정해 윈도우 단위 고정 패널 동작을 제거.
  - `onUpdated`, `onActivated`, `action.onClicked`에서 비허용 탭은 `sidePanel.close` 호출.
  - 탭별 `chrome.action.enable/disable` 적용(비허용 탭에서 아이콘 비활성).
- 검증:
  - `pnpm type-check && pnpm lint && pnpm test && pnpm build` 통과.
  - `pnpm type-check && pnpm test:e2e:extension && pnpm build && pnpm wxt:build` 통과.
  - `pnpm wxt:build` 통과.
- 배포 동기화:
  - `dist/` → `~/Downloads/openmyhealth-v0.1.1-unpacked/`
  - `.output/chrome-mv3/` → `~/Downloads/chrome-mv3-dev/`

## Review & Refactor (2026-02-25, SPEC_md 구현 점검)

### Checklist
- [x] 변경 파일 전체를 크리티컬/과구현/유지보수성 기준으로 점검한다.
- [x] 지나치게 큰 파일(`src/sidepanel/index.ts`, `src/background/index.ts`)을 모듈로 분해한다.
- [x] 승인 프리뷰-전송 간 데이터 불일치 가능성(레드랙션 카운트/선택 ID 드리프트)을 수정한다.
- [x] AI 입력 대상 탭 선택 로직을 보강해 활성 AI 탭 우선으로 안전하게 선택한다.
- [x] 타입체크/린트/유닛/빌드/WXT 빌드/확장 E2E 회귀 검증을 수행한다.

### Review
- 핵심 리팩터링:
  - `src/sidepanel/index.ts` 분해:
    - `src/sidepanel/state.ts`
    - `src/sidepanel/dom.ts`
    - `src/sidepanel/view.ts`
  - `src/background/index.ts` 메시지 처리 분해:
    - `src/background/messageHandlers.ts`
- 기능 안전성 수정:
  - 승인 프리뷰를 `ui.preview`(전체 payload)로 보존하고, 전송 시 해당 payload를 그대로 사용하도록 변경.
  - 후보 선택 변경 시 기존 프리뷰 무효화(`resetPreview`) 처리.
  - AI 탭 선택 시 `활성 탭(유효 AI URL) 우선`으로 resolve하고, fallback은 마지막 AI 탭으로 제한.
- 검증 결과:
  - `pnpm type-check` 통과
  - `pnpm lint` 통과
  - `pnpm test` 통과
  - `pnpm build` 통과
  - `pnpm wxt:build` 통과
  - `pnpm test:e2e:extension` 통과 (2 passed)
  - 추가 정리: 미사용 의존성 `dayjs`, `jsbn`, `@types/jsbn` 제거 후 전체 QA 재통과

## Review & Hardening (2026-02-25, 2차 정합성 점검)

### Checklist
- [x] `SPEC_md` 대비 구현 정합성을 재점검하고 누락 항목을 확인한다.
- [x] 과도한 마스킹 규칙으로 의료 맥락이 손실되는 문제를 완화한다.
- [x] 타입/린트 범위를 엔트리포인트까지 확장해 누락 검증을 방지한다.
- [x] 변경 후 전체 회귀(QA + E2E)를 다시 검증한다.

### Review
- 조치:
  - `redact.ts`의 날짜 전면 마스킹 규칙 제거, `생년월일/DOB` 레이블 기반 마스킹으로 축소.
  - `redact` 테스트 보강(임상 날짜 보존 + 생년월일 마스킹 확인).
  - `tsconfig.json`에 `entrypoints/**/*`, `.wxt/wxt.d.ts` 포함.
  - `eslint.config.js` 대상에 `entrypoints/**/*.ts` 포함.
  - 미사용 의존성 제거 반영(`dayjs`, `jsbn`, `@types/jsbn`).
  - 구현 기준 문서 `SPEC_md` 루트 추가.
- 검증:
  - `pnpm test` 통과 (5 suites, 8 tests)
  - `pnpm type-check` 통과
  - `pnpm lint` 통과
  - `pnpm build` 통과
  - `pnpm wxt:build` 통과
  - `pnpm test:e2e:extension` 통과 (2 passed)
