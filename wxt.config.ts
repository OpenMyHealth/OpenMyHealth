import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  publicDir: "static",
  webExt: {
    disabled: true,
  },
  vite: () => ({
    optimizeDeps: {
      entries: [],
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
    name: "OpenMyHealth",
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
    ],
    content_security_policy: {
      extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
