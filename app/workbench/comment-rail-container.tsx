"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { CommentControllerCapability } from "../application/workspace-controller.js";
import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";
import {
  computeAlignedRailOffset,
  computeCommentRailMinimumOffset,
  layoutCommentRailItems,
  routeCommentRailWheel,
} from "../lib/comment-rail-layout.js";
import {
  commentMarkerGroupKey,
  virtualizedCommentIds,
} from "../lib/comment-virtualization.js";
import {
  canSaveCommentTarget,
  commentEditSessionHasChanges,
  commentVisualHintForSelection,
  commentVisualTarget,
  isExplicitGlobalCommentTarget,
} from "./comment-model";
import {
  composerViewFields,
  deriveComposerState,
  type CommentRailActions,
  type CommentRailContainerContext,
  type CommentRailHostActions,
  type CommentRailModel,
  type OtherTabCommentGroup,
} from "./comment-rail-contract";
import type { CommentCanvasPort } from "./comment-canvas-port";
import { CommentRailView } from "./comment-rail-view";
import type {
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  OtherTabCommentEntry,
} from "./types";

export type CommentRailCapability = CommentControllerCapability<
  CommentItem,
  DirectEditEvent,
  CommentAttachment,
  HtmlCanvasSelection,
  CommentEditSession
>;

