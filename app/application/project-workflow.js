import { decodeWorkspaceResponse } from "./workspace-controller-codecs.js";
import { isBridgeRequestError } from "./bridge-client.js";
import { PROJECT_SESSION_COORDINATION } from "./project-session.js";
import { RUN_SESSION_COORDINATION } from "./run-session.js";
import { verifyOpenTarget } from "./verified-project-context.js";
import { planProjectCloseAbort, planProjectCloseHydration, planProjectCloseIdentity } from "./project/close-plan.js";
import { planProjectOpen } from "./project/open-intent.js";
import {
  acquireProjectOpenWorkspace,
  inspectProjectOpenProjection,
  prepareProjectOpenCore,
  resolveProjectOpenSource,
} from "./project/open-operation-procedure.js";
import {
  planProjectSwitchAfterSourceProtection,
  planProjectSwitchAfterDrain,
  planProjectSwitchEntry,
  planProjectSwitchFence,
  planProjectSwitchValidationLease,
} from "./project/switch-plan.js";
import { reportInternalFailure } from "./internal-failure.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SWITCH_DEADLINE_MS = 15_000;

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function sourceLocatorUnknown(reason, operationId = null) {
  const error = new Error(String(reason || "文件位置恢复结果待核对。"));
  error.code = "SOURCE_LOCATOR_RECONCILE_UNKNOWN";
  error.projectOutcome = "unknown";
  if (operationId) error.operationId = String(operationId);
  return error;
}

function stale(identity) {
  return Object.freeze({
    status: "stale",
    identity: Object.freeze({ ...identity }),
  });
}

function matchesCloseProjectIdentity(projectSession, context) {
  if (!context || typeof context !== "object") return false;
  const liveContext = projectSession.context;
  if (!liveContext) return false;
  const baseMatches = projectSession.matches({
    epoch: context.epoch,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
  });
  if (!baseMatches) return false;
  return String(liveContext.workingCopyId || "")
    === String(context.workingCopyId || "");
}

function commentSourceTarget(comment) {
  return comment?.sourceAnchor || comment?.target || null;
}

function commentTargetForDisplay(sourceTarget, comment) {
  const visualHint = comment?.visualHint || comment?.target?.visualHint;
  return visualHint
    ? { ...sourceTarget, label: visualHint.label, visualHint }
    : sourceTarget;
}

function copyOpenRequest(value) {
  if (!value || typeof value.requestId !== "string" || !value.requestId) return null;
  return Object.freeze({
    requestId: value.requestId,
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : "",
  });
}

function copyOpenConfirmation(value) {
  if (!value || typeof value.requestId !== "string" || !value.requestId) return null;
  const classification = typeof value.classification === "string"
    ? value.classification
    : "";
  if (
    classification !== "new-external"
    && classification !== "known-external"
  ) return null;
  return Object.freeze({
    requestId: value.requestId,
    classification,
    sourceFileName: typeof value.sourceFileName === "string" ? value.sourceFileName : "",
    visibleV1FileName: typeof value.visibleV1FileName === "string"
      ? value.visibleV1FileName
      : "",
    projectsRootLabel: typeof value.projectsRootLabel === "string"
      ? value.projectsRootLabel
      : "文稿 › PageRoot › 项目",
    projectName: typeof value.projectName === "string" ? value.projectName : "",
    currentBasedOnVersionId: value.currentBasedOnVersionId || null,
    currentBasedOnOrdinal: Number(value.currentBasedOnOrdinal) || 0,
    latestOfficialVersionId: value.latestOfficialVersionId || null,
    latestOfficialOrdinal: Number(value.latestOfficialOrdinal) || 0,
    currentDiffersFromBase: value.currentDiffersFromBase === true,
    sourceRelation: value.sourceRelation === "changed" ? "changed" : "unchanged",
    deleteOriginal: value.deleteOriginal === true,
    busy: value.busy === true,
  });
}

function asOpenResult(value) {
  if (!value) return Object.freeze({ kind: "empty" });
  if (
    value.openKind === "confirmation"
    || (
      typeof value.requestId === "string"
      && value.requestId
      && (
        value.classification === "new-external"
        || value.classification === "known-external"
      )
      && typeof value.html !== "string"
    )
  ) {
    const confirmation = copyOpenConfirmation(value);
    return confirmation
      ? Object.freeze({ kind: "confirmation", confirmation })
      : Object.freeze({ kind: "invalid" });
  }
  const project = copyProject(value);
  return project
    ? Object.freeze({ kind: "project", project })
    : Object.freeze({ kind: "invalid" });
}

function copyProject(value) {
  if (!value || typeof value.name !== "string" || typeof value.html !== "string") {
    return null;
  }
  const sourcePath = value.sourcePath ? String(value.sourcePath) : null;
  const sha256 = value.sha256 ? String(value.sha256) : null;
  const projectId = String(value.projectId || "");
  const documentId = String(value.documentId || "");
  const hasIdentity = (
    /^project_[A-Za-z0-9_-]+$/.test(projectId)
    && /^doc_[A-Za-z0-9_-]+$/.test(documentId)
  );
  return Object.freeze({
    ...(value.path ? { path: String(value.path) } : {}),
    name: value.name,
    sourcePath,
    html: value.html,
    sha256,
    ...(hasIdentity ? { projectId, documentId } : {}),
    ...(value.openTarget && typeof value.openTarget === "object" && !Array.isArray(value.openTarget)
      ? { openTarget: Object.freeze({ ...value.openTarget }) }
      : {}),
    ...(value.lastModifiedAt
      ? { lastModifiedAt: String(value.lastModifiedAt) }
      : {}),
  });
}

function initialSnapshot(externalFileOpenSession, projectApplicationSession) {
  return Object.freeze({
    hydration: Object.freeze({
      phase: "idle",
      generation: 0,
      epoch: 0,
      sourcePath: null,
      error: null,
    }),
    supplemental: Object.freeze({
      phase: "idle",
      operationId: null,
      snapshotRevision: null,
      error: null,
    }),
    switch: Object.freeze({ phase: "idle", operationId: null }),
    rename: Object.freeze({ phase: "idle", operationId: null }),
    open: Object.freeze({ phase: "idle", operationId: null, pendingKind: null }),
    close: Object.freeze({ phase: "idle", requestId: null }),
    openConfirmation: null,
    externalOpen: externalFileOpenSession.snapshot,
    projectApplication: projectApplicationSession.snapshot,
  });
}

function sourceFileName(sourcePath) {
  const value = String(sourcePath || "");
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return value.slice(separator + 1);
}

function sourceExtension(sourcePath) {
  return sourceFileName(sourcePath).match(/(\.html?)$/iu)?.[1] || "";
}

function normalizedRenameStem(value, sourcePath) {
  const extension = sourceExtension(sourcePath);
  let stem = String(value || "").normalize("NFC").trim();
  if (extension && stem.toLowerCase().endsWith(extension.toLowerCase())) {
    stem = stem.slice(0, -extension.length).trim();
  }
  return stem;
}

function sourceStem(sourcePath) {
  const name = sourceFileName(sourcePath);
  const extension = sourceExtension(sourcePath);
  return name.slice(0, Math.max(0, name.length - extension.length)).normalize("NFC");
}

function rebasedManagedOpenTarget(openTarget, nextSourcePath, sourceSha256) {
  if (!openTarget || typeof openTarget !== "object" || Array.isArray(openTarget)) {
    return null;
  }
  const exactSourcePath = String(nextSourcePath || "");
  if (!exactSourcePath) return null;
  return {
    ...openTarget,
    exactSourcePath,
    ...(sourceSha256 ? { sourceSha256: String(sourceSha256) } : {}),
  };
}

function documentIsStable(session) {
  return Boolean(
    session
    && !session.pendingWrite
    && !session.flushPromise
    && session.persistState === "idle"
    && session.editRevision === session.lastPersistedRevision
  );
}

function documentProtectionEvidence(workflow, input) {
  if (typeof workflow?.verifiedProtectionEvidence === "function") {
    return workflow.verifiedProtectionEvidence(input) || null;
  }
  if (typeof workflow?.hasVerifiedProtectionEvidence === "function") {
    return workflow.hasVerifiedProtectionEvidence(input) === true
      ? Object.freeze({ kind: "legacyVerified", htmlSha256: null })
      : null;
  }
  return workflow?.hasVerifiedRecoveryCheckpoint?.(input) === true
    ? Object.freeze({ kind: "legacyVerified", htmlSha256: null })
    : null;
}

function documentHasProtectionEvidence(workflow, input) {
  return Boolean(documentProtectionEvidence(workflow, input));
}

function projectErrorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return cause && typeof cause === "object" && cause.code
    ? String(cause.code)
    : fallback;
}

function projectErrorMessage(codecs, cause, fallback) {
  return codecs.errorMessage(cause, fallback);
}

