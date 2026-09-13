import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCopyDiagnostic,
} from "./e2e/electron/helpers/copy-diagnostic-classifier.mjs";

function settledSnapshot() {
  return {
    planned: {
      stableId: "pr1_123456789abc4def8abc123456789abc",
      tag: "h1",
      sourceTarget: {
        unique: true,
        stableId: "pr1_123456789abc4def8abc123456789abc",
        tag: "h1",
        codeUnitRange: { start: 10, end: 20 },
        utf8ByteRange: { start: 10, end: 20 },
      },
    },
    relocated: {
      sameAsPlanned: true,
      selectedMarker: true,
    },
    uiProjection: { availability: "unsupported" },
    commandBoundary: {
      availability: "unsupported",
      targetStableId: "pr1_123456789abc4def8abc123456789abc",
    },
    nativeTextSession: { ended: true, probeEnded: true },
    runtime: {
      candidateCount: 0,
      handoff: null,
      renderVerified: "true",
    },
    source: {
      renderedProjectionStale: "false",
      workingEqualsDisplayed: true,
    },
  };
}

test("copy diagnostics attribute an exact identity mismatch to the selected element", () => {
  const snapshot = settledSnapshot();
  snapshot.commandBoundary.targetStableId = "pr1_abcdefabcdef4def8abcabcdefabcdef";
  assert.equal(classifyCopyDiagnostic(snapshot), "wrong element selected");
});

test("copy diagnostics prefer unsettled projection evidence over a missing selection marker", () => {
  const snapshot = settledSnapshot();
  snapshot.relocated.selectedMarker = false;
  snapshot.runtime.renderVerified = "false";
  assert.equal(classifyCopyDiagnostic(snapshot), "prior edit not settled");
});

test("copy diagnostics attribute command-time disagreement to stale UI capability", () => {
  const snapshot = settledSnapshot();
  snapshot.uiProjection.availability = "available";
  snapshot.commandBoundary.availability = "available";
  snapshot.commandBoundary.executedAvailability = "unsupported";
  assert.equal(classifyCopyDiagnostic(snapshot), "stale UI capability cache");
});

test("copy diagnostics attribute an agreed false refusal to live capability judgement", () => {
  assert.equal(
    classifyCopyDiagnostic(settledSnapshot()),
    "live capability judgement wrong",
  );
});
