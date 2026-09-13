import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_HISTORY_MEMORY_LIMIT,
  SourceHistorySession,
} from "../app/application/source-history-session.js";
import { sourceSha256 } from "../app/lib/source-index.js";
const context = {
  epoch: 1,
  projectId: "project_history",
  documentId: "doc_history",
  sourcePath: "/tmp/history.html",
};

function transaction(before, after, index = 1) {
  return {
    kind: "text",
    beforeSourceSha256: sourceSha256(before),
    afterSourceSha256: sourceSha256(after),
    forwardPatches: [{
      startOffset: 0,
      endOffset: before.length,
      before,
      after,
      kind: "text",
    }],
    reversePatches: [{
      startOffset: 0,
      endOffset: after.length,
      before: after,
      after: before,
      kind: "inverse:text",
    }],
    beforeTarget: { id: `target-${index}` },
    afterTarget: { id: `target-${index}` },
    beforeSelection: { anchor: 0, focus: before.length, affinity: "right" },
    afterSelection: { anchor: after.length, focus: after.length, affinity: "right" },
  };
}

function acknowledgePending(session, activeContext, html) {
  const pending = session.pendingOperations;
  assert.deepEqual(
    session.acknowledge(activeContext, pending, sourceSha256(html)),
    { status: "accepted-head" },
  );
  assert.deepEqual(session.pendingOperations, []);
}

test("SourceHistorySession retains acknowledged edits only in the active memory stack", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  const recorded = session.record(context, transaction("a", "b"), 1);

  assert.equal(session.capabilities.canUndo, false, "save evidence blocks history action");
  acknowledgePending(session, context, "b");
  assert.equal(session.capabilities.canUndo, true);
  assert.equal(session.capabilities.canRedo, false);
  assert.equal(session.capabilities.depth, 1);
  assert.equal(session.snapshot.entries[0].operationId, recorded.operationId);
});

test("SourceHistorySession accepts an autosave prefix without dropping newer local edits", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  const first = session.record(context, transaction("a", "b", 1), 1);
  const second = session.record(context, transaction("b", "c", 2), 2);

  const result = session.acknowledge(
    context,
    [first],
    sourceSha256("b"),
  );

  assert.deepEqual(result, { status: "accepted-prefix", pendingCount: 1 });
  assert.deepEqual(session.pendingOperations, [second]);
  assert.equal(session.capabilities.sourceSha256, sourceSha256("c"));
  assert.equal(session.capabilities.depth, 2);

  assert.deepEqual(
    session.acknowledge(
      context,
      [second],
      sourceSha256("c"),
    ),
    { status: "accepted-head" },
  );
  assert.deepEqual(session.pendingOperations, []);
  assert.equal(session.capabilities.canUndo, true);
});

test("SourceHistorySession keeps pending evidence intact for invalid ACK order or hashes", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  const first = session.record(context, transaction("a", "b", 1), 1);
  const second = session.record(context, transaction("b", "c", 2), 2);
  const originalPending = session.pendingOperations;

  assert.deepEqual(
    session.acknowledge(context, [second], sourceSha256("c")),
    { status: "invalid", reason: "sent-operations-not-prefix" },
  );
  assert.deepEqual(session.pendingOperations, originalPending);

  assert.deepEqual(
    session.acknowledge(context, [first], sourceSha256("c")),
    { status: "invalid", reason: "acknowledged-sha-not-last-operation" },
  );
  assert.deepEqual(session.pendingOperations, originalPending);

  assert.deepEqual(
    session.acknowledge(
      context,
      [first, { ...first }],
      sourceSha256("b"),
    ),
    { status: "invalid", reason: "sent-operation-duplicate" },
  );
  assert.deepEqual(session.pendingOperations, originalPending);
});

test("SourceHistorySession does not mutate on an inactive-context ACK", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  session.record(context, transaction("a", "b"), 1);
  const expectedSnapshot = structuredClone(session.snapshot);
  const expectedPending = session.pendingOperations;

  assert.deepEqual(
    session.acknowledge(
      { ...context, epoch: context.epoch + 1 },
      expectedPending,
      sourceSha256("b"),
    ),
    { status: "invalid", reason: "inactive-context" },
  );
  const actualSnapshot = session.snapshot;
  assert.deepEqual(actualSnapshot, expectedSnapshot);
  assert.deepEqual(session.pendingOperations, expectedPending);
});

