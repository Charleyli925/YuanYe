// Strict lifecycle oracle for one edit -> rebuild -> continuation cycle.

export const CONTINUITY_CHAIN_REASONS = Object.freeze({
  OBSERVED: "OBSERVED",
  REQUEST_MISSING: "REQUEST_MISSING",
  REQUEST_SOURCE_MISSING: "REQUEST_SOURCE_MISSING",
  CANDIDATE_MISSING: "CANDIDATE_MISSING",
  CANDIDATE_ID_MISSING: "CANDIDATE_ID_MISSING",
  CANDIDATE_REQUEST_MISMATCH: "CANDIDATE_REQUEST_MISMATCH",
  CANDIDATE_SOURCE_MISMATCH: "CANDIDATE_SOURCE_MISMATCH",
  CANDIDATE_TERMINAL_MISSING: "CANDIDATE_TERMINAL_MISSING",
  CANDIDATE_TERMINAL_MISMATCH: "CANDIDATE_TERMINAL_MISMATCH",
  GENERATION_MISSING: "GENERATION_MISSING",
  GENERATION_NOT_ADVANCED: "GENERATION_NOT_ADVANCED",
  ACTIVE_CANDIDATE_MISMATCH: "ACTIVE_CANDIDATE_MISMATCH",
  ACTIVE_GENERATION_MISMATCH: "ACTIVE_GENERATION_MISMATCH",
  ACTIVE_DOCUMENT_MISSING: "ACTIVE_DOCUMENT_MISSING",
  RUNTIME_TERMINAL_MISSING: "RUNTIME_TERMINAL_MISSING",
  SOURCE_HASH_MISMATCH: "SOURCE_HASH_MISMATCH",
  SOURCE_SIZE_MISMATCH: "SOURCE_SIZE_MISMATCH",
  SELECTION_MISSING: "SELECTION_MISSING",
  SELECTION_ELEMENT_MISMATCH: "SELECTION_ELEMENT_MISMATCH",
  FOCUS_ELEMENT_MISMATCH: "FOCUS_ELEMENT_MISMATCH",
  DETACHED_LOCATOR: "DETACHED_LOCATOR",
  PREVIOUS_TARGET_NOT_RETIRED: "PREVIOUS_TARGET_NOT_RETIRED",
  CONTINUATION_MISSING: "CONTINUATION_MISSING",
  CONTINUATION_WRONG_TARGET: "CONTINUATION_WRONG_TARGET",
  CONTINUATION_INPUT_NOT_APPLIED: "CONTINUATION_INPUT_NOT_APPLIED",
  ORDINARY_EDIT_REBUILT_RUNTIME: "ORDINARY_EDIT_REBUILT_RUNTIME",
  ORDINARY_EDIT_EVIDENCE_MISSING: "ORDINARY_EDIT_EVIDENCE_MISSING",
  UNKNOWN_EVIDENCE: "UNKNOWN_EVIDENCE",
  HARNESS_TIMEOUT: "HARNESS_TIMEOUT",
});

export const STALE_CANDIDATE_REASONS = Object.freeze({
  OBSERVED: "OBSERVED",
  HELD_CANDIDATE_MISSING: "HELD_CANDIDATE_MISSING",
  HELD_CANDIDATE_ALREADY_ACTIVE: "HELD_CANDIDATE_ALREADY_ACTIVE",
  HELD_CANDIDATE_SOURCE_MISSING: "HELD_CANDIDATE_SOURCE_MISSING",
  HELD_CANDIDATE_SOURCE_MISMATCH: "HELD_CANDIDATE_SOURCE_MISMATCH",
  HELD_SOURCE_MISSING: "HELD_SOURCE_MISSING",
  LATEST_SOURCE_MISSING: "LATEST_SOURCE_MISSING",
  LATEST_SOURCE_NOT_ADVANCED: "LATEST_SOURCE_NOT_ADVANCED",
  CONTINUATION_WRONG_TARGET: "CONTINUATION_WRONG_TARGET",
  CONTINUATION_INPUT_NOT_APPLIED: "CONTINUATION_INPUT_NOT_APPLIED",
  FINAL_SOURCE_MISMATCH: "FINAL_SOURCE_MISMATCH",
  STALE_CANDIDATE_OVERWROTE_SOURCE: "STALE_CANDIDATE_OVERWROTE_SOURCE",
  FINAL_PROJECTION_STALE: "FINAL_PROJECTION_STALE",
  LATEST_MARKER_MISSING: "LATEST_MARKER_MISSING",
  HARNESS_TIMEOUT: "HARNESS_TIMEOUT",
  UNKNOWN_EVIDENCE: "UNKNOWN_EVIDENCE",
});

