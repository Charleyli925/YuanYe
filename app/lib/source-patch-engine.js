import {
  buildSourceIndex,
  compareParseIntegrity,
  resolveOwnedSourceIndex,
  SourceIndexError,
  sourceSha256,
} from "./source-index.js";
import { recordEditPipelineCount } from "./edit-pipeline-counters.js";
import { decodeHTML } from "entities";
import {
  canonicalSourceStyleDeclaration,
} from "../../shared/source-style-value.mjs";
import {
  planSemanticPlainTextPatch,
} from "../../shared/editable-island.mjs";
import {
  planSemanticStructurePatches,
} from "../../shared/semantic-structure-plan.mjs";
import {
  editableIslandForTarget,
  materializeEditableIslandHtml,
  normalizeEditableIslandHtml,
} from "./editable-island.js";
import { isNativeDirectEditRoot } from "./native-edit-capability.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  generatePagerootElementId,
  isValidPagerootElementId,
} from "./pageroot-element-identity.js";
import {
  cleanTargetRef,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveTargetRef,
} from "./target-resolver.js";

const TEXT_RANGE_ID_REPLAY_TOKEN = Symbol("text-range-id-replay");
const EDITABLE_ISLAND_ID_REPLAY_TOKEN = Symbol("editable-island-id-replay");

const RAW_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);

const TEXT_RANGE_UNSAFE_CONTEXT_ELEMENTS = new Set([
  ...RAW_TEXT_ELEMENTS,
  "col",
  "colgroup",
  "option",
  "optgroup",
  "select",
  "table",
  "tbody",
  "textarea",
  "tfoot",
  "thead",
  "title",
  "tr",
]);

const TRUSTED_INVERSE_PLANS = new WeakMap();
const CSS_PROPERTY_NAME_PATTERN = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/;
const HTML_ATTRIBUTE_NAME_PATTERN = /^[^\u0000-\u0020"'/>=]+$/u;
// `display: contents` looks geometry-neutral but Chromium can mutate a
// cross-wrapper Selection without dispatching beforeinput/input to the owning
// contenteditable host. A normal inline box keeps the native editing event
// pipeline intact. `all: unset` preserves inherited text properties while
// clearing box metrics; callers already reject flex/grid item and visible
// background cases where a new inline box would not be layout-safe.
const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important";
export function supportsTextRangeEditing(tagName) {
  return isNativeDirectEditRoot(tagName);
}

export class SourcePatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourcePatchError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SourcePatchError(code, message, details);
}

function expectedHash(command, index) {
  const expected = command.expectedSourceSha256 ?? index.sourceSha256;
  if (expected !== index.sourceSha256) {
    fail(
      "STALE_SOURCE_HASH",
      "The source changed after this edit command was created.",
      { expectedSourceSha256: expected, actualSourceSha256: index.sourceSha256 },
    );
  }
  return expected;
}

function commandTargetRef(index, command, key = "targetRef") {
  const targetRef = officialCommandTarget(index, command, key);
  if (targetRef) return targetRef;
  fail(
    "TARGET_REQUIRED",
    `Edit command is missing a Stable ID for ${key}.`,
  );
}

function liveElementIdFromCommand(command, key) {
  if (key === "beforeTargetRef") {
    return command.beforeElementId || command.beforeTargetRef?.elementId || null;
  }
  if (key === "targetRef") {
    return command.elementId || command.targetRef?.elementId || null;
  }
  return null;
}

function officialCommandTarget(index, command, key = "targetRef") {
  const elementId = liveElementIdFromCommand(command, key);
  if (!elementId) return null;
  const element = index.byPagerootId.get(elementId);
  if (!element || element.type !== "element") {
    fail(
      "TARGET_ORPHANED",
      "The live Stable ID is no longer in this source.",
      { elementId, key },
    );
  }
  const original = command[key];
  return createTargetRef(index, element, {
    targetId: original?.targetId,
    label: original?.label,
    level: original?.level ?? command.level ?? "subregion",
  });
}

function resolvedTarget(index, targetRef, expectedType = null) {
  const resolution = resolveTargetRef(index, targetRef);
  if (resolution.resolution === "ambiguous") {
    fail(
      "TARGET_AMBIGUOUS",
      "The edit target matches more than one source node.",
      { targetRef, candidates: resolution.candidates },
    );
  }
  if (!resolution.target || resolution.resolution === "orphaned") {
    fail(
      "TARGET_ORPHANED",
      "The edit target no longer exists in the current source.",
      { targetRef },
    );
  }
  if (expectedType && resolution.target.type !== expectedType) {
    fail(
      "UNSUPPORTED_TARGET_TYPE",
      `This edit requires a ${expectedType} target.`,
      { actualType: resolution.target.type },
    );
  }
  return resolution;
}

function refreshResolvedTargetRef(index, targetRef, target) {
  return createTargetRef(index, target, {
    targetId: targetRef.targetId,
    label: targetRef.label,
    level: targetRef.level,
    selector: target.selector,
  });
}

function sourcePatch(startOffset, endOffset, before, after, metadata = {}) {
  return {
    startOffset,
    endOffset,
    before,
    after,
    ...metadata,
  };
}

function makePlan(index, command, patches, targetRefs, metadata = {}) {
  const ordered = [...patches].sort((left, right) => left.startOffset - right.startOffset);
  let previousEnd = -1;
  for (const patch of ordered) {
    if (
      !Number.isInteger(patch.startOffset)
      || !Number.isInteger(patch.endOffset)
      || patch.startOffset < 0
      || patch.endOffset < patch.startOffset
      || patch.endOffset > index.source.length
    ) {
      fail("INVALID_PATCH_RANGE", "Patch range is outside the source.", { patch });
    }
    if (patch.startOffset < previousEnd) {
      fail("OVERLAPPING_PATCHES", "Patch ranges overlap.", { patches: ordered });
    }
    if (index.source.slice(patch.startOffset, patch.endOffset) !== patch.before) {
      fail("STALE_BEFORE_CONTENT", "Patch before-content no longer matches the source.", { patch });
    }
    previousEnd = patch.endOffset;
  }
  return {
    version: 1,
    type: command.type,
    sourceSha256: expectedHash(command, index),
    patches: ordered,
    targetRefs,
    metadata,
  };
}

function isDescendantNode(index, node, ancestor) {
  let current = node;
  while (current?.parentId) {
    if (current.parentId === ancestor.nodeId) return true;
    current = index.byNodeId.get(current.parentId);
  }
  return false;
}

function semanticElement(index, elementId, expectedTagName, fieldName) {
  if (!isValidPagerootElementId(elementId)) {
    fail("SEMANTIC_ELEMENT_ID_INVALID", `${fieldName} must carry a valid stable element ID.`, {
      fieldName,
      elementId,
    });
  }
  const element = index.byPagerootId.get(elementId) ?? null;
  if (!element) {
    fail("SEMANTIC_ELEMENT_NOT_FOUND", `${fieldName} is not present in the exact source.`, {
      fieldName,
      elementId,
    });
  }
  const tagName = String(expectedTagName ?? "").toLowerCase();
  if (!tagName || element.tagName !== tagName) {
    fail("SEMANTIC_ELEMENT_TAG_MISMATCH", `${fieldName} stable ID moved to a different authored tag.`, {
      fieldName,
      elementId,
      expectedTagName: tagName || null,
      actualTagName: element.tagName,
    });
  }
  return element;
}

function assertCompleteSemanticIdentity(index) {
  if (!index.pagerootIdentity?.complete || !index.pagerootIdentity.valid) {
    fail(
      "SEMANTIC_IDENTITY_INCOMPLETE",
      "Semantic operations require a managed source with complete valid element identity.",
      { pagerootIdentity: index.pagerootIdentity },
    );
  }
}

function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
}

function directChildElement(index, parent, elementId, expectedTagName, fieldName) {
  const element = semanticElement(index, elementId, expectedTagName, fieldName);
  if (element.parentId !== parent.nodeId) {
    fail("SEMANTIC_INSERTION_PARENT_MISMATCH", `${fieldName} is not a direct child of the declared parent.`, {
      fieldName,
      elementId,
      parentElementId: parent.pagerootId,
    });
  }
  return element;
}

function semanticInsertion(index, command) {
  const parent = semanticElement(
    index,
    command.parentElementId,
    command.parentTagName,
    "parent",
  );
  if (parent.isVoid) {
    fail("SEMANTIC_VOID_PARENT", "A void element cannot own an insertion point.", {
      parentElementId: parent.pagerootId,
      tagName: parent.tagName,
    });
  }
  const before = command.beforeElementId
    ? directChildElement(
      index,
      parent,
      command.beforeElementId,
      command.beforeTagName,
      "before",
    )
    : null;
  const targetRef = createInsertionPointTargetRef(index, {
    parentId: parent.nodeId,
    ...(before ? { beforeSiblingId: before.nodeId } : {}),
    label: `semantic insertion in <${parent.tagName}>`,
  });
  return {
    parent,
    before,
    offset: before?.range.startOffset ?? parent.contentRange.endOffset,
    targetRef,
  };
}

function semanticStructurePlanElements(index) {
  return index.elements.map((element) => ({
    elementId: element.pagerootId,
    tagName: element.tagName,
    parentElementId: element.parentId
      ? index.byNodeId.get(element.parentId)?.pagerootId ?? null
      : null,
    startOffset: element.range.startOffset,
    endOffset: element.range.endOffset,
    contentStartOffset: element.contentRange.startOffset,
    contentEndOffset: element.contentRange.endOffset,
    explicitEndTag: element.explicitEndTag,
    isVoid: element.isVoid,
    selfClosing: element.startTagRange.endOffset === element.range.endOffset
      && /\/\s*>$/u.test(element.startTagRaw),
    boundarySafe: element.boundarySafe,
  }));
}

function sharedSemanticStructurePatches(index, operation, fragmentHtml = null) {
  try {
    return planSemanticStructurePatches({
      source: index.source,
      elements: semanticStructurePlanElements(index),
      operation,
      fragmentHtml,
    }).patches;
  } catch (cause) {
    fail(
      cause?.code || "SEMANTIC_STRUCTURE_PLAN_INVALID",
      cause instanceof Error ? cause.message : "Semantic structure planning failed.",
      cause?.details || {},
    );
  }
}

