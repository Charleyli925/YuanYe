import { createDraftOperationId, isDraftOperationId, rebaseDraftMutation } from "../domain/draft-aggregate.js";
import { isBridgeRequestError } from "./bridge-client.js";
import { createCommentWorkflowCodecs } from "./comment-workflow-codecs.js";
import { isSavableCommentTarget, planCommentCommit } from "./comment/commit-plan.js";
import { normalizeRuntimeVisualHint } from "../lib/runtime-comment-hint.js";

function commentSourceTarget(target) {
  const sourceTarget = target?.commentAnchor || target || null;
  if (!sourceTarget) return null;
  const { commentAnchor, visualHint, ...anchor } = sourceTarget;
  void commentAnchor; void visualHint;
  if (target?.textLocator && !anchor.textLocator) anchor.textLocator = target.textLocator;
  return anchor;
}

function commentVisualHint(target) {
  return normalizeRuntimeVisualHint(target?.visualHint);
}

function frozenItems(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
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

function sameContext(left, right) {
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({ status: "blocked", code, reason });
}

function rejected(code, reason) {
  return Object.freeze({ status: "rejected", code, reason });
}

function unknown(operationId, reason) {
  return Object.freeze({ status: "unknown", operationId, reason });
}

function stale(context, operationId = "") {
  return Object.freeze({
    status: "stale",
    identity: Object.freeze({
      operationId: String(operationId || ""),
      epoch: Number(context?.epoch || 0),
      sourcePath: String(context?.sourcePath || ""),
      expectedSourceSha256: null,
    }),
  });
}

function registrationContext(outcome) {
  return outcome?.status === "succeeded" ? copyContext(outcome.value) : null;
}

function attachmentTargetIsCurrent(commentSession, target) {
  if (target?.kind === "composer") {
    return commentSession.composerCommentId === target.commentId;
  }
  if (target?.kind === "comment") {
    return Boolean(
      commentSession.editSession?.commentId === target.commentId
      && commentSession.comments.some(
        (comment) => comment.commentId === target.commentId,
      ),
    );
  }
  return false;
}

function attachmentById(attachments, attachmentId) {
  return (attachments || []).find(
    (attachment) => attachment?.attachmentId === attachmentId,
  ) || null;
}

function composerState(commentSession) {
  const target = commentSession.composerTarget;
  return Object.freeze({
    target,
    targetId: String(target?.id || ""),
    commentId: String(commentSession.composerCommentId || ""),
    draft: String(commentSession.composerDraft || ""),
    attachments: frozenItems(commentSession.composerAttachments),
  });
}

function composerStateIsCurrent(state, commentSession) {
  const currentAttachments = commentSession.composerAttachments;
  return Boolean(
    state
    && state.targetId === String(commentSession.composerTarget?.id || "")
    && state.commentId === String(commentSession.composerCommentId || "")
    && state.draft === String(commentSession.composerDraft || "")
    && state.attachments.length === currentAttachments.length
    && state.attachments.every(
      (attachment, index) => attachment === currentAttachments[index],
    ),
  );
}

function attachmentIdentity(context, target, operationId) {
  return Object.freeze({
    context: copyContext(context),
    target: Object.freeze({
      kind: target?.kind === "comment" ? "comment" : "composer",
      commentId: String(target?.commentId || ""),
    }),
    operationId: String(operationId || ""),
  });
}

function safeDate(now) {
  const value = new Date(Number(now) || Date.now());
  return Number.isNaN(value.getTime())
    ? new Date(0).toISOString()
    : value.toISOString();
}

function normalizedAttachmentInput(value) {
  if (!value || typeof value !== "object") return null;
  const byteLength = Number(value.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) return null;
  const fileName = String(value.fileName || "").trim() || "附件";
  const mediaType = String(value.mediaType || "").trim()
    || "application/octet-stream";
  return {
    fileName,
    mediaType,
    byteLength,
    kind: value.kind === "image" ? "image" : "file",
    dataBase64: typeof value.dataBase64 === "string" ? value.dataBase64 : null,
    sourceFile: value.sourceFile,
  };
}

function draftProjection({ draftSession, uploadCount, error }) {
  const state = draftSession.inspect();
  return Object.freeze({
    attachmentUploadCount: Math.max(0, Number(uploadCount) || 0),
    draft: Object.freeze({
      active: Boolean(state.active),
      revision: Number(state.revision || 0),
      pending: Boolean(state.pending),
      writing: Boolean(state.writing),
      error: error || null,
    }),
  });
}

// CommentWorkflow owns only application operations: Draft snapshots/recovery,
// attachment staging and their stale-result fences. CommentSession remains the
// disposable working copy; DraftSession remains the only durable CAS owner.
export class CommentWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #draftSession;
  #versionSession;
  #runSession;
  #recoveryStore;
  #attachmentBinaryPort;
  #codecs;
  #clock;
  #listeners = new Set();
  #eventListeners = new Set();
  #commentUnsubscribe = null;
  #uploadCount = 0;
  #attachmentGeneration = 0;
  #attachmentSequence = 0;
  #commentSequence = 0;
  #recoverySequence = 0;
  #recoveryOperationId = null;
  #draftError = null;
  #snapshot;
  #disposed = false;

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    runSession,
    codecs,
    ports = {},
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.attachment !== "function"
      || typeof bridgeClient.saveAttachment !== "function"
      || typeof bridgeClient.deleteAttachment !== "function"
    ) {
      throw new TypeError("CommentWorkflow requires attachment Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("CommentWorkflow requires registration authority.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("CommentWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.update !== "function") {
      throw new TypeError("CommentWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.subscribe !== "function") {
      throw new TypeError("CommentWorkflow requires CommentSession subscriptions.");
    }
    if (!draftSession || typeof draftSession.createSnapshot !== "function") {
      throw new TypeError("CommentWorkflow requires DraftSession injection.");
    }
    if (!versionSession || !versionSession.snapshot) {
      throw new TypeError("CommentWorkflow requires VersionSession injection.");
    }
    if (!runSession || typeof runSession.activeLocked !== "boolean") {
      throw new TypeError("CommentWorkflow requires RunSession injection.");
    }
    if (
      !ports.recoveryStore
      || typeof ports.recoveryStore.readRecords !== "function"
      || typeof ports.recoveryStore.write !== "function"
      || typeof ports.recoveryStore.remove !== "function"
    ) {
      throw new TypeError("CommentWorkflow requires a RecoveryStorePort.");
    }
    if (
      !ports.attachmentBinary
      || typeof ports.attachmentBinary.prepare !== "function"
    ) {
      throw new TypeError("CommentWorkflow requires an AttachmentBinaryPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("CommentWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#recoveryStore = ports.recoveryStore;
    this.#attachmentBinaryPort = ports.attachmentBinary;
    this.#codecs = createCommentWorkflowCodecs(codecs);
    this.#clock = clock;
    this.#snapshot = draftProjection({
      draftSession: this.#draftSession,
      uploadCount: this.#uploadCount,
      error: this.#draftError,
    });
    this.#draftSession.setObserver((event) => this.#handleDraftSessionEvent(event));
    this.#commentUnsubscribe = this.#commentSession.subscribe(() => {
      this.queueDraft();
    });
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("CommentWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("CommentWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#attachmentGeneration += 1;
    this.#commentUnsubscribe?.();
    this.#commentUnsubscribe = null;
    this.#draftSession.setObserver(null);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  get attachmentUploadCount() {
    return this.#uploadCount;
  }

  resetForProjectTransition() {
    this.#attachmentGeneration += 1;
    this.#uploadCount = 0;
    this.#recoveryOperationId = null;
    this.#draftError = null;
    this.#publishSnapshot();
  }

  reconcileAuthority() {
    return this.queueDraft();
  }

  inspectAttachment() {
    return this.#uploadCount > 0
      ? { state: "pending", reason: "评论附件仍在写入项目记录。" }
      : { state: "resolved" };
  }

  async waitForAttachments() {
    if (this.#uploadCount === 0) return true;
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.attachmentUploadCount !== 0) return;
        unsubscribe();
        resolve(true);
      });
    });
  }

  inspectDraft({ boundary, projectLoadError = false } = {}) {
    if (
      (this.#runSession.activeLocked && boundary !== "submit")
      || projectLoadError
    ) return { state: "resolved" };
    const context = this.#projectSession.context;
    if (!context) {
      return this.#hasDraftMaterial()
        ? { state: "pending", reason: "正在为本轮评论建立唯一项目身份。" }
        : { state: "resolved" };
    }
    const state = this.#draftSession.inspect();
    if (!state.active) {
      return { state: "pending", reason: "正在重新核对本轮评论的项目身份。" };
    }
    if (state.pending || state.writing || state.error) {
      return { state: "pending", reason: "本轮评论或编辑审计仍未安全记录。" };
    }
    return { state: "resolved" };
  }

  async drainDraft({ boundary, projectLoadError = false } = {}) {
    if (
      (this.#runSession.activeLocked && boundary !== "submit")
      || projectLoadError
    ) return true;
    const outcome = await this.flushDraft({ boundary });
    if (outcome.status === "succeeded") return true;
    if (outcome.status === "stale") return false;
    throw new Error(outcome.reason || "本轮评论或编辑审计没有完成安全记录。");
  }

  queueDraft() {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    const snapshot = this.#createCurrentDraftSnapshot();
    if (!snapshot) {
      this.#publishSnapshot();
      return blocked("DRAFT_CONTEXT_UNAVAILABLE", "评论尚未绑定可持久化的项目身份。");
    }
    this.#recoveryOperationId = null;
    this.#persistDraftRecovery(snapshot);
    if (!this.#runSession.activeLocked) {
      void this.#drainSnapshot(snapshot);
    }
    this.#publishSnapshot();
    return succeeded({ queued: true, operationId: snapshot.operationId });
  }

  async flushDraft({ boundary, snapshot } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    if (this.#runSession.activeLocked && boundary !== "submit") {
      return succeeded({ idle: true });
    }
    if (!this.#projectSession.context && !this.#hasDraftMaterial()) {
      return succeeded({ idle: true });
    }
    let context = this.#projectSession.context;
    if (!context) {
      const registered = await this.#ensureRegistered();
      const registeredContext = registrationContext(registered);
      if (!registeredContext) return registered;
      context = registeredContext;
    } else if (!this.#draftSession.isActive(context)) {
      const registered = await this.#ensureRegistered({
        sourcePath: context.sourcePath,
        expectedSourceSha256: this.#documentSession.persistedSourceSha256,
        adoptCanonicalSource: false,
      });
      const registeredContext = registrationContext(registered);
      if (!registeredContext || !this.#draftSession.isActive(registeredContext)) {
        return registeredContext
          ? blocked("DRAFT_AUTHORITY_UNAVAILABLE", "评论草稿权威暂时无法恢复。")
          : registered;
      }
      context = registeredContext;
    }
    if (!this.#isCurrentContext(context)) return stale(context);
    const write = snapshot && sameContext(snapshot, context)
      ? snapshot
      : this.#createCurrentDraftSnapshot(context);
    if (!write) {
      return blocked("DRAFT_CONTEXT_UNAVAILABLE", "评论会话与当前项目身份不一致。");
    }
    this.#recoveryOperationId = null;
    this.#persistDraftRecovery(write);
    return this.#drainSnapshot(write);
  }

  beginComposer({ target, commentId, resume = false } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    if (!target) {
      return blocked("COMMENT_TARGET_MISSING", "请先选择要评论的内容。");
    }
    const nextCommentId = String(
      commentId || this.#commentSession.composerCommentId || this.#nextCommentId(),
    );
    if (resume) {
      this.#commentSession.update({
        ...(this.#commentSession.composerCommentId
          ? {}
          : { composerCommentId: nextCommentId }),
        composerTarget: target,
      });
    } else {
      this.#commentSession.update({
        composerDraft: "",
        composerCommentId: nextCommentId,
        composerAttachments: [],
        composerTarget: target,
      });
    }
    return succeeded({
      target: this.#commentSession.composerTarget,
      commentId: this.#commentSession.composerCommentId,
    });
  }

  updateDraft(draft) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    this.#commentSession.setComposerDraft(String(draft ?? ""));
    return succeeded({ draft: this.#commentSession.composerDraft });
  }

  rebindComposerTarget(target) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    if (!target) {
      return blocked("COMMENT_TARGET_MISSING", "请先选择要评论的内容。");
    }
    this.#commentSession.setComposerTarget(target);
    return succeeded({ target: this.#commentSession.composerTarget });
  }

  clearComposer() {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    this.#commentSession.clearComposer();
    return succeeded({});
  }

  beginEdit({ commentId } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    const current = this.#commentSession.comments.find(
      (comment) => comment.commentId === commentId,
    );
    if (!current) {
      return blocked("COMMENT_MISSING", "这条评论已经不存在。");
    }
    const existing = this.#commentSession.editSession;
    if (existing?.commentId === commentId) {
      return succeeded({ session: existing });
    }
    const nextSession = {
      commentId: current.commentId,
      baselineText: current.text,
      baselineAttachments: [...(current.attachments ?? [])],
      draftText: current.text,
      draftAttachments: [...(current.attachments ?? [])],
    };
    this.#commentSession.setEditSession(nextSession);
    return succeeded({ session: nextSession });
  }

  updateEditDraft(draftText) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    const current = this.#commentSession.editSession;
    if (!current) {
      return blocked("COMMENT_EDIT_MISSING", "当前评论修改已经失效。");
    }
    const nextSession = { ...current, draftText: String(draftText ?? "") };
    this.#commentSession.setEditSession(nextSession);
    return succeeded({ session: nextSession });
  }

  clearEditSession() {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    this.#commentSession.setEditSession(null);
    return succeeded({});
  }

  rebindCommentTarget({ commentId, target } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    if (!commentId || !target) {
      return blocked("COMMENT_TARGET_MISSING", "请先选择要评论的内容。");
    }
    if (!isSavableCommentTarget(target)) {
      return blocked("COMMENT_TARGET_UNSAFE", "当前内容暂时无法建立安全的评论位置。");
    }
    const current = this.#commentSession.comments.find(
      (comment) => comment.commentId === commentId,
    );
    if (!current) {
      return blocked("COMMENT_MISSING", "这条评论已经不存在。");
    }
    const nextTarget = {
      ...commentSourceTarget(target),
      id: current.sourceAnchor.id,
    };
    const visualHint = commentVisualHint(target);
    const nextComments = this.#commentSession.comments.map((comment) => (
      comment.commentId === commentId
        ? (() => {
            const nextComment = {
              ...comment,
              sourceAnchor: nextTarget,
              updatedAt: safeDate(this.#clock.now()),
            };
            if (visualHint) nextComment.visualHint = visualHint;
            else delete nextComment.visualHint;
            return nextComment;
          })()
        : comment
    ));
    this.#commentSession.setComments(nextComments);
    return succeeded({
      comment: nextComments.find((comment) => comment.commentId === commentId),
      comments: nextComments,
      target: nextTarget,
    });
  }

  applyCommentItems(comments) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    this.#commentSession.setComments(comments);
    return succeeded({ comments: this.#commentSession.comments });
  }

  applyWorkingCopy(input) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    return succeeded(this.#commentSession.update(input));
  }

  confirmEdit(input) {
    return this.editComment(input);
  }

  async commitComment({ commentId } = {}) {
    const composer = composerState(this.#commentSession);
    const commitPlan = planCommentCommit({
      disposed: this.#disposed,
      target: composer.target,
      uploadCount: this.#uploadCount,
      text: composer.draft,
      attachmentCount: composer.attachments.length,
    });
    if (commitPlan.kind === "reject") {
      return blocked(commitPlan.code, commitPlan.reason);
    }
    const target = composer.target;
    const text = composer.draft.trim();
    const attachments = [...composer.attachments];
    const sourcePath = this.#projectSession.sourcePath;
    if (sourcePath) {
      const registered = await this.#ensureRegistered({ sourcePath });
      if (registered.status !== "succeeded") return registered;
    }
    const context = this.#projectSession.context;
    if (context && !this.#isCurrentContext(context)) return stale(context);
    // Registration is asynchronous. Do not clear a newer composer working copy
    // after the first save has waited for its project authority.
    if (!composerStateIsCurrent(composer, this.#commentSession)) {
      return stale(
        context || { sourcePath, epoch: this.#projectSession.epoch },
        "composer_changed",
      );
    }
    const currentTarget = this.#commentSession.composerTarget;
    if (
      !currentTarget
      || currentTarget.id !== target.id
      || !isSavableCommentTarget(currentTarget)
      || this.#uploadCount > 0
    ) return stale(context || { sourcePath, epoch: this.#projectSession.epoch });

    const nextCommentId = String(commentId || this.#nextCommentId());
    const now = safeDate(this.#clock.now());
    const commentTarget = this.#codecs.independentCommentTarget(
      commentSourceTarget(currentTarget),
      nextCommentId,
    );
    const visualHint = commentVisualHint(currentTarget);
    const comment = {
      commentId: nextCommentId,
      createdAt: now,
      updatedAt: now,
      sourceAnchor: commentTarget,
      ...(visualHint ? { visualHint } : {}),
      text,
      ...(attachments.length > 0
        ? { attachments: attachments.map(this.#codecs.persistedAttachment) }
        : {}),
      basedOnVersionId: this.#versionSession.snapshot.currentBasedOnVersionId,
    };
    this.#commentSession.update({
      comments: [...this.#commentSession.comments, comment],
      deletedCommentIds: [...this.#commentSession.deletedCommentIds]
        .filter((candidate) => candidate !== nextCommentId),
      composerDraft: "",
      composerCommentId: null,
      composerAttachments: [],
      composerTarget: null,
    });
    this.queueDraft();
    return succeeded({ comment, context: copyContext(context) });
  }

  editComment({ commentId } = {}) {
    const session = this.#commentSession.editSession;
    const current = this.#commentSession.comments.find(
      (comment) => comment.commentId === commentId,
    );
    if (!current || !session || session.commentId !== commentId) {
      return blocked("COMMENT_EDIT_MISSING", "当前评论修改已经失效。");
    }
    if (this.#uploadCount > 0) {
      return blocked("ATTACHMENT_UPLOAD_PENDING", "请等待附件添加完成后再确认修改。");
    }
    const text = String(session.draftText || "").trim();
    const attachments = [...(session.draftAttachments || [])];
    if (!text && attachments.length === 0) {
      return blocked("COMMENT_EMPTY", "评论需要保留正文或附件。");
    }
    const nextAttachmentIds = new Set(
      attachments.map((attachment) => attachment.attachmentId),
    );
    const removedAttachments = (session.baselineAttachments || []).filter(
      (attachment) => !nextAttachmentIds.has(attachment.attachmentId),
    );
    const context = copyContext(this.#projectSession.context);
    const nextComments = this.#commentSession.comments.map((comment) => (
      comment.commentId === commentId
        ? {
            ...comment,
            text,
            ...(attachments.length > 0
              ? { attachments: attachments.map(this.#codecs.persistedAttachment) }
              : { attachments: undefined }),
            updatedAt: safeDate(this.#clock.now()),
          }
        : comment
    ));
    this.#commentSession.update({ comments: nextComments, editSession: null });
    this.queueDraft();
    for (const attachment of removedAttachments) {
      void this.deleteAttachment({ attachment, context });
    }
    return succeeded({
      comment: nextComments.find((comment) => comment.commentId === commentId),
      removedAttachments,
      context,
    });
  }

  deleteComment({ commentId } = {}) {
    const deleted = this.#commentSession.comments.find(
      (comment) => comment.commentId === commentId,
    ) || null;
    const editSession = this.#commentSession.editSession?.commentId === commentId
      ? this.#commentSession.editSession
      : null;
    if (!deleted && !editSession) {
      return blocked("COMMENT_MISSING", "这条评论已经不存在。");
    }
    const context = copyContext(this.#projectSession.context);
    const attachments = new Map(
      [
        ...(deleted?.attachments || []),
        ...(editSession?.draftAttachments || []),
      ].map((attachment) => [attachment.attachmentId, attachment]),
    );
    this.#commentSession.update({
      comments: this.#commentSession.comments.filter(
        (comment) => comment.commentId !== commentId,
      ),
      deletedCommentIds: [
        ...this.#commentSession.deletedCommentIds,
        String(commentId || ""),
      ].filter(Boolean),
      ...(editSession ? { editSession: null } : {}),
    });
    this.queueDraft();
    for (const attachment of attachments.values()) {
      void this.deleteAttachment({ attachment, context });
    }
    return succeeded({ deleted, editSession, attachments: [...attachments.values()], context });
  }

  deleteCommentsForElementIds({ elementIds } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    const removedElementIds = new Set(
      (Array.isArray(elementIds) ? elementIds : [])
        .map((elementId) => String(elementId || ""))
        .filter(Boolean),
    );
    if (removedElementIds.size === 0) {
      return succeeded({ deleted: [], composerDiscarded: false, attachments: [] });
    }
    const targetWasRemoved = (target) => removedElementIds.has(
      String(commentSourceTarget(target)?.elementId || ""),
    );
    const deleted = this.#commentSession.comments.filter((comment) => targetWasRemoved(comment.sourceAnchor));
    const deletedIds = new Set(deleted.map((comment) => comment.commentId));
    const composerDiscarded = Boolean(
      this.#commentSession.composerTarget
      && targetWasRemoved(this.#commentSession.composerTarget),
    );
    const editSession = this.#commentSession.editSession
      && deletedIds.has(this.#commentSession.editSession.commentId)
      ? this.#commentSession.editSession
      : null;
    if (deleted.length === 0 && !composerDiscarded && !editSession) {
      return succeeded({ deleted: [], composerDiscarded: false, attachments: [] });
    }
    const context = copyContext(this.#projectSession.context);
    const attachments = new Map(
      [
        ...deleted.flatMap((comment) => comment.attachments || []),
        ...(editSession?.draftAttachments || []),
        ...(composerDiscarded ? this.#commentSession.composerAttachments : []),
      ].map((attachment) => [attachment.attachmentId, attachment]),
    );
    this.#commentSession.update({
      comments: this.#commentSession.comments.filter(
        (comment) => !deletedIds.has(comment.commentId),
      ),
      deletedCommentIds: [
        ...new Set([
          ...this.#commentSession.deletedCommentIds,
          ...deletedIds,
          ...(composerDiscarded && this.#commentSession.composerCommentId
            ? [this.#commentSession.composerCommentId]
            : []),
        ]),
      ],
      ...(editSession ? { editSession: null } : {}),
      ...(composerDiscarded
        ? {
            composerDraft: "",
            composerCommentId: null,
            composerAttachments: [],
            composerTarget: null,
          }
        : {}),
    });
    this.queueDraft();
    for (const attachment of attachments.values()) {
      void this.deleteAttachment({ attachment, context });
    }
    return succeeded({
      deleted,
      composerDiscarded,
      editSession,
      attachments: [...attachments.values()],
      context,
    });
  }

  discardComposer() {
    if (this.#uploadCount > 0) {
      return blocked("ATTACHMENT_UPLOAD_PENDING", "请等待附件添加完成后再删除草稿。");
    }
    const commentId = this.#commentSession.composerCommentId;
    const attachments = [...this.#commentSession.composerAttachments];
    const context = copyContext(this.#projectSession.context);
    if (commentId) this.#commentSession.markDeleted(commentId);
    this.#commentSession.clearComposer();
    this.queueDraft();
    for (const attachment of attachments) {
      void this.deleteAttachment({ attachment, context });
    }
    return succeeded({ commentId, attachments, context });
  }

  cancelCommentEdit({ commentId } = {}) {
    if (this.#uploadCount > 0) {
      return blocked("ATTACHMENT_UPLOAD_PENDING", "请等待附件添加完成后再取消修改。");
    }
    const session = this.#commentSession.editSession;
    if (!session || (commentId && session.commentId !== commentId)) {
      return blocked("COMMENT_EDIT_MISSING", "当前评论修改已经失效。");
    }
    const baselineIds = new Set(
      (session.baselineAttachments || []).map((attachment) => attachment.attachmentId),
    );
    const stagedAttachments = (session.draftAttachments || []).filter(
      (attachment) => !baselineIds.has(attachment.attachmentId),
    );
    const context = copyContext(this.#projectSession.context);
    this.#commentSession.setEditSession(null);
    this.queueDraft();
    for (const attachment of stagedAttachments) {
      void this.deleteAttachment({ attachment, context });
    }
    return succeeded({ commentId: session.commentId, stagedAttachments, context });
  }

  removeComposerAttachment({ attachmentId } = {}) {
    const attachment = attachmentById(
      this.#commentSession.composerAttachments,
      attachmentId,
    );
    if (!attachment) {
      return blocked("ATTACHMENT_MISSING", "该附件已经不在当前草稿中。");
    }
    const context = copyContext(this.#projectSession.context);
    this.#commentSession.setComposerAttachments(
      this.#commentSession.composerAttachments.filter(
        (item) => item.attachmentId !== attachment.attachmentId,
      ),
    );
    this.queueDraft();
    void this.deleteAttachment({ attachment, context });
    return succeeded({ attachment, context });
  }

  removeEditAttachment({ commentId, attachmentId } = {}) {
    const session = this.#commentSession.editSession;
    if (!session || session.commentId !== commentId) {
      return blocked("COMMENT_EDIT_MISSING", "当前评论修改已经失效。");
    }
    const attachment = attachmentById(session.draftAttachments, attachmentId);
    if (!attachment) {
      return blocked("ATTACHMENT_MISSING", "该附件已经不在当前修改中。");
    }
    const baseline = attachmentById(session.baselineAttachments, attachmentId);
    const context = copyContext(this.#projectSession.context);
    this.#commentSession.setEditSession({
      ...session,
      draftAttachments: session.draftAttachments.filter(
        (item) => item.attachmentId !== attachment.attachmentId,
      ),
    });
    this.queueDraft();
    if (!baseline) void this.deleteAttachment({ attachment, context });
    return succeeded({ attachment, deleted: !baseline, context });
  }

  async uploadAttachments({ files = [], target, source } = {}) {
    if (this.#disposed) {
      return blocked("COMMENT_WORKFLOW_DISPOSED", "评论工作流已停止。");
    }
    if (!attachmentTargetIsCurrent(this.#commentSession, target)) {
      return stale(this.#projectSession.context, "attachment_target");
    }
    const acceptedFiles = Array.isArray(files) ? files : [];
    if (acceptedFiles.length === 0) return succeeded({ attachments: [], failures: [] });
    let context = copyContext(this.#projectSession.context);
    const sourcePath = this.#projectSession.sourcePath;
    if (!sourcePath) {
      return blocked("ATTACHMENT_SOURCE_MISSING", "附件需要保存在当前项目记录中；请先打开本地 HTML。");
    }
    const registered = await this.#ensureRegistered({ sourcePath });
    if (registered.status !== "succeeded") return registered;
    context = copyContext(registered.value);
    if (!context || !this.#isCurrentContext(context)) return stale(context);
    const attachments = [];
    const failures = [];
    const generation = this.#attachmentGeneration;
    for (const file of acceptedFiles) {
      const result = await this.#uploadAttachment({
        file,
        target,
        source,
        context,
        generation,
      });
      if (result.status === "succeeded") {
        attachments.push(result.value);
      } else if (result.status === "stale" || result.status === "unknown") {
        return result;
      } else {
        failures.push({
          fileName: String(file?.name || "未命名文件"),
          reason: result.reason || "附件没有加入评论。",
          status: result.status,
        });
      }
    }
    return succeeded({ attachments, failures });
  }

  async readAttachment({ attachment } = {}) {
    const context = copyContext(this.#projectSession.context);
    if (!context || !this.#isCurrentContext(context)) {
      return blocked("ATTACHMENT_CONTEXT_UNAVAILABLE", "当前评论还没有绑定本地项目。");
    }
    const operationId = this.#nextOperationId("attachment-read");
    try {
      const blob = await this.#bridgeClient.attachment(
        context.sourcePath,
        attachment?.relativePath,
      );
      if (!this.#isCurrentContext(context) || !this.#attachmentExists(attachment)) {
        return stale(context, operationId);
      }
      return succeeded(blob);
    } catch (cause) {
      if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
        return unknown(operationId, String(cause.message || "附件读取结果未知。"));
      }
      return rejected(
        isBridgeRequestError(cause) && cause.code
          ? cause.code
          : "ATTACHMENT_READ_REJECTED",
        this.#codecs.errorMessage(cause, "附件暂时无法读取。"),
      );
    }
  }

  async deleteAttachment({ attachment, context } = {}) {
    const capturedContext = copyContext(context || this.#projectSession.context);
    if (!capturedContext || !attachment?.relativePath) {
      return blocked("ATTACHMENT_CONTEXT_UNAVAILABLE", "附件没有可验证的项目身份。");
    }
    const operationId = this.#nextOperationId("attachment-delete");
    try {
      await this.#bridgeClient.deleteAttachment({
        projectId: capturedContext.projectId,
        documentId: capturedContext.documentId,
        sourcePath: capturedContext.sourcePath,
        relativePath: attachment.relativePath,
      });
      return this.#isCurrentContext(capturedContext)
        ? succeeded({ removed: true })
        : stale(capturedContext, operationId);
    } catch (cause) {
      const outcome = isBridgeRequestError(cause) && cause.outcome === "unknown"
        ? unknown(operationId, String(cause.message || "附件清理结果未知。"))
        : rejected(
          isBridgeRequestError(cause) && cause.code
            ? cause.code
            : "ATTACHMENT_DELETE_REJECTED",
          this.#codecs.errorMessage(cause, "项目中的附件副本暂时无法清理。"),
        );
      this.#emitEvent({
        type: "attachment-cleanup-failed",
        context: capturedContext,
        attachment,
        outcome,
      });
      return outcome;
    }
  }

  recoverDraft({
    context,
    serverComments = [],
    serverEvents = [],
    serverDraftRevision = 0,
    serverDeletedCommentIds = [],
    serverAppliedOperationIds = [],
    serverBasedOnVersionId = null,
  } = {}) {
    const currentContext = copyContext(context);
    if (!currentContext) {
      return {
        comments: frozenItems(serverComments),
        deletedCommentIds: [],
        changeEvents: frozenItems(serverEvents),
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: frozenItems(),
        composerTarget: null,
        commentEdit: null,
      };
    }
    const keys = this.#recoveryKeys(currentContext);
    let latest = null;
    for (const { value: parsed } of this.#recoveryStore.readRecords(keys)) {
      if (
        !this.#codecs.isRecord(parsed)
        || String(parsed.sourcePath || "") !== currentContext.sourcePath
        || String(parsed.projectId || "") !== currentContext.projectId
        || String(parsed.documentId || "") !== currentContext.documentId
        || String(parsed.basedOnVersionId || "")
          !== String(serverBasedOnVersionId || "")
      ) continue;
      if (!latest || Number(parsed.localSequence || 0) > Number(latest.localSequence || 0)) {
        latest = parsed;
      }
    }
    if (!latest) {
      this.#recoveryOperationId = null;
      return {
        comments: frozenItems(serverComments),
        deletedCommentIds: [],
        changeEvents: frozenItems(serverEvents),
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: frozenItems(),
        composerTarget: null,
        commentEdit: null,
      };
    }
    const localComments = Array.isArray(latest.comments)
      ? this.#codecs.commentsFromRecords(latest.comments)
      : [];
    const operationId = isDraftOperationId(latest.operationId)
      ? String(latest.operationId)
      : createDraftOperationId();
    const operationAlreadyApplied = (serverAppliedOperationIds || []).includes(operationId);
    const localDeletedCommentIds = new Set(
      Array.isArray(latest.deletedCommentIds)
        ? latest.deletedCommentIds.map(String)
        : [],
    );
    const rebased = rebaseDraftMutation({
      operationId,
      expectedDraftRevision: Number(latest.baseDraftRevision || 0),
      comments: operationAlreadyApplied ? serverComments : localComments,
      changeEvents: Array.isArray(latest.changeEvents)
        ? (
            operationAlreadyApplied
              ? serverEvents
              : this.#codecs.changesFromDraftRecords(latest.changeEvents)
          )
        : serverEvents,
      deletedCommentIds: operationAlreadyApplied
        ? serverDeletedCommentIds
        : [...localDeletedCommentIds],
    }, {
      draftRevision: Number(serverDraftRevision || 0),
      comments: serverComments,
      changeEvents: serverEvents,
      deletedCommentIds: serverDeletedCommentIds,
    });
    this.#recoveryOperationId = operationAlreadyApplied ? null : operationId;
    const commentEdit = this.#codecs.isRecord(latest.commentEdit)
      && /^comment_[A-Za-z0-9_-]+$/.test(String(latest.commentEdit.commentId || ""))
      ? {
          commentId: String(latest.commentEdit.commentId),
          draftText: String(latest.commentEdit.draftText || ""),
          draftAttachments: Array.isArray(latest.commentEdit.draftAttachments)
            ? latest.commentEdit.draftAttachments
                .map((attachment) => this.#codecs.attachmentFromRecord(attachment))
                .filter(Boolean)
            : [],
        }
      : null;
    return {
      comments: rebased.comments,
      deletedCommentIds: operationAlreadyApplied ? [] : rebased.deletedCommentIds,
      changeEvents: rebased.changeEvents,
      composerDraft: typeof latest.composerDraft === "string"
        ? latest.composerDraft
        : "",
      composerCommentId: /^comment_[A-Za-z0-9_-]+$/.test(
        String(latest.composerCommentId || ""),
      ) ? String(latest.composerCommentId) : null,
      composerAttachments: Array.isArray(latest.composerAttachments)
        ? latest.composerAttachments
            .map((attachment) => this.#codecs.attachmentFromRecord(attachment))
            .filter(Boolean)
        : [],
      composerTarget: this.#codecs.isRecord(latest.composerTarget)
        ? this.#codecs.selectionFromRecord(latest.composerTarget)
        : null,
      commentEdit,
    };
  }

  #publishSnapshot() {
    this.#snapshot = draftProjection({
      draftSession: this.#draftSession,
      uploadCount: this.#uploadCount,
      error: this.#draftError,
    });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation subscribers cannot affect durable authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation subscribers cannot affect durable authority.
      }
    }
  }

  #hasDraftMaterial() {
    return Boolean(
      this.#commentSession.comments.length > 0
      || this.#commentSession.changeEvents.length > 0
      || this.#commentSession.deletedCommentIds.size > 0
      || this.#commentSession.composerDraft.trim()
      || this.#commentSession.composerAttachments.length > 0
      || this.#commentSession.composerTarget
      || this.#codecs.commentEditSessionHasChanges(this.#commentSession.editSession)
    );
  }

  #isCurrentContext(context) {
    return Boolean(
      !this.#disposed
      && context
      && this.#projectSession.matches(context)
      && this.#draftSession.isActive(context),
    );
  }

  #createCurrentDraftSnapshot(context = this.#draftSession.context) {
    if (!context || !this.#draftSession.isActive(context)) return null;
    return this.#draftSession.createSnapshot({
      context,
      basedOnVersionId: this.#versionSession.snapshot.currentBasedOnVersionId,
      comments: this.#commentSession.comments,
      changeEvents: this.#commentSession.changeEvents,
      deletedCommentIds: this.#commentSession.deletedCommentIds,
      operationId: this.#recoveryOperationId || undefined,
    });
  }

  async #drainSnapshot(snapshot) {
    const persisted = await this.#draftSession.drain(snapshot);
    this.#publishSnapshot();
    if (persisted) return succeeded({ revision: this.#draftSession.revision });
    const error = this.#draftSession.lastError;
    if (isBridgeRequestError(error) && error.outcome === "unknown") {
      return unknown(snapshot.operationId, String(error.message || "评论保存结果未知。"));
    }
    return rejected(
      isBridgeRequestError(error) && error.code
        ? error.code
        : "DRAFT_PERSIST_REJECTED",
      this.#codecs.errorMessage(error, "本轮评论自动恢复后仍无法记录，请稍后重试。"),
    );
  }

  #handleDraftSessionEvent(event) {
    if (this.#disposed || !event?.write || !this.#isCurrentContext(event.write)) return;
    if (event.type === "failed") {
      this.#draftError = this.#codecs.errorMessage(
        event.error,
        "本轮评论自动恢复后仍无法记录，请稍后重试。",
      );
      this.#publishSnapshot();
      this.#emitEvent({
        type: "comment-draft-persistence-failed",
        context: copyContext(event.write),
        reason: this.#draftError,
      });
      return;
    }
    if (event.type !== "acknowledged") return;
    const comments = this.#codecs.commentsFromRecords(event.authoritative.comments);
    const changeEvents = this.#codecs.changesFromDraftRecords(
      event.authoritative.changeEvents,
    );
    const state = this.#draftSession.inspect();
    this.#draftError = null;
    if (!state.pending) {
      if (event.rebaseCount > 0) {
        this.#commentSession.update({
          comments,
          changeEvents,
          deletedCommentIds: [],
        });
      } else {
        this.#commentSession.clearDeletedCommentIds();
      }
      this.#persistDraftRecovery({
        ...event.write,
        expectedDraftRevision: event.authoritative.draftRevision,
        comments,
        changeEvents,
        deletedCommentIds: [],
      });
    }
    this.#publishSnapshot();
    this.#emitEvent({
      type: "comment-draft-persisted",
      context: copyContext(event.write),
      revision: event.authoritative.draftRevision,
    });
  }

  #recoveryKeys(snapshot) {
    return [
      snapshot?.documentId ? `html-ai-draft-recovery:${snapshot.documentId}` : "",
      snapshot?.sourcePath ? `html-ai-draft-recovery:${snapshot.sourcePath}` : "",
    ].filter(Boolean);
  }

  #persistDraftRecovery(snapshot) {
    const keys = this.#recoveryKeys(snapshot || this.#projectSession.context);
    if (!snapshot) {
      this.#recoveryStore.remove(keys);
      return;
    }
    const composerText = this.#commentSession.composerDraft;
    const composerTarget = this.#commentSession.composerTarget;
    const composerAttachments = this.#commentSession.composerAttachments;
    const commentEdit = this.#codecs.commentEditSessionHasChanges(
      this.#commentSession.editSession,
    ) ? this.#commentSession.editSession : null;
    if (
      snapshot.comments.length === 0
      && snapshot.changeEvents.length === 0
      && snapshot.deletedCommentIds.length === 0
      && !composerText.trim()
      && composerAttachments.length === 0
      && !composerTarget
      && !commentEdit
    ) {
      this.#recoveryStore.remove(keys);
      return;
    }
    this.#recoveryStore.write(keys, {
      schemaVersion: "3.2.0",
      projectId: snapshot.projectId,
      documentId: snapshot.documentId,
      sourcePath: snapshot.sourcePath,
      basedOnVersionId: snapshot.basedOnVersionId,
      baseDraftRevision: snapshot.expectedDraftRevision,
      operationId: snapshot.operationId,
      localSequence: ++this.#recoverySequence,
      comments: snapshot.comments.map(this.#codecs.persistedComment),
      changeEvents: snapshot.changeEvents.map(this.#codecs.persistedChangeEvent),
      deletedCommentIds: snapshot.deletedCommentIds,
      composerDraft: composerText,
      composerCommentId: this.#commentSession.composerCommentId,
      composerAttachments: composerAttachments.map(this.#codecs.persistedAttachment),
      composerTarget: composerTarget
        ? {
            ...this.#codecs.persistedTargetRef(commentSourceTarget(composerTarget)),
            ...(commentVisualHint(composerTarget)
              ? { visualHint: commentVisualHint(composerTarget) }
              : {}),
          }
        : null,
      commentEdit: commentEdit
        ? {
            commentId: commentEdit.commentId,
            draftText: commentEdit.draftText,
            draftAttachments: commentEdit.draftAttachments.map(
              this.#codecs.persistedAttachment,
            ),
          }
        : null,
    });
  }

  async #uploadAttachment({ file, target, source, context, generation }) {
    const operationId = this.#nextOperationId("attachment-upload");
    this.#beginUpload(generation);
    try {
      const prepared = normalizedAttachmentInput(
        await this.#attachmentBinaryPort.prepare(file, {
          includeDataBase64: true,
          source,
        }),
      );
      if (!prepared) {
        return rejected("ATTACHMENT_INPUT_INVALID", "附件无法读取，请重新选择。");
      }
      if (
        generation !== this.#attachmentGeneration
        || !attachmentTargetIsCurrent(this.#commentSession, target)
        || !this.#isCurrentContext(context)
      ) return stale(context, operationId);

      const attachmentId = this.#nextAttachmentId();
      if (!prepared.dataBase64) {
        return rejected("ATTACHMENT_INPUT_INVALID", "附件没有可写入的内容。");
      }
      const payload = await this.#bridgeClient.saveAttachment({
          projectId: context.projectId,
          documentId: context.documentId,
          sourcePath: context.sourcePath,
          commentId: target.commentId,
          attachmentId,
          fileName: prepared.fileName,
          mediaType: prepared.mediaType,
          byteLength: prepared.byteLength,
          kind: prepared.kind,
          source: source === "clipboard" ? "clipboard" : "file-picker",
          dataBase64: prepared.dataBase64,
      });
      const attachment = this.#codecs.attachmentFromRecord(payload?.attachment);
      if (!attachment || attachment.attachmentId !== attachmentId) {
        return rejected("ATTACHMENT_PAYLOAD_INVALID", "附件已写入，但返回的记录不完整。" );
      }
      const identity = attachmentIdentity(context, target, operationId);
      if (
        generation !== this.#attachmentGeneration
        || !this.#isCurrentAttachmentIdentity(identity)
      ) {
        await this.deleteAttachment({ attachment, context });
        return stale(context, operationId);
      }
      if (!this.#appendAttachment(target, attachment)) {
        await this.deleteAttachment({ attachment, context });
        return stale(context, operationId);
      }
      this.queueDraft();
      const value = Object.freeze({ attachment, sourceFile: prepared.sourceFile, target });
      this.#emitEvent({ type: "attachment-uploaded", context, ...value });
      return succeeded(value);
    } catch (cause) {
      if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
        return unknown(operationId, String(cause.message || "附件写入结果未知。"));
      }
      return rejected(
        isBridgeRequestError(cause) && cause.code
          ? cause.code
          : "ATTACHMENT_SAVE_REJECTED",
        this.#codecs.errorMessage(cause, "本地项目资料暂时没有响应。"),
      );
    } finally {
      this.#endUpload(generation);
    }
  }

  #appendAttachment(target, attachment) {
    if (target.kind === "composer") {
      if (this.#commentSession.composerCommentId !== target.commentId) return false;
      this.#commentSession.setComposerAttachments([
        ...this.#commentSession.composerAttachments,
        attachment,
      ]);
      return true;
    }
    const session = this.#commentSession.editSession;
    if (
      !session
      || session.commentId !== target.commentId
      || !this.#commentSession.comments.some(
        (comment) => comment.commentId === target.commentId,
      )
    ) return false;
    this.#commentSession.setEditSession({
      ...session,
      draftAttachments: [...session.draftAttachments, attachment],
    });
    return true;
  }

  #isCurrentAttachmentIdentity(identity) {
    return Boolean(
      (
        identity.context
          ? this.#isCurrentContext(identity.context)
          : !this.#disposed
      )
      && attachmentTargetIsCurrent(this.#commentSession, identity.target),
    );
  }

  #attachmentExists(attachment) {
    const attachmentId = attachment?.attachmentId;
    if (!attachmentId) return false;
    return Boolean(
      this.#commentSession.composerAttachments.some(
        (item) => item.attachmentId === attachmentId,
      )
      || this.#commentSession.editSession?.draftAttachments?.some(
        (item) => item.attachmentId === attachmentId,
      )
      || this.#commentSession.comments.some((comment) => (
        comment.attachments || []
      ).some((item) => item.attachmentId === attachmentId)),
    );
  }

  #beginUpload(generation) {
    if (generation !== this.#attachmentGeneration) return;
    this.#uploadCount += 1;
    this.#publishSnapshot();
  }

  #endUpload(generation) {
    if (generation !== this.#attachmentGeneration) return;
    this.#uploadCount = Math.max(0, this.#uploadCount - 1);
    this.#publishSnapshot();
  }

  #nextOperationId(prefix) {
    this.#attachmentSequence += 1;
    return [
      prefix,
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#attachmentSequence.toString(36),
    ].join("_");
  }

  #nextAttachmentId() {
    this.#attachmentSequence += 1;
    return [
      "attachment",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#attachmentSequence.toString(36),
    ].join("_");
  }

  #nextCommentId() {
    this.#commentSequence += 1;
    return [
      "comment",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#commentSequence.toString(36),
    ].join("_");
  }
}
