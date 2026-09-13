import assert from "node:assert/strict";
import test from "node:test";

import {
  reportInternalFailure,
  setInternalFailureTelemetry,
} from "../app/application/internal-failure.js";

test("reportInternalFailure logs without throwing and never returns UI fields", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    const record = reportInternalFailure({
      area: "import",
      operation: "external-ack",
      code: "ack-unrecovered",
      recovered: false,
      cause: new Error("ack unavailable"),
    });
    assert.equal(record.area, "import");
    assert.equal(record.operation, "external-ack");
    assert.equal(record.code, "ack-unrecovered");
    assert.equal(record.recovered, false);
    assert.equal("title" in record, false);
    assert.equal("message" in record, false);
    assert.match(warnings.at(-1).join(" "), /pageroot:internal-failure/u);
    assert.match(warnings.at(-1).join(" "), /ack unavailable/u);
  } finally {
    console.warn = originalWarn;
  }
});

test("internal failure telemetry sink cannot interrupt reporting", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  setInternalFailureTelemetry(() => {
    throw new Error("telemetry exploded");
  });
  try {
    const record = reportInternalFailure({
      area: "navigation",
      operation: "tabs-persist",
      code: "write-retried",
      recovered: true,
    });
    assert.equal(record.recovered, true);
  } finally {
    setInternalFailureTelemetry(null);
    console.warn = originalWarn;
  }
});

test("structured-clone internal failures log a bounded safe message", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    reportInternalFailure({
      area: "project-open",
      operation: "reclassify",
      code: "reclassify-failed",
      cause: {
        code: "UNKNOWN_INTERNAL_CODE",
        message: `${"内部失败 ".repeat(120)} /Users/private/secret.html`,
      },
    });
    const detail = warnings.at(-1).at(-1);
    assert.equal(detail, "内部错误");
    assert.ok(detail.length <= 280);
    assert.doesNotMatch(warnings.at(-1).join(" "), /\[object Object\]|\/Users\/private\/secret\.html/u);
  } finally {
    console.warn = originalWarn;
  }
});
