// Independent UTF-8 byte oracle for real-HTML acceptance.
//
// The production SourcePatch engine is intentionally not imported here.  A
// caller declares the source ranges that an operation is allowed to change,
// then this module compares the accepted working baseline and the resulting
// bytes directly.  Gaps between declarations must remain byte-for-byte equal;
// offsets are allowed to shift only inside a declared before/after pair.

import { createHash } from "node:crypto";

export const SOURCE_BYTE_ORACLE_SCHEMA_VERSION = 1;
export const DEFAULT_SNIPPET_BYTES = 48;

export const SOURCE_BYTE_ORACLE_REASON_CODES = Object.freeze({
  INVALID_REGION: "INVALID_REGION",
  REGION_ORDER_INVALID: "REGION_ORDER_INVALID",
  REGION_OVERLAP: "REGION_OVERLAP",
  REGION_OUT_OF_BOUNDS: "REGION_OUT_OF_BOUNDS",
  REGION_RANGE_INVALID: "REGION_RANGE_INVALID",
  REGION_EXPECTED_BEFORE_MISMATCH: "REGION_EXPECTED_BEFORE_MISMATCH",
  REGION_EXPECTED_AFTER_MISMATCH: "REGION_EXPECTED_AFTER_MISMATCH",
  REGION_EXPECTATION_REQUIRED: "REGION_EXPECTATION_REQUIRED",
  REGION_IDENTITY_REQUIRED: "REGION_IDENTITY_REQUIRED",
  REGION_NORMALIZATION_POLICY_INVALID: "REGION_NORMALIZATION_POLICY_INVALID",
  OUTSIDE_RANGE_CHANGED: "OUTSIDE_RANGE_CHANGED",
  OUTSIDE_RANGE_LENGTH_MISMATCH: "OUTSIDE_RANGE_LENGTH_MISMATCH",
  IDENTITY_BASELINE_MISMATCH: "IDENTITY_BASELINE_MISMATCH",
  CODE_UNIT_SURROGATE_BOUNDARY: "CODE_UNIT_SURROGATE_BOUNDARY",
});

export class SourceByteRegionOracleError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SourceByteRegionOracleError";
    this.code = details.code || SOURCE_BYTE_ORACLE_REASON_CODES.INVALID_REGION;
    this.details = details;
  }
}

export class SourceByteRegionOracleAssertionError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "SourceByteRegionOracleAssertionError";
    this.code = "SOURCE_BYTE_ORACLE_FAILED";
    this.report = report;
  }
}

function fail(code, message, details = {}) {
  throw new SourceByteRegionOracleError(message, { ...details, code });
}

function bytes(value, label) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail("SOURCE_BYTES_INVALID", `${label} must be a UTF-8 string, Buffer or Uint8Array.`, {
    label,
    valueType: typeof value,
  });
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function asRange(value, label, byteLength) {
  if (!value || typeof value !== "object") {
    fail(SOURCE_BYTE_ORACLE_REASON_CODES.REGION_RANGE_INVALID, `${label} must be a range object.`, {
      label,
    });
  }
  const start = value.start ?? value.startOffset ?? value.startByte;
  const end = value.end ?? value.endOffset ?? value.endByte;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    fail(SOURCE_BYTE_ORACLE_REASON_CODES.REGION_RANGE_INVALID, `${label} must have integer start/end offsets.`, {
      label,
      value,
    });
  }
  if (end > byteLength) {
    fail(SOURCE_BYTE_ORACLE_REASON_CODES.REGION_OUT_OF_BOUNDS, `${label} exceeds its source byte length.`, {
      label,
      range: { start, end },
      byteLength,
    });
  }
  return { start, end };
}

function rangeSource(region, side) {
  return region[side] || region[`${side}Range`];
}

function regionLabel(region, index) {
  return typeof region?.label === "string" && region.label.trim()
    ? region.label
    : `region-${index + 1}`;
}

