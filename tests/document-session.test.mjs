import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DocumentSession,
  isSourceReceipt,
} from "../app/application/document-session.js";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const RECEIPT_CONTEXT = Object.freeze({
  epoch: 7,
  projectId: "project_receipt",
  documentId: "document_receipt",
  sourcePath: "/tmp/receipt-document.html",
  projectRootPath: "/tmp/receipt-project",
  targetKind: "working-copy",
  workingCopyId: "working_receipt",
  versionId: "version_receipt",
  exactSourcePath: "/tmp/receipt-document.html",
  sourceSha256: sha256("<main>one</main>"),
  sessionEpoch: 7,
});

test("document session owns source bytes, revisions and pending write", () => {
  const session = new DocumentSession({
    html: "<main>one</main>",
    persistedSourceSha256: "sha256:one",
  });
  const revision = session.beginEdit("<main>two</main>");
  const write = { revision, html: session.html };
  session.setPendingWrite(write);
  session.setPersistence({ state: "queued", error: "" });

  assert.equal(revision, 1);
  assert.equal(session.html, "<main>two</main>");
  assert.equal(session.pendingWrite, write);
  assert.equal(session.snapshot.persistState, "queued");
  assert.equal(session.canvasGeneration, 0);
  assert.equal(session.canvasAuthority.status, "pending");
  assert.equal(session.canvasAuthority.generation, 0);
});

test("authoritative source publication replaces bytes and Hash in one generation", () => {
  const session = new DocumentSession({
    html: "<main>old</main>",
    persistedSourceSha256: "sha256:old",
  });
  const observed = [];
  session.setObserver((snapshot) => observed.push(snapshot));

  const snapshot = session.publishAuthority({
    html: "<main>new</main>",
    persistedSourceSha256: "sha256:new",
    editRevision: 7,
    lastPersistedRevision: 7,
    persistState: "idle",
    persistError: "",
    pendingWrite: null,
  });

  assert.equal(observed.length, 1);
  assert.equal(snapshot.html, "<main>new</main>");
  assert.equal(snapshot.persistedSourceSha256, "sha256:new");
  assert.equal(snapshot.canvasGeneration, 1);
  assert.equal(session.pendingWrite, null);
});

test("canvas recovery advances only the disposable render generation", () => {
  const session = new DocumentSession({
    html: "<main>same</main>",
    persistedSourceSha256: "sha256:same",
  });
  const before = session.snapshot;

  const after = session.reloadCanvas();

  assert.equal(after.canvasGeneration, before.canvasGeneration + 1);
  assert.equal(after.html, before.html);
  assert.equal(after.persistedSourceSha256, before.persistedSourceSha256);
  assert.equal(after.editRevision, before.editRevision);
});

test("document conflict rejects later edit revisions until reset", () => {
  const session = new DocumentSession({ html: "one" });
  session.beginEdit("two");
  session.setPersistence({ state: "conflict", error: "changed" });
  assert.equal(session.beginEdit("three"), 1);
  assert.equal(session.html, "two");

  session.reset({ html: "external", persistedSourceSha256: "sha256:external" });
  assert.equal(session.persistState, "idle");
  assert.equal(session.pendingWrite, null);
  assert.equal(session.editRevision, 0);
  assert.equal(session.canvasGeneration, 1);
});

test("document session clears only the matching flush promise", async () => {
  const session = new DocumentSession();
  const first = Promise.resolve(true);
  const second = Promise.resolve(false);
  session.setFlushPromise(first);
  assert.equal(session.clearFlushPromise(second), false);
  assert.equal(session.flushPromise, first);
  assert.equal(session.clearFlushPromise(first), true);
  assert.equal(session.flushPromise, null);
});

test("document snapshot exposes only derived write and flush state", () => {
  const session = new DocumentSession({ html: "<main>source</main>" });
  const write = { revision: 1, html: session.html };
  session.setPendingWrite(write);
  session.setPersistence({ state: "queued" });
  assert.equal(session.snapshot.hasPendingWrite, true);
  assert.equal(session.snapshot.isFlushing, false);

  const flush = Promise.resolve(true);
  session.setFlushPromise(flush);
  assert.equal(session.snapshot.hasPendingWrite, true);
  assert.equal(session.snapshot.isFlushing, true);

  assert.equal(session.clearFlushPromise(flush), true);
  session.takePendingWrite();
  session.setPersistence({ state: "idle" });
  assert.equal(session.snapshot.hasPendingWrite, false);
  assert.equal(session.snapshot.isFlushing, false);
});

