import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect } from "@playwright/test";
import { closePageRootGracefully, keyShortcut, launchPageRoot, managedWorkingCopyPath,
  removeIsolatedUserData, stopPageRoot, waitForProjectReady, waitForRuntimeHandoffSettled }
  from "./electron-native-harness.mjs";
import { waitForElectronClipboardText, withRestoredElectronClipboard } from "./helpers/clipboard-snapshot.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { executeFrozenSelection, frozenDigest, frozenFrameAccess, frozenInitialRuntimeDecision,
  verifyFrozenBytes, verifyFrozenDisplay } from "./real-html/frozen-selection.mjs";
import { executeFrozenStructure } from "./real-html/frozen-structure.mjs";
import { readFrozenActiveGeneration, requireFrozenTextFocus } from "./real-html/frozen-text.mjs";
import { revealFrozenCommentCard, revealFrozenCommentDelete, verifyFrozenComment } from "./real-html/frozen-mixed.mjs";
import { compareElementScopedMutation, compareElementStyleMutation, SOURCE_SCOPE_POLICIES }
  from "./real-html/source-scope.mjs";
import { createExtendedLedger, markRemainingExtendedLedger, readFrozenExtendedManifest,
  clipboardSourceExpectation, verifyAdjacentMove, verifyClipboardTransfer, verifyExtendedFailureStop, verifyExtendedLedger,
  verifyRebuildContinuation }
  from "./real-html/frozen-extended-stress.mjs";
import { attributeRuntimeObserverRequests, setRuntimeLifecycleObservationContext,
  startRuntimeLifecycleObservation, stopRuntimeLifecycleObservation } from "./real-html/runtime-observer.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";
import { EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS } from "../../../app/domain/edit-runtime-contract.js";

const requireFact = (condition, code, details = {}) => {
  if (!condition) throw Object.assign(new Error(code), { code, details });
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const escapeHtmlText = value => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

async function waitInitialRuntime(page, expected, sourceRevision) {
  let decision;
  await expect.poll(async () => {
    const surface = page.getByTestId("workbench-active-document-canvas").filter({ visible: true });
    if (await surface.count() !== 1) return "WAIT";
    decision = frozenInitialRuntimeDecision({ phase: await surface.getAttribute("data-edit-runtime-phase"),
      outcome: await surface.getAttribute("data-edit-runtime-outcome") }, expected);
    return decision.state;
  }, { timeout: EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS + 5_000, intervals: [100, 250, 500] }).toBe("READY");
  return waitForRuntimeHandoffSettled(page, { expectedSourceRevision: sourceRevision });
}

async function activeFrame(editor) {
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  requireFact(await active.count() === 1, "EXTENDED_ACTIVE_FRAME_NOT_UNIQUE");
  const frame = await (await active.elementHandle()).contentFrame();
  requireFact(frame, "EXTENDED_ACTIVE_FRAME_MISSING");
  return frame;
}

let permittedSelectionIds = new Set();
async function selectExact(page, editor, target, calls) {
  const frame = await activeFrame(editor), local = [];
  try {
    // Match preflight's fixed preparation: one real Escape before measuring
    // the selection precondition. It may clear a settled selection or only
    // end Native Edit; both outcomes are explicit below.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const selected = frame.locator("[data-html-canvas-selected]");
    const count = await selected.count();
    requireFact(count <= 1, "EXTENDED_PRIOR_SELECTION_NOT_UNIQUE", { count });
    const priorSelectionId = count === 1 ? await selected.getAttribute("data-pageroot-id") : null;
    requireFact(priorSelectionId === null || permittedSelectionIds.has(priorSelectionId),
      "EXTENDED_PRIOR_SELECTION_NOT_FROZEN", { priorSelectionId });
    const result = await executeFrozenSelection({ access: frozenFrameAccess(frame, target, local),
      keyboard: page.keyboard, mouse: page.mouse, target, calls: local, priorSelectionId });
    return { frame, result };
  } finally { calls.push(...local); }
}

async function activateAtFrozenCharacter(page, frame, target, calls) {
  requireFact(target.textEntry, "EXTENDED_TEXT_ENTRY_MISSING", { targetId: target.selectedId });
  const locator = frozenFrameAccess(frame, target, calls).target(target.selectedId);
  const handle = await locator.elementHandle();
  requireFact(handle, "EXTENDED_TARGET_DETACHED");
  const position = await handle.evaluate((element, entry) => {
    const node = entry.path.reduce((current, index) => current?.childNodes[index], element);
    if (node?.nodeType !== 3 || entry.offset >= node.length) return null;
    const range = element.ownerDocument.createRange();
    range.setStart(node, entry.offset); range.setEnd(node, entry.offset + 1);
    const rect = range.getBoundingClientRect(), outer = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.left - outer.left + rect.width / 2,
      y: rect.top - outer.top + rect.height / 2 } : null;
  }, target.textEntry);
  requireFact(position, "EXTENDED_TEXT_CHARACTER_DRIFT");
  await handle.dblclick({ position, timeout: 3_000 });
  await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
  await page.keyboard.press(keyShortcut("ArrowDown"));
  await requireFrozenTextFocus(handle, target.selectedId,
    { atEnd: true, trailingText: target.textEntry.trailingText || "" });
  return { locator, handle };
}

