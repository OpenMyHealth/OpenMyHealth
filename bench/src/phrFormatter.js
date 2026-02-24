const MAX_DOCUMENTS = 6000;
const MAX_VALUE_LENGTH = 180;
const SUMMARY_RECORDS_PER_DOC = 6;
const DETAIL_RECORDS_PER_DOC = 12;
const PRESCRIPTION_RECORDS_PER_DOC = 10;
const UNKNOWN_MONTH = "unknown";

function isPrimitive(value) {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function toDisplayValue(value) {
  if (value === null || value === undefined) {
    return "정보없음";
  }
  if (typeof value === "string") {
    return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
}

function cleanDiseaseName(raw) {
  return String(raw || "")
    .replace(/^\([^)]*\)\s*/g, "")
    .trim();
}

function normalizeMonth(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return UNKNOWN_MONTH;
  }

  let match = raw.match(/^(\d{4})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  match = raw.match(/^(\d{4})[-/.](\d{2})(?:[-/.]\d{2})?$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return raw;
}

function compareMonthKey(a, b) {
  if (a === UNKNOWN_MONTH) {
    return 1;
  }
  if (b === UNKNOWN_MONTH) {
    return -1;
  }
  return a.localeCompare(b);
}

function groupByMonth(records) {
  const map = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    const month = normalizeMonth(record.date);
    if (!map.has(month)) {
      map.set(month, []);
    }
    map.get(month).push(record);
  }
  return map;
}

function uniq(values, max = Number.POSITIVE_INFINITY) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function extractKeywordTerms(values, limit = 10) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    const tokens = String(value || "")
      .toLowerCase()
      .replace(/[^0-9a-zA-Z\uAC00-\uD7A3]+/g, " ")
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);

    for (const token of tokens) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      out.push(token);
      if (out.length >= limit) {
        return out;
      }
    }
  }

  return out;
}

function summaryContext(month, monthSummaries) {
  if (!monthSummaries.length) {
    return `${month === UNKNOWN_MONTH ? "날짜 미확인" : month} | 진료요약 없음`;
  }

  const parts = uniq(monthSummaries.map((s) => s.part), 6);
  const types = uniq(monthSummaries.map((s) => s.type), 4);
  const diseases = uniq(monthSummaries.map((s) => cleanDiseaseName(s.disease_name)), 4);

  const chunks = [`${month === UNKNOWN_MONTH ? "날짜 미확인" : month}`, `요약 ${monthSummaries.length}건`];
  if (parts.length) {
    chunks.push(`진료과 ${parts.join(", ")}`);
  }
  if (types.length) {
    chunks.push(`유형 ${types.join(", ")}`);
  }
  if (diseases.length) {
    chunks.push(`주요질환 ${diseases.join(", ")}`);
  }
  return chunks.join(" | ");
}

function summarySentence(summary) {
  const parts = [];
  if (summary.date) {
    parts.push(`일자 ${normalizeMonth(summary.date)}`);
  }
  if (summary.part) {
    parts.push(`진료과 ${toDisplayValue(summary.part)}`);
  }
  if (summary.type) {
    parts.push(`유형 ${toDisplayValue(summary.type)}`);
  }
  if (summary.disease_name) {
    parts.push(`질환 ${toDisplayValue(cleanDiseaseName(summary.disease_name))}`);
  }
  if (summary.days !== undefined) {
    parts.push(`일수 ${toDisplayValue(summary.days)}`);
  }
  if (summary.my_fee !== undefined) {
    parts.push(`본인부담 ${toDisplayValue(summary.my_fee)}원`);
  }
  if (summary.total_fee !== undefined) {
    parts.push(`총진료비 ${toDisplayValue(summary.total_fee)}원`);
  }
  if (summary.insurance_fee !== undefined) {
    parts.push(`보험자부담 ${toDisplayValue(summary.insurance_fee)}원`);
  }
  if (summary.code) {
    parts.push(`코드 ${toDisplayValue(summary.code)}`);
  }
  return parts.join(" | ") || "요약 정보 없음";
}

