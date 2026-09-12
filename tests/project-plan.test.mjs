import assert from "node:assert/strict";
import test from "node:test";

import { planProjectCloseAbort, planProjectCloseHydration, planProjectCloseIdentity } from "../app/application/project/close-plan.js";
import { planProjectOpen } from "../app/application/project/open-intent.js";
import {
  planSourceLocatorRegister,
  planSourceLocatorTransition,
} from "../app/application/project/source-locator-plan.js";
import {
  planProjectSwitchEntry,
  planProjectSwitchFence,
} from "../app/application/project/switch-plan.js";

test("project open plan rejects a closing window and classifies the remaining intents", () => {
  assert.equal(planProjectOpen({ closePhase: "ready" }).code, "PROJECT_OPEN_CLOSE_COMMITTED");
  assert.equal(planProjectOpen({ kind: "startup" }).action, "startup");
  assert.equal(planProjectOpen({ kind: "local" }).action, "open-file");
  assert.equal(planProjectOpen({ kind: "recent" }).action, "open-file");
  assert.equal(planProjectOpen({ kind: "registered" }).action, "open-registered");
});

test("project switch entry plan fail-closes disposed and drain blocks, and waits for history", () => {
  assert.equal(planProjectSwitchEntry({ disposed: true }).code, "PROJECT_WORKFLOW_DISPOSED");
  assert.equal(
    planProjectSwitchEntry({ drainBlockedReason: "AI 仍在写入。" }).code,
    "PROJECT_SWITCH_BLOCKED",
  );
  assert.equal(planProjectSwitchEntry({ projectLoadError: true }).action, "reset-failed");
  assert.equal(planProjectSwitchEntry({ runLocked: true }).action, "drain-run-lock");
  assert.equal(planProjectSwitchEntry({ hasHistoryAction: true }).kind, "wait");
  assert.equal(planProjectSwitchEntry().action, "continue");
});

test("project switch fence rejects unverified native edits", () => {
  assert.equal(planProjectSwitchFence({ needsCanvasCommit: false }).kind, "ready");
  assert.equal(planProjectSwitchFence({ needsCanvasCommit: true, fenceOk: false }).code,
    "PROJECT_SWITCH_NATIVE_EDIT");
});

test("project close plans classify identity, hydration and abort without executing side effects", () => {
  assert.equal(planProjectCloseIdentity({}).code, "PROJECT_CLOSE_IDENTITY_INVALID");
  assert.equal(planProjectCloseIdentity({ requestId: "close_1", deadlineAt: 1 }).kind, "ready");
  assert.equal(
    planProjectCloseHydration({
      projectHydrating: true,
      projectOpenInFlight: true,
    }).code,
    "PROJECT_CLOSE_OPEN_IN_FLIGHT",
  );
  assert.equal(
    planProjectCloseHydration({
      projectHydrating: true,
      canCloseDuringHydration: true,
    }).action,
    "allow-hydration",
  );
  assert.equal(
    planProjectCloseHydration({
      projectLoadError: true,
      pendingDirty: true,
    }).code,
    "PROJECT_CLOSE_LOAD_ERROR_DIRTY",
  );
  assert.equal(planProjectCloseHydration({ projectLoadError: true }).action, "allow-load-error");
  assert.equal(planProjectCloseAbort({ aborted: true }).code, "PROJECT_CLOSE_ABORTED");
  assert.equal(
    planProjectCloseAbort({ projectOpenInFlight: true }).code,
    "PROJECT_CLOSE_OPEN_IN_FLIGHT",
  );
});

test("source locator plans reject stale register and transition identities", () => {
  const samePath = (left, right) => left === right;
  assert.equal(planSourceLocatorRegister({
    epoch: 1,
    liveEpoch: 2,
    sourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    projectId: "p",
    documentId: "d",
    samePath,
  }).code, "SOURCE_LOCATOR_STALE");
  assert.equal(planSourceLocatorRegister({
    epoch: 1,
    liveEpoch: 1,
    sourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    projectId: "p",
    documentId: "d",
    samePath,
  }).kind, "ready");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "",
    samePath,
  }).code, "SOURCE_LOCATOR_MISSING");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "/tmp/b.html",
    previousSourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/other.html",
    samePath,
  }).code, "SOURCE_LOCATOR_STALE");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "/tmp/b.html",
    previousSourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    samePath,
  }).kind, "ready");
});
