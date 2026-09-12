import { buildSourceIndex } from "../../lib/source-index.js";

export const TEXT_LOCATOR_STALE_REASON =
  "选中文字已经变化，请重新选择文字，或改为整个元素评论。";

const TEXT_LOCATOR_CODE = "RUN_SUBMISSION_TEXT_LOCATOR_STALE";

function failed(comment) {
  return {
    ok: false,
    code: TEXT_LOCATOR_CODE,
    commentId: String(comment?.commentId || ""),
    reason: TEXT_LOCATOR_STALE_REASON,
  };
}

function descendantText(sourceIndex, element, visiting = new Set()) {
  if (visiting.has(element.nodeId)) return null;
  visiting.add(element.nodeId);
  const pieces = [];
  for (const childId of element.childIds) {
    const child = sourceIndex.byNodeId.get(childId);
    if (!child) return null;
    if (child.type === "text") {
      pieces.push(child.value);
    } else if (child.type === "element") {
      const text = descendantText(sourceIndex, child, visiting);
      if (text === null) return null;
      pieces.push(text);
    }
  }
  visiting.delete(element.nodeId);
  return pieces.join("");
}

function uniqueQuoteOffset(text, quote) {
  const offsets = [];
  let cursor = 0;
  while (cursor <= text.length - quote.length) {
    const offset = text.indexOf(quote, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    if (offsets.length > 1) return null;
    cursor = offset + quote.length;
  }
  return offsets.length === 1 ? offsets[0] : null;
}

function validTextLocator(locator) {
  return Boolean(
    locator
    && typeof locator.quote === "string"
    && locator.quote.length > 0
    && locator.quote.length <= 5_000
    && Number.isSafeInteger(locator.startOffset)
    && Number.isSafeInteger(locator.endOffset)
    && locator.startOffset >= 0
    && locator.endOffset > locator.startOffset
    && (locator.affinity === "forward" || locator.affinity === "backward"),
  );
}

/**
 * Revalidates comment text ranges against the final saved source HTML.
 *
 * The range is measured in UTF-16 code units of the owning element's decoded
 * descendant text, matching createElementTextLocator(). A stale range may be
 * refreshed only when its exact quote occurs once in that same Stable-ID
 * element; no selector, fuzzy, or cross-element fallback is allowed.
 */
export function revalidateCommentTextLocators(comments, html) {
  if (!Array.isArray(comments)) {
    return failed(null);
  }

  let sourceIndex;
  try {
    sourceIndex = buildSourceIndex(String(html ?? ""));
  } catch {
    const comment = comments.find((item) => (
      item?.sourceAnchor?.textLocator
    ));
    return comment ? failed(comment) : { ok: true, comments };
  }

  let changed = false;
  const normalized = comments.map((comment) => {
    const sourceTarget = comment?.sourceAnchor;
    const locator = sourceTarget?.textLocator;
    if (locator === undefined || locator === null) return comment;

    const elementId = String(sourceTarget?.elementId || "");
    const element = sourceIndex.byPagerootId.get(elementId);
    if (
      !element
      || element.pagerootId !== elementId
      || element.pagerootIdentityStatus !== "valid"
    ) {
      return failed(comment);
    }
    if (!validTextLocator(locator)) return failed(comment);

    const text = descendantText(sourceIndex, element);
    if (text === null) return failed(comment);
    if (
      locator.endOffset <= text.length
      && text.slice(locator.startOffset, locator.endOffset) === locator.quote
    ) {
      return comment;
    }

    const startOffset = uniqueQuoteOffset(text, locator.quote);
    if (startOffset === null) return failed(comment);
    changed = true;
    const nextTextLocator = {
      ...locator,
      startOffset,
      endOffset: startOffset + locator.quote.length,
    };
    const nextSourceTarget = {
      ...sourceTarget,
      textLocator: nextTextLocator,
    };
    return { ...comment, sourceAnchor: nextSourceTarget };
  });

  const failure = normalized.find((item) => item?.ok === false);
  if (failure) return failure;
  return { ok: true, comments: changed ? normalized : comments };
}
