// Deterministic result semantics for the opt-in real-HTML acceptance runner.
//
// This module deliberately has no Playwright, Electron, filesystem or clock
// dependency.  The runner creates the complete plan before it opens a page;
// execution only supplies outcomes for rows in that plan.  That keeps a
// missing target, a blocked environment and a failed stage visible instead of
// silently shrinking the denominator.

export const RESULT_MODEL_SCHEMA_VERSION = 1;

export const RESULT_STATES = Object.freeze([
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "NOT_EXECUTED",
]);

export const RESULT_LEVELS = Object.freeze(["file", "stage", "operation"]);

export const RESULT_REASON_CODES = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  UPSTREAM_STAGE_FAILED: "UPSTREAM_STAGE_FAILED",
  UPSTREAM_FILE_FAILED: "UPSTREAM_FILE_FAILED",
  UPSTREAM_OPERATION_FAILED: "UPSTREAM_OPERATION_FAILED",
  PAGE_NOT_APPLICABLE: "PAGE_NOT_APPLICABLE",
  STAGE_NOT_APPLICABLE: "STAGE_NOT_APPLICABLE",
  OPERATION_NOT_APPLICABLE: "OPERATION_NOT_APPLICABLE",
  MISSING_TARGET: "MISSING_TARGET",
  ENVIRONMENT_BLOCKED: "ENVIRONMENT_BLOCKED",
  OPERATION_FAILED: "OPERATION_FAILED",
  STAGE_FAILED: "STAGE_FAILED",
  FILE_FAILED: "FILE_FAILED",
  NOT_EXECUTED: "NOT_EXECUTED",
});

const RESULT_STATE_SET = new Set(RESULT_STATES);
const RESULT_LEVEL_SET = new Set(RESULT_LEVELS);
const RESULT_REASON_CODE_SET = new Set(Object.values(RESULT_REASON_CODES));
const FINAL_STATES = new Set(["PASS", "FAIL", "NOT_APPLICABLE"]);
const BLOCKING_REASON_CODES = new Set([
  RESULT_REASON_CODES.MISSING_TARGET,
  RESULT_REASON_CODES.ENVIRONMENT_BLOCKED,
  RESULT_REASON_CODES.UPSTREAM_STAGE_FAILED,
  RESULT_REASON_CODES.UPSTREAM_FILE_FAILED,
  RESULT_REASON_CODES.UPSTREAM_OPERATION_FAILED,
  RESULT_REASON_CODES.NOT_EXECUTED,
  RESULT_REASON_CODES.NOT_STARTED,
]);
const COVERAGE_BLOCKER_REASON_CODES = new Set([
  RESULT_REASON_CODES.MISSING_TARGET,
  RESULT_REASON_CODES.ENVIRONMENT_BLOCKED,
]);

export class ResultModelValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ResultModelValidationError";
    this.code = details.code || "RESULT_MODEL_INVALID";
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResultModelValidationError(message, { ...details, code });
}

function asNonEmptyString(value, field, details = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("RESULT_FIELD_INVALID", `${field} must be a non-empty string.`, {
      field,
      value,
      ...details,
    });
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function stableMetadata(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("RESULT_METADATA_INVALID", "Result model metadata must be an object.");
  }
  return clone(value);
}

function rowId(level, fileId, stageId, operationId, sourceId) {
  if (level === "file") return `file:${fileId}`;
  if (level === "stage") return `file:${fileId}/stage:${stageId}`;
  return `file:${fileId}/stage:${stageId}/operation:${operationId || sourceId}`;
}

function normalizeApplicability(item, defaultReasonCode) {
  const applicable = item?.applicable !== false;
  if (applicable) return { applicable: true, reasonCode: null };
  return {
    applicable: false,
    reasonCode: item?.reasonCode || defaultReasonCode,
  };
}

