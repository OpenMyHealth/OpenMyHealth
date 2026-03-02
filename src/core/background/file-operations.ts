import { SCHEMA_VERSION, MAX_UPLOAD_BYTES } from "../constants";
import { decryptBytes, encryptBytes, encryptJson } from "../crypto";
import {
  deleteFileRecord,
  deleteResourcesByFileId,
  getFileRecord,
  saveFileRecord,
  saveResourceRecords,
  toFileSummary,
} from "../db";
import type { ResourceDraft, StoredFileRecord, StoredResourceRecord } from "../models";
import type { RuntimeRequest, RuntimeResponse } from "../messages";
import { parseUploadPipeline } from "../pipeline";
import { runtimeState, nowIso } from "./state";

export function buildResourceRecord(
  fileId: string,
  draft: ResourceDraft,
  keyVersion: number,
  encryptedPayload: StoredResourceRecord["encryptedPayload"],
): StoredResourceRecord {
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    fileId,
    resourceType: draft.resourceType,
    createdAt: nowIso(),
    date: draft.date,
    encryptedPayload: {
      ...encryptedPayload,
      keyVersion,
    },
  };
}

export async function handleUpload(
  message: Extract<RuntimeRequest, { type: "vault:upload-file" }>,
): Promise<RuntimeResponse> {
  const key = runtimeState.session.key;
  if (!runtimeState.session.isUnlocked || !key) {
    return { ok: false, error: "잠금을 먼저 해제해 주세요." };
  }

  const bytes = new Uint8Array(message.bytes);
  if (bytes.byteLength === 0) {
    return { ok: false, error: "빈 파일은 업로드할 수 없습니다." };
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "파일은 30MB 이하로 올려주세요." };
  }

  const fileId = crypto.randomUUID();

  const encryptedBlob = await encryptBytes(key, bytes, `file:${fileId}`);

  const processingFile: StoredFileRecord = {
    id: fileId,
    schemaVersion: SCHEMA_VERSION,
    name: message.name,
    mimeType: message.mimeType,
    size: bytes.byteLength,
    createdAt: nowIso(),
    status: "processing",
    matchedCounts: {},
    encryptedBlob,
  };

  await saveFileRecord(processingFile);

  try {
    const parsed = await parseUploadPipeline(message.name, message.mimeType, bytes);
    const resourceRecords: StoredResourceRecord[] = [];

    for (const draft of parsed.resources) {
      const encryptedPayload = await encryptJson(key, draft.payload, `resource:${draft.resourceType}`);
      resourceRecords.push(buildResourceRecord(fileId, draft, 1, encryptedPayload));
    }

    await saveResourceRecords(resourceRecords);

    const completedFile: StoredFileRecord = {
      ...processingFile,
      status: "done",
      matchedCounts: parsed.matchedCounts,
    };

    await saveFileRecord(completedFile);
    return { ok: true, uploaded: toFileSummary(completedFile) };
  } catch (err) {
    console.error("[upload] pipeline failed:", err);
    try {
      await deleteResourcesByFileId(fileId);
    } catch (cleanupError) {
      console.error("[upload] rollback failed:", cleanupError);
    }
    const failedFile: StoredFileRecord = {
      ...processingFile,
      status: "error",
    };
    await saveFileRecord(failedFile);
    return {
      ok: false,
      error: mapUploadErrorMessage(err),
    };
  }
}

export function mapUploadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "unsupported_upload_format") {
    return "지원하지 않는 파일 형식이에요. 현재는 PDF/TXT/CSV/JSON/XML/JPEG/PNG/HEIC만 지원합니다.";
  }
  return "이 기록은 읽기 어려웠어요. 다른 형식으로 다시 올려주시겠어요?";
}

export async function handleDownload(
  message: Extract<RuntimeRequest, { type: "vault:download-file" }>,
): Promise<RuntimeResponse> {
  if (!runtimeState.session.isUnlocked || !runtimeState.session.key) {
    return { ok: false, error: "잠금을 먼저 해제해 주세요." };
  }

  const file = await getFileRecord(message.fileId);
  if (!file) {
    return { ok: false, error: "파일을 찾을 수 없습니다." };
  }

  const bytes = await decryptBytes(runtimeState.session.key, file.encryptedBlob);
  return {
    ok: true,
    file: {
      name: file.name,
      mimeType: file.mimeType,
      bytes: Array.from(bytes),
    },
  };
}

export async function handleDeleteFile(
  message: Extract<RuntimeRequest, { type: "vault:delete-file" }>,
): Promise<RuntimeResponse> {
  if (!runtimeState.session.isUnlocked || !runtimeState.session.key) {
    return { ok: false, error: "잠금을 먼저 해제해 주세요." };
  }
  const file = await getFileRecord(message.fileId);
  if (!file) {
    return { ok: false, error: "파일을 찾을 수 없습니다." };
  }
  await deleteResourcesByFileId(message.fileId);
  await deleteFileRecord(message.fileId);
  return { ok: true, deletedFileId: message.fileId };
}
