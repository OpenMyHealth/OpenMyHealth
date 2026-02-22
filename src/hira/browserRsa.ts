import { BigInteger } from "jsbn";

function utf8Encode(input: string): number[] {
  const encoded = unescape(encodeURIComponent(input));
  return [...encoded].map((char) => char.charCodeAt(0));
}

function randomNonZeroBytes(size: number): number[] {
  const out: number[] = [];
  while (out.length < size) {
    const chunk = new Uint8Array(size - out.length);
    crypto.getRandomValues(chunk);
    for (const value of chunk) {
      if (value !== 0) out.push(value);
      if (out.length === size) break;
    }
  }
  return out;
}

function pkcs1v15Pad(message: string, keyBytes: number): BigInteger {
  const msg = utf8Encode(message);
  if (msg.length > keyBytes - 11) {
    throw new Error("message-too-long");
  }

  const psLength = keyBytes - msg.length - 3;
  const ps = randomNonZeroBytes(psLength);
  const block = [0x00, 0x02, ...ps, 0x00, ...msg];

  return new BigInteger(block);
}

export class BrowserRSAKey {
  private modulus: BigInteger | null = null;
  private exponent = 0;

  setPublic(modulusHex: string, exponentHex: string) {
    if (!modulusHex || !exponentHex) {
      throw new Error("invalid-public-key");
    }

    this.modulus = new BigInteger(modulusHex, 16);
    this.exponent = Number.parseInt(exponentHex, 16);

    if (!this.modulus || Number.isNaN(this.exponent)) {
      throw new Error("invalid-public-key");
    }
  }

  encrypt(plainText: string): string {
    if (!this.modulus || !this.exponent) {
      throw new Error("public-key-not-set");
    }

    const keyBytes = (this.modulus.bitLength() + 7) >> 3;
    const padded = pkcs1v15Pad(plainText, keyBytes);
    const encrypted = padded.modPowInt(this.exponent, this.modulus);
    const hex = encrypted.toString(16);

    return hex.length % 2 === 0 ? hex : `0${hex}`;
  }
}