function optionalBytes(value, label) {
  return value == null ? null : bytes(value, label);
}

function optionalLabel(region, key, nestedKey) {
  if (typeof region?.[key] === "string") return region[key];
  const nested = region?.[nestedKey];
  if (nested && typeof nested === "object" && typeof nested.label === "string") {
    return nested.label;
  }
  return null;
}

const RANGE_IDENTITY_FIELDS = Object.freeze([
  "id",
  "identity",
  "nodeId",
  "sourceId",
  "domId",
  "selector",
  "path",
  "label",
  "name",
]);

function hasRangeIdentity(value) {
  return RANGE_IDENTITY_FIELDS.some((field) => (
    typeof value?.[field] === "string" && value[field].trim() !== ""
  ));
}

function normalizeIdentityRange(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasRangeIdentity(value)) {
    fail(
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_IDENTITY_REQUIRED,
      `${label} must include source/DOM range identity metadata.`,
      { label },
    );
  }
  return { ...value };
}

function validateOrderedRanges(regions, side, byteLength) {
  let previous = null;
  for (const region of regions) {
    const current = region[side];
    if (previous) {
      if (current.start < previous.start) {
        fail(
          SOURCE_BYTE_ORACLE_REASON_CODES.REGION_ORDER_INVALID,
          `${side} allowed regions must be ordered by start offset.`,
          { side, previous, current },
        );
      }
      if (current.start < previous.end || (
        current.start === previous.start
        && current.end === current.start
        && previous.end === previous.start
      )) {
        fail(
          SOURCE_BYTE_ORACLE_REASON_CODES.REGION_OVERLAP,
          `${side} allowed regions must not overlap.`,
          { side, previous, current },
        );
      }
    }
    if (current.start < 0 || current.end > byteLength || current.end < current.start) {
      fail(
        SOURCE_BYTE_ORACLE_REASON_CODES.REGION_OUT_OF_BOUNDS,
        `${side} allowed region is outside source bytes.`,
        { side, current, byteLength },
      );
    }
    previous = current;
  }
}

function publicRange(range) {
  return { start: range.start, end: range.end, length: range.end - range.start };
}

function utf8Preview(value) {
  return value.toString("utf8").replace(/[\u0000-\u001f\u007f]/gu, (character) => {
    const code = character.codePointAt(0).toString(16).padStart(2, "0");
    return `\\x${code}`;
  });
}

function snippet(value, offset, limit = DEFAULT_SNIPPET_BYTES, absoluteBase = 0) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_SNIPPET_BYTES;
  const start = Math.max(0, Math.min(offset, value.length));
  const end = Math.min(value.length, start + safeLimit);
  const content = value.subarray(start, end);
  return {
    offset: absoluteBase + start,
    length: content.length,
    hex: content.toString("hex"),
    text: utf8Preview(content),
  };
}

function firstDifferingByte(before, after, beforeStart, afterStart) {
  const commonLength = Math.min(before.length, after.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (before[index] !== after[index]) {
      return {
        beforeOffset: beforeStart + index,
        afterOffset: afterStart + index,
        beforeByte: before[index],
        afterByte: after[index],
      };
    }
  }
  if (before.length !== after.length) {
    return {
      beforeOffset: beforeStart + commonLength,
      afterOffset: afterStart + commonLength,
      beforeByte: before[commonLength] ?? null,
      afterByte: after[commonLength] ?? null,
    };
  }
  return null;
}

function equalBytes(left, right) {
  return left.length === right.length && left.equals(right);
}

function changedRuns(before, after) {
  const runs = [];
  let start = null;
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const changed = before[index] !== after[index];
    if (changed && start == null) start = index;
    if (!changed && start != null) {
      runs.push({ start, end: index });
      start = null;
    }
  }
  if (start != null) runs.push({ start, end: length });
  return runs;
}

