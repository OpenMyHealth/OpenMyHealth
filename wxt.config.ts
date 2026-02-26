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
      },
    },
  }),
  manifest: {
    minimum_chrome_version: "114",
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
    permissions: ["storage", "tabs", "activeTab", "scripting", "sidePanel"],
    host_permissions: [
      "https://www.hira.or.kr/*",
      "https://ptl.hira.or.kr/*",
      "https://nice.checkplus.co.kr/*",
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://gemini.google.com/*",
      "https://claude.ai/*",
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
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
