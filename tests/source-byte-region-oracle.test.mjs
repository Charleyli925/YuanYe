import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SNIPPET_BYTES,
  SOURCE_BYTE_ORACLE_REASON_CODES,
  SourceByteRegionOracleError,
  assertSourceByteRegions,
  compareSourceByteRegions,
  createIdentityMaterializationBaseline,
  safeCompareSourceByteRegions,
  utf8ByteOffset,
  utf8ByteRange,
  validateSourceByteRegions,
} from "./helpers/source-byte-region-oracle.mjs";

function replaceBytes(source, needle, replacement, occurrence = 0) {
  const input = Buffer.from(source);
  const target = Buffer.from(needle);
  let start = -1;
  let cursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = input.indexOf(target, cursor);
    assert.notEqual(start, -1, `missing occurrence ${occurrence} of ${needle}`);
    cursor = start + target.length;
  }
  return Buffer.concat([
    input.subarray(0, start),
    Buffer.from(replacement),
    input.subarray(start + target.length),
  ]);
}

function regionForReplacement(
  before,
  after,
  needle,
  replacement,
  occurrence = 0,
  label = needle,
  afterOccurrence = occurrence,
) {
  const beforeBytes = Buffer.from(before);
  const afterBytes = Buffer.from(after);
  const beforeNeedle = Buffer.from(needle);
  const afterNeedle = Buffer.from(replacement);
  let beforeStart = -1;
  let afterStart = -1;
  let beforeCursor = 0;
  let afterCursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    beforeStart = beforeBytes.indexOf(beforeNeedle, beforeCursor);
    assert.notEqual(beforeStart, -1, `missing before occurrence ${occurrence} of ${needle}`);
    beforeCursor = beforeStart + beforeNeedle.length;
    if (index <= afterOccurrence) {
      afterStart = afterBytes.indexOf(afterNeedle, afterCursor);
      assert.notEqual(afterStart, -1, `missing after occurrence ${afterOccurrence} of ${replacement}`);
      afterCursor = afterStart + afterNeedle.length;
    }
  }
  return {
    label,
    before: { start: beforeStart, end: beforeStart + beforeNeedle.length },
    after: { start: afterStart, end: afterStart + afterNeedle.length },
    sourceRange: {
      selector: `source:${label}`,
      start: beforeStart,
      end: beforeStart + beforeNeedle.length,
      label: `source:${label}`,
    },
    domRange: {
      selector: `[data-test-region="${label}"]`,
      start: 0,
      end: 1,
      label: `dom:${label}`,
    },
    expectedBefore: beforeNeedle,
    expectedAfter: afterNeedle,
  };
}

test("UTF-8 offsets are byte offsets, including BOM, Chinese, emoji and combining marks", () => {
  const source = "\uFEFF中文🙂e\u0301";
  assert.equal(utf8ByteOffset(source, 0), 0);
  assert.equal(utf8ByteOffset(source, 1), 3);
  assert.equal(utf8ByteOffset(source, 3), 9);
  assert.deepEqual(utf8ByteRange(source, { start: 1, end: 5 }), { start: 3, end: 13 });
  assert.equal(Buffer.byteLength(source.slice(1, 5), "utf8"), 10);
});

test("UTF-16 ranges fail closed when an offset splits a surrogate pair", () => {
  const source = "A😀B";
  assert.equal(utf8ByteOffset(source, 0), 0);
  assert.equal(utf8ByteOffset(source, 1), 1);
  assert.equal(utf8ByteOffset(source, 3), 5);
  assert.equal(utf8ByteOffset(source, 4), 6);
  assert.throws(
    () => utf8ByteOffset(source, 2),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.CODE_UNIT_SURROGATE_BOUNDARY,
  );
  assert.throws(
    () => utf8ByteRange(source, { start: 2, end: 3 }),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.CODE_UNIT_SURROGATE_BOUNDARY,
  );
  assert.throws(
    () => utf8ByteRange(source, { start: 1, end: 2 }),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.CODE_UNIT_SURROGATE_BOUNDARY,
  );
});

test("allowed regions require exact expectations and source/DOM identity", () => {
  const before = Buffer.from("SAFE");
  const after = Buffer.from("EVIL");
  const ranges = {
    before: { start: 0, end: before.length },
    after: { start: 0, end: after.length },
    sourceRange: { id: "source-safe", start: 0, end: before.length },
    domRange: { id: "dom-safe", start: 0, end: 1 },
  };
  assert.throws(
    () => compareSourceByteRegions({ before, after, allowedRegions: [ranges] }),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTATION_REQUIRED,
  );
  assert.throws(
    () => compareSourceByteRegions({
      before,
      after,
      allowedRegions: [{
        ...ranges,
        expectedBefore: before,
        expectedAfter: after,
        normalizationPolicy: "anything",
      }],
    }),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.REGION_NORMALIZATION_POLICY_INVALID,
  );
  assert.throws(
    () => compareSourceByteRegions({
      before,
      after,
      allowedRegions: [{
        before: ranges.before,
        after: ranges.after,
        expectedBefore: before,
        expectedAfter: after,
      }],
    }),
    (error) => error instanceof SourceByteRegionOracleError
      && error.code === SOURCE_BYTE_ORACLE_REASON_CODES.REGION_IDENTITY_REQUIRED,
  );
});

