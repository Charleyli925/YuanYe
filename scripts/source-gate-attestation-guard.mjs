import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { INFRA_SENSITIVE_TAG, isInfraSensitiveTest } from "./playwright-retry-policy.mjs";

export const REQUIRED_PRODUCT_FLAKY_SUITES = Object.freeze([
  "browser-shard-1-of-3",
  "browser-shard-2-of-3",
  "browser-shard-3-of-3",
  "electron-native-shard-1-of-3",
  "electron-native-shard-2-of-3",
  "electron-native-shard-3-of-3",
  "electron-ai",
]);

export const PRODUCT_SOURCE_STEP_NAMES = Object.freeze(new Set([
  "Run full Node suite",
  "Run static checks and build the shared web renderer",
  "Run native Electron suite",
  "Run deterministic AI closed-loop suite",
  "Run shard-1-of-3",
  "Run shard-2-of-3",
  "Run shard-3-of-3",
  "Run dom-editing-compatibility",
]));

export const TRUSTED_TRIAGE_ASSOCIATIONS = Object.freeze(new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]));

export const FLAKY_EVIDENCE_SCHEMA_VERSION = 2;

const ENVIRONMENT_STEP_PATTERN = /(?:npm ci|Install npm|Playwright|preflight|Restore Electron|hosted renderer|system dependencies|Install Playwright)/iu;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TRIAGE_COMMENT_PATTERN = /<!--\s*pageroot-ci-triage\b([\s\S]*?)-->/u;
const AGGREGATE_JOB_NAMES = new Set(["release-gate", "pr-feedback"]);

export function classifyFlakyTest(test, spec = {}) {
  const title = `${spec.title || ""} ${test?.title || ""}`.trim();
  const tags = [
    ...(Array.isArray(test?.tags) ? test.tags : []),
    ...(Array.isArray(spec?.tags) ? spec.tags : []),
  ];
  return isInfraSensitiveTest({ title, tags });
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function bucketCounts(bucket) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return null;
  const failed = nonNegativeInteger(bucket.failed);
  const flaky = nonNegativeInteger(bucket.flaky);
  const retries = nonNegativeInteger(bucket.retries);
  if (failed == null || flaky == null || retries == null) return null;
  return { failed, flaky, retries };
}

export function inspectFlakyRecord(record, expectedSuite = record?.suite) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_invalid" });
  }
  if (record.schemaVersion !== FLAKY_EVIDENCE_SCHEMA_VERSION) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_invalid" });
  }
  if (!expectedSuite || record.suite !== expectedSuite) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_invalid" });
  }
  const total = nonNegativeInteger(record.total);
  const passed = nonNegativeInteger(record.passed);
  const failed = nonNegativeInteger(record.failed);
  const flaky = nonNegativeInteger(record.flaky);
  const skipped = nonNegativeInteger(record.skipped);
  const retries = nonNegativeInteger(record.retries);
  const product = bucketCounts(record.product);
  const infra = bucketCounts(record.infra);
  if (
    total == null
    || passed == null
    || failed == null
    || flaky == null
    || skipped == null
    || retries == null
    || !product
    || !infra
  ) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_invalid" });
  }
  if (total === 0) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_empty" });
  }
  if (passed + failed + flaky + skipped !== total) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_unreconciled" });
  }
  if (product.failed + infra.failed !== failed) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_unreconciled" });
  }
  if (product.flaky + infra.flaky !== flaky) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_unreconciled" });
  }
  if (product.retries + infra.retries !== retries) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_unreconciled" });
  }
  if (passed === 0 && failed === 0 && flaky === 0) {
    return Object.freeze({ ok: false, reason: "product_flaky_evidence_all_skipped" });
  }
  return Object.freeze({
    ok: true,
    reason: "product_flaky_record_valid",
    product,
    infra,
    total,
    passed,
    failed,
    flaky,
    skipped,
    retries,
  });
}

export function evaluateProductFlakyEvidence(records, { requiredSuites = REQUIRED_PRODUCT_FLAKY_SUITES } = {}) {
  const bySuite = new Map();
  for (const record of records || []) {
    if (record?.suite) bySuite.set(record.suite, record);
  }
  const missing = requiredSuites.filter((suite) => !bySuite.has(suite));
  if (missing.length > 0) {
    return Object.freeze({
      ok: false,
      reason: "product_flaky_evidence_missing",
      missing,
      product: Object.freeze({ failed: 0, flaky: 0, retries: 0 }),
    });
  }
  let failed = 0;
  let flaky = 0;
  let retries = 0;
  for (const suite of requiredSuites) {
    const inspected = inspectFlakyRecord(bySuite.get(suite), suite);
    if (!inspected.ok) {
      return Object.freeze({
        ok: false,
        reason: inspected.reason,
        missing: [],
        invalidSuite: suite,
        product: Object.freeze({ failed: 0, flaky: 0, retries: 0 }),
      });
    }
    failed += inspected.product.failed;
    flaky += inspected.product.flaky;
    retries += inspected.product.retries;
  }
  if (failed > 0 || flaky > 0 || retries > 0) {
    return Object.freeze({
      ok: false,
      reason: "product_contract_retry_or_flake",
      missing: [],
      product: Object.freeze({ failed, flaky, retries }),
    });
  }
  return Object.freeze({
    ok: true,
    reason: "product_contract_clean",
    missing: [],
    product: Object.freeze({ failed: 0, flaky: 0, retries: 0 }),
  });
}

