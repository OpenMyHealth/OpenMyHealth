import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./base64";

describe("bytesToBase64 / base64ToBytes", () => {
  it("roundtrips small data", () => {
    const input = new Uint8Array([72, 101, 108, 108, 111]);
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(output).toEqual(input);
  });

  it("roundtrips empty Uint8Array and returns empty string", () => {
    const input = new Uint8Array(0);
    const b64 = bytesToBase64(input);
    expect(b64).toBe("");
    const output = base64ToBytes(b64);
    expect(output).toEqual(new Uint8Array(0));
  });

  it("roundtrips large data exceeding chunkSize (0x8000 = 32768 bytes)", () => {
    const size = 0x8000 + 1024;
    const input = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      input[i] = i % 256;
    }
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(output).toEqual(input);
    expect(output.length).toBe(size);
  });

  it("converts known bytes to expected base64", () => {
    const input = new Uint8Array([72, 101, 108, 108, 111]);
    expect(bytesToBase64(input)).toBe("SGVsbG8=");
  });

  it("converts known base64 value to expected bytes", () => {
    const output = base64ToBytes("SGVsbG8=");
    expect(output).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
  });
});

describe("utf8ToBytes / bytesToUtf8", () => {
  it("roundtrips ASCII text", () => {
    const input = "Hello, World!";
    const bytes = utf8ToBytes(input);
    const output = bytesToUtf8(bytes);
    expect(output).toBe(input);
  });

  it("roundtrips Korean characters (multi-byte UTF-8)", () => {
    const input = "안녕하세요";
    const bytes = utf8ToBytes(input);
    const output = bytesToUtf8(bytes);
    expect(output).toBe(input);
    expect(bytes.length).toBeGreaterThan(input.length);
  });

  it("roundtrips emoji (4-byte UTF-8)", () => {
    const input = "🔬💊🩺";
    const bytes = utf8ToBytes(input);
    const output = bytesToUtf8(bytes);
    expect(output).toBe(input);
    expect(bytes.length).toBeGreaterThan(input.length);
  });

  it("returns empty Uint8Array for empty string", () => {
    const bytes = utf8ToBytes("");
    expect(bytes).toEqual(new Uint8Array(0));
    expect(bytes.length).toBe(0);
  });

  it("roundtrips large ASCII string", () => {
    const input = "A".repeat(100_000);
    const bytes = utf8ToBytes(input);
    const output = bytesToUtf8(bytes);
    expect(output).toBe(input);
    expect(bytes.length).toBe(100_000);
  });
});
