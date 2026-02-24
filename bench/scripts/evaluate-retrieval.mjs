import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { buildSemanticChunks } from "../src/phrFormatter.js";
import {
  buildLexicalIndex,
  buildSearchText,
  makeEmbeddingDocumentInput,
  makeEmbeddingQueryInput,
  normalizeMedicalQuery,
  normalizeTextForSearch,
  rankDocumentsDense,
  rankDocumentsHybrid,
} from "../src/searchPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
const MODEL_FILE_NAME = "model";
const DEFAULT_LIMIT = 140;
const BATCH_SIZE = 12;
const DEFAULT_EMBED_CHAR_LIMIT = 900;
const DEFAULT_EMBED_DIM = 576;
const DEFAULT_DENSE_WEIGHT = 0.71;
const DEFAULT_LEXICAL_WEIGHT = 0.25;
const EMBEDDING_CACHE_FILE = path.resolve(ROOT, "tests/eval/.cache/embeddinggemma_q4_cache.json");

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${path.resolve(ROOT, "public/models")}${path.sep}`;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}

function parseArgs(argv) {
  const options = {
    split: "all",
    limit: DEFAULT_LIMIT,
    mode: "both",
    embedCharLimit: DEFAULT_EMBED_CHAR_LIMIT,
    embedDim: DEFAULT_EMBED_DIM,
    denseWeight: DEFAULT_DENSE_WEIGHT,
    lexicalWeight: DEFAULT_LEXICAL_WEIGHT,
    dumpJson: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--split" && argv[i + 1]) {
      options.split = argv[++i];
      continue;
    }
    if (arg === "--mode" && argv[i + 1]) {
      options.mode = argv[++i];
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      options.limit = Math.max(1, Number(argv[++i]) || DEFAULT_LIMIT);
      continue;
    }
    if (arg === "--embed-char-limit" && argv[i + 1]) {
      options.embedCharLimit = Math.max(200, Number(argv[++i]) || DEFAULT_EMBED_CHAR_LIMIT);
      continue;
    }
    if (arg === "--embed-dim" && argv[i + 1]) {
      options.embedDim = Math.max(0, Number(argv[++i]) || 0);
      continue;
    }
    if (arg === "--dense-weight" && argv[i + 1]) {
      options.denseWeight = Math.max(0, Number(argv[++i]) || DEFAULT_DENSE_WEIGHT);
      continue;
    }
    if (arg === "--lexical-weight" && argv[i + 1]) {
      options.lexicalWeight = Math.max(0, Number(argv[++i]) || DEFAULT_LEXICAL_WEIGHT);
      continue;
    }
    if (arg === "--dump-json" && argv[i + 1]) {
      options.dumpJson = String(argv[++i]);
      continue;
    }
  }

  return options;
}

function deterministicHash(input) {
  let hash = 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function embeddingKey(text) {
  return createHash("sha1").update(String(text)).digest("hex");
}

async function loadEmbeddingCache() {
  try {
    const raw = await readFile(EMBEDDING_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const fileNameMismatch = parsed?.modelFileName && parsed.modelFileName !== MODEL_FILE_NAME;
    if (parsed?.modelId !== MODEL_ID || parsed?.dtype !== "q4" || fileNameMismatch) {
      return {
        vectors: new Map(),
        dirty: false,
      };
    }
    const entries = Object.entries(parsed?.vectors || {});
    return {
      vectors: new Map(entries),
      dirty: false,
    };
  } catch {
    return {
      vectors: new Map(),
      dirty: false,
    };
  }
}

async function saveEmbeddingCache(cacheState) {
  if (!cacheState?.dirty) {
    return;
  }
  await mkdir(path.dirname(EMBEDDING_CACHE_FILE), { recursive: true });
  const payload = {
    modelId: MODEL_ID,
    dtype: "q4",
    modelFileName: MODEL_FILE_NAME,
    updatedAt: new Date().toISOString(),
    vectors: Object.fromEntries(cacheState.vectors.entries()),
  };
  await writeFile(EMBEDDING_CACHE_FILE, JSON.stringify(payload), "utf8");
  cacheState.dirty = false;
}

function vectorRowsFromOutput(output, batchSize) {
  const raw = output?.data;
  if (!raw) {
    throw new Error("Embedding output is missing data.");
  }
  const flat = raw instanceof Float32Array ? raw : Float32Array.from(raw);
  if (batchSize === 1) {
    return [flat];
  }

  const dims = Array.isArray(output?.dims) ? output.dims : [];
  let dim = 0;
  if (dims.length >= 2 && Number(dims[0]) === batchSize) {
    dim = Number(dims[dims.length - 1]);
  } else if (flat.length % batchSize === 0) {
    dim = flat.length / batchSize;
  }

  if (!dim || dim <= 0 || dim * batchSize !== flat.length) {
    throw new Error(`Unexpected embedding shape for batch=${batchSize}, dataLen=${flat.length}`);
  }

  const rows = [];
  for (let i = 0; i < batchSize; i += 1) {
    const start = i * dim;
    rows.push(flat.slice(start, start + dim));
  }
  return rows;
}

function dotSimilarity(vecA, vecB) {
  const len = Math.min(vecA.length, vecB.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

function projectEmbedding(vector, dim = 0) {
  if (!dim || dim <= 0 || vector.length <= dim) {
    return vector;
  }
  const projected = vector.slice(0, dim);
  let norm = 0;
  for (let i = 0; i < projected.length; i += 1) {
    norm += projected[i] * projected[i];
  }
  if (norm <= 1e-12) {
    return projected;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < projected.length; i += 1) {
    projected[i] *= inv;
  }
  return projected;
}

async function embedTexts(extractor, texts, cacheState, batchSize = BATCH_SIZE) {
  const vectors = new Array(texts.length);
  const pendingIndexes = [];
  const pendingTexts = [];

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    const key = embeddingKey(text);
    const cached = cacheState.vectors.get(key);
    if (cached) {
      vectors[i] = Float32Array.from(cached);
      continue;
    }
    pendingIndexes.push(i);
    pendingTexts.push(text);
  }

  if (!pendingTexts.length) {
    console.error(`[embed] cache hit ${texts.length}/${texts.length}`);
    return vectors;
  }

  for (let i = 0; i < pendingTexts.length; i += batchSize) {
    const batch = pendingTexts.slice(i, i + batchSize);
    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });
    const rows = vectorRowsFromOutput(output, batch.length);
    for (let j = 0; j < rows.length; j += 1) {
      const row = rows[j];
      const originalIndex = pendingIndexes[i + j];
      const key = embeddingKey(pendingTexts[i + j]);
      vectors[originalIndex] = row;
      cacheState.vectors.set(key, Array.from(row));
      cacheState.dirty = true;
    }

    if ((i / batchSize) % 20 === 0 || i + batchSize >= pendingTexts.length) {
      console.error(`[embed] ${Math.min(i + batchSize, pendingTexts.length)}/${pendingTexts.length}`);
    }
  }

  return vectors;
}

async function loadJson(relativePath) {
  const filePath = path.resolve(ROOT, relativePath);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadDocs() {
  const fixtureFiles = ["case_a.json", "case_b.json", "case_c.json"];
  const docs = [];
  for (const fileName of fixtureFiles) {
    const parsed = await loadJson(`tests/fixtures/anon/${fileName}`);
    const chunks = buildSemanticChunks(parsed, fileName);
    for (const chunk of chunks) {
      docs.push({
        ...chunk,
        searchText: buildSearchText(chunk),
      });
    }
  }
  return docs;
}

async function loadQueries(split, limit) {
  const evalSet = await loadJson("tests/eval/retrieval_eval_set.json");
  const testSet = await loadJson("tests/eval/retrieval_test_set.json");
  const all = [...evalSet, ...testSet];
  let selected = all;
  if (split === "eval") {
    selected = evalSet;
  } else if (split === "test") {
    selected = testSet;
  }
  const ordered = [...selected].sort((a, b) => deterministicHash(a.id) - deterministicHash(b.id));
  return ordered.slice(0, limit);
}

function isRelevant(doc, query) {
  if (Array.isArray(query.expectedDocIds) && query.expectedDocIds.length) {
    return query.expectedDocIds.includes(doc.id);
  }

  const excludedSections = Array.isArray(query.excludeSections) ? query.excludeSections : [];
  if (excludedSections.includes(doc.section)) {
    return false;
  }
  if (doc.fileName !== query.fileName) {
    return false;
  }
  const text = normalizeTextForSearch(doc.searchText || doc.text || "");
  const anchor = normalizeTextForSearch(query.anchor || "");
  const month = normalizeTextForSearch(query.month || "");
  const section = String(query.expectedSection || "").trim();

  if (!anchor || !text.includes(anchor)) {
    return false;
  }
  if (month && month !== "unknown" && !text.includes(month)) {
    return false;
  }
  if (section && doc.section !== section) {
    return false;
  }
  return true;
}

function evaluateRanking(rankedDocs, query, cutoff = 10) {
  const top = rankedDocs.slice(0, cutoff);
  const binary = top.map((doc) => (isRelevant(doc, query) ? 1 : 0));
  const relevantRanks = [];
  for (let i = 0; i < binary.length; i += 1) {
    if (binary[i]) relevantRanks.push(i + 1);
  }
  return {
    firstRank: relevantRanks[0] || Number.POSITIVE_INFINITY,
    relevantInTop: binary.reduce((acc, cur) => acc + cur, 0),
    binary,
  };
}

function computeMetrics(perQuery, cutoff = 10) {
  const size = Math.max(1, perQuery.length);
  let hit1 = 0;
  let hit3 = 0;
  let hit5 = 0;
  let mrr = 0;
  let ndcg = 0;

  for (const item of perQuery) {
    const rank = item.firstRank;
    if (rank <= 1) hit1 += 1;
    if (rank <= 3) hit3 += 1;
    if (rank <= 5) hit5 += 1;
    if (rank <= cutoff) {
      mrr += 1 / rank;
    }

    let dcg = 0;
    for (let i = 0; i < item.binary.length; i += 1) {
      const rel = item.binary[i];
      if (!rel) continue;
      dcg += rel / Math.log2(i + 2);
    }
    const idealCount = item.binary.reduce((acc, cur) => acc + cur, 0);
    let idcg = 0;
    for (let i = 0; i < idealCount; i += 1) {
      idcg += 1 / Math.log2(i + 2);
    }
    if (idcg > 0) {
      ndcg += dcg / idcg;
    }
  }

  return {
    queries: perQuery.length,
    hitAt1: hit1 / size,
    hitAt3: hit3 / size,
    hitAt5: hit5 / size,
    mrrAt10: mrr / size,
    ndcgAt10: ndcg / size,
  };
}

async function evaluateMode({ mode, extractor, docs, queries, cacheState, embedDim = 0, denseWeight, lexicalWeight }) {
  const lexicalIndex = buildLexicalIndex(docs);
  const capText = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}...` : text);

  console.error(`[mode:${mode}] embedding ${docs.length} docs`);
  const docInputs =
    mode === "baseline"
      ? docs.map((doc) => capText(doc.text || "", evaluateOptions.embedCharLimit))
      : docs.map((doc) => capText(makeEmbeddingDocumentInput(doc), evaluateOptions.embedCharLimit));
  const docVectors = await embedTexts(extractor, docInputs, cacheState, BATCH_SIZE);
  const embeddedDocs = docs.map((doc, index) => ({
    ...doc,
    embedding: projectEmbedding(docVectors[index], embedDim),
  }));

  const queryInfos =
    mode === "baseline"
      ? queries.map((query) => ({
          rawQuery: query.query,
          normalizedQuery: normalizeTextForSearch(query.query),
          tokens: [],
          rewriteApplied: false,
          sectionAffinity: new Map(),
        }))
      : queries.map((query) => normalizeMedicalQuery(query.query, lexicalIndex));

  const queryInputs =
    mode === "baseline"
      ? queries.map((query) => capText(query.query, evaluateOptions.embedCharLimit))
      : queryInfos.map((queryInfo) => makeEmbeddingQueryInput(queryInfo));
  console.error(`[mode:${mode}] embedding ${queries.length} queries`);
  const queryVectors = await embedTexts(extractor, queryInputs, cacheState, BATCH_SIZE);

  const perQuery = [];
  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    const queryInfo = queryInfos[i];
    const queryVector = projectEmbedding(queryVectors[i], embedDim);

    const ranked =
      mode === "baseline"
        ? rankDocumentsDense({
            docs: embeddedDocs,
            queryVector,
            dotSimilarity,
          })
        : rankDocumentsHybrid({
            docs: embeddedDocs,
            queryVector,
            queryInfo,
            lexicalIndex,
            dotSimilarity,
            denseWeight,
            lexicalWeight,
          });

    const result = evaluateRanking(ranked, query, 10);
    perQuery.push({
      ...result,
      queryId: query.id,
      intent: query.intent,
      topSection: String(ranked[0]?.section || ""),
      topFileName: String(ranked[0]?.fileName || ""),
      targetDocCount: Array.isArray(query.expectedDocIds) ? query.expectedDocIds.length : 0,
      hybridApplied: Boolean(ranked[0]?.hybridApplied),
      lexicalSupport: Number(ranked[0]?.lexicalSupport || 0),
      matchedTokenCount: Number(ranked[0]?.matchedTokenCount || 0),
      lexicalHitCount: Number(ranked[0]?.lexicalHitCount || 0),
      lexicalHitRatio: Number(ranked[0]?.lexicalHitRatio || 0),
      lexicalCandidateCount: Number(ranked[0]?.lexicalCandidateCount || 0),
    });
  }

  return {
    mode,
    metrics: computeMetrics(perQuery, 10),
    perQuery,
  };
}

