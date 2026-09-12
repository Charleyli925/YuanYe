import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BridgeRequestError } from "../app/application/bridge-client.js";
import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DocumentWorkflow } from "../app/application/document-workflow.js";
import { ProjectSession } from "../app/application/project-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { auditEventKey, removeAcknowledgedAuditEvents } from "../app/lib/audit-events.js";
import { appendDirectEditEvent } from "../app/lib/direct-edit-events.js";
const SOURCE_PATH = "/tmp/document-workflow.html";
const PROJECT_ID = "project_document_workflow";
const DOCUMENT_ID = "document_document_workflow";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createScheduler() {
  let sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    run(id) {
      const task = tasks.get(id);
      tasks.delete(id);
      task?.callback();
    },
    get pending() {
      return [...tasks.entries()].map(([id, task]) => ({ id, ...task }));
    },
  };
}

function operation(before, after) {
  let startOffset = 0;
  while (
    startOffset < before.length
    && startOffset < after.length
    && before[startOffset] === after[startOffset]
  ) startOffset += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > startOffset
    && afterEnd > startOffset
    && before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    operationId: "sourceop_document_workflow_001",
    kind: "text",
    editRevision: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: beforeEnd,
      before: before.slice(startOffset, beforeEnd),
      after: after.slice(startOffset, afterEnd),
      kind: "text",
    }],
    reversePatches: [{
      startOffset,
      endOffset: afterEnd,
      before: after.slice(startOffset, afterEnd),
      after: before.slice(startOffset, beforeEnd),
      kind: "inverse:text",
    }],
    beforeTarget: { id: "target-history", text: "one", resolution: "exact" },
    afterTarget: { id: "target-history", text: "two", resolution: "exact" },
    beforeSelection: { anchor: startOffset, focus: startOffset + 3, affinity: "right" },
    afterSelection: { anchor: startOffset + 3, focus: startOffset + 3, affinity: "right" },
  };
}

function createHarness({
  html = "<!doctype html><html><body><p>one</p></body></html>",
  bridge = {},
  codecOverrides = {},
  canvasOverrides = {},
  registered = true,
  ensureRegistered,
  recoveryJournal = null,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const context = {
    epoch: projectSession.epoch,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
  };
  if (registered) projectSession.register(context);
  const documentSession = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
  });
  const commentSession = new CommentSession();
  const versionSession = new VersionSession();
  const sourceHistorySession = new SourceHistorySession();
  sourceHistorySession.activate(
    context,
    sha256(html),
    null,
  );
  const scheduler = createScheduler();
  const canvas = {
    invalidations: 0,
    history: [],
    invalidateRenderAcks() {
      this.invalidations += 1;
    },
    adoptHistorySource(htmlValue, target, selection) {
      this.history.push({ html: htmlValue, target, selection });
    },
    ...canvasOverrides,
  };
  const client = {
    async autosave() {
      throw new Error("autosave test double was not configured");
    },
    async source() {
      throw new Error("source test double was not configured");
    },
    async workspace() {
      return {};
    },
    async resolveConflict() {
      return {};
    },
    ...bridge,
  };
  const workflow = new DocumentWorkflow({
    bridgeClient: client,
    ensureRegistered: ensureRegistered || (async () => ({
      status: "succeeded",
      value: context,
    })),
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    codecs: {
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
      appendDirectEditEvent,
      auditEventKey,
      removeAcknowledgedAuditEvents,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
      ...codecOverrides,
    },
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      ...(recoveryJournal ? { recoveryJournal } : {}),
      canvas,
    },
    scheduler,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  return {
    workflow,
    context,
    projectSession,
    client,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    scheduler,
    canvas,
  };
}

test("DocumentWorkflow detaches a failed source only after Main journal readback evidence", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "protected");
  const committed = [];
  const recoveryJournal = {
    async commit(input) {
      committed.push(structuredClone(input));
      return {
        schemaVersion: "1.0.0",
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(JSON.stringify(input)),
        updatedAt: "2026-09-01T00:00:00.000Z",
        byteLength: Buffer.byteLength(input.html),
      };
    },
    async readVerified() {
      return null;
    },
    async remove() {
      return { removed: true };
    },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave() {
        throw new BridgeRequestError("SOURCE_WRITE_FAILED", "disk denied");
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const failed = await harness.workflow.flush({ throughRevision: 1 });
  assert.notEqual(failed.status, "succeeded");
  assert.equal(harness.documentSession.persistState, "failed");

  const protectedOutcome = await harness.workflow.protectForDetach({
    context: harness.context,
  });
  assert.equal(protectedOutcome.status, "succeeded");
  assert.equal(protectedOutcome.value.evidence, "recoveryVerified");
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: harness.context,
    revision: 1,
  }), true);
  assert.equal(committed.at(-1).html, after);
  assert.equal(committed.at(-1).revision, 1);
});

test("DocumentWorkflow remains fail-closed when journal acknowledgement Hash is wrong", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "unsafe");
  const harness = createHarness({
    html: before,
    recoveryJournal: {
      async commit(input) {
        return {
          ...input,
          recoveryHtmlSha256: sha256("different"),
          journalSha256: sha256("journal"),
          updatedAt: "2026-09-01T00:00:00.000Z",
        };
      },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.protectForDetach({ context: harness.context });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: harness.context,
    revision: 1,
  }), false);
});

