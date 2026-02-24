#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_ID="onnx-community/embeddinggemma-300m-ONNX"
TARGET_DIR="$ROOT_DIR/public/models/$MODEL_ID"
BASE_URL="https://huggingface.co/$MODEL_ID/resolve/main"

FILES=(
  "config.json"
  "tokenizer.json"
  "tokenizer.model"
  "tokenizer_config.json"
  "special_tokens_map.json"
  "added_tokens.json"
  "onnx/model_q4.onnx"
  "onnx/model_q4.onnx_data"
  "onnx/model_no_gather_q4.onnx"
  "onnx/model_no_gather_q4.onnx_data"
)

echo "[bundle:model] target: $TARGET_DIR"
mkdir -p "$TARGET_DIR/onnx"

for file in "${FILES[@]}"; do
  url="$BASE_URL/$file?download=true"
  out="$TARGET_DIR/$file"
  mkdir -p "$(dirname "$out")"

  if [[ -s "$out" ]]; then
    echo "[bundle:model] skip existing: $file"
    continue
  fi

  echo "[bundle:model] downloading: $file"
  curl -fL --retry 3 --retry-delay 2 "$url" -o "$out"
done

echo "[bundle:model] completed"
