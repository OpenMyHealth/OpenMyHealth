---
paths:
  - "entrypoints/**/*.tsx"
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Design System Contract — OpenMyHealth

Target users: Korean cancer patients (40-50s). Priorities: warmth, trust, accessibility, simplicity.

## Layout

- MUST use single-column vertical flow (Toss/Kakao style). Stack `<Card>` with `gap-4` or `gap-6`.
- NEVER use dashboard-style multi-column page layouts.
- Content grids within cards ARE allowed: selection grids (`grid-cols-3`), stat rows (`flex flex-wrap gap-3`), horizontal scroll strips.
- Container MUST be `max-w-[900px]` for full-tab pages.

## Color Tokens

NEVER use hardcoded Tailwind colors: `bg-gray-*`, `text-slate-*`, `bg-[#hex]`, `text-emerald-*`, `text-orange-*`.
MUST use semantic CSS variables from `global.css`:

| Purpose | Class |
|---------|-------|
| Page background | `bg-background` |
| Card surface | `bg-card` |
| Primary text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Borders | `border-border` |
| Primary action | `bg-primary` / `text-primary` |
| Status | `text-success` / `text-destructive` / `text-warning` / `text-info` |

ANTI-PATTERN: `bg-gray-50`, `text-slate-600`, `border-gray-200`, `bg-[#1a6b5a]`

### Provider Tokens

| Provider | Text | Background | Border |
|----------|------|------------|--------|
| ChatGPT | `text-provider-chatgpt` | `bg-provider-chatgpt-soft` | `border-status-success-border` |
| Claude | `text-provider-claude` | `bg-provider-claude-soft` | `border-status-warning-border` |
| Disabled | `text-provider-disabled` | `bg-provider-disabled-soft` | `border-border` |

ANTI-PATTERN: `text-emerald-700`, `bg-orange-50`, `text-slate-600` for providers

### Status Surfaces

| Status | Surface | Border |
|--------|---------|--------|
| Success | `bg-status-success-surface` | `border-status-success-border` |
| Destructive | `bg-status-destructive-surface` | `border-status-destructive-border` |
| Warning | `bg-status-warning-surface` | `border-status-warning-border` |
| Info | `bg-status-info-surface` | `border-status-info-border` |

NEVER use raw opacity like `bg-success/20`. ALWAYS use status surface tokens.

### Opacity Allowlist

MUST only use these opacity patterns: `/0`, `/5`, `/10`, `/15`, `/20`, `/30`, `/40`, `/45`, `/70`.
- `/0` — gradient transparent start
- `/5` `/10` `/15` `/20` — subtle backgrounds, hover tints
- `/30` — soft borders on status containers
- `/40` `/45` — button borders, decorative element borders
- `/70` — gradient overlay endpoint

ANTI-PATTERN: `/25`, `/35`, `/50`, `/55`, `/60`, `/80`, `/90`

## Dark Mode

- CSS variables auto-switch. NEVER use `dark:` prefix on semantic token classes.
- Dark background: warm dark (`#141718`), NEVER pure black (`#000000`).
- Only use `dark:` for non-semantic overrides (e.g., `dark:shadow-soft-float-dark`).

## Shadow Vocabulary

| Token | Purpose |
|-------|---------|
| `shadow-card` | Default card resting state |
| `shadow-card-hover` | Card hover (teal tinted) |
| `shadow-card-elevated` | Elevated card (modals, floating) |
| `shadow-metric` | Subtle stat containers |
| `shadow-overlay` | Content script floating overlays |
| `shadow-soft-float` | Hero image/banner float |

