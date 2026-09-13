// Strict, pure oracles for the private real-HTML capability census.
// Callers must normalize SourceIndex and live DOM evidence before calling.

export const CAPABILITY_COVERAGE_FRACTION = 0.6;
export const CAPABILITY_STABLE_ID_PATTERN = /^pr1_[0-9a-f]{32}$/u;

export const CAPABILITY_MANIFEST_REASONS = Object.freeze({
  SOURCE_ID_MISSING: "SOURCE_ID_MISSING",
  INVALID_STABLE_ID: "INVALID_STABLE_ID",
  DUPLICATE_STABLE_ID: "DUPLICATE_STABLE_ID",
  SOURCE_ID_NOT_FOUND: "SOURCE_ID_NOT_FOUND",
  LIVE_DOM_MISSING: "LIVE_DOM_MISSING",
  LIVE_DUPLICATE_STABLE_ID: "LIVE_DUPLICATE_STABLE_ID",
  HIDDEN_ELEMENT: "HIDDEN_ELEMENT",
  INERT_ELEMENT: "INERT_ELEMENT",
  DETACHED_ELEMENT: "DETACHED_ELEMENT",
  LIVE_RUNTIME_GENERATED: "LIVE_RUNTIME_GENERATED",
  NO_CAPABILITY: "NO_CAPABILITY",
  LIVE_IDENTITY_MISMATCH: "LIVE_IDENTITY_MISMATCH",
  CANONICALIZED_TO_OPERATION_ANCESTOR: "CANONICALIZED_TO_OPERATION_ANCESTOR",
});

export const CAPABILITY_MATRIX_ROW_KINDS = Object.freeze({
  OBSERVATION: "capability-observation",
  BEHAVIOR: "actual-behavior",
});

export const CAPABILITY_MATRIX_REASONS = Object.freeze({
  OBSERVED: "OBSERVED",
  BEHAVIOR_OBSERVED: "BEHAVIOR_OBSERVED",
  UNASSIGNED_BEHAVIOR: "UNASSIGNED_BEHAVIOR",
  COVERAGE_BELOW_THRESHOLD: "COVERAGE_BELOW_THRESHOLD",
  MISSING_REGION: "MISSING_REGION",
  MISSING_TAB: "MISSING_TAB",
  MISSING_MAJOR_TYPE: "MISSING_MAJOR_TYPE",
  MISSING_BEHAVIOR_FAMILY: "MISSING_BEHAVIOR_FAMILY",
  MATRIX_ROW_FAILED: "MATRIX_ROW_FAILED",
  MATRIX_ROW_NOT_EXECUTED: "MATRIX_ROW_NOT_EXECUTED",
  MATRIX_ROW_BLOCKED: "MATRIX_ROW_BLOCKED",
  MATRIX_ROW_UNKNOWN: "MATRIX_ROW_UNKNOWN",
  ROW_REASON_EMPTY: "ROW_REASON_EMPTY",
  HARNESS_TIMEOUT: "HARNESS_TIMEOUT",
  ORIGINAL_SOURCE_HASH_CHANGED: "ORIGINAL_SOURCE_HASH_CHANGED",
  ORIGINAL_SOURCE_SIZE_CHANGED: "ORIGINAL_SOURCE_SIZE_CHANGED",
});

const NEGATIVE_STATES = new Set(["FAIL", "NOT_EXECUTED", "BLOCKED", "UNKNOWN"]);

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))];
}

function excluded(elementId, ...reasons) {
  return { elementId: elementId || null, reasons: unique(reasons) };
}

