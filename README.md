# OpenMyHealth

OpenMyHealth brings your health data together and delivers it safely to AI assistants (ChatGPT, Claude).

## Dev

```bash
pnpm install
pnpm dev
```

`pnpm dev`를 실행한 상태에서만 `.output/chrome-mv3-dev`를 로드하세요.  
`chrome-mv3-dev`는 Vite HMR(`ws://localhost:3000`)에 연결하므로 dev 서버가 꺼져 있으면 동작하지 않습니다.

## Build

```bash
pnpm wxt:build
```

## Relay (local)

`relay:start`는 빌드를 포함해 실행되며, 보안을 위해 `RELAY_JWT_SECRET`이 필수입니다.

```bash
export RELAY_JWT_SECRET='change-this-to-at-least-32-chars'
pnpm relay:start
```

MCP 실제 읽기 응답까지 확인하려면 bridge 설정이 추가로 필요합니다.

```bash
export RELAY_MCP_BRIDGE_URL='https://your-bridge.example.com/mcp/read_health_records'
export RELAY_BRIDGE_AUTH_TOKEN='your-bridge-service-token'
```

`RELAY_MCP_BRIDGE_URL` 미설정 상태에서는 `/health`는 정상이어도 MCP 읽기 호출은 `NETWORK_UNAVAILABLE`로 응답됩니다.

보안 기본값:
- access token TTL: 1시간
- bridge 연동 시 subject/audience 전달 헤더: `X-OMH-Sub`, `X-OMH-Aud`

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Load Extension (Chrome)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3/` (프로덕션 빌드).
4. `.output/chrome-mv3-dev/`는 `pnpm dev` 실행 중일 때만 사용하세요.
5. 서비스 워커 오류에 `ws://localhost:3000`가 보이면 dev 빌드를 잘못 로드한 상태입니다.
6. 최초 설치 직후 `setup.html`이 자동으로 열리며 PIN 설정 후 `vault.html`로 이동합니다.

### Troubleshooting
- `vault.html`이 흰 화면/무한 로딩이면:
  - `chrome://extensions`에서 OpenMyHealth를 `새로고침`
  - 로드 경로가 `.output/chrome-mv3`인지 확인
  - `.output/chrome-mv3-dev`를 쓴 경우 `pnpm dev`를 켜거나 프로덕션 빌드로 다시 로드
- 서비스 워커 오류에 `Failed to connect to dev server`가 보이면:
  - dev 번들 로드 상태입니다. 프로덕션 테스트는 `.output/chrome-mv3`를 사용하세요.

## QA

```bash
pnpm type-check
pnpm lint
```