// ProjectWorkflow is the PR-3 renderer project-transition boundary. Main owns
// durable project-open ordering; the injected renderer Sessions keep their
// existing fact ownership. This workflow owns only hydration/switch/close
// operations, accepted-result execution and their stale-result fences.
export class ProjectWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #draftSession;
  #versionSession;
  #commentWorkflow;
  #runSession;
  #projectRulesWorkflow;
  #externalFileOpenSession;
  #projectApplicationSession;
  #documentWorkflow;
  #drainCoordinator;
  #codecs;
  #getCatalogRevision;
  #hashPort;
  #canvasPort;
  #projectOpenPort;
  #viewStatePort;
  #recentRunsPort;
  #navigationPort;
  #publication;
  #externalNavigationTransactions = new Map();
  #policies;
  #scheduler;
  #clock;
  #listeners = new Set();
  #eventListeners = new Set();
  #snapshot;
  #hydrationGeneration = 0;
  #operationSequence = 0;
  #openSequence = 0;
  #applicationSequence = 0;
  #pendingOpen = null;
  #openConfirmation = null;
  #externalAckPending = new Map();
  #renamePromise = null;
  #sourceLocatorPromise = null;
  #pendingLocatorReconcile = null;
  #appliedWatcherGeneration = 0;
  #locatorRetryHandle = null;
  #registeredProjectsRefresh = null;
  #reconcileScheduled = false;
  #pollWaiters = new Set();
  #disposed = false;
  #closeLifecycle = {
    preparingRequestId: null,
    frozenRequestId: null,
    frozenContext: null,
    abortedRequestIds: new Set(),
  };

  constructor({
    bridgeClient,
    ensureRegistered,
    getCatalogRevision = () => 0,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    commentWorkflow,
    runSession,
    projectRulesWorkflow,
    externalFileOpenSession,
    projectApplicationSession,
    documentWorkflow,
    drainCoordinator,
    codecs,
    ports = {},
    policies = {},
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.source !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires its project Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("ProjectWorkflow requires registration authority.");
    }
    if (!projectSession || typeof projectSession.openLocator !== "function") {
      throw new TypeError("ProjectWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.deactivate !== "function") {
      throw new TypeError("ProjectWorkflow requires DraftSession injection.");
    }
    if (!versionSession || typeof versionSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires VersionSession injection.");
    }
    if (
      !commentWorkflow
      || typeof commentWorkflow.inspectDraft !== "function"
      || typeof commentWorkflow.drainDraft !== "function"
      || typeof commentWorkflow.recoverDraft !== "function"
      || typeof commentWorkflow.inspectAttachment !== "function"
      || typeof commentWorkflow.waitForAttachments !== "function"
      || typeof commentWorkflow.resetForProjectTransition !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires CommentWorkflow composition.");
    }
    if (!runSession || typeof runSession.activate !== "function") {
      throw new TypeError("ProjectWorkflow requires RunSession injection.");
    }
    if (
      !projectRulesWorkflow
      || typeof projectRulesWorkflow.inspect !== "function"
      || typeof projectRulesWorkflow.drain !== "function"
      || typeof projectRulesWorkflow.resetForProjectTransition !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires ProjectRulesWorkflow composition.");
    }
    if (!externalFileOpenSession || typeof externalFileOpenSession.enqueue !== "function") {
      throw new TypeError("ProjectWorkflow requires ExternalFileOpenSession injection.");
    }
    if (!projectApplicationSession || typeof projectApplicationSession.enqueue !== "function") {
      throw new TypeError("ProjectWorkflow requires ProjectApplicationSession injection.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.flush !== "function"
      || typeof documentWorkflow.enqueueEdit !== "function"
      || typeof documentWorkflow.clearRecovery !== "function"
      || typeof documentWorkflow.resetForProjectTransition !== "function"
      || typeof documentWorkflow.captureProjectTransitionAuthority !== "function"
      || typeof documentWorkflow.restoreProjectTransitionAuthority !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires DocumentWorkflow composition.");
    }
    if (!drainCoordinator || typeof drainCoordinator.replace !== "function") {
      throw new TypeError("ProjectWorkflow requires the Controller DrainCoordinator.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("ProjectWorkflow requires a HashPort.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("ProjectWorkflow requires a CanvasAuthorityPort.");
    }
    if (!ports.projectOpen) {
      throw new TypeError("ProjectWorkflow requires a ProjectOpenPort.");
    }
    if (!ports.viewState || typeof ports.viewState.isTransitioning !== "function") {
      throw new TypeError("ProjectWorkflow requires a ViewStatePort.");
    }
    if (!ports.recentRuns || typeof ports.recentRuns.hydrate !== "function") {
      throw new TypeError("ProjectWorkflow requires a RecentRunsPort.");
    }
    if (
      typeof policies.canCloseDuringHydration !== "function"
      || typeof policies.shouldRecoverAfterCloseAbort !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires close coordination policies.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires a SchedulerPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("ProjectWorkflow requires a ClockPort.");
    }
    for (const method of [
      "isRecord",
      "sameSourcePath",
      "versionsFromWorkspace",
      "draftAuthorityFromWorkspace",
      "authoritativeDraftRevision",
      "commentsFromRecords",
      "changesFromDraftRecords",
      "rebindTargetsPreservingGlobal",
      "activeRunFromRecord",
      "isLockedLifecycleState",
      "commentEditSessionHasChanges",
      "recoveryIdentityFromRecord",
      "errorMessage",
    ]) {
      if (typeof codecs?.[method] !== "function") {
        throw new TypeError(`ProjectWorkflow codec ${method} is required.`);
      }
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#versionSession = versionSession;
    this.#commentWorkflow = commentWorkflow;
    this.#runSession = runSession;
    this.#projectRulesWorkflow = projectRulesWorkflow;
    this.#externalFileOpenSession = externalFileOpenSession;
    this.#projectApplicationSession = projectApplicationSession;
    this.#documentWorkflow = documentWorkflow;
    this.#drainCoordinator = drainCoordinator;
    this.#codecs = codecs;
    this.#getCatalogRevision = getCatalogRevision;
    this.#hashPort = ports.hash;
    this.#canvasPort = ports.canvas;
    this.#projectOpenPort = ports.projectOpen;
    this.#viewStatePort = ports.viewState;
    this.#recentRunsPort = ports.recentRuns;
    this.#navigationPort = ports.navigation || null;
    this.#publication = ports.publication || null;
    this.#policies = policies;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#snapshot = initialSnapshot(
      externalFileOpenSession,
      projectApplicationSession,
    );

    this.#externalFileOpenSession.setObserver(() => {
      this.#publishSnapshot();
      this.#scheduleDeferredReconciliation();
    });
    this.#projectApplicationSession.setObserver(() => {
      this.#publishSnapshot();
      this.#scheduleDeferredReconciliation();
    });
    this.#registerDrainObligations();
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    if (this.#locatorRetryHandle && typeof this.#scheduler.clearTimeout === "function") {
      this.#scheduler.clearTimeout(this.#locatorRetryHandle);
    }
    this.#locatorRetryHandle = null;
    this.#pendingLocatorReconcile = null;
    for (const waiter of [...this.#pollWaiters]) waiter.resolve(false);
    this.#externalAckPending.clear();
    this.#externalFileOpenSession.setObserver(null);
    this.#projectApplicationSession.setObserver(null);
    this.#externalFileOpenSession.dispose();
    this.#projectApplicationSession.dispose();
    for (const name of [
      "external-file-open",
      "project-application",
      "project-picker",
      "project-hydration",
      "view-transition",
      "submission",
      "attachments",
      "project-rules",
      "source",
      "draft",
      "native-edit",
    ]) this.#drainCoordinator.remove(name);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  get projectHydrating() {
    return this.#snapshot.hydration.phase === "hydrating";
  }

  get projectLoadError() {
    return this.#snapshot.hydration.phase === "failed"
      ? this.#snapshot.hydration.error
      : null;
  }

  reportLoadFailure(message) {
    const reason = String(message || "项目状态需要重新读取。");
    this.#setHydration({
      phase: "failed",
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
      error: reason,
    });
  }

  async retryHydration() {
    const sourcePath = this.#projectSession.sourcePath;
    if (!sourcePath) {
      return blocked("PROJECT_SOURCE_REQUIRED", "当前页面没有可重新读取的源文件。");
    }
    const epoch = this.#projectSession.epoch;
    this.#setHydration({ phase: "hydrating", epoch, sourcePath, error: null });
    return this.refreshWorkspace({
      sourcePath,
      epoch,
      sourceTransitionToken: epoch,
    });
  }

  async refreshWorkspace({
    sourcePath,
    epoch,
    fromDeferred = false,
    sourceTransitionToken,
  } = {}) {
    if (this.#disposed) {
      return blocked("PROJECT_WORKFLOW_DISPOSED", "项目读取工作流已经停止。");
    }
    if (!fromDeferred && sourceTransitionToken === undefined) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.refreshWorkspace({
          sourcePath,
          epoch,
          fromDeferred: true,
          sourceTransitionToken,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    return this.#hydrateWorkspace({
      sourcePath,
      epoch,
      sourceTransitionToken,
    });
  }

  async prepareSwitch({ fromDeferred = false } = {}) {
    const disposedPlan = planProjectSwitchEntry({ disposed: this.#disposed });
    if (disposedPlan.kind === "reject") {
      return blocked(disposedPlan.code, disposedPlan.reason);
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.prepareSwitch({ fromDeferred: true }),
      );
      if (deferred) return deferred;
    }

    const operationId = this.#nextOperationId("switch");
    this.#setSwitch("preparing", operationId);
    try {
      const switchObligations = this.#drainCoordinator.inspect("switch");
      const hardBlocker = switchObligations
        .find((status) => status.state === "blocked");
      const entry = planProjectSwitchEntry({
        drainBlockedReason: hardBlocker?.reason || null,
        projectLoadError: Boolean(this.projectLoadError),
        runLocked: this.#runSession.activeLocked,
        hasHistoryAction: this.#documentWorkflow.hasHistoryAction,
      });
      if (entry.kind === "reject") {
        return blocked(entry.code, entry.reason);
      }
      if (entry.action === "reset-failed") {
        this.#commentWorkflow.resetForProjectTransition();
        this.#draftSession.deactivate();
        this.#documentWorkflow.resetForProjectTransition();
        return succeeded({ operationId });
      }
      if (entry.action === "drain-run-lock") {
        const drained = await this.#drainCoordinator.drain("switch", {
          deadlineAt: this.#clock.now() + SWITCH_DEADLINE_MS,
        });
        return drained.ok
          ? succeeded({ operationId })
          : blocked("PROJECT_SWITCH_DRAIN_BLOCKED", drained.reason);
      }
      if (entry.kind === "wait") {
        const historyOutcome = await this.#documentWorkflow.waitForHistoryAction();
        if (historyOutcome.status !== "succeeded") {
          return blocked(
            "PROJECT_SWITCH_HISTORY_PENDING",
            "当前撤销或重做没有安全完成。",
          );
        }
      }

      const document = this.#documentSession.snapshot;
      const validationLease = planProjectSwitchValidationLease({
        obligationsResolved: switchObligations.every((status) => status.state === "resolved"),
        hasPendingNativeEdit: Boolean(this.#canvasPort.hasPendingNativeEdit?.()),
        hasHistoryAction: this.#documentWorkflow.hasHistoryAction,
        persistState: document.persistState,
        pendingWrite: document.hasPendingWrite,
        flushInFlight: document.isFlushing,
        editRevision: document.editRevision,
        lastPersistedRevision: document.lastPersistedRevision,
        sourcePath: this.#projectSession.sourcePath,
        persistedSourceSha256: document.persistedSourceSha256,
        workingHtmlSha256: document.workingHtmlSha256,
        canvasStatus: document.canvasAuthority?.status,
        canvasRenderedSha256: document.canvasAuthority?.renderedSha256,
      });
      if (entry.action === "continue" && validationLease.action === "reuse-verified") {
        this.#emit({
          type: "project-switch-validation-reused",
          operationId,
          sourceSha256: document.persistedSourceSha256,
        });
        return succeeded({ operationId, validationLease: "reused" });
      }

      const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
        || this.#canvasPort.isMounted();
      const shouldCommitCanvas = !this.#isHistoryView() && canvasIsMounted;
      let committed = shouldCommitCanvas
        ? this.#canvasPort.freezeWorkingSource({
            resumeEditing: false,
            trigger: "project-switch",
            endBehavior: "leave-canvas",
          })
        : null;
      const fencePlan = planProjectSwitchFence({
        needsCanvasCommit: shouldCommitCanvas,
        fenceOk: Boolean(committed?.ok),
        fenceReason: committed?.reason,
      });
      if (fencePlan.kind === "reject") {
        this.#canvasPort.showCommitBlocked?.(fencePlan.reason);
        return blocked(fencePlan.code, fencePlan.reason);
      }

      const cutoffRevision = this.#documentSession.editRevision;
      const drained = await this.#drainCoordinator.drain("switch", {
        deadlineAt: this.#clock.now() + SWITCH_DEADLINE_MS,
      });
      if (!drained.ok) {
        return blocked("PROJECT_SWITCH_DRAIN_BLOCKED", drained.reason);
      }
      const protectionEvidence = documentProtectionEvidence(this.#documentWorkflow, {
        context: this.#projectSession.context,
        revision: cutoffRevision,
      });
      const recoveryProtected = Boolean(protectionEvidence);
      const afterDrain = planProjectSwitchAfterDrain({
        editRevision: this.#documentSession.editRevision,
        cutoffRevision,
        pendingWrite: Boolean(this.#documentSession.pendingWrite),
        flushInFlight: Boolean(this.#documentSession.flushPromise),
        hasHistoryAction: this.#documentWorkflow.hasHistoryAction,
        recoveryProtected,
      });
      if (afterDrain.kind === "reject") {
        return blocked(afterDrain.code, afterDrain.reason);
      }
      if (shouldCommitCanvas) {
        const settledDocument = this.#documentSession.snapshot;
        const afterSourceProtection = planProjectSwitchAfterSourceProtection({
          needsSourceProtection: true,
          sourcePath: this.#projectSession.sourcePath,
          lastPersistedRevision: settledDocument.lastPersistedRevision,
          cutoffRevision,
          persistedSourceSha256: settledDocument.persistedSourceSha256,
          workingHtmlSha256: settledDocument.workingHtmlSha256,
          committedSourceSha256: committed?.workingSourceSha256,
          protectionHtmlSha256: protectionEvidence?.htmlSha256 || "",
          recoveryProtected,
        });
        if (afterSourceProtection.kind === "reject") {
          return blocked(
            afterSourceProtection.code,
            afterSourceProtection.reason,
          );
        }
      }
      return succeeded({ operationId });
    } catch (cause) {
      return rejected(
        projectErrorCode(cause, "PROJECT_SWITCH_REJECTED"),
        projectErrorMessage(this.#codecs, cause, "项目切换前的安全检查失败。"),
      );
    } finally {
      this.#setSwitch("idle", null);
    }
  }

  async openProject({
    kind = "local",
    sourcePath,
    projectId,
    fromDeferred = false,
    switchPrepared = false,
    transactionId = null,
  } = {}) {
    const openIntent = planProjectOpen({
      closePhase: this.#snapshot.close.phase,
      kind,
    });
    if (openIntent.kind === "reject") {
      return blocked(openIntent.code, openIntent.reason);
    }
    if (openIntent.action === "startup") return this.#openStartup({ transactionId });
    const operationId = this.#nextOpenOperation();
    this.#setOpen("opening", operationId, null);
    try {
      if (kind === "local" || kind === "recent") {
        const opened = kind === "recent"
          ? await this.#projectOpenPort.openRecent(String(sourcePath || ""))
          : await this.#projectOpenPort.openLocal();
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        const result = asOpenResult(opened);
        if (result.kind === "empty") {
          return succeeded({ operationId, opened: false });
        }
        if (result.kind === "confirmation") {
          this.#presentOpenConfirmation(result.confirmation, transactionId);
          return succeeded({
            operationId,
            opened: false,
            awaitingConfirmation: true,
          });
        }
        if (result.kind !== "project") {
          return rejected(
            "PROJECT_OPEN_REJECTED",
            "这次打开没有返回可安全切换的 HTML。",
          );
        }
        const switchOutcome = switchPrepared
          ? succeeded({ prepared: true })
          : await this.prepareSwitch({ fromDeferred });
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        if (switchOutcome.status !== "succeeded") {
          this.#pendingOpen = Object.freeze({
            kind,
            sourcePath: sourcePath || null,
            projectId: projectId || null,
            transactionId,
          });
          this.#setOpen("deferred", null, kind);
          return switchOutcome;
        }
        this.#pendingOpen = null;
        const accepted = this.#enqueueAcceptedProject(result.project, {
          kind,
          operationId,
          sourcePath: sourcePath || null,
          transactionId,
          switchPrepared: true,
        });
        if (!accepted) {
          return rejected(
            "PROJECT_APPLICATION_REJECTED",
            "无法安排当前 HTML 的安全切换。",
          );
        }
        return succeeded({ operationId, applicationId: accepted, opened: true });
      }

      const switchOutcome = switchPrepared
        ? succeeded({ prepared: true })
        : await this.prepareSwitch({ fromDeferred });
      if (this.#snapshot.close.phase === "ready") {
        return blocked(
          "PROJECT_OPEN_CLOSE_COMMITTED",
          "当前窗口正在关闭，没有接收新的 HTML。",
        );
      }
      if (switchOutcome.status !== "succeeded") {
        this.#pendingOpen = Object.freeze({
          kind,
          sourcePath: sourcePath || null,
          projectId: projectId || null,
          transactionId,
        });
        this.#setOpen("deferred", null, kind);
        return switchOutcome;
      }
      this.#pendingOpen = null;
      const project = await this.#openRegisteredProject(String(projectId || ""));
      if (!project) return succeeded({ operationId, opened: false });
      if (this.#snapshot.close.phase === "ready") {
        return blocked(
          "PROJECT_OPEN_CLOSE_COMMITTED",
          "当前窗口正在关闭，没有接收新的 HTML。",
        );
      }
      const accepted = this.#enqueueAcceptedProject(project, {
        kind,
        operationId,
        sourcePath: sourcePath || null,
        transactionId,
        switchPrepared: true,
      });
      if (!accepted) {
        return rejected(
          "PROJECT_APPLICATION_REJECTED",
          "无法安排当前 HTML 的安全切换。",
        );
      }
      return succeeded({ operationId, applicationId: accepted, opened: true });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        kind === "recent"
          ? "文件可能已移动；可重新选择当前位置，或移除旧记录。"
          : kind === "registered"
            ? "项目目录或工作文件在打开前发生变化；当前项目仍保持不变。"
          : "文件可能已移动或暂时不可读；可重新选择。",
      );
      this.#emit({
        type: "project-open-failed",
        kind,
        operationId,
        reason,
        sourcePath: sourcePath || null,
      });
      return rejected(projectErrorCode(cause, "PROJECT_OPEN_REJECTED"), reason);
    } finally {
      if (this.#snapshot.open.operationId === operationId) {
        this.#setOpen("idle", null, this.#pendingOpen?.kind || null);
      }
    }
  }

  acceptProject(project, {
    kind = "accepted",
    operationId = this.#nextOpenOperation(),
    sourcePath = null,
    switchPrepared = false,
    transactionId = null,
  } = {}) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "PROJECT_OPEN_CLOSE_COMMITTED",
        "当前窗口正在关闭，没有接收新的 HTML。",
      );
    }
    const accepted = this.#enqueueAcceptedProject(project, {
      kind,
      operationId,
      sourcePath,
      switchPrepared,
      transactionId,
    });
    return accepted
      ? succeeded({ operationId, applicationId: accepted, accepted: true, opened: true })
      : rejected("PROJECT_APPLICATION_REJECTED", "无法安排当前 HTML 的安全切换。");
  }

  acceptExternalProject(value) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "EXTERNAL_PROJECT_CLOSE_COMMITTED",
        "当前窗口正在关闭，外部 HTML 由下一次启动接收。",
      );
    }
    const request = copyOpenRequest(value);
    if (!request) {
      return rejected("EXTERNAL_PROJECT_REQUEST_INVALID", "外部 HTML 请求身份无效。");
    }
    if (value?.transactionId) {
      this.#externalNavigationTransactions.set(
        request.requestId,
        String(value.transactionId),
      );
    }
    const accepted = this.#externalFileOpenSession.enqueue(
      request,
      (next, options) => this.#openExternalProject(next, options),
    );
    if (!accepted) this.#externalNavigationTransactions.delete(request.requestId);
    if (accepted) this.#pendingOpen = null;
    this.#publishSnapshot();
    return accepted
      ? succeeded({ requestId: request.requestId })
      : blocked("EXTERNAL_PROJECT_DUPLICATE", "这个外部 HTML 请求已经处理过。");
  }

  resumeDeferredExternalProject() {
    const resumed = this.#externalFileOpenSession.resume(
      (request, options) => this.#openExternalProject(request, options),
    );
    return resumed
      ? succeeded({ resumed: true })
      : blocked("EXTERNAL_PROJECT_NOT_DEFERRED", "没有等待重试的外部 HTML。");
  }

  resumeDeferredProjectApplication() {
    const resumed = this.#projectApplicationSession.resume(
      (application) => this.#applyAcceptedProject(application),
    );
    return resumed
      ? succeeded({ resumed: true })
      : blocked("PROJECT_APPLICATION_NOT_DEFERRED", "没有等待继续的 HTML 切换。");
  }

  cancelProjectApplication(applicationId) {
    return this.#projectApplicationSession.cancel(applicationId, "stale");
  }

  reconcileDeferred() {
    if (this.#disposed) return;
    const switchBlocked = this.#drainCoordinator
      .inspect("switch")
      .some((status) => status.state !== "resolved");
    if (this.#projectApplicationSession.snapshot.status === "deferred") {
      this.#projectApplicationSession.reconcileDeferredSwitch({
        switchBlocked,
        execute: (application) => this.#applyAcceptedProject(application),
      });
      return;
    }
    if (this.#externalFileOpenSession.snapshot.status === "deferred") {
      this.#externalFileOpenSession.reconcileDeferredSwitch({
        switchBlocked,
        execute: (request, options) => this.#openExternalProject(request, options),
      });
      return;
    }
    if (!this.#pendingOpen || switchBlocked) return;
    const pending = this.#pendingOpen;
    this.#pendingOpen = null;
    void this.openProject({ ...pending, fromDeferred: true });
  }

  async prepareClose({ requestId, deadlineAt } = {}) {
    const identityPlan = planProjectCloseIdentity({ requestId, deadlineAt });
    if (identityPlan.kind === "reject") {
      return {
        ready: false,
        reason: identityPlan.reason,
        presentation: "in-app",
        retry: false,
      };
    }
    const closeRequestId = String(requestId || "");
    let imposedEditorFreeze = false;
    let frozenHtml = null;
    let frozenSourceSha256 = null;
    let ready = false;
    const lifecycle = this.#closeLifecycle;
    const inAppBlock = (reason, retry = true) => ({
      ready: false,
      reason: String(reason),
      presentation: "in-app",
      retry,
    });
    const projectOpenInFlight = () => (
      this.#snapshot.open.phase === "opening"
      || this.#externalFileOpenSession.snapshot.status !== "idle"
      || this.#projectApplicationSession.snapshot.status !== "idle"
    );
    const drainProjectOpenSessions = async () => {
      while (projectOpenInFlight()) {
        const result = await this.#drainCoordinator.drain("close", {
          deadlineAt: Number(deadlineAt) - 250,
        });
        if (!result.ok) return inAppBlock(result.reason);
      }
      return null;
    };
    lifecycle.preparingRequestId = closeRequestId;
    this.#setClose("preparing", closeRequestId);
    try {
      const projectOpenBlock = await drainProjectOpenSessions();
      if (projectOpenBlock) return projectOpenBlock;
      const hydrationPlan = planProjectCloseHydration({
        projectOpenInFlight: projectOpenInFlight(),
        projectHydrating: this.projectHydrating,
        canCloseDuringHydration: this.projectHydrating && this.#policies.canCloseDuringHydration({
          projectHydrating: true,
          viewTransitioning: this.#viewStatePort.isTransitioning(),
          submissionPending: this.#runSession.submissionPending,
          persistState: this.#documentSession.persistState,
          pendingWrite: Boolean(this.#documentSession.pendingWrite),
          flushInProgress: Boolean(this.#documentSession.flushPromise),
          draftPending: this.#draftSession.inspect().pending,
          draftFlushInProgress: this.#draftSession.inspect().writing,
          editRevision: this.#documentSession.editRevision,
          lastPersistedRevision: this.#documentSession.lastPersistedRevision,
        }),
        projectLoadError: Boolean(this.projectLoadError),
        pendingDirty: Boolean(
          this.#documentSession.pendingWrite
          || this.#documentSession.flushPromise
          || this.#documentWorkflow.hasHistoryAction
        ),
      });
      if (hydrationPlan.kind === "reject") {
        return inAppBlock(
          hydrationPlan.reason,
          hydrationPlan.code !== "PROJECT_CLOSE_LOAD_ERROR_DIRTY",
        );
      }
      if (hydrationPlan.action === "allow-hydration" || hydrationPlan.action === "allow-load-error") {
        ready = true;
        return { ready: true };
      }
      if (this.#documentWorkflow.hasHistoryAction) {
        const historyOutcome = await this.#documentWorkflow.waitForHistoryAction();
        if (historyOutcome.status !== "succeeded") {
          return inAppBlock("当前撤销或重做没有安全完成，已取消关闭。");
        }
      }
      const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
        || this.#canvasPort.isMounted();
      if (
        !this.#isHistoryView()
        && !this.#runSession.activeLocked
        && canvasIsMounted
      ) {
        const frozen = this.#canvasPort.freeze();
        if (!frozen) {
          return inAppBlock("编辑画布尚未就绪，已取消关闭以避免丢失文字草稿。");
        }
        if (!frozen.ok) {
          return inAppBlock(frozen.reason || "当前文字草稿无法安全提交，已取消关闭。");
        }
        imposedEditorFreeze = true;
        frozenHtml = frozen.html;
        const workingSourceSha256 = String(
          frozen.workingSourceSha256 || "",
        );
        const renderedProjectionSha256 = String(
          frozen.renderedProjectionSha256 || frozen.canvasRenderedSha256 || "",
        );
        if (!workingSourceSha256) {
          return inAppBlock("当前完整 HTML 还没有形成，已取消关闭。");
        }
        const projectionStale = frozen.renderedProjectionStale === true
          || renderedProjectionSha256 !== workingSourceSha256;
        if (projectionStale) {
          // Close is a source-protection boundary, not a claim that the user
          // has already seen the latest projection. Preserve the older
          // rendered Hash as a distinct fact and reconcile the frozen working
          // bytes below; project switch and AI submission keep their stronger
          // visible-projection gate.
          this.#emit({
            type: "project-close-source-safe-projection-stale",
            workingSourceSha256,
            renderedProjectionSha256,
          });
        }
        frozenSourceSha256 = workingSourceSha256;
        lifecycle.frozenRequestId = closeRequestId;
        lifecycle.frozenContext = this.#projectSession.context
          ? Object.freeze({ ...this.#projectSession.context })
          : null;
        if (
          frozen.html !== this.#documentSession.html
          && (Boolean(this.#projectSession.sourcePath) || Boolean(frozen.pendingMutation))
        ) {
          const editOutcome = this.#documentWorkflow.enqueueEdit({
            html: frozen.html,
            mutation: frozen.pendingMutation || undefined,
            context: this.#projectSession.context || undefined,
          });
          if (editOutcome.status !== "succeeded") {
            return inAppBlock(editOutcome.reason || "当前文字没有进入安全写回队列。");
          }
        }
      }
      const cutoffRevision = this.#documentSession.editRevision;
      const drained = await this.#drainCoordinator.drain("close", {
        deadlineAt: Number(deadlineAt) - 250,
      });
      if (!drained.ok) return inAppBlock(drained.reason);
      if (
        imposedEditorFreeze
        && this.#projectSession.sourcePath
        && frozenHtml !== null
        && !documentHasProtectionEvidence(this.#documentWorkflow, {
          context: this.#projectSession.context,
          revision: cutoffRevision,
        })
      ) {
        const boundaryOutcome = await this.#documentWorkflow.reconcileBoundary({
          frozenHtml,
          reportedSourceSha256: frozenSourceSha256,
          cutoffRevision,
          identity: this.#projectSession.snapshot,
          timeoutMs: 2_500,
        });
        if (boundaryOutcome.status !== "succeeded") {
          const reason = boundaryOutcome.reason
            || "关闭核对期间当前项目已切换，当前页面仍保持开启。";
          this.#emit({
            type: "project-close-reconciliation-blocked",
            code: boundaryOutcome.code || "",
            reason,
          });
          return inAppBlock(reason);
        }
      }
      const abortPlan = planProjectCloseAbort({
        aborted: lifecycle.abortedRequestIds.has(closeRequestId),
        projectOpenInFlight: projectOpenInFlight(),
      });
      if (abortPlan.kind === "reject") {
        return inAppBlock(abortPlan.reason);
      }
      if (
        imposedEditorFreeze
        && lifecycle.frozenContext
        && !matchesCloseProjectIdentity(this.#projectSession, lifecycle.frozenContext)
      ) {
        return inAppBlock("关闭核对期间当前项目身份已变化。", false);
      }
      if (imposedEditorFreeze && this.#projectSession.context) {
        lifecycle.frozenContext = Object.freeze({ ...this.#projectSession.context });
      }
      ready = true;
      this.#setClose("ready", closeRequestId);
      return { ready: true };
    } catch (cause) {
      return inAppBlock(
        cause instanceof Error ? cause.message : "关闭前安全写入检查失败。",
        false,
      );
    } finally {
      if (lifecycle.preparingRequestId === closeRequestId) {
        lifecycle.preparingRequestId = null;
      }
      if (!ready && imposedEditorFreeze && !this.#runSession.activeLocked) {
        if (lifecycle.frozenRequestId === closeRequestId) {
          lifecycle.frozenRequestId = null;
          lifecycle.frozenContext = null;
        }
        this.#canvasPort.unlock?.();
      }
      lifecycle.abortedRequestIds.delete(closeRequestId);
      if (!ready) this.#setClose("idle", null);
    }
  }

  abortClose({ requestId } = {}) {
    const closeRequestId = String(requestId || "");
    if (!closeRequestId) return;
    const lifecycle = this.#closeLifecycle;
    lifecycle.abortedRequestIds.add(closeRequestId);
    if (lifecycle.preparingRequestId === closeRequestId) return;
    if (
      this.#snapshot.close.requestId === closeRequestId
      && this.#snapshot.close.phase === "ready"
    ) {
      this.#setClose("idle", null);
    }
    if (lifecycle.frozenRequestId !== closeRequestId) {
      lifecycle.abortedRequestIds.delete(closeRequestId);
      return;
    }
    const projectIdentityMatches = Boolean(
      lifecycle.frozenContext
      && matchesCloseProjectIdentity(this.#projectSession, lifecycle.frozenContext)
    );
    const protectionVerified = projectIdentityMatches && Boolean(
      documentProtectionEvidence(this.#documentWorkflow, {
        context: this.#projectSession.context,
        revision: this.#documentSession.editRevision,
      })
    );
    const draftState = this.#draftSession.inspect();
    const mayRecover = this.#policies.shouldRecoverAfterCloseAbort({
      approvedRequestId: lifecycle.frozenRequestId,
      abortedRequestId: closeRequestId,
      imposedEditorFreeze: true,
      projectIdentityMatches,
      protectionVerified,
      projectLocked: this.#runSession.activeLocked,
      projectHydrating: this.projectHydrating,
      projectLoadError: Boolean(this.projectLoadError),
      viewTransitioning: this.#viewStatePort.isTransitioning(),
      submissionPending: this.#runSession.submissionPending,
      persistState: this.#documentSession.persistState,
      pendingWrite: Boolean(this.#documentSession.pendingWrite),
      flushInProgress: Boolean(this.#documentSession.flushPromise),
      draftPending: draftState.pending,
      draftFlushInProgress: draftState.writing,
      draftPersistError: Boolean(draftState.error),
      editRevision: this.#documentSession.editRevision,
      lastPersistedRevision: this.#documentSession.lastPersistedRevision,
    });
    if (!mayRecover) return;
    lifecycle.frozenRequestId = null;
    lifecycle.frozenContext = null;
    lifecycle.abortedRequestIds.delete(closeRequestId);
    this.#canvasPort.unlock?.();
    this.#setClose("idle", null);
  }

  hasPending(boundary) {
    return this.#drainCoordinator.hasPending(boundary);
  }

  inspectDrain(boundary) {
    return this.#drainCoordinator.inspect(boundary);
  }

  drain(boundary, options) {
    return this.#drainCoordinator.drain(boundary, options);
  }

  drainCloseFallback({ deadlineAt } = {}) {
    return this.#drainCoordinator.drain("close", {
      deadlineAt: Number(deadlineAt) || this.#clock.now() + 3_000,
    });
  }

  async refreshRecents() {
    if (typeof this.#projectOpenPort.listRecent !== "function") {
      return succeeded({ projects: [] });
    }
    try {
      const projects = await this.#projectOpenPort.listRecent();
      this.#emit({ type: "project-recents-loaded", projects });
      return succeeded({ projects });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "最近打开记录暂时无法读取。",
      );
      this.#emit({ type: "project-recents-failed", reason });
      return rejected("PROJECT_RECENTS_REJECTED", reason);
    }
  }

  async refreshRegisteredProjects() {
    if (typeof this.#projectOpenPort.listRegistered !== "function") {
      return succeeded({ projects: [] });
    }
    if (this.#registeredProjectsRefresh) return this.#registeredProjectsRefresh;
    this.#registeredProjectsRefresh = this.#refreshRegisteredProjects();
    return this.#registeredProjectsRefresh;
  }

  async restoreRegisteredWorkingCopy(projectId) {
    try {
      const value = await this.#projectOpenPort.restoreRegisteredWorkingCopy(String(projectId || ""));
      await this.refreshRegisteredProjects();
      return succeeded(value);
    } catch (cause) {
      return rejected("WORKING_COPY_RESTORE_REJECTED", projectErrorMessage(this.#codecs, cause, "工作文件无法恢复。"));
    }
  }

  async loadRegisteredProjectVersionSummaries(projectId) {
    if (typeof this.#projectOpenPort.listRegisteredVersionSummaries !== "function") {
      return rejected("PROJECT_VERSION_SUMMARIES_UNAVAILABLE", "当前环境不支持项目版本摘要读取。");
    }
    try {
      const summary = await this.#projectOpenPort.listRegisteredVersionSummaries(
        String(projectId || ""),
      );
      return succeeded(summary);
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "项目版本摘要暂时无法读取。",
      );
      return rejected("PROJECT_VERSION_SUMMARIES_REJECTED", reason);
    }
  }

  async #refreshRegisteredProjects() {
    try {
      // Coalesced readers must not publish a catalog that predates a Session
      // publication. Retry once; sustained changes leave the valid projection alone.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const revision = this.#getCatalogRevision();
        const projects = await this.#projectOpenPort.listRegistered();
        if (revision !== this.#getCatalogRevision()) continue;
        this.#emit({ type: "project-catalog-loaded", projects });
        return succeeded({ projects });
      }
      return stale({ operation: "project-catalog" });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "项目目录暂时无法读取。",
      );
      this.#emit({ type: "project-catalog-failed", reason });
      return rejected("PROJECT_CATALOG_REJECTED", reason);
    } finally {
      this.#registeredProjectsRefresh = null;
    }
  }

  scheduleProjectListRefreshAfterSettlement(context) {
    if (this.#disposed || !context || !this.#projectSession.matches(context)) return;
    // Project/Document/Version/Draft/Comment publication and Working Copy
    // confirmation are the authoritative path. Recent and catalog are
    // deferrable projections that refresh only after that settlement and
    // must never block or downgrade it.
    void Promise.all([
      this.refreshRecents(),
      this.refreshRegisteredProjects(),
    ]);
  }

  renameSource({ stem, deadlineAt } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "PROJECT_WORKFLOW_DISPOSED",
        "项目工作流已经停止。",
      ));
    }
    if (this.#renamePromise) return this.#renamePromise;
    if (this.#sourceLocatorPromise) {
      return this.#sourceLocatorPromise.then(() => this.renameSource({ stem, deadlineAt }));
    }
    const operation = this.#runSourceRename({ stem, deadlineAt });
    this.#renamePromise = operation;
    this.#sourceLocatorPromise = operation;
    operation.finally(() => {
      if (this.#renamePromise === operation) this.#renamePromise = null;
      if (this.#sourceLocatorPromise === operation) this.#sourceLocatorPromise = null;
    }).catch(() => {
      // #runSourceRename always converts failures to typed outcomes.
    });
    return operation;
  }

  reconcileExternalSourceLocator(input = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "PROJECT_WORKFLOW_DISPOSED",
        "项目工作流已经停止。",
      ));
    }
    const request = {
      reason: String(input.reason || "watch"),
      watcherGeneration: Number(input.watcherGeneration || 0),
      previousSourcePath: input.previousSourcePath
        ? String(input.previousSourcePath)
        : null,
      sourceMissing: input.sourceMissing === true
        ? true
        : input.sourceMissing === false ? false : null,
    };
    if (!this.#pendingLocatorReconcile) {
      this.#pendingLocatorReconcile = request;
    } else if (
      request.watcherGeneration >= Number(this.#pendingLocatorReconcile.watcherGeneration || 0)
    ) {
      const pending = this.#pendingLocatorReconcile;
      this.#pendingLocatorReconcile = {
        ...request,
        sourceMissing: pending.sourceMissing === true || request.sourceMissing === true
          ? true
          : pending.sourceMissing === false && request.sourceMissing === false
            ? false
            : null,
      };
    }
    if (this.#sourceLocatorPromise) {
      return this.#sourceLocatorPromise.then((result) => {
        if (this.#disposed) {
          return blocked("PROJECT_WORKFLOW_DISPOSED", "项目工作流已经停止。");
        }
        if (this.#sourceLocatorPromise) return this.#sourceLocatorPromise;
        if (this.#pendingLocatorReconcile) {
          return this.reconcileExternalSourceLocator(this.#pendingLocatorReconcile);
        }
        return result;
      });
    }
    const requested = this.#pendingLocatorReconcile;
    this.#pendingLocatorReconcile = null;
    const operation = this.#runLocatorReconcile(requested);
    this.#sourceLocatorPromise = operation;
    operation.finally(() => {
      if (this.#sourceLocatorPromise === operation) this.#sourceLocatorPromise = null;
    }).catch(() => {
      // #runLocatorReconcile always converts failures to typed outcomes.
    });
    return operation;
  }

  async #runSourceRename({ stem, deadlineAt } = {}) {
    let context = this.#projectSession.context;
    let previousSourcePath = context?.sourcePath || "";
    let expectedSha256 = this.#documentSession.persistedSourceSha256;
    const requestedStem = normalizedRenameStem(stem, previousSourcePath);
    const operationId = this.#nextOperationId("source-rename");
    const renameDeadline = Number(deadlineAt) || Date.now() + SWITCH_DEADLINE_MS;
    let canvasFrozen = false;
    let renameCommitted = false;
    try {
      if (!context || !this.#projectSession.matches(context)) {
        return blocked("SOURCE_RENAME_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
      }
      if (this.#managedOpenTarget()) {
        const reconciled = await this.#runLocatorReconcile({
          reason: "rename",
          previousSourcePath,
        });
        if (reconciled.status === "rejected" || reconciled.status === "unknown") {
          return reconciled;
        }
        context = this.#projectSession.context;
        previousSourcePath = context?.sourcePath || previousSourcePath;
        expectedSha256 = this.#documentSession.persistedSourceSha256;
        if (!context || !this.#projectSession.matches(context)) {
          return stale(context || { sourcePath: previousSourcePath });
        }
        if (this.#documentSession.persistState === "conflict") {
          return blocked(
            "SOURCE_RENAME_CONFLICT",
            "当前 HTML 与外部文件存在冲突，请先选择要保留的版本。",
          );
        }
      }
      if (!previousSourcePath || !expectedSha256 || !SHA256.test(expectedSha256)) {
        return blocked("SOURCE_RENAME_SOURCE_REQUIRED", "当前源 HTML 尚未形成可验证的文件身份。");
      }
      if (!requestedStem) {
        return rejected("SOURCE_RENAME_STEM_REQUIRED", "请输入新的 HTML 文件名。");
      }
      if (this.#runSession.activeLocked) {
        return blocked("SOURCE_RENAME_RUN_LOCKED", "当前 AI 任务仍在处理，不能修改文件名。");
      }
      if (this.projectHydrating || this.projectLoadError || this.#isHistoryView()) {
        return blocked("SOURCE_RENAME_VIEW_UNAVAILABLE", "当前视图尚未形成可安全重命名的源页面。");
      }
      if (typeof this.#projectOpenPort.renameSource !== "function") {
        return blocked("SOURCE_RENAME_UNAVAILABLE", "当前运行环境不能安全修改 HTML 文件名。");
      }

      const currentStem = sourceStem(previousSourcePath);
      if (requestedStem === currentStem) {
        return succeeded({ context, unchanged: true, sourcePath: previousSourcePath });
      }

      const committed = this.#canvasPort.freezeWorkingSource?.({
        resumeEditing: false,
        trigger: "project-rename",
      });
      if (!committed || !committed.ok) {
        return blocked(
          "SOURCE_RENAME_NATIVE_EDIT_PENDING",
          String(committed?.reason || "请先完成当前文字输入，再修改文件名。"),
        );
      }
      if (
        committed.html !== this.#documentSession.html
        || committed.pendingMutation
      ) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: committed.html,
          mutation: committed.pendingMutation || undefined,
          context,
        });
        if (enqueued.status !== "succeeded") {
          return this.#dependencyOutcome(
            enqueued,
            context,
            "SOURCE_RENAME_DOCUMENT_EDIT_REJECTED",
            "当前文字尚未安全进入源 HTML 写回队列。",
          );
        }
      }

      const drained = await this.#drainCoordinator.drain("switch", {
        deadlineAt: renameDeadline,
      });
      if (!drained.ok) {
        return blocked(
          "SOURCE_RENAME_DRAIN_INCOMPLETE",
          String(drained.reason || "当前项目尚未完成安全保存。"),
        );
      }
      if (
        this.#disposed
        || !this.#projectSession.matches(context)
        || !this.#codecs.sameSourcePath(this.#projectSession.sourcePath, previousSourcePath)
        || this.#documentSession.persistedSourceSha256 !== expectedSha256
        || !documentIsStable(this.#documentSession)
        || this.#documentWorkflow.hasHistoryAction
      ) {
        return stale(context);
      }

      const frozen = this.#canvasPort.freeze(
        "编辑画布尚未完成安全收口，不能修改文件名。",
      );
      if (!frozen?.ok) {
        return blocked(
          "SOURCE_RENAME_CANVAS_FENCE_REJECTED",
          String(frozen?.reason || "编辑画布尚未完成安全收口。"),
        );
      }
      canvasFrozen = true;
      if (
        frozen.html !== this.#documentSession.html
        || frozen.pendingMutation
      ) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: frozen.html,
          mutation: frozen.pendingMutation || undefined,
          context,
        });
        if (enqueued.status !== "succeeded") {
          return this.#dependencyOutcome(
            enqueued,
            context,
            "SOURCE_RENAME_FINAL_EDIT_REJECTED",
            "刚刚的文字输入没有安全写入源 HTML。",
          );
        }
        return blocked(
          "SOURCE_RENAME_FINAL_EDIT_QUEUED",
          "刚刚还有文字输入，源页正在安全保存，请稍后再试。",
        );
      }

      this.#setRename("renaming", operationId);
      let result;
      try {
        result = await this.#projectOpenPort.renameSource({
          operationId,
          sourcePath: previousSourcePath,
          stem: requestedStem,
          expectedSha256,
        });
      } catch (cause) {
        const active = typeof this.#projectOpenPort.getActive === "function"
          ? await this.#projectOpenPort.getActive().catch(() => null)
          : null;
        const expectedFileName = `${requestedStem}${sourceExtension(previousSourcePath)}`;
        if (
          !active
          || active.sha256 !== expectedSha256
          || sourceFileName(active.sourcePath).normalize("NFC")
            !== expectedFileName.normalize("NFC")
        ) throw cause;
        result = {
          ...active,
          operationId,
          previousSourcePath,
          fileName: expectedFileName,
          stem: requestedStem,
          extension: sourceExtension(previousSourcePath),
          renamed: true,
          replayed: true,
          workspaceRelinked: false,
        };
      }
      if (
        !result
        || String(result.operationId || "") !== operationId
        || !this.#codecs.sameSourcePath(result.previousSourcePath, previousSourcePath)
        || String(result.sha256 || "") !== expectedSha256
        || !String(result.sourcePath || "")
      ) {
        throw new Error("重命名结果与当前文件身份不一致。");
      }
      renameCommitted = true;
      if (
        this.#disposed
        || !this.#projectSession.matches(context)
        || this.#documentSession.persistedSourceSha256 !== expectedSha256
      ) return stale(context);

      const nextSourcePath = String(result.sourcePath);
      const transitioned = this.#publishSourceLocatorChange({
        previousSourcePath,
        nextSourcePath,
        context,
        expectedSha256,
        openTarget: this.#projectSession.openTarget,
      });
      if (!transitioned || !this.#projectSession.context) {
        throw new Error("文件已重命名，但当前项目身份已经变化。");
      }
      const journalRebase = await this.#documentWorkflow.rebaseRecoveryJournal?.({
        previousContext: context,
        context: transitioned,
      });
      if (journalRebase && journalRebase.status !== "succeeded") {
        throw new Error(String(
          journalRebase.reason || "文件已重命名，但恢复日志没有完成路径更新。",
        ));
      }

      const [recents, hydrated] = await Promise.all([
        this.refreshRecents(),
        this.refreshWorkspace({
          sourcePath: nextSourcePath,
          epoch: transitioned.epoch,
          fromDeferred: true,
        }),
      ]);
      if (
        recents.status !== "succeeded"
        || hydrated.status !== "succeeded"
      ) {
        return unknown(
          operationId,
          "文件名已经修改，但项目状态还没有完成刷新。",
        );
      }
      const nextContext = this.#projectSession.context;
      if (!nextContext || !this.#codecs.sameSourcePath(nextContext.sourcePath, nextSourcePath)) {
        return stale(transitioned);
      }
      this.scheduleProjectListRefreshAfterSettlement(nextContext);
      this.#emit({
        type: "project-source-renamed",
        context: nextContext,
        operationId,
        previousSourcePath,
        sourcePath: nextSourcePath,
        projectName: String(result.stem || requestedStem),
        lastModifiedAt: result.lastModifiedAt ? String(result.lastModifiedAt) : null,
      });
      return succeeded({
        context: nextContext,
        sourcePath: nextSourcePath,
        projectName: String(result.stem || requestedStem),
        lastModifiedAt: result.lastModifiedAt ? String(result.lastModifiedAt) : null,
      });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        renameCommitted
          ? "文件名已经修改，但项目状态还没有完成刷新。"
          : "文件名没有修改，请检查名称后重试。",
      );
      if (renameCommitted) {
        this.#emit({
          type: "project-source-rename-unknown",
          context,
          operationId,
          reason,
        });
        return unknown(operationId, reason);
      }
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_RENAME_REJECTED",
        reason,
      );
    } finally {
      if (canvasFrozen) {
        this.#setRename("idle", null);
        const unlock = () => {
          if (!this.#disposed) this.#canvasPort.unlock?.();
        };
        if (typeof this.#canvasPort.requestFrame === "function") {
          this.#canvasPort.requestFrame(unlock);
        } else {
          unlock();
        }
      }
    }
  }

  #managedOpenTarget() {
    const openTarget = this.#projectSession.openTarget;
    const context = this.#projectSession.context;
    return verifyOpenTarget(openTarget, {
      projectId: context?.projectId,
      documentId: context?.documentId,
      sourcePath: context?.sourcePath,
      sourceSha256: this.#documentSession.persistedSourceSha256,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
  }

  #captureLocatorFence(context) {
    const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
    return Object.freeze({
      context,
      epoch: Number(context?.epoch),
      projectId: String(context?.projectId || ""),
      documentId: String(context?.documentId || ""),
      sourcePath: String(context?.sourcePath || ""),
      sourceSha256: String(this.#documentSession.persistedSourceSha256 || ""),
      runRevision: typeof runCoordination?.locatorRevision === "function"
        ? runCoordination.locatorRevision(context?.sourcePath)
        : null,
    });
  }

  #isCurrentLocatorFence(fence) {
    if (!fence || this.#disposed) return false;
    if (
      !this.#projectSession.matches(fence.context)
      || this.#projectSession.epoch !== fence.epoch
      || this.#projectSession.projectId !== fence.projectId
      || this.#projectSession.documentId !== fence.documentId
      || !this.#codecs.sameSourcePath(
        this.#projectSession.sourcePath,
        fence.sourcePath,
      )
      || this.#documentSession.persistedSourceSha256 !== fence.sourceSha256
      || typeof this.#runSession[RUN_SESSION_COORDINATION]?.locatorRevision !== "function"
      || fence.runRevision === null
    ) return false;
    return this.#runSession[RUN_SESSION_COORDINATION]
      .locatorRevision(fence.sourcePath) === fence.runRevision;
  }

  #now() {
    return Number(this.#clock?.now?.() || Date.now());
  }

  #beginPublicationBatch() {
    return typeof this.#publication?.begin === "function"
      ? this.#publication.begin()
      : null;
  }

  #scheduleLocatorRetry(input) {
    if (this.#disposed) return;
    if (this.#locatorRetryHandle && typeof this.#scheduler.clearTimeout === "function") {
      this.#scheduler.clearTimeout(this.#locatorRetryHandle);
    }
    if (typeof this.#scheduler.setTimeout !== "function") return;
    this.#locatorRetryHandle = this.#scheduler.setTimeout(() => {
      this.#locatorRetryHandle = null;
      if (!this.#disposed) void this.reconcileExternalSourceLocator(input);
    }, 200);
  }

  #publishSourceLocatorChange({
    previousSourcePath,
    nextSourcePath,
    context,
    expectedSha256,
    openTarget = null,
    reservations = null,
  }) {
    const endPublication = this.#beginPublicationBatch();
    try {
      const canonicalSourcePath = String(nextSourcePath || "");
      const documentAuthority = this.#documentWorkflow.captureProjectTransitionAuthority?.();
      const pendingWrite = this.#documentSession.pendingWrite;
      const nextOpenTarget = rebasedManagedOpenTarget(
        openTarget,
        canonicalSourcePath,
        expectedSha256,
      );
      const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
      const projectCoordination = this.#projectSession[PROJECT_SESSION_COORDINATION] || null;
      if (
        reservations
        && (
          (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(reservations.run))
          || !projectCoordination?.transitionReservationCurrent?.(reservations.project)
        )
      ) return null;
      const runReservation = runCoordination?.prepareRebaseSource?.({
        previousSourcePath,
        sourcePath: canonicalSourcePath,
        projectId: context.projectId,
        documentId: context.documentId,
      });
      const projectReservation = projectCoordination?.prepareTransitionSource?.({
        previousSourcePath,
        sourcePath: canonicalSourcePath,
        projectId: context.projectId,
        documentId: context.documentId,
        ...(nextOpenTarget ? { openTarget: nextOpenTarget } : {}),
      });
      if ((this.#runSession && !runReservation) || !projectReservation) return null;

      // Both reservations are read-only. Commit the aggregate without
      // notifying observers; a failed ProjectSession CAS rolls the RunSession
      // reservation back, so no caller can publish a split locator.
      let runCommitted = false;
      if (this.#runSession) {
        if (!runCoordination?.commitRebaseSource?.(runReservation, { publish: false })) {
          return null;
        }
        runCommitted = true;
      }
      let transitioned = null;
      try {
        transitioned = projectCoordination?.commitTransitionSource?.(
          projectReservation,
          { publish: false },
        );
      } catch {
        if (runCommitted) {
          runCoordination?.rollbackRebaseSource?.(
            runReservation,
            { publish: false },
          );
        }
        return null;
      }
      if (!transitioned) {
        if (runCommitted) {
          runCoordination?.rollbackRebaseSource?.(
            runReservation,
            { publish: false },
          );
        }
        return null;
      }
      projectCoordination?.publish?.();
      runCoordination?.publish?.();
      if (pendingWrite && transitioned) {
        this.#documentSession.setPendingWrite({
          ...pendingWrite,
          ...transitioned,
          sourcePath: canonicalSourcePath,
          expectedSourceSha256: expectedSha256,
        });
      }
      this.#documentWorkflow.resetForProjectTransition();
      if (documentAuthority && transitioned) {
        this.#documentWorkflow.restoreProjectTransitionAuthority?.({
          authority: documentAuthority,
          context: transitioned,
          sourceSha256: expectedSha256,
        });
      }
      this.#commentWorkflow.resetForProjectTransition();
      this.#projectRulesWorkflow.resetForProjectTransition();
      return transitioned;
    } finally {
      endPublication?.();
    }
  }

  async #runLocatorReconcile({
    reason = "watch",
    watcherGeneration = 0,
    previousSourcePath = null,
    sourceMissing = null,
  } = {}) {
    const requestedReason = String(reason || "watch");
    const userRename = requestedReason === "rename";
    const context = this.#projectSession.context;
    if (!context) {
      return blocked("SOURCE_LOCATOR_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
    }
    const initialFence = this.#captureLocatorFence(context);
    const currentPath = context.sourcePath;
    if (
      previousSourcePath
      && !this.#codecs.sameSourcePath(previousSourcePath, currentPath)
    ) {
      return succeeded({ ignored: true, reason: "stale-path", sourcePath: currentPath });
    }
    if (
      watcherGeneration > 0
      && watcherGeneration < this.#appliedWatcherGeneration
    ) {
      return succeeded({ ignored: true, reason: "stale-generation", sourcePath: currentPath });
    }

    if (requestedReason === "watch" && sourceMissing === false) {
      let observed = succeeded({ unchanged: true });
      if (typeof this.#documentWorkflow.observeExternalSourceChange === "function") {
        observed = await this.#documentWorkflow.observeExternalSourceChange({
          sourcePath: currentPath,
        });
      }
      if (!this.#isCurrentLocatorFence(initialFence)) {
        return succeeded({ ignored: true, reason: "stale-session" });
      }
      return succeeded({
        context: this.#projectSession.context,
        sourcePath: currentPath,
        previousSourcePath: currentPath,
        status: observed.value?.conflict ? "content-changed" : "unchanged",
        relocated: false,
        contentChanged: Boolean(observed.value?.conflict),
        projectName: sourceStem(currentPath),
        ignored: false,
        observed: observed.value || null,
      });
    }

    const defer = (code, message) => {
      if (!userRename) {
        this.#scheduleLocatorRetry({
          reason: requestedReason,
          watcherGeneration,
          previousSourcePath: currentPath,
          sourceMissing,
        });
      }
      return blocked(code, message);
    };

    if (this.projectHydrating || this.projectLoadError || this.#isHistoryView()) {
      return defer(
        "SOURCE_LOCATOR_VIEW_UNAVAILABLE",
        "当前视图尚未形成可安全核对的源页面。",
      );
    }
    if (this.#runSession.activeLocked) {
      return defer(
        "SOURCE_LOCATOR_RUN_LOCKED",
        "当前 AI 任务仍在处理，稍后会再核对文件位置。",
      );
    }

    const committed = this.#canvasPort.freezeWorkingSource?.({
      resumeEditing: false,
      trigger: "source-locator-reconcile",
    });
    if (committed && !committed.ok) {
      return defer(
        "SOURCE_LOCATOR_NATIVE_EDIT_PENDING",
        String(committed.reason || "请先完成当前文字输入，再继续。"),
      );
    }
    if (
      committed
      && (
        committed.html !== this.#documentSession.html
        || committed.pendingMutation
      )
    ) {
      const enqueued = this.#documentWorkflow.enqueueEdit({
        html: committed.html,
        mutation: committed.pendingMutation || undefined,
        context,
      });
      if (enqueued.status !== "succeeded") {
        return this.#dependencyOutcome(
          enqueued,
          context,
          "SOURCE_LOCATOR_DOCUMENT_EDIT_REJECTED",
          "当前文字尚未安全进入源 HTML 写回队列。",
        );
      }
      return defer(
        "SOURCE_LOCATOR_DOCUMENT_EDIT_QUEUED",
        "刚刚还有文字输入，源页正在安全保存，稍后会再核对文件位置。",
      );
    }

    const drained = await this.#drainCoordinator.drain("switch", {
      deadlineAt: this.#now() + SWITCH_DEADLINE_MS,
    });
    if (!this.#isCurrentLocatorFence(initialFence)) {
      return succeeded({ ignored: true, reason: "stale-session" });
    }
    if (!drained.ok) {
      return defer(
        "SOURCE_LOCATOR_DRAIN_INCOMPLETE",
        String(drained.reason || "当前项目尚未完成安全保存。"),
      );
    }
    if (this.#disposed) {
      return blocked("PROJECT_WORKFLOW_DISPOSED", "项目工作流已经停止。");
    }

    const liveContext = this.#projectSession.context;
    if (!liveContext || !this.#isCurrentLocatorFence(initialFence)) {
      return succeeded({ ignored: true, reason: "stale-session" });
    }
    if (
      this.#documentSession.persistState === "conflict"
      && typeof this.#documentWorkflow.observeExternalSourceChange === "function"
    ) {
      const observedConflict = await this.#documentWorkflow.observeExternalSourceChange({
        sourcePath: liveContext.sourcePath,
      });
      return this.#isCurrentLocatorFence(initialFence)
        ? observedConflict
        : succeeded({ ignored: true, reason: "stale-session" });
    }

    const openTarget = this.#managedOpenTarget();
    const canReconcileManaged = Boolean(
      openTarget
      && typeof this.#projectOpenPort.reconcileActiveManagedSource === "function"
      && SHA256.test(this.#documentSession.persistedSourceSha256 || "")
    );
    const operationId = this.#nextOperationId("source-locator");
    const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
    const projectCoordination = this.#projectSession[PROJECT_SESSION_COORDINATION] || null;
    const transitionReservations = canReconcileManaged
      ? Object.freeze({
          run: runCoordination?.prepareRebaseSource?.({
            previousSourcePath: liveContext.sourcePath,
            sourcePath: liveContext.sourcePath,
            projectId: liveContext.projectId,
            documentId: liveContext.documentId,
          }),
          project: projectCoordination?.prepareTransitionSource?.({
            previousSourcePath: liveContext.sourcePath,
            sourcePath: liveContext.sourcePath,
            projectId: liveContext.projectId,
            documentId: liveContext.documentId,
            openTarget,
          }),
        })
      : null;
    if (
      canReconcileManaged
      && (
        (this.#runSession && !transitionReservations.run)
        || !transitionReservations.project
      )
    ) return succeeded({ ignored: true, reason: "stale-session" });
    let hostCommitted = false;
    let settledFence = initialFence;
    try {
      let result = null;
      if (canReconcileManaged) {
        if (!this.#isCurrentLocatorFence(initialFence)) {
          return succeeded({ ignored: true, reason: "stale-session" });
        }
        hostCommitted = true;
        result = await this.#projectOpenPort.reconcileActiveManagedSource({
          operationId,
          previousSourcePath: liveContext.sourcePath,
          projectId: liveContext.projectId,
          documentId: liveContext.documentId,
          workingCopyId: String(openTarget.workingCopyId),
          versionId: String(openTarget.versionId),
          expectedSourceSha256: this.#documentSession.persistedSourceSha256,
          reason: requestedReason,
          ...(watcherGeneration > 0 ? { watcherGeneration } : {}),
        });
        if (
          !this.#isCurrentLocatorFence(initialFence)
          || (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(transitionReservations.run))
          || !projectCoordination?.transitionReservationCurrent?.(transitionReservations.project)
        ) {
          throw sourceLocatorUnknown(
            "文件位置恢复已经返回，但当前项目身份或源 Hash 已经变化。",
            operationId,
          );
        }
        const reconciledTarget = result?.openTarget
          ? verifyOpenTarget(result.openTarget, {
            projectId: liveContext.projectId,
            documentId: liveContext.documentId,
            sourceSha256: result.sourceSha256,
            sameSourcePath: this.#codecs.sameSourcePath,
            targetKind: "working-copy",
          })
          : null;
        if (
          !result
          || String(result.operationId || "") !== operationId
          || !reconciledTarget
          || String(reconciledTarget.workingCopyId || "") !== String(openTarget.workingCopyId)
          || String(reconciledTarget.versionId || "") !== String(openTarget.versionId)
        ) {
          throw sourceLocatorUnknown(
            "当前工作文件身份无法核对，PageRoot 没有切换路径。",
            operationId,
          );
        }
        const nextGeneration = Number(result.watcherGeneration || 0);
        if (nextGeneration > 0) {
          this.#appliedWatcherGeneration = Math.max(
            this.#appliedWatcherGeneration,
            nextGeneration,
          );
        }
        const nextSourcePath = String(
          reconciledTarget.exactSourcePath || result.sourcePath || "",
        );
        const pathChanged = !this.#codecs.sameSourcePath(
          nextSourcePath,
          liveContext.sourcePath,
        );
        if (pathChanged) {
          if (!this.#isCurrentLocatorFence(initialFence)) {
            throw sourceLocatorUnknown(
              "文件位置恢复已经返回，但当前项目身份或源 Hash 已经变化。",
              operationId,
            );
          }
          const transitioned = this.#publishSourceLocatorChange({
            previousSourcePath: liveContext.sourcePath,
            nextSourcePath,
            context: liveContext,
            expectedSha256: String(result.sourceSha256),
            openTarget: reconciledTarget,
            reservations: transitionReservations,
          });
          if (!transitioned || !this.#projectSession.context) {
            throw sourceLocatorUnknown("文件位置已恢复，但本地 Locator 事务未能提交。", operationId);
          }
          settledFence = this.#captureLocatorFence(transitioned);
          const journalRebase = await this.#documentWorkflow.rebaseRecoveryJournal?.({
            previousContext: liveContext,
            context: transitioned,
          });
          if (!this.#isCurrentLocatorFence(settledFence)) {
            throw sourceLocatorUnknown(
              "文件位置已恢复，但恢复日志返回时当前项目身份或源 Hash 已经变化。",
              operationId,
            );
          }
          if (journalRebase && journalRebase.status !== "succeeded") {
            throw sourceLocatorUnknown(
              String(journalRebase.reason || "文件位置已恢复，但恢复日志没有完成路径更新。"),
              operationId,
            );
          }
          const recents = await this.refreshRecents();
          if (recents.status !== "succeeded") {
            return unknown(operationId, "文件位置已经恢复，但项目状态还没有完成刷新。");
          }
          if (!this.#isCurrentLocatorFence(settledFence)) {
            throw sourceLocatorUnknown(
              "文件位置已恢复，但最近项目刷新返回时当前项目身份已经变化。",
              operationId,
            );
          }
          const nextContext = this.#projectSession.context;
          if (!nextContext) {
            throw sourceLocatorUnknown(
              "文件位置已恢复，但当前项目身份已经变化。",
              operationId,
            );
          }
          this.scheduleProjectListRefreshAfterSettlement(nextContext);
          this.#emit({
            type: "project-source-relocated",
            context: nextContext,
            operationId,
            previousSourcePath: liveContext.sourcePath,
            sourcePath: nextSourcePath,
            projectName: sourceStem(nextSourcePath),
            status: String(result.status || "relocated"),
            contentChanged: result.status === "content-changed",
          });
        }
      }

      const observedPath = this.#projectSession.sourcePath || liveContext.sourcePath;
      let observed = succeeded({ unchanged: true });
      if (typeof this.#documentWorkflow.observeExternalSourceChange === "function") {
        observed = await this.#documentWorkflow.observeExternalSourceChange({
          sourcePath: observedPath,
        });
      }
      if (!this.#isCurrentLocatorFence(settledFence)) {
        if (hostCommitted) {
          throw sourceLocatorUnknown(
            "文件位置核对已返回，但当前项目身份或源 Hash 已经变化。",
            operationId,
          );
        }
        return succeeded({ ignored: true, reason: "stale-session" });
      }
      const nextContext = this.#projectSession.context;
      return succeeded({
        context: nextContext,
        sourcePath: observedPath,
        previousSourcePath: liveContext.sourcePath,
        status: result?.status || (observed.value?.conflict ? "content-changed" : "unchanged"),
        relocated: Boolean(
          result
          && !this.#codecs.sameSourcePath(observedPath, liveContext.sourcePath),
        ),
        contentChanged: Boolean(
          result?.status === "content-changed" || observed.value?.conflict,
        ),
        projectName: sourceStem(observedPath),
        ignored: false,
        observed: observed.value || null,
      });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "当前工作文件暂时无法核对位置，PageRoot 没有切换路径。",
      );
      this.#emit({
        type: "project-source-locator-failed",
        context: this.#projectSession.context || liveContext,
        operationId,
        code: projectErrorCode(cause, "SOURCE_LOCATOR_REJECTED"),
        reason,
      });
      if (hostCommitted && cause?.projectOutcome !== "unknown") {
        return unknown(operationId, reason);
      }
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_LOCATOR_REJECTED",
        reason,
      );
    }
  }

  async #openRegisteredProject(projectId) {
    if (typeof this.#projectOpenPort.openRegistered !== "function") {
      throw new Error("当前运行环境不能安全打开项目目录中的 HTML。");
    }
    return this.#projectOpenPort.openRegistered(projectId);
  }

  #registerDrainObligations() {
    this.#drainCoordinator.replace("external-file-open", {
      label: "等待外部 HTML 打开完成",
      inspect: (boundary) => {
        if (boundary !== "close") return { state: "resolved" };
        const status = this.#externalFileOpenSession.snapshot.status;
        if (
          this.#openConfirmation
          || status === "awaiting-confirmation"
          || (status !== "idle" && status !== "attention")
        ) {
          return {
            state: "pending",
            reason: this.#openConfirmation
              ? "外部 HTML 打开确认仍在等待选择。"
              : "外部 HTML 正在读取或等待安全切换。",
          };
        }
        return { state: "resolved" };
      },
      drain: ({ deadlineAt }) => this.#drainExternalOpenForClose(deadlineAt),
    });
    this.#drainCoordinator.replace("project-application", {
      label: "等待已接收的 HTML 切换完成",
      inspect: (boundary) => (
        boundary === "close"
        && this.#projectApplicationSession.snapshot.status !== "idle"
      ) ? {
        state: "pending",
        reason: "已接收的 HTML 仍在完成安全切换。",
      } : { state: "resolved" },
      drain: ({ deadlineAt }) => this.#waitUntil(
        () => this.#projectApplicationSession.snapshot.status === "idle",
        deadlineAt,
      ),
    });
    this.#drainCoordinator.replace("project-picker", {
      label: "等待本地 HTML 选择完成",
      inspect: (boundary) => (
        boundary === "close" && this.#snapshot.open.phase === "opening"
      ) ? {
        state: "pending",
        reason: "本地 HTML 选择仍在等待结果。",
      } : { state: "resolved" },
      drain: ({ deadlineAt }) => this.#waitUntil(
        () => this.#snapshot.open.phase !== "opening",
        deadlineAt,
      ),
    });
    this.#drainCoordinator.replace("project-hydration", {
      label: "等待项目读取完成",
      inspect: (boundary) => (
        boundary === "switch" && this.projectHydrating
      ) ? {
        state: "pending",
        reason: "当前项目仍在读取，不能开始新的项目切换。",
      } : { state: "resolved" },
    });
    this.#drainCoordinator.replace("view-transition", {
      label: "等待页面切换完成",
      inspect: (boundary) => {
        // A source rename owns the final Canvas fence while its desktop
        // transaction is unresolved. This must be an Application fact rather
        // than depending on the asynchronous React projection of the
        // workflow snapshot; otherwise a close or project switch could slip
        // between the desktop call and the next presentation render.
        if (this.#snapshot.rename.phase !== "idle") {
          return {
            state: "blocked",
            reason: "正在安全修改 HTML 文件名，请等待本次操作完成后再继续。",
          };
        }
        return this.#viewStatePort.isTransitioning() && boundary !== "history"
          ? {
              state: "blocked",
              reason: "正在核对历史或当前 HTML，请等待本次切换完成后再继续。",
            }
          : { state: "resolved" };
      },
    });
    this.#drainCoordinator.replace("submission", {
      label: "等待本轮提交准备结束",
      inspect: (boundary) => (
        boundary !== "submit" && this.#runSession.submissionPending
      ) ? {
        state: "pending",
        reason: "内部 AI 的冻结 Request 尚未安全建立。",
      } : { state: "resolved" },
      drain: ({ deadlineAt }) => this.#waitUntil(
        () => !this.#runSession.submissionPending,
        deadlineAt,
      ),
    });
    this.#drainCoordinator.replace("attachments", {
      label: "等待附件添加完成",
      inspect: () => this.#commentWorkflow.inspectAttachment(),
      drain: () => this.#commentWorkflow.waitForAttachments(),
    });
    this.#drainCoordinator.replace("project-rules", {
      label: "等待项目规则保存",
      inspect: () => this.#projectRulesWorkflow.inspect(),
      drain: () => this.#projectRulesWorkflow.drain(),
    });
    this.#drainCoordinator.replace("source", {
      label: "等待当前 HTML 写回",
      inspect: (boundary) => this.#inspectSourceObligation(boundary),
      drain: async ({ boundary }) => {
        if (this.#documentWorkflow.hasHistoryAction) {
          const history = await this.#documentWorkflow.waitForHistoryAction();
          if (history.status !== "succeeded") return false;
        }
        const outcome = await this.#documentWorkflow.flush({
          throughRevision: this.#documentSession.editRevision,
        });
        if (outcome.status === "succeeded") return true;
        if (boundary !== "switch" && boundary !== "close") return false;
        const protectedOutcome = await this.#documentWorkflow.protectForDetach?.({
          context: this.#projectSession.context,
        });
        return protectedOutcome?.status === "succeeded";
      },
    });
    this.#drainCoordinator.replace("draft", {
      label: "等待评论记录写入",
      alwaysDrain: true,
      inspect: (boundary) => this.#inspectDraftObligation(boundary),
      drain: ({ boundary }) => this.#drainDraftObligation(boundary),
    });
    this.#drainCoordinator.replace("native-edit", {
      label: "等待当前文字输入收口",
      inspect: () => this.#canvasPort.hasPendingNativeEdit?.()
        ? { state: "pending", reason: "当前文字尚未完成输入，不能离开编辑画布。" }
        : { state: "resolved" },
    });
  }

  #inspectSourceObligation(boundary) {
    if (this.#runSession.activeLocked && boundary !== "submit") {
      return { state: "resolved" };
    }
    if (!this.#projectSession.sourcePath && this.#documentSession.editRevision > 0) {
      return {
        state: "blocked",
        reason: "当前编辑尚未绑定本地 HTML，请先导出或打开本地文件。",
      };
    }
    const detachBoundary = boundary === "switch" || boundary === "close";
    const recoveryProtected = detachBoundary
      && documentHasProtectionEvidence(this.#documentWorkflow, {
        context: this.#projectSession.context,
        revision: this.#documentSession.editRevision,
      });
    if (recoveryProtected) return { state: "resolved" };
    if (this.#documentSession.persistState === "conflict") {
      if (detachBoundary && this.#documentWorkflow.canProtectForDetach?.() === true) {
        return {
          state: "pending",
          reason: "正在校验当前 HTML 的恢复副本。",
        };
      }
      return {
        state: "blocked",
        reason: "当前 HTML 与外部文件存在冲突，请先选择保留哪一份。",
      };
    }
    if (this.#documentSession.persistState === "failed") {
      if (detachBoundary && this.#documentWorkflow.canProtectForDetach?.() === true) {
        return {
          state: "pending",
          reason: "正在校验当前 HTML 的恢复副本。",
        };
      }
      return {
        state: "blocked",
        reason: this.#documentSession.persistError
          || "当前 HTML 尚未安全写回，请先处理保存失败。",
      };
    }
    if (
      this.#documentSession.pendingWrite
      || this.#documentSession.flushPromise
      || this.#documentWorkflow.hasHistoryAction
      || this.#documentSession.editRevision > this.#documentSession.lastPersistedRevision
    ) {
      return { state: "pending", reason: "当前 HTML 仍有修改尚未安全写回源文件。" };
    }
    return { state: "resolved" };
  }

  #inspectDraftObligation(boundary) {
    return this.#commentWorkflow.inspectDraft({
      boundary,
      projectLoadError: this.projectLoadError,
    });
  }

  async #drainDraftObligation(boundary) {
    return this.#commentWorkflow.drainDraft({
      boundary,
      projectLoadError: this.projectLoadError,
    });
  }

  async #openStartup({ transactionId = null } = {}) {
    const operationId = this.#nextOpenOperation();
    const startupOpenSequence = this.#openSequence;
    this.#setOpen("opening", operationId, null);
    try {
      const [activeResult, recentResult] = await Promise.allSettled([
        this.#projectOpenPort.getActive?.(),
        this.#projectOpenPort.listRecent?.(),
      ]);
      const recent = recentResult.status === "fulfilled"
        ? recentResult.value || []
        : [];
      if (recentResult.status === "fulfilled") {
        this.#emit({ type: "project-recents-loaded", projects: recent });
      } else {
        this.#emit({
          type: "project-recents-failed",
          reason: projectErrorMessage(
            this.#codecs,
            recentResult.reason,
            "最近打开记录暂时无法读取。",
          ),
        });
      }
      const active = activeResult.status === "fulfilled" ? activeResult.value : null;
      if (activeResult.status === "rejected") {
        this.#emit({
          type: "project-startup-failed",
          reason: projectErrorMessage(
            this.#codecs,
            activeResult.reason,
            "文件可能已移动、删除或损坏。源页没有打开其他内容来替代它。",
          ),
        });
      } else {
        this.#emit({ type: "project-startup-ready" });
      }
      const startupIsCurrent = this.#openSequence === startupOpenSequence;
      void this.#recentRunsPort.hydrate(
        recent,
        startupIsCurrent ? active?.sourcePath || null : null,
      );
      if (!startupIsCurrent) {
        return succeeded({ operationId, opened: false });
      }
      const result = asOpenResult(active);
      if (result.kind === "confirmation") {
        this.#presentOpenConfirmation(result.confirmation, transactionId);
        return succeeded({
          operationId,
          opened: false,
          awaitingConfirmation: true,
        });
      }
      if (result.kind === "project") {
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        const accepted = this.#enqueueAcceptedProject(result.project, {
          kind: "startup",
          operationId,
          sourcePath: result.project.sourcePath || null,
          transactionId,
        });
        if (!accepted) {
          return rejected(
            "PROJECT_APPLICATION_REJECTED",
            "无法安排当前 HTML 的安全切换。",
          );
        }
        return succeeded({ operationId, applicationId: accepted, opened: true });
      }
      return succeeded({ operationId, opened: false });
    } catch (cause) {
      return rejected(
        "PROJECT_STARTUP_REJECTED",
        projectErrorMessage(this.#codecs, cause, "上次打开的 HTML 无法恢复。"),
      );
    } finally {
      if (this.#snapshot.open.operationId === operationId) {
        this.#setOpen("idle", null, null);
      }
    }
  }

  #enqueueAcceptedProject(projectValue, metadata) {
    if (this.#snapshot.close.phase === "ready") return false;
    const project = copyProject(projectValue);
    if (!project) return false;
    this.#applicationSequence += 1;
    const applicationId = `project-application-${this.#applicationSequence}`;
    return this.#projectApplicationSession.enqueue({
      applicationId,
      value: Object.freeze({ project, metadata: Object.freeze({ ...metadata }) }),
    }, (application) => this.#applyAcceptedProject(application))
      ? applicationId
      : false;
  }

  async #applyAcceptedProject(application) {
    if (this.#snapshot.close.phase === "ready") return "complete";
    const { metadata } = application.value;
    let { project } = application.value;
    if (this.projectHydrating && !this.#retireHydrationForAcceptedSuccessor()) {
      return "deferred";
    }
    // epoch 0 has no previously opened renderer authority to drain or fence.
    // Startup still enters the accepted-result FIFO, but its first publication
    // must not depend on an edit Canvas that only mounts for an opened locator.
    // openProject marks its open/application interval as interaction-locked
    // before the first prepareSwitch. Accepted projects from other ingress
    // paths still need the canonical fence here.
    if (this.#projectSession.epoch > 0 && metadata.switchPrepared !== true) {
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") {
        return "deferred";
      }
    }
    if (this.#snapshot.close.phase === "ready") return "complete";
    // In-memory browser HTML has no disk Hash. Confirming the next switch
    // fence requires DocumentSession.persistedSourceSha256, so fill it before publish.
    if (!project.sha256) {
      project = Object.freeze({
        ...project,
        sha256: await this.#hashPort.sha256(project.html),
      });
    }
    let canvasFrozen = false;
    let applied = false;
    const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
      || this.#canvasPort.isMounted();
    if (
      this.#projectSession.sourcePath
      && !this.projectLoadError
      && !this.#isHistoryView()
      && canvasIsMounted
    ) {
      const cutoff = this.#documentSession.editRevision;
      const frozen = this.#canvasPort.freeze(
        "当前编辑画布尚未完成安全收口，暂不能切换 HTML。",
      );
      if (!frozen?.ok) {
        this.#canvasPort.showCommitBlocked?.(
          frozen?.reason || "当前编辑画布尚未完成安全收口。",
        );
        return "deferred";
      }
      canvasFrozen = true;
      const pendingWrite = this.#documentSession.pendingWrite;
      const pendingWriteIsProtected = Boolean(
        pendingWrite
        && Number(pendingWrite.revision) === cutoff
        && String(pendingWrite.html) === this.#documentSession.html
        && documentHasProtectionEvidence(this.#documentWorkflow, {
          context: this.#projectSession.context,
          revision: cutoff,
        })
      );
      if (
        this.#documentSession.editRevision !== cutoff
        || (pendingWrite && !pendingWriteIsProtected)
        || this.#documentSession.flushPromise
      ) {
        this.#canvasPort.unlock?.();
        return "deferred";
      }
    }
    try {
      const applicationApplied = this.#applyProject(project, {
        applicationId: application.applicationId,
        transactionId: metadata.transactionId || null,
        operationId: metadata.operationId || null,
      });
      if (!applicationApplied) return "stale";
      applied = true;
      const epoch = this.#projectSession.epoch;
      // Accepted-result FIFO owns synchronous publication order, not remote
      // hydration latency. A successor may retire this query only after the
      // workflow proves that the just-published project has no mutable work.
      void (async () => {
        const [, hydrated] = await Promise.all([
          this.refreshRecents(),
          this.refreshWorkspace({
            sourcePath: project.sourcePath,
            epoch,
            sourceTransitionToken: epoch,
          }),
        ]);
        if (hydrated.status === "succeeded") {
          // Defer the read-only catalog projection until hydration and any lazy
          // registration/Working-Copy adoption have settled. Running catalog in
          // parallel with hydration lets its Repository scan reorder the shared
          // queue and can leave a just-imported project stuck in "hydrating".
          this.scheduleProjectListRefreshAfterSettlement(this.#projectSession.context);
        }
      })().catch((cause) => {
        this.#emit({
          type: "project-hydration-failed",
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "项目状态暂时无法读取，请重试。",
          ),
        });
      });
    } catch (cause) {
      this.#emit({
        type: "project-open-failed",
        kind: metadata.kind,
        operationId: metadata.operationId,
        sourcePath: metadata.sourcePath,
        reason: projectErrorMessage(
          this.#codecs,
          cause,
          "文件暂时无法完成安全切换；当前项目仍保持打开。",
        ),
      });
    } finally {
      if (canvasFrozen && !applied) this.#canvasPort.unlock?.();
    }
    return "complete";
  }

  #retireHydrationForAcceptedSuccessor() {
    const unsafe = this.#drainCoordinator
      .inspect("switch")
      .some((status) => (
        status.name !== "project-hydration"
        && status.state !== "resolved"
      ));
    if (unsafe) return false;
    this.#hydrationGeneration += 1;
    this.#setHydration({
      phase: "idle",
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
      error: null,
    });
    this.#markHydrationStage("superseded");
    return true;
  }

  async #openExternalProject(request, { isSuperseded }) {
    if (isSuperseded()) return "complete";
    if (this.#externalAckPending.has(request.requestId)) {
      return await this.#retryPendingExternalAck(request.requestId)
        ? "complete"
        : "deferred";
    }
    const operationId = this.#nextOpenOperation();
    const navigationTransactionId = this.#externalNavigationTransactions.get(
      request.requestId,
    ) || null;
    try {
      if (typeof this.#projectOpenPort.acceptExternal !== "function") {
        const reason = "当前 PageRoot 版本缺少外部文件打开通道，请重新安装最新版本。";
        this.#emit({
          type: "external-project-open-unavailable",
          requestId: request.requestId,
          reason,
        });
        const acknowledged = await this.#ackWithCompletion(
          request.requestId,
          { kind: "session" },
        );
        if (acknowledged && navigationTransactionId) {
          this.#emit({
            type: "project-navigation-terminal-failed",
            transactionId: navigationTransactionId,
            reason,
          });
        }
        return acknowledged ? "complete" : "deferred";
      }
      const opened = await this.#projectOpenPort.acceptExternal(request.requestId);
      if (isSuperseded() || this.#snapshot.close.phase === "ready") return "complete";
      const result = asOpenResult(opened);
      if (result.kind === "confirmation") {
        this.#externalFileOpenSession.presentConfirmation(
          request.requestId,
          result.confirmation,
        );
        this.#presentOpenConfirmation(result.confirmation, navigationTransactionId);
        return "awaiting-confirmation";
      }
      if (result.kind !== "project") {
        throw new Error("这次外部打开没有返回可安全切换的 HTML。");
      }
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") return "deferred";
      if (isSuperseded()) return "complete";
      const applicationId = this.#enqueueAcceptedProject(result.project, {
        kind: "external",
        operationId,
        sourcePath: result.project.sourcePath || null,
        transactionId: navigationTransactionId,
      });
      if (!applicationId) {
        throw new Error("无法安排外部 HTML 的安全切换。");
      }
      if (
        navigationTransactionId
        && typeof this.#navigationPort?.waitForTerminal === "function"
      ) {
        const terminal = await this.#navigationPort.waitForTerminal(navigationTransactionId);
        if (
          !terminal
          || terminal.transactionId !== navigationTransactionId
          || !terminal.outcome
          || !["succeeded", "rejected", "blocked", "stale", "unknown"]
            .includes(String(terminal.outcome.status || ""))
          || (
            terminal.receipt?.applicationId
            && terminal.receipt.applicationId !== applicationId
          )
        ) {
          return "deferred";
        }
        if (!terminal.receipt && terminal.outcome.status !== "succeeded") {
          this.#projectApplicationSession.cancel(applicationId, "stale");
        }
      } else {
        await this.#projectApplicationSession.waitFor(applicationId);
      }
      if (!await this.#ackWithCompletion(request.requestId, { kind: "session" })) {
        return "deferred";
      }
    } catch (cause) {
      if (!isSuperseded()) {
        this.#emit({
          type: "project-open-failed",
          kind: "external",
          operationId,
          sourcePath: request.sourcePath || null,
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "文件可能已移动、暂时不可读，或不是完整的 HTML 页面；当前项目仍保持打开。",
          ),
        });
        if (!await this.#ackWithCompletion(request.requestId, { kind: "session" })) {
          return "deferred";
        }
        if (navigationTransactionId) {
          this.#emit({
            type: "project-navigation-terminal-failed",
            transactionId: navigationTransactionId,
            reason: projectErrorMessage(
              this.#codecs,
              cause,
              "文件可能已移动、暂时不可读，或不是完整的 HTML 页面。",
            ),
          });
        }
      }
    }
    return "complete";
  }

  #presentOpenConfirmation(descriptor, transactionId = null) {
    const confirmation = copyOpenConfirmation({
      ...descriptor,
      deleteOriginal: false,
      busy: false,
    });
    if (!confirmation) return false;
    if (
      this.#openConfirmation
      && this.#openConfirmation.requestId !== confirmation.requestId
    ) {
      this.#cancelPreparedIntent(this.#openConfirmation.requestId);
    }
    this.#openConfirmation = confirmation;
    this.#publishSnapshot();
    this.#emit({
      type: "project-open-confirmation-presented",
      requestId: confirmation.requestId,
      transactionId: transactionId ? String(transactionId) : null,
    });
    return true;
  }

  #setOpenConfirmation(next) {
    const confirmation = copyOpenConfirmation(next);
    this.#openConfirmation = confirmation;
    this.#publishSnapshot();
    return confirmation;
  }

  #clearOpenConfirmation() {
    this.#openConfirmation = null;
    this.#publishSnapshot();
  }

  #cancelPreparedIntent(requestId) {
    if (
      !requestId
      || typeof this.#projectOpenPort.cancelPrepared !== "function"
    ) return;
    void this.#projectOpenPort.cancelPrepared(requestId);
  }

  async #ackExternalOpen(requestId) {
    if (typeof this.#projectOpenPort.ackExternal !== "function") return true;
    let lastCause = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.#projectOpenPort.ackExternal(requestId);
        if (attempt > 0) {
          reportInternalFailure({
            area: "import",
            operation: "external-ack",
            code: "ack-retried",
            recovered: true,
            cause: lastCause,
          });
        }
        return true;
      } catch (cause) {
        lastCause = cause;
      }
    }
    reportInternalFailure({
      area: "import",
      operation: "external-ack",
      code: "ack-unrecovered",
      recovered: false,
      cause: lastCause,
    });
    this.#emit({
      type: "external-open-ack-failed",
      requestId,
      confirmation: this.#confirmationRequiresExternalAck(requestId),
      reason: projectErrorMessage(
        this.#codecs,
        lastCause,
        "外部 HTML 已处理，但下一个打开请求尚未解锁。",
      ),
    });
    return false;
  }

  #confirmationRequiresExternalAck(requestId) {
    const snapshot = this.#externalFileOpenSession.snapshot;
    return snapshot.status === "awaiting-confirmation"
      && snapshot.activeRequestId === String(requestId || "");
  }

  #applyExternalAckCompletion(requestId, completion) {
    this.#externalNavigationTransactions.delete(String(requestId || ""));
    if (completion.kind === "cancel-confirmation") {
      if (completion.external === true) {
        this.#externalFileOpenSession.cancelConfirmation(requestId);
      }
      if (this.#openConfirmation?.requestId === requestId) {
        this.#clearOpenConfirmation();
      }
      return succeeded({ canceled: true, requestId });
    }
    if (completion.kind === "complete-confirmation") {
      if (completion.external === true) {
        this.#externalFileOpenSession.completeConfirmation(requestId);
      }
      if (this.#openConfirmation?.requestId === requestId) {
        this.#clearOpenConfirmation();
      }
      this.#emit(completion.event);
      return succeeded(completion.value);
    }
    return succeeded({ requestId, acknowledged: true });
  }

  async #ackWithCompletion(requestId, completion) {
    if (!await this.#ackExternalOpen(requestId)) {
      this.#externalAckPending.set(requestId, Object.freeze({ ...completion }));
      return null;
    }
    this.#externalAckPending.delete(requestId);
    return this.#applyExternalAckCompletion(requestId, completion);
  }

  async #retryPendingExternalAck(requestId) {
    const completion = this.#externalAckPending.get(requestId);
    if (!completion) return null;
    return this.#ackWithCompletion(requestId, completion);
  }

  setExternalOpenDeleteOriginal({ requestId, deleteOriginal } = {}) {
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    if (confirmation.classification !== "new-external") {
      return rejected(
        "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
        "只有首次导入才能在成功后删除原文件。",
      );
    }
    this.#setOpenConfirmation({
      ...confirmation,
      deleteOriginal: deleteOriginal === true,
      busy: confirmation.busy,
    });
    return succeeded({ deleteOriginal: deleteOriginal === true });
  }

  async cancelExternalOpen({ requestId } = {}) {
    const requestedId = String(requestId || "");
    if (this.#externalAckPending.has(requestedId)) {
      return await this.#retryPendingExternalAck(requestedId) || rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "这次打开已取消，但下一个 Finder 请求尚未解锁。",
      );
    }
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    this.#cancelPreparedIntent(confirmation.requestId);
    const completion = {
      kind: "cancel-confirmation",
      external: this.#confirmationRequiresExternalAck(confirmation.requestId),
    };
    const completed = completion.external
      ? await this.#ackWithCompletion(confirmation.requestId, completion)
      : this.#applyExternalAckCompletion(confirmation.requestId, completion);
    if (!completed) {
      this.#setOpenConfirmation({ ...confirmation, busy: false });
      return rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "这次打开已取消，但下一个 Finder 请求尚未解锁。",
      );
    }
    return completed;
  }

  async confirmExternalOpen({
    requestId,
    action,
    deleteOriginal = false,
    transactionId = null,
  } = {}) {
    if (action === "view-initial") {
      return rejected(
        "EXTERNAL_OPEN_ACTION_UNSUPPORTED",
        "这条打开确认不提供查看初始版本。",
      );
    }
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    if (this.#externalAckPending.has(confirmation.requestId)) {
      return await this.#retryPendingExternalAck(confirmation.requestId) || rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "HTML 已完成打开，但下一个 Finder 请求尚未解锁。",
      );
    }
    if (
      confirmation.classification === "new-external"
      && action !== "import-new"
    ) {
      return rejected(
        "EXTERNAL_OPEN_ACTION_MISMATCH",
        "新的外部 HTML 只能选择导入并打开。",
      );
    }
    if (
      confirmation.classification === "known-external"
      && action !== "continue-current"
    ) {
      return rejected(
        "EXTERNAL_OPEN_ACTION_MISMATCH",
        "已导入的原文件只能打开之前的项目。",
      );
    }
    const shouldDelete = confirmation.classification === "new-external"
      && (deleteOriginal === true || confirmation.deleteOriginal === true);
    this.#setOpenConfirmation({
      ...confirmation,
      deleteOriginal: shouldDelete,
      busy: true,
    });
    // epoch 0 has no previously opened renderer authority to drain or fence.
    // Cold-start last-active B/C confirmation must not depend on an edit Canvas
    // that only mounts after a project locator is published.
    const hasBoundProject = this.#projectSession.epoch > 0;
    const previousAuthority = hasBoundProject
      ? this.captureManagedSourceTransitionAuthority()
      : null;
    if (hasBoundProject) {
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") {
        this.#setOpenConfirmation({
          ...this.#openConfirmation,
          busy: false,
        });
        return switchOutcome;
      }
    }
    if (typeof this.#projectOpenPort.commitPrepared !== "function") {
      this.#setOpenConfirmation({
        ...this.#openConfirmation,
        busy: false,
      });
      return rejected(
        "EXTERNAL_OPEN_COMMIT_UNAVAILABLE",
        "当前 PageRoot 版本缺少导入确认通道，请重新安装最新版本。",
      );
    }
    try {
      const committed = await this.#projectOpenPort.commitPrepared({
        requestId: confirmation.requestId,
        action,
        ...(shouldDelete ? { deleteOriginal: true } : {}),
      });
      const project = copyProject(committed);
      if (!project) {
        throw Object.assign(new Error("导入确认没有返回可打开的项目。"), {
          code: "EXTERNAL_OPEN_COMMIT_INVALID",
        });
      }
      const applicationApplied = this.#applyProject(project, {
        applicationId: `prepared-${confirmation.requestId}`,
        transactionId,
        operationId: `prepared-${confirmation.requestId}`,
      });
      if (!applicationApplied) {
        if (typeof this.#projectOpenPort.rollbackPrepared === "function") {
          await this.#projectOpenPort.rollbackPrepared(confirmation.requestId);
        }
        throw Object.assign(new Error("这次导航已经结束，迟到的 HTML 不会替换当前页面。"), {
          code: "WORKBENCH_NAVIGATION_STALE_APPLICATION",
        });
      }
      // The Prepared Intent is durably committed and its exact bytes have been
      // published. Retire the modal now so the user can see the new HTML while
      // hydration, Canvas verification, optional trash and external ACK finish.
      // A later fail-closed rollback restores the same confirmation below.
      this.#clearOpenConfirmation();
      const epoch = this.#projectSession.epoch;
      try {
        const [, hydrated] = await Promise.all([
          this.refreshRecents(),
          this.refreshWorkspace({
            sourcePath: project.sourcePath,
            epoch,
            sourceTransitionToken: epoch,
          }),
        ]);
        if (hydrated.status === "succeeded") {
          await this.refreshRegisteredProjects();
        }
      } catch (cause) {
        this.#emit({
          type: "project-hydration-failed",
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "项目状态暂时无法读取，请重试。",
          ),
        });
      }
      let canvasOutcome = await this.#documentWorkflow.ensureCurrentCanvas({
        context: this.#projectSession.context || undefined,
      });
      if (canvasOutcome.status !== "succeeded") {
        const retryOutcome = await this.#documentWorkflow.ensureCurrentCanvas({
          context: this.#projectSession.context || undefined,
        });
        if (retryOutcome.status === "succeeded") {
          reportInternalFailure({
            area: "canvas",
            operation: "import-canvas-ack",
            code: "canvas-retried",
            recovered: true,
            cause: canvasOutcome.reason,
          });
          canvasOutcome = retryOutcome;
        } else {
          canvasOutcome = retryOutcome;
        }
      }
      const canvasReady = canvasOutcome.status === "succeeded";
      if (!canvasReady) {
        reportInternalFailure({
          area: "canvas",
          operation: "import-canvas-ack",
          code: "canvas-unrecovered",
          recovered: false,
          cause: canvasOutcome.reason,
        });
        this.#emit({
          type: "external-open-canvas-failed",
          requestId: confirmation.requestId,
          reason: canvasOutcome.reason || "当前画布尚未完成自动恢复。",
        });
      }
      let disposition = "kept";
      if (canvasReady && typeof this.#projectOpenPort.finalizePrepared === "function") {
        const finalized = await this.#projectOpenPort.finalizePrepared(
          confirmation.requestId,
        );
        disposition = finalized?.disposition || "kept";
      }
      const completion = {
        kind: "complete-confirmation",
        external: this.#confirmationRequiresExternalAck(confirmation.requestId),
        event: Object.freeze({
          type: "external-open-completed",
          requestId: confirmation.requestId,
          action,
          imported: action === "import-new",
          disposition,
          visibleV1FileName: confirmation.visibleV1FileName,
          sourcePath: project.sourcePath,
        }),
        value: Object.freeze({
          requestId: confirmation.requestId,
          opened: true,
          disposition,
        }),
      };
      const completed = completion.external
        ? await this.#ackWithCompletion(confirmation.requestId, completion)
        : this.#applyExternalAckCompletion(confirmation.requestId, completion);
      if (!completed) {
        this.#setOpenConfirmation({
          ...confirmation,
          deleteOriginal: shouldDelete,
          busy: false,
        });
        return rejected(
          "EXTERNAL_OPEN_ACK_REJECTED",
          "HTML 已完成打开，但下一个 Finder 请求尚未解锁。",
        );
      }
      return completed;
    } catch (cause) {
      const reclassified = cause?.details?.confirmation
        || cause?.confirmation;
      if (cause?.code === "OPEN_INTENT_RECLASSIFIED" && reclassified) {
        const next = copyOpenConfirmation({
          ...reclassified,
          deleteOriginal: false,
          busy: false,
        });
        if (next) {
          this.#externalFileOpenSession.presentConfirmation(next.requestId, next);
          this.#presentOpenConfirmation(next, transactionId);
          this.#emit({
            type: "external-open-reclassified",
            requestId: next.requestId,
            reason: projectErrorMessage(
              this.#codecs,
              cause,
              "这份原文件已经关联到现有项目。",
            ),
          });
          return rejected(cause.code, cause.message);
        }
      }
      this.#setOpenConfirmation({
        ...(this.#openConfirmation || confirmation),
        busy: false,
      });
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "这次打开没有完成，当前项目仍保持打开。",
      );
      this.#emit({
        type: "project-open-failed",
        kind: "external-confirmation",
        operationId: confirmation.requestId,
        sourcePath: null,
        reason,
      });
      return rejected(
        projectErrorCode(cause, "EXTERNAL_OPEN_COMMIT_REJECTED"),
        reason,
      );
    }
  }

  retryExternalOpen({ requestId } = {}) {
    const pending = this.#externalAckPending.get(String(requestId || ""));
    if (pending) return this.#retryPendingExternalAck(String(requestId || ""));
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return Promise.resolve(stale({ requestId: String(requestId || "") }));
    }
    return this.confirmExternalOpen({
      requestId: confirmation.requestId,
      action: confirmation.classification === "new-external"
        ? "import-new"
        : "continue-current",
      deleteOriginal: confirmation.deleteOriginal,
    });
  }

  #applyProject(project, {
    applicationId = null,
    transactionId = null,
    operationId = null,
  } = {}) {
    const receivedTransactionId = transactionId ? String(transactionId) : null;
    const authorization = this.#navigationPort?.authorizeProjectApplication?.({
      transactionId: receivedTransactionId,
      applicationId,
    }) || null;
    if (receivedTransactionId && authorization?.accepted !== true) {
      this.#emit({
        type: "project-application-stale",
        transactionId: receivedTransactionId,
        applicationId: applicationId ? String(applicationId) : null,
      });
      return false;
    }
    this.#markHydrationStage("apply-start", operationId);
    const outgoingRun = this.#runSession.activeRun;
    const outgoingSourcePath = this.#projectSession.sourcePath;
    if (
      outgoingRun
      && outgoingSourcePath
      && !this.#codecs.sameSourcePath(outgoingSourcePath, project.sourcePath)
    ) {
      if (outgoingRun.status === "ready-to-open") {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: this.#clock.now(),
        });
      } else if (outgoingRun.status === "awaiting-conflict-resolution") {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "conflict",
          label: "需要处理",
          updatedAt: this.#clock.now(),
        });
      } else if (this.#codecs.isLockedLifecycleState(outgoingRun.status)) {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "processing",
          label: "正在处理",
          updatedAt: this.#clock.now(),
        });
      }
    }
    const locator = this.#projectSession.openLocator(project.sourcePath || null);
    if (
      project.sourcePath
      && project.sha256
      && project.projectId
      && project.documentId
      && project.openTarget
      && String(project.openTarget.projectId || "") === project.projectId
      && String(project.openTarget.documentId || "") === project.documentId
      && String(project.openTarget.sourceSha256 || "") === project.sha256
      && this.#codecs.sameSourcePath(
        project.openTarget.exactSourcePath,
        project.sourcePath,
      )
    ) {
      this.#projectSession.register({
        epoch: locator.epoch,
        sourcePath: project.sourcePath,
        projectId: project.projectId,
        documentId: project.documentId,
        openTarget: project.openTarget,
      });
    }
    this.#runSession.activate(project.sourcePath || null);
    this.#documentWorkflow.resetForProjectTransition();
    // Publish the hydration boundary before provisional HTML reaches Runtime
    // observers. Only the final hydrated source may start author Script.
    this.#setHydration({
      phase: project.sourcePath ? "hydrating" : "idle",
      epoch: locator.epoch,
      sourcePath: project.sourcePath || null,
      error: null,
    });
    this.#documentSession.reset({
      html: project.html,
      persistedSourceSha256: project.sha256 || null,
    });
    this.#markHydrationStage("apply-authority", operationId);
    this.#commentWorkflow.resetForProjectTransition();
    this.#draftSession.deactivate();
    this.#projectRulesWorkflow.resetForProjectTransition();
    this.#commentSession.reset();
    this.#versionSession.reset();
    this.#markHydrationStage("apply-authority:sessions-reset", operationId);
    this.#canvasPort.invalidateRenderAcks?.();
    if (project.sourcePath) this.#runSession.clearResult(project.sourcePath);
    this.#pendingOpen = null;
    this.#markHydrationStage("apply-authority:canvas-reset", operationId);
    const applicationReceipt = this.#navigationPort?.applyProject?.({
      transactionId,
      applicationId,
      project,
      epoch: locator.epoch,
      activeLocked: this.#runSession.activeLocked,
    }) || null;
    this.#emit({
      type: "project-applied",
      project,
      epoch: locator.epoch,
      activeLocked: this.#runSession.activeLocked,
      applicationReceipt,
      operationId: operationId ? String(operationId) : null,
    });
    this.#markHydrationStage("apply-authority:published", operationId);
    this.#canvasPort.applyPageViewContext?.(null);
    this.#canvasPort.clearSelection?.();
    if (!this.#runSession.activeLocked) this.#canvasPort.unlock?.();
    this.#markHydrationStage("apply-authority:unlocked", operationId);
    this.#markHydrationStage("apply-complete", operationId);
    return true;
  }

  async #hydrateWorkspace({ sourcePath, epoch, sourceTransitionToken }) {
    let activeSource = sourcePath === undefined
      ? this.#projectSession.sourcePath
      : sourcePath;
    if (!activeSource) return succeeded({ hydrated: false });
    let activeEpoch = epoch ?? this.#projectSession.epoch;
    const hydrationGeneration = this.#hydrationGeneration;
    const query = this.#projectSession.beginQuery("workspace", {
      sourcePath: activeSource,
    });
    const queryIsCurrent = () => (
      this.#projectSession.isQueryCurrent(query)
      && hydrationGeneration === this.#hydrationGeneration
      && activeEpoch === this.#projectSession.epoch
      && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
    );
    const transitionAuthorized = Boolean(
      sourceTransitionToken !== undefined
      && sourceTransitionToken === activeEpoch
      && sourceTransitionToken === this.#projectSession.epoch
      && this.projectHydrating,
    );
    const openingTarget = this.#projectSession.openTarget;
    const openingDocument = this.#documentSession.snapshot;
    const hasExactOpeningAuthority = Boolean(
      transitionAuthorized
      && openingTarget
      && this.#projectSession.projectId
      && this.#projectSession.documentId
      && openingDocument.persistedSourceSha256
      && openingTarget.projectId === this.#projectSession.projectId
      && openingTarget.documentId === this.#projectSession.documentId
      && openingTarget.sourceSha256 === openingDocument.persistedSourceSha256
      && this.#codecs.sameSourcePath(openingTarget.exactSourcePath, activeSource)
    );
    let sourceBoundaryFrozen = false;
    let mustAdoptSource = transitionAuthorized && !hasExactOpeningAuthority;
    let recoveredAutosaveConflict = false;
    const rollback = this.#captureHydrationAuthority();
    let publicationStarted = false;
    const operationId = this.#nextOperationId("hydration");
    this.#setSupplemental({ phase: "loading", operationId });
    try {
      this.#markHydrationStage("workspace-request", operationId);
      if (this.projectHydrating && !transitionAuthorized) {
        throw new Error("这次项目读取缺少与当前项目一致的源码切换令牌。");
      }
      const acquired = await acquireProjectOpenWorkspace({
        bridgeClient: this.#bridgeClient,
        sourcePath: activeSource,
        operationId,
        isCurrent: queryIsCurrent,
      });
      if (acquired.kind === "stale") {
        return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
      }
      const { envelope } = acquired;
      const payload = envelope.core;
      const supplementalPayload = envelope.supplemental;
      const decodedWorkspace = decodeWorkspaceResponse({ ...payload, ...supplementalPayload }, this.#codecs);
      this.#markHydrationStage(
        "workspace-response",
        operationId,
        this.#codecs.isRecord(envelope.performanceTiming)
          ? envelope.performanceTiming
          : null,
      );
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });

      const preparedCore = prepareProjectOpenCore({
        core: payload,
        activeSource,
        exactOpeningAuthority: hasExactOpeningAuthority ? {
          projectId: this.#projectSession.projectId,
          documentId: this.#projectSession.documentId,
          sourceSha256: openingDocument.persistedSourceSha256,
          openTarget: openingTarget,
        } : null,
        sameSourcePath: this.#codecs.sameSourcePath,
      });
      const nextProjectId = preparedCore.projectId;
      const nextDocumentId = preparedCore.documentId;
      const canonicalSourcePath = preparedCore.canonicalSourcePath;
      const workspaceHash = preparedCore.sourceSha256;
      const openTarget = preparedCore.openTarget;
      let preparedTransition = null;
      if (!this.#codecs.sameSourcePath(canonicalSourcePath, activeSource)) {
        if (!mustAdoptSource) {
          const frozen = this.#canvasPort.freeze(
            "项目状态包含新的源文件，但当前编辑画布尚未就绪。",
          );
          if (!frozen?.ok) {
            throw new Error(frozen?.reason || "无法在安全收口当前编辑后切换源文件。");
          }
          sourceBoundaryFrozen = true;
        }
        const versionId = String(
          payload.currentExactVersionId || payload.latestVersionId || "",
        );
        if (!nextProjectId || !nextDocumentId || !workspaceHash || !versionId) {
          throw new Error("项目已经生成新文件，但缺少切换当前文件所需的完整身份。");
        }
        preparedTransition = await this.prepareGeneratedSourceTransition({
          previousSourcePath: activeSource,
          nextSourcePath: canonicalSourcePath,
          expectedSha256: workspaceHash,
          nextProjectId,
          nextDocumentId,
          versionId,
          openTarget,
          operationId,
        });
        if (!preparedTransition.updatesCurrentProject) return stale({
          operationId,
          epoch: activeEpoch,
          sourcePath: activeSource,
        });
        if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        mustAdoptSource = true;
      }

      const projectRecord = this.#codecs.isRecord(supplementalPayload.project)
        ? supplementalPayload.project
        : {};
      const currentDocument = this.#documentSession.snapshot;
      const projection = await inspectProjectOpenProjection({
        document: currentDocument,
        hashPort: this.#hashPort,
        workspaceSha256: workspaceHash,
        hasExactOpeningAuthority,
        pendingWrite: this.#documentSession.pendingWrite,
        flushInFlight: this.#documentSession.flushPromise,
      });
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
      const currentDocumentClean = projection.clean;
      const cleanProjectionMismatch = projection.cleanMismatch;
      let authoritativeHtml = currentDocument.html;
      let authoritativeHash = currentDocument.persistedSourceSha256 || workspaceHash;
      let authoritativeLastModifiedAt = String(payload.lastModifiedAt || "");
      let legacyVersionAuthority = null;
      if (preparedTransition?.activatedProject) {
        authoritativeHtml = preparedTransition.activatedProject.html;
        authoritativeHash = preparedTransition.activatedProject.sha256;
        authoritativeLastModifiedAt = String(
          preparedTransition.activatedProject.lastModifiedAt
          || payload.lastModifiedAt
          || "",
        );
      } else if (mustAdoptSource || cleanProjectionMismatch) {
        mustAdoptSource = true;
        const resolvedSource = await resolveProjectOpenSource({
          core: payload,
          bridgeClient: this.#bridgeClient,
          canonicalSourcePath,
          hashPort: this.#hashPort,
          expectedSourceSha256: workspaceHash,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          isCurrent: queryIsCurrent,
          markStage: (stage) => this.#markHydrationStage(stage, operationId),
        });
        if (resolvedSource.stale || !queryIsCurrent()) {
          return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        }
        authoritativeHtml = String(resolvedSource.content || "");
        authoritativeHash = String(resolvedSource.sourceSha256 || "");
        authoritativeLastModifiedAt = String(resolvedSource.lastModifiedAt || "");
        legacyVersionAuthority = resolvedSource.legacyVersionAuthority;
      } else if (currentDocumentClean && workspaceHash) {
        authoritativeHash = workspaceHash;
      } else if (
        workspaceHash
        && currentDocument.persistedSourceSha256
        && workspaceHash !== currentDocument.persistedSourceSha256
      ) {
        throw new Error("本地编辑期间源文件身份发生变化，已停止刷新以保留当前内容。");
      }
      if (!authoritativeHash) throw new Error("项目状态缺少当前源 HTML Hash。");
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });

      const publishVersion = () => this.#versionSession.hydrate({
        versions: decodedWorkspace.versions,
        latestVersionId: payload.latestVersionId,
        currentBasedOnVersionId:
          legacyVersionAuthority?.currentBasedOnVersionId || payload.currentBasedOnVersionId,
        currentExactVersionId:
          legacyVersionAuthority?.currentExactVersionId || payload.currentExactVersionId,
        restoredFromVersionId:
          legacyVersionAuthority?.restoredFromVersionId
          || payload.restoredFromVersionId,
      });
      let context = null;
      this.#markHydrationStage("publication-start", operationId);
      publicationStarted = true;
      if (preparedTransition) {
        context = this.commitGeneratedSourceTransition({
          prepared: preparedTransition,
          html: authoritativeHtml,
          sourceSha256: authoritativeHash,
          publishVersion,
        });
      } else {
        const hydrationOpenTarget = rebasedManagedOpenTarget(
          this.#codecs.isRecord(payload.openTarget)
            ? payload.openTarget
            : this.#projectSession.openTarget,
          activeSource,
          authoritativeHash,
        );
        context = this.#projectSession.register({
          epoch: activeEpoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
          ...(hydrationOpenTarget ? { openTarget: hydrationOpenTarget } : {}),
        });
        if (!context) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        if (mustAdoptSource || authoritativeHtml !== currentDocument.html) {
          this.#documentSession.publishAuthority({
            html: authoritativeHtml,
            persistedSourceSha256: authoritativeHash,
          });
          this.#canvasPort.invalidateRenderAcks?.();
        } else {
          this.#documentSession.update({
            html: authoritativeHtml,
            persistedSourceSha256: authoritativeHash,
          });
        }
        publishVersion();
      }
      this.#markHydrationStage("publication-committed", operationId);
      if (!context) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
      activeSource = context.sourcePath;
      activeEpoch = context.epoch;
      this.#documentWorkflow.replaceRecoveryIdentity(
        this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity),
      );
      const runtime = this.#codecs.isRecord(payload.runtimeState)
        ? payload.runtimeState
        : {};
      const runtimeConflict = this.#codecs.isRecord(runtime.conflict)
        ? runtime.conflict
        : null;
      const edit = this.#codecs.isRecord(runtime.edit) ? runtime.edit : {};
      const serverRevision = Number(runtime.editRevision || edit.editRevision || 0);
      const serverPersistedRevision = Number(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || serverRevision,
      );
      this.#documentSession.update({
        editRevision: Math.max(this.#documentSession.editRevision, serverRevision),
        lastPersistedRevision: Math.max(
          this.#documentSession.lastPersistedRevision,
          serverPersistedRevision,
        ),
      });

      const draftRecord = decodedWorkspace.draft;
      const serverDraftRevision = this.#codecs.authoritativeDraftRevision(draftRecord);
      let recoveredEvents = this.#commentSession.changeEvents;
      if (!this.#draftSession.isActive(context) || serverDraftRevision >= this.#draftSession.revision) {
        this.#draftSession.activate(context, serverDraftRevision, draftRecord);
        const recovered = this.#commentWorkflow.recoverDraft({
          context,
          serverComments: decodedWorkspace.comments,
          serverEvents: decodedWorkspace.changeEvents,
          serverDraftRevision: this.#draftSession.revision,
          serverDeletedCommentIds: Array.isArray(draftRecord.deletedCommentIds)
            ? draftRecord.deletedCommentIds.map(String)
            : [],
          serverAppliedOperationIds: Array.isArray(draftRecord.appliedOperationIds)
            ? draftRecord.appliedOperationIds.map(String)
            : [],
          serverBasedOnVersionId: payload.currentBasedOnVersionId
            ? String(payload.currentBasedOnVersionId)
            : null,
        });
        const rebound = this.#codecs.rebindTargetsPreservingGlobal(
          this.#documentSession.html,
          [
            ...recovered.comments.map(commentSourceTarget),
            ...(recovered.composerTarget
              ? [recovered.composerTarget.commentAnchor || recovered.composerTarget]
              : []),
          ],
        );
        const targets = new Map(rebound.map((target) => [target.id, target]));
        const recoveredComments = recovered.comments.map((comment) => ({
          ...comment,
          target: commentTargetForDisplay(targets.get(commentSourceTarget(comment)?.id) || {
            ...commentSourceTarget(comment),
            resolution: "orphaned",
          }, comment),
          sourceAnchor: targets.get(commentSourceTarget(comment)?.id) || {
            ...commentSourceTarget(comment),
            resolution: "orphaned",
          },
        }));
        recoveredEvents = recovered.changeEvents;
        const recoveredEditComment = recovered.commentEdit
          ? recoveredComments.find(
              (comment) => comment.commentId === recovered.commentEdit?.commentId,
            ) || null
          : null;
        const recoveredEditSession = recovered.commentEdit && recoveredEditComment
          ? {
              commentId: recoveredEditComment.commentId,
              baselineText: recoveredEditComment.text,
              baselineAttachments: [...(recoveredEditComment.attachments || [])],
              draftText: recovered.commentEdit.draftText,
              draftAttachments: [...recovered.commentEdit.draftAttachments],
            }
          : null;
        const nextEditSession = this.#codecs.commentEditSessionHasChanges(recoveredEditSession)
          ? recoveredEditSession
          : null;
        const composerTarget = recovered.composerTarget
          ? commentTargetForDisplay(
              targets.get(
                (recovered.composerTarget.commentAnchor || recovered.composerTarget).id,
              ) || {
                ...(recovered.composerTarget.commentAnchor || recovered.composerTarget),
                resolution: "orphaned",
              },
              recovered.composerTarget,
            )
          : null;
        this.#commentSession.update({
          comments: recoveredComments,
          changeEvents: recoveredEvents,
          composerDraft: recovered.composerDraft,
          composerCommentId: recovered.composerCommentId,
          composerAttachments: recovered.composerAttachments,
          composerTarget,
          editSession: nextEditSession,
        });
        this.#emit({ type: "project-draft-recovered" });
      }

      const recoveredRunRecord = this.#codecs.isRecord(runtime.activeRun)
        ? runtime.activeRun
        : this.#codecs.isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const recoveredRun = this.#codecs.activeRunFromRecord(
        recoveredRunRecord
          ? { ...recoveredRunRecord, ...(runtimeConflict ? { conflict: runtimeConflict } : {}) }
          : null,
      );
      const recoveredOutcome = this.#codecs.activeRunFromRecord(payload.recentRunOutcome);
      if (recoveredOutcome) this.#runSession.rememberOutcome(recoveredOutcome);
      else if (!recoveredRun) this.#runSession.forgetOutcome(activeSource);
      let showHandoff = false;
      if (recoveredRun && this.#codecs.isLockedLifecycleState(recoveredRun.status)) {
        this.#runSession.trackRun(recoveredRun, { recovered: true });
        showHandoff = this.projectHydrating;
      } else {
        const tracked = this.#runSession.runForSource(activeSource);
        if (tracked) this.#runSession.removeRun(tracked);
        else {
          const visible = this.#runSession.activeRun;
          const keepTerminal = Boolean(
            recoveredOutcome
            && visible
            && ["error", "no-change"].includes(visible.status)
            && visible.requestId === recoveredOutcome.requestId
            && visible.attemptId === recoveredOutcome.attemptId,
          );
          if (!keepTerminal) this.#runSession.clearActiveRun();
        }
        if (!sourceBoundaryFrozen && !this.projectHydrating) this.#canvasPort.unlock?.();
      }
      if (transitionAuthorized && authoritativeHash) {
        const recoveredLocally = await this.#documentWorkflow.recoverAutosave({
          context,
          currentSourceSha256: authoritativeHash,
          serverRevision,
        });
        if (!this.#projectSession.matches(context)) return stale(context);
        if (
          recoveredLocally.status === "succeeded"
          && !recoveredLocally.value.recovered
          && runtimeConflict
          && String(runtimeConflict.type || "") === "autosave-source"
          && typeof this.#bridgeClient.conflictCandidate === "function"
        ) {
          const conflictPayload = await this.#bridgeClient
            .conflictCandidate(activeSource)
            .catch(() => ({}));
          if (
            this.#projectSession.matches(context)
            && typeof conflictPayload.content === "string"
          ) {
            const candidateHtml = conflictPayload.content;
            const candidateHash = await this.#hashPort.sha256(candidateHtml);
            if (
              candidateHash !== String(conflictPayload.sha256 || "")
              || !this.#projectSession.matches(context)
            ) throw new Error("恢复候选的内容 Hash 与冲突记录不一致。");
            this.#documentWorkflow.adoptConflictCandidate({
              context,
              html: candidateHtml,
              authoritativeSourceSha256: authoritativeHash,
              expectedSourceSha256: String(
                conflictPayload.expectedSourceSha256
                || runtimeConflict.expectedSourceSha256
                || "",
              ),
              revision: Math.max(
                serverRevision,
                Number(conflictPayload.editRevision || runtimeConflict.editRevision || 0),
              ),
              events: recoveredEvents,
            });
          }
          recoveredAutosaveConflict = true;
        }
      }
      if (mustAdoptSource) {
        const expectedHtml = this.#documentSession.html;
        const expectedHash = await this.#hashPort.sha256(expectedHtml);
        this.#markHydrationStage("verify-rendered", operationId);
        await this.#canvasPort.verifyRendered?.(expectedHtml, expectedHash, context);
        if (!this.#projectSession.matches(context)) return stale(context);
      }
      if (recoveredAutosaveConflict) {
        const frozen = this.#canvasPort.freeze(
          "冲突候选已恢复，但编辑画布尚未就绪。",
        );
        if (!frozen?.ok) throw new Error(frozen?.reason || "无法冻结已恢复的冲突候选。");
        this.#documentSession.setPersistence({
          state: "conflict",
          error: "源 HTML 在自动写回前被外部修改。工作台候选和外部文件均已保留，请比较后重新载入或导出当前 HTML。",
        });
      }
      this.#setHydration({
        phase: "idle",
        epoch: activeEpoch,
        sourcePath: activeSource,
        error: null,
      });
      publicationStarted = false;
      this.#emit({ type: "project-core-ready", context, operationId });
      this.#markHydrationStage("core-ready", operationId);
      if (sourceBoundaryFrozen && !recoveredAutosaveConflict && !this.#runSession.activeLocked) {
        this.#canvasPort.requestFrame?.(() => this.#canvasPort.unlock?.());
      }
      await Promise.resolve();
      if (!queryIsCurrent()) {
        return succeeded({ context, hydrated: true, supplemental: false, stale: true });
      }
      try {
        if (
          nextProjectId
          && nextDocumentId
          && authoritativeHash
        ) {
          this.#documentWorkflow.activateSourceHistory({
            context,
            sourceSha256: authoritativeHash,
            history: null,
            preservePending: Boolean(this.#documentSession.pendingWrite),
          });
        }
        if (!queryIsCurrent()) {
          return succeeded({ context, hydrated: true, supplemental: false, stale: true });
        }
        this.#setSupplemental({
          phase: "ready",
          operationId,
          snapshotRevision: envelope.snapshotRevision,
        });
        this.#emit({
          type: "project-hydrated",
          historyCreation: payload.historyCreation || null,
          context,
          projectName: projectRecord.displayName ? String(projectRecord.displayName) : null,
          lastModifiedAt: authoritativeLastModifiedAt || null,
          showHandoff,
        });
        this.#markHydrationStage("supplemental-ready", operationId);
        this.#markHydrationStage("ready", operationId);
        return succeeded({ context, hydrated: true, supplemental: true });
      } catch (supplementalCause) {
        const reason = projectErrorMessage(
          this.#codecs,
          supplementalCause,
          "项目辅助资料暂时无法读取。",
        );
        this.#setSupplemental({
          phase: "failed",
          operationId,
          snapshotRevision: envelope.snapshotRevision,
          error: reason,
        });
        this.#emit({
          type: "project-supplemental-failed",
          context,
          operationId,
          reason,
        });
        this.#markHydrationStage("supplemental-failed", operationId);
        return succeeded({ context, hydrated: true, supplemental: false });
      }
    } catch (cause) {
      if (this.#snapshot.supplemental.operationId === operationId) {
        this.#setSupplemental({
          phase: "failed",
          operationId,
          error: projectErrorMessage(
            this.#codecs,
            cause,
            "项目 Core 状态暂时无法读取。",
          ),
        });
      }
      if (
        publicationStarted
        && activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        const restored = this.#rollbackHydrationAuthority(rollback);
        activeEpoch = restored.epoch;
        activeSource = restored.sourcePath;
      }
      if (
        activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        const reason = projectErrorMessage(
          this.#codecs,
          cause,
          "项目状态暂时无法读取，请重试；源文件没有被改动。",
        );
        this.#setHydration({
          phase: "failed",
          epoch: activeEpoch,
          sourcePath: activeSource,
          error: reason,
        });
        this.#canvasPort.invalidateRenderAcks?.();
        this.#emit({ type: "project-hydration-failed", reason });
        this.#markHydrationStage("failed", operationId);
      }
      return this.#outcomeFromCause(
        operationId,
        cause,
        "PROJECT_HYDRATION_REJECTED",
        projectErrorMessage(
          this.#codecs,
          cause,
          "项目状态暂时无法读取，请重试；源文件没有被改动。",
        ),
      );
    } finally {
      if (
        this.#snapshot.supplemental.operationId === operationId
        && this.#snapshot.supplemental.phase === "loading"
      ) {
        this.#setSupplemental({ phase: "idle" });
      }
      if (
        transitionAuthorized
        && this.projectHydrating
        && activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        this.#setHydration({
          phase: "idle",
          epoch: activeEpoch,
          sourcePath: activeSource,
          error: null,
        });
        this.#markHydrationStage("released", operationId);
      }
    }
  }

  #captureHydrationAuthority() {
    return Object.freeze({
      project: this.#projectSession.snapshot,
      document: this.#documentSession.snapshot,
      pendingWrite: this.#documentSession.pendingWrite,
      version: this.#versionSession.snapshot,
      comment: this.#commentSession.snapshot,
      draftContext: this.#draftSession.context,
      draftRevision: this.#draftSession.revision,
      documentWorkflow: this.#documentWorkflow.captureProjectTransitionAuthority(),
      run: Object.freeze({
        activeSourcePath: this.#runSession.snapshot.activeSourcePath,
        activeRun: this.#runSession.activeRun,
        recentOutcome: this.#runSession.snapshot.recentOutcome,
        runs: [...this.#runSession.runs],
        backgroundResults: [...this.#runSession.snapshot.backgroundResults],
      }),
    });
  }

  #rollbackHydrationAuthority(previous) {
    const priorProject = previous.project;
    let locator = this.#projectSession.locator;
    let context = null;
    if (
      priorProject.sourcePath
      && priorProject.epoch === this.#projectSession.epoch
      && this.#codecs.sameSourcePath(
        priorProject.sourcePath,
        this.#projectSession.sourcePath,
      )
    ) {
      locator = this.#projectSession.locator;
    } else {
      locator = this.#projectSession.openLocator(priorProject.sourcePath || null);
    }
    if (
      priorProject.registered
      && priorProject.sourcePath
      && priorProject.projectId
      && priorProject.documentId
    ) {
      context = this.#projectSession.register({
        epoch: locator.epoch,
        sourcePath: priorProject.sourcePath,
        projectId: priorProject.projectId,
        documentId: priorProject.documentId,
        ...(priorProject.openTarget ? { openTarget: priorProject.openTarget } : {}),
      });
    } else if (this.#projectSession.context) {
      locator = this.#projectSession.openLocator(priorProject.sourcePath || null);
    }

    this.#documentWorkflow.resetForProjectTransition();
    this.#documentSession.publishAuthority({
      html: previous.document.html,
      persistedSourceSha256: previous.document.persistedSourceSha256,
      workingHtmlSha256: previous.document.workingHtmlSha256,
      editRevision: previous.document.editRevision,
      lastPersistedRevision: previous.document.lastPersistedRevision,
      persistState: previous.document.persistState,
      persistError: previous.document.persistError,
      pendingWrite: previous.pendingWrite,
    });
    this.#versionSession.hydrate({
      versions: previous.version.versions,
      latestVersionId: previous.version.latestVersionId,
      currentBasedOnVersionId: previous.version.currentBasedOnVersionId,
      currentExactVersionId: previous.version.currentExactVersionId,
      restoredFromVersionId: previous.version.restoredFromVersionId,
    });
    if (previous.version.viewMode === "history") {
      this.#versionSession.restoreView?.({
        viewMode: "history",
        viewingVersionId: previous.version.viewingVersionId,
        historyPreview: previous.version.historyPreview,
      });
    }
    this.#commentSession.update(previous.comment);
    if (context && typeof this.#draftSession.replaceAuthority === "function") {
      this.#draftSession.replaceAuthority(context, previous.draftRevision, {
        draftRevision: previous.draftRevision,
        comments: previous.comment.comments,
        changeEvents: previous.comment.changeEvents,
        deletedCommentIds: previous.comment.deletedCommentIds,
        appliedOperationIds: [],
      });
    } else {
      this.#draftSession.deactivate();
    }

    for (const run of this.#runSession.runs) this.#runSession.removeRun(run);
    this.#runSession.activate(previous.run.activeSourcePath);
    for (const run of previous.run.runs) {
      this.#runSession.trackRun(run, { activate: "never" });
    }
    this.#runSession.setActiveRun(previous.run.activeRun);
    if (previous.run.recentOutcome) {
      this.#runSession.rememberOutcome(previous.run.recentOutcome);
    } else {
      this.#runSession.forgetOutcome(previous.run.activeSourcePath);
    }
    for (const [sourcePath] of this.#runSession.snapshot.backgroundResults) {
      this.#runSession.clearResult(sourcePath);
    }
    for (const [sourcePath, result] of previous.run.backgroundResults) {
      this.#runSession.markResult(sourcePath, result);
    }
    this.#documentWorkflow.restoreProjectTransitionAuthority({
      authority: previous.documentWorkflow,
      context,
      sourceSha256: previous.document.persistedSourceSha256,
    });
    this.#canvasPort.invalidateRenderAcks?.();
    return Object.freeze({
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
    });
  }

  captureManagedSourceTransitionAuthority() {
    return this.#captureHydrationAuthority();
  }

  restoreManagedSourceTransitionAuthority(authority) {
    if (!authority || typeof authority !== "object") return null;
    return this.#rollbackHydrationAuthority(authority);
  }

  // VersionWorkflow shares this narrow transition primitive with Candidate
  // promotion, historical Working Copy continuation and future Registry
  // project activation. The caller prepares async host work first; this method
  // never publishes a partial Project/Document/Version tuple.
  async prepareManagedSourceTransition({
    previousSourcePath,
    nextSourcePath,
    expectedSha256,
    nextProjectId,
    nextDocumentId,
    versionId,
    openTarget = null,
    operationId = null,
  }) {
    if (!SHA256.test(String(expectedSha256 || ""))) {
      throw sourceLocatorUnknown(
        "托管工作文件切换缺少可核对的源 Hash，当前项目没有切换。",
        operationId,
      );
    }
    const currentPathMatchesNext = this.#codecs.sameSourcePath(
      this.#projectSession.sourcePath,
      nextSourcePath,
    );
    const currentPathMatchesPrevious = this.#codecs.sameSourcePath(
      this.#projectSession.sourcePath,
      previousSourcePath,
    );
    // A Desktop activation is allowed to publish the local aggregate only
    // when the complete current tuple and the locator agree. In particular,
    // projectId alone is not authority: a different document in the same
    // project is a background target and must remain publication-free.
    const currentIdentityMatchesNext = Boolean(
      this.#projectSession.projectId
      && this.#projectSession.documentId
      && nextProjectId
      && nextDocumentId
      && this.#projectSession.projectId === nextProjectId
      && this.#projectSession.documentId === nextDocumentId,
    );
    const updatesCurrentProject = Boolean(
      currentIdentityMatchesNext
      && (currentPathMatchesPrevious || currentPathMatchesNext)
    );
    const managedTarget = verifyOpenTarget(openTarget, {
      projectId: nextProjectId,
      documentId: nextDocumentId,
      sourcePath: nextSourcePath,
      sourceSha256: expectedSha256,
      sameSourcePath: this.#codecs.sameSourcePath,
    });
    const targetKind = String(managedTarget?.targetKind || "");
    const targetVersionMatches = Boolean(
      managedTarget
      && String(managedTarget.versionId || "") === String(versionId || ""),
    );
    const completeTargetMatches = Boolean(
      managedTarget
      && targetVersionMatches
      && ["working-copy", "version"].includes(targetKind),
    );

    // A matching path is not authority. Validate the complete target, Version
    // identity, and target kind before either a same-path fast path or a
    // transition reservation can return or publish local state.
    if (!completeTargetMatches) {
      throw sourceLocatorUnknown(
        "托管工作文件的完整 OpenTarget 与目标路径或版本身份不一致，请重新核对。",
        operationId,
      );
    }

    // A background Version may refresh the catalog, but it must never ask
    // Desktop to activate a file or publish local Session authority. Its
    // complete target is still required so a malformed response cannot be
    // silently downgraded to the generated-version compatibility route.
    if (!updatesCurrentProject) {
      return Object.freeze({
        previousSourcePath,
        nextSourcePath,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        openTarget: managedTarget,
        updatesCurrentProject,
        activatedProject: null,
      });
    }
    if (!nextSourcePath || this.#codecs.sameSourcePath(nextSourcePath, previousSourcePath)) {
      return Object.freeze({
        previousSourcePath,
        nextSourcePath,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        openTarget: managedTarget,
        updatesCurrentProject,
        activatedProject: null,
      });
    }
    if (!/^[A-Za-z0-9_-]{8,160}$/u.test(String(operationId || ""))) {
      throw sourceLocatorUnknown(
        "桌面工作文件切换缺少可核对的操作身份，当前项目没有切换。",
        operationId,
      );
    }
    const changesSourcePath = !this.#codecs.sameSourcePath(
      this.#projectSession.sourcePath,
      nextSourcePath,
    );
    const transitionFence = updatesCurrentProject && changesSourcePath
      ? this.#captureLocatorFence(this.#projectSession.context)
      : null;
    const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
    const projectCoordination = this.#projectSession[PROJECT_SESSION_COORDINATION] || null;
    const runReservation = transitionFence
      ? runCoordination?.prepareRebaseSource?.({
          previousSourcePath,
          sourcePath: nextSourcePath,
          projectId: nextProjectId,
          documentId: nextDocumentId,
        })
      : null;
    const projectReservation = transitionFence
      ? projectCoordination?.prepareTransitionSource?.({
          previousSourcePath,
          sourcePath: nextSourcePath,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          openTarget: managedTarget,
        })
      : null;
    const coordination = transitionFence
      ? Object.freeze({
          fence: transitionFence,
          runReservation,
          projectReservation,
          operationId: operationId ? String(operationId) : null,
        })
      : null;
    if (transitionFence && ((this.#runSession && !runReservation) || !projectReservation)) {
      return Object.freeze({
        previousSourcePath,
        nextSourcePath,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        openTarget: managedTarget,
        updatesCurrentProject,
        activatedProject: null,
        coordination,
      });
    }
    const isManagedWorkingCopy = targetKind === "working-copy";
    // `completeTargetMatches` above fences both routes before the Desktop
    // call; these booleans now only select the already-verified route.
    let activatedProject;
    try {
      activatedProject = isManagedWorkingCopy
        ? await this.#activateManagedWorkingCopy({
            previousSourcePath,
            nextSourcePath,
            expectedSha256,
            projectId: nextProjectId,
            documentId: nextDocumentId,
            workingCopyId: String(managedTarget.workingCopyId),
            versionId,
            projectRootPath: String(managedTarget.projectRootPath),
            operationId: String(operationId),
          })
        : await this.#activateGeneratedVersion({
            previousSourcePath,
            nextSourcePath,
            expectedSha256,
            projectId: nextProjectId,
            versionId,
            operationId: String(operationId),
          });
    } catch (cause) {
      if (transitionFence) {
        throw sourceLocatorUnknown(
          "桌面工作文件切换结果待同一操作核对，请勿重复切换。",
          operationId,
        );
      }
      throw cause;
    }
    if (
      transitionFence
      && (
        !this.#isCurrentLocatorFence(transitionFence)
        || (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(runReservation))
        || !projectCoordination?.transitionReservationCurrent?.(projectReservation)
      )
    ) {
      throw sourceLocatorUnknown(
        "托管工作文件已返回，但本地项目身份或 Locator reservation 已变化，请重新核对。",
        operationId,
      );
    }
    if (
      !activatedProject
      || typeof activatedProject !== "object"
      || String(activatedProject.operationId || "") !== String(operationId)
      || typeof activatedProject.html !== "string"
      || typeof activatedProject.sourcePath !== "string"
      || typeof activatedProject.sha256 !== "string"
    ) {
      throw sourceLocatorUnknown(
        "桌面工作文件返回的完整身份或内容无法核对，请重新打开。",
        operationId,
      );
    }
    let activatedHash;
    try {
      activatedHash = await this.#hashPort.sha256(activatedProject.html);
    } catch {
      throw sourceLocatorUnknown(
        "桌面工作文件 Hash 无法完成核对，请重新打开。",
        operationId,
      );
    }
    if (
      transitionFence
      && (
        !this.#isCurrentLocatorFence(transitionFence)
        || (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(runReservation))
        || !projectCoordination?.transitionReservationCurrent?.(projectReservation)
      )
    ) {
      throw sourceLocatorUnknown(
        "托管工作文件 Hash 返回时本地项目身份或 Locator reservation 已变化，请重新核对。",
        operationId,
      );
    }
    if (
      !this.#codecs.sameSourcePath(activatedProject.sourcePath, nextSourcePath)
      || activatedProject.sha256 !== expectedSha256
      || activatedHash !== expectedSha256
    ) {
      throw sourceLocatorUnknown(
        "生成版本的路径、HTML 与 Hash 没有形成完整一致的候选，请重新打开。",
        operationId,
      );
    }
    return Object.freeze({
      previousSourcePath,
      nextSourcePath,
      projectId: nextProjectId,
      documentId: nextDocumentId,
      openTarget: managedTarget,
      updatesCurrentProject,
      activatedProject,
      coordination,
    });
  }

  async #activateGeneratedVersion(input) {
    if (typeof this.#projectOpenPort.activateGeneratedVersion !== "function") {
      throw new Error("当前运行环境不能安全切换到生成的新版本文件。");
    }
    return this.#projectOpenPort.activateGeneratedVersion(input);
  }

  async #activateManagedWorkingCopy(input) {
    if (typeof this.#projectOpenPort.activateManagedWorkingCopy !== "function") {
      throw new Error("当前运行环境不能安全切换到托管工作文件。");
    }
    return this.#projectOpenPort.activateManagedWorkingCopy(input);
  }

  commitManagedSourceTransition({
    prepared,
    html,
    sourceSha256,
    publishVersion = () => {},
    publishSessions = null,
  }) {
    if (!prepared.updatesCurrentProject) return null;
    const changesSourcePath = !this.#codecs.sameSourcePath(
      this.#projectSession.sourcePath,
      prepared.nextSourcePath,
    );
    const runCoordination = this.#runSession[RUN_SESSION_COORDINATION] || null;
    const projectCoordination = this.#projectSession[PROJECT_SESSION_COORDINATION] || null;
    let runReservation = null;
    let projectReservation = null;
    if (changesSourcePath) {
      runReservation = prepared.coordination?.runReservation
        || runCoordination?.prepareRebaseSource?.({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
        });
      projectReservation = prepared.coordination?.projectReservation
        || projectCoordination?.prepareTransitionSource?.({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          openTarget: prepared.openTarget,
        });
      if ((this.#runSession && !runReservation) || !projectReservation) return null;
      if (
        prepared.coordination
        && (
          !this.#isCurrentLocatorFence(prepared.coordination.fence)
          || (this.#runSession && !runCoordination?.rebaseReservationCurrent?.(runReservation))
          || !projectCoordination?.transitionReservationCurrent?.(projectReservation)
        )
      ) return null;
      if (this.#runSession && !runCoordination?.commitRebaseSource?.(runReservation, { publish: false })) {
        return null;
      }
    }
    let transition = null;
    try {
      transition = changesSourcePath
        ? projectCoordination?.commitTransitionSource?.(
            projectReservation,
            { publish: false },
          )
        : this.#projectSession.context || this.#projectSession.register({
            epoch: this.#projectSession.epoch,
            projectId: prepared.projectId,
            documentId: prepared.documentId,
            sourcePath: prepared.nextSourcePath,
            ...(prepared.openTarget ? { openTarget: prepared.openTarget } : {}),
          });
    } catch {
      if (runReservation) {
        runCoordination?.rollbackRebaseSource?.(
          runReservation,
          { publish: false },
        );
      }
      return null;
    }
    if (!transition || !this.#projectSession.context) {
      if (runReservation) {
        runCoordination?.rollbackRebaseSource?.(
          runReservation,
          { publish: false },
        );
      }
      return null;
    }
    const endPublication = this.#beginPublicationBatch();
    try {
      if (changesSourcePath) {
        projectCoordination?.publish?.();
        runCoordination?.publish?.();
      }

      // Publication is deliberately synchronous: no consumer can observe a new
      // Project without the complete Document tuple, Version/Draft/Comment
      // authority and new Canvas generation.
      if (changesSourcePath) {
        this.#documentWorkflow.resetForProjectTransition();
        this.#commentWorkflow.resetForProjectTransition();
        this.#projectRulesWorkflow.resetForProjectTransition();
      }
      this.#documentSession.publishAuthority({
        html,
        persistedSourceSha256: sourceSha256,
        pendingWrite: null,
      });
      if (typeof publishSessions === "function") {
        publishSessions(this.#projectSession.context);
      } else {
        publishVersion();
        if (changesSourcePath) this.#draftSession.deactivate();
      }
      this.#canvasPort.invalidateRenderAcks?.();
      return this.#projectSession.context;
    } catch {
      return null;
    } finally {
      endPublication?.();
    }
  }

  // Kept as a compatibility seam for the already-published Candidate route.
  // New managed source callers use the generic names above.
  async prepareGeneratedSourceTransition(input) {
    return this.prepareManagedSourceTransition(input);
  }

  commitGeneratedSourceTransition(input) {
    return this.commitManagedSourceTransition(input);
  }

  #deferCanvasCommand(kind, run, options = {}) {
    if (typeof this.#canvasPort.deferCommand !== "function") return null;
    let resolveDeferred;
    const outcome = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    const deferred = this.#canvasPort.deferCommand(
      kind,
      () => Promise.resolve(run()).then(resolveDeferred, (cause) => {
        resolveDeferred(rejected(
          "PROJECT_DEFERRED_COMMAND_REJECTED",
          projectErrorMessage(this.#codecs, cause, "延后的项目操作失败。"),
        ));
      }),
      {
        ...options,
        onDiscard: () => resolveDeferred(blocked(
          "PROJECT_DEFERRED_COMMAND_DISCARDED",
          "当前项目已经变化，延后的操作没有执行。",
        )),
      },
    );
    return deferred ? outcome : null;
  }

  #scheduleDeferredReconciliation() {
    if (this.#reconcileScheduled || this.#disposed) return;
    this.#reconcileScheduled = true;
    Promise.resolve().then(() => {
      this.#reconcileScheduled = false;
      this.reconcileDeferred();
    });
  }

  #waitUntil(predicate, deadlineAt) {
    if (predicate()) return Promise.resolve(true);
    const deadline = Number(deadlineAt);
    if (this.#disposed || !Number.isFinite(deadline) || this.#clock.now() >= deadline) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const waiter = {
        timer: null,
        resolve: (value) => {
          if (!this.#pollWaiters.delete(waiter)) return;
          if (waiter.timer !== null && typeof this.#scheduler.clearTimeout === "function") {
            this.#scheduler.clearTimeout(waiter.timer);
          }
          resolve(value);
        },
      };
      const poll = () => {
        if (predicate()) {
          waiter.resolve(true);
          return;
        }
        if (this.#disposed || this.#clock.now() >= deadline) {
          waiter.resolve(false);
          return;
        }
        waiter.timer = this.#scheduler.setTimeout(poll, Math.min(40, deadline - this.#clock.now()));
      };
      this.#pollWaiters.add(waiter);
      waiter.timer = this.#scheduler.setTimeout(poll, Math.min(40, deadline - this.#clock.now()));
    });
  }

  async #drainExternalOpenForClose(deadlineAt) {
    while (this.#clock.now() < Number(deadlineAt)) {
      const confirmation = this.#openConfirmation;
      if (confirmation) {
        const canceled = await this.cancelExternalOpen({
          requestId: confirmation.requestId,
        });
        if (canceled.status !== "succeeded") {
          await new Promise((resolve) => this.#scheduler.setTimeout(resolve, 40));
        }
        continue;
      }
      if (this.#externalFileOpenSession.snapshot.status === "idle") return true;
      const settled = await this.#waitUntil(() => (
        Boolean(this.#openConfirmation)
        || this.#externalFileOpenSession.snapshot.status === "idle"
      ), deadlineAt);
      if (!settled) return false;
    }
    return false;
  }

  #dependencyOutcome(outcome, identity, fallbackCode, fallbackReason) {
    if (outcome?.status === "stale") return stale(identity);
    if (outcome?.status === "unknown") {
      return unknown(outcome.operationId || this.#nextOperationId("source-rename"), (
        outcome.reason || fallbackReason
      ));
    }
    if (outcome?.status === "rejected") {
      return rejected(outcome.code || fallbackCode, outcome.reason || fallbackReason);
    }
    return blocked(outcome?.code || fallbackCode, outcome?.reason || fallbackReason);
  }

  #setHydration({ phase, epoch, sourcePath, error }) {
    if (phase === "hydrating") this.#hydrationGeneration += 1;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      hydration: Object.freeze({
        phase,
        generation: this.#hydrationGeneration,
        epoch: Number(epoch) || 0,
        sourcePath: sourcePath ? String(sourcePath) : null,
        error: error ? String(error) : null,
      }),
    });
    this.#notify();
  }

  #setSupplemental({ phase, operationId = null, snapshotRevision = null, error = null }) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      supplemental: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
        snapshotRevision: snapshotRevision ? String(snapshotRevision) : null,
        error: error ? String(error) : null,
      }),
    });
    this.#notify();
  }

  #setSwitch(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      switch: Object.freeze({ phase, operationId }),
    });
    this.#notify();
  }

  #setRename(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      rename: Object.freeze({ phase, operationId }),
    });
    this.#notify();
  }

  #setOpen(phase, operationId, pendingKind) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      open: Object.freeze({ phase, operationId, pendingKind }),
    });
    this.#notify();
  }

  #setClose(phase, requestId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      close: Object.freeze({ phase, requestId }),
    });
    this.#notify();
  }

  #publishSnapshot() {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      openConfirmation: this.#openConfirmation,
      externalOpen: this.#externalFileOpenSession.snapshot,
      projectApplication: this.#projectApplicationSession.snapshot,
    });
    this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // A presentation subscriber cannot affect project authority.
      }
    }
  }

  #emit(event) {
    if (this.#disposed) return;
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // A presentation event listener cannot affect project authority.
      }
    }
  }

  #isHistoryView() {
    return this.#versionSession.snapshot.viewMode === "history";
  }

  #markHydrationStage(stage, operationId = null, timing = null) {
    this.#emit({
      type: "project-hydration-stage",
      stage: String(stage),
      operationId: operationId ? String(operationId) : null,
      timing: this.#codecs.isRecord(timing) ? Object.freeze({ ...timing }) : null,
    });
  }

  #nextOperationId(prefix) {
    this.#operationSequence += 1;
    return [
      prefix,
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #nextOpenOperation() {
    this.#openSequence += 1;
    return [
      "project-open",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#openSequence.toString(36),
    ].join("_");
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackMessage) {
    if (
      (isBridgeRequestError(cause) && cause.outcome === "unknown")
      || cause?.projectOutcome === "unknown"
    ) {
      return unknown(operationId, fallbackMessage);
    }
    return rejected(projectErrorCode(cause, fallbackCode), fallbackMessage);
  }
}
