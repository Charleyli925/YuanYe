import {
  buildSourceIndex,
  normalizeSourceText,
  sourceSha256,
} from "./source-index.js";
import { isPositionalSelector } from "../../bridge/target-identity.mjs";
import { isValidPagerootElementId } from "../../shared/pageroot-element-identity.mjs";

const TARGET_LEVELS = new Set([
  "module",
  "subregion",
  "text",
  "insertion-point",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function targetIdFor(payload) {
  return `target_${sourceSha256(canonicalJson(payload)).slice("sha256:".length, 27)}`;
}

function cloneFingerprint(fingerprint) {
  if (!fingerprint) return undefined;
  return {
    tagName: fingerprint.tagName,
    stableAttributes: { ...(fingerprint.stableAttributes ?? {}) },
    ancestorFingerprint: [...(fingerprint.ancestorFingerprint ?? [])],
    textPrefix: fingerprint.textPrefix,
    textSuffix: fingerprint.textSuffix,
  };
}

function targetNode(index, nodeOrId) {
  if (typeof nodeOrId === "string") {
    if (isValidPagerootElementId(nodeOrId)) {
      return index.byPagerootId.get(nodeOrId) ?? null;
    }
    return index.byNodeId.get(nodeOrId) ?? null;
  }
  return nodeOrId && typeof nodeOrId.nodeId === "string" ? nodeOrId : null;
}

export function createTargetRef(indexOrHtml, nodeOrId, options = {}) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const requestedNode = targetNode(index, nodeOrId);
  if (
    !requestedNode
    || (requestedNode.type !== "element" && requestedNode.type !== "text")
  ) {
    throw new TypeError("TargetRef requires a source-backed element or text node.");
  }

  const level = options.level
    ?? (requestedNode.type === "text" ? "text" : "subregion");
  if (!TARGET_LEVELS.has(level) || level === "insertion-point") {
    throw new TypeError(
      "Element TargetRef level must be module, subregion, or text.",
    );
  }
  if (requestedNode.type === "text" && level !== "text") {
    throw new TypeError("A text node can only create a text-level TargetRef.");
  }

  const requestedParent = requestedNode.type === "text" && requestedNode.parentId
    ? index.byNodeId.get(requestedNode.parentId)
    : null;
  const subject = requestedNode.type === "element"
    ? requestedNode
    : requestedParent;
  if (!subject || subject.type !== "element") {
    throw new TypeError("A text TargetRef requires a source-backed parent element.");
  }

  let node = requestedNode;
  if (requestedNode.type === "element" && level === "text") {
    const children = requestedNode.childIds.map(
      (nodeId) => index.byNodeId.get(nodeId),
    );
    if (children.length !== 1 || children[0]?.type !== "text") {
      throw new TypeError(
        "A text-level TargetRef requires exactly one direct text node.",
      );
    }
    node = children[0];
  }

  const normalizedText = node.type === "text"
    ? normalizeSourceText(node.value)
    : subject.textContent;
  const fingerprint = cloneFingerprint(subject.fingerprint);
  if (node.type === "text" && normalizedText) {
    fingerprint.textPrefix = normalizedText;
    fingerprint.textSuffix = normalizedText;
  }
  const identity = {
    level,
    sourceSha256: index.sourceSha256,
    startOffset: node.range.startOffset,
    endOffset: node.range.endOffset,
    fingerprint,
  };
  const elementId = subject.pagerootId ?? undefined;
  return {
    targetId: options.targetId ?? targetIdFor(
      elementId ? { level, elementId } : identity,
    ),
    ...(elementId ? { elementId } : {}),
    expectedSourceSha256: index.sourceSha256,
    label: options.label ?? (node.type === "text" ? subject.label : node.label),
    level,
    selector: options.selector ?? subject.selector,
    ...(node.type === "text" || normalizedText
      ? { textQuote: node.type === "text" ? node.value : normalizedText }
      : {}),
    sourceAnchor: {
      startOffset: node.range.startOffset,
      endOffset: node.range.endOffset,
      sourceSha256: index.sourceSha256,
    },
    fingerprint,
    resolution: "exact",
  };
}

export function cleanTargetRef(targetRef, resolution = targetRef?.resolution ?? "exact") {
  const cleaned = {
    targetId: String(targetRef?.targetId ?? ""),
    label: String(targetRef?.label ?? ""),
    level: targetRef?.level,
    resolution,
  };
  if (targetRef?.elementId) cleaned.elementId = String(targetRef.elementId);
  if (targetRef?.expectedSourceSha256) {
    cleaned.expectedSourceSha256 = String(targetRef.expectedSourceSha256);
  }
  if (targetRef?.selector) cleaned.selector = String(targetRef.selector);
  if (targetRef?.textQuote !== undefined) cleaned.textQuote = String(targetRef.textQuote);
  if (targetRef?.textLocator) {
    cleaned.textLocator = {
      quote: String(targetRef.textLocator.quote ?? ""),
      startOffset: targetRef.textLocator.startOffset,
      endOffset: targetRef.textLocator.endOffset,
      affinity: targetRef.textLocator.affinity,
    };
  }
  if (targetRef?.sourceAnchor) {
    cleaned.sourceAnchor = {
      startOffset: targetRef.sourceAnchor.startOffset,
      endOffset: targetRef.sourceAnchor.endOffset,
      sourceSha256: targetRef.sourceAnchor.sourceSha256,
    };
  }
  if (targetRef?.fingerprint) cleaned.fingerprint = cloneFingerprint(targetRef.fingerprint);
  return cleaned;
}

export function createInsertionPointTargetRef(indexOrHtml, options) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const parent = targetNode(index, options?.parentId);
  if (!parent || parent.type !== "element") {
    throw new TypeError("An insertion point requires a source-backed parent element.");
  }
  const before = options.beforeSiblingId
    ? targetNode(index, options.beforeSiblingId)
    : null;
  if (before && (before.type !== "element" || before.parentId !== parent.nodeId)) {
    throw new TypeError("Insertion-point sibling must belong to the selected parent.");
  }
  const offset = before?.range.startOffset ?? parent.contentRange.endOffset;
  const contextSize = 64;
  const textPrefix = index.source.slice(
    Math.max(parent.contentRange.startOffset, offset - contextSize),
    offset,
  );
  const textSuffix = index.source.slice(
    offset,
    Math.min(parent.contentRange.endOffset, offset + contextSize),
  );
  const fingerprint = cloneFingerprint(parent.fingerprint);
  fingerprint.textPrefix = textPrefix || undefined;
  fingerprint.textSuffix = textSuffix || undefined;
  return {
    targetId: options.targetId ?? targetIdFor(parent.pagerootId
      ? { level: "insertion-point", elementId: parent.pagerootId, offset }
      : {
          level: "insertion-point",
          sourceSha256: index.sourceSha256,
          offset,
          fingerprint,
        }),
    ...(parent.pagerootId ? { elementId: parent.pagerootId } : {}),
    expectedSourceSha256: index.sourceSha256,
    label: options.label ?? `Insert in ${parent.label}`,
    level: "insertion-point",
    selector: parent.selector,
    sourceAnchor: {
      startOffset: offset,
      endOffset: offset,
      sourceSha256: index.sourceSha256,
    },
    fingerprint,
    resolution: "exact",
  };
}

