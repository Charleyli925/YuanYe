import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  generatePagerootElementId,
} from "./pageroot-element-identity.js";
import {
  applyPatchPlan,
  planEditableIslandPatch,
  planInlineStylePatch,
  planSemanticEditableIslandPatch,
  planSemanticOperationPatch,
  planSemanticTextRangeStylePatch,
  planSiblingReorderPatch,
  planTextRangeStylePatch,
} from "./source-patch-engine.js";
import { buildSourceIndex, resolveOwnedSourceIndex, sourceSha256 } from "./source-index.js";
import { buildSourceTextMap, textRangeToSourceSegments } from "./source-text-map.js";
import { createTargetRef } from "./target-resolver.js";
import {
  assertSemanticOperationContract,
  createSemanticIdentitySnapshot,
  deriveSemanticIdentityDelta,
  SEMANTIC_OPERATION_SCHEMA_VERSION as SHARED_SEMANTIC_OPERATION_SCHEMA_VERSION,
  verifySemanticIdentityTransition,
} from "../../shared/semantic-identity-delta.mjs";

export const SEMANTIC_OPERATION_SCHEMA_VERSION = SHARED_SEMANTIC_OPERATION_SCHEMA_VERSION;

const OPERATION_TYPES = new Set([
  "setText",
  "replaceTextRange",
  "setAttribute",
  "setStyle",
  "insertElement",
  "deleteElement",
  "moveElement",
  "replaceSubtree",
]);
const OPERATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{7,95}$/u;
const TRUSTED_RESTORE_OPERATIONS = new WeakMap();
const STATE_SOURCE_INDEXES = new WeakMap();

export class SemanticOperationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SemanticOperationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SemanticOperationError(code, message, details);
}

function resolveKernelIndex(html, candidateIndex, options) {
  try {
    return resolveOwnedSourceIndex(html, candidateIndex, options);
  } catch (error) {
    if (error?.name === "SourceIndexError") {
      fail(error.code, error.message, error.details || {});
    }
    throw error;
  }
}

function assertRevision(revision, fieldName = "revision") {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    fail("SEMANTIC_REVISION_INVALID", `${fieldName} must be a non-negative safe integer.`, {
      fieldName,
      revision,
    });
  }
}

function cloneLineage(lineage) {
  if (!Array.isArray(lineage)) {
    fail("SEMANTIC_LINEAGE_INVALID", "Semantic document lineage must be an array.");
  }
  const operationIds = new Set();
  return lineage.map((entry) => {
    if (!entry || typeof entry !== "object" || !OPERATION_ID_PATTERN.test(entry.operationId ?? "")) {
      fail("SEMANTIC_LINEAGE_INVALID", "Semantic document lineage contains an invalid entry.");
    }
    if (operationIds.has(entry.operationId)) {
      fail("SEMANTIC_LINEAGE_DUPLICATE", "Semantic document lineage repeats an operation ID.", {
        operationId: entry.operationId,
      });
    }
    operationIds.add(entry.operationId);
    return { ...entry };
  });
}

function assertManagedIdentity(index, context) {
  if (!index.pagerootIdentity?.complete || !index.pagerootIdentity.valid) {
    fail(
      "SEMANTIC_IDENTITY_INCOMPLETE",
      `${context} requires a managed source with complete valid element identity.`,
      { pagerootIdentity: index.pagerootIdentity },
    );
  }
}

export function createSemanticDocumentState(html, options = {}) {
  const source = String(html);
  const revision = options.revision ?? 0;
  assertRevision(revision);
  const index = resolveKernelIndex(source, options.sourceIndex ?? null, {
    scope: "full-document",
    caller: "createSemanticDocumentState",
  });
  assertManagedIdentity(index, "Semantic document state");
  const lineage = cloneLineage(options.lineage ?? []);
  if (lineage.some((entry) => entry.nextRevision > revision)) {
    fail("SEMANTIC_LINEAGE_REVISION_INVALID", "Semantic lineage extends beyond the declared document revision.");
  }
  const state = {
    schemaVersion: SEMANTIC_OPERATION_SCHEMA_VERSION,
    revision,
    sourceSha256: index.sourceSha256,
    html: source,
    lineage,
  };
  STATE_SOURCE_INDEXES.set(state, index);
  return state;
}