test("a stale canvas hash does not block a boundary whose exact bytes were safely persisted", async () => {
  const html = "<main>saved</main>";
  const sourceSha256 = sha256(html);
  const session = new DocumentSession({ html, persistedSourceSha256: sourceSha256 });
  session.update({
    editRevision: 4,
    lastPersistedRevision: 6,
  });
  let sourceReads = 0;

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    reportedSourceSha256: sha256("<main>stale canvas metadata</main>"),
    cutoffRevision: 4,
    hashHtml: async (value) => sha256(value),
    readSource: async () => {
      sourceReads += 1;
      throw new Error("the local acknowledgement is already sufficient");
    },
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.deepEqual(result, {
    ready: true,
    repaired: true,
    sourceSha256,
    lastModifiedAt: "",
  });
  assert.equal(sourceReads, 0);
});

test("a stale persisted projection is silently repaired from authoritative source bytes", async () => {
  const html = "<main>saved</main>";
  const sourceSha256 = sha256(html);
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 3, lastPersistedRevision: 2 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 3,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: html,
      sha256: sourceSha256,
      lastModifiedAt: "2026-08-04T10:00:00.000Z",
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.deepEqual(result, {
    ready: true,
    repaired: true,
    sourceSha256,
    lastModifiedAt: "2026-08-04T10:00:00.000Z",
  });
  assert.equal(session.persistedSourceSha256, sourceSha256);
  assert.equal(session.lastPersistedRevision, 3);
  assert.equal(session.persistState, "idle");
});

test("only confirmed authoritative divergence becomes a source conflict", async () => {
  const html = "<main>local</main>";
  const externalHtml = "<main>external</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: externalHtml,
      sha256: sha256(externalHtml),
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-diverged");
  assert.equal(result.confirmed, true);
  assert.equal(session.persistState, "conflict");
  assert.match(session.persistError, /其他操作修改/u);
});

test("a transient authoritative read failure stays recoverable and does not invent corruption", async () => {
  const html = "<main>local</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => {
      throw new Error("temporarily unavailable");
    },
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-unavailable");
  assert.equal(result.confirmed, false);
  assert.equal(session.persistState, "idle");
});

test("invalid authoritative content integrity is confirmed before recovery is escalated", async () => {
  const html = "<main>local</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: "<main>damaged response</main>",
      sha256: sha256("<main>different bytes</main>"),
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-integrity-failed");
  assert.equal(result.confirmed, true);
  assert.equal(session.persistState, "idle");
});

test("source publication puts the new canvas generation into pending until an exact ACK", () => {
  const html = "<main>canvas</main>";
  const digest = sha256(html);
  const session = new DocumentSession({ html, persistedSourceSha256: digest });
  assert.equal(session.canvasAuthority.status, "idle");

  session.publishAuthority({ html, persistedSourceSha256: digest });
  assert.equal(session.canvasAuthority.status, "pending");
  assert.equal(session.canvasAuthority.generation, 1);

  assert.equal(session.confirmCanvas({
    generation: 0,
    renderedSha256: digest,
  }), false);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256("<main>stale</main>"),
  }), false);
  assert.equal(session.canvasAuthority.status, "pending");
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: digest,
  }), true);
  assert.deepEqual(session.canvasAuthority, {
    status: "verified",
    generation: 1,
    renderedSha256: digest,
    error: null,
  });
});

test("beginEdit pending the current canvas generation without rebuilding it", () => {
  const html = "<main>one</main>";
  const digest = sha256(html);
  const session = new DocumentSession({ html, persistedSourceSha256: digest });
  session.reloadCanvas();
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: digest,
  }), true);

  const edited = "<main>two</main>";
  const editedDigest = sha256(edited);
  session.beginEdit(edited, { sourceSha256: editedDigest });
  assert.equal(session.canvasGeneration, 1);
  assert.equal(session.canvasAuthority.status, "pending");
  assert.equal(session.canvasAuthority.generation, 1);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(edited),
  }), true);
  assert.equal(session.persistedSourceSha256, digest);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256("different"),
    workingHtmlSha256: sha256("different"),
  }), false);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: editedDigest,
  }), false);
});

