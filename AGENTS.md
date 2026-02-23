# AGENTS.md

This repository enforces a strict orchestration workflow.

## Non-negotiable workflow
- Plan first for any non-trivial task.
- Use sub-agents for research and parallel analysis.
- Update `tasks/lessons.md` whenever user feedback changes process.
- Do not mark work complete without verification evidence.
- Prefer elegant, minimal-impact solutions over ad-hoc patches.

## Operational rules
- Keep execution status in `tasks/todo.md`.
- Keep retrospective learnings in `tasks/lessons.md`.
- For implementation and QA, run explicit validation commands and record results.
- Avoid broad refactors unless necessary for root-cause fixes.

## Repository boundary rule
- For OpenMyHealth tasks, modify only this repo (`openmyhealth`).