function simpleSelectorMatches(element, selector) {
  if (!selector) return false;
  if (element.selector === selector) return true;
  const id = selector.match(/^#([^\s>+~:[\]]+)$/)?.[1];
  if (id) return element.stableAttributes.id === id.replace(/\\/g, "");
  const tagAndId = selector.match(/^([a-zA-Z][\w-]*)#([^\s>+~:[\]]+)$/);
  if (tagAndId) {
    return element.tagName === tagAndId[1].toLowerCase()
      && element.stableAttributes.id === tagAndId[2].replace(/\\/g, "");
  }
  return false;
}

function ancestorMatches(targetAncestors, candidateAncestors) {
  let count = 0;
  const length = Math.min(targetAncestors.length, candidateAncestors.length);
  for (let index = 0; index < length; index += 1) {
    if (targetAncestors[index] !== candidateAncestors[index]) break;
    count += 1;
  }
  return count;
}

function exactNode(index, targetRef) {
  const anchor = targetRef.sourceAnchor;
  if (!anchor || anchor.sourceSha256 !== index.sourceSha256) return null;
  const candidates = targetRef.level === "text"
    ? index.textNodes
    : index.elements;
  return candidates.find((candidate) => (
    candidate.range.startOffset === anchor.startOffset
    && candidate.range.endOffset === anchor.endOffset
    && exactFingerprintMatches(index, targetRef, candidate)
  )) ?? null;
}

function exactFingerprintMatches(index, targetRef, candidate) {
  const subject = candidate.type === "text"
    ? index.byNodeId.get(candidate.parentId)
    : candidate;
  if (!subject || subject.type !== "element") return false;
  const fingerprint = targetRef.fingerprint ?? {};
  if (
    fingerprint.tagName
    && subject.tagName !== String(fingerprint.tagName).toLowerCase()
  ) {
    return false;
  }
  for (const [name, value] of Object.entries(fingerprint.stableAttributes ?? {})) {
    if (subject.stableAttributes[name] !== value) return false;
  }
  const targetAncestors = fingerprint.ancestorFingerprint ?? [];
  if (
    targetAncestors.length > 0
    && ancestorMatches(
      targetAncestors,
      subject.fingerprint?.ancestorFingerprint ?? [],
    ) !== targetAncestors.length
  ) {
    return false;
  }
  if (
    targetRef.selector
    && !simpleSelectorMatches(subject, targetRef.selector)
  ) {
    return false;
  }
  if (targetRef.textQuote !== undefined) {
    const actualText = candidate.type === "text"
      ? candidate.value
      : normalizeSourceText(subject.textContent);
    const expectedText = candidate.type === "text"
      ? String(targetRef.textQuote)
      : normalizeSourceText(targetRef.textQuote);
    if (actualText !== expectedText) return false;
  }
  return true;
}

function resolved(targetRef, resolution, target, candidates, reason) {
  return {
    resolution,
    target: target ?? null,
    candidates,
    reason,
    targetRef: cleanTargetRef(targetRef, resolution),
  };
}

function insertionBoundaries(index, parent) {
  return new Set([
    parent.contentRange.startOffset,
    parent.contentRange.endOffset,
    ...parent.childIds.flatMap((nodeId) => {
      const child = index.byNodeId.get(nodeId);
      return [child.range.startOffset, child.range.endOffset];
    }),
  ]);
}

function resolveInsertionPoint(index, targetRef) {
  const anchor = targetRef.sourceAnchor;
  if (
    !anchor
    || !Number.isInteger(anchor.startOffset)
    || !Number.isInteger(anchor.endOffset)
    || anchor.startOffset !== anchor.endOffset
  ) {
    return resolved(
      targetRef,
      "orphaned",
      null,
      [],
      "insertion-anchor-must-be-zero-width",
    );
  }

  const parent = index.byPagerootId.get(targetRef.elementId) ?? null;
  if (!parent) {
    return resolved(targetRef, "orphaned", null, [], "stable-parent-not-found");
  }
  if (anchor.sourceSha256 === index.sourceSha256) {
    const exactBoundary = anchor.startOffset >= parent.contentRange.startOffset
      && anchor.startOffset <= parent.contentRange.endOffset
      && insertionBoundaries(index, parent).has(anchor.startOffset)
      && (
        !targetRef.selector
        || !isPositionalSelector(targetRef.selector)
        || simpleSelectorMatches(parent, targetRef.selector)
      );
    if (exactBoundary) {
      return resolved(
        targetRef,
        "exact",
        { type: "insertion-point", offset: anchor.startOffset, parentId: parent.nodeId },
        [],
        "source-anchor-and-parent-match",
      );
    }
    return resolved(
      targetRef,
      "orphaned",
      null,
      [],
      "exact-anchor-not-a-parent-child-boundary",
    );
  }

  const targetFingerprint = targetRef.fingerprint ?? {};
  const prefix = targetFingerprint.textPrefix ?? "";
  const suffix = targetFingerprint.textSuffix ?? "";
  const candidates = [...insertionBoundaries(index, parent)]
    .filter((offset) => offset >= parent.contentRange.startOffset && offset <= parent.contentRange.endOffset)
    .map((offset) => ({
      offset,
      prefix: !prefix || index.source.slice(Math.max(parent.contentRange.startOffset, offset - prefix.length), offset) === prefix,
      suffix: !suffix || index.source.slice(offset, Math.min(parent.contentRange.endOffset, offset + suffix.length)) === suffix,
    }));
  let matches = candidates.filter((candidate) => candidate.prefix && candidate.suffix);
  if (matches.length === 0 && suffix) matches = candidates.filter((candidate) => candidate.suffix);
  if (matches.length === 0 && prefix) matches = candidates.filter((candidate) => candidate.prefix);
  if (matches.length > 1) {
    return resolved(targetRef, "ambiguous", null, matches, "source-context-ambiguous");
  }
  const offset = matches[0]?.offset;
  if (!Number.isInteger(offset)) {
    return resolved(targetRef, "orphaned", null, [], "source-context-not-found");
  }
  return resolved(
    targetRef,
    "rebound",
    { type: "insertion-point", offset, parentId: parent.nodeId },
    [],
    "insertion-point-rebound",
  );
}

function resolveByStableElementId(index, targetRef) {
  if (!isValidPagerootElementId(targetRef.elementId)) {
    return resolved(targetRef, "orphaned", null, [], "stable-element-id-invalid");
  }
  const element = index.byPagerootId.get(targetRef.elementId) ?? null;
  if (!element) {
    return resolved(targetRef, "orphaned", null, [], "stable-element-not-found");
  }
  if (targetRef.level === "text") {
    if (targetRef.expectedSourceSha256 === index.sourceSha256) {
      const exact = exactNode(index, targetRef);
      if (exact?.type === "text" && exact.parentId === element.nodeId) {
        return resolved(
          targetRef,
          "exact",
          exact,
          [],
          "stable-element-and-source-hash-match",
        );
      }
    }
    const directTextNodes = element.textNodeIds
      .map((nodeId) => index.byNodeId.get(nodeId))
      .filter((node) => node?.type === "text");
    if (directTextNodes.length !== 1) {
      return resolved(targetRef, "orphaned", null, [], "stable-text-node-not-unique");
    }
    return resolved(
      targetRef,
      "exact",
      directTextNodes[0],
      [],
      targetRef.expectedSourceSha256 === index.sourceSha256
        ? "stable-element-and-source-hash-match"
        : "stable-element-match",
    );
  }
  return resolved(
    targetRef,
    "exact",
    element,
    [],
    targetRef.expectedSourceSha256 === index.sourceSha256
      ? "stable-element-and-source-hash-match"
      : "stable-element-match",
  );
}

function resolveManagedOfficialTargetRef(index, targetRef) {
  if (targetRef.level === "insertion-point") {
    if (!isValidPagerootElementId(targetRef.elementId)) {
      return resolved(
        targetRef,
        "orphaned",
        null,
        [],
        targetRef.elementId === undefined
          ? "managed-insertion-requires-parent-id" : "stable-parent-id-invalid",
      );
    }
    return resolveInsertionPoint(index, targetRef);
  }
  if (targetRef.elementId === undefined) {
    return resolved(targetRef, "orphaned", null, [], "managed-element-id-required");
  }
  return resolveByStableElementId(index, targetRef);
}

export function resolveTargetRef(indexOrHtml, targetRef, options = {}) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  if (!targetRef || typeof targetRef !== "object") {
    throw new TypeError("resolveTargetRef requires a TargetRef.");
  }
  if (!TARGET_LEVELS.has(targetRef.level)) {
    throw new TypeError(
      "TargetRef level must be module, subregion, text, or insertion-point.",
    );
  }
  void options;
  return resolveManagedOfficialTargetRef(index, targetRef);
}

export class TargetResolver {
  constructor(indexOrHtml) {
    this.index = typeof indexOrHtml === "string"
      ? buildSourceIndex(indexOrHtml)
      : indexOrHtml;
  }

  rebind(targetRef) {
    return resolveTargetRef(this.index, targetRef);
  }
}
