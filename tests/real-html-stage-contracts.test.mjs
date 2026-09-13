import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPublishedWorkingCopy } from "./e2e/electron/helpers/working-copy-publication.mjs";

import {
  createRealHtmlPlan,
  FIXED_STRUCTURE_SAMPLES,
  REAL_HTML_CAPABILITY_PLAN,
  REAL_HTML_OPERATION_IDS,
  REAL_HTML_STAGE_IDS,
} from "./e2e/electron/real-html/plan.mjs";
import { RealHtmlResultReport } from "./e2e/electron/real-html/result-report.mjs";
import { qualificationResultIssues } from "./e2e/electron/real-html/result-model.mjs";
import {
  RUNTIME_LIFECYCLE_REASONS,
  runtimeOperationOutcomes,
} from "./e2e/electron/real-html/runtime-lifecycle.mjs";
import {
  createFixedTextTargetPlan,
  TEXT_TARGET_REASON_CODES,
  validateFrozenTextTarget,
} from "./e2e/electron/real-html/text-targets.mjs";
import {
  CAPABILITY_MATRIX_REASONS,
  CAPABILITY_MATRIX_ROW_KINDS,
  CAPABILITY_MANIFEST_REASONS,
  createCapabilityManifest,
  createCapabilityMatrix,
  recordCapabilityTargetOutcome,
  selectCapabilityTargets,
} from "./e2e/electron/real-html/capability-manifest.mjs";
import {
  CONTINUITY_CHAIN_REASONS,
  evaluateContinuityChain,
  evaluateStaleCandidateFence,
  runtimeProjectionStale,
  STALE_CANDIDATE_REASONS,
} from "./e2e/electron/real-html/continuity-chain.mjs";
import { summarizeRuntimeObserverRecords } from "./e2e/electron/real-html/runtime-observer.mjs";
import { normalizeCapabilityProbeObservations } from "./e2e/electron/real-html/capability-driver.mjs";
import { assertReadOnlyCorpusMode, frozenInitialRuntimeDecision, FROZEN_ELEMENT_OPERATIONS, FROZEN_COPY_DENIED_OPERATIONS, FROZEN_STRUCTURE_PROBE_OPERATIONS, FROZEN_STRUCTURE_OPERATIONS, FROZEN_FORMAT_OPERATIONS, FROZEN_REENTRY_FORMAT_OPERATIONS, FROZEN_TEXT_OPERATIONS, frozenDigest, readFrozenSelection, verifyFrozenBytes, verifyFrozenDisplay }
  from "./e2e/electron/real-html/frozen-selection.mjs";
import { verifiedUndoTail, requireTextOperationLedger, verifyEndedHistorySession, verifyFrozenHistory } from "./e2e/electron/real-html/frozen-text.mjs";

test("cumulative Undo binds only a previously verified exact-target bookmark", () => {
  const b = { actual: { id: "fixed", activeId: "fixed", collapsed: true, remainingText: "\n      " },
    conditions: { identityMatches: true, focusMatches: true, editable: true, selectionInside: true, caretAtEnd: true } };
  assert.equal(verifiedUndoTail(b, "fixed"), "\n      ");
  for (const bad of [null, { ...b, conditions: {} }, { ...b, actual: { ...b.actual, id: "wrong" } },
    { ...b, actual: { ...b.actual, remainingText: "unexpected text" } },
    { ...b, actual: { ...b.actual, collapsed: false } }])
    assert.throws(() => verifiedUndoTail(bad, "fixed"), { code: "FROZEN_PRIOR_BOOKMARK_INVALID" });
});
import { verifyFrozenCopyCapability, verifyFrozenDenialWitness, verifyFrozenEndedContinuation, verifyFrozenStructureLifecycle } from "./e2e/electron/real-html/frozen-structure.mjs";
import { publicDiagnosticValue } from "./e2e/electron/real-html/diagnostic-sanitizer.mjs";
import { verifyMixedMarkers, bindMixedSource, verifyFrozenComment, mixedCycleRows, mixedCheckpointOperations, verifyFreshCommentStorage } from "./e2e/electron/real-html/frozen-mixed.mjs";

test("mixed newline markers retain both edits and reject either missing half", () => {
  const content = "PRCORE_H02_C1PRLINE_H02_C1 PRCORE_H02_C1_RESUME";
  assert.doesNotThrow(() => verifyMixedMarkers(content, "H02", 1, true));
  assert.doesNotThrow(() => verifyMixedMarkers("PRCORE_H02_C1 PRCORE_H02_C1_RESUME", "H02", 1, false));
  for (const bad of [content.replace("PRLINE_H02_C1", ""), content.replace("_RESUME", "_WRONG"), "PRCORE_H02_C1_RESUME"])
    assert.throws(() => verifyMixedMarkers(bad, "H02", 1, true), { code: "FROZEN_CUMULATIVE_TEXT_LOST" });
});

test("mixed binding shifts bytes only outside a verified fixed text island", () => {
  const id = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const before = Buffer.from(`<p data-pageroot-id="${id}">文字</p><span>Copy</span><!--keep-->`);
  const after = Buffer.from(before.toString().replace("文字", "文字 added"));
  const text = { selectedId: id, selectedTag: "p", textEntry: { path: [0], offset: 0, textSha256: frozenDigest("文字") } };
  const structure = { copyBinding: { byteOffset: before.indexOf("<!--"), parentId: "fixed" } };
  const result = bindMixedSource(before, after, text, structure);
  assert.equal(result.structure.copyBinding.byteOffset, structure.copyBinding.byteOffset + 6);
  assert.equal(result.text.textEntry.textSha256, frozenDigest("文字 added"));
  assert.throws(() => bindMixedSource(before, after, { ...text, textEntry: { ...text.textEntry, textSha256: "wrong" } }, structure));
  const end = before.indexOf("<span>");
  const same = { selectedId: id, copyBinding: { byteOffset: end, originalElementSha256: frozenDigest(before.subarray(0, end)) } };
  assert.equal(bindMixedSource(before, after, text, same).structure.copyBinding.originalElementSha256,
    frozenDigest(after.subarray(0, end + 6)));
  assert.throws(() => bindMixedSource(before, after, text, { ...same, copyBinding: { ...same.copyBinding, originalElementSha256: "wrong" } }));
  assert.equal(bindMixedSource(before, after, text, { copyBinding: { byteOffset: 0 } }).structure.copyBinding.byteOffset, 0);
  for (const bad of [after.toString().replace("keep", "wrong"), after.toString().replace("Copy", "wrong"),
    after.toString().replace(id, "wrong"), after.toString() + `<p data-pageroot-id="${id}">duplicate</p>`])
    assert.throws(() => bindMixedSource(before, Buffer.from(bad), text, structure));
  assert.throws(() => bindMixedSource(before, after, { ...text, selectedTag: "span" }, structure));
  assert.throws(() => bindMixedSource(before, after, text, { copyBinding: { byteOffset: 5 } }));
  assert.throws(() => bindMixedSource(before, after, { ...text, textEntry: { path: [9] } }, structure));
});
import {
  CAPABILITY_EXPECTATION_RULES,
  attachOperationGroupsToAuthoredDenominator,
  capabilityExpectationRows,
  capabilityManifestDraftIssues,
  capabilityPreflightExitCode,
  capabilityPreflightFileStatus,
  createCapabilityManifestDraft,
} from "./e2e/electron/real-html/capability-manifest-draft.mjs";

const VALID_CANDIDATE_EVIDENCE = Object.freeze({
  kind: "candidate-created",
  evidence: "candidate-id-absent-to-present",
  candidateId: "candidate-2",
});

test("real HTML plan always exposes independent A, B, C, D and E stages", () => {
  const plan = createRealHtmlPlan([{ id: "file-001", label: "private fixture 1" }]);
  assert.deepEqual(
    plan.files[0].stages.map(({ id }) => id),
    [
      REAL_HTML_STAGE_IDS.TEXT_EDITING,
      REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
      REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
      REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
    ],
  );
  assert.equal(
    plan.files[0].stages[0].operations.some(
      ({ id }) => id === REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
    ),
    false,
  );
  assert.equal(
    plan.files[0].stages[0].operations.some(
      ({ id }) => id === REAL_HTML_OPERATION_IDS.TEXT_PASTE,
    ),
    true,
  );
});

test("structure samples require explicit expected-copyability markers", () => {
  assert.match(FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector, /expected-copyable/u);
  assert.match(FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector, /expected-non-copyable/u);
  assert.doesNotMatch(FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector, /^p(?:\[|$)/u);
  assert.doesNotMatch(FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector, /^canvas(?:\[|$)/u);
});

test("real HTML plan declares the frozen capability matrix sampling contract", () => {
  const plan = createRealHtmlPlan([{ id: "file-001" }]);
  assert.equal(REAL_HTML_CAPABILITY_PLAN.minimumCoverage, 0.6);
  assert.equal(plan.metadata.capabilityPlan.ordering, "tabId/sourceOrder/StableID");
  assert.deepEqual(plan.metadata.capabilityPlan.rowKinds, ["capability-observation", "actual-behavior"]);
  assert.ok(plan.files[0].stages.find(
    ({ id }) => id === REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
  ).operations.some(({ id }) => id === REAL_HTML_OPERATION_IDS.CAPABILITY_MATRIX_RESULT));
  assert.ok(plan.files[0].stages.find(
    ({ id }) => id === REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
  ).operations.some(
    ({ id }) => id === REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
  ));
});

function textSnapshot(id, overrides = {}) {
  return {
    id,
    tag: "p",
    parentId: "pr1_00000000000040008000000000000001",
    documentOrder: 1,
    textLength: 24,
    childCount: 0,
    descendantSourceIds: [],
    sourceIdValid: true,
    domIdentityValid: true,
    visible: true,
    interactive: false,
    sourceEditable: true,
    format: { bold: false, italic: false, underline: false },
    ...overrides,
  };
}

test("text preflight freezes one format-off host plus two ordinary hosts without fallback", () => {
  const snapshots = [
    textSnapshot("pr1_00000000000040008000000000000010", { tag: "h1", format: { bold: true, italic: false, underline: false } }),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
    textSnapshot("pr1_00000000000040008000000000000013", { documentOrder: 4 }),
  ];
  const plan = createFixedTextTargetPlan(snapshots);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.targets.map(({ id }) => id), [
    snapshots[1].id,
    snapshots[0].id,
    snapshots[2].id,
  ]);
  assert.equal(plan.targets.length, 3);
});

test("text preflight keeps the visible snapshot of one Stable ID across authored tabs", () => {
  const sharedId = "pr1_00000000000040008000000000000010";
  const plan = createFixedTextTargetPlan([
    textSnapshot(sharedId, { visible: false, tabId: "tab-a" }),
    textSnapshot(sharedId, { visible: true, tabId: "tab-b" }),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
  ]);
  assert.equal(plan.ok, true);
  assert.equal(plan.targets.find((target) => target.id === sharedId)?.tabId, "tab-b");
});

test("text preflight rejects invalid DOM identity and invalid samples instead of selecting a replacement", () => {
  const duplicate = textSnapshot("pr1_00000000000040008000000000000010", {
    domIdentityValid: false,
  });
  const duplicatePlan = createFixedTextTargetPlan([
    duplicate,
    { ...duplicate, documentOrder: 2 },
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 3 }),
  ]);
  assert.equal(duplicatePlan.ok, false);
  assert.equal(duplicatePlan.reasonCode, TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE);
  assert.equal(
    duplicatePlan.rejected[0].reasons[0],
    TEXT_TARGET_REASON_CODES.DOM_IDENTITY_INVALID,
  );

  const rejectedPlan = createFixedTextTargetPlan([
    textSnapshot("pr1_00000000000040008000000000000010", {
      descendantSourceIds: ["pr1_00000000000040008000000000000099"],
    }),
    textSnapshot("pr1_00000000000040008000000000000011", { visible: false, documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { sourceEditable: false, documentOrder: 3 }),
  ]);
  assert.equal(rejectedPlan.ok, false);
  assert.equal(rejectedPlan.reasonCode, TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE);
  assert.deepEqual(rejectedPlan.rejected.map(({ reasons }) => reasons[0]), [
    TEXT_TARGET_REASON_CODES.CONTAINER_REJECTED,
    TEXT_TARGET_REASON_CODES.HIDDEN_REJECTED,
    TEXT_TARGET_REASON_CODES.EDITABLE_REJECTED,
  ]);
});

