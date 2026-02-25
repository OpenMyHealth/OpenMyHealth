/** @jest-environment node */

import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
});

describe("crypto vault envelope", () => {
  it("encrypts and decrypts payload with derived key", async () => {
    const { decryptObject, deriveVaultKey, encryptObject, randomSalt, saltFromEnvelope } = await import("../crypto");
    const salt = randomSalt();
    const key = await deriveVaultKey("supersecure123", salt);
    const payload = {
      version: 1,
      records: [{ id: "r1", title: "test" }],
    };

    const envelope = await encryptObject(payload, key, salt);
    const restored = await decryptObject<typeof payload>(envelope, key);

    expect(restored).toEqual(payload);
    expect(envelope.ciphertext.length).toBeGreaterThan(10);
    expect(saltFromEnvelope(envelope)).toBeInstanceOf(Uint8Array);
  });
});
