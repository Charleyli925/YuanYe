import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Contract and small, source-independent oracles for the private extended
 * real-HTML Electron runner.  The runner is intentionally the only module
 * that owns Electron/Playwright side effects. Keeping the manifest and
 * ledger rules here makes them cheap to test without opening a window.
 */

const ID = /^pr1_[0-9a-f]{32}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const TAG = /^[a-z][a-z0-9-]*$/u;
const STATES = new Set(["PASS", "FAIL", "NOT_APPLICABLE", "NOT_EXECUTED"]);
const REQUIRED_FILE_IDS = Object.freeze(["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08"]);

export const EXTENDED_BEHAVIORS = Object.freeze([
  "clipboard-short",
  "space-enter",
  "clipboard-large",
  "format",
  "move",
  "comment-delete",
  "reactivate",
  "text-edit",
  "structure-rebuild",
  "reactivate-rebuild",
]);

export const EXTENDED_CHECKPOINT_ROUND = 5;
export const EXTENDED_TOTAL_ROUNDS = 10;

export const EXTENDED_LEDGER_REASONS = Object.freeze({
  DEPENDENCY_NOT_COMPLETED: "DEPENDENCY_NOT_COMPLETED",
  FIRST_FAILURE_STOPPED: "FIRST_FAILURE_STOPPED",
  EXPECTED_CHANGE_OBSERVED: "EXPECTED_CHANGE_OBSERVED",
  STATIC_CANDIDATE_NOT_APPLICABLE: "STATIC_CANDIDATE_NOT_APPLICABLE",
});

