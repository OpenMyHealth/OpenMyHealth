import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLexicalIndex,
  buildSearchText,
  makeEmbeddingDocumentInput,
  makeEmbeddingQueryInput,
  normalizeMedicalQuery,
  rankDocumentsHybrid,
} from "../../src/searchPipeline.js";

function dotSimilarity(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < Math.min(vecA.length, vecB.length); i += 1) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

test("query normalization does not apply hardcoded keyword substitutions", () => {
  const docs = [
    {
      id: "d1",
      section: "진료 요약",
      text: "요약: 2024-01 | 진료과 내과 | 주요질환 위염",
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));
  const lexicalIndex = buildLexicalIndex(docs);

  const queryInfo = normalizeMedicalQuery("이빨이 아팠어", lexicalIndex);
  assert.ok(queryInfo.normalizedQuery.includes("이빨"));
  assert.equal(queryInfo.normalizedQuery.includes("치아"), false);
});

test("query normalization prefers known corpus tokens over unknown tail terms", () => {
  const docs = [
    {
      id: "d1",
      section: "진료 요약",
      parts: ["안과"],
      text: "요약: 2024-01 | 진료과 안과 | 주요질환 결막염",
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));
  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("안과 쪽으로 받은 진료 기록이 뭐가 있어?", lexicalIndex);

  assert.ok(queryInfo.tokens.includes("안과"));
  assert.equal(queryInfo.tokens.includes("기록이"), false);
});

test("query normalization collapses part-dominant natural query to part tokens", () => {
  const docs = [
    {
      id: "d1",
      section: "진료 요약",
      parts: ["안과"],
      text: "요약: 2024-01 | 진료과 안과 | 주요질환 결막염",
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));
  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("안과 쪽이 불편해서 병원 갔던 기록 있어?", lexicalIndex);

  assert.deepEqual(queryInfo.partTokens, ["안과"]);
  assert.deepEqual(queryInfo.tokens, ["안과"]);
});

test("query normalization extracts verbatim compound phrases from raw query", () => {
  const queryInfo = normalizeMedicalQuery("sodium chloride(0.9%) 성분 약 복용 기록");
  assert.ok(Array.isArray(queryInfo.verbatimPhrases));
  assert.ok(queryInfo.verbatimPhrases.includes("chloride(0.9%)"));
});

test("query normalization extracts structured Korean medical phrase tokens", () => {
  const queryInfo = normalizeMedicalQuery("약국관리료(방문당) 검사나 치료 받은 기록 찾아줘");
  assert.ok(Array.isArray(queryInfo.verbatimPhrases));
  assert.ok(queryInfo.verbatimPhrases.includes("약국관리료(방문당)"));
});

test("hybrid ranking returns scored documents", () => {
  const docs = [
    {
      id: "a",
      fileName: "case_a.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      text: "요약: 2024-05 | 진료과 이비인후과 | 주요질환 중이염",
      embedding: new Float32Array([0.2, 0.8]),
    },
    {
      id: "b",
      fileName: "case_a.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      text: "요약: 2024-05 | 진료과 내과 | 주요질환 위염",
      embedding: new Float32Array([0.9, 0.1]),
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));

  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("귀 통증 중이염 기록", lexicalIndex);
  const queryVector = new Float32Array([0.55, 0.45]); // dense 편향을 줄여 lexical 영향 확인

  const ranked = rankDocumentsHybrid({
    docs,
    queryVector,
    queryInfo,
    lexicalIndex,
    dotSimilarity,
    denseWeight: 0.35,
    lexicalWeight: 0.55,
  });

  assert.equal(ranked.length, 2);
  assert.ok(Number.isFinite(ranked[0].score));
  assert.ok(Number.isFinite(ranked[0].denseScore));
  assert.ok(Number.isFinite(ranked[0].lexicalScore));
  assert.ok(ranked[0].score >= ranked[1].score);
});