function changeEvidence({
  scope,
  reasonCode,
  label,
  sourceLabel,
  domLabel,
  sourceRange = null,
  domRange = null,
  kind,
  beforeRange,
  afterRange,
  beforeBytes,
  afterBytes,
  snippetBytes,
}) {
  const first = firstDifferingByte(
    beforeBytes,
    afterBytes,
    beforeRange.start,
    afterRange.start,
  );
  const beforeOffset = first?.beforeOffset ?? beforeRange.start;
  const afterOffset = first?.afterOffset ?? afterRange.start;
  return {
    scope,
    reasonCode,
    label,
    sourceLabel: sourceLabel || label,
    domLabel: domLabel || null,
    sourceRange,
    domRange,
    kind: kind || "replace",
    beforeRange: publicRange(beforeRange),
    afterRange: publicRange(afterRange),
    firstDifferingByte: first,
    beforeSnippet: snippet(
      beforeBytes,
      Math.max(0, beforeOffset - beforeRange.start - Math.floor(snippetBytes / 4)),
      snippetBytes,
      beforeRange.start,
    ),
    afterSnippet: snippet(
      afterBytes,
      Math.max(0, afterOffset - afterRange.start - Math.floor(snippetBytes / 4)),
      snippetBytes,
      afterRange.start,
    ),
  };
}

function normalizeRegion(region, index, beforeLength, afterLength) {
  if (!region || typeof region !== "object") {
    fail(SOURCE_BYTE_ORACLE_REASON_CODES.INVALID_REGION, "Each allowed region must be an object.", { index });
  }
  const label = regionLabel(region, index);
  const beforeRange = asRange(rangeSource(region, "before"), `${label}.before`, beforeLength);
  const afterRange = asRange(rangeSource(region, "after"), `${label}.after`, afterLength);
  const sourceRange = normalizeIdentityRange(region.sourceRange, `${label}.sourceRange`);
  const domRange = normalizeIdentityRange(region.domRange, `${label}.domRange`);
  const expectedBeforeDeclared = Object.hasOwn(region, "expectedBefore")
    || Object.hasOwn(region, "beforeBytes");
  const expectedAfterDeclared = Object.hasOwn(region, "expectedAfter")
    || Object.hasOwn(region, "afterBytes");
  const expectedBeforeValue = Object.hasOwn(region, "expectedBefore")
    ? region.expectedBefore
    : region.beforeBytes;
  const expectedAfterValue = Object.hasOwn(region, "expectedAfter")
    ? region.expectedAfter
    : region.afterBytes;
  const expectedBeforePresent = expectedBeforeDeclared
    && expectedBeforeValue !== null
    && expectedBeforeValue !== undefined;
  const expectedAfterPresent = expectedAfterDeclared
    && expectedAfterValue !== null
    && expectedAfterValue !== undefined;
  if (
    (expectedBeforeDeclared || expectedAfterDeclared)
    && !(expectedBeforePresent && expectedAfterPresent)
  ) {
    fail(
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTATION_REQUIRED,
      `${label} must declare both expectedBefore and expectedAfter bytes together.`,
      { label },
    );
  }
  if (!(expectedBeforePresent && expectedAfterPresent)) {
    fail(
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTATION_REQUIRED,
      `${label} must declare exact expectedBefore and expectedAfter bytes.`,
      { label },
    );
  }
  // The oracle intentionally has no open-ended normalization hook.  A
  // caller computes any required normalization before invoking this module
  // and declares the resulting exact bytes instead.
  if (region.normalizationPolicy != null) {
    fail(
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_NORMALIZATION_POLICY_INVALID,
      `${label}.normalizationPolicy is unsupported; declare exact expected bytes.`,
      { label },
    );
  }
  return {
    index,
    label,
    kind: typeof region.kind === "string" ? region.kind : "replace",
    sourceLabel: optionalLabel(region, "sourceLabel", "sourceRange"),
    domLabel: optionalLabel(region, "domLabel", "domRange"),
    sourceRange,
    domRange,
    before: beforeRange,
    after: afterRange,
    expectedBefore: optionalBytes(
      expectedBeforePresent ? expectedBeforeValue : null,
      `${label}.expectedBefore`,
    ),
    expectedAfter: optionalBytes(
      expectedAfterPresent ? expectedAfterValue : null,
      `${label}.expectedAfter`,
    ),
  };
}

