import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { BridgeRequestError } from "../app/application/bridge-client.js";
import { DocumentSession } from "../app/application/document-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { VersionWorkflow } from "../app/application/version-workflow.js";

import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const { versionsFromWorkspace, changesFromDraftRecords } = await loadWorkbenchModel("version-model");
const { commentsFromRecords } = await loadWorkbenchModel("comment-model");
const { draftAuthorityFromWorkspace } = await loadWorkbenchModel("record-model");
function decodedVersions(versions) {
  return versionsFromWorkspace({ versions, projectId: "project_a", documentId: "document_a" });
}

const SOURCE_A = "/tmp/version-workflow-a.html";
const SOURCE_B = "/tmp/version-workflow-b.html";
const BASE_HTML = "<!doctype html><html><body><p>base</p></body></html>";
const CANDIDATE_HTML = "<!doctype html><html><body><p>candidate</p></body></html>";
const HISTORY_HTML = "<!doctype html><html><body><p>history</p></body></html>";
const DRAINED_HTML = "<!doctype html><html><body><p>drained</p></body></html>";
const B_HTML = "<!doctype html><html><body><p>B</p></body></html>";
const HISTORY_WORKING_COPY_PATH = "/tmp/version-workflow-v2.html";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sameSourcePath(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function operationKey(run) {
  return [run.requestId, run.attemptId, run.sourcePath].join("::");
}

function versionRecord({
  id = "ver_0002",
  content = CANDIDATE_HTML,
  projectId = "project_a",
  documentId = "document_a",
} = {}) {
  return {
    schemaVersion: "4.0.0",
    versionId: id,
    ordinal: Number(id.slice(4)),
    sourceType: id === "ver_0001" ? "initial" : "internal-ai",
    projectId,
    documentId,
    contentSha256: sha256(content),
    generatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function readyRun(overrides = {}) {
  const version = versionRecord();
  const candidateId = overrides.candidateId || "candidate_ready_0001";
  const sourceWorkingCopyId = overrides.sourceWorkingCopyId || "work_ver_0001";
  const readyPayloadOverrides = overrides.readyPayload || {};
  const runOverrides = { ...overrides };
  delete runOverrides.candidateId;
  delete runOverrides.readyPayload;
  const baseCandidate = {
    candidateId,
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    sourceWorkingCopyId,
    proposedVersionId: version.versionId,
    proposedVersionOrdinal: 2,
    expectedSourceSha256: sha256(BASE_HTML),
    outputSha256: version.contentSha256,
    createdAt: "2026-08-12T00:00:01.000Z",
  };
  const baseReadyPayload = {
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    candidateId,
    versionId: version.versionId,
    contentSha256: version.contentSha256,
    candidateDisplayVersionLabel: "版本 2",
    version,
    openTarget: {
      projectId: "project_a",
      documentId: "document_a",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: sourceWorkingCopyId,
      versionId: "ver_0001",
      exactSourcePath: SOURCE_A,
      sourceSha256: sha256(BASE_HTML),
    },
    candidate: baseCandidate,
    completion: { completedAt: "2026-08-12T00:00:01.000Z" },
    outcome: {
      projectId: "project_a",
      documentId: "document_a",
      requestId: "req_0001",
      attemptId: "attempt_001",
      versionId: version.versionId,
      contentSha256: version.contentSha256,
      generatedAt: version.generatedAt,
    },
  };
  return {
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    requestPath: "/tmp/req_0001",
    attemptPath: "/tmp/req_0001/attempt_001",
    handoffMessage: "request",
    status: "ready-to-open",
    sourcePath: SOURCE_A,
    sourceWorkingCopyId,
    baseSnapshotSha256: sha256(BASE_HTML),
    previousVersionId: "ver_0001",
    basedOnVersionId: "ver_0001",
    freezeCutoffRevision: 0,
    candidateVersionId: version.versionId,
    candidateVersionLabel: "版本 2",
    submittedAt: "2026-08-12T00:00:00.000Z",
    completionObserved: true,
    ...runOverrides,
    readyPayload: {
      ...baseReadyPayload,
      ...readyPayloadOverrides,
      candidateId: readyPayloadOverrides.candidateId || candidateId,
      candidate: {
        ...baseCandidate,
        ...(readyPayloadOverrides.candidate || {}),
      },
    },
  };
}

function promotedOpenTarget(input, {
  sourcePath = SOURCE_A,
  sourceSha256 = sha256(CANDIDATE_HTML),
  documentId = input.documentId,
  targetKind = "working-copy",
  versionId = input.versionId,
} = {}) {
  return {
    projectId: input.projectId,
    documentId,
    projectRootPath: "/tmp/project-a",
    targetKind,
    workingCopyId: "work_ver_0002",
    versionId,
    exactSourcePath: sourcePath,
    sourceSha256,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({
  currentPath = SOURCE_A,
  versionRead = null,
  sourceRead = null,
  activation = null,
  createHistory = null,
  queryCreation = null,
  workspaceRead = null,
  confirmCreation = async () => ({}),
  continueHistory = null,
  confirmHistory = null,
  verifyRendered = null,
  onDrain = null,
  observeExternalSourceChange = async () => ({ status: "succeeded" }),
  onCatalogAfterSettlement = null,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = projectSession.openLocator(currentPath);
  const projectId = currentPath === SOURCE_B ? "project_b" : "project_a";
  const documentId = currentPath === SOURCE_B ? "document_b" : "document_a";
  const context = projectSession.register({
    ...locator,
    projectId,
    documentId,
  });
  const initialHtml = currentPath === SOURCE_B ? B_HTML : BASE_HTML;
  const documentSession = new DocumentSession({
    html: initialHtml,
    persistedSourceSha256: sha256(initialHtml),
  });
  const versionSession = new VersionSession();
  versionSession.hydrate({
    versions: decodedVersions([versionRecord({ id: "ver_0001", content: BASE_HTML })]),
    latestVersionId: "ver_0001",
    currentBasedOnVersionId: "ver_0001",
    currentExactVersionId: "ver_0001",
  });
  const runSession = new RunSession({ sourcePath: SOURCE_A });
  const commentSession = new CommentSession();
  const calls = {
    createHistory: [],
    queryCreation: [],
    activate: 0,
    activateInputs: [],
    continueHistory: [],
    versionFile: [],
    source: [],
    drain: [],
    prepare: [],
    commit: [],
    refresh: [],
    render: [],
    invalidate: 0,
    unlock: 0,
    freeze: 0,
    clearRecovery: 0,
    clearAudit: 0,
    resetComments: 0,
    queueDraft: 0,
    draftAuthorities: [],
    confirmHistory: [],
    catalogAfterSettlement: [],
    order: [],
  };
  const bridgeClient = {
    workspace: (path) => workspaceRead(path),
    confirmHistoryCreationOpened: confirmCreation,
    async createVersionFromHistory(input) {
      calls.createHistory.push(input);
      return createHistory(input);
    },
    async queryHistoryCreation(input) {
      calls.queryCreation.push(input);
      return queryCreation(input);
    },
    async versionFile(sourcePath, versionId) {
      calls.versionFile.push([sourcePath, versionId]);
      if (versionRead) return versionRead(sourcePath, versionId);
      const content = versionId === "ver_0001" ? HISTORY_HTML : CANDIDATE_HTML;
      return {
        projectId: "project_a",
        documentId: "document_a",
        versionId,
        content,
        sha256: sha256(content),
      };
    },
    async source(sourcePath) {
      calls.source.push(sourcePath);
      if (sourceRead) return sourceRead(sourcePath);
      const content = sourcePath === SOURCE_B ? B_HTML : CANDIDATE_HTML;
      return {
        projectId: sourcePath === SOURCE_B ? "project_b" : "project_a",
        documentId: sourcePath === SOURCE_B ? "document_b" : "document_a",
        sourcePath,
        content,
        sha256: sha256(content),
        currentBasedOnVersionId: "ver_0002",
        currentExactVersionId: "ver_0002",
        restoredFromVersionId: null,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
      };
    },
    async activateReadyVersion(input) {
      calls.activate += 1;
      calls.activateInputs.push(input);
      if (activation) return activation(input);
      const version = versionRecord({ id: input.versionId });
      return {
        projectId: input.projectId,
        documentId: input.documentId,
        requestId: input.requestId,
        attemptId: input.attemptId,
        versionId: input.versionId,
        contentSha256: version.contentSha256,
        sourceSha256: version.contentSha256,
        currentHtmlSha256: version.contentSha256,
        sourcePath: SOURCE_A,
        openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }),
        candidateDisplayVersionLabel: "版本 2",
        version,
      };
    },
    async continueEditingHistoryVersion(input) {
      calls.continueHistory.push(input);
      if (continueHistory) return continueHistory(input);
      return {
        ok: true,
        status: "history-working-copy-activated",
        projectId: "project_a",
        documentId: "document_a",
        sourcePath: SOURCE_A,
        openTarget: {
          projectId: "project_a",
          documentId: "document_a",
          projectRootPath: "/tmp/project-a",
          targetKind: "working-copy",
          workingCopyId: "work_ver_0001",
          versionId: "ver_0001",
          exactSourcePath: SOURCE_A,
          sourceSha256: sha256(BASE_HTML),
        },
        currentHtmlSha256: sha256(BASE_HTML),
        currentBasedOnVersionId: "ver_0001",
        currentExactVersionId: "ver_0001",
        restoredFromVersionId: null,
        latestVersionId: "ver_0001",
        versions: [versionRecord({ id: "ver_0001", content: BASE_HTML })],
        content: BASE_HTML,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
        historyActivation: {
          operationId: input.operationId,
          projectId: "project_a",
          documentId: "document_a",
          previousWorkingCopyId: "work_ver_0001",
          activatedWorkingCopyId: "work_ver_0001",
          versionId: "ver_0001",
          state: "desktop-pending",
          createdAt: "2026-08-12T00:00:03.000Z",
        },
        operationId: input.operationId,
        activeDraft: {
          draftRevision: 0,
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
      };
    },
    async confirmEditingHistoryVersion(input) {
      calls.confirmHistory.push(input);
      calls.order.push("confirm");
      if (confirmHistory) return confirmHistory(input);
      return {
        ok: true,
        status: "history-working-copy-desktop-confirmed",
        projectId: input.projectId,
        documentId: input.documentId,
        operationId: input.operationId,
        confirmed: true,
        historyActivation: {
          operationId: input.operationId,
          projectId: input.projectId,
          documentId: input.documentId,
          previousWorkingCopyId: input.previousWorkingCopyId,
          activatedWorkingCopyId: input.activatedWorkingCopyId,
          versionId: input.versionId,
          state: "desktop-confirmed",
          createdAt: "2026-08-12T00:00:03.000Z",
        },
      };
    },
  };
  const projectWorkflow = {
    projectHydrating: false,
    projectLoadError: null,
    async drain(boundary, input) {
      calls.drain.push([boundary, input]);
      if (onDrain) return onDrain({ boundary, input, documentSession });
      return { ok: true };
    },
    async prepareManagedSourceTransition(input) {
      calls.prepare.push(input);
      const updatesCurrentProject = (
        projectSession.projectId === input.nextProjectId
        && projectSession.documentId === input.nextDocumentId
      );
      return Object.freeze({
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        openTarget: input.openTarget || null,
        updatesCurrentProject,
        activatedProject: updatesCurrentProject && !sameSourcePath(input.previousSourcePath, input.nextSourcePath)
          ? {
              operationId: input.operationId,
              sourcePath: input.nextSourcePath,
              sha256: input.expectedSha256,
              html: input.nextSourcePath === HISTORY_WORKING_COPY_PATH ? HISTORY_HTML : CANDIDATE_HTML,
            }
          : null,
      });
    },
    commitManagedSourceTransition({ prepared, html, sourceSha256, publishVersion, publishSessions }) {
      calls.commit.push({ prepared, html, sourceSha256 });
      let nextContext = projectSession.context;
      if (!sameSourcePath(projectSession.sourcePath, prepared.nextSourcePath)) {
        nextContext = projectSession.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          openTarget: prepared.openTarget || null,
        });
      }
      if (!nextContext || !projectSession.context) return null;
      if (!sameSourcePath(projectSession.sourcePath, prepared.previousSourcePath)) {
        commentWorkflow.resetForProjectTransition();
      }
      documentSession.publishAuthority({ html, persistedSourceSha256: sourceSha256, pendingWrite: null });
      if (publishSessions) publishSessions(projectSession.context);
      else publishVersion();
      calls.invalidate += 1;
      return projectSession.context;
    },
    captureManagedSourceTransitionAuthority() {
      return {
        context: projectSession.context,
        document: documentSession.snapshot,
        version: versionSession.captureSnapshot(),
        comment: commentSession.snapshot,
      };
    },
    restoreManagedSourceTransitionAuthority(previous) {
      if (!previous?.context) return null;
      const locator = projectSession.openLocator(previous.context.sourcePath);
      const restored = projectSession.register({
        ...locator,
        projectId: previous.context.projectId,
        documentId: previous.context.documentId,
      });
      documentSession.publishAuthority({
        html: previous.document.html,
        persistedSourceSha256: previous.document.persistedSourceSha256,
      });
      versionSession.restoreSnapshot(previous.version);
      commentSession.update(previous.comment);
      return restored;
    },
    async refreshWorkspace(input) {
      calls.refresh.push(input);
      return { status: "succeeded", value: { hydrated: true } };
    },
    scheduleProjectListRefreshAfterSettlement(context) {
      calls.order.push("catalog");
      calls.catalogAfterSettlement.push(context);
      if (onCatalogAfterSettlement) onCatalogAfterSettlement(context);
    },
  };
  const recoveryState = {
    context,
    recoveryId: "recovery-existing-001",
    status: "pending",
  };
  const documentWorkflow = {
    observeExternalSourceChange,
    clearRecovery() {
      calls.clearRecovery += 1;
      recoveryState.status = "cleared";
    },
    clearAudit() {
      calls.clearAudit += 1;
    },
  };
  const commentWorkflow = {
    resetForProjectTransition() {
      calls.resetComments += 1;
    },
    queueDraft() {
      calls.queueDraft += 1;
      return { status: "succeeded", value: { queued: true } };
    },
  };
  const draftSession = {
    replaceAuthority(context, draftRevision, authority) {
      calls.draftAuthorities.push({ context, draftRevision, authority });
      return true;
    },
  };
  const workflow = new VersionWorkflow({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    documentWorkflow,
    commentWorkflow,
    codecs: {
      versionsFromWorkspace, changesFromDraftRecords, commentsFromRecords, draftAuthorityFromWorkspace,
      isRecord: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
      sameSourcePath,
      operationKey,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      hash: { sha256: async (html) => sha256(html) },
      canvas: {
        freezeWorkingSource: () => ({ ok: true }),
        freeze: () => {
          calls.freeze += 1;
          return { ok: true, html: documentSession.html };
        },
        async verifyRendered(html, hash, nextContext) {
          calls.render.push({ html, hash, context: nextContext });
          if (verifyRendered) await verifyRendered(html, hash, nextContext);
        },
        invalidateRenderAcks() {
          calls.invalidate += 1;
        },
        unlock() {
          calls.unlock += 1;
        },
      },
    },
    clock: { now: () => Date.parse("2026-08-12T00:00:03.000Z") },
  });
  return {
    workflow,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    calls,
    recoveryState,
    context,
  };
}

test("review preparation returns an immutable candidate without activating or publishing source", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.prepareReviewCandidate({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(Object.isFrozen(outcome.value), true);
  assert.equal(outcome.value.content, CANDIDATE_HTML);
  assert.equal(outcome.value.sha256, sha256(CANDIDATE_HTML));
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("review preparation fences a late candidate read after cancellation", async () => {
  const delayed = deferred();
  const harness = createHarness({
    versionRead: async () => delayed.promise,
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const reviewing = harness.workflow.prepareReviewCandidate({ run });
  harness.runSession.removeRun(run);
  delayed.resolve({
    projectId: run.projectId,
    documentId: run.documentId,
    versionId: run.candidateVersionId,
    content: CANDIDATE_HTML,
    sha256: sha256(CANDIDATE_HTML),
  });

  const outcome = await reviewing;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
});

test("activation validates all content and synchronously publishes every Session authority", async () => {
  const harness = createHarness();
  const run = readyRun({ sourceWorkingCopyId: "work_ver_0001" });
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.runSession.activeRun?.status, "complete");
  assert.equal(harness.runSession.activeRun.sourceWorkingCopyId, "work_ver_0001");
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.calls.clearAudit, 1);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.draftAuthorities[0].draftRevision, 0);
  assert.deepEqual(harness.commentSession.snapshot.comments, []);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
});

test("activation publishes committed display identity before Canvas verification settles", async () => {
  const canvasGate = deferred();
  const publication = deferred();
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) await canvasGate.promise;
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  harness.workflow.subscribeEvents((event) => {
    if (event.type === "version-activation-published") publication.resolve(event);
  });

  const activation = harness.workflow.activateReadyVersion({ run });
  const event = await publication.promise;
  assert.equal(event.operationKey, operationKey(run));
  assert.equal(event.context.sourcePath, SOURCE_A);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");

  canvasGate.resolve();
  assert.equal((await activation).status, "succeeded");
  assert.equal(harness.runSession.activeRun?.status, "complete");
});

test("activation keeps the Canvas locked when rendered-byte verification fails", async () => {
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) throw new Error("canvas did not acknowledge candidate");
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
  assert.equal(harness.runSession.activeLocked, true);
  assert.equal(harness.calls.unlock, 0);
  assert.equal(harness.calls.clearAudit, 0);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.queueDraft, 0);
  assert.equal(harness.calls.refresh.length, 0);
});

test("activation rejects completion/version hash drift before publishing current source", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256("tampered"),
      sourceSha256: sha256("tampered"),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: sha256("tampered") }),
      version: {
        ...versionRecord({ id: input.versionId }),
        contentSha256: sha256("tampered"),
      },
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("activation rejects malformed ready identity before the explicit Bridge mutation", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.readyPayload = {
    ...run.readyPayload,
    outcome: {
      ...run.readyPayload.outcome,
      versionId: "ver_9999",
    },
  };
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("activation fails closed when a hydrated ready run has no Candidate identity", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.readyPayload = {
    ...run.readyPayload,
    candidateId: null,
    candidate: null,
    navigationOperationId: "navigation_should_not_be_used",
  };
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "VERSION_ACTIVATION_PRECONDITION");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("Candidate Promotion rejects an incomplete or wrong-kind response target before local Desktop transition", async () => {
  const mutations = [
    ["null target", () => null],
    ["version target", (target) => ({ ...target, targetKind: "version" })],
    ["missing version", (target) => ({ ...target, versionId: "" })],
    ["missing path", (target) => ({ ...target, exactSourcePath: "" })],
    ["missing hash", (target) => ({ ...target, sourceSha256: "" })],
    ["wrong document", (target) => ({ ...target, documentId: "document_other" })],
  ];

  for (const [label, mutate] of mutations) {
    const harness = createHarness({
      activation: async (input) => {
        const version = versionRecord({ id: input.versionId });
        const target = promotedOpenTarget(input, { sourceSha256: version.contentSha256 });
        return {
          projectId: input.projectId,
          documentId: input.documentId,
          requestId: input.requestId,
          attemptId: input.attemptId,
          versionId: input.versionId,
          sourcePath: SOURCE_A,
          contentSha256: version.contentSha256,
          sourceSha256: version.contentSha256,
          currentHtmlSha256: version.contentSha256,
          openTarget: mutate(target),
          version,
        };
      },
    });
    const run = readyRun();
    harness.runSession.trackRun(run, { activate: "always" });
    const beforeDocument = harness.documentSession.snapshot;
    const beforeVersion = harness.versionSession.snapshot;
    const beforeProject = harness.projectSession.context;

    const outcome = await harness.workflow.activateReadyVersion({ run });

    assert.equal(outcome.status, "rejected", label);
    assert.equal(harness.calls.activate, 1, label);
    assert.equal(harness.calls.prepare.length, 0, label);
    assert.equal(harness.calls.commit.length, 0, label);
    assert.deepEqual(harness.documentSession.snapshot, beforeDocument, label);
    assert.deepEqual(harness.versionSession.snapshot, beforeVersion, label);
    assert.deepEqual(harness.projectSession.context, beforeProject, label);
  }
});

test("activation remains read-only while project hydration is in flight", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  harness.projectWorkflow.projectHydrating = true;

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "VERSION_ACTIVATION_PROJECT_UNAVAILABLE");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("background activation never replaces the active Canvas", async () => {
  const harness = createHarness({ currentPath: SOURCE_B });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.calls.catalogAfterSettlement.length, 0);
});

test("openCommittedVersion does not clear background-document recovery for a same-project different-document result", async () => {
  const harness = createHarness();
  const locator = harness.projectSession.openLocator(SOURCE_A);
  harness.projectSession.register({
    ...locator,
    projectId: "project_a",
    documentId: "document_other",
    openTarget: {
      projectId: "project_a",
      documentId: "document_other",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: "work_ver_0001",
      versionId: "ver_0001",
      exactSourcePath: SOURCE_A,
      sourceSha256: sha256(BASE_HTML),
    },
  });
  const run = readyRun();
  const beforeDocument = harness.documentSession.snapshot;
  const beforeVersion = harness.versionSession.snapshot;
  const beforeComments = harness.commentSession.snapshot;
  const outcome = await harness.workflow.openCommittedVersion({
    run,
    payload: {
      ...run.readyPayload,
      ok: true,
      status: "version-activated",
      projectId: run.projectId,
      documentId: run.documentId,
      versionId: run.candidateVersionId,
      sourcePath: SOURCE_A,
      content: CANDIDATE_HTML,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      openTarget: promotedOpenTarget(run, {
        sourceSha256: sha256(CANDIDATE_HTML),
        versionId: run.candidateVersionId,
      }),
      version: versionRecord({ id: run.candidateVersionId }),
    },
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.calls.clearRecovery, 0);
  assert.equal(harness.calls.resetComments, 0);
  assert.deepEqual(harness.documentSession.snapshot, beforeDocument);
  assert.deepEqual(harness.versionSession.snapshot, beforeVersion);
  assert.deepEqual(harness.commentSession.snapshot, beforeComments);
});

test("openCommittedVersion rejects incomplete or mismatched OpenTarget before current classification", async () => {
  const cases = [
    ["null target", () => null],
    ["wrong document target", (target) => ({ ...target, documentId: "document_other" })],
    ["wrong version target", (target) => ({ ...target, versionId: "ver_0099" })],
  ];

  for (const [label, mutateTarget] of cases) {
    const harness = createHarness();
    const run = readyRun();
    const candidateSha256 = sha256(CANDIDATE_HTML);
    const beforeProject = harness.projectSession.context;
    const beforeDocument = harness.documentSession.snapshot;
    const beforeVersion = harness.versionSession.snapshot;
    const beforeComments = harness.commentSession.snapshot;
    const beforeRecovery = { ...harness.recoveryState };
    const outcome = await harness.workflow.openCommittedVersion({
      run,
      payload: {
        ...run.readyPayload,
        ok: true,
        status: "version-activated",
        projectId: run.projectId,
        documentId: run.documentId,
        versionId: run.candidateVersionId,
        sourcePath: SOURCE_A,
        content: CANDIDATE_HTML,
        contentSha256: candidateSha256,
        sourceSha256: candidateSha256,
        currentHtmlSha256: candidateSha256,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
        openTarget: mutateTarget(promotedOpenTarget(run, { sourceSha256: candidateSha256 })),
        version: versionRecord({ id: run.candidateVersionId }),
      },
    });

    assert.equal(outcome.status, "rejected", label);
    assert.equal(harness.calls.freeze, 0, label);
    assert.equal(harness.calls.clearRecovery, 0, label);
    assert.equal(harness.calls.prepare.length, 0, label);
    assert.equal(harness.calls.commit.length, 0, label);
    assert.deepEqual(harness.projectSession.context, beforeProject, label);
    assert.deepEqual(harness.documentSession.snapshot, beforeDocument, label);
    assert.deepEqual(harness.versionSession.snapshot, beforeVersion, label);
    assert.deepEqual(harness.commentSession.snapshot, beforeComments, label);
    assert.deepEqual(harness.recoveryState, beforeRecovery, label);
  }
});

test("Version to Project transition with the same project but another document stays publication-free", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.documentId = "document_other";
  run.readyPayload = {
    ...run.readyPayload,
    documentId: "document_other",
    candidate: { ...run.readyPayload.candidate, documentId: "document_other" },
    openTarget: { ...run.readyPayload.openTarget, documentId: "document_other" },
    version: { ...run.readyPayload.version, documentId: "document_other" },
    outcome: { ...run.readyPayload.outcome, documentId: "document_other" },
  };
  harness.runSession.trackRun(run, { activate: "always" });
  const beforeProject = harness.projectSession.context;
  const beforeDocument = harness.documentSession.snapshot;
  const beforeVersion = harness.versionSession.snapshot;
  const beforeComments = harness.commentSession.snapshot;

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.deepEqual(harness.projectSession.context, beforeProject);
  assert.deepEqual(harness.documentSession.snapshot, beforeDocument);
  assert.deepEqual(harness.versionSession.snapshot, beforeVersion);
  assert.deepEqual(harness.commentSession.snapshot, beforeComments);
});

test("activation reuses activation-response bytes without a Bridge read-back", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input),
      content: CANDIDATE_HTML,
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
});

