# OpenMyHealth QA Plan (v0.1, Final Gate)

## Executed In This Pass (Evidence-based)
- `pnpm lint` ✅
- `pnpm type-check` ✅
- `pnpm relay:build` ✅
- `pnpm wxt:build` ✅
- `pnpm audit --audit-level high` ✅
- GitHub Actions CI quality gate (`.github/workflows/ci.yml`) added ✅
- Relay live smoke (`/health`, `/mcp`, unauthorized MCP read) ✅
  - `/health` 200
  - `/mcp` JSON-RPC endpoint exists (unauthorized 요청 시 401)
  - `/mcp/read_health_records` without token 401
- Production bundle safety scan ✅
  - `.output/chrome-mv3` contains required entry files (`background.js`, `vault.html`, `manifest.json`)
  - no HMR websocket strings in production build (`localhost:3000`, `vite-hmr`, `ws://localhost`)
- Runtime diagnostics hardening ✅
  - `runtime:ping` handshake added to detect build/runtime mismatch (dev vs prod)
  - Vault fallback now includes dev/prod load-path guidance (`.output/chrome-mv3`)
  - Root ErrorBoundary added in Vault and Content overlay to prevent blank white screen on render crash
- Runtime race/transport hardening ✅
  - approval settle path now returns atomic settle result to prevent timeout-after-approve race misreport
  - Vault sender trust is now strict URL-based (`vault.html` sender URL must match)
  - Setup sender trust added (`setup.html` limited sender path)
  - page bridge 응답을 `MessagePort` 전용으로 전환해 전역 `window.postMessage` 응답 노출 제거
- Security hardening ✅
  - sender identity guard (`sender.id === browser.runtime.id`) added for provider/overlay trust checks
  - extension page CSP tightened (`default-src 'self'; object-src 'none'; frame-ancestors 'none'`)
  - relay MCP forward now carries subject/audience headers (`X-OMH-Sub`, `X-OMH-Aud`)
  - relay access token TTL aligned to spec (1h)
- Background runtime hardening checks (code + build) ✅
  - runtime bootstrap gate (`ensureBackgroundReady`) before message handling
  - approval requires active request + rendered overlay before `approved` decision
  - stale persisted approval snapshot is fail-safe cleared with Vault warning copy
  - always-allow key is query/date scoped (`v2`) with legacy key compatibility
  - `always` auto-approve no longer depends on overlay responsiveness (fail-open for already-approved scope)
  - MCP enqueue path now includes per-tab rate limiting to mitigate prompt-flood DoS
  - provider tab mapping self-heals after service worker restart (trusted sender 기준)
  - `always` request now queue-skip auto 처리 (spec 6.1 정렬)
  - item-level 선택 시 `always` 금지(권한 과대 확장 방지)
  - page-bridge MCP 요청은 `allowAlways=false`로 강제되어 항상 명시적 승인 필요
  - overlay 전달 실패 시 1회 짧은 재시도 후 fail-safe error 처리
  - approval preview (summary/options) 계산 경로를 단일 `buildMcpResponse` 호출로 통합해 중복 decrypt 부하 완화
- Vault runtime resilience checks (code + build) ✅
  - bootstrap loader (`bootstrap.ts`) shows actionable retry when module boot fails/timeout
  - legacy/corrupted `matchedCounts` now render-safe fallback (`file.matchedCounts ?? {}`)
  - trust-ladder actions added: `건너뛰기`, `다 올렸어요` → AI 연결 섹션 이동
  - multi-file upload now continues on per-file failure and reports partial 실패 요약
  - upload runtime timeout extended (20s → 120s) to reduce false timeout on large PDF parsing
  - failed file 삭제 경로 추가 (`vault:delete-file`)
  - 완료 파일에도 삭제 액션 노출 + 버튼 접근성 라벨 강화
  - batch upload now refreshes file list lightweight per-file and recomputes full summary once per batch
  - upload UI guidance expanded (PDF/TXT/CSV/JSON/XML), OCR 미준비 상태를 명확히 안내
  - Vault에 `자동 공유 관리` 섹션 추가: 저장된 always 규칙 조회/해제 가능
  - bootstrap fallback timeout 상향(20s)으로 저사양 환경 false failure 완화
  - static loader guard 추가: bootstrap script 미실행(예: dev 번들/서버 미기동) 시 즉시 원인 안내
  - 설치 직후 Setup 전용 페이지(`setup.html`) 진입 경로 추가, PIN 설정 후 Vault 이동
  - Vault 헤더 단계 레일(잠금/업로드/AI연결) 추가로 onboarding 흐름 명확화
  - 업로드 UX 개선: 예시 카드 3종 + PDF/사진 분리 선택 버튼
  - schema migration runner added: version validation, sequential migrator execution, and per-version backup snapshot in meta store
  - migration rollback 복원 경로 추가: 실패 시 백업 데이터 복원 + 사용자 안내 배너
  - `vault/main.tsx` PIN/잠금해제 섹션을 분리 컴포넌트로 리팩터링 (`pin-setup-section`, `unlock-section`)
- Relay runtime smoke on real process (`127.0.0.1:8787`) ✅
  - `/health` 200 + `ok:true`
  - `/health` now exposes `bridge_configured` / `mcp_read_ready`
  - `/authorize` invalid input rejection (400)
  - `/mcp` GET SSE fallback endpoint handshake (`event: ready`) 확인
  - relay bridge token guard enforced when `RELAY_MCP_BRIDGE_URL` is set
  - bridge forwarding uses service token only (`RELAY_BRIDGE_AUTH_TOKEN`)
  - bridge fetch timeout maps to MCP `timeout` response (not generic network error)
  - `/authorize/confirm` referer / fetch-mode / fetch-dest 검증 강화
  - unauthorized 요청 차단 확인: `/mcp` 401, `/mcp/read_health_records` 401

