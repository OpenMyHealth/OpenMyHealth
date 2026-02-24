import path from "node:path";
import { performance } from "node:perf_hooks";
import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
const MODEL_ROOT = `${path.resolve(process.cwd(), "public/models")}${path.sep}`;
const DTYPE = "q4";
const DEVICE = process.env.BENCH_DEVICE || "cpu";
const MODEL_VARIANTS = [
  { key: "model", label: "model_q4", modelFileName: "model" },
  { key: "model_no_gather", label: "model_no_gather_q4", modelFileName: "model_no_gather" },
];

const CHUNK_CHAR_CANDIDATES = [800, 1100, 1400];
const BATCH_CANDIDATES = [1, 4, 8, 12];
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 2;

function parseVariantArg() {
  const idx = process.argv.indexOf("--variant");
  if (idx === -1 || !process.argv[idx + 1]) {
    return "all";
  }
  return String(process.argv[idx + 1]).trim();
}

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODEL_ROOT;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}

function makeChunkText(chars, seed) {
  const prefix = "task: search result | query: ";
  const body =
    "patient timeline medication lab result diagnosis symptom progress note follow up recommendation ";
  let text = `${prefix}${seed} `;
  while (text.length < chars) {
    text += body;
  }
  return text.slice(0, chars);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, cur) => acc + cur, 0);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return { avg, p50, p90 };
}

async function runSingleVariant(variant) {
  console.log(`[bench] localModelPath=${MODEL_ROOT}`);
  console.log(
    `[bench] loading model=${MODEL_ID} variant=${variant.label} dtype=${DTYPE} device=${DEVICE}`,
  );
  const t0 = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    device: DEVICE,
    dtype: DTYPE,
    model_file_name: variant.modelFileName,
  });
  console.log(
    `[bench] model ready (${variant.label}) in ${(performance.now() - t0).toFixed(1)} ms`,
  );
  console.log("");

  const rows = [];

  for (const chars of CHUNK_CHAR_CANDIDATES) {
    for (const batchSize of BATCH_CANDIDATES) {
      console.log(`[bench] running chars=${chars} batch=${batchSize}`);
      const times = [];
      let failed = null;

      for (let run = 0; run < WARMUP_RUNS + MEASURE_RUNS; run += 1) {
        const texts = Array.from({ length: batchSize }, (_, i) =>
          makeChunkText(chars, `c${chars}-b${batchSize}-r${run}-i${i}`),
        );
        const start = performance.now();
        try {
          await extractor(texts, {
            pooling: "mean",
            normalize: true,
          });
        } catch (error) {
          failed = error instanceof Error ? error.message : String(error);
          break;
        }
        const elapsed = performance.now() - start;
        if (run >= WARMUP_RUNS) {
          times.push(elapsed);
        }
      }

      if (failed) {
        rows.push({
          chars,
          batchSize,
          variant: variant.label,
          status: "failed",
          reason: failed,
        });
        continue;
      }

      const s = stats(times);
      const avgBatchMs = s.avg;
      const msPerChunk = avgBatchMs / batchSize;
      const chunksPerSec = 1000 / msPerChunk;
      rows.push({
        chars,
        batchSize,
        variant: variant.label,
        status: "ok",
        avgBatchMs,
        p50BatchMs: s.p50,
        p90BatchMs: s.p90,
        msPerChunk,
        chunksPerSec,
      });
      console.log(
        `[bench] done chars=${chars} batch=${batchSize} ms/chunk=${msPerChunk.toFixed(2)} chunks/s=${chunksPerSec.toFixed(2)}`,
      );
    }
  }

  const okRows = rows.filter((x) => x.status === "ok");
  okRows.sort((a, b) => a.msPerChunk - b.msPerChunk);

  console.log("[bench] top 10 by ms/chunk");
  for (const row of okRows.slice(0, 10)) {
    console.log(
      `chars=${row.chars} batch=${row.batchSize} ms/chunk=${row.msPerChunk.toFixed(2)} chunks/s=${row.chunksPerSec.toFixed(2)} batch(ms) avg=${row.avgBatchMs.toFixed(2)} p50=${row.p50BatchMs.toFixed(2)} p90=${row.p90BatchMs.toFixed(2)}`,
    );
  }

  const failedRows = rows.filter((x) => x.status === "failed");
  if (failedRows.length) {
    console.log("");
    console.log("[bench] failed configs");
    for (const row of failedRows) {
      console.log(`chars=${row.chars} batch=${row.batchSize} failed=${row.reason}`);
    }
  }
}

async function runBenchmark() {
  const variantArg = parseVariantArg();
  const variants =
    variantArg === "all"
      ? MODEL_VARIANTS
      : MODEL_VARIANTS.filter((variant) => variant.key === variantArg);

  if (!variants.length) {
    throw new Error(`Unknown --variant '${variantArg}'. Use one of: all, model, model_no_gather`);
  }

  for (const variant of variants) {
    try {
      await runSingleVariant(variant);
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[bench] variant=${variant.label} failed: ${message}`);
      console.log("");
    }
  }
}

runBenchmark()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
