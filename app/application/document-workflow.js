import { isBridgeRequestError } from "./bridge-client.js";
import { createDocumentWorkflowCodecs } from "./document-workflow-codecs.js";
import {
  planDocumentEnqueue,
  planDocumentSave,
  planDocumentLeaveReadiness,
  planDocumentLeaveAfterDrain,
  planDocumentLeaveProtection,
} from "./document/save-plan.js";
import {
  copyProjectContext as copyContext,
  verifyProjectContext,
} from "./verified-project-context.js";

const AUTOSAVE_DELAY_MS = 100;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function isNativeEditCheckpoint(mutation) {
  return Boolean(
    mutation
    &&     mutation.kind === "text"
    && mutation.property === "editableIslandHtml",
  );
}

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

function stale(context) {
  return Object.freeze({ status: "stale", context: Object.freeze({ ...context }) });
}

function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

function sourceErrorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return cause && typeof cause === "object" && cause.code
    ? String(cause.code)
    : fallback;
}

function sameContext(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && Number(left.epoch) === Number(right.epoch)
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && sameSourcePath(left.sourcePath, right.sourcePath),
  );
}

function sameRecoveryDocument(left, right) {
  return Boolean(
    left
    && right
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && String(left.workingCopyId || "") === String(right.workingCopyId || "")
  );
}

function sameOpenTarget(left, right, sameSourcePath) {
  return Boolean(
    sameOpenRoute(left, right, sameSourcePath)
    && String(left.sourceSha256 || "") === String(right.sourceSha256 || "")
  );
}