function commentMeasurementKey(itemKey: string, layoutState: unknown): string {
  const text = JSON.stringify(layoutState);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${itemKey}::${text.length}-${(hash >>> 0).toString(36)}`;
}

function shallowEqualRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  ignored = new Set<string>(),
): boolean {
  const leftKeys = Object.keys(left).filter((key) => !ignored.has(key));
  const rightKeys = Object.keys(right).filter((key) => !ignored.has(key));
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(left[key], right[key]));
}

function draftScope(target: HtmlCanvasSelection | null): string {
  if (!target) return "尚未选择";
  const visualHint = commentVisualHintForSelection(target);
  if (visualHint?.runtimeGenerated) {
    switch (visualHint.kind) {
      case "table":
      case "table-cell":
        return "表格";
      case "chart":
        return "图表";
      case "svg":
      case "canvas":
        return "图形";
      default:
        return "页面内容";
    }
  }
  if (isExplicitGlobalCommentTarget(target)) return "全局评论";
  if (target.level === "module") return "整个模块";
  if (target.level === "insertion") return "添加位置";
  return "页面内容";
}


function sourceTargetForSelection(target: HtmlCanvasSelection): HtmlCanvasSelection {
  return target.commentAnchor ?? target;
}

export const CommentRailContainer = memo(function CommentRailContainer({
  capability,
  canvasPort,
  context,
  actions,
}: {
  capability: CommentRailCapability;
  canvasPort: CommentCanvasPort;
  context: CommentRailContainerContext;
  actions: CommentRailHostActions;
}) {
  const commentsPanelRef = useRef<HTMLElement>(null);
  const commentsHeaderRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const commentEditRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputTargetRef = useRef<{
    target: Parameters<CommentRailHostActions["uploadAttachments"]>[1];
  } | null>(null);
  const handledComposerFocusRevisionRef = useRef(0);
  const commentRailOffsetRef = useRef(0);
  const commentRailMinimumOffsetRef = useRef(0);
  const [commentCardHeights, setCommentCardHeights] = useState<Record<string, number>>({});
  const [commentHeaderHeight, setCommentHeaderHeight] = useState(62);
  const [commentViewport, setCommentViewport] = useState({ top: 0, height: 800 });
  const [commentRailOffset, setCommentRailOffset] = useState(0);
  const [commentRailFollowsFocus, setCommentRailFollowsFocus] = useState(false);
  const [expandedOtherTabCommentsKey, setExpandedOtherTabCommentsKey] = useState("");
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const canvasSnapshot = useSyncExternalStore(
    canvasPort.subscribe,
    canvasPort.getSnapshot,
    canvasPort.getSnapshot,
  );
  const workingCopy = snapshot.workingCopy;
  const workingCopyEditSession = workingCopy?.editSession ?? null;
  const composer = deriveComposerState({
    relinkingTarget: canvasSnapshot.relinkingTarget,
    editingCommentId: canvasSnapshot.editingCommentId,
    commentEditSession: workingCopyEditSession,
    commentEditDraft: workingCopy?.editSession?.draftText ?? "",
    commentEditAttachments: workingCopy?.editSession?.draftAttachments ?? [],
    composerOpen: canvasSnapshot.composerOpen,
    draftTarget: workingCopy?.composerTarget ?? null,
    draft: workingCopy?.composerDraft ?? "",
    draftCommentId: workingCopy?.composerCommentId ?? null,
    draftAttachments: workingCopy?.composerAttachments ?? [],
    hasCollapsedCommentDraft: Boolean(
      workingCopy?.composerTarget
      && !canvasSnapshot.composerOpen
      && (
        workingCopy.composerDraft.trim()
        || workingCopy.composerAttachments.length > 0
      )
    ),
  });
  const {
    composerOpen,
    draftTarget,
    draft,
    draftAttachments,
    editingCommentId,
    relinkingTarget,
  } = composerViewFields(composer);
  const attachmentUploadCount = snapshot.persistence?.attachmentUploadCount ?? 0;
  const targetLayouts = canvasSnapshot.targetLayouts;
  const hasCommentDraft = Boolean(
    context.viewMode === "current"
    && !context.interactionLocked
    && draftTarget
    && (draft.trim() || draftAttachments.length > 0),
  );
  const expectedCommentLayoutTargetIds = useMemo(() => [...new Set([
    ...context.visibleCommentItems.map((comment) => (
      comment.sourceAnchor.id
    )),
    ...(
      (hasCommentDraft || composerOpen) && draftTarget
        ? [sourceTargetForSelection(draftTarget).id]
        : []
    ),
  ])].sort(), [
    composerOpen,
    context.visibleCommentItems,
    draftTarget,
    hasCommentDraft,
  ]);
  const expectedCommentLayoutTargetIdsKey = expectedCommentLayoutTargetIds.join("\u0000");
  const commentLayoutAuthority = canvasSnapshot.layoutAuthority;
  const commentLayoutReady = Boolean(
    context.canvasMode === "edit"
    && commentLayoutAuthority.ready
    && (
      commentLayoutAuthority.textEditing
      || !context.expectedCommentLayoutSourceSha256
      || commentLayoutAuthority.sourceSha256 === context.expectedCommentLayoutSourceSha256
    )
    && commentLayoutAuthority.viewContextGeneration === context.activePageViewGeneration
    && commentLayoutAuthority.targetIdsKey === expectedCommentLayoutTargetIdsKey
    && expectedCommentLayoutTargetIds.every((targetId) => Boolean(targetLayouts[targetId]))
  );
  const draftSourceTarget = draftTarget ? sourceTargetForSelection(draftTarget) : null;
  const draftTargetLayout = draftSourceTarget
    ? targetLayouts[draftSourceTarget.id]
    : undefined;
  const draftTargetInOtherTab = Boolean(
    draftTarget?.tagName !== "body"
    && draftTargetLayout?.status === "hidden"
    && draftTargetLayout.tabGroupKey,
  );
  const draftInOtherTab = hasCommentDraft && draftTargetInOtherTab;
  const draftTargetInCurrentTab = Boolean(draftTarget && !draftTargetInOtherTab);
  const draftInCurrentTab = hasCommentDraft && draftTargetInCurrentTab;
  const composerInCurrentTab = composerOpen && draftTargetInCurrentTab;
  const hasCollapsedCommentDraft = Boolean(
    draftInCurrentTab && draftTarget && !composerOpen,
  );
  const commentTargetTops = useMemo(() => Object.fromEntries(
    Object.entries(targetLayouts)
      .filter(([, layout]) => layout.status === "visible" && Number.isFinite(layout.top))
      .map(([targetId, layout]) => [targetId, layout.top as number]),
  ), [targetLayouts]);
  const otherTabCommentItems = useMemo(() => context.visibleCommentItems.filter(
    (comment) => {
      const sourceTarget = comment.sourceAnchor;
      const layout = targetLayouts[sourceTarget.id];
      return Boolean(
        sourceTarget.tagName !== "body"
        && layout?.status === "hidden"
        && layout.tabGroupKey
      );
    },
  ), [context.visibleCommentItems, targetLayouts]);
  const otherTabCommentIds = useMemo(
    () => new Set(otherTabCommentItems.map((comment) => comment.commentId)),
    [otherTabCommentItems],
  );
  const railCommentItems = useMemo(
    () => context.visibleCommentItems.filter(
      (comment) => !otherTabCommentIds.has(comment.commentId),
    ),
    [context.visibleCommentItems, otherTabCommentIds],
  );
  const otherTabCommentGroups = useMemo<OtherTabCommentGroup[]>(() => {
    const grouped = new Map<string, OtherTabCommentGroup>();
    const appendEntry = (key: string, label: string, entry: OtherTabCommentEntry) => {
      const current = grouped.get(key);
      if (current) current.entries.push(entry);
      else grouped.set(key, { key, label, entries: [entry] });
    };
    for (const comment of otherTabCommentItems) {
      const target = commentVisualTarget(comment);
      const layout = targetLayouts[target.id];
      appendEntry(
        layout?.tabGroupKey || target.id,
        layout?.tabGroupLabel || "其他标签页",
        {
          kind: "saved",
          key: comment.commentId,
          target,
          comment,
          previewText: comment.text.trim()
            || `已添加 ${(comment.attachments ?? []).length} 个附件`,
        },
      );
    }
    if (draftInOtherTab && draftTarget && draftTargetLayout?.tabGroupKey) {
      appendEntry(
        draftTargetLayout.tabGroupKey,
        draftTargetLayout.tabGroupLabel || "其他标签页",
        {
          kind: "draft",
          key: "__composer",
          target: draftTarget,
          previewText: draft.trim() || `已添加 ${draftAttachments.length} 个附件`,
        },
      );
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => {
        const sameTarget = commentMarkerGroupKey(left.target)
          === commentMarkerGroupKey(right.target);
        if (sameTarget) {
          if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
          if (left.kind === "saved" && right.kind === "saved") {
            return left.comment.createdAt.localeCompare(right.comment.createdAt);
          }
          return 0;
        }
        const position = (
          (left.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
          - (right.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
        );
        if (position !== 0) return position;
        if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
        if (left.kind === "saved" && right.kind === "saved") {
          return left.comment.createdAt.localeCompare(right.comment.createdAt);
        }
        return 0;
      }),
    }));
  }, [
    draft,
    draftAttachments.length,
    draftInOtherTab,
    draftTarget,
    draftTargetLayout,
    otherTabCommentItems,
    targetLayouts,
  ]);
  const otherTabCommentEntryCount = otherTabCommentItems.length + (draftInOtherTab ? 1 : 0);
  const otherTabCommentsOpen = (
    expandedOtherTabCommentsKey === context.otherTabCommentsContextKey
  );
  const hasUnsavedCommentEdit = Boolean(
    context.viewMode === "current"
    && context.unfinishedEditedComment
    && commentEditSessionHasChanges(workingCopyEditSession),
  );
  const commentRailStatusTop = Math.max(78, commentHeaderHeight + 16);
  const commentRailMinimumTop = commentRailStatusTop;
  const isLocatable = useCallback((target: HtmlCanvasSelection): boolean => {
    const sourceTarget = sourceTargetForSelection(target);
    const layout = targetLayouts[sourceTarget.id];
    const resolution = layout?.resolution ?? sourceTarget.resolution;
    return layout?.status !== "missing"
      && (resolution === "exact" || resolution === "rebound");
  }, [targetLayouts]);
  const draftTargetCanSave = Boolean(
    draftTarget
    && canSaveCommentTarget(draftTarget)
    && draftTargetLayout?.status !== "missing"
    && (draftTargetLayout?.resolution ?? draftTarget.commentAnchor?.resolution ?? draftTarget.resolution) === "exact"
  );
  const commentRailTargetTops = useMemo(() => {
    if (!commentLayoutReady) return {};
    const targets = [
      ...railCommentItems.map(commentVisualTarget),
      ...(
        (composerInCurrentTab || hasCollapsedCommentDraft) && draftTarget
          ? [
              draftTarget.visualHint
                ? { ...sourceTargetForSelection(draftTarget), visualHint: draftTarget.visualHint }
                : sourceTargetForSelection(draftTarget),
            ]
          : []
      ),
    ];
    const measuredGroupTops = new Map<string, number>();
    for (const target of targets) {
      const layout = targetLayouts[target.id];
      const measuredTop = isExplicitGlobalCommentTarget(target) || layout?.status === "missing"
        ? commentRailMinimumTop
        : commentTargetTops[target.id];
      if (!Number.isFinite(measuredTop)) continue;
      const groupKey = commentMarkerGroupKey(target);
      measuredGroupTops.set(
        groupKey,
        Math.min(
          measuredGroupTops.get(groupKey) ?? Number.MAX_SAFE_INTEGER,
          measuredTop as number,
        ),
      );
    }
    return Object.fromEntries(targets.flatMap((target) => {
      const top = measuredGroupTops.get(commentMarkerGroupKey(target));
      return Number.isFinite(top) ? [[target.id, top as number]] : [];
    }));
  }, [
    commentLayoutReady,
    commentRailMinimumTop,
    commentTargetTops,
    composerInCurrentTab,
    draftTarget,
    hasCollapsedCommentDraft,
    railCommentItems,
    targetLayouts,
  ]);
  const sortedVisibleCommentItems = useMemo(() => {
    if (!commentLayoutReady) return [];
    return railCommentItems
      .flatMap((comment, index) => {
        const target = commentVisualTarget(comment);
        const targetTop = isExplicitGlobalCommentTarget(target)
          ? commentRailMinimumTop
          : commentRailTargetTops[target.id];
        if (!Number.isFinite(targetTop)) return [];
        return [{
          comment,
          index,
          scopeRank: isExplicitGlobalCommentTarget(target) ? 0 : 1,
          targetTop: targetTop as number,
        }];
      })
      .sort((left, right) => (
        left.scopeRank - right.scopeRank
        || left.targetTop - right.targetTop
        || left.comment.createdAt.localeCompare(right.comment.createdAt)
        || left.index - right.index
      ))
      .map(({ comment }) => comment);
  }, [commentLayoutReady, commentRailMinimumTop, commentRailTargetTops, railCommentItems]);
  const commentMeasurementKeys = useMemo(() => Object.fromEntries(
    sortedVisibleCommentItems.map((comment) => {
      const target = commentVisualTarget(comment);
      const layout = targetLayouts[target.id];
      const resolution = layout?.resolution ?? target.resolution;
      return [comment.commentId, commentMeasurementKey(comment.commentId, {
        resolution,
        locatable: layout?.status !== "missing"
          && (resolution === "exact" || resolution === "rebound"),
        editable: context.viewMode === "current" && !context.interactionLocked,
        editing: editingCommentId === comment.commentId,
        deleting: pendingDeleteCommentId === comment.commentId,
        relinking: relinkingTarget === comment.commentId,
        text: comment.text,
        attachments: (comment.attachments ?? []).map((attachment) => ({
          id: attachment.attachmentId,
          kind: attachment.kind,
          bytes: attachment.byteLength,
        })),
      })];
    }),
  ), [
    context.interactionLocked,
    pendingDeleteCommentId,
    context.viewMode,
    editingCommentId,
    relinkingTarget,
    sortedVisibleCommentItems,
    targetLayouts,
  ]);
  const composerMeasurementKey = useMemo(() => commentMeasurementKey(
    "__composer",
    {
      canSave: draftTargetCanSave,
      deleting: pendingDeleteCommentId === "__composer",
      relinking: relinkingTarget === "__composer",
      text: draft,
      attachments: draftAttachments.map((attachment) => ({
        id: attachment.attachmentId,
        kind: attachment.kind,
        bytes: attachment.byteLength,
      })),
      uploading: attachmentUploadCount > 0,
    },
  ), [
    attachmentUploadCount,
    pendingDeleteCommentId,
    draft,
    draftAttachments,
    draftTargetCanSave,
    relinkingTarget,
  ]);
  const draftRecoveryMeasurementKey = useMemo(() => commentMeasurementKey(
    "__draft_recovery",
    { text: draft, attachments: draftAttachments.length },
  ), [draft, draftAttachments.length]);
  const commentRailLayout = useMemo(() => {
    const items = sortedVisibleCommentItems.map((comment, index) => {
      const imageCount = (comment.attachments ?? []).filter(
        (attachment) => attachment.kind === "image",
      ).length;
      const fileCount = (comment.attachments ?? []).length - imageCount;
      const textLines = Math.max(1, Math.ceil((comment.text.length || 18) / 25));
      const imageRows = Math.ceil(imageCount / 3);
      const measurementKey = commentMeasurementKeys[comment.commentId];
      return {
        key: comment.commentId,
        targetTop: isExplicitGlobalCommentTarget(commentVisualTarget(comment))
          ? commentRailMinimumTop
          : commentRailTargetTops[commentVisualTarget(comment).id],
        height: commentCardHeights[measurementKey]
          || 104
            + textLines * 19
            + imageRows * 78
            + fileCount * 48
            + (!isLocatable(comment.sourceAnchor) && context.viewMode === "current" ? 70 : 0)
            + (editingCommentId === comment.commentId ? 92 : 0)
            + (pendingDeleteCommentId === comment.commentId ? 46 : 0),
        order: index + 1,
        scopeRank: isExplicitGlobalCommentTarget(commentVisualTarget(comment)) ? 0 : 1,
      };
    });
    const draftTargetTop = draftTarget && isExplicitGlobalCommentTarget(draftTarget)
      ? commentRailMinimumTop
      : draftSourceTarget
        ? commentRailTargetTops[draftSourceTarget.id]
        : undefined;
    if (composerInCurrentTab && draftTarget && Number.isFinite(draftTargetTop)) {
      items.push({
        key: "__composer",
        targetTop: draftTargetTop as number,
        height: commentCardHeights[composerMeasurementKey]
          || 276
            + (!draftTargetCanSave ? 70 : 0)
            + (pendingDeleteCommentId === "__composer" ? 46 : 0),
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget && isExplicitGlobalCommentTarget(draftTarget) ? 0 : 1,
      });
    }
    if (hasCollapsedCommentDraft && draftTarget && Number.isFinite(draftTargetTop)) {
      items.push({
        key: "__draft_recovery",
        targetTop: draftTargetTop as number,
        height: commentCardHeights[draftRecoveryMeasurementKey] || 142,
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget && isExplicitGlobalCommentTarget(draftTarget) ? 0 : 1,
      });
    }
    const layout = layoutCommentRailItems({ minimumTop: commentRailMinimumTop, gap: 20, items });
    return {
      ...layout,
      composerTop: layout.positions.__composer,
      draftRecoveryTop: layout.positions.__draft_recovery,
    };
  }, [
    commentCardHeights,
    commentMeasurementKeys,
    commentRailMinimumTop,
    commentRailTargetTops,
    composerInCurrentTab,
    composerMeasurementKey,
    draftSourceTarget,
    pendingDeleteCommentId,
    context.viewMode,
    draftRecoveryMeasurementKey,
    draftTarget,
    draftTargetCanSave,
    editingCommentId,
    hasCollapsedCommentDraft,
    isLocatable,
    sortedVisibleCommentItems,
  ]);
  const renderedCommentIds = useMemo(() => virtualizedCommentIds({
    ids: sortedVisibleCommentItems.map((comment) => comment.commentId),
    positions: commentRailLayout.positions,
    heights: commentRailLayout.heights,
    viewportTop: Math.max(0, commentViewport.top - commentRailOffset),
    viewportHeight: commentViewport.height,
    forcedIds: [
      canvasSnapshot.focusedCommentId,
      editingCommentId,
      pendingDeleteCommentId,
    ].filter((value): value is string => Boolean(value)),
  }), [
    commentRailLayout.heights,
    commentRailLayout.positions,
    commentRailOffset,
    commentViewport.height,
    commentViewport.top,
    canvasSnapshot.focusedCommentId,
    pendingDeleteCommentId,
    editingCommentId,
    sortedVisibleCommentItems,
  ]);
  const renderedVisibleCommentItems = useMemo(
    () => sortedVisibleCommentItems.filter(
      (comment) => renderedCommentIds.has(comment.commentId),
    ),
    [renderedCommentIds, sortedVisibleCommentItems],
  );
  const canvasDocumentHeight = canvasSnapshot.canvasDocumentHeight;
  const commentRailContentHeight = Math.max(
    canvasDocumentHeight,
    commentRailLayout.bottom + 24,
  );
  const commentRailMinimumOffset = computeCommentRailMinimumOffset({
    contentBottom: commentRailLayout.bottom + 14,
    viewportBottom: canvasDocumentHeight - 14,
  });

  useEffect(() => {
    const stage = context.reviewStageRef.current;
    if (!stage) return undefined;
    let frame = 0;
    const updateViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = { top: Math.max(0, stage.scrollTop), height: Math.max(1, stage.clientHeight) };
        setCommentViewport((current) => (
          current.top === next.top && current.height === next.height ? current : next
        ));
      });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateViewport);
    observer?.observe(stage);
    stage.addEventListener("scroll", updateViewport, { passive: true });
    updateViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      stage.removeEventListener("scroll", updateViewport);
    };
  }, [context.reviewStageRef]);

  useEffect(() => {
    const header = commentsHeaderRef.current;
    if (!header || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const next = Math.ceil(header.getBoundingClientRect().height);
      setCommentHeaderHeight((current) => next > 0 && next !== current ? next : current);
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, [context.canvasMode]);

  useLayoutEffect(() => {
    const root = commentsPanelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const nodes = [...root.querySelectorAll<HTMLElement>("[data-comment-measure]")];
      const measured = Object.fromEntries(nodes.map((node) => [
        String(
          node.dataset.commentMeasureKey
          || commentMeasurementKey(String(node.dataset.commentMeasure), { compatibility: true })
        ),
        Math.ceil(node.getBoundingClientRect().height),
      ]));
      const activeKeys = new Set([
        ...railCommentItems.map((comment) => comment.commentId),
        ...(composerInCurrentTab ? ["__composer"] : []),
        ...(draftInCurrentTab && !composerOpen ? ["__draft_recovery"] : []),
      ]);
      setCommentCardHeights((current) => {
        const next = Object.fromEntries(
          Object.entries({ ...current, ...measured })
            .filter(([key]) => activeKeys.has(key.split("::", 1)[0])),
        );
        const entries = Object.entries(next);
        if (
          Object.keys(current).length === entries.length
          && entries.every(([key, height]) => current[key] === height)
        ) return current;
        return next;
      });
    };
    const observer = new ResizeObserver(update);
    const observed = new Set<HTMLElement>();
    const refreshObservedNodes = () => {
      const nodes = new Set([...root.querySelectorAll<HTMLElement>("[data-comment-measure]")]);
      for (const node of observed) {
        if (nodes.has(node)) continue;
        observer.unobserve(node);
        observed.delete(node);
      }
      for (const node of nodes) {
        if (observed.has(node)) continue;
        observed.add(node);
        observer.observe(node);
      }
      update();
    };
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(refreshObservedNodes);
    mutationObserver?.observe(root, {
      attributes: true,
      attributeFilter: ["data-comment-measure-key"],
      childList: true,
      subtree: true,
    });
    refreshObservedNodes();
    return () => {
      mutationObserver?.disconnect();
      observer.disconnect();
    };
  }, [
    composerInCurrentTab,
    composerOpen,
    draftInCurrentTab,
    railCommentItems,
  ]);

  useEffect(() => {
    commentRailOffsetRef.current = commentRailOffset;
  }, [commentRailOffset]);

  useLayoutEffect(() => {
    commentRailMinimumOffsetRef.current = commentRailMinimumOffset;
    const currentOffset = commentRailOffsetRef.current;
    if (commentRailFollowsFocus || currentOffset >= commentRailMinimumOffset) return;
    commentRailOffsetRef.current = commentRailMinimumOffset;
    setCommentRailOffset(commentRailMinimumOffset);
  }, [commentRailFollowsFocus, commentRailMinimumOffset]);

  useLayoutEffect(() => {
    if (
      !composerInCurrentTab
      || !commentLayoutReady
      || !draftTarget
      || !Number.isFinite(commentRailLayout.composerTop)
    ) return;
    const targetTop = isExplicitGlobalCommentTarget(draftTarget)
      ? commentRailMinimumTop
      : draftSourceTarget
        ? commentRailTargetTops[draftSourceTarget.id]
          ?? (draftTargetLayout?.status === "visible"
            && Number.isFinite(draftTargetLayout.top)
            ? draftTargetLayout.top
            : undefined)
        : undefined;
    if (!Number.isFinite(targetTop)) return;
    const nextRailOffset = computeAlignedRailOffset({
      targetTop: Math.max(commentRailMinimumTop, targetTop as number),
      cardTop: commentRailLayout.composerTop as number,
      minimumTop: commentRailMinimumTop,
    });
    const composerHeight = commentRailLayout.heights.__composer || 276;
    const composerBottomOffset = canvasDocumentHeight - 14
      - (commentRailLayout.composerTop as number)
      - composerHeight;
    const boundedRailOffset = Math.max(
      Math.min(nextRailOffset, composerBottomOffset),
      commentRailMinimumOffset,
    );
    if (Math.abs(commentRailOffsetRef.current - boundedRailOffset) > 0.01) {
      commentRailOffsetRef.current = boundedRailOffset;
      setCommentRailOffset(boundedRailOffset);
    }
    if (!commentRailFollowsFocus) setCommentRailFollowsFocus(true);
  }, [
    canvasDocumentHeight,
    commentLayoutReady,
    commentRailFollowsFocus,
    commentRailLayout.composerTop,
    commentRailLayout.heights,
    commentRailMinimumTop,
    commentRailMinimumOffset,
    commentRailTargetTops,
    composerInCurrentTab,
    draftSourceTarget,
    draftTargetLayout,
    draftTarget,
  ]);

  useEffect(() => {
    const rail = commentsPanelRef.current;
    if (context.canvasMode !== "edit" || !rail) return undefined;
    const handleWheel = (event: WheelEvent) => {
      const stage = context.reviewStageRef.current;
      if (!stage) return;
      event.preventDefault();
      event.stopPropagation();
      const currentRailOffset = commentRailOffsetRef.current;
      const routed = routeCommentRailWheel({
        pageScrollTop: stage.scrollTop,
        pageMaxScrollTop: Math.max(0, stage.scrollHeight - stage.clientHeight),
        railOffset: currentRailOffset,
        railMinOffset: commentRailMinimumOffsetRef.current,
        deltaY: event.deltaY,
      });
      if (Math.abs(routed.railOffset - currentRailOffset) > 0.01) {
        commentRailOffsetRef.current = routed.railOffset;
        setCommentRailFollowsFocus(false);
        setCommentRailOffset(routed.railOffset);
      }
      if (Math.abs(routed.pageScrollTop - stage.scrollTop) > 0.01) {
        stage.scrollTop = routed.pageScrollTop;
      }
    };
    rail.addEventListener("wheel", handleWheel, { passive: false });
    return () => rail.removeEventListener("wheel", handleWheel);
  }, [context.canvasMode, context.reviewStageRef]);

  useEffect(() => {
    if (
      context.canvasMode === "edit"
      && (canvasSnapshot.focusedCommentId || composerOpen || editingCommentId)
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      commentRailOffsetRef.current = 0;
      setCommentRailFollowsFocus(false);
      setCommentRailOffset(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvasSnapshot.focusedCommentId, context.canvasMode, composerOpen, editingCommentId]);

  useEffect(() => {
    if (
      context.canvasMode === "edit"
      && (canvasSnapshot.focusedCommentId || composerOpen || editingCommentId)
    ) return;
    commentRailOffsetRef.current = 0;
    setCommentRailFollowsFocus(false);
    setCommentRailOffset(0);
  }, [
    canvasSnapshot.focusedCommentId,
    canvasSnapshot.railResetRevision,
    composerOpen,
    context.canvasMode,
    editingCommentId,
  ]);

  useEffect(() => {
    const request = canvasSnapshot.revealRequest;
    if (!request || !commentLayoutReady) return undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const stage = context.reviewStageRef.current;
        const rail = commentsPanelRef.current;
        if (!stage || !rail) return;
        if (!request.itemKey) {
          commentRailOffsetRef.current = 0;
          setCommentRailFollowsFocus(false);
          setCommentRailOffset(0);
          canvasPort.settleReveal(request.requestId);
          return;
        }
        const item = [...rail.querySelectorAll<HTMLElement>("[data-comment-measure]")]
          .find((node) => node.dataset.commentMeasure === request.itemKey);
        const sourceTarget = request.target.commentAnchor ?? request.target;
        const targetTop = isExplicitGlobalCommentTarget(request.target)
          ? commentRailMinimumTop
          : commentTargetTops[sourceTarget.id]
            ?? (targetLayouts[sourceTarget.id]?.status === "visible"
              && Number.isFinite(targetLayouts[sourceTarget.id]?.top)
              ? targetLayouts[sourceTarget.id]?.top
              : undefined);
        const cardTop = request.itemKey === "__composer"
          ? commentRailLayout.composerTop
          : item?.offsetTop;
        if (!Number.isFinite(targetTop) || !Number.isFinite(cardTop)) return;
        const safeTargetTop = Math.max(commentRailMinimumTop, targetTop as number);
        const nextRailOffset = computeAlignedRailOffset({
          targetTop: safeTargetTop,
          cardTop: cardTop as number,
          minimumTop: commentRailMinimumTop,
        });
        const composerHeight = commentRailLayout.heights.__composer || 276;
        const composerBottomOffset = request.itemKey === "__composer"
          && Number.isFinite(commentRailLayout.composerTop)
          ? canvasDocumentHeight - 14
            - (commentRailLayout.composerTop as number)
            - composerHeight
          : 0;
        const boundedRailOffset = request.itemKey === "__composer"
          ? Math.max(
              Math.min(nextRailOffset, composerBottomOffset),
              commentRailMinimumOffset,
            )
          : nextRailOffset;
        commentRailOffsetRef.current = boundedRailOffset;
        setCommentRailFollowsFocus(true);
        setCommentRailOffset(boundedRailOffset);
        const desiredTop = Math.max(0, safeTargetTop - commentRailMinimumTop - 10);
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage.scrollTo({
          top: Math.min(desiredTop, maxTop),
          behavior: reduceMotion ? "auto" : "smooth",
        });
        canvasPort.settleReveal(request.requestId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    canvasPort,
    canvasSnapshot.revealRequest,
    commentLayoutReady,
    commentRailLayout.composerTop,
    commentRailLayout.heights,
    canvasDocumentHeight,
    commentRailMinimumOffset,
    commentRailMinimumTop,
    commentTargetTops,
    context.reviewStageRef,
    targetLayouts,
    renderedVisibleCommentItems,
  ]);

  useLayoutEffect(() => {
    const revision = canvasSnapshot.composerFocusRevision;
    if (
      revision <= handledComposerFocusRevisionRef.current
      || !composerInCurrentTab
      || !commentLayoutReady
      || !Number.isFinite(commentRailLayout.composerTop)
      || context.interactionLocked
    ) return;
    const composerElement = composerRef.current;
    if (!composerElement || composerElement.disabled) return;
    handledComposerFocusRevisionRef.current = revision;
    composerElement.focus({ preventScroll: true });
  }, [
    canvasSnapshot.composerFocusRevision,
    commentLayoutReady,
    commentRailLayout.composerTop,
    composerInCurrentTab,
    context.interactionLocked,
  ]);

  useLayoutEffect(() => {
    const request = canvasSnapshot.editFocusRequest;
    if (!request || request.commentId !== editingCommentId) return;
    const editor = commentEditRef.current;
    if (!editor || editor.disabled) return;
    editor.focus({ preventScroll: true });
    if (request.select) editor.select();
    canvasPort.settleCommentEditFocus(request.requestId);
  }, [canvasPort, canvasSnapshot.editFocusRequest, editingCommentId]);

  useLayoutEffect(() => {
    const request = canvasSnapshot.attachmentPickerRequest;
    if (!request) return;
    const input = attachmentInputRef.current;
    if (!input) return;
    attachmentInputTargetRef.current = { target: request.target };
    input.accept = request.accept === "image" ? "image/*" : "";
    input.value = "";
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
    canvasPort.settleAttachmentPicker(request.requestId);
  }, [canvasPort, canvasSnapshot.attachmentPickerRequest]);

  const model = useMemo<CommentRailModel>(() => ({
    composer,
    commentsPanelRef,
    commentsHeaderRef,
    composerRef,
    commentEditRef,
    viewMode: context.viewMode,
    commentLayoutReady,
    commentLayoutAuthority,
    commentRailMinimumOffset,
    commentRailFollowsFocus,
    canvasDocumentHeight,
    commentRailContentHeight,
    commentRailOffset,
    commentRailStatusTop,
    commentRailMinimumTop,
    visibleCommentItems: context.visibleCommentItems,
    draftInCurrentTab,
    hasUnsavedCommentEdit,
    otherTabCommentEntryCount,
    otherTabCommentsContextKey: context.otherTabCommentsContextKey,
    otherTabCommentsOpen,
    interactionLocked: context.interactionLocked,
    unfinishedEditedComment: context.unfinishedEditedComment,
    otherTabCommentGroups,
    activeCommentCount: context.activeCommentCount,
    changeEvents: snapshot.workingCopy?.changeEvents as DirectEditEvent[]
      || context.changeEvents,
    composerInCurrentTab,
    composerTop: commentRailLayout.composerTop,
    focusedCommentId: canvasSnapshot.focusedCommentId,
    projectLoadError: context.projectLoadError,
    draftTargetScope: draftScope(draftTarget),
    attachmentUploadCount,
    draftTargetCanSave,
    composerMeasurementKey,
    attachmentObjectUrls: context.attachmentObjectUrls,
    pendingDeleteCommentId,
    draftRecoveryTop: commentRailLayout.draftRecoveryTop,
    draftRecoveryMeasurementKey,
    expectedCommentLayoutTargetIds,
    sortedVisibleCommentItems,
    renderedVisibleCommentItems,
    commentTargetLayouts: targetLayouts,
    selection: canvasSnapshot.selection,
    commentMeasurementKeys,
    visibleCommentPositions: commentRailLayout.positions,
  }), [
    attachmentUploadCount,
    canvasDocumentHeight,
    canvasSnapshot.selection,
    commentLayoutAuthority,
    commentLayoutReady,
    commentMeasurementKeys,
    commentRailContentHeight,
    commentRailFollowsFocus,
    commentRailLayout.composerTop,
    commentRailLayout.draftRecoveryTop,
    commentRailLayout.positions,
    commentRailMinimumOffset,
    commentRailMinimumTop,
    commentRailOffset,
    commentRailStatusTop,
    composer,
    composerInCurrentTab,
    composerMeasurementKey,
    context.activeCommentCount,
    context.attachmentObjectUrls,
    context.changeEvents,
    context.interactionLocked,
    context.otherTabCommentsContextKey,
    pendingDeleteCommentId,
    context.projectLoadError,
    canvasSnapshot.focusedCommentId,
    context.unfinishedEditedComment,
    context.viewMode,
    context.visibleCommentItems,
    draftInCurrentTab,
    draftRecoveryMeasurementKey,
    draftTarget,
    draftTargetCanSave,
    expectedCommentLayoutTargetIds,
    hasUnsavedCommentEdit,
    otherTabCommentEntryCount,
    otherTabCommentGroups,
    otherTabCommentsOpen,
    renderedVisibleCommentItems,
    snapshot.workingCopy,
    sortedVisibleCommentItems,
    targetLayouts,
  ]);
  const liveActions = useMemo<CommentRailActions>(() => ({
    ...actions,
    updateDraft: (value) => capability.commands.updateDraft(value),
    updateCommentEditDraft: (value) => capability.commands.updateEditDraft(value),
    toggleOtherTabComments: () => {
      setExpandedOtherTabCommentsKey((current) => (
        current === context.otherTabCommentsContextKey
          ? ""
          : context.otherTabCommentsContextKey
      ));
    },
    collapseOtherTabComments: () => setExpandedOtherTabCommentsKey(""),
    hideCommentComposer: () => canvasPort.setComposerOpen(false),
    openAttachmentPicker: (target, accept = "all") => {
      canvasPort.requestAttachmentPicker(target, accept);
    },
    requestDeleteComment: (commentId) => setPendingDeleteCommentId(commentId),
    clearDeleteRequest: () => setPendingDeleteCommentId(null),
    deleteComment: (commentId) => {
      setPendingDeleteCommentId(null);
      actions.deleteComment(commentId);
    },
  }), [actions, canvasPort, capability, context.otherTabCommentsContextKey]);

  return (
    <>
      <CommentRailView model={model} actions={liveActions} />
      <input
        ref={attachmentInputRef}
        className="sr-only"
        type="file"
        multiple
        onChange={(event) => {
          const pending = attachmentInputTargetRef.current;
          attachmentInputTargetRef.current = null;
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (pending) {
            void actions.uploadAttachments(files, pending.target, "file-picker");
          }
        }}
      />
    </>
  );
}, (previous, next) => (
  previous.capability === next.capability
  && previous.canvasPort === next.canvasPort
  && previous.actions === next.actions
  && shallowEqualRecord(
    previous.context as unknown as Record<string, unknown>,
    next.context as unknown as Record<string, unknown>,
  )
));
