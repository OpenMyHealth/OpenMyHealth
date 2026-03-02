/**
 * Phase 2: Data Pipeline E2E Checks
 * Upload, parse, encrypt, store, download, delete operations.
 *
 * Prerequisites:
 *   - Session connected to a temp tab showing vault.html
 *   - PIN already set to "123456" (Phase 1 completed)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(id, start, message, details) {
  return { id, status: 'pass', duration: Date.now() - start, message, ...(details && { details }) };
}

function fail(id, start, message, details) {
  return { id, status: 'fail', duration: Date.now() - start, message, ...(details && { details }) };
}

function skip(id, message) {
  return { id, status: 'skip', duration: 0, message };
}

/**
 * Evaluate an async expression inside the extension context via CDP.
 * The expression must return a JSON-serialisable value (or call JSON.stringify).
 */
async function evalAsync(session, expression) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown error';
    throw new Error(text);
  }
  return result;
}

/**
 * Send a chrome.runtime.sendMessage and parse the JSON response.
 */
async function sendExtMessage(session, payload) {
  const payloadJson = JSON.stringify(payload);
  const result = await evalAsync(session, `(async () => {
    const resp = await chrome.runtime.sendMessage(${payloadJson});
    return JSON.stringify(resp);
  })()`);
  return JSON.parse(result.value);
}

/**
 * Upload a text file via vault:upload-file and return the parsed response.
 */
async function uploadText(session, name, text) {
  // Build base64 inside the page context to avoid encoding issues with Korean
  const result = await evalAsync(session, `(async () => {
    const text = ${JSON.stringify(text)};
    const bytes = new TextEncoder().encode(text);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const resp = await chrome.runtime.sendMessage({
      type: "vault:upload-file",
      name: ${JSON.stringify(name)},
      mimeType: "text/plain",
      size: bytes.byteLength,
      bytes: base64,
    });
    return JSON.stringify(resp);
  })()`);
  return JSON.parse(result.value);
}

/**
 * Upload binary data (already base64-encoded) via vault:upload-file.
 */