function sameOpenRoute(left, right, sameSourcePath) {
  return Boolean(
    sameContext(left, right, sameSourcePath)
    && String(left.projectRootPath || "") === String(right.projectRootPath || "")
    && String(left.targetKind || "") === String(right.targetKind || "")
    && String(left.workingCopyId || "") === String(right.workingCopyId || "")
    && String(left.versionId || "") === String(right.versionId || "")
    && sameSourcePath(left.exactSourcePath || left.sourcePath, right.exactSourcePath || right.sourcePath)
    && Number(left.sessionEpoch ?? left.epoch) === Number(right.sessionEpoch ?? right.epoch)
  );
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

function invalidAcknowledgement(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identityMatches(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && String(left.token || "") === String(right.token || "")
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && sameSourcePath(left.sourcePath, right.sourcePath)
    && String(left.basedOnVersionId || "") === String(right.basedOnVersionId || "")
    && String(left.sourceSha256 || "") === String(right.sourceSha256 || "")
    && Number(left.editRevision) === Number(right.editRevision),
  );
}

// DocumentWorkflow is the PR-2 durable-source boundary.  It receives existing
// Sessions by injection; it never creates a second fact owner and never imports
// the renderer's Workbench or DOM implementation.
export class DocumentWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #versionSession;
  #sourceHistorySession;
  #codecs;
  #hashPort;
  #recoveryJournal;
  #canvasPort;
  #scheduler;
  #clock;
  #listeners = new Set();
  #autosaveTimer = null;
  #historyActionPromise = null;
  #auditPending = [];
  #auditInFlight = new Set();
  #recoveryIdentity = null;
  #recoveryCheckpoint = null;
  #recoveryJournalReceipt = null;
  #exportCheckpoint = null;
  #recoveryJournalInFlight = null;
  #recoveryJournalPending = null;
  #recoveryJournalGeneration = 0;
  #operationSequence = 0;
  #disposed = false;

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    codecs,
    ports = {},
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.autosave !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.resolveConflict !== "function"
    ) {
      throw new TypeError("DocumentWorkflow requires its durable Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("DocumentWorkflow requires project registration authority.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("DocumentWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.beginEdit !== "function") {
      throw new TypeError("DocumentWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.update !== "function") {
      throw new TypeError("DocumentWorkflow requires CommentSession injection.");
    }
    if (!versionSession || typeof versionSession.markSourceEdited !== "function") {
      throw new TypeError("DocumentWorkflow requires VersionSession injection.");
    }
    if (!sourceHistorySession || typeof sourceHistorySession.record !== "function") {
      throw new TypeError("DocumentWorkflow requires SourceHistorySession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("DocumentWorkflow requires a HashPort.");
    }
    if (
      ports.recoveryJournal
      && (
        typeof ports.recoveryJournal.commit !== "function"
        || typeof ports.recoveryJournal.readVerified !== "function"
        || typeof ports.recoveryJournal.remove !== "function"
      )
    ) {
      throw new TypeError("DocumentWorkflow RecoveryJournal port is invalid.");
    }
    if (!ports.canvas || typeof ports.canvas.invalidateRenderAcks !== "function") {
      throw new TypeError("DocumentWorkflow requires a CanvasAuthorityPort.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("DocumentWorkflow requires a SchedulerPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("DocumentWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#versionSession = versionSession;
    this.#sourceHistorySession = sourceHistorySession;
    this.#codecs = createDocumentWorkflowCodecs(codecs);
    this.#hashPort = ports.hash;
    this.#recoveryJournal = ports.recoveryJournal || null;
    this.#canvasPort = ports.canvas;
    this.#scheduler = scheduler;
    this.#clock = clock;
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("DocumentWorkflow event listener must be a function.");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#clearAutosaveTimer();
    this.#listeners.clear();
  }

  get hasHistoryAction() {
    return Boolean(this.#historyActionPromise);
  }

  get recoveryIdentity() {
    return this.#recoveryIdentity;
  }

  get recoveryCheckpoint() {
    return this.#recoveryCheckpoint;
  }

  inspectLeaveReadiness({ hasPendingNativeEdit = false } = {}) {
    const document = this.#documentSession.snapshot;
    const plan = planDocumentLeaveReadiness({
      obligationsResolved: !this.#disposed,
      hasPendingNativeEdit,
      hasHistoryAction: this.hasHistoryAction,
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
    return Object.freeze({ ...plan, sourceSha256: document.persistedSourceSha256 });
  }

  captureLeaveBoundary() {
    // Operation-local immutable references, never a cached permission to leave.
    return Object.freeze({
      context: copyContext(this.#projectSession.context || this.#projectSession.locator),
      epoch: this.#projectSession.epoch,
      revision: this.#documentSession.editRevision,
      html: this.#documentSession.html,
    });
  }

  verifyLeaveBoundary(boundary, {
    needsSourceProtection = false,
    committedSourceSha256 = "",
  } = {}) {
    const current = this.#projectSession.context;
    if (
      this.#disposed || !boundary
      || boundary.epoch !== this.#projectSession.epoch
      || (boundary.context
        ? (boundary.context.targetKind
          ? !sameOpenRoute(boundary.context, current, this.#codecs.sameSourcePath)
          : !this.#isCurrent(boundary.context))
        : Boolean(current))
      || boundary.html !== this.#documentSession.html
    ) {
      return Object.freeze({
        kind: "reject", code: "PROJECT_SWITCH_SOURCE_CHANGED",
        reason: "当前 HTML 在切换边界后仍有修改尚未安全写回。",
      });
    }
    const document = this.#documentSession.snapshot;
    const evidence = this.verifiedProtectionEvidence({
      context: current || boundary.context, revision: boundary.revision,
    });
    const afterDrain = planDocumentLeaveAfterDrain({
      editRevision: document.editRevision,
      cutoffRevision: boundary.revision,
      pendingWrite: document.hasPendingWrite,
      flushInFlight: document.isFlushing,
      hasHistoryAction: this.hasHistoryAction,
      recoveryProtected: Boolean(evidence),
    });
    if (afterDrain.kind === "reject") return afterDrain;
    return planDocumentLeaveProtection({
      needsSourceProtection,
      sourcePath: this.#projectSession.sourcePath,
      lastPersistedRevision: document.lastPersistedRevision,
      cutoffRevision: boundary.revision,
      persistedSourceSha256: document.persistedSourceSha256,
      workingHtmlSha256: document.workingHtmlSha256,
      committedSourceSha256,
      protectionHtmlSha256: evidence?.htmlSha256 || "",
      recoveryProtected: Boolean(evidence),
    });
  }

  canProtectForDetach(context = this.#projectSession.context) {
    return Boolean(
      this.#recoveryJournal
      && context?.projectId
      && context?.documentId
      && context?.sourcePath
    );
  }

  hasVerifiedRecoveryCheckpoint({ context, revision: expectedRevision } = {}) {
    const activeContext = copyContext(context) || copyContext(this.#projectSession.context);
    const checkpoint = this.#recoveryCheckpoint;
    return Boolean(
      activeContext
      && checkpoint
      && sameContext(checkpoint, activeContext, this.#codecs.sameSourcePath)
      && Number(checkpoint.revision) === revision(
        expectedRevision ?? this.#documentSession.editRevision,
      )
      && SHA256.test(String(checkpoint.recoveryHtmlSha256 || ""))
      && SHA256.test(String(checkpoint.journalSha256 || ""))
      && checkpoint.recoveryHtmlSha256 === this.#documentSession.workingHtmlSha256
    );
  }

  verifiedProtectionEvidence(input = {}) {
    if (this.hasVerifiedRecoveryCheckpoint(input)) {
      return Object.freeze({
        kind: "recoveryVerified",
        revision: revision(input.revision ?? this.#documentSession.editRevision),
        htmlSha256: this.#recoveryCheckpoint.recoveryHtmlSha256,
        journalSha256: this.#recoveryCheckpoint.journalSha256,
      });
    }
    const activeContext = copyContext(input.context) || copyContext(this.#projectSession.context);
    const checkpoint = this.#exportCheckpoint;
    if (
      activeContext
      && checkpoint
      && sameContext(checkpoint, activeContext, this.#codecs.sameSourcePath)
      && Number(checkpoint.revision) === revision(
        input.revision ?? this.#documentSession.editRevision,
      )
      && SHA256.test(String(checkpoint.exportHtmlSha256 || ""))
      && checkpoint.exportHtmlSha256 === this.#documentSession.workingHtmlSha256
      && String(checkpoint.path || "")
    ) {
      return Object.freeze({
        kind: "exportVerified",
        revision: revision(input.revision ?? this.#documentSession.editRevision),
        htmlSha256: checkpoint.exportHtmlSha256,
        path: checkpoint.path,
      });
    }
    return null;
  }

  hasVerifiedProtectionEvidence(input = {}) {
    return Boolean(this.verifiedProtectionEvidence(input));
  }

  async recordVerifiedExport({ context, html, revision: exportedRevision, exported } = {}) {
    const activeContext = copyContext(context) || copyContext(this.#projectSession.context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    const expectedRevision = revision(exportedRevision);
    const expectedHtml = String(html || "");
    if (
      expectedRevision !== this.#documentSession.editRevision
      || expectedHtml !== this.#documentSession.html
    ) {
      return blocked("DOCUMENT_EXPORT_STALE", "导出副本没有覆盖当前编辑版本。");
    }
    const exportedSha256 = String(exported?.sha256 || "");
    const exportedPath = String(exported?.path || "");
    const actualSha256 = await this.#hashPort.sha256(expectedHtml);
    if (
      !this.#isCurrent(activeContext)
      || !SHA256.test(exportedSha256)
      || exportedSha256 !== actualSha256
      || !exportedPath
    ) {
      return rejected(
        "DOCUMENT_EXPORT_EVIDENCE_INVALID",
        "导出文件与当前 HTML 无法完成 Hash 校验。",
      );
    }
    if (!this.#documentSession.confirmWorkingHtml({
      revision: expectedRevision,
      htmlSha256: actualSha256,
    })) {
      return blocked("DOCUMENT_EXPORT_STALE", "导出副本没有覆盖当前编辑版本。");
    }
    this.#exportCheckpoint = Object.freeze({
      ...activeContext,
      revision: expectedRevision,
      exportHtmlSha256: exportedSha256,
      path: exportedPath,
    });
    this.#emit({
      type: "document-export-checkpoint-verified",
      context: activeContext,
      revision: expectedRevision,
      exportHtmlSha256: exportedSha256,
    });
    return succeeded({ protected: true, evidence: "exportVerified" });
  }

  async protectForDetach({ context } = {}) {
    const activeContext = copyContext(context) || copyContext(this.#projectSession.context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    if (
      this.#documentSession.persistState === "idle"
      && this.#documentSession.editRevision === this.#documentSession.lastPersistedRevision
    ) {
      return succeeded({ protected: true, evidence: "sourcePersisted" });
    }
    if (this.hasVerifiedRecoveryCheckpoint({
      context: activeContext,
      revision: this.#documentSession.editRevision,
    })) {
      return succeeded({ protected: true, evidence: "recoveryVerified" });
    }
    if (this.#exportCheckpoint && this.hasVerifiedProtectionEvidence({
      context: activeContext,
      revision: this.#documentSession.editRevision,
    })) {
      return succeeded({ protected: true, evidence: "exportVerified" });
    }
    const strandedReceipt = this.#recoveryJournalReceipt;
    if (
      strandedReceipt
      && sameRecoveryDocument(strandedReceipt, activeContext)
      && !this.#codecs.sameSourcePath(strandedReceipt.sourcePath, activeContext.sourcePath)
    ) {
      const rebased = await this.rebaseRecoveryJournal({
        previousContext: {
          ...activeContext,
          sourcePath: strandedReceipt.sourcePath,
          ...(activeContext.exactSourcePath
            ? { exactSourcePath: strandedReceipt.sourcePath }
            : {}),
        },
        context: activeContext,
      });
      if (rebased.status !== "succeeded") return rebased;
      if (this.hasVerifiedRecoveryCheckpoint({
        context: activeContext,
        revision: this.#documentSession.editRevision,
      })) {
        return succeeded({ protected: true, evidence: "recoveryVerified" });
      }
    }
    if (!this.canProtectForDetach(activeContext)) {
      return blocked(
        "DOCUMENT_RECOVERY_JOURNAL_UNAVAILABLE",
        "当前内容还没有可校验的恢复副本。",
      );
    }
    const write = this.#documentSession.pendingWrite || this.#createWrite(
      activeContext,
      this.#documentSession.html,
      this.#documentSession.editRevision,
    );
    try {
      const checkpoint = await this.#commitRecoveryJournal(write, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      if (!this.hasVerifiedRecoveryCheckpoint({
        context: activeContext,
        revision: write.revision,
      })) {
        return blocked(
          "DOCUMENT_RECOVERY_CHECKPOINT_STALE",
          "恢复副本没有覆盖当前编辑版本。",
        );
      }
      return succeeded({
        protected: true,
        evidence: "recoveryVerified",
        checkpoint,
      });
    } catch (cause) {
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const reason = this.#codecs.errorMessage(cause, "恢复副本没有安全完成。");
      this.#emit({
        type: "document-recovery-checkpoint-failed",
        context: activeContext,
        reason,
      });
      return rejected("DOCUMENT_RECOVERY_CHECKPOINT_FAILED", reason);
    }
  }

  get pendingAuditEvents() {
    return [...this.#auditPending];
  }

  replaceRecoveryIdentity(identity) {
    this.#recoveryIdentity = identity || null;
    return this.#recoveryIdentity;
  }

  captureProjectTransitionAuthority() {
    return Object.freeze({
      recoveryIdentity: this.#recoveryIdentity,
      sourceHistory: this.#sourceHistorySession.snapshot,
      sourceHistoryOperations: this.#sourceHistorySession.pendingOperations,
    });
  }

  restoreProjectTransitionAuthority({
    authority,
    context,
    sourceSha256,
  } = {}) {
    this.#recoveryIdentity = authority?.recoveryIdentity || null;
    const activeContext = copyContext(context);
    const history = authority?.sourceHistory;
    if (!activeContext || !this.#isCurrent(activeContext) || !history || !sourceSha256) {
      this.#sourceHistorySession.deactivate?.();
      return false;
    }
    this.#sourceHistorySession.activate(
      activeContext,
      String(sourceSha256),
      history,
    );
    this.#sourceHistorySession.restorePendingEvidence(
      activeContext,
      authority.sourceHistoryOperations,
    );
    return true;
  }

  resetForProjectTransition({ clearRecovery = false, context } = {}) {
    this.#clearAutosaveTimer();
    this.#auditPending = [];
    this.#auditInFlight.clear();
    this.#recoveryIdentity = null;
    this.#sourceHistorySession.deactivate?.();
    if (clearRecovery) this.#persistRecovery(null, context);
  }

  clearRecovery(context) {
    this.#persistRecovery(null, context);
  }

  async rebaseRecoveryJournal({ previousContext, context } = {}) {
    const previous = copyContext(previousContext);
    const next = copyContext(context);
    const receipt = this.#recoveryJournalReceipt;
    if (
      !previous
      || !next
      || !receipt
      || typeof this.#recoveryJournal?.rebase !== "function"
      || !sameRecoveryDocument(receipt, previous)
      || !this.#codecs.sameSourcePath(receipt.sourcePath, previous.sourcePath)
    ) {
      return succeeded({ rebased: false });
    }
    const publishRebased = (journal) => {
      const checkpoint = this.#checkpointFromJournal(journal, next);
      if (!checkpoint) {
        throw invalidAcknowledgement(
          "恢复日志路径更新后的身份无法校验。",
          "DOCUMENT_RECOVERY_REBASE_INVALID",
        );
      }
      this.#recoveryJournalReceipt = checkpoint;
      if (
        checkpoint.revision === this.#documentSession.editRevision
        && checkpoint.recoveryHtmlSha256 === this.#documentSession.workingHtmlSha256
      ) {
        this.#recoveryCheckpoint = checkpoint;
      }
      return succeeded({ rebased: true, checkpoint });
    };
    const rebase = (authority) => this.#recoveryJournal.rebase({
      projectId: authority.projectId,
      documentId: authority.documentId,
      previousSourcePath: authority.sourcePath,
      sourcePath: next.sourcePath,
      workingCopyId: String(authority.workingCopyId || ""),
      revision: authority.revision,
      recoveryHtmlSha256: authority.recoveryHtmlSha256,
      expectedJournalSha256: authority.journalSha256,
    });
    try {
      return publishRebased(await rebase(receipt));
    } catch (cause) {
      let finalCause = cause;
      try {
        const authority = await this.#recoveryJournal.readVerified({
          projectId: receipt.projectId,
          documentId: receipt.documentId,
        });
        if (
          !authority
          || !sameRecoveryDocument(authority, receipt)
          || Number(authority.revision) !== Number(receipt.revision)
          || String(authority.recoveryHtmlSha256 || "") !== receipt.recoveryHtmlSha256
        ) {
          throw invalidAcknowledgement(
            "恢复日志路径更新后的 Main 权威与当前恢复凭证不一致。",
            "DOCUMENT_RECOVERY_REBASE_AUTHORITY_MISMATCH",
          );
        }
        if (this.#codecs.sameSourcePath(authority.sourcePath, next.sourcePath)) {
          return publishRebased(authority);
        }
        if (!this.#codecs.sameSourcePath(authority.sourcePath, receipt.sourcePath)) {
          throw invalidAcknowledgement(
            "恢复日志已经指向另一个文件位置。",
            "DOCUMENT_RECOVERY_REBASE_PATH_MISMATCH",
          );
        }
        return publishRebased(await rebase(authority));
      } catch (reconcileCause) {
        finalCause = reconcileCause;
      }
      this.#emit({
        type: "document-recovery-rebase-failed",
        context: next,
        previousContext: previous,
        reason: this.#codecs.errorMessage(finalCause, "恢复日志无法更新到新文件位置。"),
      });
      return rejected(
        "DOCUMENT_RECOVERY_REBASE_REJECTED",
        this.#codecs.errorMessage(finalCause, "恢复日志无法更新到新文件位置。"),
      );
    }
  }

  clearAutosaveTimer() {
    this.#clearAutosaveTimer();
  }

  clearAudit() {
    this.#auditPending = [];
    this.#auditInFlight.clear();
  }

  activateSourceHistory({ context, sourceSha256, history, preservePending = false } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    this.#sourceHistorySession.activate(
      activeContext,
      String(sourceSha256 || ""),
      history,
      { preservePending },
    );
    return succeeded({ active: true });
  }

  async waitForHistoryAction() {
    return this.#historyActionPromise
      ? this.#historyActionPromise
      : succeeded({ idle: true });
  }

  enqueueEdit({ html, mutation, sourceTransaction, context } = {}) {
    const enqueuePlan = planDocumentEnqueue({
      disposed: this.#disposed,
      persistState: this.#documentSession.persistState,
    });
    if (enqueuePlan.kind === "reject") {
      return blocked(enqueuePlan.code, enqueuePlan.reason);
    }
    const writeContext = this.#writeContext(context);
    const nextHtml = String(html ?? "");
    const nextRevision = this.#documentSession.editRevision + 1;
    if (sourceTransaction && writeContext.sourcePath) {
      try {
        this.#sourceHistorySession.record(
          writeContext,
          sourceTransaction,
          nextRevision,
          new Date(this.#clock.now()).toISOString(),
        );
      } catch (cause) {
        return rejected(
          "SOURCE_HISTORY_RECORD_REJECTED",
          this.#codecs.errorMessage(cause, "源码历史与当前编辑不一致。"),
        );
      }
    }

    const revisionAfterEdit = this.#documentSession.beginEdit(nextHtml);
    if (revisionAfterEdit !== nextRevision) {
      return blocked(
        "DOCUMENT_EDIT_REJECTED",
        "当前文档不接受新的编辑，请先处理现有冲突。",
      );
    }
    this.#versionSession.markSourceEdited();
    this.#canvasPort.invalidateRenderAcks();

    if (mutation) {
      const nextEvents = this.#codecs.appendDirectEditEvent({
        mutation,
        revision: nextRevision,
        createdAt: new Date(this.#clock.now()).toISOString(),
        basedOnVersionId: this.#versionSession.snapshot.currentBasedOnVersionId,
        events: this.#commentSession.changeEvents,
        pendingEvents: this.#auditPending,
        inFlightKeys: this.#auditInFlight,
        nextEventId: () => this.#nextOperationId("change"),
      });
      this.#commentSession.setChangeEvents(nextEvents.events);
      this.#auditPending = nextEvents.pendingEvents;
      this.#emit({
        type: "document-direct-edit-recorded",
        context: writeContext,
        mutation,
        events: nextEvents.events,
      });
    }

    if (!writeContext.sourcePath) {
      this.#clearAutosaveTimer();
      this.#documentSession.update({
        pendingWrite: null,
        persistState: "preview-dirty",
        persistError: "",
      });
      return succeeded({ revision: nextRevision, queued: false });
    }

    const write = this.#createWrite(writeContext, nextHtml, nextRevision);
    this.#documentSession.setPendingWrite(write);
    this.#persistRecovery(write, writeContext);
    this.#documentSession.setPersistence({ state: "queued", error: "" });
    this.#scheduleAutosave({ immediate: isNativeEditCheckpoint(mutation) });
    this.#emit({
      type: "document-edit-queued",
      context: writeContext,
      revision: nextRevision,
    });
    return succeeded({ revision: nextRevision, queued: true });
  }

  async flush({ throughRevision } = {}) {
    const disposedPlan = planDocumentSave({ disposed: this.#disposed });
    if (disposedPlan.kind === "reject") {
      return blocked(disposedPlan.code, disposedPlan.reason);
    }
    this.#clearAutosaveTimer();
    const cutoff = throughRevision === undefined ? undefined : revision(throughRevision);
    const currentPromise = this.#documentSession.flushPromise;
    if (planDocumentSave({ flushInFlight: Boolean(currentPromise) }).kind === "wait") {
      const outcome = await currentPromise;
      if (!outcome || outcome.status !== "succeeded") return outcome || blocked(
        "DOCUMENT_FLUSH_UNKNOWN",
        "当前文档写入没有返回可验证结果。",
      );
      if (
        cutoff === undefined
          ? !this.#documentSession.pendingWrite
            && this.#documentSession.editRevision <= this.#documentSession.lastPersistedRevision
          : this.#documentSession.lastPersistedRevision >= cutoff
      ) return outcome;
      // A new checkpoint can arrive after the write loop has finished, while
      // its recovery journal is retiring. Re-enter single-flight admission so
      // every waiter joins the new drain instead of losing that queued edit.
      this.#documentSession.clearFlushPromise(currentPromise);
      return this.flush({ throughRevision: cutoff });
    }

    this.#reconstructPendingWrite();
    const savePlan = planDocumentSave({
      disposed: this.#disposed,
      pendingWrite: this.#documentSession.pendingWrite,
      editRevision: this.#documentSession.editRevision,
      lastPersistedRevision: this.#documentSession.lastPersistedRevision,
    });
    if (savePlan.kind === "reject") {
      return blocked(savePlan.code, savePlan.reason);
    }
    if (savePlan.action === "idle") {
      return succeeded({ revision: savePlan.revision, idle: true });
    }

    const promise = this.#runFlush(cutoff);
    this.#documentSession.setFlushPromise(promise);
    try {
      return await promise;
    } finally {
      this.#documentSession.clearFlushPromise(promise);
    }
  }

  performHistoryAction({ direction, context } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "DOCUMENT_WORKFLOW_DISPOSED",
        "文档持久化工作流已经停止。",
      ));
    }
    if (direction !== "undo" && direction !== "redo") {
      return Promise.resolve(rejected(
        "SOURCE_HISTORY_DIRECTION_INVALID",
        "只能撤销或重做源码历史。",
      ));
    }
    const requestedContext = copyContext(context) || this.#projectSession.context;
    if (!requestedContext || !this.#isCurrent(requestedContext)) {
      return Promise.resolve(requestedContext ? stale(requestedContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。",
      ));
    }
    const previous = this.#historyActionPromise;
    const operation = previous ? previous.then((outcome) => {
      if (this.#disposed || outcome.status !== "succeeded") {
        return blocked("SOURCE_HISTORY_PREVIOUS_ACTION_FAILED", "上一条历史操作未完成，请重试。");
      }
      const current = copyContext(this.#projectSession.context);
      const document = this.#documentSession.snapshot;
      // Each shortcut is a distinct intent. Only the preceding operation's
      // verified receipt may advance its queued successor to a new source Hash;
      // a member switch or an independent edit cannot rebind that request.
      if (!sameOpenRoute(requestedContext, current, this.#codecs.sameSourcePath)
        || outcome.value?.sourceSha256 !== document.workingHtmlSha256
        || outcome.value?.sourceSha256 !== document.persistedSourceSha256
        || (current.sourceSha256 && current.sourceSha256 !== outcome.value?.sourceSha256)
        || outcome.value?.persistedRevision !== document.editRevision
        || document.editRevision !== document.lastPersistedRevision
        || document.hasPendingWrite) return stale(requestedContext);
      return this.#runHistoryAction({ direction, context: current });
    }) : this.#runHistoryAction({ direction, context: requestedContext });
    this.#historyActionPromise = operation;
    operation.finally(() => {
      if (this.#historyActionPromise === operation) {
        this.#historyActionPromise = null;
      }
    });
    return operation;
  }

  async reloadAuthority({
    context,
    acceptExternalConflict = false,
    externalAuthorityAccepted = false,
  } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    const previousDocument = this.#documentSession.snapshot;
    const previousPendingWrite = this.#documentSession.pendingWrite;
    const previousVersionView = this.#versionSession.captureView();
    let externalAccepted = Boolean(externalAuthorityAccepted);
    try {
      if (acceptExternalConflict && !externalAccepted) {
        await this.#bridgeClient.resolveConflict({
          ...activeContext,
          action: "force-unlock",
        });
        externalAccepted = true;
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
      }
      const payload = await this.#bridgeClient.source(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#assertSourcePayload(payload, activeContext, "重新读取时文件身份发生变化，已拒绝覆盖当前项目。");
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "重新读取的源 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      this.#documentSession.publishAuthority({
        html,
        persistedSourceSha256: sourceSha256,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
      });
      this.#versionSession.returnCurrent({
        currentExactVersionId: payload.currentExactVersionId || null,
        currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
        restoredFromVersionId: payload.restoredFromVersionId || null,
      });
      this.#canvasPort.invalidateRenderAcks();
      await this.#acknowledgeCanvas(html, sourceSha256, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#auditPending = [];
      this.#auditInFlight.clear();
      this.#commentSession.setChangeEvents([]);
      this.#persistRecovery(null, activeContext);
      this.#emit({
        type: "document-authority-reloaded",
        context: activeContext,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
    } catch (cause) {
      if (this.#isCurrent(activeContext) && !externalAccepted) {
        this.#documentSession.publishAuthority({
          html: previousDocument.html,
          persistedSourceSha256: previousDocument.persistedSourceSha256,
          workingHtmlSha256: previousDocument.workingHtmlSha256,
          pendingWrite: previousPendingWrite,
          persistState: previousDocument.persistState,
          persistError: previousDocument.persistError,
        });
        this.#versionSession.restoreView(previousVersionView);
        this.#canvasPort.invalidateRenderAcks();
        await this.#acknowledgeCanvas(
          previousDocument.html,
          previousDocument.workingHtmlSha256
            || previousDocument.persistedSourceSha256
            || await this.#hashPort.sha256(previousDocument.html),
          activeContext,
        );
      }
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = this.#codecs.errorMessage(cause, "请稍后重试，源文件没有被覆盖。");
      this.#emit({
        type: "document-authority-reload-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "SOURCE_RELOAD_REJECTED"),
        message,
        externalAccepted,
        fatal: false,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("reload"),
        cause,
        "SOURCE_RELOAD_REJECTED",
        message,
      );
    }
  }

  async previewExternalSource({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    if (typeof this.#bridgeClient.sourcePreview !== "function") {
      return blocked("SOURCE_PREVIEW_UNAVAILABLE", "当前运行时无法预览磁盘源文件。");
    }
    try {
      const payload = await this.#bridgeClient.sourcePreview(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "磁盘预览 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
        size: Number(payload.size || 0),
      });
    } catch (cause) {
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = this.#codecs.errorMessage(cause, "暂时无法预览磁盘上的源文件。");
      this.#emit({
        type: "document-external-source-preview-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "SOURCE_PREVIEW_REJECTED"),
        message,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("preview"),
        cause,
        "SOURCE_PREVIEW_REJECTED",
        message,
      );
    }
  }

  async forceUnlockConflict({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    const previousDocument = this.#documentSession.snapshot;
    const previousPendingWrite = this.#documentSession.pendingWrite;
    const previousVersionView = this.#versionSession.captureView();
    try {
      await this.#bridgeClient.resolveConflict({
        ...activeContext,
        action: "force-unlock",
      });
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const payload = await this.#bridgeClient.source(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#assertSourcePayload(payload, activeContext, "强制解锁后文件身份发生变化，已拒绝覆盖当前项目。");
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "强制解锁后读取的源 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      const editRevision = this.#documentSession.editRevision;
      this.#documentSession.publishAuthority({
        html,
        persistedSourceSha256: sourceSha256,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
        lastPersistedRevision: editRevision,
      });
      this.#versionSession.returnCurrent({
        currentExactVersionId: payload.currentExactVersionId || null,
        currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
        restoredFromVersionId: payload.restoredFromVersionId || null,
      });
      this.#canvasPort.invalidateRenderAcks();
      await this.#acknowledgeCanvas(html, sourceSha256, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#auditPending = [];
      this.#auditInFlight.clear();
      this.#commentSession.setChangeEvents([]);
      this.#persistRecovery(null, activeContext);
      this.#emit({
        type: "document-conflict-force-unlocked",
        context: activeContext,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
    } catch (cause) {
      if (this.#isCurrent(activeContext)) {
        this.#documentSession.publishAuthority({
          html: previousDocument.html,
          persistedSourceSha256: previousDocument.persistedSourceSha256,
          workingHtmlSha256: previousDocument.workingHtmlSha256,
          pendingWrite: previousPendingWrite,
          persistState: previousDocument.persistState,
          persistError: previousDocument.persistError,
        });
        this.#versionSession.restoreView(previousVersionView);
        this.#canvasPort.invalidateRenderAcks();
      }
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = this.#codecs.errorMessage(cause, "强制解锁没有完成，项目仍保持冲突状态。");
      this.#emit({
        type: "document-conflict-force-unlock-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "DOCUMENT_FORCE_UNLOCK_REJECTED"),
        message,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("unlock"),
        cause,
        "DOCUMENT_FORCE_UNLOCK_REJECTED",
        message,
      );
    }
  }

  async ensureCurrentCanvas({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    let expectedHtml = this.#documentSession.html;
    const clean = Boolean(
      activeContext
      && this.#documentSession.persistState === "idle"
      && this.#documentSession.editRevision === this.#documentSession.lastPersistedRevision
      && !this.#documentSession.pendingWrite
      && !this.#documentSession.flushPromise,
    );
    const canvasAuthority = this.#documentSession.canvasAuthority;
    if (
      clean
      && this.#documentSession.persistedSourceSha256
      && this.#documentSession.workingHtmlSha256
      && canvasAuthority.status === "verified"
      && canvasAuthority.generation === this.#documentSession.canvasGeneration
      && canvasAuthority.renderedSha256 === this.#documentSession.workingHtmlSha256
      && this.#documentSession.workingHtmlSha256
        === this.#documentSession.persistedSourceSha256
    ) {
      return succeeded({
        html: expectedHtml,
        persistedSourceSha256: this.#documentSession.persistedSourceSha256,
        workingHtmlSha256: this.#documentSession.workingHtmlSha256,
        canvasRenderedSha256: canvasAuthority.renderedSha256,
        reusedCanvasAuthority: true,
      });
    }
    let expectedSha256 = await this.#hashPort.sha256(expectedHtml);
    try {
      if (
        activeContext
        && clean
        && this.#documentSession.persistedSourceSha256
        && this.#documentSession.persistedSourceSha256 !== expectedSha256
      ) {
        const payload = await this.#bridgeClient.source(activeContext.sourcePath);
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
        this.#assertSourcePayload(payload, activeContext, "自动恢复时源文件身份发生变化。");
        const repairedHtml = String(payload.content || "");
        const repairedSha256 = String(payload.sha256 || "");
        if (
          !SHA256.test(repairedSha256)
          || await this.#hashPort.sha256(repairedHtml) !== repairedSha256
        ) {
          throw invalidAcknowledgement(
            "自动恢复读取到的源 HTML 与 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
        this.#documentSession.publishAuthority({
          html: repairedHtml,
          persistedSourceSha256: repairedSha256,
          pendingWrite: null,
          persistState: "idle",
          persistError: "",
        });
        this.#versionSession.updateAuthority({
          currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
          currentExactVersionId: payload.currentExactVersionId || null,
          restoredFromVersionId: payload.restoredFromVersionId || null,
        });
        this.#canvasPort.invalidateRenderAcks();
        expectedHtml = repairedHtml;
        expectedSha256 = repairedSha256;
        this.#emit({
          type: "document-authority-repaired",
          context: activeContext,
          lastModifiedAt: String(payload.lastModifiedAt || ""),
        });
      }
      await this.#verifyRendered(expectedHtml, expectedSha256, activeContext || undefined);
      if (!this.#documentSession.confirmWorkingHtml({
        revision: this.#documentSession.editRevision,
        htmlSha256: expectedSha256,
      })) {
        throw Object.assign(new Error("当前工作 HTML 已变化，未接受过期画布回执。"), {
          code: "DOCUMENT_WORKING_HTML_STALE",
        });
      }
      const confirmed = this.#documentSession.confirmCanvas({
        generation: this.#documentSession.canvasGeneration,
        renderedSha256: expectedSha256,
        workingHtmlSha256: expectedSha256,
      });
      if (!confirmed) {
        throw Object.assign(new Error("当前画布尚未完成自动恢复。"), {
          code: "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
        });
      }
      return succeeded({
        html: expectedHtml,
        persistedSourceSha256: this.#documentSession.persistedSourceSha256,
        workingHtmlSha256: expectedSha256,
        canvasRenderedSha256: expectedSha256,
      });
    } catch (cause) {
      if (activeContext && !this.#isCurrent(activeContext)) return stale(activeContext);
      this.#documentSession.failCanvas({
        generation: this.#documentSession.canvasGeneration,
        error: this.#codecs.errorMessage(cause, "当前画布尚未完成自动恢复。"),
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("canvas"),
        cause,
        "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
        this.#codecs.errorMessage(cause, "当前画布尚未完成自动恢复。"),
      );
    }
  }

  async observeExternalSourceChange({ sourcePath } = {}) {
    if (this.#disposed) {
      return blocked("DOCUMENT_WORKFLOW_DISPOSED", "文档持久化工作流已经停止。");
    }
    const liveContext = copyContext(this.#projectSession.context);
    if (!liveContext?.sourcePath) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (
      sourcePath
      && !this.#codecs.sameSourcePath(sourcePath, liveContext.sourcePath)
    ) {
      return succeeded({ ignored: true, reason: "stale-path" });
    }
    if (this.#documentSession.persistState === "conflict") {
      return succeeded({ alreadyConflict: true });
    }
    if (
      this.#documentSession.persistState === "writing"
      || this.#documentSession.persistState === "queued"
      || this.#documentSession.pendingWrite
      || this.#documentSession.flushPromise
      || this.hasHistoryAction
    ) {
      return succeeded({ deferred: true });
    }
    try {
      let diskSha256 = "";
      let lastModifiedAt = "";
      let size = 0;
      if (typeof this.#bridgeClient.sourceStat === "function") {
        const stat = await this.#bridgeClient.sourceStat(liveContext.sourcePath);
        diskSha256 = String(stat.sha256 || "");
        lastModifiedAt = String(stat.lastModifiedAt || "");
        size = Number(stat.size || 0);
        if (!SHA256.test(diskSha256)) {
          throw invalidAcknowledgement(
            "外部源 HTML 与声明 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
      } else {
        const payload = await this.#bridgeClient.source(liveContext.sourcePath);
        this.#assertSourcePayload(
          payload,
          liveContext,
          "核对外部源文件时文件身份发生变化，已拒绝覆盖当前项目。",
        );
        diskSha256 = String(payload.sha256 || "");
        lastModifiedAt = String(payload.lastModifiedAt || "");
        if (
          !SHA256.test(diskSha256)
          || await this.#hashPort.sha256(String(payload.content || "")) !== diskSha256
        ) {
          throw invalidAcknowledgement(
            "外部源 HTML 与声明 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
      }
      const current = copyContext(this.#projectSession.context);
      if (
        !current
        || !this.#codecs.sameSourcePath(current.sourcePath, liveContext.sourcePath)
      ) {
        return stale(liveContext);
      }
      if (diskSha256 === this.#documentSession.persistedSourceSha256) {
        if (lastModifiedAt) {
          this.#emit({
            type: "document-boundary-reconciled",
            sourcePath: current.sourcePath,
            lastModifiedAt,
          });
        }
        return succeeded({
          unchanged: true,
          changed: false,
          sourceSha256: diskSha256,
          sha256: diskSha256,
          lastModifiedAt,
        });
      }
      const message = "源文件在磁盘上被其他程序修改了。您的编辑内容仍在，可先预览外部版本再决定。";
      this.#documentSession.setPersistence({
        state: "conflict",
        error: message,
      });
      this.#emit({
        type: "document-external-source-changed",
        context: current,
        sha256: diskSha256,
        lastModifiedAt,
        size,
      });
      return succeeded({
        conflict: true,
        changed: true,
        sourceSha256: diskSha256,
        sha256: diskSha256,
        lastModifiedAt,
      });
    } catch (cause) {
      const current = copyContext(this.#projectSession.context);
      if (
        current
        && sourcePath
        && !this.#codecs.sameSourcePath(sourcePath, current.sourcePath)
      ) {
        return stale(liveContext);
      }
      const code = sourceErrorCode(cause, "WORKING_COPY_UNAVAILABLE");
      const message = this.#codecs.errorMessage(
        cause,
        "当前工作文件暂时不可用，修改仍保留。",
      );
      if (current && this.#isCurrent(current)) {
        this.#emit({
          type: "document-persistence-failed",
          context: current,
          code,
          message,
          conflict: false,
          protocolError: false,
          recoveryWrite: this.#documentSession.pendingWrite,
          fatal: false,
        });
      }
      return this.#outcomeFromCause(
        this.#nextOperationId("source-observe"),
        cause,
        code,
        message,
      );
    }
  }

  async reconcileBoundary({
    frozenHtml,
    reportedSourceSha256 = null,
    cutoffRevision,
    identity,
    timeoutMs = 2_500,
  } = {}) {
    const boundaryIdentity = identity || this.#projectSession.snapshot;
    const sourcePath = String(boundaryIdentity?.sourcePath || "");
    if (!sourcePath) {
      return blocked("DOCUMENT_BOUNDARY_SOURCE_REQUIRED", "当前页面没有可核对的源文件。");
    }
    try {
      const result = await this.#documentSession.reconcilePersistedBoundary({
        frozenHtml: String(frozenHtml || ""),
        reportedSourceSha256,
        cutoffRevision,
        hashHtml: (html) => this.#hashPort.sha256(html),
        readSource: () => this.#bridgeClient.source(sourcePath, { timeoutMs }),
        isCurrent: () => {
          const current = this.#projectSession.snapshot;
          return Number(current.epoch) === Number(boundaryIdentity.epoch)
            && this.#codecs.sameSourcePath(current.sourcePath, boundaryIdentity.sourcePath)
            && String(current.projectId || "") === String(boundaryIdentity.projectId || "")
            && String(current.documentId || "") === String(boundaryIdentity.documentId || "")
            && Boolean(current.registered) === Boolean(boundaryIdentity.registered);
        },
        acceptsSource: (source) => Boolean(
          this.#codecs.sameSourcePath(
            String(source?.sourcePath || ""),
            boundaryIdentity.sourcePath,
          )
          && Boolean(source?.registered) === Boolean(boundaryIdentity.registered)
          && (
            !boundaryIdentity.registered
              ? !String(source?.projectId || "") && !String(source?.documentId || "")
              : String(source?.projectId || "") === String(boundaryIdentity.projectId || "")
                && String(source?.documentId || "") === String(boundaryIdentity.documentId || "")
          )
        ),
      });
      if (result.ready && result.lastModifiedAt) {
        this.#emit({
          type: "document-boundary-reconciled",
          sourcePath,
          lastModifiedAt: result.lastModifiedAt,
        });
      }
      return result.ready ? succeeded(result) : blocked(result.code, result.reason);
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("boundary"),
        cause,
        "DOCUMENT_BOUNDARY_REJECTED",
        this.#codecs.errorMessage(cause, "关闭前安全写入检查失败。"),
      );
    }
  }

  async recoverAutosave({ context, currentSourceSha256, serverRevision = 0 } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    let journalRaw = null;
    if (this.#recoveryJournal && activeContext.projectId && activeContext.documentId) {
      try {
        let journal = await this.#recoveryJournal.readVerified({
          projectId: activeContext.projectId,
          documentId: activeContext.documentId,
        });
        if (journal) {
          if (
            sameRecoveryDocument(journal, activeContext)
            && !this.#codecs.sameSourcePath(journal.sourcePath, activeContext.sourcePath)
            && typeof this.#recoveryJournal.rebase === "function"
          ) {
            journal = await this.#recoveryJournal.rebase({
              projectId: journal.projectId,
              documentId: journal.documentId,
              previousSourcePath: journal.sourcePath,
              sourcePath: activeContext.sourcePath,
              workingCopyId: String(journal.workingCopyId || ""),
              revision: revision(journal.revision),
              recoveryHtmlSha256: journal.recoveryHtmlSha256,
              expectedJournalSha256: journal.journalSha256,
            });
            journal = await this.#recoveryJournal.readVerified({
              projectId: activeContext.projectId,
              documentId: activeContext.documentId,
              expectedJournalSha256: journal.journalSha256,
            });
          }
          journalRaw = journal;
          this.#recoveryJournalReceipt = this.#checkpointFromJournal(journal, activeContext);
        }
      } catch (cause) {
        this.#emit({
          type: "document-recovery-checkpoint-failed",
          context: activeContext,
          reason: this.#codecs.errorMessage(cause, "恢复日志无法读取。"),
        });
      }
    }
    const raw = journalRaw
      && String(journalRaw.projectId || "") === activeContext.projectId
      && String(journalRaw.documentId || "") === activeContext.documentId
      && (
        !String(journalRaw.workingCopyId || "")
        || !String(activeContext.workingCopyId || "")
        || String(journalRaw.workingCopyId) === String(activeContext.workingCopyId)
      )
      && typeof journalRaw.html === "string"
      && /<html(?:\s|>)/iu.test(journalRaw.html)
      ? journalRaw
      : null;
    if (!raw) return succeeded({ recovered: false });
    this.#recoveryCheckpoint = this.#recoveryJournalReceipt;

    try {
      const recoveredHtml = raw.html;
      const targetSha256 = await this.#hashPort.sha256(recoveredHtml);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      if (targetSha256 === currentSourceSha256) {
        const reconciledRevision = Math.max(serverRevision, revision(raw.revision));
        this.#documentSession.update({
          editRevision: reconciledRevision,
          lastPersistedRevision: reconciledRevision,
          pendingWrite: null,
          persistState: "idle",
          persistError: "",
        });
        this.#scheduleRecoveryJournal(null, activeContext);
        return succeeded({ recovered: false, reconciled: true });
      }

      const nextRevision = Math.max(serverRevision, revision(raw.revision)) + 1;
      const recoveredEvents = this.#codecs.changesFromRecords(raw.changeEvents);
      const existingIds = new Set(
        this.#commentSession.changeEvents.map((event) => event.eventId),
      );
      const mergedEvents = [
        ...this.#commentSession.changeEvents,
        ...recoveredEvents.filter((event) => !existingIds.has(event.eventId)),
      ];
      const storedIdentity = this.#codecs.recoveryIdentityFromRecord(raw.recoveryIdentity);
      const canRebaseSafely = Boolean(
        (
          identityMatches(storedIdentity, this.#recoveryIdentity, this.#codecs.sameSourcePath)
          || sameRecoveryDocument(raw, activeContext)
        )
        && String(raw.expectedSourceSha256 || "") === String(currentSourceSha256 || ""),
      );
      const write = {
        ...activeContext,
        expectedSourceSha256: canRebaseSafely
          ? currentSourceSha256
          : String(raw.expectedSourceSha256 || currentSourceSha256 || ""),
        html: recoveredHtml,
        revision: nextRevision,
        events: recoveredEvents,
        historyOperations: this.#codecs.sourceHistoryOperationsFromRecord(
          raw.sourceHistoryOperations,
        ),
        recoveryIdentity: this.#recoveryIdentity,
      };
      // Crash recovery keeps exact save evidence only. Undo/Redo history is
      // intentionally empty after a process restart.
      this.#sourceHistorySession.restorePendingEvidence(
        activeContext,
        write.historyOperations,
      );
      this.#auditPending = recoveredEvents;
      this.#commentSession.setChangeEvents(mergedEvents);
      this.#documentSession.publishAuthority({
        html: recoveredHtml,
        persistedSourceSha256: currentSourceSha256,
        workingHtmlSha256: targetSha256,
        editRevision: nextRevision,
        pendingWrite: write,
      });
      this.#versionSession.markSourceEdited();
      this.#canvasPort.invalidateRenderAcks();
      this.#persistRecovery(write, activeContext);

      if (canRebaseSafely) {
        this.#documentSession.setPersistence({ state: "queued", error: "" });
        this.#clearAutosaveTimer();
        this.#autosaveTimer = this.#scheduler.setTimeout(() => {
          void this.flush();
        }, 0);
        this.#emit({ type: "document-recovery-queued", context: activeContext });
        return succeeded({ recovered: true, queued: true });
      }
      await this.#acknowledgeCanvas(recoveredHtml, targetSha256, activeContext);
      await this.#freezeAuthority("恢复记录已加载，当前投影只读。");
      this.#documentSession.setPersistence({
        state: "conflict",
        error: "恢复记录与当前项目、版本或源文件身份不一致，请比较后选择重新载入或导出当前 HTML。",
      });
      return succeeded({ recovered: true, queued: false, conflict: true });
    } catch (cause) {
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      return this.#outcomeFromCause(
        this.#nextOperationId("recovery"),
        cause,
        "DOCUMENT_RECOVERY_REJECTED",
        this.#codecs.errorMessage(cause, "恢复记录无法安全加载。"),
      );
    }
  }

  adoptConflictCandidate({
    context,
    html,
    authoritativeSourceSha256,
    expectedSourceSha256,
    revision: candidateRevision,
    events = [],
  } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    const write = {
      ...activeContext,
      expectedSourceSha256: String(expectedSourceSha256 || ""),
      html: String(html || ""),
      revision: Math.max(this.#documentSession.editRevision, revision(candidateRevision)),
      events: Array.isArray(events) ? [...events] : [],
      historyOperations: [],
      recoveryIdentity: this.#recoveryIdentity,
    };
    this.#auditPending = [...write.events];
    this.#documentSession.publishAuthority({
      html: write.html,
      persistedSourceSha256: authoritativeSourceSha256 || null,
      workingHtmlSha256: null,
      editRevision: write.revision,
      pendingWrite: write,
    });
    this.#versionSession.markSourceEdited();
    this.#canvasPort.invalidateRenderAcks();
    this.#persistRecovery(write, activeContext);
    return succeeded({ write });
  }

  #writeContext(context) {
    const explicit = copyContext(context);
    if (explicit) return explicit;
    const active = copyContext(this.#projectSession.context);
    if (active) return active;
    return Object.freeze({
      epoch: this.#projectSession.epoch,
      projectId: this.#projectSession.projectId,
      documentId: this.#projectSession.documentId,
      sourcePath: String(this.#projectSession.sourcePath || ""),
    });
  }

  #isCurrent(context) {
    return Boolean(verifyProjectContext(context, this.#projectSession, {
      disposed: this.#disposed,
      sameSourcePath: this.#codecs.sameSourcePath,
    }));
  }

  #nextOperationId(kind) {
    this.#operationSequence += 1;
    return [
      String(kind),
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #emit(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#listeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation observers cannot affect document authority.
      }
    }
  }

  #clearAutosaveTimer() {
    if (this.#autosaveTimer !== null) {
      this.#scheduler.clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
  }

  #scheduleAutosave({ immediate = false } = {}) {
    this.#clearAutosaveTimer();
    if (immediate) {
      void this.flush();
      return;
    }
    this.#autosaveTimer = this.#scheduler.setTimeout(() => {
      this.#autosaveTimer = null;
      void this.flush();
    }, AUTOSAVE_DELAY_MS);
  }

  #createWrite(context, html, nextRevision) {
    return {
      ...context,
      expectedSourceSha256: this.#documentSession.persistedSourceSha256,
      html: String(html),
      revision: revision(nextRevision),
      events: [...this.#auditPending],
      historyOperations: this.#sourceHistorySession.pendingOperations,
      recoveryIdentity: this.#recoveryIdentity,
    };
  }

  #reconstructPendingWrite() {
    if (
      this.#documentSession.pendingWrite
      || !this.#projectSession.sourcePath
      || this.#documentSession.editRevision <= this.#documentSession.lastPersistedRevision
    ) return;
    const write = this.#createWrite(
      this.#writeContext(),
      this.#documentSession.html,
      this.#documentSession.editRevision,
    );
    this.#documentSession.setPendingWrite(write);
    this.#persistRecovery(write, write);
    this.#documentSession.setPersistence({ state: "queued", error: "" });
  }

  #persistRecovery(write, context) {
    this.#scheduleRecoveryJournal(write, context);
  }

  #checkpointFromJournal(journal, context) {
    if (
      !journal
      || String(journal.projectId || "") !== String(context?.projectId || "")
      || String(journal.documentId || "") !== String(context?.documentId || "")
      || (
        String(journal.workingCopyId || "")
        && String(context?.workingCopyId || "")
        && String(journal.workingCopyId) !== String(context.workingCopyId)
      )
      || !this.#codecs.sameSourcePath(journal.sourcePath, context?.sourcePath)
      || !SHA256.test(String(journal.recoveryHtmlSha256 || ""))
      || !SHA256.test(String(journal.journalSha256 || ""))
    ) return null;
    return Object.freeze({
      ...copyContext(context),
      sourcePath: String(journal.sourcePath),
      workingCopyId: String(journal.workingCopyId || context?.workingCopyId || ""),
      revision: revision(journal.revision),
      recoveryHtmlSha256: String(journal.recoveryHtmlSha256),
      journalSha256: String(journal.journalSha256),
      updatedAt: String(journal.updatedAt || ""),
    });
  }

  #scheduleRecoveryJournal(write, context) {
    if (!this.#recoveryJournal) return null;
    const activeContext = copyContext(write || context);
    if (!activeContext?.projectId || !activeContext?.documentId || !activeContext?.sourcePath) {
      return null;
    }
    this.#recoveryJournalGeneration += 1;
    const generation = this.#recoveryJournalGeneration;
    const operation = async () => {
      if (!write) {
        const receipt = this.#recoveryJournalReceipt;
        if (!receipt || !sameContext(receipt, activeContext, this.#codecs.sameSourcePath)) {
          if (
            generation === this.#recoveryJournalGeneration
            && this.#recoveryCheckpoint
            && sameRecoveryDocument(this.#recoveryCheckpoint, activeContext)
          ) {
            this.#recoveryCheckpoint = null;
          }
          return null;
        }
        await this.#recoveryJournal.remove({
          projectId: activeContext.projectId,
          documentId: activeContext.documentId,
          sourcePath: receipt.sourcePath,
          workingCopyId: String(receipt.workingCopyId || ""),
          revision: receipt.revision,
          recoveryHtmlSha256: receipt.recoveryHtmlSha256,
          expectedJournalSha256: receipt.journalSha256,
        });
        if (this.#recoveryJournalReceipt?.journalSha256 === receipt.journalSha256) {
          this.#recoveryJournalReceipt = null;
        }
        if (generation === this.#recoveryJournalGeneration) {
          this.#recoveryCheckpoint = null;
        }
        return null;
      }
      const journal = await this.#recoveryJournal.commit({
        projectId: activeContext.projectId,
        documentId: activeContext.documentId,
        sourcePath: activeContext.sourcePath,
        workingCopyId: String(write.workingCopyId || activeContext.workingCopyId || ""),
        expectedSourceSha256: String(write.expectedSourceSha256 || "") || null,
        revision: revision(write.revision),
        html: String(write.html || ""),
        ...(this.#recoveryJournalReceipt
          && sameContext(
            this.#recoveryJournalReceipt,
            activeContext,
            this.#codecs.sameSourcePath,
          ) ? {
            expectedJournalSha256: this.#recoveryJournalReceipt.journalSha256,
          } : {}),
      });
      const checkpoint = this.#checkpointFromJournal(journal, activeContext);
      const expectedHtmlSha256 = await this.#hashPort.sha256(String(write.html || ""));
      if (
        !checkpoint
        || checkpoint.recoveryHtmlSha256 !== expectedHtmlSha256
        || checkpoint.revision !== revision(write.revision)
      ) {
        throw invalidAcknowledgement(
          "恢复日志写入后的读回校验失败。",
          "DOCUMENT_RECOVERY_CHECKPOINT_INVALID",
        );
      }
      if (!this.#documentSession.confirmWorkingHtml({
        revision: write.revision,
        htmlSha256: expectedHtmlSha256,
      })) {
        throw invalidAcknowledgement(
          "恢复日志已写入，但当前工作 HTML 已变化。",
          "DOCUMENT_RECOVERY_CHECKPOINT_STALE",
        );
      }
      this.#recoveryJournalReceipt = checkpoint;
      if (generation === this.#recoveryJournalGeneration) {
        this.#recoveryCheckpoint = checkpoint;
        this.#emit({
          type: "document-recovery-checkpoint-verified",
          context: activeContext,
          revision: checkpoint.revision,
          recoveryHtmlSha256: checkpoint.recoveryHtmlSha256,
        });
      }
      return checkpoint;
    };
    let resolveQueued;
    let rejectQueued;
    const queued = new Promise((resolve, reject) => {
      resolveQueued = resolve;
      rejectQueued = reject;
    });
    const priorWaiters = this.#recoveryJournalPending?.waiters || [];
    this.#recoveryJournalPending = {
      operation,
      waiters: [...priorWaiters, { resolve: resolveQueued, reject: rejectQueued }],
    };
    this.#runNextRecoveryJournal();
    queued.catch((cause) => {
      if (generation !== this.#recoveryJournalGeneration) return;
      this.#recoveryCheckpoint = null;
      this.#emit({
        type: "document-recovery-checkpoint-failed",
        context: activeContext,
        reason: this.#codecs.errorMessage(cause, "恢复副本没有安全完成。"),
      });
    });
    return queued;
  }

  #runNextRecoveryJournal() {
    if (this.#recoveryJournalInFlight || !this.#recoveryJournalPending) return;
    const task = this.#recoveryJournalPending;
    this.#recoveryJournalPending = null;
    const inFlight = Promise.resolve().then(task.operation);
    this.#recoveryJournalInFlight = inFlight;
    inFlight.then(
      (value) => {
        for (const waiter of task.waiters) waiter.resolve(value);
      },
      (cause) => {
        for (const waiter of task.waiters) waiter.reject(cause);
      },
    ).finally(() => {
      if (this.#recoveryJournalInFlight === inFlight) {
        this.#recoveryJournalInFlight = null;
      }
      this.#runNextRecoveryJournal();
    });
  }

  async #commitRecoveryJournal(write, context) {
    const queued = this.#scheduleRecoveryJournal(write, context);
    if (!queued) {
      throw invalidAcknowledgement(
        "当前内容无法写入恢复日志。",
        "DOCUMENT_RECOVERY_JOURNAL_UNAVAILABLE",
      );
    }
    return queued;
  }

  async #runFlush(cutoff) {
    let latestAcknowledgedContext = null;
    while (this.#documentSession.pendingWrite) {
      const pendingWrite = this.#documentSession.takePendingWrite();
      if (!pendingWrite) break;
      let write = pendingWrite;
      if (!write.sourcePath) {
        this.#documentSession.setPendingWrite(write);
        return blocked("DOCUMENT_SOURCE_UNBOUND", "当前编辑尚未绑定本地 HTML，无法写回源文件。");
      }
      const operationId = this.#nextOperationId("autosave");
      const inFlightKeys = write.events.map(this.#codecs.auditEventKey);
      for (const key of inFlightKeys) this.#auditInFlight.add(key);
      let writeContext = copyContext(write);
      try {
        if (this.#isCurrent(writeContext)) {
          this.#documentSession.setPersistence({ state: "writing", error: "" });
        }
        if (!write.projectId || !write.documentId) {
          const registration = await this.#ensureRegistered({
            sourcePath: write.sourcePath,
            expectedSourceSha256: write.expectedSourceSha256,
            adoptCanonicalSource: false,
          });
          if (!registration || registration.status !== "succeeded") {
            return this.#settleRegistrationFailure({
              registration,
              write,
              writeContext,
            });
          }
          write = {
            ...write,
            ...registration.value,
            expectedSourceSha256: this.#documentSession.persistedSourceSha256,
          };
          writeContext = registration.value;
          this.#updateQueuedWriteAfterRegistration(write);
          // Registration changes recovery identity before the durable write.
          // Persist that transition now so a crash in the subsequent POST has
          // a record the next registered workspace can safely resume.
          this.#persistRecovery(write, writeContext);
        }
        if (!this.#isCurrent(writeContext)) {
          this.#restoreWriteAfterFailure(write, writeContext);
          return stale(writeContext);
        }
        const payload = await this.#bridgeClient.autosave({
          projectId: write.projectId,
          documentId: write.documentId,
          sourcePath: write.sourcePath,
          html: write.html,
          expectedSourceSha256: write.expectedSourceSha256,
          editRevision: write.revision,
          changeEvents: write.events.map(this.#codecs.persistedChangeEvent),
          sourceHistoryOperations: write.historyOperations,
          projectRootPath: write.projectRootPath,
          targetKind: write.targetKind,
          workingCopyId: write.workingCopyId,
          versionId: write.versionId,
          exactSourcePath: write.exactSourcePath,
          sourceSha256: write.sourceSha256,
          sessionEpoch: write.sessionEpoch,
        });
        await this.#validateAutosaveAck(payload, write);
        const sourceSha256 = String(payload.sha256 || payload.currentHtmlSha256 || "");
        const persistedRevision = revision(payload.persistedRevision);
        if (!this.#acknowledgeSourceHistory({
          write,
          writeContext,
          sourceSha256,
        })) {
          // A durable ACK may arrive after the renderer has moved to another
          // document. Complete only the stale write's recovery cleanup; the
          // current SourceHistorySession is owned by the new document.
          this.#acknowledgeWrite({
            write,
            writeContext,
            payload,
            sourceSha256,
            persistedRevision,
          });
          return stale(writeContext);
        }
        const acknowledgedContext = this.#acknowledgeWrite({
          write,
          writeContext,
          payload,
          sourceSha256,
          persistedRevision,
        });
        if (!this.#isCurrent(acknowledgedContext)) return stale(acknowledgedContext);
        latestAcknowledgedContext = acknowledgedContext;
      } catch (cause) {
        return await this.#handleFlushFailure({
          cause,
          operationId,
          write,
          writeContext,
        });
      } finally {
        for (const key of inFlightKeys) this.#auditInFlight.delete(key);
      }
    }
    if (latestAcknowledgedContext && !this.#documentSession.pendingWrite) {
      const retirement = this.#scheduleRecoveryJournal(null, latestAcknowledgedContext);
      if (retirement) {
        await retirement.catch((cause) => {
          this.#emit({
            type: "document-recovery-retirement-failed",
            context: latestAcknowledgedContext,
            reason: this.#codecs.errorMessage(
              cause,
              "源 HTML 已写入，但恢复日志尚未退役。",
            ),
          });
        });
      }
    }
    if (
      cutoff !== undefined
      && this.#documentSession.lastPersistedRevision < cutoff
    ) {
      return blocked(
        "DOCUMENT_FLUSH_CUTOFF_UNREACHED",
        "当前编辑尚未安全写入源 HTML。",
      );
    }
    return succeeded({ revision: this.#documentSession.lastPersistedRevision });
  }

  #acknowledgeSourceHistory({ write, writeContext, sourceSha256 }) {
    if (!this.#isCurrent(writeContext)) return false;
    const acknowledgement = this.#sourceHistorySession.acknowledge(
      writeContext,
      write.historyOperations,
      sourceSha256,
    );
    if (
      acknowledgement.status === "invalid"
      && acknowledgement.reason !== "inactive-context"
      && this.#isCurrent(writeContext)
    ) {
      this.#sourceHistorySession.activate(
        writeContext,
        sourceSha256,
        null,
      );
    }
    return true;
  }

  async #validateAutosaveAck(payload, write) {
    if (!this.#codecs.isRecord(payload) || payload.ok === false) {
      throw invalidAcknowledgement("无法把修改更新到源 HTML。", "INVALID_AUTOSAVE_ACK");
    }
    const hasExactHtml = typeof payload.content === "string" && payload.content === write.html;
    const declaredHash = String(payload.sha256 || payload.currentHtmlSha256 || "");
    const persistedRevision = Number(payload.persistedRevision);
    const persistedAt = String(payload.lastModifiedAt || "");
    const actualHash = hasExactHtml
      ? await this.#hashPort.sha256(write.html)
      : "";
    if (
      !hasExactHtml
      || !SHA256.test(declaredHash)
      || actualHash !== declaredHash
      || !Number.isSafeInteger(persistedRevision)
      || persistedRevision < write.revision
      || !persistedAt
      || (payload.skipped === true && declaredHash !== actualHash)
    ) {
      throw invalidAcknowledgement(
        "自动写回的确认内容与本次提交的原始字节不一致。",
        "INVALID_AUTOSAVE_ACK",
      );
    }
  }

  #acknowledgeWrite({ write, writeContext, payload, sourceSha256, persistedRevision }) {
    const queued = this.#documentSession.pendingWrite;
    let nextWrite = null;
    if (queued && sameContext(queued, write, this.#codecs.sameSourcePath)) {
      nextWrite = {
        ...queued,
        expectedSourceSha256: sourceSha256,
        recoveryIdentity: this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity)
          || queued.recoveryIdentity,
        events: this.#codecs.removeAcknowledgedAuditEvents(queued.events, write.events),
        historyOperations: this.#sourceHistorySession.pendingOperations,
      };
    }
    if (!this.#isCurrent(writeContext)) {
      if (nextWrite) {
        this.#documentSession.setPendingWrite(nextWrite);
        this.#persistRecovery(nextWrite, writeContext);
      } else {
        this.#persistRecovery(null, writeContext);
      }
      return writeContext;
    }
    this.#recoveryIdentity = this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity)
      || this.#recoveryIdentity;
    const writeCompletesCurrentDocument = Boolean(
      this.#documentSession.editRevision === write.revision
      && !this.#documentSession.pendingWrite,
    );
    const acknowledgedHtml = String(payload.content);
    this.#documentSession.update(writeCompletesCurrentDocument
      ? {
          html: acknowledgedHtml,
          persistedSourceSha256: sourceSha256,
          workingHtmlSha256: sourceSha256,
          lastPersistedRevision: Math.max(
            this.#documentSession.lastPersistedRevision,
            persistedRevision,
          ),
        }
      : {
          persistedSourceSha256: sourceSha256,
          lastPersistedRevision: Math.max(
            this.#documentSession.lastPersistedRevision,
            persistedRevision,
          ),
        });
    if (writeCompletesCurrentDocument) {
      this.#rebindTargets(acknowledgedHtml);
      this.#versionSession.updateAuthority({
        currentExactVersionId: payload.currentExactVersionId,
      });
    }
    const rebound = this.#reconcileOpenTargetAfterAutosave({
      writeContext,
      payload,
      sourceSha256,
    });
    const acknowledgedContext = rebound.context;
    if (rebound.routingChanged) {
      const memoryHistory = this.#sourceHistorySession.snapshot;
      const pendingHistory = this.#sourceHistorySession.pendingOperations;
      this.#sourceHistorySession.activate(
        acknowledgedContext,
        sourceSha256,
        memoryHistory,
      );
      this.#sourceHistorySession.restorePendingEvidence(
        acknowledgedContext,
        pendingHistory,
      );
    }
    if (nextWrite && rebound.targetRefreshed) {
      nextWrite = {
        ...nextWrite,
        epoch: acknowledgedContext.epoch,
        projectId: acknowledgedContext.projectId,
        documentId: acknowledgedContext.documentId,
        sourcePath: acknowledgedContext.sourcePath,
        projectRootPath: acknowledgedContext.projectRootPath,
        targetKind: acknowledgedContext.targetKind,
        workingCopyId: acknowledgedContext.workingCopyId,
        versionId: acknowledgedContext.versionId,
        exactSourcePath: acknowledgedContext.exactSourcePath,
        sourceSha256: acknowledgedContext.sourceSha256,
        sessionEpoch: acknowledgedContext.sessionEpoch,
        expectedSourceSha256: sourceSha256,
        historyOperations: this.#sourceHistorySession.pendingOperations,
      };
    }
    if (nextWrite) {
      this.#documentSession.setPendingWrite(nextWrite);
      this.#persistRecovery(nextWrite, acknowledgedContext);
    } else {
      this.#persistRecovery(null, writeContext);
      if (rebound.routingChanged) this.#persistRecovery(null, acknowledgedContext);
    }
    this.#auditPending = this.#codecs.removeAcknowledgedAuditEvents(
      this.#auditPending,
      write.events,
    );
    if (!this.#documentSession.pendingWrite) {
      this.#documentSession.setPersistence({ state: "idle", error: "" });
    }
    if (rebound.routingChanged) {
      this.#emit({
        type: "document-open-target-rebound",
        context: acknowledgedContext,
        previousContext: writeContext,
        activeDraft: this.#codecs.isRecord(payload.activeDraft)
          ? payload.activeDraft
          : null,
      });
    }
    this.#emit({
      type: "document-persisted",
      context: acknowledgedContext,
      revision: persistedRevision,
      sourceSha256,
      lastModifiedAt: String(payload.lastModifiedAt || ""),
      lastSavedAt: String(payload.lastSavedAt || ""),
    });
    return acknowledgedContext;
  }

  #reconcileOpenTargetAfterAutosave({ writeContext, payload, sourceSha256 }) {
    const rawTarget = this.#codecs.isRecord(payload?.openTarget)
      ? payload.openTarget
      : null;
    if (!rawTarget) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    if (
      String(rawTarget.projectId || "") !== writeContext.projectId
      || String(rawTarget.documentId || "") !== writeContext.documentId
      || !String(rawTarget.projectRootPath || "")
      || !String(rawTarget.targetKind || "")
    ) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    const target = {
      ...rawTarget,
      projectId: writeContext.projectId,
      documentId: writeContext.documentId,
      exactSourcePath: String(
        rawTarget.exactSourcePath || payload.sourcePath || "",
      ),
      sourceSha256,
    };
    if (!target.exactSourcePath) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    const next = this.#codecs.sameSourcePath(
      target.exactSourcePath,
      writeContext.sourcePath,
    )
      ? this.#projectSession.refreshOpenTarget?.(target)
      : this.#projectSession.adoptOpenTarget({
          previousSourcePath: writeContext.sourcePath,
          target,
        });
    const context = copyContext(next);
    if (!context || !this.#isCurrent(context)) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    return {
      context,
      routingChanged: !sameOpenRoute(
        writeContext,
        context,
        this.#codecs.sameSourcePath,
      ),
      targetRefreshed: !sameOpenTarget(
        writeContext,
        context,
        this.#codecs.sameSourcePath,
      ),
    };
  }

  #updateQueuedWriteAfterRegistration(write) {
    const queued = this.#documentSession.pendingWrite;
    if (!queued || !this.#codecs.sameSourcePath(queued.sourcePath, write.sourcePath)) return;
    this.#documentSession.setPendingWrite({
      ...queued,
      projectId: write.projectId,
      documentId: write.documentId,
      projectRootPath: write.projectRootPath,
      targetKind: write.targetKind,
      workingCopyId: write.workingCopyId,
      versionId: write.versionId,
      exactSourcePath: write.exactSourcePath,
      sourceSha256: write.sourceSha256,
      sessionEpoch: write.sessionEpoch,
      expectedSourceSha256: write.expectedSourceSha256,
    });
  }

  #restoreWriteAfterFailure(write, context) {
    const pending = this.#documentSession.pendingWrite;
    const recoveryWrite = pending
      && sameContext(pending, write, this.#codecs.sameSourcePath)
      && pending.revision > write.revision
      ? pending
      : write;
    if (
      this.#isCurrent(context)
      && (!pending || pending.revision < recoveryWrite.revision)
    ) {
      this.#documentSession.setPendingWrite(recoveryWrite);
    }
    this.#persistRecovery(recoveryWrite, context);
    return recoveryWrite;
  }

  #settleRegistrationFailure({ registration, write, writeContext }) {
    const outcome = registration || blocked(
      "PROJECT_REGISTRATION_UNAVAILABLE",
      "项目资料暂时无法建立，修改已保留在恢复记录中。",
    );
    const message = String(
      outcome.reason || "项目资料暂时无法建立，修改已保留在恢复记录中。",
    );
    const code = outcome.status === "unknown"
      ? "PROJECT_REGISTRATION_UNKNOWN"
      : String(outcome.code || "PROJECT_REGISTRATION_UNAVAILABLE");
    const recoveryWrite = this.#restoreWriteAfterFailure(write, writeContext);
    if (outcome.status !== "stale" && this.#isCurrent(writeContext)) {
      this.#documentSession.setPersistence({ state: "failed", error: message });
      this.#emit({
        type: "document-persistence-failed",
        context: writeContext,
        code,
        message,
        conflict: false,
        protocolError: false,
        recoveryWrite,
        fatal: false,
      });
    }
    return outcome;
  }

  async #handleFlushFailure({ cause, operationId, write, writeContext }) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      const reconciliation = await this.#reconcileUnknownAutosave({
        write,
        writeContext,
      });
      if (reconciliation) return reconciliation;
    }
    const message = this.#codecs.errorMessage(
      cause,
      "当前修改还没有写入源 HTML，请重试或导出当前 HTML。",
    );
    const code = sourceErrorCode(cause, "DOCUMENT_AUTOSAVE_REJECTED");
    const conflict = (
      code === "SOURCE_CHANGED"
      || code === "SOURCE_HASH_CONFLICT"
      || code === "WORKING_COPY_CONFLICT"
      || String(cause?.message || "").includes("SOURCE_CHANGED")
    );
    const protocolError = code === "INVALID_AUTOSAVE_ACK" || cause?.code === "INVALID_AUTOSAVE_ACK";
    const recoveryWrite = this.#restoreWriteAfterFailure(write, writeContext);
    if (this.#isCurrent(writeContext)) {
      let boundaryFailure = "";
      if (conflict || protocolError) {
        this.#clearAutosaveTimer();
        const frozen = await this.#freezeAuthority(
          "编辑画布尚未就绪，已停止接受这次外部源码状态。",
        );
        if (!frozen.ok) boundaryFailure = frozen.reason;
      }
      const visibleMessage = boundaryFailure ? `${message} ${boundaryFailure}` : message;
      this.#documentSession.setPersistence({
        state: conflict ? "conflict" : "failed",
        error: visibleMessage,
      });
      this.#emit({
        type: "document-persistence-failed",
        context: writeContext,
        code,
        message: visibleMessage,
        conflict,
        protocolError,
        recoveryWrite,
        fatal: Boolean(boundaryFailure || protocolError),
      });
    }
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, message);
    }
    return rejected(code, message);
  }

  async #reconcileUnknownAutosave({ write, writeContext }) {
    try {
      const authority = await this.#bridgeClient.workspace(write.sourcePath);
      if (!this.#isCurrent(writeContext)) return stale(writeContext);
      const runtime = this.#codecs.isRecord(authority.runtimeState)
        ? authority.runtimeState
        : {};
      const edit = this.#codecs.isRecord(runtime.edit) ? runtime.edit : {};
      const persistedRevision = revision(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || authority.lastPersistedRevision,
      );
      const sourceSha256 = String(
        authority.currentHtmlSha256 || authority.sourceSha256 || "",
      );
      if (
        String(authority.projectId || "") !== writeContext.projectId
        || String(authority.documentId || "") !== writeContext.documentId
        || !this.#codecs.sameSourcePath(authority.sourcePath, writeContext.sourcePath)
        || !SHA256.test(sourceSha256)
        || persistedRevision < write.revision
      ) return null;
      const source = await this.#bridgeClient.source(write.sourcePath);
      if (!this.#isCurrent(writeContext)) return stale(writeContext);
      this.#assertSourcePayload(
        source,
        writeContext,
        "自动写回结果未知，读取到的源文件身份发生变化。",
      );
      const content = typeof source.content === "string" ? source.content : "";
      const declaredHash = String(source.sha256 || "");
      if (
        content !== write.html
        || declaredHash !== sourceSha256
        || await this.#hashPort.sha256(content) !== declaredHash
      ) return null;
      const payload = {
        content,
        sha256: sourceSha256,
        persistedRevision,
        lastModifiedAt: String(
          source.lastModifiedAt || authority.lastModifiedAt || "",
        ),
        recoveryIdentity: authority.recoveryIdentity,
        currentExactVersionId: source.currentExactVersionId
          || authority.currentExactVersionId,
      };
      if (!payload.lastModifiedAt) return null;
      if (!this.#acknowledgeSourceHistory({
        write,
        writeContext,
        sourceSha256,
      })) {
        // The authority read proved the old write, but the document changed
        // while it was being reconciled. Clean up only that stale write.
        this.#acknowledgeWrite({
          write,
          writeContext,
          payload,
          sourceSha256,
          persistedRevision,
        });
        return stale(writeContext);
      }
      this.#acknowledgeWrite({
        write,
        writeContext,
        payload,
        sourceSha256,
        persistedRevision,
      });
      return this.#isCurrent(writeContext)
        ? succeeded({ revision: persistedRevision, reconciled: true })
        : stale(writeContext);
    } catch {
      // An unknown mutation is never replayed merely because its proof query
      // failed.  The retained recovery record remains the next safe action.
      return null;
    }
  }

  #rebindTargets(html) {
    const targets = [
      ...this.#commentSession.comments.map(commentSourceTarget),
      ...this.#commentSession.changeEvents.map((event) => event.target),
      ...(this.#commentSession.composerTarget
        ? [this.#commentSession.composerTarget.commentAnchor || this.#commentSession.composerTarget]
        : []),
    ];
    const rebound = this.#codecs.rebindTargetsPreservingGlobal(html, targets);
    const byId = new Map(rebound.map((target) => [target.id, target]));
    this.#commentSession.update({
      comments: this.#commentSession.comments.map((comment) => ({
        ...comment,
        target: commentTargetForDisplay(
          byId.get(commentSourceTarget(comment)?.id) || commentSourceTarget(comment),
          comment,
        ),
        sourceAnchor: byId.get(commentSourceTarget(comment)?.id)
          || commentSourceTarget(comment),
      })),
      changeEvents: this.#commentSession.changeEvents.map((event) => ({
        ...event,
        target: byId.get(event.target.id) || event.target,
      })),
    });
    if (this.#commentSession.composerTarget) {
      const composerTarget = this.#commentSession.composerTarget;
      const sourceTarget = composerTarget.commentAnchor || composerTarget;
      this.#commentSession.setComposerTarget(
        commentTargetForDisplay(
          byId.get(sourceTarget.id) || sourceTarget,
          composerTarget,
        ),
      );
    }
  }

  async #runHistoryAction({ direction, context }) {
    const operationId = this.#nextOperationId("history");
    if (!context || !this.#isCurrent(context)) {
      return context ? stale(context) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    const drainedHtml = this.#documentSession.html;
    const drainedRevision = this.#documentSession.editRevision;
    const flush = await this.flush({ throughRevision: drainedRevision });
    if (!flush || flush.status !== "succeeded") return flush;
    // A newer direct edit may arrive while the initial drain waits. Undo must
    // not silently retarget that newer history entry, even on a legacy route
    // whose context Hash did not change with the save receipt.
    if (this.#documentSession.editRevision !== drainedRevision
      || this.#documentSession.html !== drainedHtml) return stale(context);
    if (!this.#isCurrent(context)) {
      const current = copyContext(this.#projectSession.context);
      if (!sameOpenRoute(context, current, this.#codecs.sameSourcePath)
        || this.#documentSession.editRevision !== drainedRevision
        || this.#documentSession.html !== drainedHtml
        || current.sourceSha256 !== this.#documentSession.persistedSourceSha256
        || current.sourceSha256 !== this.#documentSession.workingHtmlSha256) return stale(context);
      // The completed save may refresh this member's Hash while Undo waits.
      // Keep every routing field fixed and consume only its exact byte receipt.
      context = current;
    }
    try {
      const nextRevision = this.#documentSession.editRevision + 1;
      const applied = this.#sourceHistorySession.apply(
        context,
        direction,
        this.#documentSession.html,
        nextRevision,
        new Date(this.#clock.now()).toISOString(),
      );
      if (!applied) {
        return blocked(
          "SOURCE_HISTORY_ACTION_UNAVAILABLE",
          "当前页面没有可撤销或重做的本次打开记录。",
        );
      }
      this.#queueLocalHistoryEdit({
        context,
        direction,
        applied,
        nextRevision,
      });
      const persisted = await this.flush({ throughRevision: nextRevision });
      if (!persisted || persisted.status !== "succeeded") return persisted;
      return succeeded({
        direction,
        sourceSha256: applied.sourceSha256,
        persistedRevision: this.#documentSession.lastPersistedRevision,
      });
    } catch (cause) {
      if (!this.#isCurrent(context)) return stale(context);
      const message = this.#codecs.errorMessage(
        cause,
        direction === "undo"
          ? "撤销结果仍保留在当前页面，可重试保存。"
          : "重做结果仍保留在当前页面，可重试保存。",
      );
      this.#documentSession.setPersistence({ state: "failed", error: message });
      this.#emit({
        type: "document-history-failed",
        context,
        direction,
        message,
      });
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_HISTORY_ACTION_REJECTED",
        message,
      );
    }
  }

  #queueLocalHistoryEdit({ context, direction, applied, nextRevision }) {
    const canonicalHtml = applied.html;
    const rawTarget = this.#codecs.isRecord(applied.target)
      ? this.#codecs.selectionFromRecord(applied.target)
      : null;
    const rawTransition = this.#codecs.isRecord(applied.targetTransition)
      ? applied.targetTransition
      : null;
    const transition = {
      fromTarget: this.#codecs.isRecord(rawTransition?.fromTarget)
        ? this.#codecs.selectionFromRecord(rawTransition.fromTarget)
        : null,
      toTarget: this.#codecs.isRecord(rawTransition?.toTarget)
        ? this.#codecs.selectionFromRecord(rawTransition.toTarget)
        : null,
    };
    const targets = [
      ...this.#commentSession.comments.map(commentSourceTarget),
      ...this.#commentSession.changeEvents.map((event) => event.target),
      ...(this.#commentSession.composerTarget
        ? [this.#commentSession.composerTarget.commentAnchor || this.#commentSession.composerTarget]
        : []),
      ...(rawTarget ? [rawTarget] : []),
    ];
    const rebound = transition.fromTarget && transition.toTarget
      ? this.#codecs.rebindTargetsAcrossHistoryPreservingGlobal(
          this.#documentSession.html,
          canonicalHtml,
          targets,
          transition,
        )
      : this.#codecs.rebindTargetsPreservingGlobal(canonicalHtml, targets);
    const byId = new Map(rebound.map((target) => [target.id, target]));
    this.#commentSession.update({
      comments: this.#commentSession.comments.map((comment) => ({
        ...comment,
        target: commentTargetForDisplay(
          byId.get(commentSourceTarget(comment)?.id) || {
            ...commentSourceTarget(comment),
            resolution: "orphaned",
          },
          comment,
        ),
        sourceAnchor: byId.get(commentSourceTarget(comment)?.id) || {
          ...commentSourceTarget(comment),
          resolution: "orphaned",
        },
      })),
      changeEvents: this.#commentSession.changeEvents.map((event) => ({
        ...event,
        target: byId.get(event.target.id) || {
          ...event.target,
          resolution: "orphaned",
        },
      })),
    });
    if (this.#commentSession.composerTarget) {
      const composerTarget = this.#commentSession.composerTarget;
      const sourceTarget = composerTarget.commentAnchor || composerTarget;
      this.#commentSession.setComposerTarget(
        commentTargetForDisplay(
          byId.get(sourceTarget.id) || {
            ...sourceTarget,
            resolution: "orphaned",
          },
          composerTarget,
        ),
      );
    }
    const historyTarget = rawTarget ? byId.get(rawTarget.id) || rawTarget : null;
    this.#canvasPort.adoptHistorySource?.(
      canonicalHtml,
      historyTarget,
      this.#codecs.historyTextSelectionFromRecord(applied.selection),
    );
    if (this.#documentSession.beginEdit(canonicalHtml) !== nextRevision) {
      throw invalidAcknowledgement(
        "当前文档没有接受撤销结果。",
        "SOURCE_HISTORY_EDIT_REJECTED",
      );
    }
    this.#versionSession.markSourceEdited();
    this.#canvasPort.invalidateRenderAcks();
    const write = this.#createWrite(context, canonicalHtml, nextRevision);
    this.#documentSession.setPendingWrite(write);
    this.#persistRecovery(write, context);
    this.#documentSession.setPersistence({ state: "queued", error: "" });
    this.#emit({
      type: "document-history-applied",
      context,
      direction,
    });
  }

  #assertSourcePayload(payload, context, message) {
    if (
      !this.#codecs.isRecord(payload)
      || String(payload.projectId || "") !== context.projectId
      || String(payload.documentId || "") !== context.documentId
      || (
        payload.sourcePath
        && !this.#codecs.sameSourcePath(payload.sourcePath, context.sourcePath)
      )
    ) throw invalidAcknowledgement(message, "SOURCE_IDENTITY_MISMATCH");
  }

  async #acknowledgeCanvas(html, sourceSha256, context) {
    if (typeof this.#canvasPort.verifyRendered !== "function") return true;
    try {
      await this.#canvasPort.verifyRendered(html, sourceSha256, context);
      if (context && !this.#isCurrent(context)) return false;
      const confirmed = this.#documentSession.confirmCanvas({
        generation: this.#documentSession.canvasGeneration,
        renderedSha256: sourceSha256,
        workingHtmlSha256: sourceSha256,
      });
      if (confirmed) return true;
      this.#documentSession.failCanvas({
        generation: this.#documentSession.canvasGeneration,
        error: "当前画布尚未完成自动恢复。",
      });
      return false;
    } catch (cause) {
      this.#documentSession.failCanvas({
        generation: this.#documentSession.canvasGeneration,
        error: this.#codecs.errorMessage(cause, "当前画布尚未完成自动恢复。"),
      });
      return false;
    }
  }

  async #verifyRendered(html, sourceSha256, context) {
    if (typeof this.#canvasPort.verifyRendered !== "function") return;
    await this.#canvasPort.verifyRendered(html, sourceSha256, context);
  }

  async #freezeAuthority(reason) {
    if (typeof this.#canvasPort.freeze !== "function") {
      return { ok: true, reason: "" };
    }
    try {
      const result = await this.#canvasPort.freeze(reason);
      return result && result.ok
        ? { ok: true, reason: "" }
        : { ok: false, reason: String(result?.reason || reason) };
    } catch (cause) {
      return {
        ok: false,
        reason: this.#codecs.errorMessage(cause, reason),
      };
    }
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackMessage) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, fallbackMessage);
    }
    return rejected(sourceErrorCode(cause, fallbackCode), fallbackMessage);
  }
}