function semanticFragmentIndex(fragmentHtml, existingIndex, allowedExistingIds = new Set()) {
  const fragment = String(fragmentHtml ?? "");
  const fragmentIndex = buildSourceIndex(fragment, {
    scope: "fragment",
    caller: "planSemanticOperationPatch:fragment",
  });
  if (!fragmentIndex.integrity.ok || !fragmentIndex.pagerootIdentity.complete) {
    fail(
      "SEMANTIC_FRAGMENT_IDENTITY_INVALID",
      "Inserted or replacement HTML must contain complete valid stable identity.",
      { pagerootIdentity: fragmentIndex.pagerootIdentity, rangeErrors: fragmentIndex.rangeErrors },
    );
  }
  const rootElements = fragmentIndex.elements.filter((element) => element.parentId === null);
  if (rootElements.length !== 1) {
    fail("SEMANTIC_FRAGMENT_ROOT_INVALID", "A structural operation requires exactly one source root element.", {
      rootCount: rootElements.length,
    });
  }
  const [root] = rootElements;
  if (
    fragment.slice(0, root.range.startOffset).trim() !== ""
    || fragment.slice(root.range.endOffset).trim() !== ""
  ) {
    fail("SEMANTIC_FRAGMENT_ROOT_INVALID", "Structural HTML cannot contain authored content outside its root element.");
  }
  for (const element of fragmentIndex.elements) {
    if (existingIndex.byPagerootId.has(element.pagerootId) && !allowedExistingIds.has(element.pagerootId)) {
      fail("SEMANTIC_FRAGMENT_ID_COLLISION", "Structural HTML reuses an identity owned outside its target.", {
        elementId: element.pagerootId,
      });
    }
  }
  return { fragment, fragmentIndex, root };
}

/**
 * Internal lowering for the semantic-operation kernel. The command is fully
 * replayable so applyPatchPlan can independently re-plan and reject tampering.
 */
export function planSemanticOperationPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string" ? buildSourceIndex(indexOrHtml) : indexOrHtml;
  assertCompleteSemanticIdentity(index);
  expectedHash(command, index);
  const semanticType = String(command.semanticType ?? "");
  const target = command.targetElementId
    ? semanticElement(index, command.targetElementId, command.targetTagName, "target")
    : null;
  const targetRef = target
    ? createTargetRef(index, target, { level: "subregion" })
    : null;
  let patches = [];
  let targetRefs = targetRef ? [targetRef] : [];

  if (semanticType === "setText") {
    if (!target) fail("TARGET_REQUIRED", "setText requires an authored target.");
    patches = [planSemanticPlainTextPatch(index.source, {
      tagName: target.tagName,
      isVoid: target.isVoid,
      contentStartOffset: target.contentRange.startOffset,
      contentEndOffset: target.contentRange.endOffset,
      text: command.text ?? "",
    })];
  } else if (semanticType === "replaceTextRange") {
    if (!target) fail("TARGET_REQUIRED", "replaceTextRange requires an authored target.");
    const segments = normalizedTextRangeSegments(index, target, command.segments);
    const replacement = escapeHtmlText(command.text ?? "");
    patches = segments.map((segment, segmentIndex) => sourcePatch(
      segment.rawStartOffset,
      segment.rawEndOffset,
      index.source.slice(segment.rawStartOffset, segment.rawEndOffset),
      segmentIndex === 0 ? replacement : "",
      { kind: "semantic:replace-text-range", segmentIndex },
    ));
  } else if (semanticType === "setAttribute") {
    if (!target) fail("TARGET_REQUIRED", "setAttribute requires an authored target.");
    const attributeName = String(command.attributeName ?? "").toLowerCase();
    if (!HTML_ATTRIBUTE_NAME_PATTERN.test(attributeName)) {
      fail("SEMANTIC_ATTRIBUTE_NAME_INVALID", "The attribute name is not valid HTML source.", { attributeName });
    }
    if (attributeName === PAGEROOT_ELEMENT_ID_ATTRIBUTE) {
      fail("SEMANTIC_IDENTITY_ATTRIBUTE_PROTECTED", "Stable identity cannot be edited as an ordinary attribute.");
    }
    const attributes = target.attributesByName.get(attributeName) ?? [];
    if (attributes.length > 1) {
      fail("SEMANTIC_ATTRIBUTE_DUPLICATE", "A repeated authored attribute cannot be edited safely.", { attributeName });
    }
    const existing = attributes[0] ?? null;
    if (command.value === null) {
      patches = existing
        ? [sourcePatch(existing.range.startOffset, existing.range.endOffset, existing.raw, "", {
          kind: "semantic:set-attribute",
        })]
        : [];
    } else {
      const nextAttribute = `${existing?.rawName ?? attributeName}="${escapeHtmlAttribute(command.value)}"`;
      patches = existing
        ? [sourcePatch(existing.range.startOffset, existing.range.endOffset, existing.raw, nextAttribute, {
          kind: "semantic:set-attribute",
        })]
        : [sourcePatch(target.closingDelimiterOffset, target.closingDelimiterOffset, "", ` ${nextAttribute}`, {
          kind: "semantic:set-attribute",
        })];
    }
  } else if (semanticType === "insertElement") {
    const insertion = semanticInsertion(index, command);
    semanticFragmentIndex(command.elementHtml, index);
    patches = sharedSemanticStructurePatches(index, command, command.elementHtml);
    targetRefs = [insertion.targetRef];
  } else if (semanticType === "deleteElement") {
    if (!target || !target.parentId) {
      fail("SEMANTIC_DELETE_ROOT_UNSUPPORTED", "Only an authored element with a source parent can be deleted.");
    }
    patches = sharedSemanticStructurePatches(index, command);
  } else if (semanticType === "moveElement") {
    if (!target || !target.parentId) {
      fail("SEMANTIC_MOVE_ROOT_UNSUPPORTED", "Only an authored element with a source parent can be moved.");
    }
    const insertion = semanticInsertion(index, command);
    if (insertion.parent.nodeId === target.nodeId || isDescendantNode(index, insertion.parent, target)) {
      fail("SEMANTIC_MOVE_CYCLE", "An element cannot move into itself or its descendants.");
    }
    if (insertion.before?.nodeId === target.nodeId) {
      fail("SEMANTIC_MOVE_NOOP", "The requested move already occupies that insertion point.");
    }
    patches = sharedSemanticStructurePatches(index, command);
    targetRefs = [targetRef, insertion.targetRef];
  } else if (semanticType === "replaceSubtree") {
    if (!target) fail("TARGET_REQUIRED", "replaceSubtree requires an authored target.");
    const subtreeIds = new Set(
      index.elements
        .filter((element) => element.nodeId === target.nodeId || isDescendantNode(index, element, target))
        .map((element) => element.pagerootId),
    );
    const fragment = semanticFragmentIndex(command.elementHtml, index, subtreeIds);
    if (fragment.root.pagerootId !== target.pagerootId) {
      fail(
        "SEMANTIC_REPLACEMENT_ROOT_MISMATCH",
        "A replacement subtree must retain the target root ID.",
        {
          expectedElementId: target.pagerootId,
          actualElementId: fragment.root.pagerootId,
        },
      );
    }
    patches = sharedSemanticStructurePatches(index, command, fragment.fragment);
  } else {
    fail("SEMANTIC_OPERATION_TYPE_UNSUPPORTED", `Unsupported semantic operation type: ${semanticType || "missing"}.`);
  }

  return makePlan(
    index,
    { ...command, type: "semantic-operation" },
    patches,
    targetRefs,
    { semanticCommand: { ...command, type: "semantic-operation" }, semanticType },
  );
}

function htmlEntityToken(raw, startOffset) {
  if (raw[startOffset] !== "&") return null;
  const tokenLimit = Math.min(raw.length, startOffset + 36);
  let semicolonOffset = -1;
  for (let cursor = startOffset + 1; cursor < tokenLimit; cursor += 1) {
    const character = raw[cursor];
    if (character === ";") {
      semicolonOffset = cursor;
      break;
    }
    if (/\s|<|&/.test(character)) break;
  }
  if (semicolonOffset >= 0) {
    const source = raw.slice(startOffset, semicolonOffset + 1);
    const decoded = decodeHTML(source);
    if (decoded !== source) {
      return { rawLength: source.length, decoded };
    }
  }

  for (let cursor = startOffset + 2; cursor <= tokenLimit; cursor += 1) {
    const source = raw.slice(startOffset, cursor);
    const decoded = decodeHTML(source);
    if (decoded !== source) {
      return { rawLength: source.length, decoded };
    }
    const next = raw[cursor];
    if (!next || /\s|<|&|;/.test(next)) break;
  }
  return null;
}

function decodedBoundaryMap(raw, expectedValue) {
  const boundaries = new Map([[0, 0]]);
  let rawOffset = 0;
  let decodedOffset = 0;
  let decodedValue = "";
  while (rawOffset < raw.length) {
    const entity = htmlEntityToken(raw, rawOffset);
    if (entity) {
      rawOffset += entity.rawLength;
      decodedOffset += entity.decoded.length;
      decodedValue += entity.decoded;
      boundaries.set(decodedOffset, rawOffset);
      continue;
    }
    if (raw[rawOffset] === "\r") {
      rawOffset += raw[rawOffset + 1] === "\n" ? 2 : 1;
      decodedOffset += 1;
      decodedValue += "\n";
      boundaries.set(decodedOffset, rawOffset);
      continue;
    }
    const codePoint = raw.codePointAt(rawOffset);
    const sourceLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    decodedValue += raw.slice(rawOffset, rawOffset + sourceLength);
    rawOffset += sourceLength;
    decodedOffset += sourceLength;
    boundaries.set(decodedOffset, rawOffset);
  }
  if (expectedValue !== undefined && decodedValue !== expectedValue) {
    fail(
      "UNSAFE_TEXT_RANGE_MAPPING",
      "Selected text cannot be mapped back to its exact source encoding.",
      { expectedValue, decodedValue },
    );
  }
  return boundaries;
}

function rawBoundaryForTextOffset(textNode, decodedOffset) {
  if (
    !Number.isInteger(decodedOffset)
    || decodedOffset < 0
    || decodedOffset > textNode.value.length
  ) {
    fail(
      "INVALID_TEXT_RANGE",
      "Selected text range is outside the source text node.",
      { textNodeId: textNode.nodeId, decodedOffset },
    );
  }
  const rawOffset = decodedBoundaryMap(textNode.raw, textNode.value).get(decodedOffset);
  if (rawOffset === undefined) {
    fail(
      "UNSAFE_TEXT_RANGE_BOUNDARY",
      "Selected text begins or ends inside an encoded character.",
      { textNodeId: textNode.nodeId, decodedOffset },
    );
  }
  return textNode.range.startOffset + rawOffset;
}