test("a receipt with no working hash cannot self-certify a Canvas", () => {
  const html = "<main>one</main>";
  const digest = sha256(html);
  const edited = "<main>two</main>";
  const editedDigest = sha256(edited);
  const session = new DocumentSession({ html, persistedSourceSha256: digest });
  session.beginEdit(edited);
  assert.equal(session.confirmWorkingHtml({
    revision: 1,
    htmlSha256: editedDigest,
  }), true);
  assert.equal(session.sourceReceipt.sourceSha256, "");
  assert.equal(session.confirmCanvas({
    generation: session.canvasGeneration,
    renderedSha256: editedDigest,
    workingHtmlSha256: editedDigest,
    renderedHtml: edited,
    receipt: session.sourceReceipt,
  }), false);
  const corrected = session.publishAuthority({
    html: edited,
    persistedSourceSha256: editedDigest,
    workingHtmlSha256: editedDigest,
    operationId: "corrected-working-hash",
  }).sourceReceipt;
  assert.equal(session.confirmCanvas({
    generation: corrected.canvasGeneration,
    renderedSha256: editedDigest,
    workingHtmlSha256: editedDigest,
    renderedHtml: edited,
    receipt: corrected,
  }), true);
});

test("a late canvas ACK cannot change a newer generation or a failed verification", () => {
  const html = "<main>one</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
  });
  session.reloadCanvas();
  assert.equal(session.failCanvas({
    generation: 1,
    error: "画布没有在时限内确认载入目标 HTML。",
  }), true);
  assert.equal(session.failCanvas({
    generation: 1,
    error: "duplicate failure",
  }), false);
  assert.equal(session.canvasAuthority.status, "failed");

  session.publishAuthority({
    html: "<main>two</main>",
    persistedSourceSha256: sha256("<main>two</main>"),
  });
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(html),
  }), false);
  assert.equal(session.canvasAuthority.status, "pending");
  assert.equal(session.canvasAuthority.generation, 2);
});

test("same-byte authority publication and reload advance receipt and generation", () => {
  const html = "<main>same</main>";
  const digest = sha256(html);
  const session = new DocumentSession({
    html,
    persistedSourceSha256: digest,
    context: RECEIPT_CONTEXT,
  });
  const before = session.sourceReceipt;

  const published = session.publishAuthority({
    html,
    persistedSourceSha256: digest,
    context: RECEIPT_CONTEXT,
    operationId: "authority-same-byte",
  });
  const reloaded = session.reloadCanvas({
    context: RECEIPT_CONTEXT,
    operationId: "authority-same-byte-reload",
  });

  assert.equal(published.html, html);
  assert.equal(reloaded.html, html);
  assert.equal(published.canvasGeneration, before.canvasGeneration + 1);
  assert.equal(reloaded.canvasGeneration, published.canvasGeneration + 1);
  assert.equal(published.sourceReceipt.origin, "authority");
  assert.equal(reloaded.sourceReceipt.origin, "authority");
  assert.ok(published.sourceReceipt.sequence > before.sequence);
  assert.ok(reloaded.sourceReceipt.sequence > published.sourceReceipt.sequence);
});

test("local and history receipts keep the current canvas generation", () => {
  const session = new DocumentSession({
    html: "<main>one</main>",
    persistedSourceSha256: sha256("<main>one</main>"),
    context: RECEIPT_CONTEXT,
  });
  const generation = session.canvasGeneration;

  session.beginEdit("<main>two</main>", {
    origin: "local-edit",
    operationId: "local-edit-one",
    sourceSha256: sha256("<main>two</main>"),
    context: RECEIPT_CONTEXT,
  });
  const localReceipt = session.sourceReceipt;
  session.beginEdit("<main>three</main>", {
    origin: "history",
    operationId: "history-one",
    sourceSha256: sha256("<main>three</main>"),
    context: RECEIPT_CONTEXT,
  });
  const historyReceipt = session.sourceReceipt;

  assert.equal(localReceipt.origin, "local-edit");
  assert.equal(historyReceipt.origin, "history");
  assert.equal(localReceipt.canvasGeneration, generation);
  assert.equal(historyReceipt.canvasGeneration, generation);
  assert.ok(historyReceipt.sequence > localReceipt.sequence);
});