async function saveChanged(page, readSource, before) {
  await page.keyboard.press(keyShortcut("s"));
  await expect.poll(async () => !(await readSource()).equals(before), { timeout: 5_000 }).toBe(true);
  const indicator = page.locator("[data-persist-state]").first();
  await expect(indicator).toHaveAttribute("data-persist-state", "idle", { timeout: 5_000 });
  return readSource();
}

async function restoreBaseline({ page, editor, readSource, baseline }) {
  const attempts = [];
  for (let index = 0; index < 8 && !(await readSource()).equals(baseline); index += 1) {
    const prior = await readSource();
    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(async () => !(await readSource()).equals(prior), { timeout: 5_000 }).toBe(true);
    const current = await readSource();
    await waitForRuntimeHandoffSettled(page, { timeout: 7_000,
      expectedSourceRevision: `sha256:${frozenDigest(current)}` });
    attempts.push(frozenDigest(current));
  }
  const current = await readSource(), restored = current.equals(baseline);
  requireFact(restored, "EXTENDED_SOURCE_RESTORE_FAILED", { attempts,
    expectedSha256: frozenDigest(baseline), actualSha256: frozenDigest(current) });
  verifyFrozenDisplay({ working: await editor.getAttribute("data-working-source-sha256"),
    displayed: await editor.getAttribute("data-rendered-projection-sha256") },
  { sha256: frozenDigest(baseline), size: baseline.length });
  return { restored, undoCount: attempts.length };
}

async function textMutation({ page, editor, target, calls, readSource, marker, newline = false }) {
  const baseline = await readSource();
  const { frame } = await selectExact(page, editor, target, calls);
  const { handle } = await activateAtFrozenCharacter(page, frame, target, calls);
  try {
    const beforeText = await handle.textContent();
    const inserted = newline ? [`${marker}_A`, `${marker}_B`, `${marker}_C`] : [marker];
    if (newline) {
      // A trailing collapsible space immediately before Enter is allowed to be
      // discarded by Chromium. Put the space between two real text runs so the
      // test proves both Space and Enter without depending on that browser
      // normalization boundary.
      await page.keyboard.type(`${inserted[0]} ${inserted[1]}`);
      await page.keyboard.press("Enter");
      await page.keyboard.type(inserted[2]);
    } else await page.keyboard.type(marker);
    const liveText = await handle.textContent();
    requireFact(inserted.every(value => liveText.includes(value)), "EXTENDED_TEXT_INPUT_LANDING_FAILED",
      { targetId: target.selectedId, inserted, liveText });
    const after = await saveChanged(page, readSource, baseline);
    const oracle = compareElementScopedMutation({ before: baseline, after, sourceId: target.selectedId,
      normalizationPolicy: newline ? SOURCE_SCOPE_POLICIES.TEXT_NEWLINE : SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
      allowAttributeOrderOnly: true, expectedAfterContains: inserted, expectedAppendedPattern: newline
        ? new RegExp(`${escapeRegex(inserted[0])} ${escapeRegex(inserted[1])}`
          + `<br data-pageroot-id="pr1_[0-9a-f]{32}">${escapeRegex(inserted[2])}`, "u")
        : new RegExp(escapeRegex(marker), "u") });
    requireFact(oracle.ok, "EXTENDED_TEXT_SOURCE_SCOPE_FAILED", oracle);
    const restore = await restoreBaseline({ page, editor, readSource, baseline });
    return { beforeLength: beforeText.length, afterLength: liveText.length, changedRanges: oracle.changedRanges,
      outsideUnchanged: oracle.outsideUnchanged, restore };
  } finally { await handle.dispose(); }
}

