import {
  decryptBytes,
  decryptJson,
  deriveAesKey,
  derivePinVerifier,
  encryptBytes,
  encryptJson,
  generateSaltBase64,
} from "./crypto";
import { base64ToBytes } from "./base64";

describe("generateSaltBase64", () => {
  it("returns a non-empty base64 string", () => {
    const salt = generateSaltBase64();
    expect(salt.length).toBeGreaterThan(0);
    const decoded = base64ToBytes(salt);
    expect(decoded.length).toBe(16);
  });

  it("returns different values on each call", () => {
    const a = generateSaltBase64();
    const b = generateSaltBase64();
    expect(a).not.toBe(b);
  });
});

describe("derivePinVerifier", () => {
  let salt: string;

  beforeAll(() => {
    salt = generateSaltBase64();
  });

  it("returns consistent result for same pin and salt", async () => {
    const v1 = await derivePinVerifier("1234", salt);
    const v2 = await derivePinVerifier("1234", salt);
    expect(v1).toBe(v2);
  });

  it("returns different results for different pins", async () => {
    const v1 = await derivePinVerifier("1234", salt);
    const v2 = await derivePinVerifier("5678", salt);
    expect(v1).not.toBe(v2);
  });

  it("returns different results for different salts", async () => {
    const salt2 = generateSaltBase64();
    const v1 = await derivePinVerifier("1234", salt);
    const v2 = await derivePinVerifier("1234", salt2);
    expect(v1).not.toBe(v2);
  });
});

describe("deriveAesKey", () => {
  it("returns a CryptoKey", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey("1234", salt);
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });
});

describe("encryptBytes / decryptBytes", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    const salt = generateSaltBase64();
    key = await deriveAesKey("test-pin", salt);
  });

  it("roundtrips plaintext", async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const envelope = await encryptBytes(key, plaintext);
    const decrypted = await decryptBytes(key, envelope);
    expect(decrypted).toEqual(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", async () => {
    const plaintext = new Uint8Array([10, 20, 30]);
    const e1 = await encryptBytes(key, plaintext);
    const e2 = await encryptBytes(key, plaintext);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.iv).not.toBe(e2.iv);
  });

  it("roundtrips with matching AAD", async () => {
    const plaintext = new Uint8Array([99, 100]);
    const envelope = await encryptBytes(key, plaintext, "context-id");
    const decrypted = await decryptBytes(key, envelope);
    expect(decrypted).toEqual(plaintext);
    expect(envelope.aad).toBe("context-id");
  });

  it("throws when AAD is tampered", async () => {
    const plaintext = new Uint8Array([99, 100]);
    const envelope = await encryptBytes(key, plaintext, "context-id");
    envelope.aad = "tampered-aad";
    await expect(decryptBytes(key, envelope)).rejects.toThrow();
  });

  it("throws when ciphertext is modified", async () => {
    const plaintext = new Uint8Array([50, 60, 70]);
    const envelope = await encryptBytes(key, plaintext);
    const bytes = base64ToBytes(envelope.ciphertext);
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytesToBase64Inline(bytes);
    await expect(decryptBytes(key, envelope)).rejects.toThrow();
  });

  it("throws when decrypting with wrong key", async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const envelope = await encryptBytes(key, plaintext);

    const otherSalt = generateSaltBase64();
    const wrongKey = await deriveAesKey("wrong-pin", otherSalt);
    await expect(decryptBytes(wrongKey, envelope)).rejects.toThrow();
  });

  it("preserves keyVersion in envelope", async () => {
    const plaintext = new Uint8Array([1]);
    const e1 = await encryptBytes(key, plaintext, undefined, 1);
    expect(e1.keyVersion).toBe(1);
    const e2 = await encryptBytes(key, plaintext, undefined, 42);
    expect(e2.keyVersion).toBe(42);
  });
});

describe("encryptJson / decryptJson", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    const salt = generateSaltBase64();
    key = await deriveAesKey("json-pin", salt);
  });

  it("roundtrips a plain object", async () => {
    const payload = { name: "test", value: 123 };
    const envelope = await encryptJson(key, payload);
    const decrypted = await decryptJson<typeof payload>(key, envelope);
    expect(decrypted).toEqual(payload);
  });

  it("roundtrips nested data", async () => {
    const payload = {
      user: { id: 1, name: "Alice" },
      tags: ["a", "b", "c"],
      meta: { nested: { deep: true } },
    };
    const envelope = await encryptJson(key, payload);
    const decrypted = await decryptJson<typeof payload>(key, envelope);
    expect(decrypted).toEqual(payload);
  });

  it("roundtrips with AAD", async () => {
    const payload = { secret: "data" };
    const envelope = await encryptJson(key, payload, "aad-value");
    expect(envelope.aad).toBe("aad-value");
    const decrypted = await decryptJson<typeof payload>(key, envelope);
    expect(decrypted).toEqual(payload);
  });
});

function bytesToBase64Inline(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}
