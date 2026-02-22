import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findProviderInput,
  insertDraftIntoProvider,
} from "../adapters";
import { Provider } from "../../context/types";

function loadFixture(name: string) {
  return readFileSync(join(__dirname, "..", "__fixtures__", name), "utf8");
}

describe("provider contract fixtures", () => {
  const fixtures: Array<{ provider: Provider; file: string }> = [
    { provider: "chatgpt", file: "chatgpt.html" },
    { provider: "gemini", file: "gemini.html" },
    { provider: "claude", file: "claude.html" },
  ];

  it.each(fixtures)("$provider fixture에서 입력창을 탐지하고 draft를 삽입한다", ({ provider, file }) => {
    document.body.innerHTML = loadFixture(file);

    const input = findProviderInput(provider, document);
    expect(input).not.toBeNull();

    const result = insertDraftIntoProvider(provider, document, "fixture-draft");
    expect(result.ok).toBe(true);

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      expect(input.value).toBe("fixture-draft");
      return;
    }

    expect(input?.textContent).toBe("fixture-draft");
  });
});
