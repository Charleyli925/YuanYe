import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExtendedFormatEvidence,
  formatFailureRows,
} from "./e2e/electron/real-html/extended-format-evidence.mjs";

function completeEvidence(overrides = {}) {
  return {
    sourceScope: {
      ok: true,
      outsideElementUnchanged: true,
      changedRanges: {
        before: { start: 10, end: 10 },
        after: { start: 10, end: 27 },
      },
    },
    expectedControlValue: "29",
    observedControlValue: "29",
    expectedSourceValue: "29px",
    observedInlineValue: "29px",
    observedComputedValue: "29px",
    beforeIdentity: { document: "doc-a", generation: "7" },
    afterIdentity: { document: "doc-a", generation: "7" },
    ...overrides,
  };
}

test("extended format evidence accepts one complete single-property transition", () => {
  const verdict = evaluateExtendedFormatEvidence(completeEvidence());
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failures, []);
  assert.equal(Object.values(verdict.conditions).every(Boolean), true);
});

test("extended format evidence accepts a correct normalized color transition", () => {
  const verdict = evaluateExtendedFormatEvidence(completeEvidence({
    color: true,
    expectedControlValue: "#123456",
    observedControlValue: "#123456",
    expectedSourceValue: "#123456",
    observedInlineValue: "rgb(18, 52, 86)",
    observedComputedValue: "rgb(18, 52, 86)",
  }));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.conditions.computedValueMatches, true);
});

test("extended format evidence preserves a source oracle failure and its ranges", () => {
  const sourceScope = {
    ok: false,
    outsideElementUnchanged: false,
    expectedPropertyChanged: false,
    changedRanges: {
      before: { start: 4, end: 9 },
      after: { start: 4, end: 18 },
    },
  };
  const verdict = evaluateExtendedFormatEvidence(completeEvidence({ sourceScope }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.conditions.sourceScopeOk, false);
  assert.ok(verdict.failures.includes("SOURCE_SCOPE_ORACLE_FAILED"));
  assert.deepEqual(verdict.sourceScope.changedRanges, sourceScope.changedRanges);
});

for (const colorCase of [
  { name: "text color", expected: "#123456", observed: "rgb(101, 67, 33)" },
  { name: "fill color", expected: "#cdefab", observed: "rgb(1, 2, 3)" },
]) {
  test(`extended format evidence rejects wrong Active DOM ${colorCase.name}`, () => {
    const verdict = evaluateExtendedFormatEvidence(completeEvidence({
      color: true,
      expectedControlValue: colorCase.expected,
      observedControlValue: colorCase.expected,
      expectedSourceValue: colorCase.expected,
      observedInlineValue: colorCase.expected,
      observedComputedValue: colorCase.observed,
    }));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.conditions.controlValueMatches, true);
    assert.equal(verdict.conditions.computedValueMatches, false);
    assert.ok(verdict.failures.includes("FORMAT_COMPUTED_VALUE_MISMATCH"));
  });
}

test("format recovery failure fails the current row, blocks the remainder, and stops", () => {
  const formatCases = [
    { behaviorFamily: "font-size" },
    { behaviorFamily: "text-color" },
    { behaviorFamily: "fill-color" },
  ];
  const result = formatFailureRows({
    formatCases,
    failedIndex: 0,
    entry: { elementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    operationId: "format-font-size",
    operationFailure: { code: "SOURCE_SCOPE_ORACLE_FAILED" },
    recoveryFailure: { code: "HARNESS_RECOVERY_TIMEOUT" },
  });
  assert.equal(result.stop, true);
  assert.deepEqual(result.rows.map((row) => row.state), [
    "FAIL",
    "NOT_EXECUTED",
    "NOT_EXECUTED",
  ]);
  assert.equal(result.rows[0].reasonCode, "FORMAT_SESSION_RECOVERY_FAILED");
  assert.equal(result.rows[1].details.blockedByOperationId, "format-font-size");
});

test("a recovered property failure does not invent blocked rows", () => {
  const result = formatFailureRows({
    formatCases: [{ behaviorFamily: "font-size" }, { behaviorFamily: "text-color" }],
    failedIndex: 0,
    entry: { elementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    operationId: "format-font-size",
    operationFailure: { code: "FORMAT_COMPUTED_VALUE_MISMATCH" },
  });
  assert.equal(result.stop, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].reasonCode, "FORMAT_COMPUTED_VALUE_MISMATCH");
});
