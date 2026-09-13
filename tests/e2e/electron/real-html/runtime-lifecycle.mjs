import { REAL_HTML_OPERATION_IDS } from "./plan.mjs";

export const RUNTIME_LIFECYCLE_REASONS = Object.freeze({
  ORDINARY_EDIT_RETAINED_RUNTIME: "ORDINARY_EDIT_RETAINED_RUNTIME",
  NO_CANDIDATE_OBSERVED_AFTER_SETTLE: "NO_CANDIDATE_OBSERVED_AFTER_SETTLE",
  STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE: "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE",
  RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE: "RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE",
  SOURCE_RELOAD_SWITCHED_GENERATION: "SOURCE_RELOAD_SWITCHED_GENERATION",
  NO_DYNAMIC_RUNTIME_FAULT_INJECTED: "NO_DYNAMIC_RUNTIME_FAULT_INJECTED",
  STATIC_FALLBACK_NOT_REQUIRED: "STATIC_FALLBACK_NOT_REQUIRED",
  STATIC_FALLBACK_CONTRACT_OBSERVED: "STATIC_FALLBACK_CONTRACT_OBSERVED",
  RUNTIME_REBUILD_UNEXPECTED_DURING_ORDINARY_EDIT: "RUNTIME_REBUILD_UNEXPECTED_DURING_ORDINARY_EDIT",
  RUNTIME_REBUILD_NOT_OBSERVED: "RUNTIME_REBUILD_NOT_OBSERVED",
  RUNTIME_IDENTITY_EVIDENCE_INVALID: "RUNTIME_IDENTITY_EVIDENCE_INVALID",
  SOURCE_RELOAD_REBUILT_RUNTIME: "SOURCE_RELOAD_REBUILT_RUNTIME",
  CANDIDATE_CREATION_NOT_OBSERVED: "CANDIDATE_CREATION_NOT_OBSERVED",
  GENERATION_SWITCH_NOT_OBSERVED: "GENERATION_SWITCH_NOT_OBSERVED",
  DYNAMIC_RECOVERY_CONTRACT_NOT_OBSERVED: "DYNAMIC_RECOVERY_CONTRACT_NOT_OBSERVED",
  STATIC_FALLBACK_CONTRACT_INVALID: "STATIC_FALLBACK_CONTRACT_INVALID",
});

function transition(before, after) {
  const validDocument = typeof before?.document === "string"
    && before.document.trim() !== ""
    && typeof after?.document === "string"
    && after.document.trim() !== "";
  const documentChanged = validDocument
    && before.document !== after.document;
  const beforeGeneration = typeof before?.generation === "string"
    && before.generation.trim() !== ""
    ? Number(before.generation)
    : Number.NaN;
  const afterGeneration = typeof after?.generation === "string"
    && after.generation.trim() !== ""
    ? Number(after.generation)
    : Number.NaN;
  const generationAdvanced = Number.isInteger(beforeGeneration)
    && beforeGeneration > 0
    && Number.isInteger(afterGeneration)
    && afterGeneration > 0
    && afterGeneration > beforeGeneration;
  const validGeneration = Number.isInteger(beforeGeneration)
    && beforeGeneration > 0
    && Number.isInteger(afterGeneration)
    && afterGeneration > 0;
  const generationChanged = validGeneration && beforeGeneration !== afterGeneration;
  return {
    validDocument,
    validGeneration,
    documentChanged,
    generationChanged,
    generationAdvanced,
    sameDocument: validDocument && before.document === after.document,
    sameGeneration: validGeneration && beforeGeneration === afterGeneration,
  };
}

function notApplicable(exactReason, details = {}) {
  return {
    state: "NOT_APPLICABLE",
    reasonCode: "OPERATION_NOT_APPLICABLE",
    details: { exactReason, ...details },
  };
}

function pass(details = {}) {
  return { state: "PASS", details };
}

function fail(exactReason, details = {}) {
  return {
    state: "FAIL",
    reasonCode: "OPERATION_FAILED",
    details: { exactReason, ...details },
  };
}

/**
 * Build C-stage outcomes from independent observations.  Runtime recovery is
 * never inferred from `aria-readonly` or a page remaining editable.
 */
