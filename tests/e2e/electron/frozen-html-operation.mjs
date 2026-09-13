import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { boundFrozenInspectorCache } from "./helpers/frozen-inspector-cache.mjs";
import { tmpdir } from "node:os";
import { closePageRootGracefully, expect, launchPageRoot, managedWorkingCopyPath, removeIsolatedUserData, stopPageRoot,
  waitForProjectReady, waitForRuntimeHandoffSettled } from "./electron-native-harness.mjs";
import { executeFrozenSelection, frozenDigest, frozenFrameAccess, frozenInitialRuntimeDecision,
  readFrozenSelection, verifyFrozenBytes, verifyFrozenDisplay } from "./real-html/frozen-selection.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";
import { executeFrozenText } from "./real-html/frozen-text.mjs";
import { executeFrozenCopyDenied, executeFrozenStructure } from "./real-html/frozen-structure.mjs";
import { executeFrozenMixed, finishFrozenMixed, frozenRows, mixedCycleRows, mixedCheckpointOperations, verifyFreshCommentStorage } from "./real-html/frozen-mixed.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { startRuntimeLifecycleObservation, stopRuntimeLifecycleObservation }
  from "./real-html/runtime-observer.mjs";
import { EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS } from "../../../app/domain/edit-runtime-contract.js";

// Initial resource preparation can still be pending while the temporary static
// iframe is handoff-idle. Wait for the separately frozen Runtime contract first.
async function waitInitialRuntime(page, expected, sourceRevision) {
  let decision;
  try {
    await expect.poll(async () => {
      const surface = page.getByTestId("workbench-active-document-canvas").filter({ visible: true });
      expect(await surface.count()).toBe(1);
      decision = frozenInitialRuntimeDecision({ phase: await surface.getAttribute("data-edit-runtime-phase"),
        outcome: await surface.getAttribute("data-edit-runtime-outcome") }, expected);
      return decision.state;
    }, { timeout: EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS + 5_000, intervals: [100, 250, 500] }).not.toBe("WAIT");
  } catch (cause) {
    throw Object.assign(new Error("FROZEN_INITIAL_RUNTIME_TIMEOUT", { cause }),
      { code: "FROZEN_INITIAL_RUNTIME_TIMEOUT", details: decision });
  }
  if (decision.state !== "READY") throw Object.assign(new Error("FROZEN_INITIAL_RUNTIME_REJECTED"),
    { code: "FROZEN_INITIAL_RUNTIME_REJECTED", details: decision });
  const handoff = await waitForRuntimeHandoffSettled(page, { expectedSourceRevision: sourceRevision });
  return { decision, generation: handoff.activeFrameGeneration };
}

const manifestPath = process.env.PAGEROOT_FROZEN_MANIFEST;
const manifestDigest = process.env.PAGEROOT_FROZEN_MANIFEST_SHA256;
const plan = readFrozenSelection(readFileSync(manifestPath), manifestDigest);
const version = workspaceSourceFingerprint();
expect(version.workspaceSourceSha256, "FROZEN_SOURCE_VERSION_MISMATCH")
  .toBe(plan.workspaceSourceSha256);
verifyFrozenBytes(readFileSync(plan.original.path), plan.original, "ORIGINAL_CHANGED");
verifyFrozenBytes(readFileSync(plan.seed.path), plan.seed, "FROZEN_SEED_CHANGED");
const output = mkdtempSync(path.join(tmpdir(), "stemmio-frozen-operation-"));
const importPath = path.join(output, "source.html");
copyFileSync(plan.seed.path, importPath);
const report = { scope: plan.scope, qualification: false, fileId: plan.fileId,
  version, manifestDigest, state: "NOT_EXECUTED", calls: [],
  operation: { operation: "select", targetId: plan.targets[0].selectedId,
    state: "NOT_EXECUTED", reason: "DEPENDENCY_NOT_COMPLETED", durationMs: null },
  [plan.operation === "structure" || plan.operation === "copy-denied" ? "structureOperations" : "textOperations"]: (plan.targets[0].operations || []).map((operation) => ({
    operation, targetId: plan.targets[0].selectedId, state: "NOT_EXECUTED",
    reason: "DEPENDENCY_NOT_COMPLETED", durationMs: null,
  })), reopen: plan.reopen ? { state: "NOT_EXECUTED", reason: "DEPENDENCY_NOT_COMPLETED" } : null };