test("text execution revalidates frozen source identity but ignores self-authored order shifts", () => {
  const plan = createFixedTextTargetPlan([
    textSnapshot("pr1_00000000000040008000000000000010"),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
  ]).targets[0];
  const drifted = validateFrozenTextTarget(
    textSnapshot(plan.id, { parentId: "pr1_00000000000040008000000000000002", documentOrder: 8 }),
    plan,
  );
  assert.equal(drifted.ok, false);
  assert.ok(drifted.reasons.includes(TEXT_TARGET_REASON_CODES.DOM_IDENTITY_DRIFT));
});

test("a failed A category leaves B, C, D and E executable for the same file", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.failStage("file-001", REAL_HTML_STAGE_IDS.TEXT_EDITING, {
    exactReason: "TEXT_PREFLIGHT_FAILED",
  });
  const rows = report.rowsForFile("file-001");
  const aRows = rows.filter((row) => row.stageId === REAL_HTML_STAGE_IDS.TEXT_EDITING);
  const laterRows = rows.filter((row) => [
    REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
    REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
    REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
  ].includes(row.stageId));
  assert.ok(aRows.some((row) => row.reasonCode === "UPSTREAM_STAGE_FAILED"));
  assert.equal(laterRows.every((row) => row.reasonCode === "NOT_STARTED"), true);
  assert.equal(laterRows.every((row) => row.state === "NOT_EXECUTED"), true);
});

test("runtime facts prove rebuild, Candidate and generation independently", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY].state, "NOT_APPLICABLE");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK].state, "NOT_APPLICABLE");
});

test("runtime rebuild uses its own reload baseline when no A-stage continuity pair exists", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.ordinaryObserved,
    false,
  );
});

test("a static non-candidate document does not require Candidate creation", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "NOT_APPLICABLE");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
  );
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("failed Runtime preparation cannot make Candidate not applicable", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE,
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("Runtime projection stale attributes preserve true and false semantics", () => {
  assert.equal(runtimeProjectionStale("false"), false);
  assert.equal(runtimeProjectionStale("true"), true);
  assert.equal(runtimeProjectionStale(null), null);
  assert.equal(runtimeProjectionStale("unknown"), null);
});

test("an unknown Candidate applicability reason cannot hide missing evidence", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason: "INVENTED_REASON",
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
});

test("runtime facts fail when edit rebuilds or reload Candidate evidence is absent", () => {
  const ordinaryRebuild = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-b", generation: "2" },
    reloadBefore: { document: "doc-b", generation: "2" },
    reloadAfter: { document: "doc-c", generation: "3" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.deepEqual(
    ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD],
    {
      state: "FAIL",
      reasonCode: "OPERATION_FAILED",
      details: {
        exactReason: RUNTIME_LIFECYCLE_REASONS.RUNTIME_REBUILD_UNEXPECTED_DURING_ORDINARY_EDIT,
        ordinary: ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.ordinary,
        reload: ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.reload,
      },
    },
  );

  const missingCandidate = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: null,
  });
  assert.equal(missingCandidate[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    missingCandidate[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
});

test("Candidate requires the canonical root absent-to-present event and a non-empty ID", () => {
  for (const candidateEvidence of [
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: "" },
    { kind: "candidate-created", evidence: "candidate-frame-role-transition", candidateId: "candidate-2" },
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: null },
    true,
  ]) {
    const outcomes = runtimeOperationOutcomes({
      ordinaryBefore: { document: "doc-a", generation: "1" },
      ordinaryAfter: { document: "doc-a", generation: "1" },
      reloadBefore: { document: "doc-a", generation: "1" },
      reloadAfter: { document: "doc-b", generation: "2" },
      candidateEvidence,
    });
    assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  }
});

test("runtime rebuild and generation evidence cannot substitute for each other", () => {
  const documentOnly = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "1" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(documentOnly[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(documentOnly[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "FAIL");

  const generationOnly = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-a", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(generationOnly[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "FAIL");
  assert.equal(generationOnly[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("runtime generation must advance monotonically", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "3" },
    ordinaryAfter: { document: "doc-a", generation: "3" },
    reloadBefore: { document: "doc-a", generation: "3" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "FAIL");
});

test("runtime generation rejects missing, empty and non-numeric identities", () => {
  for (const beforeGeneration of [null, "", "not-a-number", "1.5", "0"]) {
    const outcomes = runtimeOperationOutcomes({
      ordinaryBefore: { document: "doc-a", generation: "1" },
      ordinaryAfter: { document: "doc-a", generation: "1" },
      reloadBefore: { document: "doc-a", generation: beforeGeneration },
      reloadAfter: { document: "doc-b", generation: "2" },
      candidateEvidence: VALID_CANDIDATE_EVIDENCE,
    });
    assert.equal(
      outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state,
      "FAIL",
      `baseline ${JSON.stringify(beforeGeneration)} must not prove generation advance`,
    );
  }
});

test("runtime rebuild fails closed when identity evidence is missing", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: null },
    ordinaryAfter: { document: "doc-a", generation: "2" },
    reloadBefore: { document: "doc-a", generation: "2" },
    reloadAfter: { document: "doc-b", generation: "3" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.RUNTIME_IDENTITY_EVIDENCE_INVALID,
  );
});

test("result report records real operation selectors instead of shrinking the plan", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.passOperation(
    "file-001",
    REAL_HTML_STAGE_IDS.TEXT_EDITING,
    REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
  );
  const row = report.rowsForFile("file-001").find(
    (candidate) => candidate.operationId === REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
  );
  assert.equal(row.state, "PASS");
  assert.equal(report.model.rows.length, report.plan.files[0].stages.reduce(
    (count, stage) => count + stage.operations.length + 1,
    1,
  ));
});

test("result report accepts an object selector for a non-applicable operation", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.notApplicableOperation(
    "file-001",
    REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
    { exactReason: "FIXED_SAMPLE_NOT_FOUND" },
  );
  const row = report.rowsForFile("file-001").find(
    (candidate) => candidate.operationId === REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
  );
  assert.equal(row.state, "NOT_APPLICABLE");
  assert.equal(row.details.exactReason, "FIXED_SAMPLE_NOT_FOUND");
});

test("qualification audit rejects unresolved rows and non-applicable rows without exact reasons", () => {
  const clean = qualificationResultIssues([
    { level: "operation", state: "PASS", details: null },
    {
      level: "operation",
      state: "NOT_APPLICABLE",
      details: { exactReason: "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE" },
    },
  ]);
  assert.deepEqual(clean, { unexplainedNotApplicable: [], unresolvedRows: [] });

  const unexplained = { level: "operation", state: "NOT_APPLICABLE", details: {} };
  const unresolved = { level: "stage", state: "NOT_EXECUTED", details: null };
  const rejected = qualificationResultIssues([unexplained, unresolved]);
  assert.deepEqual(rejected.unexplainedNotApplicable, [unexplained]);
  assert.deepEqual(rejected.unresolvedRows, [unresolved]);
});

function capabilityId(number) {
  return `pr1_${String(number).padStart(32, "0")}`;
}

function capabilityEvidence({ allTop = false } = {}) {
  const entries = [
    ["h1", "text", "text-input", "tab-a", "top"],
    ["p", "format", "text-format", "tab-a", "middle"],
    ["li", "structure", "structure-copy", "tab-a", "bottom"],
    ["button", "interaction", "activation", "tab-b", "top"],
    ["table", "table", "table-edit", "tab-b", "middle"],
    ["pre", "code", "code-edit", "tab-b", "bottom"],
    ["a", "link", "link-edit", "tab-b", "bottom"],
  ].map(([tagName, capabilityFamily, behaviorFamily, tabId, region], index) => ({
    id: capabilityId(index + 1),
    tagName,
    pagerootId: capabilityId(index + 1),
    pagerootIdentityStatus: "valid",
    sourceOrder: index,
    capabilityFamilies: [capabilityFamily],
    behaviorFamilies: [behaviorFamily],
    live: {
      stableId: capabilityId(index + 1),
      visible: true,
      isConnected: true,
      tabId,
      region: allTop ? "top" : region,
      tag: tagName,
      type: capabilityFamily,
      capabilityFamilies: [capabilityFamily],
      behaviorFamilies: [behaviorFamily],
    },
  }));
  const sourceElements = entries.map((entry) => ({
    id: entry.id,
    tagName: entry.tagName,
    pagerootId: entry.pagerootId,
    pagerootIdentityStatus: entry.pagerootIdentityStatus,
    sourceOrder: entry.sourceOrder,
    capabilityFamilies: entry.capabilityFamilies,
    behaviorFamilies: entry.behaviorFamilies,
  }));
  const sourceIndex = {
    elements: sourceElements,
    byPagerootId: new Map(sourceElements.map((entry) => [entry.pagerootId, entry])),
    pagerootIdentity: { issues: [] },
  };
  return {
    sourceIndex,
    liveDom: entries.map(({ live }) => live),
  };
}

function admittedCapabilityEvidence(options = {}) {
  return createCapabilityManifest(capabilityEvidence(options));
}

test("capability manifest requires dual authored/source-index and live-DOM Stable-ID proof", () => {
  const id = capabilityId(1);
  const sourceOnly = capabilityId(90);
  const liveOnly = capabilityId(91);
  const invalid = "pr1_not-a-stable-id";
  const evidence = capabilityEvidence();
  evidence.sourceIndex.elements.push({
    nodeId: "element:private-parser-handle",
    tagName: "p",
    sourceOrder: 90,
    capabilityFamilies: ["text"],
  });
  evidence.sourceIndex.elements.push({
    pagerootId: sourceOnly,
    pagerootIdentityStatus: "valid",
    tagName: "p",
    sourceOrder: 90,
    capabilityFamilies: ["text"],
  });
  evidence.sourceIndex.elements.push({
    pagerootId: invalid,
    pagerootIdentityStatus: "invalid",
    tagName: "p",
    sourceOrder: 91,
    capabilityFamilies: ["text"],
  });
  evidence.liveDom.push({
    stableId: liveOnly,
    visible: true,
    isConnected: true,
    tabId: "tab-a",
    region: "top",
    capabilityFamilies: ["text"],
  });
  const manifest = createCapabilityManifest(evidence);
  assert.equal(manifest.entries.some((entry) => entry.elementId === id), true);
  assert.equal(manifest.entries.some((entry) => entry.elementId === "element:private-parser-handle"), false);
  assert.ok(manifest.excluded.some((entry) => entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.SOURCE_ID_MISSING)));
  assert.ok(manifest.excluded.some((entry) => entry.elementId === sourceOnly
    && entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.LIVE_DOM_MISSING)));
  assert.ok(manifest.excluded.some((entry) => entry.elementId === liveOnly
    && entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.SOURCE_ID_NOT_FOUND)));
  assert.ok(manifest.excluded.some((entry) => entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.INVALID_STABLE_ID)));
  assert.equal(manifest.entries.every((entry) => !Object.hasOwn(entry, "nodeId")), true);
  assert.equal(manifest.metadata.noNodeIdFallback, true);
});

