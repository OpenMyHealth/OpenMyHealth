import { pipeline, env } from "@huggingface/transformers";
import { openDB } from "idb";
import "./style.css";
import { buildSemanticChunks } from "./phrFormatter.js";
import {
  buildLexicalIndex,
  buildSearchText,
  makeEmbeddingDocumentInput,
  makeEmbeddingQueryInput,
  normalizeMedicalQuery,
  rankDocumentsHybrid,
} from "./searchPipeline.js";

const DB_NAME = "openmyhealth-embedding-bench";
const DB_VERSION = 2;
const DOC_STORE = "documents";
const META_STORE = "meta";
const EMBED_CACHE_STORE = "embedCache";
const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

const EXPECTED_FILES = ["sample1.json", "sample2.json", "sample3.json", "sample4.json"];
const EMBEDDING_DTYPE = "q4";
const EMBEDDING_MODEL_FILE_ORDER = ["model", "model_no_gather"];
const EMBEDDING_TARGET_DIM = 576;
const EMBED_BATCH_FALLBACK_SIZE = 16;
const EMBED_BATCH_CANDIDATES_BY_DEVICE = {
  webgpu: [12, 16, 24, 32, 48],
  wasm: [8, 12, 16, 24, 32],
  default: [8, 12, 16, 24, 32],
};
const MIN_EMBED_BATCH_SIZE = 4;
const STORE_INT8_EMBEDDINGS = true;
const ENABLE_DOCUMENT_EMBED_CACHE = false;
const ENABLE_QUERY_EMBED_CACHE = false;
const QUERY_EMBED_CACHE_LIMIT = 256;
const MAX_WASM_THREADS = 4;

function resolveWasmThreadCount() {
  const hasThreadIsolation = typeof crossOriginIsolated === "boolean" && crossOriginIsolated;
  const hwThreads = Number(navigator.hardwareConcurrency || 1);
  if (!hasThreadIsolation) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_WASM_THREADS, hwThreads));
}

env.useBrowserCache = true;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/models/";
if (env.backends?.onnx?.wasm) {
  // Keep WASM backend compatible across regular browser contexts (no SAB requirement).
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = resolveWasmThreadCount();
  env.backends.onnx.wasm.simd = true;
}

const state = {
  selectedFiles: [],
  extractor: null,
  extractorModel: "",
  lastDevice: "unknown",
  lastDtype: "unknown",
  lastModelFile: "unknown",
  tunedBatchSize: null,
  docsCache: null,
  lexicalIndex: null,
  queryEmbeddingCache: new Map(),
};

const el = {
  pickPhrFolderButton: document.getElementById("pickPhrFolderButton"),
  fileInput: document.getElementById("fileInput"),
  selectedFiles: document.getElementById("selectedFiles"),
  buildButton: document.getElementById("buildButton"),
  clearButton: document.getElementById("clearButton"),
  buildStats: document.getElementById("buildStats"),
  queryInput: document.getElementById("queryInput"),
  topKInput: document.getElementById("topKInput"),
  queryButton: document.getElementById("queryButton"),
  queryStats: document.getElementById("queryStats"),
  results: document.getElementById("results"),
  log: document.getElementById("log"),
};

function log(message) {
  const now = new Date().toISOString();
  el.log.textContent = `[${now}] ${message}\n${el.log.textContent}`.slice(0, 10000);
}

function errorMessage(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function setBusy(isBusy) {
  el.pickPhrFolderButton.disabled = isBusy;
  el.fileInput.disabled = isBusy;
  el.buildButton.disabled = isBusy;
  el.clearButton.disabled = isBusy;
  el.queryButton.disabled = isBusy;
}

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const docs = db.createObjectStore(DOC_STORE, { keyPath: "id" });
        docs.createIndex("byFile", "fileName");
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(EMBED_CACHE_STORE)) {
        db.createObjectStore(EMBED_CACHE_STORE, { keyPath: "key" });
      }
    },
  });
}

