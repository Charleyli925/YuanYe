import assert from "node:assert/strict";
import test from "node:test";

import { RunSession } from "../app/application/run-session.js";

function run(overrides = {}) {
  return {
    projectId: "project",
    documentId: "document",
    requestId: "request",
    attemptId: "attempt",
    requestPath: "/tmp/request",
    attemptPath: "/tmp/attempt",
    handoffMessage: "message",
    status: "processing",
    sourcePath: "/tmp/page.html",
    baseSnapshotSha256: "sha256:base",
    previousVersionId: null,
    basedOnVersionId: null,
    freezeCutoffRevision: 1,
    candidateVersionId: "version_002",
    candidateVersionLabel: "版本 2",
    submittedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

test("run session activates one source without attaching another project result", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  const background = run({
    projectId: "other",
    requestId: "other-request",
    sourcePath: "/tmp/other.html",
  });
  session.trackRun(current);
  session.trackRun(background);
  session.markResult(background.sourcePath, {
    state: "ready",
    label: "新版本可查看",
    updatedAt: 1,
  });

  assert.equal(session.activeRun, current);
  assert.equal(session.snapshot.backgroundResults.length, 1);
  session.activate(background.sourcePath);
  assert.equal(session.activeRun, background);
});

test("run session rejects a late handoff result from an older run", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.setActiveRun(current);
  assert.equal(session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copying",
  }), true);
  assert.equal(session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: "older-request",
    attemptId: "older-attempt",
    status: "copied",
  }), false);
  assert.equal(session.activeHandoff.status, "copying");
});

test("run session preserves handoff risk after a retry fails", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "failed",
  });

  assert.equal(session.activeHandoff.status, "failed");
  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session preserves copied handoff risk when refreshing the same run", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });

  session.setActiveRun({ ...current, status: "processing" });

  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session distinguishes managed Qoder state from clipboard handoff risk", () => {
  const sourcePath = "/tmp/qoder.html";
  const session = new RunSession({ sourcePath });
  const activeRun = run({ sourcePath, requestId: "req_qoder" });
  session.trackRun(activeRun, { activate: "always" });
  session.publishHandoff({
    ...activeRun,
    mode: "managed-agent",
    status: "running",
    phase: "reading-task",
  });
  assert.equal(session.activeHandoffManaged, true);
  assert.equal(session.activeHandoffMayBeRunning, true);

  session.publishHandoff({
    ...activeRun,
    mode: "managed-agent",
    status: "interrupted",
    phase: "interrupted",
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, false);

  session.publishHandoff({
    ...activeRun,
    mode: "clipboard",
    status: "copying",
  });
  session.publishHandoff({
    ...activeRun,
    mode: "clipboard",
    status: "copied",
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);

});

test("run session keeps only the public execution activity projection", () => {
  const sourcePath = "/tmp/public-session.html";
  const session = new RunSession({ sourcePath });
  const activeRun = run({ sourcePath, requestId: "req_public", attemptId: "attempt_001" });
  session.trackRun(activeRun, { activate: "always" });
  session.publishHandoff({
    ...activeRun,
    mode: "managed-agent",
    status: "running",
    phase: "generating",
    startedAt: "2026-08-26T02:00:00.000Z",
    lastActivityAt: "2026-08-26T02:05:00.000Z",
    receivedBytes: 4_096,
    visibleText: "公开进度",
    errorCode: null,
    errorMessage: null,
    retryable: true,
  });

  assert.equal(session.activeHandoff.lastActivityAt, "2026-08-26T02:05:00.000Z");
  assert.equal(session.activeHandoff.receivedBytes, 4_096);
  assert.equal("stderr" in session.activeHandoff, false);
  assert.equal("reasoning" in session.activeHandoff, false);
});

test("run session treats a recovered processing run as potentially handed off", () => {
  const original = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  original.trackRun(current);
  original.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  assert.equal(original.activeHandoffMayBeRunning, true);

  const recovered = new RunSession({ sourcePath: "/tmp/page.html" });
  recovered.trackRun(current, { recovered: true });
  assert.equal(recovered.activeHandoff, null);
  assert.equal(recovered.activeHandoffMayBeRunning, true);

  const fresh = new RunSession({ sourcePath: "/tmp/page.html" });
  fresh.trackRun(current);
  assert.equal(fresh.activeHandoffMayBeRunning, false);
});