test("activation rejects activation-response bytes whose hash does not match", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input),
      content: CANDIDATE_HTML.replace("candidate", "tampered"),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("a failed workspace refresh never blocks activation and reports through events", async () => {
  const harness = createHarness();
  const refreshDeferred = deferred();
  harness.projectWorkflow.refreshWorkspace = async (input) => {
    harness.calls.refresh.push(input);
    return refreshDeferred.promise;
  };
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.refreshWarning, undefined);
  assert.equal(harness.calls.refresh.length, 1);
  assert.equal(
    events.some((event) => event.type === "version-refresh-warning"),
    false,
  );

  refreshDeferred.resolve({ status: "blocked", reason: "复核未完成" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const warning = events.find((event) => event.type === "version-refresh-warning");
  assert.ok(warning);
  assert.equal(warning.reason, "复核未完成");
  assert.equal(warning.candidateLabel, "版本 2");
});

test("history preview never publishes historical bytes or renders the working Canvas", async () => {
  const harness = createHarness({ verifyRendered: async () => { throw new Error("must not render"); } });
  const before = harness.documentSession.snapshot;
  const outcome = await harness.workflow.viewHistory({ version: { id: "ver_0001", contentSha256: sha256(HISTORY_HTML) }, context: harness.context });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.historyPreview.content, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.render.length, 0);
});

