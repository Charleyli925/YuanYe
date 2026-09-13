// Opt-in local acceptance. User HTML and artifacts never belong in Git/CI.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  currentEditorFrame,
  documentToken,
  expect,
  expectCheckpointPersisted,
  keyShortcut,
  launchPageRoot,
  managedWorkingCopyPath,
  stopPageRoot,
  waitForProjectReady,
  waitForRuntimeHandoffSettled,
} from "./electron-native-harness.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import {
  COPY_DIAGNOSTIC_CLASSIFICATIONS,
  classifyCopyDiagnostic,
} from "./helpers/copy-diagnostic-classifier.mjs";
import { buildSourceIndex } from "../../../app/lib/source-index.js";
import { withRestoredElectronClipboard } from "./helpers/clipboard-snapshot.mjs";
import {
  RealHtmlResultReport,
} from "./real-html/result-report.mjs";
import { qualificationResultIssues } from "./real-html/result-model.mjs";
import {
  REAL_HTML_OPERATION_IDS,
  REAL_HTML_STAGE_IDS,
} from "./real-html/plan.mjs";
import {
  CAPABILITY_MANIFEST_REASONS,
  CAPABILITY_MATRIX_REASONS,
  createCapabilityManifest,
  createCapabilityMatrix,
  selectCapabilityTargets,
} from "./real-html/capability-manifest.mjs";
import {
  capabilityObservationSnapshot,
  collectVisibleAuthoredCandidates,
  discoverRuntimeGeneratedTargets,
  driveAuthoredTabActivation,
  majorElementType,
  normalizeCapabilityProbeObservations,
  probeAuthoredCapability,
  resetAuthoredProbeSelection,
  runtimeGeneratedDiagnosticsIssue,
  sourceElementsForCapabilityManifest,
} from "./real-html/capability-driver.mjs";
import {
  runtimeOperationOutcomes,
} from "./real-html/runtime-lifecycle.mjs";
import { publicDiagnosticValue } from "./real-html/diagnostic-sanitizer.mjs";
import { assertReadOnlyCorpusMode } from "./real-html/frozen-selection.mjs";
import {
  attachOperationGroupsToAuthoredDenominator,
  capabilityExpectationRows,
  capabilityPreflightExitCode,
  capabilityPreflightFileStatus,
  createCapabilityManifestDraft,
} from "./real-html/capability-manifest-draft.mjs";
import {
  evaluateContinuityChain,
  evaluateStaleCandidateFence,
  runtimeProjectionStale,
} from "./real-html/continuity-chain.mjs";
import {
  evaluateExtendedFormatEvidence,
  formatFailureRows,
} from "./real-html/extended-format-evidence.mjs";
import {
  startRuntimeLifecycleObservation as startFullRuntimeLifecycleObservation,
  startRuntimeCandidateObservation,
  stopRuntimeLifecycleObservation as stopFullRuntimeLifecycleObservation,
  stopRuntimeCandidateObservation,
  summarizeRuntimeObserverRecords,
} from "./real-html/runtime-observer.mjs";
import {
  createFixedTextTargetPlan,
  describeTextTarget,
  TEXT_TARGET_COUNT,
  TEXT_TARGET_REASON_CODES,
  TEXT_TARGET_SELECTOR,
  validateFrozenTextTarget,
} from "./real-html/text-targets.mjs";
import {
  compareElementScopedMutation,
  compareElementStyleMutation,
  formattedMarkerAppendedPattern,
  SOURCE_SCOPE_POLICIES,
} from "./real-html/source-scope.mjs";
import {
  compareOriginalFileIdentity,
  workspaceSourceFingerprint,
} from "./real-html/workspace-provenance.mjs";
import {
  buildSourceIndex as buildPatchSourceIndex,
  createTargetRef,
} from "../../../app/lib/source-patch-core.js";
import { isEditableIslandTarget } from "../../../app/lib/editable-island.js";
import { isTransparentSourceTextElement } from "../../../app/lib/source-text-map.js";

const corpus = process.env.PAGEROOT_REAL_HTML_DIR;
if (!corpus) {
  throw new Error(
    "Set PAGEROOT_REAL_HTML_DIR to the user-designated local HTML corpus. Synthetic fallback is not acceptance.",
  );
}

const runnerMode = process.env.PAGEROOT_REAL_HTML_MODE || "qualification";
if (!["qualification", "capability-preflight-only"].includes(runnerMode)) {
  throw new Error(`Unsupported PAGEROOT_REAL_HTML_MODE: ${runnerMode}`);
}
const capabilityPreflightOnly = runnerMode === "capability-preflight-only";
assertReadOnlyCorpusMode(runnerMode);

const corpusFiles = readdirSync(corpus).filter((name) => /\.html?$/iu.test(name)).sort();
if (!corpusFiles.length) {
  throw new Error("The local corpus contains no HTML files. Acceptance was not run.");
}
const requestedFileIndexes = new Set(
  String(process.env.PAGEROOT_REAL_HTML_FILE_INDEXES || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1),
);
const files = requestedFileIndexes.size
  ? corpusFiles.filter((_name, index) => requestedFileIndexes.has(index + 1))
  : corpusFiles;
if (!files.length) {
  throw new Error("The requested local corpus file indexes did not match any HTML files.");
}

const reportDir = mkdtempSync(path.join(tmpdir(), "stemmio-real-html-acceptance-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const resultReport = new RealHtmlResultReport(files, {
  reportKind: "private-real-html-electron",
});
const REAL_HTML_LAUNCH_OPTIONS = Object.freeze({
  injectedEnv: Object.freeze({
    PAGEROOT_E2E_RUNTIME_COMMIT_HOOKS: "1",
  }),
});
const sourceProvenance = workspaceSourceFingerprint();
const report = {
  schemaVersion: 4,
  mode: runnerMode,
  head: sourceProvenance.head,
  tree: sourceProvenance.tree,
  workspaceSourceSha256: sourceProvenance.workspaceSourceSha256,
  untrackedSourceFileCount: sourceProvenance.untrackedFileCount,
  planned: files.length,
  corpusFiles: corpusFiles.length,
  selectedFileIndexes: [...requestedFileIndexes].sort((left, right) => left - right),
  minimumTextHostsPerFile: 3,
  structureCyclesWhenExpectedCopyableApplies: 2,
  minimumOrdinaryContinuityChecksPerFile: 3,
  minimumAuthoredElementCoverage: 0.6,
  minimumDynamicContinuityCyclesPerFile: 3,
  inputAuthority: "Real mouse/keyboard for fixed text flows; native color controls use bounded input/change event injection and are labeled per behavior row",
  categories: {
    A: "文字编辑",
    B: "元素结构（冻结 Stable ID 与实时能力）",
    C: "Runtime/iframe（独立生命周期事实）",
    D: "元素能力清单与行为覆盖矩阵",
    E: "编辑→重建→继续编辑长会话",
  },
  resultPlan: resultReport.plan,
  results: [],
};

console.log(`Private report: ${reportDir}`);
const saveReport = () => writeFileSync(
  path.join(reportDir, "results.json"),
  JSON.stringify(capabilityPreflightOnly
    ? report
    : { ...report, resultModel: resultReport.model }, null, 2),
);

const PRIVATE_ERROR_KEYS = new Set([
  "afterSnippet",
  "beforeSnippet",
  "html",
  "raw",
  "text",
  "value",
  "message",
  "stack",
  "filename",
  "path",
  "selector",
]);

function publicRange(range) {
  if (!range || typeof range !== "object") return null;
  const start = Number.isInteger(range.start) ? range.start : null;
  const end = Number.isInteger(range.end) ? range.end : null;
  return {
    start,
    end,
    length: start != null && end != null ? Math.max(0, end - start) : null,
  };
}

function publicFirstDifferingByte(value) {
  if (!value || typeof value !== "object") return null;
  return {
    beforeOffset: Number.isInteger(value.beforeOffset) ? value.beforeOffset : null,
    afterOffset: Number.isInteger(value.afterOffset) ? value.afterOffset : null,
  };
}

function publicOracleRange(value) {
  if (!value || typeof value !== "object") return null;
  return {
    scope: typeof value.scope === "string" ? value.scope : null,
    reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null,
    kind: typeof value.kind === "string" ? value.kind : null,
    sourceRange: publicRange(value.sourceRange),
    domRange: publicRange(value.domRange),
    beforeRange: publicRange(value.beforeRange),
    afterRange: publicRange(value.afterRange),
    firstDifferingByte: publicFirstDifferingByte(value.firstDifferingByte),
  };
}

function collectOracleBooleans(value, path = "", output = {}) {
  if (typeof value === "boolean") {
    output[path || "ok"] = value;
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_ERROR_KEYS.has(key) || key === "errors" || key === "allowedRegions") continue;
    collectOracleBooleans(nested, path ? `${path}.${key}` : key, output);
  }
  return output;
}

function publicOracleDetails(oracle) {
  if (!oracle || typeof oracle !== "object") return null;
  const changedRanges = Array.isArray(oracle.changedRanges)
    ? oracle.changedRanges.map(publicOracleRange)
    : oracle.changedRanges?.before || oracle.changedRanges?.after
      ? [
        {
          scope: "target",
          reasonCode: null,
          kind: "before",
          sourceRange: publicRange(oracle.changedRanges.before),
          domRange: null,
          beforeRange: publicRange(oracle.changedRanges.before),
          afterRange: null,
          firstDifferingByte: null,
        },
        {
          scope: "target",
          reasonCode: null,
          kind: "after",
          sourceRange: publicRange(oracle.changedRanges.after),
          domRange: null,
          beforeRange: null,
          afterRange: publicRange(oracle.changedRanges.after),
          firstDifferingByte: null,
        },
      ]
      : [];
  const errors = Array.isArray(oracle.errors)
    ? oracle.errors.map((entry) => ({
      code: typeof entry?.code === "string" ? entry.code : null,
    }))
    : [];
  return {
    exactReason: oracle.ok === true
      ? "SOURCE_SCOPE_ORACLE_PASSED"
      : errors.find((entry) => entry.code)?.code || "SOURCE_SCOPE_ORACLE_FAILED",
    booleanConditions: collectOracleBooleans(oracle),
    changedRanges,
    changedRegionCount: Number.isInteger(oracle.changedRegionCount)
      ? oracle.changedRegionCount
      : changedRanges.filter((entry) => entry?.scope === "allowed").length,
    outsideChangedRangeCount: Number.isInteger(oracle.outsideChangedRangeCount)
      ? oracle.outsideChangedRangeCount
      : changedRanges.filter((entry) => entry?.scope === "outside").length,
    appendedByteRange: publicRange(oracle.appendedByteRange),
    elementRanges: {
      before: publicRange(oracle.elementRanges?.before),
      after: publicRange(oracle.elementRanges?.after),
    },
    errors,
  };
}

function errorDetails(error) {
  const code = error?.code || null;
  const oracle = publicOracleDetails(error?.oracle);
  const details = publicDiagnosticValue(error?.details);
  return {
    error: code === "SOURCE_SCOPE_ORACLE_FAILED"
      ? "Source scope oracle failed."
      : String(error?.stack || error),
    code,
    exactReason: oracle?.exactReason || details?.exactReason || null,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    ...(oracle ? { oracle } : {}),
  };
}

function recordOperationFailure(fileId, stageId, operationId, error) {
  resultReport.failOperation(fileId, stageId, operationId, errorDetails(error));
}

async function runtimeContractSnapshot(page) {
  const editor = editorFor(page);
  const surface = surfaceFor(page);
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  const candidate = editor.locator('iframe[data-frame-role="runtime-candidate"]');
  const identity = await currentFrameIdentity(page);
  return {
    ...identity,
    candidateId: await editor.getAttribute("data-runtime-candidate-id"),
    candidatePhase: await editor.getAttribute("data-runtime-candidate-phase"),
    lastKnownGoodId: await editor.getAttribute("data-runtime-last-known-good-id"),
    lastKnownGoodGeneration: await editor.getAttribute(
      "data-runtime-last-known-good-generation",
    ),
    lastKnownGoodSourceRevision: await editor.getAttribute(
      "data-runtime-last-known-good-source-revision",
    ),
    workingSourceSha256: await editor.getAttribute("data-working-source-sha256"),
    renderedProjectionSha256: await editor.getAttribute("data-rendered-projection-sha256"),
    renderedProjectionStale: await editor.getAttribute("data-rendered-projection-stale"),
    candidateCount: await candidate.count(),
    renderVerified: await editor.getAttribute("data-render-verified"),
    runtimePhase: await surface.getAttribute("data-edit-runtime-phase"),
    runtimeOutcome: await surface.getAttribute("data-edit-runtime-outcome"),
    degradation: await editor.getAttribute("data-runtime-degradation"),
    staticFallbackVisible: await surface.getByTestId("edit-runtime-static-fallback")
      .count()
      .catch(() => 0),
    activeSandbox: await active.getAttribute("sandbox"),
  };
}

async function startRuntimeLifecycleObservation(page) {
  await editorFor(page).evaluate(startRuntimeCandidateObservation);
}

async function stopRuntimeLifecycleObservation(page) {
  return editorFor(page).evaluate(stopRuntimeCandidateObservation);
}

function editorFor(page) {
  return page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
}

function surfaceFor(page) {
  return page.getByTestId("workbench-active-document-canvas")
    .filter({ visible: true })
    .first();
}

async function waitForRuntimeReloadTerminal(page) {
  await expect.poll(async () => {
    const surface = surfaceFor(page);
    const phase = await surface.getAttribute("data-edit-runtime-phase");
    const outcome = await surface.getAttribute("data-edit-runtime-outcome");
    return {
      terminal: phase === "settled"
        || phase === "static-fallback"
        || (phase === "static" && typeof outcome === "string" && outcome !== ""),
      phase,
      outcome,
    };
  }, { timeout: 60_000 }).toMatchObject({ terminal: true });
}

async function waitUntilEditable(page) {
  const editor = editorFor(page);
  await expect(editor).toHaveAttribute("aria-readonly", "false", { timeout: 60_000 });
  await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveCount(1);
  await expect.poll(async () => ({
    handoff: await editor.getAttribute("data-runtime-handoff"),
    phase: await editor.getAttribute("data-edit-runtime-phase"),
    outcome: await editor.getAttribute("data-edit-runtime-outcome"),
  }), { timeout: 60_000 }).toMatchObject({ handoff: null });
  return editor;
}

async function currentRevision(page) {
  const value = await page.locator("[data-persist-state]").first()
    .getAttribute("data-persisted-revision");
  return Number(value || 0);
}

async function currentFrameIdentity(page) {
  const editor = editorFor(page);
  return {
    document: await documentToken(page),
    generation: await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation"),
    pendingRefresh: {
      present: await editor.getAttribute("data-runtime-refresh-pending") !== null,
      sourceRevision: await editor.getAttribute(
        "data-runtime-refresh-pending-source-revision",
      ),
      reason: await editor.getAttribute("data-runtime-refresh-pending-reason"),
      coalescedCount: await editor.getAttribute(
        "data-runtime-refresh-coalesced-count",
      ),
    },
  };
}

