// Self-contained callbacks passed directly to Playwright locator.evaluate.
// Keep all state on the renderer global so the same observer can be exercised
// by a tiny DOM fixture without launching the real-HTML corpus runner.

export const RUNTIME_OBSERVER_RECORD_KINDS = Object.freeze({
  REQUEST: "rebuild-request",
  CANDIDATE: "candidate-created",
  GENERATION: "generation",
  CANDIDATE_TERMINAL: "candidate-terminal",
  RUNTIME_TERMINAL: "runtime-terminal",
  ACTIVE_IDENTITY: "active-identity",
});

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function number(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Reduce observer records to independent lifecycle facts.  A caller may feed
 * this result into the continuity-chain oracle; no fact is inferred from a
 * neighbouring kind of record.
 */
export function summarizeRuntimeObserverRecords(records) {
  const all = Array.isArray(records) ? records : [];
  const requests = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.REQUEST);
  const candidates = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.CANDIDATE);
  const generations = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.GENERATION);
  const candidateTerminals = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.CANDIDATE_TERMINAL);
  const runtimeTerminals = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.RUNTIME_TERMINAL);
  const activeIdentities = all.filter((record) => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.ACTIVE_IDENTITY);
  const candidate = candidates.find((record) => nonEmpty(record.candidateId)) || null;
  const generation = generations.find((record) => (
    number(record.beforeGeneration) != null && number(record.afterGeneration) != null
  )) || null;
  const candidateTerminal = candidateTerminals.find((record) => (
    nonEmpty(record.terminal)
    && (!candidate || record.candidateId === candidate.candidateId)
  )) || null;
  const runtimeTerminal = runtimeTerminals.findLast((record) => (
    nonEmpty(record.terminal)
    && ["settled", "static", "static-fallback"].includes(record.phase)
  )) || null;
  const activeIdentity = activeIdentities.find((record) => (
    nonEmpty(record.candidateId) || nonEmpty(record.documentId)
  )) || null;
  return {
    records: all,
    request: requests.find((record) => nonEmpty(record.sourceRevision)) || null,
    candidate,
    candidateId: candidate?.candidateId || null,
    candidateTerminal,
    generation,
    runtimeTerminal,
    activeIdentity,
    hasRequest: requests.some((record) => nonEmpty(record.sourceRevision)),
    hasCandidate: Boolean(candidate),
    hasCandidateTerminal: Boolean(candidateTerminal),
    hasGeneration: Boolean(generation),
    hasRuntimeTerminal: Boolean(runtimeTerminal),
    hasActiveIdentity: Boolean(activeIdentity),
  };
}

export const classifyRuntimeObserverRecords = summarizeRuntimeObserverRecords;

export function attributeRuntimeObserverRequests(records) {
  const all = Array.isArray(records) ? records : [];
  const requests = all.filter(record => record?.kind === RUNTIME_OBSERVER_RECORD_KINDS.REQUEST);
  return requests.map(request => {
    const related = all.filter(record => record !== request
      && record?.requestOrdinal === request.requestOrdinal);
    const candidateIds = [...new Set(related
      .filter(record => record.kind === RUNTIME_OBSERVER_RECORD_KINDS.CANDIDATE)
      .map(record => nonEmpty(record.candidateId)).filter(Boolean))];
    return {
      requestOrdinal: request.requestOrdinal,
      execution: request.execution || null,
      reason: request.reason || null,
      sourceRevision: request.sourceRevision || null,
      candidateIds,
      candidateTerminals: related
        .filter(record => record.kind === RUNTIME_OBSERVER_RECORD_KINDS.CANDIDATE_TERMINAL)
        .map(record => ({ candidateId: record.candidateId || null, terminal: record.terminal || null })),
      generations: related
        .filter(record => record.kind === RUNTIME_OBSERVER_RECORD_KINDS.GENERATION)
        .map(record => ({ before: record.beforeGeneration || null, after: record.afterGeneration || null,
          candidateId: record.candidateId || null })),
      activeIdentities: related
        .filter(record => record.kind === RUNTIME_OBSERVER_RECORD_KINDS.ACTIVE_IDENTITY)
        .map(record => ({ candidateId: record.candidateId || null, generation: record.generation || null,
          documentId: record.documentId || null })),
      runtimeTerminals: related
        .filter(record => record.kind === RUNTIME_OBSERVER_RECORD_KINDS.RUNTIME_TERMINAL)
        .map(record => ({ phase: record.phase || null, outcome: record.outcome || null,
          candidateId: record.candidateId || null, generation: record.generation || null })),
    };
  });
}