test("run session treats a recovered interrupted Qoder handoff as unmanaged risk", () => {
  const sourcePath = "/tmp/recovered-qoder.html";
  const current = run({
    sourcePath,
    requestId: "req_recovered_qoder",
    agentDelivery: {
      mode: "qoder-acp",
      trustPolicyVersion: "trusted-local-agent-v1",
    },
  });
  const session = new RunSession({ sourcePath });
  const snapshots = [];
  session.subscribe((snapshot) => snapshots.push(snapshot));
  session.trackRun(current, { recovered: true });

  assert.equal(session.activeHandoff.status, "interrupted");
  assert.equal(session.activeHandoff.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(session.activeHandoff.retryable, false);
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);
  assert.equal(
    snapshots
      .filter((snapshot) => snapshot.activeRun?.requestId === current.requestId)
      .every((snapshot) => snapshot.activeHandoffMayBeRunning),
    true,
  );

  session.publishHandoff({
    ...current,
    mode: "qoder-acp",
    status: "failed",
    errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
    retryable: false,
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session owns submission preparation, freeze and unknown-outcome locking", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const submission = session.beginSubmission({
    sourcePath: "/tmp/page.html",
  });

  assert.ok(submission);
  assert.equal(session.snapshot.activeSubmission?.phase, "preparing");
  assert.equal(session.submissionPending, true);
  assert.equal(session.snapshot.activeSubmission?.phase === "preparing", true);
  assert.equal(session.activeLocked, false);
  assert.equal(session.beginSubmission({ sourcePath: "/tmp/other.html" }), null);

  assert.equal(session.freezeSubmission(submission), true);
  assert.equal(session.snapshot.activeSubmission?.phase, "frozen");
  assert.equal(session.submissionPending, true);
  assert.equal(session.snapshot.activeSubmission?.phase === "preparing", false);
  assert.equal(session.activeLocked, true);

  assert.equal(session.markSubmissionUncertain(submission), true);
  assert.equal(session.snapshot.activeSubmission?.phase, "uncertain");
  assert.equal(session.submissionPending, false);
  assert.equal(session.activeLocked, true);

  session.activate("/tmp/other.html");
  assert.equal(session.snapshot.activeSubmission, null);
  assert.equal(session.activeLocked, false);
  const nextSubmission = session.beginSubmission({
    sourcePath: "/tmp/other.html",
  });
  assert.ok(nextSubmission);
  assert.equal(session.snapshot.activeSubmission, nextSubmission);
  assert.equal(session.activeLocked, false);

  assert.equal(session.releaseSubmission(nextSubmission), true);
  assert.equal(session.snapshot.activeSubmission, null);
  assert.equal(session.activeLocked, false);
});

test("run session rebases run, handoff and result through a source rename", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  session.markResult(current.sourcePath, {
    state: "processing",
    label: "正在处理",
    updatedAt: 1,
  });
  session.rememberOutcome({ ...current, status: "error" });
  assert.equal(session.rebaseSource({
    previousSourcePath: current.sourcePath,
    sourcePath: "/tmp/renamed.html",
    projectId: current.projectId,
  }), true);
  assert.equal(session.activeRun.sourcePath, "/tmp/renamed.html");
  assert.equal(session.activeHandoff.sourcePath, "/tmp/renamed.html");
  assert.equal(
    session.resultForSource("/tmp/renamed.html").state,
    "processing",
  );
  assert.equal(
    session.outcomeForSource("/tmp/renamed.html").sourcePath,
    "/tmp/renamed.html",
  );
  assert.equal(session.runForSource(current.sourcePath), null);
});

test("renaming one Working Copy preserves another run in the same project and document", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const first = run({ sourceWorkingCopyId: "work_ver_0001" });
  const second = run({
    sourcePath: "/tmp/other-copy.html",
    sourceWorkingCopyId: "work_ver_0002",
    requestId: "other-request",
  });
  session.trackRun(first);
  session.trackRun(second);
  session.publishHandoff({ ...second, status: "copied" });
  session.markResult(second.sourcePath, { state: "processing", label: "正在处理", updatedAt: 1 });

  session.rebaseSource({
    previousSourcePath: first.sourcePath,
    sourcePath: "/tmp/renamed-copy.html",
    projectId: first.projectId,
    documentId: first.documentId,
  });

  assert.equal(session.runForSource(second.sourcePath), second);
  assert.equal(session.handoffForSource(second.sourcePath).requestId, second.requestId);
  assert.equal(session.resultForSource(second.sourcePath).state, "processing");
  assert.equal(session.activeRun.sourceWorkingCopyId, first.sourceWorkingCopyId);
  assert.equal(session.activeRun.sourcePath, "/tmp/renamed-copy.html");
});