test("part overlap boost favors matching department in dense-fallback path", () => {
  const docs = [
    {
      id: "p1",
      fileName: "case_a.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["안과"],
      diseases: [],
      keywords: [],
      text: "요약: 2024-05 | 진료과 안과 | 주요질환 결막염",
      embedding: new Float32Array([0.5, 0.5]),
    },
    {
      id: "p2",
      fileName: "case_b.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["내과"],
      diseases: [],
      keywords: [],
      text: "요약: 2024-05 | 진료과 내과 | 주요질환 위염",
      embedding: new Float32Array([0.5, 0.5]),
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));

  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("안과 쪽 기록", lexicalIndex);
  const queryVector = new Float32Array([0.5, 0.5]);

  const ranked = rankDocumentsHybrid({
    docs,
    queryVector,
    queryInfo,
    lexicalIndex,
    dotSimilarity,
  });

  assert.equal(ranked[0].id, "p1");
});

test("part query prefers higher department frequency when dense scores tie", () => {
  const docs = [
    {
      id: "f1",
      fileName: "case_a.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["안과"],
      diseases: [],
      keywords: [],
      text: [
        "요약: 2024-05 | 진료과 안과 | 주요질환 결막염",
        "기록:",
        "- 일자 2024-05 | 진료과 안과 | 유형 외래",
        "- 일자 2024-05 | 진료과 안과 | 유형 외래",
        "- 일자 2024-05 | 진료과 안과 | 유형 외래",
      ].join("\n"),
      embedding: new Float32Array([0.5, 0.5]),
    },
    {
      id: "f2",
      fileName: "case_b.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["안과"],
      diseases: [],
      keywords: [],
      text: "요약: 2024-05 | 진료과 안과 | 주요질환 건성안",
      embedding: new Float32Array([0.5, 0.5]),
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));

  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("안과 쪽으로 받은 진료 기록이 뭐가 있어?", lexicalIndex);
  const queryVector = new Float32Array([0.5, 0.5]);

  const ranked = rankDocumentsHybrid({
    docs,
    queryVector,
    queryInfo,
    lexicalIndex,
    dotSimilarity,
  });

  assert.equal(ranked[0].id, "f1");
});

test("verbatim phrase density boost favors documents with repeated exact compound phrase", () => {
  const docs = [
    {
      id: "rx1",
      fileName: "case_a.json",
      section: "처방",
      sourcePath: "prescriptions",
      parts: [],
      diseases: [],
      keywords: [],
      text: [
        "요약: 2024-05 | 처방 2건",
        "구분: 처방",
        "기록:",
        "- 성분 sodium chloride(0.9%)",
        "- 성분 acetaminophen",
      ].join("\n"),
      embedding: new Float32Array([0.5, 0.5]),
    },
    {
      id: "rx2",
      fileName: "case_b.json",
      section: "처방",
      sourcePath: "prescriptions",
      parts: [],
      diseases: [],
      keywords: [],
      text: [
        "요약: 2024-05 | 처방 4건",
        "구분: 처방",
        "기록:",
        "- 성분 sodium chloride(0.9%)",
        "- 성분 sodium chloride(0.9%)",
        "- 성분 sodium chloride(0.9%)",
        "- 성분 sodium chloride(0.9%)",
      ].join("\n"),
      embedding: new Float32Array([0.5, 0.5]),
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));

  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("sodium chloride(0.9%) 성분 약 복용 기록", lexicalIndex);
  const queryVector = new Float32Array([0.5, 0.5]);

  const ranked = rankDocumentsHybrid({
    docs,
    queryVector,
    queryInfo,
    lexicalIndex,
    dotSimilarity,
  });

  assert.equal(ranked[0].id, "rx2");
});

test("part-query mixed-part penalty prefers focused department docs", () => {
  const docs = [
    {
      id: "m1",
      fileName: "case_a.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["내과"],
      diseases: [],
      keywords: [],
      text: [
        "요약: 2024-05 | 진료과 내과 | 주요질환 위염",
        "기록:",
        "- 일자 2024-05 | 진료과 내과 | 유형 외래",
      ].join("\n"),
      embedding: new Float32Array([0.5, 0.5]),
    },
    {
      id: "m2",
      fileName: "case_b.json",
      section: "진료 요약",
      sourcePath: "treatmentsSummary",
      parts: ["내과", "안과", "정형외과", "피부과"],
      diseases: [],
      keywords: [],
      text: [
        "요약: 2024-05 | 진료과 내과, 안과, 정형외과, 피부과 | 주요질환 위염",
        "기록:",
        "- 일자 2024-05 | 진료과 내과 | 유형 외래",
      ].join("\n"),
      embedding: new Float32Array([0.5, 0.5]),
    },
  ].map((doc) => ({
    ...doc,
    searchText: buildSearchText(doc),
  }));

  const lexicalIndex = buildLexicalIndex(docs);
  const queryInfo = normalizeMedicalQuery("내과 쪽으로 받은 진료 기록이 뭐가 있어?", lexicalIndex);
  const queryVector = new Float32Array([0.5, 0.5]);

  const ranked = rankDocumentsHybrid({
    docs,
    queryVector,
    queryInfo,
    lexicalIndex,
    dotSimilarity,
  });

  assert.equal(ranked[0].id, "m1");
});

