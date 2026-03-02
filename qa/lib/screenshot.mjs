/**
 * Screenshot capture and PNG pixel comparison (zero external deps).
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inflateSync } from 'node:zlib';

/**
 * Capture a screenshot via CDP and write to disk.
 * @param {import('./cdp-client.mjs').CDPSession} session
 * @param {string} outputPath
 * @returns {Promise<string>} outputPath
 */
export async function captureScreenshot(session, outputPath) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(data, 'base64');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buf);
  return outputPath;
}

/**
 * Compare two PNG files pixel-by-pixel.
 * @param {string} actual — path to actual screenshot
 * @param {string} baseline — path to baseline screenshot
 * @param {string} diffOutput — path to write diff info (unused for now, reserved)
 * @param {number} threshold — max allowed fraction of differing pixels (default 0.5%)
 * @returns {Promise<{match: boolean|null, diffPercent: number, diffPixels?: number, totalPixels?: number, message?: string}>}
 */
export async function compareScreenshots(actual, baseline, diffOutput, threshold = 0.005) {
  let baselineBuf;
  try {
    baselineBuf = await readFile(baseline);
  } catch {
    return { match: null, diffPercent: 0, message: 'No baseline found' };
  }

  let actualBuf;
  try {
    actualBuf = await readFile(actual);
  } catch {
    return { match: null, diffPercent: 0, message: 'Actual screenshot not found' };
  }

  const actualImg = parsePNG(actualBuf);
  const baselineImg = parsePNG(baselineBuf);

  if (actualImg.width !== baselineImg.width || actualImg.height !== baselineImg.height) {
    return {
      match: false,
      diffPercent: 1,
      diffPixels: actualImg.width * actualImg.height,
      totalPixels: actualImg.width * actualImg.height,
      message: `Dimension mismatch: ${actualImg.width}x${actualImg.height} vs ${baselineImg.width}x${baselineImg.height}`,
    };
  }

  const totalPixels = actualImg.width * actualImg.height;
  let diffPixels = 0;
  const CHANNEL_THRESHOLD = 5;

  for (let y = 0; y < actualImg.height; y++) {
    for (let x = 0; x < actualImg.width; x++) {
      const idx = (y * actualImg.width + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(actualImg.pixels[idx + c] - baselineImg.pixels[idx + c]) > CHANNEL_THRESHOLD) {
          differs = true;
          break;
        }
      }
      if (differs) diffPixels++;
    }
  }

  const diffPercent = diffPixels / totalPixels;

  return {
    match: diffPercent <= threshold,
    diffPercent,
    diffPixels,
    totalPixels,
  };
}

// ---------------------------------------------------------------------------
// Minimal PNG parser — extracts raw RGBA pixel data
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Parse a PNG buffer and return { width, height, pixels: Uint8Array(RGBA) }.
 */
function parsePNG(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    // 4 (length) + 4 (type) + length (data) + 4 (CRC)
    offset += 12 + length;
  }

  if (width === 0 || height === 0) {
    throw new Error('PNG missing IHDR chunk');
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    // We support 8-bit RGBA (type 6) and 8-bit RGB (type 2)
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
      throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}. Only 8-bit RGB/RGBA supported.`);
    }
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = inflateSync(compressed);

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerRow = 1 + width * channels; // 1 filter byte + pixel data
  const pixels = new Uint8Array(width * height * 4);

  // Decode scanlines with filter reconstruction
  const prevRow = new Uint8Array(width * channels);
  prevRow.fill(0);

  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    const filterType = raw[rowStart];
    const rowData = new Uint8Array(width * channels);

    for (let i = 0; i < width * channels; i++) {
      const x = raw[rowStart + 1 + i];
      const a = i >= channels ? rowData[i - channels] : 0;
      const b = prevRow[i];
      const c = i >= channels ? prevRow[i - channels] : 0;

      let val;
      switch (filterType) {
        case 0: val = x; break;                         // None
        case 1: val = (x + a) & 0xff; break;            // Sub
        case 2: val = (x + b) & 0xff; break;            // Up
        case 3: val = (x + ((a + b) >> 1)) & 0xff; break; // Average
        case 4: val = (x + paethPredictor(a, b, c)) & 0xff; break; // Paeth
        default: throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
      rowData[i] = val;
    }

    // Copy to RGBA output
    for (let px = 0; px < width; px++) {
      const outIdx = (y * width + px) * 4;
      const inIdx = px * channels;
      pixels[outIdx] = rowData[inIdx];         // R
      pixels[outIdx + 1] = rowData[inIdx + 1]; // G
      pixels[outIdx + 2] = rowData[inIdx + 2]; // B
      pixels[outIdx + 3] = channels === 4 ? rowData[inIdx + 3] : 255; // A
    }

    prevRow.set(rowData);
  }

  return { width, height, pixels };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