function assertTextRangeStyleContext(index, textNode, target) {
  let ancestorId = textNode.parentId;
  while (ancestorId) {
    const ancestor = index.byNodeId.get(ancestorId);
    if (!ancestor || ancestor.type !== "element") {
      fail(
        "TEXT_RANGE_UNSAFE_CONTEXT",
        "Selected text does not have a stable HTML element context.",
        { textNodeId: textNode.nodeId, ancestorId },
      );
    }
    if (
      ancestor.namespaceURI !== "http://www.w3.org/1999/xhtml"
      || TEXT_RANGE_UNSAFE_CONTEXT_ELEMENTS.has(ancestor.tagName)
    ) {
      fail(
        "TEXT_RANGE_UNSAFE_CONTEXT",
        `Partial text styling is unsafe inside <${ancestor.tagName}>.`,
        {
          textNodeId: textNode.nodeId,
          ancestorId: ancestor.nodeId,
          tagName: ancestor.tagName,
          namespaceURI: ancestor.namespaceURI,
        },
      );
    }
    if (ancestor.nodeId === target.nodeId) return;
    ancestorId = ancestor.parentId;
  }
  fail(
    "TEXT_RANGE_TARGET_MISMATCH",
    "Selected text no longer belongs to the authorized source element.",
    { textNodeId: textNode.nodeId, targetId: target.nodeId },
  );
}

function normalizedTextRangeSegments(index, target, segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    fail("TEXT_RANGE_REQUIRED", "Text range style command has no selected text.");
  }
  if (!supportsTextRangeEditing(target.tagName)) {
    fail(
      "TEXT_RANGE_STYLE_UNSUPPORTED",
      `Partial text styling is not supported inside <${target.tagName}>.`,
      { nodeId: target.nodeId },
    );
  }
  const normalized = segments.map((segment) => {
    const textNode = index.byNodeId.get(String(segment?.textNodeId || ""));
    if (
      !textNode
      || textNode.type !== "text"
      || !isDescendantNode(index, textNode, target)
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "Selected text no longer belongs to the authorized source element.",
        { textNodeId: segment?.textNodeId, targetId: target.nodeId },
      );
    }
    assertTextRangeStyleContext(index, textNode, target);
    const startOffset = Number(segment.startOffset);
    const endOffset = Number(segment.endOffset);
    if (
      !Number.isInteger(startOffset)
      || !Number.isInteger(endOffset)
      || startOffset < 0
      || endOffset <= startOffset
      || endOffset > textNode.value.length
    ) {
      fail(
        "INVALID_TEXT_RANGE",
        "Selected text range is empty or outside the source text node.",
        { textNodeId: textNode.nodeId, startOffset, endOffset },
      );
    }
    return {
      textNode,
      textNodeId: textNode.nodeId,
      startOffset,
      endOffset,
      rawStartOffset: rawBoundaryForTextOffset(textNode, startOffset),
      rawEndOffset: rawBoundaryForTextOffset(textNode, endOffset),
    };
  }).sort((left, right) => left.rawStartOffset - right.rawStartOffset);
  for (let indexPosition = 1; indexPosition < normalized.length; indexPosition += 1) {
    if (normalized[indexPosition].rawStartOffset <= normalized[indexPosition - 1].rawEndOffset) {
      fail(
        "OVERLAPPING_TEXT_RANGES",
        "Selected text ranges overlap or touch in the same source content.",
        {
          previous: normalized[indexPosition - 1],
          current: normalized[indexPosition],
        },
      );
    }
  }
  return normalized;
}

export function planEditableIslandPatch(indexOrHtml, command, options = null) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const island = editableIslandForTarget(index, targetRef);
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    island.element,
  );
  if (
    Object.hasOwn(command, "beforeInnerHtml")
    && command.beforeInnerHtml !== island.innerHtml
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The editable island changed after this edit began.",
      { expected: command.beforeInnerHtml, actual: island.innerHtml },
    );
  }
  if (!Object.hasOwn(command, "nextInnerHtml")) {
    fail(
      "NEXT_ISLAND_HTML_REQUIRED",
      "Editable island command is missing nextInnerHtml.",
    );
  }

  const replayPagerootIds = options?.token === EDITABLE_ISLAND_ID_REPLAY_TOKEN
    ? options.pagerootIds
    : null;
  const materialized = index.pagerootIdentity.complete
    ? materializeEditableIslandHtml(String(command.nextInnerHtml), {
        baselineInnerHtml: island.innerHtml,
        replayPagerootIds,
        randomUUID: options?.randomUUID,
      })
    : {
        html: normalizeEditableIslandHtml(
          String(command.nextInnerHtml),
          { baselineInnerHtml: island.innerHtml },
        ),
        createdPagerootIds: [],
      };
  const nextInnerHtml = materialized.html;
  const patch = sourcePatch(
    island.contentRange.startOffset,
    island.contentRange.endOffset,
    island.innerHtml,
    nextInnerHtml,
    {
      kind: "editable-island",
      nodeId: island.element.nodeId,
    },
  );
  return makePlan(
    index,
    { ...command, type: "replace-editable-island" },
    nextInnerHtml === island.innerHtml ? [] : [patch],
    [currentTargetRef],
    {
      resolution: island.resolution,
      rootTagName: island.element.tagName,
      beforeInnerHtml: island.innerHtml,
      nextInnerHtml,
      createdPagerootIds: materialized.createdPagerootIds,
      writeScope: "editable-island-inner-html",
    },
  );
}

export function planSemanticEditableIslandPatch(
  indexOrHtml,
  command,
  createdPagerootIds,
) {
  return planEditableIslandPatch(indexOrHtml, command, {
    token: EDITABLE_ISLAND_ID_REPLAY_TOKEN,
    pagerootIds: createdPagerootIds,
  });
}

function normalizePropertyName(property) {
  const value = String(property ?? "").trim();
  if (!CSS_PROPERTY_NAME_PATTERN.test(value)) {
    fail("INVALID_STYLE_PROPERTY", "Inline style property name is invalid.", { property });
  }
  return value.startsWith("--") ? value : value.toLowerCase();
}

function topLevelColon(raw) {
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (char === ":" && depth === 0) return index;
  }
  return -1;
}

function declarationSegments(raw) {
  const segments = [];
  let startOffset = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (index === raw.length || (char === ";" && !quote && !comment && depth === 0)) {
      segments.push({
        startOffset,
        endOffset: index,
        separatorEndOffset: index < raw.length ? index + 1 : index,
        raw: raw.slice(startOffset, index),
      });
      startOffset = index + 1;
      continue;
    }
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
  }
  return segments;
}

function trimBounds(raw, startOffset, endOffset) {
  while (startOffset < endOffset && /\s/.test(raw[startOffset])) startOffset += 1;
  while (endOffset > startOffset && /\s/.test(raw[endOffset - 1])) endOffset -= 1;
  return { startOffset, endOffset };
}

export function parseInlineStyle(rawStyle) {
  const raw = String(rawStyle ?? "");
  const declarations = [];
  for (const segment of declarationSegments(raw)) {
    const colon = topLevelColon(segment.raw);
    if (colon < 0) continue;
    const propertyBounds = trimBounds(segment.raw, 0, colon);
    const valueBounds = trimBounds(segment.raw, colon + 1, segment.raw.length);
    const property = segment.raw.slice(propertyBounds.startOffset, propertyBounds.endOffset);
    if (!property) continue;
    const normalizedProperty = property.startsWith("--") ? property : property.toLowerCase();
    const trimmedValue = segment.raw.slice(valueBounds.startOffset, valueBounds.endOffset);
    const importantMatch = trimmedValue.match(/(\s*!\s*important)\s*$/i);
    const importantStart = importantMatch
      ? valueBounds.endOffset - importantMatch[0].length
      : valueBounds.endOffset;
    const valueCoreBounds = trimBounds(segment.raw, valueBounds.startOffset, importantStart);
    declarations.push({
      property,
      normalizedProperty,
      value: segment.raw.slice(valueCoreBounds.startOffset, valueCoreBounds.endOffset),
      important: Boolean(importantMatch),
      importantRaw: importantMatch ? segment.raw.slice(importantStart, valueBounds.endOffset) : "",
      segmentStartOffset: segment.startOffset,
      segmentEndOffset: segment.endOffset,
      separatorEndOffset: segment.separatorEndOffset,
      propertyStartOffset: segment.startOffset + propertyBounds.startOffset,
      propertyEndOffset: segment.startOffset + propertyBounds.endOffset,
      valueStartOffset: segment.startOffset + valueBounds.startOffset,
      valueEndOffset: segment.startOffset + valueBounds.endOffset,
      valueCoreStartOffset: segment.startOffset + valueCoreBounds.startOffset,
      valueCoreEndOffset: segment.startOffset + valueCoreBounds.endOffset,
      raw: segment.raw,
    });
  }
  return declarations;
}

function preferredQuote(element) {
  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const quote = element.attributes[index].quote;
    if (quote === "\"" || quote === "'") return quote;
  }
  return "\"";
}

