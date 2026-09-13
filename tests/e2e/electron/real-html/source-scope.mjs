import { buildSourceIndex } from "../../../../app/lib/source-index.js";
import { parseInlineStyle } from "../../../../app/lib/source-patch-core.js";
import { parseFragment } from "parse5";
import {
  compareSourceByteRegions,
  utf8ByteRange,
} from "../../../helpers/source-byte-region-oracle.mjs";

function sourceElementRange(sourceBytes, sourceId, side) {
  const source = sourceBytes.toString("utf8");
  const index = buildSourceIndex(source, {
    caller: "real-html-source-scope-oracle",
    scope: "test",
  });
  const element = index.byPagerootId.get(sourceId);
  if (!element?.range) {
    const error = new Error(`Source element ${sourceId} disappeared from the ${side} bytes.`);
    error.code = "SOURCE_SCOPE_IDENTITY_MISSING";
    throw error;
  }
  const codeUnitRange = {
    start: element.range.startOffset,
    end: element.range.endOffset,
  };
  return {
    sourceIndex: index,
    codeUnitRange,
    byteRange: utf8ByteRange(source, codeUnitRange),
    contentByteRange: utf8ByteRange(source, {
      start: element.contentRange.startOffset,
      end: element.contentRange.endOffset,
    }),
  };
}

// Independent, narrow oracle: reorder raw attribute tokens only. Do not
// serialize HTML or normalize values, quotes, whitespace, comments or text.
function attributeOrderOnly(bytes, spans = false) {
  const source = bytes.toString("utf8"), patches = [];
  const visit = node => {
    const positions = Object.values((node.tagName === "a" || (spans && node.tagName === "span")) && node.namespaceURI === "http://www.w3.org/1999/xhtml"
      ? node.sourceCodeLocation?.attrs || {} : {})
      .sort((a, b) => a.startOffset - b.startOffset);
    const tokens = positions.map(p => source.slice(p.startOffset, p.endOffset)).sort();
    positions.forEach((p, i) => patches.push({ ...p, text: tokens[i] }));
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parseFragment(source, { sourceCodeLocationInfo: true }));
  let result = source;
  for (const p of patches.sort((a, b) => b.startOffset - a.startOffset))
    result = result.slice(0, p.startOffset) + p.text + result.slice(p.endOffset);
  return Buffer.from(result);
}

function requiredRange(value, label) {
  if (!value || !Number.isInteger(value.start) || !Number.isInteger(value.end)) {
    const error = new Error(`${label} must be explicitly declared for source oracle evidence.`);
    error.code = "SOURCE_SCOPE_RANGE_REQUIRED";
    throw error;
  }
  if (value.start < 0 || value.end < value.start) {
    const error = new Error(`${label} is not a valid source byte range.`);
    error.code = "SOURCE_SCOPE_RANGE_INVALID";
    throw error;
  }
  return { start: value.start, end: value.end };
}

function requiredExpected(value, label) {
  if (value == null) {
    const error = new Error(`${label} must be independently declared, not derived from observed bytes.`);
    error.code = "SOURCE_SCOPE_EXPECTATION_REQUIRED";
    throw error;
  }
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, "utf8");
}

function inside(inner, outer) {
  return inner.start >= outer.start && inner.end <= outer.end;
}

export const SOURCE_SCOPE_POLICIES = Object.freeze({
  TEXT_INPUT_DELETE: "native-text-input-delete-v1",
  TEXT_NEWLINE: "native-text-newline-v1",
  TEXT_PASTE: "native-plain-text-paste-v1",
  TEXT_UNDO_REDO: "native-history-v1",
  TEXT_FORMAT: "native-inline-format-v1",
});

function assertPolicy(value) {
  if (!Object.values(SOURCE_SCOPE_POLICIES).includes(value)) {
    const error = new Error(`Unknown source normalization policy: ${String(value)}.`);
    error.code = "SOURCE_SCOPE_POLICY_INVALID";
    throw error;
  }
}