async function clipboardMutation({ electronApp, page, editor, target, calls, readSource, marker, large }) {
  return withRestoredElectronClipboard(electronApp, async () => {
    const clipboardSentinel = `PRCLIP_${marker}`;
    await electronApp.evaluate(({ clipboard }, sentinelText) => clipboard.writeText(sentinelText), clipboardSentinel);
    const sentinelObserved = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    requireFact(sentinelObserved === clipboardSentinel, "CLIPBOARD_SENTINEL_NOT_OBSERVED");
    const baseline = await readSource();
    const { frame } = await selectExact(page, editor, target, calls);
    const { handle } = await activateAtFrozenCharacter(page, frame, target, calls);
    try {
      const beforeText = await handle.textContent();
      const beforeRenderedText = await handle.evaluate(element => element.innerText);
      const selectable = beforeText;
      const length = Math.min(large ? 80 : 4, selectable.length);
      requireFact(length >= (large ? Math.min(20, selectable.length) : 1), "EXTENDED_CLIPBOARD_TEXT_TOO_SHORT");
      await page.keyboard.down("Shift");
      for (let index = 0; index < length; index += 1) await page.keyboard.press("ArrowLeft");
      await page.keyboard.up("Shift");
      const selectionTexts = await handle.evaluate((element) => {
        const selection = element.ownerDocument.getSelection();
        const rendered = selection?.toString() || "";
        if (!selection?.rangeCount) return { rendered, authored: "" };
        const fragment = selection.getRangeAt(0).cloneContents();
        const authored = (node) => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
          if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === "BR") return "\n";
          return [...node.childNodes].map(authored).join("");
        };
        return { rendered, authored: authored(fragment) };
      });
      requireFact(selectionTexts.rendered.length === length, "EXTENDED_NATIVE_SELECTION_LENGTH_MISMATCH",
        { expected: length, actual: selectionTexts.rendered.length });
      requireFact(selectionTexts.authored.length > 0, "EXTENDED_AUTHORED_SELECTION_EMPTY");
      await page.keyboard.press(keyShortcut("c"));
      const clipboardObservation = await waitForElectronClipboardText(electronApp, selectionTexts.authored,
        { staleText: clipboardSentinel });
      const clipboardText = clipboardObservation.text;
      await page.keyboard.press(keyShortcut("ArrowDown"));
      await page.keyboard.type(marker);
      await page.keyboard.press(keyShortcut("v"));
      const afterRenderedText = await handle.evaluate(element => element.innerText);
      const transfer = verifyClipboardTransfer({ selectedText: selectionTexts.authored,
        renderedSelectedText: selectionTexts.rendered, clipboardText,
        beforeText: `${beforeRenderedText}${marker}`, afterText: afterRenderedText,
        appendedText: clipboardText });
      const after = await saveChanged(page, readSource, baseline);
      const sourceExpectation = clipboardSourceExpectation(marker, clipboardText);
      const oracle = compareElementScopedMutation({ before: baseline, after, sourceId: target.selectedId,
        normalizationPolicy: sourceExpectation.lineBreakCount > 0
          ? SOURCE_SCOPE_POLICIES.TEXT_NEWLINE : SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
        expectedFreshStableIdCount: sourceExpectation.lineBreakCount,
        allowAttributeOrderOnly: true,
        expectedAfterContains: [marker], expectedAppendedPattern: new RegExp(
          sourceExpectation.pattern.source, "u") });
      requireFact(oracle.ok, "EXTENDED_CLIPBOARD_SOURCE_SCOPE_FAILED", oracle);
      const restore = await restoreBaseline({ page, editor, readSource, baseline });
      return { length, selectedSha256: frozenDigest(selectionTexts.authored),
        renderedSelectedSha256: frozenDigest(selectionTexts.rendered), transfer,
        clipboardObservation: { attempts: clipboardObservation.attempts, elapsedMs: clipboardObservation.elapsedMs },
        changedRanges: oracle.changedRanges, outsideUnchanged: oracle.outsideUnchanged, restore };
    } finally { await handle.dispose(); }
  });
}