function assertState(state) {
  if (!state || state.schemaVersion !== SEMANTIC_OPERATION_SCHEMA_VERSION) {
    fail("SEMANTIC_STATE_INVALID", "A semantic document state with schema version 1 is required.");
  }
  assertRevision(state.revision);
  if (typeof state.html !== "string" || sourceSha256(state.html) !== state.sourceSha256) {
    fail("SEMANTIC_STATE_HASH_MISMATCH", "Semantic document state bytes do not match their declared Hash.");
  }
  return createSemanticDocumentState(state.html, {
    revision: state.revision,
    lineage: state.lineage,
    sourceIndex: STATE_SOURCE_INDEXES.get(state) ?? null,
  });
}

function assertOperationEnvelope(state, operation) {
  if (!operation || typeof operation !== "object") {
    fail("SEMANTIC_OPERATION_INVALID", "A semantic operation object is required.");
  }
  if (operation.schemaVersion !== SEMANTIC_OPERATION_SCHEMA_VERSION) {
    fail("SEMANTIC_OPERATION_SCHEMA_UNSUPPORTED", "Semantic operation schema version is unsupported.", {
      schemaVersion: operation.schemaVersion,
    });
  }
  if (!OPERATION_ID_PATTERN.test(operation.operationId ?? "")) {
    fail("SEMANTIC_OPERATION_ID_INVALID", "Semantic operationId has an invalid format.");
  }
  if (state.lineage.some((entry) => entry.operationId === operation.operationId)) {
    fail("SEMANTIC_OPERATION_DUPLICATE", "The operationId already exists in document lineage.", {
      operationId: operation.operationId,
    });
  }
  assertRevision(operation.baseRevision, "baseRevision");
  if (operation.baseRevision !== state.revision) {
    fail("SEMANTIC_OPERATION_STALE_REVISION", "The semantic operation was created from a stale revision.", {
      expectedRevision: state.revision,
      actualRevision: operation.baseRevision,
    });
  }
  if (operation.expectedSourceSha256 !== state.sourceSha256) {
    fail("SEMANTIC_OPERATION_STALE_HASH", "The semantic operation was created from different source bytes.", {
      expectedSourceSha256: state.sourceSha256,
      actualSourceSha256: operation.expectedSourceSha256,
    });
  }
  if (operation.type !== "restoreExactSource") {
    try {
      assertSemanticOperationContract(operation);
    } catch (cause) {
      fail(
        cause?.code || "SEMANTIC_OPERATION_INVALID",
        cause?.message || "Semantic operation is invalid.",
        cause?.details || {},
      );
    }
  }
}

function elementPrecondition(index, target, fieldName) {
  if (!target || typeof target !== "object") {
    fail("SEMANTIC_TARGET_PRECONDITION_REQUIRED", `${fieldName} requires stable ID, tag and exact subtree Hash.`);
  }
  const targetMembers = Object.keys(target);
  const unexpectedMembers = targetMembers.filter((member) => ![
    "elementId",
    "tagName",
    "expectedOuterHtmlSha256",
  ].includes(member));
  if (unexpectedMembers.length > 0) {
    fail("SEMANTIC_TARGET_MEMBER_UNKNOWN", `${fieldName} contains unsupported target evidence.`, {
      fieldName,
      members: unexpectedMembers,
    });
  }
  const elementId = String(target.elementId ?? "");
  const element = index.byPagerootId.get(elementId) ?? null;
  if (!element) {
    fail("SEMANTIC_TARGET_NOT_FOUND", `${fieldName} is not present in the exact source.`, {
      fieldName,
      elementId,
    });
  }
  const tagName = String(target.tagName ?? "").toLowerCase();
  if (!tagName || element.tagName !== tagName) {
    fail("SEMANTIC_TARGET_TAG_MISMATCH", `${fieldName} stable ID does not match its expected authored tag.`, {
      fieldName,
      elementId,
      expectedTagName: tagName || null,
      actualTagName: element.tagName,
    });
  }
  const actualOuterHtmlSha256 = sourceSha256(element.raw);
  if (target.expectedOuterHtmlSha256 !== actualOuterHtmlSha256) {
    fail("SEMANTIC_TARGET_HASH_MISMATCH", `${fieldName} subtree changed after the operation was created.`, {
      fieldName,
      elementId,
      expectedOuterHtmlSha256: target.expectedOuterHtmlSha256,
      actualOuterHtmlSha256,
    });
  }
  return element;
}

