import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSemanticChunks } from "../src/phrFormatter.js";
import { buildSearchText, normalizeTextForSearch } from "../src/searchPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/anon");
const OUT_DIR = path.join(ROOT, "tests/eval");
const FIXTURES = [
  { fileName: "case_a.json", id: "case_a" },
  { fileName: "case_b.json", id: "case_b" },
  { fileName: "case_c.json", id: "case_c" },
];

function normalizeMonth(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "unknown";
  }
  let match = raw.match(/^(\d{4})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  match = raw.match(/^(\d{4})[-/.](\d{2})(?:[-/.]\d{2})?$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return raw;
}

function cleanDisease(value) {
  return String(value || "")
    .replace(/^\([^)]*\)\s*/g, "")
    .trim();
}

function shortText(value, limit = 26) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, limit);
}

function deterministicHash(input) {
  let hash = 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sampleItems(items, targetCount) {
  if (!items.length || targetCount <= 0) return [];
  const step = Math.max(1, Math.floor(items.length / targetCount));
  const out = [];
  for (let i = 0; i < items.length && out.length < targetCount; i += step) {
    out.push(items[i]);
  }
  return out;
}

function countOccurrences(text, token) {
  if (!text || !token) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(token, from);
    if (index < 0) {
      break;
    }
    count += 1;
    from = index + token.length;
  }
  return count;
}

function preferredSectionsByIntent(intent, expectedSection) {
  if (expectedSection) {
    return [expectedSection];
  }
  if (intent === "detail" || intent === "detail_category") {
    return ["진료 상세"];
  }
  if (intent === "prescription" || intent === "ingredient") {
    return ["처방"];
  }
  return ["진료 상세", "진료 요약", "처방"];
}

function scoreDocCandidate(doc, query, anchorToken, preferredSections) {
  let score = 0;
  if (query.expectedSection && doc.section === query.expectedSection) {
    score += 100;
  }
  const sectionRank = preferredSections.indexOf(doc.section);
  if (sectionRank >= 0) {
    score += 40 - sectionRank * 6;
  }
  if (query.month && query.month !== "unknown" && doc.month === query.month) {
    score += 30;
  }
  score += Math.min(20, countOccurrences(doc.normalizedSearchText, anchorToken));
  score -= doc.chunkIndex * 0.0001;
  return score;
}

