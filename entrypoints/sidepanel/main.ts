import sidepanelTemplate from "../../static/sidepanel.html?raw";

function mountSidepanelTemplate(): void {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(sidepanelTemplate, "text/html");

  parsed.querySelectorAll("script").forEach((node) => node.remove());

  document.documentElement.lang = parsed.documentElement.lang || "ko";
  document.title = parsed.title || "OpenMyHealth Vault";
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

async function bootstrap(): Promise<void> {
  mountSidepanelTemplate();
  await import("../../src/sidepanel/index");
}

bootstrap();