export function isProductSourceStep(stepName) {
  return PRODUCT_SOURCE_STEP_NAMES.has(String(stepName || ""));
}

export function isEnvironmentStep(stepName) {
  return ENVIRONMENT_STEP_PATTERN.test(String(stepName || ""));
}

export function isAggregateJobName(jobName) {
  return AGGREGATE_JOB_NAMES.has(String(jobName || ""));
}

export function classifyFailedJob(job) {
  if (!job || job.conclusion !== "failure") return null;
  if (isAggregateJobName(job.name)) return "aggregate";
  const failedSteps = (job.steps || []).filter((step) => step?.conclusion === "failure");
  if (failedSteps.some((step) => isProductSourceStep(step.name))) return "product";
  if (failedSteps.length > 0 && failedSteps.every((step) => isEnvironmentStep(step.name))) {
    return "ci_environment";
  }
  return "untriaged";
}

function parseTriageFields(body) {
  const match = TRIAGE_COMMENT_PATTERN.exec(String(body || ""));
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator <= 0) return null;
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(Boolean),
  );
}

export function parseTriageRecords(comments, { now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const records = [];
  for (const comment of comments || []) {
    if (!TRUSTED_TRIAGE_ASSOCIATIONS.has(String(comment?.author_association || ""))) continue;
    const fields = parseTriageFields(comment?.body);
    if (!fields) continue;
    if (fields.schemaVersion !== "1") continue;
    if (fields.classification !== "ci_environment") continue;
    if (!SHA_PATTERN.test(fields.sha || "")) continue;
    const runId = Number(fields.runId);
    const attempt = Number(fields.attempt);
    const expiresAt = Date.parse(fields.expiresAt || "");
    const job = String(fields.job || "").trim();
    const reason = String(fields.reason || "").trim();
    if (!Number.isInteger(runId) || runId <= 0) continue;
    if (!Number.isInteger(attempt) || attempt <= 0) continue;
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    if (!job || !reason) continue;
    records.push(Object.freeze({
      sha: fields.sha,
      runId,
      attempt,
      job,
      signature: String(fields.signature || "").trim() || null,
      reason,
      classification: "ci_environment",
      expiresAt: new Date(expiresAt).toISOString(),
      authorAssociation: String(comment.author_association),
    }));
  }
  return Object.freeze(records);
}

function triageCoversFailure(records, { sha, runId, attempt, job, signature }) {
  return (records || []).some((record) => (
    record.sha === sha
    && record.runId === Number(runId)
    && record.attempt === Number(attempt)
    && record.job === String(job || "")
    && record.classification === "ci_environment"
    && (!record.signature || record.signature === String(signature || ""))
  ));
}

export function evaluateShaFailureHistory({
  headSha,
  currentRunId,
  currentAttempt,
  jobsByRunAttempt = {},
  triageRecords = [],
} = {}) {
  if (!SHA_PATTERN.test(headSha || "")) {
    throw new Error("headSha must be a 40-character Git SHA.");
  }
  const runId = Number(currentRunId);
  const attempt = Number(currentAttempt);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error("currentRunId must be a positive integer.");
  }
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new Error("currentAttempt must be a positive integer.");
  }
  const untriaged = [];
  for (const [key, jobs] of Object.entries(jobsByRunAttempt)) {
    const [historyRunId, historyAttempt] = key.split(":").map(Number);
    if (historyRunId === runId && historyAttempt === attempt) continue;
    if (!Number.isInteger(historyRunId) || !Number.isInteger(historyAttempt)) continue;
    for (const job of jobs || []) {
      const classification = classifyFailedJob(job);
      if (!classification) continue;
      if (classification === "ci_environment" || classification === "aggregate") continue;
      const failedStep = (job.steps || []).find((step) => step?.conclusion === "failure");
      if (triageCoversFailure(triageRecords, {
        sha: headSha,
        runId: historyRunId,
        attempt: historyAttempt,
        job: job.name,
        signature: failedStep?.name,
      })) continue;
      untriaged.push(Object.freeze({
        runId: historyRunId,
        attempt: historyAttempt,
        job: String(job.name || "unknown"),
        classification,
      }));
    }
  }
  if (untriaged.length > 0) {
    return Object.freeze({
      ok: false,
      reason: "untriaged_product_failure_same_sha",
      untriagedFailuresForSameSha: untriaged.length,
      failures: Object.freeze(untriaged),
    });
  }
  return Object.freeze({
    ok: true,
    reason: "same_sha_clean_or_triaged",
    untriagedFailuresForSameSha: 0,
    failures: Object.freeze([]),
  });
}

export async function loadFlakyEvidence(evidenceDir) {
  const entries = await readdir(evidenceDir, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith("-flaky.json")) continue;
    const payload = JSON.parse(await readFile(path.join(evidenceDir, entry.name), "utf8"));
    records.push(payload);
  }
  return records;
}

export { INFRA_SENSITIVE_TAG };