async function formatMutation({ page, editor, target, calls, readSource }) {
  const baseline = await readSource();
  await selectExact(page, editor, target, calls);
  const button = editor.getByRole("button", { name: "加粗", exact: true });
  await expect(button).toHaveCount(1);
  const initial = await button.getAttribute("aria-pressed") === "true";
  requireFact(initial === target.initialBold, "EXTENDED_FORMAT_INITIAL_STATE_DRIFT", { initial, expected: target.initialBold });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(!initial));
  const changed = await saveChanged(page, readSource, baseline);
  const oracle = compareElementStyleMutation({ before: baseline, after: changed, sourceId: target.selectedId,
    expectedProperty: "font-weight", expectedValue: initial ? "normal" : "700" });
  requireFact(oracle.ok, "EXTENDED_FORMAT_SOURCE_SCOPE_FAILED", oracle);
  const restore = await restoreBaseline({ page, editor, readSource, baseline });
  return { from: initial, to: !initial, changedRanges: oracle.changedRanges,
    outsideUnchanged: oracle.outsideElementUnchanged, restore };
}

async function moveMutation({ page, editor, target, calls, readSource }) {
  const baseline = await readSource(), { frame } = await selectExact(page, editor, target, calls);
  const locator = frozenFrameAccess(frame, target, calls).target(target.selectedId);
  const before = await locator.evaluate(element => [...element.parentElement.children]
    .map(child => child.getAttribute("data-pageroot-id")).filter(Boolean));
  const label = target.moveDirection === "up" ? "上移" : "下移";
  await editor.getByRole("button", { name: label, exact: true }).click({ timeout: 2_000 });
  const moved = await saveChanged(page, readSource, baseline);
  await waitForRuntimeHandoffSettled(page, { timeout: 7_000, expectedSourceRevision: `sha256:${frozenDigest(moved)}` });
  const movedFrame = await activeFrame(editor), movedLocator = frozenFrameAccess(movedFrame, target, calls).target(target.selectedId);
  const after = await movedLocator.evaluate(element => [...element.parentElement.children]
    .map(child => child.getAttribute("data-pageroot-id")).filter(Boolean));
  const oracle = verifyAdjacentMove({ before, after, targetId: target.selectedId, direction: target.moveDirection });
  await selectExact(page, editor, target, calls);
  await editor.getByRole("button", { name: target.moveDirection === "up" ? "下移" : "上移", exact: true }).click({ timeout: 2_000 });
  await expect.poll(async () => (await readSource()).equals(baseline), { timeout: 5_000 }).toBe(true);
  await waitForRuntimeHandoffSettled(page, { timeout: 7_000, expectedSourceRevision: `sha256:${frozenDigest(baseline)}` });
  return { oracle, movedSha256: frozenDigest(moved), restored: true };
}