function detailSentence(detail) {
  const parts = [];
  if (detail.date) {
    parts.push(`일자 ${normalizeMonth(detail.date)}`);
  }
  if (detail.name) {
    parts.push(`항목 ${toDisplayValue(detail.name)}`);
  }
  if (detail.category) {
    parts.push(`분류 ${toDisplayValue(detail.category)}`);
  }
  if (detail.days !== undefined) {
    parts.push(`일수 ${toDisplayValue(detail.days)}일`);
  }
  if (detail.amount !== undefined) {
    parts.push(`수량 ${toDisplayValue(detail.amount)}`);
  }
  if (detail.frequency !== undefined) {
    parts.push(`빈도 ${toDisplayValue(detail.frequency)}`);
  }
  return parts.join(" | ") || "상세 기록 없음";
}

function prescriptionSentence(item) {
  const parts = [];
  if (item.date) {
    parts.push(`일자 ${normalizeMonth(item.date)}`);
  }
  if (item.medicine_name) {
    parts.push(`약품 ${toDisplayValue(item.medicine_name)}`);
  }
  if (item.ingredient) {
    parts.push(`성분 ${toDisplayValue(item.ingredient)}`);
  }
  if (item.days !== undefined) {
    parts.push(`투약일수 ${toDisplayValue(item.days)}일`);
  }
  if (item.amount !== undefined) {
    parts.push(`수량 ${toDisplayValue(item.amount)}`);
  }
  if (item.frequency !== undefined) {
    parts.push(`복용빈도 ${toDisplayValue(item.frequency)}`);
  }
  return parts.join(" | ") || "처방 기록 없음";
}

function chunkRecords(records, size) {
  const chunks = [];
  for (let i = 0; i < records.length; i += size) {
    chunks.push(records.slice(i, i + size));
  }
  return chunks;
}

function buildTagLine(parts, diseases, keywords) {
  const tags = [];
  if (parts.length) {
    tags.push(`진료과:${parts.join(",")}`);
  }
  if (diseases.length) {
    tags.push(`질환:${diseases.join(",")}`);
  }
  if (keywords.length) {
    tags.push(`키워드:${keywords.join(",")}`);
  }
  return tags.join(" | ");
}

function pushRecordDocs(
  docs,
  {
    summaryText,
    section,
    sourcePath,
    month,
    parts,
    diseases,
    keywords,
    sentences,
    perDoc,
  },
) {
  const groups = chunkRecords(sentences, perDoc);
  for (let i = 0; i < groups.length; i += 1) {
    const lines = groups[i].map((line) => `- ${line}`).join("\n");
    const tagLine = buildTagLine(parts, diseases, keywords);
    docs.push({
      sourcePath,
      section,
      recordIndex: i,
      month,
      parts,
      diseases,
      keywords,
      text: `요약: ${summaryText}\n구분: ${section}${tagLine ? `\n태그: ${tagLine}` : ""}\n기록:\n${lines}`,
    });
    if (docs.length >= MAX_DOCUMENTS) {
      return;
    }
  }
}

function isPhrPayload(parsed) {
  return Boolean(
    parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.treatmentsSummary) &&
      Array.isArray(parsed.treatmentsDetail) &&
      Array.isArray(parsed.prescriptions),
  );
}

function compactContext(month, label, count) {
  const monthLabel = month === UNKNOWN_MONTH ? "날짜 미확인" : month;
  return `${monthLabel} | ${label} ${count}건`;
}

