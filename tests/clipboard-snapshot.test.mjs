import assert from "node:assert/strict";
import test from "node:test";

import {
  assertElectronClipboardSnapshotRestorable,
  restoreElectronClipboard,
  snapshotElectronClipboard,
  waitForElectronClipboardText,
  withRestoredElectronClipboard,
} from "./e2e/electron/helpers/clipboard-snapshot.mjs";

function clipboardApp(initial) {
  const state = new Map(initial);
  return { state, async evaluate(fn, value) {
    const clipboard = {
      availableFormats: () => [...state.keys()],
      readBuffer: format => Buffer.from(state.get(format) || []),
      readText: () => Buffer.from(state.get("text/plain") || []).toString("utf8"),
      clear: () => state.clear(),
      writeText: text => { state.clear(); state.set("text/plain", Buffer.from(text)); },
      writeBuffer: (format, buffer) => { state.clear(); state.set(format, Buffer.from(buffer)); },
    };
    return fn({ clipboard }, value);
  } };
}

test("snapshot and restore preserve the exact supported plain-text payload", async () => {
  const app = clipboardApp([["text/plain", Buffer.from("before")]]);
  const snapshot = await snapshotElectronClipboard(app);
  app.state.clear(); app.state.set("text/plain", Buffer.from("changed"));
  await restoreElectronClipboard(app, snapshot);
  assert.equal(app.state.get("text/plain").toString(), "before");
});

test("multi-format clipboard fails before the action and before any clipboard mutation", async () => {
  const app = clipboardApp([["text/plain", Buffer.from("before")], ["text/html", Buffer.from("<b>before</b>")]]);
  const initial = [...app.state].map(([format, bytes]) => [format, Buffer.from(bytes)]);
  let actionCalled = false;
  await assert.rejects(withRestoredElectronClipboard(app, async () => { actionCalled = true; }),
    error => error?.code === "CLIPBOARD_SNAPSHOT_NOT_SAFELY_RESTORABLE"
      && error.details.formats.includes("text/html"));
  assert.equal(actionCalled, false);
  assert.deepEqual([...app.state], initial);
  assert.throws(() => assertElectronClipboardSnapshotRestorable({
    formats: ["text/plain", "text/html"], payloads: [],
  }), error => error?.code === "CLIPBOARD_SNAPSHOT_NOT_SAFELY_RESTORABLE");
});

test("a sole zero-byte text flavor is the canonical empty macOS clipboard", async () => {
  const app = clipboardApp([["text/plain", Buffer.alloc(0)]]);
  const snapshot = await snapshotElectronClipboard(app);
  assert.deepEqual(snapshot, { formats: [], payloads: [] });
  app.state.set("text/plain", Buffer.from("temporary"));
  await restoreElectronClipboard(app, snapshot);
  assert.deepEqual([...app.state], []);
});

test("withRestoredElectronClipboard restores a non-empty clipboard after success and failure", async () => {
  for (const throws of [false, true]) {
    const app = clipboardApp([["text/plain", Buffer.from("private")]]);
    const action = async () => {
      app.state.clear(); app.state.set("text/plain", Buffer.from("temporary"));
      if (throws) throw new Error("action failed");
      return "ok";
    };
    if (throws) await assert.rejects(withRestoredElectronClipboard(app, action), /action failed/u);
    else assert.equal(await withRestoredElectronClipboard(app, action), "ok");
    assert.deepEqual([...app.state], [["text/plain", Buffer.from("private")]]);
  }
});

test("restore fails closed when a format payload cannot be restored exactly", async () => {
  const app = clipboardApp([]);
  app.evaluate = async (fn, value) => fn({ clipboard: {
    availableFormats: () => [], readBuffer: () => Buffer.alloc(0), clear() {}, writeBuffer() {},
    writeText() {},
  } }, value);
  await assert.rejects(restoreElectronClipboard(app, {
    formats: ["text/plain"], payloads: [{ format: "text/plain", base64: Buffer.from("x").toString("base64") }],
  }), error => error?.code === "CLIPBOARD_RESTORE_MISMATCH");
});

test("clipboard copy observation accepts bounded propagation and rejects a permanently stale value", async () => {
  const delayed = clipboardApp([["text/plain", Buffer.from("old")]]);
  let reads = 0;
  delayed.evaluate = async (fn, value) => {
    reads += 1;
    if (reads === 2) delayed.state.set("text/plain", Buffer.from("new"));
    return clipboardApp(delayed.state).evaluate(fn, value);
  };
  const observed = await waitForElectronClipboardText(delayed, "new", { timeoutMs: 20, intervalMs: 1 });
  assert.equal(observed.text, "new");
  assert.equal(observed.attempts, 2);

  const stale = clipboardApp([["text/plain", Buffer.from("old")]]);
  await assert.rejects(waitForElectronClipboardText(stale, "new",
    { timeoutMs: 3, intervalMs: 1, staleText: "old" }),
  error => error?.code === "CLIPBOARD_COPY_NOT_OBSERVED" && error.details.expectedLength === 3
      && error.details.stillStale === true && error.details.nfcEqual === false
      && /^[a-f0-9]{64}$/u.test(error.details.actualSha256));
});
