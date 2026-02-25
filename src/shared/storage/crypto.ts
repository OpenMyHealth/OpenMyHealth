const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface VaultEnvelope {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

export async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 210000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptObject(value: unknown, key: CryptoKey, salt: Uint8Array): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv),
    },
    key,
    plaintext,
  );

  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: new Date().toISOString(),
  };
}

export async function decryptObject<T>(envelope: VaultEnvelope, key: CryptoKey): Promise<T> {
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv),
    },
    key,
    new Uint8Array(ciphertext),
  );

  return JSON.parse(decoder.decode(plainBuffer)) as T;
}

export function randomSalt(size = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}

export function saltFromEnvelope(envelope: VaultEnvelope): Uint8Array {
  return base64ToBytes(envelope.salt);
}

export function int8ToBase64(value: Int8Array): string {
  return bytesToBase64(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
}

export function base64ToInt8(value: string): Int8Array {
  const bytes = base64ToBytes(value);
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