test("failed history read retains persistence advanced by a successful drain", async () => {
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.publishAuthority({
        html: DRAINED_HTML,
        persistedSourceSha256: sha256(DRAINED_HTML),
        editRevision: 1,
        lastPersistedRevision: 1,
        persistState: "idle",
        persistError: "",
        pendingWrite: null,
      });
      return { ok: true };
    },
    versionRead: async () => { throw new Error("history read failed"); },
  });
  harness.documentSession.publishAuthority({
    html: DRAINED_HTML,
    persistedSourceSha256: sha256(BASE_HTML),
    editRevision: 1,
    lastPersistedRevision: 0,
    persistState: "writing",
    pendingWrite: {
      revision: 1,
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.length, 0);
});

test("history rollback retains persistence advanced before a later drain failure", async () => {
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.publishAuthority({
        html: DRAINED_HTML,
        persistedSourceSha256: sha256(DRAINED_HTML),
        editRevision: 1,
        lastPersistedRevision: 1,
        persistState: "idle",
        persistError: "",
        pendingWrite: null,
      });
      return { ok: false, reason: "draft persistence failed" };
    },
  });
  harness.documentSession.publishAuthority({
    html: DRAINED_HTML,
    persistedSourceSha256: sha256(BASE_HTML),
    editRevision: 1,
    lastPersistedRevision: 0,
    persistState: "writing",
    pendingWrite: {
      revision: 1,
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.length, 0);
});

