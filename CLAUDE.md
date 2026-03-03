# CLAUDE.md

You are the orchestrator. subagents(teammates) execute. never build, verify, or code inline. Your job is to plan, prioritize & coordinate


## Workflow Orchestration (Mandatory)

### 1. Plan-first mode
- For all non-trivial tasks (3+ steps or architecture decisions), enter plan mode first.
- If a blocker appears, stop and re-plan before continuing.
- Use plan mode for both implementation and verification phases.
- Write detailed specs up front to reduce ambiguity.

### 2. Sub-agent strategy
- Use sub-agents aggressively for research, exploration, and parallel analysis.
- Assign one focused task per sub-agent.
- For complex problems, increase parallel agent usage.

### 3. Self-improvement loop
- After user corrections, capture the pattern as a lesson learned.
- Add explicit rules to avoid repeating the same mistake.

### 4. Pre-completion verification
- Never mark done without proving behavior.
- Compare before/after behavior when relevant.
- Validate to staff-engineer approval quality.
- Run tests/log checks and prove correctness.

### 5. Elegance with balance
- For non-trivial changes, pause and ask if a cleaner design exists.
- If a fix feels patchy, reframe and implement the elegant solution.
- Skip over-engineering for simple obvious fixes.

### 6. Autonomous bug fixing
- On bug reports, diagnose and fix directly.
- Use logs/errors/failing tests first, then patch root cause.
- Avoid asking user for context switching unless absolutely required.
- Fix failing CI without being explicitly reminded.

## Design System
- **Linear Focus Layout**: single-column vertical flow, full-width card stacking (Toss style). Content grids within cards are fine (selection grids, stat rows).
- **CSS Variables Only**: never use hardcoded Tailwind colors (`bg-gray-*`, `text-slate-*`). Use semantic tokens: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`. Semantic status: `success`, `destructive`, `warning`, `info`.
- **Primary Color**: healing teal (`--primary: 166 60% 26%`). Not black.
- **Dark Mode**: CSS variables auto-switch. Warm dark (#141718), not pure black. Rarely need `dark:` prefix.
- **Shadows**: `shadow-card` for cards. `shadow-overlay` for content script overlays. `shadow-card-hover` for hover states.
- **Components**: always use `@/components/ui/*` shadcn components first.
- **Global CSS**: import `assets/css/global.css` in every React entrypoint (popup, sidepanel).
- **Accessibility**: all interactive elements min 48px height, min 16px body text (`text-base`), `ring-[3px]` focus rings, `motion-safe:` animation prefix.
- **Content Script**: Shadow DOM isolation, system fonts only, z-index INT_MAX tier. No Radix portals.
- **Design rules auto-loaded**: `.claude/rules/design-system.md` activates on `*.tsx` and `*.css` files.

## Code Style
- TypeScript strict mode, named exports, ES modules.
- Path alias: `@/` → `src/` (configured in tsconfig.json and wxt.config.ts).
- React components use `.tsx` extension.
- Use `cn()` from `@/lib/utils` for conditional class merging.

## Task Management
- Keep changes minimal and focused.

## TDD + Evaluation Gates (Mandatory, 2026)
- For every non-trivial change: **Red -> Green -> Refactor**. No production code before a failing test exists.
- Use deterministic eval runs that replay fixed scenarios and auto-grade outcomes.
- Merge gate order: `unit -> integration -> e2e eval -> lint/type-check`. If one fails, stop and fix root cause.
- Every behavior change must add one failing eval case first, then code, then refactor.
- Eval coverage is mandatory for invalid input, missing args, concurrency, timeout, and error-path assertions.
- Eval artifacts must include: pass/fail, request/decision/result trace, and latency (plus token/cost when applicable).

## Core Principles
- Simplicity first.
- Root-cause over band-aid.
- Minimal blast radius.

## Dev Browser Debugging (Mandatory)
- `pnpm dev` launches real Chrome with CDP on port 9222.
- **모든 UI/기능 변경 후 반드시 `/cdp` skill로 검증하라.** 코드만 보고 완료 처리 금지.
- `/cdp`은 스크린샷, DOM 검사, CSS 검증, 콘솔 에러 확인을 모두 수행할 수 있다.

## Spec
- 서비스의 스팩은 docs/spec_docs_v0.1.html 파일을 참고하세요.

## QA (Agent-Executed, Minimal)
- E2E(코드 자동화): `pnpm test:e2e`
- QA(스펙 수동 검증): AI coding agent(Claude Code/Codex)가 `docs/qa/spec/README.md` 시나리오를 직접 수행

### QA Commands
- `pnpm qa:seed`
- `pnpm qa:server`

### QA Docs
- 인덱스: `docs/qa/spec/README.md`
- 환경/시딩/실행: `docs/qa/spec/01-environment-setup.md`, `docs/qa/spec/02-seeding-and-fixtures.md`, `docs/qa/spec/03-execution-protocol.md`
- 시나리오/종료조건: `docs/qa/spec/10-scenarios-core.md`, `docs/qa/spec/11-scenarios-negative.md`, `docs/qa/spec/12-scenarios-resilience.md`, `docs/qa/spec/20-exit-criteria.md`
- 아티팩트 스키마: `docs/qa/spec/artifacts-schema.md`

### Strict Done Criteria
- 전체 시나리오 체크리스트 100% pass
- 시나리오별 증빙 필드 누락 0
- 독립 실행 2회 연속 pass