async function copyCapabilitySnapshot({
  page,
  workingCopyPath,
  plan,
  originalSha256,
  relocated = null,
}) {
  const editor = editorFor(page);
  const frame = await currentEditorFrame(page);
  const workingHtml = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  const workingIndex = buildSourceIndex(workingHtml, {
    caller: "local-html-corpus-copy-diagnostic",
  });
  const sourceTarget = workingIndex.byPagerootId.get(plan.id) ?? null;
  const sourceCodeUnitRange = sourceTarget?.range
    ? {
        start: sourceTarget.range.startOffset,
        end: sourceTarget.range.endOffset,
      }
    : null;
  const sourceUtf8ByteRange = sourceCodeUnitRange
    ? {
        start: Buffer.byteLength(workingHtml.slice(0, sourceCodeUnitRange.start), "utf8"),
        end: Buffer.byteLength(workingHtml.slice(0, sourceCodeUnitRange.end), "utf8"),
      }
    : null;
  const copyButton = editor.getByRole("button", { name: "复制元素", exact: true });
  const buttonCount = await copyButton.count();
  const candidateFrames = editor.locator('iframe[data-runtime-slot-role="candidate"]');
  const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
  const editingHosts = frame.locator("[data-html-canvas-editing]");
  const nativeEditingCount = await editingHosts.count();
  const focusInsideEditingHost = await frame.locator("body").evaluate(() => Boolean(
    document.activeElement?.closest?.("[data-html-canvas-editing]"),
  ));
  await editor.evaluate((root) => {
    root.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe"));
  });
  const workingSourceSha256 = await editor.getAttribute("data-working-source-sha256");
  const renderedProjectionSha256 = await editor.getAttribute(
    "data-rendered-projection-sha256",
  );
  const renderedProjectionStale = await editor.getAttribute(
    "data-rendered-projection-stale",
  );
  const diskWorkingSha256 = sha256(Buffer.from(workingHtml));
  const workingEqualsDisplayed = Boolean(
    workingSourceSha256
    && workingSourceSha256 === workingIndex.sourceSha256
    && workingSourceSha256 === renderedProjectionSha256
    && workingSourceSha256 === `sha256:${diskWorkingSha256}`
    && renderedProjectionStale === "false"
  );
  return {
    phase: "before-copy",
    planned: {
      stableId: plan.id,
      tag: plan.tag,
      tabId: plan.tabId,
      sourceTarget: {
        stableId: sourceTarget?.pagerootId ?? null,
        tag: sourceTarget?.tagName ?? null,
        unique: Boolean(sourceTarget),
        codeUnitRange: sourceCodeUnitRange,
        utf8ByteRange: sourceUtf8ByteRange,
        workingSha256: workingIndex.sourceSha256,
      },
    },
    relocated,
    uiProjection: {
      availability: await editor.getAttribute("data-element-copy-availability"),
      reason: await editor.getAttribute("data-element-copy-reason"),
      diagnostic: await editor.getAttribute("data-element-copy-diagnostic"),
      buttonCount,
      disabled: buttonCount === 1 ? await copyButton.isDisabled() : null,
    },
    commandBoundary: {
      availability: await editor.getAttribute("data-e2e-copy-live-availability"),
      reason: await editor.getAttribute("data-e2e-copy-live-reason"),
      diagnostic: await editor.getAttribute("data-e2e-copy-live-diagnostic"),
      targetStableId: await editor.getAttribute("data-e2e-copy-live-target-id"),
      probeSequence: await editor.getAttribute("data-e2e-copy-probe-sequence"),
    },
    nativeTextSession: {
      activeEditingCount: nativeEditingCount,
      focusInsideEditingHost,
      ended: nativeEditingCount === 0 && !focusInsideEditingHost,
      probeEnded: await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true",
    },
    runtime: {
      documentToken: await documentToken(page),
      activeGeneration: await activeFrame.getAttribute("data-frame-generation"),
      candidateCount: await candidateFrames.count(),
      candidateGenerations: await candidateFrames.evaluateAll((frames) => (
        frames.map((candidate) => candidate.getAttribute("data-frame-generation"))
      )),
      candidateId: await editor.getAttribute("data-runtime-candidate-id"),
      candidatePhase: await editor.getAttribute("data-runtime-candidate-phase"),
      handoff: await editor.getAttribute("data-runtime-handoff"),
      renderVerified: await editor.getAttribute("data-render-verified"),
    },
    source: {
      originalSha256,
      diskWorkingSha256,
      workingSourceSha256,
      renderedProjectionSha256,
      renderedProjectionStale,
      workingEqualsDisplayed,
    },
    attribution: null,
  };
}

function failWithCopyDiagnostic(message, snapshot) {
  const code = classifyCopyDiagnostic(snapshot);
  snapshot.attribution = {
    code,
    label: COPY_DIAGNOSTIC_CLASSIFICATIONS[code],
  };
  const error = new Error(`${message} [${snapshot.attribution.label}; ${code}]`);
  error.copyDiagnostic = snapshot;
  throw error;
}

async function clickAuthoredTab(page, tabId) {
  if (!tabId) return;
  const readState = async () => {
    const currentFrame = await currentEditorFrame(page);
    const currentTab = currentFrame.locator(`[data-pageroot-id="${tabId}"]`);
    const tabCount = await currentTab.count();
    const ariaSelected = tabCount === 1 ? await currentTab.getAttribute("aria-selected") : null;
    const controls = tabCount === 1 ? await currentTab.getAttribute("aria-controls") : null;
    const controlledVisible = controls
      ? await currentFrame.locator(`[id=${JSON.stringify(controls)}]`).isVisible().catch(() => false)
      : false;
    const activate = editorFor(page).getByRole("button", {
      name: "切换到此页签",
      exact: true,
    });
    const activationButtonCount = await activate.count();
    return {
      tabCount,
      active: ariaSelected === "true" || controlledVisible,
      ariaSelected,
      controls,
      controlledVisible,
      activationButtonCount,
      activationButtonVisible: activationButtonCount === 1
        ? await activate.isVisible().catch(() => false)
        : false,
      activationButtonEnabled: activationButtonCount === 1
        ? await activate.isEnabled().catch(() => false)
        : false,
    };
  };
  await driveAuthoredTabActivation({
    readState,
    prepareSelection: async () => {
      const selectionFrame = await currentEditorFrame(page);
      const selectionReset = await resetAuthoredProbeSelection({
        page,
        frame: selectionFrame,
        editor: editorFor(page),
      });
      if (!selectionReset.ok) {
        const error = new Error("The prior selection did not clear before tab activation.");
        error.code = "TAB_SELECTION_OVERLAY_NOT_CLEARED";
        error.details = { tabId, selectionReset };
        throw error;
      }
    },
    selectTab: async () => {
      const frame = await currentEditorFrame(page);
      const tab = frame.locator(`[data-pageroot-id="${tabId}"]`);
      await tab.evaluate((element) => element.scrollIntoView({
        block: "center",
        inline: "center",
      }));
      await tab.click({ timeout: 2_000 });
    },
    activateTab: async () => {
      const activate = editorFor(page).getByRole("button", {
        name: "切换到此页签",
        exact: true,
      });
      await activate.click({ timeout: 2_000 });
    },
  });
}

async function authoredTabIds(page) {
  const frame = await currentEditorFrame(page);
  const ids = await frame.locator('[role="tab"][data-pageroot-id]').evaluateAll((elements) => (
    elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return element.isConnected
        && rect.width > 1
        && rect.height > 1
        && style.display !== "none"
        && style.visibility !== "hidden";
    }).map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ));
  return ids.length > 0 ? [...new Set(ids)] : [null];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

async function freezeCapabilityManifest(page, workingCopyPath, { allowUnresolved = false } = {}) {
  const source = readFileSync(workingCopyPath, "utf8");
  const sourceElements = sourceElementsForCapabilityManifest(source);
  const candidates = [];
  const authoredDenominator = [];
  const unresolvedProbes = [];
  const runtimeGeneratedTargets = [];
  const runtimeGeneratedDiagnostics = [];
  for (const tabId of await authoredTabIds(page)) {
    await clickAuthoredTab(page, tabId);
    const frame = await currentEditorFrame(page);
    candidates.push(...await collectVisibleAuthoredCandidates(frame, sourceElements, tabId));
    const runtimeGenerated = await discoverRuntimeGeneratedTargets({
      page,
      frame,
      editor: editorFor(page),
      tabId,
    });
    runtimeGeneratedTargets.push(...runtimeGenerated.targets);
    runtimeGeneratedDiagnostics.push({ tabId, ...runtimeGenerated.diagnostics });
  }

  const candidatesById = new Map();
  for (const candidate of candidates) {
    const group = candidatesById.get(candidate.stableId) || [];
    group.push(candidate);
    candidatesById.set(candidate.stableId, group);
  }
  const probed = [];
  for (const group of candidatesById.values()) {
    const visible = group.filter((candidate) => candidate.visible === true);
    const duplicateInOneView = visible.some((candidate) => (
      visible.filter((other) => other.tabId === candidate.tabId).length > 1
    ));
    const candidate = visible[0] || group[0];
    const sourceMatches = sourceElements.filter((entry) => entry.pagerootId === candidate.stableId);
    const sourceIdentityValid = sourceMatches.length === 1
      && sourceMatches[0].pagerootIdentityStatus === "valid";
    if (
      sourceIdentityValid
      && candidate.visible
      && candidate.isConnected
      && !candidate.inert
      && !duplicateInOneView
    ) {
      authoredDenominator.push({
        probeStableId: candidate.stableId,
        operationStableId: null,
        tag: candidate.tag,
        type: majorElementType(candidate.tag),
        sourceOrder: sourceMatches[0].sourceOrder,
        parentId: sourceMatches[0].parentId || null,
        tabId: candidate.tabId,
        region: candidate.region,
        scrollContainer: candidate.scrollContainer,
        sourceEditable: sourceMatches[0].sourceEditable === true,
      });
    }
    if (duplicateInOneView) {
      probed.push(...group.map((candidate) => ({
        ...candidate,
        type: majorElementType(candidate.tag),
        capabilityFamilies: [],
        behaviorFamilies: [],
        probeReason: "LIVE_DUPLICATE_STABLE_ID",
      })));
      continue;
    }
    if (!candidate.visible) {
      probed.push({
        ...candidate,
        type: majorElementType(candidate.tag),
        capabilityFamilies: [],
        behaviorFamilies: [],
        probeReason: "HIDDEN_ELEMENT",
      });
      continue;
    }
    try {
      await clickAuthoredTab(page, candidate.tabId);
      const frame = await currentEditorFrame(page);
      const observation = await probeAuthoredCapability({
        page,
        frame,
        editor: editorFor(page),
        candidate,
        mode: "discover",
        sourceElements,
      });
      probed.push({ ...observation, type: majorElementType(observation.tag) });
    } catch (cause) {
      if (!allowUnresolved) throw cause;
      unresolvedProbes.push({
        probeStableId: candidate.stableId,
        operationStableId: cause?.details?.selectedId || null,
        code: cause?.code || "CAPABILITY_PROBE_FAILED",
        details: publicDiagnosticValue(cause?.details),
      });
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }
  }
  const normalized = normalizeCapabilityProbeObservations(probed, {
    allowConflicts: allowUnresolved,
  });
  const manifest = createCapabilityManifest({
    sourceIndex: { elements: sourceElements },
    liveDom: normalized.liveDom,
  });
  const aliasByProbeId = new Map(normalized.aliases.map((entry) => [
    entry.probeStableId,
    entry.operationStableId,
  ]));
  manifest.excluded = manifest.excluded.map((entry) => (
    aliasByProbeId.has(entry.elementId)
      ? {
        ...entry,
        reasons: [CAPABILITY_MANIFEST_REASONS.CANONICALIZED_TO_OPERATION_ANCESTOR],
        operationElementId: aliasByProbeId.get(entry.elementId),
      }
      : entry
  ));
  const observationsById = new Map(normalized.liveDom.map((entry) => [entry.stableId, entry]));
  manifest.entries = manifest.entries.map((entry) => {
    const observation = observationsById.get(entry.elementId);
    if (!observation?.probeStableId) {
      const error = new Error("An admitted capability entry is missing its frozen probe identity.");
      error.code = "CAPABILITY_MANIFEST_PROBE_IDENTITY_MISSING";
      error.details = { operationStableId: entry.elementId };
      throw error;
    }
    return {
      ...entry,
      probeStableId: observation.probeStableId,
      capabilitySnapshot: {
        copyAvailability: observation.copyAvailability || null,
        copyReason: observation.copyReason || null,
        probeReason: observation.probeReason || null,
      },
    };
  });
  const selection = selectCapabilityTargets(manifest);
  if (!allowUnresolved) {
    return deepFreeze({
      manifest,
      selection,
      sourceElements,
      runtimeGeneratedTargets,
      runtimeGeneratedDiagnostics,
      fingerprint: sha256(Buffer.from(JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        entries: manifest.entries,
        excluded: manifest.excluded,
        aliases: normalized.aliases,
        selected: selection.selected.map((entry) => entry.elementId),
        runtimeGeneratedTargets,
        runtimeGeneratedDiagnostics,
      }))),
    });
  }
  const manifestEntriesById = new Map(manifest.entries.map((entry) => [entry.elementId, entry]));
  const canonicalObservations = probed.filter((entry) => (
    entry.probeStableId && entry.operationStableId === entry.stableId
  ));
  const canonicalByOperation = new Map();
  for (const observation of canonicalObservations) {
    const group = canonicalByOperation.get(observation.operationStableId) || [];
    group.push(observation);
    canonicalByOperation.set(observation.operationStableId, group);
  }
  const operationGroups = [...canonicalByOperation].map(([operationStableId, observations]) => {
    const observation = normalized.liveDom.find((entry) => entry.stableId === operationStableId)
      || observations[0];
    const operation = sourceElements.find((sourceEntry) => (
      sourceEntry.pagerootId === operationStableId
    ));
    const admittedEntry = manifestEntriesById.get(operationStableId) || null;
    return {
      operationStableId,
      probeStableId: observation.probeStableId,
      manifestAdmission: admittedEntry ? "ADMITTED" : "NOT_ADMITTED",
      aliases: normalized.aliases.filter((alias) => (
        alias.operationStableId === operationStableId
      ))
        .map((alias) => alias.probeStableId),
      tag: operation?.tagName || observation.tag,
      type: admittedEntry?.type || majorElementType(operation?.tagName || observation.tag),
      sourceOrder: operation?.sourceOrder ?? observation.sourceOrder,
      parentId: operation?.parentId || null,
      tabId: observation.tabId,
      region: observation.region,
      scrollContainer: observation.scrollContainer,
      expectations: capabilityExpectationRows({ sourceElements, operation, observation }),
      probes: observations.map((probeObservation) => ({
        probeStableId: probeObservation.probeStableId,
        liveSnapshot: capabilityObservationSnapshot(probeObservation),
        liveCapabilityFamilies: probeObservation.capabilityFamilies,
        liveBehaviorFamilies: probeObservation.behaviorFamilies,
        copyAvailability: probeObservation.copyAvailability || null,
        copyReason: probeObservation.copyReason || null,
        expectations: capabilityExpectationRows({
          sourceElements,
          operation,
          observation: probeObservation,
        }),
      })),
    };
  });
  const denominatorWithOperations = attachOperationGroupsToAuthoredDenominator({
    authoredDenominator,
    operationGroups,
    liveDom: canonicalObservations,
    aliases: normalized.aliases,
  });
  for (const entry of denominatorWithOperations.filter((item) => !item.operationStableId)) {
    const rejectedProbe = probed.find((item) => item.stableId === entry.probeStableId);
    if (rejectedProbe && !unresolvedProbes.some((item) => item.probeStableId === entry.probeStableId)) {
      unresolvedProbes.push({
        probeStableId: entry.probeStableId,
        operationStableId: null,
        code: rejectedProbe.probeReason || "CAPABILITY_PROBE_IDENTITY_UNRESOLVED",
        details: null,
      });
    }
  }
  const draft = createCapabilityManifestDraft({
    authoredDenominator: denominatorWithOperations,
    operationGroups,
    aliases: normalized.aliases,
    observationConflicts: normalized.conflicts,
    unresolvedProbes,
    exclusions: manifest.excluded,
  });
  return deepFreeze({
    manifest,
    selection,
    sourceElements,
    runtimeGeneratedTargets,
    runtimeGeneratedDiagnostics,
    draft,
    fingerprint: sha256(Buffer.from(JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      entries: manifest.entries,
      excluded: manifest.excluded,
      aliases: normalized.aliases,
      selected: selection.selected.map((entry) => entry.elementId),
      runtimeGeneratedTargets,
      runtimeGeneratedDiagnostics,
      draft,
    }))),
  });
}

async function executeCapabilityObservations(page, frozen) {
  const observations = [];
  for (const entry of frozen.selection.selected) {
    await clickAuthoredTab(page, entry.tabId);
    await waitUntilEditable(page);
    const current = await probeAuthoredCapability({
      page,
      frame: await currentEditorFrame(page),
      editor: editorFor(page),
      candidate: {
        stableId: entry.probeStableId,
        expectedOperationStableId: entry.elementId,
        tag: entry.tag,
        sourceEditable: entry.capabilityFamilies.includes("text"),
        visible: true,
        isConnected: true,
        inert: false,
        runtimeGenerated: false,
        tabId: entry.tabId,
        region: entry.region,
        scrollContainer: entry.scrollContainer,
      },
      mode: "verify",
      sourceElements: frozen.sourceElements,
    });
    const expectedCapabilities = [...entry.capabilityFamilies].sort();
    const observedCapabilities = [...current.capabilityFamilies].sort();
    const identityMatches = current.selectedId === entry.elementId
      && current.runtimeGenerated === false
      && current.tag === entry.tag;
    const capabilityMatches = JSON.stringify(observedCapabilities)
      === JSON.stringify(expectedCapabilities);
    observations.push({
      elementId: entry.elementId,
      capabilityFamily: expectedCapabilities.join("+"),
      state: identityMatches && capabilityMatches ? "PASS" : "FAIL",
      reasonCode: identityMatches && capabilityMatches
        ? CAPABILITY_MATRIX_REASONS.OBSERVED
        : "FROZEN_CAPABILITY_DRIFT",
      details: {
        identityMatches,
        capabilityMatches,
        expectedCapabilities,
        observedCapabilities,
        probeReason: current.probeReason,
      },
    });
  }
  return observations;
}

function editableSourceElementCapabilities(sourceBytes) {
  const index = buildPatchSourceIndex(sourceBytes.toString("utf8"));
  return index.elements.flatMap((element) => {
    if (!element.textContent?.trim()) return [];
    const targetRef = createTargetRef(index, element, { level: "subregion" });
    if (!isEditableIslandTarget(index, targetRef).editable) return [];
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    return [{
      id: element.pagerootId || element.nodeId,
      parentId: parent?.type === "element" ? parent.pagerootId || null : null,
      transparent: isTransparentSourceTextElement(element.tagName),
    }];
  });
}