test("embedding query input keeps raw and normalized query together", () => {
  const queryInput = makeEmbeddingQueryInput({
    rawQuery: "이빨이 아팠어",
    normalizedQuery: "이빨 아팠어 치통",
    rewriteApplied: true,
  });
  assert.ok(queryInput.startsWith("task: search result | query: "));
  assert.ok(queryInput.includes("이빨이 아팠어"));
  assert.ok(queryInput.includes("이빨 아팠어 치통"));
});

test("embedding query input keeps raw query for date-hint queries", () => {
  const queryInput = makeEmbeddingQueryInput({
    rawQuery: "2023-09 치과 기록 찾아줘",
    normalizedQuery: "2023 09 치과 기록",
    rewriteApplied: true,
    hasDateHint: true,
  });
  assert.equal(queryInput, "task: search result | query: 2023-09 치과 기록 찾아줘");
});

test("embedding query input keeps raw and normalized query for very short token queries", () => {
  const queryInput = makeEmbeddingQueryInput({
    rawQuery: "복통 기록",
    normalizedQuery: "복통 기록 위장 통증",
    rewriteApplied: true,
    tokens: ["복통", "기록"],
    hasDateHint: false,
  });
  assert.ok(queryInput.includes("복통 기록"));
  assert.ok(queryInput.includes("복통 기록 위장 통증"));
});

test("embedding query input keeps raw only when normalization compresses too much", () => {
  const queryInput = makeEmbeddingQueryInput({
    rawQuery: "만성 단순치주염 관련해서 병원에서 진료 본 내역 알려줘",
    normalizedQuery: "단순치주염 진료",
    rewriteApplied: true,
    baseTokenCount: 8,
    tokens: ["단순치주염", "진료"],
  });
  assert.equal(queryInput, "task: search result | query: 만성 단순치주염 관련해서 병원에서 진료 본 내역 알려줘");
});

test("embedding query input may include normalized text even when rewriteApplied is false", () => {
  const queryInput = makeEmbeddingQueryInput({
    rawQuery: "피부과 쪽이 불편해서 병원 갔던 기록 있어?",
    normalizedQuery: "피부과 쪽이 불편해서 병원 갔던 기록 있어",
    rewriteApplied: false,
    tokens: ["피부과", "기록"],
  });
  assert.ok(queryInput.includes("피부과 쪽이 불편해서 병원 갔던 기록 있어?"));
  assert.ok(queryInput.includes("피부과 쪽이 불편해서 병원 갔던 기록 있어"));
});

test("embedding document input keeps header and broad record coverage under length cap", () => {
  const bulletLines = Array.from({ length: 40 }, (_, i) => `- 일자 2024-01 | 항목 검사${i} | 분류 테스트`);
  const raw = [
    "진료 상세 | 2024-01",
    "요약: 2024-01 | 진료상세 40건",
    "구분: 진료 상세",
    "기록:",
    ...bulletLines,
  ].join("\n");

  const input = makeEmbeddingDocumentInput({
    section: "진료 상세",
    month: "2024-01",
    parts: ["이비인후과"],
    searchText: raw,
  });

  assert.ok(input.startsWith("title: 진료 상세 | 2024-01 | 이비인후과 | text: "));
  assert.ok(input.length <= 903); // 900 + optional ellipsis
  assert.ok(input.includes("요약: 2024-01 | 진료상세 40건"));
  assert.ok(input.includes("- 일자 2024-01 | 항목 검사0 | 분류 테스트"));
  assert.ok(input.includes("- 일자 2024-01 | 항목 검사39 | 분류 테스트"));
});