function fail(condition, code, details = {}) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) freezeDeep(nested, seen);
  return Object.freeze(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function validateFileBinding(file, key) {
  fail(file && typeof file === "object", "EXTENDED_FILE_BINDING_INVALID", { key });
  fail(nonEmptyString(file.path) && path.isAbsolute(file.path), "EXTENDED_FILE_PATH_INVALID", { key });
  fail(HASH.test(file.sha256 || "") && Number.isSafeInteger(file.size) && file.size > 0,
    "EXTENDED_FILE_HASH_INVALID", { key });
}

function validateTextEntry(target, fileId) {
  const entry = target.textEntry;
  fail(entry && Array.isArray(entry.path) && entry.path.length > 0 && entry.path.length <= 8,
    "EXTENDED_TEXT_ENTRY_INVALID", { fileId, targetId: target.selectedId });
  fail(entry.path.every(index => Number.isSafeInteger(index) && index >= 0)
    && Number.isSafeInteger(entry.offset) && entry.offset >= 0
    && HASH.test(entry.textSha256 || "")
    && typeof entry.trailingText === "string" && /^[\t\n\r ]*$/u.test(entry.trailingText),
  "EXTENDED_TEXT_ENTRY_INVALID", { fileId, targetId: target.selectedId });
}

function validateTarget(target, file, targetIndex) {
  const fileId = file.fileId;
  fail(target && typeof target === "object", "EXTENDED_TARGET_INVALID", { fileId, targetIndex });
  fail(target.index === targetIndex && ID.test(target.clickId || "")
    && target.clickId === target.selectedId && target.mapping === "self"
    && TAG.test(target.clickTag || "") && target.clickTag === target.selectedTag
    && target.tabId === null && target.scrollContainer === "document",
  "EXTENDED_TARGET_IDENTITY_INVALID", { fileId, targetIndex, targetId: target.selectedId });
  fail(Array.isArray(target.capabilities) && new Set(target.capabilities).size === target.capabilities.length
    && target.capabilities.includes("selection")
    && Array.isArray(target.behaviors) && target.behaviors.length > 0
    && new Set(target.behaviors).size === target.behaviors.length,
  "EXTENDED_TARGET_CAPABILITY_INVALID", { fileId, targetIndex, targetId: target.selectedId });
  fail(target.behaviors.every(behavior => EXTENDED_BEHAVIORS.includes(behavior)),
    "EXTENDED_BEHAVIOR_UNKNOWN", { fileId, targetId: target.selectedId });
  const textBehaviors = ["clipboard-short", "space-enter", "clipboard-large", "format",
    "reactivate", "text-edit"];
  if (target.behaviors.some(behavior => textBehaviors.includes(behavior))) {
    fail(target.selectionClick === "frozen-text-character" && target.scrollBlock === "center", "EXTENDED_TEXT_CLICK_CONTRACT_INVALID",
      { fileId, targetId: target.selectedId });
    // Text behaviors may never derive a replacement path from a live DOM.
    validateTextEntry(target, fileId);
  }
  if (target.behaviors.includes("format")) fail(typeof target.initialBold === "boolean",
    "EXTENDED_FORMAT_INITIAL_STATE_MISSING", { fileId, targetId: target.selectedId });
  if (target.behaviors.includes("move")) {
    fail(["up", "down"].includes(target.moveDirection), "EXTENDED_MOVE_DIRECTION_INVALID", {
      fileId, targetId: target.selectedId,
    });
    fail(target.moveDirection === "up"
      ? target.capabilities.includes("move-up")
      : target.capabilities.includes("move-down"), "EXTENDED_MOVE_CAPABILITY_INVALID", {
      fileId, targetId: target.selectedId,
    });
  }
  if (target.behaviors.includes("structure-rebuild") || target.behaviors.includes("reactivate-rebuild")) {
    fail(target.capabilities.includes("copy") && target.copyBinding
      && target.copyBinding.kind === "inserted-leaf-at-frozen-source-offset"
      && ID.test(target.copyBinding.parentId || "")
      && (target.copyBinding.beforeSiblingId === null || ID.test(target.copyBinding.beforeSiblingId || ""))
      && Number.isSafeInteger(target.copyBinding.byteOffset) && target.copyBinding.byteOffset > 0
      && HASH.test(target.copyBinding.originalElementSha256 || "")
      && ["runtime-candidate", "static-rebuild"].includes(target.rebuildPath),
    "EXTENDED_STRUCTURE_BINDING_INVALID", { fileId, targetId: target.selectedId });
    fail(file.runtime === "static"
      ? target.rebuildPath === "static-rebuild"
      : target.rebuildPath === "runtime-candidate", "EXTENDED_REBUILD_PATH_INVALID", {
      fileId, targetId: target.selectedId, runtime: file.runtime, rebuildPath: target.rebuildPath,
    });
    const continuation = target.continuationTarget;
    fail(continuation && ID.test(continuation.clickId || "") && continuation.clickId === continuation.selectedId
      && continuation.mapping === "self" && TAG.test(continuation.clickTag || "")
      && continuation.clickTag === continuation.selectedTag && continuation.selectionClick === "frozen-text-character"
      && continuation.tabId === null && continuation.scrollContainer === "document" && continuation.scrollBlock === "center",
    "EXTENDED_CONTINUATION_TARGET_INVALID", { fileId, targetId: target.selectedId });
    validateTextEntry(continuation, fileId);
  }
}

/**
 * Read and validate the exact private manifest. `digestFn` is injected by
 * tests so this contract can be exercised without relying on a file or a
 * particular crypto implementation.
 */
export function readFrozenExtendedManifest(bytes, expectedSha256, digestFn = digest) {
  const raw = asBuffer(bytes);
  fail(HASH.test(expectedSha256 || "") && digestFn(raw) === expectedSha256,
    "EXTENDED_MANIFEST_DIGEST_MISMATCH");
  let plan;
  try { plan = JSON.parse(raw.toString("utf8")); }
  catch (cause) { throw Object.assign(new Error("EXTENDED_MANIFEST_JSON_INVALID", { cause }), {
    code: "EXTENDED_MANIFEST_JSON_INVALID",
  }); }
  fail(plan?.schemaVersion === 1 && plan.scope === "extended-ten-element-stress"
    && plan.reviewStatus === "FROZEN" && plan.reviewedBy === "root"
    && [EXTENDED_CHECKPOINT_ROUND, EXTENDED_TOTAL_ROUNDS].includes(plan.rounds)
    && Array.isArray(plan.files) && plan.files.length === REQUIRED_FILE_IDS.length,
  "EXTENDED_MANIFEST_HEADER_INVALID");
  fail(HASH.test(plan.version?.workspaceSourceSha256 || "")
    && SHA1.test(plan.version?.head || "") && SHA1.test(plan.version?.tree || "")
    && Number.isSafeInteger(plan.version?.untrackedFileCount) && plan.version.untrackedFileCount >= 0,
  "EXTENDED_MANIFEST_VERSION_INVALID");
  const fileIds = new Set();
  for (const [fileIndex, file] of plan.files.entries()) {
    fail(REQUIRED_FILE_IDS[fileIndex] === file?.fileId && !fileIds.has(file.fileId),
      "EXTENDED_FILE_ID_ORDER_INVALID", { fileIndex, fileId: file?.fileId });
    fileIds.add(file.fileId);
    fail(["runtime", "static"].includes(file.runtime), "EXTENDED_RUNTIME_CONTRACT_INVALID", {
      fileId: file.fileId, runtime: file.runtime,
    });
    fail(typeof file.structureManifestPath === "string" && path.isAbsolute(file.structureManifestPath),
      "EXTENDED_STRUCTURE_MANIFEST_PATH_INVALID", { fileId: file.fileId });
    validateFileBinding(file.original, "original"); validateFileBinding(file.seed, "seed");
    fail(Array.isArray(file.targets) && file.targets.length === 10,
      "EXTENDED_FILE_TARGET_COUNT_INVALID", { fileId: file.fileId, count: file.targets?.length });
    const ids = new Set(); const behaviors = new Set();
    for (const [targetIndex, target] of file.targets.entries()) {
      validateTarget(target, file, targetIndex);
      fail(!ids.has(target.selectedId), "EXTENDED_TARGET_DUPLICATE", {
        fileId: file.fileId, id: target.selectedId,
      });
      ids.add(target.selectedId); target.behaviors.forEach(behavior => behaviors.add(behavior));
    }
    fail(EXTENDED_BEHAVIORS.every(behavior => behaviors.has(behavior)),
      "EXTENDED_BEHAVIOR_COVERAGE_MISSING", {
        fileId: file.fileId,
        missing: EXTENDED_BEHAVIORS.filter(behavior => !behaviors.has(behavior)),
      });
    fail(file.fileId === "H08" ? file.runtime === "static" : file.runtime === "runtime",
      "EXTENDED_RUNTIME_CONTRACT_INVALID", { fileId: file.fileId, runtime: file.runtime });
    const structureTarget = file.targets.find(target => target.behaviors.includes("structure-rebuild"));
    fail(structureTarget && (file.fileId === "H08"
      ? structureTarget.rebuildPath === "static-rebuild"
      : structureTarget.rebuildPath === "runtime-candidate"),
    "EXTENDED_STATIC_CANDIDATE_CONTRACT_INVALID", { fileId: file.fileId });
  }
  fail(fileIds.size === REQUIRED_FILE_IDS.length, "EXTENDED_FILE_ID_SET_INVALID");
  return freezeDeep(plan);
}

/** Exact same-parent sibling oracle used by the move behavior. */
export function verifyAdjacentMove({ before, after, targetId, direction }) {
  const beforeIds = Array.isArray(before) ? before : [];
  const afterIds = Array.isArray(after) ? after : [];
  const index = beforeIds.indexOf(targetId);
  const afterIndex = afterIds.indexOf(targetId);
  const expectedIndex = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
  const expected = [...beforeIds];
  if (index >= 0 && expectedIndex >= 0 && expectedIndex < expected.length) {
    [expected[index], expected[expectedIndex]] = [expected[expectedIndex], expected[index]];
  }
  const conditions = {
    directionKnown: ["up", "down"].includes(direction),
    targetUniqueBefore: index >= 0 && beforeIds.indexOf(targetId, index + 1) < 0,
    targetUniqueAfter: afterIndex >= 0 && afterIds.indexOf(targetId, afterIndex + 1) < 0,
    sameLength: beforeIds.length === afterIds.length,
    exactAdjacentSwap: JSON.stringify(afterIds) === JSON.stringify(expected),
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_MOVE_ORACLE_FAILED", {
    conditions, targetId, direction,
  });
  return conditions;
}