function buildPhrDocuments(parsed) {
  const docs = [];
  const summaries = parsed.treatmentsSummary.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  const details = parsed.treatmentsDetail.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  const prescriptions = parsed.prescriptions.filter((x) => x && typeof x === "object" && !Array.isArray(x));

  const summaryByMonth = groupByMonth(summaries);
  const detailByMonth = groupByMonth(details);
  const prescriptionByMonth = groupByMonth(prescriptions);

  const monthKeys = [...new Set([...summaryByMonth.keys(), ...detailByMonth.keys(), ...prescriptionByMonth.keys()])].sort(
    compareMonthKey,
  );

  for (const monthKey of monthKeys) {
    const monthSummaries = summaryByMonth.get(monthKey) || [];
    const monthDetails = detailByMonth.get(monthKey) || [];
    const monthPrescriptions = prescriptionByMonth.get(monthKey) || [];

    const monthContext = summaryContext(monthKey, monthSummaries);
    const monthParts = uniq(monthSummaries.map((s) => s.part), 6);
    const monthDiseases = uniq(monthSummaries.map((s) => cleanDiseaseName(s.disease_name)), 6);

    const contextKeywords = extractKeywordTerms([
      ...monthParts,
      ...monthDiseases,
      ...monthDetails.slice(0, 12).map((x) => x.name),
      ...monthPrescriptions.slice(0, 12).map((x) => x.medicine_name),
    ]);

    if (monthSummaries.length) {
      const summaryLines = monthSummaries.map(summarySentence);
      pushRecordDocs(docs, {
        summaryText: monthContext,
        section: "진료 요약",
        sourcePath: "treatmentsSummary",
        month: monthKey,
        parts: monthParts,
        diseases: monthDiseases,
        keywords: contextKeywords,
        sentences: summaryLines,
        perDoc: SUMMARY_RECORDS_PER_DOC,
      });
      if (docs.length >= MAX_DOCUMENTS) {
        break;
      }
    }

    if (monthDetails.length) {
      const detailLines = monthDetails.map((detail) => detailSentence(detail));
      const detailKeywords = extractKeywordTerms(monthDetails.map((x) => `${x.name || ""} ${x.category || ""}`));
      pushRecordDocs(docs, {
        summaryText: compactContext(monthKey, "진료상세", monthDetails.length),
        section: "진료 상세",
        sourcePath: "treatmentsDetail",
        month: monthKey,
        parts: [],
        diseases: [],
        keywords: detailKeywords,
        sentences: detailLines,
        perDoc: DETAIL_RECORDS_PER_DOC,
      });
      if (docs.length >= MAX_DOCUMENTS) {
        break;
      }
    }

    if (monthPrescriptions.length) {
      const prescriptionLines = monthPrescriptions.map((item) => prescriptionSentence(item));
      const prescriptionKeywords = extractKeywordTerms(
        monthPrescriptions.map((x) => `${x.medicine_name || ""} ${x.ingredient || ""}`),
      );
      pushRecordDocs(docs, {
        summaryText: compactContext(monthKey, "처방", monthPrescriptions.length),
        section: "처방",
        sourcePath: "prescriptions",
        month: monthKey,
        parts: [],
        diseases: [],
        keywords: prescriptionKeywords,
        sentences: prescriptionLines,
        perDoc: PRESCRIPTION_RECORDS_PER_DOC,
      });
      if (docs.length >= MAX_DOCUMENTS) {
        break;
      }
    }
  }

  return docs.slice(0, MAX_DOCUMENTS);
}

function flattenGeneric(node, keyPrefix, out) {
  if (!node || typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const nextPrefix = keyPrefix ? `${keyPrefix}.${key}` : key;
    if (isPrimitive(value)) {
      out.push(`${nextPrefix}: ${toDisplayValue(value)}`);
      continue;
    }
    if (Array.isArray(value)) {
      const primitiveValues = value.filter((item) => isPrimitive(item));
      if (primitiveValues.length) {
        out.push(`${nextPrefix}: ${primitiveValues.map((x) => toDisplayValue(x)).join(", ")}`);
      }
      for (let i = 0; i < value.length; i += 1) {
        const item = value[i];
        if (item && typeof item === "object" && !Array.isArray(item)) {
          flattenGeneric(item, `${nextPrefix}.${i}`, out);
        }
      }
      continue;
    }
    flattenGeneric(value, nextPrefix, out);
  }
}

function buildGenericDocuments(parsed) {
  const lines = [];
  flattenGeneric(parsed, "", lines);
  if (!lines.length) {
    return [];
  }
  return chunkRecords(lines, 40).map((group, index) => ({
    sourcePath: "generic",
    section: "generic",
    recordIndex: index,
    month: UNKNOWN_MONTH,
    parts: [],
    diseases: [],
    keywords: [],
    text: `요약: 일반 JSON\n구분: 데이터\n기록:\n${group.map((line) => `- ${line}`).join("\n")}`,
  }));
}

export function buildSemanticChunks(parsed, fileName) {
  const docs = isPhrPayload(parsed) ? buildPhrDocuments(parsed) : buildGenericDocuments(parsed);
  return docs.slice(0, MAX_DOCUMENTS).map((doc, index) => ({
    id: `${fileName}::${index}`,
    fileName,
    chunkIndex: index,
    sourcePath: doc.sourcePath,
    section: doc.section,
    month: doc.month,
    parts: doc.parts,
    diseases: doc.diseases,
    keywords: doc.keywords,
    recordIndex: doc.recordIndex,
    text: doc.text,
  }));
}

export const __testables = {
  normalizeMonth,
  summaryContext,
  detailSentence,
  prescriptionSentence,
  isPhrPayload,
  cleanDiseaseName,
};