test("capability manifest excludes duplicate, hidden, inert, generated and no-capability elements with reasons", () => {
  const evidence = capabilityEvidence();
  const add = (id, sourceOverrides, liveOverrides) => {
    const source = {
      pagerootId: id,
      pagerootIdentityStatus: "valid",
      tagName: "div",
      sourceOrder: 100 + evidence.sourceIndex.elements.length,
      ...sourceOverrides,
    };
    evidence.sourceIndex.elements.push(source);
    evidence.sourceIndex.byPagerootId.set(id, source);
    evidence.liveDom.push({
      stableId: id,
      visible: true,
      isConnected: true,
      tabId: "tab-a",
      region: "middle",
      capabilityFamilies: ["text"],
      ...liveOverrides,
    });
  };
  const duplicateId = capabilityId(101);
  add(duplicateId, { capabilityFamilies: ["text"] }, { capabilityFamilies: ["text"] });
  evidence.sourceIndex.elements.push({
    pagerootId: duplicateId,
    pagerootIdentityStatus: "valid",
    tagName: "div",
    sourceOrder: 102,
    capabilityFamilies: ["text"],
  });
  add(capabilityId(102), { capabilityFamilies: ["text"] }, { visible: false });
  add(capabilityId(103), { capabilityFamilies: ["text"] }, { inert: true });
  add(capabilityId(104), { capabilityFamilies: ["text"] }, { runtimeGenerated: true });
  add(capabilityId(105), {}, { capabilityFamilies: [] });
  const manifest = createCapabilityManifest(evidence);
  const reasonFor = (id) => manifest.excluded.find((entry) => entry.elementId === id)?.reasons || [];
  assert.ok(reasonFor(duplicateId).includes(CAPABILITY_MANIFEST_REASONS.DUPLICATE_STABLE_ID));
  assert.ok(reasonFor(capabilityId(102)).includes(CAPABILITY_MANIFEST_REASONS.HIDDEN_ELEMENT));
  assert.ok(reasonFor(capabilityId(103)).includes(CAPABILITY_MANIFEST_REASONS.INERT_ELEMENT));
  assert.ok(reasonFor(capabilityId(104)).includes(CAPABILITY_MANIFEST_REASONS.LIVE_RUNTIME_GENERATED));
  assert.ok(reasonFor(capabilityId(105)).includes(CAPABILITY_MANIFEST_REASONS.NO_CAPABILITY));
});

test("canonical normalization preserves raw live duplicate evidence for the manifest", () => {
  const evidence = capabilityEvidence();
  const duplicate = {
    ...evidence.liveDom[0],
    stableId: evidence.sourceIndex.elements[0].pagerootId,
    capabilityFamilies: [],
    behaviorFamilies: [],
    probeReason: "LIVE_DUPLICATE_STABLE_ID",
  };
  const normalized = normalizeCapabilityProbeObservations([duplicate, { ...duplicate }]);
  assert.equal(normalized.liveDom.length, 2);
  const manifest = createCapabilityManifest({
    sourceIndex: evidence.sourceIndex,
    liveDom: normalized.liveDom,
  });
  const excluded = manifest.excluded.find((entry) => entry.elementId === duplicate.stableId);
  assert.ok(excluded?.reasons.includes(CAPABILITY_MANIFEST_REASONS.LIVE_DUPLICATE_STABLE_ID));
});

test("canonical normalization rejects missing, mismatched, or positive raw identities", () => {
  const stableId = capabilityId(210);
  const otherId = capabilityId(211);
  const valid = {
    stableId,
    probeStableId: stableId,
    operationStableId: stableId,
    capabilityFamilies: ["selection"],
    behaviorFamilies: ["activation"],
  };
  assert.throws(
    () => normalizeCapabilityProbeObservations([{ ...valid, probeStableId: null }]),
    { code: "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID" },
  );
  assert.throws(
    () => normalizeCapabilityProbeObservations([{ ...valid, operationStableId: null }]),
    { code: "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID" },
  );
  assert.throws(
    () => normalizeCapabilityProbeObservations([{ ...valid, operationStableId: otherId }]),
    { code: "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID" },
  );
  assert.throws(
    () => normalizeCapabilityProbeObservations([{
      stableId,
      capabilityFamilies: ["selection"],
      behaviorFamilies: ["activation"],
    }]),
    { code: "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID" },
  );
});

test("canonical diagnostics retain only valid planned and observed Stable IDs", () => {
  const probeStableId = capabilityId(201);
  const operationStableId = capabilityId(202);
  assert.deepEqual(publicDiagnosticValue({
    probeStableId,
    expectedOperationStableId: operationStableId,
    operationStableId,
    probeStableIds: [probeStableId, operationStableId, "private-file-name.html"],
    selectedId: "private-file-name.html",
    stableId: probeStableId,
    expectedStableId: operationStableId,
    hintTargetId: "private-file-name.html",
    path: "/private/local/path",
  }), {
    probeStableId,
    expectedOperationStableId: operationStableId,
    operationStableId,
    probeStableIds: [probeStableId, operationStableId],
    stableId: probeStableId,
    expectedStableId: operationStableId,
  });
});

test("capability draft keeps contract, source, and live conflicts pending review", () => {
  const operation = {
    pagerootId: capabilityId(220),
    pagerootIdentityStatus: "valid",
    parentId: null,
    sourceOrder: 0,
    sourceEditable: true,
    boundarySafe: true,
  };
  const expectations = capabilityExpectationRows({
    sourceElements: [operation],
    operation,
    observation: {
      capabilityFamilies: ["selection", "comment"],
      copyAvailability: "unsupported",
      copyReason: "runtime-subtree-diverged",
      probeReason: "CAPABILITY_OBSERVED",
    },
  });
  assert.equal(expectations.find((entry) => entry.family === "text")?.source.state, "ELIGIBLE");
  assert.equal(expectations.find((entry) => entry.family === "text")?.live.state, "DENIED");
  assert.equal(
    expectations.find((entry) => entry.family === "text")?.live.reason,
    "CAPABILITY_NOT_OBSERVED",
  );
  assert.equal(expectations.find((entry) => entry.family === "text")?.reviewStatus, "PENDING_REVIEW");
  assert.equal(expectations.find((entry) => entry.family === "copy")?.contract.state, "CONDITIONAL");
  assert.equal(expectations.find((entry) => entry.family === "copy")?.live.reason, "runtime-subtree-diverged");
  assert.deepEqual(capabilityManifestDraftIssues({
    authoredDenominator: [{
      probeStableId: operation.pagerootId,
      operationStableId: operation.pagerootId,
      expectations,
    }],
    operationGroups: [{ expectations }],
    unresolvedProbes: [{ probeStableId: operation.pagerootId }],
  }), ["UNRESOLVED_PROBES_PRESENT", "CAPABILITY_EXPECTATIONS_PENDING_REVIEW"]);
  assert.deepEqual(capabilityManifestDraftIssues({
    authoredDenominator: [{
      probeStableId: operation.pagerootId,
      operationStableId: operation.pagerootId,
      expectations,
    }],
    operationGroups: [{ expectations }],
    unresolvedProbes: [],
    observationConflicts: [{ operationStableId: operation.pagerootId }],
  }), [
    "CAPABILITY_EXPECTATIONS_PENDING_REVIEW",
    "CAPABILITY_OBSERVATION_CONFLICTS_PENDING_REVIEW",
  ]);
  assert.deepEqual(capabilityManifestDraftIssues({
    authoredDenominator: [{ probeStableId: operation.pagerootId, operationStableId: null }],
    operationGroups: [],
    unresolvedProbes: [],
  }), ["UNRESOLVED_DENOMINATOR_IDENTITIES", "INCOMPLETE_CAPABILITY_EXPECTATIONS"]);
  const normalizedConflict = normalizeCapabilityProbeObservations([
    {
      stableId: operation.pagerootId,
      operationStableId: operation.pagerootId,
      probeStableId: capabilityId(221),
      capabilityFamilies: ["selection"],
      region: "top",
    },
    {
      stableId: operation.pagerootId,
      operationStableId: operation.pagerootId,
      probeStableId: capabilityId(222),
      capabilityFamilies: ["selection"],
      region: "middle",
    },
  ], { allowConflicts: true });
  const constructed = createCapabilityManifestDraft({
    authoredDenominator: [{
      probeStableId: capabilityId(221),
      operationStableId: operation.pagerootId,
      expectations,
    }],
    operationGroups: [{ operationStableId: operation.pagerootId, expectations }],
    observationConflicts: normalizedConflict.conflicts,
  });
  assert.equal(constructed.observationConflicts.length, 1);
  assert.ok(constructed.issues.includes("CAPABILITY_OBSERVATION_CONFLICTS_PENDING_REVIEW"));
});

