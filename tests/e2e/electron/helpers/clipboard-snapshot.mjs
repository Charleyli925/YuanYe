import { createHash } from "node:crypto";

const textDigest = value => createHash("sha256").update(value).digest("hex");

export function assertElectronClipboardSnapshotRestorable(snapshot) {
  const formats = Array.isArray(snapshot?.formats) ? snapshot.formats : [];
  const payloads = Array.isArray(snapshot?.payloads) ? snapshot.payloads : [];
  const solePlainText = formats.length === 1 && formats[0] === "text/plain"
    && payloads.length === 1 && payloads[0]?.format === "text/plain"
    && typeof payloads[0]?.base64 === "string";
  const empty = formats.length === 0 && payloads.length === 0;
  if (!empty && !solePlainText) {
    const error = new Error(
      "Electron clipboard contains formats that this harness cannot restore atomically and exactly.",
    );
    error.code = "CLIPBOARD_SNAPSHOT_NOT_SAFELY_RESTORABLE";
    error.details = { formats, payloadFormats: payloads.map(row => row?.format ?? null) };
    throw error;
  }
  return { empty, solePlainText };
}

export async function snapshotElectronClipboard(electronApp) {
  return electronApp.evaluate(({ clipboard }) => {
    const formats = clipboard.availableFormats().sort();
    // macOS can expose a sole zero-byte text/plain flavor for an empty
    // pasteboard, but Electron cannot recreate that representation:
    // writeText("") canonicalizes it to no formats. Treat both as the same
    // empty clipboard while preserving every non-empty or mixed payload.
    if (formats.length === 1 && formats[0] === "text/plain"
      && clipboard.readBuffer("text/plain").length === 0) {
      return { formats: [], payloads: [] };
    }
    return {
      formats,
      payloads: formats.map((format) => ({
        format,
        base64: clipboard.readBuffer(format).toString("base64"),
      })),
    };
  });
}

export async function restoreElectronClipboard(electronApp, snapshot) {
  assertElectronClipboardSnapshotRestorable(snapshot);
  await electronApp.evaluate(({ clipboard }, payloads) => {
    clipboard.clear();
    if (payloads.length === 1) clipboard.writeText(Buffer.from(payloads[0].base64, "base64").toString("utf8"));
  }, snapshot.payloads || []);
  const restored = await snapshotElectronClipboard(electronApp);
  const expectedPayloads = Object.fromEntries((snapshot.payloads || []).map((row) => [row.format, row.base64]));
  const actualPayloads = Object.fromEntries((restored.payloads || []).map((row) => [row.format, row.base64]));
  if (JSON.stringify(restored.formats) !== JSON.stringify(snapshot.formats)
    || JSON.stringify(actualPayloads) !== JSON.stringify(expectedPayloads)) {
    const error = new Error(
      "Electron clipboard did not return to its exact prior formats and payloads.",
    );
    error.code = "CLIPBOARD_RESTORE_MISMATCH";
    error.expected = snapshot.formats;
    error.actual = restored.formats;
    error.details = {
      expectedFormats: snapshot.formats,
      actualFormats: restored.formats,
      payloadMatches: Object.fromEntries([...new Set([...snapshot.formats, ...restored.formats])]
        .map((format) => [format, expectedPayloads[format] === actualPayloads[format]])),
    };
    throw error;
  }
  return restored;
}

export async function withRestoredElectronClipboard(electronApp, action) {
  const snapshot = await snapshotElectronClipboard(electronApp);
  // Reject before action() or clear(): an unsupported existing pasteboard is
  // never made less recoverable merely to run a test.
  assertElectronClipboardSnapshotRestorable(snapshot);
  try {
    return await action();
  } finally {
    await restoreElectronClipboard(electronApp, snapshot);
  }
}

export async function waitForElectronClipboardText(electronApp, expectedText, {
  timeoutMs = 1000,
  intervalMs = 20,
  staleText,
} = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  let actualText = "";
  do {
    attempts += 1;
    actualText = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    if (actualText === expectedText) {
      return { text: actualText, attempts, elapsedMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt >= timeoutMs) break;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (true);
  const error = new Error("Electron clipboard did not publish the exact copied text before the bounded deadline.");
  error.code = "CLIPBOARD_COPY_NOT_OBSERVED";
  error.details = {
    attempts,
    elapsedMs: Date.now() - startedAt,
    expectedLength: expectedText.length,
    actualLength: actualText.length,
    expectedSha256: textDigest(expectedText),
    actualSha256: textDigest(actualText),
    nfcEqual: actualText.normalize("NFC") === expectedText.normalize("NFC"),
    nfkcEqual: actualText.normalize("NFKC") === expectedText.normalize("NFKC"),
    trimEqual: actualText.trim() === expectedText.trim(),
    caseFoldEqual: actualText.toLocaleLowerCase("en-US") === expectedText.toLocaleLowerCase("en-US"),
    stillStale: typeof staleText === "string" && actualText === staleText,
  };
  throw error;
}
