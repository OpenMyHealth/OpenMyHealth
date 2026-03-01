import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    'entrypoints/**/*.{ts,tsx,html}',
    'src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        lg: "900px",
      },
    },
    extend: {
      fontFamily: {
        sans: [
          "Pretendard Variable", "Pretendard",
          "-apple-system", "BlinkMacSystemFont",
          "Apple SD Gothic Neo", "Noto Sans KR",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "D2Coding", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        provider: {
          chatgpt: { DEFAULT: "hsl(var(--provider-chatgpt))", soft: "hsl(var(--provider-chatgpt-soft))" },
          claude: { DEFAULT: "hsl(var(--provider-claude))", soft: "hsl(var(--provider-claude-soft))" },
          disabled: { DEFAULT: "hsl(var(--provider-disabled))", soft: "hsl(var(--provider-disabled-soft))" },
        },
        "status-success": { surface: "hsl(var(--status-success-surface))", border: "hsl(var(--status-success-border))" },
        "status-destructive": { surface: "hsl(var(--status-destructive-surface))", border: "hsl(var(--status-destructive-border))" },
        "status-warning": { surface: "hsl(var(--status-warning-surface))", border: "hsl(var(--status-warning-border))" },
        "status-info": { surface: "hsl(var(--status-info-surface))", border: "hsl(var(--status-info-border))" },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 0.25rem)",
        xl: "var(--radius)",
        lg: "calc(var(--radius) - 2px)",
        md: "calc(var(--radius) - 4px)",
        sm: "max(2px, calc(var(--radius) - 8px))",
        full: "9999px",
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 16px rgba(26,107,90,0.10), 0 2px 4px rgba(0,0,0,0.06)',
        'card-elevated': '0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        'metric': '0 1px 3px rgba(0,0,0,0.03)',
        'overlay': '0 0 0 1px rgba(0,0,0,0.08), 0 4px 6px -1px rgba(0,0,0,0.10), 0 16px 40px -4px rgba(0,0,0,0.20)',
        'soft-float': '0 20px 40px -10px rgba(0,0,0,0.08)',
        'soft-float-dark': '0 20px 40px -10px rgba(0,0,0,0.5)',
      },
      fontSize: {
        'stat-lg': ['3rem', { lineHeight: '1', fontWeight: '700' }],
        'stat-md': ['2.25rem', { lineHeight: '1.1', fontWeight: '700' }],
        'stat-sm': ['1.5rem', { lineHeight: '1.2', fontWeight: '600' }],
      },
      spacing: {
        'card-lg': '1.5rem',
        'card-md': '1.25rem',
        'card-sm': '1rem',
      },
      zIndex: {
        'page-toast': '100',
        'ext-backdrop': '2147483640',
        'ext-card': '2147483645',
        'ext-toast': '2147483646',
        'ext-critical': '2147483647',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "status-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(0.85)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
        "slide-up-fade": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-down-fade": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.95)" },
        },
        "slide-right-fade": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(100%)" },
        },
        "slide-left-fade": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(-100%)" },
        },
        "pop": {
          "0%": { opacity: "0", transform: "scale(0.5)" },
          "70%": { opacity: "1", transform: "scale(1.1)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "shimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "status-pulse": "status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "slide-up": "slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "shake": "shake 0.4s ease-out",
        "slide-up-fade": "slide-up-fade 0.25s ease-out",
        "scale-down-fade": "scale-down-fade 0.3s ease-out forwards",
        "slide-right-fade": "slide-right-fade 0.2s ease-out forwards",
        "slide-left-fade": "slide-left-fade 0.25s ease-out forwards",
        "pop": "pop 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "shimmer": "shimmer 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
