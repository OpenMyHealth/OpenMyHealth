import { webcrypto } from "node:crypto";
import { OpenChartRecord } from "../../context/types";
import {
  decryptRecords,
  encryptRecords,
  loadEncryptedRecords,
  saveEncryptedRecords,
} from "../vault";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
  }
});

const SAMPLE_RECORDS: OpenChartRecord[] = [
  {
    id: "20250102-서울병원-A123",
    date: "2025-01-02T00:00:00.000Z",
    hospital: "서울병원",
    department: "내과",
    diagnosisCode: "A123",
    diagnosisName: "고혈압",
    treatmentType: "외래",
    days: 3,
    fees: { total: 30000, covered: 20000, self: 10000 },
    details: [],
    prescriptions: [],
    source: {
      provider: "HIRA",
      fetchedAt: "2026-02-22T00:00:00.000Z",
      window: "5y",
    },
  },
];

describe("vault", () => {
  it("records를 암호화 후 복호화하면 원본과 동일하다", async () => {
    const encrypted = await encryptRecords(SAMPLE_RECORDS, "passphrase-1");
    const decrypted = await decryptRecords(encrypted, "passphrase-1");

    expect(encrypted.cipherText).not.toContain("고혈압");
    expect(decrypted).toEqual(SAMPLE_RECORDS);
  });

  it("storage adapter를 통해 저장/로드를 수행한다", async () => {
    let memory: unknown;
    const storage = {
      set: async (value: unknown) => {
        memory = value;
      },
      get: async () => {
        return memory as { openchartVault: unknown };
      },
    };

    await saveEncryptedRecords(SAMPLE_RECORDS, "passphrase-2", storage);
    const loaded = await loadEncryptedRecords("passphrase-2", storage);

    expect(loaded).toEqual(SAMPLE_RECORDS);
  });
});