async function loadExtractor(modelId) {
  if (state.extractor && state.extractorModel === modelId) {
    return state.extractor;
  }

  const t0 = performance.now();
  state.extractor = null;
  state.tunedBatchSize = null;

  let canUseWebGpu = false;
  if (navigator.gpu && typeof navigator.gpu.requestAdapter === "function") {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      canUseWebGpu = Boolean(adapter);
    } catch {
      canUseWebGpu = false;
    }
  }

  const deviceOrder = canUseWebGpu ? ["webgpu", "wasm", "default"] : ["wasm", "default"];
  let lastError = null;

  for (const device of deviceOrder) {
    for (const modelFile of EMBEDDING_MODEL_FILE_ORDER) {
      try {
        if (device === "default") {
          state.extractor = await pipeline("feature-extraction", modelId, {
            dtype: EMBEDDING_DTYPE,
            model_file_name: modelFile,
          });
        } else {
          state.extractor = await pipeline("feature-extraction", modelId, {
            device,
            dtype: EMBEDDING_DTYPE,
            model_file_name: modelFile,
          });
        }
        state.lastDevice = device;
        state.lastDtype = EMBEDDING_DTYPE;
        state.lastModelFile = modelFile;
        break;
      } catch (error) {
        lastError = error;
        log(
          `Model load with device=${device}, dtype=${EMBEDDING_DTYPE}, model=${modelFile} failed: ${errorMessage(error)}`,
        );
      }
    }
    if (state.extractor) {
      break;
    }
  }

  if (!state.extractor) {
    const detail = lastError ? errorMessage(lastError) : "unknown backend error";
    throw new Error(
      `Model load failed with dtype=${EMBEDDING_DTYPE} on all backends. ${detail}. Run 'pnpm bundle:model' and retry.`,
    );
  }

  state.extractorModel = modelId;
  const elapsed = performance.now() - t0;
  log(
    `Model ready: ${modelId} (${state.lastDevice}, dtype=${state.lastDtype}, model=${state.lastModelFile}) in ${elapsed.toFixed(1)} ms`,
  );
  if (state.lastDevice === "wasm" && env.backends?.onnx?.wasm) {
    log(`WASM runtime: threads=${env.backends.onnx.wasm.numThreads}, simd=${String(env.backends.onnx.wasm.simd)}`);
  }
  if (state.lastDevice !== "webgpu") {
    log(
      `Performance notice: active backend is ${state.lastDevice}. For large speedup, keep Chrome WebGPU enabled.`,
    );
  }
  return state.extractor;
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

