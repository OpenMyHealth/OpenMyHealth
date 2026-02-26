# OpenMyHealth

OpenMyHealth brings your health data together and delivers it safely to AI assistants (ChatGPT, Gemini, Claude, etc.).

## Dev

```bash
pnpm install
pnpm dev
```

Load `.output/chrome-mv3-dev` in `chrome://extensions` (Developer mode).

## Build

```bash
pnpm wxt:build
```

## Load Extension (Chrome)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3/`.

## QA

```bash
pnpm type-check
pnpm lint
```