test("a missing or mismatched old locator cannot rebind a project's other run", () => {
  const session = new RunSession();
  const current = run({ sourceWorkingCopyId: "work_ver_0001" });
  session.trackRun(current);
  session.rebaseSource({
    previousSourcePath: "/tmp/missing.html", sourcePath: "/tmp/new.html",
    projectId: current.projectId, documentId: current.documentId,
  });
  assert.equal(session.runForSource(current.sourcePath), current);
  assert.equal(session.runForSource("/tmp/new.html"), null);
  assert.equal(session.rebaseSource({
    previousSourcePath: current.sourcePath, sourcePath: "/tmp/new.html",
    projectId: current.projectId, documentId: "other-document",
  }), false);
  assert.equal(session.runForSource(current.sourcePath), current);

  const occupied = run({
    sourcePath: "/tmp/occupied.html",
    requestId: "occupied-request",
    sourceWorkingCopyId: "work_ver_0002",
  });
  session.trackRun(occupied, { activate: "never" });
  assert.equal(session.rebaseSource({
    previousSourcePath: current.sourcePath,
    sourcePath: occupied.sourcePath,
    projectId: current.projectId,
    documentId: current.documentId,
  }), false);
  assert.equal(session.runForSource(current.sourcePath), current);
  assert.equal(session.runForSource(occupied.sourcePath), occupied);
});

test("removing a run requires its registered scope and rejects an older pending token", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run({ sourceWorkingCopyId: "work_ver_0001" });
  session.trackRun(current);
  for (const other of [
    { projectId: "other-project" }, { documentId: "other-document" },
    { sourceWorkingCopyId: "work_ver_0002" }, { attemptId: "other-attempt" },
    { requestId: "other-request" },
  ]) {
    assert.equal(session.hasRun({ ...current, ...other }), false);
    assert.equal(session.removeRun({ ...current, ...other }), false);
    assert.equal(session.activeRun, current);
  }
  const pending = { ...current, requestId: "pending", submissionToken: 2 };
  session.trackRun(pending);
  const olderPending = { ...pending, submissionToken: 1 };
  assert.equal(session.hasRun(olderPending), false);
  assert.equal(session.removeRun(olderPending), false);
  assert.equal(session.activeRun, pending);
});

test("a legacy run without Working Copy identity never removes another locator", () => {
  const session = new RunSession({ sourcePath: "/tmp/legacy.html" });
  const legacy = run({
    sourcePath: "/tmp/legacy.html",
    sourceWorkingCopyId: null,
  });
  const registered = run({
    sourcePath: "/tmp/registered.html",
    sourceWorkingCopyId: "work_ver_0002",
  });
  session.trackRun(legacy);
  session.trackRun(registered, { activate: "never" });

  assert.equal(session.removeRun(legacy), true);
  assert.equal(session.runForSource(legacy.sourcePath), null);
  assert.equal(session.runForSource(registered.sourcePath), registered);
  assert.equal(session.publishHandoff({
    sourcePath: "/tmp/unregistered-handoff.html",
    requestId: registered.requestId,
    attemptId: registered.attemptId,
    status: "copying",
  }), true);
  assert.equal(
    session.handoffForSource("/tmp/unregistered-handoff.html").status,
    "copying",
  );
});