export function createSemanticElementPrecondition(indexOrHtml, elementId) {
  const index = typeof indexOrHtml === "string"
    ? buildSourceIndex(indexOrHtml, {
      scope: "full-document",
      caller: "createSemanticElementPrecondition",
    })
    : resolveKernelIndex(indexOrHtml?.source, indexOrHtml);
  assertManagedIdentity(index, "Semantic target precondition");
  const element = index.byPagerootId.get(String(elementId)) ?? null;
  if (!element) {
    fail("SEMANTIC_TARGET_NOT_FOUND", "The stable element ID is not present in the exact source.", {
      elementId,
    });
  }
  return {
    elementId: element.pagerootId,
    tagName: element.tagName,
    expectedOuterHtmlSha256: sourceSha256(element.raw),
  };
}

function fragmentRoot(index, html) {
  const materialParseErrors = index.parseErrors.filter((error) => error.code !== "missing-doctype");
  if (!index.integrity.ok || materialParseErrors.length > 0) {
    fail("SEMANTIC_FRAGMENT_PARSE_INVALID", "Structural HTML must parse without new source errors.", {
      parseErrors: materialParseErrors,
      rangeErrors: index.rangeErrors,
    });
  }
  const roots = index.elements.filter((element) => element.parentId === null);
  if (roots.length !== 1) {
    fail("SEMANTIC_FRAGMENT_ROOT_INVALID", "Structural HTML must contain exactly one source root element.", {
      rootCount: roots.length,
    });
  }
  const [root] = roots;
  if (
    html.slice(0, root.range.startOffset).trim() !== ""
    || html.slice(root.range.endOffset).trim() !== ""
  ) {
    fail("SEMANTIC_FRAGMENT_ROOT_INVALID", "Structural HTML cannot contain authored content outside its root element.");
  }
  return root;
}

function allocateId(randomUUID, reservedIds) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const elementId = generatePagerootElementId(randomUUID);
    if (!reservedIds.has(elementId)) {
      reservedIds.add(elementId);
      return elementId;
    }
  }
  fail("SEMANTIC_ID_ALLOCATION_EXHAUSTED", "Could not allocate a fresh stable element ID.");
}

function materializeNewFragment(rawHtml, documentIndex, options = {}) {
  const html = String(rawHtml ?? "");
  const index = buildSourceIndex(html, {
    scope: "fragment",
    caller: "materializeNewFragment",
  });
  const root = fragmentRoot(index, html);
  const existingIdentity = index.elements.find((element) => element.pagerootIdAttribute);
  if (existingIdentity) {
    fail(
      "SEMANTIC_NEW_FRAGMENT_ID_FORBIDDEN",
      "New structural HTML cannot supply or clone persistent PageRoot IDs.",
      { nodeId: existingIdentity.nodeId },
    );
  }
  const reservedIds = new Set(documentIndex.byPagerootId.keys());
  const identities = index.elements.map((element) => ({
    offset: element.closingDelimiterOffset,
    elementId: allocateId(options.randomUUID, reservedIds),
  }));
  let identified = html;
  for (const identity of [...identities].sort((left, right) => right.offset - left.offset)) {
    identified = `${identified.slice(0, identity.offset)} ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${identity.elementId}"${identified.slice(identity.offset)}`;
  }
  const nextIndex = buildSourceIndex(identified, {
    scope: "fragment",
    caller: "materializeNewFragment:identified",
  });
  assertManagedIdentity(nextIndex, "Materialized structural HTML");
  return {
    html: identified,
    rootElementId: identities[index.elements.indexOf(root)].elementId,
    allocatedElementIds: identities.map((identity) => identity.elementId),
  };
}

