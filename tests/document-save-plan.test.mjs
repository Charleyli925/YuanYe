import assert from "node:assert/strict";
import test from "node:test";

import {
  planDocumentEnqueue,
  planDocumentSave,
  planDocumentLeaveReadiness,
  planDocumentLeaveAfterDrain,
  planDocumentLeaveProtection,
} from "../app/application/document/save-plan.js";
import {
  copyProjectContext,
  verifyProjectContext,
} from "../app/application/verified-project-context.js";

test("document enqueue plan rejects disposed and conflict, and is ready otherwise", () => {
  assert.equal(planDocumentEnqueue({ disposed: true }).kind, "reject");
  assert.equal(planDocumentEnqueue({ persistState: "conflict" }).code, "DOCUMENT_PERSISTENCE_CONFLICT");
  assert.equal(planDocumentEnqueue({ persistState: "idle" }).kind, "ready");
});

test("document save plan waits for an in-flight flush and idles when caught up", () => {
  assert.equal(planDocumentSave({ flushInFlight: true }).kind, "wait");
  assert.deepEqual(planDocumentSave({
    pendingWrite: null,
    editRevision: 3,
    lastPersistedRevision: 3,
  }), { kind: "ready", action: "idle", revision: 3 });
  assert.equal(planDocumentSave({
    pendingWrite: null,
    editRevision: 4,
    lastPersistedRevision: 3,
  }).code, "DOCUMENT_SOURCE_UNBOUND");
  assert.equal(planDocumentSave({
    pendingWrite: { sourcePath: "/tmp/page.html" },
    editRevision: 4,
    lastPersistedRevision: 3,
  }).action, "write");
});

test("VerifiedProjectContext is a frozen snapshot and never matches a different live session", () => {
  const context = copyProjectContext({
    epoch: 2,
    projectId: "project_a",
    documentId: "document_a",
    sourcePath: "/tmp/a.html",
  });
  assert.ok(Object.isFrozen(context));
  const live = {
    epoch: 2,
    sourcePath: "/tmp/a.html",
    matches(candidate) {
      return candidate.projectId === "project_a" && candidate.documentId === "document_a";
    },
  };
  const verified = verifyProjectContext(context, live);
  assert.equal(verified.sourcePath, "/tmp/a.html");
  assert.equal(verifyProjectContext(context, {
    ...live,
    matches: () => false,
  }), null);
  assert.equal(verifyProjectContext(context, live, { disposed: true }), null);
});

test("document leave rejects a post-cutoff edit", () => {
  assert.equal(
    planDocumentLeaveAfterDrain({
      editRevision: 2,
      cutoffRevision: 1,
    }).code,
    "PROJECT_SWITCH_SOURCE_CHANGED",
  );
  assert.equal(planDocumentLeaveAfterDrain({
    editRevision: 1,
    cutoffRevision: 1,
  }).kind, "ready");
});

test("project switch reuses only a clean exact Canvas validation lease", () => {
  const exact = {
    obligationsResolved: true,
    persistState: "idle",
    editRevision: 4,
    lastPersistedRevision: 4,
    sourcePath: "/tmp/a.html",
    persistedSourceSha256: "sha256:aaa",
    canvasStatus: "verified",
    renderedSha256: "sha256:aaa",
  };
  assert.equal(planDocumentLeaveReadiness(exact).action, "reuse-verified");
  assert.equal(planDocumentLeaveReadiness({
    ...exact,
    obligationsResolved: false,
  }).action, "full-check");
  assert.equal(planDocumentLeaveReadiness({
    ...exact,
    hasPendingNativeEdit: true,
  }).action, "full-check");
  assert.equal(planDocumentLeaveReadiness({
    ...exact,
    renderedSha256: "sha256:bbb",
  }).action, "full-check");
});

test("project switch after-drain plan validates Working HTML instead of presentation freshness", () => {
  assert.equal(
    planDocumentLeaveProtection({
      needsSourceProtection: true,
      sourcePath: "/tmp/a.html",
      lastPersistedRevision: 2,
      cutoffRevision: 1,
      committedSourceSha256: "sha256:aaa",
      persistedSourceSha256: "sha256:aaa",
      workingHtmlSha256: "sha256:aaa",
    }).code,
    "PROJECT_SWITCH_SOURCE_MISMATCH",
  );
  assert.equal(
    planDocumentLeaveProtection({
      needsSourceProtection: true,
      sourcePath: "/tmp/a.html",
      lastPersistedRevision: 1,
      cutoffRevision: 1,
      committedSourceSha256: "sha256:aaa",
      persistedSourceSha256: "sha256:aaa",
      workingHtmlSha256: "sha256:aaa",
    }).kind,
    "ready",
  );
  assert.equal(
    planDocumentLeaveProtection({ needsSourceProtection: false }).kind,
    "ready",
  );
});
