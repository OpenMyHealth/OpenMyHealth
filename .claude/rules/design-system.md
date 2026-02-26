---
paths:
  - "entrypoints/**/*.tsx"
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI/UX Design System — OpenMyHealth Chrome Extension

You are an expert Frontend Engineer building a Chrome Extension for Korean cancer patients (40-50s). The design prioritizes warmth, trust, accessibility, and simplicity.

## 1. Layout: Linear Focus Layout

- **Page-level: single-column vertical flow.** One primary action per screen, Toss/카카오페이 style vertical scroll.
- Stack full-width `<Card>` components vertically with `gap-4` or `gap-6`.
- **No dashboard-style multi-column page layouts** (no Bento Grid as primary page structure).
- **Content grids within cards are fine** when the context requires comparison or scanning:
  - Selection grids (AI cards, privacy pledges): `grid-cols-3`, `grid-cols-4`
  - Stat rows (data summary): `flex flex-wrap gap-3`
  - Horizontal scroll strips (example images): `flex overflow-x-auto`
- Container max-width: `900px` (extension full-tab pages).

## 2. Color System (Strict CSS Variables)

- NEVER use hardcoded Tailwind color names (`bg-gray-*`, `text-slate-*`, `bg-[#hex]`).
- **MUST USE** semantic CSS variables from `global.css`:
  - Background: `bg-background` (warm cream, not cool gray)
  - Cards: `bg-card`
  - Primary text: `text-foreground`
  - Secondary text: `text-muted-foreground`
  - Borders: `border-border`
- **Semantic status colors**: `text-success`, `text-destructive`, `text-warning`, `text-info`, `bg-success/20`.
- Primary color is **healing teal** (`--primary`), not black.
- **Info/blue** (`--info`): timer calm state, informational highlights.

## 3. Dark Mode

- CSS variables auto-switch. Rarely need `dark:` prefix on semantic colors.
- Dark background is warm dark (#141718), not pure black.

## 4. Shadows & Borders

- Cards: `shadow-card` (subtle, stable). NOT `shadow-soft-float`.
- Hover: `shadow-card-hover` (teal tinted).
- Content script overlays: `shadow-overlay`.
- All cards have `border border-border`.

## 5. Typography: Pretendard

- Font: `font-sans` = Pretendard Variable (Korean + English unified).
- **Minimum body text: 16px (`text-base`).** Never use `text-xs` for body content.
- `text-sm` (14px): only for muted helper text and badges.
- `font-mono`: only for medical codes, hashes, and technical identifiers.
- Body `line-height: 1.6` (set in global.css for Korean readability).

## 6. Accessibility (Critical — cancer patient users)

- **All interactive elements: minimum 48px height** (`h-12`).
- **Focus ring: `ring-[3px]`** (3px, not 2px).
- **Animations: use `motion-safe:` prefix** for all animation classes.
- **Status indicators: color + icon/text always paired** (color-blind safe).
- **Never rely on color alone** to convey state.
- `word-break: keep-all` for Korean syllable-unit wrapping (set in global.css).

## 7. Components

- Always use `@/components/ui/*` shadcn components first.
- Available: Badge, Button, Card, Dialog, DropdownMenu, Input, Label, Progress, ScrollArea, Select, Separator, Skeleton, Switch, Table, Tabs, Toaster.
- **Removed**: Sheet, Popover, Textarea (not in v1.0 spec).

## 8. Chrome Extension UI Patterns

- **Full-tab pages**: 900px max-width, import `@/assets/css/global.css`.
- **Content Script overlay**: Shadow DOM isolation, system fonts only (no Pretendard), z-index INT_MAX tier (`z-ext-backdrop`, `z-ext-card`, `z-ext-toast`, `z-ext-critical`). Never use Radix portal components in content scripts.
- **Background**: No UI.

## 9. Status Indicators

- **Active**: `<div className="w-2.5 h-2.5 rounded-full bg-success" />` + text label
- **Error**: `<div className="w-2.5 h-2.5 rounded-full bg-destructive" />` + text label
- **Warning**: `<div className="w-2.5 h-2.5 rounded-full bg-warning" />` + text label
- Pulse animation: `motion-safe:animate-status-pulse`

## 10. Tone & Copy

- **Compassionate tone** for all user-facing messages (spec F-24).
- Avoid technical jargon: "읽기 어려웠어요" not "문서 인식 실패", "천천히 다시 시도해 주세요" not "비밀번호 불일치".
- Use emoji sparingly and consistently (🔬💊🏥📋 for resource types).