function encodeAttributeValueFragment(value, quote) {
  let result = String(value).replace(/&/g, "&amp;");
  if (quote === "\"") return result.replace(/"/g, "&quot;");
  if (quote === "'") return result.replace(/'/g, "&#39;");
  return result
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\f/g, "&#12;")
    .replace(/\r/g, "&#13;")
    .replace(/ /g, "&#32;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;")
    .replace(/=/g, "&#61;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function declarationFor(property, value, important, quote, compact = false) {
  const separator = compact ? ":" : ": ";
  const importantSource = important ? (compact ? "!important" : " !important") : "";
  return `${property}${separator}${encodeAttributeValueFragment(value, quote)}${importantSource}`;
}

function assertCommentFreeStyleSyntax(value, details = {}) {
  if (/\/\*|\*\//.test(String(value ?? ""))) {
    fail(
      "UNSAFE_STYLE_SYNTAX",
      "Inline style comments cannot be edited safely without changing CSS meaning.",
      details,
    );
  }
}

function assertCanonicalStyleProperties(rawStyle, details = {}) {
  for (const segment of declarationSegments(rawStyle)) {
    if (segment.raw.trim() === "") continue;
    const colon = topLevelColon(segment.raw);
    if (colon < 0) {
      fail(
        "UNSAFE_STYLE_SYNTAX",
        "Inline style contains declaration syntax that cannot be preserved safely.",
        details,
      );
    }
    const bounds = trimBounds(segment.raw, 0, colon);
    const property = segment.raw.slice(bounds.startOffset, bounds.endOffset);
    if (!CSS_PROPERTY_NAME_PATTERN.test(property)) {
      fail(
        "UNSAFE_STYLE_SYNTAX",
        "Inline style contains a non-canonical or escaped property name.",
        { ...details, property },
      );
    }
  }
}

function assertSingleCssValue(value, details = {}) {
  const source = String(value);
  if (source.trim() === "") {
    fail("INVALID_STYLE_VALUE", "Inline style value cannot be empty.", details);
  }
  const closingDelimiters = [];
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        if (index + 1 >= source.length) {
          fail("INVALID_STYLE_VALUE", "Inline style value has an incomplete escape.", details);
        }
        if (source[index + 1] === "\r" && source[index + 2] === "\n") index += 2;
        else index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === "\n" || char === "\r" || char === "\f") {
        fail("INVALID_STYLE_VALUE", "Inline style string is not closed safely.", details);
      }
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= source.length) {
        fail("INVALID_STYLE_VALUE", "Inline style value has an incomplete escape.", details);
      }
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      closingDelimiters.push(")");
      continue;
    }
    if (char === "[") {
      closingDelimiters.push("]");
      continue;
    }
    if (char === "{") {
      closingDelimiters.push("}");
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (closingDelimiters.pop() !== char) {
        fail("INVALID_STYLE_VALUE", "Inline style value has unmatched delimiters.", details);
      }
      continue;
    }
    if (
      closingDelimiters.length === 0
      && (char === ";" || char === "!")
    ) {
      fail(
        "UNSAFE_STYLE_VALUE",
        char === ";"
          ? "Inline style value cannot contain a top-level declaration separator."
          : "Use the explicit important option to change CSS priority.",
        details,
      );
    }
  }
  if (quote || closingDelimiters.length > 0) {
    fail("INVALID_STYLE_VALUE", "Inline style value is not syntactically balanced.", details);
  }
}

function patchExistingStyle(index, element, styleAttribute, command, property) {
  if (!styleAttribute.valueRange) {
    if (command.value === null || command.value === undefined) return [];
    const quote = preferredQuote(element);
    const declaration = declarationFor(property, command.value, Boolean(command.important), quote);
    return [sourcePatch(
      styleAttribute.range.startOffset,
      styleAttribute.range.endOffset,
      styleAttribute.raw,
      `${styleAttribute.rawName}=${quote}${declaration}${quote}`,
      { kind: "style-attribute", property, nodeId: element.nodeId },
    )];
  }

  const rawStyle = index.source.slice(
    styleAttribute.valueRange.startOffset,
    styleAttribute.valueRange.endOffset,
  );
  assertCommentFreeStyleSyntax(rawStyle, {
    nodeId: element.nodeId,
    property,
  });
  assertCanonicalStyleProperties(rawStyle, {
    nodeId: element.nodeId,
    property,
  });
  const declarations = parseInlineStyle(rawStyle);
  const matching = declarations.filter(
    (declaration) => declaration.normalizedProperty === property,
  );
  if (matching.length > 1) {
    fail(
      "DUPLICATE_STYLE_PROPERTY",
      `Inline style contains duplicate declarations for ${property}.`,
      { nodeId: element.nodeId, property },
    );
  }
  const declaration = matching[0] ?? null;
  if (
    declaration
    && Object.hasOwn(command, "beforeValue")
    && command.beforeValue !== declaration.value
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "The inline style value changed after the edit began.",
      { expected: command.beforeValue, actual: declaration.value },
    );
  }

  if (command.value === null || command.value === undefined) {
    if (!declaration) return [];
    const localStart = declaration.segmentStartOffset;
    const localEnd = declaration.separatorEndOffset;
    const nextRawStyle = rawStyle.slice(0, localStart) + rawStyle.slice(localEnd);
    if (nextRawStyle.replace(/[;\s]/g, "") === "") {
      return [sourcePatch(
        styleAttribute.removalRange.startOffset,
        styleAttribute.removalRange.endOffset,
        index.source.slice(
          styleAttribute.removalRange.startOffset,
          styleAttribute.removalRange.endOffset,
        ),
        "",
        { kind: "style-attribute-remove", property, nodeId: element.nodeId },
      )];
    }
    return [sourcePatch(
      styleAttribute.valueRange.startOffset + localStart,
      styleAttribute.valueRange.startOffset + localEnd,
      rawStyle.slice(localStart, localEnd),
      "",
      { kind: "style-declaration-remove", property, nodeId: element.nodeId },
    )];
  }

  const quote = styleAttribute.quote;
  if (declaration) {
    const preserveImportant = command.important === undefined;
    const important = preserveImportant ? declaration.important : Boolean(command.important);
    const importantRaw = important
      ? (
          preserveImportant && declaration.importantRaw
            ? declaration.importantRaw
            : (quote ? " !important" : "!important")
        )
      : "";
    const nextValue = `${encodeAttributeValueFragment(command.value, quote)}${importantRaw}`;
    return [sourcePatch(
      styleAttribute.valueRange.startOffset + declaration.valueStartOffset,
      styleAttribute.valueRange.startOffset + declaration.valueEndOffset,
      rawStyle.slice(declaration.valueStartOffset, declaration.valueEndOffset),
      nextValue,
      { kind: "style-declaration-update", property, nodeId: element.nodeId },
    )];
  }

  let insertionOffset = rawStyle.length;
  while (insertionOffset > 0 && /\s/.test(rawStyle[insertionOffset - 1])) insertionOffset -= 1;
  const compact = quote === null;
  const declarationSource = declarationFor(
    property,
    command.value,
    Boolean(command.important),
    quote,
    compact,
  );
  const meaningful = rawStyle.slice(0, insertionOffset).trim();
  const prefix = meaningful === ""
    ? ""
    : meaningful.endsWith(";")
      ? (compact ? "" : " ")
      : (compact ? ";" : "; ");
  return [sourcePatch(
    styleAttribute.valueRange.startOffset + insertionOffset,
    styleAttribute.valueRange.startOffset + insertionOffset,
    "",
    `${prefix}${declarationSource}`,
    { kind: "style-declaration-add", property, nodeId: element.nodeId },
  )];
}

export function planInlineStylePatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const element = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    element,
  );
  const property = normalizePropertyName(command.property);
  if (command.value !== null && command.value !== undefined) {
    assertCommentFreeStyleSyntax(command.value, {
      nodeId: element.nodeId,
      property,
    });
    assertSingleCssValue(command.value, {
      nodeId: element.nodeId,
      property,
    });
  }
  const styleAttributes = element.attributesByName.get("style") ?? [];
  if (styleAttributes.length > 1) {
    fail(
      "DUPLICATE_STYLE_ATTRIBUTE",
      "The selected element has duplicate style attributes, so the edit is unsafe.",
      { nodeId: element.nodeId },
    );
  }

  let patches;
  if (styleAttributes.length === 1) {
    patches = patchExistingStyle(index, element, styleAttributes[0], command, property);
  } else if (command.value === null || command.value === undefined) {
    patches = [];
  } else {
    const quote = preferredQuote(element);
    const declaration = declarationFor(
      property,
      command.value,
      Boolean(command.important),
      quote,
    );
    const offset = element.closingDelimiterOffset;
    patches = [sourcePatch(
      offset,
      offset,
      "",
      ` style=${quote}${declaration}${quote}`,
      { kind: "style-attribute-add", property, nodeId: element.nodeId },
    )];
  }

  return makePlan(
    index,
    { ...command, type: "set-inline-style" },
    patches,
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: element.nodeId,
      property,
      value: command.value ?? null,
      important: command.important,
      writeScope: "current-element-inline-style",
    },
  );
}

export function planTextRangeStylePatch(indexOrHtml, command, replay = null) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const resolution = resolvedTarget(index, targetRef, "element");
  const target = resolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    target,
  );
  const property = normalizePropertyName(command.property);
  if (command.value === null || command.value === undefined) {
    fail(
      "TEXT_RANGE_STYLE_VALUE_REQUIRED",
      "Partial text styling requires a concrete CSS value.",
      { property },
    );
  }
  let declaration;
  try {
    ({ declaration } = canonicalSourceStyleDeclaration({
      property,
      value: command.value,
      important: Boolean(command.important),
      quote: '"',
    }));
  } catch (cause) {
    fail(
      cause?.code || "INVALID_STYLE_VALUE",
      cause?.message || "Inline style value is invalid.",
      { nodeId: target.nodeId, property, ...(cause?.details ?? {}) },
    );
  }
  const segments = normalizedTextRangeSegments(index, target, command.segments);
  const onlySegment = segments.length === 1 ? segments[0] : null;
  if (
    onlySegment
    && target.childIds.length === 1
    && target.childIds[0] === onlySegment.textNodeId
    && onlySegment.startOffset === 0
    && onlySegment.endOffset === onlySegment.textNode.value.length
  ) {
    // Styling the complete text of an existing element does not need another
    // wrapper. Reusing that element keeps repeated toolbar actions canonical
    // instead of producing span-inside-span growth.
    return planInlineStylePatch(index, {
      ...command,
      type: "set-inline-style",
      targetRef: currentTargetRef,
    });
  }
  const segmentParent = onlySegment?.textNode.parentId
    ? index.byNodeId.get(onlySegment.textNode.parentId)
    : null;
  if (
    onlySegment
    && segmentParent?.type === "element"
    && segmentParent.nodeId !== target.nodeId
    && segmentParent.childIds.length === 1
    && segmentParent.childIds[0] === onlySegment.textNodeId
    && onlySegment.startOffset === 0
    && onlySegment.endOffset === onlySegment.textNode.value.length
  ) {
    // The live selection remains authorized by its original ancestor, while
    // repeated formatting should update the text's existing immediate wrapper.
    // Keeping both refs lets the preview refresh the logical selection and the
    // actual style-write element without conflating their identities.
    const styleTargetRef = createTargetRef(index, segmentParent);
    const inlinePlan = planInlineStylePatch(index, {
      ...command,
      type: "set-inline-style",
      targetRef: styleTargetRef,
    });
    return makePlan(
      index,
      { ...command, type: "set-text-range-style" },
      inlinePlan.patches,
      [currentTargetRef, styleTargetRef],
      {
        resolution: resolution.resolution,
        nodeId: target.nodeId,
        property,
        value: command.value,
        important: command.important,
        segments: segments.map((segment) => ({
          textNodeId: segment.textNodeId,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
        })),
        writeScope: "existing-text-range-wrapper-inline-style",
        coalescedTextRangeElementId: segmentParent.pagerootId ?? segmentParent.nodeId,
      },
    );
  }
  // Canvas rejects flex/grid direct-text and visible-background cases from
  // this materialization before source publication. In supported inline flow,
  // this wrapper preserves Chromium's real caret/beforeinput/input behavior.
  const replayIds = replay?.token === TEXT_RANGE_ID_REPLAY_TOKEN
    ? replay.pagerootIds
    : null;
  const createdPagerootIds = index.pagerootIdentity.complete
    ? segments.map((_, segmentIndex) => {
      const pagerootId = replayIds?.[segmentIndex]
        ?? generatePagerootElementId(replay?.randomUUID);
      if (!isValidPagerootElementId(pagerootId) || index.byPagerootId.has(pagerootId)) {
        fail(
          "TEXT_RANGE_IDENTITY_INVALID",
          "A new text-range wrapper requires a fresh valid persistent identity.",
        );
      }
      return pagerootId;
    })
    : [];
  if (replayIds && replayIds.length !== createdPagerootIds.length) {
    fail(
      "TEXT_RANGE_IDENTITY_INVALID",
      "Text-range wrapper identity evidence does not match the selected segments.",
    );
  }
  if (new Set(createdPagerootIds).size !== createdPagerootIds.length) {
    fail(
      "TEXT_RANGE_IDENTITY_INVALID",
      "Text-range wrapper identities must be unique within the operation.",
    );
  }
  const patches = segments.flatMap((segment, segmentIndex) => {
    const persistentIdentity = index.pagerootIdentity.complete
      ? ` ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${createdPagerootIds[segmentIndex]}"`
      : "";
    const openingTag = `<span style="${TEXT_RANGE_LAYOUT_GUARD}; ${declaration}"${persistentIdentity}>`;
    return [
      sourcePatch(
        segment.rawStartOffset,
        segment.rawStartOffset,
        "",
        openingTag,
        {
          kind: "text-range-style-open",
          property,
          nodeId: segment.textNodeId,
        },
      ),
      sourcePatch(
        segment.rawEndOffset,
        segment.rawEndOffset,
        "",
        "</span>",
        {
          kind: "text-range-style-close",
          property,
          nodeId: segment.textNodeId,
        },
      ),
    ];
  });
  return makePlan(
    index,
    { ...command, type: "set-text-range-style" },
    patches,
    [currentTargetRef],
    {
      resolution: resolution.resolution,
      nodeId: target.nodeId,
      property,
      value: command.value,
      important: command.important,
      segments: segments.map((segment) => ({
        textNodeId: segment.textNodeId,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
      })),
      writeScope: "selected-text-ranges",
      createdPagerootIds,
    },
  );
}

