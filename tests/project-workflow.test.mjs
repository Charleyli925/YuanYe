import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DocumentWorkflow } from "../app/application/document-workflow.js";
import { DrainCoordinator } from "../app/application/drain-coordinator.js";
import { ExternalFileOpenSession } from "../app/application/external-file-open-session.js";
import { ProjectApplicationSession } from "../app/application/project-application-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { ProjectWorkflow } from "../app/application/project-workflow.js";
import { RunSession } from "../app/application/run-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import {
  WorkbenchTabsSession,
  projectAppliedEventToWorkbenchTabs,
} from "../app/application/workbench-tabs-session.js";
import { stopBridgeOrNotifyCloseAborted } from "../desktop/close-recovery.mjs";

const OLD_PATH = "/tmp/project-workflow-old.html";
const RENAMED_PATH = "/tmp/project-workflow-renamed.html";
const A_PATH = "/tmp/project-workflow-a.html";
const B_PATH = "/tmp/project-workflow-b.html";
const OLD_HTML = "<!doctype html><html><body><p>old</p></body></html>";
const A_HTML = "<!doctype html><html><body><p>A</p></body></html>";
const B_HTML = "<!doctype html><html><body><p>B</p></body></html>";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slug(sourcePath) {
  return sourcePath.split("/").at(-1).replace(/\W+/gu, "_");
}

function draftAuthority(revision = 0) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
  };
}

function workspacePayload(sourcePath, html) {
  const id = slug(sourcePath);
  return {
    projectId: `project_${id}`,
    documentId: `document_${id}`,
    sourcePath,
    currentHtmlSha256: sha256(html),
    project: { displayName: id },
    paths: { projectRecords: `/tmp/PageRoot/${id}` },
    versions: [{ id: `version_${id}` }],
    latestVersionId: `version_${id}`,
    currentBasedOnVersionId: `version_${id}`,
    currentExactVersionId: `version_${id}`,
    runtimeState: {
      editRevision: 0,
      lastPersistedRevision: 0,
      draft: draftAuthority(),
    },
  };
}

function sourcePayload(sourcePath, html) {
  const workspace = workspacePayload(sourcePath, html);
  return {
    projectId: workspace.projectId,
    documentId: workspace.documentId,
    sourcePath,
    content: html,
    sha256: sha256(html),
    currentBasedOnVersionId: workspace.currentBasedOnVersionId,
    currentExactVersionId: workspace.currentExactVersionId,
    lastModifiedAt: "2026-08-11T00:00:00.000Z",
  };
}

function succeeded(value) {
  return { status: "succeeded", value };
}