test("failed history load leaves the current source and navigation exit available", async () => {
  const harness = createHarness({ versionRead: async () => ({ projectId: "other", documentId: "document_a", versionId: "ver_0001", content: HISTORY_HTML, sha256: sha256(HISTORY_HTML) }) });
  const outcome = await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.workflow.getSnapshot().navigation.phase, "idle");
  assert.equal((await harness.workflow.returnToCurrent({ context: harness.context })).status, "succeeded");
});

test("history continuation synchronously publishes the V2 Working Copy authority to every Session", async () => {
  const v2 = versionRecord({ id: "ver_0002", content: HISTORY_HTML });
  const v6 = versionRecord({ id: "ver_0006", content: CANDIDATE_HTML });
  const historyDraft = {
    draftRevision: 4,
    comments: [{ commentId: "comment_v2", text: "V2 draft comment", target: { targetId: "target_v2", selector: "body", tagName: "body", level: "module" } }],
    changeEvents: [{ eventId: "change_v2", kind: "text", createdAt: "2026-08-14T00:00:00.000Z", target: { targetId: "target_v2", selector: "body", tagName: "body", level: "module" }, before: "old", after: "new", basedOnVersionId: "ver_0002", revision: 1 }],
    deletedCommentIds: ["comment_deleted_v2"],
    appliedOperationIds: ["operation_v2"],
  };
  const harness = createHarness({
    onCatalogAfterSettlement: () => new Promise(() => {}),
    versionRead: async (sourcePath, versionId) => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId,
      content: versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML,
      sha256: sha256(versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML),
      sourcePath,
    }),
    continueHistory: async (input) => ({
      ok: true,
      status: "history-working-copy-activated",
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: HISTORY_WORKING_COPY_PATH,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        exactSourcePath: HISTORY_WORKING_COPY_PATH,
        sourceSha256: sha256(HISTORY_HTML),
      },
      currentHtmlSha256: sha256(HISTORY_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      latestVersionId: "ver_0006",
      versions: [v2, v6],
      content: HISTORY_HTML,
      lastModifiedAt: "2026-08-14T00:00:00.000Z",
      historyActivation: {
        operationId: input.operationId,
        projectId: "project_a",
        documentId: "document_a",
        previousWorkingCopyId: "work_ver_0006",
        activatedWorkingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        state: "desktop-pending",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      operationId: input.operationId,
      activeDraft: historyDraft,
    }),
  });
  harness.versionSession.hydrate({
    versions: decodedVersions([v2, v6]),
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });

  const viewed = await harness.workflow.viewHistory({
    version: decodedVersions([v2])[0],
    context: harness.context,
  });
  assert.equal(viewed.status, "succeeded");
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.historyPreview.content, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.latestVersionId, "ver_0006");

  const continued = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });
  assert.equal(continued.status, "succeeded");
  assert.equal(continued.value.workingCopyId, "work_ver_0002");
  assert.equal(harness.projectSession.context.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.projectSession.context.workingCopyId, "work_ver_0002");
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.latestVersionId, "ver_0006");
  assert.deepEqual(harness.commentSession.snapshot.comments, commentsFromRecords(historyDraft.comments));
  assert.deepEqual(harness.commentSession.snapshot.changeEvents, changesFromDraftRecords(historyDraft.changeEvents));
  assert.deepEqual(
    harness.commentSession.snapshot.deletedCommentIds,
    historyDraft.deletedCommentIds,
  );
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.draftAuthorities[0].draftRevision, historyDraft.draftRevision);
  assert.deepEqual(harness.calls.draftAuthorities[0].authority.comments, historyDraft.comments);
  assert.equal(harness.calls.continueHistory.length, 1);
  assert.equal(harness.calls.continueHistory[0].versionId, "ver_0002");
  assert.equal(harness.calls.prepare[0].openTarget.workingCopyId, "work_ver_0002");
  assert.equal(harness.calls.prepare[0].operationId, harness.calls.confirmHistory[0].operationId);
  assert.equal(harness.calls.confirmHistory.length, 1);
  assert.equal(harness.calls.render.at(-1)?.html, HISTORY_HTML);
  assert.deepEqual(harness.calls.order, ["confirm", "catalog"]);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
  assert.equal(harness.calls.catalogAfterSettlement[0].sourcePath, HISTORY_WORKING_COPY_PATH);
});