function materializeReplacementFragment(rawHtml, documentIndex, target, options = {}) {
  const html = String(rawHtml ?? "");
  const index = buildSourceIndex(html, {
    scope: "fragment",
    caller: "materializeReplacementFragment",
  });
  const root = fragmentRoot(index, html);
  if (index.elements.some((element) => element.pagerootIdAttribute)) {
    fail(
      "SEMANTIC_REPLACEMENT_ID_FORBIDDEN",
      "Replacement HTML cannot author persistent PageRoot IDs; the kernel owns identity continuity.",
    );
  }
  const reservedIds = new Set(documentIndex.byPagerootId.keys());
  const identities = index.elements.map((element) => ({
    offset: element.closingDelimiterOffset,
    elementId: element.nodeId === root.nodeId
      ? target.pagerootId
      : allocateId(options.randomUUID, reservedIds),
  }));
  let identified = html;
  for (const identity of [...identities].sort((left, right) => right.offset - left.offset)) {
    identified = `${identified.slice(0, identity.offset)} ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${identity.elementId}"${identified.slice(identity.offset)}`;
  }
  return {
    html: identified,
    allocatedElementIds: identities
      .map((identity) => identity.elementId)
      .filter((elementId) => elementId !== target.pagerootId),
  };
}

function semanticSourceCommand(state, index, operation, options) {
  if (!OPERATION_TYPES.has(operation.type)) {
    fail("SEMANTIC_OPERATION_TYPE_UNSUPPORTED", `Unsupported semantic operation type: ${operation.type ?? "missing"}.`);
  }
  const command = {
    type: "semantic-operation",
    semanticType: operation.type,
    expectedSourceSha256: state.sourceSha256,
  };
  const allocation = { allocatedElementIds: [] };

  if (["setText", "replaceTextRange", "setAttribute", "setStyle", "deleteElement", "moveElement", "replaceSubtree"].includes(operation.type)) {
    const target = elementPrecondition(index, operation.target, "target");
    command.targetElementId = target.pagerootId;
    command.targetTagName = target.tagName;
  }
  if (["insertElement", "moveElement"].includes(operation.type)) {
    const parent = elementPrecondition(index, operation.parent, "parent");
    command.parentElementId = parent.pagerootId;
    command.parentTagName = parent.tagName;
    if (operation.before !== null && operation.before !== undefined) {
      const before = elementPrecondition(index, operation.before, "before");
      command.beforeElementId = before.pagerootId;
      command.beforeTagName = before.tagName;
    }
  }

  if (operation.type === "setText") {
    if (
      typeof operation.text !== "string"
      || (
        operation.contentHtml !== undefined
        && typeof operation.contentHtml !== "string"
      )
    ) {
      fail("SEMANTIC_TEXT_INVALID", "setText text must be a string.");
    }
    command.text = operation.text;
    if (operation.contentHtml !== undefined) {
      command.contentHtml = operation.contentHtml;
    }
  } else if (operation.type === "replaceTextRange") {
    const target = index.byPagerootId.get(command.targetElementId);
    const textMap = buildSourceTextMap(index, target.nodeId);
    const startOffset = operation.range?.startOffset;
    const endOffset = operation.range?.endOffset;
    if (
      !operation.range
      || typeof operation.range !== "object"
      || Object.keys(operation.range).some((member) => !["startOffset", "endOffset", "quote"].includes(member))
      || typeof operation.range.quote !== "string"
      || typeof operation.text !== "string"
    ) {
      fail("SEMANTIC_TEXT_RANGE_INVALID", "replaceTextRange requires an exact text range, quote and string replacement.");
    }
    const quote = operation.range.quote;
    if (textMap.text.slice(startOffset, endOffset) !== quote) {
      fail("SEMANTIC_TEXT_QUOTE_MISMATCH", "The selected text no longer matches its exact source quote.", {
        startOffset,
        endOffset,
        expectedQuote: quote,
        actualQuote: textMap.text.slice(startOffset, endOffset),
      });
    }
    command.segments = textRangeToSourceSegments(textMap, startOffset, endOffset);
    command.text = operation.text;
  } else if (operation.type === "setAttribute") {
    if (
      typeof operation.name !== "string"
      || (operation.value !== null && typeof operation.value !== "string")
    ) {
      fail("SEMANTIC_ATTRIBUTE_INVALID", "setAttribute requires a string name and string-or-null value.");
    }
    command.attributeName = operation.name;
    command.value = operation.value;
  } else if (operation.type === "setStyle") {
    if (
      typeof operation.property !== "string"
      || typeof operation.value !== "string"
      || typeof operation.important !== "boolean"
    ) {
      fail("SEMANTIC_STYLE_INVALID", "setStyle requires string property/value and an explicit important boolean.");
    }
    if (operation.range !== undefined) {
      if (
        !operation.range
        || typeof operation.range !== "object"
        || Object.keys(operation.range).some(
          (member) => !["startOffset", "endOffset", "quote"].includes(member),
        )
        || typeof operation.range.quote !== "string"
      ) {
        fail("SEMANTIC_TEXT_RANGE_INVALID", "Range style requires an exact text range and quote.");
      }
      const target = index.byPagerootId.get(command.targetElementId);
      const textMap = buildSourceTextMap(index, target.nodeId);
      if (
        textMap.text.slice(operation.range.startOffset, operation.range.endOffset)
          !== operation.range.quote
      ) {
        fail("SEMANTIC_TEXT_QUOTE_MISMATCH", "The styled text no longer matches its exact source quote.");
      }
      command.segments = textRangeToSourceSegments(
        textMap,
        operation.range.startOffset,
        operation.range.endOffset,
      );
    }
  } else if (operation.type === "insertElement") {
    if (typeof operation.html !== "string" || operation.html.length === 0) {
      fail("SEMANTIC_FRAGMENT_INVALID", "insertElement requires non-empty structural HTML.");
    }
    const fragment = materializeNewFragment(operation.html, index, options);
    command.elementHtml = fragment.html;
    allocation.allocatedElementIds = fragment.allocatedElementIds;
    allocation.insertedRootElementId = fragment.rootElementId;
  } else if (operation.type === "replaceSubtree") {
    if (typeof operation.html !== "string" || operation.html.length === 0) {
      fail("SEMANTIC_FRAGMENT_INVALID", "replaceSubtree requires non-empty structural HTML.");
    }
    const target = index.byPagerootId.get(command.targetElementId);
    const fragment = materializeReplacementFragment(operation.html, index, target, options);
    command.elementHtml = fragment.html;
    allocation.allocatedElementIds = fragment.allocatedElementIds;
  }
  return { command, allocation };
}

