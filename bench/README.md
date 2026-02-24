# OpenMyHealth Embedding Benchmark (Local Only)

This setup benchmarks local browser embeddings using:
- `@huggingface/transformers`
- `idb`

## Run
```bash
pnpm install
pnpm bundle:model
pnpm dev
```
Open the local URL shown by Vite.
The app uses a single bundled model: `onnx-community/embeddinggemma-300m-ONNX` (q4).
Model files are served locally from `public/models/` and remote model loading is disabled.
There is no runtime model selector; all embeddings use this model only.

## How to test with your files
1. Click `Pick Desktop/PHR Folder` and select `/Users/hyun/Desktop/PHR`.
2. Build embeddings from `sample1.json` ~ `sample4.json`.
3. Enter natural-language queries and check retrieval latency/quality.

## Privacy note
- Sample JSON files are loaded from browser file picker at runtime.
- They are not copied into this repository by default.
- `.gitignore` blocks common local PHR paths to avoid accidental commit.
- Run `pnpm check:no-phr` before commit/push to verify no PHR samples are tracked.