async function captureTextTargetSnapshots(page, sourceCapabilities, tabId) {
  const frame = await currentEditorFrame(page);
  // `evaluateAll` serializes only the callback itself, so the descriptor is
  // intentionally called inline through its self-contained function source.
  const snapshots = await frame.locator(TEXT_TARGET_SELECTOR).evaluateAll((elements, capabilities) => {
    const allowed = new Map(capabilities.map((capability) => [capability.id, capability]));
    const nativeHostFor = (hitElement) => {
      let candidate = hitElement.closest("[data-pageroot-id]");
      let nearestSafeCandidate = null;
      while (candidate) {
        const id = candidate.getAttribute("data-pageroot-id");
        const capability = allowed.get(id);
        if (!capability) return null;
        const parent = candidate.parentElement?.closest("[data-pageroot-id]") || null;
        if ((parent?.getAttribute("data-pageroot-id") || null) !== capability.parentId) return null;
        nearestSafeCandidate = candidate;
        const display = candidate.ownerDocument.defaultView
          ?.getComputedStyle(candidate).display.toLowerCase() || "";
        const climbThrough = candidate.localName === "br" || (
          capability.transparent && (display === "inline" || display === "contents")
        );
        if (!climbThrough) break;
        candidate = parent;
      }
      return nearestSafeCandidate;
    };
    return (
    elements.map((hitElement) => nativeHostFor(hitElement)).filter(Boolean).map((element) => {
      const view = element.ownerDocument.defaultView;
      const style = view?.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const id = element.getAttribute("data-pageroot-id");
      const parent = element.parentElement?.closest("[data-pageroot-id]") || null;
      const descendantSourceNodes = Array.from(
        element.querySelectorAll("[data-pageroot-id]"),
      );
      const descendantSourceIds = descendantSourceNodes
        .map((candidate) => candidate.getAttribute("data-pageroot-id"));
      const descendantSourceTags = descendantSourceNodes.map((candidate) => candidate.localName);
      const excludedAncestor = element.closest(
        "button,a,input,textarea,select,option,nav,[role=tab],[role=tablist],[contenteditable=true]",
      );
      const tag = element.localName;
      const sourceIdValid = /^pr1_[0-9a-f]{32}$/u.test(id || "");
      const text = element.textContent?.replace(/\s+/gu, " ").trim() || "";
      const hiddenByAttribute = element.hasAttribute("hidden")
        || element.getAttribute("aria-hidden") === "true"
        || element.hasAttribute("inert");
      const visible = Boolean(
        style
        && !hiddenByAttribute
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0
        && element.getClientRects().length > 0,
      );
      const format = {
        bold: style?.fontWeight === "bold" || Number(style?.fontWeight || 0) >= 600,
        italic: style?.fontStyle === "italic" || style?.fontStyle === "oblique",
        underline: (style?.textDecorationLine || "").split(/\s+/u).includes("underline"),
      };
      const documentOrder = Array.from(
        element.ownerDocument.querySelectorAll("[data-pageroot-id]"),
      ).indexOf(element);
      const domIdentityValid = sourceIdValid
        && Array.from(element.ownerDocument.querySelectorAll("[data-pageroot-id]"))
          .filter((candidate) => candidate.getAttribute("data-pageroot-id") === id)
          .length === 1;
      return {
        id,
        tag,
        parentId: parent?.getAttribute("data-pageroot-id") || null,
        documentOrder,
        textLength: text.length,
        childCount: element.childElementCount,
        descendantSourceIds,
        descendantSourceTags,
        sourceIdValid,
        domIdentityValid,
        visible,
        interactive: Boolean(excludedAncestor),
        sourceEditable: allowed.has(id),
        format,
        rect: { width: rect.width, height: rect.height },
      };
    })
    );
  }, sourceCapabilities);
  return snapshots
    .filter((snapshot) => snapshot.visible && snapshot.sourceEditable)
    .map((snapshot) => ({ ...snapshot, tabId }));
}

async function planTextTargets(page, workingCopyPath, {
  limit = TEXT_TARGET_COUNT,
  requireFormatTarget = true,
} = {}) {
  const sourceCapabilities = editableSourceElementCapabilities(readFileSync(workingCopyPath));
  const initialFrame = await currentEditorFrame(page);
  const tabs = await initialFrame.locator(
    '[role="tab"][aria-controls][data-pageroot-id]',
  ).evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return rect.width > 10 && rect.height > 10
      && style.display !== "none" && style.visibility !== "hidden";
  }).slice(0, 4).map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean));
  const snapshots = [];
  for (const tabId of tabs.length > 0 ? tabs : [null]) {
    await clickAuthoredTab(page, tabId);
    snapshots.push(...await captureTextTargetSnapshots(page, sourceCapabilities, tabId));
  }
  const fixed = createFixedTextTargetPlan(snapshots, { limit, requireFormatTarget });
  if (!fixed.ok) {
    const error = new Error("The fixed text-host preflight did not produce enough qualified targets.");
    error.code = fixed.reasonCode || TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE;
    error.details = {
      reasonCode: fixed.reasonCode,
      available: fixed.available ?? 0,
      required: fixed.required ?? limit,
      duplicateIds: fixed.duplicateIds || [],
      rejected: fixed.rejected || [],
    };
    throw error;
  }
  return fixed.targets;
}

async function renderedTextPosition(target) {
  return target.evaluate((element) => {
    const walker = element.ownerDocument.createTreeWalker(
      element,
      element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    const elementRect = element.getBoundingClientRect();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(1, node.textContent.length));
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      return {
        x: Math.max(1, rect.left - elementRect.left + Math.min(rect.width / 2, 3)),
        y: Math.max(1, rect.top - elementRect.top + Math.max(rect.height / 2, 1)),
      };
    }
    return { x: Math.min(12, elementRect.width / 2), y: Math.min(10, elementRect.height / 2) };
  });
}

async function enterNativeEdit(page, plan, { requireFormatProperty = null } = {}) {
  await clickAuthoredTab(page, plan.tabId);
  await page.keyboard.press("Escape");
  await waitUntilEditable(page);
  const frame = await currentEditorFrame(page);
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(plan.id)}]`);
  const count = await target.count();
  if (count !== 1) {
    const error = new Error("The frozen text target must resolve to exactly one DOM element.");
    error.code = count === 0
      ? TEXT_TARGET_REASON_CODES.DOM_IDENTITY_INVALID
      : TEXT_TARGET_REASON_CODES.STABLE_ID_DUPLICATE;
    error.details = { expectedId: plan.id, observedCount: count };
    throw error;
  }
  await target.scrollIntoViewIfNeeded();
  const currentSnapshot = await target.evaluate(describeTextTarget);
  currentSnapshot.sourceEditable = plan.sourceEditable === true;
  const validation = validateFrozenTextTarget(currentSnapshot, plan, {
    requireFormatProperty,
  });
  if (!validation.ok) {
    const error = new Error("The frozen text target changed before the operation.");
    error.code = validation.reasons[0] || TEXT_TARGET_REASON_CODES.SNAPSHOT_DRIFT;
    error.details = {
      expectedId: plan.id,
      reasons: validation.reasons,
      observedTag: currentSnapshot.tag,
      observedParentId: currentSnapshot.parentId,
      observedDocumentOrder: currentSnapshot.documentOrder,
    };
    throw error;
  }
  await target.dblclick({ position: await renderedTextPosition(target) });
  await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
  await expect.poll(() => target.evaluate((element) => (
    element.ownerDocument.activeElement === element && element.isContentEditable
  ))).toBe(true);
  return target;
}

async function selectTrailingText(target, page, length) {
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.down("Shift");
  for (let index = 0; index < length; index += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.up("Shift");
}

async function markerComputedStyle(target, marker) {
  return target.evaluate((element, expectedMarker) => {
    const walker = element.ownerDocument.createTreeWalker(
      element,
      element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes(expectedMarker)) continue;
      const style = element.ownerDocument.defaultView.getComputedStyle(node.parentElement);
      return {
        bold: style.fontWeight === "bold" || Number(style.fontWeight) >= 600,
        italic: style.fontStyle === "italic",
        underline: style.textDecorationLine.includes("underline"),
      };
    }
    return { bold: false, italic: false, underline: false };
  }, marker);
}

function expectFormattedMarker(savedHtml, marker) {
  const markerIndex = savedHtml.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const vicinity = savedHtml.slice(
    Math.max(0, markerIndex - 500),
    Math.min(savedHtml.length, markerIndex + marker.length + 500),
  );
  expect(vicinity).toMatch(/font-weight\s*:\s*(?:700|bold)/iu);
  expect(vicinity).toMatch(/font-style\s*:\s*italic/iu);
  expect(vicinity).toMatch(/text-decoration(?:-line)?\s*:[^;"']*underline/iu);
}

async function saveAndExitTextOperation(page, beforeRevision) {
  await page.keyboard.press(keyShortcut("s"));
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);
}

function assertScopedMutation({
  before,
  workingCopyPath,
  plan,
  normalizationPolicy,
  expectedAfterContains,
  expectedAfterExcludes = [],
  expectedAppendedPattern,
}) {
  const oracle = compareElementScopedMutation({
    before,
    after: readFileSync(workingCopyPath),
    sourceId: plan.id,
    normalizationPolicy,
    expectedAfterContains,
    expectedAfterExcludes,
    expectedAppendedPattern,
  });
  if (!oracle.ok) {
    const error = new Error(`Source scope rejected ${normalizationPolicy} for ${plan.id}.`);
    error.code = "SOURCE_SCOPE_ORACLE_FAILED";
    error.oracle = oracle;
    throw error;
  }
  return oracle;
}

async function runActivationOperation(page, plans) {
  const activated = [];
  for (const plan of plans) {
    await enterNativeEdit(page, plan);
    activated.push({ id: plan.id, tag: plan.tag, tabId: plan.tabId });
    await page.keyboard.press("Escape");
    await waitUntilEditable(page);
  }
  return { targets: activated };
}

async function runInputDeleteOperation({ page, workingCopyPath, plans, fileIndex }) {
  const samples = [];
  for (const [targetIndex, plan] of plans.entries()) {
    const marker = `PRQA_${fileIndex}_${targetIndex}_TEXT`;
    const backspaceMarker = `PRQA_${fileIndex}_${targetIndex}_BACKSPACE`;
    const deleteMarker = `PRQA_${fileIndex}_${targetIndex}_DELETE`;
    const replaceOldMarker = `PRQA_${fileIndex}_${targetIndex}_REPLACE_OLD`;
    const replaceMarker = `PRQA_${fileIndex}_${targetIndex}_REPLACED`;
    const before = readFileSync(workingCopyPath);
    const beforeRevision = await currentRevision(page);
    const target = await enterNativeEdit(page, plan);
    await target.press(keyShortcut("ArrowDown"));
    await page.keyboard.insertText(` ${marker} ${backspaceMarker}X`);
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(` ${deleteMarker}X`);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Delete");
    await page.keyboard.insertText(` ${replaceOldMarker}`);
    await selectTrailingText(target, page, replaceOldMarker.length);
    await page.keyboard.insertText(replaceMarker);
    await expect(target).toContainText(marker);
    await expect(target).not.toContainText(`${backspaceMarker}X`);
    await expect(target).not.toContainText(`${deleteMarker}X`);
    await expect(target).not.toContainText(replaceOldMarker);
    await expect(target).toContainText(replaceMarker);
    await saveAndExitTextOperation(page, beforeRevision);
    const sourceScope = assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
      expectedAfterContains: [marker, backspaceMarker, deleteMarker, replaceMarker],
      expectedAfterExcludes: [`${backspaceMarker}X`, `${deleteMarker}X`, replaceOldMarker],
      expectedAppendedPattern: new RegExp(
        ` ${marker} ${backspaceMarker} ${deleteMarker} ${replaceMarker}`,
        "u",
      ),
    });
    samples.push({
      plan,
      marker,
      backspaceMarker,
      deleteMarker,
      replaceMarker,
      sourceScope,
    });
  }
  return { samples };
}

async function runNewlineOperation({ page, workingCopyPath, plan, fileIndex }) {
  const beforeMarker = `PRQA_${fileIndex}_NEWLINE_BEFORE`;
  const marker = `PRQA_${fileIndex}_NEWLINE`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(beforeMarker);
  const beforeBreakIds = await target.locator("br[data-pageroot-id]").evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ));
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(marker);
  await expect(target).toContainText(marker);
  await expect.poll(async () => (
    (await target.locator("br[data-pageroot-id]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
    ))).filter((id) => !beforeBreakIds.includes(id)).length
  )).toBe(1);
  await saveAndExitTextOperation(page, beforeRevision);
  const saved = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expect(saved).toMatch(new RegExp(
    `${beforeMarker}[\\s\\S]*<br\\s+[^>]*data-pageroot-id="pr1_[0-9a-f]{32}"[^>]*>[\\s\\S]*${marker}`,
    "u",
  ));
  return {
    targetId: plan.id,
    beforeMarker,
    marker,
    beforeBreakIds,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_NEWLINE,
      expectedAfterContains: [beforeMarker, marker],
      expectedAppendedPattern: new RegExp(
        `${beforeMarker}<br\\s+data-pageroot-id="pr1_[0-9a-f]{32}">${marker}`,
        "u",
      ),
    }),
  };
}

async function runUndoRedoOperation({ page, workingCopyPath, plan, fileIndex }) {
  const marker = `PRQA_${fileIndex}_UNDO_REDO`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(` ${marker}`);
  await page.keyboard.press(keyShortcut("s"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
  await page.keyboard.press(keyShortcut("z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).not.toContain(marker);
  await page.keyboard.press(keyShortcut("Shift+z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
  await saveAndExitTextOperation(page, beforeRevision);
  return {
    targetId: plan.id,
    marker,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_UNDO_REDO,
      expectedAfterContains: [marker],
      expectedAppendedPattern: new RegExp(` ${marker}`, "u"),
    }),
  };
}

async function runFormatOperation({ page, workingCopyPath, plan, fileIndex }) {
  const marker = `PRQA_${fileIndex}_FORMAT`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(` ${marker}`);
  await expect.poll(() => markerComputedStyle(target, marker))
    .toEqual({ bold: false, italic: false, underline: false });
  const editor = editorFor(page);
  const formatTransitions = [];
  for (const [property, name] of [
    ["bold", "加粗"],
    ["italic", "斜体"],
    ["underline", "下划线"],
  ]) {
    await selectTrailingText(target, page, marker.length);
    const button = editor.getByRole("button", { name, exact: true });
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    const beforeState = await markerComputedStyle(target, marker);
    expect(beforeState[property]).toBe(false);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await markerComputedStyle(target, marker))[property]).toBe(true);
    formatTransitions.push({ property, from: false, to: true });
  }
  await expect.poll(() => markerComputedStyle(target, marker))
    .toEqual({ bold: true, italic: true, underline: true });
  await saveAndExitTextOperation(page, beforeRevision);
  const saved = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expectFormattedMarker(saved, marker);
  return {
    targetId: plan.id,
    marker,
    formatTransitions,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
      expectedAfterContains: [marker],
      expectedAppendedPattern: formattedMarkerAppendedPattern(marker),
    }),
  };
}

function directSiblingStableIds(workingCopyPath, targetId) {
  const index = buildPatchSourceIndex(readFileSync(workingCopyPath, "utf8"));
  const target = index.byPagerootId.get(targetId);
  const parent = target?.parentId ? index.byNodeId.get(target.parentId) : null;
  if (target?.type !== "element" || parent?.type !== "element") return null;
  return parent.childElementIds.map((nodeId) => index.byNodeId.get(nodeId)?.pagerootId)
    .filter(Boolean);
}

async function duplicateFixedStructureTarget({
  page,
  workingCopyPath,
  originalSha256,
  plan,
}) {
  await clickAuthoredTab(page, plan.tabId);
  let frame = await currentEditorFrame(page);
  const original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  const beforeIds = directSiblingStableIds(workingCopyPath, plan.id);
  if (!beforeIds) throw new Error("The frozen copy target has no source-backed parent.");
  expect(beforeIds).toContain(plan.id);
  const relocatedCount = await original.count();
  let relocated = {
    count: relocatedCount,
    stableId: null,
    tag: null,
    connected: false,
    selectedMarker: false,
    sameAsPlanned: false,
    liveStyleAttribute: null,
  };
  if (relocatedCount === 1) {
    relocated = await original.evaluate((element, expected) => ({
      count: 1,
      stableId: element.getAttribute("data-pageroot-id"),
      tag: element.tagName.toLowerCase(),
      connected: element.isConnected,
      selectedMarker: element.hasAttribute("data-html-canvas-selected"),
      liveStyleAttribute: element.getAttribute("style"),
      sameAsPlanned: (
        element.getAttribute("data-pageroot-id") === expected.stableId
        && element.tagName.toLowerCase() === expected.tag
      ),
    }), { stableId: plan.id, tag: plan.tag });
  }
  if (relocatedCount !== 1 || !relocated.sameAsPlanned || !relocated.connected) {
    const diagnostic = await copyCapabilitySnapshot({
      page,
      workingCopyPath,
      plan,
      originalSha256,
      relocated,
    });
    failWithCopyDiagnostic("Planned copy target could not be uniquely re-located", diagnostic);
  }
  await original.scrollIntoViewIfNeeded();
  await original.click({ modifiers: ["Alt"], timeout: 5_000 });
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute(
    "data-pageroot-id",
    plan.id,
  );
  await page.waitForTimeout(0);
  relocated.selectedMarker = await original.getAttribute("data-html-canvas-selected") !== null;
  const diagnostic = await copyCapabilitySnapshot({
    page,
    workingCopyPath,
    plan,
    originalSha256,
    relocated,
  });
  if (!relocated.selectedMarker) {
    failWithCopyDiagnostic("Re-located copy target was not the selected operation target", diagnostic);
  }
  if (
    diagnostic.uiProjection.buttonCount !== 1
    || diagnostic.uiProjection.disabled
    || diagnostic.uiProjection.availability !== "available"
  ) {
    failWithCopyDiagnostic("Copy action was unavailable immediately after exact selection", diagnostic);
  }
  if (
    diagnostic.commandBoundary.availability !== "available"
    || diagnostic.commandBoundary.reason !== "available"
    || diagnostic.commandBoundary.targetStableId !== plan.id
  ) {
    failWithCopyDiagnostic("Live copy capability disagreed with the selected Stable ID", diagnostic);
  }
  if (!diagnostic.nativeTextSession.ended || !diagnostic.nativeTextSession.probeEnded) {
    failWithCopyDiagnostic("Previous native text edit session did not end before copy", diagnostic);
  }
  if (!diagnostic.source.workingEqualsDisplayed) {
    failWithCopyDiagnostic("Working source and displayed source diverged before copy", diagnostic);
  }
  const editor = editorFor(page);
  const copyButton = editor.getByRole("button", { name: "复制元素", exact: true });
  const uiAvailability = diagnostic.uiProjection.availability;
  const uiReason = diagnostic.uiProjection.reason;
  const beforeDuplicate = await currentRevision(page);
  const beforeRuntime = await runtimeContractSnapshot(page);
  await editor.evaluate(startFullRuntimeLifecycleObservation);
  let observed;
  try {
    await copyButton.click({ timeout: 5_000 });
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
    await expectCheckpointPersisted(page, beforeDuplicate);
  } finally {
    observed = await editorFor(page).evaluate(stopFullRuntimeLifecycleObservation);
  }
  diagnostic.commandBoundary.executedAvailability = await editorFor(page).getAttribute(
    "data-element-copy-command-availability",
  );
  diagnostic.commandBoundary.executedReason = await editorFor(page).getAttribute(
    "data-element-copy-command-reason",
  );
  if (
    diagnostic.commandBoundary.executedAvailability !== "available"
    || diagnostic.commandBoundary.executedReason !== "available"
  ) {
    failWithCopyDiagnostic("Copy command was refused at the live command boundary", diagnostic);
  }
  const runtime = summarizeRuntimeObserverRecords(observed.records);
  const afterRuntime = await runtimeContractSnapshot(page);

  frame = await currentEditorFrame(page);
  const afterDuplicateIds = directSiblingStableIds(workingCopyPath, plan.id);
  if (!afterDuplicateIds) throw new Error("The copied target parent disappeared from source.");
  const addedIds = afterDuplicateIds.filter((id) => !beforeIds.includes(id));
  expect(
    addedIds,
    "Duplicate must add exactly one marked element with a distinct Stable ID",
  ).toHaveLength(1);
  const duplicateId = addedIds[0];
  return {
    duplicateId,
    beforeIds,
    afterDuplicateIds,
    capability: {
      uiAvailability,
      uiReason,
      commandAvailability: await editorFor(page).getAttribute(
        "data-element-copy-command-availability",
      ),
      commandReason: await editorFor(page).getAttribute("data-element-copy-command-reason"),
    },
    runtime: { before: beforeRuntime, after: afterRuntime, summary: runtime },
    diagnostic,
  };
}

async function deleteFixedStructureTargets({ page, workingCopyPath, plan, duplicateIds, originalIds }) {
  for (const duplicateId of duplicateIds) {
    let frame = await currentEditorFrame(page);
    const duplicate = frame.locator(`[data-pageroot-id="${duplicateId}"]`);
    await duplicate.scrollIntoViewIfNeeded();
    await duplicate.click();
    const beforeDelete = await currentRevision(page);
    page.once("dialog", (dialog) => dialog.accept());
    await editorFor(page).getByRole("button", { name: "删除元素", exact: true }).click();
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
    await expectCheckpointPersisted(page, beforeDelete);

    frame = await currentEditorFrame(page);
    await expect(frame.locator(`[data-pageroot-id="${duplicateId}"]`)).toHaveCount(0);
  }
  const frame = await currentEditorFrame(page);
  expect(directSiblingStableIds(workingCopyPath, plan.id)).toEqual(originalIds);
  const original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  await expect(original).toHaveCount(1);
}

async function createAndEditManifestComment(page, entry, marker) {
  await clickAuthoredTab(page, entry.tabId);
  const frame = await currentEditorFrame(page);
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(entry.elementId)}]`);
  await target.scrollIntoViewIfNeeded();
  await target.click({ modifiers: ["Alt"] });
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute(
    "data-pageroot-id",
    entry.elementId,
  );
  const commentButton = editorFor(page).getByRole("button", { name: /留评论/u });
  if (await commentButton.count() !== 1) {
    const error = new Error("The frozen comment capability disappeared.");
    error.code = "COMMENT_CAPABILITY_UNAVAILABLE";
    throw error;
  }
  await commentButton.click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" }).fill(marker);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  let card = page.locator(".comment-card").filter({ hasText: marker });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
  const updatedMarker = `${marker}_EDITED`;
  await card.getByRole("button", { name: "编辑评论", exact: true }).click();
  await card.getByRole("textbox", { name: /编辑评论/u }).fill(updatedMarker);
  await card.getByRole("button", { name: "确认修改", exact: true }).click();
  card = page.locator(".comment-card").filter({ hasText: updatedMarker });
  await expect(card).toHaveCount(1);
  return { targetId: entry.elementId, marker: updatedMarker };
}

