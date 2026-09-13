import { ProjectQueryFence } from "./project-query-fence.js";
import {
  planSourceLocatorRegister,
  planSourceLocatorTransition,
} from "./project/source-locator-plan.js";

function normalizedPath(value) {
  return value ? String(value) : null;
}

function comparablePath(value) {
  let sourcePath = normalizedPath(value);
  if (!sourcePath) return "";
  sourcePath = sourcePath.normalize("NFC");
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    sourcePath = sourcePath.slice("/private".length);
  } else if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    sourcePath = sourcePath.slice("/private".length);
  }
  try {
    if (
      typeof process !== "undefined"
      && (process.platform === "darwin" || process.platform === "win32")
    ) {
      return sourcePath.toLocaleLowerCase("en-US");
    }
  } catch {
    // Browser preview has no process; keep the NFC spelling.
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

function sameOpenTarget(left, right) {
  if (!left || !right) return !left && !right;
  return left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.projectRootPath === right.projectRootPath
    && left.targetKind === right.targetKind
    && left.workingCopyId === right.workingCopyId
    && left.versionId === right.versionId
    && samePath(left.exactSourcePath, right.exactSourcePath)
    && left.sourceSha256 === right.sourceSha256
    && left.sessionEpoch === right.sessionEpoch;
}

const TARGET_KINDS = new Set(["working-copy", "version"]);

export const PROJECT_SESSION_COORDINATION = Symbol("ProjectSession coordination");

function normalizedOpenTarget(value, {
  epoch,
  projectId,
  documentId,
  sourcePath,
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projectRootPath = normalizedPath(value.projectRootPath);
  const targetKind = String(value.targetKind || "");
  const workingCopyId = value.workingCopyId ? String(value.workingCopyId) : null;
  const versionId = value.versionId ? String(value.versionId) : null;
  const exactSourcePath = normalizedPath(value.exactSourcePath || sourcePath);
  const sourceSha256 = String(value.sourceSha256 || "");
  if (
    !projectRootPath
    || !TARGET_KINDS.has(targetKind)
    || !exactSourcePath
    || !/^sha256:[a-f0-9]{64}$/u.test(sourceSha256)
    || String(value.projectId || projectId || "") !== String(projectId || "")
    || String(value.documentId || documentId || "") !== String(documentId || "")
    || !samePath(exactSourcePath, sourcePath)
    || (targetKind === "working-copy" && !workingCopyId)
    || (targetKind === "version" && !versionId)
  ) return null;
  return Object.freeze({
    projectId: String(projectId),
    documentId: String(documentId),
    projectRootPath,
    targetKind,
    workingCopyId,
    versionId,
    exactSourcePath,
    sourceSha256,
    sessionEpoch: Number(epoch),
  });
}

function copyContext(value) {
  if (
    !value
    || !Number.isSafeInteger(Number(value.epoch))
    || !String(value.projectId || "")
    || !String(value.documentId || "")
    || !String(value.sourcePath || "")
  ) return null;
  const base = {
    epoch: Number(value.epoch),
    projectId: String(value.projectId),
    documentId: String(value.documentId),
    sourcePath: String(value.sourcePath),
  };
  const target = normalizedOpenTarget(value.openTarget ?? value, {
    ...base,
    sourcePath: base.sourcePath,
  });
  return Object.freeze(target ? { ...base, ...target } : base);
}

export class ProjectSession {
  #epoch = 0;

  #sourcePath = null;

  #projectId = "";

  #documentId = "";

  #openTarget = null;

  #observer = null;

  #queries = new ProjectQueryFence();

  constructor() {
    Object.defineProperty(this, PROJECT_SESSION_COORDINATION, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: Object.freeze({
        prepareTransitionSource: (value) => this.#prepareTransitionSource(value),
        transitionReservationCurrent: (value) => this.#transitionReservationCurrent(value),
        commitTransitionSource: (value, options) => this.#commitTransitionSource(value, options),
        publish: () => this.#publish(),
      }),
    });
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit() {
    try {
      this.#observer?.(this.snapshot);
    } catch {
      // A view observer cannot change project identity authority.
    }
  }

  openLocator(sourcePath) {
    this.#queries.clear();
    this.#epoch += 1;
    this.#sourcePath = normalizedPath(sourcePath);
    this.#projectId = "";
    this.#documentId = "";
    this.#openTarget = null;
    this.#emit();
    return this.locator;
  }

  register({
    epoch,
    sourcePath,
    projectId,
    documentId,
    openTarget = null,
    projectRootPath,
    targetKind,
    workingCopyId,
    versionId,
    exactSourcePath,
    sourceSha256,
  }) {
    if (planSourceLocatorRegister({
      epoch,
      liveEpoch: this.#epoch,
      sourcePath,
      liveSourcePath: this.#sourcePath,
      projectId,
      documentId,
      samePath,
    }).kind === "reject") return null;
    this.#projectId = String(projectId);
    this.#documentId = String(documentId);
    const requested = normalizedOpenTarget(
      openTarget ?? {
        projectId,
        documentId,
        projectRootPath,
        targetKind,
        workingCopyId,
        versionId,
        exactSourcePath,
        sourceSha256,
      },
      {
        epoch: this.#epoch,
        projectId: this.#projectId,
        documentId: this.#documentId,
        sourcePath: this.#sourcePath,
      },
    );
    if (requested) {
      this.#openTarget = requested;
    } else if (
      this.#openTarget
      && this.#openTarget.projectId === this.#projectId
      && this.#openTarget.documentId === this.#documentId
      && samePath(this.#openTarget.exactSourcePath, this.#sourcePath)
    ) {
      this.#openTarget = normalizedOpenTarget(this.#openTarget, {
        epoch: this.#epoch,
        projectId: this.#projectId,
        documentId: this.#documentId,
        sourcePath: this.#sourcePath,
      });
    } else {
      this.#openTarget = null;
    }
    this.#emit();
    return this.context;
  }

  #transitionSource({
    previousSourcePath,
    sourcePath,
    projectId = this.#projectId,
    documentId = this.#documentId,
    openTarget = null,
    publish = true,
  }) {
    const nextSourcePath = normalizedPath(sourcePath);
    if (planSourceLocatorTransition({
      nextSourcePath,
      previousSourcePath,
      liveSourcePath: this.#sourcePath,
      samePath,
    }).kind === "reject") return null;
    this.#queries.clear();
    this.#epoch += 1;
    this.#sourcePath = nextSourcePath;
    this.#projectId = String(projectId || "");
    this.#documentId = String(documentId || "");
    this.#openTarget = normalizedOpenTarget(openTarget, {
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: this.#sourcePath,
    });
    if (publish) this.#emit();
    return this.#projectId && this.#documentId ? this.context : this.locator;
  }

  transitionSource(input) {
    return this.#transitionSource(input);
  }

  #prepareTransitionSource({
    previousSourcePath,
    sourcePath,
    projectId = this.#projectId,
    documentId = this.#documentId,
    openTarget = null,
  } = {}) {
    const nextSourcePath = normalizedPath(sourcePath);
    if (
      !nextSourcePath
      || planSourceLocatorTransition({
        nextSourcePath,
        previousSourcePath,
        liveSourcePath: this.#sourcePath,
        samePath,
      }).kind === "reject"
    ) return null;
    return Object.freeze({
      epoch: this.#epoch,
      sourcePath: this.#sourcePath,
      projectId: this.#projectId,
      documentId: this.#documentId,
      previousSourcePath: normalizedPath(previousSourcePath),
      nextSourcePath,
      nextProjectId: String(projectId || ""),
      nextDocumentId: String(documentId || ""),
      openTarget,
      openTargetSnapshot: this.#openTarget,
    });
  }

  #transitionReservationCurrent(reservation) {
    return Boolean(
      reservation
      && this.#epoch === reservation.epoch
      && samePath(this.#sourcePath, reservation.sourcePath)
      && this.#projectId === reservation.projectId
      && this.#documentId === reservation.documentId
      && sameOpenTarget(this.#openTarget, reservation.openTargetSnapshot)
    );
  }

  #commitTransitionSource(reservation, { publish = true } = {}) {
    if (!this.#transitionReservationCurrent(reservation)) return null;
    return this.#transitionSource({
      previousSourcePath: reservation.previousSourcePath,
      sourcePath: reservation.nextSourcePath,
      projectId: reservation.nextProjectId,
      documentId: reservation.nextDocumentId,
      openTarget: reservation.openTarget,
      publish,
    });
  }

  #publish() {
    this.#emit();
    return this.snapshot;
  }

  adoptOpenTarget({ previousSourcePath, target } = {}) {
    if (!target || typeof target !== "object") return null;
    const exactSourcePath = normalizedPath(target.exactSourcePath);
    if (!exactSourcePath) return null;
    return this.transitionSource({
      previousSourcePath,
      sourcePath: exactSourcePath,
      projectId: target.projectId,
      documentId: target.documentId,
      openTarget: target,
    });
  }

  // A successful Working Copy save may refresh its byte hash without changing
  // the file selected by the user. Keep the existing epoch in that case: this
  // is an authority refresh, not a navigation. A rename or project move still
  // goes through adoptOpenTarget(), which deliberately creates a new epoch.
  refreshOpenTarget(target) {
    if (!target || typeof target !== "object") return null;
    if (!this.#sourcePath || !this.#projectId || !this.#documentId) return null;
    const next = normalizedOpenTarget(target, {
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: this.#sourcePath,
    });
    if (!next) return null;
    this.#openTarget = next;
    this.#emit();
    return this.context;
  }

  matches(context) {
    const candidate = copyContext(context);
    const declaresOpenTarget = Boolean(
      context
      && typeof context === "object"
      && (
        Object.hasOwn(context, "projectRootPath")
        || Object.hasOwn(context, "targetKind")
        || Object.hasOwn(context, "workingCopyId")
        || Object.hasOwn(context, "versionId")
        || Object.hasOwn(context, "exactSourcePath")
        || Object.hasOwn(context, "sourceSha256")
        || Object.hasOwn(context, "sessionEpoch")
      )
    );
    return Boolean(
      candidate
      && candidate.epoch === this.#epoch
      && samePath(candidate.sourcePath, this.#sourcePath)
      && candidate.projectId === this.#projectId
      && candidate.documentId === this.#documentId
      && (
        !this.#openTarget
        || (!declaresOpenTarget && !Object.hasOwn(candidate, "projectRootPath"))
        || (
          candidate.sessionEpoch === this.#openTarget.sessionEpoch
          && samePath(candidate.projectRootPath, this.#openTarget.projectRootPath)
          && candidate.targetKind === this.#openTarget.targetKind
          && candidate.workingCopyId === this.#openTarget.workingCopyId
          && candidate.versionId === this.#openTarget.versionId
          && samePath(candidate.exactSourcePath, this.#openTarget.exactSourcePath)
          && candidate.sourceSha256 === this.#openTarget.sourceSha256
        )
      ),
    );
  }

  matchesLocator({ epoch, sourcePath }) {
    return Number(epoch) === this.#epoch
      && samePath(sourcePath, this.#sourcePath);
  }

  beginQuery(name, { sourcePath = this.#sourcePath } = {}) {
    const identity = {
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: normalizedPath(sourcePath) || "",
    };
    return Object.freeze({
      identity,
      ticket: this.#queries.begin(identity, name),
    });
  }

  isQueryCurrent(query) {
    return Boolean(
      query
      && this.#queries.isCurrent(query.ticket)
      && this.matchesLocator(query.identity),
    );
  }

  get locator() {
    return Object.freeze({
      epoch: this.#epoch,
      sourcePath: this.#sourcePath,
    });
  }

  get context() {
    if (!this.#sourcePath || !this.#projectId || !this.#documentId) return null;
    const base = {
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: this.#sourcePath,
    };
    return Object.freeze(this.#openTarget ? { ...base, ...this.#openTarget } : base);
  }

  get snapshot() {
    return Object.freeze({
      epoch: this.#epoch,
      sourcePath: this.#sourcePath,
      projectId: this.#projectId,
      documentId: this.#documentId,
      registered: Boolean(this.context),
      ...(this.#openTarget ? { openTarget: this.#openTarget } : {}),
    });
  }

  get epoch() {
    return this.#epoch;
  }

  get sourcePath() {
    return this.#sourcePath;
  }

  get projectId() {
    return this.#projectId;
  }

  get documentId() {
    return this.#documentId;
  }

  get openTarget() {
    return this.#openTarget;
  }
}
