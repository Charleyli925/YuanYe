import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeFrameCoordinator,
  runtimeCandidateAlreadyActive,
} from "../app/components/runtime-frame-coordinator.js";

function begin(coordinator, generation) {
  return coordinator.beginCandidate({
    generation,
    sourceRevision: `sha256:${String(generation).padStart(64, "0")}`,
  }).identity;
}

function promote(coordinator, identity) {
  assert.equal(coordinator.beginPositioning(identity), true);
  assert.equal(coordinator.settle(identity, "ready").accepted, true);
}

test("fixed slots alternate without creating a third frame state", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const first = begin(coordinator, 1);
  assert.equal(first.slotId, "b");
  promote(coordinator, first);
  assert.deepEqual(
    Object.values(coordinator.snapshot.slots).map(({ slotId, phase }) => [slotId, phase]),
    [["a", "empty"], ["b", "active"]],
  );

  const second = begin(coordinator, 2);
  assert.equal(second.slotId, "a");
  promote(coordinator, second);
  assert.deepEqual(
    Object.values(coordinator.snapshot.slots).map(({ slotId, phase }) => [slotId, phase]),
    [["a", "active"], ["b", "empty"]],
  );

  const third = begin(coordinator, 3);
  assert.equal(third.slotId, "b");
  promote(coordinator, third);
  assert.equal(Object.keys(coordinator.snapshot.slots).length, 2);
  assert.equal(coordinator.snapshot.activeSlotId, "b");
});

test("latest wins reuses the inactive slot and rejects an expired slot lease", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const active = begin(coordinator, 1);
  promote(coordinator, active);

  const first = begin(coordinator, 2);
  const secondStart = coordinator.beginCandidate({
    generation: 3,
    sourceRevision: `sha256:${"3".repeat(64)}`,
  });
  const second = secondStart.identity;

  assert.equal(first.slotId, "a");
  assert.equal(second.slotId, "a");
  assert.equal(second.slotLease, first.slotLease + 1);
  assert.equal(secondStart.supersededCandidate?.candidateId, first.candidateId);
  assert.equal(coordinator.accepts(first), false);
  assert.equal(coordinator.accepts(second), true);
  assert.equal(coordinator.settle(first, "failed").accepted, false);
  assert.equal(coordinator.snapshot.latestCandidate?.candidateId, second.candidateId);
  assert.equal(coordinator.snapshot.slots.a.identity?.candidateId, second.candidateId);
  assert.equal(coordinator.snapshot.slots.b.phase, "active");
  assert.equal(coordinator.snapshot.ignoredCallbackCount, 2);
});

test("native editing and candidate positioning never overlap", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const candidate = begin(coordinator, 8);

  assert.equal(coordinator.beginNativeEdit(), true);
  assert.equal(coordinator.beginPositioning(candidate), false);
  assert.equal(coordinator.endNativeEdit(), true);
  assert.equal(coordinator.beginPositioning(candidate), true);
  assert.equal(coordinator.beginNativeEdit(), false);
  assert.equal(coordinator.canFinalize(candidate), true);
  assert.equal(coordinator.settle(candidate, "ready").accepted, true);
});

test("supersession is terminal coordination and never requests static fallback", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const candidate = begin(coordinator, 1);

  assert.deepEqual(coordinator.settle(candidate, "superseded"), {
    accepted: true,
    preserveLastKnownGood: false,
    shouldUseStaticFallback: false,
  });
  assert.equal(coordinator.snapshot.activeSlotId, "a");
  assert.equal(coordinator.snapshot.slots.b.phase, "empty");
});

test("a preparing candidate cannot settle ready before hidden positioning", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const candidate = begin(coordinator, 1);

  assert.deepEqual(coordinator.settle(candidate, "ready"), {
    accepted: false,
    preserveLastKnownGood: false,
    shouldUseStaticFallback: false,
  });
  assert.equal(coordinator.snapshot.activeSlotId, "a");
  assert.equal(coordinator.snapshot.slots.a.phase, "active");
  assert.equal(coordinator.snapshot.slots.b.phase, "preparing");
});

test("failure preserves the active slot and last-known-good identity", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const active = begin(coordinator, 1);
  promote(coordinator, active);
  const failed = begin(coordinator, 2);

  assert.deepEqual(coordinator.settle(failed, "failed"), {
    accepted: true,
    preserveLastKnownGood: true,
    shouldUseStaticFallback: true,
  });
  assert.equal(coordinator.snapshot.activeSlotId, "b");
  assert.equal(coordinator.snapshot.slots.b.phase, "active");
  assert.equal(coordinator.snapshot.slots.a.phase, "empty");
  assert.equal(coordinator.snapshot.lastKnownGood?.candidateId, active.candidateId);
});