export function createCapabilityManifest({ sourceIndex, liveDom }) {
  const sourceElements = Array.isArray(sourceIndex?.elements) ? sourceIndex.elements : [];
  const liveElements = Array.isArray(liveDom) ? liveDom : [];
  const sourceCounts = new Map();
  const liveMap = new Map();
  for (const source of sourceElements) {
    if (typeof source?.pagerootId === "string") {
      sourceCounts.set(source.pagerootId, (sourceCounts.get(source.pagerootId) || 0) + 1);
    }
  }
  for (const live of liveElements) {
    if (!liveMap.has(live?.stableId)) liveMap.set(live?.stableId, []);
    liveMap.get(live?.stableId).push(live);
  }
  const entries = [];
  const rejected = [];
  for (const source of sourceElements) {
    const id = source?.pagerootId;
    if (!id) {
      rejected.push(excluded(null, CAPABILITY_MANIFEST_REASONS.SOURCE_ID_MISSING));
      continue;
    }
    if (!CAPABILITY_STABLE_ID_PATTERN.test(id) || source.pagerootIdentityStatus !== "valid") {
      rejected.push(excluded(id, CAPABILITY_MANIFEST_REASONS.INVALID_STABLE_ID));
      continue;
    }
    if (sourceCounts.get(id) !== 1) {
      rejected.push(excluded(id, CAPABILITY_MANIFEST_REASONS.DUPLICATE_STABLE_ID));
      continue;
    }
    const matches = liveMap.get(id) || [];
    if (matches.length === 0) {
      rejected.push(excluded(id, CAPABILITY_MANIFEST_REASONS.LIVE_DOM_MISSING));
      continue;
    }
    if (matches.length !== 1) {
      rejected.push(excluded(id, CAPABILITY_MANIFEST_REASONS.LIVE_DUPLICATE_STABLE_ID));
      continue;
    }
    const live = matches[0];
    const reasons = [];
    if (live.isConnected !== true) reasons.push(CAPABILITY_MANIFEST_REASONS.DETACHED_ELEMENT);
    if (live.visible !== true) reasons.push(CAPABILITY_MANIFEST_REASONS.HIDDEN_ELEMENT);
    if (live.inert === true) reasons.push(CAPABILITY_MANIFEST_REASONS.INERT_ELEMENT);
    if (live.runtimeGenerated === true) reasons.push(CAPABILITY_MANIFEST_REASONS.LIVE_RUNTIME_GENERATED);
    if (live.tag && String(live.tag).toLowerCase() !== String(source.tagName).toLowerCase()) {
      reasons.push(CAPABILITY_MANIFEST_REASONS.LIVE_IDENTITY_MISMATCH);
    }
    const capabilityFamilies = unique(live.capabilityFamilies || []);
    if (capabilityFamilies.length === 0) reasons.push(CAPABILITY_MANIFEST_REASONS.NO_CAPABILITY);
    if (reasons.length > 0) {
      rejected.push(excluded(id, ...reasons));
      continue;
    }
    entries.push({
      elementId: id,
      tag: String(source.tagName).toLowerCase(),
      type: live.type || String(source.tagName).toLowerCase(),
      parentId: source.parentId || null,
      sourceOrder: source.sourceOrder,
      tabId: live.tabId || null,
      region: live.region,
      scrollContainer: live.scrollContainer || null,
      capabilityFamilies,
      behaviorFamilies: unique(live.behaviorFamilies || source.behaviorFamilies || []),
    });
  }
  const sourceIds = new Set(sourceElements.map((source) => source?.pagerootId).filter(Boolean));
  for (const [id] of liveMap) {
    if (CAPABILITY_STABLE_ID_PATTERN.test(id || "") && !sourceIds.has(id)) {
      rejected.push(excluded(id, CAPABILITY_MANIFEST_REASONS.SOURCE_ID_NOT_FOUND));
    }
  }
  entries.sort((left, right) => (
    String(left.tabId || "").localeCompare(String(right.tabId || ""))
    || left.sourceOrder - right.sourceOrder
    || left.elementId.localeCompare(right.elementId)
  ));
  return {
    schemaVersion: 1,
    entries,
    excluded: rejected,
    denominator: entries.length,
    capabilityFamilies: unique(entries.flatMap((entry) => entry.capabilityFamilies)),
    behaviorFamilies: unique(entries.flatMap((entry) => entry.behaviorFamilies)),
    regions: unique(entries.map((entry) => entry.region)),
    tabs: unique(entries.map((entry) => entry.tabId || "__default__")),
    majorTypes: unique(entries.map((entry) => entry.type)),
    tags: unique(entries.map((entry) => entry.tag)),
    metadata: { noNodeIdFallback: true },
  };
}

export function selectCapabilityTargets(manifest, threshold = CAPABILITY_COVERAGE_FRACTION) {
  const selected = [];
  const ids = new Set();
  const add = (entry) => {
    if (!entry || ids.has(entry.elementId)) return;
    ids.add(entry.elementId);
    selected.push(entry);
  };
  const dimensions = [
    ...manifest.capabilityFamilies.map((value) => (entry) => entry.capabilityFamilies.includes(value)),
    ...["top", "middle", "bottom"].map((value) => (entry) => entry.region === value),
    ...manifest.tabs.map((value) => (entry) => (entry.tabId || "__default__") === value),
    ...manifest.majorTypes.map((value) => (entry) => entry.type === value),
  ];
  for (const matches of dimensions) add(manifest.entries.find(matches));
  const required = Math.ceil(manifest.entries.length * threshold);
  for (const entry of manifest.entries) {
    if (selected.length >= required) break;
    add(entry);
  }
  return {
    threshold,
    required,
    selected,
    failedElementIds: [],
    replacements: [],
    order: "tabId/sourceOrder/StableID",
  };
}

