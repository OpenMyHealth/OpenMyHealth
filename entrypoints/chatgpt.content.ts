export default defineContentScript({
  matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  runAt: "document_idle",
  main() {
    import("../src/content/chatgpt");
  },
});
