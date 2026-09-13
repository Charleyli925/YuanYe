import assert from "node:assert/strict";
import test from "node:test";

import {
  RESULT_MODEL_SCHEMA_VERSION,
  RESULT_REASON_CODES,
  RESULT_STATES,
  createResultModel,
  finalizeResultModel,
  isValidResultModel,
  recordBlocker,
  recordFailure,
  recordNotApplicable,
  recordPass,
  resultRowId,
  summarizeResultModel,
  validateResultModel,
} from "./e2e/electron/real-html/result-model.mjs";

function plan() {
  return {
    id: "synthetic-real-html-plan",
    files: [
      {
        id: "page-a.html",
        stages: [
          {
            id: "open",
            operations: [
              { id: "discover-target" },
              { id: "edit-text" },
            ],
          },
          {
            id: "reopen",
            operations: [{ id: "verify-source" }],
          },
        ],
      },
      {
        id: "page-b.html",
        applicable: false,
        reasonCode: RESULT_REASON_CODES.PAGE_NOT_APPLICABLE,
        stages: [{ id: "open", operations: [{ id: "page-specific-fixture" }] }],
      },
    ],
  };
}

test("result model exposes exactly the four allowed top-level states", () => {
  assert.deepEqual(RESULT_STATES, ["PASS", "FAIL", "NOT_APPLICABLE", "NOT_EXECUTED"]);
  assert.equal(RESULT_MODEL_SCHEMA_VERSION, 1);
  assert.equal(Object.hasOwn(RESULT_STATES, "EXPECTED_UNSUPPORTED"), false);
});

test("planned file, stage and operation rows are created before execution", () => {
  const model = createResultModel(plan());
  assert.deepEqual(
    model.rows.map(({ level }) => level),
    ["file", "stage", "operation", "operation", "stage", "operation", "file", "stage", "operation"],
  );
  assert.equal(model.rows.every((row) => row.planned), true);
  assert.equal(model.rows[0].state, "NOT_EXECUTED");
  assert.equal(model.rows[0].reasonCode, RESULT_REASON_CODES.NOT_STARTED);
  assert.equal(model.rows[6].state, "NOT_APPLICABLE");
  assert.equal(model.rows[7].state, "NOT_APPLICABLE");
  assert.equal(model.rows[8].state, "NOT_APPLICABLE");
  validateResultModel(model);
});

test("a failed category stage blocks only its own operations", () => {
  let model = createResultModel(plan());
  const failedStage = resultRowId.stage("page-a.html", "open");
  model = recordFailure(model, failedStage, RESULT_REASON_CODES.STAGE_FAILED, {
    message: "synthetic stage failure",
  });
  const stageRows = model.rows.filter((row) => (
    row.fileId === "page-a.html" && row.stageId === "open" && row.id !== failedStage
  ));
  assert.ok(stageRows.length > 0);
  assert.equal(
    stageRows.every((row) => (
      row.state === "NOT_EXECUTED"
      && row.reasonCode === RESULT_REASON_CODES.UPSTREAM_STAGE_FAILED
      && row.blockedBy === failedStage
    )),
    true,
  );
  const laterCategory = model.rows.filter((row) => (
    row.fileId === "page-a.html" && row.stageId === "reopen"
  ));
  assert.equal(laterCategory.every((row) => row.reasonCode === RESULT_REASON_CODES.NOT_STARTED), true);
  assert.equal(laterCategory.every((row) => row.state === "NOT_EXECUTED"), true);
  assert.equal(model.summary.levels.operation.denominator, 0);
  assert.equal(model.summary.levels.operation.covered, 0);
  assert.equal(model.state, "FAIL");
});

test("an operation failure preserves later independent facts in the same category", () => {
  let model = createResultModel({
    files: [{
      id: "page-a.html",
      stages: [
        { id: "first", operations: [{ id: "op-1" }, { id: "op-2" }] },
        { id: "second", operations: [{ id: "op-3" }] },
      ],
    }],
  });
  const failedOperation = resultRowId.operation("page-a.html", "first", "op-1");
  model = recordFailure(model, failedOperation, RESULT_REASON_CODES.OPERATION_FAILED, {
    message: "synthetic operation failure",
  });
  const downstream = model.rows.filter((row) => (
    row.fileId === "page-a.html"
    && row.stageId === "first"
    && row.order > model.rows.find((candidate) => candidate.id === failedOperation).order
  ));
  assert.ok(downstream.length > 0);
  assert.equal(downstream.every((row) => (
    row.state === "NOT_EXECUTED"
    && row.reasonCode === RESULT_REASON_CODES.NOT_STARTED
    && row.blockedBy === null
  )), true);
  const laterStage = model.rows.filter((row) => row.fileId === "page-a.html" && row.stageId === "second");
  assert.equal(laterStage.every((row) => row.reasonCode === RESULT_REASON_CODES.NOT_STARTED), true);
  assert.equal(laterStage.every((row) => row.state === "NOT_EXECUTED"), true);
  assert.equal(model.summary.levels.file.denominator, 0);
  assert.equal(model.summary.levels.stage.denominator, 0);
  assert.equal(model.summary.levels.operation.denominator, 1);
  assert.equal(model.summary.levels.operation.failed, 1);
  model = recordPass(model, resultRowId.operation("page-a.html", "first", "op-2"));
  assert.equal(model.rows.find(
    (row) => row.id === resultRowId.operation("page-a.html", "first", "op-2"),
  ).state, "PASS");
});

