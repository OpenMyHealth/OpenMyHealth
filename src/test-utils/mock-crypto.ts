import { vi } from "vitest";
import type { EncryptedEnvelope } from "../core/models";

/**
 * Fast mock for PBKDF2-based derivation functions.
 * Bypasses 600k iterations to keep tests fast while maintaining interface contracts.
 */
export function mockCryptoFast() {
  const mockKey = {} as CryptoKey;

  vi.doMock("@/core/crypto", () => ({
    generateSaltBase64: () => "bW9jay1zYWx0LWJhc2U2NA==",
    derivePinVerifier: vi.fn(async (_pin: string, _salt: string) => "mock-verifier"),
    deriveAesKey: vi.fn(async (_pin: string, _salt: string) => mockKey),
    encryptBytes: vi.fn(async (_key: CryptoKey, plaintext: Uint8Array, aad?: string): Promise<EncryptedEnvelope> => ({
      keyVersion: 1,
      iv: "bW9jay1pdg==",
      ciphertext: Buffer.from(plaintext).toString("base64"),
      aad,
    })),
    decryptBytes: vi.fn(async (_key: CryptoKey, envelope: EncryptedEnvelope): Promise<Uint8Array> => {
      return new Uint8Array(Buffer.from(envelope.ciphertext, "base64"));
    }),
    encryptJson: vi.fn(async <T>(_key: CryptoKey, payload: T, aad?: string): Promise<EncryptedEnvelope> => ({
      keyVersion: 1,
      iv: "bW9jay1pdg==",
      ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"),
      aad,
    })),
    decryptJson: vi.fn(async <T>(_key: CryptoKey, envelope: EncryptedEnvelope): Promise<T> => {
      return JSON.parse(Buffer.from(envelope.ciphertext, "base64").toString("utf-8")) as T;
    }),
  }));

  return { mockKey };
}
