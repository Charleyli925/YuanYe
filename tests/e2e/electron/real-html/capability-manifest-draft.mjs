export const CAPABILITY_EXPECTATION_RULES = Object.freeze({
  selection: "Unique visible authored Stable ID is selectable.",
  text: "SourceIndex editable-island eligibility is required for native text editing.",
  format: "Formatting follows native text-edit eligibility.",
  comment: "A reachable authored selection supports comments.",
  copy: "Copy is conditional on source authority and click-time runtime subtree equivalence.",
  "move-up": "Move-up is available only when a preceding authored sibling exists.",
  "move-down": "Move-down is available only when a following authored sibling exists.",
  delete: "A reachable authored selection supports structural deletion.",
});

const FAMILIES = Object.freeze(Object.keys(CAPABILITY_EXPECTATION_RULES));

function liveState(observation, family) {
  if (!observation) return { state: "UNKNOWN", reason: "PROBE_NOT_COMPLETED" };
  if (family === "copy") {
    if (observation.copyAvailability === "available") {
      return { state: "AVAILABLE", reason: observation.copyReason || "available" };
    }
    if (observation.copyAvailability === "unsupported") {
      return { state: "DENIED", reason: observation.copyReason || "COPY_REASON_MISSING" };
    }
    return {
      state: "UNKNOWN",
      reason: observation.copyReason || "COPY_AVAILABILITY_UNKNOWN",
    };
  }
  return observation.capabilityFamilies?.includes(family)
    ? { state: "AVAILABLE", reason: "CAPABILITY_OBSERVED" }
    : { state: "DENIED", reason: "CAPABILITY_NOT_OBSERVED" };
}