function normalizePlan(plan) {
  const source = Array.isArray(plan) ? { files: plan } : plan;
  if (!source || typeof source !== "object" || !Array.isArray(source.files)) {
    fail("RESULT_PLAN_INVALID", "A result plan must contain a files array.");
  }
  if (source.files.length === 0) {
    fail("RESULT_PLAN_EMPTY", "A result plan must pre-create at least one file row.");
  }
  const files = source.files.map((file, fileIndex) => {
    if (!file || typeof file !== "object") {
      fail("RESULT_PLAN_INVALID", "Each planned file must be an object.", { fileIndex });
    }
    const fileSourceId = asNonEmptyString(file.id ?? file.fileId ?? file.path, "file.id", {
      fileIndex,
    });
    const fileApplicability = normalizeApplicability(file, RESULT_REASON_CODES.PAGE_NOT_APPLICABLE);
    const stages = Array.isArray(file.stages) ? file.stages : [];
    if (fileApplicability.applicable && stages.length === 0) {
      fail("RESULT_PLAN_EMPTY_STAGES", "An applicable file must declare at least one stage.", {
        fileId: fileSourceId,
      });
    }
    return {
      id: fileSourceId,
      label: typeof file.label === "string" ? file.label : fileSourceId,
      applicable: fileApplicability.applicable,
      reasonCode: fileApplicability.reasonCode,
      metadata: stableMetadata(file.metadata),
      stages: stages.map((stage, stageIndex) => {
        if (!stage || typeof stage !== "object") {
          fail("RESULT_PLAN_INVALID", "Each planned stage must be an object.", {
            fileId: fileSourceId,
            stageIndex,
          });
        }
        const stageSourceId = asNonEmptyString(stage.id ?? stage.stageId, "stage.id", {
          fileId: fileSourceId,
          stageIndex,
        });
        const stageApplicability = normalizeApplicability(
          stage,
          RESULT_REASON_CODES.STAGE_NOT_APPLICABLE,
        );
        const operations = Array.isArray(stage.operations)
          ? stage.operations
          : Array.isArray(stage.actions)
            ? stage.actions
            : [];
        if (fileApplicability.applicable && stageApplicability.applicable && operations.length === 0) {
          fail(
            "RESULT_PLAN_EMPTY_OPERATIONS",
            "An applicable stage must declare at least one operation.",
            { fileId: fileSourceId, stageId: stageSourceId },
          );
        }
        return {
          id: stageSourceId,
          label: typeof stage.label === "string" ? stage.label : stageSourceId,
          applicable: stageApplicability.applicable,
          reasonCode: stageApplicability.reasonCode,
          metadata: stableMetadata(stage.metadata),
          operations: operations.map((operation, operationIndex) => {
            const operationSource = typeof operation === "string"
              ? { id: operation }
              : operation;
            if (!operationSource || typeof operationSource !== "object") {
              fail("RESULT_PLAN_INVALID", "Each planned operation must be an object or string.", {
                fileId: fileSourceId,
                stageId: stageSourceId,
                operationIndex,
              });
            }
            const operationSourceId = asNonEmptyString(
              operationSource.id ?? operationSource.operationId,
              "operation.id",
              { fileId: fileSourceId, stageId: stageSourceId, operationIndex },
            );
            const operationApplicability = normalizeApplicability(
              operationSource,
              RESULT_REASON_CODES.OPERATION_NOT_APPLICABLE,
            );
            return {
              id: operationSourceId,
              label: typeof operationSource.label === "string"
                ? operationSource.label
                : operationSourceId,
              applicable: operationApplicability.applicable,
              reasonCode: operationApplicability.reasonCode,
              metadata: stableMetadata(operationSource.metadata),
            };
          }),
        };
      }),
    };
  });
  return {
    id: source.id == null ? null : asNonEmptyString(source.id, "plan.id"),
    label: typeof source.label === "string" ? source.label : null,
    metadata: stableMetadata(source.metadata),
    files,
  };
}

function makeRow({
  id,
  level,
  sourceId,
  fileId,
  stageId = null,
  operationId = null,
  order,
  label,
  applicable,
  notApplicableReasonCode = null,
  metadata = {},
}) {
  const notApplicable = !applicable;
  return {
    id,
    level,
    sourceId,
    fileId,
    stageId,
    operationId,
    order,
    label,
    planned: true,
    applicable,
    state: notApplicable ? "NOT_APPLICABLE" : "NOT_EXECUTED",
    reasonCode: notApplicable ? notApplicableReasonCode : RESULT_REASON_CODES.NOT_STARTED,
    blockedBy: null,
    details: null,
    metadata: clone(metadata),
  };
}