test("a new round replaces one locator atomically and rejects old attempt writers", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const first = run({
    requestId: "request_one",
    attemptId: "attempt_001",
    sourceWorkingCopyId: "work_ver_0001",
  });
  const second = run({
    requestId: "request_two",
    attemptId: "attempt_001",
    sourceWorkingCopyId: "work_ver_0001",
  });
  session.trackRun(first, { recovered: true });
  session.publishHandoff({ ...first, mode: "clipboard", status: "copied" });
  session.rememberOutcome({ ...first, status: "error" });
  session.markResult(first.sourcePath, {
    state: "error",
    label: "需要处理",
    updatedAt: 1,
  });
  const snapshots = [];
  session.subscribe((snapshot) => snapshots.push(snapshot));

  session.trackRun(second, { activate: "always" });
  const publicationsAfterReplacement = snapshots.length;

  assert.equal(session.activeRun, second);
  assert.equal(session.activeHandoff, null);
  assert.equal(session.activeHandoffMayBeRunning, false);
  assert.equal(session.handoffForSource(second.sourcePath), null);
  assert.equal(session.outcomeForSource(second.sourcePath), null);
  assert.equal(session.resultForSource(second.sourcePath), null);
  assert.equal(session.removeRun(first), false);
  assert.equal(session.publishHandoff({ ...first, status: "starting" }), false);
  assert.equal(session.rememberOutcome({ ...first, status: "error" }), null);
  assert.equal(snapshots.length, publicationsAfterReplacement);
  assert.equal(session.runForSource(second.sourcePath), second);
  assert.equal(session.activeRun, second);
});

test("a pending submission and its aggregate entry rebase through macOS path aliases", () => {
  const originalPath = "/private/var/tmp/page.html";
  const renamedPath = "/var/tmp/renamed.html";
  const session = new RunSession({ sourcePath: originalPath });
  const submission = session.beginSubmission({ sourcePath: originalPath });
  const pending = run({
    sourcePath: originalPath,
    requestId: "pending",
    submissionToken: submission.token,
    sourceWorkingCopyId: null,
  });
  session.trackRun(pending, { activate: "always" });
  session.markResult(originalPath, {
    state: "processing",
    label: "正在处理",
    updatedAt: 1,
  });

  assert.equal(session.rebaseSource({
    previousSourcePath: "/var/tmp/page.html",
    sourcePath: renamedPath,
    projectId: pending.projectId,
    documentId: pending.documentId,
  }), true);

  assert.equal(session.snapshot.activeSourcePath, renamedPath);
  assert.equal(session.activeSubmission.sourcePath, renamedPath);
  assert.equal(session.activeRun.sourcePath, renamedPath);
  assert.equal(session.activeRun.sourceWorkingCopyId, null);
  assert.equal(session.runForSource("/private/var/tmp/renamed.html").requestId, "pending");
  assert.equal(session.resultForSource("/private/var/tmp/renamed.html").state, "processing");
  assert.equal(session.freezeSubmission(submission), true);
  assert.equal(session.releaseSubmission(submission), true);
  assert.equal(session.removeRun(pending), true);
});

test("public snapshots retain their frozen shape after aggregate updates", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  session.trackRun(run());
  session.markResult("/tmp/page.html", {
    state: "processing",
    label: "正在处理",
    updatedAt: 1,
  });
  const snapshot = session.snapshot;

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.backgroundResults), true);
  assert.equal(Object.isFrozen(snapshot.backgroundResults[0]), true);
  assert.equal(Object.isFrozen(session.runs), true);
  assert.deepEqual(Object.keys(snapshot), [
    "activeSourcePath",
    "activeRun",
    "activeHandoff",
    "activeHandoffMayBeRunning",
    "activeHandoffManaged",
    "activeSubmission",
    "submissionPending",
    "activeLocked",
    "operationKeys",
    "recentOutcome",
    "backgroundResults",
  ]);
});

test("independent aggregate facts coexist and absent clears remain notification no-ops", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const snapshots = [];
  session.subscribe((snapshot) => snapshots.push(snapshot));
  assert.equal(session.clearHandoff("/tmp/page.html"), false);
  assert.equal(session.clearResult("/tmp/page.html"), false);
  assert.equal(session.forgetOutcome("/tmp/page.html"), false);
  assert.equal(snapshots.length, 1);

  const result = { state: "ready", label: "新版本可查看", updatedAt: 1 };
  const current = run();
  session.markResult(current.sourcePath, result);
  session.publishHandoff({ ...current, status: "copied" });
  session.rememberOutcome({ ...current, status: "complete" });
  assert.equal(session.resultForSource(current.sourcePath), result);
  assert.equal(session.handoffForSource(current.sourcePath).status, "copied");
  assert.equal(session.outcomeForSource(current.sourcePath).status, "complete");

  const publications = snapshots.length;
  assert.equal(session.clearResult(current.sourcePath), true);
  assert.equal(session.clearResult(current.sourcePath), false);
  assert.equal(snapshots.length, publications + 1);
});