function createTrustedRestoreOperation(operationId, baseRevision, expectedSourceSha256, html) {
  const restore = Object.freeze({
    schemaVersion: SEMANTIC_OPERATION_SCHEMA_VERSION,
    operationId,
    baseRevision,
    expectedSourceSha256,
    type: "restoreExactSource",
  });
  TRUSTED_RESTORE_OPERATIONS.set(restore, {
    canonical: JSON.stringify(restore),
    html,
  });
  return restore;
}

function inverseOperationId(operationId, nextRevision, sourceHash) {
  return `inverse_${sourceHash.slice(-12)}_${sourceSha256(operationId).slice(-12)}_${nextRevision}`;
}

function appliedResult(
  state,
  operation,
  html,
  materialization,
  allocation = {},
  identityDelta = null,
  afterIndex = null,
) {
  const nextRevision = state.revision + 1;
  const afterSourceSha256 = sourceSha256(html);
  const lineageEntry = {
    operationId: operation.operationId,
    type: operation.type,
    baseRevision: state.revision,
    nextRevision,
    beforeSourceSha256: state.sourceSha256,
    afterSourceSha256,
  };
  const nextState = createSemanticDocumentState(html, {
    revision: nextRevision,
    lineage: [...state.lineage, lineageEntry],
    sourceIndex: afterIndex,
  });
  const inverseOperation = createTrustedRestoreOperation(
    inverseOperationId(operation.operationId, nextRevision, state.sourceSha256),
    nextRevision,
    afterSourceSha256,
    state.html,
  );
  return {
    changed: html !== state.html,
    html,
    sourceSha256: afterSourceSha256,
    previousSourceSha256: state.sourceSha256,
    baseRevision: state.revision,
    nextRevision,
    lineageEntry,
    inverseOperation,
    nextState,
    materialization,
    ...(identityDelta ? { identityDelta } : {}),
    ...allocation,
  };
}