test("page-specific fixture stays NOT_APPLICABLE and does not become failed coverage", () => {
  let model = createResultModel(plan());
  model = recordPass(model, resultRowId.file("page-a.html"));
  model = recordPass(model, resultRowId.stage("page-a.html", "open"));
  model = recordPass(model, resultRowId.operation("page-a.html", "open", "discover-target"));
  model = recordPass(model, resultRowId.operation("page-a.html", "open", "edit-text"));
  model = recordPass(model, resultRowId.stage("page-a.html", "reopen"));
  model = recordPass(model, resultRowId.operation("page-a.html", "reopen", "verify-source"));
  model = finalizeResultModel(model);
  const pageB = model.rows.filter((row) => row.fileId === "page-b.html");
  assert.equal(pageB.every((row) => row.state === "NOT_APPLICABLE"), true);
  assert.equal(pageB.every((row) => row.reasonCode === RESULT_REASON_CODES.PAGE_NOT_APPLICABLE), true);
  assert.equal(model.state, "PASS");
  assert.equal(model.summary.levels.file.notApplicable, 1);
  assert.equal(model.summary.levels.stage.notApplicable, 1);
  assert.equal(model.summary.levels.operation.notApplicable, 1);
});

test("file, stage and operation denominators remain independent", () => {
  let model = createResultModel(plan());
  model = recordPass(model, resultRowId.file("page-a.html"));
  model = recordPass(model, resultRowId.stage("page-a.html", "open"));
  model = recordPass(model, resultRowId.operation("page-a.html", "open", "discover-target"));
  model = recordPass(model, resultRowId.operation("page-a.html", "open", "edit-text"));
  model = recordPass(model, resultRowId.stage("page-a.html", "reopen"));
  model = recordFailure(model, resultRowId.operation("page-a.html", "reopen", "verify-source"), RESULT_REASON_CODES.OPERATION_FAILED);
  model = finalizeResultModel(model);
  assert.deepEqual(
    Object.fromEntries(Object.entries(model.summary.levels).map(([level, counts]) => [
      level,
      {
        planned: counts.planned,
        passed: counts.passed,
        failed: counts.failed,
        notApplicable: counts.notApplicable,
        notExecuted: counts.notExecuted,
        denominator: counts.denominator,
      },
    ])),
    {
      file: { planned: 2, passed: 1, failed: 0, notApplicable: 1, notExecuted: 0, denominator: 1 },
      stage: { planned: 3, passed: 2, failed: 0, notApplicable: 1, notExecuted: 0, denominator: 2 },
      operation: { planned: 4, passed: 2, failed: 1, notApplicable: 1, notExecuted: 0, denominator: 3 },
    },
  );
  assert.equal(model.state, "FAIL");
  assert.equal(model.summary.levels.file.passRate, 1);
  assert.equal(model.summary.levels.operation.passRate, 2 / 3);
  assert.equal(model.summary.levels.operation.denominator, 3);
});

test("missing targets and environment blockers are NOT_EXECUTED and excluded from coverage", () => {
  let model = createResultModel(plan());
  const stage = resultRowId.stage("page-a.html", "open");
  model = recordBlocker(model, stage, RESULT_REASON_CODES.MISSING_TARGET, { target: "not-found" });
  const operation = model.rows.find((row) => row.id === resultRowId.operation("page-a.html", "open", "discover-target"));
  assert.equal(operation.state, "NOT_EXECUTED");
  assert.equal(operation.reasonCode, RESULT_REASON_CODES.MISSING_TARGET);
  assert.equal(operation.blockedBy, stage);
  assert.equal(model.summary.levels.stage.denominator, 0);
  assert.equal(model.summary.levels.operation.denominator, 0);
  assert.equal(model.summary.levels.stage.covered, 0);
  assert.equal(model.summary.reasonCodes.MISSING_TARGET, 3);
  const laterStageRows = model.rows.filter((row) => (
    row.fileId === "page-a.html" && row.stageId === "reopen"
  ));
  assert.equal(laterStageRows.every((row) => row.reasonCode === RESULT_REASON_CODES.NOT_STARTED), true);
  model = finalizeResultModel(model);
  assert.equal(model.summary.levels.stage.denominator, 0);
  assert.equal(model.summary.levels.operation.denominator, 0);
});