test("locator transitions preserve Request origin and only that durable attempt can settle after rename", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const original = run({ sourceWorkingCopyId: "work_ver_0001" });
  session.trackRun(original);
  session.publishHandoff({ ...original, status: "copied" });
  // Promotion's destination is a new Working Copy; its name is not run identity.
  session.rebaseSource({
    previousSourcePath: original.sourcePath, sourcePath: "/tmp/page-V2.html",
    projectId: original.projectId, documentId: original.documentId,
  });
  assert.equal(session.activeRun.sourceWorkingCopyId, "work_ver_0001");
  assert.equal(session.activeHandoffMayBeRunning, true);
  assert.equal(session.removeRun(original), true);
  assert.equal(session.activeRun, null);

  const legacy = run({ sourceWorkingCopyId: null });
  session.trackRun(legacy);
  session.rebaseSource({
    previousSourcePath: legacy.sourcePath, sourcePath: "/tmp/managed-V1.html",
    projectId: legacy.projectId, documentId: legacy.documentId,
  });
  assert.equal(session.runForSource("/tmp/managed-V1.html").sourceWorkingCopyId, null);
});

test("terminal outcomes remain reopenable after the active panel is dismissed", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const terminal = run({ status: "error", error: "返回结果无法使用。" });
  session.setActiveRun(terminal);
  session.rememberOutcome(terminal);
  session.clearActiveRun();

  assert.equal(session.snapshot.activeRun, null);
  assert.equal(session.snapshot.recentOutcome, terminal);
  session.setActiveRun(session.outcomeForSource(terminal.sourcePath));
  assert.equal(session.snapshot.activeRun, terminal);

  assert.equal(session.forgetOutcome(terminal.sourcePath), true);
  assert.equal(session.snapshot.recentOutcome, null);
});

test("run session owns exact-once operation locks", () => {
  const session = new RunSession();
  const snapshots = [];
  session.setObserver((snapshot) => snapshots.push(snapshot));
  assert.equal(session.beginOperation("cancel", "operation"), true);
  assert.equal(session.beginOperation("cancel", "operation"), false);
  assert.equal(session.isOperationBusy("cancel", "operation"), true);
  assert.deepEqual(session.snapshot.operationKeys, [["cancel", "operation"]]);
  assert.equal(session.endOperation("cancel", "operation"), true);
  assert.deepEqual(session.snapshot.operationKeys, []);
  assert.equal(session.beginOperation("cancel", "operation"), true);
  assert.equal(snapshots.length, 3);
});

test("run session allows the controller to observe alongside the existing view observer", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const viewSnapshots = [];
  const controllerSnapshots = [];
  session.setObserver((snapshot) => viewSnapshots.push(snapshot));
  const unsubscribe = session.subscribe((snapshot) => controllerSnapshots.push(snapshot));

  session.trackRun(run());
  unsubscribe();
  session.clearActiveRun();

  assert.equal(viewSnapshots.length, 2);
  assert.equal(controllerSnapshots.length, 2);
  assert.equal(controllerSnapshots[1].activeRun?.requestId, "request");
});

test("same-Run hydration preserves unresolved adoption until an explicit or authoritative outcome", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  session.trackRun(run({ status: "ready-to-open", adoptionPhase: "unknown" }));
  session.trackRun(run({ status: "ready-to-open" }), { recovered: true });
  assert.equal(session.activeRun.adoptionPhase, "unknown");
  session.clearActiveRun();
  session.setActiveRun(run({ status: "ready-to-open" }));
  assert.equal(session.activeRun.adoptionPhase, "unknown");
  session.trackRun(run({ status: "ready-to-open", adoptionPhase: undefined }));
  assert.equal(session.activeRun.adoptionPhase, undefined);
  session.trackRun(run({ status: "ready-to-open", adoptionPhase: "unknown" }));
  session.trackRun(run({ status: "complete" }), { recovered: true });
  assert.equal(session.activeRun.status, "complete");
  assert.equal(session.activeRun.adoptionPhase, undefined);
});
