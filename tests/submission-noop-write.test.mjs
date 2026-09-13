import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { fixture, importSource } from "./project-file-repository-harness.mjs";
import {
  appendSubmissionExecutionFact, projectSubmissionReceipt,
} from "../bridge/project-file-repository/submission.mjs";
import {
  conversationIndexPath, conversationRecordPath, createConversation,
  readConversation, readConversationIndex,
} from "../bridge/conversation-repository.mjs";

const operationId = `submission_${"c".repeat(32)}`;
const event = (id, kind = "reading-task") => ({
  eventId: `event_${id}`, kind, timestamp: "2026-09-12T00:00:00.000Z",
});

async function setup(t, { capped = false } = {}) {
  const f = await fixture(t);
  const { target } = await importSource(f);
  const receipt = await f.repository.recordSubmission({ target, operationId, input: {
    expectedSourceSha256: target.sourceSha256,
    comments: [{ commentId: "comment_write_count", text: "Adjust heading",
      target: { targetId: "target_write_count" }, attachments: [] }],
    targets: [{ targetId: "target_write_count" }], agentDelivery: { mode: "clipboard" },
  } });
  const context = { projectRoot: path.join(target.projectRootPath, ".pageroot"),
    projectId: target.projectId, documentId: target.documentId };
  const loaded = { paths: { projectRootPath: target.projectRootPath },
    project: { projectId: target.projectId, documentId: target.documentId },
    workingCopy: { workingCopyId: target.workingCopyId } };
  const paths = {
    receipt: path.join(context.projectRoot, "submissions", `${operationId}.json`),
    conversation: conversationRecordPath(context, receipt.conversationId),
    index: conversationIndexPath(context),
  };
  if (capped) {
    receipt.events = Array.from({ length: 64 }, (_, i) => event(`progress_${i}`));
    await fs.writeFile(paths.receipt, JSON.stringify(receipt));
    await projectSubmissionReceipt(loaded, receipt);
  }
  return { ...f, receipt, context, loaded, paths,
    append: (value) => appendSubmissionExecutionFact(loaded, operationId, value) };
}

// Observe real atomic publications, not a production test-only writer facade.
// The patch is scoped to this test process and always restored before returning.
async function publications(paths, action, fault = null) {
  const original = fs.rename;
  const writes = { receipt: 0, conversation: 0, index: 0 };
  let injected = false;
  fs.rename = async (...args) => {
    const kind = Object.keys(paths).find((key) => paths[key] === String(args[1]));
    const inject = kind && fault?.kind === kind && !injected;
    const fail = () => {
      injected = true;
      throw Object.assign(new Error(`synthetic ${kind} publication failure`), { code: "EIO" });
    };
    if (inject && !fault.after) fail();
    const result = await original(...args);
    if (kind) writes[kind] += 1;
    if (inject && fault.after) fail();
    return result;
  };
  syncBuiltinESMExports();
  try { await action(); }
  finally { fs.rename = original; syncBuiltinESMExports(); }
  if (fault) assert.equal(injected, true, "the intended filesystem boundary must be reached");
  return writes;
}

const noWrites = { receipt: 0, conversation: 0, index: 0 };
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

test("progress cap writes truncation once; thousands of omitted facts and duplicates publish nothing", async (t) => {
  const f = await setup(t, { capped: true });
  assert.deepEqual(await publications(f.paths, () => f.append(event("cap"))),
    { receipt: 1, conversation: 1, index: 1 });
  const before = await Promise.all(Object.values(f.paths).map((file) => fs.readFile(file)));
  assert.deepEqual(await publications(f.paths, async () => {
    for (let i = 0; i < 2000; i += 1) await f.append(event(`omitted_${i}`));
    await f.append(event("progress_0"));
  }), noWrites);
  const after = await Promise.all(Object.values(f.paths).map((file) => fs.readFile(file)));
  assert.deepEqual(after, before, "bytes, revisions and timestamps must remain unchanged");
  for (const kind of ["started", "stop-requested", "stop-confirmed", "execution-ended"]) {
    assert.deepEqual(await publications(f.paths, () => f.append(event(kind, kind))),
      { receipt: 1, conversation: 1, index: 1 }, kind);
  }
  const summary = { ...event("summary", "public-summary"), publicSummary: "The result is ready for validation." };
  assert.deepEqual(await publications(f.paths, () => f.append(summary)),
    { receipt: 1, conversation: 1, index: 1 });
  assert.deepEqual(await publications(f.paths, () => f.append(summary)), noWrites);
  const receipt = await readJson(f.paths.receipt);
  assert.equal(receipt.eventsTruncated, true);
  assert.equal(receipt.events.filter((value) => value.kind === "reading-task").length, 64);
  assert.equal(receipt.events.filter((value) => value.kind === "public-summary").length, 1);
});

for (const fault of [
  { kind: "receipt", expected: { receipt: 1, conversation: 1, index: 1 } },
  { kind: "conversation", expected: { receipt: 0, conversation: 1, index: 1 } },
  { kind: "index", expected: { receipt: 0, conversation: 0, index: 1 } },
  { kind: "index", after: true, expected: noWrites },
]) {
  for (const capped of [false, true]) test(`${capped ? "first truncation" : "terminal summary"} repairs ${fault.kind} ${fault.after ? "after" : "before"} publication without repeating committed writes`, async (t) => {
    const f = await setup(t, { capped });
    const fact = capped ? event("cap_failure")
      : { ...event("terminal", "public-summary"), publicSummary: "Completed visible work." };
    await publications(f.paths, () => assert.rejects(f.append(fact), /synthetic .* publication failure/), fault);
    assert.deepEqual(await publications(f.paths, () => f.append(fact)), fault.expected);
    assert.deepEqual(await publications(f.paths, () => f.append(fact)), noWrites);
    const stored = await readJson(f.paths.receipt);
    const record = await readConversation(f.context, f.receipt.conversationId);
    assert.equal(Boolean(stored.eventsTruncated), capped);
    assert.equal(record.messages.filter((message) => capped
      ? message.messageId.endsWith("_truncated") : message.kind === "result-summary").length, 1);
    const index = await readConversationIndex(f.context);
    const summary = index.documents[0].conversations.find((item) => item.conversationId === record.conversationId);
    assert.equal(summary.messageCount, record.messages.length);
    assert.equal(summary.updatedAt, record.updatedAt);
  });
}

test("an old receipt no-op preserves the newer current conversation, ordering and unknown index members", async (t) => {
  const f = await setup(t);
  const newer = await createConversation(f.context, { title: "Newer conversation" });
  const index = await readJson(f.paths.index);
  index.futureIndex = { keep: true };
  index.documents[0].futureDocument = true;
  index.documents[0].conversations[0].futureSummary = { keep: "value" };
  await fs.writeFile(f.paths.index, JSON.stringify(index));
  const before = await fs.readFile(f.paths.index);
  assert.deepEqual(await publications(f.paths, () => projectSubmissionReceipt(f.loaded, f.receipt)), noWrites);
  assert.deepEqual(await fs.readFile(f.paths.index), before);
  await f.append(event("old_fact"));
  const updated = await readJson(f.paths.index);
  assert.equal(updated.documents[0].currentConversationId, newer.conversationId);
  assert.deepEqual(updated.futureIndex, { keep: true });
  assert.equal(updated.documents[0].futureDocument, true);
  assert.deepEqual(updated.documents[0].conversations.find((item) => item.conversationId === f.receipt.conversationId).futureSummary,
    { keep: "value" });
});
