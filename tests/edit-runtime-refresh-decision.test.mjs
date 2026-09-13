import assert from "node:assert/strict";
import test from "node:test";

import {
  decideEditRuntimeRefresh,
} from "../app/components/edit-runtime-refresh-decision.js";

test("static text, style and sibling reorder stay in the mounted frame", () => {
  for (const mutationKind of ["text", "style", "reorder"]) {
    assert.deepEqual(decideEditRuntimeRefresh({ mutationKind }), {
      action: "in-place",
      reason: `static-${mutationKind}`,
      synchronizeCurrentFrame: true,
    });
  }
});

test("Runtime text, style and sibling reorder edits end after in-place projection", () => {
  for (const mutationKind of ["text", "style", "reorder"]) {
    assert.deepEqual(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind,
    }), {
      action: "in-place",
      reason: `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
    });
  }
});

test("Runtime structure and program changes prepare a candidate now", () => {
  assert.equal(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "structure",
  }).action, "candidate-now");
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "style",
    programIdentityChanged: true,
  }), {
    action: "candidate-now",
    reason: "program-identity-changed",
    synchronizeCurrentFrame: false,
  });
});
