# CLAUDE.md

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

## Task Management
- Keep changes minimal and focused.

## Core Principles
- Simplicity first.
- Root-cause over band-aid.
- Minimal blast radius.
