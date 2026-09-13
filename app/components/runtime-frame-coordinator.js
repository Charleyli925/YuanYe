const TERMINAL_OUTCOMES = new Set([
  "ready",
  "rejected",
  "failed",
  "superseded",
]);

const SLOT_IDS = Object.freeze(["a", "b"]);
const CANDIDATE_KINDS = Object.freeze(["dynamic", "static-disabled"]);
let coordinatorSequence = 0;

function otherSlot(slotId) {
  return slotId === "a" ? "b" : "a";
}

function normalizedIdentity(value) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger(value.generation)
    || value.generation < 0
    || typeof value.sourceRevision !== "string"
    || !CANDIDATE_KINDS.includes(value.kind)
    || !SLOT_IDS.includes(value.slotId)
    || !Number.isSafeInteger(value.slotLease)
    || value.slotLease < 1
  ) {
    throw new TypeError(
      "Runtime frame identity requires a generation, source revision, slot, and slot lease.",
    );
  }
  return {
    candidateId: String(value.candidateId || ""),
    kind: value.kind,
    generation: value.generation,
    sourceRevision: value.sourceRevision,
    slotId: value.slotId,
    slotLease: value.slotLease,
  };
}

function frozenIdentity(value) {
  return Object.freeze({
    candidateId: value.candidateId,
    kind: value.kind,
    generation: value.generation,
    sourceRevision: value.sourceRevision,
    slotId: value.slotId,
    slotLease: value.slotLease,
  });
}

function sameIdentity(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.candidateId === right.candidateId
    && left.kind === right.kind
    && left.generation === right.generation
    && left.sourceRevision === right.sourceRevision
    && left.slotId === right.slotId
    && left.slotLease === right.slotLease;
}

export function runtimeCandidateAlreadyActive({
  request,
  runtimeFrame,
  frameLoadGeneration,
  snapshot,
} = {}) {
  const lastKnownGood = snapshot?.lastKnownGood;
  if (request?.kind === "static-disabled") {
    return Boolean(
      lastKnownGood
      && lastKnownGood.kind === "static-disabled"
      && lastKnownGood.sourceRevision === request.sourceRevision,
    );
  }
  if (
    request?.kind !== "dynamic"
    || !runtimeFrame
    || runtimeFrame.settled !== true
    || (runtimeFrame.activation !== "ready" && runtimeFrame.activation !== "partial")
    || runtimeFrame.elementGeneration !== frameLoadGeneration
    || !lastKnownGood
  ) return false;
  const activeSlotIdentity = snapshot.activeSlotId
    ? snapshot.slots?.[snapshot.activeSlotId]?.identity
    : null;
  return Boolean(
    lastKnownGood.kind === "dynamic"
    && lastKnownGood.sourceRevision === request.sourceRevision
    && sameIdentity(runtimeFrame.attempt, lastKnownGood)
    && sameIdentity(runtimeFrame.attempt, activeSlotIdentity),
  );
}

function frozenSlot(slot) {
  return Object.freeze({
    slotId: slot.slotId,
    slotLease: slot.slotLease,
    phase: slot.phase,
    identity: slot.identity ? frozenIdentity(slot.identity) : null,
  });
}

function frozenSnapshot({
  slots,
  activeSlotId,
  latest,
  lastKnownGood,
  nativeEdit,
  ignoredCallbackCount,
}) {
  return Object.freeze({
    slots: Object.freeze({
      a: frozenSlot(slots.a),
      b: frozenSlot(slots.b),
    }),
    activeSlotId,
    candidateSlotId: latest?.slotId || null,
    latestCandidate: latest ? frozenIdentity(latest) : null,
    latestPhase: latest?.phase || null,
    lastKnownGood: lastKnownGood ? frozenIdentity(lastKnownGood) : null,
    nativeEdit: nativeEdit ? Object.freeze({ ...nativeEdit }) : null,
    ignoredCallbackCount,
  });
}

/**
 * Single owner for the two physical Runtime iframe slots and candidate identity.
 * React owns iframe DOM effects; the coordinator owns only slot leases and
 * lifecycle transitions, so a stale callback can never acquire a reused slot.
 */