test("one allowed replacement preserves exact UTF-8 bytes outside the region", () => {
  const before = Buffer.from("\uFEFF<!doctype html>\r\n<!-- token -->\r\n<p>中文🙂 e\u0301 &amp; token</p>\r\n<footer>untouched</footer>", "utf8");
  const after = replaceBytes(before, "中文🙂", "汉字🚀");
  const region = regionForReplacement(before, after, "中文🙂", "汉字🚀", 0, "paragraph-text");
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [{ ...region, kind: "normalize", sourceLabel: "p text", domLabel: "paragraph" }],
  });
  assert.equal(report.ok, true);
  assert.equal(report.outsideUnchanged, true);
  assert.ok(report.changedRegionCount >= 1);
  assert.equal(report.outsideChangedRangeCount, 0);
  assert.equal(report.changedRanges[0].label, "paragraph-text");
  assert.equal(report.changedRanges[0].sourceLabel, "p text");
  assert.equal(report.changedRanges[0].domLabel, "paragraph");
  assert.equal(report.changedRanges[0].firstDifferingByte.beforeOffset, region.before.start);
  assert.equal(report.changedRanges[0].firstDifferingByte.afterOffset, region.after.start);
  assert.ok(report.changedRanges[0].beforeSnippet.length <= DEFAULT_SNIPPET_BYTES);
  assert.ok(report.changedRanges[0].afterSnippet.length <= DEFAULT_SNIPPET_BYTES);
});

test("changed evidence retains the declared source and DOM ranges", () => {
  const before = Buffer.from("<p>old</p>", "utf8");
  const after = Buffer.from("<p>new</p>", "utf8");
  const beforeStart = before.indexOf("old");
  const afterStart = after.indexOf("new");
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [{
      label: "paragraph-text",
      sourceRange: { start: 3, end: 6, label: "source text" },
      domRange: { selector: "p", start: 0, end: 1, label: "paragraph" },
      before: { start: beforeStart, end: beforeStart + 3 },
      after: { start: afterStart, end: afterStart + 3 },
      expectedBefore: "old",
      expectedAfter: "new",
    }],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.changedRanges[0].sourceRange, {
    start: 3,
    end: 6,
    label: "source text",
  });
  assert.deepEqual(report.changedRanges[0].domRange, {
    selector: "p",
    start: 0,
    end: 1,
    label: "paragraph",
  });
});

test("CRLF, entities/comments and duplicate tokens are handled by explicit disjoint regions", () => {
  const before = Buffer.from(
    "\uFEFF<!-- dup -->\r\n<p>dup &amp; 中文</p>\r\n<section>middle</section>\r\n<p>dup</p>\r\n<footer>tail</footer>",
    "utf8",
  );
  const afterOne = replaceBytes(before, "dup", "first", 1);
  const after = replaceBytes(afterOne, "middle", "中间内容", 0);
  const firstRegion = regionForReplacement(before, after, "dup", "first", 1, "first-duplicate", 0);
  const middleBefore = Buffer.from("middle");
  const middleAfter = Buffer.from("中间内容");
  const middleBeforeStart = before.indexOf(middleBefore);
  const middleAfterStart = after.indexOf(middleAfter);
  const middleRegion = {
    label: "middle-section",
    before: { start: middleBeforeStart, end: middleBeforeStart + middleBefore.length },
    after: { start: middleAfterStart, end: middleAfterStart + middleAfter.length },
    sourceRange: { selector: "source:middle-section", start: middleBeforeStart, end: middleBeforeStart + middleBefore.length },
    domRange: { selector: "section", start: 0, end: 1, label: "middle-section" },
    expectedBefore: middleBefore,
    expectedAfter: middleAfter,
  };
  const report = assertSourceByteRegions({
    before,
    after,
    allowedRegions: [firstRegion, middleRegion],
    snippetBytes: 32,
  });
  assert.equal(report.ok, true);
  assert.equal(report.allowedRegions.length, 2);
  assert.equal(report.changedRanges.length, 2);
  assert.equal(report.changedRanges.every((change) => change.scope === "allowed"), true);
  // The duplicate token outside the declared region remains exact.
  assert.equal(report.outsideUnchanged, true);
});