async function commentMutation({ page, editor, target, calls, readSource, readComments, marker }) {
  const baseline = await readSource();
  await selectExact(page, editor, target, calls);
  await editor.getByRole("button", { name: /留评论/u }).click({ timeout: 2_000 });
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" }).fill(marker);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  let match;
  await expect.poll(async () => {
    const matches = (await readComments()).filter(comment => comment.text === marker);
    match = matches.length === 1 ? matches[0] : null; return matches.length;
  }, { timeout: 5_000 }).toBe(1);
  const expected = { commentId: match.commentId, text: marker, targetId: target.selectedId };
  const created = verifyFrozenComment(match, expected);
  const card = await revealFrozenCommentCard(page, expected);
  const button = await revealFrozenCommentDelete(card); await button.click();
  await card.getByRole("button", { name: "删除", exact: true }).click({ timeout: 2_000 });
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await readComments()).some(comment => comment.commentId === match.commentId),
    { timeout: 5_000 }).toBe(false);
  verifyFrozenBytes(await readSource(), { sha256: frozenDigest(baseline), size: baseline.length }, "COMMENT_CHANGED_SOURCE");
  return { created, deleted: true };
}

async function reactivation({ page, editor, target, calls }) {
  const first = await selectExact(page, editor, target, calls);
  const firstEdit = await activateAtFrozenCharacter(page, first.frame, target, calls);
  await page.keyboard.press("Escape"); await firstEdit.handle.dispose();
  const second = await selectExact(page, editor, target, calls);
  const secondEdit = await activateAtFrozenCharacter(page, second.frame, target, calls);
  const focus = await requireFrozenTextFocus(secondEdit.handle, target.selectedId,
    { atEnd: true, trailingText: target.textEntry.trailingText || "" });
  await page.keyboard.press("Escape"); await secondEdit.handle.dispose();
  return { selectedTwice: true, focus: focus.conditions };
}

async function rebuildContinuationMutation({ page, editor, target, calls, readSource, marker }) {
  const baseline = await readSource();
  const { frame } = await selectExact(page, editor, target, calls);
  const { handle } = await activateAtFrozenCharacter(page, frame, target, calls);
  try {
    await page.keyboard.type(marker);
    const liveText = await handle.textContent();
    const selected = frame.locator("[data-html-canvas-selected]");
    const selectedId = await selected.count() === 1
      ? await selected.getAttribute("data-pageroot-id") : null;
    const focusedId = await handle.evaluate(element => element.ownerDocument.activeElement
      ?.closest?.("[data-pageroot-id]")?.getAttribute("data-pageroot-id") || null);
    const after = await saveChanged(page, readSource, baseline);
    const sourceText = after.toString("utf8");
    const oracle = compareElementScopedMutation({ before: baseline, after, sourceId: target.selectedId,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE, allowAttributeOrderOnly: true,
      expectedAfterContains: [marker], expectedAppendedPattern: new RegExp(escapeRegex(marker), "u") });
    const expectedHash = `sha256:${frozenDigest(after)}`;
    await expect.poll(async () => ({ working: await editor.getAttribute("data-working-source-sha256"),
      displayed: await editor.getAttribute("data-rendered-projection-sha256") }),
    { timeout: 5_000, intervals: [50, 100, 250] }).toEqual({ working: expectedHash, displayed: expectedHash });
    const display = verifyFrozenDisplay({ working: await editor.getAttribute("data-working-source-sha256"),
      displayed: await editor.getAttribute("data-rendered-projection-sha256") },
    { sha256: frozenDigest(after), size: after.length });
    const restore = await restoreBaseline({ page, editor, readSource, baseline });
    const conditions = verifyRebuildContinuation({ targetId: target.selectedId, selectedId, focusedId, marker, liveText,
      sourceContainsMarker: sourceText.includes(marker), sourceScopeOk: oracle.ok,
      outsideUnchanged: oracle.outsideUnchanged, workingMatches: display.workingMatches,
      displayedMatches: display.displayedMatches, restored: restore.restored });
    return { conditions, changedRanges: oracle.changedRanges, restore };
  } finally { await handle.dispose(); }
}