function projectEmbedding(vector, dim = EMBEDDING_TARGET_DIM) {
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

async function embedBatch(texts) {
  const output = await state.extractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  return vectorRowsFromOutput(output, texts.length).map((vector) => projectEmbedding(vector));
}

async function embedText(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

function makeBatchTuneStorageKey() {
  return `omh.embedBatch.${MODEL_ID}.${state.lastDevice}.${state.lastDtype}.${state.lastModelFile}`;
}

function getActiveBatchCandidates() {
  const base = EMBED_BATCH_CANDIDATES_BY_DEVICE[state.lastDevice] || EMBED_BATCH_CANDIDATES_BY_DEVICE.default;
  const filtered = base.filter((size) => size >= MIN_EMBED_BATCH_SIZE);
  const uniqueSorted = [...new Set(filtered)].sort((a, b) => a - b);
  return uniqueSorted;
}

function getStoredBatchSize() {
  try {
    const raw = localStorage.getItem(makeBatchTuneStorageKey());
    const parsed = Number(raw);
    const candidates = getActiveBatchCandidates();
    if (candidates.includes(parsed)) {
      return parsed;
    }
  } catch {
    // no-op
  }
  return null;
}

function storeBatchSize(batchSize) {
  try {
    localStorage.setItem(makeBatchTuneStorageKey(), String(batchSize));
  } catch {
    // no-op
  }
}

function buildBatchTuneText(chars = 1000) {
  const seed =
    "task: search result | query: medical record timeline diagnosis medication prescription symptom followup ";
  let text = seed;
  while (text.length < chars) {
    text += seed;
  }
  return text.slice(0, chars);
}

async function tuneEmbeddingBatchSize() {
  if (!state.extractor) {
    return EMBED_BATCH_FALLBACK_SIZE;
  }
  const candidates = getActiveBatchCandidates();
  if (state.tunedBatchSize && candidates.includes(state.tunedBatchSize)) {
    return state.tunedBatchSize;
  }

  const stored = getStoredBatchSize();
  if (stored) {
    state.tunedBatchSize = stored;
    return stored;
  }

  const tuneText = buildBatchTuneText();
  const rows = [];

  for (const batchSize of candidates) {
    const batch = Array.from({ length: batchSize }, (_, i) => `${tuneText}${i}`);
    try {
      // Warmup
      await state.extractor(batch, {
        pooling: "mean",
        normalize: true,
      });
      const elapsedRuns = [];
      for (let run = 0; run < 2; run += 1) {
        const t0 = performance.now();
        await state.extractor(batch, {
          pooling: "mean",
          normalize: true,
        });
        elapsedRuns.push(performance.now() - t0);
      }
      const elapsed = elapsedRuns.reduce((acc, value) => acc + value, 0) / elapsedRuns.length;
      rows.push({
        batchSize,
        msPerChunk: elapsed / batchSize,
      });
    } catch (error) {
      log(`Batch tune failed for size=${batchSize}: ${errorMessage(error)}`);
    }
  }

  if (!rows.length) {
    const fallback = candidates[0] || EMBED_BATCH_FALLBACK_SIZE;
    state.tunedBatchSize = fallback;
    return fallback;
  }

  rows.sort((a, b) => a.msPerChunk - b.msPerChunk);
  const best = rows[0];
  state.tunedBatchSize = best.batchSize;
  storeBatchSize(best.batchSize);
  log(
    `Batch tune selected size=${best.batchSize} (${best.msPerChunk.toFixed(2)} ms/chunk, device=${state.lastDevice}, model=${state.lastModelFile}).`,
  );
  return best.batchSize;
}

function getCachedQueryEmbedding(key) {
  if (!ENABLE_QUERY_EMBED_CACHE) {
    return null;
  }
  if (!state.queryEmbeddingCache.has(key)) {
    return null;
  }
  const value = state.queryEmbeddingCache.get(key);
  state.queryEmbeddingCache.delete(key);
  state.queryEmbeddingCache.set(key, value);
  return value;
}

function setCachedQueryEmbedding(key, vector) {
  if (!ENABLE_QUERY_EMBED_CACHE) {
    return;
  }
  if (state.queryEmbeddingCache.has(key)) {
    state.queryEmbeddingCache.delete(key);
  }
  state.queryEmbeddingCache.set(key, vector);
  while (state.queryEmbeddingCache.size > QUERY_EMBED_CACHE_LIMIT) {
    const oldestKey = state.queryEmbeddingCache.keys().next().value;
    state.queryEmbeddingCache.delete(oldestKey);
  }
}

function deterministicHash(input) {
  let hash = 0;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function makeEmbeddingCacheKey(text, modelFileName = state.lastModelFile || EMBEDDING_MODEL_FILE_ORDER[0]) {
  const normalizedText = String(text || "");
  return `${MODEL_ID}|${EMBEDDING_DTYPE}|${modelFileName}|dim=${EMBEDDING_TARGET_DIM || 0}|${deterministicHash(normalizedText)}|${normalizedText.length}`;
}

function quantizeEmbeddingInt8(vector) {
  const encoded = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, vector[i]));
    encoded[i] = Math.round(clamped * 127);
  }
  return encoded;
}

function dotSimilarity(vecA, vecB) {
  const len = Math.min(vecA.length, vecB.length);
  const isInt8 = vecB instanceof Int8Array;
  const scale = isInt8 ? 1 / 127 : 1;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += vecA[i] * (isInt8 ? vecB[i] * scale : vecB[i]);
  }
  return sum;
}

function renderSelectedFiles() {
  if (!state.selectedFiles.length) {
    el.selectedFiles.textContent = "No files selected.";
    return;
  }
  const list = state.selectedFiles.map((file) => file.name).join(", ");
  el.selectedFiles.textContent = `Selected ${state.selectedFiles.length} file(s): ${list}`;
}

async function pickPhrFolder() {
  if (!window.showDirectoryPicker) {
    log("showDirectoryPicker API not available. Use file input fallback.");
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: "read",
      startIn: "desktop",
    });

    const found = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== "file" || !name.toLowerCase().endsWith(".json")) {
        continue;
      }
      const file = await handle.getFile();
      found.push(file);
    }

    if (!found.length) {
      log("No JSON files found in selected folder.");
      return;
    }

    found.sort((a, b) => a.name.localeCompare(b.name));
    const prioritized = [];
    for (const target of EXPECTED_FILES) {
      const file = found.find((item) => item.name === target);
      if (file) {
        prioritized.push(file);
      }
    }

    const finalFiles = prioritized.length ? prioritized : found;
    state.selectedFiles = finalFiles;
    renderSelectedFiles();
    log(`Folder selected. Using ${finalFiles.length} JSON file(s).`);
  } catch (error) {
    log(`Folder pick canceled or failed: ${String(error)}`);
  }
}

