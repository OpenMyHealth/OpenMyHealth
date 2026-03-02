---
description: CDP로 dev Chrome 검증 (스크린샷, DOM, 콘솔 로그)
---

`pnpm dev`로 열린 Chrome(port 9222)에 CDP로 접속하여 현재 상태를 검증해줘.

## 검증 항목 (필요한 것만 선택)
- **스크린샷**: `Page.captureScreenshot` → `/tmp/chrome-screenshot.png` 저장 → Read로 확인
- **DOM 검사**: `Runtime.evaluate`로 요소 존재, className, 구조 확인
- **CSS 검증**: `Runtime.evaluate`로 computed style, CSS 변수 값, 스타일시트 로드 상태 확인
- **콘솔 에러**: `Runtime.evaluate`로 에러 수집 또는 `Log.enable` → `Log.entryAdded`로 실시간 확인
- **탭 이동**: `Page.navigate`로 특정 페이지(setup.html, vault.html 등)로 이동 후 검증

## 기술 세부사항
- 탭 목록: `curl -s http://localhost:9222/json`
- WebSocket 연결: Node.js `net` 모듈로 raw 구현 (ws 패키지 없음)
- background.js 탭은 제외하고 첫 번째 페이지 사용
- 9222 포트 연결 실패 시 `pnpm dev`가 실행 중인지 확인

## 자동화된 QA
- `pnpm qa` — 전체 QA 체크 실행 (setup, vault, content script, baseline 비교)
- `pnpm qa --checks setup` — setup.html만 검증
- `pnpm qa --checks vault` — vault.html만 검증
- `pnpm qa --checks content` — 콘텐츠 스크립트만 검증
- `pnpm qa --json` — JSON 출력
- `pnpm qa:baseline` — 현재 스크린샷을 베이스라인으로 저장
- 결과: `qa/runs/latest/report.json` + 스크린샷

## 사용 시점
- UI 변경 후 렌더링 확인
- CSS/스타일 변경 후 적용 확인
- 런타임 에러 디버깅
- 익스텐션 기능 동작 검증