async function runTarget({ electronApp, page, editor, target, targetIndex, round, calls, readSource, readComments, fileId }) {
  const actual = [];
  const marker = `PRX_${fileId}_R${round}_T${targetIndex}`;
  const has = behavior => target.behaviors.includes(behavior);
  const execute = async (behavior, operation, action) => {
    await editor.evaluate(setRuntimeLifecycleObservationContext, {
      fileId, round, targetIndex, targetId: target.selectedId, behavior, operation,
    });
    return action();
  };
  if (has("clipboard-short")) actual.push({ behavior: "clipboard-short", result: await execute(
    "clipboard-short", "copy-paste-short-text", () => clipboardMutation(
      { electronApp, page, editor, target, calls, readSource, marker, large: false })) });
  if (has("space-enter")) actual.push({ behavior: "space-enter", result: await execute(
    "space-enter", "insert-space-and-enter", () => textMutation(
      { page, editor, target, calls, readSource, marker, newline: true })) });
  if (has("clipboard-large")) actual.push({ behavior: "clipboard-large", result: await execute(
    "clipboard-large", "copy-paste-large-text", () => clipboardMutation(
      { electronApp, page, editor, target, calls, readSource, marker, large: true })) });
  if (has("format")) actual.push({ behavior: "format", result: await execute(
    "format", "toggle-bold", () => formatMutation({ page, editor, target, calls, readSource })) });
  if (has("move")) actual.push({ behavior: "move", result: await execute(
    "move", "move-and-restore-element", () => moveMutation({ page, editor, target, calls, readSource })) });
  if (has("comment-delete")) actual.push({ behavior: "comment-delete", result: await execute(
    "comment-delete", "create-and-delete-comment", () => commentMutation(
      { page, editor, target, calls, readSource, readComments, marker: `PRCOMMENT_${marker}` })) });
  if (has("reactivate")) actual.push({ behavior: "reactivate", result: await execute(
    "reactivate", "reactivate-twice", () => reactivation({ page, editor, target, calls })) });
  if (has("text-edit")) actual.push({ behavior: "text-edit", result: await execute(
    "text-edit", "edit-and-restore-text", () => textMutation(
      { page, editor, target, calls, readSource, marker, newline: false })) });
  if (has("structure-rebuild")) {
    const result = await execute("structure-rebuild", "copy-edit-delete-element", async () => {
      await selectExact(page, editor, target, calls);
      const rows = target.operations.map(operation => ({ operation, targetId: target.selectedId,
        state: "NOT_EXECUTED", reason: "DEPENDENCY_NOT_COMPLETED", durationMs: null }));
      const value = await executeFrozenStructure({ frame: await activeFrame(editor), target, page, editor,
        fileId: `${fileId}_R${round}`, readSource, rows, calls });
      return { value, rows };
    });
    actual.push({ behavior: "structure-rebuild", result: result.value, operations: result.rows });
  }
  if (has("reactivate-rebuild")) actual.push({ behavior: "reactivate-rebuild",
    result: await execute("reactivate-rebuild", "continue-edit-after-rebuild", () => rebuildContinuationMutation(
      { page, editor, target: target.continuationTarget, calls, readSource, marker: `PRCONT_${marker}` })) });
  requireFact(actual.length === target.behaviors.length, "EXTENDED_BEHAVIOR_LEDGER_MISMATCH",
    { expected: target.behaviors, actual: actual.map(item => item.behavior) });
  return actual;
}