test("capability draft keeps every authored alias in the denominator", () => {
  const probeA = capabilityId(230);
  const probeC = capabilityId(231);
  const operationB = capabilityId(232);
  const expectations = Object.keys(CAPABILITY_EXPECTATION_RULES).map((family) => ({
    family,
    reviewStatus: "CONSISTENT",
  }));
  const alternateExpectations = expectations.map((entry) => ({
    ...entry,
    evidenceVariant: "alias",
  }));
  const probeALiveSnapshot = { region: "top", sourceEditable: true };
  const probeCLiveSnapshot = { region: "middle", sourceEditable: false };
  const denominator = attachOperationGroupsToAuthoredDenominator({
    authoredDenominator: [
      { probeStableId: probeA },
      { probeStableId: probeC },
    ],
    operationGroups: [{
      operationStableId: operationB,
      expectations,
      probes: [
        { probeStableId: probeA, liveSnapshot: probeALiveSnapshot, expectations },
        { probeStableId: probeC, liveSnapshot: probeCLiveSnapshot, expectations: alternateExpectations },
      ],
    }],
    liveDom: [{
      stableId: operationB,
      probeStableId: probeA,
      operationStableId: operationB,
    }],
    aliases: [
      { probeStableId: probeA, operationStableId: operationB },
      { probeStableId: probeC, operationStableId: operationB },
    ],
  });
  assert.equal(denominator.length, 2);
  assert.deepEqual(denominator.map((entry) => entry.operationStableId), [operationB, operationB]);
  assert.equal(denominator[0].expectations, expectations);
  assert.equal(denominator[1].expectations, alternateExpectations);
  assert.equal(denominator[0].liveSnapshot, probeALiveSnapshot);
  assert.equal(denominator[1].liveSnapshot, probeCLiveSnapshot);
  assert.equal(new Set(denominator.map((entry) => entry.probeStableId)).size, 2);
  assert.deepEqual(capabilityManifestDraftIssues({
    authoredDenominator: denominator,
    operationGroups: [{ operationStableId: operationB, expectations }],
    unresolvedProbes: [],
  }), []);
  const invalidExpectations = expectations.map((entry) => ({ ...entry }));
  invalidExpectations[7].family = invalidExpectations[0].family;
  assert.deepEqual(capabilityManifestDraftIssues({
    authoredDenominator: [{ ...denominator[0], expectations: invalidExpectations }],
    operationGroups: [{ operationStableId: operationB, expectations: invalidExpectations }],
    unresolvedProbes: [],
  }), ["INCOMPLETE_CAPABILITY_EXPECTATIONS"]);
});

test("capability preflight cannot pass file, cleanup, or source failures", () => {
  assert.equal(capabilityPreflightFileStatus({}), "PENDING_REVIEW");
  assert.equal(capabilityPreflightFileStatus({ environmentBlocked: true }), "ENVIRONMENT_BLOCKED");
  assert.equal(capabilityPreflightFileStatus({ discoveryFailed: true }), "DISCOVERY_ERROR");
  assert.equal(capabilityPreflightFileStatus({ cleanupFailed: true }), "DISCOVERY_ERROR");
  assert.equal(capabilityPreflightFileStatus({ workingCopyUnchanged: false }), "DISCOVERY_ERROR");
  assert.equal(capabilityPreflightFileStatus({ originalUnchanged: false }), "DISCOVERY_ERROR");
  assert.equal(capabilityPreflightFileStatus({
    draftIssues: ["UNRESOLVED_PROBES_PRESENT"],
  }), "DISCOVERY_ERROR");
  assert.equal(capabilityPreflightFileStatus({
    draftIssues: ["AUTHORED_DENOMINATOR_EMPTY"],
  }), "DISCOVERY_ERROR");
  const passingRow = {
    status: "PENDING_REVIEW",
    originalUnchanged: true,
    preflightWorkingCopy: { unchanged: true },
  };
  assert.equal(capabilityPreflightExitCode([passingRow]), 0);
  for (const broken of [
    { ...passingRow, status: "DISCOVERY_ERROR" },
    { ...passingRow, originalUnchanged: false },
    { ...passingRow, preflightWorkingCopy: { unchanged: false } },
    { ...passingRow, cleanupError: "cleanup failed" },
  ]) assert.equal(capabilityPreflightExitCode([broken]), 1);
});

test("frozen copy boundary proves exact source witness and fails every missing condition", () => {
  for (const [kind, tag, attribute] of [["attribute-extra", "div", "style"], ["attribute-extra", "svg", "viewBox"],
    ["attribute-extra", "div", "_echarts_instance_"], ["opaque-canvas", "canvas"], ["empty-container-populated", "div"]]) {
    const rootId = capabilityId(601), witnessId = capabilityId(602);
    const raw = `<div data-pageroot-id="${rootId}">\n<${tag} data-pageroot-id="${witnessId}"></${tag}></div>`;
    const source = Buffer.from(raw), identity = { path: "synthetic.html", sha256: frozenDigest(source), size: source.length };
    const proof = { kind, witnessId, witnessTag: tag, diagnosticPath: "root/div[1]", sourceElementSha256: frozenDigest(raw), ...(attribute ? { attribute } : {}) };
    const target = { clickId: rootId, selectedId: rootId, clickTag: "div", selectedTag: "div", mapping: "self",
      expectedCapability: "AVAILABLE", contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET", sourceProof: "REVIEWED_EXACT_SEED",
      tabId: null, scrollContainer: "document", operations: FROZEN_COPY_DENIED_OPERATIONS,
      selectionPoint: { x: 5, y: 5, expectedHitId: rootId, basis: "direct-authored-hit" }, denialEvidence: proof,
      copyCapability: { expected: "UNSUPPORTED", basis: "REVIEWED_AUTHORED_COPY_BOUNDARY", reason: "runtime-subtree-diverged",
        diagnostic: `root/div[1]:${attribute ? `attribute-extra:${attribute.toLowerCase()}` : kind === "opaque-canvas" ? "opaque-or-program" : "child-count"}` } };
    const plan = { schemaVersion: 1, scope: "core-copy-denied", operation: "copy-denied", reviewStatus: "FROZEN", reviewedBy: "root",
      fileId: "H94", initialRuntime: "runtime", reopen: false, workspaceSourceSha256: "a".repeat(64), original: identity, seed: identity, targets: [target] };
    const bytes = Buffer.from(JSON.stringify(plan)); assert.equal(readFrozenSelection(bytes, frozenDigest(bytes)).operation, "copy-denied");
    for (const mutate of [t => t.selectionPoint.x = -1, t => t.selectionPoint.expectedHitId = witnessId,
      t => t.denialEvidence.witnessId = "stale", t => t.denialEvidence.kind = "AUTO",
      t => t.copyCapability.diagnostic = "", t => t.denialEvidence.diagnosticPath = "AUTO"] ) {
      const broken = structuredClone(plan); mutate(broken.targets[0]); const b = Buffer.from(JSON.stringify(broken));
      assert.throws(() => readFrozenSelection(b, frozenDigest(b)));
    }
    const live = { id: witnessId, tag, connected: true, count: 1, attributeValue: "nonempty", childCount: 1 };
    assert.ok(Object.values(verifyFrozenDenialWitness(source, target, live).conditions).every(Boolean));
    for (const invalid of [{ count: 0 }, { count: 2 }, { id: rootId }, { connected: false }, { tag: "span" },
      ...(attribute ? [{ attributeValue: "" }, { attributeValue: null }] : kind === "empty-container-populated" ? [{ childCount: 0 }, { childCount: null }] : [])]) {
      assert.throws(() => verifyFrozenDenialWitness(source, target, { ...live, ...invalid }), error =>
        error.code === "FROZEN_DENIAL_WITNESS_MISMATCH" && Object.values(error.details.conditions).includes(false) && Boolean(error.details.sourceRange));
    }
    for (const change of [{ sourceElementSha256: "b".repeat(64) }, { diagnosticPath: "root/div[0]" }, { witnessId: rootId }]) {
      assert.throws(() => verifyFrozenDenialWitness(source, { ...target, denialEvidence: { ...proof, ...change } }, live));
    }
    const changed = raw.replace(`data-pageroot-id="${witnessId}"`, `data-pageroot-id="${witnessId}"${attribute ? ` ${attribute}="already-authored"` : ""}`)
      .replace(`></${tag}>`, `>authored</${tag}>`);
    assert.throws(() => verifyFrozenDenialWitness(Buffer.from(changed), target, live));
  }
});