function relativeChangedRange(before, after) {
  let prefix = 0;
  const minimum = Math.min(before.length, after.length);
  while (prefix < minimum && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < minimum - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return {
    before: { start: prefix, end: before.length - suffix },
    after: { start: prefix, end: after.length - suffix },
  };
}

function styleDeclarationMap(element) {
  const attributes = element.attributesByName.get("style") || [];
  if (attributes.length > 1) {
    return {
      duplicateStyleAttributes: true,
      duplicateProperties: [],
      declarations: new Map(),
      syntaxComplete: false,
      unparsedRanges: [],
    };
  }
  const rawStyle = attributes[0]?.rawValue || "";
  const parsed = parseInlineStyle(rawStyle);
  const covered = new Uint8Array(rawStyle.length);
  for (const declaration of parsed) {
    covered.fill(1, declaration.segmentStartOffset, declaration.separatorEndOffset);
  }
  const unparsedRanges = [];
  let unparsedStart = null;
  for (let index = 0; index < rawStyle.length; index += 1) {
    const allowedUncovered = covered[index] === 1 || /[;\s]/u.test(rawStyle[index]);
    if (!allowedUncovered && unparsedStart === null) unparsedStart = index;
    if (allowedUncovered && unparsedStart !== null) {
      unparsedRanges.push({ start: unparsedStart, end: index });
      unparsedStart = null;
    }
  }
  if (unparsedStart !== null) {
    unparsedRanges.push({ start: unparsedStart, end: rawStyle.length });
  }
  const duplicateProperties = [];
  const declarations = new Map();
  for (const declaration of parsed) {
    if (declarations.has(declaration.normalizedProperty)) {
      duplicateProperties.push(declaration.normalizedProperty);
      continue;
    }
    declarations.set(declaration.normalizedProperty, {
      value: declaration.value,
      important: declaration.important,
    });
  }
  return {
    duplicateStyleAttributes: false,
    duplicateProperties,
    declarations,
    syntaxComplete: unparsedRanges.length === 0 && !rawStyle.includes("/*"),
    unparsedRanges,
  };
}

function declarationChanged(before, after) {
  return before?.value !== after?.value || before?.important !== after?.important;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function formattedMarkerAppendedPattern(marker) {
  const styleValue = "all:\\s*unset;\\s*display:\\s*inline\\s*!important;\\s*"
    + "font-weight:\\s*700;\\s*font-style:\\s*italic;\\s*"
    + "text-decoration-line:\\s*underline";
  return new RegExp(
    ` <span style="${styleValue}" data-pageroot-id="pr1_[0-9a-f]{32}">`
    + `${escapeRegExp(marker)}</span>`,
    "u",
  );
}

/**
 * Verify one native operation immediately against its own accepted baseline.
 * Bytes outside the Stable-ID element must be identical; element-local
 * normalization is allowed only under a closed policy plus independent
 * semantic contains/excludes expectations.
 */
export function compareElementScopedMutation({
  before,
  after,
  sourceId,
  normalizationPolicy,
  expectedAfterContains = [],
  expectedAfterExcludes = [],
  expectedBeforeExcludes = expectedAfterContains,
  expectedAppendedPattern,
  expectedFreshStableIdCount,
  allowAttributeOrderOnly = false,
  allowSpanAttributeOrder = false,
} = {}) {
  assertPolicy(normalizationPolicy);
  if (!(expectedAppendedPattern instanceof RegExp)) {
    const error = new Error("A closed appended-subrange pattern is required for source scope.");
    error.code = "SOURCE_SCOPE_APPENDED_PATTERN_REQUIRED";
    throw error;
  }
  const beforeBytes = Buffer.isBuffer(before) ? Buffer.from(before) : Buffer.from(before, "utf8");
  const afterBytes = Buffer.isBuffer(after) ? Buffer.from(after) : Buffer.from(after, "utf8");
  const beforeElement = sourceElementRange(beforeBytes, sourceId, "before");
  const afterElement = sourceElementRange(afterBytes, sourceId, "after");
  const outsideUnchanged = beforeBytes.subarray(0, beforeElement.contentByteRange.start)
    .equals(afterBytes.subarray(0, afterElement.contentByteRange.start))
    && beforeBytes.subarray(beforeElement.contentByteRange.end)
      .equals(afterBytes.subarray(afterElement.contentByteRange.end));
  const beforeElementBytes = beforeBytes.subarray(
    beforeElement.contentByteRange.start,
    beforeElement.contentByteRange.end,
  );
  const afterElementBytes = afterBytes.subarray(
    afterElement.contentByteRange.start,
    afterElement.contentByteRange.end,
  );
  const beforeElementText = beforeElementBytes.toString("utf8");
  const rawRelative = relativeChangedRange(beforeElementBytes, afterElementBytes);
  const checkedBefore = allowAttributeOrderOnly || allowSpanAttributeOrder ? attributeOrderOnly(beforeElementBytes, allowSpanAttributeOrder) : beforeElementBytes;
  const checkedAfter = allowAttributeOrderOnly || allowSpanAttributeOrder ? attributeOrderOnly(afterElementBytes, allowSpanAttributeOrder) : afterElementBytes;
  let relative = relativeChangedRange(checkedBefore, checkedAfter);
  if (relative.before.start === relative.before.end) {
    // Shared delimiter bytes can rotate a minimal insertion: inserting <br>
    // before </span> otherwise looks like "br>...<". Align only to a unique
    // declared insertion whose removal restores every baseline byte.
    const text = checkedAfter.toString("utf8");
    const pattern = new RegExp(expectedAppendedPattern.source,
      expectedAppendedPattern.flags.replace(/[gy]/gu, "") + "g");
    const candidates = [];
    for (const match of text.matchAll(pattern)) {
      if (!match[0].length) continue;
      const start = Buffer.byteLength(text.slice(0, match.index));
      const end = start + Buffer.byteLength(match[0]);
      if (Buffer.concat([checkedAfter.subarray(0, start), checkedAfter.subarray(end)]).equals(checkedBefore))
        candidates.push({ before: { start, end: start }, after: { start, end } });
    }
    if (candidates.length === 1) relative = candidates[0];
  }
  const appendedBytes = checkedAfter.subarray(relative.after.start, relative.after.end);
  const appendedText = appendedBytes.toString("utf8");
  const appendedStableIds = [...appendedText.matchAll(
    /data-pageroot-id="(pr1_[0-9a-f]{32})"/gu,
  )].map((match) => match[1]);
  const resolvedFreshStableIdCount = Number.isInteger(expectedFreshStableIdCount)
    && expectedFreshStableIdCount >= 0 ? expectedFreshStableIdCount : [
    SOURCE_SCOPE_POLICIES.TEXT_NEWLINE,
    SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
  ].includes(normalizationPolicy) ? 1 : 0;
  const freshStableIdsValid = appendedStableIds.length === resolvedFreshStableIdCount
    && new Set(appendedStableIds).size === appendedStableIds.length
    && appendedStableIds.every((id) => !beforeElement.sourceIndex.byPagerootId.has(id));
  const sourceIdentityValid = beforeElement.sourceIndex.pagerootIdentity?.valid === true
    && afterElement.sourceIndex.pagerootIdentity?.valid === true;
  expectedAppendedPattern.lastIndex = 0;
  const appendedMatch = expectedAppendedPattern.exec(appendedText);
  const appendedShapeValid = Boolean(
    appendedMatch
    && appendedMatch.index === 0
    && appendedMatch[0] === appendedText,
  );
  const preservedBeforeContent = relative.before.start === relative.before.end;
  const unexpectedBefore = expectedBeforeExcludes.filter((value) => beforeElementText.includes(value));
  const missingExpected = expectedAfterContains.filter((value) => !appendedText.includes(value));
  const unexpectedPresent = expectedAfterExcludes.filter((value) => appendedText.includes(value));
  return {
    ok: outsideUnchanged
      && preservedBeforeContent
      && appendedShapeValid
      && sourceIdentityValid
      && freshStableIdsValid
      && unexpectedBefore.length === 0
      && missingExpected.length === 0
      && unexpectedPresent.length === 0,
    outsideUnchanged,
    preservedBeforeContent,
    appendedShapeValid,
    sourceIdentityValid,
    freshStableIdsValid,
    expectedFreshStableIdCount: resolvedFreshStableIdCount,
    appendedStableIds,
    identityIssueCodes: [
      ...(beforeElement.sourceIndex.pagerootIdentity?.issues || []),
      ...(afterElement.sourceIndex.pagerootIdentity?.issues || []),
    ].map((issue) => issue.code),
    expectedAppendedPattern: expectedAppendedPattern.source,
    normalizationPolicy,
    attributeOrderOnly: allowAttributeOrderOnly,
    spanAttributeOrder: allowSpanAttributeOrder,
    sourceId,
    unexpectedBefore,
    missingExpected,
    unexpectedPresent,
    appendedByteRange: {
      start: afterElement.contentByteRange.start + relative.after.start,
      end: afterElement.contentByteRange.start + relative.after.end,
    },
    changedRanges: {
      before: {
        start: beforeElement.contentByteRange.start + rawRelative.before.start,
        end: beforeElement.contentByteRange.start + rawRelative.before.end,
      },
      after: {
        start: afterElement.contentByteRange.start + rawRelative.after.start,
        end: afterElement.contentByteRange.start + rawRelative.after.end,
      },
    },
    elementRanges: {
      before: beforeElement.contentByteRange,
      after: afterElement.contentByteRange,
    },
  };
}

/**
 * Compare one stable authored element's exact source region across an edit.
 * The expected bytes are explicit slices from the accepted before/after
 * source, while the oracle enforces every byte outside the element unchanged.
 */
export function compareElementSourceDelta({
  before,
  after,
  sourceId,
  beforeRange,
  afterRange,
  expectedBefore,
  expectedAfter,
  domSelector = null,
  label = "authored-element",
  kind = "replace",
} = {}) {
  const beforeBytes = Buffer.isBuffer(before) ? Buffer.from(before) : Buffer.from(before, "utf8");
  const afterBytes = Buffer.isBuffer(after) ? Buffer.from(after) : Buffer.from(after, "utf8");
  const beforeElement = sourceElementRange(beforeBytes, sourceId, "before");
  const afterElement = sourceElementRange(afterBytes, sourceId, "after");
  const explicitBeforeRange = requiredRange(beforeRange, "beforeRange");
  const explicitAfterRange = requiredRange(afterRange, "afterRange");
  if (!inside(explicitBeforeRange, beforeElement.byteRange)) {
    const error = new Error(`${label} beforeRange is outside the identified source element.`);
    error.code = "SOURCE_SCOPE_RANGE_OUTSIDE_TARGET";
    throw error;
  }
  if (!inside(explicitAfterRange, afterElement.byteRange)) {
    const error = new Error(`${label} afterRange is outside the identified source element.`);
    error.code = "SOURCE_SCOPE_RANGE_OUTSIDE_TARGET";
    throw error;
  }
  const expectedBeforeBytes = requiredExpected(expectedBefore, "expectedBefore");
  const expectedAfterBytes = requiredExpected(expectedAfter, "expectedAfter");
  const region = {
    label,
    kind,
    before: explicitBeforeRange,
    after: explicitAfterRange,
    expectedBefore: expectedBeforeBytes,
    expectedAfter: expectedAfterBytes,
    sourceRange: {
      id: sourceId,
      start: explicitBeforeRange.start,
      end: explicitBeforeRange.end,
      elementByteRange: beforeElement.byteRange,
    },
    domRange: {
      id: sourceId,
      selector: domSelector || `[data-pageroot-id="${sourceId}"]`,
      start: 0,
      end: 1,
    },
  };
  return compareSourceByteRegions({
    before: beforeBytes,
    after: afterBytes,
    allowedRegions: [region],
  });
}

/**
 * Verify one element-level style control. The only semantic source change may
 * be the independently declared CSS property/value on the frozen Stable ID.
 * All non-style attributes, element content, closing tag, sibling bytes and
 * document identity must remain unchanged.
 */
export function compareElementStyleMutation({
  before,
  after,
  sourceId,
  expectedProperty,
  expectedValue,
} = {}) {
  const property = String(expectedProperty || "").trim().toLowerCase();
  if (!property) {
    const error = new Error("expectedProperty is required for an element style oracle.");
    error.code = "SOURCE_SCOPE_STYLE_PROPERTY_REQUIRED";
    throw error;
  }
  if (expectedValue == null) {
    const error = new Error("expectedValue must be independently declared for an element style oracle.");
    error.code = "SOURCE_SCOPE_EXPECTATION_REQUIRED";
    throw error;
  }
  const expected = String(expectedValue);
  const beforeBytes = Buffer.isBuffer(before) ? Buffer.from(before) : Buffer.from(before, "utf8");
  const afterBytes = Buffer.isBuffer(after) ? Buffer.from(after) : Buffer.from(after, "utf8");
  const beforeElement = sourceElementRange(beforeBytes, sourceId, "before");
  const afterElement = sourceElementRange(afterBytes, sourceId, "after");
  const beforeNode = beforeElement.sourceIndex.byPagerootId.get(sourceId);
  const afterNode = afterElement.sourceIndex.byPagerootId.get(sourceId);
  const beforeStyle = styleDeclarationMap(beforeNode);
  const afterStyle = styleDeclarationMap(afterNode);
  const allProperties = new Set([
    ...beforeStyle.declarations.keys(),
    ...afterStyle.declarations.keys(),
  ]);
  const changedProperties = [...allProperties]
    .filter((name) => declarationChanged(
      beforeStyle.declarations.get(name),
      afterStyle.declarations.get(name),
    ))
    .sort();
  const expectedDeclaration = afterStyle.declarations.get(property) || null;
  const expectedPropertyChanged = changedProperties.length === 1
    && changedProperties[0] === property;
  const expectedValueApplied = expectedDeclaration?.value === expected;
  const beforeNonStyleAttributes = beforeNode.attributes
    .filter((attribute) => attribute.name !== "style")
    .map((attribute) => attribute.raw);
  const afterNonStyleAttributes = afterNode.attributes
    .filter((attribute) => attribute.name !== "style")
    .map((attribute) => attribute.raw);
  const nonStyleAttributesUnchanged = JSON.stringify(beforeNonStyleAttributes)
    === JSON.stringify(afterNonStyleAttributes);
  const elementContentAndClosingUnchanged = beforeElement.sourceIndex.source.slice(
    beforeNode.startTagRange.endOffset,
    beforeNode.range.endOffset,
  ) === afterElement.sourceIndex.source.slice(
    afterNode.startTagRange.endOffset,
    afterNode.range.endOffset,
  );
  const outsideElementUnchanged = beforeBytes.subarray(0, beforeElement.byteRange.start)
    .equals(afterBytes.subarray(0, afterElement.byteRange.start))
    && beforeBytes.subarray(beforeElement.byteRange.end)
      .equals(afterBytes.subarray(afterElement.byteRange.end));
  const sourceIdentityValid = beforeElement.sourceIndex.pagerootIdentity?.valid === true
    && afterElement.sourceIndex.pagerootIdentity?.valid === true;
  const styleSyntaxValid = !beforeStyle.duplicateStyleAttributes
    && !afterStyle.duplicateStyleAttributes
    && beforeStyle.syntaxComplete
    && afterStyle.syntaxComplete
    && beforeStyle.duplicateProperties.length === 0
    && afterStyle.duplicateProperties.length === 0;
  const tagNameUnchanged = beforeNode.tagName === afterNode.tagName;
  const relative = relativeChangedRange(beforeBytes, afterBytes);
  return {
    ok: outsideElementUnchanged
      && tagNameUnchanged
      && nonStyleAttributesUnchanged
      && elementContentAndClosingUnchanged
      && sourceIdentityValid
      && styleSyntaxValid
      && expectedPropertyChanged
      && expectedValueApplied,
    sourceId,
    expectedProperty: property,
    expectedValue: expected,
    observedBefore: beforeStyle.declarations.get(property) || null,
    observedAfter: expectedDeclaration,
    changedProperties,
    expectedPropertyChanged,
    expectedValueApplied,
    outsideElementUnchanged,
    tagNameUnchanged,
    nonStyleAttributesUnchanged,
    elementContentAndClosingUnchanged,
    sourceIdentityValid,
    styleSyntaxValid,
    duplicateStyleAttributes: {
      before: beforeStyle.duplicateStyleAttributes,
      after: afterStyle.duplicateStyleAttributes,
    },
    duplicateProperties: {
      before: beforeStyle.duplicateProperties,
      after: afterStyle.duplicateProperties,
    },
    syntaxComplete: {
      before: beforeStyle.syntaxComplete,
      after: afterStyle.syntaxComplete,
    },
    unparsedStyleRanges: {
      before: beforeStyle.unparsedRanges,
      after: afterStyle.unparsedRanges,
    },
    identityIssueCodes: [
      ...(beforeElement.sourceIndex.pagerootIdentity?.issues || []),
      ...(afterElement.sourceIndex.pagerootIdentity?.issues || []),
    ].map((issue) => issue.code),
    changedRanges: relative,
    elementRanges: {
      before: beforeElement.byteRange,
      after: afterElement.byteRange,
    },
  };
}
