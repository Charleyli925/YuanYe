import { resolveReviewCommentSourceElement } from "./review-comment-source-map.js";

// Grouping rules for the read-only comment markers drawn over a preview.
//
// Pure and DOM-free: it maps saved comments onto the Stable IDs the preview
// already stamps as data-pageroot-id, so the marker layer never needs a
// second annotation pass over authored HTML. The measure protocol still calls
// that identity `nodeId` so the preview iframe contract stays one field.
//
// A target that cannot be resolved exactly produces no marker. The resolver
// fails closed on ambiguous and orphaned targets, so an unresolved comment is
// simply absent from the page rather than being parked in a corner as a fake
// marker. The comment itself is still readable in the round's detail view.

const MAX_PREVIEW_COMMENT_GROUPS = 200;
const MAX_PREVIEW_COMMENT_ITEMS = 20;
const MAX_PREVIEW_COMMENT_TEXT = 2_000;

function commentBodyText(comment) {
  const text = String(comment?.text || "").trim();
  if (text) return text.slice(0, MAX_PREVIEW_COMMENT_TEXT);
  const attachmentCount = comment?.attachments?.length || 0;
  return attachmentCount > 0 ? `已添加 ${attachmentCount} 个参考附件` : "";
}

// A global comment is about the page as a whole and has no place on it. Pinning
// it to <body> would put a marker in a corner the user never pointed at, so the
// preview shows none. The comment stays readable in the round's detail view.
function isGlobalTarget(target) {
  return String(target?.level || "") === "module"
    && String(target?.selector || "").trim().toLowerCase() === "body";
}

/**
 * @returns {Array<{ key: string, nodeId: string, items: Array<{ text: string, attachmentCount: number }> }>}
 */
export function previewCommentMarkerGroups(sourceIndex, comments) {
  if (!sourceIndex || !Array.isArray(comments) || comments.length === 0) {
    return [];
  }
  const byNodeId = new Map();
  for (const comment of comments) {
    const text = commentBodyText(comment);
    if (!text) continue;
    const target = comment?.sourceAnchor;
    if (!target || isGlobalTarget(target)) continue;
    const sourceElement = resolveReviewCommentSourceElement(sourceIndex, target);
    // Preview DOM is addressed by Stable ID. An ephemeral parse nodeId cannot
    // appear as data-pageroot-id, so it must not be sent to the page.
    const elementId = sourceElement?.pagerootId;
    if (!elementId) continue;
    const existing = byNodeId.get(elementId);
    const item = {
      text,
      attachmentCount: comment?.attachments?.length || 0,
    };
    if (existing) {
      if (existing.length < MAX_PREVIEW_COMMENT_ITEMS) existing.push(item);
      continue;
    }
    if (byNodeId.size >= MAX_PREVIEW_COMMENT_GROUPS) break;
    byNodeId.set(elementId, [item]);
  }
  return [...byNodeId.entries()].map(([nodeId, items], index) => ({
    key: `preview-comment-${index + 1}`,
    nodeId,
    items,
  }));
}

/**
 * The bounded request the preview host sends into the page. It carries marker
 * keys and source-node identities only: no comment text ever reaches the page.
 */
export function previewCommentMeasureRequest(groups) {
  return groups.map((group) => ({ key: group.key, nodeId: group.nodeId }));
}

/**
 * Accepts a layout array that arrived from the page and keeps only entries the
 * host actually asked for. A page script cannot introduce a marker, move one to
 * an unrequested key, or push a non-finite coordinate into React.
 */
export function safePreviewCommentLayouts(value, allowedKeys) {
  if (!Array.isArray(value)) return [];
  const layouts = [];
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const key = String(entry.key || "");
    if (!allowedKeys.has(key) || seen.has(key)) continue;
    const left = Number(entry.left);
    const top = Number(entry.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    seen.add(key);
    layouts.push({ key, left, top });
    if (layouts.length >= MAX_PREVIEW_COMMENT_GROUPS) break;
  }
  return layouts;
}

export {
  MAX_PREVIEW_COMMENT_GROUPS,
  MAX_PREVIEW_COMMENT_ITEMS,
};