test("frozen executor ingress binds reviewed single target, seed bytes and manifest digest", () => {
  assert.doesNotThrow(() => assertReadOnlyCorpusMode("capability-preflight-only"));
  assert.throws(() => assertReadOnlyCorpusMode("qualification"), { code: "AUTOMATIC_DISCOVERY_EXECUTION_RETIRED" });
  const seed = Buffer.from("synthetic seed");
  const identity = { path: "synthetic.html", sha256: frozenDigest(seed), size: seed.length };
  const plan = { schemaVersion: 1, scope: "single-selection-micro", reviewStatus: "FROZEN",
    reviewedBy: "root", fileId: "H03", initialRuntime: "static", operation: "select", original: identity, seed: identity,
    workspaceSourceSha256: "a".repeat(64), targets: [{
      clickId: capabilityId(301), selectedId: capabilityId(301), clickTag: "p", selectedTag: "p",
      mapping: "self", expectedCapability: "AVAILABLE", contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET",
      sourceProof: "REVIEWED_EXACT_SEED", tabId: null, scrollContainer: "document",
    }] };
  const bytes = Buffer.from(JSON.stringify(plan));
  assert.equal(readFrozenSelection(bytes, frozenDigest(bytes)).targets[0].clickId, capabilityId(301));
  assert.throws(() => readFrozenSelection(bytes, "b".repeat(64)), { code: "FROZEN_MANIFEST_DIGEST_MISMATCH" });
  for (const changed of [
    { ...plan, reviewStatus: "DRAFT" }, { ...plan, targets: [...plan.targets, ...plan.targets] },
    { ...plan, initialRuntime: "AUTO" }, { ...plan, initialRuntime: undefined },
    { ...plan, targets: [{ ...plan.targets[0], clickId: "stale-id" }] },
    { ...plan, targets: [{ ...plan.targets[0], selectedId: capabilityId(302) }] },
  ]) {
    const changedBytes = Buffer.from(JSON.stringify(changed));
    assert.throws(() => readFrozenSelection(changedBytes, frozenDigest(changedBytes)));
  }
  assert.deepEqual(verifyFrozenBytes(seed, identity, "SOURCE_CHANGED"), { hashMatches: true, sizeMatches: true });
  assert.throws(() => verifyFrozenBytes(Buffer.from("Synthetic seed"), identity, "SOURCE_CHANGED"), { code: "SOURCE_CHANGED" });
  assert.throws(() => verifyFrozenBytes(seed, { ...identity, size: seed.length + 1 }, "SOURCE_CHANGED"), { code: "SOURCE_CHANGED" });
  const display = { working: `sha256:${identity.sha256}`, displayed: `sha256:${identity.sha256}` };
  assert.deepEqual(verifyFrozenDisplay(display, identity), { workingMatches: true, displayedMatches: true });
  for (const incorrect of [{ ...display, working: identity.sha256 },
    { ...display, displayed: `sha256:${"b".repeat(64)}` }, { ...display, working: null }]) {
    assert.throws(() => verifyFrozenDisplay(incorrect, identity), { code: "FROZEN_DISPLAY_SOURCE_MISMATCH" });
  }
  const textPlan = { ...plan, scope: "native-text-core-micro", operation: "native-text",
    targets: [{ ...plan.targets[0], operations: FROZEN_TEXT_OPERATIONS,
      textCapability: { expected: "AVAILABLE", basis: "SOURCE_EDITABLE_ISLAND_PLAIN_LEAF",
        clickPoint: "first-direct-text-character" } }] };
  const textBytes = Buffer.from(JSON.stringify(textPlan));
  assert.equal(readFrozenSelection(textBytes, frozenDigest(textBytes)).operation, "native-text");
  const structurePlan = { ...plan, scope: "core-structure-leaf", operation: "structure", reopen: true,
    targets: [{ ...plan.targets[0], clickTag: "span", selectedTag: "span", operations: FROZEN_STRUCTURE_OPERATIONS,
      copyCapability: { expected: "AVAILABLE", basis: "REVIEWED_SOURCE_EQUIVALENT_LEAF", reason: "available" },
      textCapability: { expected: "AVAILABLE", basis: "SOURCE_EDITABLE_ISLAND_PLAIN_LEAF" },
      rebuildPath: "static-rebuild", copyBinding: { kind: "inserted-leaf-at-frozen-source-offset",
        parentId: capabilityId(300), beforeSiblingId: null, byteOffset: 100, originalElementSha256: "a".repeat(64) } }] };
  const structureBytes = Buffer.from(JSON.stringify(structurePlan));
  assert.equal(readFrozenSelection(structureBytes, frozenDigest(structureBytes)).operation, "structure");
  const deniedPlan = { ...plan, scope: "core-copy-denied", operation: "copy-denied", initialRuntime: "runtime", reopen: false,
    targets: [{ ...plan.targets[0], operations: FROZEN_COPY_DENIED_OPERATIONS,
      denialEvidence: { attribute: "data-author-proof", value: "added", sourceElementSha256: "a".repeat(64) },
      copyCapability: { expected: "UNSUPPORTED", basis: "REVIEWED_RUNTIME_ATTRIBUTE_DIVERGENCE",
        reason: "runtime-subtree-diverged", diagnostic: "root:attribute-extra:data-author-proof" } }] };
  const deniedBytes = Buffer.from(JSON.stringify(deniedPlan));
  assert.equal(readFrozenSelection(deniedBytes, frozenDigest(deniedBytes)).operation, "copy-denied");
  for (const change of [{ operations: [] }, { denialEvidence: {} }, { clickTag: "span" },
    { copyCapability: { ...deniedPlan.targets[0].copyCapability, reason: "" } },
    { copyCapability: { ...deniedPlan.targets[0].copyCapability, diagnostic: "root:attribute-extra:other" } },
    { copyCapability: { ...deniedPlan.targets[0].copyCapability, basis: "OBSERVED_UI" } }]) {
    const bytes = Buffer.from(JSON.stringify({ ...deniedPlan, targets: [{ ...deniedPlan.targets[0], ...change }] }));
    assert.throws(() => readFrozenSelection(bytes, frozenDigest(bytes)), { code: "FROZEN_COPY_DENIED_CONTRACT_INVALID" });
  }
  for (const attribute of ["data-runtime-proof", "data-pageroot-edit-runtime-source", "data-html-canvas-selected", "data-pageroot-v2-editing"]) {
    const bytes = Buffer.from(JSON.stringify({ ...deniedPlan, targets: [{ ...deniedPlan.targets[0],
      denialEvidence: { ...deniedPlan.targets[0].denialEvidence, attribute },
      copyCapability: { ...deniedPlan.targets[0].copyCapability, diagnostic: `root:attribute-extra:${attribute}` } }] }));
    assert.throws(() => readFrozenSelection(bytes, frozenDigest(bytes)), { code: "FROZEN_COPY_DENIED_CONTRACT_INVALID" });
  }
  const paragraphBytes = Buffer.from(JSON.stringify({ ...structurePlan,
    targets: [{ ...structurePlan.targets[0], clickTag: "p", selectedTag: "p" }] }));
  assert.equal(readFrozenSelection(paragraphBytes, frozenDigest(paragraphBytes)).targets[0].selectedTag, "p");
  const probeBytes = Buffer.from(JSON.stringify({ ...structurePlan, targets: [{ ...structurePlan.targets[0],
    continuationProbe: "session-ended-no-refocus", operations: FROZEN_STRUCTURE_PROBE_OPERATIONS }] }));
  assert.doesNotThrow(() => readFrozenSelection(probeBytes, frozenDigest(probeBytes)));
  for (const change of [{ operations: ["copy"] }, { rebuildPath: "AUTO" }, { copyBinding: { kind: "find-new-id" } },
    { continuationProbe: "AUTO" }, { continuationProbe: "session-ended-no-refocus" },
    { clickTag: "p" }, { clickTag: "div", selectedTag: "div" },
    { copyCapability: { expected: "AVAILABLE", basis: "OBSERVED_UI", reason: "available" } }]) {
    const bytes = Buffer.from(JSON.stringify({ ...structurePlan, targets: [{ ...structurePlan.targets[0], ...change }] }));
    assert.throws(() => readFrozenSelection(bytes, frozenDigest(bytes)), { code: "FROZEN_STRUCTURE_CONTRACT_INVALID" });
  }
  for (const change of [{ operations: ["activate", "input"] },
    { historyAdoption: "runtime-candidate" },
    { textCapability: { expected: "AVAILABLE", basis: "OBSERVED_UI" } },
    { mapping: "authored-ancestor", selectedId: capabilityId(302) }]) {
    const changedBytes = Buffer.from(JSON.stringify({ ...textPlan,
      targets: [{ ...textPlan.targets[0], ...change }] }));
    assert.throws(() => readFrozenSelection(changedBytes, frozenDigest(changedBytes)),
      { code: "FROZEN_TEXT_CONTRACT_INVALID" });
  }
  const formatPlan = { ...textPlan, scope: "core-text-format", reopen: true, targets: [{ ...textPlan.targets[0],
    operations: FROZEN_FORMAT_OPERATIONS, initialBold: false, textNodePath: [0],
    historyAdoption: "editable-island-in-place", historyBasis: "REVIEWED_CANONICAL_ISLAND",
    historyResume: "in-place",
    formatCapability: { expected: "AVAILABLE", scope: "text-range", basis: "SOURCE_SAFE_TEXT_RANGE_WRAPPER" },
    textCapability: { ...textPlan.targets[0].textCapability, basis: "SOURCE_EDITABLE_ISLAND" } }] };
  for (const initialBold of [false, true]) {
    const bytes = Buffer.from(JSON.stringify({ ...formatPlan,
      targets: [{ ...formatPlan.targets[0], initialBold }] }));
    assert.doesNotThrow(() => readFrozenSelection(bytes, frozenDigest(bytes)));
  }
  const elementPlan = { ...formatPlan, scope: "element-text-format", targets: [{ ...formatPlan.targets[0],
    selectionClick: "frozen-text-character",
    textNodePath: undefined, textEntry: { path: [1], offset: 2, textSha256: "a".repeat(64), trailingText: "" },
    textCapability: { ...formatPlan.targets[0].textCapability, clickPoint: "frozen-text-character" },
    formatCapability: { expected: "AVAILABLE", scope: "element", basis: "SOURCE_ELEMENT_STYLE_NO_NEW_WRAPPER" },
    operations: FROZEN_ELEMENT_OPERATIONS }] };
  const readElement = (change = {}, scope = elementPlan.scope) => {
    const bytes = Buffer.from(JSON.stringify({ ...elementPlan, scope, targets: [{ ...elementPlan.targets[0], ...change }] }));
    return readFrozenSelection(bytes, frozenDigest(bytes));
  };
  for (const tag of ["h1", "h2", "p", "li", "td", "th", "span"])
    assert.doesNotThrow(() => readElement({ clickTag: tag, selectedTag: tag }));
  for (const selectionClick of [undefined, "auto", "retry", "ancestor"])
    assert.throws(() => readElement({ selectionClick }), { code: "FROZEN_CLICK_CONTRACT_INVALID" });
  assert.throws(() => readElement({ tabRoute: { buttonId: "unplanned" } }),
    { code: "FROZEN_TARGET_CONTRACT_INVALID" });
  const reentryElement = [...FROZEN_REENTRY_FORMAT_OPERATIONS.slice(0, -2), ...FROZEN_ELEMENT_OPERATIONS.slice(6)];
  const reentryContract = { historyAdoption: "runtime-candidate", historyResume: "explicit-reentry",
    historyBasis: "REVIEWED_CANONICAL_MAPPING_FALLBACK", operations: reentryElement };
  assert.doesNotThrow(() => readElement(reentryContract));
  assert.throws(() => readElement({ ...reentryContract, operations: FROZEN_ELEMENT_OPERATIONS }),
    { code: "FROZEN_TEXT_CONTRACT_INVALID" });
  assert.doesNotThrow(() => readElement({ textEntry: { ...elementPlan.targets[0].textEntry, trailingText: "\n    " } }));
  for (const trailingText of [undefined, null, "word", "\u00a0"])
    assert.throws(() => readElement({ textEntry: { ...elementPlan.targets[0].textEntry, trailingText } }),
      { code: "FROZEN_ELEMENT_ENTRY_INVALID" });
  for (const entry of [null, { path: [], offset: 0, textSha256: "a".repeat(64) },
    { path: [-1], offset: 0, textSha256: "a".repeat(64) }, { path: [0], offset: -1, textSha256: "a".repeat(64) },
    { path: [0], offset: 0, textSha256: "" }])
    assert.throws(() => readElement({ textEntry: entry }), { code: "FROZEN_ELEMENT_ENTRY_INVALID" });
  assert.throws(() => readElement({}, "core-text-format"), { code: "FROZEN_ELEMENT_ENTRY_INVALID" });
  for (const change of [{ clickTag: "script", selectedTag: "script" }, { clickTag: "div", selectedTag: "div" },
    { operations: FROZEN_FORMAT_OPERATIONS }, { clickTag: "h1", selectedTag: "p" }])
    assert.throws(() => readElement(change), { code: "FROZEN_TEXT_CONTRACT_INVALID" });
  const fallback = Buffer.from(JSON.stringify({ ...formatPlan, targets: [{ ...formatPlan.targets[0],
    historyAdoption: "runtime-candidate", historyBasis: "REVIEWED_CANONICAL_MAPPING_FALLBACK",
    historyResume: "explicit-reentry", operations: FROZEN_REENTRY_FORMAT_OPERATIONS }] }));
  assert.doesNotThrow(() => readFrozenSelection(fallback, frozenDigest(fallback)));
  const mixed = { ...formatPlan, scope: "core-three-cycle", operation: "mixed", initialRuntime: "runtime", cycles: 3,
    commentBasis: "EXACT_AUTHORED_SOURCE_ANCHOR", structurePrefixSha256: "b".repeat(64), targets: [
      { ...formatPlan.targets[0], formatCapability: { expected: "AVAILABLE", scope: "element", basis: "SOURCE_ELEMENT_STYLE_NO_NEW_WRAPPER" } },
      { ...structurePlan.targets[0], selectedId: capabilityId(303), clickId: capabilityId(303),
        rebuildPath: "runtime-candidate", continuationProbe: "session-ended-no-refocus", operations: FROZEN_STRUCTURE_PROBE_OPERATIONS },
    ] };
  const readMixed = plan => { const bytes = Buffer.from(JSON.stringify(plan)); return readFrozenSelection(bytes, frozenDigest(bytes)); };
  assert.doesNotThrow(() => readMixed(mixed));
  const pending = mixedCycleRows(readMixed(mixed));
  assert.equal(pending.length, 3);
  assert.deepEqual(mixedCheckpointOperations(mixed), ["reopen-cumulative", "delete-comment-1", "delete-comment-2", "delete-comment-3"]);
  const pressure = readMixed({ ...mixed, scope: "core-pressure-20", cycles: 20 });
  assert.equal(mixedCycleRows(pressure).length, 20);
  assert.equal(mixedCheckpointOperations(pressure).length, 21);
  assert.equal(mixedCheckpointOperations(pressure).at(-1), "delete-comment-20");
  for (const cycles of [0, 3, 19, 21, 50, 100, "20"])
    assert.throws(() => readMixed({ ...mixed, scope: "core-pressure-20", cycles }), { code: "FROZEN_MIXED_PLAN_INVALID" });
  for (const limit of [50, 100]) {
    const plan = readMixed({ ...mixed, scope: `core-pressure-${limit}`, cycles: limit });
    assert.equal(mixedCycleRows(plan).length, limit);
    assert.equal(mixedCheckpointOperations(plan).length, limit + 1);
    for (const cycles of [0, 3, 20, limit - 1, limit + 1, String(limit)])
      assert.throws(() => readMixed({ ...mixed, scope: `core-pressure-${limit}`, cycles }), { code: "FROZEN_MIXED_PLAN_INVALID" });
  }
  assert.equal(pending.flatMap(cycle => [...cycle.control, ...cycle.text, ...cycle.structure, ...cycle.continuation])
    .every(row => row.state === "NOT_EXECUTED" && row.reason === "DEPENDENCY_NOT_COMPLETED"), true);
  for (const change of [{ cycles: 20 }, { initialRuntime: "static" }, { commentBasis: "LIVE_UI" },
    { reviewStatus: "DRAFT" }, { structurePrefixSha256: "" }, { targets: [mixed.targets[0], mixed.targets[0]] }])
    assert.throws(() => readMixed({ ...mixed, ...change }));
  for (const change of [{ initialBold: null }, { textNodePath: [1] }, { operations: FROZEN_TEXT_OPERATIONS },
    { historyAdoption: "AUTO" }, { historyBasis: "OBSERVED_RUNTIME" }, { historyResume: "AUTO" },
    { formatCapability: { expected: "AVAILABLE", scope: "AUTO" } }]) {
    const bytes = Buffer.from(JSON.stringify({ ...formatPlan, targets: [{ ...formatPlan.targets[0], ...change }] }));
    assert.throws(() => readFrozenSelection(bytes, frozenDigest(bytes)), { code: "FROZEN_TEXT_CONTRACT_INVALID" });
  }
});