function attachExpectedDocIds(queries, docs) {
  const out = [];
  for (const query of queries) {
    const anchorToken = normalizeTextForSearch(query.anchor || "");
    if (!anchorToken) {
      continue;
    }

    const preferredSections = preferredSectionsByIntent(query.intent, query.expectedSection);
    let candidates = docs.filter(
      (doc) =>
        doc.fileName === query.fileName &&
        doc.section !== "월 컨텍스트" &&
        doc.normalizedSearchText.includes(anchorToken),
    );

    if (query.expectedSection) {
      candidates = candidates.filter((doc) => doc.section === query.expectedSection);
    } else {
      candidates = candidates.filter((doc) => preferredSections.includes(doc.section));
    }

    if (query.month && query.month !== "unknown") {
      const monthToken = normalizeTextForSearch(query.month);
      candidates = candidates.filter(
        (doc) => doc.month === query.month || doc.normalizedSearchText.includes(monthToken),
      );
    }

    if (!candidates.length) {
      continue;
    }

    const expectedDocIds = candidates
      .map((doc) => ({
        id: doc.id,
        score: scoreDocCandidate(doc, query, anchorToken, preferredSections),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 3)
      .map((item) => item.id);

    if (!expectedDocIds.length) {
      continue;
    }

    out.push({
      ...query,
      expectedDocIds,
      preferredSections,
      excludeSections: ["월 컨텍스트"],
    });
  }
  return out;
}

function createSummaryQueries(fileName, summaries) {
  const sampled = sampleItems(summaries, 18);
  const queries = [];
  for (let i = 0; i < sampled.length; i += 1) {
    const item = sampled[i];
    const month = normalizeMonth(item.date);
    const part = shortText(item.part, 20);
    const disease = shortText(cleanDisease(item.disease_name), 30);
    if (!part && !disease) continue;

    queries.push({
      id: `${fileName}-summary-${i}-a`,
      fileName,
      intent: "summary",
      query: `${month} ${part} ${disease} 진료 기록`,
      anchor: disease || part,
      month,
      expectedSection: "진료 요약",
    });
    queries.push({
      id: `${fileName}-summary-${i}-b`,
      fileName,
      intent: "summary_natural",
      query: `${disease || part} 관련해서 병원에서 진료 본 내역 알려줘`,
      anchor: disease || part,
      month: "",
      expectedSection: "진료 요약",
    });
    if (part) {
      queries.push({
        id: `${fileName}-summary-${i}-c`,
        fileName,
        intent: "part",
        query: `${part} 쪽으로 받은 진료 기록이 뭐가 있어?`,
        anchor: part,
        month: "",
        expectedSection: "",
      });
    }
  }
  return queries;
}

function createDetailQueries(fileName, details) {
  const sampled = sampleItems(details, 14);
  const queries = [];
  for (let i = 0; i < sampled.length; i += 1) {
    const item = sampled[i];
    const month = normalizeMonth(item.date);
    const name = shortText(item.name, 30);
    if (!name) continue;
    queries.push({
      id: `${fileName}-detail-${i}-a`,
      fileName,
      intent: "detail",
      query: `${name} 검사나 치료 받은 기록 찾아줘`,
      anchor: name,
      month: "",
      expectedSection: "진료 상세",
    });
    queries.push({
      id: `${fileName}-detail-${i}-b`,
      fileName,
      intent: "detail_category",
      query: `${month} ${shortText(item.category, 20)} 관련 진료 상세 내역`,
      anchor: name,
      month,
      expectedSection: "진료 상세",
    });
  }
  return queries;
}

function createPrescriptionQueries(fileName, prescriptions) {
  const sampled = sampleItems(prescriptions, 14);
  const queries = [];
  for (let i = 0; i < sampled.length; i += 1) {
    const item = sampled[i];
    const month = normalizeMonth(item.date);
    const med = shortText(item.medicine_name, 28);
    const ing = shortText(item.ingredient, 24);
    if (!med && !ing) continue;
    queries.push({
      id: `${fileName}-rx-${i}-a`,
      fileName,
      intent: "prescription",
      query: `${med || ing} 처방 받은 시기 알려줘`,
      anchor: med || ing,
      month: "",
      expectedSection: "처방",
    });
    if (ing) {
      queries.push({
        id: `${fileName}-rx-${i}-b`,
        fileName,
        intent: "ingredient",
        query: `${ing} 성분 약 복용 기록`,
        anchor: ing,
        month: "",
        expectedSection: "처방",
      });
    }
  }
  return queries;
}

function createColloquialQueries(fileName, summaries) {
  const sampled = sampleItems(summaries, 12);
  const queries = [];
  for (let i = 0; i < sampled.length; i += 1) {
    const item = sampled[i];
    const month = normalizeMonth(item.date);
    const part = shortText(item.part, 20);
    if (!part) continue;
    queries.push({
      id: `${fileName}-col-${i}-a`,
      fileName,
      intent: "colloquial",
      query: `${part} 쪽이 불편해서 병원 갔던 기록 있어?`,
      anchor: part,
      month: "",
      expectedSection: "",
    });
  }
  return queries;
}

async function loadFixture(fileName) {
  const raw = await readFile(path.join(FIXTURE_DIR, fileName), "utf8");
  return JSON.parse(raw);
}

function withSplit(query) {
  const hash = deterministicHash(query.id);
  return {
    ...query,
    split: hash % 5 === 0 ? "test" : "eval",
  };
}

async function main() {
  const allQueries = [];

  for (const fixture of FIXTURES) {
    const parsed = await loadFixture(fixture.fileName);
    const summaries = Array.isArray(parsed.treatmentsSummary) ? parsed.treatmentsSummary : [];
    const details = Array.isArray(parsed.treatmentsDetail) ? parsed.treatmentsDetail : [];
    const prescriptions = Array.isArray(parsed.prescriptions) ? parsed.prescriptions : [];

    const queries = [
      ...createSummaryQueries(fixture.fileName, summaries),
      ...createDetailQueries(fixture.fileName, details),
      ...createPrescriptionQueries(fixture.fileName, prescriptions),
      ...createColloquialQueries(fixture.fileName, summaries),
    ];

    const chunkDocs = buildSemanticChunks(parsed, fixture.fileName).map((doc) => {
      const searchText = buildSearchText(doc);
      return {
        ...doc,
        searchText,
        normalizedSearchText: normalizeTextForSearch(searchText),
      };
    });
    const strictQueries = attachExpectedDocIds(queries, chunkDocs);

    for (const query of strictQueries) {
      if (!query.anchor || !query.query.trim()) {
        continue;
      }
      allQueries.push(withSplit(query));
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const query of allQueries) {
    const key = query.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(query);
  }

  deduped.sort((a, b) => deterministicHash(a.id) - deterministicHash(b.id));

  await mkdir(OUT_DIR, { recursive: true });
  const evalSet = deduped.filter((item) => item.split === "eval");
  const testSet = deduped.filter((item) => item.split === "test");

  await writeFile(path.join(OUT_DIR, "retrieval_eval_set.json"), JSON.stringify(evalSet, null, 2));
  await writeFile(path.join(OUT_DIR, "retrieval_test_set.json"), JSON.stringify(testSet, null, 2));

  console.log(
    JSON.stringify(
      {
        total: deduped.length,
        eval: evalSet.length,
        test: testSet.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
