import assert from "node:assert/strict";
import test from "node:test";

import {
  revalidateCommentTextLocators,
  TEXT_LOCATOR_STALE_REASON,
} from "../app/application/run/text-locator-validation.js";

const ELEMENT_ID = "pr1_11111111111141118111111111111111";
const OTHER_ELEMENT_ID = "pr1_22222222222242229222222222222222";

function html(text, otherText = "") {
  return `<!doctype html><html><body><p data-pageroot-id="${ELEMENT_ID}">${text}</p><aside data-pageroot-id="${OTHER_ELEMENT_ID}">${otherText}</aside></body></html>`;
}

function comment(locator, overrides = {}) {
  return {
    commentId: "comment_text_locator",
    text: "请检查这段文字",
    sourceAnchor: {
      id: "target_comment_text_locator",
      elementId: ELEMENT_ID,
      resolution: "exact",
      textLocator: locator,
    },
    ...overrides,
  };
}

const locator = {
  quote: "目标",
  startOffset: 0,
  endOffset: 2,
  affinity: "forward",
};

test("an unchanged exact UTF-16 locator is accepted without rewriting the comment", () => {
  const comments = [comment(locator)];
  const result = revalidateCommentTextLocators(comments, html("目标内容"));

  assert.equal(result.ok, true);
  assert.equal(result.comments, comments);
});

test("a unique quote after a prefix insertion is refreshed within the same Stable-ID element", () => {
  const result = revalidateCommentTextLocators(
    [comment(locator)],
    html("😀目标内容"),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.comments[0].sourceAnchor.textLocator, {
    ...locator,
    startOffset: 2,
    endOffset: 4,
  });
});

test("rewritten, repeated, deleted, or cross-element quotes block submission", () => {
  for (const [name, source] of [
    ["rewritten", html("别的内容")],
    ["repeated in the same element", html("新目标和目标")],
    ["deleted", html("没有这段文字", "目标")],
    ["only similar elsewhere", html("新内容", "目标")],
  ]) {
    const result = revalidateCommentTextLocators([comment(locator)], source);
    assert.equal(result.ok, false, name);
    assert.equal(result.code, "RUN_SUBMISSION_TEXT_LOCATOR_STALE", name);
    assert.equal(result.reason, TEXT_LOCATOR_STALE_REASON, name);
  }
});

test("comments without textLocator keep the existing element-comment behavior", () => {
  const comments = [comment(undefined, {
    sourceAnchor: {
      id: "target_element_only",
      elementId: ELEMENT_ID,
      resolution: "exact",
    },
  })];
  const result = revalidateCommentTextLocators(comments, html("改写后的元素内容"));

  assert.equal(result.ok, true);
  assert.equal(result.comments, comments);
});

test("refresh updates only the source anchor and preserves runtime explanation", () => {
  const visualHint = { runtimeGenerated: true, kind: "table", label: "数据表" };
  const input = comment(locator, { visualHint });
  const result = revalidateCommentTextLocators([input], html("😀目标内容"));
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.comments[0], "target"), false);
  assert.equal(result.comments[0].sourceAnchor.textLocator.startOffset, 2);
  assert.equal(result.comments[0].visualHint, visualHint);
  assert.equal(input.sourceAnchor.textLocator.startOffset, 0);
});
