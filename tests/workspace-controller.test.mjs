import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ConversationSession } from "../app/application/conversation-session.js";
import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DraftSession } from "../app/application/draft-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import {
  WorkspaceController,
  registrationContextFromOutcome,
} from "../app/application/workspace-controller.js";

const SOURCE_PATH = "/tmp/workspace-controller.html";
const NEXT_SOURCE_PATH = "/tmp/workspace-controller-next.html";

test("Qoder compatibility actions stay pinned to the Qoder workflow", () => {
  const source = readFileSync(
    new URL("../app/application/workspace-controller.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /refreshQoderAvailability\(\) \{\s+return this\.#requireRunWorkflow\(\)\.refreshQoderAvailability\(\);\s+\}/u,
  );
  assert.match(
    source,
    /checkQoderUsability\(\) \{\s+return this\.#requireRunWorkflow\(\)\.checkQoderUsability\(\);\s+\}/u,
  );
  assert.match(
    source,
    /copyQoderGuidance\(input\) \{\s+return this\.#requireRunWorkflow\(\)\.copyQoderGuidance\(input\);\s+\}/u,
  );
  assert.match(
    source,
    /installQoder\(\) \{\s+return this\.#requireRunWorkflow\(\)\.installQoder\(\);\s+\}/u,
  );
  assert.match(
    source,
    /planRunSubmission\(\) \{\s+return this\.#requireRunWorkflow\(\)\.planSubmission\(\);\s+\}/u,
  );
});

test("workspace close freezes navigation but keeps tab layout persistence best-effort", () => {
  const source = readFileSync(
    new URL("../app/application/workspace-controller.js", import.meta.url),
    "utf8",
  );
  const beginClose = source.indexOf("navigation.beginClose({ requestId })");
  const firstAwait = source.indexOf("await navigation.prepareClose(input)", beginClose);
  assert.ok(beginClose >= 0);
  assert.ok(firstAwait > beginClose);
  const prepareCloseBody = source.slice(
    beginClose,
    source.indexOf("abortClose(input)", beginClose),
  );
  assert.doesNotMatch(prepareCloseBody, /pinCloseRevision\(\)/u);
  assert.doesNotMatch(prepareCloseBody, /workbenchTabsPersistenceCoordinator\?\.drain/u);
  assert.doesNotMatch(prepareCloseBody, /acknowledgedRevision/u);
  assert.match(source, /navigation\.commitClose\(\{ requestId \}\)/u);
  assert.match(source, /releaseCloseRevision\(\)/u);
  assert.match(
    source,
    /abortClose\(input\) \{\s+this\.#workbenchNavigationWorkflow\?\.abortClose\(input\)/u,
  );
});

function sha256(html) {
  return `sha256:${createHash("sha256").update(html).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const codecs = {
  projectVersionSummariesFromVersions: (versions) => versions,
  projectVersionSummariesFromWorkspace: (payload) => payload.versions,
  commentsFromRecords: (value) => Array.isArray(value) ? value : [],
  changesFromDraftRecords: (value) => Array.isArray(value) ? value : [],
  isRecord,
  sameSourcePath: (left, right) => Boolean(left && right && left === right),
  draftAuthorityFromWorkspace: (payload) => (
    isRecord(payload.runtimeState) && isRecord(payload.runtimeState.draft)
      ? payload.runtimeState.draft
      : isRecord(payload.activeDraft) ? payload.activeDraft : {}
  ),
  authoritativeDraftRevision: (draft) => Number(draft.draftRevision || 0),
  recoveryIdentityFromRecord: (value) => value || null,
  versionsFromWorkspace: (payload) => Array.isArray(payload.versions)
    ? payload.versions
    : [],
  rebindTargetsPreservingGlobal: (_html, targets) => targets.map((target) => ({
    ...target,
    selector: `${target.selector}[data-rebound]`,
  })),
};

const documentWorkflowCodecs = {
  isRecord,
  sameSourcePath: (left, right) => Boolean(left && right && left === right),
  persistedChangeEvent: (value) => value,
  recoveryIdentityFromRecord: (value) => value || null,
  sourceHistoryOperationsFromRecord: (value) => Array.isArray(value) ? value : [],
  changesFromRecords: (value) => Array.isArray(value) ? value : [],
  historyTextSelectionFromRecord: (value) => value || null,
  selectionFromRecord: (value) => value || null,
  rebindTargetsPreservingGlobal: (_html, targets) => targets,
  rebindTargetsAcrossHistoryPreservingGlobal: (_before, _after, targets) => targets,
  canLocateTarget: () => true,
  appendDirectEditEvent: ({ events = [], pendingEvents = [] }) => ({
    events,
    pendingEvents,
  }),
  auditEventKey: (value) => String(value?.eventId || ""),
  removeAcknowledgedAuditEvents: (events) => events,
  errorMessage: (cause, fallback) => String(cause?.message || fallback),
};

function authoritativeDraft(revision = 0) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
  };
}

function registrationPayload({
  sourcePath = SOURCE_PATH,
  projectId = "project_registration",
  documentId = "document_registration",
  html = "<main>canonical source</main>",
  draft = authoritativeDraft(4),
  openTarget = null,
  workingCopyRecovered = false,
} = {}) {
  const sourceSha256 = sha256(html);
  return {
    ok: true,
    projectId,
    documentId,
    sourcePath,
    currentHtmlSha256: sourceSha256,
    content: html,
    project: { displayName: "Canonical project" },
    paths: { projectRecords: "/tmp/PageRoot/project_registration" },
    versions: [{ id: "V1" }],
    runtimeState: { draft },
    recoveryIdentity: { token: "recovery_identity" },
    ...(openTarget ? { openTarget } : {}),
    ...(workingCopyRecovered ? { workingCopyRecovered: true } : {}),
  };
}

function createHarness({
  html = "<main>local source</main>",
  bridgeClient = null,
  projectSource = null,
  projectRulesWorkflow: projectRulesWorkflowConfig = null,
  editRuntimePort = null,
  initialDocument = null,
  conversationSession = null,
  controllerCodecs = codecs,
  versionSession: providedVersionSession = null,
  sourceHistorySession: providedSourceHistorySession = null,
  recoveryPort = null,
  canvasPort = null,
  documentWorkflow: documentWorkflowConfig = null,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const documentSession = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
  });
  if (initialDocument) documentSession.update(initialDocument);
  const client = bridgeClient || {
    async ensureProject() {
      return registrationPayload();
    },
    async workspace() {
      return registrationPayload();
    },
    async saveDraft() {
      return {};
    },
  };
  const commentSession = new CommentSession();
  const draftSession = new DraftSession({ bridgeClient: client });
  const versionSession = providedVersionSession || new VersionSession();
  const sourceHistorySession = providedSourceHistorySession || new SourceHistorySession();
  const recovery = [];
  let canvasInvalidations = 0;
  const events = [];
  const controller = new WorkspaceController({
    bridgeClient: client,
    conversationSession,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    codecs: controllerCodecs,
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      recovery: recoveryPort || { replace: (identity) => recovery.push(identity) },
      canvas: canvasPort || { invalidateRenderAcks: () => { canvasInvalidations += 1; } },
      ...(projectSource ? { projectSource } : {}),
      ...(editRuntimePort ? { editRuntime: editRuntimePort } : {}),
    },
    ...(projectRulesWorkflowConfig
      ? { projectRulesWorkflow: projectRulesWorkflowConfig }
      : {}),
    ...(documentWorkflowConfig
      ? { documentWorkflow: documentWorkflowConfig }
      : {}),
    clock: { now: () => 1_726_000_000_000 },
  });
  controller.subscribeEvents((event) => events.push(event));
  return {
    controller,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    runSession: projectRulesWorkflowConfig?.runSession || null,
    recovery,
    events,
    client,
    get canvasInvalidations() {
      return canvasInvalidations;
    },
  };
}

async function settleAsyncRuntime() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("shell publishes queued document history as busy until the terminal action settles", async (t) => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const writes = [];
  let releaseUndo;
  let releaseRedo;
  const harness = createHarness({
    html: before,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({ html: before });
      },
      async workspace() {
        return registrationPayload({ html: before });
      },
      async autosave(input) {
        writes.push(input);
        if (writes.length === 2) {
          await new Promise((resolve) => { releaseUndo = resolve; });
        } else if (writes.length === 3) {
          await new Promise((resolve) => { releaseRedo = resolve; });
        }
        return {
          ok: true,
          content: input.html,
          sha256: sha256(input.html),
          persistedRevision: input.editRevision,
          lastModifiedAt: "2026-09-13T00:00:00.000Z",
        };
      },
      async source() {
        return {
          content: after,
          sha256: sha256(after),
          lastModifiedAt: "2026-09-13T00:00:00.000Z",
        };
      },
      async resolveConflict() {
        return {};
      },
      async saveDraft() {
        return {};
      },
    },
    documentWorkflow: {
      codecs: documentWorkflowCodecs,
      scheduler: {
        setTimeout: () => 1,
        clearTimeout() {},
      },
    },
  });
  t.after(() => harness.controller.dispose());
  const context = harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_PATH,
    projectId: "project_history_shell",
    documentId: "document_history_shell",
  });
  harness.documentSession.publishAuthority({
    html: before,
    persistedSourceSha256: sha256(before),
    workingHtmlSha256: sha256(before),
    context,
    operationId: "history-shell-initial-authority",
  });
  harness.sourceHistorySession.activate(context, sha256(before), null);
  const startOffset = before.indexOf("one");
  assert.equal(harness.controller.enqueueDocumentEdit({
    html: after,
    context,
    sourceTransaction: {
      operationId: "sourceop_history_shell_001",
      kind: "text",
      editRevision: 1,
      createdAt: "2026-09-13T00:00:00.000Z",
      beforeSourceSha256: sha256(before),
      afterSourceSha256: sha256(after),
      forwardPatches: [{
        startOffset,
        endOffset: startOffset + 3,
        before: "one",
        after: "two",
        kind: "text",
      }],
      reversePatches: [{
        startOffset,
        endOffset: startOffset + 3,
        before: "two",
        after: "one",
        kind: "inverse:text",
      }],
      beforeTarget: { id: "target-history-shell", text: "one", resolution: "exact" },
      afterTarget: { id: "target-history-shell", text: "two", resolution: "exact" },
    },
  }).status, "succeeded");
  assert.equal((await harness.controller.flushDocument()).status, "succeeded");

  const observed = [harness.controller.shell.getSnapshot().hasDocumentHistoryAction];
  const unsubscribe = harness.controller.shell.subscribe(() => {
    observed.push(harness.controller.shell.getSnapshot().hasDocumentHistoryAction);
  });
  t.after(unsubscribe);
  const undo = harness.controller.performDocumentHistoryAction({ direction: "undo", context });
  assert.equal(harness.controller.shell.getSnapshot().hasDocumentHistoryAction, true);
  while (!releaseUndo) await new Promise((resolve) => setImmediate(resolve));
  const redo = harness.controller.performDocumentHistoryAction({ direction: "redo", context });
  releaseUndo();
  assert.equal((await undo).status, "succeeded");
  while (!releaseRedo) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.controller.shell.getSnapshot().hasDocumentHistoryAction, true);
  assert.equal(observed.slice(observed.indexOf(true)).includes(false), false);
  releaseRedo();
  assert.equal((await redo).status, "succeeded");
  await settleAsyncRuntime();
  assert.equal(harness.controller.shell.getSnapshot().hasDocumentHistoryAction, false);
  assert.equal(observed.at(-1), false);
});

function createProjectRulesHarness() {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const context = projectSession.register({
    epoch: 1,
    projectId: "project_rules_controller",
    documentId: "document_rules_controller",
    sourcePath: SOURCE_PATH,
  });
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const documentSession = new DocumentSession({
    html: "<main>local source</main>",
    persistedSourceSha256: sha256("<main>local source</main>"),
  });
  const commentSession = new CommentSession();
  let persisted = "# Original rules";
  const client = {
    async ensureProject() {
      return registrationPayload();
    },
    async workspace() {
      return registrationPayload();
    },
    async saveDraft() {
      return {};
    },
    async projectFile(sourcePath, relativePath) {
      assert.equal(sourcePath, SOURCE_PATH);
      assert.equal(relativePath, "PROJECT.md");
      return { content: persisted };
    },
    async updateProjectFile(payload) {
      persisted = payload.content;
      return {};
    },
  };
  const controller = new WorkspaceController({
    bridgeClient: client,
    projectSession,
    documentSession,
    commentSession,
    draftSession: new DraftSession({ bridgeClient: client }),
    versionSession: new VersionSession(),
    sourceHistorySession: new SourceHistorySession(),
    codecs,
    ports: {
      hash: { sha256: async (value) => sha256(value) },
    },
    projectRulesWorkflow: {
      runSession,
      scheduler: {
        setTimeout: () => 1,
        clearTimeout() {},
      },
      presentation: {
        restoreEditor({ settle }) {
          settle();
        },
      },
    },
    clock: { now: () => 1_726_000_000_000 },
  });
  return { context, controller, runSession, commentSession, documentSession, projectSession, get persisted() { return persisted; } };
}

test("workspace controller accepts its injected test Session set and publishes canonical authority", async () => {
  const harness = createHarness();
  harness.commentSession.update({
    comments: [{
      commentId: "comment_1",
      sourceAnchor: { id: "target_1", selector: "main" },
    }],
    composerTarget: { id: "target_2", selector: "main > p" },
  });

  const outcome = await harness.controller.ensureRegistered();
  const context = registrationContextFromOutcome(outcome);

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(context, {
    epoch: 1,
    projectId: "project_registration",
    documentId: "document_registration",
    sourcePath: SOURCE_PATH,
  });
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.documentSession.html, "<main>canonical source</main>");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256("<main>canonical source</main>"));
  assert.equal(harness.versionSession.snapshot.versions[0].id, "V1");
  assert.equal(harness.draftSession.isActive(context), true);
  assert.equal(harness.sourceHistorySession.isActive(context), true);
  assert.equal(harness.commentSession.comments[0].sourceAnchor.selector, "main[data-rebound]");
  assert.equal(
    harness.commentSession.composerTarget.selector,
    "main > p[data-rebound]",
  );
  assert.equal(harness.recovery.length, 1);
  assert.equal(harness.canvasInvalidations, 1);
  assert.deepEqual(harness.events, [{
    type: "registration-published",
    context,
    projectName: "Canonical project",
    canonicalSourceAdopted: true,
  }]);
});

test("workspace controller publishes one recovered Working Copy signal from Bridge authority", async () => {
  const harness = createHarness({
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({ workingCopyRecovered: true });
      },
      async workspace() {
        return registrationPayload({ workingCopyRecovered: true });
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
  });

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, "registration-published");
  assert.equal(harness.events[0].workingCopyRecovered, true);
});

test("managed registration activates the exact V1 Working Copy before publishing Sessions", async (t) => {
  const workingCopyPath = "/tmp/PageRoot/项目/managed/managed-V1.html";
  const managedHtml = "<main>managed V1 source</main>";
  const target = {
    projectId: "project_managed",
    documentId: "document_managed",
    projectRootPath: "/tmp/PageRoot/项目/managed",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: workingCopyPath,
    sourceSha256: sha256(managedHtml),
  };
  const calls = [];
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const harness = createHarness({
    html: managedHtml,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({
          sourcePath: workingCopyPath,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        return registrationPayload({
          sourcePath: workingCopyPath,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        return {
          operationId: input.operationId,
          sourcePath: workingCopyPath,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  const aggregateSnapshots = [];
  const unsubscribe = harness.controller.subscribe((snapshot) => {
    if (snapshot.projectSession?.sourcePath === workingCopyPath) {
      aggregateSnapshots.push(snapshot);
    }
  });
  t.after(unsubscribe);

  const beforeGeneration = harness.documentSession.canvasGeneration;
  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(harness.canvasInvalidations, 1);
  assert.equal(harness.projectSession.context?.sourcePath, workingCopyPath);
  assert.equal(harness.projectSession.context?.workingCopyId, "work_ver_0001");
  assert.equal(harness.documentSession.sourceReceipt.context.projectId, outcome.value.projectId);
  assert.equal(harness.documentSession.sourceReceipt.context.documentId, outcome.value.documentId);
  assert.equal(harness.documentSession.sourceReceipt.context.sourcePath, outcome.value.sourcePath);
  assert.equal(harness.documentSession.sourceReceipt.context.workingCopyId, outcome.value.workingCopyId);
  assert.equal(
    harness.documentSession.sourceReceipt.operationId,
    "workspace-register-authority",
  );
  assert.ok(aggregateSnapshots.length >= 1);
  for (const snapshot of aggregateSnapshots) {
    assert.equal(
      snapshot.projectSession.sourcePath,
      snapshot.runSession.activeSourcePath,
    );
    assert.equal(
      snapshot.document.sourceReceipt.context.sourcePath,
      snapshot.projectSession.sourcePath,
    );
    assert.equal(
      snapshot.document.sourceReceipt.context.sourcePath,
      snapshot.runSession.activeSourcePath,
    );
    assert.equal(snapshot.document.canvasGeneration, beforeGeneration + 1);
    assert.equal(
      snapshot.document.sourceReceipt.operationId,
      "workspace-register-authority",
    );
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].operationId, /^registration_/u);
  const activationCall = Object.fromEntries(
    Object.entries(calls[0]).filter(([key]) => key !== "operationId"),
  );
  assert.deepEqual(activationCall, {
    previousSourcePath: SOURCE_PATH,
    nextSourcePath: workingCopyPath,
    expectedSha256: sha256(managedHtml),
    projectId: "project_managed",
    documentId: "document_managed",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    projectRootPath: "/tmp/PageRoot/项目/managed",
  });
});

test("managed registration resumes a post-commit publication under the same operation", async (t) => {
  class FailOnceVersionSession extends VersionSession {
    attempts = 0;

    hydrate(input) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected version publication failure");
      return super.hydrate(input);
    }
  }

  const managedHtml = "<main>managed continuation</main>";
  const target = {
    projectId: "project_registration_continuation",
    documentId: "document_registration_continuation",
    projectRootPath: "/tmp/PageRoot/项目/registration-continuation",
    targetKind: "working-copy",
    workingCopyId: "work_registration_continuation",
    versionId: "ver_registration_continuation",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };
  const versionSession = new FailOnceVersionSession();
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  let ensureCalls = 0;
  const activationCalls = [];
  const harness = createHarness({
    html: managedHtml,
    versionSession,
    bridgeClient: {
      async ensureProject() {
        ensureCalls += 1;
        return registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        throw new Error("continuation must not use the Draft-only recovery path");
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        activationCalls.push(input);
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());
  const beforeGeneration = harness.documentSession.canvasGeneration;

  const first = await harness.controller.ensureRegistered();

  assert.equal(first.status, "unknown");
  assert.equal(first.operationId, activationCalls[0].operationId);
  assert.equal(ensureCalls, 1);
  assert.equal(activationCalls.length, 1);
  assert.equal(versionSession.attempts, 1);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(
    harness.controller.getSnapshot().projectSession.sourcePath,
    SOURCE_PATH,
    "an incomplete core tuple must stay behind the aggregate publication fence",
  );
  assert.equal(
    harness.controller.getSnapshot().document.sourceReceipt?.context?.sourcePath
      || null,
    null,
  );

  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(ensureCalls, 1);
  assert.equal(activationCalls.length, 1);
  assert.equal(versionSession.attempts, 2);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(harness.events.filter((event) => event.type === "registration-published").length, 1);
  assert.equal(harness.projectSession.context?.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(runSession.snapshot.activeSourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.documentSession.sourceReceipt.context.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.controller.getSnapshot().projectSession.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.controller.getSnapshot().versionSession.versions[0].id, "V1");
});

test("first autosave resumes registration before persisting a later same-document edit", async (t) => {
  class FailOnceVersionSession extends VersionSession {
    attempts = 0;

    hydrate(input) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected version publication failure");
      return super.hydrate(input);
    }
  }

  const originalHtml = "<main>managed original</main>";
  const firstEditHtml = "<main>managed first edit</main>";
  const latestHtml = "<main>managed latest edit</main>";
  const target = {
    projectId: "project_registration_autosave",
    documentId: "document_registration_autosave",
    projectRootPath: "/tmp/PageRoot/项目/registration-autosave",
    targetKind: "working-copy",
    workingCopyId: "work_registration_autosave",
    versionId: "ver_registration_autosave",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(originalHtml),
  };
  const sourceTransaction = (before, after) => ({
    kind: "setText",
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [],
    reversePatches: [],
    beforeTarget: { id: "target_registration_autosave" },
    afterTarget: { id: "target_registration_autosave" },
  });
  const versionSession = new FailOnceVersionSession();
  let ensureCalls = 0;
  let workspaceCalls = 0;
  let activationCalls = 0;
  const autosaves = [];
  const bridgeClient = {
    async ensureProject() {
      ensureCalls += 1;
      return {
        ...registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: originalHtml,
          openTarget: target,
        }),
        currentBasedOnVersionId: "V1",
        currentExactVersionId: "V1",
        latestVersionId: "V1",
      };
    },
    async workspace() {
      workspaceCalls += 1;
      throw new Error("continuation must not use the Draft-only recovery path");
    },
    async autosave(input) {
      autosaves.push(input);
      const sourceSha256 = sha256(input.html);
      return {
        ok: true,
        content: input.html,
        sha256: sourceSha256,
        currentHtmlSha256: sourceSha256,
        persistedRevision: input.editRevision,
        lastModifiedAt: "2026-09-13T00:00:00.000Z",
        lastSavedAt: "2026-09-13T00:00:00.000Z",
        currentExactVersionId: null,
        recoveryIdentity: { token: "recovery_after_autosave" },
        openTarget: { ...target, sourceSha256 },
      };
    },
    async source() {
      return {
        content: latestHtml,
        sha256: sha256(latestHtml),
        lastModifiedAt: "2026-09-13T00:00:00.000Z",
      };
    },
    async resolveConflict() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({
    html: originalHtml,
    bridgeClient,
    versionSession,
    documentWorkflow: {
      codecs: documentWorkflowCodecs,
      scheduler: {
        setTimeout: () => 1,
        clearTimeout() {},
      },
    },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        activationCalls += 1;
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(originalHtml),
          html: originalHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());

  assert.equal(harness.controller.enqueueDocumentEdit({
    html: firstEditHtml,
    sourceTransaction: sourceTransaction(originalHtml, firstEditHtml),
  }).status, "succeeded");
  const first = await harness.controller.flushDocument({ throughRevision: 1 });

  assert.equal(first.status, "unknown");
  assert.equal(ensureCalls, 1);
  assert.equal(activationCalls, 1);
  assert.equal(versionSession.attempts, 1);
  assert.equal(harness.documentSession.pendingWrite?.revision, 1);
  assert.equal(harness.documentSession.pendingWrite?.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.sourceHistorySession.isActive(harness.projectSession.context), true);

  harness.commentSession.update({
    comments: [{
      commentId: "comment_registration_autosave",
      sourceAnchor: { id: "target_registration_autosave", selector: "main" },
    }],
    composerTarget: { id: "target_registration_autosave", selector: "main" },
  });
  assert.equal(harness.controller.enqueueDocumentEdit({
    html: latestHtml,
    sourceTransaction: sourceTransaction(firstEditHtml, latestHtml),
    context: harness.controller.getCurrentProjectContext(),
  }).status, "succeeded");

  const saved = await harness.controller.flushDocument({ throughRevision: 2 });

  assert.equal(saved.status, "succeeded", JSON.stringify(saved));
  assert.equal(ensureCalls, 1);
  assert.equal(workspaceCalls, 0);
  assert.equal(activationCalls, 1);
  assert.equal(versionSession.attempts, 2);
  assert.equal(autosaves.length, 1);
  assert.equal(autosaves[0].html, latestHtml);
  assert.equal(autosaves[0].sourceHistoryOperations.length, 2);
  assert.equal(harness.documentSession.html, latestHtml);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(latestHtml));
  assert.equal(harness.documentSession.workingHtmlSha256, sha256(latestHtml));
  assert.equal(harness.documentSession.lastPersistedRevision, 2);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.projectSession.context.sourceSha256, sha256(latestHtml));
  assert.equal(
    harness.documentSession.sourceReceipt.sourceSha256,
    sha256(latestHtml),
  );
  assert.equal(harness.draftSession.isActive(harness.projectSession.context), true);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, null);
  assert.equal(harness.sourceHistorySession.capabilities.sourceSha256, sha256(latestHtml));
  assert.equal(harness.sourceHistorySession.capabilities.canUndo, true);
  assert.equal(
    harness.commentSession.comments[0].commentId,
    "comment_registration_autosave",
  );
  assert.equal(
    harness.events.filter((event) => event.type === "registration-published").length,
    1,
  );
  assert.equal((await harness.controller.ensureRegistered()).status, "succeeded");
  assert.equal(workspaceCalls, 0);
});

test("registration rejects a stale-frame edit and rebinds late comments to canonical HTML", async (t) => {
  class FailOnceVersionSession extends VersionSession {
    attempts = 0;

    hydrate(input) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected canonical publication failure");
      return super.hydrate(input);
    }
  }

  const versionSession = new FailOnceVersionSession();
  const harness = createHarness({
    html: "<main>stale presented source</main>",
    versionSession,
  });
  t.after(() => harness.controller.dispose());

  const first = await harness.controller.ensureRegistered();
  assert.equal(first.status, "unknown");
  assert.equal(
    harness.documentSession.html,
    "<main>canonical source</main>",
  );

  harness.commentSession.update({
    comments: [{
      commentId: "comment_after_canonical_registration",
      sourceAnchor: { id: "target_after_canonical_registration", selector: "main" },
    }],
    composerTarget: {
      id: "target_after_canonical_registration",
      selector: "main",
    },
  });
  const staleEdit = harness.controller.enqueueDocumentEdit({
    html: "<main>stale frame edit</main>",
    context: harness.controller.getCurrentProjectContext(),
  });
  assert.equal(staleEdit.status, "blocked");
  assert.equal(staleEdit.code, "PROJECT_REGISTRATION_RECONCILIATION_REQUIRED");
  assert.equal(
    harness.documentSession.html,
    "<main>canonical source</main>",
  );

  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(versionSession.attempts, 2);
  assert.equal(
    harness.commentSession.comments[0].sourceAnchor.selector,
    "main[data-rebound]",
  );
  assert.equal(
    harness.commentSession.composerTarget.selector,
    "main[data-rebound]",
  );
  assert.equal(
    harness.events.filter((event) => event.type === "registration-published").length,
    1,
  );
});

test("registration keeps the stale-frame fence through SourceHistory publication", async (t) => {
  class FailOnceSourceHistorySession extends SourceHistorySession {
    attempts = 0;

    activate(...args) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected source history publication failure");
      return super.activate(...args);
    }
  }

  const presentedHtml = "<main>stale source-history frame</main>";
  const canonicalHtml = "<main>canonical source</main>";
  const staleEditedHtml = "<main>stale source-history edit</main>";
  const staleTransaction = {
    kind: "setText",
    beforeSourceSha256: sha256(presentedHtml),
    afterSourceSha256: sha256(staleEditedHtml),
    forwardPatches: [],
    reversePatches: [],
    beforeTarget: { id: "target_stale_source_history" },
    afterTarget: { id: "target_stale_source_history" },
  };
  const sourceHistorySession = new FailOnceSourceHistorySession();
  let ensureCalls = 0;
  const harness = createHarness({
    html: presentedHtml,
    sourceHistorySession,
    bridgeClient: {
      async ensureProject() {
        ensureCalls += 1;
        return registrationPayload({ html: canonicalHtml });
      },
      async workspace() {
        throw new Error("continuation must not restore only Draft authority");
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
  });
  t.after(() => harness.controller.dispose());

  const first = await harness.controller.ensureRegistered();
  assert.equal(first.status, "unknown");
  assert.equal(sourceHistorySession.attempts, 1);
  assert.equal(harness.documentSession.html, canonicalHtml);

  const staleEdit = harness.controller.enqueueDocumentEdit({
    html: staleEditedHtml,
    sourceTransaction: staleTransaction,
    context: harness.controller.getCurrentProjectContext(),
  });
  assert.equal(staleEdit.status, "blocked");
  assert.equal(staleEdit.code, "PROJECT_REGISTRATION_RECONCILIATION_REQUIRED");
  assert.equal(harness.documentSession.html, canonicalHtml);
  assert.equal(
    sourceHistorySession.isActive(harness.projectSession.context),
    false,
  );
  harness.commentSession.update({
    comments: [{
      commentId: "comment_stale_source_history",
      sourceAnchor: {
        id: "target_stale_source_history",
        selector: "main",
      },
    }],
    composerCommentId: "comment_stale_source_history_composer",
    composerDraft: "late stage-six comment",
    composerTarget: {
      id: "target_stale_source_history_composer",
      selector: "main",
    },
  });

  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(ensureCalls, 1);
  assert.equal(sourceHistorySession.attempts, 2);
  assert.equal(harness.documentSession.html, canonicalHtml);
  assert.equal(
    harness.commentSession.comments[0].sourceAnchor.selector,
    "main[data-rebound]",
  );
  assert.equal(
    harness.commentSession.composerTarget.selector,
    "main[data-rebound]",
  );
  assert.equal(
    harness.events.filter((event) => event.type === "registration-published").length,
    1,
  );
});

test("late registration reconciliation preserves edits and comments made after an unknown outcome", async (t) => {
  class FailOnceSourceHistorySession extends SourceHistorySession {
    attempts = 0;

    activate(...args) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected source history publication failure");
      return super.activate(...args);
    }
  }

  const managedHtml = "<main>managed history baseline</main>";
  const editedHtml = "<main>managed history edited</main>";
  const target = {
    projectId: "project_registration_history_continuation",
    documentId: "document_registration_history_continuation",
    projectRootPath: "/tmp/PageRoot/项目/registration-history-continuation",
    targetKind: "working-copy",
    workingCopyId: "work_registration_history_continuation",
    versionId: "ver_registration_history_continuation",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };
  const sourceHistorySession = new FailOnceSourceHistorySession();
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  let ensureCalls = 0;
  let activationCalls = 0;
  const harness = createHarness({
    html: managedHtml,
    sourceHistorySession,
    bridgeClient: {
      async ensureProject() {
        ensureCalls += 1;
        return registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        throw new Error("continuation must not restore only Draft authority");
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        activationCalls += 1;
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());
  const beforeGeneration = harness.documentSession.canvasGeneration;

  const first = await harness.controller.ensureRegistered();
  assert.equal(first.status, "unknown");
  assert.equal(harness.controller.getSnapshot().projectSession.sourcePath, NEXT_SOURCE_PATH);

  const context = harness.projectSession.context;
  const editRevision = harness.documentSession.beginEdit(editedHtml, {
    origin: "local-edit",
    operationId: "edit_after_registration_unknown",
    sourceSha256: sha256(editedHtml),
    context,
  });
  const pendingWrite = {
    ...context,
    expectedSourceSha256: sha256(managedHtml),
    html: editedHtml,
    revision: editRevision,
    events: [],
    historyOperations: [],
    recoveryIdentity: null,
  };
  harness.documentSession.update({
    pendingWrite,
    persistState: "queued",
  });
  sourceHistorySession.activate(context, sha256(editedHtml), null);
  harness.commentSession.setComments([{
    commentId: "comment_after_registration_unknown",
    sourceAnchor: { id: "anchor_after_unknown", selector: "main" },
  }]);
  const editedReceipt = harness.documentSession.sourceReceipt;

  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(ensureCalls, 1);
  assert.equal(activationCalls, 1);
  assert.equal(sourceHistorySession.attempts, 2);
  assert.equal(harness.documentSession.html, editedHtml);
  assert.equal(harness.documentSession.editRevision, editRevision);
  assert.equal(harness.documentSession.sourceReceipt, editedReceipt);
  assert.equal(harness.documentSession.pendingWrite, pendingWrite);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(
    harness.commentSession.comments[0].commentId,
    "comment_after_registration_unknown",
  );
  assert.equal(harness.events.filter((event) => event.type === "registration-published").length, 1);
});

test("ordinary registration continuation cannot degrade into Draft-only false success", async (t) => {
  class FailOnceVersionSession extends VersionSession {
    attempts = 0;

    hydrate(input) {
      this.attempts += 1;
      if (this.attempts === 1) throw new Error("injected ordinary version failure");
      return super.hydrate(input);
    }
  }

  const versionSession = new FailOnceVersionSession();
  let ensureCalls = 0;
  let workspaceCalls = 0;
  const harness = createHarness({
    versionSession,
    bridgeClient: {
      async ensureProject() {
        ensureCalls += 1;
        return registrationPayload({ html: "<main>local source</main>" });
      },
      async workspace() {
        workspaceCalls += 1;
        return registrationPayload({ html: "<main>local source</main>" });
      },
      async saveDraft() {
        return {};
      },
    },
  });
  t.after(() => harness.controller.dispose());

  const first = await harness.controller.ensureRegistered();
  const retry = await harness.controller.ensureRegistered();

  assert.equal(first.status, "unknown");
  assert.equal(retry.status, "succeeded");
  assert.equal(ensureCalls, 1);
  assert.equal(workspaceCalls, 0);
  assert.equal(versionSession.attempts, 2);
  assert.equal(harness.versionSession.snapshot.versions[0].id, "V1");
  assert.equal(harness.events.filter((event) => event.type === "registration-published").length, 1);
});

test("registration treats recovery and Canvas adapters as rebuildable projections", async (t) => {
  const harness = createHarness({
    html: "<main>canonical source</main>",
    recoveryPort: {
      replace() {
        throw new Error("injected recovery projection failure");
      },
    },
    canvasPort: {
      invalidateRenderAcks() {
        throw new Error("injected Canvas projection failure");
      },
    },
  });
  t.after(() => harness.controller.dispose());

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.projectSession.context?.projectId, "project_registration");
  assert.equal(
    harness.documentSession.sourceReceipt.context.projectId,
    "project_registration",
  );
});

test("managed registration rejects an incomplete OpenTarget before Desktop or Session mutation", async (t) => {
  const managedHtml = "<main>managed incomplete target</main>";
  const baseTarget = {
    projectId: "project_incomplete_target",
    documentId: "document_incomplete_target",
    projectRootPath: "/tmp/PageRoot/项目/incomplete-target",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };

  for (const [label, mutateTarget] of [
    ["missing exactSourcePath", (target) => { delete target.exactSourcePath; }],
    ["wrong exactSourcePath", (target) => { target.exactSourcePath = "/tmp/PageRoot/项目/incomplete-target/other-V1.html"; }],
    ["wrong sourceSha256", (target) => { target.sourceSha256 = `sha256:${"0".repeat(64)}`; }],
    ["missing OpenTarget", null],
  ]) {
    const runSession = new RunSession({ sourcePath: SOURCE_PATH });
    const previousRun = {
      projectId: "project_incomplete_target",
      documentId: "document_incomplete_target",
      sourcePath: SOURCE_PATH,
      requestId: `request_incomplete_${label.replaceAll(" ", "_")}`,
      attemptId: "attempt_incomplete_target",
      status: "processing",
    };
    runSession.trackRun(previousRun, { activate: "never" });
    let desktopCalls = 0;
    const harness = createHarness({
      html: managedHtml,
      bridgeClient: {
        async ensureProject() {
          const target = mutateTarget ? structuredClone(baseTarget) : null;
          mutateTarget?.(target);
          return registrationPayload({
            sourcePath: NEXT_SOURCE_PATH,
            projectId: baseTarget.projectId,
            documentId: baseTarget.documentId,
            html: managedHtml,
            ...(target ? { openTarget: target } : {}),
          });
        },
        async workspace() {
          return registrationPayload();
        },
        async saveDraft() {
          return {};
        },
        async projectFile() {
          return { content: "" };
        },
        async updateProjectFile() {
          return {};
        },
      },
      projectRulesWorkflow: { runSession },
      projectSource: {
        async activateManagedWorkingCopy() {
          desktopCalls += 1;
          return null;
        },
      },
    });
    t.after(() => harness.controller.dispose());
    const beforeDocument = harness.documentSession.snapshot;
    const beforeComments = harness.commentSession.snapshot;
    const beforeVersions = harness.versionSession.snapshot;
    const beforeRules = harness.controller.getSnapshot().projectRules;
    const beforeRun = runSession.snapshot;
    const beforeProjectSource = harness.projectSession.sourcePath;

    const outcome = await harness.controller.ensureRegistered();

    assert.equal(outcome.status, "rejected", label);
    assert.equal(outcome.code, "PROJECT_REGISTRATION_OPEN_TARGET_INVALID", label);
    assert.equal(desktopCalls, 0, label);
    assert.equal(harness.projectSession.context, null, label);
    assert.equal(harness.projectSession.sourcePath, beforeProjectSource, label);
    assert.deepEqual(harness.documentSession.snapshot, beforeDocument, label);
    assert.deepEqual(harness.commentSession.snapshot, beforeComments, label);
    assert.deepEqual(harness.versionSession.snapshot, beforeVersions, label);
    assert.deepEqual(harness.controller.getSnapshot().projectRules, beforeRules, label);
    assert.deepEqual(runSession.snapshot, beforeRun, label);
  }
});

test("managed registration fails closed when its destination locator already owns a Request", async (t) => {
  const managedHtml = "<main>managed destination source</main>";
  const target = {
    projectId: "project_registration",
    documentId: "document_registration",
    projectRootPath: "/tmp/PageRoot/项目/occupied",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const harness = createHarness({
    html: managedHtml,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        return registrationPayload();
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());
  const previousRun = {
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: SOURCE_PATH,
    requestId: "request_previous_registration",
    attemptId: "attempt_previous_registration",
    status: "complete",
  };
  const destinationRun = {
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: NEXT_SOURCE_PATH,
    requestId: "request_destination_registration",
    attemptId: "attempt_destination_registration",
    status: "processing",
  };
  runSession.trackRun(previousRun, { activate: "never" });
  runSession.trackRun(destinationRun, { activate: "never" });

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "PROJECT_RUN_LOCATOR_REBASE_REJECTED");
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.projectSession.sourcePath, SOURCE_PATH);
  assert.equal(runSession.runForSource(SOURCE_PATH), previousRun);
  assert.equal(runSession.runForSource(NEXT_SOURCE_PATH), destinationRun);
});

test("managed activation reports unknown when a destination collision appears after host activation", async (t) => {
  const managedHtml = "<main>managed destination race</main>";
  const target = {
    projectId: "project_registration_race",
    documentId: "document_registration_race",
    projectRootPath: "/tmp/PageRoot/项目/race",
    targetKind: "working-copy",
    workingCopyId: "work_ver_race",
    versionId: "ver_race",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };
  let releaseActivation;
  const activationStarted = new Promise((resolve) => {
    releaseActivation = resolve;
  });
  const calls = [];
  const receipts = new Map();
  let hostMutations = 0;
  let hostActivePath = SOURCE_PATH;
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const harness = createHarness({
    html: managedHtml,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        return registrationPayload();
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        if (!receipts.has(input.operationId)) {
          hostMutations += 1;
          hostActivePath = NEXT_SOURCE_PATH;
          receipts.set(input.operationId, Object.freeze({
            operationId: input.operationId,
            activePath: hostActivePath,
          }));
        }
        await activationStarted;
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());

  const previousRun = {
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: SOURCE_PATH,
    requestId: "request_race_previous",
    attemptId: "attempt_race_previous",
    status: "complete",
  };
  const destinationRun = {
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: NEXT_SOURCE_PATH,
    requestId: "request_race_destination",
    attemptId: "attempt_race_destination",
    status: "processing",
  };
  runSession.trackRun(previousRun, { activate: "never" });
  const registration = harness.controller.ensureRegistered();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  runSession.trackRun(destinationRun, { activate: "never" });
  releaseActivation();

  const outcome = await registration;

  assert.equal(outcome.status, "unknown");
  assert.equal(hostActivePath, NEXT_SOURCE_PATH);
  assert.equal(receipts.get(calls[0].operationId)?.activePath, NEXT_SOURCE_PATH);
  assert.equal(
    harness.controller.getSnapshot().registration.outcome.operationId,
    calls[0].operationId,
  );
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.projectSession.sourcePath, SOURCE_PATH);
  assert.equal(runSession.runForSource(SOURCE_PATH), previousRun);
  assert.equal(runSession.runForSource(NEXT_SOURCE_PATH), destinationRun);

  runSession.removeRun(destinationRun);
  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].operationId, calls[0].operationId);
  assert.equal(hostMutations, 1);
  assert.equal(hostActivePath, NEXT_SOURCE_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(runSession.runForSource(SOURCE_PATH), null);
  assert.equal(runSession.runForSource(NEXT_SOURCE_PATH)?.requestId, previousRun.requestId);
});

test("managed registration fences edits during host activation and rebinds the latest queued write on retry", async (t) => {
  const managedHtml = "<main>managed registration baseline</main>";
  const editedHtml = "<main>latest renderer edit</main>";
  const target = {
    projectId: "project_registration_edit_race",
    documentId: "document_registration_edit_race",
    projectRootPath: "/tmp/PageRoot/项目/edit-race",
    targetKind: "working-copy",
    workingCopyId: "work_ver_edit_race",
    versionId: "ver_edit_race",
    exactSourcePath: NEXT_SOURCE_PATH,
    sourceSha256: sha256(managedHtml),
  };
  let markActivationStarted;
  const activationStarted = new Promise((resolve) => {
    markActivationStarted = resolve;
  });
  let releaseActivation;
  const activationBarrier = new Promise((resolve) => {
    releaseActivation = resolve;
  });
  const calls = [];
  const hostReceipts = new Map();
  let hostMutations = 0;
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const harness = createHarness({
    html: managedHtml,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({
          sourcePath: NEXT_SOURCE_PATH,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        return registrationPayload();
      },
      async saveDraft() {
        return {};
      },
      async projectFile() {
        return { content: "" };
      },
      async updateProjectFile() {
        return {};
      },
    },
    projectRulesWorkflow: { runSession },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        if (!hostReceipts.has(input.operationId)) {
          hostMutations += 1;
          hostReceipts.set(input.operationId, Object.freeze({
            operationId: input.operationId,
            activePath: NEXT_SOURCE_PATH,
          }));
          markActivationStarted();
        }
        await activationBarrier;
        return {
          operationId: input.operationId,
          sourcePath: NEXT_SOURCE_PATH,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });
  t.after(() => harness.controller.dispose());

  const previousRun = {
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: SOURCE_PATH,
    requestId: "request_registration_edit_race",
    attemptId: "attempt_registration_edit_race",
    status: "processing",
  };
  runSession.trackRun(previousRun, { activate: "never" });
  const aggregateSnapshots = [];
  const unsubscribe = harness.controller.subscribe((snapshot) => {
    aggregateSnapshots.push(snapshot);
  });
  t.after(unsubscribe);

  const beforeGeneration = harness.documentSession.canvasGeneration;
  const registration = harness.controller.ensureRegistered();
  await activationStarted;
  assert.equal(calls.length, 1);

  const editRevision = harness.documentSession.beginEdit(editedHtml, {
    origin: "local-edit",
    operationId: "edit_during_registration",
    sourceSha256: sha256(editedHtml),
  });
  const queuedWrite = {
    epoch: harness.projectSession.epoch,
    projectId: null,
    documentId: null,
    sourcePath: SOURCE_PATH,
    expectedSourceSha256: sha256(managedHtml),
    html: editedHtml,
    revision: editRevision,
    events: [],
    historyOperations: [],
    recoveryIdentity: null,
  };
  harness.documentSession.update({
    pendingWrite: queuedWrite,
    persistState: "queued",
  });
  const editedSnapshot = harness.documentSession.snapshot;
  const editedReceipt = harness.documentSession.sourceReceipt;
  const editedCanvasAuthority = harness.documentSession.canvasAuthority;
  const editedFlushPromise = harness.documentSession.flushPromise;
  releaseActivation();

  const first = await registration;

  assert.equal(first.status, "unknown");
  assert.equal(first.operationId, calls[0].operationId);
  assert.equal(hostReceipts.get(first.operationId)?.activePath, NEXT_SOURCE_PATH);
  assert.equal(hostMutations, 1);
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.projectSession.sourcePath, SOURCE_PATH);
  assert.equal(runSession.runForSource(SOURCE_PATH), previousRun);
  assert.equal(runSession.runForSource(NEXT_SOURCE_PATH), null);
  assert.equal(harness.documentSession.snapshot, editedSnapshot);
  assert.equal(harness.documentSession.html, editedHtml);
  assert.equal(harness.documentSession.editRevision, editRevision);
  assert.equal(harness.documentSession.sourceReceipt, editedReceipt);
  assert.equal(harness.documentSession.canvasAuthority, editedCanvasAuthority);
  assert.equal(harness.documentSession.pendingWrite, queuedWrite);
  assert.equal(harness.documentSession.flushPromise, editedFlushPromise);
  assert.equal(harness.documentSession.pendingWrite.sourcePath, SOURCE_PATH);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration);
  assert.equal(harness.canvasInvalidations, 0);
  for (const snapshot of aggregateSnapshots) {
    const paths = [
      snapshot.projectSession?.sourcePath,
      snapshot.runSession?.activeSourcePath,
      snapshot.document?.sourceReceipt?.context?.sourcePath,
    ];
    assert.equal(paths.includes(NEXT_SOURCE_PATH), false);
  }

  const retrySnapshotStart = aggregateSnapshots.length;
  const retry = await harness.controller.ensureRegistered();

  assert.equal(retry.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].operationId, calls[0].operationId);
  assert.equal(hostMutations, 1);
  assert.equal(harness.projectSession.context?.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(runSession.runForSource(SOURCE_PATH), null);
  assert.equal(runSession.runForSource(NEXT_SOURCE_PATH)?.requestId, previousRun.requestId);
  assert.equal(harness.documentSession.html, editedHtml);
  assert.equal(harness.documentSession.editRevision, editRevision);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(harness.canvasInvalidations, 1);
  assert.equal(
    harness.documentSession.sourceReceipt.operationId,
    "workspace-register-authority",
  );
  assert.equal(
    harness.documentSession.sourceReceipt.context.sourcePath,
    NEXT_SOURCE_PATH,
  );
  assert.equal(harness.documentSession.pendingWrite.html, editedHtml);
  assert.equal(harness.documentSession.pendingWrite.revision, editRevision);
  assert.equal(harness.documentSession.pendingWrite.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.documentSession.pendingWrite.projectId, target.projectId);
  assert.equal(harness.documentSession.pendingWrite.documentId, target.documentId);
  assert.equal(harness.documentSession.pendingWrite.workingCopyId, target.workingCopyId);
  assert.equal(harness.documentSession.pendingWrite.versionId, target.versionId);
  assert.equal(harness.documentSession.pendingWrite.exactSourcePath, NEXT_SOURCE_PATH);
  assert.equal(
    harness.documentSession.pendingWrite.expectedSourceSha256,
    sha256(managedHtml),
  );
  assert.equal(harness.documentSession.confirmCanvas({
    generation: editedReceipt.canvasGeneration,
    renderedSha256: sha256(editedHtml),
    workingHtmlSha256: sha256(editedHtml),
    renderedHtml: editedHtml,
    receipt: editedReceipt,
  }), false);
  const retrySnapshots = aggregateSnapshots.slice(retrySnapshotStart);
  assert.ok(retrySnapshots.length >= 1);
  assert.equal(
    retrySnapshots.some((snapshot) => snapshot.projectSession?.sourcePath === NEXT_SOURCE_PATH),
    true,
  );
  for (const snapshot of retrySnapshots) {
    const paths = [
      snapshot.projectSession?.sourcePath,
      snapshot.runSession?.activeSourcePath,
      snapshot.document?.sourceReceipt?.context?.sourcePath,
    ];
    if (!paths.includes(NEXT_SOURCE_PATH)) continue;
    assert.deepEqual(paths, [NEXT_SOURCE_PATH, NEXT_SOURCE_PATH, NEXT_SOURCE_PATH]);
    assert.equal(snapshot.document.html, editedHtml);
    assert.equal(snapshot.document.hasPendingWrite, true);
    assert.equal(snapshot.document.canvasGeneration, beforeGeneration + 1);
    assert.equal(
      snapshot.document.sourceReceipt.operationId,
      "workspace-register-authority",
    );
  }
});

test("managed registration fails closed when its desktop Working Copy activation is unavailable", async () => {
  const workingCopyPath = "/tmp/PageRoot/项目/unavailable/unavailable-V1.html";
  const managedHtml = "<main>managed V1 source</main>";
  const target = {
    projectId: "project_unavailable",
    documentId: "document_unavailable",
    projectRootPath: "/tmp/PageRoot/项目/unavailable",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: workingCopyPath,
    sourceSha256: sha256(managedHtml),
  };
  const harness = createHarness({
    html: managedHtml,
    bridgeClient: {
      async ensureProject() {
        return registrationPayload({
          sourcePath: workingCopyPath,
          projectId: target.projectId,
          documentId: target.documentId,
          html: managedHtml,
          openTarget: target,
        });
      },
      async workspace() {
        return registrationPayload();
      },
      async saveDraft() {
        return {};
      },
    },
  });

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "PROJECT_WORKING_COPY_ACTIVATION_UNAVAILABLE");
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.projectSession.sourcePath, SOURCE_PATH);
});

test("workspace registration publishes a same-byte authority and rebuild fence", async () => {
  const html = "<main>canonical source</main>";
  const harness = createHarness({ html });
  const beforeGeneration = harness.documentSession.canvasGeneration;
  const beforeReceipt = harness.documentSession.sourceReceipt;

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(harness.canvasInvalidations, 1);
  assert.equal(harness.documentSession.sourceReceipt.origin, "authority");
  assert.ok(harness.documentSession.sourceReceipt.sequence > beforeReceipt.sequence);
  assert.equal(harness.documentSession.sourceReceipt.context.projectId, outcome.value.projectId);
  assert.equal(harness.documentSession.sourceReceipt.context.documentId, outcome.value.documentId);
  assert.equal(harness.documentSession.sourceReceipt.context.sourcePath, outcome.value.sourcePath);
  assert.equal(harness.documentSession.confirmCanvas({
    generation: harness.documentSession.canvasGeneration,
    renderedSha256: sha256(html),
    workingHtmlSha256: sha256(html),
    renderedHtml: html,
    receipt: beforeReceipt,
  }), false, "pre-registration ACK must not settle the registered context");
  harness.controller.dispose();
});

test("workspace controller is the sole aggregate Session observer and disconnects on dispose", () => {
  const harness = createHarness();
  const snapshots = [];
  const unsubscribe = harness.controller.subscribe((snapshot) => snapshots.push(snapshot));

  assert.equal(snapshots.at(-1)?.document, harness.documentSession.snapshot);
  assert.equal(snapshots.at(-1)?.commentSession, harness.commentSession.snapshot);
  assert.equal(snapshots.at(-1)?.versionSession, harness.versionSession.snapshot);
  assert.equal(snapshots.at(-1)?.runSession, null);

  harness.documentSession.setPendingWrite({ revision: 1 });
  harness.documentSession.setPersistence({ state: "queued" });
  assert.equal(snapshots.at(-1)?.document?.hasPendingWrite, true);

  harness.commentSession.setComments([{
    commentId: "aggregate_comment",
    target: { id: "aggregate_target", selector: "main" },
  }]);
  assert.equal(snapshots.at(-1)?.commentSession?.comments[0]?.commentId, "aggregate_comment");
  assert.equal(Object.isFrozen(harness.controller.getSnapshot()), true);

  const finalSnapshot = harness.controller.getSnapshot();
  harness.controller.dispose();
  harness.documentSession.setPersistence({ state: "idle" });
  assert.equal(harness.controller.getSnapshot(), finalSnapshot);
  unsubscribe();
});

test("comments capability publishes only comment snapshots with stable commands", () => {
  const harness = createHarness();
  const capability = harness.controller.comments;
  const commands = capability.commands;
  const snapshots = [];
  const unsubscribe = capability.subscribe(() => {
    snapshots.push(capability.getSnapshot());
  });
  const initial = capability.getSnapshot();

  harness.documentSession.setPendingWrite({ revision: 1 });
  assert.equal(capability.getSnapshot(), initial);
  assert.equal(snapshots.length, 0);

  harness.commentSession.setComposerDraft("local draft");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].workingCopy, harness.commentSession.snapshot);
  assert.equal(snapshots[0].workingCopy.composerDraft, "local draft");
  assert.equal(snapshots[0].persistence, null);
  assert.equal(harness.controller.comments, capability);
  assert.equal(harness.controller.comments.commands, commands);
  assert.ok(Object.isFrozen(snapshots[0]));
  assert.ok(Object.isFrozen(commands));

  unsubscribe();
  harness.commentSession.setComposerDraft("after unsubscribe");
  assert.equal(snapshots.length, 1);
  harness.controller.dispose();
});

test("runs and navigation are stable capability facets over Controller authority", () => {
  const harness = createProjectRulesHarness();
  const runs = harness.controller.runs;
  const navigation = harness.controller.navigation;
  const publications = [];
  const unsubscribe = runs.subscribe(() => publications.push(runs.getSnapshot()));
  const activeRun = {
    sourcePath: SOURCE_PATH,
    requestId: "request_capability",
    attemptId: "attempt_capability",
    status: "processing",
  };

  harness.runSession.setActiveRun(activeRun);
  harness.runSession.publishHandoff({
    sourcePath: SOURCE_PATH,
    requestId: activeRun.requestId,
    attemptId: activeRun.attemptId,
    status: "running",
    visibleText: "Agent is working",
  });

  assert.equal(runs.getSnapshot().session?.activeRun, activeRun);
  assert.equal(
    runs.getSnapshot().session?.activeHandoff?.visibleText,
    "Agent is working",
  );
  assert.equal(publications.length >= 2, true);
  assert.equal(harness.controller.runs, runs);
  assert.equal(harness.controller.navigation, navigation);
  assert.ok(Object.isFrozen(runs.commands));
  assert.ok(Object.isFrozen(navigation.commands));
  assert.deepEqual(navigation.getSnapshot(), {
    tabs: null,
    ready: false,
    workflow: null,
    persistence: null,
  });

  unsubscribe();
  harness.controller.dispose();
});

test("workspace controller owns one Edit runtime attempt per source path and canvas generation", async () => {
  const html = [
    "<!doctype html><html><body>",
    '<main id="chart-host"></main>',
    '<script>echarts.init(document.querySelector("#chart-host"))</script>',
    "</body></html>",
  ].join("");
  const prepares = [];
  const revocations = [];
  const harness = createHarness({
    html,
    editRuntimePort: {
      async prepare(request) {
        prepares.push(request);
        const ordinal = prepares.length.toString(16);
        return {
          contractVersion: 2,
          sessionId: ordinal.padStart(32, "0"),
          executionId: ordinal.padStart(24, "0"),
          sourceSha256: request.sourceSha256,
          resourceSha256: sha256(`resource:${ordinal}`),
          documentBasePath: "/",
          scriptCount: 1,
          byteLength: 1,
          canvasGeneration: request.canvasGeneration,
          hosts: request.hosts,
        };
      },
      async revoke(sessionId) {
        revocations.push(sessionId);
        return { revoked: true };
      },
    },
  });

  await settleAsyncRuntime();
  const preparing = harness.controller.getSnapshot().editRuntime;
  assert.equal(preparing?.phase, "preparing");
  assert.equal(prepares.length, 0);
  assert.equal(harness.controller.startEditAuthorRuntimePreparation({
    sourceSha256: preparing?.sourceSha256,
    canvasGeneration: preparing?.canvasGeneration,
  }), true);
  await settleAsyncRuntime();
  const ready = harness.controller.getSnapshot().editRuntime;
  assert.equal(ready?.phase, "ready");
  assert.equal(prepares.length, 1);
  const runtimeAttempt = {
    candidateId: "runtime-controller-candidate-1",
    candidateGeneration: 1,
    candidateSourceRevision: ready?.grant?.sourceSha256,
  };
  assert.equal(
    harness.controller.beginEditAuthorRuntime({
      sessionId: ready?.grant?.sessionId,
      sourceSha256: ready?.grant?.sourceSha256,
      canvasGeneration: ready?.grant?.canvasGeneration,
      ...runtimeAttempt,
    }),
    true,
  );
  assert.equal(
    harness.controller.settleEditAuthorRuntime({
      sessionId: ready?.grant?.sessionId,
      sourceSha256: ready?.grant?.sourceSha256,
      canvasGeneration: ready?.grant?.canvasGeneration,
      ...runtimeAttempt,
      outcome: "ready",
    }),
    true,
  );
  assert.equal(harness.controller.getSnapshot().editRuntime?.phase, "settled");

  harness.commentSession.setComments([{
    commentId: "runtime_comment",
    target: { id: "chart", selector: "#chart-host" },
  }]);
  await settleAsyncRuntime();
  assert.equal(prepares.length, 1, "comments never refresh the runtime key");

  harness.documentSession.reloadCanvas();
  await settleAsyncRuntime();
  const nextPreparing = harness.controller.getSnapshot().editRuntime;
  assert.equal(nextPreparing?.phase, "preparing");
  assert.equal(harness.controller.startEditAuthorRuntimePreparation({
    sourceSha256: nextPreparing?.sourceSha256,
    canvasGeneration: nextPreparing?.canvasGeneration,
  }), true);
  await settleAsyncRuntime();
  assert.equal(prepares.length, 2);
  assert.equal(revocations.length >= 1, true);
  harness.controller.dispose();
});

test("workspace controller starts the disposable runtime when its initial source becomes authoritative", async () => {
  const html = [
    "<!doctype html><html><body>",
    '<main id="chart-host"></main>',
    '<script>echarts.init(document.querySelector("#chart-host"))</script>',
    "</body></html>",
  ].join("");
  const prepares = [];
  const harness = createHarness({
    html,
    initialDocument: {
      editRevision: 1,
      lastPersistedRevision: 0,
      persistState: "writing",
    },
    editRuntimePort: {
      async prepare(request) {
        prepares.push(request);
        return {
          contractVersion: 2,
          sessionId: "1".padStart(32, "0"),
          executionId: "1".padStart(24, "0"),
          sourceSha256: request.sourceSha256,
          resourceSha256: sha256("authoritative-resource"),
          documentBasePath: "/",
          scriptCount: 1,
          byteLength: 1,
          canvasGeneration: request.canvasGeneration,
          hosts: request.hosts,
        };
      },
      async revoke() {
        return { revoked: true };
      },
    },
  });

  await settleAsyncRuntime();
  const beforeAuthority = harness.controller.getSnapshot().editRuntime;
  assert.equal(beforeAuthority?.phase, "static");
  assert.equal(beforeAuthority?.lastOutcome, "source-not-authoritative");
  assert.equal(prepares.length, 0);
  const canvasGeneration = beforeAuthority?.canvasGeneration;

  harness.documentSession.update({
    editRevision: 1,
    lastPersistedRevision: 1,
    persistState: "idle",
  });
  await settleAsyncRuntime();

  const preparing = harness.controller.getSnapshot().editRuntime;
  assert.equal(preparing?.phase, "preparing");
  assert.equal(prepares.length, 0);
  assert.equal(harness.controller.startEditAuthorRuntimePreparation({
    sourceSha256: preparing?.sourceSha256,
    canvasGeneration: preparing?.canvasGeneration,
  }), true);
  await settleAsyncRuntime();
  const ready = harness.controller.getSnapshot().editRuntime;
  assert.equal(prepares.length, 1);
  assert.equal(ready?.phase, "ready");
  assert.equal(ready?.canvasGeneration, canvasGeneration);

  harness.documentSession.setPersistedSourceSha256(sha256(html + "<!-- source echo -->"));
  await settleAsyncRuntime();
  assert.equal(prepares.length, 1);
  harness.controller.dispose();
});

test("workspace controller aggregates and dispatches the typed PROJECT.md workflow", async () => {
  const harness = createProjectRulesHarness();
  const snapshots = [];
  const unsubscribe = harness.controller.subscribe((snapshot) => snapshots.push(snapshot));

  assert.equal(
    (await harness.controller.openProjectRules({ context: harness.context })).status,
    "succeeded",
  );
  assert.equal(harness.controller.getSnapshot().projectRules?.content, "# Original rules");
  assert.equal(
    harness.controller.updateProjectRules({ content: "# Updated rules" }).status,
    "succeeded",
  );
  assert.equal((await harness.controller.saveProjectRules()).status, "succeeded");
  assert.equal(harness.persisted, "# Updated rules");
  assert.equal(
    snapshots.at(-1)?.projectRules?.savedContent,
    "# Updated rules",
  );

  unsubscribe();
  harness.controller.dispose();
});

test("workspace controller rejects split RunSession composition for project rules", () => {
  const projectRulesRunSession = new RunSession({ sourcePath: SOURCE_PATH });
  const projectWorkflowRunSession = new RunSession({ sourcePath: SOURCE_PATH });

  assert.throws(() => new WorkspaceController({
    bridgeClient: {
      async ensureProject() {
        return registrationPayload();
      },
    },
    projectSession: new ProjectSession(),
    documentSession: new DocumentSession({
      html: "<main>source</main>",
      persistedSourceSha256: sha256("<main>source</main>"),
    }),
    commentSession: new CommentSession(),
    draftSession: new DraftSession({ bridgeClient: { async saveDraft() {} } }),
    versionSession: new VersionSession(),
    sourceHistorySession: new SourceHistorySession(),
    codecs,
    ports: { hash: { sha256: async (value) => sha256(value) } },
    projectRulesWorkflow: { runSession: projectRulesRunSession },
    projectWorkflow: { runSession: projectWorkflowRunSession },
    clock: { now: () => 1 },
  }), /one RunSession/);
});

test("workspace controller shares one registration Promise across durable callers", async () => {
  let resolveEnsure;
  let ensureCount = 0;
  const client = {
    ensureProject() {
      ensureCount += 1;
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });

  const first = harness.controller.ensureRegistered();
  const second = harness.controller.ensureRegistered();
  assert.equal(first, second);
  assert.equal(ensureCount, 1);
  resolveEnsure(registrationPayload());

  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.status, "succeeded");
  assert.equal(right.status, "succeeded");
  assert.equal(harness.projectSession.context?.projectId, "project_registration");
});

test("a late registration result is stale and cannot publish into the next project", async () => {
  let resolveEnsure;
  const client = {
    ensureProject() {
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const pending = harness.controller.ensureRegistered();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  resolveEnsure(registrationPayload());

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, "<main>local source</main>");
  assert.equal(harness.draftSession.context, null);
});

test("a changed expected source Hash retires registration before Session publication", async () => {
  let resolveEnsure;
  const client = {
    ensureProject() {
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const pending = harness.controller.ensureRegistered();
  const newerHtml = "<main>newer source</main>";
  harness.documentSession.update({
    html: newerHtml,
    persistedSourceSha256: sha256(newerHtml),
  });
  resolveEnsure(registrationPayload());

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, newerHtml);
  assert.equal(harness.draftSession.context, null);
});

test("a source switch retires an in-flight registration instead of blocking the next project", async () => {
  let resolveFirst;
  const calls = [];
  const client = {
    ensureProject({ sourcePath }) {
      calls.push(sourcePath);
      if (calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(registrationPayload({
        sourcePath: NEXT_SOURCE_PATH,
        projectId: "project_next",
        documentId: "document_next",
      }));
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const first = harness.controller.ensureRegistered();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  const second = harness.controller.ensureRegistered({
    sourcePath: NEXT_SOURCE_PATH,
    expectedSourceSha256: harness.documentSession.persistedSourceSha256,
  });

  assert.notEqual(first, second);
  assert.deepEqual(calls, [SOURCE_PATH, NEXT_SOURCE_PATH]);
  assert.equal((await second).status, "succeeded");
  resolveFirst(registrationPayload());
  assert.equal((await first).status, "stale");
  assert.deepEqual(harness.projectSession.context, {
    epoch: 2,
    projectId: "project_next",
    documentId: "document_next",
    sourcePath: NEXT_SOURCE_PATH,
  });
});

test("workspace controller fails closed on a canonical HTML Hash mismatch", async () => {
  const payload = registrationPayload();
  payload.currentHtmlSha256 = sha256("<main>different bytes</main>");
  const harness = createHarness({
    bridgeClient: {
      async ensureProject() {
        return payload;
      },
      async workspace() {
        return {};
      },
      async saveDraft() {
        return {};
      },
    },
  });

  const outcome = await harness.controller.ensureRegistered();
  assert.deepEqual(outcome, {
    status: "rejected",
    code: "PROJECT_REGISTRATION_PAYLOAD_INVALID",
    reason: "项目记录已建立，但返回的身份或源文件校验不完整。",
  });
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.draftSession.context, null);
});

test("an existing project recovers its Draft authority without creating a second identity", async () => {
  let ensureCount = 0;
  let workspaceCount = 0;
  const client = {
    async ensureProject() {
      ensureCount += 1;
      return registrationPayload();
    },
    async workspace() {
      workspaceCount += 1;
      return registrationPayload({
        draft: authoritativeDraft(12),
      });
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const locator = harness.projectSession.locator;
  const context = harness.projectSession.register({
    ...locator,
    projectId: "project_registration",
    documentId: "document_registration",
  });

  const outcome = await harness.controller.ensureRegistered({
    expectedSourceSha256: harness.documentSession.persistedSourceSha256,
  });
  assert.deepEqual(registrationContextFromOutcome(outcome), context);
  assert.equal(ensureCount, 0);
  assert.equal(workspaceCount, 1);
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.draftSession.isActive(context), true);
  assert.equal(harness.draftSession.revision, 12);
  assert.deepEqual(harness.events, [{
    type: "draft-authority-rebound",
    context,
  }]);
});

test("a mismatched workspace identity does not rebind a registered Draft", async () => {
  const client = {
    async ensureProject() {
      return registrationPayload();
    },
    async workspace() {
      return registrationPayload({ projectId: "project_wrong" });
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const context = harness.projectSession.register({
    ...harness.projectSession.locator,
    projectId: "project_registration",
    documentId: "document_registration",
  });

  const outcome = await harness.controller.ensureRegistered();
  assert.deepEqual(outcome, {
    status: "rejected",
    code: "PROJECT_REGISTRATION_IDENTITY_MISMATCH",
    reason: "项目记录的身份与当前页面不一致，已停止恢复评论会话。",
  });
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.draftSession.context, null);
});

test("confirmExternalOpen rejects view-initial before ProjectWorkflow is required", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.controller.confirmExternalOpen({
      requestId: "req_view",
      action: "view-initial",
    }),
    {
      status: "rejected",
      code: "EXTERNAL_OPEN_ACTION_UNSUPPORTED",
      reason: "这条打开确认不提供查看初始版本。",
    },
  );
});


test("catalog retains active V3 after switching projects using the production summary projection", async () => {
  const projection = await loadWorkbenchModel("project-version-tree-model");
  const h = createHarness({ controllerCodecs: { ...codecs, ...projection } });
  await h.controller.ensureRegistered();
  const a = h.projectSession.snapshot;
  const versions = (count) => Array.from({ length: count }, (_, i) => ({ id: `ver_000${i+1}`, ordinal: i+1, generatedAt: "2026-09-07T00:00:00.000Z", displayFileName: `A-V${i+1}.html` }));
  h.versionSession.hydrate({ versions: versions(2), currentBasedOnVersionId: "ver_0001", latestVersionId: "ver_0002" });
  h.versionSession.updateAuthority({ versions: versions(3), latestVersionId: "ver_0003" });
  h.versionSession.reset();
  h.projectSession.openLocator("/tmp/B.html");
  h.projectSession.register({ epoch: h.projectSession.epoch, sourcePath: "/tmp/B.html", projectId: "project_b", documentId: "document_b" });
  h.versionSession.hydrate({ versions: versions(1), currentBasedOnVersionId: "ver_0001", latestVersionId: "ver_0001" });
  const catalog = h.controller.projectCatalog.getSnapshot();
  assert.equal(catalog.versionSummaries[a.projectId].documentId, a.documentId);
  assert.equal(catalog.versionSummaries[a.projectId].versions.length, 3);
  assert.equal(catalog.versionSummaries[a.projectId].versions.find((row) => row.isLatestOfficial).versionId, "ver_0003");
  assert.equal(catalog.versionSummaries.project_b.versions.length, 1);
  h.controller.dispose();
});


test("a freshly decoded Working Copy timestamp replaces its old historical summary", async (t) => {
  const projection = await loadWorkbenchModel("project-version-tree-model");
  const h = createHarness({ controllerCodecs: { ...codecs, ...projection } });
  t.after(() => h.controller.dispose());
  await h.controller.ensureRegistered();
  const projectId = h.projectSession.snapshot.projectId;
  const versions = [{ id: "v1", ordinal: 1, modifiedAt: "2026-09-01T00:00:00Z" },
    { id: "v2", ordinal: 2, modifiedAt: "2026-09-02T00:00:00Z" }];
  h.versionSession.hydrate({ versions, currentBasedOnVersionId: "v2", latestVersionId: "v2" });
  h.versionSession.hydrate({ versions: [{ ...versions[0], modifiedAt: "2026-09-07T00:00:00Z" }, versions[1]],
    currentBasedOnVersionId: "v1", latestVersionId: "v2" });
  const summary = () => h.controller.projectCatalog.getSnapshot().versionSummaries[projectId].versions;
  assert.equal(summary()[0].modifiedAt, "2026-09-07T00:00:00Z");
  h.versionSession.updateAuthority({});
  assert.equal(summary()[0].modifiedAt, "2026-09-07T00:00:00Z");
  assert.equal(summary()[0].isActiveWorkingCopy, true);
  assert.equal(summary()[1].isLatestOfficial, true);
});

test("runtime retry awaits save authority and never follows a changed document", async (t) => {
  for (const outcome of ["saved", "failed", "switched"]) await t.test(outcome, async () => {
    const html = '<html><body><p>Original</p><script>console.log("chart")</script></body></html>';
    const latest = html.replace('Original', 'Latest');
    const harness = createHarness({ html, editRuntimePort: {
      async prepare() { throw new Error('synthetic transient prepare failure'); },
      async revoke() { return { revoked: true }; },
    } });
    try {
      const initial = harness.controller.getSnapshot().editRuntime;
      harness.controller.startEditAuthorRuntimePreparation({
        sourceSha256: initial.sourceSha256, canvasGeneration: initial.canvasGeneration,
      });
      await settleAsyncRuntime();
      assert.equal(harness.controller.getSnapshot().editRuntime.retryAvailable, true);
      harness.documentSession.update({ html: latest, editRevision: 1, persistState: 'writing' });
      let finishSave;
      const save = new Promise(resolve => { finishSave = resolve; });
      harness.controller.flushDocument = () => save;
      const retried = harness.controller.retryEditAuthorRuntime();
      await settleAsyncRuntime();
      assert.equal(harness.controller.getSnapshot().editRuntime.phase, 'static-fallback');
      if (outcome === 'switched') harness.projectSession.openLocator(NEXT_SOURCE_PATH);
      if (outcome !== 'failed') harness.documentSession.update({
        persistedSourceSha256: sha256(latest), lastPersistedRevision: 1, persistState: 'idle',
      });
      finishSave({ status: outcome === 'failed' ? 'blocked' : 'succeeded' });
      assert.equal(await retried, outcome === 'saved');
      if (outcome === 'saved') {
        const retry = harness.controller.getSnapshot().editRuntime;
        assert.equal(retry.phase, 'preparing');
        assert.equal(retry.sourceSha256, sha256(latest));
        assert.equal(retry.sourcePath, SOURCE_PATH);
      }
    } finally { harness.controller.dispose(); }
  });
});


test("shell omits comment drafts while saved content and composer structure remain observable", (t) => {
  const h = createHarness();
  t.after(() => h.controller.dispose());
  const shell = h.controller.shell;
  const updates = [];
  const unsubscribe = shell.subscribe(() => updates.push(shell.getSnapshot()));
  const initial = shell.getSnapshot();
  assert.equal(shell.getSnapshot(), initial);
  assert.equal("conversation" in initial, false);
  assert.equal("composerDraft" in initial.commentSession, false);
  h.commentSession.update({ composerTarget: { id: "paragraph" }, composerCommentId: "draft_1", composerDraft: "first" });
  assert.equal(updates.length, 1);
  assert.equal(shell.getSnapshot().commentSession.composerHasText, true);
  const withDraft = shell.getSnapshot();
  h.commentSession.setComposerDraft("first second");
  assert.equal(shell.getSnapshot(), withDraft);
  assert.equal(updates.length, 1);
  assert.equal(h.controller.comments.getSnapshot().workingCopy.composerDraft, "first second");
  h.commentSession.setComposerDraft(" ");
  assert.equal(updates.length, 2);
  assert.equal(shell.getSnapshot().commentSession.composerHasText, false);
  h.commentSession.update({ comments: [{ commentId: "saved", content: "saved content" }] });
  assert.equal(updates.length, 3);
  const attachments = [];
  h.commentSession.update({ editSession: { commentId: "saved", baselineText: "saved content", baselineAttachments: attachments, draftText: "new", draftAttachments: attachments } });
  const editing = shell.getSnapshot();
  assert.equal("draftText" in editing.commentSession.editSession, false);
  h.commentSession.update({ editSession: { ...h.commentSession.snapshot.editSession, draftText: "new text" } });
  assert.equal(shell.getSnapshot(), editing);
  h.commentSession.update({ editSession: { ...h.commentSession.snapshot.editSession, draftAttachments: [{ attachmentId: "new" }] } });
  assert.notEqual(shell.getSnapshot(), editing);
  const beforeUnsubscribe = updates.length;
  unsubscribe();
  h.commentSession.reset();
  assert.equal(updates.length, beforeUnsubscribe);
  let afterDispose = 0;
  shell.subscribe(() => { afterDispose += 1; });
  h.controller.dispose();
  h.commentSession.setComments([{ commentId: "late" }]);
  assert.equal(afterDispose, 0);
});

test("Agent text, clock and bytes notify only the run facet; phase, error and lifecycle notify shell", (t) => {
  const h = createProjectRulesHarness();
  t.after(() => h.controller.dispose());
  const run = { sourcePath: SOURCE_PATH, requestId: "request_shell", attemptId: "attempt_shell", status: "processing" };
  h.runSession.setActiveRun(run);
  const handoff = { ...run, mode: "managed-agent", status: "running", phase: "agent-message", visibleText: "first" };
  h.runSession.publishHandoff(handoff);
  const initial = h.controller.shell.getSnapshot();
  let shellUpdates = 0;
  let runUpdates = 0;
  h.controller.shell.subscribe(() => { shellUpdates += 1; });
  h.controller.runs.subscribe(() => { runUpdates += 1; });
  for (let index = 1; index <= 40; index += 1) {
    h.runSession.publishHandoff({ ...handoff, visibleText: `message ${index}`, visibleTextUpdates: [{ id: "message", text: `message ${index}` }], receivedBytes: index, lastActivityAt: String(index), updatedAt: String(index) });
  }
  assert.equal(runUpdates, 40);
  assert.equal(shellUpdates, 0);
  assert.equal(h.controller.shell.getSnapshot(), initial);
  assert.equal("visibleText" in initial.runSession.activeHandoff, false);
  assert.equal("receivedBytes" in initial.runSession.activeHandoff, false);
  assert.equal(h.controller.runs.getSnapshot().session.activeHandoff.visibleText, "message 40");
  h.runSession.publishHandoff({ ...handoff, phase: "validating" });
  assert.equal(shellUpdates, 1);
  h.runSession.publishHandoff({ ...handoff, status: "failed", errorCode: "AGENT_FAILED", errorMessage: "failed" });
  assert.equal(shellUpdates, 2);
  assert.equal(h.controller.shell.getSnapshot().runSession.activeHandoff.errorCode, "AGENT_FAILED");
  h.runSession.clearActiveRun();
  assert.equal(shellUpdates, 3);
});

test("conversation facet retains exact owner facts through draft writes, document replacement and disposal", async (t) => {
  const session = new ConversationSession();
  const saved = [];
  const h = createHarness({ conversationSession: session, bridgeClient: {
    async saveDraft() { return {}; },
    async ensureProject() { return registrationPayload(); },
    async workspace() { return registrationPayload(); },
    async saveConversationDraft(body) { saved.push(body); return { draft: { conversationId: body.conversationId, text: body.text, intent: body.intent } }; },
  } });
  t.after(() => h.controller.dispose());
  const a = { projectId: "project_conversation", documentId: "doc_a", sourcePath: SOURCE_PATH };
  const b = { ...a, documentId: "doc_b", sourcePath: NEXT_SOURCE_PATH };
  const record = { ...a, conversationId: "conversation_a", title: "A", messages: [{ text: "A history" }], turns: [] };
  const initial = h.controller.shell.getSnapshot();
  let shellUpdates = 0;
  let localUpdates = 0;
  h.controller.shell.subscribe(() => { shellUpdates += 1; });
  const unsubscribe = h.controller.conversation.subscribe(() => { localUpdates += 1; });
  session.beginLoad(a);
  session.publish(a, { conversation: record, draft: { text: "first", intent: "modify" } });
  const loaded = h.controller.conversation.getSnapshot();
  assert.equal(loaded, h.controller.getSnapshot().conversation);
  assert.equal(h.controller.conversation.getSnapshot(), loaded);
  for (let index = 0; index < 20; index += 1) h.controller.updateConversationDraftText(`draft ${index}`);
  assert.equal(h.controller.shell.getSnapshot(), initial);
  assert.equal(shellUpdates, 0);
  assert.equal(localUpdates, 22);
  assert.equal(h.controller.conversation.getSnapshot().draftText, "draft 19");
  assert.equal(await h.controller.flushConversationDraft(), true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sourcePath, SOURCE_PATH);
  assert.equal(saved[0].text, "draft 19");
  session.beginLoad(b);
  const switched = h.controller.conversation.getSnapshot();
  assert.equal(switched.context.documentId, "doc_b");
  assert.deepEqual(switched.messages, []);
  assert.equal(switched.draftText, "");
  assert.equal(session.publish(a, { conversation: record }), false);
  assert.equal(h.controller.conversation.getSnapshot(), switched);
  session.fail(b, new Error("load failed"));
  assert.equal(h.controller.conversation.getSnapshot().status, "failed");
  unsubscribe();
  const beforeUnsubscribe = localUpdates;
  session.deactivate();
  assert.equal(localUpdates, beforeUnsubscribe);
  h.controller.dispose();
  const disposed = h.controller.conversation.getSnapshot();
  session.beginLoad(a);
  assert.equal(h.controller.conversation.getSnapshot(), disposed);
});

test("PROJECT.md content stays local while composition, save and restore notify shell", async (t) => {
  const h = createProjectRulesHarness();
  t.after(() => h.controller.dispose());
  await h.controller.openProjectRules({ context: h.context });
  const rules = h.controller.projectRules;
  const initial = h.controller.shell.getSnapshot();
  let shellUpdates = 0;
  let localUpdates = 0;
  h.controller.shell.subscribe(() => { shellUpdates += 1; });
  const unsubscribe = rules.subscribe(() => { localUpdates += 1; });
  h.controller.updateProjectRules({ content: "# New" });
  h.controller.updateProjectRules({ content: "# New rules" });
  assert.equal(localUpdates, 2);
  assert.equal(shellUpdates, 0);
  assert.equal(h.controller.shell.getSnapshot(), initial);
  assert.equal("content" in initial.projectRules, false);
  assert.equal("savedContent" in initial.projectRules, false);
  assert.equal(rules.getSnapshot().content, "# New rules");
  assert.equal(rules.getSnapshot(), h.controller.getSnapshot().projectRules);
  const target = {};
  h.controller.beginProjectRulesComposition({ target, baselineValue: "# New rules" });
  assert.equal(rules.getSnapshot().compositionActive, true);
  assert.equal(h.controller.shell.getSnapshot().projectRules.compositionActive, true);
  assert.equal((await h.controller.saveProjectRules()).status, "blocked");
  h.controller.finishProjectRulesComposition({ target });
  assert.equal(rules.getSnapshot().compositionActive, false);
  assert.equal((await h.controller.saveProjectRules()).status, "succeeded");
  assert.equal(h.persisted, "# New rules");
  h.controller.updateProjectRules({ content: "unsaved" });
  h.controller.restoreProjectRules();
  assert.equal(rules.getSnapshot().content, "# New rules");
  assert.equal(shellUpdates > 0, true);
  unsubscribe();
  const beforeUnsubscribe = localUpdates;
  h.controller.updateProjectRules({ content: "later" });
  assert.equal(localUpdates, beforeUnsubscribe);
});