test("DocumentWorkflow rebases an exact recovery receipt after the source file moves", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "protected-move");
  const movedPath = "/tmp/moved/document-workflow.html";
  let receipt = null;
  let rebaseCalls = 0;
  let readCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`move:${input.sourcePath}:${input.revision}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() {
      readCalls += 1;
      return receipt;
    },
    async rebase(input) {
      rebaseCalls += 1;
      assert.equal(input.previousSourcePath, SOURCE_PATH);
      assert.equal(input.sourcePath, movedPath);
      assert.equal(input.expectedJournalSha256, receipt.journalSha256);
      if (rebaseCalls === 1) throw new Error("transient rebase failure");
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`move:${movedPath}:${receipt.revision}`),
      };
      return receipt;
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });
  const rebased = await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  });
  assert.equal(rebased.status, "succeeded");
  assert.equal(rebased.value.rebased, true);
  assert.equal(rebaseCalls, 2);
  assert.equal(readCalls, 1);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: nextContext,
    revision: 1,
  }), true);
});

test("DocumentWorkflow adopts Main authority when a journal rebase ACK is lost", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "lost-ack");
  const movedPath = "/tmp/moved/lost-ack.html";
  let receipt = null;
  let rebaseCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`lost-ack:${input.sourcePath}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async rebase() {
      rebaseCalls += 1;
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`lost-ack:${movedPath}`),
      };
      throw new Error("ACK lost after publish");
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });

  const rebased = await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  });

  assert.equal(rebased.status, "succeeded");
  assert.equal(rebaseCalls, 1);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
});

