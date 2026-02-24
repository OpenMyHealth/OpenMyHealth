import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { buildSemanticChunks } from './src/phrFormatter.js';
import {
  buildLexicalIndex,
  buildSearchText,
  makeEmbeddingDocumentInput,
  makeEmbeddingQueryInput,
  normalizeMedicalQuery,
  normalizeTextForSearch,
  rankDocumentsDense,
  rankDocumentsHybrid,
} from './src/searchPipeline.js';

const ROOT = process.cwd();
const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX';
const CACHE_FILE = path.join(ROOT, 'tests/eval/.cache/embeddinggemma_q4_cache.json');
const BATCH_SIZE = 8;

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${path.resolve(ROOT, 'public/models')}${path.sep}`;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
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
  return createHash('sha1').update(String(text)).digest('hex');
}

function vectorRowsFromOutput(output, batchSize) {
  const raw = output?.data;
  const flat = raw instanceof Float32Array ? raw : Float32Array.from(raw || []);
  if (batchSize === 1) return [flat];
  const dim = flat.length / batchSize;
  const rows = [];
  for (let i = 0; i < batchSize; i += 1) rows.push(flat.slice(i * dim, (i + 1) * dim));
  return rows;
}

function dotSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i];
  return sum;
}

function isRelevant(doc, query) {
  if (doc.fileName !== query.fileName) return false;
  const text = normalizeTextForSearch(doc.searchText || doc.text || '');
  const anchor = normalizeTextForSearch(query.anchor || '');
  const month = normalizeTextForSearch(query.month || '');
  const section = String(query.expectedSection || '').trim();
  if (!anchor || !text.includes(anchor)) return false;
  if (month && month !== 'unknown' && !text.includes(month)) return false;
  if (section && doc.section !== section) return false;
  return true;
}

function evaluateRanking(rankedDocs, query, cutoff = 10) {
  const top = rankedDocs.slice(0, cutoff);
  const binary = top.map((doc) => (isRelevant(doc, query) ? 1 : 0));
  const relevantRanks = [];
  for (let i = 0; i < binary.length; i += 1) if (binary[i]) relevantRanks.push(i + 1);
  return { firstRank: relevantRanks[0] || Number.POSITIVE_INFINITY, binary };
}

function computeMetrics(rows) {
  const size = Math.max(1, rows.length);
  let hit1 = 0;
  let hit3 = 0;
  let mrr = 0;
  let ndcg = 0;
  for (const item of rows) {
    const rank = item.firstRank;
    if (rank <= 1) hit1 += 1;
    if (rank <= 3) hit3 += 1;
    if (rank <= 10) mrr += 1 / rank;
    let dcg = 0;
    for (let i = 0; i < item.binary.length; i += 1) if (item.binary[i]) dcg += 1 / Math.log2(i + 2);
    const idealCount = item.binary.reduce((a, b) => a + b, 0);
    let idcg = 0;
    for (let i = 0; i < idealCount; i += 1) idcg += 1 / Math.log2(i + 2);
    if (idcg > 0) ndcg += dcg / idcg;
  }
  return { hitAt1: hit1 / size, hitAt3: hit3 / size, mrrAt10: mrr / size, ndcgAt10: ndcg / size };
}

async function loadCache() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed?.vectors || {}));
  } catch {
    return new Map();
  }
}

async function embedTexts(extractor, texts, cache) {
  const out = new Array(texts.length);
  const pending = [];
  for (let i = 0; i < texts.length; i += 1) {
    const key = embeddingKey(texts[i]);
    const cached = cache.get(key);
    if (cached) out[i] = Float32Array.from(cached);
    else pending.push(i);
  }
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const idxs = pending.slice(i, i + BATCH_SIZE);
    const batch = idxs.map((idx) => texts[idx]);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const rows = vectorRowsFromOutput(output, batch.length);
    for (let j = 0; j < rows.length; j += 1) out[idxs[j]] = rows[j];
  }
  return out;
}

async function loadDocs() {
  const fixtureFiles = ['case_a.json', 'case_b.json', 'case_c.json'];
  const docs = [];
  for (const fileName of fixtureFiles) {
    const parsed = JSON.parse(await readFile(path.join(ROOT, 'tests/fixtures/anon', fileName), 'utf8'));
    const chunks = buildSemanticChunks(parsed, fileName);
    for (const chunk of chunks) docs.push({ ...chunk, searchText: buildSearchText(chunk) });
  }
  return docs;
}

async function loadQueries(limit = 295) {
  const evalSet = JSON.parse(await readFile(path.join(ROOT, 'tests/eval/retrieval_eval_set.json'), 'utf8'));
  const testSet = JSON.parse(await readFile(path.join(ROOT, 'tests/eval/retrieval_test_set.json'), 'utf8'));
  return [...evalSet, ...testSet].sort((a, b) => deterministicHash(a.id) - deterministicHash(b.id)).slice(0, limit);
}

const docs = await loadDocs();
const queries = await loadQueries(295);
const lexicalIndex = buildLexicalIndex(docs);
const cache = await loadCache();
const extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'cpu', dtype: 'q4' });

const docInputs = docs.map((doc) => makeEmbeddingDocumentInput(doc));
const docVecs = await embedTexts(extractor, docInputs, cache);
const embeddedDocs = docs.map((doc, i) => ({ ...doc, embedding: docVecs[i] }));

const baselineInputs = queries.map((q) => q.query);
const improvedInfos = queries.map((q) => normalizeMedicalQuery(q.query, lexicalIndex));
const improvedInputs = improvedInfos.map((qi) => makeEmbeddingQueryInput(qi));
const improvedRawInputs = queries.map((q) => q.query);

const [baselineVecs, improvedVecs, improvedRawVecs] = await Promise.all([
  embedTexts(extractor, baselineInputs, cache),
  embedTexts(extractor, improvedInputs, cache),
  embedTexts(extractor, improvedRawInputs, cache),
]);

function run(mode, queryVecs) {
  const rows = [];
  for (let i = 0; i < queries.length; i += 1) {
    const q = queries[i];
    const ranked =
      mode === 'baseline'
        ? rankDocumentsDense({ docs: embeddedDocs, queryVector: queryVecs[i], dotSimilarity })
        : rankDocumentsHybrid({
            docs: embeddedDocs,
            queryVector: queryVecs[i],
            queryInfo: improvedInfos[i],
            lexicalIndex,
            dotSimilarity,
          });
    rows.push({ ...evaluateRanking(ranked, q), intent: q.intent });
  }
  const byIntent = {};
  for (const intent of ['colloquial', 'part', 'summary_natural', 'summary']) {
    byIntent[intent] = computeMetrics(rows.filter((r) => r.intent === intent));
  }
  return { overall: computeMetrics(rows), byIntent };
}

const baseline = run('baseline', baselineVecs);
const improved = run('improved', improvedVecs);
const improvedRaw = run('improvedRaw', improvedRawVecs);
console.log(JSON.stringify({ baseline, improved, improvedRaw }, null, 2));