test("history continuation retries one lost Bridge response with the same receipt operation", async () => {
  const v2 = versionRecord({ id: "ver_0002", content: HISTORY_HTML });
  const v6 = versionRecord({ id: "ver_0006", content: CANDIDATE_HTML });
  let attempts = 0;
  const harness = createHarness({
    versionRead: async (_sourcePath, versionId) => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId,
      content: versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML,
      sha256: sha256(versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML),
    }),
    continueHistory: async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new BridgeRequestError("response lost", { outcome: "unknown" });
      }
      return {
        ok: true,
        status: "history-working-copy-activated",
        projectId: "project_a",
        documentId: "document_a",
        sourcePath: HISTORY_WORKING_COPY_PATH,
        openTarget: {
          projectId: "project_a",
          documentId: "document_a",
          projectRootPath: "/tmp/project-a",
          targetKind: "working-copy",
          workingCopyId: "work_ver_0002",
          versionId: "ver_0002",
          exactSourcePath: HISTORY_WORKING_COPY_PATH,
          sourceSha256: sha256(HISTORY_HTML),
        },
        currentHtmlSha256: sha256(HISTORY_HTML),
        currentBasedOnVersionId: "ver_0002",
        currentExactVersionId: "ver_0002",
        restoredFromVersionId: null,
        latestVersionId: "ver_0006",
        versions: [v2, v6],
        content: HISTORY_HTML,
        lastModifiedAt: "2026-08-14T00:00:00.000Z",
        historyActivation: {
          operationId: input.operationId,
          projectId: "project_a",
          documentId: "document_a",
          previousWorkingCopyId: "work_ver_0006",
          activatedWorkingCopyId: "work_ver_0002",
          versionId: "ver_0002",
          state: "desktop-pending",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
        operationId: input.operationId,
        activeDraft: {
          draftRevision: 0,
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
      };
    },
  });
  harness.versionSession.hydrate({
    versions: decodedVersions([v2, v6]),
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });
  assert.equal((await harness.workflow.viewHistory({ version: decodedVersions([v2])[0], context: harness.context })).status, "succeeded");

  const outcome = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.continueHistory.length, 2);
  assert.equal(
    harness.calls.continueHistory[0].operationId,
    harness.calls.continueHistory[1].operationId,
  );
  assert.equal(harness.calls.prepare[0].operationId, harness.calls.continueHistory[0].operationId);
  assert.equal(harness.calls.confirmHistory[0].operationId, harness.calls.continueHistory[0].operationId);
});

