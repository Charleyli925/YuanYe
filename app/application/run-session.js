import { isLockedLifecycleState } from "../domain/run-lifecycle.js";
import {
  MANAGED_AGENT_MODE,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  normalizeAgentDelivery,
} from "../../shared/agent-delivery.mjs";

function normalizedPath(value) {
  return value ? String(value) : null;
}

function comparablePath(value) {
  const sourcePath = normalizedPath(value);
  if (!sourcePath) return "";
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
}

function samePath(left, right) {
  return Boolean(
    left
    && right
    && comparablePath(left) === comparablePath(right),
  );
}

function sameRun(left, right) {
  if (!left || !right) return false;
  return left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && (!left.projectId || !right.projectId || left.projectId === right.projectId)
    && (!left.documentId || !right.documentId || left.documentId === right.documentId)
    && sameKnownWorkingCopy(left, right)
    && samePendingSubmission(left, right)
    && samePath(left.sourcePath, right.sourcePath);
}

function sameKnownWorkingCopy(left, right) {
  return !left.sourceWorkingCopyId || !right.sourceWorkingCopyId
    || left.sourceWorkingCopyId === right.sourceWorkingCopyId;
}

function samePendingSubmission(left, right) {
  if (left.requestId !== "pending") return true;
  return left.submissionToken || right.submissionToken
    ? left.submissionToken === right.submissionToken
    : samePath(left.sourcePath, right.sourcePath);
}

function sameAttempt(left, right) {
  return Boolean(
    left
    && right
    && left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && sameKnownWorkingCopy(left, right)
    && samePendingSubmission(left, right)
    && (
      samePath(left.sourcePath, right.sourcePath)
      // A registered Request origin or the exact pending token survives a
      // locator rebind. Legacy records with a missing origin never do.
      || Boolean(
        left.projectId
        && right.projectId
        && left.documentId
        && right.documentId
        && (
          (
            left.sourceWorkingCopyId
            && right.sourceWorkingCopyId
            && left.sourceWorkingCopyId === right.sourceWorkingCopyId
          )
          || (
            left.requestId === "pending"
            && left.submissionToken
            && left.submissionToken === right.submissionToken
          )
        )
      )
    ),
  );
}

function locatorKey(value) {
  return comparablePath(value) || null;
}

function emptyEntry(sourcePath) {
  return Object.freeze({
    sourcePath: normalizedPath(sourcePath),
    run: null,
    runTracked: false,
    result: null,
    handoff: null,
    copied: false,
    recovered: false,
    outcome: null,
  });
}

function hasEntryFacts(entry) {
  return Boolean(
    entry?.run
    || entry?.result
    || entry?.handoff
    || entry?.copied
    || entry?.recovered
    || entry?.outcome,
  );
}

function frozenBackgroundResults(entries) {
  return Object.freeze(
    [...entries.values()].flatMap((entry) => (
      entry.result
        ? [Object.freeze([entry.sourcePath, entry.result])]
        : []
    )),
  );
}

function frozenOperationKeys(map) {
  return Object.freeze(
    [...map].flatMap(([kind, keys]) => (
      [...keys].map((key) => Object.freeze([kind, key]))
    )),
  );
}

const OPERATION_KINDS = Object.freeze([
  "activate",
  "cancel",
  "resolve",
  "poll",
]);

export const RUN_SESSION_COORDINATION = Symbol("RunSession coordination");

function runDelivery(run) {
  try {
    return normalizeAgentDelivery(run?.agentDelivery);
  } catch {
    try {
      return normalizeAgentDelivery({
        ...run?.agentDelivery,
        trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      });
    } catch {
      return null;
    }
  }
}

