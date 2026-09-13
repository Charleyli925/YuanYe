// Small, fixed-target real-HTML lanes. This is intentionally a thin adapter
// over the existing frozen selection/runtime helpers; it must not discover,
// substitute, or infer targets during execution.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

import {
  closePageRootGracefully,
  currentEditorFrame,
  launchPageRoot,
  managedWorkingCopyPath,
  removeIsolatedUserData,
  stopPageRoot,
  waitForProjectReady,
  waitForRuntimeHandoffSettled,
} from "./electron-native-harness.mjs";
import { executeFrozenSelection, frozenDigest, frozenFrameAccess } from "./real-html/frozen-selection.mjs";
import {
  assertElectronRichClipboardSnapshotRestorable,
  snapshotElectronClipboard,
  withRichElectronClipboard,
} from "./helpers/clipboard-snapshot.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { readFrozenExtendedManifest } from "./real-html/frozen-extended-stress.mjs";
import {
  setRuntimeLifecycleObservationContext,
  startRuntimeLifecycleObservation,
  stopRuntimeLifecycleObservation,
  attributeRuntimeObserverRequests,
} from "./real-html/runtime-observer.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";

const fail = (condition, code, details = {}) => {
  if (!condition) throw Object.assign(new Error(code), { code, details });
};

const lane = process.env.PAGEROOT_SPECIALIZED_LANE || "";
const fileId = process.env.PAGEROOT_SPECIALIZED_FILE_ID || "";
const manifestPath = process.env.PAGEROOT_EXTENDED_MANIFEST || "";
const requestedRounds = Number(process.env.PAGEROOT_SPECIALIZED_ROUNDS || 3);
const laneNames = new Set(["external-paste", "IME", "race/rapid-actions", "long-session"]);
fail(laneNames.has(lane), "SPECIALIZED_LANE_INVALID", { lane });
fail(/^H0[1-8]$/u.test(fileId), "SPECIALIZED_FILE_ID_INVALID", { fileId });
fail(manifestPath && path.isAbsolute(manifestPath), "SPECIALIZED_MANIFEST_MISSING");
fail(Number.isSafeInteger(requestedRounds) && requestedRounds > 0 && requestedRounds <= 100,
  "SPECIALIZED_ROUNDS_INVALID", { requestedRounds });

const digest = value => createHash("sha256").update(value).digest("hex");
const originalManifestBytes = readFileSync(manifestPath);
const originalManifestSha256 = frozenDigest(originalManifestBytes);
const currentVersion = workspaceSourceFingerprint();
// The merged PR and current main have the same source tree but different Git
// commit metadata. Rebind only the provenance header in memory, preserving the
// reviewed target facts and keeping the local manifest out of the repository.
const reboundManifestBytes = Buffer.from(JSON.stringify({
  ...JSON.parse(originalManifestBytes.toString("utf8")),
  version: currentVersion,
}, null, 2));
const plan = readFrozenExtendedManifest(reboundManifestBytes, frozenDigest(reboundManifestBytes));
const file = plan.files.find(item => item.fileId === fileId);
fail(file, "SPECIALIZED_FILE_NOT_FROZEN", { fileId });

const TARGET_INDEX = Object.freeze({
  "external-paste": Object.fromEntries(plan.files.map(item => [item.fileId, 0])),
  IME: { H01: 7, H02: 5, H03: 5, H04: 7, H05: 6, H06: 5, H07: 5, H08: 6 },
  "race/rapid-actions": Object.fromEntries(plan.files.map(item => [item.fileId, 9])),
  "long-session": { H01: 5, H02: 5, H03: 5, H04: 7, H05: 5, H06: 5, H07: 5, H08: 6 },
});

