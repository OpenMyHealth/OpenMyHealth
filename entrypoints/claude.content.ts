export default defineContentScript({
  matches: ["https://claude.ai/*"],
  runAt: "document_idle",
  main() {
    import("../src/content/claude");
  },
});
