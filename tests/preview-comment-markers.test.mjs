import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PREVIEW_COMMENT_GROUPS,
  previewCommentMarkerGroups,
  previewCommentMeasureRequest,
  safePreviewCommentLayouts,
} from "../app/lib/preview-comment-markers.js";
import {
  buildSourceIndex,
  createTargetRef,
} from "../app/lib/source-patch-core.js";
import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";

function identified(html) {
  return materializeSourceElementIdentity(html).html;
}

function selectionFor(targetRef) {
  return {
    id: targetRef.targetId,
    elementId: targetRef.elementId,
    label: targetRef.label,
    level: targetRef.level,
    selector: targetRef.selector,
    textQuote: targetRef.textQuote,
    sourceAnchor: targetRef.sourceAnchor,
    fingerprint: targetRef.fingerprint,
    resolution: targetRef.resolution,
  };
}

function commentOn(sourceIndex, tagName, text, options = {}) {
  const element = sourceIndex.elements.find(
    (candidate) => candidate.tagName === tagName,
  );
  const target = createTargetRef(sourceIndex, element, {
    targetId: options.targetId || `${tagName}-target`,
    level: "subregion",
  });
  return {
    text,
    attachments: options.attachments || [],
    sourceAnchor: selectionFor(target),
  };
}

test("each resolvable target becomes one marker carrying its Stable ID", () => {
  const source = identified("<main><h1 id=\"title\">标题</h1><p id=\"body\">正文</p></main>");
  const sourceIndex = buildSourceIndex(source);
  const groups = previewCommentMarkerGroups(sourceIndex, [
    commentOn(sourceIndex, "h1", "标题再短一点"),
    commentOn(sourceIndex, "p", "这段拆成两句"),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.key), [
    "preview-comment-1",
    "preview-comment-2",
  ]);
  assert.deepEqual(
    groups.map((group) => group.items.map((item) => item.text)),
    [["标题再短一点"], ["这段拆成两句"]],
  );
  assert.ok(groups.every((group) => /^pr1_[0-9a-f]{32}$/u.test(group.nodeId)));
  assert.equal(new Set(groups.map((group) => group.nodeId)).size, 2);
});

test("several comments on one target collapse into a single counted marker", () => {
  const source = identified("<main><h1 id=\"title\">标题</h1></main>");
  const sourceIndex = buildSourceIndex(source);
  const groups = previewCommentMarkerGroups(sourceIndex, [
    commentOn(sourceIndex, "h1", "第一条"),
    commentOn(sourceIndex, "h1", "第二条"),
    commentOn(sourceIndex, "h1", "第三条"),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].items.map((item) => item.text),
    ["第一条", "第二条", "第三条"],
  );
});

test("an ambiguous or orphaned target produces no marker at all", () => {
  // Two siblings with the same tag, class and text: nothing distinguishes them
  // once the document shifts, so the frozen target stops resolving uniquely.
  const repeated = "<main><section class=\"same\">相同</section>"
    + "<section class=\"same\">相同</section></main>";
  const repeatedIndex = buildSourceIndex(repeated);
  const ambiguous = commentOn(repeatedIndex, "section", "改这个区块");
  const shiftedIndex = buildSourceIndex(`<!-- shifted -->${repeated}`);
  assert.deepEqual(previewCommentMarkerGroups(shiftedIndex, [ambiguous]), []);

  const unique = "<main><article id=\"gone\">待移除</article></main>";
  const uniqueIndex = buildSourceIndex(unique);
  const orphaned = commentOn(uniqueIndex, "article", "改这个");
  assert.deepEqual(
    previewCommentMarkerGroups(buildSourceIndex("<main></main>"), [orphaned]),
    [],
  );
});