test("insertions, deletions and offset shifts stay scoped to paired regions", () => {
  const before = Buffer.from("HEAD|alpha|MIDDLE|beta|TAIL", "utf8");
  const after = Buffer.from("HEAD|α|MIDDLE||TAIL|INSERTED", "utf8");
  const alphaBefore = Buffer.from("alpha");
  const alphaAfter = Buffer.from("α");
  const beta = Buffer.from("beta");
  const insert = Buffer.from("|INSERTED");
  const alphaBeforeStart = before.indexOf(alphaBefore);
  const alphaAfterStart = after.indexOf(alphaAfter);
  const betaBeforeStart = before.indexOf(beta);
  const betaAfterStart = after.indexOf("|TAIL");
  const insertAfterStart = after.length - insert.length;
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [
      {
        label: "alpha-normalization",
        kind: "normalize",
        before: { start: alphaBeforeStart, end: alphaBeforeStart + alphaBefore.length },
        after: { start: alphaAfterStart, end: alphaAfterStart + alphaAfter.length },
        sourceRange: { selector: "source:alpha", start: alphaBeforeStart, end: alphaBeforeStart + alphaBefore.length },
        domRange: { selector: "[data-test-region=alpha]", start: 0, end: 1 },
        expectedBefore: alphaBefore,
        expectedAfter: alphaAfter,
      },
      {
        label: "beta-delete",
        kind: "delete",
        before: { start: betaBeforeStart, end: betaBeforeStart + beta.length },
        after: { start: betaAfterStart, end: betaAfterStart },
        sourceRange: { selector: "source:beta", start: betaBeforeStart, end: betaBeforeStart + beta.length },
        domRange: { selector: "[data-test-region=beta]", start: 0, end: 1 },
        expectedBefore: beta,
        expectedAfter: Buffer.alloc(0),
      },
      {
        label: "tail-insert",
        kind: "insert",
        before: { start: before.length, end: before.length },
        after: { start: insertAfterStart, end: after.length },
        sourceRange: { selector: "source:tail", start: before.length, end: before.length },
        domRange: { selector: "[data-test-region=tail]", start: 0, end: 1 },
        expectedBefore: Buffer.alloc(0),
        expectedAfter: insert,
      },
    ],
  });
  assert.equal(report.ok, true);
  assert.equal(report.outsideUnchanged, true);
  assert.equal(report.changedRegionCount, 3);
  assert.equal(report.changedRanges.some((change) => change.label === "tail-insert"), true);
  assert.equal(report.allowedRegions.find((region) => region.label === "beta-delete").afterRange.length, 0);
});

test("invalid region order, overlap and bounds fail closed", () => {
  const before = Buffer.from("0123456789");
  const after = Buffer.from("0123456789");
  const assertRegionError = (allowedRegions, code) => {
    assert.throws(
      () => validateSourceByteRegions(allowedRegions, {
        beforeByteLength: before.length,
        afterByteLength: after.length,
      }),
      (error) => error instanceof SourceByteRegionOracleError && error.code === code,
    );
  };
  assertRegionError([
    {
      label: "later",
      before: { start: 7, end: 8 },
      after: { start: 7, end: 8 },
      sourceRange: { id: "later" },
      domRange: { id: "later" },
      expectedBefore: "7",
      expectedAfter: "7",
    },
    {
      label: "earlier",
      before: { start: 2, end: 3 },
      after: { start: 2, end: 3 },
      sourceRange: { id: "earlier" },
      domRange: { id: "earlier" },
      expectedBefore: "2",
      expectedAfter: "2",
    },
  ], SOURCE_BYTE_ORACLE_REASON_CODES.REGION_ORDER_INVALID);
  assertRegionError([
    {
      label: "one",
      before: { start: 2, end: 6 },
      after: { start: 2, end: 6 },
      sourceRange: { id: "one" },
      domRange: { id: "one" },
      expectedBefore: "2345",
      expectedAfter: "2345",
    },
    {
      label: "two",
      before: { start: 5, end: 7 },
      after: { start: 5, end: 7 },
      sourceRange: { id: "two" },
      domRange: { id: "two" },
      expectedBefore: "56",
      expectedAfter: "56",
    },
  ], SOURCE_BYTE_ORACLE_REASON_CODES.REGION_OVERLAP);
  assertRegionError([
    { label: "out", before: { start: 2, end: 11 }, after: { start: 2, end: 3 } },
  ], SOURCE_BYTE_ORACLE_REASON_CODES.REGION_OUT_OF_BOUNDS);
  const safe = safeCompareSourceByteRegions({
    before,
    after,
    allowedRegions: [{ before: { start: 8, end: 7 }, after: { start: 8, end: 7 } }],
  });
  assert.equal(safe.ok, false);
  assert.equal(safe.errors[0].code, SOURCE_BYTE_ORACLE_REASON_CODES.REGION_RANGE_INVALID);
});