export class RuntimeFrameCoordinator {
  #coordinatorId = `runtime-${(++coordinatorSequence).toString(36)}`;
  #candidateSequence = 0;
  #slots = {
    a: { slotId: "a", slotLease: 0, phase: "active", identity: null },
    b: { slotId: "b", slotLease: 0, phase: "empty", identity: null },
  };
  #activeSlotId = "a";
  #latest = null;
  #lastKnownGood = null;
  #nativeEdit = null;
  #ignoredCallbackCount = 0;

  get snapshot() {
    return frozenSnapshot({
      slots: this.#slots,
      activeSlotId: this.#activeSlotId,
      latest: this.#latest,
      lastKnownGood: this.#lastKnownGood,
      nativeEdit: this.#nativeEdit,
      ignoredCallbackCount: this.#ignoredCallbackCount,
    });
  }

  beginCandidate({ generation, sourceRevision, kind = "dynamic" } = {}) {
    const previous = this.#latest;
    const slotId = previous?.slotId
      || (this.#activeSlotId ? otherSlot(this.#activeSlotId) : "a");
    const slot = this.#slots[slotId];
    const input = {
      candidateId: "pending",
      kind,
      generation,
      sourceRevision,
      slotId,
      slotLease: slot.slotLease + 1,
    };
    normalizedIdentity(input);
    const identity = Object.freeze({
      candidateId: `${this.#coordinatorId}-${(++this.#candidateSequence).toString(36)}-${generation.toString(36)}`,
      kind,
      generation,
      sourceRevision,
      slotId,
      slotLease: input.slotLease,
    });
    this.#latest = { ...identity, phase: "preparing" };
    this.#slots[slotId] = {
      slotId,
      slotLease: identity.slotLease,
      phase: "preparing",
      identity,
    };
    return Object.freeze({
      identity,
      supersededCandidate: previous ? frozenIdentity(previous) : null,
    });
  }

  accepts(candidate) {
    let normalized;
    try {
      normalized = normalizedIdentity(candidate);
    } catch {
      this.#ignoredCallbackCount += 1;
      return false;
    }
    const slot = this.#slots[normalized.slotId];
    if (
      sameIdentity(this.#latest, normalized)
      && slot.slotLease === normalized.slotLease
      && sameIdentity(slot.identity, normalized)
    ) return true;
    this.#ignoredCallbackCount += 1;
    return false;
  }

  canPromote(candidate) {
    return this.accepts(candidate)
      && this.#latest?.phase === "preparing"
      && this.#nativeEdit === null;
  }

  beginPositioning(candidate) {
    if (!this.canPromote(candidate)) return false;
    this.#latest = { ...this.#latest, phase: "positioning" };
    const slotId = this.#latest.slotId;
    this.#slots[slotId] = {
      ...this.#slots[slotId],
      phase: "positioning",
    };
    return true;
  }

  canFinalize(candidate) {
    if (!this.accepts(candidate) || this.#latest?.phase !== "positioning") return false;
    return this.#nativeEdit === null;
  }

  beginNativeEdit() {
    if (this.#latest?.phase === "positioning") return false;
    this.#nativeEdit = { kind: "user", candidateId: null };
    return true;
  }

  endNativeEdit() {
    const hadNativeEdit = this.#nativeEdit !== null;
    this.#nativeEdit = null;
    return hadNativeEdit;
  }

  settle(candidate, outcome) {
    if (!TERMINAL_OUTCOMES.has(outcome) || !this.accepts(candidate)) {
      return Object.freeze({
        accepted: false,
        preserveLastKnownGood: false,
        shouldUseStaticFallback: false,
      });
    }
    if (outcome === "ready" && !this.canFinalize(candidate)) {
      return Object.freeze({
        accepted: false,
        preserveLastKnownGood: false,
        shouldUseStaticFallback: false,
      });
    }
    const identity = frozenIdentity(this.#latest);
    const preserveLastKnownGood = outcome !== "ready" && Boolean(this.#lastKnownGood);
    const slotId = identity.slotId;
    if (outcome === "ready") {
      const previousActiveSlotId = this.#activeSlotId;
      this.#lastKnownGood = identity;
      this.#activeSlotId = slotId;
      this.#slots[slotId] = {
        ...this.#slots[slotId],
        phase: "active",
        identity,
      };
      if (previousActiveSlotId && previousActiveSlotId !== slotId) {
        this.#slots[previousActiveSlotId] = {
          ...this.#slots[previousActiveSlotId],
          phase: "empty",
          identity: null,
        };
      }
    } else {
      this.#slots[slotId] = this.#activeSlotId === slotId
        ? {
            ...this.#slots[slotId],
            phase: "active",
            identity: null,
          }
        : {
            ...this.#slots[slotId],
            phase: "empty",
            identity: null,
          };
    }
    this.#latest = null;
    return Object.freeze({
      accepted: true,
      preserveLastKnownGood,
      shouldUseStaticFallback: (
        (outcome === "failed" || outcome === "rejected")
        && identity.kind === "dynamic"
      ),
    });
  }

  reset() {
    this.#slots = {
      a: { slotId: "a", slotLease: this.#slots.a.slotLease, phase: "active", identity: null },
      b: { slotId: "b", slotLease: this.#slots.b.slotLease, phase: "empty", identity: null },
    };
    this.#activeSlotId = "a";
    this.#latest = null;
    this.#lastKnownGood = null;
    this.#nativeEdit = null;
  }
}