function descendants(rows, parent) {
  return rows.filter((row) => (
    row.order > parent.order
    && row.fileId === parent.fileId
    && (parent.level === "file" || row.stageId === parent.stageId)
    && row.level !== parent.level
  ));
}

function downstreamRows(rows, sourceRow) {
  if (sourceRow.level === "file") {
    return rows.filter((row) => row.fileId === sourceRow.fileId && row.order > sourceRow.order);
  }
  // A, B, C, D and E are independent categories. A stage failure may only block
  // work that belongs to that same category; it must never turn a later
  // category into NOT_EXECUTED. Planned operation failures are independent
  // result facts and do not call this helper; explicit missing-target or
  // environment blockers may still stop downstream work in that category.
  if (sourceRow.level === "stage" || sourceRow.level === "operation") {
    return rows.filter((row) => (
      row.fileId === sourceRow.fileId
      && row.stageId === sourceRow.stageId
      && row.order > sourceRow.order
    ));
  }
  return [];
}

function assertKnownState(state) {
  if (!RESULT_STATE_SET.has(state)) {
    fail("RESULT_STATE_INVALID", `Unknown result state ${JSON.stringify(state)}.`, { state });
  }
}

function assertKnownReasonCode(reasonCode) {
  if (reasonCode != null && !RESULT_REASON_CODE_SET.has(reasonCode)) {
    fail("RESULT_REASON_CODE_INVALID", `Unknown result reason code ${JSON.stringify(reasonCode)}.`, {
      reasonCode,
    });
  }
}

function rowCanAccept(row, outcome) {
  if (!row.planned) {
    fail("RESULT_ROW_NOT_PLANNED", `Result row ${row.id} was not planned.`, { rowId: row.id });
  }
  if (FINAL_STATES.has(row.state) && row.state !== "NOT_EXECUTED") {
    if (row.state === outcome.state && row.reasonCode === (outcome.reasonCode ?? null)) return false;
    fail("RESULT_ROW_FINAL", `Result row ${row.id} already has a final result.`, {
      rowId: row.id,
      state: row.state,
    });
  }
  if (row.state === "NOT_EXECUTED" && row.reasonCode !== RESULT_REASON_CODES.NOT_STARTED) {
    if (
      row.state === outcome.state
      && row.reasonCode === (outcome.reasonCode ?? null)
      && row.blockedBy === (outcome.blockedBy ?? null)
    ) return false;
    fail("RESULT_ROW_BLOCKED", `Result row ${row.id} is already blocked or not executed.`, {
      rowId: row.id,
      state: row.state,
      reasonCode: row.reasonCode,
      blockedBy: row.blockedBy,
    });
  }
  return true;
}

function normalizeOutcome(input) {
  const outcome = typeof input === "string" ? { state: input } : input;
  if (!outcome || typeof outcome !== "object") {
    fail("RESULT_OUTCOME_INVALID", "A result outcome must be a state or object.");
  }
  assertKnownState(outcome.state);
  assertKnownReasonCode(outcome.reasonCode ?? null);
  if (outcome.blockedBy != null) asNonEmptyString(outcome.blockedBy, "blockedBy");
  if (outcome.state === "NOT_EXECUTED" && !outcome.reasonCode) {
    fail(
      "RESULT_REASON_REQUIRED",
      "NOT_EXECUTED rows require an explicit reasonCode.",
    );
  }
  if (outcome.state === "NOT_APPLICABLE" && !outcome.reasonCode) {
    fail(
      "RESULT_REASON_REQUIRED",
      "NOT_APPLICABLE rows require an explicit reasonCode.",
    );
  }
  if (outcome.state === "FAIL" && !outcome.reasonCode) {
    fail("RESULT_REASON_REQUIRED", "FAIL rows require an explicit reasonCode.");
  }
  if (outcome.state !== "NOT_EXECUTED" && outcome.blockedBy != null) {
    fail("RESULT_BLOCKED_STATE_INVALID", "Only NOT_EXECUTED rows may be blocked.");
  }
  return {
    state: outcome.state,
    reasonCode: outcome.reasonCode ?? null,
    blockedBy: outcome.blockedBy ?? null,
    details: outcome.details == null ? null : clone(outcome.details),
  };
}

