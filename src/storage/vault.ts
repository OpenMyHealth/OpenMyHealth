import { OpenChartRecord } from "../context/types";

export interface EncryptedPayload {
  version: 1;
  salt: string;
  iv: string;
  cipherText: string;
  createdAt: string;
}

const ITERATIONS = 120_000;
const KEY_LENGTH = 256;

function utf8Encode(value: string): Uint8Array {
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function utf8Decode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return decodeURIComponent(escape(binary));
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

async function deriveAesKey(
  passphrase: string,
  salt: ArrayBuffer,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptRecords(
  records: OpenChartRecord[],
  passphrase: string,
): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(passphrase, toArrayBuffer(salt));

  const plainText = utf8Encode(JSON.stringify(records));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(plainText),
  );

  return {
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    cipherText: toBase64(new Uint8Array(encrypted)),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptRecords(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<OpenChartRecord[]> {
  const key = await deriveAesKey(passphrase, toArrayBuffer(fromBase64(payload.salt)));

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(payload.iv)),
    },
    key,
    toArrayBuffer(fromBase64(payload.cipherText)),
  );

  return JSON.parse(utf8Decode(new Uint8Array(decrypted))) as OpenChartRecord[];
}

export async function saveEncryptedRecords(
  records: OpenChartRecord[],
  passphrase: string,
  storage: Pick<chrome.storage.StorageArea, "set">,
) {
  const encrypted = await encryptRecords(records, passphrase);
  await storage.set({ openchartVault: encrypted });
}

export async function loadEncryptedRecords(
  passphrase: string,
  storage: Pick<chrome.storage.StorageArea, "get">,
): Promise<OpenChartRecord[]> {
  const result = await storage.get("openchartVault");
  const payload = result.openchartVault as EncryptedPayload | undefined;

  if (!payload) {
    return [];
  }

  return decryptRecords(payload, passphrase);
}