/** Exact native copy/paste transfer oracle. */
export function verifyClipboardTransfer({ selectedText, renderedSelectedText = selectedText,
  clipboardText, beforeText, afterText, appendedText }) {
  const conditions = {
    selectedNonempty: typeof selectedText === "string" && selectedText.length > 0,
    clipboardExact: clipboardText === selectedText,
    appendExpected: appendedText === selectedText,
    targetExact: afterText === beforeText + renderedSelectedText,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_CLIPBOARD_ORACLE_FAILED", { conditions });
  return conditions;
}

export function clipboardSourceExpectation(marker, selectedText) {
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapeHtml = value => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const segments = selectedText.split("\n");
  const breakPattern = '<br data-pageroot-id="pr1_[0-9a-f]{32}">';
  return {
    lineBreakCount: segments.length - 1,
    pattern: new RegExp(`${escapeRegex(marker)}${segments.map(value => escapeRegex(escapeHtml(value))).join(breakPattern)}`, "u"),
  };
}

/** The clipboard helper already compares formats/payloads; this pure oracle
 * keeps its exact restoration proof in the extended runner's ledger. */
export function verifyClipboardRestoration(before, after) {
  const beforePayloads = Array.isArray(before?.payloads) ? before.payloads : [];
  const afterPayloads = Array.isArray(after?.payloads) ? after.payloads : [];
  const conditions = {
    formatsExact: JSON.stringify(before?.formats || []) === JSON.stringify(after?.formats || []),
    payloadsExact: JSON.stringify(beforePayloads) === JSON.stringify(afterPayloads),
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_CLIPBOARD_RESTORE_ORACLE_FAILED", { conditions });
  return conditions;
}

export function verifySpacesEnter({ beforeText, afterText, beforeBreakCount, afterBreakCount }) {
  const conditions = {
    beforeText: typeof beforeText === "string",
    afterText: typeof afterText === "string",
    textRetained: typeof beforeText === "string" && typeof afterText === "string"
      && afterText.startsWith(beforeText),
    exactlyOneBreak: Number.isInteger(beforeBreakCount) && Number.isInteger(afterBreakCount)
      && afterBreakCount === beforeBreakCount + 1,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_SPACE_ENTER_ORACLE_FAILED", { conditions });
  return conditions;
}

export function verifyFormatTransition({ initialBold, observedInitialBold, observedFinalBold }) {
  const conditions = {
    initialDeclared: typeof initialBold === "boolean",
    initialMatches: observedInitialBold === initialBold,
    toggled: observedFinalBold === !initialBold,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_FORMAT_ORACLE_FAILED", { conditions });
  return conditions;
}

export function verifyReactivation({ targetId, selectedId, editable, reselectedId }) {
  const conditions = {
    targetKnown: ID.test(targetId || ""),
    selectedExact: selectedId === targetId,
    editable: editable === true,
    reselectedExact: reselectedId === targetId,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_REACTIVATION_ORACLE_FAILED", { conditions });
  return conditions;
}

export function verifyRebuildContinuation({ targetId, selectedId, focusedId, marker, liveText,
  sourceContainsMarker, sourceScopeOk, outsideUnchanged, workingMatches, displayedMatches, restored }) {
  const conditions = {
    targetKnown: ID.test(targetId || ""),
    selectedExact: selectedId === targetId,
    focusExact: focusedId === targetId,
    markerKnown: typeof marker === "string" && marker.length > 0,
    inputLanded: typeof liveText === "string" && liveText.includes(marker),
    sourceContainsMarker: sourceContainsMarker === true,
    sourceScopeOk: sourceScopeOk === true,
    outsideUnchanged: outsideUnchanged === true,
    workingMatches: workingMatches === true,
    displayedMatches: displayedMatches === true,
    restored: restored === true,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_REBUILD_CONTINUATION_FAILED", { conditions });
  return conditions;
}

export function verifyCommentLifecycle({ comment, commentId, targetId, sourceBefore, sourceAfter, deleted }) {
  const conditions = {
    commentIdExact: typeof commentId === "string" && commentId.length > 0 && comment?.commentId === commentId,
    targetExact: comment?.sourceAnchor?.elementId === targetId,
    resolutionExact: comment?.sourceAnchor?.resolution === "exact",
    sourceUnchanged: Buffer.from(sourceBefore || []).equals(Buffer.from(sourceAfter || [])),
    deleted: deleted === true,
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_COMMENT_ORACLE_FAILED", { conditions });
  return conditions;
}

export function verifyStructureLifecycle({ path: rebuildPath, runtime, sourceHash, workingHash, displayedHash,
  candidateId, activeCandidateId, beforeGeneration, afterGeneration, beforeDocument, afterDocument }) {
  const staticPath = rebuildPath === "static-rebuild";
  const conditions = {
    knownPath: ["runtime-candidate", "static-rebuild"].includes(rebuildPath),
    sourceMatches: sourceHash === workingHash && workingHash === displayedHash,
    generationAdvanced: Number.isInteger(Number(beforeGeneration)) && Number(beforeGeneration) > 0
      && Number.isInteger(Number(afterGeneration)) && Number(afterGeneration) > Number(beforeGeneration),
    documentRebuilt: typeof beforeDocument === "string" && typeof afterDocument === "string"
      && beforeDocument !== afterDocument,
    staticCandidateNotApplicable: !staticPath || (runtime === "NOT_APPLICABLE" && !candidateId),
    runtimeCandidateBound: staticPath || (runtime === "ready" && typeof candidateId === "string"
      && candidateId.length > 0 && activeCandidateId === candidateId),
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_STRUCTURE_LIFECYCLE_ORACLE_FAILED", { conditions });
  return conditions;
}

export function createExtendedLedger(targetCount = 10, rounds = EXTENDED_TOTAL_ROUNDS, targets = []) {
  fail(Number.isSafeInteger(targetCount) && targetCount > 0 && Number.isSafeInteger(rounds) && rounds > 0,
    "EXTENDED_LEDGER_PLAN_INVALID");
  return Array.from({ length: rounds }, (_, roundIndex) => Array.from({ length: targetCount }, (_, targetIndex) => ({
    round: roundIndex + 1,
    targetIndex,
    targetId: targets[targetIndex]?.selectedId || null,
    behaviors: [...(targets[targetIndex]?.behaviors || [])],
    state: "NOT_EXECUTED",
    reason: EXTENDED_LEDGER_REASONS.DEPENDENCY_NOT_COMPLETED,
    durationMs: null,
  }))).flat();
}

export function markRemainingExtendedLedger(rows, startIndex, reason = EXTENDED_LEDGER_REASONS.FIRST_FAILURE_STOPPED) {
  fail(Array.isArray(rows) && Number.isSafeInteger(startIndex) && startIndex >= 0 && startIndex <= rows.length,
    "EXTENDED_LEDGER_CURSOR_INVALID");
  for (let index = startIndex; index < rows.length; index += 1) {
    if (rows[index].state !== "FAIL") Object.assign(rows[index], {
      state: "NOT_EXECUTED", reason, durationMs: 0,
    });
  }
  return rows;
}

export function verifyExtendedLedger(rows, targetCount, rounds) {
  const expected = targetCount * rounds;
  const coordinates = new Set((rows || []).map(row => `${row?.round}:${row?.targetIndex}`));
  const conditions = {
    exactRowCount: Array.isArray(rows) && rows.length === expected,
    knownStates: Array.isArray(rows) && rows.every(row => STATES.has(row.state)),
    allPass: Array.isArray(rows) && rows.every(row => row.state === "PASS"),
    reasonsPresent: Array.isArray(rows) && rows.every(row => typeof row.reason === "string" && row.reason.length > 0),
    durationsPresent: Array.isArray(rows) && rows.every(row => Number.isFinite(row.durationMs) && row.durationMs >= 0),
    exactCoordinates: coordinates.size === expected && Array.isArray(rows)
      && rows.every(row => Number.isSafeInteger(row.round) && row.round >= 1 && row.round <= rounds
        && Number.isSafeInteger(row.targetIndex) && row.targetIndex >= 0 && row.targetIndex < targetCount),
  };
  fail(Object.values(conditions).every(Boolean), "EXTENDED_LEDGER_INVALID", { conditions, expected, actual: rows?.length });
  return conditions;
}

/** Verify the stop-on-first-failure rule, including the NOT_EXECUTED suffix. */
export function verifyExtendedFailureStop(rows, targetCount, rounds) {
  const expected = targetCount * rounds;
  const conditions = {
    exactRowCount: Array.isArray(rows) && rows.length === expected,
    knownStates: Array.isArray(rows) && rows.every(row => STATES.has(row.state)),
    coordinates: Array.isArray(rows) && rows.every((row, index) => (
      row.round === Math.floor(index / targetCount) + 1 && row.targetIndex === index % targetCount
    )),
  };
  const firstFailure = (rows || []).findIndex(row => row.state === "FAIL");
  conditions.singleFailure = firstFailure < 0 || (rows || []).filter(row => row.state === "FAIL").length === 1;
  conditions.noExecutedAfterFailure = firstFailure < 0
    ? (rows || []).every(row => row.state === "PASS")
    : rows.slice(firstFailure + 1).every(row => row.state === "NOT_EXECUTED");
  conditions.noNotExecutedBeforeFailure = firstFailure < 0
    ? true
    : rows.slice(0, firstFailure).every(row => row.state === "PASS");
  fail(Object.values(conditions).every(Boolean), "EXTENDED_FAILURE_STOP_INVALID", { conditions, firstFailure });
  return { ...conditions, firstFailure };
}