test("mixed comments require exact persistent ID and authored anchor, never display-only identity", () => {
  const initial = { workingCopyId: "work_ver_0001", draftRelativePath: "drafts/work_ver_0001.json",
    draftRevision: 0, draftSha256: null };
  assert.doesNotThrow(() => verifyFreshCommentStorage(initial, false));
  assert.throws(() => verifyFreshCommentStorage(initial, true), { code: "FROZEN_INITIAL_COMMENT_STORAGE_INVALID" });
  for (const change of [{ draftRevision: 1 }, { draftSha256: "sha256:published" }, { draftRelativePath: "elsewhere" }])
    assert.throws(() => verifyFreshCommentStorage({ ...initial, ...change }, false), { code: "FROZEN_INITIAL_COMMENT_STORAGE_INVALID" });
  const expected = { commentId: "comment_fixed_1", text: "Synthetic comment", targetId: capabilityId(301) };
  const comment = { commentId: expected.commentId, text: expected.text,
    sourceAnchor: { elementId: expected.targetId, resolution: "exact" } };
  assert.doesNotThrow(() => verifyFrozenComment(comment, expected));
  for (const change of [{ commentId: "old" }, { text: "wrong" }, { sourceAnchor: undefined },
    { sourceAnchor: { elementId: capabilityId(302), resolution: "exact" } },
    { sourceAnchor: { elementId: expected.targetId, resolution: "orphaned" } }])
    assert.throws(() => verifyFrozenComment({ ...comment, ...change }, expected), { code: "FROZEN_COMMENT_IDENTITY_MISMATCH" });
});

test("frozen copy assessment accepts exact available or denied facts and rejects stale UI, live probes and empty reasons", () => {
  const source = Buffer.from("synthetic unchanged source"), sourceHash = `sha256:${frozenDigest(source)}`;
  for (const available of [true, false]) {
    const diagnostic = available ? null : "root:attribute-extra:data-author-proof";
    const target = { selectedId: capabilityId(301), copyCapability: { expected: available ? "AVAILABLE" : "UNSUPPORTED",
      reason: available ? "available" : "runtime-subtree-diverged", ...(diagnostic ? { diagnostic } : {}) } };
    const actual = { probeBefore: 0, probeAfter: 1, ui: available ? "available" : "unsupported", live: available ? "available" : "unsupported",
      uiReason: target.copyCapability.reason, liveReason: target.copyCapability.reason, uiDiagnostic: diagnostic, liveDiagnostic: diagnostic,
      liveId: target.selectedId, sessionEnded: "true", candidateId: null, candidateCount: 0,
      working: sourceHash, displayed: sourceHash, buttonCount: available ? 1 : 0, buttonEnabled: available };
    assert.doesNotThrow(() => verifyFrozenCopyCapability(actual, target, source));
    for (const change of [{ probeAfter: 0 }, { probeBefore: null }, { ui: "UNKNOWN" }, { live: available ? "unsupported" : "available" },
      { uiReason: "" }, { liveReason: "" }, { liveDiagnostic: diagnostic ? null : "unexpected" },
      { uiDiagnostic: "wrong-diagnostic" }, { liveId: capabilityId(302) }, { sessionEnded: "false" },
      { candidateId: "pending" }, { candidateCount: 1 }, { working: "stale" }, { displayed: "stale" },
      { buttonCount: 2 }, { buttonEnabled: !available }]) {
      assert.throws(() => verifyFrozenCopyCapability({ ...actual, ...change }, target, source), error => {
        assert.equal(error.code, "FROZEN_COPY_CAPABILITY_MISMATCH");
        assert.ok(Object.values(error.details.conditions).includes(false));
        assert.equal(Object.keys(error.details.conditions).length, 10);
        return true;
      });
    }
  }
});

test("initial Runtime preparation is not mistaken for an idle handoff or a terminal success", () => {
  const check = (phase, outcome, expected = "runtime") => frozenInitialRuntimeDecision({ phase, outcome }, expected).state;
  assert.equal(check("settled", "ready"), "READY");
  assert.equal(check("static", "not-candidate", "static"), "READY");
  for (const phase of ["preparing", "ready", "running"]) assert.equal(check(phase, null), "WAIT");
  assert.equal(check("static", "source-not-authoritative"), "WAIT");
  for (const [phase, outcome] of [["static", "not-candidate"], ["static-fallback", "prepare-failed"],
    ["settled", "timeout"], [null, null], ["UNKNOWN", "ready"]]) assert.equal(check(phase, outcome), "REJECTED");
  assert.equal(check("settled", "ready", "static"), "REJECTED");
});

test("direct continuation cannot call wrong focus, missed input or source changes an ended session", () => {
  const actual = { sessionEnded: true, frameFocusIsBody: true, targetNotEditable: true, outerFocusSafe: true,
    sourceUnchanged: true, targetTextUnchanged: true, generationUnchanged: true, currentDocument: true, inputEvents: [] };
  assert.doesNotThrow(() => verifyFrozenEndedContinuation(actual));
  for (const key of Object.keys(actual).filter(key => key !== "inputEvents")) {
    for (const value of [false, null, undefined]) {
      assert.throws(() => verifyFrozenEndedContinuation({ ...actual, [key]: value }), error => {
        assert.equal(error.code, "FROZEN_DIRECT_CONTINUATION_MISMATCH");
        assert.equal(error.details.conditions[key], false);
        assert.equal(Object.keys(error.details.conditions).length, 9);
        return true;
      });
    }
  }
  for (const inputEvents of [null, undefined, "", {}, [{ type: "input", id: "wrong-target" }]]) {
    assert.throws(() => verifyFrozenEndedContinuation({ ...actual, inputEvents }), { code: "FROZEN_DIRECT_CONTINUATION_MISMATCH" });
  }
});

test("history reentry requires proven ended session and never excuses input into another target", () => {
  const actual = { sessionEnded: true, editable: false, focusIsBody: true, selectionInside: false };
  assert.doesNotThrow(() => verifyEndedHistorySession(actual));
  for (const key of Object.keys(actual)) {
    for (const value of [!actual[key], null, undefined]) {
      assert.throws(() => verifyEndedHistorySession({ ...actual, [key]: value }),
        { code: "FROZEN_HISTORY_SESSION_END_INVALID" });
    }
  }
});

test("frozen history accepts a reviewed fallback but rejects missing and mismatched lifecycle facts", () => {
  const records = [
    { kind: "rebuild-request", sourceRevision: "sha256:next", reason: "history" },
    { kind: "candidate-created", candidateId: "candidate-new", sourceRevision: "sha256:next" },
    { kind: "candidate-terminal", candidateId: "candidate-new", terminal: "ready" },
    { kind: "generation", beforeGeneration: "1", afterGeneration: "2" },
    { kind: "active-identity", candidateId: "candidate-new", generation: "2" },
    { kind: "runtime-terminal", candidateId: "candidate-new", phase: "settled", terminal: "ready" },
  ];
  const proof = { expectedPath: "runtime-candidate", sourceHash: "sha256:next", records,
    before: { generation: "1", documentId: "old" }, after: { generation: "2", documentId: "new",
      path: "runtime-candidate", working: "sha256:next", displayed: "sha256:next" } };
  assert.doesNotThrow(() => verifyFrozenHistory(proof));
  const structureProof = { ...proof, path: "runtime-candidate", after: { ...proof.after, phase: "settled", outcome: "ready" } };
  assert.doesNotThrow(() => verifyFrozenStructureLifecycle(structureProof));
  for (const change of [{ phase: "static-fallback" }, { outcome: "prepare-failed" }, { phase: null }, { outcome: null }]) {
    assert.throws(() => verifyFrozenStructureLifecycle({ ...structureProof, after: { ...structureProof.after, ...change } }),
      { code: "FROZEN_STRUCTURE_RUNTIME_TERMINAL_INVALID" });
  }
  for (const broken of [
    ...records.map((_, index) => ({ ...proof, records: records.filter((_, i) => i !== index) })),
    ...[{ documentId: "old" }, { generation: "1" }, { path: "UNKNOWN" }, { displayed: "sha256:wrong" }]
      .map((change) => ({ ...proof, after: { ...proof.after, ...change } })),
    { ...proof, records: records.map((row) => row.kind === "active-identity" ? { ...row, candidateId: "wrong" } : row) },
    { ...proof, records: records.map((row) => row.kind === "runtime-terminal" ? { ...row, terminal: "static-fallback" } : row) },
    { ...proof, records: [...records, { kind: "candidate-created", candidateId: "extra" }] },
    { ...proof, before: { ...proof.before, generation: null } },
  ]) {
    assert.throws(() => verifyFrozenHistory(broken), { code: "FROZEN_HISTORY_ADOPTION_INVALID" });
    if (broken.after.path !== "UNKNOWN") assert.throws(() => verifyFrozenStructureLifecycle({ ...broken, path: "runtime-candidate" }),
      { code: "FROZEN_HISTORY_ADOPTION_INVALID" });
  }
  const inPlace = { ...proof, expectedPath: "editable-island-in-place", records: [],
    after: { ...proof.after, path: "editable-island-in-place", documentId: "old", generation: "1" } };
  assert.doesNotThrow(() => verifyFrozenHistory(inPlace));
  assert.throws(() => verifyFrozenHistory({ ...inPlace, records }), { code: "FROZEN_HISTORY_ADOPTION_INVALID" });
});

