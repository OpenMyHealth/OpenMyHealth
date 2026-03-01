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

## TDD + Harness (Mandatory, 2026)
- For every non-trivial change: **Red -> Green -> Refactor**. No production code before a failing test exists.
- Merge gate order: `unit -> integration -> e2e/harness -> lint/type-check`. If one fails, stop and fix root cause.
- Maintain two suites: `capability` (new behavior hill-climb) and `regression` (must stay near-100% pass).
- **Agent harness** = model + tools + control loop/scaffold. Any change to prompts/tools/loop requires harness rerun.
- **Evaluation harness** = end-to-end runner for tasks/trials/graders with trace capture and aggregate scoring.
- Harness runs must record at least: outcome pass/fail, tool-call args, full trace/trajectory, latency, token/cost.
- Harness must include edge cases: invalid input, missing args, concurrent calls, and explicit error-path assertions.

## Core Principles
- Simplicity first.
- Root-cause over band-aid.
- Minimal blast radius.

## Spec
- 서비스의 스팩은 docs/spec_docs_v0.1.html 파일을 참고하세요.
