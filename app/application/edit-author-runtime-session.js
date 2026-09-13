import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  analyzeEditRuntimeDocument,
  isEditRuntimeDocumentBasePath,
  isEditRuntimeSourceSha256,
  unsupportedEditRuntimeProgramReason,
} from "../domain/edit-runtime-contract.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const RETRYABLE_STATIC_FALLBACK_OUTCOMES = new Set([
  "prepare-failed",
  "runtime-failed",
  "recovery-failed",
  "candidate-failed",
  "candidate-rejected",
]);

function frozenSnapshot({
  phase = "static",
  sourceSha256 = null,
  sourcePath = null,
  canvasGeneration = null,
  grant = null,
  lastOutcome = null,
} = {}) {
  return Object.freeze({
    phase,
    sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    sourcePath: sourcePath ? String(sourcePath) : null,
    canvasGeneration: Number.isSafeInteger(canvasGeneration) ? canvasGeneration : null,
    grant,
    lastOutcome,
    retryAvailable: (
      phase === "static-fallback"
      && RETRYABLE_STATIC_FALLBACK_OUTCOMES.has(lastOutcome)
    ) || (
      phase === "settled"
      && lastOutcome === "runtime-partial"
    ),
  });
}

function normalizedRuntimeSourcePath(value) {
  const sourcePath = value ? String(value) : "";
  // macOS exposes the same temporary-file tree through both /var and
  // /private/var (and likewise /tmp). A renderer/Main round trip can switch
  // between those spellings without changing the actual source authority.
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
}

function sameKey(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.sourcePath === right.sourcePath
    && left.canvasGeneration === right.canvasGeneration;
}

function sourceDirectory(sourcePath) {
  const normalized = String(sourcePath || "");
  const slash = normalized.lastIndexOf("/");
  const backslash = normalized.lastIndexOf("\\");
  const index = Math.max(slash, backslash);
  return index <= 0 ? normalized : normalized.slice(0, index);
}

const LIVE_RUNTIME_PHASES = new Set(["ready", "running", "settled"]);

function isLiveSameDirectoryPathRelocation(current, next, phase) {
  return Boolean(current)
    && Boolean(next)
    && LIVE_RUNTIME_PHASES.has(phase)
    && current.canvasGeneration === next.canvasGeneration
    && current.sourceSha256 === next.sourceSha256
    && current.html === next.html
    && current.sourcePath !== next.sourcePath
    && sourceDirectory(current.sourcePath) === sourceDirectory(next.sourcePath);
}

function sameExactIdentity(left, right) {
  return sameKey(left, right)
    && left.sourceSha256 === right.sourceSha256
    && left.html === right.html;
}

function normalizedRuntimeAttempt(value) {
  const candidateId = String(value?.candidateId || "");
  const candidateSourceRevision = String(value?.candidateSourceRevision || "").toLowerCase();
  if (
    !candidateId
    || candidateId.length > 128
    || !Number.isSafeInteger(value?.candidateGeneration)
    || value.candidateGeneration < 0
    || !isEditRuntimeSourceSha256(candidateSourceRevision)
  ) return null;
  return Object.freeze({
    candidateId,
    candidateGeneration: value.candidateGeneration,
    candidateSourceRevision,
  });
}

function sameRuntimeAttempt(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.candidateId === right.candidateId
    && left.candidateGeneration === right.candidateGeneration
    && left.candidateSourceRevision === right.candidateSourceRevision;
}

function normalizedGrant(value, request) {
  const allowedLibraryOrigins = new Set([
    "bundled", "disk-cache", "network", "local", "inline",
  ]);
  if (
    !isRecord(value)
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || !/^[a-f0-9]{32}$/u.test(String(value.sessionId || ""))
    || !/^[a-f0-9]{24}$/u.test(String(value.executionId || ""))
    || String(value.sourceSha256 || "").toLowerCase() !== request.sourceSha256
    || !isEditRuntimeSourceSha256(value.resourceSha256)
    || !isEditRuntimeDocumentBasePath(value.documentBasePath)
    || !Number.isSafeInteger(value.scriptCount)
    || value.scriptCount < 1
    || value.scriptCount > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 1
    || value.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes
    || value.canvasGeneration !== request.canvasGeneration
    || typeof request.programIdentity !== "string"
    || (value.resourceMode !== undefined && value.resourceMode !== "exact")
    || value.recoveryAvailable !== undefined
    || (
      value.libraryOrigins !== undefined
      && (
        !Array.isArray(value.libraryOrigins)
        || value.libraryOrigins.some((origin) => !allowedLibraryOrigins.has(origin))
      )
    )
    || (
      value.runtimeLibraries !== undefined
      && (
        !Array.isArray(value.runtimeLibraries)
        || value.runtimeLibraries.some((library) => library !== "echarts")
      )
    )
  ) return null;
  return Object.freeze({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: String(value.sessionId).toLowerCase(),
    executionId: String(value.executionId).toLowerCase(),
    sourceSha256: request.sourceSha256,
    resourceSha256: String(value.resourceSha256).toLowerCase(),
    documentBasePath: String(value.documentBasePath),
    scriptCount: value.scriptCount,
    byteLength: value.byteLength,
    libraryOrigins: Object.freeze([...(value.libraryOrigins || [])]),
    runtimeLibraries: Object.freeze([...(value.runtimeLibraries || [])]),
    resourceMode: "exact",
    canvasGeneration: request.canvasGeneration,
    programIdentity: request.programIdentity,
  });
}