test("a late A receipt cannot acknowledge or overwrite newer B source", () => {
  const htmlA = "<main>A</main>";
  const htmlB = "<main>B</main>";
  const session = new DocumentSession({
    html: "<main>start</main>",
    persistedSourceSha256: sha256("<main>start</main>"),
    context: RECEIPT_CONTEXT,
  });
  session.beginEdit(htmlA, {
    origin: "local-edit",
    operationId: "edit-A",
    sourceSha256: sha256(htmlA),
    context: RECEIPT_CONTEXT,
  });
  const receiptA = session.sourceReceipt;
  session.beginEdit(htmlB, {
    origin: "local-edit",
    operationId: "edit-B",
    sourceSha256: sha256(htmlB),
    context: RECEIPT_CONTEXT,
  });
  const receiptB = session.sourceReceipt;
  session.confirmWorkingHtml({ revision: session.editRevision, htmlSha256: sha256(htmlB) });

  assert.equal(session.confirmCanvas({
    generation: receiptA.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: receiptA,
  }), false);
  assert.equal(session.html, htmlB);
  assert.equal(session.sourceReceipt.sequence, receiptB.sequence);
  assert.equal(session.confirmCanvas({
    generation: receiptB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: receiptB,
  }), true);
});

test("duplicate, stale and context-mismatched receipts are discarded", () => {
  const html = "<main>receipt</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
    context: RECEIPT_CONTEXT,
  });
  session.confirmWorkingHtml({ revision: session.editRevision, htmlSha256: sha256(html) });
  const first = session.sourceReceipt;
  const exactAck = {
    generation: first.canvasGeneration,
    renderedSha256: sha256(html),
    workingHtmlSha256: sha256(html),
    renderedHtml: html,
    receipt: first,
  };
  assert.equal(session.confirmCanvas({
    generation: first.canvasGeneration,
    renderedSha256: sha256(html),
    workingHtmlSha256: sha256(html),
    receipt: first,
  }), false);
  assert.equal(session.confirmCanvas({
    ...exactAck,
    renderedHtml: "<main>not-the-source</main>",
  }), false);
  assert.equal(session.confirmCanvas({
    ...exactAck,
    receipt: { ...first, operationId: "forged-operation" },
  }), false);
  assert.equal(session.confirmCanvas(exactAck), true);
  assert.equal(session.confirmCanvas(exactAck), false);

  const next = session.publishAuthority({
    html,
    persistedSourceSha256: sha256(html),
    context: RECEIPT_CONTEXT,
    operationId: "authority-next",
  }).sourceReceipt;
  const wrongContext = {
    ...next,
    context: { ...RECEIPT_CONTEXT, documentId: "other-document" },
  };
  assert.equal(session.confirmWorkingHtml({
    revision: session.editRevision,
    htmlSha256: sha256(html),
  }), true);
  assert.equal(session.confirmCanvas({
    generation: next.canvasGeneration,
    renderedSha256: sha256(html),
    workingHtmlSha256: sha256(html),
    renderedHtml: html,
    receipt: first,
  }), false);
  assert.equal(session.confirmCanvas({
    generation: next.canvasGeneration,
    renderedSha256: sha256(html),
    workingHtmlSha256: sha256(html),
    renderedHtml: html,
    receipt: wrongContext,
  }), false);
  for (const [field, value] of [
    ["projectId", "other-project"],
    ["epoch", RECEIPT_CONTEXT.epoch + 1],
    ["sourcePath", "/tmp/other-document.html"],
  ]) {
    assert.equal(session.confirmCanvas({
      generation: next.canvasGeneration,
      renderedSha256: sha256(html),
      workingHtmlSha256: sha256(html),
      renderedHtml: html,
      receipt: {
        ...next,
        context: { ...RECEIPT_CONTEXT, [field]: value },
      },
    }), false, `receipt context field ${field} must be fenced`);
  }
});

test("receipt target context never infers exact path or session epoch", () => {
  const html = "<main>strict-target</main>";
  const session = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
    context: RECEIPT_CONTEXT,
  });
  const receipt = session.publishAuthority({
    html,
    persistedSourceSha256: sha256(html),
    context: RECEIPT_CONTEXT,
    operationId: "strict-target-context",
  }).sourceReceipt;
  for (const field of ["exactSourcePath", "sessionEpoch"]) {
    const incompleteReceipt = {
      ...receipt,
      context: Object.fromEntries(
        Object.entries(receipt.context).filter(([key]) => key !== field),
      ),
    };
    assert.equal(isSourceReceipt(incompleteReceipt), false, `${field} is required`);
    assert.equal(session.confirmCanvas({
      generation: receipt.canvasGeneration,
      renderedSha256: sha256(html),
      workingHtmlSha256: sha256(html),
      renderedHtml: html,
      receipt: incompleteReceipt,
    }), false, `${field} omission cannot ACK Canvas`);
    assert.equal(session.canvasAuthority.status, "pending");
  }
});

