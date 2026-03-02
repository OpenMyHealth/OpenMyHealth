import type { StoredResourceRecord } from "../models";

vi.mock("../crypto", () => ({
  encryptBytes: vi.fn(async (_key: CryptoKey, plaintext: Uint8Array, aad: string) => ({
    keyVersion: 1,
    iv: "bW9jaw==",
    ciphertext: Buffer.from(plaintext).toString("base64"),
    aad,
  })),
  decryptBytes: vi.fn(
    async (_key: CryptoKey, envelope: { ciphertext: string }) =>
      new Uint8Array(Buffer.from(envelope.ciphertext, "base64")),
  ),
  encryptJson: vi.fn(async (_key: CryptoKey, payload: unknown, aad: string) => ({
    keyVersion: 1,
    iv: "bW9jaw==",
    ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"),
    aad,
  })),
}));

vi.mock("../db", () => ({
  saveFileRecord: vi.fn(),
  getFileRecord: vi.fn(),
  deleteFileRecord: vi.fn(),
  saveResourceRecords: vi.fn(),
  deleteResourcesByFileId: vi.fn(),
  toFileSummary: vi.fn((f: { id: string; name: string; mimeType: string; size: number; createdAt: string; status: string; matchedCounts: Record<string, number> }) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    createdAt: f.createdAt,
    status: f.status,
    matchedCounts: f.matchedCounts,
  })),
}));

vi.mock("../pipeline", () => ({
  parseUploadPipeline: vi.fn(),
}));

import { encryptBytes, encryptJson } from "../crypto";
import {
  saveFileRecord,
  getFileRecord,
  deleteFileRecord,
  deleteResourcesByFileId,
} from "../db";
import { parseUploadPipeline } from "../pipeline";
import { runtimeState } from "./state";
import { bytesToBase64, base64ToBytes } from "../base64";
import {
  buildResourceRecord,
  handleUpload,
  handleDownload,
  handleDeleteFile,
  mapUploadErrorMessage,
} from "./file-operations";

const mockEncryptBytes = vi.mocked(encryptBytes);
const mockEncryptJson = vi.mocked(encryptJson);
const mockSaveFileRecord = vi.mocked(saveFileRecord);
const mockGetFileRecord = vi.mocked(getFileRecord);
const mockDeleteFileRecord = vi.mocked(deleteFileRecord);
const mockDeleteResourcesByFileId = vi.mocked(deleteResourcesByFileId);
const mockParseUploadPipeline = vi.mocked(parseUploadPipeline);

beforeEach(() => {
  vi.clearAllMocks();
  runtimeState.session.isUnlocked = true;
  runtimeState.session.key = {} as CryptoKey;
});

function makeUploadMessage(bytes?: string) {
  const defaultBytes = bytesToBase64(new Uint8Array([1, 2, 3]));
  return {
    type: "vault:upload-file" as const,
    name: "blood-test.pdf",
    mimeType: "application/pdf",
    size: bytes ? base64ToBytes(bytes).length : 3,
    bytes: bytes ?? defaultBytes,
  };
}