test("a failed dynamic candidate can be replaced by one static-disabled lease", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const active = begin(coordinator, 1);
  promote(coordinator, active);
  const dynamic = begin(coordinator, 2);

  assert.equal(coordinator.settle(dynamic, "failed").shouldUseStaticFallback, true);
  const fallback = coordinator.beginCandidate({
    generation: 3,
    sourceRevision: `sha256:${"2".repeat(64)}`,
    kind: "static-disabled",
  }).identity;

  assert.equal(fallback.slotId, dynamic.slotId);
  assert.equal(fallback.slotLease, dynamic.slotLease + 1);
  assert.equal(fallback.kind, "static-disabled");
  assert.equal(coordinator.accepts(dynamic), false);
  promote(coordinator, fallback);
  assert.equal(coordinator.snapshot.activeSlotId, fallback.slotId);
  assert.equal(coordinator.snapshot.lastKnownGood?.kind, "static-disabled");
});

test("a failed static-disabled candidate preserves the old active without another fallback", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const active = begin(coordinator, 1);
  promote(coordinator, active);
  const fallback = coordinator.beginCandidate({
    generation: 2,
    sourceRevision: `sha256:${"2".repeat(64)}`,
    kind: "static-disabled",
  }).identity;

  assert.deepEqual(coordinator.settle(fallback, "failed"), {
    accepted: true,
    preserveLastKnownGood: true,
    shouldUseStaticFallback: false,
  });
  assert.equal(coordinator.snapshot.activeSlotId, active.slotId);
  assert.equal(coordinator.snapshot.lastKnownGood?.candidateId, active.candidateId);
});

test("deferred dynamic replay requires the settled runtime and complete active identity", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const active = begin(coordinator, 4);
  promote(coordinator, active);
  const snapshot = coordinator.snapshot;
  const request = { kind: "dynamic", sourceRevision: active.sourceRevision };
  const runtimeFrame = {
    attempt: active,
    elementGeneration: active.generation,
    activation: "ready",
    settled: true,
  };

  assert.equal(runtimeCandidateAlreadyActive({
    request,
    runtimeFrame,
    frameLoadGeneration: active.generation,
    snapshot,
  }), true);
  assert.equal(runtimeCandidateAlreadyActive({
    request,
    runtimeFrame: null,
    frameLoadGeneration: active.generation,
    snapshot,
  }), false, "an old lastKnownGood cannot satisfy a new physical frame");
  assert.equal(runtimeCandidateAlreadyActive({
    request,
    runtimeFrame: { ...runtimeFrame, activation: "pending" },
    frameLoadGeneration: active.generation,
    snapshot,
  }), false);
  assert.equal(runtimeCandidateAlreadyActive({
    request,
    runtimeFrame: { ...runtimeFrame, elementGeneration: active.generation + 1 },
    frameLoadGeneration: active.generation,
    snapshot,
  }), false);
  assert.equal(runtimeCandidateAlreadyActive({
    request,
    runtimeFrame: {
      ...runtimeFrame,
      attempt: { ...active, candidateId: "forged-candidate" },
    },
    frameLoadGeneration: active.generation,
    snapshot,
  }), false, "same source/kind is not enough without the full identity");
});

test("deferred static replay keeps its existing last-known-good semantics", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const dynamic = begin(coordinator, 5);
  promote(coordinator, dynamic);
  const staticCandidate = coordinator.beginCandidate({
    generation: 6,
    sourceRevision: dynamic.sourceRevision,
    kind: "static-disabled",
  }).identity;
  promote(coordinator, staticCandidate);

  assert.equal(runtimeCandidateAlreadyActive({
    request: {
      kind: "static-disabled",
      sourceRevision: staticCandidate.sourceRevision,
    },
    runtimeFrame: null,
    frameLoadGeneration: 0,
    snapshot: coordinator.snapshot,
  }), true);
});

test("the first failure requests static fallback and clears its slot", () => {
  const coordinator = new RuntimeFrameCoordinator();
  const failed = begin(coordinator, 1);
  assert.deepEqual(coordinator.settle(failed, "rejected"), {
    accepted: true,
    preserveLastKnownGood: false,
    shouldUseStaticFallback: true,
  });
  assert.equal(coordinator.snapshot.activeSlotId, "a");
  assert.equal(coordinator.snapshot.slots.a.phase, "active");
  assert.equal(coordinator.snapshot.slots.b.phase, "empty");
});
