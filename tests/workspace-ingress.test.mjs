import assert from "node:assert/strict";
import test from "node:test";
import { decodeWorkspaceResponse } from "../app/application/workspace-controller-codecs.js";
import { VersionSession } from "../app/application/version-session.js";
import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const versionModel = await loadWorkbenchModel("version-model");
const records = await loadWorkbenchModel("record-model");
const comments = await loadWorkbenchModel("comment-model");
const summaries = await loadWorkbenchModel("project-version-tree-model");
const codecs = { ...versionModel, ...records, ...comments };
function response() {
  return {
    projectId: "project_test", documentId: "document_test",
    latestVersionId: "ver_0008", currentBasedOnVersionId: "ver_0002", currentExactVersionId: null,
    versions: Array.from({ length: 8 }, (_, index) => ({
      schemaVersion: "4.0.0", versionId: `ver_${String(index + 1).padStart(4, "0")}`,
      ordinal: index + 1, sourceType: index ? "internal-ai" : "initial",
      createdAt: "2026-09-01T00:00:00.000Z", displayFileName: `sample-V${index + 1}.html`,
      isActiveWorkingCopy: true, isLatestOfficial: true,
    })),
    runtimeState: { draft: {
      draftRevision: 3,
      comments: [{ commentId: "comment_one", text: "preserve this draft", target: { targetId: "target_one", selector: "body", tagName: "body", level: "module" } }],
      changeEvents: [{ eventId: "change_one", kind: "text", target: { targetId: "target_one", selector: "body", tagName: "body", level: "module" }, createdAt: "2026-09-01T00:00:00.000Z", basedOnVersionId: "ver_0002", revision: 2, provenance: { actor: { kind: "human", id: "local" }, device: "device_22743a39-3445-4283-ba90-ba39ec4b72e2" }, before: "before", after: "after" }],
    } },
  };
}
function publish(session, payload) {
  const decoded = decodeWorkspaceResponse(payload, codecs);
  session.hydrate({ ...payload, versions: decoded.versions });
  return decoded;
}
test("eight real Bridge rows remain distinct through the production decoder and Session", () => {
  const payload = response();
  assert.ok(payload.versions.every((row) => !Object.hasOwn(row, "id")));
  const session = new VersionSession();
  const decoded = publish(session, payload);
  assert.equal(new Set(session.snapshot.versions.map((version) => version.id)).size, 8);
  const rows = summaries.projectVersionSummariesFromVersions(session.snapshot.versions,
    payload.projectId, payload.documentId, "sample-V2.html", {
      activeVersionId: session.snapshot.currentBasedOnVersionId, latestVersionId: session.snapshot.latestVersionId,
    });
  assert.deepEqual(rows.filter((row) => row.isActiveWorkingCopy).map((row) => row.versionId), ["ver_0002"]);
  assert.deepEqual(rows.filter((row) => row.isLatestOfficial).map((row) => row.versionId), ["ver_0008"]);
  assert.equal(new Set(rows.map((row) => row.displayFileName)).size, 8);
  assert.equal(decoded.comments[0].commentId, "comment_one");
  assert.equal(decoded.comments[0].sourceAnchor.id, "target_comment_one");
  assert.equal(decoded.changeEvents[0].eventId, "change_one");
  assert.equal(decoded.changeEvents[0].target.id, "target_one");
  assert.equal(decoded.draft.comments[0].target.targetId, "target_one");
});
for (const [label, corrupt] of [
  ["missing ID", (p) => { delete p.versions[0].versionId; }],
  ["duplicate ID", (p) => { p.versions[1].versionId = p.versions[0].versionId; }],
  ["illegal ordinal", (p) => { p.versions[0].ordinal = 0; }],
  ["duplicate ordinal", (p) => { p.versions[1].ordinal = 1; }],
  ["wrong project", (p) => { p.versions[0].projectId = "other"; }],
  ["missing current target", (p) => { p.currentBasedOnVersionId = "ver_0099"; }],
  ["missing latest target", (p) => { p.latestVersionId = "ver_0099"; }],
  ["invalid draft comment", (p) => { delete p.runtimeState.draft.comments[0].commentId; }],
  ["invalid change event", (p) => { delete p.runtimeState.draft.changeEvents[0].eventId; }],
  ["invalid persisted provenance", (p) => { p.runtimeState.draft.changeEvents[0].provenance.device = "invalid"; }],
  ["unknown edit field", (p) => { p.runtimeState.draft.changeEvents[0].unexpected = true; }],
  ["invalid draft", (p) => { p.runtimeState.draft = null; }],
]) test(`${label} does not replace valid Session authority`, () => {
  const session = new VersionSession();
  publish(session, response());
  const before = session.snapshot;
  const payload = response(); corrupt(payload);
  assert.throws(() => publish(session, payload));
  assert.equal(session.snapshot, before);
});
test("missing authority leaves both summary markers unknown despite stale row flags", () => {
  const payload = response(); delete payload.latestVersionId; delete payload.currentBasedOnVersionId;
  const { versions } = decodeWorkspaceResponse(payload, codecs);
  const rows = summaries.projectVersionSummariesFromVersions(versions, payload.projectId, payload.documentId, "sample.html");
  assert.ok(rows.every((row) => row.isActiveWorkingCopy === null && row.isLatestOfficial === null));
});

