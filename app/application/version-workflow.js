import { decodeWorkspaceResponse } from "./workspace-controller-codecs.js";
import { isBridgeRequestError } from "./bridge-client.js";
import { verifyOpenTarget } from "./verified-project-context.js";
import { planVersionActivate, planVersionPrepareReview } from "./version/review-plan.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

// Non-blocking performance-timeline marks for the accept/open critical path.
// Marks are inert outside profiling sessions and never affect control flow.
const perfMark = (name) => {
  globalThis.performance?.mark?.(name);
};

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
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

function stale(identity) {
  return Object.freeze({ status: "stale", identity: Object.freeze({ ...identity }) });
}

function errorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return fallback;
}

function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || context.sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? context.epoch),
    }
    : {};
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
    ...target,
  });
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(String(value)));
}

function sameRun(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && sameSourcePath(left.sourcePath, right.sourcePath),
  );
}

function initialSnapshot() {
  return Object.freeze({
    navigation: Object.freeze({
      phase: "idle",
      operationId: null,
      generation: 0,
    }),
    review: Object.freeze({
      phase: "idle",
      operationId: null,
    }),
  });
}

function emptyDraftAuthority() {
  return Object.freeze({
    draftRevision: 0,
    comments: Object.freeze([]),
    changeEvents: Object.freeze([]),
    deletedCommentIds: Object.freeze([]),
    appliedOperationIds: Object.freeze([]),
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


export class VersionWorkflow {
  #creationGeneration = 0;
  #bridgeClient;
  #projectSession;
  #documentSession;
  #versionSession;
  #runSession;
  #projectWorkflow;
  #documentWorkflow;
  #commentWorkflow;
  #commentSession;
  #draftSession;
  #codecs;
  #hashPort;
  #canvasPort;
  #clock;
  #snapshot = initialSnapshot();
  #listeners = new Set();
  #eventListeners = new Set();
  #operationSequence = 0;
  #navigationGeneration = 0;
  #reviewGeneration = 0;
  #disposed = false;
  #pendingActivations = new Map();
  #historyContinuationRecovery = null;

  constructor({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    documentWorkflow,
    commentWorkflow,
    commentSession,
    draftSession,
    codecs,
    ports = {},
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.versionFile !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.activateReadyVersion !== "function"
      || typeof bridgeClient.continueEditingHistoryVersion !== "function"
      || typeof bridgeClient.confirmEditingHistoryVersion !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires its Version Bridge methods.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("VersionWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.publishAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DocumentSession injection.");
    }
    if (
      !versionSession
      || typeof versionSession.captureSnapshot !== "function"
      || typeof versionSession.restoreSnapshot !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires VersionSession snapshot authority.");
    }
    if (
      !runSession
      || typeof runSession.beginOperation !== "function"
      || typeof runSession.endOperation !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires RunSession injection.");
    }
    if (
      !projectWorkflow
      || typeof projectWorkflow.prepareManagedSourceTransition !== "function"
      || typeof projectWorkflow.commitManagedSourceTransition !== "function"
      || typeof projectWorkflow.drain !== "function"
      || typeof projectWorkflow.refreshWorkspace !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires ProjectWorkflow publication authority.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.clearRecovery !== "function"
      || typeof documentWorkflow.clearAudit !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires DocumentWorkflow composition.");
    }
    if (!commentWorkflow || typeof commentWorkflow.resetForProjectTransition !== "function") {
      throw new TypeError("VersionWorkflow requires CommentWorkflow composition.");
    }
    if (!commentSession || typeof commentSession.reset !== "function") {
      throw new TypeError("VersionWorkflow requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.replaceAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DraftSession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("VersionWorkflow requires a HashPort.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("VersionWorkflow requires a CanvasAuthorityPort.");
    }
    if (typeof ports.canvas.verifyRendered !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must verify rendered bytes.");
    }
    if (typeof ports.canvas.invalidateRenderAcks !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must invalidate render acknowledgements.");
    }
    if (typeof ports.canvas.unlock !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must unlock the Canvas.");
    }
    for (const method of [
      "isRecord",
      "sameSourcePath",
      "operationKey",
      "errorMessage",
      "versionsFromWorkspace",
      "draftAuthorityFromWorkspace",
      "commentsFromRecords",
      "changesFromDraftRecords",
    ]) {
      if (typeof codecs?.[method] !== "function") {
        throw new TypeError(`VersionWorkflow codec ${method} is required.`);
      }
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("VersionWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#projectWorkflow = projectWorkflow;
    this.#documentWorkflow = documentWorkflow;
    this.#commentWorkflow = commentWorkflow;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#codecs = codecs;
    this.#hashPort = ports.hash;
    this.#canvasPort = {
      deferCommand: ports.canvas.deferCommand || null,
      freezeWorkingSource: ports.canvas.freezeWorkingSource || (() => ({ ok: true })),
      freeze: ports.canvas.freeze,
      verifyRendered: ports.canvas.verifyRendered,
      invalidateRenderAcks: ports.canvas.invalidateRenderAcks,
      unlock: ports.canvas.unlock,
      requestFrame: ports.canvas.requestFrame || null,
      onNavigationChange: ports.canvas.onNavigationChange || (() => {}),
    };
    this.#clock = clock;
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    for (const [key, pending] of this.#pendingActivations) {
      clearTimeout(pending.timer);
      this.#runSession.endOperation("activate", key);
    }
    this.#pendingActivations.clear();
    this.#historyContinuationRecovery = null;
    this.#navigationGeneration += 1;
    this.#reviewGeneration += 1;
    this.#canvasPort.onNavigationChange(false);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  async prepareReviewCandidate({ run } = {}) {
    const ready = this.#readyRun(run);
    const reviewPlan = planVersionPrepareReview({
      disposed: this.#disposed,
      ready: Boolean(ready),
      baseHashOk: Boolean(ready && SHA256.test(String(ready.baseSnapshotSha256 || ""))),
    });
    if (reviewPlan.kind === "reject") {
      return reviewPlan.code === "VERSION_REVIEW_BASE_HASH_INVALID"
        ? rejected(reviewPlan.code, reviewPlan.reason)
        : blocked(reviewPlan.code, reviewPlan.reason);
    }
    const operationId = this.#nextOperationId("review");
    const generation = ++this.#reviewGeneration;
    this.#setReview("preparing", operationId);
    try {
      const payload = await this.#bridgeClient.versionFile(
        ready.sourcePath,
        ready.candidateVersionId,
      );
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      this.#assertVersionFileIdentity(payload, ready, ready.candidateVersionId);
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      const expectedSha256 = this.#candidateHash(ready, sha256);
      if (
        !content
        || !SHA256.test(sha256)
        || sha256 !== expectedSha256
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("审阅候选与已校验版本的内容 Hash 不一致。");
      }
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      const candidate = Object.freeze({
        operationId,
        operationKey: this.#codecs.operationKey(ready),
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        sourcePath: ready.sourcePath,
        versionId: ready.candidateVersionId,
        baseSnapshotSha256: ready.baseSnapshotSha256,
        content,
        sha256,
        ...(ready.candidateAssessment
          ? { candidateAssessment: ready.candidateAssessment }
          : {}),
      });
      this.#emitEvent({ type: "version-review-candidate-prepared", candidate });
      return succeeded(candidate);
    } catch (cause) {
      return this.#outcomeFromCause(
        operationId,
        cause,
        "VERSION_REVIEW_CANDIDATE_REJECTED",
        "候选版本仍已安全保留，可以稍后重试。",
      );
    } finally {
      if (generation === this.#reviewGeneration) this.#setReview("idle", null);
    }
  }

  async activateReadyVersion({
    run,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    const ready = this.#readyRun(run);
    const entryPlan = planVersionActivate({
      disposed: this.#disposed,
      ready: Boolean(ready),
    });
    if (entryPlan.kind === "reject") {
      return blocked(entryPlan.code, entryPlan.reason);
    }
    try {
      // Validate the persisted ready record before the explicit mutation. A
      // malformed late poll result must never be allowed to activate a Version
      // merely because the Bridge would later return authoritative bytes.
      this.#committedPayload(ready, ready.readyPayload);
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("activation-validation"),
        cause,
        "VERSION_ACTIVATION_PAYLOAD_INVALID",
        "当前候选的完成资料不完整，不能打开。",
      );
    }
    // A ready candidate from another Document must never reach Desktop. The
    // candidate may still be structurally valid for its own frozen Request,
    // but activating it against the current ProjectSession would otherwise
    // let the Bridge mutate a destination that local Sessions cannot own.
    try {
      const readyTarget = this.#readyOpenTarget(ready);
      const currentContext = this.#projectSession.context;
      if (
        !currentContext
        || readyTarget.projectId !== currentContext.projectId
        || readyTarget.documentId !== currentContext.documentId
      ) {
        if (currentContext) {
          return succeeded({
            current: false,
            context: null,
            versionId: ready.candidateVersionId,
            candidateLabel: String(
              ready.readyPayload?.candidateDisplayVersionLabel
              || ready.candidateVersionLabel
              || "",
            ),
            protocolViolation: Boolean(
              ready.readyPayload?.protocolViolation
              || ready.readyPayload?.outcome?.protocolViolation,
            ),
            committedSourcePath: ready.sourcePath,
            lastModifiedAt: String(
              ready.readyPayload?.lastModifiedAt
              || ready.readyPayload?.outcome?.completedAt
              || "",
            ),
          });
        }
        return blocked(
          "VERSION_ACTIVATION_CONTEXT_MISMATCH",
          "候选版本所属文档已不是当前编辑文档，本次采用已安全取消。",
        );
      }
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("activation-context-validation"),
        cause,
        "VERSION_ACTIVATION_PAYLOAD_INVALID",
        "当前候选的工作文件身份不完整，不能打开。",
      );
    }
    const hydratePlan = planVersionActivate({
      ready: true,
      projectHydrating: this.#projectWorkflow.projectHydrating,
    });
    if (hydratePlan.kind === "reject") {
      return blocked(hydratePlan.code, hydratePlan.reason);
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.activateReadyVersion({
          run: ready,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operationKey = this.#codecs.operationKey(ready);
    if (!this.#runSession.beginOperation("activate", operationKey)) {
      return blocked("VERSION_ACTIVATION_BUSY", "当前候选版本正在打开，请等待当前操作完成。");
    }
    const operation = this.#beginNavigation("activating", this.#projectSession.context);
    if (!operation) {
      this.#runSession.endOperation("activate", operationKey);
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const pending = this.#pendingActivations.get(operationKey);
    this.#runSession.trackRun({ ...ready, adoptionPhase: pending ? "unknown" : "applying", error: undefined });
    let durableActivationOperationId = operation.operationId;
    try {
      const drained = pending ? { ok: true } : await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
      if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) return stale(this.#runIdentity(ready));
      if (!drained.ok) return blocked("ADOPTION_DRAFT_NOT_SAVED", drained.reason || "当前修改意见尚未保存，本次修改尚未采用。");
      const readyCandidate = this.#readyCandidate(ready);
      if (!readyCandidate) {
        throw new Error("当前候选缺少经核对的 Candidate 身份，不能重放采用操作。");
      }
      const readyTarget = this.#readyOpenTarget(ready);
      perfMark("pageroot:accept:promote-start");
      const activationRequest = pending?.request || {
        ...readyTarget,
        candidateId: readyCandidate.candidateId,
        decisionOperationId: `promote_${readyCandidate.candidateId}`,
        expectedSourceSha256: readyTarget.sourceSha256,
        sourcePath: ready.sourcePath,
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        versionId: ready.candidateVersionId,
      };
      if (
        String(activationRequest.candidateId || "") !== readyCandidate.candidateId
        || String(activationRequest.decisionOperationId || "")
          !== `promote_${readyCandidate.candidateId}`
      ) {
        throw new Error("当前采用回执与 Candidate 身份不一致，不能重放旧操作。");
      }
      durableActivationOperationId = String(
        activationRequest.decisionOperationId || operation.operationId,
      );
      if (!pending) this.#pendingActivations.set(operationKey, { request: activationRequest, run: ready, reviewLease, timer: null, delay: 1000 });
      let activatedPayload;
      try {
        activatedPayload = await this.#bridgeClient.activateReadyVersion(activationRequest);
      } catch (cause) {
        if (!activationRequest.decisionOperationId || !isBridgeRequestError(cause) || cause.outcome !== "unknown") throw cause;
        if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) return stale(this.#runIdentity(ready));
        activatedPayload = await this.#bridgeClient.activateReadyVersion(activationRequest);
      }
      const activatedOpenTarget = this.#activatedOpenTarget(ready, activatedPayload);
      perfMark("pageroot:accept:promote-end");
      if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) {
        return stale(this.#runIdentity(ready));
      }
      const opened = await this.#openCommittedVersion({
        run: ready,
        payload: {
          ...ready.readyPayload,
          ...activatedPayload,
          completion: ready.readyPayload.completion,
          outcome: ready.readyPayload.outcome,
          version: activatedPayload.version || ready.readyPayload.version,
          openTarget: activatedOpenTarget,
        },
        reviewLease,
        operation,
        activationOperationId: durableActivationOperationId,
      });
      if (opened.status !== "succeeded") return opened;

      this.#clearPendingActivation(operationKey);
      const completed = this.#settleActivatedRun(ready, opened.value);
      const value = {
        ...opened.value,
        completedRun: completed,
      };
      this.#emitEvent({ type: "version-activated", ...value });
      return succeeded(value);
    } catch (cause) {
      if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
        return unknown(durableActivationOperationId, "采用结果待确认，正在自动核对。请勿重复采用或结束本轮。");
      }
      this.#clearPendingActivation(operationKey);
      const reason = ["SOURCE_HASH_CONFLICT", "CANDIDATE_SOURCE_CHANGED", "CANDIDATE_SOURCE_CONFLICT"].includes(errorCode(cause, ""))
        ? "页面已发生变化，本次修改尚未应用。"
        : this.#codecs.errorMessage(cause, "最新版暂时无法打开。");
      if (this.#runMatches(this.#runSession.activeRun, ready)) {
        this.#runSession.trackRun({
          ...ready,
          status: "ready-to-open",
          error: reason,
        });
      }
      return this.#outcomeFromCause(
        durableActivationOperationId,
        cause,
        "VERSION_ACTIVATION_REJECTED",
        reason,
      );
    } finally {
      if (this.#pendingActivations.has(operationKey)) {
        this.#runSession.trackRun({ ...ready, adoptionPhase: "unknown", error: undefined });
        this.#scheduleActivationReconciliation(operationKey);
      } else {
        this.#runSession.endOperation("activate", operationKey);
        if (this.#isCurrentReadyRun(ready)) this.#runSession.trackRun({ ...this.#runSession.activeRun, adoptionPhase: undefined });
      }
      this.#finishNavigation(operation);
    }
  }

  #clearPendingActivation(key) {
    clearTimeout(this.#pendingActivations.get(key)?.timer);
    this.#pendingActivations.delete(key);
  }

  #scheduleActivationReconciliation(key) {
    const pending = this.#pendingActivations.get(key);
    if (!pending || !pending.request.decisionOperationId || pending.timer || this.#disposed) return;
    pending.timer = setTimeout(async () => {
      pending.timer = null;
      if (this.#disposed || this.#pendingActivations.get(key) !== pending) return;
      if (this.#isCurrentReadyRun(pending.run)) {
        this.#runSession.endOperation("activate", key);
        await this.activateReadyVersion({ run: pending.run, reviewLease: pending.reviewLease });
      }
      pending.delay = Math.min(30_000, pending.delay * 2);
      this.#scheduleActivationReconciliation(key);
    }, pending.delay);
    pending.timer.unref?.();
  }

  async openCommittedVersion({
    run,
    payload,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    if (!run || !this.#codecs.isRecord(payload)) {
      return blocked("VERSION_OPEN_PRECONDITION", "完成结果缺少可校验的版本资料。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.openCommittedVersion({
          run,
          payload,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("opening", this.#projectSession.context);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    try {
      return await this.#openCommittedVersion({
        run,
        payload,
        reviewLease,
        operation,
      });
    } catch (cause) {
      return this.#outcomeFromCause(
        operation.operationId,
        cause,
        "VERSION_OPEN_REJECTED",
        "已生成的版本暂时无法安全打开。",
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async viewHistory({
    version,
    context = this.#projectSession.context,
    deadlineAt = this.#clock.now() + 15_000,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (!version?.id) {
      return blocked("VERSION_HISTORY_PRECONDITION", "当前历史版本缺少可验证的版本 ID。");
    }
    if (this.#projectWorkflow.projectHydrating || this.#projectWorkflow.projectLoadError) {
      return blocked("VERSION_HISTORY_PROJECT_UNAVAILABLE", "项目状态尚未准备完成，不能切换历史视图。");
    }
    if (this.#runSession.activeLocked) {
      return blocked("VERSION_HISTORY_RUN_LOCKED", "当前 AI 处理尚未完成，不能切换历史视图。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.viewHistory({ version, context: current, deadlineAt, fromDeferred: true }),
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("history", current);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    try {
      if (this.#versionSession.snapshot.viewMode === "current") {
        const frozen = this.#freezeCurrentCanvas(
          "当前编辑画布尚未完成安全收口，无法打开历史版本。",
        );
        if (!frozen.ok) return blocked("VERSION_HISTORY_CANVAS_FENCE", frozen.reason);
        const drained = await this.#projectWorkflow.drain("history", { deadlineAt });
        if (!this.#isNavigationCurrent(operation)) return stale(current);
        if (!drained.ok) throw new Error(drained.reason || "当前编辑没有完成安全收口。");
      }
      const payload = await this.#bridgeClient.versionFile(current.sourcePath, String(version.id));
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#assertVersionFileIdentity(payload, current, String(version.id));
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      if (
        (version.contentSha256 && sha256 !== String(version.contentSha256))
        || !SHA256.test(sha256)
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("历史文件内容与声明 Hash 不一致，已拒绝打开。");
      }
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#versionSession.enterHistory(String(version.id), {
        projectId: current.projectId, documentId: current.documentId,
        sourcePath: current.sourcePath, versionId: String(version.id), content, sha256,
      });
      const value = { context: current, versionId: String(version.id), content, sha256 };
      this.#emitEvent({ type: "version-history-viewed", ...value });
      return succeeded(value);
    } catch (cause) {
      return rejected(
        errorCode(cause, "VERSION_HISTORY_REJECTED"),
        this.#codecs.errorMessage(
          cause,
          "历史版本没有打开；当前工作内容仍保留。",
        ),
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async returnToCurrent({
    context = this.#projectSession.context,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (this.#snapshot.navigation.phase !== "idle") {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const creation = this.#snapshot.creation;
    if (creation?.context.projectId === current.projectId && creation.context.documentId === current.documentId) {
      if (creation.phase === "unknown") return blocked("HISTORY_CREATION_UNKNOWN", "创建结果暂时未知，请先查询同一操作；仍可切换项目或关闭标签。");
      if (["created", "open-failed"].includes(creation.phase)) {
        return this.openCreatedHistoryVersion({ operationId: creation.operationId, context: current });
      }
    }
    // Leaving a read-only projection must remain possible even when a disk
    // check fails. Observation reports conflicts through DocumentWorkflow and
    // never replaces the protected current source with disk bytes.
    this.#versionSession.returnCurrent();
    const value = { context: current, content: this.#documentSession.html,
      sha256: this.#documentSession.snapshot.workingHtmlSha256 };
    this.#emitEvent({ type: "version-current-returned", ...value });
    void this.#documentWorkflow.observeExternalSourceChange({ sourcePath: current.sourcePath });
    return succeeded(value);
  }

  #setHistoryCreation(value, generation) {
    if (generation !== this.#creationGeneration) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, creation: Object.freeze(value) });
    this.#publishSnapshot();
  }

  #validateHistoryCreation(payload, context, operationId, versionId = null, snapshotSha256 = null) {
    if (!isRecord(payload) || payload.operationId !== operationId
      || payload.projectId !== context.projectId || payload.documentId !== context.documentId
      || !["created", "not-created"].includes(payload.status)) {
      throw new Error("新版本操作回执身份不一致。");
    }
    if (payload.status === "created" && (
      !Number.isSafeInteger(payload.versionOrdinal) || payload.versionOrdinal < 2
      || payload.versionId !== `ver_${String(payload.versionOrdinal).padStart(4, "0")}`
      || !String(payload.sourcePath || "") || !SHA256.test(String(payload.contentSha256 || ""))
      || payload.workingCopyId !== `work_${payload.versionId}`
      || payload.previousVersionId !== `ver_${String(payload.versionOrdinal - 1).padStart(4, "0")}`
      || !/^ver_\d{4,}$/.test(String(payload.basedOnVersionId || ""))
      || !["pending", "opened", "superseded"].includes(payload.recoveryState)
      || (payload.openedAt !== null && (typeof payload.openedAt !== "string" || Number.isNaN(Date.parse(payload.openedAt))))
      || (versionId && payload.basedOnVersionId !== versionId)
      || (snapshotSha256 && payload.contentSha256 !== snapshotSha256)
    )) throw new Error("新版本操作回执内容不一致。");
    return Object.freeze({ ...payload });
  }

  async createVersionFromHistory({ operationId, context = this.#projectSession.context } = {}) {
    const current = copyContext(context);
    if (this.#disposed) return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    if (!current || !this.#projectSession.matches(current)) return stale(current || {});
    const pending = this.#snapshot.creation;
    if (pending?.context.projectId === current.projectId && pending.context.documentId === current.documentId
      && !["opened", "superseded", "not-created"].includes(pending.phase)) {
      return blocked("HISTORY_CREATION_PENDING", "请先查询或打开上一次创建操作的结果。");
    }
    const preview = this.#versionSession.snapshot.historyPreview;
    if (!preview || preview.projectId !== current.projectId || preview.documentId !== current.documentId
      || preview.sourcePath !== current.sourcePath || !/^[A-Za-z0-9_-]{8,160}$/.test(String(operationId || ""))) {
      return blocked("HISTORY_CREATION_PRECONDITION", "请先打开要作为来源的历史版本。");
    }
    if (this.#runSession.activeLocked) return blocked("HISTORY_CREATION_RUN_LOCKED", "请先完成当前 AI 任务或候选的处理。");
    const operation = this.#beginNavigation("creating", current);
    if (!operation) return blocked("VERSION_NAVIGATION_BUSY", "版本操作正在进行。");
    const creationGeneration = ++this.#creationGeneration;
    this.#setHistoryCreation({ phase: "creating", operationId, context: current }, creationGeneration);
    let attempted = false;
    try {
      const drained = await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      if (!drained.ok) return blocked("HISTORY_CREATION_DRAIN", drained.reason || "当前修改尚未保存。");
      attempted = true;
      const payload = await this.#bridgeClient.createVersionFromHistory({
        target: current, operationId, versionId: preview.versionId,
        expectedSourceSha256: this.#documentSession.persistedSourceSha256,
        expectedSnapshotSha256: preview.sha256,
      });
      const result = this.#validateHistoryCreation(payload, current, operationId, preview.versionId, preview.sha256);
      if (result.status !== "created") throw new Error("创建操作没有返回已创建版本。");
      this.#setHistoryCreation({ phase: "created", operationId, context: current, result }, creationGeneration);
      return succeeded(result);
    } catch (cause) {
      if (attempted) {
        try {
          const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }),
            current, operationId, preview.versionId, preview.sha256);
          this.#setHistoryCreation({ phase: this.#historyCreationPhase(result), operationId, context: current, result }, creationGeneration);
          if (result.status === "created") return succeeded(result);
          return rejected(errorCode(cause, "HISTORY_CREATION_NOT_CREATED"), this.#codecs.errorMessage(cause, "尚未创建新版本，可以重试。"));
        } catch {
          this.#setHistoryCreation({ phase: "unknown", operationId, context: current }, creationGeneration);
          return unknown(operationId, "创建结果暂时未知，请查询此操作的结果，不要重新创建。");
        }
      }
      this.#setHistoryCreation({ phase: "not-created", operationId, context: current }, creationGeneration);
      return rejected(errorCode(cause, "HISTORY_CREATION_NOT_CREATED"), this.#codecs.errorMessage(cause, "尚未创建新版本。"));
    } finally {
      if (this.#snapshot.creation?.phase === "creating") this.#setHistoryCreation({ phase: "not-created", operationId, context: current }, creationGeneration);
      this.#finishNavigation(operation);
    }
  }

  #historyCreationPhase(result) {
    if (result.status !== "created") return "not-created";
    if (result.recoveryState === "superseded") return "superseded";
    return result.openedAt ? "opened" : "created";
  }

  async queryHistoryCreation({ operationId, context = this.#projectSession.context } = {}) {
    const current = copyContext(context);
    if (!current || this.#disposed) return blocked("HISTORY_CREATION_CONTEXT", "项目身份不可用。");
    const creationGeneration = ++this.#creationGeneration;
    try {
      const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      this.#setHistoryCreation({ phase: this.#historyCreationPhase(result), operationId, context: current, result }, creationGeneration);
      return succeeded(result);
    } catch {
      this.#setHistoryCreation({ phase: "unknown", operationId, context: current }, creationGeneration);
      return unknown(operationId, "暂时无法确认创建结果，请稍后查询同一操作。");
    }
  }

  async restoreHistoryCreation({ operationId, context }) {
    if (!context || !this.#projectSession.matches(context) || this.#snapshot.navigation.phase !== "idle") return;
    const generation = ++this.#creationGeneration;
    try {
      const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: context, operationId }), context, operationId);
      if (!this.#projectSession.matches(context)) return;
      let phase = this.#historyCreationPhase(result);
      // Hydration may already have opened this very Working Copy. Confirm its
      // existing Canvas, never reopen a receipt merely to repair openedAt.
      if (phase === "created" && context.workingCopyId === result.workingCopyId
        && this.#versionSession.snapshot.currentBasedOnVersionId === result.versionId
        && this.#versionSession.snapshot.viewMode === "current") {
        try {
          await this.#canvasPort.verifyRendered(this.#documentSession.html, this.#documentSession.persistedSourceSha256, context);
          if (!this.#projectSession.matches(context) || generation !== this.#creationGeneration
            || this.#snapshot.navigation.phase !== "idle") return;
          phase = "opened";
          try { await this.#bridgeClient.confirmHistoryCreationOpened({ target: context, operationId }); } catch { /* The verified current Canvas is already usable. */ }
        } catch { /* Keep the committed result available for explicit opening. */ }
      }
      if (!this.#projectSession.matches(context)) return;
      this.#setHistoryCreation({ phase, operationId, context, result }, generation);
    } catch {
      if (this.#projectSession.matches(context)) this.#setHistoryCreation({ phase: "unknown", operationId, context }, generation);
    }
  }

  async openCreatedHistoryVersion({ operationId, context = this.#projectSession.context } = {}) {
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) return stale(current || {});
    if (this.#runSession.activeLocked) return blocked("HISTORY_CREATION_RUN_LOCKED", "请先完成当前 AI 任务或候选的处理。");
    const operation = this.#beginNavigation("opening", current);
    if (!operation) return blocked("VERSION_NAVIGATION_BUSY", "版本操作正在进行。");
    const generation = ++this.#creationGeneration;
    let result;
    try {
      result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      if (result.status !== "created") {
        this.#setHistoryCreation({ phase: "not-created", operationId, context: current, result }, generation);
        return rejected("HISTORY_NOT_CREATED", "尚未创建新版本，可以重试。");
      }
      if (result.recoveryState === "superseded") {
        this.#setHistoryCreation({ phase: "superseded", operationId, context: current, result }, generation);
        return blocked("HISTORY_CREATION_SUPERSEDED", "项目已继续到其他版本，旧创建结果无需重新打开。");
      }
      this.#setHistoryCreation({ phase: "opening", operationId, context: current, result }, generation);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const drained = await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
      if (!drained.ok) throw new Error(drained.reason || "当前修改尚未保护，暂未打开新稿。");
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const payload = await this.#bridgeClient.workspace(result.sourcePath);
      const decoded = decodeWorkspaceResponse(payload, this.#codecs);
      const target = payload.openTarget;
      const content = String(payload.content || "");
      const sha256 = String(payload.currentHtmlSha256 || payload.sourceSha256 || "");
      if (payload.projectId !== current.projectId || payload.documentId !== current.documentId
        || payload.currentBasedOnVersionId !== result.versionId || payload.latestVersionId !== result.versionId
        || target?.targetKind !== "working-copy" || target.projectId !== current.projectId
        || target.documentId !== current.documentId || target.versionId !== result.versionId
        || target.workingCopyId !== result.workingCopyId || target.exactSourcePath !== result.sourcePath
        || target.sourceSha256 !== sha256 || !SHA256.test(sha256)
        || !decoded.versions.some((version) => version.id === result.versionId && version.contentSha256 === result.contentSha256)
        || await this.#hashPort.sha256(content) !== sha256) {
        throw new Error("已创建版本的工作文件身份或内容校验失败。");
      }
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const latestReceipt = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      if (latestReceipt.status !== "created" || latestReceipt.recoveryState === "superseded") {
        this.#setHistoryCreation({ phase: this.#historyCreationPhase(latestReceipt), operationId, context: current, result: latestReceipt }, generation);
        return blocked("HISTORY_CREATION_SUPERSEDED", "项目已继续迭代，停止打开旧创建结果。");
      }
      const prepared = await this.#projectWorkflow.prepareManagedSourceTransition({
        previousSourcePath: current.sourcePath, nextSourcePath: result.sourcePath,
        expectedSha256: sha256, nextProjectId: current.projectId, nextDocumentId: current.documentId,
        versionId: result.versionId, openTarget: target, operationId,
      });
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const nextContext = this.#projectWorkflow.commitManagedSourceTransition({
        prepared, html: content, sourceSha256: sha256,
        publishSessions: (publishedContext) => {
          this.#versionSession.hydrate({ versions: decoded.versions,
            latestVersionId: payload.latestVersionId, currentBasedOnVersionId: result.versionId,
            currentExactVersionId: payload.currentExactVersionId, restoredFromVersionId: payload.restoredFromVersionId });
          this.#versionSession.returnCurrent();
          this.#draftSession.replaceAuthority(publishedContext, decoded.draft.draftRevision, decoded.draft);
          this.#commentSession.update({ comments: decoded.comments, changeEvents: decoded.changeEvents,
            deletedCommentIds: decoded.draft.deletedCommentIds, composerDraft: "", composerCommentId: null,
            composerAttachments: [], composerTarget: null, editSession: null });
        },
      });
      if (!nextContext || !this.#projectSession.matches(nextContext)) {
        return prepared?.coordination?.operationId
          ? unknown(operationId, "桌面工作文件已完成激活，但本地项目状态待同一操作核对。")
          : stale(current);
      }
      this.#setHistoryCreation({ phase: "opening", operationId, context: nextContext, result }, generation);
      await this.#canvasPort.verifyRendered(content, sha256, nextContext);
      if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(nextContext)) return stale(nextContext);
      // A lost opened acknowledgement cannot turn an already opened file into
      // another creation. The durable receipt remains queryable on restart.
      try { await this.#bridgeClient.confirmHistoryCreationOpened({ target: nextContext, operationId }); } catch { /* Retry acknowledgement on the next explicit open. */ }
      this.#setHistoryCreation({ phase: "opened", operationId, context: nextContext, result }, generation);
      this.#documentWorkflow.clearAudit();
      this.#documentWorkflow.clearRecovery(nextContext);
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(nextContext);
      this.#emitEvent({ type: "version-history-created-opened", context: nextContext, versionId: result.versionId });
      return succeeded(result);
    } catch (cause) {
      const active = this.#projectSession.context;
      const owner = active?.projectId === current.projectId && active?.documentId === current.documentId ? active : current;
      this.#setHistoryCreation({ phase: result?.status === "created" ? "open-failed" : "unknown", operationId, context: owner, result }, generation);
      if (cause?.projectOutcome === "unknown") {
        return unknown(
          operationId,
          this.#codecs.errorMessage(cause, "桌面工作文件已完成激活，但本地项目状态待同一操作核对。"),
        );
      }
      return result?.status === "created"
        ? rejected("HISTORY_CREATED_OPEN_FAILED", this.#codecs.errorMessage(cause, "新版本已创建，但打开失败。可以打开已创建版本。"))
        : unknown(operationId, "暂时无法确认创建结果，请查询同一操作。");
    } finally {
      if (this.#snapshot.creation?.phase === "opening") this.#setHistoryCreation({ ...this.#snapshot.creation, phase: "created" }, generation);
      this.#finishNavigation(operation);
    }
  }

  // Compatibility only: old activation receipts and protocol regression tests.
  // Product history Edit must use createVersionFromHistory/openCreatedHistoryVersion.
  async continueEditingHistoryVersion({
    versionId = this.#versionSession.snapshot.viewingVersionId,
    context = this.#projectSession.context,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    const requestedVersionId = String(versionId || "");
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (
      this.#versionSession.snapshot.viewMode !== "history"
      || this.#versionSession.snapshot.viewingVersionId !== requestedVersionId
      || !/^ver_\d{4,}$/.test(requestedVersionId)
    ) {
      return blocked(
        "VERSION_HISTORY_CONTINUE_PRECONDITION",
        "请先只读查看一份明确的历史版本，再基于它继续编辑。",
      );
    }
    if (this.#projectWorkflow.projectHydrating || this.#projectWorkflow.projectLoadError) {
      return blocked(
        "VERSION_HISTORY_CONTINUE_PROJECT_UNAVAILABLE",
        "项目状态尚未准备完成，不能基于历史版本继续编辑。",
      );
    }
    if (this.#runSession.activeLocked) {
      return blocked(
        "VERSION_HISTORY_CONTINUE_RUN_LOCKED",
        "当前 AI 处理尚未完成，不能切换到历史工作文件。",
      );
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.continueEditingHistoryVersion({
          versionId: requestedVersionId,
          context: current,
          fromDeferred: true,
        }),
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("history", current);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const recoverableContinuation = this.#historyContinuationRecovery
      && this.#historyContinuationRecovery.projectId === current.projectId
      && this.#historyContinuationRecovery.documentId === current.documentId
      && this.#historyContinuationRecovery.versionId === requestedVersionId
      && this.#codecs.sameSourcePath(
        this.#historyContinuationRecovery.sourcePath,
        current.sourcePath,
      )
      ? this.#historyContinuationRecovery
      : null;
    const activationOperationId = recoverableContinuation?.operationId || operation.operationId;
    let historyActivation = null;
    let activationMayHaveCommitted = false;
    try {
      const frozen = this.#freezeCurrentCanvas(
        "当前历史视图尚未完成安全收口，无法切换到历史工作文件。",
      );
      if (!frozen.ok) {
        return blocked("VERSION_HISTORY_CONTINUE_CANVAS_FENCE", frozen.reason);
      }
      const continueHistory = () => this.#bridgeClient.continueEditingHistoryVersion({
        sourcePath: current.sourcePath,
        projectId: current.projectId,
        documentId: current.documentId,
        versionId: requestedVersionId,
        operationId: activationOperationId,
      });
      let payload;
      try {
        payload = await continueHistory();
      } catch (cause) {
        if (!isBridgeRequestError(cause) || cause.outcome !== "unknown") throw cause;
        // The Repository receipt is keyed by this operation, so a single
        // bounded retry can recover a lost response without another switch.
        activationMayHaveCommitted = true;
        payload = await continueHistory();
      }
      // The Bridge may return a durable Repository receipt for a renderer
      // operation that was lost before this renderer turn (for example, a
      // restart with X persisted while the new click asks for Y). Validate
      // that small receipt identity before decoding any workspace fields and
      // retain X immediately. Later workspace/target/content validation may
      // fail, but it must never make us fall back to minting Y.
      const durableReceipt = this.#historyActivationReceipt(
        payload,
        current,
        requestedVersionId,
        recoverableContinuation?.operationId || null,
      );
      if (!durableReceipt) {
        throw new Error("历史工作文件响应缺少可核对的持久激活回执。");
      }
      activationMayHaveCommitted = true;
      historyActivation = durableReceipt;
      this.#retainHistoryContinuationRecovery(
        historyActivation.operationId,
        current,
        requestedVersionId,
      );
      const resumed = this.#historyContinuationPayload(payload, current, requestedVersionId);
      historyActivation = resumed.historyActivation;
      // The Repository history activation is already a durable effect even
      // when the following Desktop/local commit cannot complete. Record its
      // exact receipt immediately so every return/throw path can continue the
      // same operation instead of minting a second history activation.
      this.#retainHistoryContinuationRecovery(
        historyActivation.operationId,
        current,
        requestedVersionId,
      );
      if (!this.#isNavigationCurrent(operation)) {
        this.#historyContinuationRecovery = Object.freeze({
          operationId: historyActivation.operationId,
          projectId: current.projectId,
          documentId: current.documentId,
          versionId: requestedVersionId,
          sourcePath: current.sourcePath,
        });
        return unknown(
          historyActivation.operationId,
          "历史工作文件已提交；请重试以完成桌面切换。",
        );
      }
      const resumedHash = await this.#hashPort.sha256(resumed.content);
      if (!this.#isNavigationCurrent(operation)) {
        this.#historyContinuationRecovery = Object.freeze({
          operationId: historyActivation.operationId,
          projectId: current.projectId,
          documentId: current.documentId,
          versionId: requestedVersionId,
          sourcePath: current.sourcePath,
        });
        return unknown(
          historyActivation.operationId,
          "历史工作文件已提交；请重试以完成桌面切换。",
        );
      }
      if (resumedHash !== resumed.sha256) {
        throw new Error("历史工作文件内容与声明 Hash 不一致，不能继续编辑。");
      }
      const prepared = await this.#projectWorkflow.prepareManagedSourceTransition({
        previousSourcePath: current.sourcePath,
        nextSourcePath: resumed.openTarget.exactSourcePath,
        expectedSha256: resumed.sha256,
        nextProjectId: current.projectId,
        nextDocumentId: current.documentId,
        versionId: requestedVersionId,
        openTarget: resumed.openTarget,
        operationId: historyActivation.operationId,
      });
      if (!this.#isNavigationCurrent(operation)) {
        this.#historyContinuationRecovery = Object.freeze({
          operationId: historyActivation.operationId,
          projectId: current.projectId,
          documentId: current.documentId,
          versionId: requestedVersionId,
          sourcePath: current.sourcePath,
        });
        return unknown(
          historyActivation.operationId,
          "历史工作文件已完成桌面激活；请重试以恢复编辑会话。",
        );
      }
      if (
        !prepared
        || !prepared.updatesCurrentProject
        || !prepared.activatedProject
        || prepared.activatedProject.operationId !== historyActivation.operationId
        || prepared.activatedProject.sha256 !== resumed.sha256
      ) {
        throw Object.assign(
          new Error("历史工作文件尚未完成同一操作的桌面激活，不能确认。"),
          { code: "HISTORY_DESKTOP_ACTIVATION_NOT_READY" },
        );
      }
      const confirmation = await this.#bridgeClient.confirmEditingHistoryVersion({
        sourcePath: current.sourcePath,
        projectId: current.projectId,
        documentId: current.documentId,
        previousWorkingCopyId: historyActivation.previousWorkingCopyId,
        activatedWorkingCopyId: historyActivation.activatedWorkingCopyId,
        versionId: historyActivation.versionId,
        operationId: historyActivation.operationId,
      });
      this.#historyConfirmationPayload(confirmation, current, historyActivation);
      if (!this.#isNavigationCurrent(operation)) {
        this.#historyContinuationRecovery = Object.freeze({
          operationId: historyActivation.operationId,
          projectId: current.projectId,
          documentId: current.documentId,
          versionId: requestedVersionId,
          sourcePath: current.sourcePath,
        });
        return unknown(
          historyActivation.operationId,
          "历史工作文件已完成桌面激活；请重试以恢复编辑会话。",
        );
      }
      const nextContext = this.#projectWorkflow.commitManagedSourceTransition({
        prepared,
        html: resumed.content,
        sourceSha256: resumed.sha256,
        publishSessions: (publishedContext) => {
          this.#versionSession.hydrate({
            versions: resumed.versions,
            latestVersionId: resumed.latestVersionId,
            currentBasedOnVersionId: requestedVersionId,
            currentExactVersionId: resumed.currentExactVersionId,
            restoredFromVersionId: resumed.restoredFromVersionId,
          });
          this.#versionSession.returnCurrent({
            currentBasedOnVersionId: requestedVersionId,
            currentExactVersionId: resumed.currentExactVersionId,
            restoredFromVersionId: resumed.restoredFromVersionId,
          });
          this.#draftSession.replaceAuthority(
            publishedContext,
            resumed.draft.draftRevision,
            resumed.draft,
          );
          this.#commentSession.update({
            comments: resumed.comments,
            changeEvents: resumed.changeEvents,
            deletedCommentIds: resumed.draft.deletedCommentIds,
            composerDraft: "",
            composerCommentId: null,
            composerAttachments: [],
            composerTarget: null,
            editSession: null,
          });
        },
      });
      if (!nextContext || !this.#projectSession.matches(nextContext)) {
        return prepared?.coordination?.operationId
          ? unknown(
            historyActivation.operationId,
            "历史工作文件已完成桌面激活，但本地项目状态待同一操作核对。",
          )
          : stale(current);
      }
      // Keep the durable operation recoverable until the local aggregate has
      // committed the complete tuple. A valid Repository/Desktop receipt is
      // not itself a local Session commit.
      this.#historyContinuationRecovery = null;
      if (!this.#isNavigationActive(operation)) return stale(current);
      await this.#canvasPort.verifyRendered(resumed.content, resumed.sha256, nextContext);
      if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(nextContext)) {
        return stale(nextContext);
      }
      this.#documentWorkflow.clearAudit();
      this.#documentSession.setPersistence({ state: "idle", error: "" });
      this.#documentWorkflow.clearRecovery(nextContext);
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(nextContext);
      const value = {
        context: nextContext,
        versionId: requestedVersionId,
        workingCopyId: resumed.openTarget.workingCopyId,
        content: resumed.content,
        sha256: resumed.sha256,
        lastModifiedAt: resumed.lastModifiedAt,
      };
      this.#emitEvent({ type: "version-history-editing-continued", ...value });
      return succeeded(value);
    } catch (cause) {
      if (
        historyActivation
        || activationMayHaveCommitted
        || (isBridgeRequestError(cause) && cause.outcome === "unknown")
      ) {
        this.#historyContinuationRecovery = Object.freeze({
          operationId: historyActivation?.operationId || activationOperationId,
          projectId: current.projectId,
          documentId: current.documentId,
          versionId: requestedVersionId,
          sourcePath: current.sourcePath,
        });
        return unknown(
          historyActivation?.operationId || activationOperationId,
          this.#codecs.errorMessage(
            cause,
            "历史工作文件可能已经激活；请重试以安全恢复编辑会话。",
          ),
        );
      }
      return rejected(
        errorCode(cause, "VERSION_HISTORY_CONTINUE_REJECTED"),
        this.#codecs.errorMessage(
          cause,
          "没有切换到历史工作文件；原来的历史视图仍保持不变。",
        ),
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async #openCommittedVersion({
    run,
    payload,
    reviewLease,
    operation,
    activationOperationId = null,
  }) {
    perfMark("pageroot:accept:open-start");
    const completion = this.#committedPayload(run, payload);
    const committedSourcePath = String(
      payload.sourcePath
      || payload.currentPath
      || payload.workingCopyPath
      || run.sourcePath,
    );
    // An explicit activation response already carries the authoritative
    // post-promotion bytes. Reusing them skips re-reading megabytes over the
    // Bridge while the review overlay is still blocking the user; identity
    // and hash verification below still run on these bytes before they may
    // reach the canvas, and an incomplete payload falls back to the read-back.
    const inline = this.#inlineActivatedSource(payload);
    let source = inline;
    if (!source) {
      const [versionPayload, sourcePayload] = await Promise.all([
        this.#bridgeClient.versionFile(committedSourcePath, completion.versionId),
        this.#bridgeClient.source(committedSourcePath),
      ]);
      if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
      this.#assertVersionFileIdentity(versionPayload, run, completion.versionId);
      this.#assertSourceIdentity(sourcePayload, run, { allowSourceTransition: true });
      const versionContent = String(versionPayload.content || "");
      if (versionContent !== String(sourcePayload.content || "")) {
        throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
      }
      source = {
        content: versionContent,
        versionSha256: String(versionPayload.sha256 || versionPayload.contentSha256 || ""),
        sourceSha256: String(sourcePayload.sha256 || sourcePayload.sourceSha256 || ""),
        sourcePath: String(sourcePayload.sourcePath || committedSourcePath),
        lastModifiedAt: String(sourcePayload.lastModifiedAt || ""),
      };
    } else {
      this.#assertVersionFileIdentity(payload, run, completion.versionId);
      this.#assertSourceIdentity(payload, run, { allowSourceTransition: true });
    }
    perfMark("pageroot:accept:read-end");
    const content = source.content;
    const versionSha256 = source.versionSha256;
    const sourceSha256 = source.sourceSha256;
    const resolvedCommittedSourcePath = source.sourcePath;
    const lastModifiedAt = source.lastModifiedAt;
    const contentHash = await this.#hashPort.sha256(content);
    if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
    if (
      versionSha256 !== completion.expectedSha256
      || sourceSha256 !== completion.expectedSha256
      || !SHA256.test(versionSha256)
      || contentHash !== versionSha256
    ) {
      throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
    }
    perfMark("pageroot:accept:hash-end");
    if (!validTimestamp(lastModifiedAt)) {
      throw new Error("当前源 HTML 缺少独立的最后修改时间，已停止打开。");
    }

    // Current/background classification and any canvas/recovery mutation must
    // use the response's complete authority tuple. Never borrow project,
    // document, path, hash, or version identity from the frozen run or a
    // surrounding workspace when the response omits or mismatches it.
    const verifiedOpenTarget = verifyOpenTarget(payload.openTarget, {
      projectId: run.projectId,
      documentId: run.documentId,
      sourcePath: resolvedCommittedSourcePath,
      sourceSha256,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (
      !verifiedOpenTarget
      || String(verifiedOpenTarget.versionId || "") !== String(completion.versionId || "")
    ) {
      throw new Error("已生成版本的工作文件 OpenTarget 不完整或身份不一致，已停止打开。");
    }

    const activeContext = this.#projectSession.context;
    const affectsCurrentCanvas = Boolean(
      activeContext
      && activeContext.projectId === run.projectId
      && activeContext.documentId === run.documentId
      && (
        this.#codecs.sameSourcePath(activeContext.sourcePath, run.sourcePath)
        || this.#codecs.sameSourcePath(activeContext.sourcePath, resolvedCommittedSourcePath)
      ),
    );
    if (affectsCurrentCanvas) {
      const alreadyFencedForReview = Boolean(
        reviewLease
        && reviewLease.operationKey === this.#codecs.operationKey(run)
        && reviewLease.beforeHtml === this.#documentSession.html,
      );
      if (!alreadyFencedForReview) {
        const frozen = this.#freezeCurrentCanvas(
          "新版本已生成，但当前编辑画布尚未就绪。",
        );
        if (!frozen.ok) throw new Error(frozen.reason);
      }
      if (!this.#projectSession.matches(activeContext)) {
        return stale(activeContext);
      }
      this.#documentWorkflow.clearRecovery(activeContext);
    }

    const prepared = await this.#projectWorkflow.prepareManagedSourceTransition({
      previousSourcePath: run.sourcePath,
      nextSourcePath: resolvedCommittedSourcePath,
      expectedSha256: sourceSha256,
      nextProjectId: run.projectId,
      nextDocumentId: run.documentId,
      versionId: completion.versionId,
      openTarget: verifiedOpenTarget,
      operationId: activationOperationId || operation.operationId,
    });
    if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
    if (
      prepared?.updatesCurrentProject
      && !this.#codecs.sameSourcePath(run.sourcePath, resolvedCommittedSourcePath)
      && prepared?.activatedProject?.sha256 !== sourceSha256
    ) {
      return unknown(
        activationOperationId || operation.operationId,
        "桌面工作文件已返回，但本地项目状态缺少同一 Hash 的完整回执。",
      );
    }
    if (!prepared.updatesCurrentProject) {
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(
        this.#projectSession.context,
      );
      return succeeded({
        current: false,
        context: null,
        versionId: completion.versionId,
        candidateLabel: completion.candidateLabel,
        protocolViolation: completion.protocolViolation,
        aiCompletedAt: completion.aiCompletedAt,
        committedSourcePath: resolvedCommittedSourcePath,
        lastModifiedAt,
      });
    }
    const context = this.#projectWorkflow.commitManagedSourceTransition({
      prepared,
      html: content,
      sourceSha256,
      publishSessions: (publishedContext) => {
        this.#versionSession.adoptCommitted(completion.versionId);
        const retained = payload.retainedDraft;
        this.#draftSession.replaceAuthority(publishedContext, Number(retained?.draftRevision || 0), retained || emptyDraftAuthority());
        this.#commentSession.reset();
        if (retained?.comments?.length) this.#commentSession.update({
          comments: this.#codecs.commentsFromRecords(retained.comments), changeEvents: [],
        });
      },
    });
    if (!context || !this.#projectSession.matches(context)) {
      return prepared?.coordination?.operationId
        ? unknown(
          activationOperationId || operation.operationId,
          "版本工作文件已完成激活，但本地项目状态待同一操作核对。",
        )
        : stale(this.#runIdentity(run));
    }
    perfMark("pageroot:accept:commit-end");

    // Durable promotion and complete Session publication are the user-facing
    // cut. Canvas verification remains mandatory, but it warms the sole edit
    // surface after the committed bytes are already eligible for display.
    this.#emitEvent({
      type: "version-activation-published",
      context,
      operationKey: this.#codecs.operationKey(run),
      candidateLabel: completion.candidateLabel,
      committedSourcePath: resolvedCommittedSourcePath,
      lastModifiedAt,
    });

    await this.#canvasPort.verifyRendered(content, versionSha256, context);
    perfMark("pageroot:accept:canvas-verified");
    if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(context)) {
      return stale(context);
    }

    this.#documentWorkflow.clearAudit();
    this.#documentSession.setPersistence({ state: "idle", error: "" });

    this.#commentWorkflow.queueDraft();
    this.#documentWorkflow.clearRecovery(context);

    // Workspace re-hydration only refreshes project metadata for panels; the
    // Version bytes on the canvas are verified above. Run it in the background
    // instead of holding the review overlay open, and surface a non-fatal
    // warning through the event channel when it cannot complete.
    const refreshFallback = "新版本已打开，但项目资料尚未完成复核。";
    void this.#projectWorkflow.refreshWorkspace({
      sourcePath: resolvedCommittedSourcePath,
      epoch: context.epoch,
    }).then((refreshed) => {
      if (refreshed.status === "succeeded" || refreshed.status === "stale") return;
      this.#emitEvent({
        type: "version-refresh-warning",
        context,
        candidateLabel: completion.candidateLabel,
        reason: refreshed.reason || refreshFallback,
      });
    }).catch((cause) => {
      this.#emitEvent({
        type: "version-refresh-warning",
        context,
        candidateLabel: completion.candidateLabel,
        reason: this.#codecs.errorMessage(cause, refreshFallback),
      });
    });
    perfMark("pageroot:accept:refresh-end");

    this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(context);

    return succeeded({
      current: true,
      context,
      versionId: completion.versionId,
      candidateLabel: completion.candidateLabel,
      protocolViolation: completion.protocolViolation,
      aiCompletedAt: completion.aiCompletedAt,
      committedSourcePath: resolvedCommittedSourcePath,
      lastModifiedAt,
    });
  }

  #committedPayload(run, payload) {
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    const outcome = this.#codecs.isRecord(payload.outcome) ? payload.outcome : {};
    const completion = this.#codecs.isRecord(payload.completion) ? payload.completion : {};
    const declaredCompletionTimes = [
      completion.completedAt,
      outcome.completedAt,
      payload.completedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const declaredVersionTimes = [
      version.generatedAt,
      outcome.generatedAt,
      payload.generatedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const aiCompletedAt = String(declaredCompletionTimes[0] || "");
    const versionGeneratedAt = String(declaredVersionTimes[0] || "");
    if (!validTimestamp(aiCompletedAt) || !validTimestamp(versionGeneratedAt)) {
      throw new Error("完成结果缺少可审计的 AI 完成时间或版本生成时间。");
    }
    if (
      declaredCompletionTimes.some((value) => String(value) !== aiCompletedAt)
      || declaredVersionTimes.some((value) => String(value) !== versionGeneratedAt)
    ) {
      throw new Error("完成记录与版本记录的时间戳不一致，已拒绝打开。");
    }
    const declaredVersionIds = [
      payload.versionId,
      version.versionId,
      version.id,
      outcome.versionId,
      completion.versionId,
      run.candidateVersionId,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const versionId = String(declaredVersionIds[0] || "");
    const declaredContentHashes = [
      payload.contentSha256,
      version.contentSha256,
      outcome.contentSha256,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const expectedSha256 = String(
      declaredContentHashes[0]
      || payload.sourceSha256
      || payload.currentHtmlSha256
      || "",
    );
    if (!versionId || !SHA256.test(expectedSha256)) {
      throw new Error("完成结果缺少版本 ID 或内容 Hash。");
    }
    if (
      declaredVersionIds.some((value) => String(value) !== versionId)
      || declaredContentHashes.some((value) => String(value) !== expectedSha256)
    ) {
      throw new Error("完成记录与候选版本的 ID 或内容 Hash 不一致，已拒绝打开。");
    }
    for (const [field, expected] of [
      ["projectId", run.projectId],
      ["documentId", run.documentId],
      ["requestId", run.requestId],
      ["attemptId", run.attemptId],
    ]) {
      const declared = [payload[field], version[field], outcome[field], completion[field]]
        .filter((value) => value !== undefined && value !== null && value !== "");
      if (declared.some((value) => String(value) !== expected)) {
        throw new Error(`完成结果的 ${field} 与当前冻结任务不一致，已拒绝打开。`);
      }
    }
    if (run.candidateVersionId && versionId !== run.candidateVersionId) {
      throw new Error("完成结果的版本 ID 与系统预留候选版本不一致，已拒绝打开。");
    }
    return Object.freeze({
      versionId,
      expectedSha256,
      candidateLabel: String(payload.candidateDisplayVersionLabel || run.candidateVersionLabel),
      aiCompletedAt,
      protocolViolation: Boolean(payload.protocolViolation || outcome.protocolViolation),
    });
  }

  #candidateHash(run, fallback) {
    const payload = this.#codecs.isRecord(run.readyPayload) ? run.readyPayload : {};
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    return String(payload.contentSha256 || version.contentSha256 || fallback || "");
  }

  #readyOpenTarget(run) {
    const target = isRecord(run?.readyPayload?.openTarget)
      ? run.readyPayload.openTarget
      : null;
    const verifiedTarget = verifyOpenTarget(target, {
      projectId: run?.projectId,
      documentId: run?.documentId,
      sourcePath: run?.sourcePath,
      sourceSha256: run?.baseSnapshotSha256 || run?.sourceSha256 || null,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (!verifiedTarget) {
      throw new Error("候选版本缺少其所属项目的完整工作文件身份，不能从其他项目借用当前页面。");
    }
    return verifiedTarget;
  }

  #activatedOpenTarget(run, payload) {
    const candidateHash = this.#candidateHash(run, "");
    const responseVersionId = String(payload?.versionId || "");
    const responseSourcePath = String(
      payload?.sourcePath
      || payload?.currentPath
      || payload?.workingCopyPath
      || "",
    );
    const target = verifyOpenTarget(payload?.openTarget, {
      projectId: run?.projectId,
      documentId: run?.documentId,
      sourcePath: responseSourcePath || null,
      sourceSha256: candidateHash,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (
      !target
      || !SHA256.test(candidateHash)
      || !responseVersionId
      || responseVersionId !== String(run?.candidateVersionId || "")
      || target.versionId !== responseVersionId
      || String(payload?.projectId || "") !== String(run?.projectId || "")
      || String(payload?.documentId || "") !== String(run?.documentId || "")
      || (responseSourcePath && !this.#codecs.sameSourcePath(target.exactSourcePath, responseSourcePath))
    ) {
      throw new Error("Candidate Promotion 返回的工作文件 OpenTarget 不完整或身份不一致。");
    }
    return target;
  }

  // A "version-activated" response comes from the same Bridge authority that
  // just committed the promotion transaction; its inline bytes replace the
  // immediate read-back. Anything missing or malformed disables the fast path
  // so the full read-back below re-establishes the source of truth.
  #inlineActivatedSource(payload) {
    const content = typeof payload?.content === "string" ? payload.content : "";
    const sha256 = String(payload?.contentSha256 || "");
    const sourcePath = String(payload?.sourcePath || "");
    const lastModifiedAt = String(payload?.lastModifiedAt || "");
    if (
      payload?.ok !== true
      || payload?.status !== "version-activated"
      || !content
      || !sourcePath
      || !SHA256.test(sha256)
      || String(payload?.sourceSha256 || sha256) !== sha256
      || !validTimestamp(lastModifiedAt)
    ) return null;
    return {
      content,
      versionSha256: sha256,
      sourceSha256: sha256,
      sourcePath,
      lastModifiedAt,
    };
  }

  #assertVersionFileIdentity(payload, owner, expectedVersionId) {
    const projectId = String(owner.projectId || "");
    const documentId = String(owner.documentId || "");
    if (
      String(payload?.projectId || "") !== projectId
      || String(payload?.documentId || "") !== documentId
      || String(payload?.versionId || "") !== String(expectedVersionId || "")
    ) {
      throw new Error("版本文件的项目、文档或版本身份与当前操作不一致。");
    }
  }

  #assertSourceIdentity(payload, owner, { allowSourceTransition = false } = {}) {
    if (
      String(payload?.projectId || "") !== String(owner.projectId || "")
      || String(payload?.documentId || "") !== String(owner.documentId || "")
      || (!allowSourceTransition && (
        payload?.sourcePath
        && !this.#codecs.sameSourcePath(payload.sourcePath, owner.sourcePath)
      ))
    ) {
      throw new Error("当前源 HTML 的项目身份发生变化，已拒绝切换视图。");
    }
  }

  #historyContinuationPayload(payload, context, versionId) {
    const openTarget = isRecord(payload?.openTarget) ? payload.openTarget : null;
    const sha256 = String(
      payload?.currentHtmlSha256
      || payload?.sourceSha256
      || openTarget?.sourceSha256
      || "",
    );
    const content = String(payload?.content || "");
    const latestVersionId = String(payload?.latestVersionId || "");
    const decodedWorkspace = decodeWorkspaceResponse(payload, this.#codecs);
    const versions = decodedWorkspace.versions;
    const historyActivation = isRecord(payload?.historyActivation)
      ? payload.historyActivation
      : null;
    const operationId = String(historyActivation?.operationId || "");
    const previousWorkingCopyId = historyActivation?.previousWorkingCopyId;
    const activatedWorkingCopyId = String(historyActivation?.activatedWorkingCopyId || "");
    const verifiedOpenTarget = verifyOpenTarget(openTarget, {
      projectId: context?.projectId,
      documentId: context?.documentId,
      sourcePath: payload?.sourcePath,
      sourceSha256: sha256,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (
      payload?.ok !== true
      || payload?.status !== "history-working-copy-activated"
      || String(payload?.projectId || "") !== context.projectId
      || String(payload?.documentId || "") !== context.documentId
      || String(payload?.currentBasedOnVersionId || "") !== versionId
      || !verifiedOpenTarget
      || String(verifiedOpenTarget.projectId || "") !== context.projectId
      || String(verifiedOpenTarget.documentId || "") !== context.documentId
      || String(verifiedOpenTarget.versionId || "") !== versionId
      || String(payload?.sourcePath || "") !== String(verifiedOpenTarget.exactSourcePath)
      || !SHA256.test(sha256)
      || !content
      || !/^ver_\d{4,}$/.test(latestVersionId)
      || !versions
      || !versions.some((version) => version.id === versionId)
      || !historyActivation
      || String(historyActivation.projectId || "") !== context.projectId
      || String(historyActivation.documentId || "") !== context.documentId
      || String(historyActivation.versionId || "") !== versionId
      || !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
      || !["desktop-pending", "desktop-confirmed"].includes(historyActivation.state)
      || !validTimestamp(historyActivation.createdAt)
      || String(payload?.operationId || "") !== operationId
      || (
        previousWorkingCopyId !== null
        && !/^work_ver_\d{4,}$/.test(String(previousWorkingCopyId || ""))
      )
      || !/^work_ver_\d{4,}$/.test(activatedWorkingCopyId)
      || activatedWorkingCopyId !== String(verifiedOpenTarget.workingCopyId)
      || !validTimestamp(payload?.lastModifiedAt)
    ) {
      throw new Error("历史继续编辑响应缺少完整、同一项目的工作文件身份。");
    }
    const { draft, comments, changeEvents } = decodedWorkspace;
    return Object.freeze({
      openTarget: verifiedOpenTarget,
      historyActivation: Object.freeze({
        operationId,
        projectId: context.projectId,
        documentId: context.documentId,
        previousWorkingCopyId,
        activatedWorkingCopyId,
        versionId,
        state: String(historyActivation.state),
        createdAt: String(historyActivation.createdAt),
      }),
      content,
      sha256,
      latestVersionId,
      versions,
      currentExactVersionId: payload.currentExactVersionId
        ? String(payload.currentExactVersionId)
        : null,
      restoredFromVersionId: payload.restoredFromVersionId
        ? String(payload.restoredFromVersionId)
        : null,
      lastModifiedAt: String(payload.lastModifiedAt),
      draft,
      comments,
      changeEvents,
    });
  }

  #retainHistoryContinuationRecovery(operationId, context, versionId) {
    this.#historyContinuationRecovery = Object.freeze({
      operationId: String(operationId || ""),
      projectId: String(context?.projectId || ""),
      documentId: String(context?.documentId || ""),
      versionId: String(versionId || ""),
      sourcePath: String(context?.sourcePath || ""),
    });
  }

  #historyActivationReceipt(payload, context, versionId, expectedOperationId = null) {
    const receipt = isRecord(payload?.historyActivation)
      ? payload.historyActivation
      : null;
    const operationId = String(receipt?.operationId || payload?.operationId || "");
    const previousWorkingCopyId = receipt?.previousWorkingCopyId;
    const activatedWorkingCopyId = String(receipt?.activatedWorkingCopyId || "");
    if (
      payload?.ok !== true
      || payload?.status !== "history-working-copy-activated"
      || !receipt
      || !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
      || (expectedOperationId && operationId !== expectedOperationId)
      || String(payload?.operationId || "") !== operationId
      || String(receipt.projectId || "") !== String(context?.projectId || "")
      || String(receipt.documentId || "") !== String(context?.documentId || "")
      || String(receipt.versionId || "") !== String(versionId || "")
      || (previousWorkingCopyId !== null
        && !/^work_ver_\d{4,}$/.test(String(previousWorkingCopyId || "")))
      || !/^work_ver_\d{4,}$/.test(activatedWorkingCopyId)
      || !["desktop-pending", "desktop-confirmed"].includes(String(receipt.state || ""))
      || !validTimestamp(receipt.createdAt)
    ) return null;
    return Object.freeze({
      operationId,
      projectId: String(receipt.projectId),
      documentId: String(receipt.documentId),
      previousWorkingCopyId,
      activatedWorkingCopyId,
      versionId: String(receipt.versionId),
      state: String(receipt.state),
      createdAt: String(receipt.createdAt),
    });
  }

  #historyConfirmationPayload(payload, context, activation) {
    const confirmed = isRecord(payload?.historyActivation) ? payload.historyActivation : null;
    if (
      payload?.ok !== true
      || payload?.status !== "history-working-copy-desktop-confirmed"
      || String(payload?.projectId || "") !== context.projectId
      || String(payload?.documentId || "") !== context.documentId
      || String(payload?.operationId || "") !== activation.operationId
      || !confirmed
      || String(confirmed.operationId || "") !== activation.operationId
      || String(confirmed.projectId || "") !== context.projectId
      || String(confirmed.documentId || "") !== context.documentId
      || confirmed.previousWorkingCopyId !== activation.previousWorkingCopyId
      || String(confirmed.activatedWorkingCopyId || "") !== activation.activatedWorkingCopyId
      || String(confirmed.versionId || "") !== activation.versionId
      || confirmed.state !== "desktop-confirmed"
    ) {
      throw new Error("历史工作文件桌面确认响应缺少完整的一致回执。");
    }
    return confirmed;
  }

  #settleActivatedRun(run, value) {
    const warning = value.protocolViolation
      ? "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。"
      : "";
    const completed = {
      ...run,
      sourcePath: value.committedSourcePath,
      candidateVersionLabel: value.candidateLabel,
      status: value.protocolViolation ? "error" : "complete",
      completionObserved: true,
      ...(warning ? { error: warning } : {}),
    };
    this.#runSession.setActiveRun(completed);
    this.#runSession.removeRun(run, { clearActive: false });
    this.#runSession.clearActiveHandoff();
    return Object.freeze(completed);
  }

  #freezeCurrentCanvas(reason) {
    const frozen = this.#canvasPort.freeze(reason);
    if (!frozen || !frozen.ok) {
      return {
        ok: false,
        reason: frozen?.reason || "当前编辑画布尚未完成安全收口。",
      };
    }
    if (frozen.html !== this.#documentSession.html) {
      return { ok: false, reason: "编辑画布的冻结快照与当前源 HTML 不一致。" };
    }
    return { ok: true, html: frozen.html };
  }

  #beginNavigation(phase, context) {
    if (this.#snapshot.navigation.phase !== "idle") return null;
    const operation = Object.freeze({
      operationId: this.#nextOperationId("navigation"),
      generation: ++this.#navigationGeneration,
      context: copyContext(context),
    });
    this.#setNavigation(phase, operation.operationId, operation.generation);
    return operation;
  }

  #finishNavigation(operation) {
    if (
      this.#snapshot.navigation.operationId !== operation.operationId
      || operation.generation !== this.#navigationGeneration
    ) return;
    this.#setNavigation("idle", null, operation.generation);
    if (!this.#runSession.activeLocked) {
      const unlock = () => this.#canvasPort.unlock();
      if (typeof this.#canvasPort.requestFrame === "function") {
        this.#canvasPort.requestFrame(unlock);
      } else {
        unlock();
      }
    }
  }

  #isNavigationCurrent(operation) {
    return Boolean(
      this.#isNavigationActive(operation)
      && (!operation.context || this.#projectSession.matches(operation.context)),
    );
  }

  #isNavigationActive(operation) {
    return Boolean(
      !this.#disposed
      && operation
      && operation.generation === this.#navigationGeneration
      && this.#snapshot.navigation.operationId === operation.operationId,
    );
  }

  #deferCanvasCommand(kind, run, options = {}) {
    if (typeof this.#canvasPort.deferCommand !== "function") return null;
    let resolveDeferred;
    const outcome = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    const deferred = this.#canvasPort.deferCommand(
      kind,
      () => {
        Promise.resolve(run()).then(
          resolveDeferred,
          (cause) => resolveDeferred(rejected(
            "VERSION_DEFERRED_COMMAND_REJECTED",
            this.#codecs.errorMessage(cause, "延后的版本操作失败。"),
          )),
        );
      },
      {
        ...options,
        onDiscard: () => resolveDeferred(blocked(
          "VERSION_DEFERRED_COMMAND_DISCARDED",
          "当前项目已经变化，延后的版本操作没有执行。",
        )),
      },
    );
    return deferred ? outcome : null;
  }

  #readyRun(run) {
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || !run.candidateVersionId
      || !this.#readyCandidate(run)
      || !this.#isCurrentReadyRun(run)
    ) return null;
    return run;
  }

  #readyCandidate(run) {
    const payload = isRecord(run?.readyPayload) ? run.readyPayload : null;
    const candidate = isRecord(payload?.candidate) ? payload.candidate : null;
    const candidateId = String(payload?.candidateId || "");
    if (
      !candidate
      || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(candidateId)
      || String(candidate.candidateId || "") !== candidateId
      || String(run?.projectId || "") !== String(candidate.projectId || "")
      || String(run?.documentId || "") !== String(candidate.documentId || "")
      || String(run?.requestId || "") !== String(candidate.requestId || "")
      || String(run?.attemptId || "") !== String(candidate.attemptId || "")
      || String(run?.candidateVersionId || "") !== String(candidate.proposedVersionId || "")
      || (
        run?.sourceWorkingCopyId
        && String(run.sourceWorkingCopyId) !== String(candidate.sourceWorkingCopyId || "")
      )
    ) return null;
    return Object.freeze({ ...candidate, candidateId });
  }

  #isCurrentReadyRun(run) {
    return Boolean(
      this.#runMatches(this.#runSession.activeRun, run)
      && this.#runSession.activeRun?.status === "ready-to-open",
    );
  }

  #runMatches(left, right) {
    return sameRun(left, right, this.#codecs.sameSourcePath);
  }

  #runIdentity(run) {
    return Object.freeze({
      projectId: String(run?.projectId || ""),
      documentId: String(run?.documentId || ""),
      requestId: String(run?.requestId || ""),
      attemptId: String(run?.attemptId || ""),
      sourcePath: String(run?.sourcePath || ""),
    });
  }

  #nextOperationId(kind) {
    this.#operationSequence += 1;
    return [
      "version",
      String(kind),
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #setNavigation(phase, operationId, generation = this.#navigationGeneration) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      navigation: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
        generation,
      }),
    });
    this.#canvasPort.onNavigationChange(phase !== "idle");
    this.#publishSnapshot();
  }

  #setReview(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      review: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
      }),
    });
    this.#publishSnapshot();
  }

  #publishSnapshot() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation subscribers cannot alter Version authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze({ ...event });
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation listeners cannot alter Version authority.
      }
    }
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackReason) {
    const reason = this.#codecs.errorMessage(cause, fallbackReason);
    if (
      (isBridgeRequestError(cause) && cause.outcome === "unknown")
      || cause?.projectOutcome === "unknown"
    ) {
      return unknown(operationId, reason);
    }
    return rejected(errorCode(cause, fallbackCode), reason);
  }
}