async function buildKnowledgeBase() {
  if (!state.selectedFiles.length) {
    log("Select JSON files first.");
    return;
  }

  setBusy(true);
  el.results.innerHTML = "";

  try {
    const modelId = MODEL_ID;
    await loadExtractor(modelId);

    const db = await getDb();
    await db.clear(DOC_STORE);

    let allChunks = [];
    for (const file of state.selectedFiles) {
      const tFileStart = performance.now();
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const semanticChunks = buildSemanticChunks(parsed, file.name);
      const chunks = semanticChunks.map((chunk) => {
        const searchText = buildSearchText(chunk);
        return {
          ...chunk,
          searchText,
          embeddingInput: makeEmbeddingDocumentInput({
            ...chunk,
            searchText,
          }),
        };
      });
      const tFileEnd = performance.now();

      allChunks = allChunks.concat(chunks);
      log(`${file.name}: ${chunks.length} semantic docs generated in ${(tFileEnd - tFileStart).toFixed(1)} ms`);
    }

    if (!allChunks.length) {
      log("No chunks generated. Check JSON structure.");
      return;
    }

    const tEmbedStart = performance.now();
    const records = [];
    let batchSize = await tuneEmbeddingBatchSize();
    let processed = 0;
    let cacheHitCount = 0;
    let cacheMissCount = 0;
    const expectedFormat = STORE_INT8_EMBEDDINGS ? "int8_n127" : "float32";
    const shouldReadEmbedCache = ENABLE_DOCUMENT_EMBED_CACHE && (await db.count(EMBED_CACHE_STORE)) > 0;
    if (!ENABLE_DOCUMENT_EMBED_CACHE) {
      log("Embedding cache disabled; recomputing all document embeddings.");
    } else if (!shouldReadEmbedCache) {
      log("Embed cache is empty; skipping cache read lookups for this build.");
    }

    while (processed < allChunks.length) {
      const end = Math.min(processed + batchSize, allChunks.length);
      const batch = allChunks.slice(processed, end);
      try {
        const cacheKeys = ENABLE_DOCUMENT_EMBED_CACHE
          ? batch.map((chunk) => makeEmbeddingCacheKey(chunk.embeddingInput))
          : [];
        const cachedEmbeddings = new Array(batch.length).fill(null);
        const missingInputs = [];

        if (shouldReadEmbedCache) {
          const cacheTx = db.transaction([EMBED_CACHE_STORE], "readonly");
          const cachedRows = await Promise.all(cacheKeys.map((cacheKey) => cacheTx.store.get(cacheKey)));
          await cacheTx.done;

          for (let i = 0; i < batch.length; i += 1) {
            const row = cachedRows[i];
            const input = batch[i].embeddingInput;
            const validRow =
              row &&
              row.modelId === modelId &&
              row.dtype === EMBEDDING_DTYPE &&
              row.modelFileName === state.lastModelFile &&
              row.embeddingFormat === expectedFormat &&
              row.input === input &&
              row.embedding;

            if (validRow) {
              if (row.embedding instanceof Int8Array || row.embedding instanceof Float32Array) {
                cachedEmbeddings[i] = row.embedding;
              } else if (Array.isArray(row.embedding)) {
                cachedEmbeddings[i] =
                  expectedFormat === "int8_n127" ? Int8Array.from(row.embedding) : Float32Array.from(row.embedding);
              }
            }

            if (cachedEmbeddings[i]) {
              cacheHitCount += 1;
            } else {
              cacheMissCount += 1;
              missingInputs.push(input);
            }
          }
        } else {
          for (let i = 0; i < batch.length; i += 1) {
            cacheMissCount += 1;
            missingInputs.push(batch[i].embeddingInput);
          }
        }

        let embeddedMissing = [];
        if (missingInputs.length) {
          embeddedMissing = await embedBatch(missingInputs);
        }

        const cacheWriteRows = ENABLE_DOCUMENT_EMBED_CACHE ? [] : null;
        let missCursor = 0;
        for (let i = 0; i < batch.length; i += 1) {
          const chunk = batch[i];
          let embedding = cachedEmbeddings[i];
          let dim = embedding?.length || 0;

          if (!embedding) {
            const vector = embeddedMissing[missCursor++];
            dim = vector.length;
            embedding = STORE_INT8_EMBEDDINGS ? quantizeEmbeddingInt8(vector) : vector;
            if (ENABLE_DOCUMENT_EMBED_CACHE) {
              cacheWriteRows.push({
                key: cacheKeys[i],
                modelId,
                dtype: EMBEDDING_DTYPE,
                modelFileName: state.lastModelFile,
                embeddingFormat: expectedFormat,
                input: chunk.embeddingInput,
                embedding,
                dim,
                updatedAt: new Date().toISOString(),
              });
            }
          }

          const { embeddingInput, ...chunkRecord } = chunk;
          records.push({
            ...chunkRecord,
            embedding,
            dim,
            embeddingFormat: expectedFormat,
          });
        }

        if (ENABLE_DOCUMENT_EMBED_CACHE && cacheWriteRows.length) {
          const cacheWriteTx = db.transaction([EMBED_CACHE_STORE], "readwrite");
          for (const row of cacheWriteRows) {
            cacheWriteTx.store.put(row);
          }
          await cacheWriteTx.done;
        }

        processed = end;
      } catch (error) {
        if (batchSize > MIN_EMBED_BATCH_SIZE) {
          const nextSize = Math.max(MIN_EMBED_BATCH_SIZE, Math.floor(batchSize / 2));
          if (nextSize < batchSize) {
            log(
              `Embed batch failed at size=${batchSize} (${errorMessage(error)}). Retrying with size=${nextSize}.`,
            );
            batchSize = nextSize;
            continue;
          }
        }
        throw error;
      }

      if (processed % 5 === 0 || processed === allChunks.length) {
        const cacheStats = ENABLE_DOCUMENT_EMBED_CACHE
          ? ` (cache hit ${cacheHitCount}, miss ${cacheMissCount})`
          : "";
        log(`Embedded ${processed}/${allChunks.length} chunks...${cacheStats}`);
      }
    }

    const tEmbedEnd = performance.now();
    const tWriteStart = performance.now();
    const tx = db.transaction([DOC_STORE], "readwrite");
    for (const record of records) {
      tx.store.put(record);
    }
    await tx.done;
    const tWriteEnd = performance.now();

    const embedMs = tEmbedEnd - tEmbedStart;
    const writeMs = tWriteEnd - tWriteStart;
    const totalMs = tWriteEnd - tEmbedStart;
    const docsPerSec = allChunks.length / (totalMs / 1000);

    await db.put(META_STORE, {
      key: "lastBuild",
      modelId,
      device: state.lastDevice,
      dtype: state.lastDtype,
      modelFileName: state.lastModelFile,
      embedBatchSize: batchSize,
      embeddingFormat: expectedFormat,
      chunks: allChunks.length,
      elapsedMs: totalMs,
      embedMs,
      writeMs,
      embedCacheEnabled: ENABLE_DOCUMENT_EMBED_CACHE,
      embedCacheHits: ENABLE_DOCUMENT_EMBED_CACHE ? cacheHitCount : 0,
      embedCacheMisses: ENABLE_DOCUMENT_EMBED_CACHE ? cacheMissCount : 0,
      builtAt: new Date().toISOString(),
    });

    state.docsCache = records;
    state.lexicalIndex = buildLexicalIndex(records);
    state.queryEmbeddingCache.clear();

    el.buildStats.textContent = [
      `model: ${modelId}`,
      `device: ${state.lastDevice}`,
      `dtype: ${state.lastDtype}`,
      `model file: ${state.lastModelFile}`,
      `embed dim: ${EMBEDDING_TARGET_DIM || "full"}`,
      `embed batch size: ${batchSize}`,
      `embedding format: ${expectedFormat}`,
      ENABLE_DOCUMENT_EMBED_CACHE
        ? `embedding cache: hit ${cacheHitCount} / miss ${cacheMissCount}`
        : "embedding cache: disabled",
      `files: ${state.selectedFiles.length}`,
      `chunks: ${allChunks.length}`,
      `embedding elapsed: ${embedMs.toFixed(1)} ms`,
      `db write elapsed: ${writeMs.toFixed(1)} ms`,
      `total elapsed: ${totalMs.toFixed(1)} ms`,
      `throughput: ${docsPerSec.toFixed(2)} chunks/sec`,
      `avg per chunk: ${(totalMs / allChunks.length).toFixed(1)} ms`,
    ].join("\n");

    log("Knowledge base build completed.");
  } catch (error) {
    const message = errorMessage(error);
    el.buildStats.textContent = `Build failed.\n${message}`;
    log(`Build failed: ${message}`);
  } finally {
    setBusy(false);
  }
}

