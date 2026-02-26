# Design System Reference

## Overview

OpenMyHealth uses a **Linear Focus Layout** design system built on React + Tailwind CSS v3 + shadcn/ui, optimized for Korean cancer patients (40-50s) using a Chrome Extension. The design prioritizes warmth, trust, and accessibility.

## Design Tokens

### Colors (CSS Variables)

All colors use HSL CSS variables defined in `assets/css/global.css`. They automatically switch between light and dark mode.

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--background` | Warm cream `#fafaf8` | Warm dark `#141718` | Page background |
| `--card` | White `#ffffff` | Dark charcoal `#1e2022` | Card surfaces |
| `--foreground` | Deep navy | Warm light | Primary text |
| `--muted-foreground` | Warm gray (5.5:1+) | Light gray | Secondary text |
| `--primary` | Healing teal `#1a6b5a` | Bright teal | Buttons, links, focus rings |
| `--destructive` | Dark red | Bright red | Errors, deletions |
| `--success` | Sage teal | Bright teal | Success states |
| `--warning` | Dark amber | Bright amber | Warnings, caution states |
| `--info` | Steel blue | Bright blue | Timer calm state, informational |
| `--border` | Warm light gray | Dark gray | Borders, dividers |

All semantic colors meet **WCAG AA** contrast requirements (4.5:1+ for text, 3:1+ for UI components).

### Border Radius

| Class | Value | Usage |
|-------|-------|-------|
| `rounded-lg` | `var(--radius)` = `0.75rem` (12px) | Cards, containers |
| `rounded-md` | `calc(var(--radius) - 2px)` (10px) | Buttons, inputs |
| `rounded-sm` | `max(2px, calc(var(--radius) - 4px))` (8px) | Small elements |
| `rounded-full` | `9999px` | Pills, badges, status dots |

### Shadows

| Class | Usage |
|-------|-------|
| `shadow-card` | Default card shadow (subtle, stable) |
| `shadow-card-hover` | Card hover state (teal tinted) |
| `shadow-overlay` | Content script overlay (high elevation) |
| `shadow-soft-float` | Legacy — use sparingly |

### Animations

| Class | Usage |
|-------|-------|
| `animate-accordion-down` | Accordion open |
| `animate-accordion-up` | Accordion close |
| `animate-status-pulse` | Status indicator pulse (use with `motion-safe:`) |
| `animate-slide-up` | File card entry |
| `animate-shake` | PIN error shake |
| `animate-slide-up-fade` | Approval card entry |
| `animate-scale-down-fade` | Approval send (card dismiss) |
| `animate-slide-right-fade` | Approval reject (card dismiss) |
| `animate-slide-left-fade` | File/card delete |
| `animate-pop` | Success checkmark bounce |
| `animate-shimmer` | Parsing progress shimmer |

### Z-Index (Content Script)

| Class | Value | Usage |
|-------|-------|-------|
| `z-ext-backdrop` | `2147483640` | Overlay backdrop |
| `z-ext-card` | `2147483645` | Overlay card |
| `z-ext-toast` | `2147483646` | Toast notifications |
| `z-ext-critical` | `2147483647` | Critical UI (INT32_MAX) |

## Typography

| Context | Font | Class |
|---------|------|-------|
| All UI text | Pretendard Variable | `font-sans` (default) |
| Medical codes, hashes | JetBrains Mono / D2Coding | `font-mono` |

### Font Size Rules (Accessibility)

| Usage | Size | Class |
|-------|------|-------|
| Body text | 16px | `text-base` (minimum) |
| Helper text | 14px | `text-sm` (muted only) |
| Badges/labels | 14px | `text-sm` |
| Card titles | 18px | `text-lg` |
| Section headers | 20px | `text-xl` |
| PIN numbers | 32px+ | `text-3xl`+ |

**Never use `text-xs` (12px) for any user-facing content.**

## Components

Available shadcn/ui components at `@/components/ui/`:

| Component | Import |
|-----------|--------|
| Badge | `@/components/ui/badge` |
| Button | `@/components/ui/button` |
| Card | `@/components/ui/card` |
| Dialog | `@/components/ui/dialog` |
| Dropdown Menu | `@/components/ui/dropdown-menu` |
| Input | `@/components/ui/input` |
| Label | `@/components/ui/label` |
| Progress | `@/components/ui/progress` |
| Scroll Area | `@/components/ui/scroll-area` |
| Select | `@/components/ui/select` |
| Separator | `@/components/ui/separator` |
| Skeleton | `@/components/ui/skeleton` |
| Switch | `@/components/ui/switch` |
| Table | `@/components/ui/table` |
| Tabs | `@/components/ui/tabs` |
| Toaster | `@/components/ui/toaster` |

### Utility

- `cn()` from `@/lib/utils` — merges Tailwind classes with conflict resolution
- `useToast()` from `@/hooks/use-toast` — toast notification state management

## Accessibility Requirements

- All interactive elements: **minimum 48px height** (`h-12`)
- Focus rings: **3px width** (`ring-[3px]`)
- Animations: **always use `motion-safe:` prefix**
- Status: **color + icon/text paired** (never color alone)
- Korean text: `word-break: keep-all` (set globally)
- Line height: `1.6` (optimized for Korean readability)
- `prefers-reduced-motion: reduce` respected globally

## Light/Dark Mode

Dark mode is controlled by the `dark` class on the root element. CSS variables automatically swap values.

```tsx
// Correct - uses CSS variables, auto-switches
<div className="bg-background text-foreground">

// Wrong - hardcoded colors
<div className="bg-white dark:bg-gray-900 text-black dark:text-white">
```

## Chrome Extension UI Patterns

### Full-tab pages
```tsx
// In popup/sidepanel entrypoints:
import '@/assets/css/global.css'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
```

### Content Script overlays
- Shadow DOM isolation (no style leakage)
- System fonts only (no Pretendard loading)
- Z-index: `z-ext-*` classes
- No Radix portal components

`assets/css/global.css` must be imported in every React entrypoint (popup, sidepanel) to activate the design tokens.
