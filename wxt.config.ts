import { defineConfig } from "wxt";

const isE2E = process.env.OMH_E2E === "1";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  publicDir: "static",
  webExt: {
    binaries: {
      chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    chromiumProfile: ".wxt/chrome-profile",
    keepProfileChanges: true,
    startUrls: ["https://chatgpt.com/"],
    chromiumArgs: ["--remote-debugging-port=9222"],
  },
  vite: () => ({
    define: {
      "import.meta.env.OMH_E2E": JSON.stringify(isE2E),
    },
resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
        "@contracts": new URL("./packages/contracts/src", import.meta.url).pathname,
      },
    },
  }),
  manifest: {
    minimum_chrome_version: "122",
    name: isE2E ? "OpenMyHealth [E2E]" : "OpenMyHealth",
    description:
      "OpenMyHealth Safety Layer: local health vault, guided source sync, and approval-first AI context delivery.",
    version: "0.0.0",
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "96": "icon/96.png",
      "128": "icon/128.png",
    },
    permissions: ["storage", "tabs"],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      ...(isE2E ? ["http://localhost:*/*"] : []),
    ],
    content_security_policy: {
      extension_pages: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
    action: {
      default_title: "OpenMyHealth",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "96": "icon/96.png",
        "128": "icon/128.png",
      },
    },
  },
});