function nearestIdentifiedParentId(index, element) {
  let parentId = element.parentId;
  while (parentId) {
    const parent = index.byNodeId.get(parentId);
    if (!parent || parent.type !== "element") return null;
    if (parent.pagerootId) return parent.pagerootId;
    parentId = parent.parentId;
  }
  return null;
}

function semanticIdentitySnapshot(index) {
  assertManagedIdentity(index, "Semantic identity delta");
  return createSemanticIdentitySnapshot({
    sourceSha256: index.sourceSha256,
    elements: index.elements.map((element) => ({
      elementId: element.pagerootId,
      tagName: element.tagName,
      parentElementId: nearestIdentifiedParentId(index, element),
      outerHtmlSha256: sourceSha256(element.raw),
    })),
  });
}

export function deriveSemanticOperationIdentityDelta(
  beforeHtml,
  afterHtml,
  operation,
  { direction = "forward", beforeIndex = null, afterIndex = null } = {},
) {
  const beforeSnapshot = semanticIdentitySnapshot(
    resolveKernelIndex(String(beforeHtml), beforeIndex, {
      scope: "full-document",
      caller: "deriveSemanticOperationIdentityDelta:before",
    }),
  );
  const afterSnapshot = semanticIdentitySnapshot(
    resolveKernelIndex(String(afterHtml), afterIndex, {
      scope: "full-document",
      caller: "deriveSemanticOperationIdentityDelta:after",
    }),
  );
  const identityDelta = deriveSemanticIdentityDelta(
    beforeSnapshot,
    afterSnapshot,
    operation,
    { direction },
  );
  verifySemanticIdentityTransition({
    beforeSnapshot,
    afterSnapshot,
    operation,
    direction,
    identityDelta,
  });
  return identityDelta;
}

function applyTrustedRestore(state, operation) {
  const trusted = TRUSTED_RESTORE_OPERATIONS.get(operation);
  if (!trusted || trusted.canonical !== JSON.stringify(operation)) {
    fail(
      "SEMANTIC_INVERSE_UNTRUSTED",
      "Exact-source restore operations must be generated by this kernel and cannot be cloned or authored.",
    );
  }
  const index = buildSourceIndex(trusted.html, {
    scope: "full-document",
    caller: "applyTrustedRestore",
  });
  assertManagedIdentity(index, "Exact semantic restore");
  return appliedResult(state, operation, trusted.html, {
    kind: "trusted-exact-source-restore",
    source: "authoritative-source-history",
  }, {}, null, index);
}