test("static structure rebuild requires a new current document and explicit non-Runtime terminal", () => {
  const proof = { path: "static-rebuild", records: [], sourceHash: "sha256:next",
    before: { documentId: "old", generation: "1" }, after: { documentId: "new", generation: "2",
      working: "sha256:next", displayed: "sha256:next", phase: "static", outcome: "not-candidate" } };
  assert.equal(verifyFrozenStructureLifecycle(proof).candidate.state, "NOT_APPLICABLE");
  for (const change of [{ documentId: "old" }, { generation: "1" }, { displayed: "sha256:old" },
    { phase: "static-fallback" }, { outcome: "prepare-failed" }]) {
    assert.throws(() => verifyFrozenStructureLifecycle({ ...proof, after: { ...proof.after, ...change } }),
      { code: "FROZEN_STATIC_REBUILD_INVALID" });
  }
  assert.throws(() => verifyFrozenStructureLifecycle({ ...proof, records: [{ kind: "candidate-created" }] }),
    { code: "FROZEN_STATIC_REBUILD_INVALID" });
});

test("frozen text operation ledger fails omissions, unknowns, empty reasons and timeouts", () => {
  const rows = FROZEN_TEXT_OPERATIONS.map((operation) => ({ operation,
    state: "PASS", reason: "EXPECTED_CHANGE_OBSERVED", durationMs: 1 }));
  assert.doesNotThrow(() => requireTextOperationLedger(rows, FROZEN_TEXT_OPERATIONS));
  for (const incorrect of [rows.slice(1), [...rows, rows[0]],
    ...[{ state: "UNKNOWN" }, { state: "NOT_EXECUTED" }, { state: "FAIL", reason: "TimeoutError" },
      { reason: "" }, { durationMs: null }, { operation: "scan" }]
      .map((change) => [{ ...rows[0], ...change }, ...rows.slice(1)])]) {
    assert.throws(() => requireTextOperationLedger(incorrect, FROZEN_TEXT_OPERATIONS),
      { code: "FROZEN_TEXT_LEDGER_INVALID" });
  }
});

test("frozen source reader accepts a bounded atomic publication gap but fails persistent absence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "frozen-reader-self-proof-"));
  const source = path.join(directory, "source.html");
  const staged = path.join(directory, "staged.html");
  try {
    await writeFile(staged, "synthetic source");
    const reading = readPublishedWorkingCopy(source, null);
    await rename(staged, source);
    assert.deepEqual(await reading, Buffer.from("synthetic source"));
    await assert.rejects(readPublishedWorkingCopy(staged, null), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capability target selection covers dimensions before the deterministic ceil(60%) fill", () => {
  const manifest = admittedCapabilityEvidence();
  const first = selectCapabilityTargets(manifest);
  const second = selectCapabilityTargets(manifest);
  assert.deepEqual(
    first.selected.map((entry) => entry.elementId),
    second.selected.map((entry) => entry.elementId),
  );
  assert.ok(first.selected.length >= Math.ceil(manifest.entries.length * 0.6));
  assert.deepEqual(first.order, "tabId/sourceOrder/StableID");
  for (const family of manifest.capabilityFamilies) {
    assert.equal(first.selected.some((entry) => entry.capabilityFamilies.includes(family)), true);
  }
  for (const region of ["top", "middle", "bottom"]) {
    assert.equal(first.selected.some((entry) => entry.region === region), true);
  }
  for (const tabId of manifest.tabs) assert.equal(first.selected.some((entry) => entry.tabId === tabId), true);
  for (const majorType of manifest.majorTypes) {
    assert.equal(first.selected.some((entry) => entry.type === majorType), true);
  }
});

test("failed fixed capability target is retained and never replaced", () => {
  const selection = selectCapabilityTargets(admittedCapabilityEvidence());
  const before = selection.selected.map((entry) => entry.elementId);
  const failed = recordCapabilityTargetOutcome(selection, before[0], {
    state: "FAIL",
    reasonCode: "CAPABILITY_ACTION_FAILED",
  });
  assert.deepEqual(failed.selected.map((entry) => entry.elementId), before);
  assert.deepEqual(failed.replacements, []);
  assert.deepEqual(failed.failedElementIds, [before[0]]);
  assert.equal(failed.selected[0].outcome.state, "FAIL");
});

function passingCapabilityMatrix(overrides = {}) {
  const manifest = admittedCapabilityEvidence();
  const selection = selectCapabilityTargets(manifest);
  return createCapabilityMatrix({
    manifest,
    selection,
    observations: selection.selected.map((entry) => ({
      elementId: entry.elementId,
      capabilityFamily: entry.capabilityFamilies[0],
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.OBSERVED,
    })),
    behaviors: manifest.behaviorFamilies.map((behaviorFamily) => ({
      elementId: selection.selected[0].elementId,
      behaviorFamily,
      kind: CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR,
      assigned: true,
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
    })),
    originalSource: { hash: "sha256:original", size: 100 },
    observedSource: { hash: "sha256:original", size: 100 },
    ...overrides,
  });
}

test("capability matrix separates observations from actual behavior and passes complete evidence", () => {
  const matrix = passingCapabilityMatrix();
  assert.equal(matrix.verdict.ok, true);
  assert.equal(matrix.observations.every((row) => row.kind === CAPABILITY_MATRIX_ROW_KINDS.OBSERVATION), true);
  assert.equal(matrix.actualBehaviors.every((row) => row.kind === CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR), true);
  assert.equal(matrix.verdict.coveredElementIds.length, new Set(matrix.verdict.coveredElementIds).size);
  assert.equal(matrix.verdict.coverage >= 0.6, true);
});

test("capability matrix rejects under-60 coverage, all-top selection and missing dimensions", () => {
  const underCovered = passingCapabilityMatrix({
    observations: [],
  });
  assert.equal(underCovered.verdict.ok, false);
  assert.ok(underCovered.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.COVERAGE_BELOW_THRESHOLD));

  const allTopManifest = admittedCapabilityEvidence({ allTop: true });
  const allTopSelection = selectCapabilityTargets(allTopManifest);
  const allTop = createCapabilityMatrix({
    manifest: allTopManifest,
    selection: allTopSelection,
    observations: allTopSelection.selected.map((entry) => ({ elementId: entry.elementId, state: "PASS" })),
    originalSource: { hash: "sha256:top", size: 100 },
    observedSource: { hash: "sha256:top", size: 100 },
  });
  assert.equal(allTop.verdict.ok, false);
  assert.ok(allTop.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_REGION));
  assert.ok(allTop.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_MAJOR_TYPE) === false);

  const missingBehavior = passingCapabilityMatrix({
    requiredBehaviorFamilies: ["not-executed-family"],
  });
  assert.equal(missingBehavior.verdict.ok, false);
  assert.ok(missingBehavior.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_BEHAVIOR_FAMILY));
});

test("capability matrix rejects failure states, unassigned behavior, timeout, empty reason and source changes", () => {
  for (const state of ["FAIL", "NOT_EXECUTED", "BLOCKED", "UNKNOWN"]) {
    const matrix = passingCapabilityMatrix({
      observations: [{ elementId: capabilityId(1), state, reasonCode: state === "UNKNOWN" ? "UNKNOWN_EVIDENCE" : "ACTION_FAILED" }],
    });
    assert.equal(matrix.verdict.ok, false, state);
  }
  const unassigned = passingCapabilityMatrix({
    behaviors: [{
      elementId: capabilityId(1),
      behaviorFamily: "activation",
      kind: CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR,
      assigned: false,
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.UNASSIGNED_BEHAVIOR,
    }],
    requiredBehaviorFamilies: ["activation"],
  });
  assert.equal(unassigned.verdict.ok, false);
  assert.ok(unassigned.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_BEHAVIOR_FAMILY));

  const timeout = passingCapabilityMatrix({ harnessState: "HARNESS_TIMEOUT" });
  assert.equal(timeout.verdict.ok, false);
  assert.ok(timeout.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.HARNESS_TIMEOUT));

  const emptyReason = passingCapabilityMatrix({
    observations: [{ elementId: capabilityId(1), state: "FAIL", reasonCode: "" }],
  });
  assert.ok(emptyReason.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ROW_REASON_EMPTY));

  const changedHash = passingCapabilityMatrix({
    observedSource: { hash: "sha256:changed", size: 100 },
  });
  assert.ok(changedHash.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_HASH_CHANGED));
  const changedSize = passingCapabilityMatrix({
    observedSource: { hash: "sha256:original", size: 101 },
  });
  assert.ok(changedSize.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_SIZE_CHANGED));
});