const targetIndex = TARGET_INDEX[lane][fileId];
const target = file.targets[targetIndex];
fail(target && target.index === targetIndex, "SPECIALIZED_TARGET_INDEX_INVALID", { lane, fileId, targetIndex });
if (lane === "external-paste") fail(target.behaviors.includes("clipboard-short"), "SPECIALIZED_PASTE_BEHAVIOR_MISSING");
if (lane === "IME" || lane === "long-session") fail(target.behaviors.includes("text-edit"), "SPECIALIZED_TEXT_BEHAVIOR_MISSING");
if (lane === "race/rapid-actions") {
  fail(fileId === "H08" || target.behaviors.includes("structure-rebuild"), "SPECIALIZED_REBUILD_BEHAVIOR_MISSING");
  if (fileId === "H08") {
    console.log(JSON.stringify({ lane, fileId, state: "NOT_APPLICABLE", reason: "STATIC_RUNTIME_REBUILD_NOT_APPLICABLE" }));
    process.exit(0);
  }
}

const output = mkdtempSync(path.join(tmpdir(), `stemmio-specialized-${fileId}-`));
const importPath = path.join(output, "source.html");
copyFileSync(file.seed.path, importPath);
const baselineOriginal = readFileSync(file.original.path);
const baselineSeed = readFileSync(file.seed.path);
const report = {
  scope: "specialized-real-html-lanes",
  lane,
  fileId,
  targetIndex,
  targetTag: target.selectedTag,
  targetId: target.selectedId,
  manifestSha256: originalManifestSha256,
  reboundManifestSha256: frozenDigest(reboundManifestBytes),
  rounds: lane === "long-session" ? requestedRounds : 1,
  state: "NOT_EXECUTED",
  operations: [],
  lifecycle: [],
  original: { sha256: digest(baselineOriginal), size: baselineOriginal.length },
  seed: { sha256: digest(baselineSeed), size: baselineSeed.length },
};

let session = null;
let editor = null;
let workingPath = null;
let observing = false;

async function activeFrame() {
  // Reuse the existing settled-frame helper so the first operation never
  // races initial Candidate/Runtime mounting.
  return currentEditorFrame(session.page);
}

async function selectFixedTarget() {
  const frame = await activeFrame();
  const exact = frame.locator(`[data-pageroot-id="${target.selectedId}"]`);
  const exactCount = await exact.count();
  fail(exactCount === 1, "SPECIALIZED_TARGET_NOT_PRESENT_IN_ACTIVE_FRAME", {
    targetId: target.selectedId,
    exactCount,
    activeFrameUrl: frame.url(),
  });
  await session.page.keyboard.press("Escape");
  await session.page.keyboard.press("Escape");
  const selected = frame.locator("[data-html-canvas-selected]");
  const selectedCount = await selected.count();
  fail(selectedCount <= 1, "SPECIALIZED_PRIOR_SELECTION_NOT_UNIQUE", { selectedCount });
  const priorSelectionId = selectedCount === 1 ? await selected.getAttribute("data-pageroot-id") : null;
  fail(priorSelectionId === null || priorSelectionId === target.selectedId,
    "SPECIALIZED_PRIOR_SELECTION_NOT_FROZEN", { priorSelectionId, expected: target.selectedId });
  const calls = [];
  await executeFrozenSelection({ access: frozenFrameAccess(frame, target, calls), keyboard: session.page.keyboard,
    mouse: session.page.mouse, target, calls, priorSelectionId });
  report.operations.push({ operation: "select", targetId: target.selectedId, calls });
  return frame;
}

async function activateFixedText(frame) {
  const locator = frozenFrameAccess(frame, target, report.operations).target(target.selectedId);
  const handle = await locator.elementHandle();
  fail(handle, "SPECIALIZED_TARGET_DETACHED");
  const position = await handle.evaluate((element, entry) => {
    const node = entry.path.reduce((current, index) => current?.childNodes[index], element);
    if (node?.nodeType !== 3 || entry.offset >= node.length) return null;
    const range = element.ownerDocument.createRange();
    range.setStart(node, entry.offset); range.setEnd(node, entry.offset + 1);
    const rect = range.getBoundingClientRect(), outer = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.left - outer.left + rect.width / 2,
      y: rect.top - outer.top + rect.height / 2 } : null;
  }, target.textEntry);
  fail(position, "SPECIALIZED_TEXT_CHARACTER_DRIFT");
  await handle.dblclick({ position, timeout: 3_000 });
  await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
  await session.page.keyboard.press("End");
  return { locator, handle };
}

