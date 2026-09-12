// Relink presentation rules for comments whose targets cannot be proven.
//
// Pure and DOM-free so the load-bearing structure rules stay pinned by a Node
// test instead of only by review:
//
//   - The unsafe set is exactly "has content and cannot be located" — the same
//     predicate submission blocks on, so the rail card's count can never
//     disagree with the block reason.
//   - The durable relink action lives on the comment rail, a persistent
//     surface that page reflow cannot detach. A second toast pointer is
//     forbidden: a toast button could be lost to a mid-click reflow with
//     no retry loop for a human (#281).
//
// `canLocateTarget` and `commentHasContent` also live here so the predicate
// has one home; comment-model.ts re-exports them for existing consumers.

import { isValidPagerootElementId } from "../../shared/pageroot-element-identity.mjs";
import { buildSourceIndex } from "../lib/source-index.js";

/** @param {{ resolution?: string, elementId?: string, commentAnchor?: { resolution?: string, elementId?: string } }} target */
export function canLocateTarget(target) {
  const persist = target?.commentAnchor || target;
  return (persist?.resolution === "exact" || persist?.resolution === "rebound")
    && isValidPagerootElementId(persist?.elementId);
}

/**
 * Explicit whole-page comments persist against the body's Stable ID.
 * A body without a valid ID cannot be saved; the caller must not invent a
 * selector-only global target.
 *
 * @param {string} html
 * @returns {{
 *   id: string,
 *   elementId: string,
 *   label: string,
 *   selector: string,
 *   level: "module",
 *   tagName: "body",
 *   text: string,
 *   resolution: "exact",
 * } | null}
 */
export function globalPageCommentTargetFromHtml(html) {
  const index = buildSourceIndex(String(html || ""));
  const body = index.elements.find((element) => element.tagName === "body");
  if (!isValidPagerootElementId(body?.pagerootId)) return null;
  return Object.freeze({
    id: "target_global_page",
    elementId: body.pagerootId,
    label: "整个页面",
    selector: "body",
    level: "module",
    tagName: "body",
    text: "",
    resolution: "exact",
  });
}

/**
 * @param {{ text?: string, attachments?: unknown[] }} comment
 * @returns {boolean}
 */
export function commentHasContent(comment) {
  return Boolean(comment.text.trim() || comment.attachments?.length);
}

/**
 * Comments that still carry content but whose targets cannot be proven.
 *
 * @param {ReadonlyArray<import("./types").CommentItem>} comments
 * @returns {import("./types").CommentItem[]}
 */
export function unsafeRelinkComments(comments) {
  return comments.filter(
    (comment) => commentHasContent(comment)
      && !canLocateTarget(comment.sourceAnchor),
  );
}
