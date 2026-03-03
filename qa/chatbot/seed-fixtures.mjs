#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverTargets,
  discoverExtensionId,
  discoverBrowserWsUrl,
  connectTarget,
  findExtensionId,
} from "../lib/cdp-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CDP_PORT = 9222;
const DEFAULT_PIN = "123456";

const FIXTURES = [
  {
    id: "seed-observation",
    filePath: join(__dirname, "../../e2e/data/sample-lab-report.txt"),
    name: "seed-lab-report.txt",
    mimeType: "text/plain",
    expectResource: "Observation",
  },
  {
    id: "seed-medication",
    filePath: join(__dirname, "../../e2e/data/sample-medication.txt"),
    name: "seed-medication.txt",
    mimeType: "text/plain",
    expectResource: "MedicationStatement",
  },
  {
    id: "seed-condition",
    filePath: join(__dirname, "../../e2e/data/sample-condition.txt"),
    name: "seed-condition.txt",
    mimeType: "text/plain",
    expectResource: "Condition",
  },
  {
    id: "seed-report",
    filePath: join(__dirname, "../../e2e/data/sample-report.txt"),
    name: "seed-report.txt",
    mimeType: "text/plain",
    expectResource: "DiagnosticReport",
  },
  {
    id: "seed-docref",
    filePath: join(__dirname, "fixtures/docref-note.txt"),
    name: "seed-docref-note.txt",
    mimeType: "text/plain",
    expectResource: "DocumentReference",
  },
];