export function planSemanticTextRangeStylePatch(
  indexOrHtml,
  command,
  createdPagerootIds,
) {
  return planTextRangeStylePatch(indexOrHtml, command, {
    token: TEXT_RANGE_ID_REPLAY_TOKEN,
    pagerootIds: createdPagerootIds,
  });
}

function gapBoundary(source, previousElement, nextElement) {
  const startOffset = previousElement.range.endOffset;
  const endOffset = nextElement.range.startOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  const firstComment = gap.indexOf("<!--");
  const beforeComment = gap.slice(0, firstComment);
  if (beforeComment === "") return endOffset;
  if (/\r|\n/.test(beforeComment)) return startOffset;
  fail(
    "UNSAFE_REORDER_BOUNDARY",
    "A comment between sibling modules has ambiguous ownership.",
    { startOffset, endOffset },
  );
}

function trailingCommentBoundary(source, parent, lastElement) {
  const startOffset = lastElement.range.endOffset;
  const endOffset = parent.contentRange.endOffset;
  const gap = source.slice(startOffset, endOffset);
  if (!gap.includes("<!--")) return startOffset;
  if (!gap.startsWith("<!--")) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "A trailing comment is separated from the last module, so ownership is ambiguous.",
      { startOffset, endOffset },
    );
  }

  let cursor = 0;
  let commentCount = 0;
  while (gap.startsWith("<!--", cursor)) {
    const commentEnd = gap.indexOf("-->", cursor + 4);
    if (commentEnd < 0) {
      fail(
        "UNSAFE_REORDER_BOUNDARY",
        "A trailing comment does not have a complete source boundary.",
        { startOffset, endOffset },
      );
    }
    cursor = commentEnd + 3;
    commentCount += 1;
  }
  const remaining = gap.slice(cursor);
  if (remaining.includes("<!--") || remaining.trim() !== "") {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "Trailing comment ownership is ambiguous.",
      { startOffset, endOffset },
    );
  }
  return commentCount > 0 ? startOffset + cursor : startOffset;
}

function reorderUnits(index, parent) {
  if (!parent.boundarySafe || !parent.explicitEndTag) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "The parent source boundary is not explicit enough for safe reordering.",
      { parentId: parent.nodeId },
    );
  }
  const childNodes = parent.childIds.map((nodeId) => index.byNodeId.get(nodeId));
  const unsafeText = childNodes.find(
    (node) => node.type === "text" && !node.whitespaceOnly,
  );
  if (unsafeText) {
    fail(
      "UNSAFE_REORDER_BOUNDARY",
      "Sibling reordering cannot move across non-whitespace text nodes.",
      { nodeId: unsafeText.nodeId },
    );
  }
  const elements = parent.childElementIds.map((nodeId) => index.byNodeId.get(nodeId));
  if (elements.length < 2) {
    fail("REORDER_REQUIRES_SIBLINGS", "The selected module has no reorderable sibling.");
  }
  for (const element of elements) {
    const selfClosing = element.startTagRange.endOffset === element.range.endOffset
      && /\/\s*>$/.test(element.startTagRaw);
    if (!element.explicitEndTag && !element.isVoid && !selfClosing) {
      fail(
        "UNSAFE_REORDER_BOUNDARY",
        "A sibling has an implicit closing boundary.",
        { nodeId: element.nodeId },
      );
    }
  }

  const boundaries = [];
  for (let indexPosition = 0; indexPosition < elements.length - 1; indexPosition += 1) {
    boundaries.push(gapBoundary(index.source, elements[indexPosition], elements[indexPosition + 1]));
  }
  const trailingBoundary = trailingCommentBoundary(
    index.source,
    parent,
    elements.at(-1),
  );
  return elements.map((element, position) => {
    const startOffset = position === 0
      ? parent.contentRange.startOffset
      : boundaries[position - 1];
    const endOffset = position === elements.length - 1
      ? trailingBoundary
      : boundaries[position];
    return {
      nodeId: element.nodeId,
      element,
      startOffset,
      endOffset,
      raw: index.source.slice(startOffset, endOffset),
    };
  });
}

export function planSiblingReorderPatch(indexOrHtml, command) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  const targetRef = commandTargetRef(index, command);
  const targetResolution = resolvedTarget(index, targetRef, "element");
  const moving = targetResolution.target;
  const currentTargetRef = refreshResolvedTargetRef(
    index,
    targetRef,
    moving,
  );
  const parent = moving.parentId ? index.byNodeId.get(moving.parentId) : null;
  if (!parent || parent.type !== "element") {
    fail("REORDER_PARENT_REQUIRED", "The selected module has no source-backed parent.");
  }
  const units = reorderUnits(index, parent);
  const oldOrder = units.map((unit) => unit.nodeId);
  const movingIndex = oldOrder.indexOf(moving.nodeId);
  const remaining = oldOrder.filter((nodeId) => nodeId !== moving.nodeId);

  let insertionIndex;
  let beforeTargetRef = null;
  let currentBeforeTargetRef = null;
  if (command.beforeTargetRef || command.beforeNodeId) {
    beforeTargetRef = commandTargetRef(index, command, "beforeTargetRef");
    const beforeResolution = resolvedTarget(index, beforeTargetRef, "element");
    currentBeforeTargetRef = refreshResolvedTargetRef(
      index,
      beforeTargetRef,
      beforeResolution.target,
    );
    if (beforeResolution.target.parentId !== parent.nodeId) {
      fail(
        "REORDER_DIFFERENT_PARENT",
        "Sibling reorder targets must have the same parent.",
      );
    }
    if (beforeResolution.target.nodeId === moving.nodeId) {
      insertionIndex = movingIndex;
    } else {
      insertionIndex = remaining.indexOf(beforeResolution.target.nodeId);
    }
  } else if (Number.isInteger(command.toIndex)) {
    if (command.toIndex < 0 || command.toIndex > remaining.length) {
      fail("INVALID_REORDER_INDEX", "Requested sibling index is outside the parent.");
    }
    insertionIndex = command.toIndex;
  } else {
    insertionIndex = remaining.length;
  }

  const nextOrder = [...remaining];
  nextOrder.splice(insertionIndex, 0, moving.nodeId);
  if (
    Array.isArray(command.beforeOrder)
    && command.beforeOrder.join("\u0000") !== oldOrder.join("\u0000")
  ) {
    fail(
      "STALE_BEFORE_CONTENT",
      "Sibling order changed after the reorder gesture began.",
      { expected: command.beforeOrder, actual: oldOrder },
    );
  }

  let patches;
  if (index.pagerootIdentity?.complete) {
    const movedPosition = nextOrder.indexOf(moving.nodeId);
    const nextSiblingNodeId = nextOrder[movedPosition + 1] ?? null;
    const nextSibling = nextSiblingNodeId
      ? index.byNodeId.get(nextSiblingNodeId)
      : null;
    patches = sharedSemanticStructurePatches(index, {
      type: "moveElement",
      targetElementId: moving.pagerootId,
      parentElementId: parent.pagerootId,
      beforeElementId: nextSibling?.pagerootId ?? null,
    });
  } else {
    let firstChanged = -1;
    let lastChanged = -1;
    for (let position = 0; position < oldOrder.length; position += 1) {
      if (oldOrder[position] !== nextOrder[position]) {
        if (firstChanged < 0) firstChanged = position;
        lastChanged = position;
      }
    }
    patches = [];
    if (firstChanged >= 0) {
      const byNodeId = new Map(units.map((unit) => [unit.nodeId, unit]));
      const startOffset = units[firstChanged].startOffset;
      const endOffset = units[lastChanged].endOffset;
      const before = index.source.slice(startOffset, endOffset);
      const after = nextOrder
        .slice(firstChanged, lastChanged + 1)
        .map((nodeId) => byNodeId.get(nodeId).raw)
        .join("");
      patches.push(sourcePatch(
        startOffset,
        endOffset,
        before,
        after,
        {
          kind: "sibling-reorder",
          parentId: parent.nodeId,
          movedNodeId: moving.nodeId,
        },
      ));
    }
  }

  return makePlan(
    index,
    { ...command, type: "reorder-sibling" },
    patches,
    currentBeforeTargetRef
      ? [currentTargetRef, currentBeforeTargetRef]
      : [currentTargetRef],
    {
      resolution: targetResolution.resolution,
      parentNodeId: parent.nodeId,
      beforeOrder: oldOrder,
      nextOrder,
    },
  );
}