test("detach retries a stranded journal rebase after a moved source settles", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "retry-on-detach");
  const movedPath = "/tmp/moved/retry-on-detach.html";
  let receipt = null;
  let rebaseCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`detach:${input.sourcePath}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async rebase() {
      rebaseCalls += 1;
      if (rebaseCalls < 3) throw new Error("injected transient rebase failure");
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`detach:${movedPath}`),
      };
      return receipt;
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });
  assert.equal((await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  })).status, "rejected");

  const protectedDetach = await harness.workflow.protectForDetach({
    context: nextContext,
  });

  assert.equal(protectedDetach.status, "succeeded");
  assert.equal(protectedDetach.value.evidence, "recoveryVerified");
  assert.equal(rebaseCalls, 3);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
});

test("DocumentWorkflow accepts only an exact exported HTML Hash as detach evidence", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "exported");
  const harness = createHarness({ html: before });
  harness.workflow.enqueueEdit({ html: after });

  const invalid = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 1,
    exported: { path: "/tmp/report-copy.html", sha256: sha256("wrong") },
  });
  assert.equal(invalid.status, "rejected");

  const verified = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 1,
    exported: { path: "/tmp/report-copy.html", sha256: sha256(after) },
  });
  assert.equal(verified.status, "succeeded");
  assert.equal(verified.value.evidence, "exportVerified");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 1,
  }), true);
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).value.evidence, "exportVerified");

  const newer = after.replace("exported", "edited-after-export");
  harness.workflow.enqueueEdit({ html: newer });
  const raced = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 2,
    exported: { path: "/tmp/report-copy.html", sha256: sha256(after) },
  });
  assert.equal(raced.status, "blocked");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 2,
  }), false);
});

test("DocumentWorkflow can protect failed HTML before explicitly reloading the disk version", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const after = before.replace("disk", "protected-unsaved");
  const recoveryJournal = {
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`reload:${input.revision}`),
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
    },
    async readVerified() { return null; },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave() { throw new Error("disk denied"); },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: before,
          sha256: sha256(before),
          lastModifiedAt: "2026-09-02T00:00:00.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  assert.notEqual((await harness.workflow.flush()).status, "succeeded");
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 1,
  }), true);

  const reloaded = await harness.workflow.reloadAuthority({ context: harness.context });
  assert.equal(reloaded.status, "succeeded");
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.documentSession.workingHtmlSha256, sha256(before));
});

test("DocumentWorkflow restores source-history and recovery authority after a project transition reset", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("transition-recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 1,
  };
  const pending = operation(before, after);
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.sourceHistorySession.restorePendingEvidence(harness.context, [pending]);
  const authority = harness.workflow.captureProjectTransitionAuthority();

  harness.workflow.resetForProjectTransition();
  assert.equal(harness.workflow.recoveryIdentity, null);
  assert.equal(harness.sourceHistorySession.snapshot, null);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);

  assert.equal(harness.workflow.restoreProjectTransitionAuthority({
    authority,
    context: harness.context,
    sourceSha256: sha256(before),
  }), true);
  assert.deepEqual(harness.workflow.recoveryIdentity, recoveryIdentity);
  assert.equal(harness.sourceHistorySession.capabilities.depth, 0);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, [pending]);
});

test("DocumentWorkflow coalesces a 100ms source write and only accepts exact HTML/Hash acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({ html: after });
  assert.equal(queued.status, "succeeded");
  assert.equal(queued.value.revision, 1);
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [100]);
  assert.equal(harness.documentSession.persistState, "queued");

  const outcome = await harness.workflow.flush({ throughRevision: 1 });
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].html, after);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow flushes a native-edit checkpoint immediately", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({
    html: after,
    mutation: {
      kind: "text",
      property: "editableIslandHtml",
      target: { id: "island" },
    },
  });
  assert.equal(queued.status, "succeeded");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), []);
  const outcome = await harness.workflow.flush();
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rebinds a moved Working Copy before the next autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const final = after.replace("two", "three");
  const movedPath = "/tmp/project-renamed/document-V1.html";
  const initialTarget = {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/project-original",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_PATH,
    sourceSha256: sha256(before),
  };
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        const currentTarget = {
          ...initialTarget,
          projectRootPath: "/tmp/project-renamed",
          exactSourcePath: movedPath,
          sourceSha256: sha256(body.html),
        };
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          openTarget: currentTarget,
          activeDraft: {
            draftRevision: 0,
            comments: [],
            changeEvents: [],
            deletedCommentIds: [],
          },
        };
      },
    },
  });
  const registered = harness.projectSession.register({
    ...harness.context,
    openTarget: initialTarget,
  });
  assert.equal(registered?.exactSourcePath, SOURCE_PATH);
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, movedPath);
  assert.equal(harness.projectSession.context?.projectRootPath, "/tmp/project-renamed");
  assert.equal(
    events.find((event) => event.type === "document-open-target-rebound")?.context?.sourcePath,
    movedPath,
  );

  harness.workflow.enqueueEdit({ html: final });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sourcePath, movedPath);
  assert.equal(calls[1].exactSourcePath, movedPath);
  assert.equal(calls[1].projectRootPath, "/tmp/project-renamed");
  assert.equal(calls[1].expectedSourceSha256, sha256(after));
});

test("DocumentWorkflow exposes no user-selected moved-project rebinding API", () => {
  const harness = createHarness();
  assert.equal("rebindRelocatedOpenTarget" in harness.workflow, false);
});

test("DocumentWorkflow rejects an unchainable source transaction without publishing the canvas edit", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const transaction = {
    ...operation(before, after),
    beforeSourceSha256: sha256("a different authoritative source"),
  };

  const outcome = harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: transaction,
  });

  assert.deepEqual(outcome, {
    status: "rejected",
    code: "SOURCE_HISTORY_RECORD_REJECTED",
    reason: "源码历史与当前画布补丁链不一致。",
  });
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.editRevision, 0);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);
  assert.equal(harness.canvas.invalidations, 0);
});

test("DocumentWorkflow drains a newer queued write after an earlier acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const middle = before.replace("one", "two");
  const after = before.replace("one", "three");
  const calls = [];
  let resolveFirst;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave(body) {
        calls.push(body);
        if (calls.length === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: middle });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  harness.workflow.enqueueEdit({ html: after });
  resolveFirst({
    ok: true,
    content: middle,
    sha256: sha256(middle),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].html, after);
  assert.equal(calls[1].expectedSourceSha256, sha256(middle));
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow accepts an older ACK and drains the newer source-history prefix", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const middle = before.replace("one", "two");
  const after = middle.replace("two", "three");
  const calls = [];
  let resolveFirst;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave(body) {
        calls.push(body);
        if (calls.length === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: `2026-08-11T00:00:0${calls.length}.000Z`,
        });
      },
    },
  });

  assert.equal(harness.workflow.enqueueEdit({
    html: middle,
    sourceTransaction: operation(before, middle),
  }).status, "succeeded");
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);

  assert.equal(harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: operation(middle, after),
  }).status, "succeeded");
  resolveFirst({
    ok: true,
    content: middle,
    sha256: sha256(middle),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].html, middle);
  assert.equal(calls[1].html, after);
  assert.equal(calls[1].expectedSourceSha256, sha256(middle));
  assert.equal(calls[1].sourceHistoryOperations.length, 1);
  assert.equal(
    calls[1].sourceHistoryOperations[0].beforeSourceSha256,
    sha256(middle),
  );
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.sourceHistorySession.capabilities.canUndo, true);

  assert.equal(
    (await harness.workflow.performHistoryAction({
      direction: "undo",
      context: harness.context,
    })).status,
    "succeeded",
  );
  assert.equal(harness.documentSession.html, middle);
  assert.equal(
    (await harness.workflow.performHistoryAction({
      direction: "undo",
      context: harness.context,
    })).status,
    "succeeded",
  );
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.sourceHistorySession.capabilities.canRedo, true);
});

test("DocumentWorkflow reconstructs a missing pending write and rebinds comment targets after acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    codecOverrides: {
      rebindTargetsPreservingGlobal: (_html, targets) => targets.map((target) => ({
        ...target,
        selector: "[data-rebound]",
      })),
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          currentExactVersionId: "version_002",
        };
      },
    },
  });
  harness.commentSession.setComments([{
    commentId: "comment_rebind",
    text: "keep target",
    target: { id: "target_rebind", selector: "p", resolution: "exact" },
    attachments: [],
  }]);
  harness.documentSession.beginEdit(after);

  const outcome = await harness.workflow.flush({ throughRevision: 1 });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.commentSession.comments[0].target.selector, "[data-rebound]");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "version_002");
});

test("DocumentWorkflow registers an unbound source write before its first autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrations = 0;
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrations += 1;
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const boundary = harness.workflow.captureLeaveBoundary();
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(registrations, 1);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256(after),
  }).kind, "ready");
});

test("DocumentWorkflow settles a failed first registration as a retryable persistence failure", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrationAttempts = 0;
  let autosaves = 0;
  const events = [];
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrationAttempts += 1;
      if (registrationAttempts === 1) {
        return {
          status: "blocked",
          code: "PROJECT_REGISTRATION_UNAVAILABLE",
          reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
        };
      }
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        autosaves += 1;
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  const first = await harness.workflow.flush();

  assert.deepEqual(first, {
    status: "blocked",
    code: "PROJECT_REGISTRATION_UNAVAILABLE",
    reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
  });
  assert.equal(autosaves, 0);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
  const failure = events.find((event) => event.type === "document-persistence-failed");
  assert.equal(failure?.code, "PROJECT_REGISTRATION_UNAVAILABLE");
  assert.equal(failure?.fatal, false);

  const second = await harness.workflow.flush();

  assert.equal(second.status, "succeeded");
  assert.equal(registrationAttempts, 2);
  assert.equal(autosaves, 1);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rekeys recovery to registered identity before the first autosave resolves", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveAutosave;
  let enteredAutosave;
  const autosaveEntered = new Promise((resolve) => { enteredAutosave = resolve; });
  const commits = [];
  const harness = createHarness({
    html: before,
    registered: false,
    recoveryJournal: {
      async commit(input) {
        commits.push(structuredClone(input));
        return {
          ...input,
          recoveryHtmlSha256: sha256(input.html),
          journalSha256: sha256(`rekey:${input.revision}:${input.html}`),
          updatedAt: "2026-08-11T00:00:00.000Z",
        };
      },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
    ensureRegistered: async () => {
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      autosave() {
        enteredAutosave();
        return new Promise((resolve) => { resolveAutosave = resolve; });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await autosaveEntered;
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(commits.some((record) => (
    record.projectId === PROJECT_ID
    && record.documentId === DOCUMENT_ID
    && record.sourcePath === SOURCE_PATH
    && record.html === after
  )));

  resolveAutosave({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });
  assert.equal((await flushing).status, "succeeded");
});

test("DocumentWorkflow returns stale after a durable acknowledgement races a new project locator", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveWrite;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave() {
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  // The public Session transition, rather than the old write, is the stale authority.
  harness.projectSession.openLocator("/tmp/other.html");
  resolveWrite({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "stale");
});

test("DocumentWorkflow leaves the next document Source History untouched by a stale ACK", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const nextBefore = "<!doctype html><html><body><p>next</p></body></html>";
  const nextAfter = nextBefore.replace("next", "later");
  const nextSourcePath = "/tmp/next-document.html";
  const nextProjectId = "project_document_workflow_next";
  const nextDocumentId = "document_document_workflow_next";
  let resolveWrite;
  const harness = createHarness({
    bridge: {
      autosave() {
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await Promise.resolve();

  harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: nextSourcePath,
    projectId: nextProjectId,
    documentId: nextDocumentId,
  });
  const nextContext = {
    epoch: harness.projectSession.epoch,
    projectId: nextProjectId,
    documentId: nextDocumentId,
    sourcePath: nextSourcePath,
  };
  harness.sourceHistorySession.activate(
    nextContext,
    sha256(nextBefore),
    null,
  );
  harness.sourceHistorySession.record(
    nextContext,
    operation(nextBefore, nextAfter),
    1,
  );
  const expectedSnapshot = structuredClone(harness.sourceHistorySession.snapshot);
  const expectedPending = harness.sourceHistorySession.pendingOperations;

  let activateCalls = 0;
  const activate = harness.sourceHistorySession.activate.bind(harness.sourceHistorySession);
  harness.sourceHistorySession.activate = (...args) => {
    activateCalls += 1;
    return activate(...args);
  };

  resolveWrite({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "stale");
  assert.equal(activateCalls, 0, "inactive-context ACK must not reactivate the old document");
  const actualSnapshot = harness.sourceHistorySession.snapshot;
  assert.deepEqual(actualSnapshot, expectedSnapshot);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, expectedPending);
  assert.equal(harness.sourceHistorySession.capabilities.sourceSha256, sha256(nextAfter));
});

test("DocumentWorkflow rebuilds Source History for an invalid ACK in the current context", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  let activateCalls = 0;
  const activate = harness.sourceHistorySession.activate.bind(harness.sourceHistorySession);
  harness.sourceHistorySession.activate = (...args) => {
    activateCalls += 1;
    return activate(...args);
  };

  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(activateCalls, 1);
  assert.equal(harness.sourceHistorySession.snapshot.projectId, PROJECT_ID);
  assert.equal(harness.sourceHistorySession.capabilities.sourceSha256, sha256(after));
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);
});

test("DocumentWorkflow preserves recovery and fails closed when autosave acknowledgement bytes differ", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html.replace("two", "three"),
          sha256: sha256(body.html.replace("two", "three")),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "INVALID_AUTOSAVE_ACK");
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
});

test("DocumentWorkflow keeps an externally accepted source when its canvas cannot render", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const events = [];
  const harness = createHarness({
    html: before,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render external source");
      },
    },
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return { ok: true };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    acceptExternalConflict: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(conflictResolutions, [{
    ...harness.context,
    action: "force-unlock",
  }]);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(external));
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(
    events.some((event) => event.type === "document-authority-reloaded"),
    true,
  );
});

test("DocumentWorkflow preserves a prior external acceptance when reloading its authority", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  let conflictResolutions = 0;
  const events = [];
  const harness = createHarness({
    html: before,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render external source");
      },
    },
    bridge: {
      async resolveConflict() {
        conflictResolutions += 1;
        return { ok: true };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    externalAuthorityAccepted: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(conflictResolutions, 0);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(
    events.some((event) => event.type === "document-authority-reloaded"),
    true,
  );
});

test("DocumentWorkflow reconciles an unknown autosave only after reading matching authority", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        throw new BridgeRequestError("timeout", { status: 503, outcome: "unknown" });
      },
      async workspace() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          currentHtmlSha256: sha256(after),
          lastPersistedRevision: 1,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: after,
          sha256: sha256(after),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.reconciled, true);
  assert.equal(calls.length, 1);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow restores a matching crash journal into the same durable queue", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 2,
  };
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 2,
        html: after,
        recoveryHtmlSha256: sha256(after),
        journalSha256: sha256("crash-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`crash:${input.revision}`),
        updatedAt: "2026-09-01T00:00:03.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.client.autosave = async (body) => ({
    ok: true,
    content: body.html,
    sha256: sha256(body.html),
    persistedRevision: body.editRevision,
    lastModifiedAt: "2026-08-11T00:00:03.000Z",
  });

  const recovered = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });

  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.value.queued, true);
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.editRevision, 3);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [0]);
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow does not recover document HTML without a Main journal", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({ html: before });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.recovered, false);
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.pendingWrite, null);
});

test("DocumentWorkflow restores only verified Main journal HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const journalHtml = before.replace("one", "older-main");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "1.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        expectedSourceSha256: sha256(before),
        revision: 2,
        html: journalHtml,
        recoveryHtmlSha256: sha256(journalHtml),
        journalSha256: sha256("older-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`journal:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, journalHtml);
  assert.equal(harness.documentSession.editRevision, 3);
});