/**
 * Validate and normalize a list of paired before/after byte ranges.  The
 * supplied order is checked rather than sorted so a caller cannot hide a
 * malformed declaration by relying on the oracle to repair it.
 */
export function validateSourceByteRegions(regions, {
  beforeByteLength,
  afterByteLength,
  beforeLength,
  afterLength,
} = {}) {
  if (!Array.isArray(regions)) {
    fail(SOURCE_BYTE_ORACLE_REASON_CODES.INVALID_REGION, "allowedRegions must be an array.");
  }
  const resolvedBeforeLength = beforeByteLength ?? beforeLength;
  const resolvedAfterLength = afterByteLength ?? afterLength;
  if (!Number.isInteger(resolvedBeforeLength) || resolvedBeforeLength < 0) {
    fail("SOURCE_LENGTH_INVALID", "beforeByteLength must be a non-negative integer.");
  }
  if (!Number.isInteger(resolvedAfterLength) || resolvedAfterLength < 0) {
    fail("SOURCE_LENGTH_INVALID", "afterByteLength must be a non-negative integer.");
  }
  const normalized = regions.map((region, index) => normalizeRegion(
    region,
    index,
    resolvedBeforeLength,
    resolvedAfterLength,
  ));
  validateOrderedRanges(normalized, "before", resolvedBeforeLength);
  validateOrderedRanges(normalized, "after", resolvedAfterLength);
  for (const region of normalized) {
    if (region.expectedBefore && !Number.isInteger(region.expectedBefore.length)) {
      fail(SOURCE_BYTE_ORACLE_REASON_CODES.INVALID_REGION, `${region.label}.expectedBefore is invalid.`);
    }
    if (region.expectedAfter && !Number.isInteger(region.expectedAfter.length)) {
      fail(SOURCE_BYTE_ORACLE_REASON_CODES.INVALID_REGION, `${region.label}.expectedAfter is invalid.`);
    }
  }
  return normalized;
}

/** Return the UTF-8 byte offset for a JavaScript UTF-16 code-unit offset. */
export function utf8ByteOffset(source, codeUnitOffset) {
  const text = String(source);
  if (!Number.isInteger(codeUnitOffset) || codeUnitOffset < 0 || codeUnitOffset > text.length) {
    fail("CODE_UNIT_RANGE_INVALID", "codeUnitOffset must be within the source string.", {
      codeUnitOffset,
      codeUnitLength: text.length,
    });
  }
  if (
    codeUnitOffset > 0
    && codeUnitOffset < text.length
    && text.charCodeAt(codeUnitOffset - 1) >= 0xd800
    && text.charCodeAt(codeUnitOffset - 1) <= 0xdbff
    && text.charCodeAt(codeUnitOffset) >= 0xdc00
    && text.charCodeAt(codeUnitOffset) <= 0xdfff
  ) {
    fail(
      SOURCE_BYTE_ORACLE_REASON_CODES.CODE_UNIT_SURROGATE_BOUNDARY,
      "codeUnitOffset must not split a UTF-16 surrogate pair.",
      { codeUnitOffset, codeUnitLength: text.length },
    );
  }
  return Buffer.byteLength(text.slice(0, codeUnitOffset), "utf8");
}

/** Convert a source-index UTF-16 range to an explicit UTF-8 byte range. */
export function utf8ByteRange(source, codeUnitRange) {
  const text = String(source);
  const normalized = asRange(codeUnitRange, "codeUnitRange", text.length);
  return {
    start: utf8ByteOffset(text, normalized.start),
    end: utf8ByteOffset(text, normalized.end),
  };
}