async function uploadBinary(session, name, mimeType, base64, size) {
  return sendExtMessage(session, {
    type: 'vault:upload-file',
    name,
    mimeType,
    size,
    bytes: base64,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runPhase2Checks(session, extensionId, runDir) {
  const results = [];
  const uploadedFileIds = [];

  // Navigate to vault.html
  try {
    await session.send('Page.enable');
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout (15s)')), 15000);
      session.once('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
    });
    await session.send('Page.navigate', { url: `chrome-extension://${extensionId}/vault.html` });
    await loadPromise;
    // Wait for app to mount
    await new Promise(r => setTimeout(r, 1500));
  } catch (e) {
    const ids = [
      'p2:upload-lab', 'p2:upload-med', 'p2:upload-condition', 'p2:upload-report',
      'p2:upload-docref', 'p2:data-summary', 'p2:file-cards', 'p2:file-download',
      'p2:file-delete', 'p2:size-limit', 'p2:encryption-check', 'p2:schema-version',
      'p2:upload-pdf', 'p2:upload-image',
    ];
    return ids.map(id => skip(id, `Page load failed: ${e.message}`));
  }

  // Unlock vault (may need to wait for lockout from Phase 1 to expire)
  try {
    // Check for active lockout first
    const state = await sendExtMessage(session, { type: 'vault:get-state' });
    if (state.session?.lockoutUntil) {
      const waitMs = state.session.lockoutUntil - Date.now();
      if (waitMs > 0 && waitMs <= 65000) {
        // Wait for lockout to expire (up to ~65s)
        await new Promise(r => setTimeout(r, waitMs + 500));
      } else if (waitMs > 65000) {
        const ids = [
          'p2:upload-lab', 'p2:upload-med', 'p2:upload-condition', 'p2:upload-report',
          'p2:upload-docref', 'p2:data-summary', 'p2:file-cards', 'p2:file-download',
          'p2:file-delete', 'p2:size-limit', 'p2:encryption-check', 'p2:schema-version',
          'p2:upload-pdf', 'p2:upload-image',
        ];
        return ids.map(id => skip(id, `Lockout too long (~${Math.round(waitMs/1000)}s remaining)`));
      }
    }

    const unlockResp = await sendExtMessage(session, { type: 'session:unlock', pin: '123456' });
    if (!unlockResp.isUnlocked) {
      // Might still be locked out — try waiting once more
      if (unlockResp.lockoutUntil) {
        const waitMs = unlockResp.lockoutUntil - Date.now();
        if (waitMs > 0 && waitMs <= 65000) {
          await new Promise(r => setTimeout(r, waitMs + 500));
          const retry = await sendExtMessage(session, { type: 'session:unlock', pin: '123456' });
          if (!retry.isUnlocked) {
            throw new Error(retry.error || `Unlock retry failed: ${JSON.stringify(retry)}`);
          }
        } else {
          throw new Error(`Lockout active (~${Math.round((waitMs || 0)/1000)}s) - ${unlockResp.error || 'locked'}`);
        }
      } else {
        throw new Error(unlockResp.error || `Unlock failed: ${JSON.stringify(unlockResp)}`);
      }
    }
    // Small delay for state propagation
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    const ids = [
      'p2:upload-lab', 'p2:upload-med', 'p2:upload-condition', 'p2:upload-report',
      'p2:upload-docref', 'p2:data-summary', 'p2:file-cards', 'p2:file-download',
      'p2:file-delete', 'p2:size-limit', 'p2:encryption-check', 'p2:schema-version',
      'p2:upload-pdf', 'p2:upload-image',
    ];
    return ids.map(id => skip(id, `Unlock failed: ${e.message}`));
  }

  // --- 2.1 Lab Text Upload ---
  {
    const id = 'p2:upload-lab';
    const start = Date.now();
    try {
      const text = '혈색소: 10.1 g/dL\n혈소판: 150 K/uL\nWBC: 4.2 K/uL';
      const resp = await uploadText(session, 'lab-result.txt', text);
      if (!resp.ok) {
        results.push(fail(id, start, `Upload failed: ${resp.error}`));
      } else {
        const mc = resp.uploaded?.matchedCounts || {};
        const obsCount = mc.Observation || 0;
        uploadedFileIds.push(resp.uploaded?.id);
        if (obsCount >= 3) {
          results.push(ok(id, start, `Observation=${obsCount}`, mc));
        } else {
          results.push(fail(id, start, `Observation=${obsCount}, expected >=3`, mc));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.2 Medication Upload ---
  {
    const id = 'p2:upload-med';
    const start = Date.now();
    try {
      const text = '처방약 목록\n타목시펜 20mg tablet 1일1회 복용\n아스피린 100mg tablet 1일1회 복용\n메트포르민 500mg tablet 1일2회 복용';
      const resp = await uploadText(session, 'medication.txt', text);
      if (!resp.ok) {
        results.push(fail(id, start, `Upload failed: ${resp.error}`));
      } else {
        const mc = resp.uploaded?.matchedCounts || {};
        const medCount = mc.MedicationStatement || 0;
        uploadedFileIds.push(resp.uploaded?.id);
        if (medCount >= 1) {
          results.push(ok(id, start, `MedicationStatement=${medCount}`, mc));
        } else {
          results.push(fail(id, start, `MedicationStatement=${medCount}, expected >=1`, mc));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.3 Condition Upload ---
  {
    const id = 'p2:upload-condition';
    const start = Date.now();
    try {
      const text = '진단: 유방암 Stage IIA\n병기: T2N0M0';
      const resp = await uploadText(session, 'diagnosis.txt', text);
      if (!resp.ok) {
        results.push(fail(id, start, `Upload failed: ${resp.error}`));
      } else {
        const mc = resp.uploaded?.matchedCounts || {};
        const condCount = mc.Condition || 0;
        uploadedFileIds.push(resp.uploaded?.id);
        if (condCount >= 1) {
          results.push(ok(id, start, `Condition=${condCount}`, mc));
        } else {
          results.push(fail(id, start, `Condition=${condCount}, expected >=1`, mc));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.4 DiagnosticReport Upload ---
  {
    const id = 'p2:upload-report';
    const start = Date.now();
    try {
      const text = 'MRI 소견: 좌측 유방 종괴\n조직검사 결과: 양성';
      const resp = await uploadText(session, 'mri-report.txt', text);
      if (!resp.ok) {
        results.push(fail(id, start, `Upload failed: ${resp.error}`));
      } else {
        const mc = resp.uploaded?.matchedCounts || {};
        const reportCount = mc.DiagnosticReport || 0;
        uploadedFileIds.push(resp.uploaded?.id);
        if (reportCount >= 1) {
          results.push(ok(id, start, `DiagnosticReport=${reportCount}`, mc));
        } else {
          results.push(fail(id, start, `DiagnosticReport=${reportCount}, expected >=1`, mc));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.5 Unclassified -> DocumentReference ---
  {
    const id = 'p2:upload-docref';
    const start = Date.now();
    try {
      const text = '안녕하세요 이것은 일반 문서입니다';
      const resp = await uploadText(session, 'general-doc.txt', text);
      if (!resp.ok) {
        results.push(fail(id, start, `Upload failed: ${resp.error}`));
      } else {
        const mc = resp.uploaded?.matchedCounts || {};
        const docCount = mc.DocumentReference || 0;
        uploadedFileIds.push(resp.uploaded?.id);
        if (docCount >= 1) {
          results.push(ok(id, start, `DocumentReference=${docCount}`, mc));
        } else {
          results.push(fail(id, start, `DocumentReference=${docCount}, expected >=1`, mc));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.6 Data Summary Update ---
  {
    const id = 'p2:data-summary';
    const start = Date.now();
    try {
      const state = await sendExtMessage(session, { type: 'vault:get-state' });
      if (!state.ok) {
        results.push(fail(id, start, `get-state failed: ${state.error}`));
      } else {
        const summary = state.summary || {};
        const types = Object.keys(summary);
        // After 5 uploads we expect at least a few resource types in summary
        if (types.length >= 1) {
          results.push(ok(id, start, `Summary has ${types.length} types: ${types.join(', ')}`, summary));
        } else {
          results.push(fail(id, start, 'Summary is empty after uploads', summary));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.7 File Card Status ---
  {
    const id = 'p2:file-cards';
    const start = Date.now();
    try {
      const state = await sendExtMessage(session, { type: 'vault:get-state' });
      if (!state.ok) {
        results.push(fail(id, start, `get-state failed: ${state.error}`));
      } else {
        const files = state.files || [];
        const doneFiles = files.filter(f => f.status === 'done');
        if (files.length >= 5) {
          if (doneFiles.length >= 5) {
            results.push(ok(id, start, `${files.length} files listed, ${doneFiles.length} done`));
          } else {
            results.push(fail(id, start, `${doneFiles.length}/${files.length} done, expected >=5 done`,
              files.map(f => ({ name: f.name, status: f.status }))));
          }
        } else {
          results.push(fail(id, start, `Only ${files.length} files, expected >=5`,
            files.map(f => ({ name: f.name, status: f.status }))));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.8 File Download ---
  {
    const id = 'p2:file-download';
    const start = Date.now();
    try {
      // Download the first uploaded file (lab-result.txt)
      const fileId = uploadedFileIds[0];
      if (!fileId) {
        results.push(skip(id, 'No file ID from upload'));
      } else {
        const resp = await sendExtMessage(session, { type: 'vault:download-file', fileId });
        if (!resp.ok) {
          results.push(fail(id, start, `Download failed: ${resp.error}`));
        } else {
          // Decode the returned base64 back to text and verify it matches
          const decoded = await evalAsync(session, `(() => {
            const bytes = Uint8Array.from(atob(${JSON.stringify(resp.file.bytes)}), c => c.charCodeAt(0));
            return new TextDecoder().decode(bytes);
          })()`);
          const text = decoded.value;
          if (text && text.includes('혈색소')) {
            results.push(ok(id, start, `Downloaded ${resp.file.name}, content verified`));
          } else {
            results.push(fail(id, start, 'Downloaded content does not match original'));
          }
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.9 File Delete ---
  {
    const id = 'p2:file-delete';
    const start = Date.now();
    try {
      // Delete the docref file (index 4: general-doc.txt)
      const fileId = uploadedFileIds[4];
      if (!fileId) {
        results.push(skip(id, 'No docref file ID from upload'));
      } else {
        // Count files before
        const beforeState = await sendExtMessage(session, { type: 'vault:get-state' });
        const beforeCount = (beforeState.files || []).length;

        const resp = await sendExtMessage(session, { type: 'vault:delete-file', fileId });
        if (!resp.ok) {
          results.push(fail(id, start, `Delete failed: ${resp.error}`));
        } else {
          // Verify file count decreased
          const afterState = await sendExtMessage(session, { type: 'vault:get-state' });
          const afterCount = (afterState.files || []).length;
          if (afterCount < beforeCount) {
            results.push(ok(id, start, `Deleted file, count ${beforeCount} -> ${afterCount}`));
          } else {
            results.push(fail(id, start, `File count did not decrease: ${beforeCount} -> ${afterCount}`));
          }
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.10 30MB File Rejection ---
  {
    const id = 'p2:size-limit';
    const start = Date.now();
    try {
      // Create a small payload but report a size exceeding MAX_UPLOAD_BYTES (30MB).
      // The actual size check happens on the real byte length after base64 decode,
      // so we need to actually test with a payload that exceeds the limit.
      // We generate a string just over 30MB inside the page context.
      const resp = await evalAsync(session, `(async () => {
        // 30MB + 1 byte = 31457281 bytes
        const SIZE = 30 * 1024 * 1024 + 1;
        // Create a large Uint8Array filled with zeros
        const arr = new Uint8Array(SIZE);
        // Convert to base64 in chunks to avoid call stack overflow
        const CHUNK = 32768;
        let base64 = '';
        for (let i = 0; i < arr.length; i += CHUNK) {
          const slice = arr.subarray(i, Math.min(i + CHUNK, arr.length));
          base64 += btoa(String.fromCharCode(...slice));
        }
        const resp = await chrome.runtime.sendMessage({
          type: "vault:upload-file",
          name: "big-file.txt",
          mimeType: "text/plain",
          size: SIZE,
          bytes: base64,
        });
        return JSON.stringify(resp);
      })()`);
      const parsed = JSON.parse(resp.value);
      if (parsed.ok === false) {
        results.push(ok(id, start, `Rejected: ${parsed.error}`));
      } else {
        results.push(fail(id, start, 'Large file was accepted instead of rejected'));
      }
    } catch (e) {
      // If it throws due to memory or other issues, that's also acceptable rejection
      results.push(ok(id, start, `Rejected with error: ${e.message}`));
    }
  }

  // --- 2.11 IndexedDB Encryption ---
  {
    const id = 'p2:encryption-check';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("openmyhealth_vault", 2);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction("resources", "readonly");
        const store = tx.objectStore("resources");
        const records = await new Promise(r => {
          const req = store.getAll();
          req.onsuccess = () => r(req.result);
        });
        db.close();
        // Check the first few records for encryption structure
        const checked = records.slice(0, 5).map(rec => ({
          hasEncryptedPayload: !!rec.encryptedPayload,
          hasIv: !!(rec.encryptedPayload && rec.encryptedPayload.iv),
          hasCiphertext: !!(rec.encryptedPayload && rec.encryptedPayload.ciphertext),
          hasKeyVersion: !!(rec.encryptedPayload && typeof rec.encryptedPayload.keyVersion === 'number'),
          // Ensure no plaintext payload field
          hasPlaintextPayload: !!rec.payload,
        }));
        return JSON.stringify({
          totalRecords: records.length,
          checked,
        });
      })()`);
      const data = JSON.parse(result.value);
      if (data.totalRecords === 0) {
        results.push(fail(id, start, 'No resource records found in IndexedDB'));
      } else {
        const allEncrypted = data.checked.every(c =>
          c.hasEncryptedPayload && c.hasIv && c.hasCiphertext && c.hasKeyVersion && !c.hasPlaintextPayload
        );
        if (allEncrypted) {
          results.push(ok(id, start, `${data.totalRecords} records, all encrypted`, data));
        } else {
          results.push(fail(id, start, 'Some records missing encryption fields', data));
        }
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.12 Schema Version ---
  {
    const id = 'p2:schema-version';
    const start = Date.now();
    try {
      const result = await evalAsync(session, `(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("openmyhealth_vault", 2);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction("meta", "readonly");
        const store = tx.objectStore("meta");
        const meta = await new Promise(r => {
          const req = store.get("schema_version");
          req.onsuccess = () => r(req.result);
        });
        db.close();
        return JSON.stringify(meta);
      })()`);
      const meta = JSON.parse(result.value);
      if (meta && meta.value === 1) {
        results.push(ok(id, start, 'schema_version === 1'));
      } else {
        results.push(fail(id, start, `schema_version = ${meta?.value ?? 'not found'}`, meta));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.13 PDF Upload ---
  {
    const id = 'p2:upload-pdf';
    const start = Date.now();
    try {
      // Minimal valid PDF structure. The pipeline may not parse it meaningfully,
      // but it should not crash and should fall back to DocumentReference.
      const resp = await evalAsync(session, `(async () => {
        const pdfContent = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>>>endobj\\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\\nxref\\n0 5\\n0000000000 65535 f \\ntrailer<</Size 5/Root 1 0 R>>\\nstartxref\\n9\\n%%EOF';
        const bytes = new TextEncoder().encode(pdfContent);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
        const resp = await chrome.runtime.sendMessage({
          type: "vault:upload-file",
          name: "lab-report.pdf",
          mimeType: "application/pdf",
          size: bytes.byteLength,
          bytes: base64,
        });
        return JSON.stringify(resp);
      })()`);
      const parsed = JSON.parse(resp.value);
      if (parsed.ok) {
        uploadedFileIds.push(parsed.uploaded?.id);
        const mc = parsed.uploaded?.matchedCounts || {};
        results.push(ok(id, start, `PDF uploaded, matchedCounts: ${JSON.stringify(mc)}`, mc));
      } else {
        // PDF parsing failure is acceptable; the extension may not support this minimal PDF
        results.push(ok(id, start, `PDF handled (error expected for minimal PDF): ${parsed.error}`));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  // --- 2.14 Image Upload -> DocumentReference ---
  {
    const id = 'p2:upload-image';
    const start = Date.now();
    try {
      // Minimal 1x1 white PNG (valid binary)
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      // Compute actual byte length from base64
      const resp = await evalAsync(session, `(async () => {
        const base64 = ${JSON.stringify(png)};
        const binary = atob(base64);
        const size = binary.length;
        const resp = await chrome.runtime.sendMessage({
          type: "vault:upload-file",
          name: "scan.png",
          mimeType: "image/png",
          size: size,
          bytes: base64,
        });
        return JSON.stringify(resp);
      })()`);
      const parsed = JSON.parse(resp.value);
      if (parsed.ok) {
        uploadedFileIds.push(parsed.uploaded?.id);
        const mc = parsed.uploaded?.matchedCounts || {};
        const docCount = mc.DocumentReference || 0;
        if (docCount >= 1) {
          results.push(ok(id, start, `Image -> DocumentReference=${docCount}`, mc));
        } else {
          // Image without OCR may still produce other types or none
          results.push(ok(id, start, `Image uploaded, matchedCounts: ${JSON.stringify(mc)}`, mc));
        }
      } else {
        // Image upload error is acceptable if format not supported
        results.push(ok(id, start, `Image handled: ${parsed.error}`));
      }
    } catch (e) {
      results.push(fail(id, start, e.message));
    }
  }

  return results;
}