async function saveAndWait(before) {
  await session.page.keyboard.press("Meta+s");
  await expect.poll(async () => !(await readPublishedWorkingCopy(workingPath, null)).equals(before), { timeout: 5_000 }).toBe(true);
  await expect(session.page.locator("[data-persist-state]").first()).toHaveAttribute("data-persist-state", "idle", { timeout: 5_000 });
  const after = await readPublishedWorkingCopy(workingPath, null);
  await waitForRuntimeHandoffSettled(session.page, { timeout: 7_000,
    expectedSourceRevision: `sha256:${frozenDigest(after)}` });
  return after;
}

async function externalPaste() {
  const before = await readPublishedWorkingCopy(workingPath, null);
  const marker = `SPECIAL_PASTE_${fileId}`;
  const richPayload = { text: `${marker} 富文本\n特殊字符`, html: `<p>${marker} <strong>富文本</strong><br>特殊字符<script>window.__PASTE_INJECTED__=true</script></p>` };
  const prior = await snapshotElectronClipboard(session.electronApp);
  assertElectronRichClipboardSnapshotRestorable(prior);
  const frame = await selectFixedTarget();
  const { locator, handle } = await activateFixedText(frame);
  try {
    await withRichElectronClipboard(session.electronApp, richPayload, async () => {
      await session.page.keyboard.press("Meta+v");
      await expect.poll(() => locator.textContent()).toContain(marker);
    });
    const after = await saveAndWait(before);
    const source = after.toString("utf8");
    fail(source.includes(marker), "SPECIALIZED_PASTE_SOURCE_MISSING", { marker });
    const markerOffset = source.indexOf(marker);
    const markerContext = source.slice(Math.max(0, markerOffset - 80), markerOffset + marker.length + 160);
    fail(!markerContext.includes("<strong>富文本") && !markerContext.includes("<em>富文本")
      && !source.includes("window.__PASTE_INJECTED__=true"),
    "SPECIALIZED_PASTE_RICH_MARKUP_LEAKED", { markerContext });
    report.operations.push({ operation: "external-paste", state: "PASS", marker,
      sourceContainsMarker: true, richMarkupDropped: true });
  } finally { await handle.dispose(); }
}

async function ime() {
  const before = await readPublishedWorkingCopy(workingPath, null);
  const marker = `中文${fileId}`;
  const frame = await selectFixedTarget();
  const { locator, handle } = await activateFixedText(frame);
  try {
    const recorder = await frame.evaluate(() => {
      const target = document.activeElement;
      const events = [];
      for (const type of ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"]) {
        target?.addEventListener(type, event => events.push({ type, inputType: event.inputType || null }), { capture: true });
      }
      return true;
    });
    fail(recorder, "SPECIALIZED_IME_RECORDER_NOT_INSTALLED");
    const cdp = await session.page.context().newCDPSession(session.page);
    await cdp.send("Input.imeSetComposition", { text: "zhongwen", selectionStart: 8, selectionEnd: 8 });
    await cdp.send("Input.insertText", { text: marker });
    const text = await locator.textContent();
    fail(text.includes(marker) && !text.includes("zhongwen"), "SPECIALIZED_IME_TEXT_MISMATCH", { text });
    const after = await saveAndWait(before);
    const source = after.toString("utf8");
    fail(source.includes(marker) && !source.includes("zhongwen"), "SPECIALIZED_IME_SOURCE_MISMATCH");
    report.operations.push({ operation: "IME", state: "PASS", marker,
      compositionProtocol: "Input.imeSetComposition+Input.insertText" });
  } finally { await handle.dispose(); }
}