function applyOutcome(rows, rowIdValue, outcomeValue) {
  const outcome = normalizeOutcome(outcomeValue);
  const row = rows.find((candidate) => candidate.id === rowIdValue);
  if (!row) {
    fail("RESULT_ROW_UNKNOWN", `Unknown result row ${JSON.stringify(rowIdValue)}.`, {
      rowId: rowIdValue,
    });
  }
  if (!rowCanAccept(row, outcome)) return rows;
  row.state = outcome.state;
  row.reasonCode = outcome.reasonCode;
  row.blockedBy = outcome.blockedBy;
  row.details = outcome.details;
  return rows;
}

function blockRows(rows, sourceRow, reasonCode, candidates = downstreamRows(rows, sourceRow)) {
  for (const row of candidates) {
    if (row.state !== "NOT_EXECUTED" || row.reasonCode !== RESULT_REASON_CODES.NOT_STARTED) continue;
    row.state = "NOT_EXECUTED";
    row.reasonCode = reasonCode;
    row.blockedBy = sourceRow.id;
    row.details = {
      blockedByState: sourceRow.state,
      blockedByReasonCode: sourceRow.reasonCode,
    };
  }
}

function recomputeModelState(model) {
  const states = model.rows.map((row) => row.state);
  if (states.some((state) => state === "FAIL")) return "FAIL";
  if (states.some((state) => state === "NOT_EXECUTED")) return "NOT_EXECUTED";
  if (states.length > 0 && states.every((state) => state === "NOT_APPLICABLE")) {
    return "NOT_APPLICABLE";
  }
  return "PASS";
}

function countLevel(rows, level) {
  const levelRows = rows.filter((row) => row.level === level);
  const counts = {
    total: levelRows.length,
    planned: levelRows.filter((row) => row.planned).length,
    passed: levelRows.filter((row) => row.state === "PASS").length,
    failed: levelRows.filter((row) => row.state === "FAIL").length,
    notApplicable: levelRows.filter((row) => row.state === "NOT_APPLICABLE").length,
    notExecuted: levelRows.filter((row) => row.state === "NOT_EXECUTED").length,
  };
  counts.excludedFromCoverage = levelRows.filter((row) => (
    COVERAGE_BLOCKER_REASON_CODES.has(row.reasonCode)
  )).length;
  // `denominator` means rows that actually executed and therefore can be
  // judged.  It never derives passed from total - failed and never counts
  // non-applicable or blocked/environment rows as coverage.
  counts.denominator = levelRows.filter((row) => (
    row.state === "PASS"
    || (row.state === "FAIL" && !COVERAGE_BLOCKER_REASON_CODES.has(row.reasonCode))
  )).length;
  counts.coverageDenominator = counts.denominator;
  counts.totalApplicable = counts.planned - counts.notApplicable;
  counts.covered = counts.denominator;
  counts.coverage = counts.totalApplicable === 0 ? null : counts.covered / counts.totalApplicable;
  counts.plannedCoverage = counts.planned === 0 ? null : counts.covered / counts.planned;
  counts.passRate = counts.denominator === 0 ? null : counts.passed / counts.denominator;
  counts.uncovered = counts.notExecuted;
  return counts;
}

function reasonCounts(rows) {
  const counts = {};
  for (const row of rows) {
    if (!row.reasonCode) continue;
    counts[row.reasonCode] = (counts[row.reasonCode] || 0) + 1;
  }
  return counts;
}

export const RESULT_MODEL_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["schemaVersion", "state", "rows"],
  properties: {
    schemaVersion: { const: RESULT_MODEL_SCHEMA_VERSION },
    state: { enum: RESULT_STATES },
    rows: { type: "array" },
  },
});

/**
 * Create a complete file/stage/operation result plan before execution.
 *
 * `applicable: false` on a file is intentionally inherited by all its
 * descendants.  A page-specific fixture can therefore be planned once and
 * reported as NOT_APPLICABLE without becoming a failed or missing test.
 */