async function verifyAndDeleteManifestComment(page, comment) {
  const card = page.locator(".comment-card").filter({ hasText: comment.marker });
  await expect(card).toHaveCount(1);
  const resolution = await card.getAttribute("data-resolution");
  expect(["exact", "rebound"]).toContain(resolution);
  await card.getByRole("button", { name: "删除评论", exact: true }).click();
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).toHaveCount(0);
  return { ...comment, resolution, deleted: true };
}

async function selectFrozenRuntimeGeneratedTarget(page, target) {
  await clickAuthoredTab(page, target.tabId);
  const frame = await currentEditorFrame(page);
  const anchor = frame.locator(
    `[data-pageroot-id=${JSON.stringify(target.sourceAnchorId)}]`,
  );
  if (await anchor.count() !== 1) {
    const error = new Error("The frozen Runtime-generated source anchor is not unique.");
    error.code = "RUNTIME_GENERATED_SOURCE_ANCHOR_MISMATCH";
    throw error;
  }
  const runtimeTarget = anchor.locator(target.relativePath);
  if (await runtimeTarget.count() !== 1 || !await runtimeTarget.isVisible().catch(() => false)) {
    const error = new Error("The frozen Runtime-generated visual target cannot be re-resolved.");
    error.code = "RUNTIME_GENERATED_TARGET_MISMATCH";
    throw error;
  }
  await runtimeTarget.scrollIntoViewIfNeeded();
  await runtimeTarget.click();
  const editor = editorFor(page);
  await expect(editor).toHaveAttribute("data-selection-runtime-generated", "true");
  await expect(editor).toHaveAttribute(
    "data-selection-runtime-source-anchor-id",
    target.sourceAnchorId,
  );
  await expect(editor).toHaveAttribute("data-selection-runtime-kind", target.kind);
  await expect(editor).toHaveAttribute("data-selection-runtime-path", target.relativePath);
  const toolbar = editor.getByRole("toolbar").filter({ visible: true }).first();
  await expect(toolbar.getByRole("button", { name: /留评论/u })).toHaveCount(1);
  for (const name of ["编辑", "复制元素", "上移", "下移", "删除元素"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  return {
    targetKey: target.targetKey,
    sourceAnchorId: target.sourceAnchorId,
    kind: target.kind,
    relativePath: target.relativePath,
    frozenGeneration: target.generation,
    observedGeneration: await editor.getAttribute("data-selection-runtime-generation"),
  };
}

async function createRuntimeGeneratedComment(page, target, marker) {
  const boundary = await selectFrozenRuntimeGeneratedTarget(page, target);
  const toolbar = editorFor(page).getByRole("toolbar").filter({ visible: true }).first();
  await toolbar.getByRole("button", { name: /留评论/u }).click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" }).fill(marker);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  const card = page.locator(".comment-card").filter({ hasText: marker });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
  return { ...boundary, marker };
}

async function verifyEditDeleteRuntimeGeneratedComment(page, target, comment) {
  let card = page.locator(".comment-card").filter({ hasText: comment.marker });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(editorFor(page)).toHaveAttribute("data-selection-runtime-generated", "true");
  await expect(editorFor(page)).toHaveAttribute(
    "data-selection-runtime-source-anchor-id",
    target.sourceAnchorId,
  );
  await expect(editorFor(page)).toHaveAttribute("data-selection-runtime-kind", target.kind);
  await expect(editorFor(page)).toHaveAttribute("data-selection-runtime-path", target.relativePath);
  const updatedMarker = `${comment.marker}_EDITED`;
  await card.getByRole("button", { name: "编辑评论", exact: true }).click();
  await card.getByRole("textbox", { name: /编辑评论/u }).fill(updatedMarker);
  await card.getByRole("button", { name: "确认修改", exact: true }).click();
  card = page.locator(".comment-card").filter({ hasText: updatedMarker });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "删除评论", exact: true }).click();
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).toHaveCount(0);
  return { ...comment, marker: updatedMarker, reopened: true, edited: true, deleted: true };
}

function behaviorResultRows(entry, capabilityFamily, families, state, reasonCode, details = null) {
  return families.map((behaviorFamily) => ({
    elementId: entry.elementId,
    capabilityFamily,
    behaviorFamily,
    assigned: true,
    state,
    reasonCode,
    ...(details ? { details } : {}),
  }));
}

const EXTENDED_FORMAT_CASES = Object.freeze([
  Object.freeze({
    behaviorFamily: "font-size",
    cssProperty: "font-size",
    label: "字号（像素）",
    candidates: ["29", "31"],
    sourceValue: (value) => `${value}px`,
  }),
  Object.freeze({
    behaviorFamily: "text-color",
    cssProperty: "color",
    label: "文字颜色",
    candidates: ["#123456", "#654321"],
    sourceValue: (value) => value,
    color: true,
  }),
  Object.freeze({
    behaviorFamily: "fill-color",
    cssProperty: "background-color",
    label: "元素填充色",
    candidates: ["#cdefab", "#abcdef"],
    sourceValue: (value) => value,
    color: true,
  }),
  Object.freeze({
    behaviorFamily: "padding",
    cssProperty: "padding-top",
    label: "内边距（像素）",
    candidates: ["37", "39"],
    sourceValue: (value) => `${value}px`,
  }),
  Object.freeze({
    behaviorFamily: "margin",
    cssProperty: "margin-top",
    label: "外间距（像素）",
    candidates: ["-17", "-19"],
    sourceValue: (value) => `${value}px`,
  }),
  Object.freeze({
    behaviorFamily: "line-height",
    cssProperty: "line-height",
    label: "行距（像素）",
    candidates: ["53", "57"],
    sourceValue: (value) => `${value}px`,
  }),
]);

