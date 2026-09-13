// Fixed text-host preflight for the private real-HTML runner.
//
// The runner cannot know a private page's selectors ahead of time, so it takes
// one deterministic snapshot of the current authored frame and freezes the
// first three explicitly qualified Stable-ID hosts.  The snapshot is the only
// discovery step.  Execution never searches for a replacement target.

export const TEXT_TARGET_COUNT = 3;
export const TEXT_TARGET_SELECTOR = "[data-pageroot-id]";
export const TEXT_TARGET_STABLE_ID_PATTERN = /^pr1_[0-9a-f]{32}$/u;

export const TEXT_TARGET_REASON_CODES = Object.freeze({
  PLAN_INVALID: "TEXT_TARGET_PLAN_INVALID",
  STABLE_ID_INVALID: "TEXT_TARGET_STABLE_ID_INVALID",
  STABLE_ID_DUPLICATE: "TEXT_TARGET_STABLE_ID_DUPLICATE",
  DOM_IDENTITY_INVALID: "TEXT_TARGET_DOM_IDENTITY_INVALID",
  DOM_IDENTITY_DRIFT: "TEXT_TARGET_DOM_IDENTITY_DRIFT",
  CONTAINER_REJECTED: "TEXT_TARGET_CONTAINER_REJECTED",
  HIDDEN_REJECTED: "TEXT_TARGET_HIDDEN_REJECTED",
  INTERACTIVE_REJECTED: "TEXT_TARGET_INTERACTIVE_REJECTED",
  EDITABLE_REJECTED: "TEXT_TARGET_EDITABLE_REJECTED",
  TEXT_EMPTY: "TEXT_TARGET_TEXT_EMPTY",
  FORMAT_NOT_OFF: "TEXT_TARGET_FORMAT_NOT_OFF",
  SNAPSHOT_INCOMPLETE: "TEXT_TARGET_SNAPSHOT_INCOMPLETE",
});

function asStableId(value) {
  return typeof value === "string" && TEXT_TARGET_STABLE_ID_PATTERN.test(value);
}

function formatState(format) {
  return {
    bold: format?.bold === true,
    italic: format?.italic === true,
    underline: format?.underline === true,
  };
}

/**
 * This function is passed directly to Playwright's frame.evaluateAll.  Keep
 * it self-contained: it must not depend on module state in the Node process.
 */
export function describeTextTarget(element) {
  const documentNode = element.ownerDocument;
  const view = documentNode.defaultView;
  const style = view?.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const id = element.getAttribute("data-pageroot-id");
  const parent = element.parentElement?.closest("[data-pageroot-id]") || null;
  const descendantSourceNodes = Array.from(
    element.querySelectorAll("[data-pageroot-id]"),
  );
  const descendantSourceIds = descendantSourceNodes
    .map((candidate) => candidate.getAttribute("data-pageroot-id"));
  const descendantSourceTags = descendantSourceNodes.map((candidate) => candidate.localName);
  const excludedAncestor = element.closest(
    "button,a,input,textarea,select,option,nav,[role=tab],[role=tablist],[contenteditable=true]",
  );
  const tag = element.localName;
  const sourceIdValid = /^pr1_[0-9a-f]{32}$/u.test(id || "");
  const text = element.textContent?.replace(/\s+/gu, " ").trim() || "";
  const hiddenByAttribute = element.hasAttribute("hidden")
    || element.getAttribute("aria-hidden") === "true"
    || element.hasAttribute("inert");
  const visible = Boolean(
    style
    && !hiddenByAttribute
    && style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0
    && rect.width > 0
    && rect.height > 0
    && element.getClientRects().length > 0,
  );
  const format = {
    bold: style?.fontWeight === "bold" || Number(style?.fontWeight || 0) >= 600,
    italic: style?.fontStyle === "italic" || style?.fontStyle === "oblique",
    underline: (style?.textDecorationLine || "").split(/\s+/u).includes("underline"),
  };
  const documentOrder = Array.from(
    documentNode.querySelectorAll("[data-pageroot-id]"),
  ).indexOf(element);
  const domIdentityValid = sourceIdValid
    && Array.from(documentNode.querySelectorAll("[data-pageroot-id]"))
      .filter((candidate) => candidate.getAttribute("data-pageroot-id") === id)
      .length === 1;
  return {
    id,
    tag,
    parentId: parent?.getAttribute("data-pageroot-id") || null,
    documentOrder,
    textLength: text.length,
    childCount: element.childElementCount,
    descendantSourceIds,
    descendantSourceTags,
    sourceIdValid,
    domIdentityValid,
    visible,
    interactive: Boolean(excludedAncestor),
    format,
    rect: {
      width: rect.width,
      height: rect.height,
    },
  };
}