export function createResultModel(plan, options = {}) {
  const normalizedPlan = normalizePlan(plan);
  const rows = buildPlannedRows(normalizedPlan);
  const model = {
    schemaVersion: RESULT_MODEL_SCHEMA_VERSION,
    state: recomputeModelState({ rows }),
    plan: normalizedPlan,
    rows,
    summary: null,
    metadata: stableMetadata(options.metadata),
  };
  validateResultModel(model);
  return model;
}

function buildPlannedRows(normalizedPlan) {
  const rows = [];
  let order = 0;
  for (const file of normalizedPlan.files) {
    const fileRow = makeRow({
      id: rowId("file", file.id),
      level: "file",
      sourceId: file.id,
      fileId: file.id,
      order: order += 1,
      label: file.label,
      applicable: file.applicable,
      notApplicableReasonCode: file.reasonCode,
      metadata: file.metadata,
    });
    rows.push(fileRow);
    for (const stage of file.stages) {
      const stageApplicable = file.applicable && stage.applicable;
      const stageReason = !file.applicable
        ? file.reasonCode
        : stage.reasonCode;
      const stageRow = makeRow({
        id: rowId("stage", file.id, stage.id),
        level: "stage",
        sourceId: stage.id,
        fileId: file.id,
        stageId: stage.id,
        order: order += 1,
        label: stage.label,
        applicable: stageApplicable,
        notApplicableReasonCode: stageReason,
        metadata: stage.metadata,
      });
      rows.push(stageRow);
      for (const operation of stage.operations) {
        const operationApplicable = stageApplicable && operation.applicable;
        const operationReason = !file.applicable
          ? file.reasonCode
          : !stage.applicable
            ? stage.reasonCode
            : operation.reasonCode;
        rows.push(makeRow({
          id: rowId("operation", file.id, stage.id, operation.id),
          level: "operation",
          sourceId: operation.id,
          fileId: file.id,
          stageId: stage.id,
          operationId: operation.id,
          order: order += 1,
          label: operation.label,
          applicable: operationApplicable,
          notApplicableReasonCode: operationReason,
          metadata: operation.metadata,
        }));
      }
    }
  }
  return rows;
}

/**
 * Record one row outcome and return a new model.  The input model is never
 * mutated, which lets a runner retain each accepted working baseline and
 * replay a deterministic report if a later operation fails.
 */
export function recordResult(model, selector, outcomeValue) {
  const rowIdValue = resolveRowId(selector);
  validateResultModel(model);
  const next = clone(model);
  const row = next.rows.find((candidate) => candidate.id === rowIdValue);
  if (!row) {
    fail("RESULT_ROW_UNKNOWN", `Unknown result row ${JSON.stringify(rowIdValue)}.`, {
      rowId: rowIdValue,
    });
  }
  applyOutcome(next.rows, rowIdValue, outcomeValue);
  const updated = next.rows.find((candidate) => candidate.id === rowIdValue);
  if (updated.state === "FAIL" && updated.level === "file") {
    blockRows(next.rows, updated, RESULT_REASON_CODES.UPSTREAM_FILE_FAILED);
  } else if (updated.state === "FAIL" && updated.level === "stage") {
    blockRows(next.rows, updated, RESULT_REASON_CODES.UPSTREAM_STAGE_FAILED);
  } else if (updated.state === "NOT_EXECUTED" && (
    updated.level === "file"
    || updated.level === "stage"
    || updated.level === "operation"
  ) && (
    updated.reasonCode === RESULT_REASON_CODES.MISSING_TARGET
    || updated.reasonCode === RESULT_REASON_CODES.ENVIRONMENT_BLOCKED
  )) {
    blockRows(next.rows, updated, updated.reasonCode);
  } else if (updated.state === "NOT_APPLICABLE") {
    for (const row of descendants(next.rows, updated)) {
      if (row.state !== "NOT_EXECUTED" || row.reasonCode !== RESULT_REASON_CODES.NOT_STARTED) continue;
      row.state = "NOT_APPLICABLE";
      row.reasonCode = updated.reasonCode;
      row.blockedBy = null;
      row.details = updated.details == null ? null : clone(updated.details);
    }
  }
  next.state = recomputeModelState(next);
  next.summary = summarizeResultModel(next);
  validateResultModel(next);
  return next;
}