test("legacy history adopts a preseeded Repository receipt before later workspace validation", async () => {
  const receipt = {
    operationId: "history_preseed_x_0001",
    projectId: "project_a",
    documentId: "document_a",
    previousWorkingCopyId: "work_ver_0001",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0001",
    state: "desktop-pending",
    createdAt: "2026-08-14T00:00:00.000Z",
  };
  const calls = [];
  const responseFor = (operationId, malformed = false) => ({
    ok: true,
    status: "history-working-copy-activated",
    projectId: "project_a",
    documentId: "document_a",
    sourcePath: HISTORY_WORKING_COPY_PATH,
    operationId,
    historyActivation: { ...receipt, operationId },
    openTarget: {
      projectId: "project_a",
      documentId: "document_a",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: "work_ver_0002",
      versionId: "ver_0001",
      exactSourcePath: HISTORY_WORKING_COPY_PATH,
      sourceSha256: sha256(BASE_HTML),
    },
    currentHtmlSha256: sha256(BASE_HTML),
    currentBasedOnVersionId: "ver_0001",
    currentExactVersionId: "ver_0001",
    restoredFromVersionId: null,
    latestVersionId: "ver_0001",
    versions: malformed ? [] : [versionRecord({ id: "ver_0001", content: BASE_HTML })],
    content: BASE_HTML,
    lastModifiedAt: "2026-08-14T00:00:00.000Z",
    activeDraft: {
      draftRevision: 0,
      comments: [],
      changeEvents: [],
      deletedCommentIds: [],
      appliedOperationIds: [],
    },
  });
  const harness = createHarness({
    continueHistory: async (input) => {
      calls.push(input);
      return responseFor(receipt.operationId, calls.length === 1);
    },
  });
  harness.versionSession.enterHistory("ver_0001");
  const first = await harness.workflow.continueEditingHistoryVersion({ context: harness.context });
  assert.equal(first.status, "unknown");
  assert.equal(first.operationId, receipt.operationId);
  assert.equal(harness.calls.confirmHistory.length, 0);
  const second = await harness.workflow.continueEditingHistoryVersion({ context: harness.context });
  assert.equal(second.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].operationId, receipt.operationId);
  assert.equal(calls[1].operationId, receipt.operationId);
  assert.equal(harness.calls.confirmHistory.length, 1);
  assert.equal(harness.calls.confirmHistory[0].operationId, receipt.operationId);
});

test("history continuation keeps the V2 Working Copy active when Canvas validation fails", async () => {
  let failHistoryRender = false;
  const harness = createHarness({
    versionRead: async () => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId: "ver_0002",
      content: HISTORY_HTML,
      sha256: sha256(HISTORY_HTML),
    }),
    continueHistory: async (input) => ({
      ok: true,
      status: "history-working-copy-activated",
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: HISTORY_WORKING_COPY_PATH,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        exactSourcePath: HISTORY_WORKING_COPY_PATH,
        sourceSha256: sha256(HISTORY_HTML),
      },
      currentHtmlSha256: sha256(HISTORY_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      latestVersionId: "ver_0006",
      versions: [
        versionRecord({ id: "ver_0002", content: HISTORY_HTML }),
        versionRecord({ id: "ver_0006", content: CANDIDATE_HTML }),
      ],
      content: HISTORY_HTML,
      lastModifiedAt: "2026-08-14T00:00:00.000Z",
      historyActivation: {
        operationId: input.operationId,
        projectId: "project_a",
        documentId: "document_a",
        previousWorkingCopyId: "work_ver_0006",
        activatedWorkingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        state: "desktop-pending",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      operationId: input.operationId,
      activeDraft: {
        draftRevision: 0,
        comments: [],
        changeEvents: [],
        deletedCommentIds: [],
        appliedOperationIds: [],
      },
    }),
    verifyRendered: async (html) => {
      if (failHistoryRender && html === HISTORY_HTML) throw new Error("history canvas failed");
    },
  });
  harness.versionSession.hydrate({
    versions: decodedVersions([
      versionRecord({ id: "ver_0002", content: HISTORY_HTML }),
      versionRecord({ id: "ver_0006", content: CANDIDATE_HTML }),
    ]),
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });
  const viewed = await harness.workflow.viewHistory({
    version: { id: "ver_0002", contentSha256: sha256(HISTORY_HTML) },
    context: harness.context,
  });
  assert.equal(viewed.status, "succeeded");
  failHistoryRender = true;

  const outcome = await harness.workflow.continueEditingHistoryVersion({
    context: harness.context,
  });

  assert.equal(outcome.status, "unknown");
  assert.equal(harness.calls.confirmHistory.length, 1);
  assert.equal(harness.projectSession.context.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.documentSession.html, HISTORY_HTML);
});

test("legacy history retains one Repository receipt until local commit and never confirms a collision", async () => {
  let hostMutationCount = 0;
  let hostReceiptCommitted = false;
  let collision = true;
  let blockConfirmation = false;
  const confirmationGate = deferred();
  const v2 = versionRecord({ id: "ver_0002", content: HISTORY_HTML });
  const v6 = versionRecord({ id: "ver_0006", content: CANDIDATE_HTML });
  const historyResponse = (input) => {
    if (!hostReceiptCommitted) {
      hostReceiptCommitted = true;
      hostMutationCount += 1;
    }
    return {
      ok: true,
      status: "history-working-copy-activated",
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: HISTORY_WORKING_COPY_PATH,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        exactSourcePath: HISTORY_WORKING_COPY_PATH,
        sourceSha256: sha256(HISTORY_HTML),
      },
      currentHtmlSha256: sha256(HISTORY_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      latestVersionId: "ver_0006",
      versions: [v2, v6],
      content: HISTORY_HTML,
      lastModifiedAt: "2026-08-14T00:00:00.000Z",
      historyActivation: {
        operationId: input.operationId,
        projectId: "project_a",
        documentId: "document_a",
        previousWorkingCopyId: "work_ver_0006",
        activatedWorkingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        state: "desktop-pending",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      operationId: input.operationId,
      activeDraft: {
        draftRevision: 0,
        comments: [],
        changeEvents: [],
        deletedCommentIds: [],
        appliedOperationIds: [],
      },
    };
  };
  const harness = createHarness({
    versionRead: async (_sourcePath, versionId) => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId,
      content: versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML,
      sha256: sha256(versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML),
    }),
    continueHistory: async (input) => historyResponse(input),
    confirmHistory: async (input) => {
      if (blockConfirmation) return confirmationGate.promise;
      return {
        ok: true,
        status: "history-working-copy-desktop-confirmed",
        projectId: input.projectId,
        documentId: input.documentId,
        operationId: input.operationId,
        historyActivation: {
          operationId: input.operationId,
          projectId: input.projectId,
          documentId: input.documentId,
          previousWorkingCopyId: input.previousWorkingCopyId,
          activatedWorkingCopyId: input.activatedWorkingCopyId,
          versionId: input.versionId,
          state: "desktop-confirmed",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      };
    },
  });
  harness.versionSession.hydrate({
    versions: decodedVersions([v2, v6]),
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });
  assert.equal((await harness.workflow.viewHistory({
    version: decodedVersions([v2])[0],
    context: harness.context,
  })).status, "succeeded");

  const originalPrepare = harness.projectWorkflow.prepareManagedSourceTransition;
  harness.projectWorkflow.prepareManagedSourceTransition = async (input) => {
    if (collision) {
      harness.calls.prepare.push(input);
      return {
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        openTarget: input.openTarget,
        updatesCurrentProject: true,
        activatedProject: null,
      };
    }
    const prepared = await originalPrepare(input);
    return prepared;
  };

  const beforeDocument = harness.documentSession.snapshot;
  const beforeVersion = harness.versionSession.snapshot;
  const first = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });
  assert.equal(first.status, "unknown");
  assert.equal(harness.calls.confirmHistory.length, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(hostMutationCount, 1);
  assert.deepEqual(harness.documentSession.snapshot, beforeDocument);
  assert.deepEqual(harness.versionSession.snapshot, beforeVersion);

  collision = false;
  blockConfirmation = true;
  const secondAttempt = harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });
  for (let attempt = 0; attempt < 20 && harness.calls.confirmHistory.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(harness.calls.confirmHistory.length, 1);
  const changedContext = harness.projectSession.openLocator(SOURCE_B);
  harness.projectSession.register({
    ...changedContext,
    projectId: "project_b",
    documentId: "document_b",
  });
  harness.runSession.activate(SOURCE_B);
  harness.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  confirmationGate.resolve({
    ok: true,
    status: "history-working-copy-desktop-confirmed",
    projectId: "project_a",
    documentId: "document_a",
    operationId: harness.calls.confirmHistory[0].operationId,
    historyActivation: {
      operationId: harness.calls.confirmHistory[0].operationId,
      projectId: "project_a",
      documentId: "document_a",
      previousWorkingCopyId: "work_ver_0006",
      activatedWorkingCopyId: "work_ver_0002",
      versionId: "ver_0002",
      state: "desktop-confirmed",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  });
  const second = await secondAttempt;
  assert.equal(second.status, "unknown");
  assert.equal(hostMutationCount, 1);
  assert.equal(harness.calls.commit.length, 0);

  const restoredContext = harness.projectSession.openLocator(SOURCE_A);
  harness.projectSession.register({
    ...restoredContext,
    projectId: "project_a",
    documentId: "document_a",
  });
  harness.runSession.activate(SOURCE_A);
  harness.documentSession.publishAuthority({ html: BASE_HTML, persistedSourceSha256: sha256(BASE_HTML) });
  blockConfirmation = false;
  const third = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });
  assert.equal(third.status, "succeeded");
  assert.equal(hostMutationCount, 1);
  assert.equal(harness.calls.continueHistory.length, 3);
  assert.equal(new Set(harness.calls.continueHistory.map((input) => input.operationId)).size, 1);
  assert.equal(harness.calls.confirmHistory.length, 2);
  assert.equal(harness.calls.commit.length, 1);
});

