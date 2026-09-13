function normalizedCssColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/u.test(normalized)) return normalized;
  const channels = normalized.match(/[\d.]+/gu)?.map(Number) || [];
  if (channels.length < 3 || channels.slice(0, 3).some((channel) => !Number.isFinite(channel))) {
    return normalized;
  }
  if (channels.length >= 4 && channels[3] !== 1) return normalized;
  return `#${channels.slice(0, 3).map((channel) => (
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")
  )).join("")}`;
}

export function evaluateExtendedFormatEvidence({
  sourceScope,
  color = false,
  expectedControlValue,
  observedControlValue,
  expectedSourceValue,
  observedInlineValue,
  observedComputedValue,
  beforeIdentity,
  afterIdentity,
} = {}) {
  const sourceScopeOk = sourceScope?.ok === true;
  const controlValueMatches = String(observedControlValue || "").toLowerCase()
    === String(expectedControlValue || "").toLowerCase();
  const inlineValueMatches = color
    ? true
    : observedInlineValue === expectedSourceValue;
  const computedValueMatches = color
    ? normalizedCssColor(observedComputedValue) === normalizedCssColor(expectedSourceValue)
    : observedComputedValue === expectedSourceValue;
  const documentIdentityUnchanged = Boolean(
    beforeIdentity?.document
    && afterIdentity?.document
    && beforeIdentity.document === afterIdentity.document,
  );
  const generationUnchanged = Boolean(
    beforeIdentity?.generation
    && afterIdentity?.generation
    && beforeIdentity.generation === afterIdentity.generation,
  );
  const conditions = {
    sourceScopeOk,
    controlValueMatches,
    inlineValueMatches,
    computedValueMatches,
    documentIdentityUnchanged,
    generationUnchanged,
  };
  const failures = [];
  if (!sourceScopeOk) failures.push("SOURCE_SCOPE_ORACLE_FAILED");
  if (!controlValueMatches) failures.push("FORMAT_CONTROL_VALUE_MISMATCH");
  if (!inlineValueMatches) failures.push("FORMAT_INLINE_VALUE_MISMATCH");
  if (!computedValueMatches) failures.push("FORMAT_COMPUTED_VALUE_MISMATCH");
  if (!documentIdentityUnchanged) failures.push("FORMAT_DOCUMENT_IDENTITY_CHANGED");
  if (!generationUnchanged) failures.push("FORMAT_GENERATION_CHANGED");
  return {
    ok: failures.length === 0,
    conditions,
    failures,
    sourceScope,
  };
}

export function formatFailureRows({
  formatCases,
  failedIndex,
  entry,
  operationId,
  operationFailure,
  recoveryFailure = null,
} = {}) {
  const failedCase = formatCases[failedIndex];
  const rows = [{
    elementId: entry.elementId,
    capabilityFamily: "format",
    behaviorFamily: failedCase.behaviorFamily,
    operationId,
    assigned: true,
    state: "FAIL",
    reasonCode: recoveryFailure
      ? "FORMAT_SESSION_RECOVERY_FAILED"
      : operationFailure?.code || "EXTENDED_FORMAT_BEHAVIOR_FAILED",
    details: {
      operationFailure,
      ...(recoveryFailure ? { recoveryFailure } : {}),
    },
  }];
  if (recoveryFailure) {
    for (const remaining of formatCases.slice(failedIndex + 1)) {
      rows.push({
        elementId: entry.elementId,
        capabilityFamily: "format",
        behaviorFamily: remaining.behaviorFamily,
        operationId: `format-${remaining.behaviorFamily}`,
        assigned: true,
        state: "NOT_EXECUTED",
        reasonCode: "FORMAT_SESSION_RECOVERY_FAILED",
        details: { blockedByOperationId: operationId },
      });
    }
  }
  return { rows, stop: Boolean(recoveryFailure) };
}