let session;
let workingPath;
let expectedFinal = plan.seed;
let observedEditor;
let readComments;
let inspectorCache;
if (plan.operation === "mixed") {
  delete report.textOperations;
  delete report.operation;
  report.mixed = { cycles: mixedCycleRows(plan), checkpoint: frozenRows(
    mixedCheckpointOperations(plan), plan.targets[0].selectedId) };
}
try {
  session = await launchPageRoot({ activeSourcePath: importPath });
  const page = session.page;
  await waitForProjectReady(page);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true });
  await expect(editor).toHaveCount(1);
  await expect(editor).toHaveAttribute("aria-readonly", "false");
  report.initialRuntime = await waitInitialRuntime(page, plan.initialRuntime, `sha256:${plan.seed.sha256}`);
  inspectorCache = await boundFrozenInspectorCache(page);
  report.inspectorCache = inspectorCache.evidence;
  await editor.evaluate(startRuntimeLifecycleObservation);
  observedEditor = editor;
  workingPath = await managedWorkingCopyPath(page, importPath);
  verifyFrozenBytes(readFileSync(workingPath), plan.seed, "IMPORTED_IDENTITY_BYTES_CHANGED");
  if (plan.operation === "mixed") {
    // A fresh import owns one declared Working Copy. Read its exact draft file,
    // never search projects or infer a comment's target from rendered text.
    const control = path.join(path.dirname(workingPath), ".pageroot");
    const manifest = JSON.parse(readFileSync(path.join(control, "manifest.json")));
    expect(manifest.workingCopies).toHaveLength(1);
    const working = manifest.workingCopies[0];
    expect(working.workingCopyId).toBe("work_ver_0001");
    expect(working.sourceRelativePath).toBe(path.basename(workingPath));
    const draftPath = path.join(control, "drafts", "work_ver_0001.json");
    report.initialCommentStorage = verifyFreshCommentStorage(
      JSON.parse(readFileSync(path.join(control, "working-copies", "work_ver_0001.json"))), existsSync(draftPath));
    readComments = () => {
      const draft = JSON.parse(readFileSync(draftPath));
      expect(Array.isArray(draft.comments)).toBe(true);
      return draft.comments;
    };
    expectedFinal = await executeFrozenMixed({ plan, page, editor,
      readSource: () => readPublishedWorkingCopy(workingPath, null), readComments,
      report: report.mixed, calls: report.calls });
  } else {
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  await expect(active).toHaveCount(1);
  const frame = await (await active.elementHandle()).contentFrame();
  expect(frame).toBeTruthy();
  const access = frozenFrameAccess(frame, plan.targets[0], report.calls);
  report.operation = await executeFrozenSelection({ access, keyboard: page.keyboard, mouse: page.mouse,
    target: plan.targets[0], calls: report.calls });
  if (plan.operation === "native-text") {
    report.text = await executeFrozenText({ frame, target: plan.targets[0], access, page, editor,
      fileId: plan.fileId, readSource: () => readPublishedWorkingCopy(workingPath, null), rows: report.textOperations, calls: report.calls });
    expectedFinal = { sha256: report.text.finalSha256, size: report.text.finalSize };
    await waitForRuntimeHandoffSettled(page);
  }
  if (plan.operation === "structure") {
    report.structure = await executeFrozenStructure({ frame, target: plan.targets[0], page, editor,
      fileId: plan.fileId, readSource: () => readPublishedWorkingCopy(workingPath, null), rows: report.structureOperations, calls: report.calls });
    expectedFinal = { sha256: report.structure.finalSha256, size: report.structure.finalSize };
  }
  if (plan.operation === "copy-denied") await executeFrozenCopyDenied({ frame, target: plan.targets[0], editor,
    readSource: () => readPublishedWorkingCopy(workingPath, null), rows: report.structureOperations, calls: report.calls });
  }
  report.source = verifyFrozenBytes(await readPublishedWorkingCopy(workingPath, null), expectedFinal, "WORKING_SOURCE_CHANGED");
  report.display = {
    working: await editor.getAttribute("data-working-source-sha256"),
    displayed: await editor.getAttribute("data-rendered-projection-sha256"),
  };
  report.display.conditions = verifyFrozenDisplay(report.display, expectedFinal);
  report.lifecycle = await observedEditor.evaluate(stopRuntimeLifecycleObservation);
  observedEditor = null;
  if (plan.reopen) {
    inspectorCache.verify();
    const started = performance.now();
    try {
      await closePageRootGracefully(session.electronApp, page);
      session.electronApp = null;
      session = await launchPageRoot({ isolatedUserData: session.isolatedUserData });
      await waitForProjectReady(session.page);
      report.reopen.initialRuntime = await waitInitialRuntime(session.page, plan.initialRuntime, `sha256:${expectedFinal.sha256}`);
      inspectorCache = await boundFrozenInspectorCache(session.page);
      report.reopen.inspectorCache = inspectorCache.evidence;
      const reopenedEditor = session.page.getByTestId("html-canvas-editor").filter({ visible: true });
      await expect(reopenedEditor).toHaveCount(1);
      const reopenedActive = reopenedEditor.locator('iframe[data-runtime-slot-role="active"]');
      await expect(reopenedActive).toHaveCount(1);
      const reopenedFrame = await (await reopenedActive.elementHandle()).contentFrame();
      const reopenedTarget = frozenFrameAccess(reopenedFrame, plan.targets[0], report.calls).target(plan.targets[0].selectedId);
      await expect(reopenedTarget).toHaveCount(1);
      expect(await reopenedTarget.evaluate((element) => element.localName)).toBe(plan.targets[0].selectedTag);
      if (plan.operation === "mixed") {
        await finishFrozenMixed({ plan, page: session.page, editor: reopenedEditor,
          readSource: () => readPublishedWorkingCopy(workingPath, null), readComments,
          report: report.mixed, expectedFinal, calls: report.calls });
      } else if (plan.operation === "structure") {
        expect(await reopenedTarget.textContent()).toBe(report.structure.originalText);
        await expect(reopenedFrame.locator(`[data-pageroot-id="${report.structure.copyId}"]`)).toHaveCount(0);
      } else await expect(reopenedTarget).toContainText(`PRCORE_${plan.fileId}`);
      const source = verifyFrozenBytes(await readPublishedWorkingCopy(workingPath, null), expectedFinal, "REOPEN_SOURCE_CHANGED");
      const display = verifyFrozenDisplay({ working: await reopenedEditor.getAttribute("data-working-source-sha256"),
        displayed: await reopenedEditor.getAttribute("data-rendered-projection-sha256") }, expectedFinal);
      Object.assign(report.reopen, { state: "PASS", reason: "EXACT_ID_TEXT_AND_SOURCE_REOPENED", source, display });
    } catch (error) {
      Object.assign(report.reopen, { state: "FAIL", reason: error.code || "REOPEN_ASSERTION_FAILED" });
      throw error;
    } finally { report.reopen.durationMs = performance.now() - started; }
  }
  report.state = "PASS";
  inspectorCache.verify();
} catch (error) {
  report.state = "FAIL";
  report.firstFailure = { code: error.code || error.name, details: error.details,
    localStack: error.stack };
  if (readComments) {
    try { report.failureComments = readComments(); }
    catch (captureError) { report.commentCaptureError = captureError.message; }
  }
  if (observedEditor) {
    try {
      report.lifecycle = await observedEditor.evaluate(stopRuntimeLifecycleObservation);
      report.failureEditorState = await observedEditor.evaluate((element) => Object.fromEntries(
        [...element.attributes].filter((attribute) => attribute.name.startsWith("data-") || attribute.name === "aria-readonly")
          .map((attribute) => [attribute.name, attribute.value])));
    } catch (captureError) { report.lifecycleCaptureError = captureError.message; }
  }
  try {
    copyFileSync(plan.seed.path, path.join(output, "before.html"));
    if (workingPath) writeFileSync(path.join(output, "after.html"), await readPublishedWorkingCopy(workingPath, null));
  } catch (captureError) { report.evidenceCaptureError = captureError.code || captureError.message; }
  if (session) await session.page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
} finally {
  // Read working bytes before the standard cleanup retires the isolated project.
  if (workingPath && report.state === "PASS") {
    try { report.finalSource = verifyFrozenBytes(readFileSync(workingPath), expectedFinal, "WORKING_SOURCE_CHANGED"); }
    catch (error) { report.state = "FAIL"; report.finalSourceError = error.code; }
  }
  if (session) {
    try {
      if (session.electronApp) await stopPageRoot(session.electronApp, session.isolatedUserData);
      else removeIsolatedUserData(session.isolatedUserData);
      report.cleanup = "PASS";
    }
    catch (error) { report.state = "FAIL"; report.cleanup = "FAIL"; report.cleanupError = error.stack; }
  }
  try {
    report.original = verifyFrozenBytes(readFileSync(plan.original.path), plan.original, "ORIGINAL_CHANGED");
    verifyFrozenBytes(readFileSync(plan.seed.path), plan.seed, "FROZEN_SEED_CHANGED");
    expect(frozenDigest(readFileSync(manifestPath))).toBe(manifestDigest);
    expect(workspaceSourceFingerprint().workspaceSourceSha256).toBe(version.workspaceSourceSha256);
  } catch (error) { report.state = "FAIL"; report.finalIntegrityError = error.code || error.message; }
  writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fileId: report.fileId, scope: report.scope, state: report.state,
    qualification: false, reportDirectory: output }));
  process.exitCode = report.state === "PASS" ? 0 : 1;
}