function recoveredAgentHandoff(run) {
  const delivery = runDelivery(run);
  if (run?.status !== "processing"
    || delivery?.mode !== MANAGED_AGENT_MODE) return null;
  return Object.freeze({
    sourcePath: run.sourcePath,
    requestId: run.requestId,
    attemptId: run.attemptId,
    mode: MANAGED_AGENT_MODE,
    status: "interrupted",
    phase: "bridge-restarted",
    providerId: delivery.selection.providerId,
    runtimeId: delivery.selection.runtimeId,
    agentName: null,
    agentVersion: null,
    visibleText: "",
    visibleTextUpdates: [],
    textTruncated: false,
    startedAt: null,
    lastActivityAt: null,
    receivedBytes: 0,
    updatedAt: null,
    errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
    errorMessage: "Bridge 无法证明旧 Agent 会话已经停止。请结束本轮，再重新发送。",
    retryable: false,
    safeToRetry: false,
    recoveryKind: "end",
  });
}

export class RunSession {
  #activeSourcePath;

  #entries = new Map();

  // Locator revisions are deliberately kept outside the public snapshot. A
  // recent-run read may complete after the locator has gone through an
  // absent -> occupied -> absent ABA cycle, so the absence itself needs a
  // durable monotonic tombstone.
  #locatorRevisions = new Map();

  #revisionSequence = 0;

  // Active presentation keeps only aggregate locator keys. The facts live in
  // #entries and a new attempt at the same locator replaces the old one.
  #presentedRunKey = null;

  #presentedHandoffKey = null;

  #submission = null;

  #submissionSequence = 0;