export function planSourcePatch(command, indexOrHtml) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml)
    : indexOrHtml;
  switch (command?.type) {
    case "editable-island":
    case "replace-editable-island":
      return planEditableIslandPatch(index, command);
    case "style":
    case "set-inline-style":
      return planInlineStylePatch(index, command);
    case "text-range-style":
    case "set-text-range-style":
      return planTextRangeStylePatch(index, command);
    case "reorder":
    case "reorder-sibling":
      return planSiblingReorderPatch(index, command);
    default:
      fail("UNSUPPORTED_EDIT_COMMAND", `Unsupported edit command: ${command?.type ?? "missing"}.`);
  }
}

function normalizePatches(patches) {
  const ordered = [...(patches ?? [])].sort((left, right) => left.startOffset - right.startOffset);
  let previousEnd = -1;
  for (const patch of ordered) {
    if (
      !Number.isInteger(patch.startOffset)
      || !Number.isInteger(patch.endOffset)
      || patch.startOffset < 0
      || patch.endOffset < patch.startOffset
      || typeof patch.before !== "string"
      || typeof patch.after !== "string"
    ) {
      fail("INVALID_PATCH_RANGE", "Patch range or source content is invalid.", { patch });
    }
    if (patch.startOffset < previousEnd) {
      fail("OVERLAPPING_PATCHES", "Patch ranges overlap.", { patches: ordered });
    }
    previousEnd = patch.endOffset;
  }
  return ordered;
}

function renderPatches(source, patches) {
  let result = source;
  for (const patch of [...patches].sort((left, right) => right.startOffset - left.startOffset)) {
    result = result.slice(0, patch.startOffset) + patch.after + result.slice(patch.endOffset);
  }
  return result;
}

export function validatePatchScope(baseHtml, nextHtml, patches) {
  const ordered = normalizePatches(patches);
  const expected = renderPatches(baseHtml, ordered);
  if (expected !== nextHtml) {
    return {
      verdict: "rejected",
      outsideUnchanged: false,
      reason: "output-does-not-equal-declared-patches",
      allowedRanges: ordered.map((patch) => ({
        startOffset: patch.startOffset,
        endOffset: patch.endOffset,
      })),
    };
  }
  let baseCursor = 0;
  let nextCursor = 0;
  const protectedSegments = [];
  for (const patch of ordered) {
    const length = patch.startOffset - baseCursor;
    const baseSegment = baseHtml.slice(baseCursor, patch.startOffset);
    const nextSegment = nextHtml.slice(nextCursor, nextCursor + length);
    if (baseSegment !== nextSegment) {
      return {
        verdict: "rejected",
        outsideUnchanged: false,
        reason: "protected-segment-changed",
      };
    }
    protectedSegments.push({
      baseStartOffset: baseCursor,
      baseEndOffset: patch.startOffset,
      nextStartOffset: nextCursor,
      nextEndOffset: nextCursor + length,
    });
    baseCursor = patch.endOffset;
    nextCursor += length + patch.after.length;
  }
  const baseSuffix = baseHtml.slice(baseCursor);
  const nextSuffix = nextHtml.slice(nextCursor);
  if (baseSuffix !== nextSuffix) {
    return {
      verdict: "rejected",
      outsideUnchanged: false,
      reason: "protected-suffix-changed",
    };
  }
  protectedSegments.push({
    baseStartOffset: baseCursor,
    baseEndOffset: baseHtml.length,
    nextStartOffset: nextCursor,
    nextEndOffset: nextHtml.length,
  });
  return {
    verdict: "allowed",
    outsideUnchanged: true,
    reason: "only-declared-source-ranges-changed",
    allowedRanges: ordered.map((patch) => ({
      startOffset: patch.startOffset,
      endOffset: patch.endOffset,
      kind: patch.kind,
    })),
    protectedSegments,
  };
}

function inversePatches(patches) {
  let delta = 0;
  const inverse = patches.map((patch) => {
    const startOffset = patch.startOffset + delta;
    const inversePatch = sourcePatch(
      startOffset,
      startOffset + patch.after.length,
      patch.after,
      patch.before,
      { kind: `inverse:${patch.kind ?? "source"}` },
    );
    delta += patch.after.length - patch.before.length;
    return inversePatch;
  });
  const coalesced = [];
  for (const patch of inverse) {
    const previous = coalesced.at(-1);
    if (previous && previous.startOffset === patch.startOffset) {
      // Adjacent forward deletions collapse to one output boundary. Their
      // inverse insertions must be one ordered patch; independent zero-width
      // patches at the same offset render in reverse order and cannot restore
      // the recorded source hash.
      previous.endOffset = Math.max(previous.endOffset, patch.endOffset);
      previous.before += patch.before;
      previous.after += patch.after;
      if (previous.kind !== patch.kind) previous.kind = "inverse:source";
      continue;
    }
    coalesced.push({ ...patch });
  }
  return coalesced;
}

function operationTypeForPlan(plan) {
  const value = String(plan?.metadata?.operationType ?? plan?.type ?? "");
  return value.replace(/^(?:inverse:)+/, "");
}

function patchesEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((patch, index) => {
    const candidate = right[index];
    return patch.startOffset === candidate.startOffset
      && patch.endOffset === candidate.endOffset
      && patch.before === candidate.before
      && patch.after === candidate.after
      && patch.kind === candidate.kind;
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inverseProvenanceToken(provenance, targetRefs) {
  return sourceSha256(canonicalValue({
    baseSourceSha256: provenance.baseSourceSha256,
    outputSourceSha256: provenance.outputSourceSha256,
    operationType: provenance.operationType,
    appliedPatches: provenance.appliedPatches,
    targetRefs,
  }));
}

function registerTrustedInversePlan(plan) {
  TRUSTED_INVERSE_PLANS.set(plan, canonicalValue(plan));
}

function validateTrustedInversePlan(plan) {
  const trustedSnapshot = TRUSTED_INVERSE_PLANS.get(plan);
  if (!trustedSnapshot) {
    fail(
      "INVERSE_PLAN_UNTRUSTED",
      "Inverse patches can only be applied from a PatchEngine-generated history entry.",
    );
  }
  if (trustedSnapshot !== canonicalValue(plan)) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "The generated inverse patch plan changed after it was created.",
    );
  }
}

function validateInverseProvenance(plan, index, patches, targetRefs) {
  const provenance = plan.metadata?.inverseProvenance;
  if (!provenance || typeof provenance !== "object") {
    fail(
      "INVERSE_PROVENANCE_REQUIRED",
      "Inverse patch plan is missing its generated source provenance.",
    );
  }
  const expectedToken = inverseProvenanceToken(provenance, targetRefs);
  if (
    provenance.outputSourceSha256 !== index.sourceSha256
    || provenance.token !== expectedToken
  ) {
    fail(
      "INVERSE_PROVENANCE_INVALID",
      "Inverse patch provenance does not match its source or TargetRefs.",
    );
  }
  const expectedPatches = inversePatches(provenance.appliedPatches ?? []);
  if (!patchesEqual(patches, expectedPatches)) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "Inverse patches are not the exact inverse of the generated source patches.",
    );
  }
  const restoredSource = renderPatches(index.source, patches);
  if (sourceSha256(restoredSource) !== provenance.baseSourceSha256) {
    fail(
      "INVERSE_PLAN_TAMPERED",
      "Inverse patches do not restore the recorded source hash.",
    );
  }
}

function assertPatchWithin(patch, allowedRange, code, message) {
  if (
    patch.startOffset < allowedRange.startOffset
    || patch.endOffset > allowedRange.endOffset
  ) {
    fail(code, message, { patch, allowedRange });
  }
}