/** Record a successful row without forcing callers to spell out the state. */
export function recordPass(model, rowIdValue, details = null) {
  return recordResult(model, rowIdValue, { state: "PASS", details });
}

/** Record a failure with an explicit, machine-readable reason code. */
export function recordFailure(model, rowIdValue, reasonCode, details = null) {
  return recordResult(model, rowIdValue, {
    state: "FAIL",
    reasonCode,
    details,
  });
}

/**
 * Mark a planned page/stage/operation as non-applicable.  Descendants inherit
 * the same semantic outcome and remain visible in their own denominators.
 */
export function recordNotApplicable(model, rowIdValue, reasonCode, details = null) {
  return recordResult(model, rowIdValue, {
    state: "NOT_APPLICABLE",
    reasonCode,
    details,
  });
}

/**
 * Record a missing target or an environment blocker as NOT_EXECUTED.  These
 * reasons are deliberately excluded from the coverage denominator.
 */
export function recordBlocker(model, rowIdValue, reasonCode, details = null) {
  if (![RESULT_REASON_CODES.MISSING_TARGET, RESULT_REASON_CODES.ENVIRONMENT_BLOCKED].includes(reasonCode)) {
    fail("RESULT_BLOCKER_REASON_INVALID", "Only missing-target or environment-blocked reasons are blockers.", {
      reasonCode,
    });
  }
  return recordResult(model, rowIdValue, {
    state: "NOT_EXECUTED",
    reasonCode,
    details,
  });
}

/**
 * Finalize a model.  Unresolved planned rows remain NOT_EXECUTED; they are not
 * rewritten as FAIL and no denominator is inferred from the number of passed
 * rows.  This function is pure and safe to call more than once.
 */
export function finalizeResultModel(model) {
  validateResultModel(model);
  const next = clone(model);
  for (const row of next.rows) {
    if (row.state === "NOT_EXECUTED" && row.reasonCode === RESULT_REASON_CODES.NOT_STARTED) {
      row.reasonCode = RESULT_REASON_CODES.NOT_EXECUTED;
    }
  }
  next.state = recomputeModelState(next);
  next.summary = summarizeResultModel(next);
  validateResultModel(next);
  return next;
}

export function summarizeResultModel(model) {
  validateResultModel(model, { skipSummary: true });
  const levels = Object.fromEntries(RESULT_LEVELS.map((level) => [
    level,
    countLevel(model.rows, level),
  ]));
  return {
    state: recomputeModelState(model),
    levels,
    reasonCodes: reasonCounts(model.rows),
  };
}

export function qualificationResultIssues(modelOrRows, { includeFileRows = false } = {}) {
  const rows = Array.isArray(modelOrRows) ? modelOrRows : modelOrRows?.rows;
  if (!Array.isArray(rows)) {
    fail("RESULT_ROWS_INVALID", "Qualification audit requires result rows.");
  }
  const scopedRows = includeFileRows ? rows : rows.filter((row) => row.level !== "file");
  return {
    unexplainedNotApplicable: scopedRows.filter((row) => (
      row.state === "NOT_APPLICABLE"
      && (typeof row.details?.exactReason !== "string"
        || row.details.exactReason.trim() === "")
    )),
    unresolvedRows: scopedRows.filter((row) => row.state === "NOT_EXECUTED"),
  };
}

/**
 * Validate the model schema and semantic invariants.  Returns the model for a
 * convenient assertion style and throws ResultModelValidationError on any
 * invalid state.  `isValidResultModel` is the non-throwing counterpart.
 */