  #busy = new Map(
    OPERATION_KINDS.map((kind) => [kind, new Set()]),
  );

  #observer = null;

  #listeners = new Set();

  constructor({ sourcePath = null } = {}) {
    this.#activeSourcePath = normalizedPath(sourcePath);
    Object.defineProperty(this, RUN_SESSION_COORDINATION, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: Object.freeze({
        locatorKey: (value) => locatorKey(value),
        locatorRevision: (value) => this.#locatorRevision(value),
        prepareRebaseSource: (value) => this.#prepareRebaseSource(value),
        rebaseReservationCurrent: (value) => this.#rebaseReservationCurrent(value),
        commitRebaseSource: (value, options) => this.#commitRebaseSource(value, options),
        rollbackRebaseSource: (value, options) => this.#rollbackRebaseSource(value, options),
        publish: () => this.#publish(),
      }),
    });
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("RunSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    try {
      this.#observer?.(this.snapshot);
    } catch {
      // A view observer cannot change run authority.
    }
    for (const listener of this.#listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // Supplemental subscribers cannot change run authority.
      }
    }
  }

  #matchesSubmission(submission) {
    return Boolean(
      this.#submission
      && submission?.token === this.#submission.token,
    );
  }

  #setSubmission(submission) {
    const previousSourcePath = this.#submission?.sourcePath || null;
    const nextSourcePath = submission?.sourcePath || null;
    this.#submission = submission && Object.freeze(submission);
    this.#advanceLocator(locatorKey(previousSourcePath));
    this.#advanceLocator(locatorKey(nextSourcePath));
    this.#emit();
    return this.#submission;
  }

  #advanceLocator(key) {
    if (!key) return 0;
    const revision = ++this.#revisionSequence;
    this.#locatorRevisions.set(key, revision);
    return revision;
  }

  #locate(sourcePath) {
    const key = locatorKey(sourcePath);
    return Object.freeze({
      key,
      entry: key ? this.#entries.get(key) || null : null,
    });
  }

  #writeEntry(key, entry) {
    if (!key) return null;
    this.#advanceLocator(key);
    if (!hasEntryFacts(entry)) {
      this.#entries.delete(key);
      if (this.#presentedRunKey === key) this.#presentedRunKey = null;
      if (this.#presentedHandoffKey === key) this.#presentedHandoffKey = null;
      return null;
    }
    const frozen = Object.freeze(entry);
    this.#entries.set(key, frozen);
    return frozen;
  }

  #currentAttempt(entry) {
    return entry?.run || entry?.outcome || entry?.handoff || null;
  }

  #startEntryAttempt(entry, run, { tracked }) {
    return Object.freeze({
      ...entry,
      run,
      runTracked: tracked,
      result: null,
      handoff: null,
      copied: false,
      recovered: false,
      outcome: null,
    });
  }

  #releasePresentedRun() {
    const key = this.#presentedRunKey;
    const entry = key ? this.#entries.get(key) || null : null;
    this.#advanceLocator(key);
    this.#presentedRunKey = null;
    if (!entry || entry.runTracked) return;
    this.#writeEntry(key, { ...entry, run: null });
  }

  #attemptExistsElsewhere(run, excludedKey) {
    if (!run?.requestId || !run?.attemptId) return false;
    for (const [key, entry] of this.#entries) {
      if (key === excludedKey) continue;
      const attempt = this.#currentAttempt(entry);
      if (sameAttempt(attempt, run)) return true;
    }
    return false;
  }

  activate(sourcePath) {
    const previousKey = locatorKey(this.#activeSourcePath);
    this.#releasePresentedRun();
    this.#activeSourcePath = normalizedPath(sourcePath);
    const { key, entry } = this.#locate(this.#activeSourcePath);
    this.#presentedRunKey = entry?.runTracked ? key : null;
    this.#presentedHandoffKey = entry?.handoff ? key : null;
    this.#advanceLocator(previousKey);
    this.#advanceLocator(key);
    this.#emit();
    return this.snapshot;
  }

  beginSubmission({
    sourcePath,
  } = {}) {
    const activeSourcePath = normalizedPath(sourcePath);
    if (
      !activeSourcePath
      || (
        this.#submission
        && (
          this.#submission.phase !== "uncertain"
          || samePath(this.#submission.sourcePath, activeSourcePath)
        )
      )
    ) return null;
    return this.#setSubmission({
      token: ++this.#submissionSequence,
      sourcePath: activeSourcePath,
      phase: "preparing",
    });
  }

  #advanceSubmission(submission, phase) {
    if (
      !this.#matchesSubmission(submission)
      || (phase === "frozen" && this.#submission.phase !== "preparing")
    ) return false;
    if (this.#submission.phase !== phase) {
      this.#setSubmission({ ...this.#submission, phase });
    }
    return true;
  }

  freezeSubmission(submission) {
    return this.#advanceSubmission(submission, "frozen");
  }

  markSubmissionUncertain(submission) {
    return this.#advanceSubmission(submission, "uncertain");
  }

  releaseSubmission(submission) {
    if (!this.#matchesSubmission(submission)) return false;
    this.#setSubmission(null);
    return true;
  }

  clearActiveSubmission() {
    return this.releaseSubmission(this.activeSubmission);
  }

  #preservePendingAdoption(run) {
    const previous = this.runForSource(run?.sourcePath);
    return run?.status === "ready-to-open" && sameRun(previous, run)
      && previous.adoptionPhase && !Object.hasOwn(run, "adoptionPhase")
      ? { ...run, adoptionPhase: previous.adoptionPhase } : run;
  }

  setActiveRun(run) {
    run = this.#preservePendingAdoption(run);
    if (!run?.sourcePath) {
      this.#releasePresentedRun();
      this.#emit();
      return null;
    }

    const located = this.#locate(run.sourcePath);
    const key = located.key;
    const entry = located.entry || emptyEntry(run.sourcePath);
    const sameEntryAttempt = sameRun(this.#currentAttempt(entry), run);
    if (this.#presentedRunKey !== key) {
      this.#releasePresentedRun();
    }
    let nextEntry;
    if (sameEntryAttempt) {
      nextEntry = Object.freeze({ ...entry, run });
    } else {
      nextEntry = this.#startEntryAttempt(entry, run, { tracked: false });
      if (this.#presentedHandoffKey === key) this.#presentedHandoffKey = null;
    }
    this.#writeEntry(key, nextEntry);
    this.#presentedRunKey = key;
    this.#emit();
    return this.activeRun;
  }

  trackRun(run, { activate = "if-current", recovered = false } = {}) {
    if (!run?.sourcePath) return null;
    run = this.#preservePendingAdoption(run);
    const located = this.#locate(run.sourcePath);
    const key = located.key;
    const entry = located.entry || emptyEntry(run.sourcePath);
    const sameEntryAttempt = sameRun(this.#currentAttempt(entry), run);
    const sameTrackedRun = entry.runTracked && sameRun(entry.run, run);
    const recoveredHandoff = recovered && !sameTrackedRun
      ? recoveredAgentHandoff(run)
      : null;
    let nextEntry = sameEntryAttempt
      ? Object.freeze({
          ...entry,
          run,
          runTracked: true,
          ...(!sameTrackedRun ? { copied: false, recovered: false } : {}),
          ...(recovered && !sameTrackedRun ? { recovered: true } : {}),
          ...(recoveredHandoff ? { handoff: recoveredHandoff } : {}),
        })
      : this.#startEntryAttempt(entry, run, { tracked: true });
    if (!sameEntryAttempt && recovered) {
      nextEntry = Object.freeze({
        ...nextEntry,
        recovered: true,
        ...(recoveredHandoff ? { handoff: recoveredHandoff } : {}),
      });
    }
    this.#writeEntry(key, nextEntry);

    const shouldActivate = (
      activate === "always"
      || (
        activate !== "never"
        && samePath(this.#activeSourcePath, run.sourcePath)
      )
    );
    if (shouldActivate) this.#presentedRunKey = key;
    else if (this.#presentedRunKey === key && !sameEntryAttempt) this.#presentedRunKey = null;
    if (recoveredHandoff) {
      if (
        samePath(this.#activeSourcePath, run.sourcePath)
        && sameRun(this.activeRun, recoveredHandoff)
      ) {
        this.#presentedHandoffKey = key;
      }
    } else if (this.#presentedHandoffKey === key && !sameEntryAttempt) {
      this.#presentedHandoffKey = null;
    }
    this.#emit();
    return run;
  }

  runForSource(sourcePath) {
    const entry = this.#locate(sourcePath).entry;
    return entry?.runTracked ? entry.run : null;
  }

  hasRun(run) {
    const tracked = this.runForSource(run?.sourcePath);
    return sameRun(tracked, run);
  }

  removeRun(run, { clearActive = true } = {}) {
    if (!run) return false;
    let changed = false;
    for (const [key, entry] of this.#entries) {
      const trackedMatches = entry.runTracked && sameAttempt(entry.run, run);
      const presentedMatches = this.#presentedRunKey === key
        && sameAttempt(entry.run, run);
      if (!trackedMatches && !(clearActive && presentedMatches)) continue;
      if (clearActive && presentedMatches) this.#presentedRunKey = null;
      const keepRun = presentedMatches && !clearActive;
      this.#writeEntry(key, {
        ...entry,
        run: keepRun ? entry.run : null,
        runTracked: false,
        copied: false,
        recovered: false,
      });
      changed = true;
    }
    if (changed) this.#emit();
    return changed;
  }

  clearActiveRun() {
    if (!this.activeRun) return false;
    this.#releasePresentedRun();
    this.#emit();
    return true;
  }

  publishHandoff(state) {
    if (!state?.sourcePath) return false;
    const located = this.#locate(state.sourcePath);
    const key = located.key;
    const entry = located.entry || emptyEntry(state.sourcePath);
    const currentAttempt = this.#currentAttempt(entry);
    if (
      (currentAttempt && !sameRun(currentAttempt, state))
      || this.#attemptExistsElsewhere(state, key)
    ) return false;

    const previous = entry.handoff;
    const beginsDelivery = state.status === "copying" || state.status === "starting";
    if (
      !beginsDelivery
      && previous
      && (
        previous.requestId !== state.requestId
        || previous.attemptId !== state.attemptId
      )
    ) return false;
    const copyAlreadyConfirmed = entry.copied;
    let copied = beginsDelivery && !copyAlreadyConfirmed ? false : entry.copied;
    if (["copied", "starting", "running", "cancelling"].includes(state.status)) {
      copied = true;
    } else if (
      state.mode === MANAGED_AGENT_MODE
      && ["completed", "failed", "interrupted", "cancelled"].includes(state.status)
    ) {
      copied = false;
    }
    this.#writeEntry(key, { ...entry, handoff: state, copied });
    if (
      samePath(this.#activeSourcePath, state.sourcePath)
      && sameRun(this.activeRun, state)
    ) {
      this.#presentedHandoffKey = key;
    }
    this.#emit();
    return true;
  }

  handoffForSource(sourcePath) {
    return this.#locate(sourcePath).entry?.handoff || null;
  }

  clearHandoff(sourcePath) {
    const { key, entry } = this.#locate(sourcePath);
    const changed = Boolean(entry?.handoff);
    if (!entry || (!entry.handoff && !entry.copied)) return false;
    this.#writeEntry(key, { ...entry, handoff: null, copied: false });
    if (this.#presentedHandoffKey === key) this.#presentedHandoffKey = null;
    if (changed) this.#emit();
    return changed;
  }

  clearActiveHandoff() {
    const key = this.#presentedHandoffKey;
    const entry = key ? this.#entries.get(key) || null : null;
    if (!entry?.handoff) return false;
    this.#presentedHandoffKey = null;
    this.#writeEntry(key, { ...entry, copied: false });
    this.#emit();
    return true;
  }

  rememberOutcome(run) {
    if (!run?.sourcePath) return null;
    const located = this.#locate(run.sourcePath);
    const key = located.key;
    const entry = located.entry || emptyEntry(run.sourcePath);
    const currentAttempt = this.#currentAttempt(entry);
    if (
      (currentAttempt && !sameRun(currentAttempt, run))
      || this.#attemptExistsElsewhere(run, key)
    ) return null;
    this.#writeEntry(key, { ...entry, outcome: run });
    this.#emit();
    return run;
  }

  forgetOutcome(sourcePath) {
    const { key, entry } = this.#locate(sourcePath);
    if (!entry?.outcome) return false;
    this.#writeEntry(key, { ...entry, outcome: null });
    this.#emit();
    return true;
  }

  outcomeForSource(sourcePath) {
    return this.#locate(sourcePath).entry?.outcome || null;
  }

  markResult(sourcePath, result) {
    const activeSourcePath = normalizedPath(sourcePath);
    if (!activeSourcePath || !result) return false;
    const { key, entry: located } = this.#locate(activeSourcePath);
    const entry = located || emptyEntry(activeSourcePath);
    this.#writeEntry(key, { ...entry, result });
    this.#emit();
    return true;
  }

  clearResult(sourcePath) {
    const { key, entry } = this.#locate(sourcePath);
    if (!entry?.result) return false;
    this.#writeEntry(key, { ...entry, result: null });
    this.#emit();
    return true;
  }

  resultForSource(sourcePath) {
    return this.#locate(sourcePath).entry?.result || null;
  }

  #locatorRevision(sourcePath) {
    const key = locatorKey(sourcePath);
    return key ? this.#locatorRevisions.get(key) || 0 : 0;
  }

  #prepareRebaseSource({
    previousSourcePath,
    sourcePath,
    projectId = "",
    documentId = "",
  }) {
    const nextSourcePath = normalizedPath(sourcePath);
    if (!previousSourcePath || !nextSourcePath) return false;

    const previous = this.#locate(previousSourcePath);
    const nextKey = locatorKey(nextSourcePath);
    const entry = previous.entry;
    if ([entry?.run, entry?.handoff, entry?.outcome].some((run) => run && (
      (projectId && run.projectId && run.projectId !== projectId)
      || (documentId && run.documentId && run.documentId !== documentId)
    ))) return false;
    if (
      previous.key !== nextKey
      && this.#entries.has(nextKey)
    ) return null;

    return Object.freeze({
      previousSourcePath: normalizedPath(previousSourcePath),
      sourcePath: nextSourcePath,
      previousKey: previous.key,
      nextKey,
      projectId: String(projectId || ""),
      documentId: String(documentId || ""),
      previousRevision: this.#locatorRevision(previousSourcePath),
      nextRevision: this.#locatorRevision(nextSourcePath),
      previousEntry: entry,
      nextEntry: this.#entries.get(nextKey) || null,
      activeSourcePath: this.#activeSourcePath,
      presentedRunKey: this.#presentedRunKey,
      presentedHandoffKey: this.#presentedHandoffKey,
      submission: this.#submission,
    });
  }

  #rebaseReservationCurrent(reservation) {
    if (!reservation || typeof reservation !== "object") return false;
    const sameOptionalPath = (left, right) => (
      (!left && !right) || samePath(left, right)
    );
    const entryForKey = (key) => this.#entries.get(key) || null;
    if (
      this.#locatorRevision(reservation.previousSourcePath)
        !== reservation.previousRevision
      || this.#locatorRevision(reservation.sourcePath) !== reservation.nextRevision
      || entryForKey(reservation.previousKey) !== reservation.previousEntry
      || entryForKey(reservation.nextKey) !== reservation.nextEntry
      || !sameOptionalPath(this.#activeSourcePath, reservation.activeSourcePath)
      || this.#presentedRunKey !== reservation.presentedRunKey
      || this.#presentedHandoffKey !== reservation.presentedHandoffKey
      || this.#submission !== reservation.submission
    ) return false;
    return reservation.previousKey === reservation.nextKey
      || !this.#entries.has(reservation.nextKey);
  }

  #applyRebaseSource(reservation) {
    const {
      previousSourcePath,
      sourcePath: nextSourcePath,
      previousKey,
      nextKey,
    } = reservation;
    const entry = this.#entries.get(previousKey) || null;

    // Rename, initial managed binding and Promotion move one aggregate locator.
    // The immutable Request-origin Working Copy inside its run is unchanged.
    if (entry) {
      const rebased = Object.freeze({
        ...entry,
        sourcePath: nextSourcePath,
        run: entry.run ? { ...entry.run, sourcePath: nextSourcePath } : null,
        handoff: entry.handoff
          ? { ...entry.handoff, sourcePath: nextSourcePath }
          : null,
        outcome: entry.outcome
          ? { ...entry.outcome, sourcePath: nextSourcePath }
          : null,
      });
      if (previousKey !== nextKey) {
        this.#advanceLocator(previousKey);
        this.#entries.delete(previousKey);
      }
      this.#writeEntry(nextKey, rebased);
      if (this.#presentedRunKey === previousKey) this.#presentedRunKey = nextKey;
      if (this.#presentedHandoffKey === previousKey) this.#presentedHandoffKey = nextKey;
    } else {
      this.#advanceLocator(previousKey);
      if (previousKey !== nextKey) this.#advanceLocator(nextKey);
    }
    if (samePath(this.#submission?.sourcePath, previousSourcePath)) {
      this.#submission = Object.freeze({
        ...this.#submission,
        sourcePath: nextSourcePath,
      });
    }
    if (samePath(this.#activeSourcePath, previousSourcePath)) {
      this.#activeSourcePath = nextSourcePath;
    }
    return true;
  }

  #commitRebaseSource(reservation, { publish = true } = {}) {
    if (!this.#rebaseReservationCurrent(reservation)) return false;
    this.#applyRebaseSource(reservation);
    if (publish) this.#emit();
    return true;
  }

  #rollbackRebaseSource(reservation, { publish = true } = {}) {
    if (!reservation || typeof reservation !== "object") return false;
    const currentEntry = this.#entries.get(reservation.nextKey) || null;
    if (
      (reservation.previousKey !== reservation.nextKey
        && this.#entries.has(reservation.previousKey))
      || (reservation.previousKey === reservation.nextKey
        && currentEntry === reservation.previousEntry)
    ) return false;
    const expectedActiveSourcePath = samePath(
      reservation.activeSourcePath,
      reservation.previousSourcePath,
    ) ? reservation.sourcePath : reservation.activeSourcePath;
    if (
      (!expectedActiveSourcePath && this.#activeSourcePath)
      || (expectedActiveSourcePath && !samePath(
        this.#activeSourcePath,
        expectedActiveSourcePath,
      ))
    ) return false;
    if (reservation.previousEntry && !currentEntry) return false;
    if (!reservation.previousEntry && currentEntry) return false;
    if (reservation.previousKey !== reservation.nextKey) {
      this.#entries.delete(reservation.nextKey);
      this.#advanceLocator(reservation.nextKey);
    }
    if (reservation.previousEntry) {
      this.#entries.set(reservation.previousKey, reservation.previousEntry);
      this.#advanceLocator(reservation.previousKey);
    } else {
      this.#entries.delete(reservation.previousKey);
      this.#advanceLocator(reservation.previousKey);
    }
    this.#activeSourcePath = reservation.activeSourcePath;
    this.#presentedRunKey = reservation.presentedRunKey;
    this.#presentedHandoffKey = reservation.presentedHandoffKey;
    this.#submission = reservation.submission;
    if (publish) this.#emit();
    return true;
  }

  rebaseSource(value) {
    const reservation = this.#prepareRebaseSource(value);
    return Boolean(reservation && this.#commitRebaseSource(reservation));
  }

  #publish() {
    this.#emit();
    return this.snapshot;
  }

  beginOperation(kind, key) {
    const busy = this.#busy.get(kind);
    if (!busy || !key || busy.has(key)) return false;
    busy.add(key);
    this.#emit();
    return true;
  }

  endOperation(kind, key) {
    const changed = this.#busy.get(kind)?.delete(key) ?? false;
    if (changed) this.#emit();
    return changed;
  }

  isOperationBusy(kind, key) {
    return Boolean(key && this.#busy.get(kind)?.has(key));
  }

  get activeRun() {
    return this.#entries.get(this.#presentedRunKey)?.run || null;
  }

  get activeHandoff() {
    return this.#entries.get(this.#presentedHandoffKey)?.handoff || null;
  }

  get activeHandoffMayBeRunning() {
    const activeRun = this.activeRun;
    const activeHandoff = this.activeHandoff;
    const entry = this.#entries.get(this.#presentedRunKey) || null;
    if (!activeRun || !entry) return false;
    if (activeHandoff?.mode === MANAGED_AGENT_MODE) {
      return sameRun(activeHandoff, activeRun) && (
        ["starting", "running", "cancelling"].includes(activeHandoff.status)
        || (
          (
            activeHandoff.status === "interrupted"
            || activeHandoff.errorCode === "AGENT_RESTART_RECOVERY_REQUIRED"
          )
          && entry.recovered
        )
      );
    }
    return entry.copied
      || (
        activeRun.status === "processing"
        && entry.recovered
      );
  }

  get activeHandoffManaged() {
    const activeRun = this.activeRun;
    const activeHandoff = this.activeHandoff;
    return Boolean(
      activeRun
      && activeHandoff?.mode === MANAGED_AGENT_MODE
      && ["starting", "running", "cancelling"].includes(activeHandoff.status)
      && sameRun(activeHandoff, activeRun),
    );
  }

  get activeSubmission() {
    return samePath(this.#submission?.sourcePath, this.#activeSourcePath)
      ? this.#submission
      : null;
  }

  get submissionPending() {
    return this.#submission?.phase === "preparing"
      || this.#submission?.phase === "frozen";
  }

  get activeLocked() {
    return Boolean(
      this.activeSubmission
      && this.activeSubmission.phase !== "preparing",
    ) || isLockedLifecycleState(this.activeRun?.status);
  }

  get runs() {
    return Object.freeze(
      [...this.#entries.values()].flatMap((entry) => (
        entry.runTracked && entry.run ? [entry.run] : []
      )),
    );
  }

  get snapshot() {
    return Object.freeze({
      activeSourcePath: this.#activeSourcePath,
      activeRun: this.activeRun,
      activeHandoff: this.activeHandoff,
      activeHandoffMayBeRunning: this.activeHandoffMayBeRunning,
      activeHandoffManaged: this.activeHandoffManaged,
      activeSubmission: this.activeSubmission,
      submissionPending: this.submissionPending,
      activeLocked: this.activeLocked,
      operationKeys: frozenOperationKeys(this.#busy),
      recentOutcome: this.outcomeForSource(this.#activeSourcePath),
      backgroundResults: frozenBackgroundResults(this.#entries),
    });
  }
}