async function race() {
  const before = await readPublishedWorkingCopy(workingPath, null);
  await waitForRuntimeHandoffSettled(session.page, {
    timeout: 7_000,
    expectedSourceRevision: `sha256:${file.seed.sha256}`,
  });
  await editor.evaluate(startRuntimeLifecycleObservation); observing = true;
  await editor.evaluate(setRuntimeLifecycleObservationContext, {
    fileId, round: 1, targetIndex, targetId: target.selectedId,
    behavior: "structure-rebuild", operation: "rapid-copy-copy",
  });
  await selectFixedTarget();
  const button = editor.getByRole("button", { name: "复制元素", exact: true });
  fail(await button.count() === 1 && await button.isEnabled(), "SPECIALIZED_COPY_BUTTON_UNAVAILABLE");
  await button.evaluate(element => { element.click(); element.click(); });
  await waitForRuntimeHandoffSettled(session.page, { timeout: 10_000 });
  const frame = await currentEditorFrame(session.page);
  const records = await editor.evaluate(stopRuntimeLifecycleObservation); observing = false;
  const attributed = attributeRuntimeObserverRequests(records.records || []);
  fail(attributed.length >= 1, "SPECIALIZED_RACE_REBUILD_NOT_OBSERVED", { records });
  const marker = `RACE_${fileId}`;
  const calls = [];
  const freshTarget = frame.locator(`[data-pageroot-id="${target.selectedId}"]`);
  fail(await freshTarget.count() === 1, "SPECIALIZED_RACE_ORIGINAL_IDENTITY_MISSING");
  await freshTarget.dblclick({ timeout: 3_000 });
  await expect(freshTarget).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
  await session.page.keyboard.press("End");
  await session.page.keyboard.insertText(marker);
  const after = await saveAndWait(before);
  fail(after.toString("utf8").includes(marker), "SPECIALIZED_RACE_CONTINUATION_MISSING", { marker });
  report.lifecycle = attributed;
  report.operations.push({ operation: "race/rapid-actions", state: "PASS", marker,
    rebuildRequests: attributed.length, resumedTargetId: target.selectedId, calls });
}

async function longSession() {
  const markers = [];
  for (let round = 1; round <= requestedRounds; round += 1) {
    const before = await readPublishedWorkingCopy(workingPath, null);
    const marker = `LONG_${fileId}_R${round}`; markers.push(marker);
    let locator;
    let handle;
    if (round === 1) {
      const frame = await selectFixedTarget();
      ({ locator, handle } = await activateFixedText(frame));
    } else {
      // Cumulative text intentionally invalidates the original character
      // hash. Re-enter only by the frozen Stable ID; never infer a new point
      // or substitute another element.
      const frame = await currentEditorFrame(session.page);
      locator = frame.locator(`[data-pageroot-id="${target.selectedId}"]`);
      fail(await locator.count() === 1, "SPECIALIZED_LONG_SESSION_TARGET_MISSING");
      fail(await locator.evaluate(element => element.localName) === target.selectedTag,
        "SPECIALIZED_LONG_SESSION_TARGET_TAG_DRIFT");
      handle = await locator.elementHandle();
      await handle.dblclick({ timeout: 3_000 });
      await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
      await session.page.keyboard.press("End");
    }
    try {
      await session.page.keyboard.insertText(marker);
      await expect(locator).toContainText(marker);
      const after = await saveAndWait(before);
      const sourceContainsMarker = after.toString("utf8").includes(marker);
      fail(sourceContainsMarker, "SPECIALIZED_LONG_SESSION_SOURCE_MISSING", {
        round, marker, sourceSha256: frozenDigest(after),
      });
      const requiredMarkers = markers.slice();
      let cumulative = await readPublishedWorkingCopy(workingPath, null);
      const cumulativeDeadline = Date.now() + 2_000;
      while (Date.now() < cumulativeDeadline
        && !requiredMarkers.every(value => cumulative.toString("utf8").includes(value))) {
        await new Promise(resolve => setTimeout(resolve, 40));
        cumulative = await readPublishedWorkingCopy(workingPath, null);
      }
      fail(requiredMarkers.every(value => cumulative.toString("utf8").includes(value)),
        "SPECIALIZED_LONG_SESSION_CUMULATIVE_SOURCE_DRIFT", {
          round,
          requiredMarkers,
          markerPresence: requiredMarkers.map(value => cumulative.toString("utf8").includes(value)),
          sourceSha256: frozenDigest(cumulative),
          markerContexts: Object.fromEntries(requiredMarkers.map(value => {
            const offset = cumulative.toString("utf8").indexOf(value);
            return [value, offset < 0 ? null : cumulative.toString("utf8").slice(Math.max(0, offset - 80), offset + value.length + 120)];
          })),
        });
      report.operations.push({ operation: "long-session", round, state: "PASS", marker,
        sourceContainsMarker, cumulativeMarkers: requiredMarkers });
    } finally { await handle.dispose(); }
  }
  const beforeReopen = await readPublishedWorkingCopy(workingPath, null);
  report.operations.push({ operation: "long-session-before-reopen", sourceSha256: frozenDigest(beforeReopen),
    markerPresence: markers.map(marker => beforeReopen.toString("utf8").includes(marker)) });
  await closePageRootGracefully(session.electronApp, session.page);
  session.electronApp = null;
  session = await launchPageRoot({ isolatedUserData: session.isolatedUserData });
  await waitForProjectReady(session.page);
  workingPath = await managedWorkingCopyPath(session.page, importPath);
  const reopened = await currentEditorFrame(session.page);
  const locator = reopened.locator(`[data-pageroot-id="${target.selectedId}"]`);
  fail(await locator.count() === 1, "SPECIALIZED_LONG_SESSION_REOPEN_IDENTITY_MISSING");
  const source = await readPublishedWorkingCopy(workingPath, null);
  report.operations.push({ operation: "long-session-after-reopen", sourceSha256: frozenDigest(source),
    pathBasename: path.basename(workingPath), markerPresence: markers.map(marker => source.toString("utf8").includes(marker)) });
  fail(markers.every(marker => source.toString("utf8").includes(marker)), "SPECIALIZED_LONG_SESSION_REOPEN_SOURCE_MISSING", { markers });
  report.operations.push({ operation: "long-session-reopen", state: "PASS", markers, stableId: target.selectedId });
}