export function applySemanticOperation(inputState, operation, options = {}) {
  const state = assertState(inputState);
  assertOperationEnvelope(state, operation);
  if (operation.type === "restoreExactSource") {
    return applyTrustedRestore(state, operation);
  }
  const index = STATE_SOURCE_INDEXES.get(state);
  if (!index) {
    fail("SEMANTIC_STATE_INVALID", "Semantic document state is missing its owned source index.");
  }
  const { command, allocation } = semanticSourceCommand(state, index, operation, options);
  const targetElement = command.targetElementId
    ? index.byPagerootId.get(command.targetElementId)
    : null;
  const semanticParent = operation.type === "moveElement"
    ? index.byPagerootId.get(operation.parent.elementId)
    : null;
  const plan = operation.type === "moveElement"
    && targetElement?.parentId === semanticParent?.nodeId
    ? planSiblingReorderPatch(index, {
      type: "reorder-sibling",
      targetRef: createTargetRef(index, targetElement, { level: "subregion" }),
      ...(operation.before
        ? {
            beforeTargetRef: createTargetRef(
              index,
              index.byPagerootId.get(operation.before.elementId),
              { level: "subregion" },
            ),
          }
        : {}),
      expectedSourceSha256: state.sourceSha256,
    })
    : operation.type === "setText" && operation.contentHtml !== undefined
    ? (operation.createdPagerootIds !== undefined
      ? planSemanticEditableIslandPatch(index, {
        type: "replace-editable-island",
        targetRef: createTargetRef(index, targetElement, { level: "subregion" }),
        beforeInnerHtml: index.source.slice(
          targetElement.contentRange.startOffset,
          targetElement.contentRange.endOffset,
        ),
        nextInnerHtml: command.contentHtml,
        expectedSourceSha256: state.sourceSha256,
      }, operation.createdPagerootIds)
      : planEditableIslandPatch(index, {
        type: "replace-editable-island",
        targetRef: createTargetRef(index, targetElement, { level: "subregion" }),
        beforeInnerHtml: index.source.slice(
          targetElement.contentRange.startOffset,
          targetElement.contentRange.endOffset,
        ),
        nextInnerHtml: command.contentHtml,
        expectedSourceSha256: state.sourceSha256,
      }, { randomUUID: options.randomUUID }))
    : operation.type === "setStyle" && operation.range
    ? (operation.createdPagerootIds
      ? planSemanticTextRangeStylePatch(index, {
        type: "set-text-range-style",
        targetRef: createTargetRef(index, targetElement, { level: "subregion" }),
        segments: command.segments,
        property: operation.property,
        value: operation.value,
        important: operation.important,
        expectedSourceSha256: state.sourceSha256,
      }, operation.createdPagerootIds)
      : planTextRangeStylePatch(index, {
        type: "set-text-range-style",
        targetRef: createTargetRef(index, targetElement, { level: "subregion" }),
        segments: command.segments,
        property: operation.property,
        value: operation.value,
        important: operation.important,
        expectedSourceSha256: state.sourceSha256,
      }, { randomUUID: options.randomUUID }))
    : operation.type === "setStyle"
    ? planInlineStylePatch(index, {
      type: "set-inline-style",
      targetRef: createTargetRef(index, targetElement, {
        level: "subregion",
      }),
      property: operation.property,
      value: operation.value,
      important: operation.important === true,
      expectedSourceSha256: state.sourceSha256,
    })
    : planSemanticOperationPatch(index, command);
  if (
    operation.type === "setText"
    && operation.contentHtml !== undefined
    && Array.isArray(plan.metadata?.createdPagerootIds)
  ) {
    allocation.allocatedElementIds = [...plan.metadata.createdPagerootIds];
  }
  const materialization = applyPatchPlan(plan, state.html, {
    baseIndex: index,
    ...(Array.isArray(options.trackedTargetRefs)
      ? { trackedTargetRefs: options.trackedTargetRefs }
      : {}),
  });
  assertManagedIdentity(materialization.sourceIndex, "Semantic operation output");
  if (operation.type === "insertElement" || operation.type === "moveElement") {
    const expectedParent = materialization.sourceIndex.byPagerootId.get(
      operation.parent.elementId,
    );
    const placedElementId = operation.type === "moveElement"
      ? operation.target.elementId
      : allocation.insertedRootElementId;
    const placedElement = placedElementId
      ? materialization.sourceIndex.byPagerootId.get(placedElementId)
      : null;
    if (
      expectedParent?.type !== "element"
      || placedElement?.type !== "element"
      || placedElement.parentId !== expectedParent.nodeId
    ) {
      fail(
        "SEMANTIC_STRUCTURE_DESTINATION_MISMATCH",
        "The HTML parser did not retain the structural element under the requested source parent.",
        {
          operationType: operation.type,
          parentElementId: operation.parent.elementId,
          placedElementId: placedElementId ?? null,
        },
      );
    }
  }
  if (operation.type === "setText" && operation.contentHtml !== undefined) {
    const target = materialization.sourceIndex.byPagerootId.get(
      operation.target.elementId,
    );
    const text = target?.type === "element"
      ? buildSourceTextMap(
        materialization.sourceIndex,
        target.nodeId,
        { allowEmpty: true, ignoreComments: true },
      ).text
      : null;
    if (text !== operation.text) {
      fail(
        "SEMANTIC_MATERIALIZATION_TEXT_MISMATCH",
        "The identified content projection does not match setText logical text.",
      );
    }
  }
  // A range operation declares logical intent only. The one materialization
  // owns any wrapper allocation, then binds that allocation into identity
  // verification and returns it to the caller as accepted save evidence.
  const generatedRangeStyleIds = (
    operation.type === "setStyle"
    && operation.range
    && !operation.createdPagerootIds
    && Array.isArray(plan.metadata?.createdPagerootIds)
  )
    ? [...plan.metadata.createdPagerootIds]
    : [];
  if (generatedRangeStyleIds.length > 0) {
    allocation.allocatedElementIds = generatedRangeStyleIds;
  }
  const generatedEditableIslandIds = (
    operation.type === "setText"
    && operation.contentHtml !== undefined
    && operation.createdPagerootIds === undefined
    && allocation.allocatedElementIds?.length
  )
    ? [...allocation.allocatedElementIds]
    : [];
  const identityOperation = generatedRangeStyleIds.length > 0
    ? { ...operation, createdPagerootIds: generatedRangeStyleIds }
    : generatedEditableIslandIds.length > 0
      ? {
          ...operation,
          contentHtml: plan.metadata.nextInnerHtml,
          createdPagerootIds: generatedEditableIslandIds,
        }
      : operation.type === "setText" && operation.contentHtml !== undefined
        ? { ...operation, contentHtml: plan.metadata.nextInnerHtml }
        : operation;
  const identityDelta = deriveSemanticOperationIdentityDelta(
    state.html,
    materialization.html,
    identityOperation,
    {
      beforeIndex: index,
      afterIndex: materialization.sourceIndex,
    },
  );
  return appliedResult(state, operation, materialization.html, {
    kind: "source-patch",
    planType: plan.type,
    patches: materialization.patches,
    scopeReport: materialization.scopeReport,
    parseIntegrity: materialization.parseIntegrity,
    sourcePatchResult: materialization,
  }, allocation, identityDelta, materialization.sourceIndex);
}

export class SemanticOperationKernel {
  createState(html, options = {}) {
    return createSemanticDocumentState(html, options);
  }

  createTarget(indexOrHtml, elementId) {
    return createSemanticElementPrecondition(indexOrHtml, elementId);
  }

  apply(state, operation, options = {}) {
    return applySemanticOperation(state, operation, options);
  }
}
