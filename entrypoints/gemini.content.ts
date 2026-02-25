export default defineContentScript({
  matches: ["https://gemini.google.com/*"],
  runAt: "document_idle",
  main() {
    import("../src/content/gemini");
  },
});