describe("file-operations", () => {
  describe("buildResourceRecord", () => {
    it("creates correct structure with UUID", () => {
      const draft = {
        resourceType: "Observation" as const,
        date: "2024-01-01",
        payload: { id: "obs-1", display: "glucose", value: 100, unit: "mg/dL" },
      };
      const encPayload: StoredResourceRecord["encryptedPayload"] = {
        keyVersion: 0,
        iv: "abc",
        ciphertext: "def",
      };

      const result = buildResourceRecord("file-1", draft, 1, encPayload);

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.fileId).toBe("file-1");
      expect(result.resourceType).toBe("Observation");
      expect(result.date).toBe("2024-01-01");
      expect(result.schemaVersion).toBe(1);
      expect(result.encryptedPayload.keyVersion).toBe(1);
      expect(result.encryptedPayload.iv).toBe("abc");
      expect(result.encryptedPayload.ciphertext).toBe("def");
      expect(result.createdAt).toBeDefined();
    });
  });

  describe("handleUpload", () => {
    it("happy path returns uploaded summary", async () => {
      mockParseUploadPipeline.mockResolvedValue({
        resources: [
          {
            resourceType: "Observation",
            date: "2024-01-01",
            payload: { id: "obs-1", display: "glucose" },
          },
        ],
        matchedCounts: { Observation: 1 },
        preview: "1 observation",
      });

      const result = await handleUpload(makeUploadMessage());

      expect(result.ok).toBe(true);
      expect(result).toHaveProperty("uploaded");
      const uploaded = (result as { ok: true; uploaded: { name: string; status: string } }).uploaded;
      expect(uploaded.name).toBe("blood-test.pdf");
      expect(uploaded.status).toBe("done");
    });

    it("returns error when session locked", async () => {
      runtimeState.session.isUnlocked = false;
      runtimeState.session.key = null;

      const result = await handleUpload(makeUploadMessage());

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("잠금");
    });

    it("returns error with empty bytes", async () => {
      const result = await handleUpload(makeUploadMessage(""));

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("빈 파일");
    });

    it("returns error when exceeds 30MB", async () => {
      const bigBytes = bytesToBase64(new Uint8Array(31 * 1024 * 1024));
      const result = await handleUpload(makeUploadMessage(bigBytes));

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("30MB 이하");
    });

    it("marks file as error and rolls back resources on pipeline failure", async () => {
      mockParseUploadPipeline.mockRejectedValueOnce(new Error("parse error"));

      const result = await handleUpload(makeUploadMessage());

      expect(result.ok).toBe(false);
      expect(mockDeleteResourcesByFileId).toHaveBeenCalled();

      const saveFileCalls = mockSaveFileRecord.mock.calls;
      const lastSavedFile = saveFileCalls[saveFileCalls.length - 1][0] as { status: string };
      expect(lastSavedFile.status).toBe("error");
    });

    it("still marks error when pipeline fails and rollback also fails", async () => {
      mockParseUploadPipeline.mockRejectedValueOnce(new Error("parse error"));
      mockDeleteResourcesByFileId.mockRejectedValueOnce(new Error("rollback failed"));

      const result = await handleUpload(makeUploadMessage());

      expect(result.ok).toBe(false);
      const saveFileCalls = mockSaveFileRecord.mock.calls;
      const lastSavedFile = saveFileCalls[saveFileCalls.length - 1][0] as { status: string };
      expect(lastSavedFile.status).toBe("error");
    });

    it("encrypts blob with correct AAD 'file:{fileId}'", async () => {
      mockParseUploadPipeline.mockResolvedValue({
        resources: [],
        matchedCounts: {},
        preview: "",
      });

      await handleUpload(makeUploadMessage());

      const aad = mockEncryptBytes.mock.calls[0][2] as string;
      expect(aad).toMatch(/^file:/);
    });

    it("encrypts resources with correct AAD 'resource:{type}'", async () => {
      mockParseUploadPipeline.mockResolvedValue({
        resources: [
          {
            resourceType: "Observation",
            date: "2024-01-01",
            payload: { id: "obs-1", display: "glucose" },
          },
        ],
        matchedCounts: { Observation: 1 },
        preview: "1 observation",
      });

      await handleUpload(makeUploadMessage());

      expect(mockEncryptJson.mock.calls[0][2]).toBe("resource:Observation");
    });

    it("saves processing status before pipeline runs", async () => {
      const callOrder: string[] = [];
      mockSaveFileRecord.mockImplementation(async (file) => {
        callOrder.push(`save:${(file as { status: string }).status}`);
      });
      mockParseUploadPipeline.mockImplementation(async () => {
        callOrder.push("pipeline");
        return { resources: [], matchedCounts: {}, preview: "" };
      });

      await handleUpload(makeUploadMessage());

      expect(callOrder.indexOf("save:processing")).toBeLessThan(callOrder.indexOf("pipeline"));
    });
  });

  describe("handleDownload", () => {
    it("happy path returns decrypted bytes", async () => {
      const originalBytes = new Uint8Array([10, 20, 30]);
      mockGetFileRecord.mockResolvedValue({
        id: "f1",
        schemaVersion: 1,
        name: "test.pdf",
        mimeType: "application/pdf",
        size: 3,
        createdAt: new Date().toISOString(),
        status: "done",
        matchedCounts: {},
        encryptedBlob: {
          keyVersion: 1,
          iv: "bW9jaw==",
          ciphertext: Buffer.from(originalBytes).toString("base64"),
        },
      });

      const result = await handleDownload({ type: "vault:download-file", fileId: "f1" });

      expect(result.ok).toBe(true);
      const fileResult = result as { ok: true; file: { name: string; mimeType: string; bytes: string } };
      expect(fileResult.file.name).toBe("test.pdf");
      expect(fileResult.file.mimeType).toBe("application/pdf");
      expect(base64ToBytes(fileResult.file.bytes)).toEqual(originalBytes);
    });

    it("returns error when session locked", async () => {
      runtimeState.session.isUnlocked = false;
      runtimeState.session.key = null;

      const result = await handleDownload({ type: "vault:download-file", fileId: "f1" });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("잠금");
    });

    it("returns error when file not found", async () => {
      mockGetFileRecord.mockResolvedValue(undefined as never);

      const result = await handleDownload({ type: "vault:download-file", fileId: "missing" });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("찾을 수 없습니다");
    });
  });

  describe("handleDeleteFile", () => {
    it("happy path deletes resources and file", async () => {
      mockGetFileRecord.mockResolvedValue({
        id: "f1",
        schemaVersion: 1,
        name: "test.pdf",
        mimeType: "application/pdf",
        size: 3,
        createdAt: new Date().toISOString(),
        status: "done",
        matchedCounts: {},
        encryptedBlob: { keyVersion: 1, iv: "a", ciphertext: "b" },
      });

      const result = await handleDeleteFile({ type: "vault:delete-file", fileId: "f1" });

      expect(result.ok).toBe(true);
      expect((result as { ok: true; deletedFileId: string }).deletedFileId).toBe("f1");
      expect(mockDeleteResourcesByFileId).toHaveBeenCalledWith("f1");
      expect(mockDeleteFileRecord).toHaveBeenCalledWith("f1");
    });

    it("returns error when session locked", async () => {
      runtimeState.session.isUnlocked = false;
      runtimeState.session.key = null;

      const result = await handleDeleteFile({ type: "vault:delete-file", fileId: "f1" });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("잠금");
    });

    it("returns error when file not found", async () => {
      mockGetFileRecord.mockResolvedValue(undefined as never);

      const result = await handleDeleteFile({ type: "vault:delete-file", fileId: "missing" });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("찾을 수 없습니다");
    });
  });

  describe("mapUploadErrorMessage", () => {
    it("returns specific message for unsupported_upload_format", () => {
      const msg = mapUploadErrorMessage(new Error("unsupported_upload_format"));
      expect(msg).toContain("지원하지 않는 파일 형식");
    });

    it("returns generic message for other errors", () => {
      const msg = mapUploadErrorMessage(new Error("some random error"));
      expect(msg).toContain("읽기 어려웠어요");
    });

    it("returns generic message for non-Error values", () => {
      const msg = mapUploadErrorMessage("a string");
      expect(msg).toContain("읽기 어려웠어요");
    });
  });
});