test("SourceHistorySession applies undo and redo locally with exact HTML evidence", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  session.record(context, transaction("a", "b"), 1);
  acknowledgePending(session, context, "b");

  const undone = session.apply(context, "undo", "b", 2);
  assert.equal(undone.html, "a");
  assert.equal(undone.sourceSha256, sourceSha256("a"));
  assert.equal(undone.kind, "text");
  assert.equal(session.capabilities.canUndo, false);
  acknowledgePending(session, context, "a");
  assert.equal(session.capabilities.canRedo, true);

  const redone = session.apply(context, "redo", "a", 3);
  assert.equal(redone.html, "b");
  assert.equal(redone.kind, "text");
  acknowledgePending(session, context, "b");
  assert.equal(session.capabilities.canUndo, true);
  assert.equal(session.capabilities.canRedo, false);
});

test("SourceHistorySession keeps text, style, and structure undo on the renderer path", () => {
  for (const [kind, before, after] of [
    ["text", "<p>one</p>", "<p>two</p>"],
    ["style", '<p style="color:red">one</p>', '<p style="color:blue">one</p>'],
    ["structure", "<main><p>one</p></main>", "<main><p>one</p><aside>two</aside></main>"],
  ]) {
    const session = new SourceHistorySession();
    session.activate(context, sourceSha256(before), null);
    const sourceTransaction = transaction(before, after);
    sourceTransaction.kind = kind;
    sourceTransaction.forwardPatches[0].kind = kind;
    sourceTransaction.reversePatches[0].kind = `inverse:${kind}`;
    session.record(context, sourceTransaction, 1);
    acknowledgePending(session, context, after);

    assert.equal(session.apply(context, "undo", after, 2).html, before, kind);
    acknowledgePending(session, context, before);
    assert.equal(session.apply(context, "redo", before, 3).html, after, kind);
    acknowledgePending(session, context, after);
  }
});

test("SourceHistorySession truncates redo when a new edit follows undo", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  session.record(context, transaction("a", "b", 1), 1);
  session.record(context, transaction("b", "c", 2), 2);
  acknowledgePending(session, context, "c");

  assert.equal(session.apply(context, "undo", "c", 3).html, "b");
  acknowledgePending(session, context, "b");
  assert.equal(session.capabilities.canRedo, true);
  session.record(context, transaction("b", "x", 3), 4);
  acknowledgePending(session, context, "x");

  assert.equal(session.capabilities.depth, 2);
  assert.equal(session.capabilities.canRedo, false);
  assert.equal(session.apply(context, "redo", "x", 5), null);
});

test("SourceHistorySession keeps only the latest 20 edit behaviors", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("0"), null);
  let html = "0";
  for (let index = 1; index <= 25; index += 1) {
    const next = String(index);
    session.record(context, transaction(html, next, index), index);
    html = next;
  }
  acknowledgePending(session, context, html);

  assert.equal(session.capabilities.depth, SOURCE_HISTORY_MEMORY_LIMIT);
  for (let index = 0; index < SOURCE_HISTORY_MEMORY_LIMIT; index += 1) {
    const undone = session.apply(context, "undo", html, 26 + index);
    html = undone.html;
    acknowledgePending(session, context, html);
  }
  assert.equal(html, "5");
  assert.equal(session.apply(context, "undo", html, 50), null);
});

test("SourceHistorySession clears history on another HTML or a new open lifetime", () => {
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256("a"), null);
  session.record(context, transaction("a", "b"), 1);
  acknowledgePending(session, context, "b");

  session.activate(
    { ...context, sourcePath: "/tmp/other.html" },
    sourceSha256("other"),
    null,
  );
  assert.equal(session.capabilities.depth, 0);

  session.deactivate();
  session.activate(context, sourceSha256("b"), null);
  assert.equal(session.capabilities.depth, 0);
  assert.equal(session.capabilities.canUndo, false);
});

test("SourceHistorySession rejects a forged in-process handoff snapshot", () => {
  const source = new SourceHistorySession();
  source.activate(context, sourceSha256("a"), null);
  source.record(context, transaction("a", "b"), 1);
  acknowledgePending(source, context, "b");
  const forged = {
    ...source.snapshot,
    entries: [{
      ...source.snapshot.entries[0],
      beforeSourceSha256: sourceSha256("forged"),
    }],
  };

  const target = new SourceHistorySession();
  target.activate(context, sourceSha256("b"), forged);
  assert.equal(target.capabilities.depth, 0);
  assert.equal(target.capabilities.canUndo, false);
});

test("crash recovery may restore save evidence but never an undo stack", () => {
  const original = new SourceHistorySession();
  original.activate(context, sourceSha256("a"), null);
  original.record(context, transaction("a", "b"), 1);
  const saveEvidence = original.pendingOperations;

  const restarted = new SourceHistorySession();
  restarted.activate(context, sourceSha256("b"), null);
  assert.equal(restarted.restorePendingEvidence(context, saveEvidence), true);
  assert.equal(restarted.capabilities.depth, 0);
  assert.equal(restarted.capabilities.canUndo, false);
  acknowledgePending(restarted, context, "b");
  assert.equal(restarted.capabilities.canUndo, false);
});