const STATIC_REASONS = new Set([
  "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE",
]);

function part(state, reasonCode, details = {}) {
  return { state, reasonCode, details };
}

const pass = (details) => part("PASS", CONTINUITY_CHAIN_REASONS.OBSERVED, details);
const fail = (reasonCode, details) => part("FAIL", reasonCode, details);
const integerIdentity = (value) => (
  (typeof value === "number" && Number.isInteger(value) && value > 0)
  || (typeof value === "string" && /^[1-9]\d*$/u.test(value))
);

export function runtimeProjectionStale(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function evaluateContinuityChain(input) {
  const parts = {};
  if (input.harnessTimeout === true) {
    return { ok: false, state: "FAIL", parts, failures: [{ code: CONTINUITY_CHAIN_REASONS.HARNESS_TIMEOUT }] };
  }
  if (input.harnessStatus === "UNKNOWN") {
    return { ok: false, state: "FAIL", parts, failures: [{ code: CONTINUITY_CHAIN_REASONS.UNKNOWN_EVIDENCE }] };
  }

  const request = input.request;
  parts.request = request?.status
    ? request?.sourceRevision
      ? pass({ sourceRevision: request.sourceRevision, reason: request.reason || null })
      : fail(CONTINUITY_CHAIN_REASONS.REQUEST_SOURCE_MISSING)
    : fail(CONTINUITY_CHAIN_REASONS.REQUEST_MISSING);
  const staticReason = STATIC_REASONS.has(input.staticNotApplicableReason)
    ? input.staticNotApplicableReason
    : null;
  if (staticReason) {
    parts.candidateIdentity = part("NOT_APPLICABLE", staticReason);
    parts.candidateTerminal = part("NOT_APPLICABLE", staticReason);
  } else if (!input.candidate) {
    parts.candidateIdentity = fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING);
    parts.candidateTerminal = fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_TERMINAL_MISSING);
  } else {
    const candidate = input.candidate;
    if (!candidate.candidateId) {
      parts.candidateIdentity = fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_ID_MISSING);
    } else if (candidate.sourceRevision !== request?.sourceRevision) {
      parts.candidateIdentity = fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_REQUEST_MISMATCH);
    } else if (candidate.sourceRevision !== input.rebuildSource?.hash) {
      parts.candidateIdentity = fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_SOURCE_MISMATCH);
    } else {
      parts.candidateIdentity = pass({ candidateId: candidate.candidateId });
    }
    parts.candidateTerminal = candidate.status === "ready"
      ? pass({ status: candidate.status })
      : candidate.status
        ? fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_TERMINAL_MISMATCH, { status: candidate.status })
        : fail(CONTINUITY_CHAIN_REASONS.CANDIDATE_TERMINAL_MISSING);
  }

  const beforeGeneration = Number(input.generation?.before);
  const afterGeneration = Number(input.generation?.after);
  parts.generation = input.generation?.observed === true
    && integerIdentity(input.generation?.before) && integerIdentity(input.generation?.after)
    ? afterGeneration > beforeGeneration
      ? pass({ before: beforeGeneration, after: afterGeneration })
      : fail(CONTINUITY_CHAIN_REASONS.GENERATION_NOT_ADVANCED)
    : fail(CONTINUITY_CHAIN_REASONS.GENERATION_MISSING);

  const active = input.active;
  if (!active?.documentId) {
    parts.activeIdentity = fail(CONTINUITY_CHAIN_REASONS.ACTIVE_DOCUMENT_MISSING);
  } else if (!staticReason && active.candidateId !== input.candidate?.candidateId) {
    parts.activeIdentity = fail(CONTINUITY_CHAIN_REASONS.ACTIVE_CANDIDATE_MISMATCH);
  } else if (Number(active.generation) !== afterGeneration) {
    parts.activeIdentity = fail(CONTINUITY_CHAIN_REASONS.ACTIVE_GENERATION_MISMATCH);
  } else {
    parts.activeIdentity = pass({ documentId: active.documentId });
  }

  parts.runtimeTerminal = input.runtime?.terminal === true
    && typeof input.runtime?.phase === "string"
    && typeof input.runtime?.outcome === "string"
    ? pass({ phase: input.runtime.phase, outcome: input.runtime.outcome })
    : fail(CONTINUITY_CHAIN_REASONS.RUNTIME_TERMINAL_MISSING);
  const working = input.workingSource;
  const displayed = input.displayedSource;
  parts.sourceConsistency = working?.hash
    && displayed?.hash
    && displayed?.workingProjectionHash === working.hash
    && displayed?.stale === false
    && working.hash === displayed.hash
    ? displayed.size == null || working.size === displayed.size
      ? pass({ hash: working.hash, size: working.size })
      : fail(CONTINUITY_CHAIN_REASONS.SOURCE_SIZE_MISMATCH)
    : fail(CONTINUITY_CHAIN_REASONS.SOURCE_HASH_MISMATCH);

  const ordinary = input.ordinaryEdit;
  const ordinaryComplete = Boolean(
    ordinary?.before?.documentId
    && ordinary?.after?.documentId
    && integerIdentity(ordinary?.before?.generation)
    && integerIdentity(ordinary?.after?.generation),
  );
  const ordinaryRebuilt = ordinaryComplete && (
    ordinary.before?.documentId !== ordinary.after?.documentId
    || Number(ordinary.before?.generation) !== Number(ordinary.after?.generation)
    || ordinary.rebuilt === true
  );
  parts.ordinaryEdit = !ordinaryComplete
    ? fail(CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_EVIDENCE_MISSING)
    : ordinaryRebuilt
      ? fail(CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_REBUILT_RUNTIME)
      : pass();

  const afterSelection = input.selection?.after;
  const expectedSelectionId = input.selection?.expectedElementId;
  if (!expectedSelectionId || !afterSelection?.elementId) {
    parts.selection = fail(CONTINUITY_CHAIN_REASONS.SELECTION_MISSING);
  } else if (afterSelection.connected !== true) {
    parts.selection = fail(CONTINUITY_CHAIN_REASONS.DETACHED_LOCATOR);
  } else if (expectedSelectionId !== afterSelection.elementId) {
    parts.selection = fail(CONTINUITY_CHAIN_REASONS.SELECTION_ELEMENT_MISMATCH);
  } else {
    parts.selection = pass({ elementId: afterSelection.elementId });
  }
  const focus = input.selection?.focus;
  parts.focus = expectedSelectionId
    && focus?.activeElementId === expectedSelectionId
    && focus?.anchorElementId === expectedSelectionId
    && focus?.focusElementId === expectedSelectionId
    ? pass({ elementId: expectedSelectionId })
    : fail(CONTINUITY_CHAIN_REASONS.FOCUS_ELEMENT_MISMATCH);
  parts.selectionFocus = parts.selection.state === "PASS" && parts.focus.state === "PASS"
    ? pass()
    : fail(parts.selection.reasonCode !== CONTINUITY_CHAIN_REASONS.OBSERVED
      ? parts.selection.reasonCode
      : parts.focus.reasonCode);
  parts.previousTarget = input.previousTargetRetired === true
    ? pass()
    : fail(CONTINUITY_CHAIN_REASONS.PREVIOUS_TARGET_NOT_RETIRED);

  const continuation = input.continuation;
  const expectedElementId = continuation?.expectedElementId;
  if (!expectedElementId || !["without-refocus", "session-ended"].includes(continuation?.mode)) {
    parts.continuation = fail(CONTINUITY_CHAIN_REASONS.CONTINUATION_MISSING);
  } else if (continuation.mode === "without-refocus") {
    parts.continuation = continuation.directInputApplied === true
      && continuation.directTargetId === expectedElementId
      ? pass({ mode: continuation.mode, elementId: expectedElementId })
      : fail(CONTINUITY_CHAIN_REASONS.CONTINUATION_WRONG_TARGET, {
        expectedElementId,
        observedElementId: continuation.directTargetId || null,
      });
  } else if (continuation.directInputApplied === true) {
    parts.continuation = fail(CONTINUITY_CHAIN_REASONS.CONTINUATION_WRONG_TARGET, {
      expectedElementId,
      observedElementId: continuation.directTargetId || null,
    });
  } else if (
    continuation.sessionEnded === true
    && continuation.relocatedElementId === expectedElementId
    && continuation.relocatedInputApplied === true
  ) {
    parts.continuation = pass({ mode: continuation.mode, elementId: expectedElementId });
  } else {
    parts.continuation = fail(CONTINUITY_CHAIN_REASONS.CONTINUATION_INPUT_NOT_APPLIED, {
      expectedElementId,
      observedElementId: continuation.relocatedElementId || null,
    });
  }

  const failures = Object.entries(parts)
    .filter(([, value]) => value.state === "FAIL")
    .map(([name, value]) => ({ code: value.reasonCode, part: name }));
  return { ok: failures.length === 0, state: failures.length === 0 ? "PASS" : "FAIL", parts, failures };
}