export function validateResultModel(model, { skipSummary = false } = {}) {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    fail("RESULT_MODEL_INVALID", "A result model must be an object.");
  }
  if (model.schemaVersion !== RESULT_MODEL_SCHEMA_VERSION) {
    fail("RESULT_SCHEMA_VERSION_INVALID", "Unsupported result model schema version.", {
      schemaVersion: model.schemaVersion,
    });
  }
  assertKnownState(model.state);
  if (!model.plan || typeof model.plan !== "object" || Array.isArray(model.plan)) {
    fail("RESULT_PLAN_REQUIRED", "A result model must retain its complete result plan.");
  }
  const normalizedPlan = normalizePlan(model.plan);
  const plannedRows = buildPlannedRows(normalizedPlan);
  if (!Array.isArray(model.rows)) fail("RESULT_ROWS_INVALID", "Result model rows must be an array.");
  if (model.rows.length !== plannedRows.length) {
    fail("RESULT_ROWS_PLAN_MISMATCH", "Result rows must exactly match the planned rows.", {
      plannedRowCount: plannedRows.length,
      actualRowCount: model.rows.length,
    });
  }
  const ids = new Set();
  let previousOrder = 0;
  for (const [rowIndex, row] of model.rows.entries()) {
    if (!row || typeof row !== "object") fail("RESULT_ROW_INVALID", "Each result row must be an object.");
    const planned = plannedRows[rowIndex];
    if (!planned) {
      fail("RESULT_ROWS_PLAN_MISMATCH", "Result rows contain an unplanned row.", { rowIndex });
    }
    for (const field of [
      "id", "level", "sourceId", "fileId", "stageId", "operationId", "order", "label", "planned",
      "applicable",
    ]) {
      if (row[field] !== planned[field]) {
        fail("RESULT_ROW_PLAN_MISMATCH", `Result row ${row.id || rowIndex} does not match its plan.`, {
          rowIndex,
          field,
          actual: row[field],
          expected: planned[field],
        });
      }
    }
    if (JSON.stringify(row.metadata ?? {}) !== JSON.stringify(planned.metadata ?? {})) {
      fail("RESULT_ROW_PLAN_MISMATCH", `Result row ${row.id || rowIndex} metadata does not match its plan.`, {
        rowIndex,
      });
    }
    if (!planned.applicable && row.reasonCode !== planned.reasonCode) {
      fail("RESULT_ROW_PLAN_MISMATCH", `Result row ${row.id || rowIndex} applicability reason drifted.`, {
        rowIndex,
        actual: row.reasonCode,
        expected: planned.reasonCode,
      });
    }
    asNonEmptyString(row.id, "row.id");
    if (ids.has(row.id)) fail("RESULT_ROW_DUPLICATE", `Duplicate result row ${row.id}.`, { rowId: row.id });
    ids.add(row.id);
    if (!RESULT_LEVEL_SET.has(row.level)) {
      fail("RESULT_LEVEL_INVALID", `Unknown result row level ${JSON.stringify(row.level)}.`, {
        rowId: row.id,
      });
    }
    if (!Number.isInteger(row.order) || row.order <= previousOrder) {
      fail("RESULT_ORDER_INVALID", "Result rows must have strictly increasing integer order.", {
        rowId: row.id,
        order: row.order,
      });
    }
    previousOrder = row.order;
    assertKnownState(row.state);
    assertKnownReasonCode(row.reasonCode ?? null);
    if (row.state === "NOT_EXECUTED" && !row.reasonCode) {
      fail("RESULT_REASON_REQUIRED", "NOT_EXECUTED rows require an explicit reasonCode.", {
        rowId: row.id,
      });
    }
    if (row.state === "NOT_APPLICABLE" && !row.reasonCode) {
      fail("RESULT_REASON_REQUIRED", "NOT_APPLICABLE rows require an explicit reasonCode.", {
        rowId: row.id,
      });
    }
    if (row.state === "FAIL" && !row.reasonCode) {
      fail("RESULT_REASON_REQUIRED", "FAIL rows require an explicit reasonCode.", {
        rowId: row.id,
      });
    }
    if (
      row.blockedBy != null
      && (!ids.has(row.blockedBy) || row.blockedBy === row.id || row.state !== "NOT_EXECUTED")
    ) {
      fail("RESULT_BLOCKED_BY_INVALID", "blockedBy must reference an earlier NOT_EXECUTED row.", {
        rowId: row.id,
        blockedBy: row.blockedBy,
      });
    }
    if (row.state === "NOT_EXECUTED" && BLOCKING_REASON_CODES.has(row.reasonCode)) {
      if (row.reasonCode === RESULT_REASON_CODES.UPSTREAM_STAGE_FAILED && !row.blockedBy) {
        fail("RESULT_BLOCKED_BY_REQUIRED", "Upstream stage propagation requires blockedBy.", {
          rowId: row.id,
        });
      }
      if (row.reasonCode === RESULT_REASON_CODES.UPSTREAM_FILE_FAILED && !row.blockedBy) {
        fail("RESULT_BLOCKED_BY_REQUIRED", "Upstream file propagation requires blockedBy.", {
          rowId: row.id,
        });
      }
      if (row.reasonCode === RESULT_REASON_CODES.UPSTREAM_OPERATION_FAILED && !row.blockedBy) {
        fail("RESULT_BLOCKED_BY_REQUIRED", "Upstream operation propagation requires blockedBy.", {
          rowId: row.id,
        });
      }
    }
  }
  const recomputedState = recomputeModelState(model);
  if (model.state !== recomputedState) {
    fail("RESULT_STATE_STALE", "Result model state does not match its rows.", {
      state: model.state,
      expectedState: recomputedState,
    });
  }
  if (model.summary != null && !skipSummary) {
    const summary = summarizeResultModel({ ...model, summary: null });
    if (JSON.stringify(model.summary) !== JSON.stringify(summary)) {
      fail("RESULT_SUMMARY_STALE", "Result model summary does not match rows.");
    }
  }
  return model;
}