function authorizePatchPlan(plan, index, patches) {
  const isInverse = String(plan?.type ?? "").startsWith("inverse:");
  if (isInverse) validateTrustedInversePlan(plan);
  if (!Array.isArray(plan.targetRefs) || plan.targetRefs.length === 0) {
    fail(
      "PATCH_TARGETS_REQUIRED",
      "Every source patch plan must declare at least one operation TargetRef.",
    );
  }
  const operationType = operationTypeForPlan(plan);
  if (![
    "replace-editable-island",
    "set-inline-style",
    "set-text-range-style",
    "reorder-sibling",
    "semantic-operation",
  ].includes(operationType)) {
    fail(
      "UNSUPPORTED_PATCH_PLAN_TYPE",
      `Unsupported patch plan type: ${operationType || "missing"}.`,
    );
  }
  const targetRefs = plan.targetRefs.map((targetRef) => cleanTargetRef(targetRef));
  const resolutions = targetRefs.map((targetRef) => {
    if (targetRef.resolution !== "exact") {
      fail(
        "PATCH_TARGET_NOT_EXACT",
        "Patch operation TargetRefs must declare exact resolution.",
        { targetRef },
      );
    }
    if (targetRef.sourceAnchor?.sourceSha256 !== index.sourceSha256) {
      fail(
        "PATCH_TARGET_NOT_EXACT",
        "Patch operation TargetRefs must be refreshed against the exact source hash.",
        { targetRef, sourceSha256: index.sourceSha256 },
      );
    }
    const resolution = resolveTargetRef(index, targetRef);
    if (resolution.resolution !== "exact" || !resolution.target) {
      fail(
        resolution.resolution === "ambiguous"
          ? "TARGET_AMBIGUOUS"
          : "TARGET_ORPHANED",
        "Patch operation TargetRef is not exact in the declared source.",
        { targetRef, resolution },
      );
    }
    return resolution;
  });
  if (isInverse) {
    validateInverseProvenance(plan, index, patches, targetRefs);
  }

  if (operationType === "replace-editable-island") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail(
        "PATCH_TARGET_COUNT_INVALID",
        "Editable island replacement requires exactly one element TargetRef.",
      );
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      const patchKind = String(patch.kind ?? "").replace(/^(?:inverse:)+/, "");
      if (patchKind !== "editable-island") {
        fail(
          "PATCH_KIND_MISMATCH",
          "Editable island replacement has an unrelated source operation.",
          { patch },
        );
      }
      if (
        patch.startOffset !== element.contentRange.startOffset
        || patch.endOffset !== element.contentRange.endOffset
      ) {
        fail(
          "PATCH_OUTSIDE_TARGET",
          "Editable island replacement must cover the exact element content boundary.",
          { patch, contentRange: element.contentRange },
        );
      }
    }
    if (!isInverse) {
      const expected = planSemanticEditableIslandPatch(index, {
        type: "replace-editable-island",
        targetRef: targetRefs[0],
        beforeInnerHtml: plan.metadata?.beforeInnerHtml,
        nextInnerHtml: plan.metadata?.nextInnerHtml,
        expectedSourceSha256: index.sourceSha256,
      }, plan.metadata?.createdPagerootIds ?? []);
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Editable island patch does not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "set-inline-style") {
    if (targetRefs.length !== 1 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Inline style patch requires one element TargetRef.");
    }
    const element = resolutions[0].target;
    for (const patch of patches) {
      if (!String(patch.kind ?? "").includes("style")) {
        fail("PATCH_KIND_MISMATCH", "Inline style patch has a non-style operation.", { patch });
      }
      assertPatchWithin(
        patch,
        element.startTagRange,
        "PATCH_OUTSIDE_TARGET",
        "Inline style patch is outside the authorized start tag.",
      );
    }
    if (!isInverse) {
      const expected = planInlineStylePatch(index, {
        type: "set-inline-style",
        targetRef: targetRefs[0],
        property: plan.metadata?.property,
        value: plan.metadata?.value,
        important: plan.metadata?.important,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Inline style patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "set-text-range-style") {
    const coalescesExistingWrapper = String(plan.metadata?.writeScope ?? "")
      .startsWith("existing-text-range-wrapper-inline-style");
    const expectedTargetCount = coalescesExistingWrapper ? 2 : 1;
    if (
      targetRefs.length !== expectedTargetCount
      || resolutions.some((resolution) => resolution.target.type !== "element")
    ) {
      fail(
        "PATCH_TARGET_COUNT_INVALID",
        `Text range style patch requires ${expectedTargetCount} element TargetRef${expectedTargetCount === 1 ? "" : "s"}.`,
      );
    }
    const element = resolutions[0].target;
    const styleElement = coalescesExistingWrapper ? resolutions[1].target : null;
    if (
      styleElement
      && (
        !isDescendantNode(index, styleElement, element)
        || styleElement.parentId === null
      )
    ) {
      fail(
        "TEXT_RANGE_TARGET_MISMATCH",
        "The existing text wrapper no longer belongs to the authorized source element.",
      );
    }
    for (const patch of patches) {
      const patchKind = String(patch.kind ?? "");
      const normalizedPatchKind = patchKind.replace(/^(?:inverse:)+/, "");
      const expectedPatchKind = coalescesExistingWrapper
        ? "style"
        : "text-range-style";
      if (!normalizedPatchKind.includes(expectedPatchKind)) {
        fail("PATCH_KIND_MISMATCH", "Text range style patch has an unrelated source operation.", { patch });
      }
      assertPatchWithin(
        patch,
        styleElement?.startTagRange ?? element.contentRange,
        "PATCH_OUTSIDE_TARGET",
        coalescesExistingWrapper
          ? "Text range style patch is outside the authorized wrapper start tag."
          : "Text range style patch is outside the authorized element content.",
      );
    }
    if (!isInverse) {
      const expected = planTextRangeStylePatch(index, {
        type: "set-text-range-style",
        targetRef: targetRefs[0],
        segments: plan.metadata?.segments,
        property: plan.metadata?.property,
        value: plan.metadata?.value,
        important: plan.metadata?.important,
        expectedSourceSha256: index.sourceSha256,
      }, {
        token: TEXT_RANGE_ID_REPLAY_TOKEN,
        pagerootIds: plan.metadata?.createdPagerootIds,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Text range style patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "reorder-sibling") {
    if (targetRefs.length > 2 || resolutions[0].target.type !== "element") {
      fail("PATCH_TARGET_COUNT_INVALID", "Sibling reorder has invalid operation TargetRefs.");
    }
    const moving = resolutions[0].target;
    const parent = moving.parentId ? index.byNodeId.get(moving.parentId) : null;
    if (!parent || parent.type !== "element") {
      fail("REORDER_PARENT_REQUIRED", "Authorized reorder target has no source parent.");
    }
    if (
      resolutions[1]
      && (
        resolutions[1].target.type !== "element"
        || resolutions[1].target.parentId !== parent.nodeId
      )
    ) {
      fail("REORDER_DIFFERENT_PARENT", "Authorized reorder targets have different parents.");
    }
    for (const patch of patches) {
      if (!String(patch.kind ?? "").includes("reorder")) {
        fail("PATCH_KIND_MISMATCH", "Sibling reorder has a non-reorder operation.", { patch });
      }
      assertPatchWithin(
        patch,
        parent.contentRange,
        "PATCH_OUTSIDE_TARGET",
        "Sibling reorder patch is outside the authorized parent content.",
      );
      if (
        patch.endOffset <= moving.range.startOffset
        || patch.startOffset >= moving.range.endOffset
      ) {
        fail(
          "PATCH_OUTSIDE_TARGET",
          "Sibling reorder patch does not include the moved target fragment.",
          { patch, targetRange: moving.range },
        );
      }
    }
    if (!isInverse) {
      const desiredIndex = plan.metadata?.nextOrder?.indexOf(moving.nodeId);
      const expected = planSiblingReorderPatch(index, {
        type: "reorder-sibling",
        targetRef: targetRefs[0],
        ...(targetRefs[1]
          ? { beforeTargetRef: targetRefs[1] }
          : { toIndex: desiredIndex }),
        beforeOrder: plan.metadata?.beforeOrder,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Sibling reorder patches do not match the declared operation metadata.",
        );
      }
    }
  }

  if (operationType === "semantic-operation") {
    const semanticCommand = plan.metadata?.semanticCommand;
    if (!semanticCommand || typeof semanticCommand !== "object") {
      fail(
        "SEMANTIC_OPERATION_METADATA_REQUIRED",
        "A semantic source plan must carry its replayable command metadata.",
      );
    }
    if (!isInverse) {
      const expected = planSemanticOperationPatch(index, {
        ...semanticCommand,
        expectedSourceSha256: index.sourceSha256,
      });
      if (!patchesEqual(patches, expected.patches)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Semantic source patches do not match the declared operation.",
        );
      }
      const expectedTargetRefs = expected.targetRefs.map((targetRef) => cleanTargetRef(targetRef));
      if (canonicalValue(targetRefs) !== canonicalValue(expectedTargetRefs)) {
        fail(
          "PATCH_PLAN_TAMPERED",
          "Semantic source TargetRefs do not match the declared operation.",
        );
      }
    }
  }

  return { operationType, targetRefs, resolutions };
}

function transformedOffset(offset, patches, affinity = "start") {
  let delta = 0;
  for (const patch of patches) {
    if (offset < patch.startOffset) break;
    if (offset > patch.endOffset) {
      delta += patch.after.length - patch.before.length;
      continue;
    }
    if (offset === patch.endOffset) {
      return patch.startOffset + delta + patch.after.length;
    }
    if (offset === patch.startOffset || offset < patch.endOffset) {
      return patch.startOffset + delta + (affinity === "end" ? patch.after.length : 0);
    }
  }
  return offset + delta;
}

function reorderIdentityMap(plan, baseIndex, nextIndex) {
  if (
    operationTypeForPlan(plan) !== "reorder-sibling"
    || !Array.isArray(plan.metadata?.nextOrder)
  ) {
    return null;
  }
  const oldParent = baseIndex.byNodeId.get(plan.metadata.parentNodeId);
  if (!oldParent || oldParent.type !== "element") return null;
  const nextParentStart = transformedOffset(
    oldParent.range.startOffset,
    normalizePatches(plan.patches),
  );
  const nextParent = nextIndex.elements.find((element) => (
    element.tagName === oldParent.tagName
    && element.range.startOffset === nextParentStart
  ));
  if (!nextParent) return null;
  const nextChildren = nextParent.childElementIds.map(
    (nodeId) => nextIndex.byNodeId.get(nodeId),
  );
  if (nextChildren.length !== plan.metadata.nextOrder.length) return null;
  const childMap = new Map();
  plan.metadata.nextOrder.forEach((oldNodeId, position) => {
    childMap.set(oldNodeId, nextChildren[position]);
  });
  return { oldParent, nextParent, childMap };
}

function directChildUnder(index, node, parentId) {
  let current = node;
  while (current?.parentId && current.parentId !== parentId) {
    current = index.byNodeId.get(current.parentId);
  }
  return current?.parentId === parentId ? current : null;
}

function deterministicMappedNode(plan, baseIndex, nextIndex, patches, baseNode) {
  if (baseNode.type === "element" && baseNode.pagerootId) {
    const stableElement = nextIndex.byPagerootId.get(baseNode.pagerootId) ?? null;
    return stableElement?.tagName === baseNode.tagName ? stableElement : null;
  }
  const reorderMap = reorderIdentityMap(plan, baseIndex, nextIndex);
  if (reorderMap) {
    if (baseNode.nodeId === reorderMap.oldParent.nodeId) return reorderMap.nextParent;
    const oldTop = directChildUnder(
      baseIndex,
      baseNode,
      reorderMap.oldParent.nodeId,
    );
    const nextTop = oldTop ? reorderMap.childMap.get(oldTop.nodeId) : null;
    if (oldTop && nextTop) {
      if (baseNode.nodeId === oldTop.nodeId) return nextTop;
      const relativeStart = baseNode.range.startOffset - oldTop.range.startOffset;
      const relativeEnd = baseNode.range.endOffset - oldTop.range.startOffset;
      const candidates = nextIndex.nodes.filter((node) => (
        node.type === baseNode.type
        && node.range.startOffset - nextTop.range.startOffset === relativeStart
        && node.range.endOffset - nextTop.range.startOffset === relativeEnd
        && (
          node.type !== "element"
          || node.tagName === baseNode.tagName
        )
      ));
      if (candidates.length === 1) return candidates[0];
    }
  }

  if (baseNode.type === "text") {
    const replacing = patches.find((patch) => (
      patch.startOffset === baseNode.range.startOffset
      && patch.endOffset === baseNode.range.endOffset
    ));
    const startOffset = transformedOffset(baseNode.range.startOffset, patches);
    const endOffset = replacing
      ? startOffset + replacing.after.length
      : transformedOffset(baseNode.range.endOffset, patches, "end");
    return nextIndex.textNodes.find((node) => (
      node.range.startOffset === startOffset
      && node.range.endOffset === endOffset
    )) ?? null;
  }
  if (baseNode.type === "element") {
    const startOffset = transformedOffset(baseNode.range.startOffset, patches);
    return nextIndex.elements.find((element) => (
      element.tagName === baseNode.tagName
      && element.range.startOffset === startOffset
    )) ?? null;
  }
  return null;
}

function unresolvedTargetMapping(
  beforeTargetRef,
  beforeResolution,
  tracked,
  resolution = beforeResolution.resolution,
) {
  return {
    targetId: beforeTargetRef.targetId,
    beforeTargetRef,
    afterTargetRef: cleanTargetRef(beforeTargetRef, resolution),
    beforeNodeId: beforeResolution.target?.nodeId ?? null,
    afterNodeId: null,
    resolution,
    tracked,
  };
}

function mappedInsertionPointRef(
  plan,
  baseIndex,
  nextIndex,
  patches,
  beforeTargetRef,
  beforeResolution,
  tracked,
) {
  const insertion = beforeResolution.target;
  if (!insertion || insertion.type !== "insertion-point") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  const oldParent = baseIndex.byNodeId.get(insertion.parentId);
  if (!oldParent || oldParent.type !== "element") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
      "orphaned",
    );
  }
  const nextParent = deterministicMappedNode(
    plan,
    baseIndex,
    nextIndex,
    patches,
    oldParent,
  );
  if (!nextParent || nextParent.type !== "element") {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
      "orphaned",
    );
  }

  let nextBeforeSibling = null;
  if (insertion.offset !== oldParent.contentRange.endOffset) {
    const oldBeforeSibling = oldParent.childElementIds
      .map((nodeId) => baseIndex.byNodeId.get(nodeId))
      .find((element) => element.range.startOffset === insertion.offset);
    if (!oldBeforeSibling) {
      return unresolvedTargetMapping(
        beforeTargetRef,
        beforeResolution,
        tracked,
        "orphaned",
      );
    }
    nextBeforeSibling = deterministicMappedNode(
      plan,
      baseIndex,
      nextIndex,
      patches,
      oldBeforeSibling,
    );
    if (
      !nextBeforeSibling
      || nextBeforeSibling.type !== "element"
      || nextBeforeSibling.parentId !== nextParent.nodeId
    ) {
      return unresolvedTargetMapping(
        beforeTargetRef,
        beforeResolution,
        tracked,
        "orphaned",
      );
    }
  }

  const afterTargetRef = createInsertionPointTargetRef(nextIndex, {
    parentId: nextParent.nodeId,
    ...(nextBeforeSibling ? { beforeSiblingId: nextBeforeSibling.nodeId } : {}),
    targetId: beforeTargetRef.targetId,
    label: beforeTargetRef.label,
  });
  return {
    targetId: beforeTargetRef.targetId,
    beforeTargetRef,
    afterTargetRef,
    beforeNodeId: null,
    afterNodeId: null,
    beforeParentId: oldParent.nodeId,
    afterParentId: nextParent.nodeId,
    resolution: "exact",
    tracked,
  };
}

function mappedTargetRef(plan, baseIndex, nextIndex, patches, targetRef, tracked) {
  const beforeTargetRef = cleanTargetRef(targetRef);
  let beforeResolution;
  try {
    beforeResolution = resolveTargetRef(baseIndex, beforeTargetRef);
  } catch (error) {
    if (!tracked) throw error;
    return unresolvedTargetMapping(
      beforeTargetRef,
      { resolution: "orphaned", target: null, error },
      tracked,
      "orphaned",
    );
  }
  if (beforeTargetRef.level === "insertion-point") {
    return mappedInsertionPointRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  if (
    !beforeResolution.target
    || !["element", "text"].includes(beforeResolution.target.type)
  ) {
    return unresolvedTargetMapping(
      beforeTargetRef,
      beforeResolution,
      tracked,
    );
  }
  const nextNode = deterministicMappedNode(
    plan,
    baseIndex,
    nextIndex,
    patches,
    beforeResolution.target,
  );
  if (nextNode) {
    const afterTargetRef = createTargetRef(nextIndex, nextNode, {
      targetId: beforeTargetRef.targetId,
      label: beforeTargetRef.label,
      level: beforeTargetRef.level,
    });
    return {
      targetId: beforeTargetRef.targetId,
      beforeTargetRef,
      afterTargetRef,
      beforeNodeId: beforeResolution.target.nodeId,
      afterNodeId: nextNode.nodeId,
      resolution: "exact",
      tracked,
    };
  }
  return unresolvedTargetMapping(
    beforeTargetRef,
    beforeResolution,
    tracked,
    "orphaned",
  );
}

function mirroredReorderMetadata(plan, mapping) {
  if (!mapping || operationTypeForPlan(plan) !== "reorder-sibling") return {};
  const oldToNew = new Map(
    [...mapping.childMap.entries()].map(([oldNodeId, node]) => [oldNodeId, node.nodeId]),
  );
  return {
    parentNodeId: mapping.nextParent.nodeId,
    beforeOrder: plan.metadata.nextOrder.map((nodeId) => oldToNew.get(nodeId)),
    nextOrder: plan.metadata.beforeOrder.map((nodeId) => oldToNew.get(nodeId)),
  };
}

export function applyPatchPlan(plan, sourceHtml, options = {}) {
  const source = String(sourceHtml);
  const actualSourceSha256 = sourceSha256(source);
  if (actualSourceSha256 !== plan.sourceSha256) {
    fail(
      "STALE_SOURCE_HASH",
      "The source changed before the patch could be applied.",
      { expectedSourceSha256: plan.sourceSha256, actualSourceSha256 },
    );
  }
  const patches = normalizePatches(plan.patches);
  for (const patch of patches) {
    if (patch.endOffset > source.length) {
      fail("INVALID_PATCH_RANGE", "Patch range is outside the source.", { patch });
    }
  }
  recordEditPipelineCount("fullPatchApply", {
    scope: "full-document",
    caller: "applyPatchPlan",
    codeUnitLength: source.length,
  });
  let baseIndex;
  try {
    baseIndex = resolveOwnedSourceIndex(source, options.baseIndex ?? null, {
      scope: "full-document",
      caller: "applyPatchPlan:before",
    });
  } catch (error) {
    if (error instanceof SourceIndexError) {
      fail(error.code, error.message, error.details);
    }
    throw error;
  }
  const authorization = authorizePatchPlan(plan, baseIndex, patches);
  for (const patch of patches) {
    const actual = source.slice(patch.startOffset, patch.endOffset);
    if (actual !== patch.before) {
      fail(
        "STALE_BEFORE_CONTENT",
        "The exact source range changed before the patch could be applied.",
        { patch, actual },
      );
    }
  }
  const html = renderPatches(source, patches);
  const scopeReport = validatePatchScope(source, html, patches);
  if (!scopeReport.outsideUnchanged) {
    fail("OUTSIDE_TARGET_CHANGED", "Source outside the declared patch ranges changed.", scopeReport);
  }

  const nextIndex = buildSourceIndex(html, {
    scope: "full-document",
    caller: "applyPatchPlan:after",
  });
  const parseIntegrity = compareParseIntegrity(baseIndex, nextIndex);
  if (!parseIntegrity.ok) {
    fail(
      "PARSE_INTEGRITY_FAILED",
      "The patched HTML introduced parser or source-range errors.",
      parseIntegrity,
    );
  }

  const nextSourceSha256 = nextIndex.sourceSha256;
  const trackedTargetRefs = Array.isArray(options.trackedTargetRefs)
    ? options.trackedTargetRefs
    : Array.isArray(plan.trackedTargetRefs)
      ? plan.trackedTargetRefs
      : [];
  const operationMappings = authorization.targetRefs.map(
    (targetRef) => mappedTargetRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      targetRef,
      false,
    ),
  );
  const operationTargetIds = new Set(
    operationMappings.map((mapping) => mapping.targetId),
  );
  const trackedMappings = trackedTargetRefs
    .map((targetRef) => cleanTargetRef(targetRef))
    .filter((targetRef) => !operationTargetIds.has(targetRef.targetId))
    .map((targetRef) => mappedTargetRef(
      plan,
      baseIndex,
      nextIndex,
      patches,
      targetRef,
      true,
    ));
  const targetMappings = [...operationMappings, ...trackedMappings];
  const refreshedTargetRefs = operationMappings.map(
    (mapping) => mapping.afterTargetRef,
  );
  const refreshedTrackedTargetRefs = trackedMappings.map(
    (mapping) => mapping.afterTargetRef,
  );
  const reorderMap = reorderIdentityMap(plan, baseIndex, nextIndex);
  const inverseProvenance = {
    baseSourceSha256: actualSourceSha256,
    outputSourceSha256: nextSourceSha256,
    operationType: authorization.operationType,
    appliedPatches: patches.map((patch) => ({ ...patch })),
  };
  inverseProvenance.token = inverseProvenanceToken(
    inverseProvenance,
    refreshedTargetRefs,
  );
  const inversePlan = {
    version: 1,
    type: `inverse:${plan.type}`,
    sourceSha256: nextSourceSha256,
    patches: inversePatches(patches),
    targetRefs: refreshedTargetRefs,
    trackedTargetRefs: refreshedTrackedTargetRefs,
    metadata: {
      inverseOfSourceSha256: plan.sourceSha256,
      originalType: plan.type,
      operationType: authorization.operationType,
      ...plan.metadata,
      ...mirroredReorderMetadata(plan, reorderMap),
      inverseProvenance,
    },
  };
  registerTrustedInversePlan(inversePlan);
  return {
    html,
    changed: patches.length > 0,
    sourceSha256: nextSourceSha256,
    previousSourceSha256: actualSourceSha256,
    patches,
    inversePlan,
    refreshedTargetRefs,
    refreshedTrackedTargetRefs,
    targetMappings,
    scopeReport: {
      ...scopeReport,
      baseSha256: actualSourceSha256,
      outputSha256: nextSourceSha256,
    },
    parseIntegrity,
    sourceIndex: nextIndex,
  };
}

export class SourcePatchEngine {
  plan(command, indexOrHtml) {
    return planSourcePatch(command, indexOrHtml);
  }

  apply(plan, sourceHtml, options = {}) {
    return applyPatchPlan(plan, sourceHtml, options);
  }
}
