const NORMALIZATION_RE = /[^\p{L}\p{N}]+/gu;
const EMBEDDING_TEXT_CHAR_LIMIT = 900;
const BROAD_TOKEN_DF_RATIO = 0.72;
const INFORMATIVE_TOKEN_DF_RATIO = 0.5;
const EMBEDDING_QUERY_PREFIX = "task: search result | query: ";
const EMBEDDING_DOCUMENT_PREFIX = "title: ";
const EMBEDDING_DOCUMENT_TEXT_SEPARATOR = " | text: ";
const EMBEDDING_DEFAULT_TITLE = "none";
const AMBIGUOUS_PART_LEXICAL_REWEIGHT = 2.6;
const AMBIGUOUS_PART_DENSE_REWEIGHT = 0.65;
const AMBIGUOUS_PART_FORCE_DENSE_GAP = 0;
const SECTION_MISMATCH_CONFIDENCE_MIN = 0.62;
const SECTION_MISMATCH_PENALTY_WEIGHT = 0.007;
const SECTION_BOOST_WEIGHT = 0.03;
const MONTH_MISMATCH_UNKNOWN_PENALTY = 0.01;
const MONTH_MISMATCH_KNOWN_PENALTY = 0.06;
const STRUCTURED_PHRASE_BOOST_FALLBACK = 0.0038;
const STRUCTURED_PHRASE_BOOST_HYBRID = 0.0026;