const manifestPath = process.env.PAGEROOT_EXTENDED_MANIFEST;
const manifestSha256 = process.env.PAGEROOT_EXTENDED_MANIFEST_SHA256;
const requestedFileId = process.env.PAGEROOT_EXTENDED_FILE_ID;
const manifestBytes = readFileSync(manifestPath);
const plan = readFrozenExtendedManifest(manifestBytes, manifestSha256, frozenDigest);
const file = plan.files.find(item => item.fileId === requestedFileId);
requireFact(file, "EXTENDED_FILE_NOT_FROZEN", { requestedFileId });
permittedSelectionIds = new Set(file.targets.flatMap(target => [target.selectedId,
  target.continuationTarget?.selectedId].filter(Boolean)));
const version = workspaceSourceFingerprint();
requireFact(version.workspaceSourceSha256 === plan.version.workspaceSourceSha256, "EXTENDED_SOURCE_VERSION_MISMATCH");
verifyFrozenBytes(readFileSync(file.original.path), file.original, "ORIGINAL_CHANGED");
verifyFrozenBytes(readFileSync(file.seed.path), file.seed, "FROZEN_SEED_CHANGED");

const output = mkdtempSync(path.join(tmpdir(), `stemmio-extended-${file.fileId}-`));
const importPath = path.join(output, "source.html"); copyFileSync(file.seed.path, importPath);
const report = { scope: plan.scope, qualification: false, fileId: file.fileId, version,
  manifestSha256, state: "NOT_EXECUTED", rows: createExtendedLedger(file.targets.length, plan.rounds, file.targets),
  checkpoints: [], calls: [] };