test("legacy comment targets decode once and serialize compatible aliases from the single source anchor", () => {
  const elementId = "pr1_11111111111141118111111111111111";
  const otherId = "pr1_22222222222242229222222222222222";
  const oldTarget = {
    targetId: "target_legacy", elementId, selector: "p", label: "正文", level: "subregion",
    resolution: "exact", fingerprint: { tagName: "p", stableAttributes: {}, ancestorFingerprint: [], futureFingerprint: "keep" },
    textLocator: { quote: "😀目标", startOffset: 0, endOffset: 4, affinity: "forward", futureLocator: true },
    futureTarget: { retained: true },
  };
  const record = {
    commentId: "comment_legacy", createdAt: "2026-09-01T00:00:00.000Z", text: "保留这条要求", target: oldTarget,
    futureComment: { retained: true }, requestId: "request_old", resultVersionId: "ver_0002",
    attachments: [{ attachmentId: "attachment_legacy", fileName: "reference.txt", relativePath: "attachments/reference.txt", sha256: `sha256:${"a".repeat(64)}`, byteLength: 4, kind: "file", mediaType: "text/plain", futureAttachment: "keep" }],
  };
  const originalBytes = JSON.stringify(record);
  const [decoded] = comments.commentsFromRecords(JSON.parse(`[${originalBytes}]`));
  assert.equal(Object.hasOwn(decoded, "target"), false);
  assert.equal(decoded.sourceAnchor.elementId, elementId);
  assert.equal(decoded.sourceAnchor.textLocator.endOffset, 4);
  const next = { ...decoded, sourceAnchor: { ...decoded.sourceAnchor, elementId: otherId, selector: "aside", resolution: "orphaned" } };
  const encoded = comments.persistedComment(next);
  assert.equal(encoded.target.elementId, otherId);
  assert.equal(encoded.sourceAnchor.elementId, otherId);
  assert.equal(encoded.target.resolution, "orphaned");
  assert.deepEqual(encoded.target.futureTarget, record.target.futureTarget);
  assert.equal(encoded.target.fingerprint.futureFingerprint, "keep");
  assert.equal(encoded.target.textLocator.futureLocator, true);
  assert.deepEqual(encoded.futureComment, record.futureComment);
  assert.equal(encoded.attachments[0].futureAttachment, "keep");
  const [restarted] = comments.commentsFromRecords(JSON.parse(JSON.stringify([encoded])));
  assert.equal(Object.hasOwn(restarted, "target"), false);
  assert.equal(restarted.sourceAnchor.elementId, otherId);
  assert.equal(restarted.requestId, record.requestId);
  assert.equal(restarted.resultVersionId, record.resultVersionId);
  assert.equal(JSON.stringify(record), originalBytes, "reading never rewrites a historical record");
  const withoutLocator = { ...restarted.sourceAnchor };
  delete withoutLocator.textLocator;
  const cleared = comments.persistedComment({ ...restarted, sourceAnchor: withoutLocator });
  assert.equal(Object.hasOwn(cleared.target, "textLocator"), false, "extensions cannot revive a cleared locator");
});

test("sourceAnchor wins over a conflicting legacy target; body runtime hints stay distinct from global comments", () => {
  const bodyId = "pr1_11111111111141118111111111111111";
  const source = { targetId: "target_body", elementId: bodyId, selector: "body", level: "module", label: "旧标签", resolution: "orphaned", futureAnchor: "retained" };
  const hint = { runtimeGenerated: true, kind: "table", label: "财务数据表", relativePath: "table:nth-of-type(1)" };
  const [runtime, global] = comments.commentsFromRecords([
    { commentId: "comment_runtime", text: "改表格", sourceAnchor: source, target: { ...source, elementId: "pr1_22222222222242229222222222222222", visualHint: hint }, futureComment: true },
    { commentId: "comment_global", text: "改全页", target: source },
  ]);
  assert.equal(runtime.sourceAnchor.elementId, bodyId);
  assert.equal(runtime.sourceAnchor.label, "整个页面");
  assert.equal(Object.hasOwn(runtime.sourceAnchor, "visualHint"), false);
  assert.equal(comments.commentVisualTarget(runtime).label, "财务数据表");
  assert.equal(comments.isExplicitGlobalCommentTarget(comments.commentVisualTarget(runtime)), false);
  assert.equal(comments.isExplicitGlobalCommentTarget(comments.commentVisualTarget(global)), true);
  assert.equal(comments.persistedComment(runtime).sourceAnchor.futureAnchor, "retained");
  assert.equal(comments.persistedComment(runtime).target.elementId, bodyId);
  const noHint = { ...runtime };
  delete noHint.visualHint;
  assert.equal(comments.commentVisualTarget(noHint).label, "整个页面");
  assert.equal(Object.hasOwn(comments.persistedComment(noHint), "visualHint"), false);
});

test("comment extensions do not bypass existing field normalization", () => {
  const [decoded] = comments.commentsFromRecords([{
    commentId: "comment_invalid_fields", text: "保留内容", attachments: "invalid", requestId: false,
    target: { targetId: "target_invalid_fields", selector: "p", level: "subregion", resolution: "unknown" },
    visualHint: { runtimeGenerated: true, kind: "table", label: "表格", outerHTML: "untrusted" },
    futureMetadata: { version: 2 },
  }]);
  assert.equal(Object.hasOwn(decoded, "attachments"), false);
  assert.equal(Object.hasOwn(decoded, "requestId"), false);
  assert.equal(decoded.sourceAnchor.resolution, "orphaned");
  assert.equal(Object.hasOwn(decoded.visualHint, "outerHTML"), false);
  assert.deepEqual(comments.persistedComment(decoded).futureMetadata, { version: 2 });
});