test("file-level environment blockers propagate without entering coverage", () => {
  let model = createResultModel({
    files: [{
      id: "blocked-page",
      stages: [{ id: "open", actions: [{ id: "load" }] }],
    }],
  });
  model = recordBlocker(
    model,
    resultRowId.file("blocked-page"),
    RESULT_REASON_CODES.ENVIRONMENT_BLOCKED,
    { environment: "electron-unavailable" },
  );
  assert.equal(model.rows[0].state, "NOT_EXECUTED");
  assert.equal(model.rows[1].blockedBy, model.rows[0].id);
  assert.equal(model.rows[1].reasonCode, RESULT_REASON_CODES.ENVIRONMENT_BLOCKED);
  assert.equal(model.summary.levels.file.denominator, 0);
  assert.equal(model.summary.levels.operation.denominator, 0);
  assert.equal(resultRowId.action("blocked-page", "open", "load"), resultRowId.operation(
    "blocked-page",
    "open",
    "load",
  ));
});

test("operation blockers propagate only within the same category", () => {
  for (const reasonCode of [
    RESULT_REASON_CODES.MISSING_TARGET,
    RESULT_REASON_CODES.ENVIRONMENT_BLOCKED,
  ]) {
    let model = createResultModel({
      files: [{
        id: "blocked-operation-page",
        stages: [
          { id: "first", operations: [{ id: "op-1" }, { id: "op-2" }] },
          { id: "second", operations: [{ id: "op-3" }] },
        ],
      }],
    });
    const blocker = resultRowId.operation("blocked-operation-page", "first", "op-1");
    model = recordBlocker(model, blocker, reasonCode, { reason: "direct operation blocker" });
    const downstream = model.rows.filter((row) => (
      row.fileId === "blocked-operation-page"
      && row.stageId === "first"
      && row.id !== blocker
      && row.order > model.rows.find((candidate) => candidate.id === blocker).order
    ));
    assert.ok(downstream.length > 0);
    assert.equal(downstream.every((row) => (
      row.state === "NOT_EXECUTED"
      && row.reasonCode === reasonCode
      && row.blockedBy === blocker
    )), true);
    const laterCategory = model.rows.filter((row) => (
      row.fileId === "blocked-operation-page" && row.stageId === "second"
    ));
    assert.equal(laterCategory.every((row) => row.reasonCode === RESULT_REASON_CODES.NOT_STARTED), true);
    assert.equal(model.summary.levels.operation.denominator, 0);
    assert.equal(model.summary.levels.stage.denominator, 0);
    assert.equal(model.summary.levels.file.denominator, 0);
    assert.throws(
      () => recordPass(model, resultRowId.operation("blocked-operation-page", "first", "op-2")),
      /already blocked or not executed/u,
    );
  }
});

test("not-applicable propagation and validation reject invented or stale states", () => {
  let model = createResultModel({
    files: [{ id: "page", stages: [{ id: "stage", operations: [{ id: "op" }] }] }],
  });
  model = recordNotApplicable(
    model,
    resultRowId.file("page"),
    RESULT_REASON_CODES.PAGE_NOT_APPLICABLE,
  );
  assert.equal(model.rows.every((row) => row.state === "NOT_APPLICABLE"), true);
  assert.equal(model.state, "NOT_APPLICABLE");
  assert.equal(summarizeResultModel(model).state, "NOT_APPLICABLE");
  assert.equal(isValidResultModel(model), true);

  const invented = structuredClone(model);
  invented.rows[0].state = "EXPECTED_UNSUPPORTED";
  assert.equal(isValidResultModel(invented), false);

  const stale = structuredClone(model);
  stale.summary = { state: "PASS", levels: {}, reasonCodes: {} };
  assert.throws(() => validateResultModel(stale), /summary does not match rows/iu);
});

test("applicable files and stages cannot silently produce empty denominators", () => {
  assert.throws(
    () => createResultModel({ files: [{ id: "empty.html", stages: [] }] }),
    (error) => error?.code === "RESULT_PLAN_EMPTY_STAGES",
  );
  assert.throws(
    () => createResultModel({ files: [{ id: "empty.html", stages: [{ id: "stage", operations: [] }] }] }),
    (error) => error?.code === "RESULT_PLAN_EMPTY_OPERATIONS",
  );
  assert.doesNotThrow(() => createResultModel({
    files: [{ id: "not-applicable.html", applicable: false, stages: [] }],
  }));
});

test("rows must exactly reconcile with the immutable file/stage/operation plan", () => {
  const model = createResultModel(plan());
  const missing = structuredClone(model);
  missing.rows.pop();
  assert.equal(isValidResultModel(missing), false);

  const extra = structuredClone(model);
  extra.rows.push(structuredClone(extra.rows.at(-1)));
  assert.equal(isValidResultModel(extra), false);

  const tampered = structuredClone(model);
  tampered.rows[2].label = "different operation";
  assert.equal(isValidResultModel(tampered), false);
});
