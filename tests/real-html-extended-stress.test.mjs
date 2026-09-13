import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { EXTENDED_BEHAVIORS, createExtendedLedger, markRemainingExtendedLedger,
  clipboardSourceExpectation, readFrozenExtendedManifest, verifyAdjacentMove, verifyClipboardTransfer,
  verifyExtendedFailureStop, verifyExtendedLedger, verifyRebuildContinuation }
  from "./e2e/electron/real-html/frozen-extended-stress.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const id = n => `pr1_${n.toString(16).padStart(32, "0")}`;
const textEntry = { path: [0], offset: 0, textSha256: "a".repeat(64), trailingText: "" };
const baseTarget = (n, index, behaviors) => ({ index, clickId: id(n), selectedId: id(n), mapping: "self",
  clickTag: "p", selectedTag: "p", tabId: null, scrollContainer: "document",
  scrollBlock: "center",
  selectionClick: "frozen-text-character", textEntry, initialBold: false,
  moveDirection: "up",
  capabilities: ["selection", "text", "format", "comment", "copy", "move-up", "move-down"], behaviors });
const file = n => {
  const targets = Array.from({ length: 10 }, (_, index) => baseTarget(n * 20 + index + 1, index,
    index === 0 ? EXTENDED_BEHAVIORS.filter(value => !value.includes("rebuild")) : ["text-edit"]));
  const structure = baseTarget(n * 20 + 10, 9, ["structure-rebuild", "reactivate-rebuild"]);
  Object.assign(structure, { copyBinding: { kind: "inserted-leaf-at-frozen-source-offset", parentId: id(n * 20 + 12),
    beforeSiblingId: null, byteOffset: 10, originalElementSha256: "b".repeat(64) },
  rebuildPath: n === 8 ? "static-rebuild" : "runtime-candidate", operations: ["copy"],
  continuationTarget: { clickId: targets[1].clickId, selectedId: targets[1].selectedId, mapping: "self",
    clickTag: "p", selectedTag: "p", tabId: null, scrollContainer: "document",
    scrollBlock: "center",
    selectionClick: "frozen-text-character", textEntry } });
  targets[9] = structure;
  return { fileId: `H0${n}`, runtime: n === 8 ? "static" : "runtime",
    original: { path: "/tmp/original.html", sha256: "c".repeat(64), size: 1 },
    seed: { path: "/tmp/seed.html", sha256: "d".repeat(64), size: 1 },
    structureManifestPath: "/tmp/structure.json", targets };
};
const manifest = () => ({ schemaVersion: 1, scope: "extended-ten-element-stress", reviewStatus: "FROZEN",
  reviewedBy: "root", rounds: 10, version: { head: "1".repeat(40), tree: "2".repeat(40),
    workspaceSourceSha256: "3".repeat(64), untrackedFileCount: 0 },
  files: Array.from({ length: 8 }, (_, index) => file(index + 1)) });

test("extended manifest freezes exactly eight files and ten distinct targets with all behaviors", () => {
  const plan = manifest(), bytes = Buffer.from(JSON.stringify(plan));
  assert.equal(readFrozenExtendedManifest(bytes, digest(bytes), digest).files.length, 8);
  for (const mutate of [p => p.files[0].targets.pop(),
    p => { p.files[0].targets[1].selectedId = p.files[0].targets[0].selectedId; },
    p => { p.files[0].targets[0].behaviors = []; },
    p => { p.files[0].targets[9].continuationTarget.selectedId = id(999); }]) {
    const changed = manifest(); mutate(changed); const changedBytes = Buffer.from(JSON.stringify(changed));
    assert.throws(() => readFrozenExtendedManifest(changedBytes, digest(changedBytes), digest));
  }
  assert.throws(() => readFrozenExtendedManifest(bytes, "0".repeat(64), digest), /DIGEST/u);
});

test("move oracle accepts one adjacent swap and rejects direction, distance and identity errors", () => {
  assert.equal(verifyAdjacentMove({ before: ["a", "b", "c"], after: ["b", "a", "c"],
    targetId: "b", direction: "up" }).exactAdjacentSwap, true);
  for (const after of [["a", "c", "b"], ["b", "c", "a"], ["a", "b", "c"]])
    assert.throws(() => verifyAdjacentMove({ before: ["a", "b", "c"], after, targetId: "b", direction: "up" }), /MOVE_ORACLE/u);
});