function qualificationReasons(snapshot, {
  requireFormatProperty = null,
  requireFormatOff = false,
  allowInlineDescendants = false,
} = {}) {
  const reasons = [];
  if (!snapshot || typeof snapshot !== "object") {
    return [TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE];
  }
  if (!asStableId(snapshot.id) || snapshot.sourceIdValid !== true) {
    reasons.push(TEXT_TARGET_REASON_CODES.STABLE_ID_INVALID);
  }
  if (snapshot.domIdentityValid !== true) {
    reasons.push(TEXT_TARGET_REASON_CODES.DOM_IDENTITY_INVALID);
  }
  const descendantSourceTags = Array.isArray(snapshot.descendantSourceTags)
    ? snapshot.descendantSourceTags
    : [];
  const hasDisallowedDescendant = descendantSourceTags.length > 0
    && descendantSourceTags.some((tag) => !["br", "em", "i", "mark", "small", "span", "strong", "u"].includes(tag));
  if (
    Array.isArray(snapshot.descendantSourceIds)
    && snapshot.descendantSourceIds.length > 0
    && (!allowInlineDescendants || hasDisallowedDescendant)
  ) {
    reasons.push(TEXT_TARGET_REASON_CODES.CONTAINER_REJECTED);
  }
  if (snapshot.visible !== true) reasons.push(TEXT_TARGET_REASON_CODES.HIDDEN_REJECTED);
  if (snapshot.interactive === true) reasons.push(TEXT_TARGET_REASON_CODES.INTERACTIVE_REJECTED);
  if (snapshot.sourceEditable !== true) reasons.push(TEXT_TARGET_REASON_CODES.EDITABLE_REJECTED);
  if (!Number.isInteger(snapshot.textLength) || snapshot.textLength < 1) {
    reasons.push(TEXT_TARGET_REASON_CODES.TEXT_EMPTY);
  }
  if (
    requireFormatOff
    && ["bold", "italic", "underline"].some((property) => snapshot.format?.[property] !== false)
  ) {
    reasons.push(TEXT_TARGET_REASON_CODES.FORMAT_NOT_OFF);
  }
  if (requireFormatProperty && snapshot.format?.[requireFormatProperty] !== false) {
    reasons.push(TEXT_TARGET_REASON_CODES.FORMAT_NOT_OFF);
  }
  return reasons;
}

export function isTextTargetQualified(snapshot, options = {}) {
  return qualificationReasons(snapshot, options).length === 0;
}

export function textTargetQualificationReasons(snapshot, options = {}) {
  return qualificationReasons(snapshot, options);
}

/**
 * Select a small, deterministic fixed snapshot.  The caller must pass the
 * frame's document-order snapshot as-is; this function deliberately does not
 * sort, distribute, or retry candidates.
 */
export function createFixedTextTargetPlan(snapshots, {
  limit = TEXT_TARGET_COUNT,
  requireFormatTarget = true,
} = {}) {
  if (!Array.isArray(snapshots) || !Number.isInteger(limit) || limit < 1) {
    return {
      ok: false,
      reasonCode: TEXT_TARGET_REASON_CODES.PLAN_INVALID,
      reasons: [TEXT_TARGET_REASON_CODES.PLAN_INVALID],
      targets: [],
    };
  }
  const snapshotsById = new Map();
  for (const snapshot of snapshots) {
    if (typeof snapshot?.id !== "string") continue;
    const previous = snapshotsById.get(snapshot.id);
    if (!previous || (!isTextTargetQualified(previous) && isTextTargetQualified(snapshot))) {
      snapshotsById.set(snapshot.id, snapshot);
    }
  }
  const uniqueSnapshots = [...snapshotsById.values()];
  const qualified = uniqueSnapshots.filter((snapshot) => isTextTargetQualified(snapshot));
  const formatTarget = requireFormatTarget
    ? qualified.find((snapshot) => isTextTargetQualified(
      snapshot,
      { requireFormatOff: true },
    ))
    : qualified[0];
  if (qualified.length < limit || !formatTarget) {
    return {
      ok: false,
      reasonCode: TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE,
      reasons: [TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE],
      available: qualified.length,
      required: limit,
      rejected: uniqueSnapshots
        .filter((snapshot) => !isTextTargetQualified(snapshot))
        .map((snapshot) => ({
          id: asStableId(snapshot?.id) ? snapshot.id : null,
          reasons: textTargetQualificationReasons(snapshot),
        })),
      targets: [],
    };
  }
  return {
    ok: true,
    reasonCode: null,
    available: qualified.length,
    required: limit,
    targets: [
      formatTarget,
      ...qualified.filter((snapshot) => snapshot.id !== formatTarget.id),
    ].slice(0, limit).map((snapshot) => ({
      id: snapshot.id,
      tag: snapshot.tag,
      parentId: snapshot.parentId || null,
      documentOrder: snapshot.documentOrder,
      tabId: snapshot.tabId || null,
      sourceEditable: true,
      initialFormat: formatState(snapshot.format),
      snapshot: {
        id: snapshot.id,
        tag: snapshot.tag,
        parentId: snapshot.parentId || null,
        documentOrder: snapshot.documentOrder,
      },
    })),
  };
}

/**
 * Revalidate one frozen target immediately before an action.  Text length and
 * geometry are intentionally live facts, while Stable ID/tag/parent identity
 * remain frozen.  A changed target is rejected; no alternate target is ever
 * returned.
 */
export function validateFrozenTextTarget(snapshot, plan, {
  requireFormatProperty = null,
  allowInlineDescendants = true,
} = {}) {
  const reasons = qualificationReasons(snapshot, {
    requireFormatProperty,
    allowInlineDescendants,
  });
  if (!plan || typeof plan !== "object") reasons.push(TEXT_TARGET_REASON_CODES.PLAN_INVALID);
  if (plan?.id !== snapshot?.id || plan?.tag !== snapshot?.tag || (
    plan?.parentId || null
  ) !== (snapshot?.parentId || null)) {
    reasons.push(TEXT_TARGET_REASON_CODES.DOM_IDENTITY_DRIFT);
  }
  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}