export function isValidResultModel(model) {
  try {
    validateResultModel(model);
    return true;
  } catch (error) {
    if (error instanceof ResultModelValidationError) return false;
    throw error;
  }
}

export const resultRowId = Object.freeze({
  file: (fileId) => rowId("file", fileId),
  stage: (fileId, stageId) => rowId("stage", fileId, stageId),
  operation: (fileId, stageId, operationId) => rowId("operation", fileId, stageId, operationId),
  action: (fileId, stageId, actionId) => rowId("operation", fileId, stageId, actionId),
});

function resolveRowId(selector) {
  if (typeof selector === "string") return selector;
  if (!selector || typeof selector !== "object") {
    fail("RESULT_ROW_SELECTOR_INVALID", "A row selector must be an id or selector object.");
  }
  if (typeof selector.rowId === "string") return selector.rowId;
  if (typeof selector.id === "string" && selector.id.includes(":")) return selector.id;
  const level = selector.level;
  if (level === "file") return resultRowId.file(selector.fileId ?? selector.sourceId);
  if (level === "stage") return resultRowId.stage(
    selector.fileId,
    selector.stageId ?? selector.sourceId,
  );
  if (level === "operation" || level === "action") return resultRowId.operation(
    selector.fileId,
    selector.stageId,
    selector.operationId ?? selector.sourceId,
  );
  fail("RESULT_ROW_SELECTOR_INVALID", "A selector object requires a valid level.", { selector });
}

export function rowSelectorId(selector) {
  return resolveRowId(selector);
}

export function resultRowsAt(model, level) {
  validateResultModel(model);
  if (!RESULT_LEVEL_SET.has(level)) {
    fail("RESULT_LEVEL_INVALID", `Unknown result row level ${JSON.stringify(level)}.`, { level });
  }
  return model.rows.filter((row) => row.level === level).map(clone);
}

// Small naming aliases keep the integration runner readable while the core
// API remains the explicit pure functions above.
export const buildResultModel = createResultModel;
export const applyResult = recordResult;
export const resultSummary = summarizeResultModel;

export const recordFileResult = (model, fileId, outcome) => recordResult(
  model,
  resultRowId.file(fileId),
  outcome,
);
export const recordStageResult = (model, fileId, stageId, outcome) => recordResult(
  model,
  resultRowId.stage(fileId, stageId),
  outcome,
);
export const recordOperationResult = (model, fileId, stageId, operationId, outcome) => recordResult(
  model,
  resultRowId.operation(fileId, stageId, operationId),
  outcome,
);