let session, workingPath, editor, observerStarted = false;
try {
  session = await launchPageRoot({ activeSourcePath: importPath }); const page = session.page;
  await waitForProjectReady(page);
  editor = page.getByTestId("html-canvas-editor").filter({ visible: true });
  await expect(editor).toHaveCount(1); await expect(editor).toHaveAttribute("aria-readonly", "false");
  report.initialRuntime = await waitInitialRuntime(page, file.runtime, `sha256:${file.seed.sha256}`);
  await editor.evaluate(startRuntimeLifecycleObservation); observerStarted = true;
  workingPath = await managedWorkingCopyPath(page, importPath);
  verifyFrozenBytes(readFileSync(workingPath), file.seed, "IMPORTED_IDENTITY_BYTES_CHANGED");
  const control = path.join(path.dirname(workingPath), ".pageroot");
  const manifest = JSON.parse(readFileSync(path.join(control, "manifest.json")));
  requireFact(manifest.workingCopies?.length === 1, "EXTENDED_WORKING_COPY_NOT_UNIQUE");
  const draftPath = path.join(control, "drafts", `${manifest.workingCopies[0].workingCopyId}.json`);
  const readSource = () => readPublishedWorkingCopy(workingPath, null);
  const readComments = () => existsSync(draftPath) ? JSON.parse(readFileSync(draftPath)).comments || [] : [];
  for (let round = 1; round <= plan.rounds; round += 1) {
    for (let targetIndex = 0; targetIndex < file.targets.length; targetIndex += 1) {
      const target = file.targets[targetIndex], rowIndex = (round - 1) * file.targets.length + targetIndex;
      const row = report.rows[rowIndex]; Object.assign(row, { tag: target.selectedTag });
      const started = performance.now();
      try {
        row.actual = await runTarget({ electronApp: session.electronApp, page, editor, target, targetIndex,
          round, calls: report.calls, readSource, readComments, fileId: file.fileId });
        Object.assign(row, { state: "PASS", reason: "ALL_FROZEN_TARGET_BEHAVIORS_PASSED" });
      } catch (error) {
        Object.assign(row, { state: "FAIL", reason: error.code || "EXTENDED_TARGET_FAILED", details: error.details });
        markRemainingExtendedLedger(report.rows, rowIndex + 1);
        throw error;
      } finally { row.durationMs = performance.now() - started; }
    }
    if (round === 5 || round === plan.rounds) {
      const rows = report.rows.filter(row => row.round <= round);
      report.checkpoints.push({ round, ledger: verifyExtendedLedger(rows, file.targets.length, round),
        source: verifyFrozenBytes(await readSource(), file.seed, "EXTENDED_CHECKPOINT_SOURCE_DRIFT"),
        display: verifyFrozenDisplay({ working: await editor.getAttribute("data-working-source-sha256"),
          displayed: await editor.getAttribute("data-rendered-projection-sha256") }, file.seed),
        commentsEmpty: readComments().length === 0 });
      requireFact(report.checkpoints.at(-1).commentsEmpty, "EXTENDED_COMMENT_LEAK");
    }
  }
  report.lifecycle = await editor.evaluate(stopRuntimeLifecycleObservation); observerStarted = false;
  report.lifecycle.requestAttributions = attributeRuntimeObserverRequests(report.lifecycle.records);
  await closePageRootGracefully(session.electronApp, page); session.electronApp = null;
  session = await launchPageRoot({ isolatedUserData: session.isolatedUserData });
  await waitForProjectReady(session.page);
  const reopened = session.page.getByTestId("html-canvas-editor").filter({ visible: true });
  await expect(reopened).toHaveCount(1);
  await waitInitialRuntime(session.page, file.runtime, `sha256:${file.seed.sha256}`);
  const reopenedFrame = await activeFrame(reopened);
  for (const target of file.targets) {
    const locator = frozenFrameAccess(reopenedFrame, target, report.calls).target(target.selectedId);
    requireFact(await locator.count() === 1 && await locator.evaluate(element => element.localName) === target.selectedTag,
      "EXTENDED_REOPEN_IDENTITY_FAILED", { targetId: target.selectedId });
  }
  report.reopen = { state: "PASS", reason: "ALL_FROZEN_IDENTITIES_AND_BASELINE_REOPENED" };
  report.state = "PASS";
} catch (error) {
  report.state = "FAIL"; report.firstFailure = { code: error.code || error.name,
    message: error.message, details: error.details, localStack: error.stack };
  try { report.failureStop = verifyExtendedFailureStop(report.rows, file.targets.length, plan.rounds); }
  catch (ledgerError) { report.failureStopError = { code: ledgerError.code, details: ledgerError.details }; }
  if (editor && observerStarted) {
    try { report.lifecycle = await editor.evaluate(stopRuntimeLifecycleObservation); observerStarted = false;
      report.lifecycle.requestAttributions = attributeRuntimeObserverRequests(report.lifecycle.records); }
    catch (captureError) { report.lifecycleCaptureError = captureError.message; }
  }
  if (session?.page) await session.page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  if (workingPath) {
    try { writeFileSync(path.join(output, "after.html"), await readPublishedWorkingCopy(workingPath, null)); }
    catch (captureError) { report.sourceCaptureError = captureError.message; }
  }
} finally {
  if (session) {
    try { if (session.electronApp) await stopPageRoot(session.electronApp, session.isolatedUserData);
      else removeIsolatedUserData(session.isolatedUserData); report.cleanup = "PASS"; }
    catch (error) { report.state = "FAIL"; report.cleanup = "FAIL"; report.cleanupError = error.message; }
  }
  try {
    report.original = verifyFrozenBytes(readFileSync(file.original.path), file.original, "ORIGINAL_CHANGED");
    verifyFrozenBytes(readFileSync(file.seed.path), file.seed, "FROZEN_SEED_CHANGED");
    requireFact(frozenDigest(readFileSync(manifestPath)) === manifestSha256, "EXTENDED_MANIFEST_CHANGED");
    requireFact(workspaceSourceFingerprint().workspaceSourceSha256 === version.workspaceSourceSha256,
      "EXTENDED_SOURCE_CHANGED_DURING_RUN");
  } catch (error) { report.state = "FAIL"; report.finalIntegrityError = error.code || error.message; }
  writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fileId: file.fileId, state: report.state, reportDirectory: output }));
  process.exitCode = report.state === "PASS" ? 0 : 1;
}