function authoredSiblings(sourceElements, operation) {
  return sourceElements.filter((entry) => (
    entry?.pagerootIdentityStatus === "valid"
    && entry.parentId === operation.parentId
  )).sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function sourceState(sourceElements, operation, family) {
  if (!operation) return { state: "UNKNOWN", reason: "OPERATION_SOURCE_IDENTITY_UNRESOLVED" };
  if (family === "text" || family === "format") {
    return operation.sourceEditable === true
      ? { state: "ELIGIBLE", reason: "SOURCE_EDITABLE_ISLAND" }
      : { state: "INELIGIBLE", reason: "SOURCE_NOT_EDITABLE_ISLAND" };
  }
  if (family === "copy") {
    return operation.boundarySafe === true
      ? { state: "ELIGIBLE", reason: "SOURCE_BOUNDARY_SAFE_RUNTIME_PROOF_REQUIRED" }
      : { state: "UNKNOWN", reason: "SOURCE_BOUNDARY_OR_RUNTIME_PROOF_REQUIRED" };
  }
  if (family === "move-up" || family === "move-down") {
    const siblings = authoredSiblings(sourceElements, operation);
    const index = siblings.findIndex((entry) => entry.pagerootId === operation.pagerootId);
    if (index < 0) return { state: "UNKNOWN", reason: "SOURCE_SIBLING_IDENTITY_UNRESOLVED" };
    const available = family === "move-up" ? index > 0 : index < siblings.length - 1;
    return available
      ? { state: "ELIGIBLE", reason: "AUTHORED_SIBLING_AVAILABLE" }
      : { state: "INELIGIBLE", reason: "AUTHORED_SIBLING_UNAVAILABLE" };
  }
  return { state: "ELIGIBLE", reason: "UNIQUE_REACHABLE_AUTHORED_TARGET" };
}

function contractState(family) {
  return ["copy", "move-up", "move-down", "delete"].includes(family)
    ? { state: "CONDITIONAL", reason: CAPABILITY_EXPECTATION_RULES[family] }
    : { state: "EXPECTED", reason: CAPABILITY_EXPECTATION_RULES[family] };
}

export function attachOperationGroupsToAuthoredDenominator({
  authoredDenominator,
  operationGroups,
  liveDom,
  aliases,
}) {
  const probeToOperation = new Map();
  for (const observation of liveDom || []) {
    if (observation?.probeStableId && observation?.operationStableId) {
      probeToOperation.set(observation.probeStableId, observation.operationStableId);
    }
  }
  for (const alias of aliases || []) {
    probeToOperation.set(alias.probeStableId, alias.operationStableId);
  }
  const groupsById = new Map((operationGroups || []).map((group) => [
    group.operationStableId,
    group,
  ]));
  const evidenceByProbe = new Map((operationGroups || []).flatMap((group) => (
    (group.probes || []).map((probe) => [probe.probeStableId, probe])
  )));
  return (authoredDenominator || []).map((entry) => {
    const operationStableId = probeToOperation.get(entry.probeStableId) || null;
    const probeEvidence = evidenceByProbe.get(entry.probeStableId) || null;
    return {
      ...entry,
      operationStableId,
      liveSnapshot: probeEvidence?.liveSnapshot || null,
      expectations: probeEvidence?.expectations
        || groupsById.get(operationStableId)?.expectations
        || [],
      assignedBehaviors: [],
    };
  });
}

export function capabilityExpectationRows({ sourceElements, operation, observation }) {
  return FAMILIES.map((family) => {
    const contract = contractState(family);
    const source = sourceState(sourceElements, operation, family);
    const live = liveState(observation, family);
    const deterministicExpected = contract.state === "EXPECTED" && source.state !== "UNKNOWN";
    const expectedAvailable = source.state === "ELIGIBLE";
    const consistent = deterministicExpected
      && ((expectedAvailable && live.state === "AVAILABLE")
        || (!expectedAvailable && live.state === "DENIED"));
    return {
      family,
      contract,
      source,
      live,
      reviewStatus: consistent ? "CONSISTENT" : "PENDING_REVIEW",
    };
  });
}

export function capabilityManifestDraftIssues(draft) {
  const issues = [];
  if (!Array.isArray(draft?.authoredDenominator) || draft.authoredDenominator.length === 0) {
    issues.push("AUTHORED_DENOMINATOR_EMPTY");
  }
  if ((draft?.unresolvedProbes || []).length > 0) issues.push("UNRESOLVED_PROBES_PRESENT");
  if ((draft?.authoredDenominator || []).some((entry) => !entry.operationStableId)) {
    issues.push("UNRESOLVED_DENOMINATOR_IDENTITIES");
  }
  if ((draft?.authoredDenominator || []).some((entry) => {
    if (!Array.isArray(entry.expectations) || entry.expectations.length !== FAMILIES.length) {
      return true;
    }
    const families = new Set(entry.expectations.map((expectation) => expectation?.family));
    return families.size !== FAMILIES.length
      || FAMILIES.some((family) => !families.has(family));
  })) issues.push("INCOMPLETE_CAPABILITY_EXPECTATIONS");
  if (
    (draft?.operationGroups || []).some((group) => (
      group.expectations.some((entry) => entry.reviewStatus === "PENDING_REVIEW")
    ))
    || (draft?.authoredDenominator || []).some((entry) => (
      (entry.expectations || []).some((expectation) => (
        expectation.reviewStatus === "PENDING_REVIEW"
      ))
    ))
  ) issues.push("CAPABILITY_EXPECTATIONS_PENDING_REVIEW");
  if ((draft?.observationConflicts || []).length > 0) {
    issues.push("CAPABILITY_OBSERVATION_CONFLICTS_PENDING_REVIEW");
  }
  return issues;
}

export function createCapabilityManifestDraft({
  authoredDenominator,
  operationGroups,
  aliases = [],
  observationConflicts = [],
  unresolvedProbes = [],
  exclusions = [],
}) {
  const denominator = authoredDenominator || [];
  const draft = {
    schemaVersion: 1,
    reviewStatus: "DRAFT",
    capabilityRules: CAPABILITY_EXPECTATION_RULES,
    coverageRequirement: 0.6,
    authoredDenominator: denominator,
    operationGroups: operationGroups || [],
    aliases,
    observationConflicts,
    unresolvedProbes,
    exclusions,
    coveragePlan: {
      denominator: denominator.length,
      required: Math.ceil(denominator.length * 0.6),
      assigned: 0,
      status: "PENDING_REVIEW",
      regions: [...new Set(denominator.map((entry) => entry.region))],
      tabs: [...new Set(denominator.map((entry) => entry.tabId || "__default__"))],
      majorTypes: [...new Set(denominator.map((entry) => entry.type))],
    },
  };
  return { ...draft, issues: capabilityManifestDraftIssues(draft) };
}

export function capabilityPreflightFileStatus({
  environmentBlocked = false,
  discoveryFailed = false,
  cleanupFailed = false,
  workingCopyUnchanged = true,
  originalUnchanged = true,
  draftIssues = [],
} = {}) {
  if (environmentBlocked) return "ENVIRONMENT_BLOCKED";
  if (
    discoveryFailed
    || cleanupFailed
    || !workingCopyUnchanged
    || !originalUnchanged
    || draftIssues.includes("AUTHORED_DENOMINATOR_EMPTY")
    || draftIssues.includes("UNRESOLVED_PROBES_PRESENT")
    || draftIssues.includes("UNRESOLVED_DENOMINATOR_IDENTITIES")
    || draftIssues.includes("INCOMPLETE_CAPABILITY_EXPECTATIONS")
  ) return "DISCOVERY_ERROR";
  return "PENDING_REVIEW";
}

export function capabilityPreflightExitCode(rows) {
  return (rows || []).every((row) => (
    row.status === "PENDING_REVIEW"
    && row.originalUnchanged === true
    && row.preflightWorkingCopy?.unchanged === true
    && !row.cleanupError
  )) ? 0 : 1;
}
