import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  editRuntimePort = null,
  initialDocument = null,
  controllerCodecs = codecs,
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
  const versionSession = new VersionSession();
  const sourceHistorySession = new SourceHistorySession();
  const recovery = [];
  let canvasInvalidations = 0;
  const events = [];
  const controller = new WorkspaceController({
    bridgeClient: client,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    codecs: controllerCodecs,
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      recovery: { replace: (identity) => recovery.push(identity) },
      canvas: { invalidateRenderAcks: () => { canvasInvalidations += 1; } },
      ...(projectSource ? { projectSource } : {}),
      ...(editRuntimePort ? { editRuntime: editRuntimePort } : {}),
    },
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
  return { context, controller, runSession, get persisted() { return persisted; } };
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
    },
  });

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, "registration-published");
  assert.equal(harness.events[0].workingCopyRecovered, true);
});

test("managed registration activates the exact V1 Working Copy before publishing Sessions", async () => {
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
    },
    projectSource: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        return {
          sourcePath: workingCopyPath,
          sha256: sha256(managedHtml),
          html: managedHtml,
        };
      },
    },
  });

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, workingCopyPath);
  assert.equal(harness.projectSession.context?.workingCopyId, "work_ver_0001");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
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

test("workspace registration confirms matching canonical bytes without rebuilding the canvas", async () => {
  const html = "<main>canonical source</main>";
  const harness = createHarness({ html });
  const beforeGeneration = harness.documentSession.canvasGeneration;

  const outcome = await harness.controller.ensureRegistered();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration);
  assert.equal(harness.canvasInvalidations, 0);
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
