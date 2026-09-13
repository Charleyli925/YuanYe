"use client";

import {
  memo,
  type CSSProperties,
} from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import { shouldSubmitCommentOnEnter } from "../lib/comment-rail-layout.js";
import {
  commentVisualTarget,
  insertionLabel,
  isExplicitGlobalCommentTarget,
} from "./comment-model";
import {
  composerViewFields,
  type CommentRailActions,
  type CommentRailModel,
} from "./comment-rail-contract";
import { CommentAttachmentStrip } from "./presentation";
import { formatTime } from "./project-model";

export type { CommentAttachmentTarget, OtherTabCommentGroup } from "./comment-rail-contract";

export type CommentRailViewProps = {
  model: CommentRailModel;
  actions: CommentRailActions;
};

export const CommentRailView = memo(function CommentRailView({
  model,
  actions,
}: CommentRailViewProps) {
  const {
    commentsPanelRef,
    commentsHeaderRef,
    composerRef,
    commentEditRef,
    viewMode,
    commentLayoutReady,
    commentLayoutAuthority,
    commentRailMinimumOffset,
    commentRailFollowsFocus,
    canvasDocumentHeight,
    commentRailContentHeight,
    commentRailOffset,
    commentRailStatusTop,
    commentRailMinimumTop,
    visibleCommentItems,
    draftInCurrentTab,
    hasUnsavedCommentEdit,
    otherTabCommentEntryCount,
    otherTabCommentsOpen,
    interactionLocked,
    unfinishedEditedComment,
    otherTabCommentGroups,
    activeCommentCount,
    changeEvents,
    composerInCurrentTab,
    composerTop,
    focusedCommentId,
    projectLoadError,
    draftTargetScope,
    attachmentUploadCount,
    draftTargetCanSave,
    composerMeasurementKey,
    attachmentObjectUrls,
    pendingDeleteCommentId,
    draftRecoveryTop,
    draftRecoveryMeasurementKey,
    expectedCommentLayoutTargetIds,
    sortedVisibleCommentItems,
    renderedVisibleCommentItems,
    commentTargetLayouts,
    selection,
    commentMeasurementKeys,
    visibleCommentPositions,
  } = model;
  const {
    composerOpen,
    draftTarget,
    draft,
    draftCommentId,
    draftAttachments,
    hasCollapsedCommentDraft,
    editingCommentId,
    commentEditSession,
    commentEditDraft,
    commentEditAttachments,
    relinkingTarget,
  } = composerViewFields(model.composer);
  const {
    openGlobalCommentComposer,
    resumeCurrentComposer,
    resumeCommentEdit,
    toggleOtherTabComments,
    collapseOtherTabComments,
    hideCommentComposer,
    requestDeleteComment,
    clearDeleteRequest,
    focusCommentTarget,
    cancelTargetRelink,
    onRetryProjectHydration,
    closeCommentComposer,
    beginTargetRelink,
    updateDraft: onComposerDraftChange,
    onComposerPaste,
    commit: addComment,
    ensureAttachmentObjectUrl,
    openAttachmentPreview,
    downloadAttachment,
    removeComposerAttachment,
    discardCurrentComposer,
    openAttachmentPicker,
    commentTargetIsLocatable,
    updateCommentEditDraft,
    cancelCommentEdit,
    confirmEdit: confirmCommentEdit,
    pasteImages,
    removeCommentAttachment,
    queueReviewCommentFocus,
    deleteComment,
    beginEdit: beginCommentEdit,
  } = actions;
  return (
          <aside
            ref={commentsPanelRef}
            className="comments-panel comment-rail"
            aria-label={viewMode === "history" ? "历史版本评论" : "本轮评论"}
            aria-busy={!commentLayoutReady}
            data-layout-ready={commentLayoutReady ? "true" : "false"}
            data-layout-generation={commentLayoutAuthority.viewContextGeneration}
            data-layout-text-editing={
              commentLayoutAuthority.textEditing ? "true" : undefined
            }
            data-rail-min-offset={commentRailMinimumOffset}
            data-rail-following={commentRailFollowsFocus ? "true" : "false"}
            style={{
              "--comment-rail-height": `${canvasDocumentHeight}px`,
            } as CSSProperties}
            tabIndex={-1}
          >
          <div
            className="comment-rail-content"
            style={{
              minHeight: `${commentRailContentHeight}px`,
              "--comment-rail-offset": `${commentRailOffset}px`,
            } as CSSProperties}
          >
            <header
              ref={commentsHeaderRef}
              className="comments-header comment-rail-header"
              data-has-header-actions={
                commentLayoutReady
                && (
                  draftInCurrentTab
                  || hasUnsavedCommentEdit
                  || otherTabCommentEntryCount > 0
                )
                  ? "true"
                  : undefined
              }
              data-other-tabs-open={
                commentLayoutReady && otherTabCommentsOpen
                  ? "true"
                  : undefined
              }
            >
              <div className="comment-rail-header-main">
                <div className="comment-rail-title-row">
                  <h1>评论 <span>{visibleCommentItems.length}</span></h1>
                  {viewMode === "history" ? (
                    <small>历史版本 · 只读</small>
                  ) : (
                    <button
                      className="comment-rail-global-action"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label="全局评论"
                      aria-expanded={composerOpen && isExplicitGlobalCommentTarget(draftTarget)}
                      disabled={interactionLocked}
                      onClick={openGlobalCommentComposer}
                    ><PlusIcon aria-hidden="true" size={12} weight="bold" />添加全局评论</button>
                  )}
                </div>
                {commentLayoutReady
                && (
                  draftInCurrentTab
                  || hasUnsavedCommentEdit
                  || otherTabCommentEntryCount > 0
                ) ? (
                  <div className="comment-rail-header-actions">
                  {commentLayoutReady && draftInCurrentTab ? (
                    <button
                      className="comment-header-action unsaved-comment-shortcut"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label="有一条未保存评论"
                      onClick={resumeCurrentComposer}
                    >
                      <span>未保存 1</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                  {commentLayoutReady
                  && hasUnsavedCommentEdit
                  && unfinishedEditedComment ? (
                    <button
                      className="comment-header-action unsaved-comment-edit-shortcut"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label="有一条未保存修改"
                      onClick={() => resumeCommentEdit(
                        unfinishedEditedComment.commentId,
                      )}
                    >
                      <span>未保存修改 1</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                  {commentLayoutReady && otherTabCommentEntryCount > 0 ? (
                    <button
                      className="comment-header-action other-tab-comments-toggle"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label={`其他标签页评论 ${otherTabCommentEntryCount}`}
                      aria-expanded={otherTabCommentsOpen}
                      aria-controls="other-tab-comment-groups"
                      onClick={toggleOtherTabComments}
                    >
                      <span>其他标签页 {otherTabCommentEntryCount}</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                  </div>
                ) : null}
                <span className="round-record-counts sr-only">
                  {activeCommentCount} 条评论 · {changeEvents.length} 项直接编辑记录
                </span>
              </div>
              {commentLayoutReady
              && otherTabCommentsOpen
              && otherTabCommentGroups.length > 0 ? (
                <div
                  id="other-tab-comment-groups"
                  className="other-tab-comment-groups"
                  role="region"
                  aria-label="其他标签页评论"
                >
                  {otherTabCommentGroups.map((group) => (
                    <section
                      className="other-tab-comment-group"
                      aria-label={`${group.label}的评论`}
                      key={group.key}
                    >
                      <div className="other-tab-comment-group-header">
                        <strong>{group.label}</strong>
                      </div>
                      <div className="other-tab-comment-list">
                        {group.entries.map((entry) => {
                          if (entry.kind === "draft") {
                            return (
                              <button
                                className="comment-card other-tab-comment-card draft-comment-card"
                                type="button"
                                data-html-canvas-preserve-selection="true"
                                aria-label={`${group.label}：未保存评论：${insertionLabel(entry.target)}：${entry.previewText}`}
                                key={entry.key}
                                onClick={() => {
                                  collapseOtherTabComments();
                                  window.requestAnimationFrame(resumeCurrentComposer);
                                }}
                              >
                                <span className="comment-card-header">
                                  <span className="comment-target">
                                    {insertionLabel(entry.target)}
                                  </span>
                                  <span className="unsaved-comment-status">未保存</span>
                                </span>
                                <span className="other-tab-comment-card-body">
                                  {entry.previewText}
                                </span>
                              </button>
                            );
                          }
                          return (
                            <button
                              className="comment-card other-tab-comment-card"
                              type="button"
                              data-html-canvas-preserve-selection="true"
                              aria-label={`${group.label}：${insertionLabel(entry.target)}：${entry.previewText}`}
                              key={entry.key}
                              onClick={() => {
                                collapseOtherTabComments();
                                hideCommentComposer();
                                clearDeleteRequest();
                                window.requestAnimationFrame(() => {
                                  focusCommentTarget(
                                    entry.target,
                                    entry.comment.commentId,
                                  );
                                });
                              }}
                            >
                              <span className="comment-card-header">
                                <span className="comment-target">
                                  {insertionLabel(entry.target)}
                                </span>
                                <time
                                  dateTime={
                                    entry.comment.updatedAt
                                    || entry.comment.createdAt
                                  }
                                >
                                  {formatTime(
                                    entry.comment.updatedAt
                                    || entry.comment.createdAt,
                                    true,
                                  )}
                                </time>
                              </span>
                              <span className="other-tab-comment-card-body">
                                {entry.previewText}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </header>
            <span className="sr-only" role="status" aria-live="polite">
              {composerInCurrentTab && Number.isFinite(composerTop)
                ? "评论输入框已与画布目标同时定位"
                : focusedCommentId
                  ? "评论与画布目标已同时定位"
                  : ""}
            </span>

            {projectLoadError ? (
              <section
                className="round-lock-card rail-status-card"
                aria-label="项目读取失败"
                style={{ top: `${commentRailStatusTop}px` }}
              >
                <strong>当前项目暂不可编辑</strong>
                <span>{projectLoadError}</span>
                <button type="button" onClick={onRetryProjectHydration}>重试读取</button>
              </section>
            ) : composerInCurrentTab
              && draftTarget
              && !interactionLocked ? (
              <section
                className="comment-composer rail-comment-composer"
                aria-label="添加评论"
                data-html-canvas-preserve-selection="true"
                data-comment-measure="__composer"
                data-comment-measure-key={composerMeasurementKey}
                data-focused="true"
                style={{
                  top: `${
                    Number.isFinite(composerTop)
                      ? composerTop as number
                      : commentRailMinimumTop
                  }px`,
                }}
              >
                <header>
                  <div className="composer-target" data-empty={!draftTarget ? "true" : "false"}>
                    <strong>{draftTargetScope}</strong>
                    <span>“{insertionLabel(draftTarget)}”</span>
                  </div>
                  <button
                    className="comment-tool-button"
                    type="button"
                    aria-label="关闭评论编辑器"
                    title={attachmentUploadCount > 0 ? "附件添加完成后可关闭" : "收起并保留草稿"}
                    disabled={attachmentUploadCount > 0}
                    onClick={closeCommentComposer}
                  ><XIcon aria-hidden="true" size={17} weight="bold" /></button>
                </header>
                <label htmlFor="round-comment-draft">评论内容</label>
                {!draftTargetCanSave ? (
                  <div className="comment-target-recovery" role="status">
                    <span>
                      <strong>原位置已变化</strong>
                      <small>草稿和附件仍保留，请在画布中选择新的位置。</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => beginTargetRelink("__composer")}
                    >{relinkingTarget === "__composer" ? "正在等待选择…" : "重新选择目标"}</button>
                    {relinkingTarget === "__composer" ? (
                      <button type="button" onClick={cancelTargetRelink}>取消</button>
                    ) : null}
                  </div>
                ) : null}
                <textarea
                  id="round-comment-draft"
                  ref={composerRef}
                  value={draft}
                  disabled={!draftTargetCanSave || interactionLocked}
                  placeholder={isExplicitGlobalCommentTarget(draftTarget)
                    ? "输入对整个页面的修改要求…"
                    : "输入对这部分内容的修改要求…"}
                  onChange={(event) => {
                    onComposerDraftChange(event.target.value);
                  }}
                  onPaste={onComposerPaste}
                  onKeyDown={(event) => {
                    if (shouldSubmitCommentOnEnter({
                      key: event.key,
                      shiftKey: event.shiftKey,
                      isComposing: event.nativeEvent.isComposing,
                    })) {
                      event.preventDefault();
                      void addComment();
                    }
                  }}
                />
                <CommentAttachmentStrip
                  attachments={draftAttachments}
                  objectUrls={attachmentObjectUrls}
                  editable={!interactionLocked}
                  onEnsurePreview={ensureAttachmentObjectUrl}
                  onPreview={(attachment) => void openAttachmentPreview(attachment)}
                  onDownload={(attachment) => void downloadAttachment(attachment)}
                  onRemove={removeComposerAttachment}
                />
                {pendingDeleteCommentId === "__composer" ? (
                  <footer className="comment-delete-confirm composer-delete-confirm" role="alert">
                    <span>删除这条未保存评论？</span>
                    <div>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => {
                          clearDeleteRequest();
                          window.requestAnimationFrame(() => {
                            document.getElementById("composer-delete-button")?.focus();
                          });
                        }}
                      >取消</button>
                      <button
                        className="confirm-delete"
                        type="button"
                        onClick={discardCurrentComposer}
                      >删除</button>
                    </div>
                  </footer>
                ) : (
                  <footer className="composer-actions">
                    <div className="composer-footer-tools">
                      <button
                        className="comment-tool-button"
                        type="button"
                        aria-label="添加附件"
                        title="添加附件"
                        disabled={interactionLocked || !draftCommentId}
                        onClick={() => {
                          if (draftCommentId) {
                            openAttachmentPicker(
                              { kind: "composer", commentId: draftCommentId },
                              "all",
                            );
                          }
                        }}
                      >
                        <PaperclipIcon aria-hidden="true" size={17} weight="bold" />
                      </button>
                      <button
                        className="comment-tool-button"
                        type="button"
                        aria-label="添加图片"
                        title="添加图片"
                        disabled={interactionLocked || !draftCommentId}
                        onClick={() => {
                          if (draftCommentId) {
                            openAttachmentPicker(
                              { kind: "composer", commentId: draftCommentId },
                              "image",
                            );
                          }
                        }}
                      >
                        <ImageIcon aria-hidden="true" size={17} weight="bold" />
                      </button>
                      <button
                        id="composer-delete-button"
                        className="comment-tool-button danger"
                        type="button"
                        aria-label="删除未保存评论"
                        title="删除未保存评论"
                        disabled={
                          interactionLocked
                          || attachmentUploadCount > 0
                          || (!draft.trim() && draftAttachments.length === 0)
                        }
                        onClick={() => requestDeleteComment("__composer")}
                      >
                        <TrashIcon aria-hidden="true" size={17} weight="bold" />
                      </button>
                      {attachmentUploadCount > 0 ? <small>正在添加附件…</small> : null}
                    </div>
                    <button
                      className="add-comment-button"
                      type="button"
                      aria-label="评论" title="提交评论"
                      disabled={
                        !draftTargetCanSave
                        || (!draft.trim() && draftAttachments.length === 0)
                        || attachmentUploadCount > 0
                        || interactionLocked
                      }
                      onClick={(event) => {
                        event.currentTarget.blur();
                        void addComment();
                      }}
                    >
                      <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
                    </button>
                  </footer>
                )}
              </section>
            ) : !commentLayoutReady ? null
            : hasCollapsedCommentDraft
              && draftTarget
              && draftRecoveryTop !== undefined ? (
              <button
                className="comment-card draft-comment-card"
                type="button"
                data-html-canvas-preserve-selection="true"
                aria-label={`未保存评论：${insertionLabel(draftTarget)}：${draft.trim() || `已添加 ${draftAttachments.length} 个附件`}`}
                data-comment-measure="__draft_recovery"
                data-comment-measure-key={draftRecoveryMeasurementKey}
                style={{ top: `${draftRecoveryTop}px` }}
                onClick={resumeCurrentComposer}
              >
                <span className="comment-card-header">
                  <span className="comment-target">
                    {insertionLabel(draftTarget)}
                  </span>
                  <span className="unsaved-comment-status">未保存</span>
                </span>
                <span className="other-tab-comment-card-body">
                  {draft.trim() || `已添加 ${draftAttachments.length} 个附件`}
                </span>
              </button>
            ) : null}

            {(commentLayoutReady || expectedCommentLayoutTargetIds.length === 0)
            && sortedVisibleCommentItems.length === 0
            && !composerInCurrentTab
            && !hasCollapsedCommentDraft ? (
              <div
                className="comments-empty"
                style={{ top: `${commentRailMinimumTop}px` }}
              >
                <ChatCircleTextIcon aria-hidden="true" size={24} weight="duotone" />
                <strong>{otherTabCommentEntryCount > 0
                  ? "这个标签页还没有评论"
                  : "评论会显示在这里"}</strong>
                <span>{otherTabCommentEntryCount > 0
                  ? "其他标签页的评论可从顶部展开。"
                  : "可以评论整个页面、模块或其中的小区块；写好后就能发给 AI。"}</span>
              </div>
            ) : renderedVisibleCommentItems.map((comment) => {
              const index = sortedVisibleCommentItems.findIndex(
                (item) => item.commentId === comment.commentId,
              );
              const sourceTarget = comment.sourceAnchor;
              const displayTarget = commentVisualTarget(comment);
              const editable = viewMode === "current" && !interactionLocked;
              const editing = (
                editingCommentId === comment.commentId
                && commentEditSession?.commentId === comment.commentId
              );
              const activeEditSession = (
                editing
                && commentEditSession?.commentId === comment.commentId
              )
                ? commentEditSession
                : null;
              const shownAttachments = activeEditSession
                ? activeEditSession.draftAttachments
                : comment.attachments;
              const deleting = pendingDeleteCommentId === comment.commentId;
              const targetLayout = commentTargetLayouts[sourceTarget.id];
              const targetResolution =
                targetLayout?.resolution ?? sourceTarget.resolution;
              const targetLocatable = commentTargetIsLocatable(comment.sourceAnchor);
              return (
                <article
                  className="comment-card"
                  data-html-canvas-preserve-selection="true"
                  data-comment-measure={comment.commentId}
                  data-comment-measure-key={commentMeasurementKeys[comment.commentId]}
                  data-selected={selection?.selector === sourceTarget.selector ? "true" : "false"}
                  data-focused={focusedCommentId === comment.commentId ? "true" : undefined}
                  data-resolution={targetResolution}
                  data-editing={editing ? "true" : undefined}
                  role="group"
                  aria-current={focusedCommentId === comment.commentId ? "location" : undefined}
                  tabIndex={editable && targetLocatable ? 0 : -1}
                  aria-label={`${insertionLabel(displayTarget)}：${comment.text}`}
                  style={{
                    top: `${visibleCommentPositions[comment.commentId]}px`,
                  }}
                  onClick={() => {
                    if (!editing && !deleting && editable && targetLocatable) {
                      focusCommentTarget(displayTarget, comment.commentId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget
                      && !editing
                      && !deleting
                      && editable
                      && targetLocatable
                      && (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      focusCommentTarget(displayTarget, comment.commentId);
                    }
                  }}
                  key={comment.commentId}
                >
                  <header className="comment-card-header">
                    <span className="comment-target">{insertionLabel(displayTarget)}</span>
                    <time dateTime={comment.updatedAt || comment.createdAt}>
                      {formatTime(comment.updatedAt || comment.createdAt, true)}
                    </time>
                  </header>
                  {!targetLocatable && editable ? (
                    <div
                      className="comment-target-recovery"
                      role="status"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>
                        <strong>评论位置已丢失</strong>
                        <small>建议删除这条评论，并在正确位置重新评论。</small>
                      </span>
                    </div>
                  ) : null}
                  {editing ? (
                    <textarea
                      ref={commentEditRef}
                      className="comment-edit-textarea"
                      aria-label={`编辑评论 ${index + 1}`}
                      value={commentEditDraft}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateCommentEditDraft(
                        event.target.value,
                      )}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelCommentEdit();
                        } else if (shouldSubmitCommentOnEnter({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          isComposing: event.nativeEvent.isComposing,
                        })) {
                          event.preventDefault();
                          confirmCommentEdit(comment.commentId);
                        }
                      }}
                      onPaste={(event) => pasteImages(event, {
                        kind: "comment",
                        commentId: comment.commentId,
                      })}
                    />
                  ) : <p>{comment.text || "已添加参考附件"}</p>}
                  <CommentAttachmentStrip
                    attachments={shownAttachments}
                    objectUrls={attachmentObjectUrls}
                    editable={editable && editing}
                    onEnsurePreview={ensureAttachmentObjectUrl}
                    onPreview={(attachment) => void openAttachmentPreview(attachment)}
                    onDownload={(attachment) => void downloadAttachment(attachment)}
                    onRemove={(attachment) => removeCommentAttachment(
                      comment.commentId,
                      attachment,
                    )}
                  />
                  {editable ? (
                    deleting ? (
                      <footer
                        className="comment-delete-confirm"
                        role="alert"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span>删除这条评论？</span>
                        <div>
                          <button
                            type="button"
                            autoFocus
                            onClick={(event) => {
                              event.currentTarget.blur();
                              clearDeleteRequest();
                              queueReviewCommentFocus(displayTarget, comment.commentId);
                              window.requestAnimationFrame(() => {
                                document.getElementById(`comment-delete-${comment.commentId}`)?.focus();
                              });
                            }}
                          >取消</button>
                          <button
                            className="confirm-delete"
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.blur();
                              deleteComment(comment.commentId);
                            }}
                          >删除</button>
                        </div>
                      </footer>
                    ) : (
                      <footer className="comment-card-footer">
                        {shownAttachments?.length ? (
                          <span>{shownAttachments.length} 个附件</span>
                        ) : null}
                        <div className="comment-card-tools">
                          <button
                            className="comment-tool-button"
                            type="button"
                            aria-label="添加附件"
                            title="添加附件"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (beginCommentEdit(comment, false)) {
                                window.requestAnimationFrame(() => {
                                  openAttachmentPicker(
                                    {
                                      kind: "comment",
                                      commentId: comment.commentId,
                                    },
                                    "all",
                                  );
                                });
                              }
                            }}
                          >
                            <PaperclipIcon aria-hidden="true" size={17} weight="bold" />
                          </button>
                          <button
                            className="comment-tool-button"
                            type="button"
                            aria-label="添加图片"
                            title="添加图片"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (beginCommentEdit(comment, false)) {
                                window.requestAnimationFrame(() => {
                                  openAttachmentPicker(
                                    {
                                      kind: "comment",
                                      commentId: comment.commentId,
                                    },
                                    "image",
                                  );
                                });
                              }
                            }}
                          >
                            <ImageIcon aria-hidden="true" size={17} weight="bold" />
                          </button>
                          {editing ? (
                            <>
                              <button
                                className="comment-tool-button cancel-edit"
                                type="button"
                                aria-label="取消编辑"
                                title="取消编辑"
                                disabled={attachmentUploadCount > 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.currentTarget.blur();
                                  cancelCommentEdit();
                                }}
                              >
                                <XIcon aria-hidden="true" size={17} weight="bold" />
                              </button>
                              <button
                                className="comment-tool-button confirm-edit"
                                type="button"
                                aria-label="确认修改"
                                title="确认修改"
                                disabled={
                                  attachmentUploadCount > 0
                                  || (
                                    !commentEditDraft.trim()
                                    && commentEditAttachments.length === 0
                                  )
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.currentTarget.blur();
                                  confirmCommentEdit(comment.commentId);
                                }}
                              >
                                <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
                              </button>
                            </>
                          ) : (
                            <button
                              className="comment-tool-button"
                              type="button"
                              aria-label="编辑评论"
                              title="编辑评论"
                              onClick={(event) => {
                                event.stopPropagation();
                                beginCommentEdit(comment);
                              }}
                            >
                              <PencilSimpleIcon aria-hidden="true" size={17} weight="bold" />
                            </button>
                          )}
                          <button
                            id={`comment-delete-${comment.commentId}`}
                            className="comment-tool-button danger"
                            type="button"
                            aria-label="删除评论"
                            title="删除评论"
                            disabled={attachmentUploadCount > 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              event.currentTarget.blur();
                              requestDeleteComment(comment.commentId);
                              queueReviewCommentFocus(displayTarget, comment.commentId);
                            }}
                          >
                            <TrashIcon aria-hidden="true" size={17} weight="bold" />
                          </button>
                        </div>
                      </footer>
                    )
                  ) : null}
                </article>
              );
            })}

          </div>
          </aside>

  );
});