function fullContinuityEvidence() {
  return {
    request: { sourceRevision: "sha256:source-2", reason: "structure-edit", status: "submitted" },
    candidate: { candidateId: "candidate-2", sourceRevision: "sha256:source-2", status: "ready" },
    generation: { before: 1, after: 2, observed: true },
    active: { candidateId: "candidate-2", generation: 2, documentId: "runtime-doc-2" },
    runtime: { candidateId: "candidate-2", generation: 2, documentId: "runtime-doc-2", terminal: true, phase: "settled", outcome: "ready" },
    rebuildSource: { hash: "sha256:source-2", size: 180 },
    workingSource: { hash: "sha256:source-2", size: 200 },
    displayedSource: {
      hash: "sha256:source-2",
      workingProjectionHash: "sha256:source-2",
      stale: false,
      size: 200,
    },
    selection: {
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      after: { elementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", connected: true },
      focus: {
        activeElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        anchorElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        focusElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    previousTargetRetired: true,
    ordinaryEdit: {
      before: { documentId: "runtime-doc-1", generation: 1 },
      after: { documentId: "runtime-doc-1", generation: 1 },
    },
    continuation: {
      mode: "session-ended",
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      directInputApplied: false,
      directTargetId: null,
      sessionEnded: true,
      relocatedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      relocatedInputApplied: true,
    },
  };
}

test("continuity chain passes only when each request, Candidate, generation, Active, Runtime, source and focus fact is present", () => {
  const chain = evaluateContinuityChain(fullContinuityEvidence());
  assert.equal(chain.ok, true);
  assert.equal(chain.state, "PASS");
  for (const part of [
    "request",
    "candidateIdentity",
    "candidateTerminal",
    "generation",
    "activeIdentity",
    "runtimeTerminal",
    "sourceConsistency",
    "selection",
    "focus",
    "continuation",
    "previousTarget",
  ]) assert.equal(chain.parts[part].state, "PASS", part);
});

test("continuity chain does not substitute generation for Candidate/ID or Candidate terminal", () => {
  const generationOnly = fullContinuityEvidence();
  delete generationOnly.candidate;
  const noCandidate = evaluateContinuityChain(generationOnly);
  assert.equal(noCandidate.ok, false);
  assert.equal(noCandidate.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING);

  const noTerminal = fullContinuityEvidence();
  delete noTerminal.candidate.status;
  const candidateOnly = evaluateContinuityChain(noTerminal);
  assert.equal(candidateOnly.ok, false);
  assert.equal(candidateOnly.parts.candidateIdentity.state, "PASS");
  assert.equal(candidateOnly.parts.candidateTerminal.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_TERMINAL_MISSING);
});

test("continuity chain rejects wrong Candidate promotion and stale Candidate source", () => {
  const wrongPromotion = fullContinuityEvidence();
  wrongPromotion.active.candidateId = "candidate-old";
  const wrong = evaluateContinuityChain(wrongPromotion);
  assert.equal(wrong.parts.candidateIdentity.state, "PASS");
  assert.equal(wrong.parts.activeIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.ACTIVE_CANDIDATE_MISMATCH);

  const stale = fullContinuityEvidence();
  stale.candidate.sourceRevision = "sha256:old-source";
  stale.request.sourceRevision = "sha256:old-source";
  const staleResult = evaluateContinuityChain(stale);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_SOURCE_MISMATCH);
});

test("continuity chain rejects a Candidate attached to a different rebuild request", () => {
  const mismatched = fullContinuityEvidence();
  mismatched.request.sourceRevision = "sha256:request-source";
  const result = evaluateContinuityChain(mismatched);
  assert.equal(result.ok, false);
  assert.equal(
    result.parts.candidateIdentity.reasonCode,
    CONTINUITY_CHAIN_REASONS.CANDIDATE_REQUEST_MISMATCH,
  );
});

test("continuity chain compares Candidate to the rebuild snapshot, not later continuation source", () => {
  const continued = fullContinuityEvidence();
  continued.workingSource = { hash: "sha256:source-3", size: 220 };
  continued.displayedSource = {
    hash: "sha256:source-3",
    workingProjectionHash: "sha256:source-3",
    stale: false,
    size: 220,
  };
  const result = evaluateContinuityChain(continued);
  assert.equal(result.ok, true);
  assert.equal(result.parts.candidateIdentity.state, "PASS");
  assert.equal(result.parts.sourceConsistency.state, "PASS");
});

test("continuity chain rejects wrong or detached selection, ordinary rebuild, unknown and timeout evidence", () => {
  const wrongSelection = fullContinuityEvidence();
  wrongSelection.selection.after.elementId = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const wrong = evaluateContinuityChain(wrongSelection);
  assert.equal(wrong.parts.selection.reasonCode, CONTINUITY_CHAIN_REASONS.SELECTION_ELEMENT_MISMATCH);

  const detached = fullContinuityEvidence();
  detached.selection.after.connected = false;
  const detachedResult = evaluateContinuityChain(detached);
  assert.equal(detachedResult.parts.selection.reasonCode, CONTINUITY_CHAIN_REASONS.DETACHED_LOCATOR);

  const rebuilt = fullContinuityEvidence();
  rebuilt.ordinaryEdit.after.generation = 2;
  const rebuiltResult = evaluateContinuityChain(rebuilt);
  assert.equal(rebuiltResult.parts.ordinaryEdit.reasonCode, CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_REBUILT_RUNTIME);

  const missingOrdinary = fullContinuityEvidence();
  delete missingOrdinary.ordinaryEdit;
  const missingOrdinaryResult = evaluateContinuityChain(missingOrdinary);
  assert.equal(
    missingOrdinaryResult.parts.ordinaryEdit.reasonCode,
    CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_EVIDENCE_MISSING,
  );

  const missingSelectionIdentity = fullContinuityEvidence();
  delete missingSelectionIdentity.selection.after.elementId;
  delete missingSelectionIdentity.selection.focus;
  const missingSelectionResult = evaluateContinuityChain(missingSelectionIdentity);
  assert.equal(missingSelectionResult.ok, false);
  assert.equal(
    missingSelectionResult.parts.selection.reasonCode,
    CONTINUITY_CHAIN_REASONS.SELECTION_MISSING,
  );
  assert.equal(
    missingSelectionResult.parts.focus.reasonCode,
    CONTINUITY_CHAIN_REASONS.FOCUS_ELEMENT_MISMATCH,
  );

  const wrongContinuation = fullContinuityEvidence();
  wrongContinuation.continuation = {
    mode: "without-refocus",
    expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    directInputApplied: true,
    directTargetId: "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const wrongContinuationResult = evaluateContinuityChain(wrongContinuation);
  assert.equal(
    wrongContinuationResult.parts.continuation.reasonCode,
    CONTINUITY_CHAIN_REASONS.CONTINUATION_WRONG_TARGET,
  );

  const unknown = evaluateContinuityChain({ ...fullContinuityEvidence(), harnessStatus: "UNKNOWN" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.failures[0].code, CONTINUITY_CHAIN_REASONS.UNKNOWN_EVIDENCE);

  const timeout = evaluateContinuityChain({ ...fullContinuityEvidence(), harnessTimeout: true });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.failures[0].code, CONTINUITY_CHAIN_REASONS.HARNESS_TIMEOUT);
});

test("explicit static N/A applies only to Candidate facts and cannot hide other missing evidence", () => {
  const staticResult = evaluateContinuityChain({
    request: { sourceRevision: "sha256:static", status: "submitted" },
    staticNotApplicableReason: RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
  });
  assert.equal(staticResult.ok, false);
  assert.equal(staticResult.parts.candidateIdentity.state, "NOT_APPLICABLE");
  assert.equal(staticResult.parts.candidateTerminal.state, "NOT_APPLICABLE");

  const preparationFailed = evaluateContinuityChain({
    request: { sourceRevision: "sha256:failed", status: "submitted" },
    staticNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE,
  });
  assert.equal(preparationFailed.parts.candidateIdentity.state, "FAIL");
  assert.equal(
    preparationFailed.parts.candidateIdentity.reasonCode,
    CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING,
  );

  const unexplained = evaluateContinuityChain({
    request: { sourceRevision: "sha256:no-candidate", status: "submitted" },
    generation: { before: 1, after: 2 },
  });
  assert.equal(unexplained.ok, false);
  assert.equal(unexplained.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING);
});

function fullStaleCandidateEvidence() {
  return {
    heldCandidate: {
      candidateId: "candidate-held",
      activeCandidateId: "candidate-active",
      sourceRevision: "sha256:held",
    },
    heldSource: { hash: "sha256:held", size: 180 },
    latestSource: { hash: "sha256:latest", size: 195 },
    continuation: {
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      directInputApplied: false,
      directTargetId: null,
      sessionEnded: true,
      relocatedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      relocatedInputApplied: true,
    },
    finalSource: {
      hash: "sha256:latest",
      workingHash: "sha256:latest",
      displayedHash: "sha256:latest",
      stale: false,
      latestMarkerPresent: true,
    },
  };
}

test("stale Candidate fence accepts both safe continuation modes and preserves the latest source", () => {
  const relocated = evaluateStaleCandidateFence(fullStaleCandidateEvidence());
  assert.equal(relocated.ok, true);

  const direct = fullStaleCandidateEvidence();
  direct.continuation = {
    expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    directInputApplied: true,
    directTargetId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sessionEnded: false,
    relocatedElementId: null,
    relocatedInputApplied: false,
  };
  assert.equal(evaluateStaleCandidateFence(direct).ok, true);
});

test("stale Candidate fence rejects wrong delivery and stale overwrite independently", () => {
  const wrongCandidateRevision = fullStaleCandidateEvidence();
  wrongCandidateRevision.heldCandidate.sourceRevision = "sha256:wrong-held";
  assert.equal(
    evaluateStaleCandidateFence(wrongCandidateRevision).parts.sourceAdvance.reasonCode,
    STALE_CANDIDATE_REASONS.HELD_CANDIDATE_SOURCE_MISMATCH,
  );

  const wrongTarget = fullStaleCandidateEvidence();
  wrongTarget.continuation.directInputApplied = true;
  wrongTarget.continuation.directTargetId = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal(
    evaluateStaleCandidateFence(wrongTarget).parts.continuation.reasonCode,
    STALE_CANDIDATE_REASONS.CONTINUATION_WRONG_TARGET,
  );

  const overwritten = fullStaleCandidateEvidence();
  overwritten.finalSource = {
    hash: "sha256:held",
    workingHash: "sha256:held",
    displayedHash: "sha256:held",
    stale: false,
    latestMarkerPresent: false,
  };
  const overwrittenResult = evaluateStaleCandidateFence(overwritten);
  assert.equal(overwrittenResult.ok, false);
  assert.equal(
    overwrittenResult.parts.finalSource.reasonCode,
    STALE_CANDIDATE_REASONS.STALE_CANDIDATE_OVERWROTE_SOURCE,
  );

  const staleProjection = fullStaleCandidateEvidence();
  staleProjection.finalSource.displayedHash = "sha256:held";
  staleProjection.finalSource.stale = true;
  assert.equal(
    evaluateStaleCandidateFence(staleProjection).parts.finalSource.reasonCode,
    STALE_CANDIDATE_REASONS.FINAL_PROJECTION_STALE,
  );
});

test("runtime observer summaries keep Candidate, generation and Runtime terminal observations independent", () => {
  const summary = summarizeRuntimeObserverRecords([
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: "candidate-2" },
    { kind: "generation", beforeGeneration: "1", afterGeneration: "2" },
    { kind: "candidate-terminal", terminal: "ready", candidateId: "candidate-2" },
    {
      kind: "runtime-terminal",
      terminal: "ready",
      phase: "settled",
      outcome: "ready",
      candidateId: "candidate-2",
      generation: "2",
    },
  ]);
  assert.equal(summary.hasCandidate, true);
  assert.equal(summary.hasGeneration, true);
  assert.equal(summary.hasCandidateTerminal, true);
  assert.equal(summary.hasRuntimeTerminal, true);
  assert.equal(summary.candidate.candidateId, "candidate-2");
  assert.equal(summary.generation.beforeGeneration, "1");
  assert.equal(summary.candidateTerminal.terminal, "ready");
  assert.equal(summary.runtimeTerminal.terminal, "ready");
});
