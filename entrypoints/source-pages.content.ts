export default defineContentScript({
  matches: ["https://www.hira.or.kr/*", "https://ptl.hira.or.kr/*"],
  runAt: "document_idle",
  main() {
    import("../src/content/source-pages");
  },
});
