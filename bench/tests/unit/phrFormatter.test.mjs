import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSemanticChunks, __testables } from "../../src/phrFormatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/anon");

async function loadFixture(name) {
  const raw = await readFile(path.join(FIXTURE_DIR, name), "utf8");
  return JSON.parse(raw);
}

test("normalizeMonth handles PHR date formats", () => {
  assert.equal(__testables.normalizeMonth("202412"), "2024-12");
  assert.equal(__testables.normalizeMonth("2024-12"), "2024-12");
  assert.equal(__testables.normalizeMonth("2024-12-31"), "2024-12");
  assert.equal(__testables.normalizeMonth(""), "unknown");
});

test("PHR fixtures generate summary-centered chunks without root path noise", async () => {
  const fixtures = ["case_a.json", "case_b.json", "case_c.json"];
  for (const fixtureName of fixtures) {
    const parsed = await loadFixture(fixtureName);
    const chunks = buildSemanticChunks(parsed, fixtureName);

    assert.ok(chunks.length > 0, `${fixtureName} should produce chunks`);
    assert.ok(chunks.every((chunk) => chunk.text.startsWith("요약: ")), `${fixtureName} should keep summary prefix`);
    assert.ok(chunks.some((chunk) => chunk.text.includes("구분: 진료 상세")), `${fixtureName} should include detail docs`);
    assert.ok(chunks.some((chunk) => chunk.text.includes("구분: 처방")), `${fixtureName} should include prescription docs`);

    const hasPathNoise = chunks.some((chunk) => /root(?:\.|\[)/.test(chunk.text));
    assert.equal(hasPathNoise, false, `${fixtureName} should not include root path traces`);
  }
});

test("case_a keeps core medical content and avoids document explosion", async () => {
  const parsed = await loadFixture("case_a.json");
  const chunks = buildSemanticChunks(parsed, "case_a.json");

  assert.ok(chunks.some((chunk) => chunk.text.includes("약국관리료(방문당)")));
  assert.ok(chunks.some((chunk) => chunk.text.includes("보령메이액트정100밀리그램")));
  assert.ok(chunks.some((chunk) => chunk.text.includes("주요질환")));
  assert.ok(chunks.length > 100, "case_a should not collapse too aggressively");
  assert.ok(chunks.length < 1200, "case_a should stay far below per-record chunk count");
});