export function evaluateStaleCandidateFence(input) {
  const parts = {};
  if (input.harnessTimeout === true) {
    return {
      ok: false,
      state: "FAIL",
      parts,
      failures: [{ code: STALE_CANDIDATE_REASONS.HARNESS_TIMEOUT }],
    };
  }
  if (input.harnessStatus === "UNKNOWN") {
    return {
      ok: false,
      state: "FAIL",
      parts,
      failures: [{ code: STALE_CANDIDATE_REASONS.UNKNOWN_EVIDENCE }],
    };
  }

  const held = input.heldCandidate;
  if (!held?.candidateId) {
    parts.heldCandidate = fail(STALE_CANDIDATE_REASONS.HELD_CANDIDATE_MISSING);
  } else if (held.candidateId === held.activeCandidateId) {
    parts.heldCandidate = fail(STALE_CANDIDATE_REASONS.HELD_CANDIDATE_ALREADY_ACTIVE);
  } else if (!held.sourceRevision) {
    parts.heldCandidate = fail(STALE_CANDIDATE_REASONS.HELD_CANDIDATE_SOURCE_MISSING);
  } else {
    parts.heldCandidate = pass({
      candidateId: held.candidateId,
      sourceRevision: held.sourceRevision || null,
    });
  }

  const heldHash = input.heldSource?.hash;
  const latestHash = input.latestSource?.hash;
  if (!heldHash) {
    parts.sourceAdvance = fail(STALE_CANDIDATE_REASONS.HELD_SOURCE_MISSING);
  } else if (held?.sourceRevision !== heldHash) {
    parts.sourceAdvance = fail(STALE_CANDIDATE_REASONS.HELD_CANDIDATE_SOURCE_MISMATCH, {
      candidateSourceRevision: held?.sourceRevision || null,
      heldHash,
    });
  } else if (!latestHash) {
    parts.sourceAdvance = fail(STALE_CANDIDATE_REASONS.LATEST_SOURCE_MISSING);
  } else if (heldHash === latestHash) {
    parts.sourceAdvance = fail(STALE_CANDIDATE_REASONS.LATEST_SOURCE_NOT_ADVANCED);
  } else {
    parts.sourceAdvance = pass({ heldHash, latestHash });
  }

  const continuation = input.continuation;
  if (continuation?.directInputApplied === true) {
    parts.continuation = continuation.directTargetId === continuation.expectedElementId
      ? pass({ mode: "without-refocus", elementId: continuation.expectedElementId })
      : fail(STALE_CANDIDATE_REASONS.CONTINUATION_WRONG_TARGET, {
        expectedElementId: continuation?.expectedElementId || null,
        observedElementId: continuation?.directTargetId || null,
      });
  } else if (
    continuation?.sessionEnded === true
    && continuation?.relocatedElementId === continuation?.expectedElementId
    && continuation?.relocatedInputApplied === true
  ) {
    parts.continuation = pass({ mode: "session-ended", elementId: continuation.expectedElementId });
  } else {
    parts.continuation = fail(STALE_CANDIDATE_REASONS.CONTINUATION_INPUT_NOT_APPLIED);
  }

  const final = input.finalSource;
  if (final?.hash && heldHash && final.hash === heldHash) {
    parts.finalSource = fail(STALE_CANDIDATE_REASONS.STALE_CANDIDATE_OVERWROTE_SOURCE);
  } else if (!final?.hash || final.hash !== latestHash || final.workingHash !== latestHash) {
    parts.finalSource = fail(STALE_CANDIDATE_REASONS.FINAL_SOURCE_MISMATCH, {
      latestHash: latestHash || null,
      finalHash: final?.hash || null,
      workingHash: final?.workingHash || null,
    });
  } else if (final.displayedHash !== latestHash || final.stale !== false) {
    parts.finalSource = fail(STALE_CANDIDATE_REASONS.FINAL_PROJECTION_STALE, {
      displayedHash: final.displayedHash || null,
      stale: final.stale,
    });
  } else if (final.latestMarkerPresent !== true) {
    parts.finalSource = fail(STALE_CANDIDATE_REASONS.LATEST_MARKER_MISSING);
  } else {
    parts.finalSource = pass({ hash: final.hash });
  }

  const failures = Object.entries(parts)
    .filter(([, value]) => value.state === "FAIL")
    .map(([name, value]) => ({ code: value.reasonCode, part: name }));
  return {
    ok: failures.length === 0,
    state: failures.length === 0 ? "PASS" : "FAIL",
    parts,
    failures,
  };
}
