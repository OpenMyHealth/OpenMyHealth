import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { env, pipeline } from "@huggingface/transformers";
import { buildSemanticChunks } from "../src/phrFormatter.js";
import { buildSearchText, makeEmbeddingDocumentInput } from "../src/searchPipeline.js";

const ROOT = process.cwd();
const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
const MODEL_FILE_NAME = "model";
const DTYPE = "q4";
const DEVICE = process.env.BENCH_DEVICE || "cpu";
const MODEL_ROOT = `${path.resolve(ROOT, "public/models")}${path.sep}`;
const FIXTURE_FILES = ["case_a.json", "case_b.json", "case_c.json"];
const BATCH_CANDIDATES = [1, 4, 8, 12];
const WARMUP_RUNS = 0;
const MEASURE_RUNS = 1;
const DEFAULT_SAMPLE_COUNT = 480;

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODEL_ROOT;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}

function parseArgs(argv) {
  const options = {
    sampleCount: DEFAULT_SAMPLE_COUNT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sample-count" && argv[i + 1]) {
      options.sampleCount = Math.max(60, Number(argv[++i]) || DEFAULT_SAMPLE_COUNT);
    }
  }
  return options;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((acc, value) => acc + value, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return { avg, p50, p90 };
}

function quantizeEmbeddingInt8(vector) {
  const encoded = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, vector[i]));
    encoded[i] = Math.round(clamped * 127);
  }
  return encoded;
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

async function loadEmbeddingInputs(sampleCount) {
  const docs = [];
  for (const fileName of FIXTURE_FILES) {
    const raw = await readFile(path.resolve(ROOT, "tests/fixtures/anon", fileName), "utf8");
    const parsed = JSON.parse(raw);
    const chunks = buildSemanticChunks(parsed, fileName);
    for (const chunk of chunks) {
      const searchText = buildSearchText(chunk);
      docs.push({
        ...chunk,
        embeddingInput: makeEmbeddingDocumentInput({
          ...chunk,
          searchText,
        }),
      });
    }
  }
  return docs.slice(0, sampleCount).map((doc) => doc.embeddingInput);
}

async function benchmarkBatch(extractor, inputs, batchSize) {
  const embeddingTimes = [];
  const quantizeTimes = [];
  let processed = 0;

  for (let run = 0; run < WARMUP_RUNS + MEASURE_RUNS; run += 1) {
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);

      const embedStart = performance.now();
      const output = await extractor(batch, {
        pooling: "mean",
        normalize: true,
      });
      const rows = vectorRowsFromOutput(output, batch.length);
      const embedElapsed = performance.now() - embedStart;

      const quantStart = performance.now();
      for (const row of rows) {
        quantizeEmbeddingInt8(row);
      }
      const quantElapsed = performance.now() - quantStart;

      if (run >= WARMUP_RUNS) {
        embeddingTimes.push(embedElapsed / batch.length);
        quantizeTimes.push(quantElapsed / batch.length);
        processed += batch.length;
      }
    }
  }

  const embedStat = stats(embeddingTimes);
  const quantStat = stats(quantizeTimes);
  return {
    batchSize,
    processed,
    embedAvgMsPerChunk: embedStat.avg,
    embedP50MsPerChunk: embedStat.p50,
    embedP90MsPerChunk: embedStat.p90,
    quantAvgMsPerChunk: quantStat.avg,
    totalAvgMsPerChunk: embedStat.avg + quantStat.avg,
    chunksPerSec: 1000 / Math.max(1e-9, embedStat.avg + quantStat.avg),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const inputs = await loadEmbeddingInputs(options.sampleCount);
  if (!inputs.length) {
    throw new Error("No embedding inputs found.");
  }

  console.log(`[bench-real] model=${MODEL_ID} modelFile=${MODEL_FILE_NAME} dtype=${DTYPE} device=${DEVICE}`);
  console.log(`[bench-real] localModelPath=${MODEL_ROOT}`);
  console.log(`[bench-real] sampleCount=${inputs.length}`);

  const modelStart = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    device: DEVICE,
    dtype: DTYPE,
    model_file_name: MODEL_FILE_NAME,
  });
  const modelElapsed = performance.now() - modelStart;
  console.log(`[bench-real] modelReadyMs=${modelElapsed.toFixed(1)}`);

  const results = [];
  for (const batchSize of BATCH_CANDIDATES) {
    const row = await benchmarkBatch(extractor, inputs, batchSize);
    results.push(row);
    console.log(
      `[bench-real] batch=${batchSize} totalAvgMs/chunk=${row.totalAvgMsPerChunk.toFixed(2)} embedP50=${row.embedP50MsPerChunk.toFixed(2)} chunks/s=${row.chunksPerSec.toFixed(2)}`,
    );
  }

  results.sort((a, b) => a.totalAvgMsPerChunk - b.totalAvgMsPerChunk);
  const best = results[0];
  console.log("");
  console.log("[bench-real] summary");
  for (const row of results) {
    console.log(
      `batch=${row.batchSize} totalAvgMs/chunk=${row.totalAvgMsPerChunk.toFixed(2)} embedAvg=${row.embedAvgMsPerChunk.toFixed(2)} quantAvg=${row.quantAvgMsPerChunk.toFixed(2)} chunks/s=${row.chunksPerSec.toFixed(2)}`,
    );
  }
  console.log(
    `[bench-real] recommended batch=${best.batchSize} (totalAvgMs/chunk=${best.totalAvgMsPerChunk.toFixed(2)}, chunks/s=${best.chunksPerSec.toFixed(2)})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