async function setColorControlValue(control, value) {
  await control.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Native color input value setter is unavailable.");
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function runExtendedFormatBehaviors(page, workingCopyPath, entry, sourceElements) {
  const rows = [];
  for (const [formatIndex, formatCase] of EXTENDED_FORMAT_CASES.entries()) {
    const operationId = `format-${formatCase.behaviorFamily}`;
    try {
      await clickAuthoredTab(page, entry.tabId);
      await page.keyboard.press("Escape");
      await waitUntilEditable(page);
      const frame = await currentEditorFrame(page);
      const live = await probeAuthoredCapability({
        page,
        frame,
        editor: editorFor(page),
        candidate: {
          stableId: entry.probeStableId,
          expectedOperationStableId: entry.elementId,
          tag: entry.tag,
          sourceEditable: true,
          visible: true,
          isConnected: true,
          inert: false,
          runtimeGenerated: false,
          tabId: entry.tabId,
          region: entry.region,
          scrollContainer: entry.scrollContainer,
        },
        mode: "verify",
        sourceElements,
      });
      if (
        live.selectedId !== entry.elementId
        || live.tag !== entry.tag
        || !live.capabilityFamilies.includes("format")
      ) {
        const error = new Error("The frozen format target failed live identity or capability revalidation.");
        error.code = "FORMAT_TARGET_CAPABILITY_DRIFT";
        error.details = {
          expectedId: entry.elementId,
          observedId: live.selectedId,
          expectedTag: entry.tag,
          observedTag: live.tag,
          observedCapabilities: live.capabilityFamilies,
          probeReason: live.probeReason,
        };
        throw error;
      }
      const toolbar = editorFor(page).getByRole("toolbar").filter({ visible: true }).first();
      const summary = toolbar.locator("summary").filter({ hasText: "样式与间距" });
      const details = summary.locator("xpath=..");
      if (await details.getAttribute("open") === null) await summary.click();
      const control = toolbar.getByLabel(formatCase.label, { exact: true });
      await expect(control).toBeVisible();
      await expect(control).toBeEnabled();
      const beforeControlValue = (await control.inputValue()).toLowerCase();
      const targetValue = formatCase.candidates.find(
        (candidate) => candidate.toLowerCase() !== beforeControlValue,
      );
      if (!targetValue) {
        const error = new Error("No independently fixed format value differs from the live control value.");
        error.code = "FORMAT_EXPECTATION_NOT_DISTINCT";
        throw error;
      }
      const expectedSourceValue = formatCase.sourceValue(targetValue);
      const before = readFileSync(workingCopyPath);
      const beforeRevision = await currentRevision(page);
      const beforeIdentity = await currentFrameIdentity(page);
      if (formatCase.color) await setColorControlValue(control, targetValue);
      else await control.fill(targetValue);
      await expectCheckpointPersisted(page, beforeRevision);
      const after = readFileSync(workingCopyPath);
      const sourceScope = compareElementStyleMutation({
        before,
        after,
        sourceId: entry.elementId,
        expectedProperty: formatCase.cssProperty,
        expectedValue: expectedSourceValue,
      });
      const activeFrame = await currentEditorFrame(page);
      const target = activeFrame.locator(
        `[data-pageroot-id=${JSON.stringify(entry.elementId)}]`,
      );
      await expect(target).toHaveCount(1);
      const observedInlineValue = await target.evaluate(
        (element, property) => element.style.getPropertyValue(property).trim(),
        formatCase.cssProperty,
      );
      const observedComputedValue = await target.evaluate(
        (element, property) => element.ownerDocument.defaultView
          ?.getComputedStyle(element).getPropertyValue(property).trim() || "",
        formatCase.cssProperty,
      );
      const observedControlValue = (await control.inputValue()).toLowerCase();
      const afterIdentity = await currentFrameIdentity(page);
      const evidence = evaluateExtendedFormatEvidence({
        sourceScope,
        color: formatCase.color === true,
        expectedControlValue: targetValue,
        observedControlValue,
        expectedSourceValue,
        observedInlineValue,
        observedComputedValue,
        beforeIdentity,
        afterIdentity,
      });
      if (!evidence.ok) {
        const error = new Error("The extended format behavior failed a trust oracle.");
        error.code = evidence.failures[0] || "EXTENDED_FORMAT_EVIDENCE_FAILED";
        error.details = { conditions: evidence.conditions, failures: evidence.failures };
        if (!evidence.conditions.sourceScopeOk) error.oracle = sourceScope;
        throw error;
      }
      rows.push({
        elementId: entry.elementId,
        capabilityFamily: "format",
        behaviorFamily: formatCase.behaviorFamily,
        operationId,
        assigned: true,
        state: "PASS",
        reasonCode: CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
        details: {
          beforeControlValue,
          expectedControlValue: targetValue,
          observedControlValue,
          observedInlineValue,
          observedComputedValue,
          sourceScope,
          beforeIdentity,
          afterIdentity,
          evidence: evidence.conditions,
          inputAuthority: formatCase.color
            ? "bounded native color-input value setter with input/change events"
            : "Playwright keyboard fill on the visible native number input",
        },
      });
    } catch (cause) {
      let recoveryCause = null;
      try {
        await page.keyboard.press("Escape");
        await waitUntilEditable(page);
      } catch (cleanupCause) {
        recoveryCause = cleanupCause;
      }
      const failure = formatFailureRows({
        formatCases: EXTENDED_FORMAT_CASES,
        failedIndex: formatIndex,
        entry,
        operationId,
        operationFailure: errorDetails(cause),
        recoveryFailure: recoveryCause ? errorDetails(recoveryCause) : null,
      });
      rows.push(...failure.rows);
      if (failure.stop) return rows;
    }
  }
  return rows;
}

async function moveManifestTarget(page, workingCopyPath, entry) {
  await clickAuthoredTab(page, entry.tabId);
  const frame = await currentEditorFrame(page);
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(entry.elementId)}]`);
  await target.scrollIntoViewIfNeeded();
  await target.click({ modifiers: ["Alt"] });
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute(
    "data-pageroot-id",
    entry.elementId,
  );
  const direction = entry.capabilityFamilies.includes("move-up") ? "up" : "down";
  const name = direction === "up" ? "上移" : "下移";
  const inverseName = direction === "up" ? "下移" : "上移";
  const beforeOrder = directSiblingStableIds(workingCopyPath, entry.elementId);
  const beforeRevision = await currentRevision(page);
  const beforeIdentity = await currentFrameIdentity(page);
  const button = editorFor(page).getByRole("button", { name, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expectCheckpointPersisted(page, beforeRevision);
  const afterIdentity = await currentFrameIdentity(page);
  const afterOrder = directSiblingStableIds(workingCopyPath, entry.elementId);
  expect(afterOrder).not.toEqual(beforeOrder);
  expect(afterIdentity.document).toBe(beforeIdentity.document);
  expect(afterIdentity.generation).toBe(beforeIdentity.generation);
  const restoreRevision = await currentRevision(page);
  const inverse = editorFor(page).getByRole("button", { name: inverseName, exact: true });
  await expect(inverse).toBeEnabled();
  await inverse.click();
  await expectCheckpointPersisted(page, restoreRevision);
  expect(directSiblingStableIds(workingCopyPath, entry.elementId)).toEqual(beforeOrder);
  return {
    targetId: entry.elementId,
    direction,
    beforeIdentity,
    afterIdentity,
    restored: true,
  };
}

async function runDedicatedCapabilityStage({
  session,
  copyPath,
  frozenCapability,
  fileIndex,
}) {
  let activeSession = session;
  let activePage = activeSession.page;
  let workingCopyPath = await managedWorkingCopyPath(activePage, copyPath);
  const observations = await executeCapabilityObservations(activePage, frozenCapability);
  const rows = [];
  const formatEntry = frozenCapability.manifest.entries.find((entry) => (
    entry.capabilityFamilies.includes("format")
  )) || null;
  if (formatEntry) {
    rows.push(...await runExtendedFormatBehaviors(
      activePage,
      workingCopyPath,
      formatEntry,
      frozenCapability.sourceElements,
    ));
  }
  const runtimeBoundaries = [];
  let runtimeComment = null;
  for (const [targetIndex, target] of frozenCapability.runtimeGeneratedTargets.entries()) {
    const matrixEntry = { elementId: `runtime:${target.targetKey}` };
    try {
      const boundary = targetIndex === 0
        ? await createRuntimeGeneratedComment(
          activePage,
          target,
          `PRQA_${fileIndex}_RUNTIME_COMMENT`,
        )
        : await selectFrozenRuntimeGeneratedTarget(activePage, target);
      runtimeBoundaries.push({ ...target, ...boundary });
      if (targetIndex === 0) runtimeComment = boundary;
      rows.push(...behaviorResultRows(
        matrixEntry,
        "runtime-generated",
        ["runtime-capability-boundary"],
        "PASS",
        CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
        boundary,
      ));
    } catch (cause) {
      rows.push(...behaviorResultRows(
        matrixEntry,
        "runtime-generated",
        ["runtime-capability-boundary"],
        "FAIL",
        cause?.code || "RUNTIME_GENERATED_BOUNDARY_FAILED",
      ));
    }
  }
  const commentEntry = frozenCapability.manifest.entries.find((entry) => (
    entry.capabilityFamilies.includes("comment")
  )) || null;
  let comment = null;
  if (commentEntry) {
    try {
      comment = await createAndEditManifestComment(
        activePage,
        commentEntry,
        `PRQA_${fileIndex}_COMMENT`,
      );
    } catch (cause) {
      rows.push(...behaviorResultRows(
        commentEntry,
        "comment",
        ["comment-create", "comment-edit", "comment-delete", "comment-reopen"],
        "FAIL",
        cause?.code || "COMMENT_LIFECYCLE_FAILED",
      ));
    }
  }
  const moveEntry = frozenCapability.manifest.entries.find((entry) => (
    entry.capabilityFamilies.includes("move-up")
    || entry.capabilityFamilies.includes("move-down")
  )) || null;
  if (moveEntry) {
    try {
      const moved = await moveManifestTarget(activePage, workingCopyPath, moveEntry);
      rows.push(...behaviorResultRows(
        moveEntry,
        "move",
        ["move"],
        "PASS",
        CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
        moved,
      ));
    } catch (cause) {
      rows.push(...behaviorResultRows(
        moveEntry,
        "move",
        ["move"],
        "FAIL",
        cause?.code || "MOVE_BEHAVIOR_FAILED",
      ));
    }
  }

  const isolatedUserData = activeSession.isolatedUserData;
  await stopPageRoot(activeSession.electronApp, isolatedUserData, { cleanup: false });
  activeSession = await launchPageRoot({ isolatedUserData, ...REAL_HTML_LAUNCH_OPTIONS });
  activePage = activeSession.page;
  await waitForProjectReady(activePage);
  await waitUntilEditable(activePage);
  workingCopyPath = await managedWorkingCopyPath(activePage, copyPath);

  if (comment) {
    try {
      const reopened = await verifyAndDeleteManifestComment(activePage, comment);
      rows.push(...behaviorResultRows(
        commentEntry,
        "comment",
        ["comment-create", "comment-edit", "comment-delete", "comment-reopen"],
        "PASS",
        CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
        reopened,
      ));
    } catch (cause) {
      rows.push(...behaviorResultRows(
        commentEntry,
        "comment",
        ["comment-create", "comment-edit", "comment-delete", "comment-reopen"],
        "FAIL",
        cause?.code || "COMMENT_REOPEN_DELETE_FAILED",
      ));
    }
  }
  if (runtimeComment) {
    const runtimeTarget = frozenCapability.runtimeGeneratedTargets[0];
    const matrixEntry = { elementId: `runtime:${runtimeTarget.targetKey}` };
    try {
      const reopened = await verifyEditDeleteRuntimeGeneratedComment(
        activePage,
        runtimeTarget,
        runtimeComment,
      );
      rows.push(...behaviorResultRows(
        matrixEntry,
        "runtime-generated",
        ["runtime-comment-create", "runtime-comment-edit", "runtime-comment-reopen", "runtime-comment-delete"],
        "PASS",
        CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
        reopened,
      ));
    } catch (cause) {
      rows.push(...behaviorResultRows(
        matrixEntry,
        "runtime-generated",
        ["runtime-comment-create", "runtime-comment-edit", "runtime-comment-reopen", "runtime-comment-delete"],
        "FAIL",
        cause?.code || "RUNTIME_GENERATED_COMMENT_LIFECYCLE_FAILED",
      ));
    }
  }
  const identityEntry = frozenCapability.manifest.entries[0] || null;
  if (identityEntry) {
    await clickAuthoredTab(activePage, identityEntry.tabId);
    const count = await (await currentEditorFrame(activePage))
      .locator(`[data-pageroot-id=${JSON.stringify(identityEntry.elementId)}]`).count();
    const state = count === 1 ? "PASS" : "FAIL";
    rows.push(...behaviorResultRows(
      identityEntry,
      "selection",
      ["persistence", "stable-id"],
      state,
      state === "PASS"
        ? CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED
        : "REOPENED_STABLE_ID_MISMATCH",
      { reopenedCount: count },
    ));
  }
  return {
    session: activeSession,
    page: activePage,
    workingCopyPath,
    observations,
    rows,
    runtimeGenerated: {
      targets: frozenCapability.runtimeGeneratedTargets,
      diagnostics: frozenCapability.runtimeGeneratedDiagnostics,
      boundaries: runtimeBoundaries,
      comment: runtimeComment,
    },
  };
}

async function twoAnimationFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function markerDeliverySnapshot(page, marker) {
  const frame = await currentEditorFrame(page);
  const frameFocus = await frame.evaluate((value) => {
    const active = document.activeElement;
    const host = active?.closest?.("[data-pageroot-id]") || null;
    const content = active && "value" in active ? String(active.value) : active?.textContent || "";
    return {
      elementId: host?.getAttribute("data-pageroot-id") || null,
      markerPresent: Boolean(host && content.includes(value)),
    };
  }, marker);
  const outerFocus = await page.evaluate((value) => {
    const active = document.activeElement;
    const editable = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active?.isContentEditable === true;
    const content = active && "value" in active ? String(active.value) : active?.textContent || "";
    return {
      editable,
      markerPresent: editable && content.includes(value),
      tag: active?.localName || null,
    };
  }, marker);
  return { frameFocus, outerFocus };
}

async function nativeSelectionEvidence(page, expectedElementId) {
  const frame = await currentEditorFrame(page);
  return frame.evaluate((expectedId) => {
    const nearestId = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.("[data-pageroot-id]")
        ?.getAttribute("data-pageroot-id") || null;
    };
    const selection = document.getSelection();
    const activeElementId = nearestId(document.activeElement);
    const active = document.querySelector(`[data-pageroot-id="${expectedId}"]`);
    return {
      expectedElementId: expectedId,
      after: {
        elementId: activeElementId,
        connected: active?.isConnected === true,
      },
      focus: {
        activeElementId,
        anchorElementId: nearestId(selection?.anchorNode),
        focusElementId: nearestId(selection?.focusNode),
      },
    };
  }, expectedElementId);
}

function runtimeTerminalSnapshot(snapshot) {
  const terminal = ["settled", "static", "static-fallback"].includes(snapshot.runtimePhase)
    && typeof snapshot.runtimeOutcome === "string"
    && snapshot.runtimeOutcome !== "";
  return {
    terminal,
    phase: snapshot.runtimePhase,
    outcome: snapshot.runtimeOutcome,
  };
}

async function runContinuityCycle({
  page,
  workingCopyPath,
  textPlan,
  copyEntry,
  fileIndex,
  cycleIndex,
  retainedMarkers,
}) {
  const ordinaryMarker = `PRQA_${fileIndex}_CHAIN_${cycleIndex}_ORDINARY`;
  const ordinaryBefore = await currentFrameIdentity(page);
  await editorFor(page).evaluate(startFullRuntimeLifecycleObservation);
  let ordinaryObserved;
  try {
    const ordinaryRevision = await currentRevision(page);
    const ordinaryTarget = await enterNativeEdit(page, textPlan);
    await ordinaryTarget.press(keyShortcut("ArrowDown"));
    await page.keyboard.insertText(` ${ordinaryMarker}`);
    await saveAndExitTextOperation(page, ordinaryRevision);
  } finally {
    ordinaryObserved = await editorFor(page).evaluate(stopFullRuntimeLifecycleObservation);
  }
  const ordinarySummary = summarizeRuntimeObserverRecords(ordinaryObserved.records);
  const ordinaryAfter = await currentFrameIdentity(page);
  const ordinaryEdit = {
    before: {
      documentId: ordinaryBefore.document,
      generation: Number(ordinaryBefore.generation),
    },
    after: {
      documentId: ordinaryAfter.document,
      generation: Number(ordinaryAfter.generation),
    },
    rebuilt: ordinarySummary.hasRequest
      || ordinarySummary.hasCandidate
      || ordinarySummary.hasGeneration,
    observations: ordinaryObserved.records,
  };

  await clickAuthoredTab(page, copyEntry.tabId);
  let frame = await currentEditorFrame(page);
  const structureTarget = frame.locator(
    `[data-pageroot-id=${JSON.stringify(copyEntry.elementId)}]`,
  );
  await structureTarget.scrollIntoViewIfNeeded();
  await structureTarget.click({ modifiers: ["Alt"] });
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute(
    "data-pageroot-id",
    copyEntry.elementId,
  );
  const copyButton = editorFor(page).getByRole("button", { name: "复制元素", exact: true });
  await expect(copyButton).toBeEnabled();
  const beforeIds = directSiblingStableIds(workingCopyPath, copyEntry.elementId);
  const rebuildBefore = await runtimeContractSnapshot(page);
  const oldFrame = frame;
  const oldTarget = oldFrame.locator(
    `[data-pageroot-id=${JSON.stringify(textPlan.id)}]`,
  );
  const oldTargetHandle = await oldTarget.elementHandle();
  const structureRevision = await currentRevision(page);
  await editorFor(page).evaluate(startFullRuntimeLifecycleObservation);
  let rebuildObserved;
  try {
    await copyButton.click();
    await expectCheckpointPersisted(page, structureRevision);
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
  } finally {
    rebuildObserved = await editorFor(page).evaluate(stopFullRuntimeLifecycleObservation);
  }
  const rebuildSummary = summarizeRuntimeObserverRecords(rebuildObserved.records);
  const rebuildAfter = await runtimeContractSnapshot(page);
  const rebuildSourceBytes = readFileSync(workingCopyPath);
  const rebuildSource = {
    hash: sha256(rebuildSourceBytes),
    size: rebuildSourceBytes.length,
  };
  const afterIds = directSiblingStableIds(workingCopyPath, copyEntry.elementId);
  const duplicateIds = afterIds?.filter((id) => !beforeIds?.includes(id)) || [];
  expect(duplicateIds).toHaveLength(1);

  let previousTargetRetired = false;
  try {
    previousTargetRetired = await oldTargetHandle?.evaluate((element) => !element.isConnected)
      ?? false;
  } catch {
    previousTargetRetired = true;
  }
  await oldTargetHandle?.dispose().catch(() => {});

  const directMarker = `PRQA_${fileIndex}_CHAIN_${cycleIndex}_DIRECT`;
  const continuationRevision = await currentRevision(page);
  await page.keyboard.insertText(` ${directMarker}`);
  await twoAnimationFrames(page);
  const directDelivery = await markerDeliverySnapshot(page, directMarker);
  const directInputApplied = directDelivery.frameFocus.markerPresent
    || directDelivery.outerFocus.markerPresent;
  const directTargetId = directDelivery.frameFocus.markerPresent
    ? directDelivery.frameFocus.elementId
    : directDelivery.outerFocus.markerPresent
      ? `outer:${directDelivery.outerFocus.tag || "unknown"}`
      : null;
  let continuationMode = "without-refocus";
  let relocatedElementId = null;
  let relocatedInputApplied = false;
  let selectionEvidence = null;
  if (!directInputApplied) {
    continuationMode = "session-ended";
    const relocated = await enterNativeEdit(page, textPlan);
    relocatedElementId = await relocated.getAttribute("data-pageroot-id");
    const relocatedMarker = `PRQA_${fileIndex}_CHAIN_${cycleIndex}_RELOCATED`;
    await relocated.press(keyShortcut("ArrowDown"));
    await page.keyboard.insertText(` ${relocatedMarker}`);
    await expect(relocated).toContainText(relocatedMarker);
    relocatedInputApplied = true;
    selectionEvidence = await nativeSelectionEvidence(page, textPlan.id);
    retainedMarkers.push(relocatedMarker);
  } else if (directTargetId === textPlan.id) {
    relocatedElementId = textPlan.id;
    relocatedInputApplied = true;
    selectionEvidence = await nativeSelectionEvidence(page, textPlan.id);
  }
  await saveAndExitTextOperation(page, continuationRevision);
  retainedMarkers.push(ordinaryMarker, directInputApplied ? directMarker : null);

  const currentSource = readFileSync(workingCopyPath);
  for (const marker of retainedMarkers.filter(Boolean)) {
    expect(currentSource.toString("utf8")).toContain(marker);
  }
  const workingSource = { hash: sha256(currentSource), size: currentSource.length };
  const finalRuntime = await runtimeContractSnapshot(page);
  const generationRecord = rebuildSummary.generation;
  const candidate = rebuildSummary.candidate;
  const candidateTerminal = rebuildSummary.candidateTerminal;
  const evidence = {
    request: rebuildSummary.request ? {
      sourceRevision: rebuildSummary.request.sourceRevision,
      reason: rebuildSummary.request.reason,
      status: rebuildSummary.request.status || "submitted",
    } : null,
    candidate: candidate ? {
      candidateId: candidate.candidateId,
      sourceRevision: candidate.sourceRevision,
      status: candidateTerminal?.terminal || null,
    } : null,
    generation: {
      before: Number(rebuildBefore.generation),
      after: Number(rebuildAfter.generation),
      observed: Boolean(generationRecord),
    },
    active: {
      candidateId: rebuildAfter.lastKnownGoodId || null,
      generation: Number(rebuildAfter.generation),
      documentId: rebuildAfter.document,
    },
    runtime: runtimeTerminalSnapshot(finalRuntime),
    rebuildSource,
    workingSource,
    displayedSource: {
      hash: finalRuntime.renderedProjectionSha256,
      workingProjectionHash: finalRuntime.workingSourceSha256,
      stale: runtimeProjectionStale(finalRuntime.renderedProjectionStale),
      size: null,
    },
    ordinaryEdit,
    previousTargetRetired,
    selection: selectionEvidence,
    continuation: {
      mode: continuationMode,
      expectedElementId: textPlan.id,
      directInputApplied,
      directTargetId,
      sessionEnded: !directInputApplied,
      relocatedElementId,
      relocatedInputApplied,
    },
  };
  const verdict = evaluateContinuityChain(evidence);
  return {
    ok: verdict.ok,
    cycleIndex,
    textTargetId: textPlan.id,
    structureTargetId: copyEntry.elementId,
    duplicateId: duplicateIds[0],
    previousTargetRetired,
    evidence,
    verdict,
    observations: rebuildObserved.records,
  };
}

async function armRuntimeCommitHold(page) {
  await page.evaluate(() => {
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ = [];
  });
}

async function waitForHeldRuntimeCommit(page) {
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__?.length || 0
  )), { timeout: 60_000 }).toBeGreaterThan(0);
}

async function releaseHeldRuntimeCommits(page) {
  await page.evaluate(() => {
    const releases = window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ || [];
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ = undefined;
    releases.forEach((release) => release());
  });
}

async function runStaleCandidateFence({
  page,
  workingCopyPath,
  textPlan,
  copyEntry,
  fileIndex,
  retainedMarkers,
}) {
  await clickAuthoredTab(page, copyEntry.tabId);
  const frame = await currentEditorFrame(page);
  const structureTarget = frame.locator(
    `[data-pageroot-id=${JSON.stringify(copyEntry.elementId)}]`,
  );
  await structureTarget.scrollIntoViewIfNeeded();
  await structureTarget.click({ modifiers: ["Alt"] });
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute(
    "data-pageroot-id",
    copyEntry.elementId,
  );
  const copyButton = editorFor(page).getByRole("button", { name: "复制元素", exact: true });
  await expect(copyButton).toBeEnabled();
  const beforeIds = directSiblingStableIds(workingCopyPath, copyEntry.elementId);
  const beforeRevision = await currentRevision(page);
  await armRuntimeCommitHold(page);
  await editorFor(page).evaluate(startFullRuntimeLifecycleObservation);
  let observations;
  let released = false;
  try {
    await copyButton.click();
    await expectCheckpointPersisted(page, beforeRevision);
    await waitForHeldRuntimeCommit(page);
    const held = await runtimeContractSnapshot(page);
    expect(held.candidateId).toBeTruthy();
    expect(held.candidatePhase).toBeTruthy();
    const heldSource = readFileSync(workingCopyPath);
    const heldSourceHash = sha256(heldSource);
    expect(held.candidateId).not.toBe(held.lastKnownGoodId);

    const directMarker = `PRQA_${fileIndex}_STALE_DIRECT`;
    const continuationRevision = await currentRevision(page);
    await page.keyboard.insertText(` ${directMarker}`);
    await twoAnimationFrames(page);
    const direct = await markerDeliverySnapshot(page, directMarker);
    const directInputApplied = direct.frameFocus.markerPresent || direct.outerFocus.markerPresent;
    const directTargetId = direct.frameFocus.markerPresent
      ? direct.frameFocus.elementId
      : direct.outerFocus.markerPresent
        ? `outer:${direct.outerFocus.tag || "unknown"}`
        : null;
    if (directInputApplied && directTargetId !== textPlan.id) {
      const error = new Error("Held Candidate continuation landed before exact relocation.");
      error.code = "STALE_CANDIDATE_DIRECT_INPUT_WRONG_TARGET";
      throw error;
    }

    let latestMarker = directMarker;
    let relocatedElementId = null;
    let relocatedInputApplied = false;
    if (!directInputApplied) {
      latestMarker = `PRQA_${fileIndex}_STALE_LATEST`;
      const relocated = await enterNativeEdit(page, textPlan);
      relocatedElementId = await relocated.getAttribute("data-pageroot-id");
      await relocated.press(keyShortcut("ArrowDown"));
      await page.keyboard.insertText(` ${latestMarker}`);
      await expect(relocated).toContainText(latestMarker);
      relocatedInputApplied = true;
    }
    const selection = await nativeSelectionEvidence(page, textPlan.id);
    expect(selection).toMatchObject({
      expectedElementId: textPlan.id,
      after: { elementId: textPlan.id, connected: true },
      focus: {
        activeElementId: textPlan.id,
        anchorElementId: textPlan.id,
        focusElementId: textPlan.id,
      },
    });
    await page.keyboard.press(keyShortcut("s"));
    await expectCheckpointPersisted(page, continuationRevision);
    await page.keyboard.press("Escape");
    const latestSource = readFileSync(workingCopyPath);
    const latestSourceHash = sha256(latestSource);
    expect(latestSourceHash).not.toBe(heldSourceHash);
    retainedMarkers.push(latestMarker);

    await releaseHeldRuntimeCommits(page);
    released = true;
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
    const finalSource = readFileSync(workingCopyPath);
    const finalRuntime = await runtimeContractSnapshot(page);
    const finalSourceHash = sha256(finalSource);
    const verdict = evaluateStaleCandidateFence({
      heldCandidate: {
        candidateId: held.candidateId,
        activeCandidateId: held.lastKnownGoodId,
        sourceRevision: held.candidateSourceRevision,
      },
      heldSource: { hash: heldSourceHash, size: heldSource.length },
      latestSource: { hash: latestSourceHash, size: latestSource.length },
      continuation: {
        expectedElementId: textPlan.id,
        directInputApplied,
        directTargetId,
        sessionEnded: !directInputApplied,
        relocatedElementId,
        relocatedInputApplied,
      },
      finalSource: {
        hash: finalSourceHash,
        workingHash: finalRuntime.workingSourceSha256,
        displayedHash: finalRuntime.renderedProjectionSha256,
        stale: runtimeProjectionStale(finalRuntime.renderedProjectionStale),
        latestMarkerPresent: finalSource.toString("utf8").includes(latestMarker),
      },
    });
    if (!verdict.ok) {
      const error = new Error("A held Candidate overwrote or obscured a later accepted edit.");
      error.code = verdict.failures[0]?.code || "STALE_CANDIDATE_FENCE_FAILED";
      error.details = { failures: verdict.failures };
      throw error;
    }
    observations = await editorFor(page).evaluate(stopFullRuntimeLifecycleObservation);
    const afterIds = directSiblingStableIds(workingCopyPath, copyEntry.elementId);
    const duplicateIds = afterIds?.filter((id) => !beforeIds?.includes(id)) || [];
    expect(duplicateIds).toHaveLength(1);
    return {
      state: "PASS",
      reasonCode: "STALE_CANDIDATE_DID_NOT_OVERWRITE_LATEST_SOURCE",
      duplicateId: duplicateIds[0],
      heldCandidate: {
        candidateId: held.candidateId,
        sourceRevision: held.candidateSourceRevision,
        activeCandidateId: held.lastKnownGoodId,
      },
      continuation: {
        directInputApplied,
        directTargetId,
        relocatedElementId,
        relocatedInputApplied,
      },
      heldSourceHash,
      latestSourceHash,
      finalSourceHash,
      verdict,
      observations: observations.records,
    };
  } finally {
    if (!released) await releaseHeldRuntimeCommits(page).catch(() => {});
    if (!observations) {
      await editorFor(page).evaluate(stopFullRuntimeLifecycleObservation).catch(() => {});
    }
  }
}

async function runContinuityQualification({
  page,
  workingCopyPath,
  textPlans,
  copyEntry,
  fileIndex,
}) {
  const retainedMarkers = [];
  const cycles = [];
  const originalIds = directSiblingStableIds(workingCopyPath, copyEntry.elementId);
  for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
    const cycle = await runContinuityCycle({
      page,
      workingCopyPath,
      textPlan: textPlans[cycleIndex % textPlans.length],
      copyEntry,
      fileIndex,
      cycleIndex,
      retainedMarkers,
    });
    cycles.push(cycle);
    if (!cycle.ok) {
      const error = new Error("A continuity cycle failed its independent trust oracles.");
      error.code = cycle.verdict.failures[0]?.code || "CONTINUITY_CHAIN_FAILED";
      error.details = { cycleIndex, failures: cycle.verdict.failures };
      throw error;
    }
  }
  const staleCandidateFence = await runStaleCandidateFence({
    page,
    workingCopyPath,
    textPlan: textPlans[0],
    copyEntry,
    fileIndex,
    retainedMarkers,
  });
  await deleteFixedStructureTargets({
    page,
    workingCopyPath,
    plan: { id: copyEntry.elementId, tabId: copyEntry.tabId },
    duplicateIds: [
      ...cycles.map((cycle) => cycle.duplicateId),
      staleCandidateFence.duplicateId,
    ],
    originalIds,
  });
  return {
    cycles,
    staleCandidateFence,
    retainedMarkers: retainedMarkers.filter(Boolean),
  };
}

function capabilityBehaviorRows(fileId, frozen, manualRows = []) {
  if (!frozen) return [];
  const operationRows = new Map(resultReport.rowsForFile(fileId)
    .filter((row) => row.level === "operation")
    .map((row) => [row.operationId, row]));
  const mappings = [
    [REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE, ["activation"], "text"],
    [REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE, ["input", "backspace", "delete-key", "selection-replace"], "text"],
    [REAL_HTML_OPERATION_IDS.TEXT_NEWLINE, ["enter"], "text"],
    [REAL_HTML_OPERATION_IDS.TEXT_PASTE, ["paste"], "text"],
    [REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO, ["undo-redo"], "text"],
    [REAL_HTML_OPERATION_IDS.TEXT_FORMAT, ["bold", "italic", "underline"], "format"],
    [REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE, ["source-scope"], "text"],
    [REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE, ["duplicate", "edit-duplicate"], "copy"],
    [REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE, ["delete-duplicate"], "copy"],
  ];
  const required = new Set(frozen.manifest.behaviorFamilies);
  const rows = [];
  for (const [operationId, families, capabilityPrefix] of mappings) {
    const operation = operationRows.get(operationId);
    const applicableFamilies = families.filter((family) => required.has(family));
    if (applicableFamilies.length === 0) continue;
    for (const behaviorFamily of applicableFamilies) {
      const recordedTargetId = behaviorFamily === "edit-duplicate"
        ? operation?.details?.duplicateEditTargetId
        : behaviorFamily === "delete-duplicate"
          ? operation?.details?.duplicateIds?.[0]
          : operation?.details?.targetId
        || operation?.details?.targets?.[0]?.id
        || operation?.details?.samples?.[0]?.plan?.id
        || operation?.details?.checks?.[0]?.targetId
        || operation?.details?.sourceId
        || null;
      const entry = frozen.manifest.entries.find((candidate) => (
        candidate.elementId === recordedTargetId
      ));
      rows.push({
        elementId: recordedTargetId || null,
        capabilityFamily: capabilityPrefix,
        behaviorFamily,
        assigned: Boolean(recordedTargetId && (entry || behaviorFamily.includes("duplicate"))),
        state: recordedTargetId ? operation?.state || "NOT_EXECUTED" : "NOT_EXECUTED",
        reasonCode: !recordedTargetId
          ? "BEHAVIOR_TARGET_NOT_RECORDED"
          : operation?.state === "PASS"
          ? CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED
          : operation?.details?.exactReason || operation?.reasonCode || "BEHAVIOR_NOT_RECORDED",
        operationId,
      });
    }
  }
  return [...rows, ...manualRows];
}

function fullElementBehaviorMatrix(manifest, selection, observations, behaviors) {
  const selectedIds = new Set(selection.selected.map((entry) => entry.elementId));
  const observationById = new Map(observations.map((entry) => [entry.elementId, entry]));
  const behaviorByElement = new Map();
  for (const behavior of behaviors) {
    const rows = behaviorByElement.get(behavior.elementId) || [];
    rows.push(behavior);
    behaviorByElement.set(behavior.elementId, rows);
  }
  const authored = manifest.entries.map((entry) => ({
    elementId: entry.elementId,
    tag: entry.tag,
    type: entry.type,
    tabId: entry.tabId,
    region: entry.region,
    scrollContainer: entry.scrollContainer,
    capabilities: entry.capabilityFamilies.map((capabilityFamily) => ({
      capabilityFamily,
      state: selectedIds.has(entry.elementId)
        ? observationById.get(entry.elementId)?.state || "NOT_EXECUTED"
        : "NOT_APPLICABLE",
      reasonCode: selectedIds.has(entry.elementId)
        ? observationById.get(entry.elementId)?.reasonCode || "CAPABILITY_OBSERVATION_MISSING"
        : "NOT_SELECTED_BY_FROZEN_COVERAGE_SAMPLE",
    })),
    behaviors: entry.behaviorFamilies.map((behaviorFamily) => {
      const actual = (behaviorByElement.get(entry.elementId) || [])
        .find((row) => row.behaviorFamily === behaviorFamily);
      return actual || {
        elementId: entry.elementId,
        behaviorFamily,
        assigned: false,
        state: "NOT_APPLICABLE",
        reasonCode: "BEHAVIOR_NOT_ASSIGNED_TO_THIS_ELEMENT",
      };
    }),
  }));
  const generated = behaviors.filter((row) => !manifest.entries.some(
    (entry) => entry.elementId === row.elementId,
  ));
  return { authored, generated };
}

async function runDeterministicPasteProbe({
  page,
  electronApp,
  workingCopyPath,
  plan,
  fileIndex,
}) {
  const pasteMarker = "PRQA_" + fileIndex + "_PASTE";
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  await withRestoredElectronClipboard(electronApp, async () => {
    await electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      pasteMarker,
    );
    const target = await enterNativeEdit(page, plan);
    await target.press(keyShortcut("ArrowDown"));
    await page.keyboard.press(keyShortcut("v"));
    await expect(target).toContainText(pasteMarker);
    await page.keyboard.press(keyShortcut("s"));
    await expectCheckpointPersisted(page, beforeRevision);
    await page.keyboard.press("Escape");
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain(pasteMarker);
  });
  return {
    targetId: plan.id,
    marker: pasteMarker,
    inputAuthority: "Playwright keyboard shortcut with restored Electron clipboard",
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
      expectedAfterContains: [pasteMarker],
      expectedAppendedPattern: new RegExp(pasteMarker, "u"),
    }),
  };
}

function summarizeSourceScopeEvidence(entries, omittedOperationIds = []) {
  const checks = entries.map(({ operationId, targetId, sourceScope }) => ({
    operationId,
    targetId,
    booleanConditions: Object.fromEntries(
      Object.entries(sourceScope).filter(([, value]) => typeof value === "boolean"),
    ),
    appendedByteRange: sourceScope.appendedByteRange || null,
    changedRanges: sourceScope.changedRanges || null,
    elementRanges: sourceScope.elementRanges || null,
  }));
  const failed = checks.filter((check) => (
    Object.values(check.booleanConditions).some((value) => value !== true)
  ));
  if (failed.length) {
    const error = new Error("One or more operation-scoped source oracles failed.");
    error.code = "SOURCE_SCOPE_ORACLE_FAILED";
    error.oracle = { checks, omittedOperationIds };
    throw error;
  }
  return {
    ok: true,
    checkedOperationCount: new Set(checks.map((check) => check.operationId)).size,
    checkedTargetCount: new Set(checks.map((check) => check.targetId)).size,
    omittedOperationIds,
    checks,
  };
}

async function verifyViewport(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow:
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > innerWidth + 2,
  }));
}

for (const filename of files) {
  const fileIndex = corpusFiles.indexOf(filename);
  const originalPath = path.join(corpus, filename);
  const copyDir = path.join(reportDir, String(fileIndex));
  const copyPath = path.join(copyDir, filename);
  const row = {
    fileId: `H${String(fileIndex + 1).padStart(2, "0")}`,
    filename,
    originalSha256: null,
    originalSize: null,
    status: "NOT_EXECUTED",
    plannedTargets: [],
    completedTargets: [],
    structureCycles: [],
    lifecycle: [],
  };
  let session;
  let page;
  let original;
  let workingCopyPath = null;
  let plans = [];
  let selectedPlans = [];
  let successful = [];
  let frozenCapability = null;
  let capabilityObservations = [];
  const behaviorRows = [];
  let capabilityFailure = null;
  try {
    try {
      original = readFileSync(originalPath);
      row.originalSha256 = sha256(original);
      row.originalSize = original.length;
      mkdirSync(copyDir, { recursive: true });
      writeFileSync(copyPath, original);
    } catch (cause) {
      resultReport.blockFile(filename, "ENVIRONMENT_BLOCKED", {
        exactReason: "CORPUS_FILE_COPY_FAILED",
        ...errorDetails(cause),
      });
      throw cause;
    }
    try {
      session = await launchPageRoot({ activeSourcePath: copyPath, ...REAL_HTML_LAUNCH_OPTIONS });
    } catch (cause) {
      resultReport.blockFile(filename, "ENVIRONMENT_BLOCKED", {
        exactReason: "ELECTRON_LAUNCH_FAILED",
        ...errorDetails(cause),
      });
      throw cause;
    }
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);
    const preflightWorkingCopyBefore = capabilityPreflightOnly
      ? readFileSync(workingCopyPath)
      : null;
    try {
      frozenCapability = await freezeCapabilityManifest(page, workingCopyPath, {
        allowUnresolved: capabilityPreflightOnly,
      });
      row.capabilityManifest = {
        fingerprint: frozenCapability.fingerprint,
        denominator: frozenCapability.manifest.denominator,
        selected: frozenCapability.selection.selected.length,
        excluded: frozenCapability.manifest.excluded.length,
        regions: frozenCapability.manifest.regions,
        majorTypes: frozenCapability.manifest.majorTypes,
        capabilityFamilies: frozenCapability.manifest.capabilityFamilies,
        behaviorFamilies: frozenCapability.manifest.behaviorFamilies,
        runtimeGeneratedTargets: frozenCapability.runtimeGeneratedTargets,
        runtimeGeneratedDiagnostics: frozenCapability.runtimeGeneratedDiagnostics,
        entries: frozenCapability.manifest.entries,
        exclusions: frozenCapability.manifest.excluded,
        selection: {
          selectedIds: frozenCapability.selection.selected.map((entry) => entry.elementId),
          threshold: frozenCapability.selection.threshold,
          required: frozenCapability.selection.required,
          replacements: frozenCapability.selection.replacements,
        },
        ...(capabilityPreflightOnly ? { draft: frozenCapability.draft } : {}),
      };
    } catch (cause) {
      row.capabilityError = errorDetails(cause);
      capabilityFailure = cause;
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }
    if (capabilityPreflightOnly) {
      const preflightWorkingCopyAfter = readFileSync(workingCopyPath);
      row.preflightWorkingCopy = {
        beforeSha256: sha256(preflightWorkingCopyBefore),
        beforeSize: preflightWorkingCopyBefore.length,
        afterSha256: sha256(preflightWorkingCopyAfter),
        afterSize: preflightWorkingCopyAfter.length,
        unchanged: preflightWorkingCopyBefore.equals(preflightWorkingCopyAfter),
      };
      if (!row.preflightWorkingCopy.unchanged) {
        row.capabilityError = {
          code: "PREFLIGHT_WORKING_COPY_CHANGED",
          exactReason: "READ_ONLY_PREFLIGHT_MUTATED_WORKING_SOURCE",
        };
      }
      row.status = capabilityPreflightFileStatus({
        discoveryFailed: Boolean(capabilityFailure),
        workingCopyUnchanged: row.preflightWorkingCopy.unchanged,
        draftIssues: frozenCapability?.draft?.issues || [],
      });
      continue;
    }
    try {
    plans = await planTextTargets(page, workingCopyPath);
    selectedPlans = plans.slice(0, TEXT_TARGET_COUNT);
    row.plannedTargets = plans.map(({ id, tag, tabId, top }) => ({ id, tag, tabId, top }));

    if (selectedPlans.length < TEXT_TARGET_COUNT) {
      const error = new Error("Each real HTML file must exercise at least three text hosts.");
      error.code = "TEXT_HOST_COVERAGE_INCOMPLETE";
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.TEXT_EDITING,
        REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
        error,
      );
      throw error;
    }
    const runTextOperation = async (operationId, action) => {
      try {
        const details = await action();
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.TEXT_EDITING,
          operationId,
          details,
        );
        return details;
      } catch (cause) {
        if (cause?.code === "CLIPBOARD_FORMAT_UNSUPPORTED") {
          const details = {
            notApplicable: true,
            exactReason: "SYSTEM_CLIPBOARD_ACCEPTANCE_DEFERRED",
            observedFormatCount: Array.isArray(cause.formats) ? cause.formats.length : 0,
          };
          resultReport.notApplicableOperation(
            filename,
            REAL_HTML_STAGE_IDS.TEXT_EDITING,
            operationId,
            details,
          );
          await page.keyboard.press("Escape").catch(() => {});
          await waitUntilEditable(page).catch(() => {});
          return details;
        }
        recordOperationFailure(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, operationId, cause);
        await page.keyboard.press("Escape").catch(() => {});
        await waitUntilEditable(page).catch(() => {});
        throw cause;
      }
    };

    await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
      () => runActivationOperation(page, selectedPlans),
    );
    const inputDelete = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
      () => runInputDeleteOperation({ page, workingCopyPath, plans: selectedPlans, fileIndex }),
    );
    successful = inputDelete.samples.map((sample) => ({
      plan: sample.plan,
      markers: { startMarker: sample.marker, ...sample },
    }));
    row.completedTargets = inputDelete.samples.map((sample) => ({
      id: sample.plan.id,
      tag: sample.plan.tag,
      tabId: sample.plan.tabId,
      operations: ["activate", "input", "Backspace", "Delete", "save and re-enter"],
      sourceScope: sample.sourceScope,
    }));
    const newline = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
      () => runNewlineOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const paste = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_PASTE,
      () => runDeterministicPasteProbe({
        page,
        electronApp: session.electronApp,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const undoRedo = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
      () => runUndoRedoOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const format = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
      () => runFormatOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const sourceScope = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE,
      () => summarizeSourceScopeEvidence([
        ...inputDelete.samples.map((sample) => ({
          operationId: REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
          targetId: sample.plan.id,
          sourceScope: sample.sourceScope,
        })),
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
          targetId: selectedPlans[0].id,
          sourceScope: newline.sourceScope,
        },
        ...(paste.sourceScope ? [{
          operationId: REAL_HTML_OPERATION_IDS.TEXT_PASTE,
          targetId: selectedPlans[0].id,
          sourceScope: paste.sourceScope,
        }] : []),
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
          targetId: selectedPlans[0].id,
          sourceScope: undoRedo.sourceScope,
        },
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
          targetId: selectedPlans[0].id,
          sourceScope: format.sourceScope,
        },
      ], paste.sourceScope ? [] : [REAL_HTML_OPERATION_IDS.TEXT_PASTE]),
    );
    row.sourceScope = sourceScope;
    resultReport.passStage(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, {
      targetCount: successful.length,
      paste,
      operationOrder: [
        REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
        REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
        REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
        REAL_HTML_OPERATION_IDS.TEXT_PASTE,
        REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
        REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
        REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE,
      ],
    });

    await page.screenshot({ path: path.join(copyDir, "after-complex-text-edits.png"), fullPage: true });
    } catch (cause) {
      row.textError = errorDetails(cause);
      const textStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.TEXT_EDITING,
      );
      if (textStage?.state === "NOT_EXECUTED" && textStage.reasonCode === "NOT_STARTED") {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    await stopPageRoot(session.electronApp, session.isolatedUserData);
    session = undefined;
    writeFileSync(copyPath, original);
    session = await launchPageRoot({ activeSourcePath: copyPath, ...REAL_HTML_LAUNCH_OPTIONS });
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);

    try {
    const copyableEntries = frozenCapability?.manifest.entries.filter((entry) => (
      entry.capabilityFamilies.includes("copy")
    )) || [];
    const copyable = copyableEntries.find((entry) => entry.capabilityFamilies.includes("text"))
      || copyableEntries[0]
      || null;
    const nonCopyable = frozenCapability?.manifest.entries.find((entry) => (
      entry.capabilitySnapshot?.copyAvailability === "unsupported"
      && !entry.capabilityFamilies.includes("copy")
    )) || null;
    const duplicateIds = [];
    const deferredStructureFailures = [];
    if (!copyable) {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
        { exactReason: "NO_FROZEN_COPYABLE_AUTHORED_ELEMENT" },
      );
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
        { exactReason: "NO_DUPLICATE_CREATED" },
      );
    } else {
      const copyablePlan = {
        id: copyable.elementId,
        tag: copyable.tag,
        tabId: copyable.tabId,
      };
      let originalIds;
      let duplicateEditTargetId = null;
      let copyableError = null;
      try {
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const duplicate = await duplicateFixedStructureTarget({
            page,
            workingCopyPath,
            originalSha256: row.originalSha256,
            plan: copyablePlan,
          });
          expect(duplicate.capability).toMatchObject({
            uiAvailability: "available",
            uiReason: "available",
            commandAvailability: "available",
            commandReason: "available",
          });
          originalIds ||= duplicate.beforeIds;
          duplicateIds.push(duplicate.duplicateId);
          row.structureCycles.push({
            cycle,
            originalId: copyable.elementId,
            duplicateId: duplicate.duplicateId,
            result: "copied",
            diagnostic: duplicate.diagnostic,
            capability: duplicate.capability,
            runtime: duplicate.runtime,
          });
          if (cycle === 0 && copyable.capabilityFamilies.includes("text")) {
            const duplicatePlan = { ...copyablePlan, id: duplicate.duplicateId };
            duplicateEditTargetId = duplicate.duplicateId;
            const duplicateMarker = `PRQA_${fileIndex}_DUPLICATE_EDIT`;
            const beforeEditRevision = await currentRevision(page);
            const duplicateTarget = await enterNativeEdit(page, duplicatePlan);
            await duplicateTarget.press(keyShortcut("ArrowDown"));
            await page.keyboard.insertText(` ${duplicateMarker}`);
            await saveAndExitTextOperation(page, beforeEditRevision);
            expect(readFileSync(workingCopyPath, "utf8")).toContain(duplicateMarker);
            row.structureCycles[row.structureCycles.length - 1].duplicateEdit = {
              marker: duplicateMarker,
              result: "edited",
            };
          }
        }
      } catch (cause) {
        copyableError = cause;
      }
      if (copyableError) {
        deferredStructureFailures.push({
          operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
          error: copyableError,
        });
      } else {
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
          {
            sourceId: copyable.elementId,
            expectedCopyable: true,
            frozenCapability: copyable.capabilitySnapshot,
            cycles: row.structureCycles.length,
            duplicateEditTargetId,
          },
        );
        try {
          await deleteFixedStructureTargets({
            page,
            workingCopyPath,
            plan: copyablePlan,
            duplicateIds,
            originalIds,
          });
          for (const cycle of row.structureCycles) cycle.result = "copied-and-deleted";
          resultReport.passOperation(
            filename,
            REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
            REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
            { duplicateIds },
          );
        } catch (cause) {
          deferredStructureFailures.push({
            operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
            error: cause,
          });
        }
      }
    }

    if (!nonCopyable) {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
        { exactReason: "NO_FROZEN_NON_COPYABLE_AUTHORED_ELEMENT" },
      );
    } else {
      try {
        await clickAuthoredTab(page, nonCopyable.tabId);
        const observed = await probeAuthoredCapability({
          page,
          frame: await currentEditorFrame(page),
          editor: editorFor(page),
          candidate: {
            stableId: nonCopyable.probeStableId,
            expectedOperationStableId: nonCopyable.elementId,
            tag: nonCopyable.tag,
            sourceEditable: nonCopyable.capabilityFamilies.includes("text"),
            visible: true,
            isConnected: true,
            inert: false,
            runtimeGenerated: false,
            tabId: nonCopyable.tabId,
            region: nonCopyable.region,
            scrollContainer: nonCopyable.scrollContainer,
          },
          mode: "verify",
          sourceElements: frozenCapability.sourceElements,
        });
        expect(observed.selectedId).toBe(nonCopyable.elementId);
        expect(observed.copyAvailability).toBe("unsupported");
        expect(typeof observed.copyReason === "string" && observed.copyReason.length > 0).toBe(true);
        expect(await editorFor(page).getByRole(
          "button",
          { name: "复制元素", exact: true },
        ).count()).toBe(0);
        const nonCopyablePlan = {
          id: nonCopyable.elementId,
          tag: nonCopyable.tag,
          tabId: nonCopyable.tabId,
        };
        const nonCopyableTarget = (await currentEditorFrame(page))
          .locator(`[data-pageroot-id=${JSON.stringify(nonCopyable.elementId)}]`);
        const relocated = await nonCopyableTarget.evaluate((element, expected) => ({
          count: 1,
          stableId: element.getAttribute("data-pageroot-id"),
          tag: element.tagName.toLowerCase(),
          connected: element.isConnected,
          selectedMarker: element.hasAttribute("data-html-canvas-selected"),
          liveStyleAttribute: element.getAttribute("style"),
          sameAsPlanned: element.getAttribute("data-pageroot-id") === expected.stableId
            && element.tagName.toLowerCase() === expected.tag,
        }), { stableId: nonCopyablePlan.id, tag: nonCopyablePlan.tag });
        const diagnostic = await copyCapabilitySnapshot({
          page,
          workingCopyPath,
          plan: nonCopyablePlan,
          originalSha256: row.originalSha256,
          relocated,
        });
        expect(await nonCopyableTarget.evaluate(
          (element) => element.isContentEditable,
        )).toBe(false);
        expect(diagnostic.commandBoundary.availability).toBe("unsupported");
        expect(diagnostic.commandBoundary.reason).toBeTruthy();
        expect(diagnostic.commandBoundary.reason).not.toBe("available");
        expect(diagnostic.commandBoundary.targetStableId).toBe(nonCopyable.elementId);
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
          {
            sourceId: nonCopyable.elementId,
            expectedCopyable: false,
            contentEditable: false,
            copyAvailability: observed.copyAvailability,
            capabilityReason: observed.copyReason,
            diagnostic,
          },
        );
      } catch (cause) {
        deferredStructureFailures.push({
          operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
          error: cause,
        });
      }
    }
    for (const failure of deferredStructureFailures.reverse()) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        failure.operationId,
        failure.error,
      );
    }
    const structureRows = resultReport.rowsForFile(filename).filter(
      (resultRow) => resultRow.level === "operation"
        && resultRow.stageId === REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    );
    if (structureRows.some((resultRow) => resultRow.state === "FAIL")) {
      throw new Error("Element structure stage failed.");
    }
    if (structureRows.every((resultRow) => resultRow.state === "NOT_APPLICABLE")) {
      resultReport.notApplicableStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, {
        exactReason: "NO_APPLICABLE_FROZEN_STRUCTURE_TARGETS",
      });
    } else {
      resultReport.passStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, {
        frozenManifestFingerprint: frozenCapability?.fingerprint || null,
      });
    }

    } catch (cause) {
      row.structureError = errorDetails(cause);
      const structureStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
      );
      if (
        structureStage?.state === "NOT_EXECUTED"
        && structureStage.reasonCode === "NOT_STARTED"
      ) {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    await stopPageRoot(session.electronApp, session.isolatedUserData);
    session = undefined;
    writeFileSync(copyPath, original);
    session = await launchPageRoot({ activeSourcePath: copyPath, ...REAL_HTML_LAUNCH_OPTIONS });
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);

    try {
    const runtimePlans = await planTextTargets(page, workingCopyPath, {
      limit: 1,
      requireFormatTarget: false,
    });
    const runtimePlan = runtimePlans[0] || null;
    const runtimeSecondaryPlan = runtimePlans[1] || runtimePlan;
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(editorFor(page).getByRole("toolbar")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await waitUntilEditable(page);
    let target = null;
    if (runtimePlan) {
      target = await enterNativeEdit(page, runtimePlan);
      await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
      await page.keyboard.press("Escape");
      row.lifecycle.push("preview-edit-reenter");
    } else {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
        { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
      );
    }

    const reloadBefore = await runtimeContractSnapshot(page);
    await startRuntimeLifecycleObservation(page);
    let runtimeObservations;
    try {
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
      await expect(page.locator(".workbench-chrome-status"))
        .toHaveText("页面已重新加载，可以继续编辑", { timeout: 60_000 });
      await waitUntilEditable(page);
      await waitForRuntimeReloadTerminal(page);
    } finally {
      runtimeObservations = await stopRuntimeLifecycleObservation(page);
    }
    const reloadAfter = await runtimeContractSnapshot(page);
    const candidateNotApplicableReason = (
      reloadAfter.runtimePhase === "static"
      && reloadAfter.runtimeOutcome === "not-candidate"
    )
      ? "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE"
      : null;
    row.runtime = {
      ordinaryBefore: null,
      ordinaryAfter: null,
      reloadBefore,
      reloadAfter,
      observations: runtimeObservations,
    };
    const runtimeOutcomes = runtimeOperationOutcomes({
      ordinaryBefore: null,
      ordinaryAfter: null,
      reloadBefore,
      reloadAfter,
      candidateNotApplicableReason,
      candidateEvidence: runtimeObservations.find((observation) => (
        observation.kind === "candidate-created"
        && observation.evidence === "candidate-id-absent-to-present"
        && typeof observation.candidateId === "string"
        && observation.candidateId.trim() !== ""
      )) || null,
      dynamicRecovery: null,
      staticFallback: {
        observed: reloadAfter.staticFallbackVisible > 0
          || reloadAfter.runtimePhase === "static-fallback",
        phase: reloadAfter.runtimePhase,
        renderVerified: reloadAfter.renderVerified,
        sandbox: reloadAfter.activeSandbox,
      },
    });
    for (const operationId of [
      REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD,
      REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE,
      REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION,
      REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY,
      REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK,
    ]) {
      const outcome = runtimeOutcomes[operationId];
      resultReport.operation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        operationId,
        outcome,
      );
    }
    const runtimeRows = resultReport.rowsForFile(filename).filter(
      (resultRow) => resultRow.level === "operation"
        && resultRow.stageId === REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
    );
    if (runtimeRows.some((resultRow) => resultRow.state === "FAIL")) {
      resultReport.failStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, {
        exactReason: "RUNTIME_OPERATION_FAILED",
      });
      throw new Error("Runtime/iframe stage failed.");
    }
    try {
      if (!runtimeSecondaryPlan) {
        resultReport.notApplicableOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
          { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
        );
      } else {
        target = await enterNativeEdit(page, runtimeSecondaryPlan);
        await page.keyboard.press("Escape");
        row.lifecycle.push("source-reload-reenter");
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
          { sourceId: runtimeSecondaryPlan.id },
        );
      }
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
        cause,
      );
      throw cause;
    }

    try {
      row.viewport = await verifyViewport(page);
      expect(row.viewport.horizontalOverflow, "Workbench chrome must fit the acceptance viewport")
        .toBe(false);
      resultReport.passOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_VIEWPORT,
        row.viewport,
      );
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_VIEWPORT,
        cause,
      );
      throw cause;
    }
    await page.screenshot({ path: path.join(copyDir, "after-source-reload.png"), fullPage: true });

    const isolatedUserData = session.isolatedUserData;
    await stopPageRoot(session.electronApp, isolatedUserData, { cleanup: false });
    session = undefined;
    try {
      session = await launchPageRoot({ isolatedUserData, ...REAL_HTML_LAUNCH_OPTIONS });
      await waitForProjectReady(session.page);
      await waitUntilEditable(session.page);
      if (!runtimePlan) {
        resultReport.notApplicableOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
          { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
        );
      } else {
        await clickAuthoredTab(session.page, runtimePlan.tabId);
        const reopenedTarget = (await currentEditorFrame(session.page)).locator(
          `[data-pageroot-id="${runtimePlan.id}"]`,
        );
        await reopenedTarget.scrollIntoViewIfNeeded();
        await reopenedTarget.dblclick({ position: await renderedTextPosition(reopenedTarget) });
        await expect(reopenedTarget).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
        await session.page.keyboard.press("Escape");
        row.lifecycle.push("reopen-managed-project-reenter");
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
          { targetCount: 1 },
        );
      }
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
        cause,
      );
      throw cause;
    }
    await session.page.screenshot({ path: path.join(copyDir, "reopened.png"), fullPage: true });

    const finalWorkingCopy = await managedWorkingCopyPath(session.page, copyPath);
    row.finalWorkingSha256 = sha256(readFileSync(finalWorkingCopy));
    row.originalUnchanged = sha256(readFileSync(originalPath)) === row.originalSha256;
    if (!row.originalUnchanged) {
      const error = new Error("The original user HTML changed during isolated acceptance.");
      error.code = "ORIGINAL_HTML_CHANGED";
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.ORIGINAL_SOURCE_IMMUTABLE,
        error,
      );
      throw error;
    }
    resultReport.passOperation(
      filename,
      REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      REAL_HTML_OPERATION_IDS.ORIGINAL_SOURCE_IMMUTABLE,
      { originalSha256: row.originalSha256, originalSize: original.length },
    );
    resultReport.passStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, {
      observations: runtimeObservations,
      lifecycle: row.lifecycle,
    });
    } catch (cause) {
      row.runtimeError = errorDetails(cause);
      const runtimeStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      );
      if (
        runtimeStage?.state === "NOT_EXECUTED"
        && runtimeStage.reasonCode === "NOT_STARTED"
      ) {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    try {
      if (session) {
        await stopPageRoot(session.electronApp, session.isolatedUserData);
        session = undefined;
      }
      writeFileSync(copyPath, original);
      session = await launchPageRoot({ activeSourcePath: copyPath, ...REAL_HTML_LAUNCH_OPTIONS });
      page = session.page;
      await waitForProjectReady(page);
      await waitUntilEditable(page);
      workingCopyPath = await managedWorkingCopyPath(page, copyPath);
      const runtimeState = await runtimeContractSnapshot(page);
      const staticReason = runtimeState.runtimePhase === "static"
        && runtimeState.runtimeOutcome === "not-candidate"
        ? "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE"
        : null;
      if (
        runtimeState.runtimePhase === "static-fallback"
        && runtimeState.runtimeOutcome === "prepare-failed"
      ) {
        const error = new Error("Dynamic Runtime preparation failed before continuity qualification.");
        error.code = "RUNTIME_PREPARATION_FAILED_BEFORE_CONTINUITY";
        throw error;
      }
      if (staticReason) {
        resultReport.notApplicableOperation(
          filename,
          REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
          REAL_HTML_OPERATION_IDS.CONTINUITY_CHAIN_RESULT,
          { exactReason: staticReason },
        );
        resultReport.notApplicableStage(filename, REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN, {
          exactReason: staticReason,
        });
      } else {
        const continuityPlans = await planTextTargets(page, workingCopyPath, {
          limit: 2,
          requireFormatTarget: false,
        });
        const continuityCopyEntry = frozenCapability?.manifest.entries.find((entry) => (
          entry.capabilityFamilies.includes("copy")
        )) || null;
        if (!continuityCopyEntry) {
          resultReport.notApplicableOperation(
            filename,
            REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
            REAL_HTML_OPERATION_IDS.CONTINUITY_CHAIN_RESULT,
            { exactReason: "NO_FROZEN_COPYABLE_AUTHORED_ELEMENT_FOR_CONTINUITY" },
          );
          resultReport.notApplicableStage(filename, REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN, {
            exactReason: "NO_FROZEN_COPYABLE_AUTHORED_ELEMENT_FOR_CONTINUITY",
          });
        } else if (continuityPlans.length < 2) {
          resultReport.notApplicableOperation(
            filename,
            REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
            REAL_HTML_OPERATION_IDS.CONTINUITY_CHAIN_RESULT,
            { exactReason: "INSUFFICIENT_FROZEN_TEXT_TARGETS_FOR_CONTINUITY" },
          );
          resultReport.notApplicableStage(filename, REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN, {
            exactReason: "INSUFFICIENT_FROZEN_TEXT_TARGETS_FOR_CONTINUITY",
          });
        } else {
          const continuity = await runContinuityQualification({
            page,
            workingCopyPath,
            textPlans: continuityPlans,
            copyEntry: continuityCopyEntry,
            fileIndex,
          });
          row.continuity = continuity;
          resultReport.passOperation(
            filename,
            REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
            REAL_HTML_OPERATION_IDS.CONTINUITY_CHAIN_RESULT,
            {
              cycleCount: continuity.cycles.length,
              cycles: continuity.cycles,
            },
          );
          resultReport.passStage(filename, REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN, {
            cycleCount: continuity.cycles.length,
          });
        }
      }
    } catch (cause) {
      row.continuityError = errorDetails(cause);
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
        REAL_HTML_OPERATION_IDS.CONTINUITY_CHAIN_RESULT,
        cause,
      );
      resultReport.failStage(
        filename,
        REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
        errorDetails(cause),
      );
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    if (frozenCapability) {
      try {
        if (session) {
          await stopPageRoot(session.electronApp, session.isolatedUserData);
          session = undefined;
        }
        writeFileSync(copyPath, original);
        session = await launchPageRoot({ activeSourcePath: copyPath, ...REAL_HTML_LAUNCH_OPTIONS });
        page = session.page;
        await waitForProjectReady(page);
        await waitUntilEditable(page);
        const capabilityRun = await runDedicatedCapabilityStage({
          session,
          copyPath,
          frozenCapability,
          fileIndex,
        });
        session = capabilityRun.session;
        page = capabilityRun.page;
        workingCopyPath = capabilityRun.workingCopyPath;
        capabilityObservations = capabilityRun.observations;
        behaviorRows.push(...capabilityRun.rows);
        row.runtimeGeneratedCoverage = capabilityRun.runtimeGenerated;
        const runtimeGeneratedRows = capabilityRun.rows.filter((entry) => (
          entry.capabilityFamily === "runtime-generated"
        ));
        const runtimeDiagnosticsIssue = runtimeGeneratedDiagnosticsIssue(
          frozenCapability.runtimeGeneratedDiagnostics,
        );
        if (runtimeDiagnosticsIssue) {
          const error = new Error("Runtime-generated target diagnostics were incomplete.");
          error.code = runtimeDiagnosticsIssue;
          error.details = {
            diagnostics: frozenCapability.runtimeGeneratedDiagnostics,
          };
          recordOperationFailure(
            filename,
            REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
            REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
            error,
          );
          capabilityFailure ||= error;
        } else if (frozenCapability.runtimeGeneratedTargets.length === 0) {
          resultReport.notApplicableOperation(
            filename,
            REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
            REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
            {
              exactReason: "NO_PROVABLE_RUNTIME_GENERATED_TARGET",
              diagnostics: frozenCapability.runtimeGeneratedDiagnostics,
            },
          );
        } else if (runtimeGeneratedRows.some((entry) => entry.state !== "PASS")) {
          const error = new Error("A frozen Runtime-generated target failed its boundary check.");
          error.code = "RUNTIME_GENERATED_BOUNDARY_FAILED";
          error.details = {
            failures: runtimeGeneratedRows.filter((entry) => entry.state !== "PASS"),
          };
          recordOperationFailure(
            filename,
            REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
            REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
            error,
          );
          capabilityFailure ||= error;
        } else {
          resultReport.passOperation(
            filename,
            REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
            REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
            capabilityRun.runtimeGenerated,
          );
        }
      } catch (cause) {
        capabilityFailure ||= cause;
        row.capabilityExecutionError = errorDetails(cause);
        const runtimeOperation = resultReport.rowsForFile(filename).find((entry) => (
          entry.level === "operation"
          && entry.operationId === REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY
        ));
        if (runtimeOperation?.state === "NOT_EXECUTED" && runtimeOperation.reasonCode === "NOT_STARTED") {
          recordOperationFailure(
            filename,
            REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
            REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
            cause,
          );
        }
      }
    }

    if (frozenCapability) {
      const matrixBehaviors = capabilityBehaviorRows(
        filename,
        frozenCapability,
        behaviorRows,
      );
      const matrix = createCapabilityMatrix({
        manifest: frozenCapability.manifest,
        selection: frozenCapability.selection,
        observations: capabilityObservations,
        behaviors: matrixBehaviors,
        originalSource: { hash: row.originalSha256, size: original.length },
        observedSource: {
          hash: sha256(readFileSync(originalPath)),
          size: readFileSync(originalPath).length,
        },
      });
      row.capabilityMatrix = {
        coverage: matrix.verdict.coverage,
        observationCount: matrix.observations.length,
        behaviorCount: matrix.actualBehaviors.length,
        failures: matrix.verdict.failures,
        observations: matrix.observations,
        actualBehaviors: matrix.actualBehaviors,
        elementCapabilityBehaviorMatrix: fullElementBehaviorMatrix(
          frozenCapability.manifest,
          frozenCapability.selection,
          matrix.observations,
          matrix.actualBehaviors,
        ),
        manifest: row.capabilityManifest,
        sourceFence: {
          original: { hash: row.originalSha256, size: original.length },
          observed: {
            hash: sha256(readFileSync(originalPath)),
            size: readFileSync(originalPath).length,
          },
        },
      };
      if (matrix.verdict.ok && !capabilityFailure) {
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
          REAL_HTML_OPERATION_IDS.CAPABILITY_MATRIX_RESULT,
          row.capabilityMatrix,
        );
        resultReport.passStage(filename, REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX, {
          manifestFingerprint: frozenCapability.fingerprint,
          coverage: matrix.verdict.coverage,
        });
      } else {
        const error = capabilityFailure
          || new Error("The frozen element capability and behavior matrix failed.");
        error.code ||= "CAPABILITY_BEHAVIOR_MATRIX_FAILED";
        error.details ||= { failures: matrix.verdict.failures };
        recordOperationFailure(
          filename,
          REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
          REAL_HTML_OPERATION_IDS.CAPABILITY_MATRIX_RESULT,
          error,
        );
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX, errorDetails(error));
      }
    } else {
      const error = capabilityFailure || new Error("Capability manifest was not produced.");
      error.code ||= "CAPABILITY_MANIFEST_MISSING";
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
        REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
        error,
      );
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
        REAL_HTML_OPERATION_IDS.CAPABILITY_MATRIX_RESULT,
        error,
      );
      resultReport.failStage(filename, REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX, errorDetails(error));
    }

    if (session) {
      await stopPageRoot(session.electronApp, session.isolatedUserData);
      session = undefined;
    }
    let finalOriginalIssue = null;
    try {
      const finalOriginal = readFileSync(originalPath);
      row.originalFinalSha256 = sha256(finalOriginal);
      row.originalFinalSize = finalOriginal.length;
      const identity = compareOriginalFileIdentity({
        expectedSha256: row.originalSha256,
        expectedSize: row.originalSize,
        observedSha256: row.originalFinalSha256,
        observedSize: row.originalFinalSize,
      });
      row.originalUnchanged = identity.ok;
      if (!identity.ok) finalOriginalIssue = identity;
    } catch (cause) {
      row.originalUnchanged = null;
      row.originalVerificationError = String(cause?.stack || cause);
      finalOriginalIssue = {
        exactReason: "FINAL_ORIGINAL_VERIFICATION_FAILED",
        ...errorDetails(cause),
      };
    }
    const fileRowsBeforeVerdict = resultReport.rowsForFile(filename);
    const { unexplainedNotApplicable, unresolvedRows } = qualificationResultIssues(
      fileRowsBeforeVerdict,
    );
    const failedStages = fileRowsBeforeVerdict.filter(
      (resultRow) => resultRow.level === "stage" && resultRow.state === "FAIL",
    );
    if (finalOriginalIssue) {
      resultReport.failFile(filename, finalOriginalIssue);
    } else if (unexplainedNotApplicable.length > 0 || unresolvedRows.length > 0) {
      resultReport.failFile(filename, {
        exactReason: "INCOMPLETE_QUALIFICATION_RESULT_MODEL",
        unexplainedNotApplicable: unexplainedNotApplicable.map((entry) => entry.id),
        unresolvedRows: unresolvedRows.map((entry) => entry.id),
      });
    } else if (failedStages.length > 0) {
      resultReport.failFile(filename, {
        exactReason: "CATEGORY_FAILED",
        failedStages: failedStages.map((stage) => stage.stageId),
      });
    } else {
      resultReport.passFile(filename, {
        textTargets: successful.length,
        structureCycles: row.structureCycles.length,
        lifecycle: row.lifecycle,
      });
    }
  } catch (cause) {
    row.error = String(cause?.stack || cause);
    if (capabilityPreflightOnly) {
      row.status = !original || !session ? "ENVIRONMENT_BLOCKED" : "DISCOVERY_ERROR";
      row.preflightError = errorDetails(cause);
    } else {
      const fileRow = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "file",
      );
      if (fileRow?.state === "NOT_EXECUTED" && fileRow.reasonCode === "NOT_STARTED") {
        resultReport.failFile(filename, errorDetails(cause));
      }
    }
    if (session) {
      await session.page.screenshot({ path: path.join(copyDir, "failure.png"), fullPage: true })
        .catch(() => {});
    }
  } finally {
    if (session) {
      await stopPageRoot(session.electronApp, session.isolatedUserData).catch((cause) => {
        row.cleanupError = String(cause?.stack || cause);
        if (capabilityPreflightOnly) row.status = "DISCOVERY_ERROR";
      });
    }
    if (original && row.originalFinalSize == null) {
      try {
        const finalOriginal = readFileSync(originalPath);
        row.originalFinalSha256 = sha256(finalOriginal);
        row.originalFinalSize = finalOriginal.length;
        row.originalUnchanged = compareOriginalFileIdentity({
          expectedSha256: row.originalSha256,
          expectedSize: row.originalSize,
          observedSha256: row.originalFinalSha256,
          observedSize: row.originalFinalSize,
        }).ok;
        if (capabilityPreflightOnly && !row.originalUnchanged) {
          row.status = "DISCOVERY_ERROR";
        }
      } catch (cause) {
        row.originalUnchanged = null;
        row.originalVerificationError = String(cause?.stack || cause);
        if (capabilityPreflightOnly) row.status = "ENVIRONMENT_BLOCKED";
      }
    }
    if (!capabilityPreflightOnly) {
      row.status = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "file",
      )?.state || row.status;
    }
    report.results.push(row);
    saveReport();
    console.log(capabilityPreflightOnly
      ? `${report.results.length}/${files.length}: ${row.status} capability preflight`
      : `${report.results.length}/${files.length}: ${row.status} ${filename} `
        + `(${row.completedTargets.filter((target) => !target.rejected).length} text hosts, `
        + `${row.structureCycles.length} structure cycles)`);
  }
}

if (capabilityPreflightOnly) {
  report.pendingReview = report.results.filter((row) => row.status === "PENDING_REVIEW").length;
  report.discoveryErrors = report.results.filter((row) => row.status === "DISCOVERY_ERROR").length;
  report.environmentBlocked = report.results.filter((row) => row.status === "ENVIRONMENT_BLOCKED").length;
  report.originalsUnchanged = report.results.every((row) => row.originalUnchanged === true);
  report.draftFingerprint = sha256(Buffer.from(JSON.stringify({
    head: report.head,
    tree: report.tree,
    workspaceSourceSha256: report.workspaceSourceSha256,
    files: report.results.map((row) => ({
      fileId: row.fileId,
      originalSha256: row.originalSha256,
      originalSize: row.originalSize,
      originalUnchanged: row.originalUnchanged,
      manifestFingerprint: row.capabilityManifest?.fingerprint || null,
      draft: row.capabilityManifest?.draft || null,
    })),
  })));
  saveReport();
  process.exitCode = capabilityPreflightExitCode(report.results);
} else {
  report.passed = report.results.filter((row) => row.status === "PASS").length;
  report.failed = report.results.filter((row) => row.status === "FAIL").length;
  report.notExecuted = report.results.filter((row) => row.status === "NOT_EXECUTED").length;
  report.notApplicable = report.results.filter((row) => row.status === "NOT_APPLICABLE").length;
  resultReport.finalize();
  saveReport();
  process.exitCode = report.failed || report.notExecuted ? 1 : 0;
}
