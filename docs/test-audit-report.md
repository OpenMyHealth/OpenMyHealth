# 테스트 품질 감사 보고서

**프로젝트**: OpenMyHealth (전체 프로젝트)
**감사일**: 2026-03-01
**감사 범위**: Part 1 — `src/core/` 16개 테스트 파일 품질 감사 | Part 2 — 미테스트 파일 34개 전수 감사
**Part 1 커버리지**: lines 99.92%, branches 95.67%, functions 100% (src/core/ only)
**Part 2 발견**: 런타임 로직 보유 25개 파일, 테스트 0개, ~506개 테스트 필요
**스펙 참조**: `docs/spec_v0.1.html`

---

## 목차

### Part 1: `src/core/` 테스트 품질 감사

1. [요약 대시보드](#1-요약-대시보드)
2. [심각도 정의](#2-심각도-정의)
3. [파일별 감사 결과](#3-파일별-감사-결과)
   - [3.1 base64.test.ts](#31-base64testts) ~ [3.16 message-handlers.test.ts](#316-message-handlerstestts)
4. [v8 ignore 사용 종합 평가](#4-v8-ignore-사용-종합-평가)
5. [구조적 한계 종합](#5-구조적-한계-종합)
6. [발견 사항 전체 목록](#6-발견-사항-전체-목록)

### Part 2: 미테스트 파일 전수 감사

7. [미테스트 파일 요약 대시보드](#7-미테스트-파일-요약-대시보드)
8. [파일별 상세 감사](#8-파일별-상세-감사)
   - [8.1 relay/server.ts](#81-packagesrelaysrcserverts) (CRITICAL, 1,310줄)
   - [8.2 contracts/index.ts](#82-packagescontractssrcindexts) (HIGH, 189줄)
   - [8.3 content.tsx](#83-entrypointscontenttsx) (CRITICAL, 797줄)
   - [8.4 vault/main.tsx](#84-entrypointsvaultmaintsx) (CRITICAL, 664줄)
   - [8.5 overlay-utils.ts](#85-srccontentoverlay-utilsts) (CRITICAL, 63줄)
   - [8.6 page-bridge.ts](#86-srccontentpage-bridgets) (CRITICAL, 144줄)
   - [8.7 vault/runtime.ts](#87-entrypointsvaultruntimets) (HIGH, 112줄)
   - [8.8 background.ts](#88-entrypointsbackgroundts) (HIGH, 59줄)
   - [8.9 error-boundary.tsx](#89-srccomponentserror-boundarytsx) (HIGH, 47줄)
   - [8.10 ~ 8.21 나머지 파일](#810-entrypointsvaultcomponentsunlock-sectiontsx) (MEDIUM~LOW)
   - [8.22 ~ 8.30 SKIP 대상](#822-830-skip-대상-파일)
9. [구조적 테스트 가능성 차단 요소](#9-구조적-테스트-가능성-차단-요소)
10. [전체 프로젝트 종합 통계](#10-전체-프로젝트-종합-통계)
11. [권장 테스트 작성 순서](#11-권장-테스트-작성-순서)

---

## 1. 요약 대시보드

| # | 테스트 파일 | 소스 파일 | 등급 | 핵심 이슈 |
|---|-----------|----------|------|----------|
| 1 | `base64.test.ts` | `base64.ts` | **PERFECT** | 없음 |
| 2 | `utils.test.ts` | `utils.ts` | **GOOD** | 스펙 대비 아이콘 3건 불일치 |
| 3 | `crypto.test.ts` | `crypto.ts` | **PERFECT** | 없음 |
| 4 | `runtime-client.test.ts` | `runtime-client.ts` | **PERFECT** | 없음 |
| 5 | `db.test.ts` | `db.ts` | **GOOD** | `restoreMigrationState` ~100줄 미테스트 |
| 6 | `pipeline.test.ts` | `pipeline.ts` | **NEEDS_IMPROVEMENT** | 느슨한 assertion, vacuous isFinite 테스트 |
| 7 | `mcp.test.ts` | `mcp.ts` | **NEEDS_IMPROVEMENT** | MAX_RECORDS 캡 미검증, scanLimit 미테스트 |
| 8 | `state.test.ts` | `state.ts` | **NEEDS_IMPROVEMENT** | 동어반복 테스트, 커버리지 패딩 |
| 9 | `permission-scope.test.ts` | `permission-scope.ts` | **GOOD** | query 정규화 엣지케이스 미테스트 |
| 10 | `sender-validation.test.ts` | `sender-validation.ts` | **GOOD** | vaultTabs 비추가 미검증 |
| 11 | `settings.test.ts` | `settings.ts` | **GOOD** | deriveAesKey 인자 미검증, lockoutUntil 값 약한 검증 |
| 12 | `tab-manager.test.ts` | `tab-manager.ts` | **GOOD** | undefined tabUrl 미테스트 |
| 13 | `overlay.test.ts` | `overlay.ts` | **GOOD** | 없음 |
| 14 | `file-operations.test.ts` | `file-operations.ts` | **GOOD** | 삭제 순서 미검증 |
| 15 | `approval-engine.test.ts` | `approval-engine.ts` | **NEEDS_IMPROVEMENT** | Ghost test, 보안 속성 미검증, 커버리지 추적 패턴 |
| 16 | `message-handlers.test.ts` | `message-handlers.ts` | **GOOD** | monkey-patch 방어 테스트 1건 |

**등급 분포**: PERFECT 3 / GOOD 9 / NEEDS_IMPROVEMENT 4

---

## 2. 심각도 정의

| 심각도 | 의미 |
|--------|------|
| **CRITICAL** | 테스트가 assertion 없이 커버리지만 올리거나, 보안 속성 미검증 |
| **HIGH** | 스펙과 불일치하는 expected value, 또는 실제로 테스트하지 않는 것을 테스트한다고 주장 |
| **MEDIUM** | 느슨한 assertion, 미검증 인자, 구조적으로 테스트 불가 영역 |
| **LOW** | 중복 코드, 네이밍 부정확, 작은 엣지케이스 누락 |

---

## 3. 파일별 감사 결과

### 3.1 `base64.test.ts`

**등급: PERFECT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 모킹 없음 (순수 함수) |
| 테스트 정확성 | 라운드트립, known value, chunk boundary 모두 검증 |
| v8 ignore | 없음 |
| 구조적 한계 | 없음 |

순수 함수 4개(`bytesToBase64`, `base64ToBytes`, `utf8ToBytes`, `bytesToUtf8`)를 모킹 없이 직접 테스트. 빈 값, 대용량(chunk 경계), 멀티바이트 UTF-8(한글, 이모지) 등 엣지케이스 완벽 커버.

**발견 사항: 없음**

---

### 3.2 `utils.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 모킹 없음 (순수 함수) |
| 테스트 정확성 | 대부분 정확, 스펙 대비 아이콘 불일치 3건 |
| v8 ignore | 1건 — 정당 |
| 구조적 한계 | 없음 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| U-1 | HIGH | `resourceLabel` 아이콘 3건 스펙 불일치. 테스트가 코드값을 그대로 검증하여 스펙 위반을 감지 못함 |
| U-2 | LOW | `timingSafeEqual` 테스트 이름 "does not short-circuit"은 기능 테스트로 증명 불가 |

**U-1 상세:**

| ResourceType | 코드 아이콘 | 스펙 아이콘 (Section 6.0) |
|-------------|-----------|------------------------|
| `Condition` | 🩺 | 🏥 |
| `DiagnosticReport` | 🧾 | 📋 |
| `DocumentReference` | 📁 | 📝 |

`utils.ts:7-9`에서 정의된 아이콘과 `spec_v0.1.html` Section 6.0 P1-3 테이블의 아이콘이 다름. 테스트는 코드 값을 그대로 expected로 사용하여 스펙 위반을 잡지 못함.

---

### 3.3 `crypto.test.ts`

**등급: PERFECT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 모킹 없음 — 실제 Web Crypto API 사용 |
| 테스트 정확성 | AES-GCM 라운드트립, PBKDF2 결정성, 변조 감지 모두 검증 |
| v8 ignore | 없음 |
| 구조적 한계 | private 함수(randomBytes, importPinKey)는 공개 API를 통해 간접 테스트 |

암호화 테스트의 모범 사례. 실제 PBKDF2 600K iterations + AES-256-GCM 라운드트립, AAD 변조 감지, 잘못된 키 거부, keyVersion 보존 등을 모킹 없이 검증. 스펙 Section 2.2 step 6 (AES-256-GCM + PBKDF2) 준수 확인.

**발견 사항: 없음**

---

### 3.4 `runtime-client.test.ts`

**등급: PERFECT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 최소 모킹 (browser.runtime.sendMessage만) |
| 테스트 정확성 | 타임아웃, 에러 래핑, envelope 검증 모두 정확 |
| v8 ignore | 없음 |
| 구조적 한계 | 없음 |

`withTimeout` 타이머 정리, `sendRuntimeMessage` envelope 검증, 비-Error 값 stringify 등 모든 분기 커버. 브라우저 API 모킹은 필수적이며 적절.

**발견 사항: 없음**

---

### 3.5 `db.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | fake-indexeddb 사용 (실제 IDB 동작) |
| 테스트 정확성 | CRUD, 마이그레이션, 날짜 필터링 모두 정확 |
| v8 ignore | 다수 — 대부분 정당 |
| 구조적 한계 | 모듈 레벨 싱글톤 (`dbPromise`), `restoreMigrationState` 미테스트 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| DB-1 | MEDIUM | `restoreMigrationState` ~100줄이 v8 ignore로 완전히 미커버. 현재 마이그레이터(v0→v1)에서는 도달 불가하나, 향후 마이그레이션 실패 시 유저 데이터 복원에 사용되는 안전 핵심 코드 |
| DB-2 | LOW | `setupDbWithMeta` 테스트 헬퍼가 프로덕션 스키마 생성 로직을 중복. 스키마 변경 시 동기화 필요 |
| DB-3 | LOW | 공유 fixtures 대신 로컬 헬퍼 함수 사용 (코드 중복) |

---

### 3.6 `pipeline.test.ts`

**등급: NEEDS_IMPROVEMENT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | PDF.js 모킹 — 정당 (WASM 불가) |
| 테스트 정확성 | 느슨한 assertion, vacuous 테스트 존재 |
| v8 ignore | 3건 — 2건 정당, 1건 의문 |
| 구조적 한계 | OCR/WASM 분류 미구현 (스펙 대비 Gap) |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| PL-1 | HIGH | `"skips non-finite numeric values like Infinity"` 테스트가 vacuous. 정규식이 `[0-9]+`만 매칭하므로 `Number()`가 항상 finite 반환 → `isFinite` 가드 도달 불가. 테스트명이 주장하는 동작을 실제 검증하지 않음 |
| PL-2 | MEDIUM | 다수의 assertion이 `toBeGreaterThanOrEqual(1)` 사용. 정확한 개수를 알 수 있는 경우에도 느슨한 검증. 파서 중복 카운팅 버그를 감지 못함 |
| PL-3 | LOW | medication cap 테스트가 `;` 구분자로 regex 동작 우회. regex `\s` 문자 클래스가 `\n` 매칭하는 버그를 노출하지만 근본 해결이 아닌 테스트 우회 |
| PL-4 | MEDIUM | PDF 테스트가 mock 설정 검증만 수행. 실제 `extractPdfText` 로직 미검증 (구조적 한계) |
| PL-5 | LOW | v8 ignore `medication limit break` (line 80-82)가 의문. 테스트가 이 분기를 실행한다면 ignore 불필요 |

---

### 3.7 `mcp.test.ts`

**등급: NEEDS_IMPROVEMENT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | crypto + db 모킹 — 단위 테스트로 정당 |
| 테스트 정확성 | depth/query 매칭은 정확, 제한 검증 부족 |
| v8 ignore | 1건 — 의문 |
| 구조적 한계 | Zod 스키마 검증이 안전망 역할 (강점) |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| MCP-1 | HIGH | `MAX_RECORDS_PER_RESPONSE` 캡 테스트가 실제 캡핑 미검증. `limit: 50`으로 테스트하면 `Math.min(50, 50) = 50`이므로 캡 동작 불검증. `limit: 9999` → 50 결과를 검증해야 함 |
| MCP-2 | MEDIUM | `scanLimit` 분기 미검증. query 존재 시 `5_000`, 미존재 시 `limit` 사용 여부를 `queryResources` 호출 인자로 확인해야 함 |
| MCP-3 | MEDIUM | `matchesQuery`에서 `performer` 필드 매칭 미테스트. `notes` 매칭만 검증 |
| MCP-4 | MEDIUM | `request.limit` 미설정 시 테스트가 레코드 1건만 사용. 60건+ 제공 후 50건 반환 검증 필요 |
| MCP-5 | LOW | v8 ignore `typeof payload.value === "number"` ternary가 의문. 양쪽 분기 테스트한다면 ignore 불필요 |

---

### 3.8 `state.test.ts`

**등급: NEEDS_IMPROVEMENT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 모킹 없음 |
| 테스트 정확성 | 대부분 동어반복 (tautological) |
| v8 ignore | 1건 — 정당 (compile-time ternary) |
| 구조적 한계 | `RUNTIME_MODE`는 빌드별 단일 분기만 도달 가능 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| ST-1 | MEDIUM | 초기값 테스트 7개가 `false === false`, `[] === []` 수준의 동어반복. 회귀 감지 가치 낮음. 커버리지 확보 목적으로 작성된 것으로 보임 |
| ST-2 | MEDIUM | 상수 테스트 3개가 하드코딩된 값의 동일성만 검증. 상수 변경 시 테스트도 함께 변경 필요 → 회귀 감지 불가 |
| ST-3 | LOW | `nowIso` 테스트가 형식만 검증, 현재 시각 검증 안 함. `vi.useFakeTimers()`로 시계 고정 후 정확한 값 검증 필요 |

---

### 3.9 `permission-scope.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 모킹 없음 (순수 함수) |
| 테스트 정확성 | 라운드트립, 엣지케이스 잘 커버 |
| v8 ignore | 없음 |
| 구조적 한계 | 없음 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| PS-1 | LOW | query 정규화(`.trim().toLowerCase()`) 엣지케이스 미테스트. `" Blood Pressure "` → `"blood pressure"` 정규화 검증 필요 |
| PS-2 | LOW | legacy 형식에서 invalid provider, invalid resourceType 분기 미테스트 (invalid depth만 테스트됨) |

---

### 3.10 `sender-validation.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | browser API 글로벌 모킹만 (적절) |
| 테스트 정확성 | 보안 핵심 검증 잘 커버 |
| v8 ignore | 5건 — 모두 정당 (`??`/`?.` micro-branches) |
| 구조적 한계 | `runtimeState` 사이드이펙트 커플링 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| SV-1 | LOW | `isVaultPageSender` 탭 없는 sender 테스트에서 "vaultTabs에 추가 안 됨"이라는 주석의 부정 assertion 누락. `expect(runtimeState.session.vaultTabs.size).toBe(0)` 추가 필요 |
| SV-2 | LOW | `requireVaultSender` 에러 응답 메시지 내용 미검증. `result.ok === false`만 확인하고 에러 메시지 문자열 검증 없음 |
| SV-3 | LOW | 테스트 자체 `makeSender` 헬퍼가 공유 fixtures 버전과 불일치 (`frozen` 프로퍼티 누락) |

---

### 3.11 `settings.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | db + crypto 모킹 — 적절 |
| 테스트 정확성 | PIN 검증, lockout, mutex 잘 테스트 |
| v8 ignore | 1건 — 정당 |
| 구조적 한계 | `verifyAndUnlock`이 복합 책임 (설계 이슈) |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| SET-1 | MEDIUM | `verifyAndUnlock` correct PIN 테스트에서 `deriveAesKey` 호출 인자 미검증. mock이 인자 무관하게 CryptoKey 반환 → 잘못된 salt로 호출해도 통과 |
| SET-2 | MEDIUM | wrong-PIN 테스트에서 `lockoutUntil`이 `toBeTypeOf("number")`만 검증. 정확한 지속 시간(10초 등) 미검증 → 1ms든 1년이든 통과 |
| SET-3 | LOW | `updateSettings` 변경 감지(`JSON.stringify`)의 한계 테스트 없음 (변경 후 복원 시 no-op 감지) |

---

### 3.12 `tab-manager.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | approval-engine + browser.tabs 모킹 — 정당 |
| 테스트 정확성 | 탭 추적, rate limit, provider 탭 검색 정확 |
| v8 ignore | 4건 — 대부분 정당, 1건 주석 과장 |
| 구조적 한계 | 순환 의존으로 동적 import 사용 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| TM-1 | LOW | `trackVaultTab(id, undefined)` — tabUrl이 undefined인 경우 미테스트 |
| TM-2 | LOW | v8 ignore (line 72) 주석이 "all paths tested"라 하지만 `!tab.id` 분기 미테스트. 주석 과장 |
| TM-3 | LOW | `mock-browser.ts` 헬퍼를 사용하지 않고 매번 풀 Tab 객체 수동 생성 (가독성 저하) |

---

### 3.13 `overlay.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | tab-manager + settings 모킹 — 적절 |
| 테스트 정확성 | 성공/실패 경로 모두 정확 |
| v8 ignore | 없음 |
| 구조적 한계 | 없음 |

`isOverlayResponsiveForRequest`가 실제 `sendOverlay`를 통해 테스트되는 점이 좋은 설계(미니 통합 테스트).

**발견 사항: 없음**

---

### 3.14 `file-operations.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | crypto + db + pipeline 3중 모킹 — 오케스트레이터로서 정당 |
| 테스트 정확성 | 업로드/다운로드/삭제 모든 경로 정확 |
| v8 ignore | 없음 |
| 구조적 한계 | 없음 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| FO-1 | LOW | `handleDeleteFile`에서 삭제 순서(리소스 → 파일) 미검증. 데이터 무결성상 순서가 중요하나 assertion 없음 |

---

### 3.15 `approval-engine.test.ts`

**등급: NEEDS_IMPROVEMENT**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 5개 의존성 모킹 — 구조적으로 필수 |
| 테스트 정확성 | 일부 ghost test, 보안 속성 미검증 |
| v8 ignore | 3건 — 정당 |
| 구조적 한계 | 레이스 컨디션 검증 불가, E2E 플로우 미테스트 |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| AE-1 | **CRITICAL** | `pumpQueue` 엣지케이스 테스트(line 1462-1471)에 **assertion이 0개**. 주석으로 "의도한 분기에 도달 못함"을 시인. 커버리지만 올리는 Ghost test |
| AE-2 | **CRITICAL** | `lockSession` 테스트에서 `pending.resolve`가 `LOCKED_SESSION` 에러 응답으로 호출되는지 미검증. `settled === true`만 확인 → "ok" 응답으로 settle되어도 통과 (보안 위반 감지 불가) |
| AE-3 | HIGH | `lockSession`에서 key 삭제 순서 미검증. source에서 `key = null` (line 812) → `settleApproval` (line 828) 순서인데, 역순이면 old key로 데이터 유출 가능. 순서 검증 assertion 없음 |
| AE-4 | HIGH | `addAudit` 호출 인자 미검증. `mockAddAuditLog.toHaveBeenCalled()` 만 확인. `requested_resource_counts`, `shared_resource_counts`, `effectiveSharedTypes` 내용 미검증 |
| AE-5 | HIGH | `armPendingApprovalTimer` 테스트에서 타이머 지속시간 미검증. `timerId !== null`만 확인 → 100ms든 100초든 통과 |
| AE-6 | MEDIUM | `tryAutoApproveAlwaysAllow` 에러 경로 미테스트. `buildMcpResponse`가 non-ok 반환 시 audit에 `"error"` 기록해야 하나, mock이 항상 ok 반환 |
| AE-7 | MEDIUM | `updateSettings` mock이 mutation을 버림 → 설정에 실제 기록된 값 검증 불가 |
| AE-8 | MEDIUM | `persistAlwaysScopes` → `hasAlwaysAllow` 라운드트립 미검증. settings mock이 항상 `alwaysAllowScopes: []` 반환 → 쓰기 후 읽기 연동 검증 없음 |
| AE-9 | LOW | "Additional coverage tests for uncovered lines" (line 698) 섹션이 라인 번호 기반으로 구성 → 커버리지 추적 패턴 가시적 |
| AE-10 | MEDIUM | `enqueueApprovalRequest`에서 timer arming, `hydrateApprovalPreview` fire-and-forget, `deadlineAt` 계산 미검증 |

---

### 3.16 `message-handlers.test.ts`

**등급: GOOD**

| 항목 | 평가 |
|------|------|
| 모킹 수준 | 9개 의존성 모킹 — 오케스트레이터로서 정당 |
| 테스트 정확성 | 19개 핸들러 전부 성공+실패 경로 커버 |
| v8 ignore | 없음 |
| 구조적 한계 | 통합 보안 속성 검증 불가 (vault 전용 메시지 격리) |

**발견 사항:**

| ID | 심각도 | 내용 |
|----|--------|------|
| MH-1 | LOW | monkey-patching 방어 테스트(line 1532-1543): `runtimeHandlers`에 `undefined` 핸들러를 주입하여 방어 분기 커버. TypeScript `satisfies` 제약으로 프로덕션에서 도달 불가 → 커버리지 동기 테스트 |
| MH-2 | LOW | `handleApprovalDecision` 20개 분기 테스트는 우수. 단, `handleRevokePermission`에서 settings에 실제 기록된 필터 결과 미검증 (mock이 mutation 버림) |
| MH-3 | MEDIUM | "vault-only 메시지를 content script에서 호출 불가" 보안 속성이 `requireVaultSender()` 호출 여부만 확인. 실제 거부 로직은 `sender-validation.test.ts`에 위임 → 통합 검증 부재 |

---

## 4. v8 ignore 사용 종합 평가

### 정당한 사용 (대부분)

| 카테고리 | 해당 파일 | 건수 | 평가 |
|----------|----------|------|------|
| Compile-time ternary | `state.ts` | 1 | 빌드별 단일 분기 도달 |
| `??`/`?.` micro-branch | `sender-validation.ts` | 5 | V8이 nullish coalescing을 별도 분기로 카운팅 |
| IDB 라이프사이클 콜백 | `db.ts` | 12+ | fake-indexeddb로 트리거 불가 |
| `&&` 단축 평가 | `approval-engine.ts` | 2 | V8 복합 조건 분기 카운팅 한계 |
| 타입 내로잉 가드 | `approval-engine.ts` | 1 | Map.set() 직후 Map.get() — 항상 defined |
| NaN 방어 가드 | `utils.ts` | 1 | `|| 0`이 논리적으로 실행되나 V8 미추적 |
| 도달 불가 방어 코드 | `tab-manager.ts`, `pipeline.ts` | 5 | 타입 시스템/regex로 보장된 불변 조건 |

### 의문스러운 사용

| 파일 | 위치 | 이유 |
|------|------|------|
| `mcp.ts:57-58` | `typeof ternary` | 양쪽 분기 테스트 존재한다면 ignore 불필요. V8 quirk인지 실제 미커버인지 확인 필요 |
| `pipeline.ts:80-82` | `medication break` | 테스트가 이 분기를 실행한다면 ignore 불필요. 실행 여부 확인 필요 |
| `tab-manager.ts:72` | `tab.id &&` | 주석 "all paths tested"이나 `!tab.id` 분기는 미테스트 |

### 주목할 미테스트 영역

| 파일 | 위치 | 규모 | 위험도 |
|------|------|------|--------|
| `db.ts:327-424` | `restoreMigrationState` | ~100줄 | **높음** — 마이그레이션 실패 시 유저 데이터 복원 로직 |
| `db.ts:280-313` | backup non-settings stores | ~30줄 | 낮음 — 현재 사용 안 됨 |
| `db.ts:465-474` | migration catch block | ~10줄 | 낮음 — 현재 마이그레이터 실패 불가 |

---

## 5. 구조적 한계 종합

### 5.1 테스트 불가 아키텍처 패턴

| 패턴 | 영향 파일 | 설명 |
|------|----------|------|
| 모듈 레벨 싱글톤 | `db.ts` (`dbPromise`), `state.ts` (`runtimeState`) | 테스트 간 상태 격리를 위해 `vi.resetModules()` 필수. 누락 시 테스트 간 누수 |
| 동적 import 순환 의존 | `tab-manager.ts` → `approval-engine.ts` | `void import(...)` 패턴으로 실제 통합 테스트 불가 |
| Fire-and-forget 비동기 | `approval-engine.ts` (`hydrateApprovalPreview`, `tryAutoApprove` overlay 체크) | 비동기 부작용의 완료를 테스트에서 관찰하기 어려움 |
| Browser Extension API | `runtime-client.ts`, `tab-manager.ts`, `overlay.ts` | 테스트 환경에 존재하지 않아 모킹 필수 |

### 5.2 스펙 대비 미구현 (테스트와 무관)

| 스펙 항목 | 현재 상태 | 비고 |
|----------|----------|------|
| OCR (Tesseract.js WASM) | 이미지 → DocumentReference 단순 변환 | 스펙 Section 2.2 |
| WASM BERT 분류 | 규칙 기반(regex) 폴백만 구현 | 스펙에서 폴백으로 명시 |
| 30회 실패 자동 삭제 | 미구현 | 스펙 "기본 OFF" (v0.1 범위 외) |

### 5.3 통합 테스트 부재

현재 테스트 스위트는 전부 단위 테스트. 다음 크로스모듈 시나리오에 대한 통합 테스트가 없음:

1. **E2E 승인 플로우**: `mcp:enqueue-request` → `approval:decision` → 데이터 공유 → 감사 로그
2. **세션 잠금 카스케이드**: 세션 잠금 → 모든 pending 승인 거부 → 에러 응답 전파
3. **content script → vault 메시지 격리**: vault 전용 메시지가 content script sender에서 실제 거부되는지
4. **persistAlwaysScopes → hasAlwaysAllow 라운드트립**: 설정 쓰기 → 읽기 → 매칭

---

## 6. 발견 사항 전체 목록

### CRITICAL (2건)

| ID | 파일 | 내용 |
|----|------|------|
| AE-1 | `approval-engine.test.ts:1462-1471` | Ghost test — assertion 0개로 커버리지만 올림 |
| AE-2 | `approval-engine.test.ts:506-516` | `lockSession` 보안 속성 미검증 — `LOCKED_SESSION` 에러 응답 미확인 |

### HIGH (7건)

| ID | 파일 | 내용 |
|----|------|------|
| U-1 | `utils.test.ts:19-28` | 스펙 대비 아이콘 3건 불일치 (Condition, DiagnosticReport, DocumentReference) |
| PL-1 | `pipeline.test.ts:90-104` | Vacuous `isFinite` 테스트 — 도달 불가 분기를 테스트한다고 주장 |
| MCP-1 | `mcp.test.ts:231-243` | `MAX_RECORDS_PER_RESPONSE` 캡핑 동작 실질 미검증 |
| AE-3 | `approval-engine.test.ts:498-516` | `lockSession` key 삭제 순서 미검증 — 역순 시 데이터 유출 가능 |
| AE-4 | `approval-engine.test.ts:360` | `addAudit` 호출 인자 미검증 — 감사 로그 내용 정확성 확인 없음 |
| AE-5 | `approval-engine.test.ts:180-185` | 타이머 지속시간 미검증 — 값 무관하게 통과 |
| AE-6 | `approval-engine.test.ts` | `tryAutoApproveAlwaysAllow` 에러 audit 경로 미테스트 |

### MEDIUM (12건)

| ID | 파일 | 내용 |
|----|------|------|
| DB-1 | `db.ts:327-424` | `restoreMigrationState` ~100줄 미테스트 (안전 핵심 코드) |
| PL-2 | `pipeline.test.ts` | 느슨한 assertion `toBeGreaterThanOrEqual(1)` 다수 |
| PL-4 | `pipeline.test.ts:191-216` | PDF 테스트가 mock 설정만 검증 |
| MCP-2 | `mcp.test.ts` | `scanLimit` 분기(query 유무에 따른 5000 vs limit) 미검증 |
| MCP-3 | `mcp.test.ts` | `matchesQuery` `performer` 필드 매칭 미테스트 |
| MCP-4 | `mcp.test.ts:315-328` | `request.limit` 미설정 시 대량 레코드 테스트 필요 |
| ST-1 | `state.test.ts:9-39` | 초기값 동어반복 테스트 7건 |
| ST-2 | `state.test.ts:97-109` | 상수 동어반복 테스트 3건 |
| SET-1 | `settings.test.ts:167-182` | `deriveAesKey` 호출 인자(pin, salt) 미검증 |
| SET-2 | `settings.test.ts:225-239` | `lockoutUntil` 값 느슨한 검증 (`toBeTypeOf("number")`) |
| AE-7 | `approval-engine.test.ts` | `updateSettings` mock이 mutation 결과 버림 |
| MH-3 | `message-handlers.test.ts` | vault-only 메시지 격리 통합 검증 부재 |

### LOW (14건)

| ID | 파일 | 내용 |
|----|------|------|
| U-2 | `utils.test.ts:109` | 테스트명 "does not short-circuit" 증명 불가 |
| DB-2 | `db.test.ts` | `setupDbWithMeta` 스키마 중복 |
| DB-3 | `db.test.ts` | 공유 fixtures 미사용 |
| PL-3 | `pipeline.test.ts:131-139` | medication cap `;` 구분자 우회 |
| PL-5 | `pipeline.ts:80-82` | medication break v8 ignore 필요성 의문 |
| MCP-5 | `mcp.ts:57-58` | typeof ternary v8 ignore 필요성 의문 |
| ST-3 | `state.test.ts:88-95` | `nowIso` 형식만 검증, 값 미검증 |
| PS-1 | `permission-scope.test.ts` | query 정규화 엣지케이스 미테스트 |
| PS-2 | `permission-scope.test.ts` | legacy invalid provider/resourceType 미테스트 |
| SV-1 | `sender-validation.test.ts:153-160` | vaultTabs 비추가 부정 assertion 누락 |
| SV-2 | `sender-validation.test.ts:285-319` | 에러 메시지 내용 미검증 |
| SV-3 | `sender-validation.test.ts` | 테스트 `makeSender`와 공유 fixtures 불일치 |
| TM-1 | `tab-manager.test.ts` | `trackVaultTab(id, undefined)` 미테스트 |
| TM-2 | `tab-manager.ts:72` | v8 ignore 주석 과장 |
| TM-3 | `tab-manager.test.ts` | `mock-browser.ts` 헬퍼 미사용 |
| SET-3 | `settings.test.ts` | `updateSettings` 변경감지 한계 미테스트 |
| FO-1 | `file-operations.test.ts` | `handleDeleteFile` 삭제 순서 미검증 |
| MH-1 | `message-handlers.test.ts:1532-1543` | 도달 불가 방어 분기 monkey-patch 테스트 |
| MH-2 | `message-handlers.test.ts` | `handleRevokePermission` settings 필터 결과 미검증 |
| AE-8 | `approval-engine.test.ts` | `persistAlwaysScopes` → `hasAlwaysAllow` 라운드트립 미검증 |
| AE-9 | `approval-engine.test.ts:698` | 커버리지 추적 패턴 (라인 번호 기반 테스트 구성) |
| AE-10 | `approval-engine.test.ts` | `enqueueApprovalRequest` timer arming/deadlineAt 미검증 |

---

## 종합 평가 (src/core/)

**전체 진단**: 16개 테스트 파일 중 **12개(75%)** 가 GOOD 이상. 커버리지 수치(99.92%)는 대부분 실질적인 테스트로 달성되었으며, 모킹-테스트-모킹 패턴이나 빈 assertion 같은 심각한 안티패턴은 **1건(AE-1 ghost test)** 만 발견.

**주요 우려 영역**:
1. `approval-engine.test.ts`가 보안 핵심 모듈임에도 보안 속성(에러 응답 내용, key 삭제 순서) 검증이 부족
2. `pipeline.test.ts`와 `mcp.test.ts`에서 느슨한 assertion으로 인해 회귀 감지력이 떨어짐
3. 통합 테스트 부재로 크로스모듈 보안 속성(E2E 승인 플로우, 세션 잠금 카스케이드) 미검증
4. `db.ts`의 `restoreMigrationState` ~100줄이 안전 핵심 코드임에도 미테스트 (향후 마이그레이션 추가 시 위험)

**긍정적 측면**:
- `crypto.test.ts`는 실제 Web Crypto를 사용한 암호화 테스트의 모범 사례
- `sender-validation.test.ts`는 보안 공격 벡터(프로토콜 다운그레이드, 서브도메인 스푸핑, iframe 주입) 잘 커버
- `message-handlers.test.ts`는 19개 핸들러 전부 성공+실패 경로 테스트
- 대부분의 v8 ignore 사용은 정당하며 문서화가 잘 되어 있음

---
---

# Part 2: 미테스트 파일 전수 감사

**감사일**: 2026-03-01
**감사 범위**: `src/core/` 외 전체 프로젝트 — `packages/`, `entrypoints/`, `src/content/`, `src/components/`, `src/hooks/`, `src/lib/`
**발견 파일 수**: 테스트 0개인 소스 파일 **34개** (런타임 로직 보유 25개, SKIP 9개)
**예상 필요 테스트 수**: **~506개**

---

## 7. 미테스트 파일 요약 대시보드

| # | 파일 | 줄 수 | 우선도 | 예상 테스트 수 | 핵심 위험 |
|---|------|------|--------|-------------|----------|
| 1 | `packages/relay/src/server.ts` | 1,310 | **CRITICAL** | ~151 | OAuth2+JWT+PKCE+MCP 전체가 미테스트, 보안 최고위험 |
| 2 | `entrypoints/content.tsx` | 797 | **CRITICAL** | ~48 | 승인/거부 플로우, 타이머 자동거부, fail-safe |
| 3 | `entrypoints/vault/main.tsx` | 664 | **CRITICAL** | ~47 | PIN 보안, 파일 암호화, 권한 관리 |
| 4 | `src/content/overlay-utils.ts` | 63 | **CRITICAL** | ~25 | 3단계 타이머 색상, 아이템 필터링 (데이터 노출 제어) |
| 5 | `src/content/page-bridge.ts` | 144 | **CRITICAL** | ~15 | 건강기록 요청의 주요 데이터 게이트웨이 |
| 6 | `packages/contracts/src/index.ts` | 189 | **HIGH** | ~60 | 공유 계약: Zod 스키마 + 빌더 함수 (3개 서브시스템이 의존) |
| 7 | `entrypoints/vault/runtime.ts` | 112 | **HIGH** | ~22 | 보안 흐름의 사용자 대면 메시지 (lockout 안내) |
| 8 | `entrypoints/background.ts` | 59 | **HIGH** | ~11 | 확장 프로그램 생명주기, 메시지 라우팅 |
| 9 | `src/components/error-boundary.tsx` | 47 | **HIGH** | ~7 | 오류 복구의 단일 장애점 |
| 10 | `entrypoints/vault/components/unlock-section.tsx` | 93 | **HIGH** | ~10 | 잠금 해제 UI, 무차별 대입 방지 표시 |
| 11 | `entrypoints/setup/main.tsx` | 221 | **MEDIUM** | ~15 | 최초 실행 PIN 설정 |
| 12 | `entrypoints/vault/components/upload-section.tsx` | 218 | **MEDIUM** | ~16 | 파일 업로드 UX (드래그&드롭) |
| 13 | `src/hooks/use-toast.ts` | 87 | **MEDIUM** | ~14 | 모듈 레벨 싱글턴 상태, 자동 제거 타이머 |
| 14 | `entrypoints/vault/components/audit-log-section.tsx` | 119 | **MEDIUM** | ~12 | 감사 추적 렌더링 |
| 15 | `entrypoints/vault/components/pin-setup-section.tsx` | 118 | **MEDIUM** | ~10 | PIN 입력 정제 |
| 16 | `entrypoints/vault/components/permission-section.tsx` | 94 | **MEDIUM** | ~10 | 권한 해제 UI |
| 17 | `entrypoints/vault/components/provider-section.tsx` | 133 | **MEDIUM** | ~10 | AI 제공자 선택 |
| 18 | `entrypoints/setup/bootstrap.ts` | 57 | **LOW** | ~8 | 부트 복원력 |
| 19 | `entrypoints/vault/bootstrap.ts` | 57 | **LOW** | ~8 | 부트 복원력 |
| 20 | `entrypoints/vault/components/trust-anchor-section.tsx` | 58 | **LOW** | ~4 | 정적 카드 표시 |
| 21 | `src/lib/utils.ts` | 6 | **LOW** | ~3 | clsx+twMerge 래퍼 (스모크 테스트만) |
| — | `src/content/style.ts` | 187 | **SKIP** | 0 | 순수 CSS 상수 |
| — | `src/core/constants.ts` | 23 | **SKIP** | 0 | 순수 상수 |
| — | `src/core/messages.ts` | 112 | **SKIP** | 0 | 순수 타입 정의 |
| — | `src/core/models.ts` | 141 | **SKIP** | 0 | 순수 타입 정의 |
| — | `src/components/ui/*.tsx` (16개) | ~900 | **SKIP** | 0 | shadcn/ui 표준 래퍼, 업스트림 테스트됨 |

**우선도 분포**: CRITICAL 5 / HIGH 5 / MEDIUM 7 / LOW 4 / SKIP 9+

---

## 8. 파일별 상세 감사

### 8.1 `packages/relay/src/server.ts`

**등급: CRITICAL** — 프로젝트에서 보안 위험이 가장 높은 파일

| 속성 | 값 |
|------|-----|
| 줄 수 | 1,310 |
| 함수 수 | 56개 |
| 테스트 | **0개** |
| 의존성 | `node:http`, `node:crypto`, `@openmyhealth/contracts` |
| Exports | **없음** (모듈 전체가 side-effect) |

#### 아키텍처

단일 파일 Node.js HTTP 서버. 두 가지 역할:
1. **OAuth 2.0 인가 서버** — Authorization Code + PKCE(S256), 동의 화면, CSRF 방어, JWT 액세스 토큰, 회전 리프레시 토큰
2. **MCP 릴레이** — JSON-RPC 2.0 (`read_health_records`), SSE 전송, REST 엔드포인트

모든 상태(인가 코드, 대기 중 인가, 리프레시 토큰)는 인메모리 `Map`에 보관.

#### 런타임 함수 목록 (56개)

**설정/유틸리티** (6개):
- `normalizeRedirectUri` (72-82) — HTTPS 강제, 자격증명 거부, 해시 제거
- `parseCsvList` (84-89) — CSV 파싱
- `parseClientRedirects` (91-144) — 클라이언트+리다이렉트 허용목록 파싱
- `normalizePublicOrigin` (146-152) — 프로토콜 검증
- `normalizeBridgeUrl` (154-164) — 브릿지 URL 검증 (루프백 전용 HTTP 허용)
- `isLoopbackHost` (166-168) — 127.0.0.1/::1/localhost 체크

**암호화/토큰** (12개):
- `now` (204-206) — Unix 초 단위 타임스탬프
- `sha256Base64Url` (208-210) — PKCE 검증용 SHA-256
- `randomToken` (212-214) — 암호학적 랜덤 base64url
- `safeStringEqual` (216-223) — 타이밍 안전 비교
- `base64UrlJson` (337-339) — JSON → base64url
- `signJwt` (361-372) — HS256 JWT 서명
- `verifyJwt` (374-433) — JWT 검증 (서명, exp, nbf, iss, aud, scope, sub)
- `issueAccessToken` (435-447) — 1시간 TTL JWT 발급
- `hashRefreshToken` (449-451) — SHA-256 해시
- `revokeRefreshFamily` (453-459) — 패밀리 전체 폐기 (재사용 탐지)
- `issueRefreshToken` (461-484) — 랜덤 리프레시 토큰 발급
- `signConsentToken` (595-597) — CSRF용 HMAC-SHA256

**HTTP 응답 헬퍼** (9개):
- `json` (248-261), `html` (263-279), `escapeHtml` (281-288), `redirect` (290-297)
- `unauthorized` (504-506), `invalidGrant` (508-510), `notFound` (512-514)
- `jsonRpcResult` (516-522), `jsonRpcError` (524-541)

**요청 파싱** (5개):
- `parseCookies` (225-240), `requestFingerprint` (242-246)
- `parseBodyRaw` (299-322) — 1MB 제한, `parseFormBody` (324-327), `parseJsonBody` (329-335)

**OAuth 핸들러** (8개):
- `parseAuthorizeParams` (599-626) — 인가 요청 파라미터 검증
- `issueAuthCode` (628-646) — 인가 코드 발급 (5분 TTL)
- `renderConsentPage` (648-683) — 동의 HTML 페이지 렌더링
- `buildDenyRedirect` (685-691) — 거부 리다이렉트 URL
- `handleAuthorize` (693-722) — GET /authorize
- `handleAuthorizeConfirm` (724-834) — POST /authorize/confirm **(가장 복잡: 110줄)**
- `handleToken` (836-925) — POST /token (authorization_code + refresh_token)
- `sendTokenResponse` (486-502) — 토큰 응답 전송

**MCP 핸들러** (7개):
- `forwardToBridge` (927-965) — 55초 타임아웃으로 브릿지 전달
- `getBearerClaims` (967-975) — Bearer JWT 추출/검증
- `executeReadHealthRecords` (977-1017) — Zod 검증 후 브릿지 전달
- `parseJsonRpcRequest` (1019-1036) — JSON-RPC 2.0 구조 검증
- `readHealthRecordsToolDefinition` (1038-1063) — MCP 도구 정의
- `handleMcpRpc` (1065-1167) — POST /mcp JSON-RPC 라우터
- `handleMcpRead` (1169-1186) — POST /mcp/read_health_records

**기타** (9개):
- `openSseStream` (543-583), `handleMcpSse` (1188-1195), `consentCookie` (585-588)
- `clearConsentCookie` (590-593), `isClientAllowed` (341-343), `isRedirectAllowed` (345-359)
- `cleanupExpiredTokens` (1282-1299), `RequestBodyTooLargeError` 클래스 (197-202)
- 메인 HTTP 라우터 (1197-1280)

#### 보안 필수 테스트 경로 (28개)

**CRITICAL (악용 가능)** — 15개:
| # | 보안 경로 | 위험 | 라인 |
|---|----------|------|------|
| S1 | JWT 서명 검증 (타이밍 안전) | 토큰 위조 | 374-433 |
| S2 | PKCE 검증자 유효성 검사 | 인가 코드 가로채기 | 876-883 |
| S3 | 인가 코드 일회용 강제 | 재생 공격 | 857 |
| S4 | 리프레시 토큰 일회용 + 패밀리 폐기 | 토큰 도난 탐지 | 911-921 |
| S5 | 동의 확인 시 Origin 헤더 검증 | CSRF 공격 | 742-748 |
| S6 | 동의 확인 시 CSRF 토큰 검증 | 크로스사이트 폼 제출 | 793-798 |
| S7 | 동의 쿠키 nonce 검증 | 세션 고정 | 785-791 |
| S8 | 리다이렉트 URI 허용목록 강제 | 오픈 리다이렉트 | 345-359 |
| S9 | 클라이언트 ID 허용목록 강제 | 미인가 클라이언트 | 341-343 |
| S10 | Sec-Fetch-Site/Mode/Dest 검증 | Fetch 메타데이터 공격 방지 | 764-783 |
| S11 | 요청 핑거프린트 검증 | 세션 도용 | 800-809 |
| S12 | JWT 만료 시간 강제 | 만료 토큰 사용 | 413-415 |
| S13 | JWT 발급자 검증 | 크로스서비스 토큰 혼동 | 419-421 |
| S14 | JWT audience 검증 | 토큰 오결합 | 422-424 |
| S15 | JWT scope 강제 | 권한 상승 | 425-427 |

**HIGH (심층 방어)** — 13개:
| # | 보안 경로 | 위험 | 라인 |
|---|----------|------|------|
| S16 | HTTPS 전용 리다이렉트 URI | HTTP를 통한 자격증명 유출 | 74-76 |
| S17 | 리다이렉트 URI에 자격증명 금지 | 자격증명 노출 | 77-79 |
| S18 | 요청 본문 1MB 제한 | 대용량 페이로드 DoS | 306-309 |
| S19 | 동의 페이지 HTML 이스케이프 | XSS | 281-288 |
| S20 | HTML 응답 보안 헤더 | 클릭재킹, MIME 스니핑 | 270-276 |
| S21 | Cache-Control: no-store | 토큰 캐싱 | 257 |
| S22 | HttpOnly + SameSite=Lax 쿠키 | JS를 통한 쿠키 도용 | 585-588 |
| S23 | HTTPS의 Secure 쿠키 플래그 | 쿠키 가로채기 | 586 |
| S24 | 브릿지 URL HTTPS 강제 | 브릿지의 MITM | 160-161 |
| S25 | JWT_SECRET 최소 길이 | 약한 비밀키 | 67-69 |
| S26 | 비루프백 호스트 방지 | 실수로 공개 노출 | 170-172 |
| S27 | 모든 토큰 체크에 타이밍 안전 비교 | 타이밍 공격 | 216-223 |
| S28 | 최대 저장소 크기 (1000/1000/5000) | 메모리 고갈 DoS | 188-190 |

#### 테스트 가능성 평가

**치명적 차단 요소**:
1. **Export 없음** — 모든 함수, 상수, 저장소가 모듈 프라이빗. HTTP 통합 테스트 또는 리팩터링 필요.
2. **임포트 시 사이드 이펙트** — 환경변수 검증이 모듈 최상위에서 실행. `import()` 전에 환경변수 설정 필수.
3. **서버 자동 시작** (1308줄) — 팩토리 함수 없음. 테스트에서 모듈 임포트 시 실제 서버 시작됨.
4. **전역 가변 상태** — `authCodes`, `pendingAuthorizations`, `refreshStore` Map이 프라이빗이며 테스트 간 초기화 불가.
5. **의존성 주입 없음** — `JWT_SECRET`, `BRIDGE_URL` 등이 모듈 레벨 변수로 1회 계산.

**권장 리팩터링**:
- `createServer(config)` 팩토리 함수 추출 → 설정 주입 가능
- 순수 유틸리티 함수 export → 독립 단위 테스트 가능
- 저장소를 주입 가능/초기화 가능하게 변경
- 서버 시작을 모듈 본문에서 분리 (`if (import.meta.url === ...)` 가드)

**리팩터링 없는 실용적 접근**:
- 동적 `import()`로 환경변수 설정 후 모듈 로드, 서버 캡처, HTTP 요청으로 테스트, `server.close()`로 정리. 느리지만 작동.

#### 스펙 준수

| 스펙 요구사항 | 구현 | 상태 |
|-------------|------|------|
| OAuth 2.0 인가 코드 플로우 | 완전 구현 | MATCH |
| JWT Stateless (스펙 A-2) | HS256 JWT, 토큰 DB 없음 | MATCH |
| 액세스 토큰 1시간 TTL | `ACCESS_TOKEN_TTL_SECONDS = 3600` | MATCH |
| 리프레시 토큰 30일 TTL | `now() + 30 * 24 * 60 * 60` | MATCH |
| 리프레시 토큰 회전 (1회용) | `used: boolean` + 패밀리 폐기 | MATCH |
| Streamable HTTP (스펙 A-5) | POST /mcp JSON-RPC | MATCH |
| SSE 폴백 | GET /mcp SSE | MATCH |
| `read_health_records` 도구 | 스펙 6.0 도구 정의와 일치 | MATCH |
| 서버 타임아웃 55초 (스펙 6.3) | `AbortSignal.timeout(55_000)` | MATCH |
| Zero Storage (스펙 A-1) | 건강 데이터 저장 없음, 임시 인증 상태만 | MATCH |
| scope: "mcp:read" | verifyJwt에서 체크, 토큰에서 발급 | MATCH |

**불일치/갭**:
- 스펙은 "서버에 토큰 DB 없음"이라 했지만 `refreshStore`는 인메모리 토큰 DB. 영속적 DB가 아니므로 사실상 준수.
- 스펙에 PKCE가 명시되지 않음. 구현은 S256 강제 — 스펙 초과 보안 강화.
- `limit` 파라미터가 도구 정의에 있지만 스펙에는 없음.

#### 예상 테스트: **~151개** (유닛 ~40 + HTTP 통합 ~110)

---

### 8.2 `packages/contracts/src/index.ts`

**등급: HIGH**

| 속성 | 값 |
|------|-----|
| 줄 수 | 189 |
| 패키지 | `@openmyhealth/contracts` v0.1.0 |
| 테스트 | **0개** |
| 의존성 | `zod` (단일) |
| Exports | 상수 1, Zod 스키마 14, 타입 12, 빌더 함수 3 |

#### 런타임 로직

**Zod 스키마 (14개)** — 런타임 유효성 검사 로직:
- `AiProviderSchema` (5) — `z.enum(["chatgpt", "claude", "gemini"])`
- `ResourceTypeSchema` (8-14) — FHIR 리소스 타입 5종
- `ResourceCountMapSchema` (17-23) — 선택적 필드, `nonnegative().int()` 제약
- `McpDepthSchema` (26) — codes/summary/detail
- `McpStatusSchema` (29) — ok/denied/timeout/error
- `McpErrorCodeSchema` (32-41) — 오류 코드 8종
- `IsoDateSchema` (44-47) — `Date.parse()` 커스텀 refinement **(가장 복잡한 유효성 검사)**
- `ReadHealthRecordsRequestSchema` (49-56) — `.min(1)`, `.trim()`, `.max(500)`, `.positive()`, `.max(50)`, `.default()` 의미론
- `McpDataRecordSchema` (59-76) — union 타입, 중첩 선택적 객체
- `McpResourceResultSchema` (79-83), `ReadHealthRecordsResponseSchema` (86-105)
- `AuditResultSchema` (166), `PermissionLevelSchema` (170), `AuditLogEntrySchema` (173-188)

**빌더 함수 (3개)** — 순수 함수:
- `buildMcpErrorResponse` (108-132) — 에러 응답 생성 (status, error 필드 채움)
- `buildMcpDeniedResponse` (134-148) — 거부 응답 ("요청이 거절되었습니다.")
- `buildMcpTimeoutResponse` (150-164) — 타임아웃 응답 ("요청 시간이 초과되었습니다.")

**상수**: `MAX_RECORDS_PER_RESPONSE = 50`

#### 테스트 가능성: **매우 쉬움**
순수 함수 + Zod 스키마. 모킹 불필요. 비동기 없음. Node.js 표준 환경.

#### 스펙 불일치
| # | 이슈 | 심각도 |
|---|------|--------|
| D1 | `AuditResultSchema`에 `"error"` 포함 — 스펙은 3개 값만 (approved/denied/timeout) | LOW |
| D2 | `ReadHealthRecordsRequestSchema`에 `limit` 필드 — 스펙 도구 스키마에 없음 | LOW |
| D3 | `McpErrorCodeSchema` 8개 코드 — 스펙에 미정의 | INFO |
| D4 | `AuditLogEntrySchema`에 스펙 외 필드 추가 (requested_resource_counts 등) | INFO |

#### 인프라 참고
루트 `vitest.config.ts`는 `src/**/*.test.ts`만 포함. `packages/` 테스트를 위해 include 패턴 확장 또는 별도 vitest 설정 필요.

#### 예상 테스트: **~60개** (순수 Zod 파싱, <1초 실행)

---

### 8.3 `entrypoints/content.tsx`

**등급: CRITICAL** — 보안 경계: 건강 데이터 승인/거부 의사결정 흐름

| 속성 | 값 |
|------|-----|
| 줄 수 | 797 |
| 역할 | chatgpt.com/claude.ai에 주입되는 Content Script. Shadow DOM 승인 오버레이 렌더링 |
| 테스트 | **0개** |
| 주요 컴포넌트 | `OverlayApp` (678줄), `OverlayFallback` (38줄) |

#### 런타임 함수 (22개)

**최상위**:
- `sendOverlayMessage()` (28-35) — 20초 타임아웃 런타임 메시지
- `detectProvider()` (37-42) — hostname으로 claude/chatgpt 판별

**OverlayApp 내부 함수** (16개):
- `clearHideTimer()`, `scheduleHide()`, `resetTimerAnnouncement()` — 타이머 관리
- `acknowledgeApprovalRendered()` (96-103) — 배경에 렌더 ACK 전송
- `applyIncomingRequest()` (105-117) — 새 요청 수신 시 상태 초기화
- `applyPreviewUpdate()` (119-137) — 사용자 커스텀 유지하며 미리보기 업데이트
- `showResolvedStatus()` (139-154) — 승인/거부/에러→한국어 텍스트, 자동 숨김
- `openVault()` (339-357), `applyDecisionResponse()` (359-379)
- `approve()` (381-417) — **핵심**: 선택 검증, "always" 권한 + 커스텀 아이템 방지
- `deny()` (419-438), `toggleType()` (440-458), `toggleItem()` (460-487)
- `toggleAlwaysAllow()` (489-497), `confirmAlwaysAllow()`, `cancelAlwaysAllow()`
- `retryLastAction()` (508-527)

**useEffect 훅** (6개):
- 요청 ID 동기화 (156-159), 포커스 관리 (161-172)
- 메인 이벤트 리스너 (174-231) — MCP 브릿지 + 모든 OverlayEvent 처리
- ACK 렌더 (233-243), 타이머 인터벌 (245-256), 키보드 핸들러 (280-327)

**OverlayFallback**: 렌더 실패 시 `overlay:render-failed` 전송 → 배경에서 자동 거부 (fail-safe)

#### 핵심 테스트 케이스

**보안 필수** (먼저 작성해야 할 테스트):
1. `approve()` — 빈 리소스 선택 시 거부 (실수로 전체 데이터 전송 방지)
2. `approve()` — "always" 권한 + 커스텀 아이템 선택 시 거부
3. `deny()` — 정확한 메시지 형태 전송
4. 타이머 자동 거부 — 남은 시간 0 → "timeout" 모드 전환 (절대 "approved"가 아닌)
5. `OverlayFallback` — 마운트 시 `overlay:render-failed` 전송 (fail-safe 자동 거부)
6. `applyDecisionResponse()` 만료 요청 체크 — 이미 해결된 요청에 행동 방지
7. Escape 키 → approval 모드에서만 deny 호출
8. Tab 트랩 — 포커스가 다이얼로그 안에서만 순환

#### 테스트 가능성 차단 요소
1. **Closed Shadow DOM** (`mode: "closed"`) — 테스트에서 shadow root 접근 불가. 프로덕션에서는 closed, 테스트에서는 open으로 변경하거나 `main()` 외부에서 컴포넌트 테스트 필요.
2. **컴포넌트 클로저 내 모든 함수** — 독립 단위 테스트 불가. 커스텀 훅으로 추출 권장.
3. **모듈 레벨 가변 상태** (`lastKnownRequestId`)
4. **WXT `defineContentScript` 래퍼**

#### 스펙 준수: 전체 일치
- 6.2: 기본+상세 모드, [전송][거부] 버튼, 프라이버시 메시지
- 6.3: 3단계 타이머 (blue/amber/red), 5초/15초 알림
- 9.2: 렌더 실패 → 자동 거부 (fail-safe)

#### 예상 테스트: **~48개**

---

### 8.4 `entrypoints/vault/main.tsx`

**등급: CRITICAL** — 메인 UI, PIN 보안 + 파일 암호화 + 권한 관리

| 속성 | 값 |
|------|-----|
| 줄 수 | 664 |
| 역할 | Vault 페이지. PIN 설정/해제/잠금, 파일 업로드/다운로드/삭제, AI 제공자 선택, 권한 관리, 감사 로그 |
| 테스트 | **0개** |
| 상태 변수 | 19개 |
| 내부 함수 | 13개 |

#### 핵심 함수

| 함수 | 라인 | 설명 |
|------|------|------|
| `refreshState()` | 96-124 | 금고 상태 가져오기 (epoch 가드로 만료 응답 무시) |
| `setupPin()` | 179-213 | PIN 6자리 검증 + 설정 |
| `unlock()` | 215-261 | PIN 해제 + lockout 처리 |
| `lock()` | 263-278 | 세션 잠금 |
| `setProvider()` | 280-297 | AI 제공자 설정 |
| `triggerDownload()` | 299-326 | 복호화 파일 다운로드 (blob URL) |
| `uploadFiles()` | 328-396 | 다중 파일 업로드 (낙관적 UI, 크기 제한, 에러 집계) |
| `triggerDelete()` | 398-412 | 파일 삭제 |
| `revokePermission()` | 414-431 | 자동 공유 권한 해제 |

#### 보안 테스트 필수:
- `setupPin()` — 6자리 미만 거부, 불일치 거부
- `unlock()` — lockout 활성 시 차단, 실패 시 lockout 설정
- `uploadFiles()` — `MAX_UPLOAD_BYTES` 초과 스킵
- epoch 가드 — 만료 응답 무시

#### 테스트 가능성: 높은 난이도
- 모든 함수가 컴포넌트 클로저 내부 → 커스텀 훅 추출 권장
- `createRoot()` 모듈 스코프 → 컴포넌트를 named export로 분리 필요
- `browser.runtime.sendMessage`, `URL.createObjectURL`, FileList API 모킹 필요

#### 예상 테스트: **~47개**

---

### 8.5 `src/content/overlay-utils.ts`

**등급: CRITICAL** — 타이머 단계 색상이 보안 UX를 직접 제어, 아이템 필터링이 데이터 노출 결정

| 속성 | 값 |
|------|-----|
| 줄 수 | 63 |
| 함수 수 | 7개 (전부 export) |
| 테스트 | **0개** |

#### 함수별 분석

| 함수 | 라인 | 설명 |
|------|------|------|
| `isStaleRequestError(message?)` | 4-6 | "request not found" 문자열 매칭 (한/영) |
| `stageColor(remainingMs)` | 8-16 | ≤5s→red, ≤15s→amber, >15s→blue |
| `stageGuide(remainingMs)` | 18-26 | 경계값별 한국어 안내 텍스트 |
| `defaultSelectedItemIds(request)` | 28-33 | resourceOptions에서 모든 아이템 ID 추출 |
| `getFocusableElements(root)` | 35-39 | DOM 쿼리: disabled/aria-hidden 제외 |
| `retryLabel(action)` | 41-52 | 액션별 한국어 재시도 버튼 라벨 |
| `filterSelectedItems(...)` | 54-63 | 선택된 아이템 필터링 + 중복 제거 |

#### 테스트 가능성: **매우 쉬움** (getFocusableElements만 JSDOM 필요)

#### 스펙 준수: 6.3 "60초 타이머: 3단계 에스컬레이션" 경계값 완전 일치

#### 예상 테스트: **~25개**

---

### 8.6 `src/content/page-bridge.ts`

**등급: CRITICAL** — AI 제공자가 건강기록을 요청하는 주요 데이터 게이트웨이

| 속성 | 값 |
|------|-----|
| 줄 수 | 144 |
| Export | `setupPageMcpBridge` 1개 |
| 테스트 | **0개** |

#### 런타임 로직
- `readableError(error)` (40-45) — 오류→문자열 변환
- `postBridgeMessage(port, payload)` (47-49) — port.postMessage 래퍼
- `normalizeRequestId(value)` (51-53) — 빈 값이면 UUID 생성
- `isBridgeRequestMessage(data)` (55-61) — source+type 타입 가드
- `setupPageMcpBridge(getProvider)` (63-144) — **핵심**: window.message 리스너, origin 검증, Zod 스키마 검증, 런타임 메시지 전송, MessagePort 응답

#### 테스트 가능성: 중간 난이도
- `sendRuntimeMessage` 모킹, `window`, `MessagePort` 모킹, JSDOM 필요
- fire-and-forget `void` 패턴 → 프로미스 flush 필요

#### 스펙 준수: 6.0 `read_health_records` MCP 도구 스키마 일치. 75초 타임아웃 (스펙 65초보다 약간 관대 — 의도적)

#### 예상 테스트: **~15개**

---

### 8.7 `entrypoints/vault/runtime.ts`

**등급: HIGH** — 보안 흐름의 사용자 대면 메시지

| 속성 | 값 |
|------|-----|
| 줄 수 | 112 |
| Export | 8개 함수 |
| 테스트 | **0개** |

#### 함수

| 함수 | 라인 | 설명 |
|------|------|------|
| `readableError(error)` | 14-19 | Error/문자열/기타 → 문자열 |
| `sendUploadMessage()` | 30-37 | 120초 타임아웃 |
| `sendVaultMessage()` | 39-41 | 20초 타임아웃 |
| `summarizeUploadErrors(errors)` | 43-49 | 첫 2개 + "외 N건" |
| `lockoutGuide(seconds)` | 51-59 | 3단계 lockout 한국어 메시지 |
| `humanizeUploadError(error)` | 61-73 | 기술 에러→사용자 친화 한국어 |
| `withConnectionHint(error)` | 75-102 | 연결 문제 진단 + 배경 핑 |
| `statusTone(status)` | 104-112 | 파일 상태→CSS 클래스 |

#### 테스트 가능성: **쉬움** (withConnectionHint만 sendMessage 모킹 필요)

#### 예상 테스트: **~22개**

---

### 8.8 `entrypoints/background.ts`

**등급: HIGH** — 확장 프로그램의 중추 신경계

| 속성 | 값 |
|------|-----|
| 줄 수 | 59 |
| 역할 | Service Worker 진입점. 모든 Chrome API 이벤트를 핸들러에 연결 |
| 테스트 | **0개** |

#### 런타임 로직
- `onInstalled` (reason=install) → `ensureSetupTab()` + `clearPersistedApprovalState()`
- `onInstalled` (reason=update) → `lockSession("runtime update")`
- `action.onClicked` → PIN 여부에 따라 setup/vault 탭 열기
- `tabs.onUpdated` → vault 탭 추적
- `tabs.onRemoved` → vault 탭 추적 해제
- `runtime.onStartup` → `lockSession("runtime startup")`
- `runtime.onMessage` → 비동기 메시지 핸들러 + 에러 envelope

#### 테스트 가능성: 중간. 모든 로직이 임포트된 함수에 위임 (이미 테스트됨). 오케스트레이션 글루 코드.

#### 예상 테스트: **~11개**

---

### 8.9 `src/components/error-boundary.tsx`

**등급: HIGH** — 모든 React 표면의 오류 복구 단일 장애점

| 속성 | 값 |
|------|-----|
| 줄 수 | 47 |
| Export | `ErrorBoundary` 클래스 |
| 테스트 | **0개** |

#### 런타임 로직
- `getDerivedStateFromError(error)` — 에러 상태 설정
- `componentDidCatch(error)` — `console.error` 로깅
- `reset()` — 에러 클리어 + `resetKey` 증가 → 자식 재마운트
- `render()` — 에러 시 fallback, 정상 시 children (key로 재마운트)

#### 테스트 가능성: **쉬움**. React Testing Library + 의도적 throw 패턴.

#### 예상 테스트: **~7개**

---

### 8.10 `entrypoints/vault/components/unlock-section.tsx`

**등급: HIGH** — 무차별 대입 방지의 사용자 대면 UI

| 속성 | 값 |
|------|-----|
| 줄 수 | 93 |
| 테스트 | **0개** |

#### 핵심 동작
- PIN 입력에서 비숫자 제거 (`replace(/\D/g, "")`)
- lockout 활성 시 입력 비활성화
- lockout 카운트다운 + 단계 라벨 표시
- 에러가 가이드와 동일하면 숨김

#### 예상 테스트: **~10개**

---

### 8.11 `entrypoints/setup/main.tsx`

**등급: MEDIUM**

| 속성 | 값 |
|------|-----|
| 줄 수 | 221 |
| 테스트 | **0개** |

#### 핵심 동작
- PIN 6자리 x 2 확인, locale 자동 감지
- `refreshState()` — 배경에서 vault 상태 가져오기
- `setupPin()` — 검증 + 메시지 전송 + vault 페이지 이동

#### 스펙 준수: 1.1 PIN 6자리 x 2, 1.2 프라이버시 앵커 — 일치

#### 예상 테스트: **~15개**

---

### 8.12 `src/hooks/use-toast.ts`

**등급: MEDIUM**

| 속성 | 값 |
|------|-----|
| 줄 수 | 87 |
| 테스트 | **0개** |

#### 핵심 동작
- `genId()` — 자동 증가 카운터
- `reducer` — ADD/DISMISS/REMOVE
- `toast(props)` — 5000ms 후 자동 제거
- `useToast()` — pub/sub 패턴 React 훅

#### 테스트 가능성 이슈: 모듈 레벨 싱글턴 (`memoryState`, `count`, `listeners`). `vi.resetModules()` 또는 `_resetForTesting()` export 필요.

#### 예상 테스트: **~14개**

---

### 8.13 `entrypoints/vault/components/audit-log-section.tsx`

**등급: MEDIUM** | 줄: 119 | 테스트: 0

헬퍼 함수: `depthLabel`, `formatResourceCounts`, `resultLabel`, `resultTone`
컴포넌트: 감사 로그 목록 렌더링

#### 예상 테스트: **~12개**

---

### 8.14 `entrypoints/vault/components/upload-section.tsx`

**등급: MEDIUM** | 줄: 218 | 테스트: 0

파일 업로드 영역 (드래그&드롭), 3가지 picker 모드 (pdf/image/all), 파일 목록 (상태/다운로드/삭제)

#### 예상 테스트: **~16개**

---

### 8.15 `entrypoints/vault/components/pin-setup-section.tsx`

**등급: MEDIUM** | 줄: 118 | 테스트: 0

PIN 입력 (비숫자 제거), locale 선택기, TrustAnchorSection 포함

#### 예상 테스트: **~10개**

---

### 8.16 `entrypoints/vault/components/permission-section.tsx`

**등급: MEDIUM** | 줄: 94 | 테스트: 0

권한 표시 + 해제 버튼. `depthLabel`, `dateRangeLabel` 헬퍼.

#### 예상 테스트: **~10개**

---

### 8.17 `entrypoints/vault/components/provider-section.tsx`

**등급: MEDIUM** | 줄: 133 | 테스트: 0

AI 제공자 선택 (ChatGPT/Claude/Gemini). Gemini 항상 비활성화.

#### 예상 테스트: **~10개**

---

### 8.18 `entrypoints/setup/bootstrap.ts`

**등급: LOW** | 줄: 57 | 테스트: 0

Setup 페이지 부트 가드. 20초 타임아웃, 동적 import, 에러 복구 UI.

#### 예상 테스트: **~8개**

---

### 8.19 `entrypoints/vault/bootstrap.ts`

**등급: LOW** | 줄: 57 | 테스트: 0

Vault 페이지 부트 가드. setup/bootstrap.ts와 동일 패턴.

#### 예상 테스트: **~8개**

---

### 8.20 `entrypoints/vault/components/trust-anchor-section.tsx`

**등급: LOW** | 줄: 58 | 테스트: 0

정적 트러스트 카드 4개 (클라우드 없음, AES-256, 데이터 수집 없음, 오픈소스). 순수 프레젠테이션.

#### 예상 테스트: **~4개**

---

### 8.21 `src/lib/utils.ts`

**등급: LOW** | 줄: 6 | 테스트: 0

`cn()` — `clsx` + `tailwind-merge` 합성. 스모크 테스트 충분.

#### 예상 테스트: **~3개**

---

### 8.22-8.30 SKIP 대상 파일

| 파일 | 줄 수 | SKIP 사유 |
|------|------|-----------|
| `src/content/style.ts` | 187 | 순수 CSS 상수, 런타임 로직 없음 |
| `src/core/constants.ts` | 23 | 순수 상수 |
| `src/core/messages.ts` | 112 | 순수 타입 정의 (런타임에 사라짐) |
| `src/core/models.ts` | 141 | 순수 타입 정의 |
| `src/components/ui/badge.tsx` | 32 | shadcn 표준 래퍼 |
| `src/components/ui/button.tsx` | 52 | shadcn 표준 래퍼 |
| `src/components/ui/card.tsx` | 55 | shadcn 표준 래퍼 |
| `src/components/ui/dialog.tsx` | 98 | shadcn 표준 래퍼 |
| `src/components/ui/dropdown-menu.tsx` | 180 | shadcn 표준 래퍼 |
| `src/components/ui/input.tsx` | 23 | shadcn 표준 래퍼 |
| `src/components/ui/label.tsx` | 18 | shadcn 표준 래퍼 |
| `src/components/ui/progress.tsx` | 26 | shadcn 표준 래퍼 |
| `src/components/ui/scroll-area.tsx` | 43 | shadcn 표준 래퍼 |
| `src/components/ui/select.tsx` | 147 | shadcn 표준 래퍼 |
| `src/components/ui/separator.tsx` | 23 | shadcn 표준 래퍼 |
| `src/components/ui/skeleton.tsx` | 12 | shadcn 표준 래퍼 |
| `src/components/ui/switch.tsx` | 26 | shadcn 표준 래퍼 |
| `src/components/ui/table.tsx` | 103 | shadcn 표준 래퍼 |
| `src/components/ui/tabs.tsx` | 52 | shadcn 표준 래퍼 |
| `src/components/ui/toaster.tsx` | 37 | shadcn 표준 래퍼 (use-toast의 얇은 소비자) |

---

## 9. 구조적 테스트 가능성 차단 요소

### 9.1 `packages/relay/src/server.ts` — Export 없는 모놀리스

**심각도: CRITICAL**

1,310줄의 서버가 **단일 함수도 export하지 않음**. 56개 함수 전부 모듈 프라이빗. 서버가 `import()` 시 자동 시작. 인메모리 저장소(`authCodes`, `refreshStore`)가 프라이빗이라 테스트 간 초기화 불가.

**해결 방안**:
- (A) `createServer(config)` 팩토리 + 유틸 함수 export (권장)
- (B) 리팩터링 없이 HTTP 통합 테스트 (동적 import + 실제 HTTP 요청)

### 9.2 `entrypoints/content.tsx` — Closed Shadow DOM + 컴포넌트 클로저

**심각도: HIGH**

- `attachShadow({ mode: "closed" })` → 테스트에서 shadow root 접근 불가
- 22개 함수가 `OverlayApp` 컴포넌트 클로저 내부 → 독립 단위 테스트 불가
- 모듈 레벨 가변 상태 (`lastKnownRequestId`)

**해결 방안**: `useOverlayState()` 커스텀 훅으로 상태 로직 추출. shadow mode를 파라미터화.

### 9.3 `entrypoints/vault/main.tsx` — 모듈 스코프 side-effect

**심각도: HIGH**

`createRoot(document.getElementById("root")!).render(...)` 가 모듈 최상위에서 실행. 모듈 임포트 = 렌더링 트리거.

**해결 방안**: `App` 컴포넌트를 named export로 분리. `useVaultState()` 커스텀 훅으로 비즈니스 로직 추출.

### 9.4 Vitest 설정 미지원

**심각도: MEDIUM**

루트 `vitest.config.ts`의 include 패턴이 `src/**/*.test.ts`만 포함. `packages/`, `entrypoints/` 테스트 발견 불가.

**해결 방안**: include 패턴 확장 또는 패키지별 vitest 설정 추가.

### 9.5 `use-toast.ts` 싱글턴 상태 누수

**심각도: LOW**

`memoryState`, `count`, `listeners`가 모듈 레벨 → 테스트 간 상태 누수.

**해결 방안**: `_resetForTesting()` export 추가 또는 `vi.resetModules()`.

---

## 10. 전체 프로젝트 종합 통계

### Part 1: `src/core/` (테스트 있음)

| 지표 | 값 |
|------|-----|
| 소스 파일 | 16개 |
| 테스트 파일 | 16개 |
| 테스트 케이스 | 565개 |
| 라인 커버리지 | 99.92% |
| 등급 분포 | PERFECT 3 / GOOD 9 / NEEDS_IMPROVEMENT 4 |
| 주요 발견 | CRITICAL 2, HIGH 7, MEDIUM 12, LOW 14+ |

### Part 2: 나머지 전체 (테스트 없음)

| 지표 | 값 |
|------|-----|
| 소스 파일 (런타임 로직) | 25개 |
| 소스 파일 (SKIP) | 9+ (타입/상수/CSS/shadcn) |
| 테스트 파일 | **0개** |
| 테스트 케이스 | **0개** |
| 예상 필요 테스트 | **~506개** |
| 우선도 분포 | CRITICAL 5 / HIGH 5 / MEDIUM 7 / LOW 4 |

### 전체 프로젝트

| 지표 | 값 |
|------|-----|
| 전체 소스 파일 (런타임 로직) | **41개** |
| 테스트 파일 | **16개** |
| 테스트 커버 비율 | **39%** (16/41) |
| 기존 테스트 | 565개 |
| 미작성 테스트 | **~506개** |
| 총 필요 테스트 | **~1,071개** |

---

## 11. 권장 테스트 작성 순서

보안 위험과 의존성을 고려한 우선순위:

| 순서 | 파일 | 예상 테스트 | 사유 |
|------|------|-----------|------|
| 1 | `packages/relay/src/server.ts` | ~151 | 1,310줄 보안 코드, OAuth/JWT/PKCE 전부 미테스트 |
| 2 | `packages/contracts/src/index.ts` | ~60 | relay 테스트의 선행 의존, Zod 스키마 검증 |
| 3 | `src/content/overlay-utils.ts` | ~25 | 순수 함수, 빠른 승리, 보안 UX 직접 제어 |
| 4 | `src/content/page-bridge.ts` | ~15 | 데이터 게이트웨이 |
| 5 | `entrypoints/vault/runtime.ts` | ~22 | 순수 함수 다수, 보안 메시지 |
| 6 | `src/components/error-boundary.tsx` | ~7 | 빠른 승리, 오류 복구 기반 |
| 7 | `entrypoints/content.tsx` | ~48 | 리팩터링 후 테스트 (커스텀 훅 추출) |
| 8 | `entrypoints/vault/main.tsx` | ~47 | 리팩터링 후 테스트 (커스텀 훅 추출) |
| 9 | `entrypoints/background.ts` | ~11 | 오케스트레이션 검증 |
| 10 | 나머지 컴포넌트/부트스트랩 | ~120 | UI 컴포넌트 + 부트 가드 |

**리팩터링 선행 필수**:
- `server.ts`: `createServer()` 팩토리 + 유틸 export (순서 1 전에)
- `content.tsx`: `useOverlayState()` 훅 추출 (순서 7 전에)
- `vault/main.tsx`: `useVaultState()` 훅 추출 (순서 8 전에)
- `vitest.config.ts`: include 패턴 확장 (순서 1-2 전에)
