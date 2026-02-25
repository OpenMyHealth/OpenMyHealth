import type { NormalizedRecord, SearchCandidate } from "../types";
import { recencyBoost } from "../utils/date";
import { cosineSimilarityInt8, embedTextToInt8, tokenizeForOverlap } from "./embed";

function buildSearchText(record: NormalizedRecord): string {
  const tags = record.tags.join(" ");
  return `${record.title} ${record.summary} ${tags}`.trim();
}

function lexicalOverlapScore(queryTokens: string[], docTokens: string[]): number {
  if (!queryTokens.length || !docTokens.length) return 0;

  const qSet = new Set(queryTokens);
  const dSet = new Set(docTokens);

  let matched = 0;
  for (const token of qSet) {
    if (dSet.has(token)) {
      matched += 1;
    }
  }

  const coverage = matched / qSet.size;
  const precision = matched / dSet.size;
  return (coverage * 0.75) + (precision * 0.25);
}

function stableSortByScore(candidates: SearchCandidate[]): SearchCandidate[] {
  return candidates
    .map((candidate, idx) => ({ idx, candidate }))
    .sort((a, b) => {
      if (b.candidate.score !== a.candidate.score) {
        return b.candidate.score - a.candidate.score;
      }
      return a.idx - b.idx;
    })
    .map(({ candidate }) => candidate);
}

export function ensureRecordEmbedding(record: NormalizedRecord): NormalizedRecord {
  if (record.embedding && record.embedding.length > 0) {
    return record;
  }

  return {
    ...record,
    embedding: embedTextToInt8(buildSearchText(record)),
  };
}

export function searchRecords(query: string, records: NormalizedRecord[], limit = 12): SearchCandidate[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const queryEmbedding = embedTextToInt8(normalizedQuery);
  const queryTokens = tokenizeForOverlap(normalizedQuery);

  const scored: SearchCandidate[] = [];
  for (const base of records) {
    const record = ensureRecordEmbedding(base);
    if (!record.embedding) continue;

    const dense = cosineSimilarityInt8(queryEmbedding, record.embedding);
    const docTokens = tokenizeForOverlap(buildSearchText(record));
    const lexical = lexicalOverlapScore(queryTokens, docTokens);
    const recent = recencyBoost(record.date);

    const score = (dense * 0.68) + (lexical * 0.22) + (recent * 0.1);

    scored.push({
      id: record.id,
      score,
      lexicalScore: lexical,
      denseScore: dense,
      recencyBoost: recent,
      title: record.title,
      summary: record.summary,
      date: record.date,
      sourceName: record.sourceName,
      type: record.type,
    });
  }

  return stableSortByScore(scored).slice(0, Math.max(1, limit));
}