function parseArgs(argv) {
  const args = {
    pin: DEFAULT_PIN,
    provider: "chatgpt",
    clearOnly: false,
    keepExisting: false,
    json: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--pin" && argv[i + 1]) {
      args.pin = argv[++i];
    } else if (token === "--provider" && argv[i + 1]) {
      args.provider = argv[++i];
    } else if (token === "--clear-only") {
      args.clearOnly = true;
    } else if (token === "--keep-existing") {
      args.keepExisting = true;
    } else if (token === "--json") {
      args.json = true;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evalAsync(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description || exceptionDetails.text || "Runtime.evaluate failed";
    throw new Error(text);
  }

  return result.value;
}

async function sendExtMessage(session, payload) {
  const result = await evalAsync(
    session,
    `(async () => {
      const resp = await chrome.runtime.sendMessage(${JSON.stringify(payload)});
      return JSON.stringify(resp);
    })()`,
  );

  return JSON.parse(result);
}

async function openVaultTab(extensionId) {
  const browserWsUrl = await discoverBrowserWsUrl(CDP_PORT);
  const browserSession = await connectTarget(browserWsUrl);
  const { targetId } = await browserSession.send("Target.createTarget", { url: "about:blank" });
  const pageWsUrl = `ws://localhost:${CDP_PORT}/devtools/page/${targetId}`;
  const session = await connectTarget(pageWsUrl);

  await session.send("Page.enable");
  await session.send("Runtime.enable");

  const loadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vault.html load timeout (20s)")), 20_000);
    session.once("Page.loadEventFired", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  await session.send("Page.navigate", { url: `chrome-extension://${extensionId}/vault.html` });
  await loadPromise;
  await sleep(1_200);

  return { session, browserSession, targetId };
}

async function closeVaultTab(tab) {
  if (!tab) {
    return;
  }

  const { session, browserSession, targetId } = tab;
  try {
    await session.close();
  } catch {
    // no-op
  }
  try {
    await browserSession.send("Target.closeTarget", { targetId });
  } catch {
    // no-op
  }
  try {
    await browserSession.close();
  } catch {
    // no-op
  }
}

async function ensureSessionReady(session, pin) {
  let state = await sendExtMessage(session, { type: "vault:get-state" });
  if (!state?.ok) {
    throw new Error(`vault:get-state failed: ${JSON.stringify(state)}`);
  }

  if (!state.session?.hasPin) {
    const setup = await sendExtMessage(session, {
      type: "session:setup-pin",
      pin,
      locale: "ko",
    });
    if (!setup?.ok || !setup?.isUnlocked) {
      throw new Error(`session:setup-pin failed: ${JSON.stringify(setup)}`);
    }
    state = await sendExtMessage(session, { type: "vault:get-state" });
  }

  if (state.session?.isUnlocked) {
    return;
  }

  const unlock = await sendExtMessage(session, { type: "session:unlock", pin });
  if (unlock?.isUnlocked) {
    return;
  }

  const lockoutUntil = unlock?.lockoutUntil ?? state.session?.lockoutUntil;
  if (lockoutUntil) {
    const waitMs = lockoutUntil - Date.now();
    if (waitMs > 0 && waitMs <= 70_000) {
      await sleep(waitMs + 500);
      const retry = await sendExtMessage(session, { type: "session:unlock", pin });
      if (retry?.isUnlocked) {
        return;
      }
      throw new Error(`session:unlock failed after lockout wait: ${JSON.stringify(retry)}`);
    }
    throw new Error(`lockout is active (${Math.round(waitMs / 1000)}s remaining)`);
  }

  throw new Error(`session:unlock failed: ${JSON.stringify(unlock)}`);
}

async function clearFiles(session) {
  const listResp = await sendExtMessage(session, { type: "vault:list-files" });
  if (!listResp?.ok || !Array.isArray(listResp.files)) {
    throw new Error(`vault:list-files failed: ${JSON.stringify(listResp)}`);
  }

  const deleted = [];
  for (const file of listResp.files) {
    const delResp = await sendExtMessage(session, { type: "vault:delete-file", fileId: file.id });
    if (!delResp?.ok) {
      throw new Error(`vault:delete-file failed for ${file.id}: ${JSON.stringify(delResp)}`);
    }
    deleted.push(file.id);
  }
  return deleted;
}

async function clearPermissions(session) {
  const listResp = await sendExtMessage(session, { type: "vault:list-permissions" });
  if (!listResp?.ok || !Array.isArray(listResp.permissions)) {
    throw new Error(`vault:list-permissions failed: ${JSON.stringify(listResp)}`);
  }

  const revoked = [];
  for (const permission of listResp.permissions) {
    const revokeResp = await sendExtMessage(session, {
      type: "vault:revoke-permission",
      key: permission.key,
    });
    if (!revokeResp?.ok) {
      throw new Error(`vault:revoke-permission failed for ${permission.key}: ${JSON.stringify(revokeResp)}`);
    }
    revoked.push(permission.key);
  }
  return revoked;
}

async function uploadFixture(session, fixture) {
  const bytes = await readFile(fixture.filePath);
  const response = await sendExtMessage(session, {
    type: "vault:upload-file",
    name: fixture.name,
    mimeType: fixture.mimeType,
    size: bytes.byteLength,
    bytes: bytes.toString("base64"),
  });

  if (!response?.ok) {
    return {
      id: fixture.id,
      status: "fail",
      message: response?.error || "upload failed",
      response,
    };
  }

  const matched = response.uploaded?.matchedCounts || {};
  const matchedCount = Number(matched[fixture.expectResource] || 0);
  if (matchedCount < 1) {
    return {
      id: fixture.id,
      status: "fail",
      message: `expected ${fixture.expectResource} >= 1, got ${matchedCount}`,
      response,
    };
  }

  return {
    id: fixture.id,
    status: "pass",
    uploadedFileId: response.uploaded?.id,
    matchedCounts: matched,
  };
}

async function discoverExtensionIdOrThrow() {
  let targets;
  try {
    targets = await discoverTargets(CDP_PORT);
  } catch {
    throw new Error("CDP not reachable on port 9222. Start Chrome with remote debugging first.");
  }
  let extensionId = findExtensionId(targets);
  if (!extensionId) {
    const profileDir = join(__dirname, "../../.wxt/chrome-profile");
    extensionId = await discoverExtensionId(CDP_PORT, profileDir);
  }
  if (!extensionId) {
    throw new Error("OpenMyHealth extension id not found on CDP port 9222");
  }
  return extensionId;
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  let tab;
  try {
    const extensionId = await discoverExtensionIdOrThrow();
    tab = await openVaultTab(extensionId);

    await ensureSessionReady(tab.session, args.pin);

    const summary = {
      startedAt,
      extensionId,
      provider: args.provider,
      clearOnly: args.clearOnly,
      keepExisting: args.keepExisting,
      deletedFileIds: [],
      revokedPermissionKeys: [],
      uploads: [],
      finalState: null,
    };

    summary.revokedPermissionKeys = await clearPermissions(tab.session);

    if (!args.keepExisting) {
      summary.deletedFileIds = await clearFiles(tab.session);
    }

    if (!args.clearOnly) {
      const setProvider = await sendExtMessage(tab.session, {
        type: "vault:set-provider",
        provider: args.provider,
      });
      if (!setProvider?.ok) {
        throw new Error(`vault:set-provider failed: ${JSON.stringify(setProvider)}`);
      }

      for (const fixture of FIXTURES) {
        const result = await uploadFixture(tab.session, fixture);
        summary.uploads.push(result);
      }
    }

    const finalStateRaw = await sendExtMessage(tab.session, { type: "vault:get-state" });
    summary.finalState = {
      ok: finalStateRaw?.ok === true,
      session: finalStateRaw?.session || null,
      settings: finalStateRaw?.settings || null,
      fileCount: Array.isArray(finalStateRaw?.files) ? finalStateRaw.files.length : 0,
      files: Array.isArray(finalStateRaw?.files)
        ? finalStateRaw.files.map((file) => ({
            id: file.id,
            name: file.name,
            status: file.status,
            matchedCounts: file.matchedCounts,
          }))
        : [],
      summary: finalStateRaw?.summary || {},
      auditLogCount: Array.isArray(finalStateRaw?.auditLogs) ? finalStateRaw.auditLogs.length : 0,
    };

    const failedUploads = summary.uploads.filter((item) => item.status === "fail");
    const finalOk = summary.finalState?.ok === true;

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("Chatbot fixture seeding summary");
      console.log(JSON.stringify(summary, null, 2));
    }

    if (!finalOk || failedUploads.length > 0) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Seed failed: ${message}`);
    }
    process.exit(1);
  } finally {
    await closeVaultTab(tab);
  }
}

main();