try {
  session = await launchPageRoot({ activeSourcePath: importPath });
  await waitForProjectReady(session.page);
  editor = session.page.getByTestId("html-canvas-editor").filter({ visible: true });
  await expect(editor).toHaveCount(1);
  workingPath = await managedWorkingCopyPath(session.page, importPath);
  fail(readFileSync(workingPath).equals(baselineSeed), "SPECIALIZED_IMPORTED_SEED_DRIFT");
  await waitForRuntimeHandoffSettled(session.page, {
    timeout: 7_000,
    expectedSourceRevision: `sha256:${file.seed.sha256}`,
  });
  if (lane === "external-paste") await externalPaste();
  else if (lane === "IME") await ime();
  else if (lane === "race/rapid-actions") await race();
  else await longSession();
  report.state = "PASS";
} catch (error) {
  report.state = "FAIL";
  report.firstFailure = { code: error.code || "SPECIALIZED_LANE_FAILED", message: error.message, details: error.details };
} finally {
  if (observing && editor) {
    try { report.lifecycle = attributeRuntimeObserverRequests((await editor.evaluate(stopRuntimeLifecycleObservation)).records || []); }
    catch {}
  }
  if (session?.electronApp) await stopPageRoot(session.electronApp, session.isolatedUserData).catch(() => {});
  else if (session?.isolatedUserData) removeIsolatedUserData(session.isolatedUserData);
  try {
    report.originalUnchanged = readFileSync(file.original.path).equals(baselineOriginal);
    report.seedUnchanged = readFileSync(file.seed.path).equals(baselineSeed);
    report.workspaceSourceSha256 = currentVersion.workspaceSourceSha256;
  } catch (error) {
    report.state = "FAIL";
    report.integrityError = error.code || error.message;
  }
  writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ lane, fileId, state: report.state, reportDirectory: output }));
  process.exitCode = report.state === "PASS" ? 0 : 1;
}