function metricsByIntent(perQuery) {
  const grouped = new Map();
  for (const row of perQuery) {
    if (!grouped.has(row.intent)) grouped.set(row.intent, []);
    grouped.get(row.intent).push(row);
  }
  const out = {};
  for (const [intent, rows] of grouped.entries()) {
    out[intent] = computeMetrics(rows, 10);
  }
  return out;
}

function hybridDiagnostics(perQuery) {
  const rows = perQuery.filter((row) => row.hybridApplied !== undefined);
  if (!rows.length) {
    return null;
  }
  const total = rows.length;
  const applied = rows.filter((row) => row.hybridApplied).length;
  const topContext = rows.filter((row) => row.topSection === "월 컨텍스트").length;
  const misses = rows.filter((row) => !Number.isFinite(row.firstRank) || row.firstRank > 1);
  const topContextOnMiss = misses.filter((row) => row.topSection === "월 컨텍스트").length;
  const avgTargetDocCount = rows.reduce((acc, row) => acc + (Number(row.targetDocCount) || 0), 0) / total;
  const avg = (key) => rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0) / total;
  return {
    queries: total,
    hybridAppliedRate: applied / total,
    avgTargetDocCount,
    topContextRate: topContext / total,
    topContextOnMissRate: topContextOnMiss / Math.max(1, misses.length),
    avgLexicalSupport: avg("lexicalSupport"),
    avgMatchedTokenCount: avg("matchedTokenCount"),
    avgLexicalHitCount: avg("lexicalHitCount"),
    avgLexicalHitRatio: avg("lexicalHitRatio"),
    avgLexicalCandidateCount: avg("lexicalCandidateCount"),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  evaluateOptions = options;
  const docs = await loadDocs();
  const queries = await loadQueries(options.split, options.limit);

  if (!queries.length) {
    throw new Error("No queries found. Run `pnpm gen:retrieval-dataset` first.");
  }

  const cacheState = await loadEmbeddingCache();

  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    device: "cpu",
    dtype: "q4",
    model_file_name: MODEL_FILE_NAME,
  });
  console.error(
    `[config] mode=${options.mode} split=${options.split} limit=${options.limit} embedCharLimit=${options.embedCharLimit} embedDim=${options.embedDim || 0} denseWeight=${options.denseWeight} lexicalWeight=${options.lexicalWeight}`,
  );

  const modes = options.mode === "both" ? ["baseline", "improved"] : [options.mode];
  const outputs = [];
  for (const mode of modes) {
    const result = await evaluateMode({
      mode,
      extractor,
      docs,
      queries,
      cacheState,
      embedDim: options.embedDim,
      denseWeight: options.denseWeight,
      lexicalWeight: options.lexicalWeight,
    });
    outputs.push(result);
  }

  await saveEmbeddingCache(cacheState);

  for (const result of outputs) {
    console.log(`\\n[${result.mode}]`);
    console.log(JSON.stringify(result.metrics, null, 2));
    console.log(`[${result.mode}] by intent`);
    console.log(JSON.stringify(metricsByIntent(result.perQuery), null, 2));
    const diagnostics = hybridDiagnostics(result.perQuery);
    if (diagnostics) {
      console.log(`[${result.mode}] diagnostics`);
      console.log(JSON.stringify(diagnostics, null, 2));
    }
  }

  if (outputs.length === 2) {
    const base = outputs.find((x) => x.mode === "baseline")?.metrics;
    const improved = outputs.find((x) => x.mode === "improved")?.metrics;
    if (base && improved) {
      const delta = {
        hitAt1: improved.hitAt1 - base.hitAt1,
        hitAt3: improved.hitAt3 - base.hitAt3,
        hitAt5: improved.hitAt5 - base.hitAt5,
        mrrAt10: improved.mrrAt10 - base.mrrAt10,
        ndcgAt10: improved.ndcgAt10 - base.ndcgAt10,
      };
      console.log("\\n[delta improved-baseline]");
      console.log(JSON.stringify(delta, null, 2));
    }
  }

  if (options.dumpJson) {
    const dumpPath = path.resolve(ROOT, options.dumpJson);
    await mkdir(path.dirname(dumpPath), { recursive: true });
    await writeFile(
      dumpPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          options,
          outputs,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.error(`[dump] wrote ${dumpPath}`);
  }
}

let evaluateOptions = {
  embedCharLimit: DEFAULT_EMBED_CHAR_LIMIT,
  embedDim: DEFAULT_EMBED_DIM,
  denseWeight: DEFAULT_DENSE_WEIGHT,
  lexicalWeight: DEFAULT_LEXICAL_WEIGHT,
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