export function runtimeOperationOutcomes({
  ordinaryBefore,
  ordinaryAfter,
  reloadBefore,
  reloadAfter,
  dynamicRecovery = null,
  staticFallback = null,
  candidateNotApplicableReason = null,
  candidateEvidence = null,
} = {}) {
  const ordinary = transition(ordinaryBefore, ordinaryAfter);
  const reload = transition(reloadBefore, reloadAfter);
  const candidateCreated = candidateEvidence?.kind === "candidate-created"
    && candidateEvidence?.evidence === "candidate-id-absent-to-present"
    && typeof candidateEvidence?.candidateId === "string"
    && candidateEvidence.candidateId.trim() !== "";
  const candidateNotApplicable = candidateNotApplicableReason
    === RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE;
  const ordinaryObserved = ordinary.validDocument && ordinary.validGeneration;
  const ordinaryProvided = ordinaryBefore != null || ordinaryAfter != null;
  const ordinaryEvidenceInvalid = ordinaryProvided && !ordinaryObserved;
  const ordinaryRebuilt = ordinaryObserved
    && (ordinary.documentChanged || ordinary.generationChanged);
  const reloadRebuilt = reload.documentChanged;
  const runtimeIdentityValid = reload.validDocument
    && reload.validGeneration
    && !ordinaryEvidenceInvalid;

  let dynamic;
  if (!dynamicRecovery?.faultInjected) {
    dynamic = notApplicable(RUNTIME_LIFECYCLE_REASONS.NO_DYNAMIC_RUNTIME_FAULT_INJECTED, {
      recoveryVerified: false,
      faultInjected: false,
    });
  } else if (
    dynamicRecovery.recovered === true
    && dynamicRecovery.runtimeOutcome === "recovered"
    && dynamicRecovery.generation
  ) {
    dynamic = pass({
      exactReason: "DYNAMIC_RUNTIME_RECOVERY_CONTRACT_OBSERVED",
      recoveryVerified: true,
      runtimeOutcome: dynamicRecovery.runtimeOutcome,
      generation: dynamicRecovery.generation,
    });
  } else {
    dynamic = fail(RUNTIME_LIFECYCLE_REASONS.DYNAMIC_RECOVERY_CONTRACT_NOT_OBSERVED, {
      recoveryVerified: false,
      faultInjected: true,
      runtimeOutcome: dynamicRecovery.runtimeOutcome || null,
    });
  }

  let fallback;
  if (!staticFallback?.observed) {
    fallback = notApplicable(RUNTIME_LIFECYCLE_REASONS.STATIC_FALLBACK_NOT_REQUIRED, {
      fallbackVerified: false,
    });
  } else if (
    staticFallback.phase === "static-fallback"
    && staticFallback.renderVerified === "true"
    && staticFallback.sandbox === "allow-same-origin"
  ) {
    fallback = pass({
      exactReason: RUNTIME_LIFECYCLE_REASONS.STATIC_FALLBACK_CONTRACT_OBSERVED,
      fallbackVerified: true,
      phase: staticFallback.phase,
      sandbox: staticFallback.sandbox,
    });
  } else {
    fallback = fail(RUNTIME_LIFECYCLE_REASONS.STATIC_FALLBACK_CONTRACT_INVALID, {
      fallbackVerified: false,
      phase: staticFallback.phase || null,
      renderVerified: staticFallback.renderVerified || null,
      sandbox: staticFallback.sandbox || null,
    });
  }

  return {
    [REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD]: !runtimeIdentityValid
      ? fail(RUNTIME_LIFECYCLE_REASONS.RUNTIME_IDENTITY_EVIDENCE_INVALID, {
        ordinary,
        reload,
      })
      : ordinaryRebuilt
      ? fail(RUNTIME_LIFECYCLE_REASONS.RUNTIME_REBUILD_UNEXPECTED_DURING_ORDINARY_EDIT, {
        ordinary,
        reload,
      })
      : reloadRebuilt
        ? pass({
          exactReason: RUNTIME_LIFECYCLE_REASONS.SOURCE_RELOAD_REBUILT_RUNTIME,
          ordinaryObserved,
          ordinary,
          reload,
        })
        : fail(RUNTIME_LIFECYCLE_REASONS.RUNTIME_REBUILD_NOT_OBSERVED, {
          ordinary,
          reload,
        }),
    [REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE]: candidateNotApplicable
      ? notApplicable(candidateNotApplicableReason, {
        candidateCreated: false,
        candidateEvidence,
      })
      : candidateCreated
      ? pass({
        candidateCreated: true,
        candidateId: candidateEvidence.candidateId,
        exactReason: "CANDIDATE_CREATED",
      })
      : fail(RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED, {
        candidateCreated: false,
        candidateEvidence,
      }),
    [REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION]: reload.generationAdvanced
      ? pass({
        exactReason: RUNTIME_LIFECYCLE_REASONS.SOURCE_RELOAD_SWITCHED_GENERATION,
        ...reload,
      })
      : fail(RUNTIME_LIFECYCLE_REASONS.GENERATION_SWITCH_NOT_OBSERVED, reload),
    [REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY]: dynamic,
    [REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK]: fallback,
  };
}