NEVER use generic shadows: `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, raw `shadow-[...]`.

## Typography Hierarchy

Font: `font-sans` = Pretendard Variable. `font-mono` = medical codes only.

| Class | Size | Weight | Use |
|-------|------|--------|-----|
| `text-stat-lg` | 48px | 700 | Hero stat number |
| `text-stat-md` | 36px | 700 | Section stat number |
| `text-stat-sm` | 24px | 600 | Inline/card stat number |
| `text-2xl` | 24px | — | Page title |
| `text-xl` | 20px | — | Section heading |
| `text-lg` | 18px | — | Card title |
| `text-base` | 16px | — | Body text (MINIMUM) |
| `text-sm` | 14px | — | Helper/badge ONLY |

NEVER use `text-xs` for body content. `text-sm` MUST only appear on muted helpers and badges.

## Card Padding Standard

| Token | Value | Tailwind | Use |
|-------|-------|----------|-----|
| `p-card-lg` | 24px | `p-6` | Hero/summary cards |
| `p-card-md` | 20px | `p-5` | Section cards |
| `p-card-sm` | 16px | `p-4` | Inner nested cards |

ANTI-PATTERN: `p-8`, `p-3`, `p-2` on cards.

## Border Radius Hierarchy

`--radius` is `1rem` (16px). All values derive from it.

| Token | Computed | Use |
|-------|----------|-----|
| `rounded-2xl` | 20px | Hero/summary card outer, dialogs |
| `rounded-xl` | 16px | Section card outer |
| `rounded-lg` | 14px | Inner card, nested container |
| `rounded-md` | 12px | Button, input, select |
| `rounded-sm` | 8px | Badge, small chip |
| `rounded-full` | pill | Avatar, status dot |

ANTI-PATTERN: `rounded` (bare), `rounded-3xl`, `rounded-[20px]`

## Gradient Overlay Standard

- MUST use CSS variable background: `hsl(var(--background))` with stop at `transparent 55%`.
- Overlay mask opacity: `opacity-70` with `bg-background`.
- NEVER use hardcoded hex in gradients: `from-[#faf8f5]`, `bg-[#141718]/70`.

## Accessibility (Critical)

- ALL interactive elements MUST have minimum `h-12` (48px) height.
- Body text MUST be `text-base` (16px) minimum.
- Focus ring MUST be `ring-[3px]` in component definitions (overrides base `ring-4` in global.css).
- ALL animations MUST use `motion-safe:` prefix.
- Status indicators MUST pair color + icon/text. NEVER rely on color alone.
- Korean text: `word-break: keep-all` (set in global.css).

ANTI-PATTERN: `h-8` button, `text-xs` body, `animate-bounce` without `motion-safe:`

## Animations
- Custom 애니메이션 (animate-pulse, animate-slide-up-fade): MUST use motion-safe: prefix
- Radix data-[state] 애니메이션 (animate-in/out): motion-safe 불필요 (global.css prefers-reduced-motion 전역 처리)

## Z-Index

### Page-level (vault, setup, popup)
- Radix 오버레이(dialog, select, dropdown): `z-50` 표준 유지
- Toast: `z-page-toast` (100)

### Content Script (Shadow DOM)
- MUST use INT_MAX tier: z-ext-backdrop, z-ext-card, z-ext-toast, z-ext-critical
- NEVER use z-50 or z-[n] in content scripts

## Content Script (Shadow DOM)

- MUST use Shadow DOM isolation for content script UI.
- MUST use system fonts only (no Pretendard in content scripts).
- z-index MUST use INT_MAX tier tokens:
  - `z-ext-backdrop` (2147483640), `z-ext-card` (2147483645)
  - `z-ext-toast` (2147483646), `z-ext-critical` (2147483647)
- NEVER use Radix portal components in content scripts.
- NEVER use arbitrary z-index: `z-50`, `z-[999]`.

## Components

ALWAYS use `@/components/ui/*` shadcn components first.
Available: Badge, Button, Card, Dialog, DropdownMenu, Input, Label, Progress, ScrollArea, Select, Separator, Skeleton, Switch, Table, Tabs, Toaster.

## Status Indicators

- Active: `<div className="w-2.5 h-2.5 rounded-full bg-success" />` + text label
- Error: `bg-destructive` dot + text label. Pulse: `motion-safe:animate-status-pulse`

## Tone & Copy

Compassionate Korean tone. "읽기 어려웠어요" not "문서 인식 실패". Avoid technical jargon.

---

## VERIFICATION — Run Before PR

```sh
# No hardcoded Tailwind colors (MUST find 0 matches)
rg '(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d' --glob '*.tsx' -l

# No hardcoded hex in className (MUST find 0)
rg 'bg-\[#|text-\[#|border-\[#' --glob '*.tsx' -l

# No generic shadow classes (MUST find 0)
rg 'shadow-(sm|md|lg|xl|2xl)' --glob '*.tsx' -l

# No arbitrary z-index (MUST find 0)
rg 'z-\[' --glob '*.tsx' -l

# No text-xs in components (MUST find 0)
rg 'text-xs' src/components/ entrypoints/ --glob '*.tsx' -l

# Animations missing motion-safe (review manually)
rg 'animate-' --glob '*.tsx' | rg -v 'motion-safe'

# dark: prefix on semantic colors (should be rare/zero)
rg 'dark:(bg|text|border)-' --glob '*.tsx' -l
```