test("return-current preserves working authority and checks external changes independently", async () => {
  const observation = deferred();
  let observedPath;
  const harness = createHarness({ observeExternalSourceChange: ({ sourcePath }) => {
    observedPath = sourcePath;
    return observation.promise;
  } });
  const before = harness.documentSession.snapshot;
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const outcome = await harness.workflow.returnToCurrent({ context: harness.context });
  assert.equal(outcome.status, "succeeded");
  assert.equal(observedPath, SOURCE_A);
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.calls.render.length, 0);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.historyPreview, null);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  observation.resolve({ status: "rejected", reason: "file unavailable" });
});

test("malformed committed history response remains unknown and preserves Session authority", async () => {
  const harness = createHarness({ continueHistory: async () => ({
    ok: true, status: "history-working-copy-activated", projectId: "project_a", documentId: "document_a",
    operationId: "history_malformed_receipt_0001",
    historyActivation: {
      operationId: "history_malformed_receipt_0001",
      projectId: "project_a",
      documentId: "document_a",
      previousWorkingCopyId: "work_ver_0001",
      activatedWorkingCopyId: "work_ver_0002",
      versionId: "ver_0001",
      state: "desktop-pending",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
    versions: [versionRecord({ id: "ver_0001" }), versionRecord({ id: "ver_0001" })],
  }) });
  harness.versionSession.enterHistory("ver_0001");
  const previous = harness.versionSession.snapshot;
  const project = harness.projectSession.context;
  const html = harness.documentSession.html;
  const outcome = await harness.workflow.continueEditingHistoryVersion({ context: project });
  assert.equal(outcome.status, "unknown");
  assert.equal(harness.versionSession.snapshot, previous);
  assert.equal(harness.projectSession.context.sourcePath, project.sourcePath);
  assert.equal(harness.documentSession.html, html);
  assert.equal(harness.calls.confirmHistory.length, 0);
});

test("a late historical read cannot publish into another project", async () => {
  const read = deferred();
  const harness = createHarness({ versionRead: () => read.promise });
  const pending = harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.projectSession.openLocator(SOURCE_B);
  harness.versionSession.reset();
  harness.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  read.resolve({ projectId: "project_a", documentId: "document_a", versionId: "ver_0001", content: HISTORY_HTML, sha256: sha256(HISTORY_HTML) });
  assert.equal((await pending).status, "stale");
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.versionSession.snapshot.historyPreview, null);
});

function historyCreatedResult(operationId) {
  return { status: "created", operationId, projectId: "project_a", documentId: "document_a",
    versionId: "ver_0002", versionOrdinal: 2, workingCopyId: "work_ver_0002", basedOnVersionId: "ver_0001",
    previousVersionId: "ver_0001", contentSha256: sha256(HISTORY_HTML), sourcePath: HISTORY_WORKING_COPY_PATH, openedAt: null, recoveryState: "pending" };
}

test("manual creation reconciles a lost receipt without repeating the command or publishing Document", async () => {
  const operationId = "history_create_lost_0001";
  const harness = createHarness({ createHistory: async () => { throw new Error("lost receipt"); },
    queryCreation: async () => historyCreatedResult(operationId) });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const before = harness.documentSession.snapshot;
  const result = await harness.workflow.createVersionFromHistory({ operationId, context: harness.context });
  assert.equal(result.status, "succeeded");
  assert.equal(result.value.versionId, "ver_0002");
  assert.equal(harness.calls.createHistory.length, 1);
  assert.equal(harness.calls.queryCreation.length, 1);
  assert.equal(harness.calls.queryCreation[0].operationId, operationId);
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "created");
});

test("unknown manual creation stays queryable with the same operation", async () => {
  const operationId = "history_create_unknown_0001";
  let available = false;
  const harness = createHarness({ createHistory: async () => { throw new Error("timeout"); }, queryCreation: async () => {
    if (!available) throw new Error("offline");
    return historyCreatedResult(operationId);
  } });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const result = await harness.workflow.createVersionFromHistory({ operationId, context: harness.context });
  assert.equal(result.status, "unknown");
  assert.equal(result.operationId, operationId);
  available = true;
  const queried = await harness.workflow.queryHistoryCreation({ operationId, context: harness.context });
  assert.equal(queried.status, "succeeded");
  assert.equal(harness.calls.createHistory.length, 1);
});

test("a delayed operation query cannot overwrite the next operation result", async () => {
  const delayed = deferred();
  const harness = createHarness({ queryCreation: ({ operationId }) => operationId === "history_old_0001"
    ? delayed.promise : Promise.resolve(historyCreatedResult(operationId)) });
  const old = harness.workflow.queryHistoryCreation({ operationId: "history_old_0001", context: harness.context });
  await harness.workflow.queryHistoryCreation({ operationId: "history_new_0001", context: harness.context });
  delayed.resolve(historyCreatedResult("history_old_0001"));
  await old;
  assert.equal(harness.workflow.getSnapshot().creation.operationId, "history_new_0001");
});

function createdWorkspace() {
  return { ok: true, projectId: "project_a", documentId: "document_a", sourcePath: HISTORY_WORKING_COPY_PATH,
    content: HISTORY_HTML, currentHtmlSha256: sha256(HISTORY_HTML), latestVersionId: "ver_0002",
    currentBasedOnVersionId: "ver_0002", currentExactVersionId: "ver_0002", restoredFromVersionId: null,
    versions: [versionRecord({ id: "ver_0001", content: HISTORY_HTML }), {
      ...versionRecord({ id: "ver_0002", content: HISTORY_HTML }), sourceType: "history-copy",
      sourceOperationId: "history_open_0001", sourceRequestId: null, sourceCandidateId: null,
      basedOnVersionId: "ver_0001", previousVersionId: "ver_0001", baseSnapshotSha256: sha256(HISTORY_HTML),
    }], activeDraft: { draftRevision: 0, comments: [], changeEvents: [] },
    openTarget: { targetKind: "working-copy", projectId: "project_a", documentId: "document_a",
      projectRootPath: "/tmp/project-a", versionId: "ver_0002", workingCopyId: "work_ver_0002",
      exactSourcePath: HISTORY_WORKING_COPY_PATH, sourceSha256: sha256(HISTORY_HTML) } };
}