async function clearDb() {
  setBusy(true);
  try {
    const db = await getDb();
    await db.clear(DOC_STORE);
    await db.clear(META_STORE);
    if (db.objectStoreNames.contains(EMBED_CACHE_STORE)) {
      await db.clear(EMBED_CACHE_STORE);
    }
    el.buildStats.textContent = "DB cleared.";
    el.queryStats.textContent = "No query yet.";
    el.results.innerHTML = "";
    state.docsCache = null;
    state.lexicalIndex = null;
    state.queryEmbeddingCache.clear();
    log("IndexedDB cleared.");
  } catch (error) {
    log(`Clear failed: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function runQuery() {
  const query = el.queryInput.value.trim();
  if (!query) {
    log("Enter a query first.");
    return;
  }

  setBusy(true);

  try {
    const db = await getDb();
    const loaded = state.docsCache || (await db.getAll(DOC_STORE));
    const docs = loaded.map((doc) =>
      doc.searchText
        ? doc
        : {
            ...doc,
            searchText: buildSearchText(doc),
          },
    );
    state.docsCache = docs;
    if (!state.lexicalIndex) {
      state.lexicalIndex = buildLexicalIndex(docs);
    }
    if (!docs.length) {
      log("No documents in DB. Build embeddings first.");
      return;
    }

    const modelId = MODEL_ID;
    await loadExtractor(modelId);

    const tQueryStart = performance.now();
    const queryInfo = normalizeMedicalQuery(query, state.lexicalIndex);
    const queryEmbeddingInput = makeEmbeddingQueryInput(queryInfo);
    const cachedQueryVec = ENABLE_QUERY_EMBED_CACHE ? getCachedQueryEmbedding(queryEmbeddingInput) : null;
    const queryVec = cachedQueryVec || (await embedText(queryEmbeddingInput));
    if (ENABLE_QUERY_EMBED_CACHE && !cachedQueryVec) {
      setCachedQueryEmbedding(queryEmbeddingInput, queryVec);
    }

    const scored = rankDocumentsHybrid({
      docs,
      queryVector: queryVec,
      queryInfo,
      lexicalIndex: state.lexicalIndex,
      dotSimilarity,
    });

    const topK = Math.max(1, Math.min(20, Number(el.topKInput.value) || 5));
    const top = scored.slice(0, topK);
    const tQueryEnd = performance.now();

    el.results.innerHTML = top
      .map(
        (item) => `
          <article class="result">
            <div class="meta">section=${item.section || "unknown"} | month=${item.month || "unknown"} | score=${item.score.toFixed(4)} | dense=${(item.denseScore ?? item.score).toFixed(4)} | lexical=${(item.lexicalScore ?? 0).toFixed(4)} | file=${item.fileName} | chunk=${item.chunkIndex}</div>
            <div class="text">${item.text.replace(/</g, "&lt;")}</div>
          </article>
        `,
      )
      .join("");

    el.queryStats.textContent = [
      `query: ${query}`,
      queryInfo.rewriteApplied ? `normalized: ${queryInfo.normalizedQuery}` : "",
      `model: ${modelId}`,
      `dtype: ${state.lastDtype}`,
      `model file: ${state.lastModelFile}`,
      `embed dim: ${EMBEDDING_TARGET_DIM || "full"}`,
      ENABLE_QUERY_EMBED_CACHE ? `query cache: ${cachedQueryVec ? "hit" : "miss"}` : "query cache: disabled",
      `docs scanned: ${docs.length}`,
      `topK: ${topK}`,
      `elapsed: ${(tQueryEnd - tQueryStart).toFixed(1)} ms`,
    ]
      .filter(Boolean)
      .join("\n");

    log(`Query completed in ${(tQueryEnd - tQueryStart).toFixed(1)} ms.`);
  } catch (error) {
    const message = errorMessage(error);
    el.queryStats.textContent = `Query failed.\n${message}`;
    log(`Query failed: ${message}`);
  } finally {
    setBusy(false);
  }
}

function handleFileInputChange() {
  const files = Array.from(el.fileInput.files || []).filter((file) =>
    file.name.toLowerCase().endsWith(".json"),
  );
  state.selectedFiles = files;
  renderSelectedFiles();
  if (files.length) {
    log(`File input selected ${files.length} JSON file(s).`);
  }
}

el.pickPhrFolderButton.addEventListener("click", pickPhrFolder);
el.fileInput.addEventListener("change", handleFileInputChange);
el.buildButton.addEventListener("click", buildKnowledgeBase);
el.clearButton.addEventListener("click", clearDb);
el.queryButton.addEventListener("click", runQuery);

log("Ready. Pick Desktop/PHR folder or choose files manually. Using bundled EmbeddingGemma q4 model.");