test("failed receipts are terminal until a newer authority receipt is published", () => {
  const html = "<main>terminal</main>";
  const digest = sha256(html);
  const session = new DocumentSession({
    html,
    persistedSourceSha256: digest,
    context: RECEIPT_CONTEXT,
  });
  const first = session.sourceReceipt;

  assert.equal(session.failCanvas({
    generation: first.canvasGeneration,
    error: "timeout",
    receipt: first,
  }), true);
  assert.equal(session.canvasAuthority.status, "failed");
  assert.equal(session.confirmCanvas({
    generation: first.canvasGeneration,
    renderedSha256: digest,
    workingHtmlSha256: digest,
    renderedHtml: html,
    receipt: first,
  }), false);
  assert.equal(session.canvasAuthority.status, "failed");

  const second = session.publishAuthority({
    html,
    persistedSourceSha256: digest,
    context: RECEIPT_CONTEXT,
    operationId: "authority-after-timeout",
  }).sourceReceipt;
  assert.ok(second.sequence > first.sequence);
  assert.equal(session.confirmCanvas({
    generation: second.canvasGeneration,
    renderedSha256: digest,
    workingHtmlSha256: digest,
    renderedHtml: html,
    receipt: second,
  }), true);
  assert.equal(session.failCanvas({
    generation: second.canvasGeneration,
    error: "late failure",
    receipt: second,
  }), false);
  assert.equal(session.canvasAuthority.status, "verified");
});

test("session incarnation fences lower and equal sequence receipts across rebuilds", () => {
  const htmlA = "<main>A</main>";
  const htmlB = "<main>B</main>";
  const firstSession = new DocumentSession({
    html: htmlA,
    persistedSourceSha256: sha256(htmlA),
    context: RECEIPT_CONTEXT,
  });
  const receiptA = firstSession.sourceReceipt;
  const rebuiltSession = new DocumentSession({
    html: htmlB,
    persistedSourceSha256: sha256(htmlB),
    context: RECEIPT_CONTEXT,
  });
  const receiptB = rebuiltSession.sourceReceipt;

  assert.notEqual(receiptA.sessionIncarnation, receiptB.sessionIncarnation);
  assert.equal(receiptA.sequence, receiptB.sequence);
  assert.equal(rebuiltSession.confirmCanvas({
    generation: receiptB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: receiptA,
  }), false, "old incarnation cannot ACK the rebuilt document");

  const equalSequenceDifferentOperation = {
    ...receiptB,
    operationId: "different-operation",
    sourceSha256: sha256("<main>other</main>"),
  };
  assert.equal(rebuiltSession.confirmCanvas({
    generation: receiptB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: equalSequenceDifferentOperation,
  }), false, "equal sequence with different operation/hash is stale");
  assert.equal(rebuiltSession.confirmCanvas({
    generation: receiptB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: receiptB,
  }), true);

  const sameByteSession = new DocumentSession({
    html: htmlB,
    persistedSourceSha256: sha256(htmlB),
    context: RECEIPT_CONTEXT,
  });
  const sameByteA = sameByteSession.sourceReceipt;
  const sameByteB = sameByteSession.publishAuthority({
    html: htmlB,
    persistedSourceSha256: sha256(htmlB),
    context: RECEIPT_CONTEXT,
    operationId: sameByteA.operationId,
  }).sourceReceipt;
  assert.equal(sameByteA.operationId, sameByteB.operationId);
  assert.ok(sameByteB.canvasGeneration > sameByteA.canvasGeneration);
  assert.equal(sameByteSession.confirmCanvas({
    generation: sameByteB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: sameByteA,
  }), false, "same-byte authority cannot reuse the prior receipt");
  assert.equal(sameByteSession.confirmCanvas({
    generation: sameByteB.canvasGeneration,
    renderedSha256: sha256(htmlB),
    workingHtmlSha256: sha256(htmlB),
    renderedHtml: htmlB,
    receipt: sameByteB,
  }), true);
});
