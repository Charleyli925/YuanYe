import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_INTERRUPTION_KINDS,
  globalInterruptionPresentation,
} from "../app/lib/global-interruption.js";

test("unknown kinds cannot present a free-form interruption", () => {
  assert.equal(globalInterruptionPresentation(null), null);
  assert.equal(globalInterruptionPresentation({ kind: "made-up-toast" }), null);
  assert.ok(GLOBAL_INTERRUPTION_KINDS.includes("external-agent-may-still-run"));
});

test("allowlisted copy is owned by the catalog, not the caller", () => {
  const presented = globalInterruptionPresentation({
    kind: "handoff-recopy",
    succeeded: false,
  });
  assert.equal(presented?.title, "复制没有成功");
  assert.equal(presented?.actionId, null);
});

test("project-open recovery preserves only an opaque Prepared request for its existing action", () => {
  const retryPrepared = globalInterruptionPresentation({
    kind: "project-open-failed",
    detail: "response lost after commit",
    requestId: "prepared_open_retry",
  });
  assert.equal(retryPrepared?.actionId, "retry-project-open");
  assert.equal(retryPrepared?.actionRequestId, "prepared_open_retry");

  const reselect = globalInterruptionPresentation({
    kind: "project-open-failed",
    detail: "file moved",
  });
  assert.equal(reselect?.actionId, "retry-project-open");
  assert.equal(reselect?.actionRequestId, undefined);
});