test("DocumentWorkflow automatically restores a verified Main journal without local metadata", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const recoveredHtml = before.replace("one", "main-only");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 3,
        html: recoveredHtml,
        recoveryHtmlSha256: sha256(recoveredHtml),
        journalSha256: sha256("main-only-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`main-only:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 1,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, recoveredHtml);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.documentSession.workingHtmlSha256, sha256(recoveredHtml));
});

test("DocumentWorkflow restores Main journal HTML without browser audit events", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const recoveredHtml = before.replace("one", "merged");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 4,
        html: recoveredHtml,
        recoveryHtmlSha256: sha256(recoveredHtml),
        journalSha256: sha256("merged-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`merged:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 1,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, recoveredHtml);
  assert.deepEqual(harness.commentSession.changeEvents, []);
});

test("DocumentWorkflow keeps one journal in flight and coalesces to the latest pending HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const commits = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const recoveryJournal = {
    async commit(input) {
      commits.push(structuredClone(input));
      if (commits.length === 1) await firstBlocked;
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`coalesced:${input.revision}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async readVerified() { return null; },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-1") });
  await Promise.resolve();
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-2") });
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-3") });
  assert.equal(commits.length, 1);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(commits.length, 2);
  assert.equal(commits[1].revision, 3);
  assert.equal(commits[1].html, before.replace("one", "revision-3"));
});

test("DocumentWorkflow waits for exact CAS retirement after source persistence succeeds", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "saved-and-retired");
  let receipt = null;
  const removals = [];
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`retire:${input.revision}`),
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async remove(input) {
      removals.push(structuredClone(input));
      assert.equal(input.sourcePath, SOURCE_PATH);
      assert.equal(input.revision, receipt.revision);
      assert.equal(input.recoveryHtmlSha256, receipt.recoveryHtmlSha256);
      assert.equal(input.expectedJournalSha256, receipt.journalSha256);
      receipt = null;
      return { removed: true };
    },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-02T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  assert.equal((await harness.workflow.flush({ throughRevision: 1 })).status, "succeeded");
  assert.equal(removals.length, 1);
  assert.equal(receipt, null);
  assert.equal(harness.workflow.recoveryCheckpoint, null);
});

test("DocumentWorkflow drains edits queued during recovery retirement without a second user action", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  let releaseRetirement;
  let retirementStarted;
  const retiring = new Promise((resolve) => { retirementStarted = resolve; });
  const barrier = new Promise((resolve) => { releaseRetirement = resolve; });
  let receipt = null;
  let removals = 0;
  const writes = [];
  const harness = createHarness({
    html: before,
    recoveryJournal: {
      async commit(input) {
        receipt = {
          ...input,
          recoveryHtmlSha256: sha256(input.html),
          journalSha256: sha256(`retirement-race:${input.revision}`),
          updatedAt: "2026-09-07T00:00:00.000Z",
        };
        return receipt;
      },
      async readVerified() { return receipt; },
      async remove() {
        if (++removals === 1) {
          retirementStarted();
          await barrier;
        }
        receipt = null;
        return { removed: true };
      },
    },
    bridge: {
      async autosave(body) {
        writes.push(body);
        return {
          ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-07T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: before.replace("one", "two") });
  await harness.workflow.protectForDetach({ context: harness.context });
  const first = harness.workflow.flush();
  await retiring;
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  harness.workflow.enqueueEdit({ html: before.replace("one", "three") });
  // Several native checkpoints may join the same finishing flush. They must
  // share the next write, with the latest exact expected Hash, rather than
  // returning the old receipt or starting parallel writes.
  const followers = [harness.workflow.flush(), harness.workflow.flush(), harness.workflow.flush()];
  releaseRetirement();
  const outcomes = await Promise.all([first, ...followers]);
  assert.ok(outcomes.every((outcome) => outcome.status === "succeeded"));
  assert.deepEqual(writes.map((write) => write.editRevision), [1, 2]);
  assert.equal(writes[1].expectedSourceSha256, sha256(writes[0].html));
  assert.equal(writes[1].html, before.replace("one", "three"));
  assert.equal(harness.documentSession.lastPersistedRevision, 2);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow never claims a newer journal receipt while deleting stale recovery", async () => {
  let reads = 0;
  let removals = 0;
  const harness = createHarness({
    recoveryJournal: {
      async readVerified() {
        reads += 1;
        return null;
      },
      async commit() {
        throw new Error("commit is not expected");
      },
      async remove() {
        removals += 1;
        return { removed: true };
      },
    },
  });

  harness.workflow.clearRecovery(harness.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.equal(removals, 0);
});

test("DocumentWorkflow applies current-open undo locally and saves the resulting full HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const entry = operation(before, after);
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  assert.equal(harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: entry,
    context: harness.context,
  }).status, "succeeded");
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.sourceHistorySession.capabilities.canUndo, true);

  const outcome = await harness.workflow.performHistoryAction({
    direction: "undo",
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].html, after);
  assert.equal(calls[1].html, before);
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.canvas.history.length, 1);
  assert.equal(harness.sourceHistorySession.capabilities.canRedo, true);
});

for (const change of ["hash", "working-copy", "project-root"]) {
  test(`DocumentWorkflow history drain accepts only a same-member Hash refresh (${change})`, async () => {
    const before = "<!doctype html><html><body><p>one</p></body></html>";
    const after = before.replace("one", "two");
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: "/tmp/managed-project", targetKind: "working-copy",
      workingCopyId: "work_ver_0001", versionId: "ver_0001",
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const writes = [];
    const harness = createHarness({ html: before, bridge: {
      async autosave(body) {
        writes.push(body);
        return { ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: "2026-09-07T00:00:00.000Z",
          openTarget: { ...target, sourceSha256: sha256(body.html),
            ...(change === "working-copy" ? { workingCopyId: "work_ver_0002", versionId: "ver_0002" } : {}),
            ...(change === "project-root" ? { projectRootPath: "/tmp/other-project" } : {}),
          } };
      },
    } });
    harness.projectSession.refreshOpenTarget(target);
    const context = harness.projectSession.context;
    harness.sourceHistorySession.activate(context, sha256(before), null);
    harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context });
    const outcome = await harness.workflow.performHistoryAction({ direction: "undo", context });
    if (change === "hash") {
      assert.equal(outcome.status, "succeeded");
      assert.deepEqual(writes.map((write) => write.html), [after, before]);
      assert.equal(harness.documentSession.html, before);
    } else {
      assert.equal(outcome.status, "stale");
      assert.equal(writes.length, 1);
      assert.equal(harness.documentSession.html, after);
    }
  });
}

test("DocumentWorkflow force-unlock adopts disk HTML and clears persistence conflict", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(body) {
        assert.equal(body.action, "force-unlock");
        return { ok: true, status: "force-unlocked" };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  harness.documentSession.setPersistence({
    state: "conflict",
    error: "源文件在磁盘上被其他程序修改了。",
  });
  harness.documentSession.setEditRevision(3);

  const outcome = await harness.workflow.forceUnlockConflict({
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(external));
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.lastPersistedRevision, 3);
});

test("DocumentWorkflow reloadAuthority adopts a Working Copy conflict through force-unlock", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return { ok: true, status: "force-unlocked" };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:03.000Z",
        };
      },
    },
  });
  harness.documentSession.setPersistence({
    state: "conflict",
    error: "源文件在磁盘上被其他程序修改了。",
  });

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    acceptExternalConflict: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(conflictResolutions, [{
    ...harness.context,
    action: "force-unlock",
  }]);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
});

test("DocumentWorkflow treats matching source-stat hashes as a save echo", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return { sha256: sha256(html), lastModifiedAt: "2026-08-11T00:00:02.000Z", size: 40 };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, false);
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow projects a conflict when source-stat hash diverges", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return {
          sha256: sha256(html.replace("one", "two")),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          size: 40,
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, true);
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange keeps the editor when disk hash matches", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: html,
          sha256: sha256(html),
          lastModifiedAt: "2026-08-15T00:00:00.000Z",
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange enters conflict without adopting disk bytes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const disk = html.replace("one", "external");
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: disk,
          sha256: sha256(disk),
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(html));
});

test("observeExternalSourceChange ignores stale paths and in-flight writes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let sourceCalls = 0;
  const harness = createHarness({
    html,
    bridge: {
      async source() {
        sourceCalls += 1;
        throw new Error("should not read while writing");
      },
    },
  });

  const stale = await harness.workflow.observeExternalSourceChange({
    sourcePath: "/tmp/other-document.html",
  });
  assert.equal(stale.status, "succeeded");
  assert.equal(stale.value.ignored, true);

  harness.documentSession.setPersistence({ state: "writing" });
  const deferred = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });
  assert.equal(deferred.status, "succeeded");
  assert.equal(deferred.value.deferred, true);
  assert.equal(sourceCalls, 0);
});

test("ensureCurrentCanvas records verified authority after a successful render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({ html });
  const outcome = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(harness.documentSession.canvasAuthority, {
    status: "verified",
    generation: 0,
    renderedSha256: sha256(html),
    error: null,
  });
});

test("ensureCurrentCanvas reuses an exact clean verified Canvas without another render fence", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let verifyCalls = 0;
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        verifyCalls += 1;
      },
    },
  });
  assert.equal((await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  })).status, "succeeded");

  const reused = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(reused.status, "succeeded");
  assert.equal(reused.value.reusedCanvasAuthority, true);
  assert.equal(verifyCalls, 1);
});

test("ensureCurrentCanvas fails closed when the canvas cannot render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render");
      },
    },
  });
  const outcome = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(harness.documentSession.canvasAuthority.generation, 0);
});

for (const change of ['none', 'working-copy', 'project-root', 'epoch', 'invalid-ack', 'independent-edit']) {
  test(`DocumentWorkflow serializes queued Undo then Redo against verified history receipts (${change})`, async () => {
    const before = '<!doctype html><html><body><p>one</p></body></html>';
    const after = before.replace('one', 'two');
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: '/tmp/managed-project', targetKind: 'working-copy',
      workingCopyId: 'work_ver_0001', versionId: 'ver_0001',
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const writes = [];
    let releaseUndo;
    const harness = createHarness({ html: before, bridge: {
      async autosave(body) {
        writes.push(body);
        if (writes.length === 2) await new Promise(resolve => { releaseUndo = resolve; });
        return { ok: true, content: body.html,
          sha256: change === 'invalid-ack' && writes.length === 2 ? sha256('wrong receipt') : sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: '2026-09-09T00:00:00.000Z',
          openTarget: { ...target, sourceSha256: sha256(body.html) } };
      },
    } });
    harness.projectSession.refreshOpenTarget(target);
    harness.sourceHistorySession.activate(harness.projectSession.context, sha256(before), null);
    harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context: harness.projectSession.context });
    assert.equal((await harness.workflow.flush()).status, 'succeeded');
    const undo = harness.workflow.performHistoryAction({ direction: 'undo', context: harness.projectSession.context });
    while (!releaseUndo) await new Promise(resolve => setImmediate(resolve));
    const redo = harness.workflow.performHistoryAction({ direction: 'redo', context: harness.projectSession.context });
    assert.notEqual(redo, undo, 'opposite history intents must not share a success receipt');
    if (change === 'working-copy' || change === 'project-root') {
      harness.projectSession.refreshOpenTarget({ ...target, sourceSha256: sha256(after),
        ...(change === 'working-copy' ? { workingCopyId: 'work_ver_0002', versionId: 'ver_0002' } : { projectRootPath: '/tmp/other-project' }) });
    } else if (change === 'epoch') harness.projectSession.openLocator('/tmp/other-document.html');
    else if (change === 'independent-edit') {
      const independent = before.replace('one', 'independent');
      assert.equal(harness.workflow.enqueueEdit({ html: independent,
        sourceTransaction: { ...operation(before, independent), operationId: 'sourceop_document_workflow_002' },
        context: harness.projectSession.context }).status, 'succeeded');
    }
    releaseUndo();
    const outcomes = await Promise.all([undo, redo]);
    if (change === 'none') {
      assert.deepEqual(outcomes.map(outcome => outcome.value?.direction), ['undo', 'redo']);
      assert.deepEqual(writes.map(write => write.html), [after, before, after]);
      assert.equal(writes[2].expectedSourceSha256, sha256(before));
      assert.equal(harness.documentSession.html, after);
      assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
    } else {
      assert.notEqual(outcomes[1].status, 'succeeded');
      if (change === 'independent-edit') {
        assert.equal(harness.documentSession.html, before.replace('one', 'independent'));
        assert.equal(writes.slice(2).some(write => write.html === after), false);
      } else assert.equal(writes.length, 2, 'queued Redo must not write after its route or receipt changes');
    }
    assert.equal(harness.workflow.hasHistoryAction, false);
  });
}


test("DocumentWorkflow does not retarget Undo when a newer edit arrives during its initial drain", async () => {
  const before = '<!doctype html><html><body><p>one</p></body></html>';
  const after = before.replace('one', 'two');
  const newer = before.replace('one', 'three');
  let releaseSave;
  const writes = [];
  const harness = createHarness({ html: before, bridge: {
    async autosave(body) {
      writes.push(body);
      if (writes.length === 1) await new Promise(resolve => { releaseSave = resolve; });
      return { ok: true, content: body.html, sha256: sha256(body.html),
        persistedRevision: body.editRevision, lastModifiedAt: '2026-09-09T00:00:00.000Z' };
    },
  } });
  harness.sourceHistorySession.activate(harness.context, sha256(before), null);
  harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context: harness.context });
  const undo = harness.workflow.performHistoryAction({ direction: 'undo', context: harness.context });
  while (!releaseSave) await new Promise(resolve => setImmediate(resolve));
  harness.workflow.enqueueEdit({ html: newer, sourceTransaction: operation(after, newer), context: harness.context });
  releaseSave();
  assert.equal((await undo).status, 'stale');
  assert.equal(harness.documentSession.html, newer);
  assert.equal((await harness.workflow.flush()).status, 'succeeded');
  assert.deepEqual(writes.map(write => write.html), [after, newer]);
});


test("leave readiness is current evidence, not a permission retained across an edit", (t) => {
  const h = createHarness();
  t.after(() => h.workflow.dispose());
  assert.equal(h.documentSession.confirmCanvas({ generation: 0,
    renderedSha256: sha256(h.documentSession.html) }), true);
  assert.equal(h.workflow.inspectLeaveReadiness().action, "reuse-verified");
  assert.equal(h.workflow.inspectLeaveReadiness({ hasPendingNativeEdit: true }).action, "full-check");
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, { needsSourceProtection: true,
    committedSourceSha256: sha256(h.documentSession.html) }).kind, "ready");
  h.documentSession.beginEdit(h.documentSession.html.replace("one", "newer"));
  assert.equal(h.workflow.inspectLeaveReadiness().action, "full-check");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

test("leave boundary cannot cross a same-byte document switch or source replacement", (t) => {
  for (const change of ["context", "source"]) {
    const h = createHarness();
    t.after(() => h.workflow.dispose());
    const boundary = h.workflow.captureLeaveBoundary();
    if (change === "context") h.projectSession.openLocator("/tmp/another-document.html");
    else h.documentSession.update({ html: h.documentSession.html.replace("one", "replacement") });
    assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED", change);
  }
});

test("leave checks source protection independently of a stale rendered projection", (t) => {
  const h = createHarness();
  t.after(() => h.workflow.dispose());
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(h.workflow.inspectLeaveReadiness().action, "full-check");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256(h.documentSession.html),
  }).kind, "ready");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256("different"),
  }).code, "PROJECT_SWITCH_SOURCE_MISMATCH");
  h.workflow.dispose();
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

for (const change of ["none", "working-copy", "project-root", "epoch"]) {
  test(`leave boundary consumes an actual managed autosave acknowledgement (${change})`, async (t) => {
    const before = "<!doctype html><html><body><p>one</p></body></html>";
    const after = before.replace("one", "two");
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: "/tmp/managed-project", targetKind: "working-copy",
      workingCopyId: "work_ver_0001", versionId: "ver_0001",
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const h = createHarness({ html: before, bridge: {
      async autosave(body) {
        return { ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: "2026-09-12T00:00:00.000Z",
          openTarget: { ...target, sourceSha256: sha256(body.html) } };
      },
    } });
    t.after(() => h.workflow.dispose());
    h.projectSession.refreshOpenTarget(target);
    assert.equal(h.workflow.enqueueEdit({ html: after, context: h.projectSession.context }).status, "succeeded");
    const boundary = h.workflow.captureLeaveBoundary();
    assert.equal(boundary.context.sourceSha256, sha256(before));
    const saved = await h.workflow.flush();
    assert.equal(saved.status, "succeeded", JSON.stringify(saved));
    assert.equal(h.projectSession.context.sourceSha256, sha256(after));
    assert.equal(h.projectSession.matches(boundary.context), false,
      "the pre-save target hash is stale even though this is the same managed source");
    if (change === "working-copy" || change === "project-root") {
      h.projectSession.refreshOpenTarget({ ...target, sourceSha256: sha256(after),
        ...(change === "working-copy"
          ? { workingCopyId: "work_ver_0002", versionId: "ver_0002" }
          : { projectRootPath: "/tmp/other-project" }) });
    } else if (change === "epoch") h.projectSession.openLocator(SOURCE_PATH);
    const result = h.workflow.verifyLeaveBoundary(boundary, {
      needsSourceProtection: true, committedSourceSha256: sha256(after),
    });
    assert.equal(result.kind, change === "none" ? "ready" : "reject", JSON.stringify(result));
    if (change !== "none") assert.equal(result.code, "PROJECT_SWITCH_SOURCE_CHANGED");
  });
}


test("unregistered leave boundary still rejects a different source locator", (t) => {
  const h = createHarness({ registered: false });
  t.after(() => h.workflow.dispose());
  const boundary = h.workflow.captureLeaveBoundary();
  h.projectSession.openLocator("/tmp/different-unregistered.html");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

test("first registration may leave through fresh recovery evidence when source save fails", async (t) => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "protected");
  const h = createHarness({ html: before, registered: false,
    ensureRegistered: async () => succeededRegistration(),
    bridge: { async autosave() { throw new BridgeRequestError("SOURCE_WRITE_FAILED", "disk denied"); } },
    recoveryJournal: {
      async commit(input) { return { schemaVersion: "1.0.0", ...input,
        recoveryHtmlSha256: sha256(input.html), journalSha256: sha256(JSON.stringify(input)),
        updatedAt: "2026-09-12T00:00:00.000Z", byteLength: Buffer.byteLength(input.html) }; },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
  });
  function succeededRegistration() {
    return { status: "succeeded", value: h.projectSession.register({
      epoch: h.projectSession.epoch, projectId: PROJECT_ID, documentId: DOCUMENT_ID, sourcePath: SOURCE_PATH,
    }) };
  }
  t.after(() => h.workflow.dispose());
  h.workflow.enqueueEdit({ html: after });
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(boundary.context.projectId, "");
  assert.notEqual((await h.workflow.flush()).status, "succeeded");
  assert.equal(h.projectSession.context.projectId, PROJECT_ID);
  const input = { needsSourceProtection: true, committedSourceSha256: sha256(after) };
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, input).kind, "reject");
  assert.equal((await h.workflow.protectForDetach({ context: h.projectSession.context })).status, "succeeded");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, input).kind, "ready");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    ...input, committedSourceSha256: sha256("wrong frozen source"),
  }).code, "PROJECT_SWITCH_PROTECTION_MISMATCH");
  assert.equal(h.documentSession.persistState, "failed");
  assert.equal(h.documentSession.persistedSourceSha256, sha256(before));
});