test("created history opens through verified workspace and lost opened acknowledgement cannot recreate", async () => {
  const operationId = "history_open_0001";
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(), confirmCreation: async () => { throw new Error("lost acknowledgement"); } });
  const outcome = await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context });
  assert.equal(outcome.status, "succeeded", outcome.reason);
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(harness.calls.createHistory.length, 0);
  assert.equal(harness.calls.continueHistory.length, 0);
});

test("created history workspace failure keeps history usable and retries only opening", async () => {
  const operationId = "history_open_0001";
  let fail = true;
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId), workspaceRead: async () => {
    if (fail) throw new Error("load failed");
    return createdWorkspace();
  } });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const before = harness.documentSession.snapshot;
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).status, "rejected");
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "open-failed");
  assert.equal((await harness.workflow.createVersionFromHistory({ operationId: "history_duplicate_0001", context: harness.context })).status, "blocked");
  fail = false;
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).status, "succeeded");
  assert.equal(harness.calls.createHistory.length, 0);
});

test("created history late workspace never publishes across a project switch", async () => {
  const delayed = deferred();
  const harness = createHarness({ queryCreation: async () => historyCreatedResult("history_open_0001"), workspaceRead: () => delayed.promise });
  const opening = harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.projectSession.openLocator(SOURCE_B);
  harness.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  delayed.resolve(createdWorkspace());
  assert.equal((await opening).status, "stale");
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.calls.commit.length, 0);
});

test("restart restores an unacknowledged creation and leaves acknowledged operation quiet", async () => {
  let openedAt = null;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult("history_open_0001"), openedAt }) });
  await harness.workflow.restoreHistoryCreation({ operationId: "history_open_0001", context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "created");
  openedAt = "2026-09-08T00:00:00.000Z";
  await harness.workflow.restoreHistoryCreation({ operationId: "history_open_0001", context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(harness.calls.createHistory.length, 0);
});

test("return-current reconciles committed creation rather than re-exposing the old working file", async () => {
  const operationId = "history_open_0001";
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId), workspaceRead: async () => createdWorkspace() });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  await harness.workflow.queryHistoryCreation({ operationId, context: harness.context });
  assert.equal((await harness.workflow.returnToCurrent({ context: harness.context })).status, "succeeded");
  assert.equal(harness.projectSession.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.calls.createHistory.length, 0);
});


test("a lost opened acknowledgement followed by a later Version cannot resurrect the old recovery action", async () => {
  const operationId = "history_open_0001";
  let workspaceReads = 0;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult(operationId), recoveryState: "superseded" }),
    workspaceRead: async () => { workspaceReads += 1; return createdWorkspace(); } });
  await harness.workflow.restoreHistoryCreation({ operationId, context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "superseded");
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).code, "HISTORY_CREATION_SUPERSEDED");
  assert.equal(workspaceReads, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
});

test("later iteration while reading the created workspace stops publication", async () => {
  let queries = 0;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult("history_open_0001"),
    recoveryState: ++queries > 1 ? "superseded" : "pending" }), workspaceRead: async () => createdWorkspace() });
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context })).code, "HISTORY_CREATION_SUPERSEDED");
  assert.equal(harness.calls.prepare.length, 0);
  assert.equal(harness.calls.commit.length, 0);
});


test("repairing an opened acknowledgement verifies current Canvas without reopening its workspace", async () => {
  let reads = 0;
  let acknowledgements = 0;
  const harness = createHarness({ queryCreation: async () => historyCreatedResult("history_open_0001"),
    workspaceRead: async () => { reads += 1; return createdWorkspace(); },
    confirmCreation: async () => { acknowledgements += 1; throw new Error("lost acknowledgement"); } });
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context })).status, "succeeded");
  const commits = harness.calls.commit.length;
  await harness.workflow.restoreHistoryCreation({ operationId: "history_open_0001", context: harness.projectSession.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(reads, 1);
  assert.equal(harness.calls.commit.length, commits);
  assert.equal(acknowledgements, 2);
});


test("adoption refuses mutation when newer draft comments cannot drain", async () => {
  const harness = createHarness({ onDrain: async () => ({ ok: false, reason: "Draft save failed" }) });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.code, "ADOPTION_DRAFT_NOT_SAVED");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.runSession.activeRun.status, "ready-to-open");
});


test("lost adoption reply reconciles the same Candidate decision without a new operation", async () => {
  let count = 0;
  const harness = createHarness({ activation: async (input) => {
    if (++count === 1) throw new BridgeRequestError("response lost", { outcome: "unknown" });
    const version = versionRecord({ id: input.versionId });
    return { ...input, contentSha256: version.contentSha256, sourceSha256: version.contentSha256,
      currentHtmlSha256: version.contentSha256, sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }), version };
  } });
  const run = readyRun({ candidateId: "candidate_synthetic" });
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.activate, 2);
  assert.deepEqual(harness.calls.activateInputs[0], harness.calls.activateInputs[1]);
  assert.equal(harness.calls.activateInputs[0].decisionOperationId, "promote_candidate_synthetic");
  assert.equal(harness.calls.prepare[0].operationId, "promote_candidate_synthetic");
  assert.equal(harness.calls.commit.length, 1);
});

test("two lost adoption replies retain one decision and automatically reconcile without a second user action", async (t) => {
  let replies = 0;
  const harness = createHarness({ activation: async (input) => {
    replies += 1;
    if (replies <= 2) throw new BridgeRequestError("lost committed reply", { outcome: "unknown" });
    const version = versionRecord({ id: input.versionId });
    return { projectId: input.projectId, documentId: input.documentId,
      requestId: input.requestId, attemptId: input.attemptId, versionId: input.versionId,
      contentSha256: version.contentSha256, sourceSha256: version.contentSha256,
      currentHtmlSha256: version.contentSha256, sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }),
      candidateDisplayVersionLabel: "版本 2", version };
  } });
  t.after(() => harness.workflow.dispose());
  const run = readyRun({ candidateId: "candidate_adoption_recovery" });
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.status, "unknown");
  assert.equal(harness.runSession.activeRun.adoptionPhase, "unknown");
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), true);
  assert.equal(harness.workflow.getSnapshot().navigation.phase, "idle");
  assert.equal((await harness.workflow.activateReadyVersion({ run })).code, "VERSION_ACTIVATION_BUSY");
  assert.equal(harness.calls.activate, 2);
  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.equal(harness.runSession.activeRun.status, "complete");
  assert.equal(harness.calls.activate, 3);
  assert.deepEqual(harness.calls.activateInputs, Array(3).fill(harness.calls.activateInputs[0]));
  assert.equal(harness.calls.activateInputs[0].decisionOperationId, "promote_candidate_adoption_recovery");
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), false);
});
