import { EMBEDDING_DIM } from "../constants";

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  const matches = lower.match(TOKEN_RE);
  if (!matches) return out;
  for (const token of matches) {
    if (token.length < 2) continue;
    out.push(token);
  }
  return out;
}

function charNgrams(token: string): string[] {
  if (token.length <= 3) return [token];
  const out: string[] = [];
  for (let i = 0; i <= token.length - 3; i += 1) {
    out.push(token.slice(i, i + 3));
  }
  return out;
}

export function embedTextToFloat(text: string, dim = EMBEDDING_DIM): Float32Array {
  const vector = new Float32Array(dim);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const tokenWeight = 1 + Math.min(token.length, 8) * 0.05;
    const grams = charNgrams(token);
    for (const gram of grams) {
      const h = hash32(gram) % dim;
      vector[h] += tokenWeight;
    }
  }

  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) {
    norm += vector[i] * vector[i];
  }

  if (norm <= 1e-12) {
    return vector;
  }

  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= inv;
  }

  return vector;
}

export function quantizeEmbedding(vector: Float32Array): Int8Array {
  const out = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, vector[i]));
    out[i] = Math.round(clamped * 127);
  }
  return out;
}

export function embedTextToInt8(text: string, dim = EMBEDDING_DIM): Int8Array {
  return quantizeEmbedding(embedTextToFloat(text, dim));
}

export function cosineSimilarityInt8(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
}

export function tokenizeForOverlap(text: string): string[] {
  return tokenize(text);
}
