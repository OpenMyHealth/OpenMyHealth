import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./base64";
import {
  GCM_IV_BYTES,
  GCM_TAG_BITS,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
} from "./constants";
import type { EncryptedEnvelope } from "./models";
import { asArrayBuffer } from "./utils";

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

async function importPinKey(pin: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asArrayBuffer(utf8ToBytes(pin)), "PBKDF2", false, ["deriveBits", "deriveKey"]);
}

export function generateSaltBase64(): string {
  return bytesToBase64(randomBytes(SALT_BYTES));
}

function domainSalt(rawSalt: Uint8Array, purpose: string): Uint8Array {
  const prefix = utf8ToBytes(`${purpose}:`);
  const combined = new Uint8Array(prefix.length + rawSalt.length);
  combined.set(prefix);
  combined.set(rawSalt, prefix.length);
  return combined;
}

export async function derivePinVerifier(pin: string, saltBase64: string): Promise<string> {
  const pinKey = await importPinKey(pin);
  const salt = domainSalt(base64ToBytes(saltBase64), "verifier");
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: asArrayBuffer(salt),
    },
    pinKey,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function deriveAesKey(pin: string, saltBase64: string): Promise<CryptoKey> {
  const pinKey = await importPinKey(pin);
  const salt = domainSalt(base64ToBytes(saltBase64), "encryption");
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: asArrayBuffer(salt),
    },
    pinKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: string,
  keyVersion = 1,
): Promise<EncryptedEnvelope> {
  const iv = randomBytes(GCM_IV_BYTES);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      tagLength: GCM_TAG_BITS,
      additionalData: aad ? asArrayBuffer(utf8ToBytes(aad)) : undefined,
    },
    key,
    asArrayBuffer(plaintext),
  );

  return {
    keyVersion,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    aad,
  };
}

export async function decryptBytes(key: CryptoKey, envelope: EncryptedEnvelope): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(base64ToBytes(envelope.iv)),
      tagLength: GCM_TAG_BITS,
      additionalData: envelope.aad ? asArrayBuffer(utf8ToBytes(envelope.aad)) : undefined,
    },
    key,
    asArrayBuffer(base64ToBytes(envelope.ciphertext)),
  );

  return new Uint8Array(decrypted);
}

export async function encryptJson<T>(key: CryptoKey, payload: T, aad?: string): Promise<EncryptedEnvelope> {
  return encryptBytes(key, utf8ToBytes(JSON.stringify(payload)), aad);
}

export async function decryptJson<T>(key: CryptoKey, envelope: EncryptedEnvelope): Promise<T> {
  const decrypted = await decryptBytes(key, envelope);
  return JSON.parse(bytesToUtf8(decrypted)) as T;
}