test("clipboard oracle requires exact nonempty selected, copied and appended text", () => {
  assert.equal(verifyClipboardTransfer({ selectedText: "字", clipboardText: "字", beforeText: "A",
    afterText: "A字", appendedText: "字" }).clipboardExact, true);
  for (const patch of [{ selectedText: "" }, { clipboardText: "x" }, { afterText: "字A" }])
    assert.throws(() => verifyClipboardTransfer({ selectedText: "字", clipboardText: "字", beforeText: "A",
      afterText: "A字", appendedText: "字", ...patch }), /CLIPBOARD_ORACLE/u);
});

test("clipboard oracle compares rendered line breaks exactly and rejects a wrong paste landing", () => {
  const selectedText = "副标题\n尾部";
  const beforeText = "标题\n副标题\n尾部__MARK__";
  assert.equal(verifyClipboardTransfer({ selectedText, clipboardText: selectedText, beforeText,
    afterText: `${beforeText}${selectedText}`, appendedText: selectedText }).targetExact, true);
  assert.throws(() => verifyClipboardTransfer({ selectedText, clipboardText: selectedText, beforeText,
    afterText: `${beforeText}副标题尾部`, appendedText: selectedText }), /CLIPBOARD_ORACLE/u);
});

test("clipboard oracle separates authored clipboard text from CSS-transformed rendered text", () => {
  assert.equal(verifyClipboardTransfer({ selectedText: "fing", renderedSelectedText: "FING",
    clipboardText: "fing", beforeText: "TITLE__MARK__", afterText: "TITLE__MARK__FING",
    appendedText: "fing" }).targetExact, true);
  assert.throws(() => verifyClipboardTransfer({ selectedText: "fing", renderedSelectedText: "FING",
    clipboardText: "FING", beforeText: "TITLE__MARK__", afterText: "TITLE__MARK__FING",
    appendedText: "FING" }), /CLIPBOARD_ORACLE/u);
});

test("clipboard source expectation requires one fresh br identity per rendered line break", () => {
  const marker = "__MARK__";
  const { pattern, lineBreakCount } = clipboardSourceExpectation(marker, "甲\n乙\n丙");
  assert.equal(lineBreakCount, 2);
  assert.equal(pattern.test(`${marker}甲<br data-pageroot-id="${id(91)}">乙<br data-pageroot-id="${id(92)}">丙`), true);
  assert.equal(pattern.test(`${marker}甲乙丙`), false);
});

test("rebuild continuation requires exact landing, saved scoped input, display agreement and restoration", () => {
  const targetId = id(94), marker = "PRCONT_H01_R1_T9";
  const good = { targetId, selectedId: targetId, focusedId: targetId, marker,
    liveText: `before${marker}`, sourceContainsMarker: true, sourceScopeOk: true,
    outsideUnchanged: true, workingMatches: true, displayedMatches: true, restored: true };
  assert.equal(verifyRebuildContinuation(good).inputLanded, true);
  for (const patch of [{ focusedId: id(95) }, { liveText: "before" }, { sourceContainsMarker: false },
    { sourceScopeOk: false }, { outsideUnchanged: false }, { displayedMatches: false }, { restored: false }]) {
    assert.throws(() => verifyRebuildContinuation({ ...good, ...patch }),
      error => error?.code === "EXTENDED_REBUILD_CONTINUATION_FAILED"
        && Object.values(error.details.conditions).includes(false));
  }
});

test("ledger rejects missing, failed, unknown and duplicate target-round rows", () => {
  const rows = createExtendedLedger(10, 2);
  rows.forEach(row => Object.assign(row, { state: "PASS", reason: "OBSERVED", durationMs: 1 }));
  assert.equal(verifyExtendedLedger(rows, 10, 2).allPass, true);
  for (const mutate of [r => r.pop(), r => { r[0].state = "FAIL"; }, r => { r[0].reason = ""; },
    r => { r[1].targetIndex = 0; }]) {
    const copy = structuredClone(rows); mutate(copy);
    assert.throws(() => verifyExtendedLedger(copy, 10, 2), /LEDGER/u);
  }
});

test("first failure leaves a complete NOT_EXECUTED suffix", () => {
  const rows = createExtendedLedger(2, 2);
  Object.assign(rows[0], { state: "PASS", reason: "OK", durationMs: 1 });
  Object.assign(rows[1], { state: "FAIL", reason: "FIRST", durationMs: 1 });
  markRemainingExtendedLedger(rows, 2);
  assert.equal(verifyExtendedFailureStop(rows, 2, 2).firstFailure, 1);
  rows[2].state = "PASS";
  assert.throws(() => verifyExtendedFailureStop(rows, 2, 2), /FAILURE_STOP/u);
});