function minMaxNormalize(values) {
  if (!values.length) {
    return [];
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  if (range <= 1e-12) {
    return values.map(() => 0);
  }
  return values.map((value) => (value - min) / range);
}

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function robustPercentileNormalize(values, lower = 0.1, upper = 0.9) {
  if (!values.length) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const lo = sorted[Math.max(0, Math.min(n - 1, Math.floor((n - 1) * lower)))];
  const hi = sorted[Math.max(0, Math.min(n - 1, Math.floor((n - 1) * upper)))];
  const range = hi - lo;
  if (range <= 1e-12) {
    return minMaxNormalize(values);
  }
  return values.map((value) => clamp01((value - lo) / range));
}

function lowercaseText(text) {
  return String(text || "").toLowerCase();
}

function extractMonthHints(text) {
  const out = [];
  const seen = new Set();
  const re = /(\d{4})[-./]?(\d{2})/g;
  const input = String(text || "");
  let match = re.exec(input);
  while (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      const key = `${match[1]}-${String(month).padStart(2, "0")}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    match = re.exec(input);
  }
  return out;
}

function extractVerbatimPhrases(text, max = 4) {
  const raw = String(text || "");
  const latinMatches = raw.match(/[A-Za-z][A-Za-z0-9().%/+_-]{4,}/g) || [];
  const structuredMatches = raw.match(/[0-9A-Za-z가-힣][0-9A-Za-z가-힣()[\].%/+_-]{4,}/g) || [];
  const matches = [...latinMatches, ...structuredMatches];
  const out = [];
  const seen = new Set();
  for (const match of matches) {
    const term = match.toLowerCase().trim();
    if (!term || seen.has(term)) {
      continue;
    }
    const dateLike = /^\d{4}[-./]\d{2}(?:[-./]\d{2})?$/.test(term);
    if (dateLike) {
      continue;
    }
    const structured = /[()[\].%/+_-]/.test(term) || /\d/.test(term);
    const hasAsciiStart = /^[a-z]/.test(term);
    if (!hasAsciiStart && !structured) {
      continue;
    }
    seen.add(term);
    out.push(term);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function unique(values, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function makeCharNgrams(token, n = 2) {
  if (token.length < n) {
    return [token];
  }
  const grams = [];
  for (let i = 0; i <= token.length - n; i += 1) {
    grams.push(token.slice(i, i + n));
  }
  return grams;
}

function diceSimilarity(a, b) {
  if (!a.length || !b.length) {
    return 0;
  }
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersect = 0;
  for (const gram of aSet) {
    if (bSet.has(gram)) {
      intersect += 1;
    }
  }
  return (2 * intersect) / (aSet.size + bSet.size);
}

export function normalizeTextForSearch(text) {
  return lowercaseText(text)
    .replace(NORMALIZATION_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(text) {
  const normalized = normalizeTextForSearch(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function expandTokensFromVocabulary(tokens, lexicalIndex, threshold = 0.72, maxPerToken = 1) {
  if (!lexicalIndex?.vocabEntries?.length) {
    return tokens;
  }

  const out = new Set(tokens);
  for (const token of tokens) {
    if (lexicalIndex.termSet.has(token)) {
      continue;
    }

    const tokenGrams = makeCharNgrams(token, 2);
    const candidates = [];
    for (const entry of lexicalIndex.vocabEntries) {
      const score = diceSimilarity(tokenGrams, entry.grams);
      if (score >= threshold) {
        candidates.push({ term: entry.term, score, df: entry.df });
      }
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.df - a.df;
    });

    for (const candidate of candidates.slice(0, maxPerToken)) {
      out.add(candidate.term);
    }
  }

  return [...out];
}

function inferSectionAffinity(queryTokens, lexicalIndex) {
  const sectionScores = new Map();
  if (!queryTokens.length || !lexicalIndex?.sectionTermWeight) {
    return sectionScores;
  }

  for (const token of queryTokens) {
    const sectionMap = lexicalIndex.sectionTermWeight.get(token);
    if (!sectionMap) {
      continue;
    }
    for (const [section, score] of sectionMap.entries()) {
      sectionScores.set(section, (sectionScores.get(section) || 0) + score);
    }
  }

  const entries = [...sectionScores.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return sectionScores;
  }

  const max = entries[0][1];
  for (const [section, score] of entries) {
    sectionScores.set(section, max > 0 ? score / max : 0);
  }
  return sectionScores;
}

function filterTokensByIdf(tokens, lexicalIndex) {
  if (!lexicalIndex?.idf?.size) {
    return tokens;
  }
  const knownTokens = tokens.filter((token) => lexicalIndex.idf.has(token));
  const threshold = lexicalIndex.idfThreshold ?? 0;
  const filtered = knownTokens.filter((token) => {
    const tokenIdf = lexicalIndex.idf.get(token);
    return tokenIdf >= threshold;
  });
  if (filtered.length) {
    return unique(filtered);
  }
  if (knownTokens.length) {
    return unique(knownTokens);
  }
  return tokens;
}

function pruneOverBroadTokens(tokens, lexicalIndex, partTokenSet) {
  if (!tokens.length || !lexicalIndex?.docFreq?.size) {
    return tokens;
  }
  const docCount = Math.max(1, Number(lexicalIndex.docCount || 1));
  const retained = [];
  for (const token of tokens) {
    if (partTokenSet?.has(token)) {
      retained.push(token);
      continue;
    }
    const df = lexicalIndex.docFreq.get(token);
    if (!df) {
      retained.push(token);
      continue;
    }
    if (df / docCount <= BROAD_TOKEN_DF_RATIO) {
      retained.push(token);
    }
  }

  if (!retained.length) {
    return tokens;
  }

  // Keep broad-token pruning conservative: collapse only when informative terms remain.
  const informativeCount = retained.reduce((acc, token) => {
    if (partTokenSet?.has(token)) {
      return acc + 1;
    }
    const df = lexicalIndex.docFreq.get(token) || 0;
    return acc + (df / docCount <= INFORMATIVE_TOKEN_DF_RATIO || !df ? 1 : 0);
  }, 0);

  return informativeCount > 0 ? unique(retained) : tokens;
}

export function normalizeMedicalQuery(rawQuery, lexicalIndex = null) {
  const raw = String(rawQuery || "");
  const normalizedBase = normalizeTextForSearch(raw);
  const baseTokens = tokenizeSearchText(normalizedBase);
  const baseMatchedTokens =
    lexicalIndex && lexicalIndex.termSet
      ? baseTokens.reduce((acc, token) => (lexicalIndex.termSet.has(token) ? acc + 1 : acc), 0)
      : 0;
  const lexicalCoverage = baseMatchedTokens / Math.max(1, baseTokens.length);
  const needsExpansion = lexicalCoverage < 0.6;
  const expansionThreshold = lexicalCoverage < 0.45 ? 0.62 : 0.68;
  const expansionLimit = lexicalCoverage < 0.35 ? 2 : 1;
  const expandedTokens =
    lexicalIndex && needsExpansion
      ? expandTokensFromVocabulary(baseTokens, lexicalIndex, expansionThreshold, expansionLimit)
      : baseTokens;
  const tokenPool = unique(expandedTokens);
  const weightedTokens = filterTokensByIdf(tokenPool, lexicalIndex);
  const partTokenSet = lexicalIndex?.partTermSet || null;
  const focusedTokens = pruneOverBroadTokens(weightedTokens, lexicalIndex, partTokenSet);
  const partTokens = partTokenSet
    ? unique([...baseTokens, ...focusedTokens].filter((token) => partTokenSet.has(token)), 4)
    : [];
  const partDominantNaturalQuery = partTokens.length > 0 && baseTokens.length >= 6 && focusedTokens.length <= 3;
  const refinedTokens = partDominantNaturalQuery ? unique([...partTokens], 4) : focusedTokens;
  const partTokenRatio = partTokens.length / Math.max(1, refinedTokens.length);
  const normalizedQuery = refinedTokens.join(" ").trim() || normalizedBase;
  const sectionAffinity = inferSectionAffinity(refinedTokens, lexicalIndex);

  const hasDateHint = /\b\d{4}[-./]?\d{2}\b/.test(raw) || /\b\d{4}[-./]?\d{2}\b/.test(normalizedBase);
  const monthHints = unique([...extractMonthHints(raw), ...extractMonthHints(normalizedBase)], 2);
  const verbatimPhrases = extractVerbatimPhrases(raw, 4);

  return {
    rawQuery: raw,
    normalizedQuery,
    tokens: refinedTokens,
    rewriteApplied: normalizedBase !== normalizedQuery,
    sectionAffinity,
    hasDateHint,
    lexicalCoverage,
    baseTokenCount: baseTokens.length,
    baseMatchedTokenCount: baseMatchedTokens,
    partTokens,
    partTokenRatio,
    monthHints,
    verbatimPhrases,
  };
}

export function makeEmbeddingQueryInput(queryInfo) {
  const withPrefix = (text) => `${EMBEDDING_QUERY_PREFIX}${String(text || "").trim()}`;
  const raw = String(queryInfo?.rawQuery || "").trim();
  const normalized = queryInfo?.normalizedQuery || normalizeTextForSearch(raw);
  const baseTokenCount = Number(queryInfo?.baseTokenCount || 0);
  const focusedTokenCount = Array.isArray(queryInfo?.tokens) ? queryInfo.tokens.length : 0;
  if (!raw) {
    return withPrefix(normalized);
  }
  if (queryInfo?.hasDateHint) {
    return withPrefix(raw);
  }
  if (!normalized || normalized === raw) {
    return withPrefix(raw);
  }
  // If normalization prunes too aggressively, keep semantic signal from the raw query only.
  const compressedTooMuch =
    baseTokenCount >= 6 && focusedTokenCount > 0 && focusedTokenCount / Math.max(1, baseTokenCount) < 0.45;
  if (compressedTooMuch) {
    return withPrefix(raw);
  }
  return withPrefix(`${raw}\n${normalized}`);
}

function normalizeMetaList(values, limit = 8) {
  if (!Array.isArray(values)) {
    return [];
  }
  return unique(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    limit,
  );
}

export function buildSearchText(doc) {
  const meta = [
    doc.section || doc.sourcePath || "",
    doc.month || "",
    ...normalizeMetaList(doc.parts, 6),
    ...normalizeMetaList(doc.diseases, 6),
    ...normalizeMetaList(doc.keywords, 10),
  ]
    .filter(Boolean)
    .join(" | ");
  return `${meta}\n${doc.text || ""}`.trim();
}

function compactEmbeddingText(rawText, limit = EMBEDDING_TEXT_CHAR_LIMIT) {
  const raw = String(rawText || "");
  if (raw.length <= limit) {
    return raw;
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return `${raw.slice(0, limit)}...`;
  }

  const bulletIndexes = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("- ")) {
      bulletIndexes.push(i);
    }
  }

  const headerIndexes = [];
  if (bulletIndexes.length) {
    for (let i = 0; i < bulletIndexes[0]; i += 1) {
      headerIndexes.push(i);
    }
  } else {
    for (let i = 0; i < Math.min(4, lines.length); i += 1) {
      headerIndexes.push(i);
    }
  }

  const selected = new Set(headerIndexes);
  if (bulletIndexes.length) {
    const orderedBullets = [...bulletIndexes];
    selected.add(orderedBullets[0]);
    selected.add(orderedBullets[orderedBullets.length - 1]);

    const targetSamples = Math.min(12, orderedBullets.length);
    const step = Math.max(1, Math.floor(orderedBullets.length / targetSamples));
    for (let i = 0; i < orderedBullets.length; i += step) {
      selected.add(orderedBullets[i]);
      if (selected.size >= targetSamples + headerIndexes.length + 2) {
        break;
      }
    }
  }

  const sortedIndexes = [...selected].sort((a, b) => a - b);
  let text = sortedIndexes.map((index) => lines[index]).join("\n");
  if (text.length <= limit) {
    return text;
  }

  // Reduce low-priority bullet lines until we fit the embedding budget.
  const headerSet = new Set(headerIndexes);
  const removable = sortedIndexes.filter((index) => !headerSet.has(index));
  while (removable.length && text.length > limit) {
    const dropIndex = removable.splice(Math.floor(removable.length / 2), 1)[0];
    const keep = sortedIndexes.filter((index) => index !== dropIndex);
    text = keep.map((index) => lines[index]).join("\n");
    sortedIndexes.length = 0;
    for (const index of keep) {
      sortedIndexes.push(index);
    }
  }

  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function makeEmbeddingDocumentInput(doc) {
  const raw = doc.searchText || doc.text || "";
  const titleParts = [
    String(doc.section || "").trim(),
    String(doc.month || "").trim(),
    ...normalizeMetaList(doc.parts, 2),
  ].filter((part) => part && part !== "unknown");
  const title = titleParts.join(" | ") || EMBEDDING_DEFAULT_TITLE;
  const prefix = `${EMBEDDING_DOCUMENT_PREFIX}${title}${EMBEDDING_DOCUMENT_TEXT_SEPARATOR}`;
  const textLimit = Math.max(128, EMBEDDING_TEXT_CHAR_LIMIT - prefix.length);
  const body = compactEmbeddingText(raw, textLimit);
  return `${prefix}${body}`;
}

function buildTermFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

export function buildLexicalIndex(docs) {
  const docFreq = new Map();
  const sectionTermDocs = new Map();
  const partTermSet = new Set();
  const docMeta = new Map();
  let totalDocLen = 0;

  for (const doc of docs) {
    const section = String(doc.section || doc.sourcePath || "unknown");
    const rawText = doc.searchText || doc.text || "";
    const tokens = tokenizeSearchText(rawText);
    const lineCount = Math.max(
      1,
      String(rawText)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean).length,
    );
    const partTokens = new Set(tokenizeSearchText((doc.parts || []).join(" ")));
    for (const token of partTokens) {
      partTermSet.add(token);
    }
    totalDocLen += tokens.length;
    const tf = buildTermFrequency(tokens);
    docMeta.set(doc.id, {
      tokens,
      tf,
      length: tokens.length,
      lineCount,
      section,
      partTokens,
    });

    const uniqueTokens = new Set(tokens);
    for (const term of uniqueTokens) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
      if (!sectionTermDocs.has(term)) {
        sectionTermDocs.set(term, new Map());
      }
      const sectionMap = sectionTermDocs.get(term);
      sectionMap.set(section, (sectionMap.get(section) || 0) + 1);
    }
  }

  const idf = new Map();
  const sectionTermWeight = new Map();
  const N = Math.max(1, docs.length);

  for (const [term, df] of docFreq.entries()) {
    const termIdf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    idf.set(term, termIdf);

    const sectionDocs = sectionTermDocs.get(term) || new Map();
    const sectionWeight = new Map();
    for (const [section, sectionDf] of sectionDocs.entries()) {
      sectionWeight.set(section, termIdf * (sectionDf / df));
    }
    sectionTermWeight.set(term, sectionWeight);
  }

  const vocabEntries = [...docFreq.entries()]
    .map(([term, df]) => ({ term, df, grams: makeCharNgrams(term, 2) }))
    .sort((a, b) => b.df - a.df)
    .slice(0, 5000);

  const sortedIdf = [...idf.values()].sort((a, b) => a - b);
  const idfThreshold = sortedIdf.length ? sortedIdf[Math.floor(sortedIdf.length * 0.35)] : 0;

  return {
    docMeta,
    idf,
    idfThreshold,
    docFreq,
    docCount: docs.length,
    avgDocLen: totalDocLen / Math.max(1, docs.length),
    sectionTermWeight,
    vocabEntries,
    termSet: new Set(docFreq.keys()),
    partTermSet,
  };
}

export function scoreLexicalBm25(docId, queryTokens, lexicalIndex, k1 = 1.2, b = 0.75) {
  const meta = lexicalIndex.docMeta.get(docId);
  if (!meta || !meta.length) {
    return 0;
  }

  let score = 0;
  for (const term of queryTokens) {
    const tf = meta.tf.get(term) || 0;
    if (!tf) {
      continue;
    }
    const idf = lexicalIndex.idf.get(term) || 0;
    const denom = tf + k1 * (1 - b + b * (meta.length / Math.max(1, lexicalIndex.avgDocLen)));
    score += idf * ((tf * (k1 + 1)) / denom);
  }
  return score;
}

function scoreSectionBoost(sectionAffinity, docSection) {
  if (!sectionAffinity || !sectionAffinity.size) {
    return 0;
  }
  const normalized = sectionAffinity.get(docSection) || 0;
  return normalized * SECTION_BOOST_WEIGHT;
}

function scoreSectionMismatchPenalty(docSection, topSection, topSectionConfidence) {
  if (!topSection || !Number.isFinite(topSectionConfidence)) {
    return 0;
  }
  if (topSectionConfidence < SECTION_MISMATCH_CONFIDENCE_MIN) {
    return 0;
  }
  if (docSection === topSection) {
    return 0;
  }
  return -SECTION_MISMATCH_PENALTY_WEIGHT * topSectionConfidence;
}

function scoreSectionPenalty(docSection) {
  return docSection === "월 컨텍스트" ? -0.02 : 0;
}

function scoreTokenOverlap(queryTokens, docText, lexicalIndex = null) {
  if (!queryTokens.length) {
    return 0;
  }
  const normalizedDoc = normalizeTextForSearch(docText);
  if (!normalizedDoc) {
    return 0;
  }
  let hitWeight = 0;
  let totalWeight = 0;
  for (const token of queryTokens) {
    const idf = lexicalIndex?.idf?.get(token);
    const tokenWeight = idf ? 1 + Math.min(3.5, Math.max(0, idf * 1.5)) : 1;
    totalWeight += tokenWeight;
    if (normalizedDoc.includes(token)) {
      hitWeight += tokenWeight;
    }
  }
  if (totalWeight <= 0) {
    return 0;
  }
  return hitWeight / totalWeight;
}

function scoreBestLineOverlap(queryTokens, docText, lexicalIndex = null) {
  if (!queryTokens.length) {
    return 0;
  }
  const lines = String(docText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 4);
  if (!lines.length) {
    return 0;
  }
  let best = 0;
  for (const line of lines) {
    const score = scoreTokenOverlap(queryTokens, line, lexicalIndex);
    if (score > best) {
      best = score;
      if (best >= 0.999) {
        break;
      }
    }
  }
  return best;
}

function scoreVerbatimPhraseOverlap(phrases, docText) {
  if (!phrases.length) {
    return 0;
  }
  const normalizedDoc = lowercaseText(docText);
  if (!normalizedDoc) {
    return 0;
  }
  let matched = 0;
  for (const phrase of phrases) {
    if (phrase && normalizedDoc.includes(phrase)) {
      matched += 1;
    }
  }
  return matched / phrases.length;
}

function normalizeStructuredPhrase(text) {
  return lowercaseText(text).replace(/[^0-9a-zA-Z가-힣]+/g, "");
}

function scoreStructuredPhraseOverlap(phrases, docText, minLength = 6) {
  if (!phrases.length) {
    return 0;
  }
  const docNormalized = normalizeStructuredPhrase(docText);
  if (!docNormalized) {
    return 0;
  }

  let matched = 0;
  let total = 0;
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeStructuredPhrase(phrase);
    if (!normalizedPhrase || normalizedPhrase.length < minLength) {
      continue;
    }
    total += 1;
    if (docNormalized.includes(normalizedPhrase)) {
      matched += 1;
    }
  }

  if (!total) {
    return 0;
  }
  return matched / total;
}

function scoreVerbatimPhraseDensity(phrases, docText, maxCountPerPhrase = 6) {
  if (!phrases.length) {
    return 0;
  }
  const normalizedDoc = lowercaseText(docText);
  if (!normalizedDoc) {
    return 0;
  }

  const effectivePhrases = phrases.filter(Boolean);
  if (!effectivePhrases.length) {
    return 0;
  }

  const lineCount = Math.max(1, normalizedDoc.split("\n").length);
  let weightedCount = 0;

  for (const phrase of effectivePhrases) {
    let count = 0;
    let from = 0;
    while (count < maxCountPerPhrase) {
      const index = normalizedDoc.indexOf(phrase, from);
      if (index < 0) {
        break;
      }
      count += 1;
      from = index + phrase.length;
    }
    weightedCount += count;
  }

  const cappedMax = effectivePhrases.length * Math.max(1, maxCountPerPhrase);
  const normalizedByPhrase = cappedMax > 0 ? weightedCount / cappedMax : 0;
  const density = weightedCount / Math.max(4, lineCount * 2.2);
  return clamp01(normalizedByPhrase * 0.6 + density * 0.4);
}

function deriveSemanticExpansionTokens({ docs, denseRaw, lexicalIndex, baseTokens, topN = 24, maxTokens = 6 }) {
  const scoredDocIndexes = denseRaw
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const tokenScores = new Map();
  const baseSet = new Set(baseTokens);

  for (const { index } of scoredDocIndexes) {
    const doc = docs[index];
    const meta = lexicalIndex.docMeta.get(doc.id);
    if (!meta) continue;
    for (const [term, tf] of meta.tf.entries()) {
      if (baseSet.has(term)) continue;
      const idf = lexicalIndex.idf.get(term) || 0;
      const score = idf * Math.min(3, tf);
      tokenScores.set(term, (tokenScores.get(term) || 0) + score);
    }
  }

  return [...tokenScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTokens)
    .map(([term]) => term);
}

function rankPositionsDescending(values) {
  const ranked = values
    .map((score, index) => ({ score, index }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
  const positions = new Array(values.length);
  for (let rank = 0; rank < ranked.length; rank += 1) {
    positions[ranked[rank].index] = rank + 1;
  }
  return positions;
}

function reciprocalRankFusionScores(primaryScores, secondaryScores, primaryWeight, secondaryWeight, k = 60) {
  const primaryRanks = rankPositionsDescending(primaryScores);
  const secondaryRanks = rankPositionsDescending(secondaryScores);
  const scores = new Array(primaryScores.length);
  for (let i = 0; i < primaryScores.length; i += 1) {
    scores[i] = primaryWeight / (k + primaryRanks[i]) + secondaryWeight / (k + secondaryRanks[i]);
  }
  return scores;
}

function countLexicalMatches(tokens, lexicalIndex) {
  if (!lexicalIndex?.termSet || !tokens.length) {
    return 0;
  }
  let matched = 0;
  for (const token of tokens) {
    if (lexicalIndex.termSet.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

function diversifyTopByFile(scoredDocs, topLimit = 6) {
  if (!Array.isArray(scoredDocs) || scoredDocs.length <= 1 || topLimit <= 1) {
    return scoredDocs;
  }
  const preferred = [];
  const deferred = [];
  const seenFiles = new Set();

  for (const doc of scoredDocs) {
    const file = String(doc.fileName || "");
    if (preferred.length < topLimit && file && !seenFiles.has(file)) {
      seenFiles.add(file);
      preferred.push(doc);
    } else {
      deferred.push(doc);
    }
  }

  return preferred.concat(deferred);
}

function demoteContextSection(scoredDocs) {
  if (!Array.isArray(scoredDocs) || scoredDocs.length < 2) {
    return scoredDocs;
  }
  const preferred = [];
  const context = [];

  for (const doc of scoredDocs) {
    if (doc.section === "월 컨텍스트") {
      context.push(doc);
    } else {
      preferred.push(doc);
    }
  }

  if (!preferred.length || !context.length) {
    return scoredDocs;
  }

  return preferred.concat(context);
}

function scorePartOverlap(docId, partTokens, lexicalIndex) {
  if (!partTokens.length) {
    return 0;
  }
  const meta = lexicalIndex?.docMeta?.get(docId);
  if (!meta?.partTokens?.size) {
    return 0;
  }
  let matched = 0;
  for (const token of partTokens) {
    if (meta.partTokens.has(token)) {
      matched += 1;
    }
  }
  return matched / partTokens.length;
}

function pickFocusTokens(effectiveTokens, partTokens, lexicalIndex, max = 2) {
  const seed = partTokens.length ? partTokens : effectiveTokens;
  if (!seed.length) {
    return [];
  }

  const scored = seed
    .map((token) => {
      const idf = lexicalIndex?.idf?.get(token) || 0;
      return {
        token,
        score: idf * (1 + Math.min(2, token.length / 8)),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.token.length - a.token.length;
    });

  return unique(scored.map((item) => item.token), max);
}

function scoreFocusFrequency(docId, focusTokens, lexicalIndex, cap = 6) {
  if (!focusTokens.length || !lexicalIndex?.docMeta?.size) {
    return 0;
  }
  const meta = lexicalIndex.docMeta.get(docId);
  if (!meta?.tf?.size) {
    return 0;
  }

  let gain = 0;
  let gainCap = 0;
  const tfCap = Math.max(1, Number(cap) || 6);
  for (const token of focusTokens) {
    const tf = meta.tf.get(token) || 0;
    const idf = lexicalIndex.idf.get(token) || 0;
    const weight = 1 + Math.min(3.5, Math.max(0, idf));
    gain += Math.min(tfCap, tf) * weight;
    gainCap += tfCap * weight;
  }

  if (gainCap <= 0) {
    return 0;
  }
  return gain / gainCap;
}

function scorePartQueryFocusDensity(docId, focusTokens, lexicalIndex, scale = 1.6) {
  if (!focusTokens.length) {
    return 0;
  }
  const meta = lexicalIndex?.docMeta?.get(docId);
  if (!meta?.tf?.size) {
    return 0;
  }
  let matched = 0;
  for (const token of focusTokens) {
    matched += meta.tf.get(token) || 0;
  }
  if (!matched) {
    return 0;
  }
  const lineCount = Math.max(1, Number(meta.lineCount || 1));
  return clamp01((matched / lineCount) / Math.max(1, scale));
}

function scorePartQueryMixedPenalty(docId, lexicalIndex, divisor = 5) {
  const meta = lexicalIndex?.docMeta?.get(docId);
  if (!meta?.partTokens?.size) {
    return 0;
  }
  const mixed = Math.max(0, meta.partTokens.size - 1);
  return Math.min(1, mixed / Math.max(1, divisor));
}

function scorePartQueryCompactness(docId, lexicalIndex, pivot = 22) {
  const meta = lexicalIndex?.docMeta?.get(docId);
  if (!meta?.length) {
    return 0;
  }
  return clamp01(pivot / Math.max(pivot, meta.length));
}

function scoreMonthMatch(docMonth, monthHints) {
  if (!monthHints.length) {
    return 0;
  }
  const normalizedDocMonth = String(docMonth || "").trim();
  if (!normalizedDocMonth || normalizedDocMonth === "unknown") {
    return 0;
  }
  return monthHints.includes(normalizedDocMonth) ? 1 : 0;
}

function scoreMonthMismatchPenalty(docMonth, monthHints, hasDateHint) {
  if (!hasDateHint || !monthHints.length) {
    return 0;
  }
  const normalizedDocMonth = String(docMonth || "").trim();
  if (!normalizedDocMonth || normalizedDocMonth === "unknown") {
    return -MONTH_MISMATCH_UNKNOWN_PENALTY;
  }
  return monthHints.includes(normalizedDocMonth) ? 0 : -MONTH_MISMATCH_KNOWN_PENALTY;
}

export function rankDocumentsHybrid({
  docs,
  queryVector,
  queryInfo,
  lexicalIndex,
  dotSimilarity,
  denseWeight = 0.71,
  lexicalWeight = 0.25,
}) {
  const baseTokens = Array.isArray(queryInfo?.tokens) ? queryInfo.tokens : [];
  const partTokens = Array.isArray(queryInfo?.partTokens) ? queryInfo.partTokens : [];
  const monthHints = Array.isArray(queryInfo?.monthHints) ? queryInfo.monthHints : [];
  const verbatimPhrases = Array.isArray(queryInfo?.verbatimPhrases) ? queryInfo.verbatimPhrases : [];
  const partTokenRatio = Number(queryInfo?.partTokenRatio || 0);
  const baseTokenCount = Number(queryInfo?.baseTokenCount || baseTokens.length);
  const queryLexicalCoverage = Number(queryInfo?.lexicalCoverage || 0);
  const isPartQuery = partTokens.length > 0;
  const partIntentStrength = isPartQuery
    ? Math.min(1, partTokens.length / Math.max(1, baseTokenCount * 0.35))
    : 0;
  const denseRaw = docs.map((doc) => dotSimilarity(queryVector, doc.embedding));
  const baseMatchedTokens = countLexicalMatches(baseTokens, lexicalIndex);
  const shouldExpand = baseTokens.length >= 2 && baseMatchedTokens === 0;
  const semanticExpansion = shouldExpand
    ? deriveSemanticExpansionTokens({
        docs,
        denseRaw,
        lexicalIndex,
        baseTokens,
      })
    : [];
  const effectiveTokens = unique([...baseTokens, ...semanticExpansion], 24);
  const focusTokens = pickFocusTokens(effectiveTokens, partTokens, lexicalIndex, 2);
  const matchedTokenCount = countLexicalMatches(effectiveTokens, lexicalIndex);
  const tokenCoverage = matchedTokenCount / Math.max(1, effectiveTokens.length);
  const lexicalRaw = docs.map((doc) => scoreLexicalBm25(doc.id, effectiveTokens, lexicalIndex));
  const lexicalHitCount = lexicalRaw.reduce((acc, score) => (score > 0 ? acc + 1 : acc), 0);
  const lexicalHitRatio = lexicalHitCount / Math.max(1, docs.length);

  const denseNorm = robustPercentileNormalize(denseRaw);
  const lexicalNorm = robustPercentileNormalize(lexicalRaw);
  const lexicalConfidence = lexicalNorm.length ? Math.max(...lexicalNorm) : 0;
  const sectionConfidence =
    queryInfo.sectionAffinity && queryInfo.sectionAffinity.size
      ? Math.max(...queryInfo.sectionAffinity.values())
      : 0;
  const lexicalSelectivity = clamp01(1 - Math.max(0, lexicalHitRatio - 0.05) / 0.45);
  const lexicalSupport = Math.min(1, tokenCoverage * 0.65 + lexicalSelectivity * 0.35);
  const lexicalSignalOk =
    matchedTokenCount >= (queryInfo.hasDateHint ? 1 : isPartQuery ? 1 : 2) &&
    lexicalHitCount >= (queryInfo.hasDateHint ? 2 : 3) &&
    lexicalConfidence >= (queryInfo.hasDateHint ? 0.2 : isPartQuery ? 0.16 : 0.28);
  const selectiveWindow = queryInfo.hasDateHint
    ? lexicalHitRatio >= 0.01 && lexicalHitRatio <= 0.45
    : lexicalHitRatio >= 0.005 && lexicalHitRatio <= (isPartQuery ? 0.95 : 0.35);
  const partHybridGuard = !isPartQuery || lexicalSupport >= 0.26;
  const disableHybridForPart =
    isPartQuery &&
    !queryInfo.hasDateHint &&
    partTokenRatio >= 0.7 &&
    lexicalHitRatio >= 0.08;
  const ambiguousPartNaturalQuery =
    isPartQuery &&
    !queryInfo?.hasDateHint &&
    partTokenRatio >= 0.7 &&
    baseTokenCount >= 6 &&
    queryLexicalCoverage >= 0.35 &&
    lexicalHitRatio >= 0.02 &&
    lexicalHitRatio <= 0.2;
  const denseSorted = [...denseRaw].sort((a, b) => b - a);
  const denseTopGap = denseSorted.length > 1 ? denseSorted[0] - denseSorted[1] : 1;
  const ambiguousDenseFallbackGate =
    AMBIGUOUS_PART_FORCE_DENSE_GAP > 0 &&
    ambiguousPartNaturalQuery &&
    denseTopGap >= AMBIGUOUS_PART_FORCE_DENSE_GAP;
  const useHybrid =
    lexicalSignalOk &&
    selectiveWindow &&
    (lexicalSupport >= 0.3 || sectionConfidence >= 0.4) &&
    partHybridGuard &&
    !disableHybridForPart &&
    !ambiguousDenseFallbackGate;
  const ambiguousLexicalReweight = ambiguousPartNaturalQuery ? AMBIGUOUS_PART_LEXICAL_REWEIGHT : 1;
  const ambiguousDenseReweight = ambiguousPartNaturalQuery ? AMBIGUOUS_PART_DENSE_REWEIGHT : 1;

  const shouldDiversifyPartTop = isPartQuery && partTokenRatio >= 0.8 && baseTokenCount <= 4 && lexicalHitRatio >= 0.9;
  const sectionAffinityEntries =
    queryInfo.sectionAffinity && queryInfo.sectionAffinity.size
      ? [...queryInfo.sectionAffinity.entries()].sort((a, b) => b[1] - a[1])
      : [];
  const topSection = sectionAffinityEntries[0]?.[0] || "";
  const topSectionConfidence = sectionAffinityEntries[0]?.[1] || 0;

  if (!useHybrid) {
    const denseOnly = docs.map((doc, index) => {
      const docSection = String(doc.section || doc.sourcePath || "unknown");
      const partSpecificQuery = isPartQuery && !queryInfo?.hasDateHint;
      const partFocusTokens = focusTokens.length ? focusTokens : partTokens;
      const overlap = scoreTokenOverlap(effectiveTokens, doc.searchText || doc.text || "", lexicalIndex);
      const lineOverlap = scoreBestLineOverlap(effectiveTokens, doc.searchText || doc.text || "", lexicalIndex);
      const overlapSignal = Math.max(overlap, lineOverlap);
      const phraseOverlap = scoreVerbatimPhraseOverlap(verbatimPhrases, doc.searchText || doc.text || "");
      const structuredPhraseOverlap = scoreStructuredPhraseOverlap(verbatimPhrases, doc.searchText || doc.text || "");
      const phraseDensity = scoreVerbatimPhraseDensity(verbatimPhrases, doc.searchText || doc.text || "");
      const partOverlap = isPartQuery ? scorePartOverlap(doc.id, partTokens, lexicalIndex) : 0;
      const focusFrequency = scoreFocusFrequency(doc.id, focusTokens, lexicalIndex, isPartQuery ? 20 : 8);
      const partDensity = partSpecificQuery ? scorePartQueryFocusDensity(doc.id, partFocusTokens, lexicalIndex) : 0;
      const partMixedPenalty = partSpecificQuery ? scorePartQueryMixedPenalty(doc.id, lexicalIndex) : 0;
      const partCompactness = partSpecificQuery ? scorePartQueryCompactness(doc.id, lexicalIndex) : 0;
      const partBoost = partOverlap * (0.02 + partIntentStrength * 0.03);
      const focusMultiplier = ambiguousPartNaturalQuery ? 1.2 : 1;
      const focusBoost =
        focusFrequency * (isPartQuery ? 0.08 + partIntentStrength * 0.12 : 0.012) * focusMultiplier;
      const partDensityBoost = partDensity * 0.015;
      const partMixedPenaltyScore = partMixedPenalty * 0.006;
      const partCompactnessBoost = partCompactness * 0.006;
      const monthMatch = scoreMonthMatch(doc.month, monthHints);
      const monthBoost = monthMatch * (queryInfo?.hasDateHint ? 0.1 : 0.02);
      const monthMismatchPenalty = scoreMonthMismatchPenalty(doc.month, monthHints, queryInfo?.hasDateHint);
      const sectionMismatchPenalty = scoreSectionMismatchPenalty(docSection, topSection, topSectionConfidence);
      const lineBoostSection = docSection === "처방" || docSection === "진료 상세" ? 1 : 0;
      const lineBoost = lineOverlap * lineBoostSection * (0.007 + lexicalSupport * 0.008);
      const phraseBoostSection = docSection === "처방" ? 1 : 0.4;
      const phraseBoost = phraseOverlap * phraseBoostSection * 0.02;
      const structuredPhraseBoost = structuredPhraseOverlap * phraseBoostSection * STRUCTURED_PHRASE_BOOST_FALLBACK;
      const phraseDensityBoost = phraseDensity * phraseBoostSection * 0.04;
      const overlapBoost = overlapSignal * (queryInfo?.hasDateHint ? 0.006 : 0.012);
      const sectionPenalty = scoreSectionPenalty(docSection);
      return {
        ...doc,
        denseScore: denseRaw[index],
        lexicalScore: lexicalRaw[index],
        denseNorm: denseNorm[index],
        lexicalNorm: lexicalNorm[index],
        sectionBoost: 0,
        sectionPenalty,
        overlap: Math.max(overlapSignal, partOverlap),
        monthMatch,
        score:
          denseRaw[index] +
          partBoost +
          focusBoost +
          partDensityBoost -
          partMixedPenaltyScore +
          partCompactnessBoost +
          monthBoost +
          monthMismatchPenalty +
          sectionMismatchPenalty +
          overlapBoost +
          lineBoost +
          phraseBoost +
          structuredPhraseBoost +
          phraseDensityBoost +
          sectionPenalty,
        hybridApplied: false,
        matchedTokenCount,
        lexicalHitCount,
        lexicalHitRatio,
        lexicalSupport,
        lexicalCandidateCount: docs.length,
      };
    });
    denseOnly.sort((a, b) => b.score - a.score);
    if (shouldDiversifyPartTop) {
      return demoteContextSection(diversifyTopByFile(denseOnly, 6));
    }
    return demoteContextSection(denseOnly);
  }

  const effectiveLexicalWeight = lexicalWeight * lexicalSupport * ambiguousLexicalReweight;
  const effectiveDenseWeight = denseWeight * ambiguousDenseReweight;
  const blendWeightTotal = Math.max(1e-9, effectiveDenseWeight + effectiveLexicalWeight);
  const denseBlendWeight = effectiveDenseWeight / blendWeightTotal;
  const lexicalBlendWeight = effectiveLexicalWeight / blendWeightTotal;
  const rrfScores = reciprocalRankFusionScores(
    denseRaw,
    lexicalRaw,
    denseBlendWeight,
    lexicalBlendWeight,
  );
  const rrfNorm = minMaxNormalize(rrfScores);

  const scored = docs.map((doc, index) => {
    const docSection = String(doc.section || doc.sourcePath || "unknown");
    const partSpecificQuery = isPartQuery && !queryInfo?.hasDateHint;
    const partFocusTokens = focusTokens.length ? focusTokens : partTokens;
    const sectionBoost = scoreSectionBoost(queryInfo.sectionAffinity, docSection);
    const sectionMismatchPenalty = scoreSectionMismatchPenalty(docSection, topSection, topSectionConfidence);
    const sectionPenalty = scoreSectionPenalty(docSection);
    const overlap = scoreTokenOverlap(effectiveTokens, doc.searchText || doc.text || "", lexicalIndex);
    const lineOverlap = scoreBestLineOverlap(effectiveTokens, doc.searchText || doc.text || "", lexicalIndex);
    const overlapSignal = Math.max(overlap, lineOverlap);
    const phraseOverlap = scoreVerbatimPhraseOverlap(verbatimPhrases, doc.searchText || doc.text || "");
    const structuredPhraseOverlap = scoreStructuredPhraseOverlap(verbatimPhrases, doc.searchText || doc.text || "");
    const phraseDensity = scoreVerbatimPhraseDensity(verbatimPhrases, doc.searchText || doc.text || "");
      const partOverlap = isPartQuery ? scorePartOverlap(doc.id, partTokens, lexicalIndex) : 0;
    const focusFrequency = scoreFocusFrequency(doc.id, focusTokens, lexicalIndex, isPartQuery ? 20 : 8);
    const partDensity = partSpecificQuery ? scorePartQueryFocusDensity(doc.id, partFocusTokens, lexicalIndex) : 0;
    const partMixedPenalty = partSpecificQuery ? scorePartQueryMixedPenalty(doc.id, lexicalIndex) : 0;
    const partCompactness = partSpecificQuery ? scorePartQueryCompactness(doc.id, lexicalIndex) : 0;
    const monthMatch = scoreMonthMatch(doc.month, monthHints);
    const monthBoost = monthMatch * (queryInfo?.hasDateHint ? 0.06 : 0.015);
    const lineBoostSection = docSection === "처방" || docSection === "진료 상세" ? 1 : 0;
    const lineBoost = lineOverlap * lineBoostSection * (0.006 + lexicalSupport * 0.006);
    const phraseBoostSection = docSection === "처방" ? 1 : 0.4;
    const phraseBoost = phraseOverlap * phraseBoostSection * 0.016;
    const structuredPhraseBoost = structuredPhraseOverlap * phraseBoostSection * STRUCTURED_PHRASE_BOOST_HYBRID;
    const phraseDensityBoost = phraseDensity * phraseBoostSection * 0.035;
    const rerankBoost = overlapSignal * (0.02 + lexicalSupport * 0.02);
    const partBoost = partOverlap * (0.015 + lexicalSupport * 0.012 + partIntentStrength * 0.015);
    const focusMultiplier = ambiguousPartNaturalQuery ? 1.2 : 1;
    const focusBoost =
      focusFrequency *
      (isPartQuery ? 0.06 + lexicalSupport * 0.08 + partIntentStrength * 0.06 : 0.01 + lexicalSupport * 0.008) *
      focusMultiplier;
    const partDensityBoost = partDensity * 0.015;
    const partMixedPenaltyScore = partMixedPenalty * 0.006;
    const partCompactnessBoost = partCompactness * 0.006;
    const blendScore = denseNorm[index] * denseBlendWeight + lexicalNorm[index] * lexicalBlendWeight;
    const monthMismatchPenalty = scoreMonthMismatchPenalty(doc.month, monthHints, queryInfo?.hasDateHint);
    const finalScore =
      blendScore * 0.88 +
      rrfNorm[index] * 0.1 +
      sectionBoost +
      sectionMismatchPenalty +
      sectionPenalty +
      rerankBoost +
      lineBoost +
      phraseBoost +
      structuredPhraseBoost +
      phraseDensityBoost +
      partBoost +
      focusBoost +
      partDensityBoost -
      partMixedPenaltyScore +
      partCompactnessBoost +
      monthBoost +
      monthMismatchPenalty;

    return {
      ...doc,
      denseScore: denseRaw[index],
      lexicalScore: lexicalRaw[index],
      denseNorm: denseNorm[index],
      lexicalNorm: lexicalNorm[index],
      sectionBoost,
      sectionPenalty,
      overlap: Math.max(overlapSignal, partOverlap),
      monthMatch,
      rrfScore: rrfNorm[index],
      hybridApplied: true,
      matchedTokenCount,
      lexicalHitCount,
      lexicalHitRatio,
      lexicalSupport,
      lexicalCandidateCount: docs.length,
      score: finalScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  if (shouldDiversifyPartTop) {
    return demoteContextSection(diversifyTopByFile(scored, 6));
  }
  return demoteContextSection(scored);
}

export function rankDocumentsDense({ docs, queryVector, dotSimilarity }) {
  const scored = docs.map((doc) => ({
    ...doc,
    score: dotSimilarity(queryVector, doc.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