function sameContext(left, right) {
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function createDraftSession(initialContext) {
  return {
    context: initialContext,
    revision: 0,
    lastError: null,
    deactivate() {
      this.context = null;
      this.revision = 0;
    },
    activate(context, revision = 0) {
      this.context = { ...context };
      this.revision = Number(revision) || 0;
      return true;
    },
    replaceAuthority(context, revision = 0) {
      return this.activate(context, revision);
    },
    isActive(context) {
      return sameContext(this.context, context);
    },
    inspect() {
      return {
        active: Boolean(this.context),
        revision: this.revision,
        pending: false,
        writing: false,
        error: null,
      };
    },
    createSnapshot({ context, comments, changeEvents, deletedCommentIds }) {
      if (!this.isActive(context)) return null;
      return {
        ...context,
        operationId: "draftop_project_workflow_001",
        basedOnVersionId: null,
        expectedDraftRevision: this.revision,
        comments: [...comments],
        changeEvents: [...changeEvents],
        deletedCommentIds: [...deletedCommentIds],
      };
    },
    async drain() {
      return true;
    },
  };
}

async function waitFor(predicate, message = "condition did not settle") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function createHarness({
  getCatalogRevision,
  bridge = {},
  canvas = {},
  projectOpen = {},
  policies = {},
  projectRulesWorkflow: rulesWorkflow = {},
  navigation = null,
  documentWorkflow: documentWorkflowOverrides = {},
  documentWorkflowFactory = null,
  initialProject = true,
  openTarget = null,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = initialProject ? projectSession.openLocator(OLD_PATH) : null;
  const oldContext = locator
    ? projectSession.register({
        ...locator,
        projectId: "project_old",
        documentId: "document_old",
        ...(openTarget ? { openTarget } : {}),
      })
    : null;
  const documentSession = new DocumentSession({
    html: OLD_HTML,
    persistedSourceSha256: sha256(OLD_HTML),
  });
  const commentSession = new CommentSession();
  const draftSession = createDraftSession(oldContext);
  const versionSession = new VersionSession();
  if (initialProject) {
    versionSession.hydrate({
      versions: [{ id: "version_old" }],
      latestVersionId: "version_old",
      currentBasedOnVersionId: "version_old",
      currentExactVersionId: "version_old",
    });
  }
  const runSession = new RunSession({
    sourcePath: initialProject ? OLD_PATH : null,
  });
  const events = [];
  const calls = [];
  const client = {
    async workspace(sourcePath) {
      calls.push(["workspace", sourcePath]);
      const html = sourcePath === A_PATH ? A_HTML
        : sourcePath === B_PATH ? B_HTML
          : OLD_HTML;
      return workspacePayload(sourcePath, html);
    },
    async source(sourcePath) {
      calls.push(["source", sourcePath]);
      const html = sourcePath === A_PATH ? A_HTML
        : sourcePath === B_PATH ? B_HTML
          : OLD_HTML;
      return sourcePayload(sourcePath, html);
    },
    async conflictCandidate() {
      return {};
    },
    ...bridge,
  };
  const defaultDocumentWorkflow = {
    hasHistoryAction: false,
    resetCount: 0,
    projectTransitionAuthority: Object.freeze({
      recoveryIdentity: {
        token: "recovery_old",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
      },
      sourceHistory: {
        scope: "open-document-memory",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
        baseSourceSha256: sha256(OLD_HTML),
        cursor: 0,
        revision: 0,
        entries: [],
      },
      sourceHistoryOperations: [],
    }),
    restoredProjectTransitionAuthority: null,
    resetForProjectTransition() {
      this.resetCount += 1;
      this.projectTransitionAuthority = null;
    },
    clearRecovery() {},
    captureProjectTransitionAuthority() {
      return this.projectTransitionAuthority;
    },
    restoreProjectTransitionAuthority(input) {
      this.projectTransitionAuthority = input.authority;
      this.restoredProjectTransitionAuthority = input;
      return true;
    },
    async flush({ throughRevision } = {}) {
      const persistedHash = sha256(documentSession.html);
      documentSession.update({
        persistedSourceSha256: persistedHash,
        workingHtmlSha256: persistedHash,
        lastPersistedRevision: throughRevision,
      });
      return succeeded({ revision: throughRevision });
    },
    async waitForHistoryAction() {
      return succeeded({ idle: true });
    },
    async ensureCurrentCanvas() {
      return succeeded({ ready: true });
    },
    enqueueEdit() {
      return succeeded({ revision: documentSession.editRevision, queued: true });
    },
    async reconcileBoundary() {
      return succeeded({ ready: true, lastModifiedAt: "" });
    },
    replaceRecoveryIdentity() {},
    activateSourceHistory() {
      return succeeded({ active: true });
    },
    async recoverAutosave() {
      return succeeded({ recovered: false });
    },
    canProtectForDetach() {
      return false;
    },
    hasVerifiedRecoveryCheckpoint() {
      return false;
    },
    async protectForDetach() {
      return { status: "blocked", code: "NO_RECOVERY", reason: "no recovery" };
    },
    adoptConflictCandidate() {
      return succeeded({ adopted: true });
    },
    observeCount: 0,
    observeResult: { unchanged: true },
    async observeExternalSourceChange() {
      this.observeCount += 1;
      return succeeded(this.observeResult);
    },
    ...documentWorkflowOverrides,
  };
  let unlockCount = 0;
  let fenceCount = 0;
  const canvasPort = {
    deferCommand: () => false,
    freezeWorkingSource: () => {
      fenceCount += 1;
      const canvasRenderedSha256 = sha256(documentSession.html);
      return {
        ok: true,
        html: documentSession.html,
        workingSourceSha256: canvasRenderedSha256,
        renderedProjectionSha256: canvasRenderedSha256,
        renderedProjectionStale: false,
        canvasRenderedSha256,
        sourceSha256: canvasRenderedSha256,
      };
    },
    freeze: () => {
      const canvasRenderedSha256 = sha256(documentSession.html);
      return {
        ok: true,
        html: documentSession.html,
        workingSourceSha256: canvasRenderedSha256,
        renderedProjectionSha256: canvasRenderedSha256,
        renderedProjectionStale: false,
        canvasRenderedSha256,
        sourceSha256: canvasRenderedSha256,
        pendingMutation: null,
      };
    },
    async verifyRendered() {},
    invalidateRenderAcks() {},
    showCommitBlocked() {},
    unlock() {
      unlockCount += 1;
    },
    clearSelection() {},
    applyPageViewContext() {},
    hasPendingNativeEdit: () => false,
    requestFrame: (callback) => callback(),
    ...canvas,
  };
  // Project tests fake persistence, but leave decisions execute the real owner.
  const boundaryOwner = new DocumentWorkflow({
    bridgeClient: { autosave: async () => ({}), resolveConflict: async () => ({}), ...client },
    ensureRegistered: async () => succeeded(projectSession.context),
    projectSession, documentSession, commentSession, versionSession,
    sourceHistorySession: new SourceHistorySession(),
    codecs: {
      isRecord, sameSourcePath: (left, right) => left === right,
      persistedChangeEvent: (value) => value,
      recoveryIdentityFromRecord: (value) => value,
      sourceHistoryOperationsFromRecord: (value) => value,
      changesFromRecords: (value) => value,
      historyTextSelectionFromRecord: (value) => value,
      selectionFromRecord: (value) => value,
      rebindTargetsPreservingGlobal: (_html, targets) => targets,
      rebindTargetsAcrossHistoryPreservingGlobal: (_before, _after, targets) => targets,
      canLocateTarget: () => true,
      appendDirectEditEvent: (value) => value,
      auditEventKey: (value) => value,
      removeAcknowledgedAuditEvents: (value) => value,
      errorMessage: (cause, fallback) => cause?.message || fallback,
    },
    ports: { hash: { sha256: async (html) => sha256(html) }, canvas: canvasPort },
    clock: { now: Date.now },
  });
  Object.defineProperty(boundaryOwner, "hasHistoryAction", {
    get: () => defaultDocumentWorkflow.hasHistoryAction,
  });
  boundaryOwner.verifiedProtectionEvidence = (input) => (
    defaultDocumentWorkflow.verifiedProtectionEvidence?.(input) || null
  );
  for (const name of ["inspectLeaveReadiness", "captureLeaveBoundary", "verifyLeaveBoundary"]) {
    defaultDocumentWorkflow[name] ??= boundaryOwner[name].bind(boundaryOwner);
  }
  const documentWorkflow = typeof documentWorkflowFactory === "function"
    ? documentWorkflowFactory({
        client,
        projectSession,
        documentSession,
        commentSession,
        versionSession,
        canvasPort,
        context: oldContext,
      })
    : defaultDocumentWorkflow;
  const openPort = {
    async openLocal() {
      return null;
    },
    async openRecent() {
      return null;
    },
    async getActive() {
      return null;
    },
    async listRecent() {
      return [];
    },
    async acceptExternal() {
      return null;
    },
    ...projectOpen,
  };
  const viewState = {
    isTransitioning: () => false,
  };
  const recentRuns = {
    async hydrate() {},
  };
  const commentWorkflow = {
    resetCount: 0,
    resetForProjectTransition() {
      this.resetCount += 1;
    },
    inspectAttachment: () => ({ state: "resolved" }),
    async waitForAttachments() {
      return true;
    },
    inspectDraft: () => ({ state: "resolved" }),
    async drainDraft() {
      return true;
    },
    recoverDraft({ serverComments, serverEvents }) {
      return {
        comments: serverComments,
        changeEvents: serverEvents,
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: [],
        composerTarget: null,
        commentEdit: null,
      };
    },
  };
  const workflow = new ProjectWorkflow({
    getCatalogRevision,
    bridgeClient: client,
    ensureRegistered: async () => succeeded(projectSession.context),
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    commentWorkflow,
    runSession,
    projectRulesWorkflow: {
      drainCount: 0,
      resetForProjectTransition() {},
      inspect: () => ({ state: "resolved" }),
      async drain() {
        this.drainCount += 1;
        return true;
      },
      ...rulesWorkflow,
    },
    externalFileOpenSession: new ExternalFileOpenSession(),
    projectApplicationSession: new ProjectApplicationSession(),
    documentWorkflow,
    drainCoordinator: new DrainCoordinator(),
    codecs: {
      isRecord,
      sameSourcePath: (left, right) => Boolean(left && right && left === right),
      versionsFromWorkspace: (payload) => Array.isArray(payload.versions)
        ? payload.versions
        : [],
      draftAuthorityFromWorkspace: (payload) => (
        isRecord(payload.runtimeState) && isRecord(payload.runtimeState.draft)
          ? payload.runtimeState.draft
          : draftAuthority()
      ),
      authoritativeDraftRevision: (draft) => Number(draft.draftRevision || 0),
      commentsFromRecords: (value) => Array.isArray(value) ? value : [],
      changesFromDraftRecords: (value) => Array.isArray(value) ? value : [],
      rebindTargetsPreservingGlobal: (_html, targets) => targets,
      activeRunFromRecord: () => null,
      isLockedLifecycleState: () => false,
      commentEditSessionHasChanges: () => false,
      recoveryIdentityFromRecord: (value) => value || null,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      canvas: canvasPort,
      projectOpen: openPort,
      viewState,
      recentRuns,
      ...(navigation ? { navigation } : {}),
    },
    policies: {
      canCloseDuringHydration: (state) => Boolean(
        state.projectHydrating
        && !state.viewTransitioning
        && !state.submissionPending
        && !state.pendingWrite
        && !state.flushInProgress
        && !state.draftPending
        && !state.draftFlushInProgress
        && state.editRevision === state.lastPersistedRevision
      ),
      shouldRecoverAfterCloseAbort: (state) => Boolean(
        state.approvedRequestId === state.abortedRequestId
        && state.imposedEditorFreeze
        && state.projectIdentityMatches
        && !state.projectLocked
        && !state.projectHydrating
        && !state.projectLoadError
        && !state.viewTransitioning
        && !state.submissionPending
        && !state.draftPending
        && !state.draftFlushInProgress
        && !state.draftPersistError
        && (
          state.protectionVerified
          || (
            state.persistState === "idle"
            && !state.pendingWrite
            && !state.flushInProgress
            && state.editRevision === state.lastPersistedRevision
          )
        )
      ),
      ...policies,
    },
    clock: { now: Date.now },
  });
  workflow.subscribeEvents((event) => events.push(event));
  return {
    workflow,
    client,
    calls,
    events,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    runSession,
    documentWorkflow,
    commentWorkflow,
    canvasPort,
    oldContext,
    get unlockCount() {
      return unlockCount;
    },
    get fenceCount() {
      return fenceCount;
    },
  };
}

test("startup publishes the initial active project without fencing a nonexistent Canvas", async (t) => {
  const harness = createHarness({
    initialProject: false,
    canvas: {
      freezeWorkingSource: () => null,
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const sourcePublications = [];
  harness.documentSession.setObserver((snapshot) => {
    if (snapshot.html === A_HTML) sourcePublications.push({
      generation: snapshot.canvasGeneration,
      hydrating: harness.workflow.projectHydrating,
    });
  });
  const outcome = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(outcome.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === A_PATH
      && !harness.workflow.projectHydrating,
    "initial startup project did not finish hydration",
  );
  assert.equal(sourcePublications.length > 0, true);
  assert.equal(sourcePublications[0].hydrating, true,
    "provisional source observers must see the hydration boundary before preparing Runtime");
  assert.equal(harness.documentSession.html, A_HTML);
  assert.equal(harness.projectSession.context.projectId, `project_${slug(A_PATH)}`);
});

test("a clean exact Canvas validation lease skips the leave-side drain", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  assert.equal(harness.documentSession.confirmCanvas({
    generation: 0,
    renderedSha256: sha256(OLD_HTML),
  }), true);

  const outcome = await harness.workflow.prepareSwitch();
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.validationLease, "reused");
  assert.equal(harness.fenceCount, 0);
  assert.equal(
    harness.events.some((event) => event.type === "project-switch-validation-reused"),
    true,
  );
});

test("a dirty document cannot reuse the Canvas validation lease", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  harness.documentSession.confirmCanvas({
    generation: 0,
    renderedSha256: sha256(OLD_HTML),
  });
  harness.documentSession.beginEdit(OLD_HTML.replace("old", "dirty"));

  const outcome = await harness.workflow.prepareSwitch();
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.validationLease, undefined);
  assert.ok(harness.fenceCount > 0);
});

test("project switch accepts protected Working HTML without refreshing a last-known-good projection", async (t) => {
  const latestHtml = OLD_HTML.replace("old", "latest structure");
  const oldRenderedSha256 = sha256(OLD_HTML);
  let staleFenceCount = 0;
  let ensureCanvasCount = 0;
  let fenceOptions = null;
  let harness;
  harness = createHarness({
    canvas: {
      freezeWorkingSource: (options) => {
        staleFenceCount += 1;
        fenceOptions = options;
        return {
          ok: true,
          html: harness.documentSession.html,
          workingSourceSha256: sha256(harness.documentSession.html),
          renderedProjectionSha256: oldRenderedSha256,
          renderedProjectionStale: true,
          canvasRenderedSha256: oldRenderedSha256,
          sourceSha256: sha256(harness.documentSession.html),
        };
      },
    },
    documentWorkflow: {
      async ensureCurrentCanvas() {
        ensureCanvasCount += 1;
        return succeeded({ ready: true });
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentSession.beginEdit(latestHtml);

  const outcome = await harness.workflow.prepareSwitch();

  assert.equal(outcome.status, "succeeded", JSON.stringify(outcome));
  assert.equal(staleFenceCount, 1);
  assert.equal(ensureCanvasCount, 0);
  assert.equal(fenceOptions?.endBehavior, "leave-canvas");
});

test("close protects the latest source without claiming a stale projection is current", async (t) => {
  const latestHtml = OLD_HTML.replace("old", "latest structure");
  const oldRenderedSha256 = sha256(OLD_HTML);
  let reconciliationCount = 0;
  let harness;
  harness = createHarness({
    canvas: {
      freeze: () => ({
        ok: true,
        html: harness.documentSession.html,
        workingSourceSha256: sha256(harness.documentSession.html),
        renderedProjectionSha256: oldRenderedSha256,
        renderedProjectionStale: true,
        canvasRenderedSha256: oldRenderedSha256,
        sourceSha256: sha256(harness.documentSession.html),
        pendingMutation: null,
      }),
    },
    documentWorkflow: {
      async reconcileBoundary() {
        reconciliationCount += 1;
        return succeeded({ reconciled: true });
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentSession.beginEdit(latestHtml);

  const outcome = await harness.workflow.prepareClose({
    requestId: "close_stale_last_known_good",
    deadlineAt: Date.now() + 2_000,
  });

  assert.deepEqual(outcome, { ready: true });
  assert.equal(reconciliationCount, 1);
  assert.equal(harness.unlockCount, 0);
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
  assert.equal(harness.events.some((event) => (
    event.type === "project-close-source-safe-projection-stale"
    && event.workingSourceSha256 === sha256(latestHtml)
    && event.renderedProjectionSha256 === oldRenderedSha256
  )), true);
});

test("a failed source write can switch only after an exact recovery checkpoint", async (t) => {
  let checkpointVerified = false;
  const harness = createHarness({
    documentWorkflow: {
      async flush() {
        return { status: "rejected", code: "SOURCE_WRITE_FAILED", reason: "disk denied" };
      },
      canProtectForDetach() {
        return true;
      },
      hasVerifiedRecoveryCheckpoint({ revision } = {}) {
        return checkpointVerified && revision === 1;
      },
      verifiedProtectionEvidence({ revision } = {}) {
        return checkpointVerified && revision === 1
          ? {
              kind: "recoveryVerified",
              revision,
              htmlSha256: harness.documentSession.workingHtmlSha256,
            }
          : null;
      },
      async protectForDetach() {
        harness.documentSession.confirmWorkingHtml({
          revision: 1,
          htmlSha256: sha256(harness.documentSession.html),
        });
        checkpointVerified = true;
        return succeeded({ protected: true, evidence: "recoveryVerified" });
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentSession.beginEdit(OLD_HTML.replace("old", "protected"));
  harness.documentSession.setPersistence({ state: "failed", error: "disk denied" });

  const outcome = await harness.workflow.prepareSwitch();
  assert.equal(outcome.status, "succeeded", JSON.stringify(outcome));
  assert.equal(checkpointVerified, true);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.lastPersistedRevision, 0);
});

test("a failed source write can close after recovery evidence without claiming source persistence", async (t) => {
  let checkpointVerified = false;
  const harness = createHarness({
    documentWorkflow: {
      async flush() {
        return { status: "rejected", code: "SOURCE_WRITE_FAILED", reason: "disk denied" };
      },
      canProtectForDetach() { return true; },
      hasVerifiedProtectionEvidence({ revision } = {}) {
        return checkpointVerified && revision === 1;
      },
      async protectForDetach() {
        checkpointVerified = true;
        return succeeded({ protected: true, evidence: "recoveryVerified" });
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentSession.beginEdit(OLD_HTML.replace("old", "protected"));
  harness.documentSession.setPersistence({ state: "failed", error: "disk denied" });

  const result = await harness.workflow.prepareClose({
    requestId: "close_recovery_001",
    deadlineAt: Date.now() + 5_000,
  });
  assert.deepEqual(result, { ready: true });
  assert.equal(checkpointVerified, true);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.lastPersistedRevision, 0);
  harness.workflow.abortClose({ requestId: "close_recovery_other" });
  assert.equal(harness.unlockCount, 0);
  harness.workflow.abortClose({ requestId: "close_recovery_001" });
  assert.equal(harness.unlockCount, 1);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.editRevision, 1);
});

test("real Document and Project workflows protect H1 for navigation, close, and restart while source stays H0", async (t) => {
  const h1 = OLD_HTML.replace("old", "protected-real-workflow");
  let journalRecord = null;
  const recoveryJournal = {
    async commit(input) {
      journalRecord = {
        schemaVersion: "2.0.0",
        ...structuredClone(input),
        workingCopyId: String(input.workingCopyId || ""),
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`real-journal:${input.revision}:${input.html}`),
        updatedAt: "2026-09-02T00:00:00.000Z",
        byteLength: Buffer.byteLength(input.html),
      };
      return structuredClone(journalRecord);
    },
    async readVerified() {
      return journalRecord ? structuredClone(journalRecord) : null;
    },
    async remove(input) {
      if (journalRecord?.journalSha256 === input.expectedJournalSha256) {
        journalRecord = null;
        return { removed: true };
      }
      return { removed: false };
    },
  };
  const sourceBytes = OLD_HTML;
  const makeRealDocumentWorkflow = ({
    client,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    canvasPort,
    context,
  }) => {
    const sourceHistorySession = new SourceHistorySession();
    sourceHistorySession.activate(
      context,
      sha256(OLD_HTML),
      null,
    );
    return new DocumentWorkflow({
      bridgeClient: client,
      ensureRegistered: async () => succeeded(projectSession.context),
      projectSession,
      documentSession,
      commentSession,
      versionSession,
      sourceHistorySession,
      codecs: {
        isRecord,
        sameSourcePath: (left, right) => left === right,
        persistedChangeEvent: (value) => value,
        recoveryIdentityFromRecord: (value) => value || null,
        sourceHistoryOperationsFromRecord: (value) => Array.isArray(value) ? value : [],
        changesFromRecords: (value) => Array.isArray(value) ? value : [],
        historyTextSelectionFromRecord: (value) => value || null,
        selectionFromRecord: (value) => value || null,
        rebindTargetsPreservingGlobal: (_html, targets) => targets,
        rebindTargetsAcrossHistoryPreservingGlobal: (_before, _after, targets) => targets,
        canLocateTarget: () => true,
        appendDirectEditEvent: ({ events, pendingEvents }) => ({ events, pendingEvents }),
        auditEventKey: (value) => String(value?.eventId || ""),
        removeAcknowledgedAuditEvents: (events) => events,
        errorMessage: (cause, fallback) => String(cause?.message || fallback),
      },
      ports: {
        hash: { sha256: async (value) => sha256(value) },
        recoveryJournal,
        canvas: canvasPort,
      },
      scheduler: globalThis,
      clock: { now: Date.now },
    });
  };
  const bridge = {
    async autosave() {
      throw new Error("permanent source write failure");
    },
    async resolveConflict() { return { ok: true }; },
  };
  const first = createHarness({
    bridge,
    documentWorkflowFactory: makeRealDocumentWorkflow,
  });
  t.after(() => {
    first.documentWorkflow.dispose();
    first.workflow.dispose();
  });
  assert.equal(first.documentWorkflow.enqueueEdit({
    html: h1,
    context: first.projectSession.context,
  }).status, "succeeded");
  assert.notEqual((await first.documentWorkflow.flush({ throughRevision: 1 })).status, "succeeded");
  assert.equal(sourceBytes, OLD_HTML);
  assert.equal(first.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(first.documentSession.persistState, "failed");

  for (const destination of ["start", "settings", "other-html", "close-active-tab"]) {
    const prepared = await first.workflow.prepareSwitch();
    assert.equal(prepared.status, "succeeded", destination);
    assert.equal(first.documentSession.workingHtmlSha256, sha256(h1));
    assert.notEqual(
      first.documentSession.canvasAuthority.renderedSha256,
      sha256(h1),
      "leave safety must not claim a presentation acknowledgement",
    );
    assert.equal(first.documentSession.persistedSourceSha256, sha256(OLD_HTML));
    assert.equal(first.documentSession.persistState, "failed");
  }
  assert.equal(journalRecord.html, h1);
  assert.equal(journalRecord.recoveryHtmlSha256, sha256(h1));
  const close = await first.workflow.prepareClose({
    requestId: "close_real_recovery_001",
    deadlineAt: Date.now() + 5_000,
  });
  assert.deepEqual(close, { ready: true });
  await assert.rejects(
    stopBridgeOrNotifyCloseAborted({
      requestId: "close_real_recovery_001",
      stopBridge: async () => { throw new Error("bridge shutdown failed"); },
      notifyCloseAborted: async (payload) => first.workflow.abortClose(payload),
    }),
    /bridge shutdown failed/u,
  );
  assert.equal(first.unlockCount, 1);
  assert.equal(first.workflow.getSnapshot().close.phase, "idle");
  assert.equal(first.documentSession.persistState, "failed");

  const restarted = createHarness({
    bridge,
    documentWorkflowFactory: makeRealDocumentWorkflow,
  });
  t.after(() => {
    restarted.documentWorkflow.dispose();
    restarted.workflow.dispose();
  });
  const recovered = await restarted.documentWorkflow.recoverAutosave({
    context: restarted.projectSession.context,
    currentSourceSha256: sha256(OLD_HTML),
    serverRevision: 0,
  });
  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.value.queued, true);
  assert.equal(restarted.documentSession.html, h1);
  assert.equal(restarted.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(restarted.documentSession.workingHtmlSha256, sha256(h1));
  assert.notEqual((await restarted.documentWorkflow.flush({ throughRevision: 1 })).status, "succeeded");
  assert.ok(restarted.documentSession.pendingWrite);
  assert.equal(restarted.workflow.acceptProject({
    name: "Protected successor",
    projectId: "project_protected_successor",
    documentId: "document_protected_successor",
    sourcePath: B_PATH,
    html: B_HTML,
    sha256: sha256(B_HTML),
  }).status, "succeeded");
  await waitFor(
    () => restarted.projectSession.sourcePath === B_PATH
      && restarted.workflow.getSnapshot().projectApplication.status === "idle",
    "verified protection did not release the successor project application",
  );
  assert.equal(restarted.documentSession.html, B_HTML);
  assert.equal(journalRecord.html, h1);
});

test("a startup catalog read cannot delay or supersede a newer local open", async (t) => {
  let resolveActive;
  let catalogRequested = false;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      getActive: () => new Promise((resolve) => {
        resolveActive = resolve;
      }),
      listRegistered: () => {
        catalogRequested = true;
        return new Promise(() => {});
      },
      async openLocal() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const startup = harness.workflow.openProject({ kind: "startup" });
  await waitFor(() => Boolean(resolveActive), "startup active read did not begin");
  const local = await harness.workflow.openProject({ kind: "local" });
  assert.equal(local.status, "succeeded");

  resolveActive({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  let startupDeadline;
  const startupOutcome = await Promise.race([
    startup,
    new Promise((_, reject) => {
      startupDeadline = setTimeout(
        () => reject(new Error("startup waited for the read-only project catalog")),
        500,
      );
    }),
  ]).finally(() => clearTimeout(startupDeadline));
  assert.equal(startupOutcome.status, "succeeded");
  assert.equal(startupOutcome.value.opened, false);
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "newer local open did not remain current after startup settled",
  );
  await waitFor(() => catalogRequested === true, "catalog refresh did not run after the project settled");
  assert.equal(harness.documentSession.html, B_HTML);
});

test("the read-only catalog refresh waits until project hydration settles", async (t) => {
  let resolveWorkspace;
  let catalogCalls = 0;
  const harness = createHarness({
    initialProject: false,
    bridge: {
      workspace: () => new Promise((resolve) => {
        resolveWorkspace = resolve;
      }),
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      listRegistered: () => {
        catalogCalls += 1;
        return Promise.resolve([{ projectId: "project_catalog_a", availability: "ready" }]);
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const startup = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(startup.status, "succeeded");
  await waitFor(() => Boolean(resolveWorkspace), "hydration did not begin");
  assert.equal(catalogCalls, 0);

  resolveWorkspace(workspacePayload(A_PATH, A_HTML));
  await waitFor(
    () => harness.projectSession.context?.sourcePath === A_PATH
      && !harness.workflow.projectHydrating,
    "project did not settle hydration",
  );
  await waitFor(() => catalogCalls === 1, "deferred catalog refresh did not run");

  const stageNames = harness.events
    .filter((event) => event.type === "project-hydration-stage")
    .map((event) => event.stage);
  assert.ok(stageNames.includes("apply-authority:sessions-reset"));
});

test("hydration correlates repository timing with its unique operation", async (t) => {
  let requestedOperationId = null;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath, options) {
        requestedOperationId = options?.operationId || null;
        return {
          ...workspacePayload(sourcePath, sourcePath === A_PATH ? A_HTML : OLD_HTML),
          performanceTiming: {
            repositoryQueueWaitMs: 4,
            workspaceTotalMs: 18,
            bridgeWorkspaceTotalMs: 21,
          },
        };
      },
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
    },
    initialProject: false,
  });
  t.after(() => harness.workflow.dispose());

  const opened = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(opened.status, "succeeded");
  await waitFor(() => harness.events.some((event) => (
    event.type === "project-hydration-stage"
    && event.stage === "workspace-response"
  )), "hydration response was not observed");

  const response = harness.events.find((event) => (
    event.type === "project-hydration-stage"
    && event.stage === "workspace-response"
  ));
  assert.match(requestedOperationId, /^hydration_/u);
  assert.equal(response.operationId, requestedOperationId);
  assert.deepEqual(response.timing, {
    repositoryQueueWaitMs: 4,
    workspaceTotalMs: 18,
    bridgeWorkspaceTotalMs: 21,
  });
});

test("production split workspace commits Core without a second source read and fences Supplemental", async (t) => {
  let sourceCalls = 0;
  const harness = createHarness({
    bridge: {
      async workspaceEnvelope(sourcePath, options) {
        const flat = {
          ...workspacePayload(sourcePath, A_HTML),
          content: A_HTML,
          sourceSha256: sha256(A_HTML),
          lastModifiedAt: "2026-08-27T00:00:00.000Z",
        };
        return {
          workspaceEnvelopeVersion: 1,
          operationId: options.operationId,
          snapshotRevision: `${options.operationId}:revision_1`,
          core: {
            ...flat,
            project: undefined,
            paths: undefined,
            versions: undefined,
          },
          supplemental: {
            operationId: options.operationId,
            snapshotRevision: `${options.operationId}:revision_1`,
            project: flat.project,
            paths: flat.paths,
            versions: flat.versions,
          },
          performanceTiming: { workspaceTotalMs: 9 },
        };
      },
      async source() {
        sourceCalls += 1;
        throw new Error("split workspace must not repeat the source read");
      },
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: OLD_HTML,
          sha256: sha256(OLD_HTML),
        };
      },
    },
    initialProject: false,
  });
  t.after(() => harness.workflow.dispose());

  const opened = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(opened.status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().supplemental.phase === "ready");

  assert.equal(sourceCalls, 0);
  assert.equal(harness.documentSession.html, A_HTML);
  assert.deepEqual(harness.versionSession.snapshot.versions, [
    { id: `version_${slug(A_PATH)}` },
  ]);
  assert.ok(harness.events.some((event) => event.type === "project-core-ready"));
  assert.ok(harness.events.some((event) => event.type === "project-hydrated"));
});

test("Supplemental failure never rolls back committed Core HTML", async (t) => {
  const harness = createHarness({
    bridge: {
      async workspaceEnvelope(sourcePath, options) {
        const flat = {
          ...workspacePayload(sourcePath, A_HTML),
          content: A_HTML,
          sourceSha256: sha256(A_HTML),
        };
        return {
          workspaceEnvelopeVersion: 1,
          operationId: options.operationId,
          snapshotRevision: `${options.operationId}:revision_2`,
          core: flat,
          supplemental: {
            operationId: options.operationId,
            snapshotRevision: `${options.operationId}:revision_2`,
            versions: flat.versions,
          },
        };
      },
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: OLD_HTML,
          sha256: sha256(OLD_HTML),
        };
      },
    },
    initialProject: false,
  });
  harness.documentWorkflow.activateSourceHistory = () => {
    throw new Error("supplement unavailable");
  };
  t.after(() => harness.workflow.dispose());

  const opened = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(opened.status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().supplemental.phase === "failed");

  assert.equal(harness.workflow.projectHydrating, false);
  assert.equal(harness.documentSession.html, A_HTML);
  assert.equal(harness.workflow.projectLoadError, null);
  assert.ok(harness.events.some((event) => event.type === "project-core-ready"));
  assert.ok(harness.events.some((event) => event.type === "project-supplemental-failed"));
});

test("concurrent catalog refreshes coalesce into one in-flight read", async (t) => {
  let resolveCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve) => {
          resolveCatalog = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.refreshRegisteredProjects();
  const second = harness.workflow.refreshRegisteredProjects();

  resolveCatalog([{ projectId: "project_catalog_a", availability: "ready" }]);
  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
  assert.equal(firstOutcome.status, "succeeded");
  assert.equal(secondOutcome.status, "succeeded");
  assert.equal(firstOutcome, secondOutcome);
  assert.equal(catalogCalls, 1);
});

test("two post-settlement refreshes coalesce into one catalog read", async (t) => {
  let resolveCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve) => {
          resolveCatalog = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const context = harness.projectSession.context;
  harness.workflow.scheduleProjectListRefreshAfterSettlement(context);
  harness.workflow.scheduleProjectListRefreshAfterSettlement(context);
  await waitFor(() => catalogCalls === 1, "scheduled refreshes did not coalesce");
  resolveCatalog([{ projectId: "project_catalog_a", availability: "ready" }]);
  await waitFor(
    () => harness.events.some((event) => event.type === "project-catalog-loaded"),
    "catalog projection did not load",
  );
  assert.equal(catalogCalls, 1);
});

test("a post-settlement refresh is fenced by the current Project context", async (t) => {
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return Promise.resolve([]);
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const staleContext = harness.projectSession.context;
  harness.projectSession.openLocator(B_PATH);
  const currentContext = harness.projectSession.register({
    ...harness.projectSession.locator,
    projectId: "project_b",
    documentId: "document_b",
  });

  harness.workflow.scheduleProjectListRefreshAfterSettlement(staleContext);
  assert.equal(catalogCalls, 0);

  harness.workflow.scheduleProjectListRefreshAfterSettlement(currentContext);
  await waitFor(() => catalogCalls === 1, "current project refresh did not start");
  assert.equal(catalogCalls, 1);
});

test("source rename settles before the catalog refresh and never downgrades on catalog failure", async (t) => {
  let settleCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        if (sourcePath !== RENAMED_PATH) return workspacePayload(sourcePath, OLD_HTML);
        return {
          ...workspacePayload(RENAMED_PATH, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: RENAMED_PATH,
          project: { displayName: "renamed" },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        return {
          operationId: payload.operationId,
          previousSourcePath: OLD_PATH,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve, reject) => {
          settleCatalog = { resolve, reject };
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => catalogCalls === 1, "catalog refresh did not follow rename settlement");
  const outcome = await pending;
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(OLD_HTML));

  settleCatalog.reject(new Error("catalog unavailable"));
  await waitFor(
    () => harness.events.some((event) => event.type === "project-catalog-failed"),
    "catalog failure did not surface a projection event",
  );
  assert.equal(outcome.status, "succeeded");
});

test("a Registry project open routes only its projectId through the desktop authority", async (t) => {
  const openedProjectIds = [];
  let fenceCount = 0;
  const projectId = "project_catalog_b";
  const documentId = "doc_catalog_b";
  const openTarget = {
    projectId,
    documentId,
    projectRootPath: "/tmp/PageRoot/B",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: B_PATH,
    sourceSha256: sha256(B_HTML),
  };
  const harness = createHarness({
    bridge: {
      async workspace() {
        return {
          ...workspacePayload(B_PATH, B_HTML),
          projectId,
          documentId,
          openTarget,
        };
      },
      async source() {
        throw new Error("exact registered open must not read source twice");
      },
    },
    canvas: {
      freezeWorkingSource() {
        fenceCount += 1;
        return {
          ok: true,
          html: harness.documentSession.html,
          workingSourceSha256: harness.documentSession.persistedSourceSha256,
          renderedProjectionSha256: harness.documentSession.persistedSourceSha256,
          renderedProjectionStale: false,
          canvasRenderedSha256: harness.documentSession.persistedSourceSha256,
          sourceSha256: harness.documentSession.persistedSourceSha256,
        };
      },
    },
    projectOpen: {
      async openRegistered(projectId) {
        openedProjectIds.push(projectId);
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
          projectId,
          documentId,
          openTarget,
        };
      },
      async listRegistered() {
        return [{ projectId: "project_catalog_b", availability: "ready" }];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const catalog = await harness.workflow.refreshRegisteredProjects();
  assert.equal(catalog.status, "succeeded");
  assert.deepEqual(openedProjectIds, []);

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "registered project did not finish its safe transition",
  );
  assert.deepEqual(openedProjectIds, ["project_catalog_b"]);
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.calls.filter(([kind]) => kind === "source").length, 0);
  assert.equal(fenceCount, 1, "the outgoing Canvas is fenced once by prepareSwitch");
});

test("a pre-protected Registry successor does not repeat the outgoing switch drain", async (t) => {
  let prepareCount = 0;
  const harness = createHarness({
    projectOpen: {
      async openRegistered() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.prepareSwitch = async () => {
    prepareCount += 1;
    return succeeded({ prepared: true });
  };

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
    switchPrepared: true,
  });

  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "pre-protected registered successor did not publish",
  );
  assert.equal(prepareCount, 0);
});

test("a Registry project opens from Start without fencing an unmounted Canvas", async (t) => {
  let fenceCount = 0;
  const harness = createHarness({
    initialProject: false,
    canvas: {
      isMounted: () => false,
      freezeWorkingSource: () => {
        fenceCount += 1;
        return null;
      },
    },
    projectOpen: {
      async openRegistered() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "registered project did not publish from Start",
  );
  assert.equal(fenceCount, 0);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("a retained Controller can switch Registry projects while Start owns the unmounted outlet", async (t) => {
  let fenceCount = 0;
  let freezeCount = 0;
  const harness = createHarness({
    canvas: {
      isMounted: () => false,
      freezeWorkingSource: () => {
        fenceCount += 1;
        return null;
      },
      freeze: () => {
        freezeCount += 1;
        return null;
      },
    },
    projectOpen: {
      async openRegistered() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "retained Controller did not publish the Registry project from Start",
  );
  assert.equal(fenceCount, 0);
  assert.equal(freezeCount, 0);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("a v4 Working Copy transition uses the exact managed desktop activation", async (t) => {
  const calls = [];
  const managedTarget = {
    projectId: "project_old",
    documentId: "document_old",
    projectRootPath: "/tmp/PageRoot/项目/managed",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    exactSourcePath: B_PATH,
    sourceSha256: sha256(B_HTML),
  };
  const harness = createHarness({
    projectOpen: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        return {
          sourcePath: B_PATH,
          sha256: sha256(B_HTML),
          html: B_HTML,
        };
      },
      async listRecent() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const prepared = await harness.workflow.prepareGeneratedSourceTransition({
    previousSourcePath: OLD_PATH,
    nextSourcePath: B_PATH,
    expectedSha256: sha256(B_HTML),
    nextProjectId: "project_old",
    nextDocumentId: "document_old",
    versionId: "ver_0002",
    openTarget: managedTarget,
  });

  assert.equal(prepared.updatesCurrentProject, true);
  assert.equal(prepared.activatedProject?.sourcePath, B_PATH);
  assert.deepEqual(calls, [{
    previousSourcePath: OLD_PATH,
    nextSourcePath: B_PATH,
    expectedSha256: sha256(B_HTML),
    projectId: "project_old",
    documentId: "document_old",
    workingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    projectRootPath: "/tmp/PageRoot/项目/managed",
  }]);
});

test("v4 exposes no relocation workflow that can retarget a moved project", (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  assert.equal("relocateCurrentProject" in harness.workflow, false);
  assert.equal("rebindRelocatedOpenTarget" in harness.documentWorkflow, false);
});

test("project application requires the synchronous navigation receipt before presentation", async (t) => {
  const order = [];
  const receipts = [];
  const harness = createHarness({
    navigation: {
      authorizeProjectApplication() {
        return { accepted: true, kind: "transaction" };
      },
      applyProject(input) {
        order.push("application-port");
        const receipt = Object.freeze({
          transactionId: input.transactionId,
          applicationId: input.applicationId,
          projectId: input.project.projectId,
          documentId: input.project.documentId,
          epoch: input.epoch,
        });
        receipts.push(receipt);
        return receipt;
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.subscribeEvents((event) => {
    if (event.type !== "project-applied") return;
    order.push("presentation-event");
    assert.equal(event.applicationReceipt, receipts[0]);
  });
  const outcome = harness.workflow.acceptProject({
    projectId: "project_A",
    documentId: "doc_A",
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  }, { transactionId: "navigation-A", kind: "accepted" });
  assert.equal(outcome.status, "succeeded");
  await waitFor(() => order.includes("presentation-event"));
  assert.deepEqual(order, ["application-port", "presentation-event"]);
  assert.equal(receipts[0].transactionId, "navigation-A");
  assert.equal(receipts[0].applicationId, outcome.value.applicationId);
});

test("a terminal transaction rejects its deferred application before Controller authority changes", async (t) => {
  let applicationAuthorityOpen = true;
  let canvasReady = false;
  let applyCount = 0;
  const harness = createHarness({
    canvas: {
      freeze() {
        return canvasReady
          ? {
              ok: true,
              html: harness.documentSession.html,
              sourceSha256: harness.documentSession.persistedSourceSha256,
            }
          : { ok: false, reason: "defer once" };
      },
    },
    navigation: {
      authorizeProjectApplication() {
        return applicationAuthorityOpen
          ? { accepted: true, kind: "transaction" }
          : { accepted: false, kind: "stale" };
      },
      applyProject() {
        applyCount += 1;
        return {};
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const prior = harness.projectSession.snapshot;
  const accepted = harness.workflow.acceptProject({
    name: "Late B",
    projectId: "project_late_b",
    documentId: "doc_late_b",
    sourcePath: B_PATH,
    html: B_HTML,
    sha256: sha256(B_HTML),
  }, { transactionId: "navigation-expired" });
  assert.equal(accepted.status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().projectApplication.status === "deferred");

  applicationAuthorityOpen = false;
  canvasReady = true;
  assert.equal(harness.workflow.resumeDeferredProjectApplication().status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().projectApplication.status === "idle");
  assert.deepEqual(harness.projectSession.snapshot, prior);
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(applyCount, 0);
});

test("a stale hydration result cannot publish into a newer project locator", async (t) => {
  let resolveWorkspace;
  const harness = createHarness({
    bridge: {
      workspace: () => new Promise((resolve) => {
        resolveWorkspace = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.refreshWorkspace({
    sourcePath: OLD_PATH,
    epoch: harness.projectSession.epoch,
  });
  await waitFor(() => Boolean(resolveWorkspace));
  harness.projectSession.openLocator(B_PATH);
  harness.documentSession.reset({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  resolveWorkspace(workspacePayload(OLD_PATH, OLD_HTML));

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("accepted projects retain FIFO order while the predecessor hydrates slowly", async (t) => {
  let resolveA;
  const aWorkspace = {
    ...workspacePayload(A_PATH, A_HTML),
    projectId: "project_fifo_a",
    documentId: "doc_fifo_a",
  };
  const bWorkspace = {
    ...workspacePayload(B_PATH, B_HTML),
    projectId: "project_fifo_b",
    documentId: "doc_fifo_b",
  };
  const harness = createHarness({
    bridge: {
      workspace(sourcePath) {
        if (sourcePath === A_PATH) {
          return new Promise((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.resolve(bWorkspace);
      },
      source(sourcePath) {
        const payload = sourcePayload(
          sourcePath,
          sourcePath === A_PATH ? A_HTML : B_HTML,
        );
        const workspace = sourcePath === A_PATH ? aWorkspace : bWorkspace;
        return Promise.resolve({
          ...payload,
          projectId: workspace.projectId,
          documentId: workspace.documentId,
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const tabsSession = new WorkbenchTabsSession();
  const unsubscribeTabs = harness.workflow.subscribeEvents((event) => {
    projectAppliedEventToWorkbenchTabs({ session: tabsSession, event });
  });
  t.after(unsubscribeTabs);

  assert.equal(harness.workflow.acceptProject({
    name: "A",
    projectId: aWorkspace.projectId,
    documentId: aWorkspace.documentId,
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  }).status, "succeeded");
  await waitFor(() => Boolean(resolveA));
  assert.equal(harness.workflow.acceptProject({
    name: "B",
    projectId: bWorkspace.projectId,
    documentId: bWorkspace.documentId,
    sourcePath: B_PATH,
    html: B_HTML,
    sha256: sha256(B_HTML),
  }).status, "succeeded");
  await waitFor(
    () => harness.projectSession.sourcePath === B_PATH
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "fast FIFO successor did not publish",
  );
  assert.deepEqual(
    harness.events
      .filter((event) => event.type === "project-applied")
      .map((event) => event.project.name),
    ["A", "B"],
  );
  assert.deepEqual(
    tabsSession.snapshot.tabs
      .filter((tab) => tab.kind === "document")
      .map((tab) => `${tab.projectId}/${tab.documentId}`),
    ["project_fifo_a/doc_fifo_a", "project_fifo_b/doc_fifo_b"],
  );
  assert.equal(
    tabsSession.snapshot.tabs.find((tab) => tab.tabId === tabsSession.snapshot.activeTabId)?.projectId,
    "project_fifo_b",
  );
  assert.equal(harness.documentSession.html, B_HTML);
  await waitFor(
    () => harness.projectSession.context?.projectId === bWorkspace.projectId,
    "fast FIFO successor identity did not hydrate",
  );
  assert.equal(harness.projectSession.context.projectId, bWorkspace.projectId);
  resolveA(aWorkspace);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("native input delivered after the switch drain defers without losing the accepted project", async (t) => {
  let firstFreeze = true;
  const harness = createHarness({
    canvas: {
      freeze() {
        const frozen = {
          ok: true,
          html: harness.documentSession.html,
          sourceSha256: harness.documentSession.persistedSourceSha256,
          pendingMutation: null,
        };
        if (firstFreeze) {
          firstFreeze = false;
          harness.documentSession.update({ editRevision: 1 });
        }
        return frozen;
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptProject({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  await waitFor(
    () => harness.workflow.getSnapshot().projectApplication.status === "deferred",
    "post-drain native input did not retain the accepted project",
  );
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);
  assert.ok(harness.unlockCount >= 1);

  harness.documentSession.update({ lastPersistedRevision: 1 });
  harness.workflow.reconcileDeferred();
  await waitFor(
    () => harness.projectSession.sourcePath === A_PATH
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "retained accepted project did not resume",
  );
  assert.equal(harness.documentSession.html, A_HTML);
});

test("direct external ACK waits for the correlated navigation terminal", async (t) => {
  const order = [];
  let appliedApplicationId = null;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  const harness = createHarness({
    initialProject: false,
    canvas: { isMounted: () => false },
    projectOpen: {
      async acceptExternal() {
        order.push("accept");
        return {
          projectId: "project_external_terminal",
          documentId: "doc_external_terminal",
          name: "External terminal",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async ackExternal() {
        order.push("ack");
      },
    },
    navigation: {
      authorizeProjectApplication() {
        return { accepted: true, kind: "transaction" };
      },
      applyProject(input) {
        order.push("apply-receipt");
        appliedApplicationId = input.applicationId;
        return { transactionId: input.transactionId, epoch: input.epoch };
      },
      async waitForTerminal(transactionId) {
        assert.equal(transactionId, "navigation-external-terminal");
        order.push("wait-terminal");
        await terminal;
        order.push("terminal");
        return {
          transactionId,
          outcome: { status: "succeeded", value: {} },
          receipt: { applicationId: appliedApplicationId },
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.prepareSwitch = async () => succeeded({ prepared: true });
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external-terminal",
    sourcePath: A_PATH,
    transactionId: "navigation-external-terminal",
  }).status, "succeeded");
  await waitFor(
    () => order.includes("wait-terminal"),
    `navigation terminal wait did not start: ${JSON.stringify({
      order,
      events: harness.events.map((event) => ({ type: event.type, reason: event.reason })),
      snapshot: harness.workflow.getSnapshot(),
    })}`,
  );
  assert.deepEqual(order, ["accept", "apply-receipt", "wait-terminal"]);
  resolveTerminal();
  await waitFor(() => order.includes("ack"));
  assert.deepEqual(order, ["accept", "apply-receipt", "wait-terminal", "terminal", "ack"]);
});

test("external FIFO does not ACK until waitForTerminal returns a real terminal contract", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    canvas: { isMounted: () => false },
    projectOpen: {
      async acceptExternal() {
        order.push("accept");
        return {
          projectId: "project_external_unsettled",
          documentId: "doc_external_unsettled",
          name: "External unsettled",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async ackExternal() {
        order.push("ack");
      },
    },
    navigation: {
      authorizeProjectApplication() {
        return { accepted: false, kind: "stale" };
      },
      applyProject() {
        order.push("apply-receipt");
        return {};
      },
      async waitForTerminal() {
        order.push("wait-terminal");
        return null;
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.prepareSwitch = async () => succeeded({ prepared: true });
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external-unsettled",
    sourcePath: A_PATH,
    transactionId: "navigation-external-unsettled",
  }).status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "deferred");
  assert.deepEqual(order, ["accept", "wait-terminal", "accept", "wait-terminal"]);
  assert.equal(harness.projectSession.sourcePath, null);
});

test("external FIFO ACKs a correlated expired terminal without applying its stale project", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    canvas: { isMounted: () => false },
    projectOpen: {
      async acceptExternal() {
        order.push("accept");
        return {
          projectId: "project_external_expired",
          documentId: "doc_external_expired",
          name: "External expired",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async ackExternal() {
        order.push("ack");
      },
    },
    navigation: {
      authorizeProjectApplication() {
        return { accepted: false, kind: "stale" };
      },
      applyProject() {
        order.push("apply-receipt");
        return {};
      },
      async waitForTerminal(transactionId) {
        order.push("terminal");
        return {
          transactionId,
          outcome: {
            status: "rejected",
            code: "WORKBENCH_NAVIGATION_APPLY_TIMEOUT",
            reason: "expired",
          },
          receipt: null,
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.prepareSwitch = async () => succeeded({ prepared: true });
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external-expired",
    sourcePath: A_PATH,
    transactionId: "navigation-external-expired",
  }).status, "succeeded");
  await waitFor(() => order.includes("ack"));
  assert.deepEqual(order, ["accept", "terminal", "ack"]);
  assert.equal(harness.projectSession.sourcePath, null);
  assert.equal(harness.workflow.getSnapshot().projectApplication.status, "idle");
});

test("an external request arriving during close preparation cancels that exact close", async (t) => {
  let resolveExternal;
  const harness = createHarness({
    projectOpen: {
      acceptExternal: () => new Promise((resolve) => {
        resolveExternal = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());
  const submission = harness.runSession.beginSubmission({ sourcePath: OLD_PATH });
  assert.ok(submission);

  const closing = harness.workflow.prepareClose({
    requestId: "close_external_race",
    deadlineAt: Date.now() + 2_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_during_close",
    sourcePath: A_PATH,
  }).status, "succeeded");
  await waitFor(
    () => harness.workflow.getSnapshot().externalOpen.status === "opening",
  );
  harness.runSession.releaseSubmission(submission);

  const readiness = await closing;
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /HTML 打开/u);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
  await waitFor(() => Boolean(resolveExternal));
  resolveExternal(null);
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
});

test("two unregistered OS opens keep confirmation and acknowledgement order", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        order.push(`accept:${requestId}`);
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: `${requestId}.html`,
          visibleV1FileName: `${requestId}-V1.html`,
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async ackExternal(requestId) {
        order.push(`ack:${requestId}`);
        return { acknowledged: true, requestId };
      },
      async cancelPrepared() {
        return { canceled: true };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_first",
    sourcePath: A_PATH,
  }).status, "succeeded");
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_second",
    sourcePath: B_PATH,
  }).status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().openConfirmation?.requestId === "external_first"
  ));
  assert.deepEqual(order, ["accept:external_first"]);
  assert.equal(harness.workflow.getSnapshot().externalOpen.queuedRequestId, "external_second");

  assert.equal((await harness.workflow.cancelExternalOpen({ requestId: "external_first" })).status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().openConfirmation?.requestId === "external_second"
  ));
  assert.deepEqual(order, [
    "accept:external_first",
    "ack:external_first",
    "accept:external_second",
  ]);
  assert.equal((await harness.workflow.cancelExternalOpen({ requestId: "external_second" })).status, "succeeded");
  await waitFor(() => order.at(-1) === "ack:external_second");
});

test("direct external ack rejection defers the head and retry never accepts or enqueues it twice", async (t) => {
  const accepted = [];
  const acknowledgements = [];
  let remainingAckFailures = 2;
  const harness = createHarness({
    projectOpen: {
      async acceptExternal(requestId) {
        accepted.push(requestId);
        return requestId === "external_ack_first"
          ? { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) }
          : { name: "B", sourcePath: B_PATH, html: B_HTML, sha256: sha256(B_HTML) };
      },
      async ackExternal(requestId) {
        acknowledgements.push(requestId);
        if (requestId === "external_ack_first" && remainingAckFailures > 0) {
          remainingAckFailures -= 1;
          throw new Error("ack unavailable");
        }
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptExternalProject({
    requestId: "external_ack_first",
    sourcePath: A_PATH,
  });
  harness.workflow.acceptExternalProject({
    requestId: "external_ack_second",
    sourcePath: B_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "deferred");
  assert.deepEqual(accepted, ["external_ack_first"]);
  assert.deepEqual(acknowledgements, ["external_ack_first", "external_ack_first"]);

  assert.equal(harness.workflow.resumeDeferredExternalProject().status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().externalOpen.status === "idle"
    && accepted.length === 2
  ));
  assert.deepEqual(accepted, ["external_ack_first", "external_ack_second"]);
  assert.deepEqual(acknowledgements, [
    "external_ack_first",
    "external_ack_first",
    "external_ack_first",
    "external_ack_second",
  ]);
  assert.equal(harness.projectSession.context?.sourcePath, B_PATH);
});

test("terminal external failure retries ack once without reopening", async (t) => {
  let acceptCount = 0;
  let ackCount = 0;
  const harness = createHarness({
    projectOpen: {
      async acceptExternal() {
        acceptCount += 1;
        return { invalid: true };
      },
      async ackExternal(requestId) {
        ackCount += 1;
        if (ackCount <= 2) throw new Error("ack unavailable");
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptExternalProject({
    requestId: "external_terminal_ack",
    sourcePath: A_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
  assert.equal(acceptCount, 1);
  assert.equal(ackCount, 3);
  assert.equal(harness.projectSession.context?.sourcePath, OLD_PATH);
});

test("confirmed external open retries only its failed ack and never commits twice", async (t) => {
  let commitCount = 0;
  let ackCount = 0;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: "confirm.html",
          visibleV1FileName: "confirm-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        commitCount += 1;
        return { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
      async ackExternal(requestId) {
        ackCount += 1;
        if (ackCount <= 2) throw new Error("ack unavailable");
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.acceptExternalProject({
    requestId: "external_confirm_ack",
    sourcePath: A_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().openConfirmation?.requestId === "external_confirm_ack");
  const first = await harness.workflow.confirmExternalOpen({
    requestId: "external_confirm_ack",
    action: "import-new",
  });
  assert.equal(first.code, "EXTERNAL_OPEN_ACK_REJECTED");
  assert.equal(commitCount, 1);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "awaiting-confirmation");
  const retried = await harness.workflow.retryExternalOpen({ requestId: "external_confirm_ack" });
  assert.equal(retried.status, "succeeded");
  assert.equal(commitCount, 1);
  assert.equal(ackCount, 3);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "idle");
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("a single external ack rejection recovers without remaining deferred", async (t) => {
  let ackCount = 0;
  const harness = createHarness({
    projectOpen: {
      async acceptExternal() {
        return { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) };
      },
      async ackExternal(requestId) {
        ackCount += 1;
        if (ackCount === 1) throw new Error("ack unavailable");
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.acceptExternalProject({
    requestId: "external_ack_recover",
    sourcePath: A_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
  assert.equal(ackCount, 2);
  assert.equal(harness.projectSession.context?.sourcePath, A_PATH);
});

test("close drains and acknowledges every queued external confirmation", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        order.push(`accept:${requestId}`);
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: `${requestId}.html`,
          visibleV1FileName: `${requestId}-V1.html`,
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async ackExternal(requestId) {
        order.push(`ack:${requestId}`);
        return { acknowledged: true, requestId };
      },
      async cancelPrepared() {
        return { canceled: true };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  for (const requestId of ["close_confirmation_1", "close_confirmation_2", "close_confirmation_3"]) {
    harness.workflow.acceptExternalProject({ requestId, sourcePath: A_PATH });
  }
  await waitFor(() => harness.workflow.getSnapshot().openConfirmation?.requestId === "close_confirmation_1");
  const closed = await harness.workflow.prepareClose({
    requestId: "close_all_confirmations",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(closed, { ready: true });
  assert.deepEqual(order, [
    "accept:close_confirmation_1",
    "ack:close_confirmation_1",
    "accept:close_confirmation_2",
    "ack:close_confirmation_2",
    "accept:close_confirmation_3",
    "ack:close_confirmation_3",
  ]);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "idle");
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("close drains an in-flight local picker before it commits", async (t) => {
  let resolveLocal;
  const harness = createHarness({
    projectOpen: {
      openLocal: () => new Promise((resolve) => {
        resolveLocal = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = harness.workflow.openProject({ kind: "local" });
  await waitFor(
    () => Boolean(resolveLocal) && harness.workflow.getSnapshot().open.phase === "opening",
    "local picker did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_local_picker",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveLocal(null);
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, false);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
});

test("close drains project switch preparation before it commits", async (t) => {
  let sourceReleased = false;
  let resolveSource;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
    },
    projectRulesWorkflow: {
      inspect() {
        return sourceReleased
          ? { state: "resolved" }
          : { state: "pending", reason: "source protection pending" };
      },
      drain() {
        if (sourceReleased) return Promise.resolve(true);
        return new Promise((resolve) => {
          resolveSource = () => {
            sourceReleased = true;
            resolve(true);
          };
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = harness.workflow.openProject({ kind: "local" });
  await waitFor(
    () => Boolean(resolveSource) && harness.workflow.getSnapshot().open.phase === "opening",
    "project switch preparation did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_switch_preparation",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveSource();
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, true);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
});

test("close drains an in-flight startup active-project read before it commits", async (t) => {
  let resolveActive;
  const harness = createHarness({
    projectOpen: {
      getActive: () => new Promise((resolve) => {
        resolveActive = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = harness.workflow.openProject({ kind: "startup" });
  await waitFor(
    () => Boolean(resolveActive) && harness.workflow.getSnapshot().open.phase === "opening",
    "startup active-project read did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_startup_read",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveActive(null);
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, false);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
});

test("committed close rejects new external work and abort unlocks only its own freeze", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  const readiness = await harness.workflow.prepareClose({
    requestId: "close_owned_freeze",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_after_commit",
    sourcePath: A_PATH,
  }).status, "blocked");

  harness.workflow.abortClose({ requestId: "close_other" });
  assert.equal(harness.unlockCount, 0);
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
  harness.workflow.abortClose({ requestId: "close_owned_freeze" });
  assert.equal(harness.unlockCount, 1);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
});

test("close trusts the prior Start navigation fence when the Canvas outlet is unmounted", async (t) => {
  let freezeCount = 0;
  const harness = createHarness({
    canvas: {
      isMounted: () => false,
      freeze: () => {
        freezeCount += 1;
        return null;
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const readiness = await harness.workflow.prepareClose({
    requestId: "close_from_start_outlet",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(freezeCount, 0);
});

test("a stuck immutable hydration can close without waiting for the remote read", async (t) => {
  const harness = createHarness({
    bridge: {
      workspace: () => new Promise(() => {}),
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.acceptProject({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  await waitFor(() => (
    harness.workflow.projectHydrating
    && harness.workflow.getSnapshot().projectApplication.status === "idle"
  ));
  const unlocksBeforeClose = harness.unlockCount;

  const readiness = await harness.workflow.prepareClose({
    requestId: "close_stuck_hydration",
    deadlineAt: Date.now() + 500,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.unlockCount, unlocksBeforeClose);
});

test("a Canvas acknowledgement failure rolls the hydration publication back", async (t) => {
  const canonicalHtml = "<!doctype html><html><body><p>canonical</p></body></html>";
  const harness = createHarness({
    bridge: {
      async workspace() {
        return workspacePayload(OLD_PATH, canonicalHtml);
      },
      async source() {
        return sourcePayload(OLD_PATH, canonicalHtml);
      },
    },
    canvas: {
      async verifyRendered() {
        throw new Error("canvas acknowledgement missing");
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.refreshWorkspace({
    sourcePath: OLD_PATH,
    epoch: harness.projectSession.epoch,
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.workflow.projectLoadError, "canvas acknowledgement missing");
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(harness.projectSession.context.projectId, "project_old");
  assert.equal(harness.versionSession.snapshot.latestVersionId, "version_old");
  assert.deepEqual(
    harness.documentWorkflow.projectTransitionAuthority,
    {
      recoveryIdentity: {
        token: "recovery_old",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
      },
      sourceHistory: {
        scope: "open-document-memory",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
        baseSourceSha256: sha256(OLD_HTML),
        cursor: 0,
        revision: 0,
        entries: [],
      },
      sourceHistoryOperations: [],
    },
  );
  assert.equal(
    harness.documentWorkflow.restoredProjectTransitionAuthority.context.sourcePath,
    OLD_PATH,
  );
  assert.equal(
    harness.documentWorkflow.restoredProjectTransitionAuthority.sourceSha256,
    sha256(OLD_HTML),
  );
});

test("source rename is a typed ProjectWorkflow transition with one synchronous Session publication", async (t) => {
  let renamePayload = null;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        if (sourcePath !== RENAMED_PATH) return workspacePayload(sourcePath, OLD_HTML);
        return {
          ...workspacePayload(RENAMED_PATH, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: RENAMED_PATH,
          project: { displayName: "renamed" },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        renamePayload = payload;
        return {
          operationId: payload.operationId,
          previousSourcePath: OLD_PATH,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.renameSource({ stem: "renamed" });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(renamePayload, {
    operationId: renamePayload.operationId,
    sourcePath: OLD_PATH,
    stem: "renamed",
    expectedSha256: sha256(OLD_HTML),
  });
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.projectId, "project_old");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(harness.runSession.snapshot.activeSourcePath, RENAMED_PATH);
  assert.equal(harness.documentWorkflow.resetCount, 1);
  assert.equal(harness.commentWorkflow.resetCount, 1);
  assert.ok(harness.unlockCount >= 1);
});

test("title-bar rename keeps the managed OpenTarget so a later Finder rename can rebind", async (t) => {
  const finderPath = "/tmp/project-workflow-finder.html";
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(OLD_PATH),
    bridge: {
      async workspace(sourcePath) {
        const nextPath = sourcePath === finderPath
          ? finderPath
          : sourcePath === RENAMED_PATH
            ? RENAMED_PATH
            : OLD_PATH;
        return {
          ...workspacePayload(nextPath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: nextPath,
          project: { displayName: nextPath.split("/").at(-1).replace(/\.html$/u, "") },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        return {
          operationId: payload.operationId,
          previousSourcePath: payload.sourcePath,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "project-workflow-renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        if (payload.previousSourcePath === RENAMED_PATH) {
          return locatorResult(payload, { sourcePath: finderPath });
        }
        return locatorResult(payload, {
          sourcePath: OLD_PATH,
          status: "unchanged",
        });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const renamed = await harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  assert.equal(renamed.status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");

  const relocated = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: RENAMED_PATH,
    sourceMissing: true,
  });
  assert.equal(relocated.status, "succeeded");
  assert.equal(relocated.value.relocated, true);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, finderPath);
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");
  assert.equal(reconcileCalls.at(-1)?.previousSourcePath, RENAMED_PATH);
});

test("Finder relocate prefers Bridge exactSourcePath over a private-prefixed desktop path", async (t) => {
  const privateRenamed = "/private/tmp/project-workflow-renamed.html";
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        return {
          ...locatorResult(payload, { sourcePath: RENAMED_PATH }),
          sourcePath: privateRenamed,
        };
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
    sourceMissing: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, RENAMED_PATH);
});

test("source rename reconciles a lost desktop response only against the expected new file identity", async (t) => {
  let renameCount = 0;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        return {
          ...workspacePayload(sourcePath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath,
        };
      },
    },
    projectOpen: {
      async renameSource() {
        renameCount += 1;
        throw new Error("desktop response lost");
      },
      async getActive() {
        return {
          name: "project-workflow-renamed.html",
          sourcePath: RENAMED_PATH,
          html: OLD_HTML,
          sha256: sha256(OLD_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  const second = harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  assert.equal(first, second);
  const outcome = await first;

  assert.equal(outcome.status, "succeeded");
  assert.equal(renameCount, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
});

test("a late source rename result cannot rebase a newer project Session", async (t) => {
  let resolveRename;
  let renamePayload;
  const harness = createHarness({
    projectOpen: {
      renameSource(payload) {
        renamePayload = payload;
        return new Promise((resolve) => {
          resolveRename = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => Boolean(resolveRename));
  harness.projectSession.openLocator(B_PATH);
  harness.documentSession.reset({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  resolveRename({
    operationId: renamePayload.operationId,
    previousSourcePath: OLD_PATH,
    sourcePath: RENAMED_PATH,
    sha256: sha256(OLD_HTML),
    stem: "renamed",
  });

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.runSession.snapshot.activeSourcePath, OLD_PATH);
});

test("a pending source rename blocks another project transition at the workflow boundary", async (t) => {
  let resolveRename;
  const harness = createHarness({
    projectOpen: {
      renameSource(payload) {
        return new Promise((resolve) => {
          resolveRename = () => resolve({
            operationId: payload.operationId,
            previousSourcePath: OLD_PATH,
            sourcePath: RENAMED_PATH,
            sha256: sha256(OLD_HTML),
            stem: "renamed",
          });
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const rename = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => Boolean(resolveRename));
  const transition = await harness.workflow.prepareSwitch();

  assert.deepEqual(transition, {
    status: "blocked",
    code: "PROJECT_SWITCH_BLOCKED",
    reason: "正在安全修改 HTML 文件名，请等待本次操作完成后再继续。",
  });
  resolveRename();
  assert.equal((await rename).status, "succeeded");
});

function managedOpenTarget(sourcePath = OLD_PATH) {
  return {
    projectId: "project_old",
    documentId: "document_old",
    projectRootPath: "/tmp/project-root",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: sourcePath,
    sourceSha256: sha256(OLD_HTML),
  };
}

function locatorResult(payload, {
  sourcePath = RENAMED_PATH,
  status = "relocated",
  watcherGeneration = 4,
  sha = sha256(OLD_HTML),
} = {}) {
  return {
    operationId: payload.operationId,
    status,
    previousSourcePath: payload.previousSourcePath,
    sourcePath,
    sourceSha256: sha,
    watcherGeneration,
    openTarget: {
      ...managedOpenTarget(sourcePath),
      sourceSha256: sha,
    },
  };
}


test("Finder locator rebase keeps IDs, publishes the new path, and does not load disk HTML", async (t) => {
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.projectId, "project_old");
  assert.equal(harness.projectSession.context?.documentId, "document_old");
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");
  assert.equal(harness.projectSession.openTarget?.versionId, "ver_0001");
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(harness.runSession.snapshot.activeSourcePath, RENAMED_PATH);
  assert.equal(harness.documentWorkflow.observeCount, 1);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0].previousSourcePath, OLD_PATH);
  assert.equal(reconcileCalls[0].reason, "watch");
  assert.ok(!("nextSourcePath" in reconcileCalls[0]));
  assert.ok(harness.events.some((event) => event.type === "project-source-relocated"));
});

test("Finder relocation is not reported settled when journal rebase cannot reconcile", async (t) => {
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    documentWorkflow: {
      async rebaseRecoveryJournal() {
        return {
          status: "rejected",
          code: "DOCUMENT_RECOVERY_REBASE_REJECTED",
          reason: "journal rebase unavailable",
        };
      },
    },
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        return locatorResult(payload);
      },
      async listRecent() { return []; },
      async listRegistered() { return []; },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
  });

  assert.notEqual(outcome.status, "succeeded");
  assert.match(outcome.reason, /journal rebase unavailable/u);
  assert.ok(!harness.events.some((event) => event.type === "project-source-relocated"));
});

test("present-file watch hints only hash-observe and do not drain switch", async (t) => {
  const reconcileCalls = [];
  const rulesWorkflow = {
    drainCount: 0,
    inspect: () => ({ state: "pending", reason: "unsaved project rules" }),
    async drain() {
      this.drainCount += 1;
      return true;
    },
  };
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectRulesWorkflow: rulesWorkflow,
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, false);
  assert.equal(outcome.value.sourcePath, OLD_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, OLD_PATH);
  assert.equal(harness.documentWorkflow.observeCount, 1);
  assert.equal(reconcileCalls.length, 0);
  assert.equal(rulesWorkflow.drainCount, 0);
  assert.equal(harness.fenceCount, 0);
  assert.ok(!harness.events.some((event) => event.type === "project-source-relocated"));
});

test("a later present-file hint does not drop a pending missing-path rebase", async (t) => {
  let releaseObserve;
  const observeGate = new Promise((resolve) => {
    releaseObserve = resolve;
  });
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentWorkflow.observeExternalSourceChange = async function observeExternalSourceChange() {
    this.observeCount += 1;
    await observeGate;
    return succeeded(this.observeResult);
  };

  const first = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });
  await waitFor(
    () => harness.documentWorkflow.observeCount === 1,
    "present-file observe did not start",
  );
  const missing = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 2,
    previousSourcePath: OLD_PATH,
    sourceMissing: true,
  });
  const present = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });
  assert.equal(reconcileCalls.length, 0);
  releaseObserve();
  assert.equal((await first).status, "succeeded");
  assert.equal((await missing).status, "succeeded");
  assert.equal((await present).status, "succeeded");
  assert.equal(reconcileCalls.length, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
});

test("Finder directory events coalesce to one rebase and late old-path events are ignored", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        await gate;
        return locatorResult(payload, { watcherGeneration: 5 });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: OLD_PATH,
  });
  await waitFor(() => reconcileCalls.length === 1, "first locator reconcile did not start");
  const second = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 2,
    previousSourcePath: OLD_PATH,
  });
  const third = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
  });
  assert.equal(reconcileCalls.length, 1);
  release();
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).value.ignored, true);
  assert.equal((await third).value.ignored, true);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);

  const stale = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: RENAMED_PATH,
  });
  assert.equal(stale.value.ignored, true);
  assert.equal(stale.value.reason, "stale-generation");
  assert.equal(reconcileCalls.length, 1);
});

test("Finder content-changed rebase keeps editor HTML and asks DocumentWorkflow to compare hashes", async (t) => {
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        return locatorResult(payload, {
          status: "content-changed",
          sha: sha256(A_HTML),
        });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentWorkflow.observeResult = { conflict: true };

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.contentChanged, true);
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(OLD_HTML));
  assert.equal(harness.documentWorkflow.observeCount, 1);
});

test("PageRoot rename after Finder rebase uses the recovered path", async (t) => {
  let renamePayload = null;
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    bridge: {
      async workspace(sourcePath) {
        return {
          ...workspacePayload(sourcePath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath,
          project: { displayName: "pageroot-new" },
        };
      },
    },
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        if (payload.previousSourcePath === OLD_PATH) {
          return locatorResult(payload);
        }
        return locatorResult(payload, {
          status: "unchanged",
          sourcePath: RENAMED_PATH,
        });
      },
      async renameSource(payload) {
        renamePayload = payload;
        return {
          operationId: payload.operationId,
          previousSourcePath: RENAMED_PATH,
          sourcePath: "/tmp/project-workflow-pageroot-new.html",
          sha256: sha256(OLD_HTML),
          stem: "pageroot-new",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
  });
  const outcome = await harness.workflow.renameSource({ stem: "pageroot-new" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(renamePayload.sourcePath, RENAMED_PATH);
  assert.equal(renamePayload.stem, "pageroot-new");
  assert.equal(
    harness.projectSession.context?.sourcePath,
    "/tmp/project-workflow-pageroot-new.html",
  );
});

test("cancelling the local picker does not drain the current project", async (t) => {
  let fenced = 0;
  const harness = createHarness({
    canvas: {
      freezeWorkingSource: () => {
        fenced += 1;
        return {
          ok: true,
          html: OLD_HTML,
          workingSourceSha256: sha256(OLD_HTML),
          renderedProjectionSha256: sha256(OLD_HTML),
          renderedProjectionStale: false,
          canvasRenderedSha256: sha256(OLD_HTML),
          sourceSha256: sha256(OLD_HTML),
        };
      },
    },
    projectOpen: {
      async openLocal() {
        return null;
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.opened, false);
  assert.equal(fenced, 0);
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);
});

test("startup confirmation commits without fencing a nonexistent Canvas", async (t) => {
  let fenced = 0;
  let ackCount = 0;
  const harness = createHarness({
    initialProject: false,
    canvas: {
      freezeWorkingSource: () => {
        fenced += 1;
        return null;
      },
    },
    projectOpen: {
      async getActive() {
        return {
          openKind: "confirmation",
          requestId: "req_startup_new",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
      async ackExternal() {
        ackCount += 1;
        throw new Error("startup confirmation has no external mailbox head");
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const started = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(started.status, "succeeded");
  assert.equal(started.value.awaitingConfirmation, true);
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(fenced, 0);

  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_startup_new",
    action: "import-new",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(ackCount, 0);
  assert.equal(fenced, 0);
  await waitFor(
    () => harness.projectSession.sourcePath === A_PATH
      && !harness.workflow.projectHydrating
      && harness.workflow.getSnapshot().openConfirmation === null,
    "startup confirmation did not finish hydration",
  );
  assert.equal(harness.documentSession.html, A_HTML);
});

test("a local Start confirmation cancel or commit failure never publishes the retained Controller", async (t) => {
  let commitShouldFail = false;
  let appliedCount = 0;
  let canceledCount = 0;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_local_start",
          classification: "new-external",
          sourceFileName: "local.html",
          visibleV1FileName: "local-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async cancelPrepared() {
        canceledCount += 1;
        return { canceled: true };
      },
      async commitPrepared() {
        if (commitShouldFail) throw new Error("commit rejected");
        return { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const unsubscribe = harness.workflow.subscribeEvents((event) => {
    if (event.type === "project-applied") appliedCount += 1;
  });
  t.after(unsubscribe);

  await harness.workflow.openProject({ kind: "local" });
  const canceled = await harness.workflow.cancelExternalOpen({ requestId: "req_local_start" });
  assert.equal(canceled.status, "succeeded");
  assert.equal(canceledCount, 1);
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(appliedCount, 0);

  commitShouldFail = true;
  await harness.workflow.openProject({ kind: "local" });
  const failed = await harness.workflow.confirmExternalOpen({
    requestId: "req_local_start",
    action: "import-new",
  });
  assert.equal(failed.status, "rejected");
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(appliedCount, 0);
});

test("a new-external picker result shows confirmation without switching", async (t) => {
  let fenced = 0;
  let committed = null;
  const harness = createHarness({
    canvas: {
      freezeWorkingSource: () => {
        fenced += 1;
        return {
          ok: true,
          html: OLD_HTML,
          workingSourceSha256: sha256(OLD_HTML),
          renderedProjectionSha256: sha256(OLD_HTML),
          renderedProjectionStale: false,
          canvasRenderedSha256: sha256(OLD_HTML),
          sourceSha256: sha256(OLD_HTML),
        };
      },
    },
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_new",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared(payload) {
        committed = payload;
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opened = await harness.workflow.openProject({ kind: "local" });
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.awaitingConfirmation, true);
  assert.equal(fenced, 0);
  assert.equal(
    harness.workflow.getSnapshot().openConfirmation?.classification,
    "new-external",
  );
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);

  assert.equal(
    (await harness.workflow.confirmExternalOpen({
      requestId: "req_new",
      action: "view-initial",
    })).status,
    "rejected",
  );

  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_new",
    action: "import-new",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.deepEqual(committed, {
    requestId: "req_new",
    action: "import-new",
  });
  assert.equal(harness.projectSession.sourcePath, A_PATH);
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("canvas failure after import keeps the published project and never trashes", async (t) => {
  let finalized = 0;
  let rolledBack = 0;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_canvas_fail",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async rollbackPrepared() {
        rolledBack += 1;
        return { rolledBack: true };
      },
      async finalizePrepared() {
        finalized += 1;
        return { disposition: "trashed" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  let canvasCalls = 0;
  harness.documentWorkflow.ensureCurrentCanvas = async () => {
    canvasCalls += 1;
    return {
      status: "rejected",
      code: "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
      reason: "当前画布尚未完成自动恢复。",
    };
  };

  await harness.workflow.openProject({ kind: "local" });
  harness.workflow.setExternalOpenDeleteOriginal({
    requestId: "req_canvas_fail",
    deleteOriginal: true,
  });
  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_canvas_fail",
    action: "import-new",
    deleteOriginal: true,
  });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(canvasCalls, 2);
  assert.equal(finalized, 0);
  assert.equal(rolledBack, 0);
  assert.equal(harness.projectSession.sourcePath, A_PATH);
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
  assert.equal(
    harness.events.some((event) => event.type === "external-open-canvas-failed"),
    true,
  );
});

test("canvas confirmation recovers after one failed acknowledgement", async (t) => {
  let finalized = 0;
  let rolledBack = 0;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_canvas_retry",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async rollbackPrepared() {
        rolledBack += 1;
        return { rolledBack: true };
      },
      async finalizePrepared() {
        finalized += 1;
        return { disposition: "kept" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  let canvasCalls = 0;
  harness.documentWorkflow.ensureCurrentCanvas = async () => {
    canvasCalls += 1;
    if (canvasCalls === 1) {
      return {
        status: "rejected",
        code: "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
        reason: "当前画布尚未完成自动恢复。",
      };
    }
    return succeeded({ ready: true });
  };

  await harness.workflow.openProject({ kind: "local" });
  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_canvas_retry",
    action: "import-new",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(canvasCalls, 2);
  assert.equal(finalized, 1);
  assert.equal(rolledBack, 0);
  assert.equal(
    harness.events.some((event) => event.type === "external-open-canvas-failed"),
    false,
  );
});

test("continue-current opens the bound project without importing again", async (t) => {
  let committed = null;
  let finalized = 0;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_known",
          classification: "known-external",
          sourceFileName: "page.html",
          projectName: "page",
          currentBasedOnOrdinal: 6,
          latestOfficialOrdinal: 6,
          currentDiffersFromBase: true,
          sourceRelation: "unchanged",
        };
      },
      async commitPrepared(payload) {
        committed = payload;
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        finalized += 1;
        return { disposition: "kept" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  await harness.workflow.openProject({ kind: "local" });
  assert.equal(
    harness.workflow.setExternalOpenDeleteOriginal({
      requestId: "req_known",
      deleteOriginal: true,
    }).status,
    "rejected",
  );
  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_known",
    action: "continue-current",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.deepEqual(committed, {
    requestId: "req_known",
    action: "continue-current",
  });
  assert.equal(finalized, 1);
  assert.equal(harness.projectSession.sourcePath, A_PATH);
});


test("catalog rereads after newer Session facts and still accepts a later removal", async (t) => {
  let revision = 0;
  let resolveOld;
  let reads = 0;
  const h = createHarness({ getCatalogRevision: () => revision, projectOpen: {
    listRegistered: () => ++reads === 1 ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(reads === 2 ? [{ projectId: "A" }, { projectId: "B" }] : [{ projectId: "B" }]),
  } });
  t.after(() => h.workflow.dispose());
  const pending = h.workflow.refreshRegisteredProjects();
  revision += 1; // A has been verified and published while the old B-only read waits.
  const coalesced = h.workflow.refreshRegisteredProjects();
  resolveOld([{ projectId: "B" }]);
  assert.deepEqual((await pending).value.projects.map((row) => row.projectId), ["A", "B"]);
  assert.equal((await coalesced).status, "succeeded");
  assert.equal(reads, 2);
  assert.equal(h.events.filter((event) => event.type === "project-catalog-loaded").length, 1);
  assert.deepEqual((await h.workflow.refreshRegisteredProjects()).value.projects, [{ projectId: "B" }]);
});

test("catalog stops after one reread when authority keeps changing", async (t) => {
  let revision = 0;
  const h = createHarness({ getCatalogRevision: () => revision, projectOpen: {
    listRegistered: async () => { revision += 1; return []; },
  } });
  t.after(() => h.workflow.dispose());
  assert.equal((await h.workflow.refreshRegisteredProjects()).status, "stale");
  assert.equal(revision, 2);
  assert.equal(h.events.some((event) => event.type === "project-catalog-loaded"), false);
});
