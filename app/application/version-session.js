function optionalId(value) {
  return value ? String(value) : null;
}

function initialSnapshot() {
  return Object.freeze({
    versions: Object.freeze([]),
    latestVersionId: null,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    viewMode: "current",
    viewingVersionId: null,
    historyPreview: null,
  });
}

export function validateVersionSessionVersions(versions) {
  const decoded = Array.isArray(versions) ? versions : [];
  const ids = new Set();
  for (const version of decoded) {
    if (typeof version?.id !== "string" || !version.id.trim() || ids.has(version.id)) {
      throw new TypeError("VersionSession requires unique decoded Version IDs.");
    }
    ids.add(version.id);
  }
  return decoded;
}

export class VersionSession {
  #observer = null;

  #snapshot = initialSnapshot();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    const versions = validateVersionSessionVersions(next.versions);
    this.#snapshot = Object.freeze({
      ...next,
      versions: Object.freeze([...versions]),
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change Version authority.
    }
  }

  reset() {
    this.#emit(initialSnapshot());
  }

  hydrate({
    versions,
    latestVersionId,
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId = null,
  }) {
    this.#emit({
      ...this.#snapshot,
      versions: Array.isArray(versions) ? versions : [],
      latestVersionId: optionalId(latestVersionId),
      currentBasedOnVersionId: optionalId(currentBasedOnVersionId),
      currentExactVersionId: optionalId(currentExactVersionId),
      restoredFromVersionId: optionalId(restoredFromVersionId),
    });
    return this.#snapshot;
  }

  updateAuthority({
    versions,
    latestVersionId,
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId,
  }) {
    const next = { ...this.#snapshot };
    if (versions !== undefined) {
      next.versions = Array.isArray(versions) ? versions : [];
    }
    if (latestVersionId !== undefined) {
      next.latestVersionId = optionalId(latestVersionId);
    }
    if (currentBasedOnVersionId !== undefined) {
      next.currentBasedOnVersionId = optionalId(currentBasedOnVersionId);
    }
    if (currentExactVersionId !== undefined) {
      next.currentExactVersionId = optionalId(currentExactVersionId);
    }
    if (restoredFromVersionId !== undefined) {
      next.restoredFromVersionId = optionalId(restoredFromVersionId);
    }
    this.#emit(next);
    return this.#snapshot;
  }

  markSourceEdited() {
    if (this.#snapshot.currentExactVersionId === null) return false;
    this.#emit({
      ...this.#snapshot,
      currentExactVersionId: null,
    });
    return true;
  }

  adoptCommitted(versionId) {
    const id = optionalId(versionId);
    if (!id) return false;
    this.#emit({
      ...this.#snapshot,
      latestVersionId: id,
      currentBasedOnVersionId: id,
      currentExactVersionId: id,
      restoredFromVersionId: null,
      viewMode: "current",
      viewingVersionId: null,
      historyPreview: null,
    });
    return true;
  }

  enterHistory(versionId, preview = null) {
    const id = optionalId(versionId);
    if (!id) return false;
    this.#emit({
      ...this.#snapshot,
      viewMode: "history",
      viewingVersionId: id,
      historyPreview: preview ? Object.freeze({ ...preview }) : null,
    });
    return true;
  }

  returnCurrent({
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId,
  } = {}) {
    const next = {
      ...this.#snapshot,
      viewMode: "current",
      viewingVersionId: null,
      historyPreview: null,
    };
    if (currentBasedOnVersionId !== undefined) {
      next.currentBasedOnVersionId = optionalId(currentBasedOnVersionId);
    }
    if (currentExactVersionId !== undefined) {
      next.currentExactVersionId = optionalId(currentExactVersionId);
    }
    if (restoredFromVersionId !== undefined) {
      next.restoredFromVersionId = optionalId(restoredFromVersionId);
    }
    this.#emit(next);
    return this.#snapshot;
  }

  captureView() {
    return Object.freeze({
      viewMode: this.#snapshot.viewMode,
      viewingVersionId: this.#snapshot.viewingVersionId,
      historyPreview: this.#snapshot.historyPreview,
    });
  }

  restoreView(view) {
    if (!view || !["current", "history"].includes(view.viewMode)) {
      return false;
    }
    this.#emit({
      ...this.#snapshot,
      viewMode: view.viewMode,
      historyPreview: view.viewMode === "history" ? view.historyPreview || null : null,
      viewingVersionId:
        view.viewMode === "history"
          ? optionalId(view.viewingVersionId)
          : null,
    });
    return true;
  }

  // Project transition rollback retains the complete immutable projection,
  // including the verified preview, without borrowing Document source bytes.
  captureSnapshot() {
    return Object.freeze({
      ...this.#snapshot,
      versions: Object.freeze([...this.#snapshot.versions]),
    });
  }

  restoreSnapshot(snapshot) {
    if (
      !snapshot
      || !["current", "history"].includes(snapshot.viewMode)
    ) return false;
    this.#emit({
      versions: Array.isArray(snapshot.versions) ? snapshot.versions : [],
      latestVersionId: optionalId(snapshot.latestVersionId),
      currentBasedOnVersionId: optionalId(snapshot.currentBasedOnVersionId),
      currentExactVersionId: optionalId(snapshot.currentExactVersionId),
      restoredFromVersionId: optionalId(snapshot.restoredFromVersionId),
      viewMode: snapshot.viewMode,
      historyPreview: snapshot.viewMode === "history" ? snapshot.historyPreview || null : null,
      viewingVersionId: snapshot.viewMode === "history"
        ? optionalId(snapshot.viewingVersionId)
        : null,
    });
    return true;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
