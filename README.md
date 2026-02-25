# OpenMyHealth

OpenMyHealth brings your health data together and delivers it safely to AI assistants (ChatGPT, Gemini, Claude, etc.).

## Build

```bash
pnpm install
pnpm build
pnpm validate:dist
```

Chrome extension output is generated in `dist/`.

## Dev Mode (WXT Hot-Reload Loop)

```bash
pnpm install
pnpm dev
```

- WXT runs a live build watcher for extension entrypoints.
- Load `.output/chrome-mv3-dev` once in `chrome://extensions`, then keep `pnpm dev` running.
- Use this for tight UI iteration on Side Panel, content scripts, and background logic.

### Side Panel UI Focused Workflow

1. Run `pnpm dev`.
2. Open `chrome://extensions` -> **Load unpacked** -> `.output/chrome-mv3-dev`.
3. Open `chatgpt.com` and click the extension action icon.
4. Keep DevTools open on the Side Panel, edit `src/sidepanel/*` and `static/sidepanel.html`.
5. Save -> WXT rebuilds/reloads automatically.

### Notes

- `static/sidepanel.html` remains the single source of Side Panel markup/style.
- In WXT mode, `entrypoints/sidepanel/main.ts` mounts that template and boots `src/sidepanel/index.ts`.
- Existing release pipeline (`pnpm build`, `pnpm release:dry-run`) is unchanged and still outputs to `dist/`.

## Load Extension (Chrome)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `dist/`.

## QA

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm test:e2e:extension
```

## Release Dry-Run

```bash
pnpm release:dry-run
# or with explicit tag
pnpm release:dry-run v0.1.1
```

## Docs
- `docs/security.md`: security model and boundaries
- `docs/ux-flow.md`: end-to-end UX flow
- `docs/adapters.md`: country/source adapter contribution guide