test("an empty comment with no attachment contributes no marker", () => {
  const source = identified("<main><h1 id=\"title\">标题</h1><p id=\"body\">正文</p></main>");
  const sourceIndex = buildSourceIndex(source);
  const groups = previewCommentMarkerGroups(sourceIndex, [
    commentOn(sourceIndex, "h1", "   "),
    commentOn(sourceIndex, "p", "", { attachments: [{ id: "a" }, { id: "b" }] }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].items[0].text, "已添加 2 个参考附件");
  assert.equal(groups[0].items[0].attachmentCount, 2);
});

test("the measure request carries identities only, never comment text", () => {
  const source = identified("<main><h1 id=\"title\">标题</h1></main>");
  const sourceIndex = buildSourceIndex(source);
  const groups = previewCommentMarkerGroups(sourceIndex, [
    commentOn(sourceIndex, "h1", "这句话不能进入页面"),
  ]);
  const request = previewCommentMeasureRequest(groups);

  assert.equal(request.length, 1);
  assert.deepEqual(Object.keys(request[0]).sort(), ["key", "nodeId"]);
  assert.ok(!JSON.stringify(request).includes("这句话不能进入页面"));
});

test("a layout the host never asked for is discarded", () => {
  const allowed = new Set(["preview-comment-1", "preview-comment-2"]);
  const layouts = safePreviewCommentLayouts([
    { key: "preview-comment-1", left: 10, top: 20 },
    { key: "preview-comment-unrequested", left: 30, top: 40 },
    { key: "preview-comment-2", left: 50, top: 60 },
  ], allowed);

  assert.deepEqual(layouts, [
    { key: "preview-comment-1", left: 10, top: 20 },
    { key: "preview-comment-2", left: 50, top: 60 },
  ]);
});

test("a duplicated or non-finite layout never reaches the marker layer", () => {
  const allowed = new Set(["preview-comment-1"]);
  assert.deepEqual(
    safePreviewCommentLayouts([
      { key: "preview-comment-1", left: 10, top: 20 },
      { key: "preview-comment-1", left: 999, top: 999 },
    ], allowed),
    [{ key: "preview-comment-1", left: 10, top: 20 }],
  );
  for (const bad of [
    { key: "preview-comment-1", left: Number.NaN, top: 1 },
    { key: "preview-comment-1", left: 1, top: Number.POSITIVE_INFINITY },
    { key: "preview-comment-1", left: "10", top: {} },
    { key: "preview-comment-1" },
    null,
    "preview-comment-1",
  ]) {
    assert.deepEqual(
      safePreviewCommentLayouts([bad], allowed),
      [],
      `layout ${JSON.stringify(bad)} must be discarded`,
    );
  }
  assert.deepEqual(safePreviewCommentLayouts("not-an-array", allowed), []);
});

test("the marker layer stays bounded no matter how many layouts arrive", () => {
  const allowed = new Set(
    Array.from({ length: MAX_PREVIEW_COMMENT_GROUPS + 50 }, (_value, index) => (
      `preview-comment-${index + 1}`
    )),
  );
  const flooded = Array.from(
    { length: MAX_PREVIEW_COMMENT_GROUPS + 50 },
    (_value, index) => ({
      key: `preview-comment-${index + 1}`,
      left: index,
      top: index,
    }),
  );
  assert.equal(
    safePreviewCommentLayouts(flooded, allowed).length,
    MAX_PREVIEW_COMMENT_GROUPS,
  );
});

test("a global comment has no place on the page and gets no marker", () => {
  const sourceIndex = buildSourceIndex("<main><h1 id=\"title\">标题</h1></main>");
  const globalComment = {
    text: "整页再紧凑一点",
    attachments: [],
    sourceAnchor: { id: "page", level: "module", selector: "body", label: "整页" },
  };
  assert.deepEqual(previewCommentMarkerGroups(sourceIndex, [globalComment]), []);
});

test("no source index or no comment yields no marker", () => {
  const sourceIndex = buildSourceIndex("<main><h1>标题</h1></main>");
  assert.deepEqual(previewCommentMarkerGroups(null, []), []);
  assert.deepEqual(previewCommentMarkerGroups(sourceIndex, []), []);
  assert.deepEqual(previewCommentMarkerGroups(sourceIndex, [{ text: "无目标" }]), []);
});