/** Build an explicit record for the identity-materialization baseline. */
export function createIdentityMaterializationBaseline(original, acceptedWorkingBaseline, metadata = {}) {
  const originalBytes = bytes(original, "identityMaterializationBaseline.original");
  const baselineBytes = bytes(acceptedWorkingBaseline, "identityMaterializationBaseline.acceptedWorkingBaseline");
  return {
    excludedFromEditDelta: true,
    originalSha256: digest(originalBytes),
    acceptedWorkingBaselineSha256: digest(baselineBytes),
    originalByteLength: originalBytes.length,
    acceptedWorkingBaselineByteLength: baselineBytes.length,
    acceptedWorkingBaseline: baselineBytes,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...metadata }
      : {},
  };
}

function baselineReport(identityMaterializationBaseline, beforeBytes) {
  if (!identityMaterializationBaseline) return null;
  const baselineBytes = identityMaterializationBaseline.acceptedWorkingBaseline
    ?? identityMaterializationBaseline.working
    ?? identityMaterializationBaseline.after;
  const matches = baselineBytes == null
    ? true
    : equalBytes(bytes(baselineBytes, "identityMaterializationBaseline.acceptedWorkingBaseline"), beforeBytes);
  return {
    excludedFromEditDelta: true,
    baselineMatchesBefore: matches,
    originalSha256: identityMaterializationBaseline.originalSha256 ?? null,
    acceptedWorkingBaselineSha256: identityMaterializationBaseline.acceptedWorkingBaselineSha256
      ?? (baselineBytes == null ? null : digest(bytes(baselineBytes, "identityMaterializationBaseline.acceptedWorkingBaseline"))),
    originalByteLength: identityMaterializationBaseline.originalByteLength ?? null,
    acceptedWorkingBaselineByteLength: identityMaterializationBaseline.acceptedWorkingBaselineByteLength
      ?? (baselineBytes == null ? null : bytes(baselineBytes, "identityMaterializationBaseline.acceptedWorkingBaseline").length),
    metadata: identityMaterializationBaseline.metadata && typeof identityMaterializationBaseline.metadata === "object"
      ? { ...identityMaterializationBaseline.metadata }
      : {},
  };
}

function publicRegion(region) {
  return {
    label: region.label,
    kind: region.kind,
    sourceLabel: region.sourceLabel || region.label,
    domLabel: region.domLabel,
    sourceRange: region.sourceRange,
    domRange: region.domRange,
    beforeRange: publicRange(region.before),
    afterRange: publicRange(region.after),
    expectedBeforeLength: region.expectedBefore?.length ?? null,
    expectedAfterLength: region.expectedAfter?.length ?? null,
  };
}

function compareGap({
  beforeBytes,
  afterBytes,
  beforeRange,
  afterRange,
  label,
  snippetBytes,
}) {
  const beforeSlice = beforeBytes.subarray(beforeRange.start, beforeRange.end);
  const afterSlice = afterBytes.subarray(afterRange.start, afterRange.end);
  if (beforeSlice.length !== afterSlice.length) {
    return [changeEvidence({
      scope: "outside",
      reasonCode: SOURCE_BYTE_ORACLE_REASON_CODES.OUTSIDE_RANGE_LENGTH_MISMATCH,
      label,
      sourceLabel: label,
      domLabel: null,
      sourceRange: null,
      domRange: null,
      kind: "outside",
      beforeRange,
      afterRange,
      beforeBytes: beforeSlice,
      afterBytes: afterSlice,
      snippetBytes,
    })];
  }
  return changedRuns(beforeSlice, afterSlice).map((run) => changeEvidence({
    scope: "outside",
    reasonCode: SOURCE_BYTE_ORACLE_REASON_CODES.OUTSIDE_RANGE_CHANGED,
    label,
    sourceLabel: label,
    domLabel: null,
    kind: "outside",
    beforeRange: {
      start: beforeRange.start + run.start,
      end: beforeRange.start + run.end,
    },
    afterRange: {
      start: afterRange.start + run.start,
      end: afterRange.start + run.end,
    },
    beforeBytes: beforeSlice.subarray(run.start, run.end),
    afterBytes: afterSlice.subarray(run.start, run.end),
    snippetBytes,
  }));
}