test("outside corruption reports every changed range with first byte and bounded snippets", () => {
  const before = Buffer.from("prefix|change|middle|tail", "utf8");
  const after = Buffer.from("prefix|CHANGED|middle|ta!l", "utf8");
  const change = regionForReplacement(before, after, "change", "CHANGED", 0, "declared-change");
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [change],
  });
  assert.equal(report.ok, false);
  assert.equal(report.outsideUnchanged, false);
  assert.equal(report.outsideChangedRangeCount, 1);
  const outside = report.changedRanges.find((range) => range.scope === "outside");
  assert.equal(outside.label, "outside:tail");
  assert.equal(outside.firstDifferingByte.beforeByte, "i".charCodeAt(0));
  assert.equal(outside.firstDifferingByte.afterByte, "!".charCodeAt(0));
  assert.ok(outside.beforeSnippet.length <= DEFAULT_SNIPPET_BYTES);
  assert.ok(outside.afterSnippet.length <= DEFAULT_SNIPPET_BYTES);
  assert.throws(() => assertSourceByteRegions({ before, after, allowedRegions: [change] }), /Source byte oracle failed/iu);
});

test("one declared region reports multiple disjoint byte runs independently", () => {
  const before = Buffer.from("abcDEFghi");
  const after = Buffer.from("abXDEFYhi");
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [{
      label: "two-character-edits",
      before: { start: 0, end: before.length },
      after: { start: 0, end: after.length },
      sourceRange: { id: "whole-source", start: 0, end: before.length },
      domRange: { id: "whole-dom", start: 0, end: 1 },
      expectedBefore: before,
      expectedAfter: after,
    }],
  });
  assert.equal(report.ok, true);
  assert.equal(report.changedRanges.length, 2);
  assert.deepEqual(
    report.changedRanges.map((change) => change.firstDifferingByte.beforeOffset),
    [2, 6],
  );
});

test("identity materialization is an excluded baseline, then each edit rebases from its accepted bytes", () => {
  const original = Buffer.from("<p>中文</p>", "utf8");
  const acceptedBaseline = Buffer.from('<p data-pageroot-id="pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa">中文</p>', "utf8");
  const editOne = replaceBytes(acceptedBaseline, "中文", "中文🙂");
  const editOneRegion = regionForReplacement(acceptedBaseline, editOne, "中文", "中文🙂", 0, "text-one");
  const identity = createIdentityMaterializationBaseline(original, acceptedBaseline, { phase: "identity" });
  const first = assertSourceByteRegions({
    before: acceptedBaseline,
    after: editOne,
    allowedRegions: [editOneRegion],
    identityMaterializationBaseline: identity,
  });
  assert.equal(first.ok, true);
  assert.equal(first.identityMaterializationBaseline.excludedFromEditDelta, true);
  assert.equal(first.identityMaterializationBaseline.baselineMatchesBefore, true);
  assert.equal(first.changedRanges.length, 1);

  const editTwo = replaceBytes(editOne, "data-pageroot-id", "data-pageroot-key");
  const editTwoRegion = regionForReplacement(editOne, editTwo, "data-pageroot-id", "data-pageroot-key", 0, "attribute-two");
  const second = compareSourceByteRegions({
    before: editOne,
    after: editTwo,
    allowedRegions: [editTwoRegion],
    identityMaterializationBaseline: identity,
  });
  assert.equal(second.ok, true);
  assert.equal(second.identityMaterializationBaseline.baselineMatchesBefore, false);
  assert.deepEqual(second.errors, []);
  // The mismatch is a diagnostic only; the edit comparison itself still has
  // one declared change and no outside corruption.
  assert.equal(second.outsideUnchanged, true);
});

test("declared expected bytes are checked independently from observed bytes", () => {
  const before = Buffer.from("before");
  const after = Buffer.from("after");
  const report = compareSourceByteRegions({
    before,
    after,
    allowedRegions: [{
      label: "replacement",
      before: { start: 0, end: before.length },
      after: { start: 0, end: after.length },
      sourceRange: { id: "replacement-source", start: 0, end: before.length },
      domRange: { id: "replacement-dom", start: 0, end: 1 },
      expectedBefore: "wrong-before",
      expectedAfter: "wrong-after",
    }],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.errors.map((error) => error.code),
    [
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_BEFORE_MISMATCH,
      SOURCE_BYTE_ORACLE_REASON_CODES.REGION_EXPECTED_AFTER_MISMATCH,
    ],
  );
  assert.equal(report.changedRanges[0].scope, "allowed");
});
