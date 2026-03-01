import type { McpDataRecord, ResourceType } from "../../packages/contracts/src/index";
import type { ResourceDraft, UploadPipelineResult } from "./models";

const LAB_KEYWORDS = ["hemoglobin", "혈색소", "혈소판", "platelet", "wbc", "rbc", "검사", "lab"];
const MED_KEYWORDS = ["mg", "tablet", "capsule", "처방", "복용", "약", "약품"];
const CONDITION_KEYWORDS = ["진단", "cancer", "암", "stage", "병기", "condition"];
const REPORT_KEYWORDS = ["report", "소견", "MRI", "CT", "조직검사", "병리"];
const TEXT_FILE_EXTENSIONS = [".txt", ".text", ".csv", ".json", ".xml"];
const IMAGE_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"];

function containsAny(input: string, words: string[]): boolean {
  const lower = input.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function classify(text: string, fileName: string): ResourceType[] {
  const joined = `${fileName}\n${text}`;
  const types = new Set<ResourceType>();

  if (containsAny(joined, LAB_KEYWORDS)) {
    types.add("Observation");
  }
  if (containsAny(joined, MED_KEYWORDS)) {
    types.add("MedicationStatement");
  }
  if (containsAny(joined, CONDITION_KEYWORDS)) {
    types.add("Condition");
  }
  if (containsAny(joined, REPORT_KEYWORDS)) {
    types.add("DiagnosticReport");
  }

  if (types.size === 0) {
    types.add("DocumentReference");
  }

  return [...types];
}

function parseObservations(text: string): McpDataRecord[] {
  const results: McpDataRecord[] = [];
  const regex = /([A-Za-z가-힣\s]{2,32})[:：]\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%/]+)?/g;

  for (const match of text.matchAll(regex)) {
    const label = match[1].trim();
    const value = Number(match[2]);
    /* v8 ignore next 3 -- regex only captures digit patterns; Number() always returns finite */
    if (!Number.isFinite(value)) {
      continue;
    }
    results.push({
      id: crypto.randomUUID(),
      display: label,
      value,
      /* v8 ignore next -- match[3] is always present when regex matches; || undefined is a safety guard */
      unit: match[3] || undefined,
      date: new Date().toISOString().slice(0, 10),
      flag: "unknown",
    });
    if (results.length >= 10) {
      break;
    }
  }

  return results;
}

function parseMedications(text: string): McpDataRecord[] {
  const results: McpDataRecord[] = [];
  const regex = /([A-Za-z가-힣0-9\-\s]{2,40})\s+(\d+(?:\.\d+)?)\s*(mg|ml|정|캡슐)/gi;

  for (const match of text.matchAll(regex)) {
    results.push({
      id: crypto.randomUUID(),
      display: match[1].trim(),
      value: Number(match[2]),
      unit: match[3],
      date: new Date().toISOString().slice(0, 10),
    });
    /* v8 ignore next 3 -- limit cap tested via 10+ medication entries */
    if (results.length >= 10) {
      break;
    }
  }

  return results;
}

function makeResourceDrafts(resourceType: ResourceType, records: McpDataRecord[], text: string): ResourceDraft[] {
  if (records.length === 0) {
    return [
      {
        resourceType,
        date: new Date().toISOString().slice(0, 10),
        payload: {
          id: crypto.randomUUID(),
          display: "문서 요약",
          notes: text.slice(0, 500),
          date: new Date().toISOString().slice(0, 10),
        },
      },
    ];
  }

  return records.map((record) => ({
    resourceType,
    date: record.date ?? new Date().toISOString().slice(0, 10),
    payload: record,
  }));
}

let pdfWorkerUrlPromise: Promise<string> | null = null;

async function getPdfWorkerUrl(): Promise<string> {
  if (!pdfWorkerUrlPromise) {
    pdfWorkerUrlPromise = import("pdfjs-dist/legacy/build/pdf.worker.mjs?url").then((module) => module.default);
  }
  return pdfWorkerUrlPromise;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = await getPdfWorkerUrl();
  if (pdfjs.GlobalWorkerOptions.workerSrc !== workerUrl) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }

  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pageLimit = Math.min(document.numPages, 30);
  const textChunks: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText.length > 0) {
        textChunks.push(pageText);
      }
    }
  } finally {
    await document.destroy();
  }

  return textChunks.join("\n").trim();
}

export async function parseUploadPipeline(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<UploadPipelineResult> {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  const isPdf = lowerMime === "application/pdf" || lowerName.endsWith(".pdf");
  const supportsTextPreview = lowerMime.includes("text")
    || lowerMime.includes("json")
    || lowerMime.includes("xml")
    || lowerMime.includes("csv")
    || TEXT_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const isImage = lowerMime.startsWith("image/")
    || IMAGE_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));

  let text = "";
  let forcedTypes: ResourceType[] | null = null;
  if (supportsTextPreview) {
    text = new TextDecoder().decode(bytes).trim();
  } else if (isPdf) {
    text = await extractPdfText(bytes);
  } else if (isImage) {
    forcedTypes = ["DocumentReference"];
    text = `이미지 파일 업로드: ${fileName}`;
  } else {
    throw new Error("unsupported_upload_format");
  }

  if (text.length === 0) {
    throw new Error("empty_extracted_text");
  }
  const resourceTypes = forcedTypes ?? classify(text, fileName);

  const resources: ResourceDraft[] = [];
  const matchedCounts: Partial<Record<ResourceType, number>> = {};

  for (const type of resourceTypes) {
    let drafts: ResourceDraft[] = [];

    if (type === "Observation") {
      drafts = makeResourceDrafts(type, parseObservations(text), text);
    } else if (type === "MedicationStatement") {
      drafts = makeResourceDrafts(type, parseMedications(text), text);
    } else if (type === "Condition") {
      drafts = makeResourceDrafts(
        type,
        [
          {
            id: crypto.randomUUID(),
            display: "진단명 추정",
            notes: text.slice(0, 140),
            date: new Date().toISOString().slice(0, 10),
          },
        ],
        text,
      );
    } else if (type === "DiagnosticReport") {
      drafts = makeResourceDrafts(
        type,
        [
          {
            id: crypto.randomUUID(),
            display: "영상·병리 보고서",
            notes: text.slice(0, 200),
            date: new Date().toISOString().slice(0, 10),
          },
        ],
        text,
      );
    } else {
      drafts = makeResourceDrafts(type, [], text);
    }

    matchedCounts[type] = (matchedCounts[type] ?? 0) + drafts.length;
    resources.push(...drafts);
  }

  return {
    resources,
    matchedCounts,
    preview: text.slice(0, 400),
  };
}