## Critical Manual QA (Real Chrome, No Mock)
1. Dev/Prod build separation sanity
- Load extension from `.output/chrome-mv3` only.
- Verify no `ws://localhost:3000` error in extension service worker console.
- Expected: production bundle has no Vite HMR websocket connection attempts.
- Expected: 최초 설치 시 `setup.html` 자동 진입 후 PIN 설정 완료 시 `vault.html` 이동.

2. Vault bootstrap resilience
- Open `chrome-extension://<id>/vault.html` after fresh install and after extension reload.
- Keep one old vault tab open, reload extension, open new vault tab.
- Expected: no infinite fallback loading; blocked DB path shows actionable message.

3. Message transport failure recovery
- While vault is open, reload extension from `chrome://extensions`.
- Press `다시 시도` and run `잠금 해제`, `잠그기`, provider switch, upload click.
- Expected: user-visible error with retry path; no silent no-op.

4. PIN progressive lockout
- Enter wrong PIN until thresholds (3/5/10).
- Expected:
  - 3회: 10초 대기 안내
  - 5회: 60초 대기 안내
  - 10회: 300초 + 복구 불가 경고 안내

5. Upload robustness
- Upload: valid PDF/TXT/CSV/JSON/XML/JPEG/PNG/HEIC, empty file, >30MB file.
- During upload, refresh extension once.
- Expected: spinner does not get stuck forever; post-failure state recovers; invalid input receives clear error.

6. Always permission revoke flow
- 승인 카드에서 `같은 조건 자동 허용` 선택 후 1회 승인.
- Vault `자동 공유 관리`에서 규칙 노출 확인 후 즉시 해제.
- 동일 조건 요청 재실행 시 승인 카드가 다시 표시되는지 확인.

7. Service worker restart recovery
- 승인 카드 표시 전후로 service worker terminate.
- Chat 탭 새로고침 없이 동일 요청 재실행.
- Expected: 신뢰 가능한 sender면 provider tab mapping이 회복되어 정상 enqueue.

8. MCP overlay runtime recovery
- On ChatGPT/Claude tab, trigger approval card.
- Reload extension during card display.
- Try `선택 항목 공유`, `거절`, `보관함 열기`.
- Expected: failure is surfaced in `actionError`, buttons disabled while pending.

9. Connection success overlay
- ChatGPT/Claude 탭에서 content script 초기화(`overlay:ready`) 후 최초 연결 완료 상태 확인.
- Expected: "연결 완료!" 오버레이가 1회 노출되고 자동으로 닫힘.

10. Security abuse checks
- Use invalid/missing cookie for `/authorize/confirm`.
- Use mismatched browser/session context for confirm request.
- Expected: request rejected.

11. Runtime mismatch diagnostics
- Call `runtime:ping` from vault and verify `mode`/`version` in response.
- Load dev bundle without `pnpm dev` intentionally and confirm user-facing guidance points to `.output/chrome-mv3`.

## Advanced QA Actions (Senior QA Checklist)
1. Service worker lifecycle fault injection
- Force worker idle/suspend between `enqueue` and `approval:decision`.
- Confirm queue recovery strategy or fail-safe messaging.

2. Data growth soak test
- Insert 1k/5k/10k records and measure vault open time, summary render time, and approval latency.
- Track memory spikes during query/decrypt.

3. Upgrade migration simulation
- Keep old extension tab open and install newer build with DB version bump.
- Validate `onblocked` path, user copy, and safe retry flow.

4. Real network turbulence
- Toggle offline/online during approval timeout window.
- Validate timeout and retryable error behavior end-to-end.

5. Security replay/regression suite
- Auth code replay
- Refresh token reuse after rotation
- Non-HTTPS remote origin attempt (when remote host mode enabled)

## Advanced QA Execution Method (Practical)
1. Service worker lifecycle fault injection
- `chrome://extensions`에서 OpenMyHealth의 Service Worker를 수동 종료 후 요청 재시도
- 승인 카드 노출 전/후 각각 종료해 큐 복구/자동 거절 동작 확인

2. Data growth soak test
- 샘플 문서 100/500/1000건을 순차 업로드(스크립트 또는 수동 반복)
- Vault 첫 렌더 시간, 승인 카드 표시 지연, 요청 완료 시간 기록

3. Migration failure simulation
- 이전 DB 스냅샷으로 시작 후 `DB_VERSION` 증가 빌드 로드
- 강제 오류(개발 빌드에서 migrator throw)로 rollback/복구 안내 배너 검증

4. Network turbulence
- Relay 실행 중 승인 대기 상태에서 네트워크 오프라인/온라인 전환
- timeout, retry copy, 다음 요청 복구 여부를 각각 확인

5. Security replay checks
- `/token` auth code 1회 사용 후 동일 code 재사용 요청 -> `invalid_grant` 확인
- refresh token 사용 직후 동일 refresh 재사용 -> family revoke 확인

## Remaining Risk (Known)
- `/mcp` GET 기반 SSE fallback은 추가되었지만, 완전한 sessionful Streamable HTTP 상호운용(양방향 이벤트/세션 생명주기)은 추가 구현이 필요합니다.
- End-to-end MCP ingress wiring (`mcp:enqueue-request` producer path) is not complete in this repo.
- 이미지 업로드는 현재 안전 보관(DocumentReference) 중심으로 동작하며, OCR/WASM 분류 파이프라인은 추가 구현이 필요합니다.
- Audit log pagination is not implemented (Vault currently discloses “최근 100건” only).