export function recordCapabilityTargetOutcome(selection, elementId, outcome) {
  return {
    ...selection,
    selected: selection.selected.map((entry) => (
      entry.elementId === elementId ? { ...entry, outcome: { ...outcome } } : entry
    )),
    failedElementIds: outcome.state === "FAIL"
      ? unique([...selection.failedElementIds, elementId])
      : selection.failedElementIds,
    replacements: [],
  };
}

function failure(code, details = {}) {
  return { code, details };
}

export function createCapabilityMatrix({
  manifest,
  selection,
  observations = [],
  behaviors = [],
  requiredBehaviorFamilies = manifest.behaviorFamilies,
  originalSource,
  observedSource,
  harnessState = "READY",
}) {
  const failures = [];
  if (harnessState === "HARNESS_TIMEOUT") failures.push(failure(CAPABILITY_MATRIX_REASONS.HARNESS_TIMEOUT));
  for (const row of [...observations, ...behaviors]) {
    if (typeof row.reasonCode !== "string" || row.reasonCode.trim() === "") {
      failures.push(failure(CAPABILITY_MATRIX_REASONS.ROW_REASON_EMPTY, { elementId: row.elementId }));
    }
    if (NEGATIVE_STATES.has(row.state)) {
      const code = row.state === "NOT_EXECUTED"
        ? CAPABILITY_MATRIX_REASONS.MATRIX_ROW_NOT_EXECUTED
        : row.state === "BLOCKED"
          ? CAPABILITY_MATRIX_REASONS.MATRIX_ROW_BLOCKED
          : row.state === "UNKNOWN"
            ? CAPABILITY_MATRIX_REASONS.MATRIX_ROW_UNKNOWN
            : CAPABILITY_MATRIX_REASONS.MATRIX_ROW_FAILED;
      failures.push(failure(code, { elementId: row.elementId }));
    }
  }
  const coveredElementIds = unique(observations.filter((row) => row.state === "PASS")
    .map((row) => row.elementId));
  const coverage = manifest.entries.length === 0 ? 0 : coveredElementIds.length / manifest.entries.length;
  if (coverage < (selection.threshold ?? CAPABILITY_COVERAGE_FRACTION)) {
    failures.push(failure(CAPABILITY_MATRIX_REASONS.COVERAGE_BELOW_THRESHOLD, { coverage }));
  }
  const coveredEntries = manifest.entries.filter((entry) => coveredElementIds.includes(entry.elementId));
  for (const region of ["top", "middle", "bottom"]) {
    if (!coveredEntries.some((entry) => entry.region === region)) {
      failures.push(failure(CAPABILITY_MATRIX_REASONS.MISSING_REGION, { region }));
    }
  }
  for (const tab of manifest.tabs) {
    if (!coveredEntries.some((entry) => (entry.tabId || "__default__") === tab)) {
      failures.push(failure(CAPABILITY_MATRIX_REASONS.MISSING_TAB, { tab }));
    }
  }
  for (const majorType of manifest.majorTypes) {
    if (!coveredEntries.some((entry) => entry.type === majorType)) {
      failures.push(failure(CAPABILITY_MATRIX_REASONS.MISSING_MAJOR_TYPE, { majorType }));
    }
  }
  const passedBehaviors = new Set(behaviors.filter((row) => (
    row.assigned !== false && row.state === "PASS"
  )).map((row) => row.behaviorFamily));
  for (const behaviorFamily of requiredBehaviorFamilies) {
    if (!passedBehaviors.has(behaviorFamily)) {
      failures.push(failure(CAPABILITY_MATRIX_REASONS.MISSING_BEHAVIOR_FAMILY, { behaviorFamily }));
    }
  }
  if (originalSource?.hash !== observedSource?.hash) {
    failures.push(failure(CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_HASH_CHANGED));
  }
  if (originalSource?.size !== observedSource?.size) {
    failures.push(failure(CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_SIZE_CHANGED));
  }
  return {
    schemaVersion: 1,
    observations: observations.map((row) => ({ kind: CAPABILITY_MATRIX_ROW_KINDS.OBSERVATION, ...row })),
    actualBehaviors: behaviors.map((row) => ({ kind: CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR, ...row })),
    verdict: { ok: failures.length === 0, coverage, coveredElementIds, failures },
  };
}

export const evaluateCapabilityMatrix = createCapabilityMatrix;