/**
 * Compare two accepted working-copy byte buffers against declared paired
 * regions.  Region contents may be normalized/replaced/inserted/deleted;
 * every byte outside those regions must remain exact.
 */
export function compareSourceByteRegions({
  before: beforeInput,
  after: afterInput,
  beforeBytes: beforeBytesInput,
  afterBytes: afterBytesInput,
  allowedRegions = [],
  regions = null,
  identityMaterializationBaseline = null,
  identityBaseline = null,
  snippetBytes = DEFAULT_SNIPPET_BYTES,
} = {}) {
  const beforeBytes = bytes(beforeInput ?? beforeBytesInput, "before");
  const afterBytes = bytes(afterInput ?? afterBytesInput, "after");
  const normalizedRegions = validateSourceByteRegions(regions ?? allowedRegions, {
    beforeByteLength: beforeBytes.length,
    afterByteLength: afterBytes.length,
  });
  const baseline = baselineReport(
    identityMaterializationBaseline || identityBaseline,
    beforeBytes,
  );
  const errors = [];
  // The identity materialization transition is a separate accepted baseline,
  // not an edit-region delta.  A later sequential edit may legitimately start
  // from a newer working baseline, so baselineMatchesBefore is diagnostic and
  // never changes the byte-delta verdict.
  const changes = [];
  let beforeCursor = 0;
  let afterCursor = 0;
  for (const region of normalizedRegions) {
    changes.push(...compareGap({
      beforeBytes,
      afterBytes,
      beforeRange: { start: beforeCursor, end: region.before.start },
      afterRange: { start: afterCursor, end: region.after.start },
      label: `outside:${region.label}`,
      snippetBytes,
    }));
    const beforeRegionBytes = beforeBytes.subarray(region.before.start, region.before.end);
    const afterRegionBytes = afterBytes.subarray(region.after.start, region.after.end);
    if (region.expectedBefore && !equalBytes(beforeRegionBytes, region.expectedBefore)) {
      errors.push({
        code: SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_BEFORE_MISMATCH,
        label: region.label,
        message: `Declared before bytes do not match ${region.label}.`,
        evidence: changeEvidence({
          scope: "allowed",
          reasonCode: SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_BEFORE_MISMATCH,
          label: region.label,
          sourceLabel: region.sourceLabel,
          domLabel: region.domLabel,
          sourceRange: region.sourceRange,
          domRange: region.domRange,
          kind: region.kind,
          beforeRange: region.before,
          afterRange: region.after,
          beforeBytes: region.expectedBefore,
          afterBytes: beforeRegionBytes,
          snippetBytes,
        }),
      });
    }
    if (region.expectedAfter && !equalBytes(afterRegionBytes, region.expectedAfter)) {
      errors.push({
        code: SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_AFTER_MISMATCH,
        label: region.label,
        message: `Declared after bytes do not match ${region.label}.`,
        evidence: changeEvidence({
          scope: "allowed",
          reasonCode: SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_AFTER_MISMATCH,
          label: region.label,
          sourceLabel: region.sourceLabel,
          domLabel: region.domLabel,
          sourceRange: region.sourceRange,
          domRange: region.domRange,
          kind: region.kind,
          beforeRange: region.before,
          afterRange: region.after,
          beforeBytes: beforeRegionBytes,
          afterBytes: region.expectedAfter,
          snippetBytes,
        }),
      });
    }
    if (!equalBytes(beforeRegionBytes, afterRegionBytes)) {
      if (beforeRegionBytes.length === afterRegionBytes.length) {
        for (const run of changedRuns(beforeRegionBytes, afterRegionBytes)) {
          changes.push(changeEvidence({
            scope: "allowed",
            reasonCode: null,
            label: region.label,
            sourceLabel: region.sourceLabel,
            domLabel: region.domLabel,
            sourceRange: region.sourceRange,
            domRange: region.domRange,
            kind: region.kind,
            beforeRange: {
              start: region.before.start + run.start,
              end: region.before.start + run.end,
            },
            afterRange: {
              start: region.after.start + run.start,
              end: region.after.start + run.end,
            },
            beforeBytes: beforeRegionBytes.subarray(run.start, run.end),
            afterBytes: afterRegionBytes.subarray(run.start, run.end),
            snippetBytes,
          }));
        }
      } else {
        changes.push(changeEvidence({
          scope: "allowed",
          reasonCode: null,
          label: region.label,
          sourceLabel: region.sourceLabel,
          domLabel: region.domLabel,
          sourceRange: region.sourceRange,
          domRange: region.domRange,
          kind: region.kind,
          beforeRange: region.before,
          afterRange: region.after,
          beforeBytes: beforeRegionBytes,
          afterBytes: afterRegionBytes,
          snippetBytes,
        }));
      }
    }
    beforeCursor = region.before.end;
    afterCursor = region.after.end;
  }
  changes.push(...compareGap({
    beforeBytes,
    afterBytes,
    beforeRange: { start: beforeCursor, end: beforeBytes.length },
    afterRange: { start: afterCursor, end: afterBytes.length },
    label: "outside:tail",
    snippetBytes,
  }));
  const outsideChanges = changes.filter((change) => change.scope === "outside");
  const expectedErrors = errors;
  return {
    schemaVersion: SOURCE_BYTE_ORACLE_SCHEMA_VERSION,
    ok: errors.length === 0 && outsideChanges.length === 0,
    outsideUnchanged: outsideChanges.length === 0,
    before: { byteLength: beforeBytes.length, sha256: digest(beforeBytes) },
    after: { byteLength: afterBytes.length, sha256: digest(afterBytes) },
    allowedRegions: normalizedRegions.map(publicRegion),
    changedRanges: changes,
    errors,
    identityMaterializationBaseline: baseline,
    changedRegionCount: changes.filter((change) => change.scope === "allowed").length,
    outsideChangedRangeCount: outsideChanges.length,
    declaredRegionCount: normalizedRegions.length,
    expectedRegionCount: normalizedRegions.length,
    expectedRegionErrors: expectedErrors.length,
  };
}

/** Throw only for a content mismatch; invalid declarations already throw from the strict oracle. */
export function assertSourceByteRegions(options) {
  const report = compareSourceByteRegions(options);
  if (!report.ok) {
    throw new SourceByteRegionOracleAssertionError(
      `Source byte oracle failed with ${report.changedRanges.length} changed range(s).`,
      report,
    );
  }
  return report;
}

/** Non-throwing adapter useful for reporting an invalid declaration as a test failure row. */
export function safeCompareSourceByteRegions(options) {
  try {
    return compareSourceByteRegions(options);
  } catch (error) {
    if (!(error instanceof SourceByteRegionOracleError)) throw error;
    return {
      schemaVersion: SOURCE_BYTE_ORACLE_SCHEMA_VERSION,
      ok: false,
      outsideUnchanged: false,
      allowedRegions: [],
      changedRanges: [],
      errors: [{
        code: error.code,
        message: error.message,
        details: error.details,
      }],
      error: {
        name: error.name,
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }
}

export const compareSourceBytes = compareSourceByteRegions;
export const assertSourceByteRegionOracle = assertSourceByteRegions;