export function setRuntimeLifecycleObservationContext(_element, context) {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  const state = globalThis[key];
  if (!state) throw new Error("Runtime lifecycle observer is not active.");
  const valid = context && /^H\d{2}$/u.test(context.fileId)
    && Number.isInteger(context.round) && context.round > 0
    && Number.isInteger(context.targetIndex) && context.targetIndex >= 0
    && /^pr1_[a-f0-9]{32}$/u.test(context.targetId)
    && typeof context.behavior === "string" && context.behavior.length > 0
    && typeof context.operation === "string" && context.operation.length > 0;
  if (!valid) throw new Error("Runtime lifecycle execution context is invalid.");
  state.execution = { ...context };
  return state.execution;
}

export function startRuntimeCandidateObservation(element, options = {}) {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  globalThis[key]?.observer?.disconnect();
  const candidate = element.querySelector('iframe[data-frame-role="runtime-candidate"]');
  const candidateId = element.getAttribute("data-runtime-candidate-id");
  if (candidate || candidateId) {
    throw new Error("Runtime Candidate observation requires a clean absent precondition.");
  }
  const records = [];
  const lifecycleRecords = [];
  // Lifecycle facts are always collected separately.  The legacy stop
  // function still returns only candidate records, so existing callers keep
  // their contract while the lifecycle stop function can expose the full
  // independent set.
  const includeLifecycle = options?.includeLifecycle !== false && options?.lifecycle !== false;
  let lastActiveGeneration = element.querySelector(
    'iframe[data-runtime-slot-role="active"]',
  )?.getAttribute("data-frame-generation") || null;
  const recorded = new Set();
  const frameCandidates = new WeakMap();
  let requestOrdinal = 0;
  let observationOrdinal = 0;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(m => m.type === "attributes" && m.target === element
      && m.attributeName === "data-runtime-refresh-pending" && m.oldValue === null)) requestOrdinal++;
    // Promotion removes the iframe's Candidate attribute. Preserve that exact
    // object's binding across batches (or read its removal record in this batch).
    // Root last-known-good metadata is committed later and cannot identify it.
    const frameCandidateId = (frame) => {
      if (!frame) return null;
      const candidateId = frame.getAttribute("data-runtime-candidate-id")
        || mutations.findLast((entry) => entry.target === frame
          && entry.attributeName === "data-runtime-candidate-id" && entry.oldValue)?.oldValue;
      const generation = frame.getAttribute("data-frame-generation");
      if (candidateId) frameCandidates.set(frame, { candidateId, generation });
      const binding = frameCandidates.get(frame);
      return binding?.generation === generation ? binding.candidateId : null;
    };
    const activeCandidateId = () => frameCandidateId(
      element.querySelector('iframe[data-runtime-slot-role="active"]'),
    );
    const recordCandidate = (evidence, candidateValue, generation = null) => {
      if (typeof candidateValue !== "string" || candidateValue.trim() === "") return;
      const recordKey = `${evidence}:${candidateValue}:${generation || "unknown"}`;
      if (recorded.has(recordKey)) return;
      recorded.add(recordKey);
      records.push({
        kind: "candidate-created",
        evidence,
        candidateId: candidateValue,
        generation,
        sourceRevision: element.getAttribute("data-runtime-candidate-source-revision")
          || mutations.findLast((entry) => (
            entry.type === "attributes"
            && entry.target === element
            && entry.attributeName === "data-runtime-candidate-source-revision"
            && typeof entry.oldValue === "string"
            && entry.oldValue.trim() !== ""
          ))?.oldValue
          || null,
        requestOrdinal,
        observationOrdinal: ++observationOrdinal,
        execution: globalThis[key]?.execution ? { ...globalThis[key].execution } : null,
      });
    };
    const recordLifecycle = (record) => {
      if (!includeLifecycle) return;
      const enriched = {
        ...record,
        requestOrdinal: record.requestOrdinal ?? requestOrdinal,
        observationOrdinal: ++observationOrdinal,
        execution: globalThis[key]?.execution ? { ...globalThis[key].execution } : null,
      };
      const recordKey = [
        enriched.kind,
        enriched.evidence,
        enriched.candidateId || "unknown",
        enriched.generation || "unknown",
        enriched.beforeGeneration || "unknown",
        enriched.afterGeneration || "unknown",
        enriched.terminal || "unknown",
        enriched.documentId || "unknown",
        enriched.sourceRevision || "unknown",
        enriched.reason || "unknown",
        enriched.phase || "unknown",
        enriched.outcome || "unknown",
        enriched.requestOrdinal || "unknown",
        JSON.stringify(enriched.execution),
      ].join(":");
      if (recorded.has(`lifecycle:${recordKey}`)) return;
      recorded.add(`lifecycle:${recordKey}`);
      lifecycleRecords.push(enriched);
    };
    for (const [index, mutation] of mutations.entries()) {
      if (
        includeLifecycle
        && mutation.type === "attributes"
        && mutation.target === element
        && [
          "data-runtime-refresh-pending",
          "data-runtime-refresh-pending-source-revision",
          "data-runtime-refresh-pending-reason",
        ].includes(mutation.attributeName)
      ) {
        const requestWasRaised = element.hasAttribute("data-runtime-refresh-pending")
          || mutations.some((entry) => (
            entry.type === "attributes"
            && entry.target === element
            && entry.attributeName === "data-runtime-refresh-pending"
            && entry.oldValue === null
          ));
        const sourceMutation = mutations.findLast((entry) => (
          entry.type === "attributes"
          && entry.target === element
          && entry.attributeName === "data-runtime-refresh-pending-source-revision"
          && typeof entry.oldValue === "string"
          && entry.oldValue.trim() !== ""
        ));
        const reasonMutation = mutations.findLast((entry) => (
          entry.type === "attributes"
          && entry.target === element
          && entry.attributeName === "data-runtime-refresh-pending-reason"
          && typeof entry.oldValue === "string"
          && entry.oldValue.trim() !== ""
        ));
        if (!requestWasRaised) continue;
        recordLifecycle({
          kind: "rebuild-request",
          requestOrdinal,
          evidence: "runtime-refresh-pending",
          status: "submitted",
          sourceRevision: element.getAttribute("data-runtime-refresh-pending-source-revision")
            || sourceMutation?.oldValue
            || null,
          reason: element.getAttribute("data-runtime-refresh-pending-reason")
            || reasonMutation?.oldValue
            || null,
        });
      }
      if (
        mutation.type === "attributes"
        && mutation.target === element
        && mutation.attributeName === "data-runtime-candidate-id"
        && mutation.oldValue === null
      ) {
        const current = element.getAttribute("data-runtime-candidate-id");
        const removedLater = mutations.slice(index + 1).find((later) => (
          later.type === "attributes"
          && later.target === element
          && later.attributeName === "data-runtime-candidate-id"
          && later.oldValue
        ));
        recordCandidate("candidate-id-absent-to-present", current || removedLater?.oldValue);
      }
      if (
        includeLifecycle
        && mutation.type === "attributes"
        && mutation.target === element
        && mutation.attributeName === "data-runtime-candidate-id"
        && mutation.oldValue
        && mutation.oldValue !== element.getAttribute("data-runtime-candidate-id")
      ) {
        const candidateId = mutation.oldValue;
        const promoted = activeCandidateId() === candidateId;
        const replacementId = element.getAttribute("data-runtime-candidate-id");
        const surface = element.closest(".canvas-edit-surface");
        recordLifecycle({
          kind: "candidate-terminal",
          evidence: "candidate-id-terminal-transition",
          candidateId,
          terminal: promoted
            ? "ready"
            : replacementId
              ? "superseded"
              : surface?.getAttribute("data-edit-runtime-outcome") || "failed",
          sourceRevision: records.findLast((entry) => entry.candidateId === candidateId)?.sourceRevision || null,
        });
      }
      if (
        mutation.type === "attributes"
        && mutation.attributeName === "data-frame-role"
        && mutation.oldValue !== "runtime-candidate"
      ) {
        const frame = mutation.target;
        if (!(frame instanceof element.ownerDocument.defaultView.HTMLIFrameElement)) continue;
        const currentRole = frame.getAttribute("data-frame-role");
        const retiredLater = mutations.slice(index + 1).some((later) => (
          later.type === "attributes"
          && later.target === frame
          && later.attributeName === "data-frame-role"
          && later.oldValue === "runtime-candidate"
        ));
        if (currentRole === "runtime-candidate" || retiredLater) {
          recordCandidate(
            "candidate-frame-role-transition",
            frameCandidateId(frame),
            frame.getAttribute("data-frame-generation"),
          );
        }
      }
      if (
        includeLifecycle
        && mutation.type === "attributes"
        && mutation.attributeName === "data-frame-generation"
      ) {
        const beforeGeneration = mutation.oldValue;
        const afterGeneration = mutation.target.getAttribute("data-frame-generation");
        if (beforeGeneration !== afterGeneration) {
          recordLifecycle({
            kind: "generation",
            evidence: "frame-generation-attribute-transition",
            beforeGeneration,
            afterGeneration,
            generation: afterGeneration,
            candidateId: frameCandidateId(mutation.target),
          });
          if (mutation.target.getAttribute("data-runtime-slot-role") === "active") {
            lastActiveGeneration = afterGeneration;
          }
        }
      }
      if (
        includeLifecycle
        && mutation.type === "attributes"
        && mutation.attributeName === "data-runtime-slot-role"
        && mutation.target.getAttribute("data-runtime-slot-role") === "active"
      ) {
        const frame = mutation.target;
        const generation = frame.getAttribute("data-frame-generation");
        if (lastActiveGeneration && generation && lastActiveGeneration !== generation) {
          recordLifecycle({
            kind: "generation",
            evidence: "active-slot-promotion",
            beforeGeneration: lastActiveGeneration,
            afterGeneration: generation,
            generation,
            candidateId: frameCandidateId(frame),
          });
        }
        lastActiveGeneration = generation || lastActiveGeneration;
        let documentId = null;
        try {
          documentId = frame.contentWindow?.__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__ || null;
        } catch {
          documentId = null;
        }
        recordLifecycle({
          kind: "active-identity",
          evidence: "active-slot-promotion",
          candidateId: frameCandidateId(frame),
          generation,
          documentId,
        });
      }
      if (
        includeLifecycle
        && mutation.type === "attributes"
        && mutation.target === element.closest(".canvas-edit-surface")
        && ["data-edit-runtime-phase", "data-edit-runtime-outcome"].includes(
          mutation.attributeName,
        )
      ) {
        const phase = mutation.target.getAttribute("data-edit-runtime-phase");
        const outcome = mutation.target.getAttribute("data-edit-runtime-outcome");
        if (phase || outcome) {
          recordLifecycle({
            kind: "runtime-terminal",
            evidence: "edit-runtime-terminal-transition",
            terminal: outcome || phase,
            phase,
            outcome,
            candidateId: activeCandidateId(),
            generation: element.querySelector('iframe[data-runtime-slot-role="active"]')
              ?.getAttribute("data-frame-generation") || null,
          });
        }
      }
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof element.ownerDocument.defaultView.Element)) continue;
        const frames = node.matches("iframe") ? [node] : [...node.querySelectorAll("iframe")];
        for (const frame of frames) {
          if (frame.getAttribute("data-frame-role") === "runtime-candidate") {
            recordCandidate(
              "candidate-frame-added",
              frameCandidateId(frame),
              frame.getAttribute("data-frame-generation"),
            );
            recordLifecycle({
              kind: "generation",
              evidence: "candidate-frame-added-generation",
              beforeGeneration: null,
              afterGeneration: frame.getAttribute("data-frame-generation"),
              generation: frame.getAttribute("data-frame-generation"),
              candidateId: frameCandidateId(frame),
            });
          }
        }
      }
    }
  });
  observer.observe(element, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      "data-runtime-candidate-id",
      "data-runtime-refresh-pending",
      "data-runtime-refresh-pending-source-revision",
      "data-runtime-refresh-pending-reason",
      "data-runtime-candidate-phase",
      "data-runtime-activation",
      "data-render-verified",
      "data-runtime-slot-role",
      "data-frame-role",
      "data-frame-generation",
    ],
  });
  const surface = element.closest(".canvas-edit-surface");
  if (surface && surface !== element) {
    observer.observe(surface, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-edit-runtime-phase", "data-edit-runtime-outcome"],
    });
  }
  globalThis[key] = { observer, records, lifecycleRecords, includeLifecycle, execution: null };
}

// Alias the same self-contained callback so Playwright can serialize either
// entry point without maintaining a second observer implementation.
export const startRuntimeLifecycleObservation = startRuntimeCandidateObservation;

export function stopRuntimeCandidateObservation() {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  const state = globalThis[key];
  state?.observer?.disconnect();
  delete globalThis[key];
  return state?.records || [];
}

/** Return candidate and lifecycle records for new trust-chain consumers. */
export function stopRuntimeLifecycleObservation() {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  const state = globalThis[key];
  state?.observer?.disconnect();
  delete globalThis[key];
  const candidateRecords = state?.records || [];
  const lifecycleRecords = state?.lifecycleRecords || [];
  return {
    candidateRecords,
    lifecycleRecords,
    records: [...candidateRecords, ...lifecycleRecords],
  };
}