/**
 * The sole application owner for Edit author-runtime state. Its key is exactly
 * (sourcePath, canvasGeneration): ordinary source revisions, autosaves, and
 * comments intentionally cannot start another preparation in the same canvas.
 * A same-directory Finder rename that keeps HTML, SHA and canvas generation
 * only relocates that live key; it does not consume another prepare attempt.
 */
export class EditAuthorRuntimeSession {
  #port;
  #listeners = new Set();
  #snapshot = frozenSnapshot();
  #identity = null;
  #latestSourceIdentity = null;
  #latestSourceAuthoritative = false;
  #pendingPreparation = null;
  #activeRequest = null;
  #runtimeAttempt = null;
  #attemptGeneration = 0;
  #requestSequence = 0;
  #disposed = false;

  constructor({ port = null } = {}) {
    if (
      port !== null
      && (
        !isRecord(port)
        || typeof port.prepare !== "function"
        || typeof port.revoke !== "function"
      )
    ) {
      throw new TypeError("EditAuthorRuntimeSession requires a narrow prepare/revoke port.");
    }
    this.#port = port;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("EditAuthorRuntimeSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  #emit(next) {
    this.#snapshot = frozenSnapshot(next);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // View listeners observe state but cannot influence its lifecycle.
      }
    }
  }

  #revoke(grant) {
    if (!grant?.sessionId || !this.#port) return;
    void Promise.resolve(this.#port.revoke(grant.sessionId)).catch(() => undefined);
  }

  #revokeActiveGrants() {
    this.#revoke(this.#snapshot.grant);
  }

  #transitionToStatic(
    phase,
    lastOutcome,
    identity = this.#latestSourceAuthoritative
      ? this.#latestSourceIdentity
      : this.#identity,
  ) {
    this.#pendingPreparation = null;
    this.#activeRequest = null;
    this.#runtimeAttempt = null;
    this.#revokeActiveGrants();
    this.#emit({
      phase,
      sourceSha256: identity?.sourceSha256 || null,
      sourcePath: identity?.sourcePath || null,
      canvasGeneration: identity?.canvasGeneration ?? null,
      lastOutcome,
    });
  }

  refresh({
    html,
    sourceSha256,
    canvasGeneration,
    sourcePath,
    sourceIsAuthoritative = false,
  } = {}) {
    if (this.#disposed) return this.#snapshot;
    const normalizedSourceSha = String(sourceSha256 || "").toLowerCase();
    const normalizedSourcePath = normalizedRuntimeSourcePath(sourcePath);
    const identity = (
      typeof html === "string"
      && normalizedSourcePath
      && isEditRuntimeSourceSha256(normalizedSourceSha)
      && Number.isSafeInteger(canvasGeneration)
      && canvasGeneration >= 0
    ) ? Object.freeze({
      html,
      sourceSha256: normalizedSourceSha,
      sourcePath: normalizedSourcePath,
      canvasGeneration,
    }) : null;

    if (!identity) {
      this.#latestSourceIdentity = null;
      this.#latestSourceAuthoritative = false;
      if (this.#identity || this.#snapshot.phase !== "static") {
        this.#attemptGeneration += 1;
        this.#identity = null;
        this.#transitionToStatic("static", "invalid-source", null);
      }
      return this.#snapshot;
    }
    this.#latestSourceIdentity = identity;
    this.#latestSourceAuthoritative = Boolean(sourceIsAuthoritative);
    if (isLiveSameDirectoryPathRelocation(this.#identity, identity, this.#snapshot.phase)) {
      this.#identity = identity;
      this.#emit({
        phase: this.#snapshot.phase,
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        grant: this.#snapshot.grant,
        lastOutcome: this.#snapshot.lastOutcome,
      });
      return this.#snapshot;
    }
    const authorityJustBecameAvailable = (
      sameKey(this.#identity, identity)
      && sourceIsAuthoritative
      && this.#snapshot.phase === "static"
      && this.#snapshot.lastOutcome === "source-not-authoritative"
    );
    const failedProgramMovedToEquivalentCanvas = Boolean(
      this.#identity
      && this.#snapshot.phase === "static-fallback"
      && RETRYABLE_STATIC_FALLBACK_OUTCOMES.has(this.#snapshot.lastOutcome)
      && this.#identity.sourcePath === identity.sourcePath
      && this.#identity.sourceSha256 === identity.sourceSha256
    );
    if (failedProgramMovedToEquivalentCanvas) {
      // Canvas verification may replace a provisional generation after a
      // candidate has already failed. That presentation-only retry must not
      // execute the same author program again. Carry the failure onto the
      // equivalent latest canvas and wait for the explicit user retry.
      this.#attemptGeneration += 1;
      this.#identity = identity;
      this.#emit({
        phase: "static-fallback",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: this.#snapshot.lastOutcome,
      });
      return this.#snapshot;
    }
    // A non-authoritative source cannot consume the one attempt for this
    // canvas generation. It is only a precondition wait; the first matching
    // authoritative snapshot must still be able to prepare the final frame.
    if (sameKey(this.#identity, identity) && !authorityJustBecameAvailable) {
      if (
        this.#snapshot.phase === "static-fallback"
        && this.#snapshot.sourceSha256 !== identity.sourceSha256
      ) {
        this.#emit({
          phase: "static-fallback",
          sourceSha256: identity.sourceSha256,
          sourcePath: identity.sourcePath,
          canvasGeneration: identity.canvasGeneration,
          lastOutcome: this.#snapshot.lastOutcome,
        });
      }
      return this.#snapshot;
    }

    this.#attemptGeneration += 1;
    this.#pendingPreparation = null;
    this.#activeRequest = null;
    this.#runtimeAttempt = null;
    this.#revokeActiveGrants();
    this.#identity = identity;
    const attemptGeneration = this.#attemptGeneration;
    if (!sourceIsAuthoritative) {
      this.#emit({
        phase: "static",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "source-not-authoritative",
      });
      return this.#snapshot;
    }
    const scriptContract = analyzeEditRuntimeDocument(identity.html);
    const programIdentity = scriptContract.programIdentity;
    const unsupportedProgram = scriptContract.executableScripts.some((script) => (
      unsupportedEditRuntimeProgramReason(script.inline)
    ));
    if (
      scriptContract.executableScripts.length < 1
      && !scriptContract.unsupportedReason
    ) {
      this.#emit({
        phase: "static",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "not-candidate",
      });
      return this.#snapshot;
    }
    if (
      scriptContract.unsupportedReason
      || unsupportedProgram
      || scriptContract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
      || !programIdentity
    ) {
      this.#emit({
        phase: "static-fallback",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "unsupported-program",
      });
      return this.#snapshot;
    }
    if (!this.#port) {
      this.#emit({
        phase: "static-fallback",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "desktop-unavailable",
      });
      return this.#snapshot;
    }

    const request = Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      requestId: "edit-runtime-" + identity.sourceSha256.slice(-16)
        + "-" + String(++this.#requestSequence).toString(36),
      sourceSha256: identity.sourceSha256,
      html: identity.html,
      programIdentity,
      canvasGeneration: identity.canvasGeneration,
    });
    this.#activeRequest = request;
    this.#pendingPreparation = Object.freeze({
      attemptGeneration,
      identity,
      request,
      started: false,
    });
    this.#emit({
      phase: "preparing",
      sourceSha256: identity.sourceSha256,
      sourcePath: identity.sourcePath,
      canvasGeneration: identity.canvasGeneration,
    });
    return this.#snapshot;
  }

  /**
   * The Workbench calls this only after the preparing snapshot has committed
   * its no-interaction loading surface. That presentation acknowledgement is
   * what prevents a fast main-process grant from racing a mounted static frame.
   */
  startPreparation({ sourceSha256, canvasGeneration } = {}) {
    const pending = this.#pendingPreparation;
    if (
      this.#disposed
      || !pending
      || pending.started
      || this.#snapshot.phase !== "preparing"
      || !sameExactIdentity(this.#identity, pending.identity)
      || pending.identity.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || pending.identity.canvasGeneration !== canvasGeneration
    ) return false;
    this.#pendingPreparation = Object.freeze({ ...pending, started: true });
    const { attemptGeneration, identity, request } = pending;
    void Promise.resolve(this.#port.prepare(request)).then((result) => {
      if (
        this.#disposed
        || attemptGeneration !== this.#attemptGeneration
        || !sameExactIdentity(this.#identity, identity)
      ) {
        this.#revoke(result);
        return;
      }
      this.#pendingPreparation = null;
      const grant = normalizedGrant(result, request);
      if (!grant) {
        this.#transitionToStatic("static-fallback", "prepare-failed", identity);
        return;
      }
      this.#emit({
        phase: "ready",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        grant,
      });
    }).catch(() => {
      if (
        this.#disposed
        || attemptGeneration !== this.#attemptGeneration
        || !sameExactIdentity(this.#identity, identity)
      ) return;
      this.#transitionToStatic("static-fallback", "prepare-failed", identity);
    });
    return true;
  }

  beginRuntime({
    sessionId,
    sourceSha256,
    canvasGeneration,
    candidateId,
    candidateGeneration,
    candidateSourceRevision,
  } = {}) {
    const grant = this.#snapshot.grant;
    const attempt = normalizedRuntimeAttempt({
      candidateId,
      candidateGeneration,
      candidateSourceRevision,
    });
    if (
      !["ready", "running", "settled"].includes(this.#snapshot.phase)
      || !grant
      || !attempt
      || grant.sessionId !== String(sessionId || "").toLowerCase()
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    if (
      this.#snapshot.phase === "running"
      && sameRuntimeAttempt(this.#runtimeAttempt, attempt)
    ) return true;
    this.#runtimeAttempt = attempt;
    this.#emit({
      phase: "running",
      sourceSha256: grant.sourceSha256,
      sourcePath: this.#identity?.sourcePath || null,
      canvasGeneration: grant.canvasGeneration,
      grant,
    });
    return true;
  }

  settleRuntime({
    sessionId,
    sourceSha256,
    canvasGeneration,
    candidateId,
    candidateGeneration,
    candidateSourceRevision,
    outcome,
    preserveLastKnownGood = false,
    runtimePartial = false,
  } = {}) {
    const grant = this.#snapshot.grant;
    const attempt = normalizedRuntimeAttempt({
      candidateId,
      candidateGeneration,
      candidateSourceRevision,
    });
    if (
      this.#snapshot.phase !== "running"
      || !grant
      || !sameRuntimeAttempt(this.#runtimeAttempt, attempt)
      || grant.sessionId !== String(sessionId || "").toLowerCase()
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    this.#runtimeAttempt = null;
    // Replacing a disposable iframe is coordination, never authored-program
    // failure. Return the shared grant to the last truthful usable phase so a
    // successor attempt can begin without revocation or static degradation.
    if (outcome === "superseded") {
      this.#emit({
        phase: preserveLastKnownGood ? "settled" : "ready",
        sourceSha256: grant.sourceSha256,
        sourcePath: this.#identity?.sourcePath || null,
        canvasGeneration: grant.canvasGeneration,
        grant,
        lastOutcome: "superseded",
      });
      return true;
    }
    if (outcome === "ready") {
      this.#emit({
        phase: "settled",
        sourceSha256: grant.sourceSha256,
        sourcePath: this.#identity?.sourcePath || null,
        canvasGeneration: grant.canvasGeneration,
        grant,
        lastOutcome: runtimePartial === true ? "runtime-partial" : "ready",
      });
      return true;
    }
    if (preserveLastKnownGood) {
      this.#transitionToStatic(
        "static-fallback",
        outcome === "rejected" ? "candidate-rejected" : "candidate-failed",
      );
      return true;
    }
    this.#transitionToStatic(
      "static-fallback",
      outcome === "rejected" ? "rejected" : "runtime-failed",
    );
    return true;
  }

  retry(currentSource = null) {
    if (currentSource) this.refresh(currentSource);
    const identity = this.#latestSourceIdentity;
    if (
      this.#disposed
      || !identity
      || !this.#latestSourceAuthoritative
      || !this.#snapshot.retryAvailable
    ) return false;
    this.#identity = null;
    const snapshot = this.refresh({
      html: identity.html,
      sourceSha256: identity.sourceSha256,
      sourcePath: identity.sourcePath,
      canvasGeneration: identity.canvasGeneration,
      sourceIsAuthoritative: true,
    });
    return snapshot.phase === "preparing";
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#attemptGeneration += 1;
    this.#revokeActiveGrants();
    this.#identity = null;
    this.#latestSourceIdentity = null;
    this.#latestSourceAuthoritative = false;
    this.#pendingPreparation = null;
    this.#activeRequest = null;
    this.#runtimeAttempt = null;
    this.#listeners.clear();
    this.#snapshot = frozenSnapshot();
  }
}
