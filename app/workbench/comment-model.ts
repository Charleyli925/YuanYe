import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";
import {
  rebindCanvasSelectionTargets,
  rebindCanvasSelectionTargetsAcrossHistory,
} from "../lib/canvas-target-rebind.js";
import type {
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
} from "./types";
import { isRecord } from "./record-model";
import { canLocateTarget } from "./comment-relink-model.js";
import { isValidPagerootElementId } from "../../shared/pageroot-element-identity.mjs";
import { normalizeRuntimeVisualHint } from "../lib/runtime-comment-hint.js";
import type { HtmlCanvasRuntimeVisualHint } from "../components/HtmlCanvasEditor.types";

// The relink predicates live in comment-relink-model (plain JS so Node tests
// can pin them); re-exported here for existing consumers.
export { canLocateTarget, commentHasContent, globalPageCommentTargetFromHtml } from "./comment-relink-model.js";

export function isGlobalPageTarget(target: HtmlCanvasSelection): boolean {
  return target.selector.trim().toLowerCase() === "body"
    && target.level === "module";
}

export function exactGlobalPageTarget(
  target: HtmlCanvasSelection,
): HtmlCanvasSelection {
  return {
    ...target,
    label: "整个页面",
    selector: "body",
    level: "module",
    tagName: "body",
    text: "",
    resolution: "exact",
  };
}

/**
 * A runtime selection is deliberately not a source target. Its private,
 * ephemeral commentAnchor is the only source selection that comment code may
 * use for persistence or relinking.
 */
export function commentAnchorForSelection(
  target: HtmlCanvasSelection | null | undefined,
): HtmlCanvasSelection | null {
  return target?.commentAnchor ?? target ?? null;
}

export function commentVisualHintForSelection(
  target: HtmlCanvasSelection | null | undefined,
): HtmlCanvasRuntimeVisualHint | undefined {
  const normalized = normalizeRuntimeVisualHint(target?.visualHint);
  return normalized || undefined;
}

/**
 * A body source anchor is only a true global comment when the user selected
 * the global entry point. Runtime comments may use body as their safe source
 * fallback while retaining a visual hint for the generated object.
 */
export function isExplicitGlobalCommentTarget(
  target: HtmlCanvasSelection | null | undefined,
): boolean {
  const sourceTarget = commentAnchorForSelection(target);
  return Boolean(
    sourceTarget
    && isGlobalPageTarget(sourceTarget)
    && !commentVisualHintForSelection(target),
  );
}

/** A disposable Canvas/card target; never write this projection back to a comment. */
export function commentVisualTarget(comment: CommentItem): HtmlCanvasSelection {
  return comment.visualHint
    ? { ...comment.sourceAnchor, label: comment.visualHint.label, visualHint: comment.visualHint }
    : comment.sourceAnchor;
}

export function canSaveCommentTarget(target: HtmlCanvasSelection): boolean {
  const anchor = commentAnchorForSelection(target);
  return Boolean(
    anchor
    && anchor.resolution === "exact"
    && isValidPagerootElementId(anchor.elementId),
  );
}

export function rebindTargetsPreservingGlobal(
  nextHtml: string,
  targets: HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const localTargets = targets.filter((target) => (
    !isGlobalPageTarget(target) && canLocateTarget(target)
  ));
  const reboundById = new Map(
    rebindCanvasSelectionTargets(nextHtml, localTargets)
      .map((target) => [target.id, target]),
  );
  return targets.map((target) => (
    isGlobalPageTarget(target)
      ? exactGlobalPageTarget(target)
      : canLocateTarget(target)
        ? reboundById.get(target.id) || target
        : target
  ));
}

export function rebindTargetsAcrossHistoryPreservingGlobal(
  currentHtml: string,
  nextHtml: string,
  targets: HtmlCanvasSelection[],
  transition: {
    fromTarget: HtmlCanvasSelection | null;
    toTarget: HtmlCanvasSelection | null;
  },
): HtmlCanvasSelection[] {
  const localTargets = targets.filter((target) => (
    !isGlobalPageTarget(target) && canLocateTarget(target)
  ));
  const reboundById = new Map(
    rebindCanvasSelectionTargetsAcrossHistory(
      currentHtml,
      nextHtml,
      localTargets,
      transition,
    ).map((target) => [target.id, target]),
  );
  return targets.map((target) => (
    isGlobalPageTarget(target)
      ? exactGlobalPageTarget(target)
      : canLocateTarget(target)
        ? reboundById.get(target.id) || target
        : target
  ));
}

export function normalizeGlobalCommentTargets(comments: CommentItem[]): {
  comments: CommentItem[];
  changed: boolean;
} {
  let changed = false;
  const normalized = comments.map((comment) => {
    const sourceTarget = comment.sourceAnchor;
    if (!isGlobalPageTarget(sourceTarget)) return comment;
    const target = exactGlobalPageTarget(sourceTarget);
    if (
      sourceTarget.tagName === target.tagName
      && sourceTarget.label === target.label
      && sourceTarget.text === target.text
      && sourceTarget.resolution === target.resolution
    ) return comment;
    changed = true;
    return {
      ...comment,
      sourceAnchor: independentCommentTarget(target, comment.commentId),
    };
  });
  return { comments: changed ? normalized : comments, changed };
}

export function recordId(
  prefix: "comment" | "change" | "attachment",
  counter: number,
): string {
  return `${prefix}_${Date.now().toString(36)}_${String(counter).padStart(4, "0")}`;
}

export function independentCommentTarget(
  target: HtmlCanvasSelection,
  commentId: string,
): HtmlCanvasSelection {
  const safeCommentId = commentId.replace(/[^A-Za-z0-9_-]/gu, "_")
    || "comment_unknown";
  return {
    ...target,
    id: `target_${safeCommentId}`,
  };
}

export function persistedAttachment(
  attachment: CommentAttachment,
): CommentAttachment {
  return {
    ...attachment,
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
    relativePath: attachment.relativePath,
    ...(attachment.requestRelativePath
      ? { requestRelativePath: attachment.requestRelativePath }
      : {}),
    ...(attachment.source ? { source: attachment.source } : {}),
  };
}

function commentAttachmentFingerprint(
  attachments: readonly CommentAttachment[],
): string {
  return attachments
    .map((attachment) => attachment.attachmentId)
    .sort()
    .join("\u0000");
}

export function commentEditSessionHasChanges(
  session: CommentEditSession | null,
): boolean {
  if (!session) return false;
  return session.draftText !== session.baselineText
    || commentAttachmentFingerprint(session.draftAttachments)
      !== commentAttachmentFingerprint(session.baselineAttachments);
}

export function attachmentFromRecord(
  value: unknown,
): CommentAttachment | null {
  if (!isRecord(value)) return null;
  const attachmentId = String(value.attachmentId || "");
  const fileName = String(value.fileName || "");
  const relativePath = String(value.relativePath || "");
  const sha256 = String(value.sha256 || "");
  const byteLength = Number(value.byteLength || 0);
  if (
    !/^attachment_[A-Za-z0-9_-]+$/.test(attachmentId)
    || !fileName
    || !relativePath
    || !/^sha256:[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
  ) return null;
  return {
    ...withoutFields(value, ["attachmentId", "kind", "fileName", "mediaType", "byteLength", "sha256", "relativePath", "requestRelativePath", "source"]),
    attachmentId,
    kind: value.kind === "image" ? "image" : "file",
    fileName,
    mediaType: String(value.mediaType || "application/octet-stream"),
    byteLength,
    sha256,
    relativePath,
    ...(value.requestRelativePath
      ? { requestRelativePath: String(value.requestRelativePath) }
      : {}),
    ...(value.source === "clipboard" || value.source === "file-picker"
      ? { source: value.source }
      : {}),
  };
}

export function formatFileSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${Math.ceil(byteLength / 1024)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(
    byteLength < 10 * 1024 * 1024 ? 1 : 0,
  )} MB`;
}

export function selectionFromRecord(raw: unknown): HtmlCanvasSelection {
  const item = isRecord(raw) ? raw : {};
  const selector = String(item.selector || "");
  const levelValue = String(item.level || "part");
  const resolutionValue = String(item.resolution || "");
  const resolution = (
    ["exact", "rebound", "ambiguous", "orphaned"].includes(resolutionValue)
      ? resolutionValue
      : "orphaned"
  ) as HtmlCanvasSelection["resolution"];
  const normalizedVisualHint = normalizeRuntimeVisualHint(item.visualHint);
  const selection: HtmlCanvasSelection = {
    id: String(item.targetId || ""),
    ...(item.elementId ? { elementId: String(item.elementId) } : {}),
    ...(item.expectedSourceSha256
      ? { expectedSourceSha256: String(item.expectedSourceSha256) }
      : {}),
    label: String(item.label || selector || "页面内容"),
    selector,
    level: levelValue === "module"
      ? "module"
      : levelValue === "insertion" || levelValue === "insertion-point"
        ? "insertion"
        : "part",
    tagName: isRecord(item.fingerprint)
      ? String(item.fingerprint.tagName || "")
      : levelValue === "insertion" || levelValue === "insertion-point"
        ? "insertion"
        : "",
    text: String(item.textQuote || ""),
    resolution,
    ...(item.textQuote ? { textQuote: String(item.textQuote) } : {}),
    ...(isRecord(item.textLocator)
      && Number.isInteger(item.textLocator.startOffset)
      && Number.isInteger(item.textLocator.endOffset)
      && Number(item.textLocator.startOffset) >= 0
      && Number(item.textLocator.endOffset) > Number(item.textLocator.startOffset)
      && (item.textLocator.affinity === "forward" || item.textLocator.affinity === "backward")
      ? {
          textLocator: {
            quote: String(item.textLocator.quote || ""),
            startOffset: Number(item.textLocator.startOffset),
            endOffset: Number(item.textLocator.endOffset),
            affinity: item.textLocator.affinity,
          },
        }
      : {}),
    ...(isRecord(item.sourceAnchor)
      ? {
          sourceAnchor: {
            startOffset: Number(item.sourceAnchor.startOffset || 0),
            endOffset: Number(item.sourceAnchor.endOffset || 0),
            sourceSha256: String(item.sourceAnchor.sourceSha256 || ""),
          },
        }
      : {}),
    ...(isRecord(item.fingerprint)
      ? {
          fingerprint: {
            tagName: String(item.fingerprint.tagName || ""),
            stableAttributes: isRecord(item.fingerprint.stableAttributes)
              ? Object.fromEntries(
                  Object.entries(item.fingerprint.stableAttributes).map(
                    ([key, value]) => [key, String(value)],
                  ),
                )
              : {},
            ancestorFingerprint: Array.isArray(
              item.fingerprint.ancestorFingerprint,
            )
              ? item.fingerprint.ancestorFingerprint.map(String)
              : [],
            ...(item.fingerprint.textPrefix
              ? { textPrefix: String(item.fingerprint.textPrefix) }
              : {}),
            ...(item.fingerprint.textSuffix
              ? { textSuffix: String(item.fingerprint.textSuffix) }
              : {}),
          },
        }
      : {}),
    ...(normalizedVisualHint
      ? { visualHint: normalizedVisualHint as HtmlCanvasRuntimeVisualHint }
      : {}),
  };
  return isGlobalPageTarget(selection)
    ? exactGlobalPageTarget(selection)
    : selection;
}

export type PersistedTargetRef = {
  targetId: string;
  elementId?: string;
  expectedSourceSha256?: string;
  label: string;
  level: "module" | "subregion" | "insertion-point";
  selector: string;
  textQuote?: string;
  textLocator?: HtmlCanvasSelection["textLocator"];
  sourceAnchor?: HtmlCanvasSelection["sourceAnchor"];
  fingerprint?: HtmlCanvasSelection["fingerprint"];
  resolution: HtmlCanvasSelection["resolution"];
};

export function persistedTargetRef(
  target: HtmlCanvasSelection,
): PersistedTargetRef {
  return {
    targetId: target.id,
    ...(target.elementId ? { elementId: target.elementId } : {}),
    ...(target.expectedSourceSha256
      ? { expectedSourceSha256: target.expectedSourceSha256 }
      : {}),
    label: target.level === "insertion"
      ? (
          target.label.includes("添加内容")
            ? target.label
            : `${target.label.replace(/[。；;，,\s]+$/u, "")}添加内容`
        )
      : target.label,
    level: target.level === "part"
      ? "subregion"
      : target.level === "insertion"
        ? "insertion-point"
        : "module",
    selector: target.selector,
    ...(target.textQuote !== undefined ? { textQuote: target.textQuote } : {}),
    ...(target.textLocator ? { textLocator: { ...target.textLocator } } : {}),
    ...(target.sourceAnchor ? { sourceAnchor: { ...target.sourceAnchor } } : {}),
    ...(target.fingerprint
      ? {
          fingerprint: {
            ...target.fingerprint,
            stableAttributes: { ...target.fingerprint.stableAttributes },
            ancestorFingerprint: [...target.fingerprint.ancestorFingerprint],
          },
        }
      : {}),
    resolution: target.resolution,
  };
}

// Only unknown record extensions survive here; known legacy target fields are
// discarded on ingress and regenerated from sourceAnchor on egress.
const COMMENT_RECORD_EXTENSIONS = Symbol("comment-record-extensions");
const TARGET_RECORD_FIELDS = [
  "targetId", "id", "elementId", "expectedSourceSha256", "label", "level", "selector",
  "textQuote", "textLocator", "sourceAnchor", "fingerprint", "resolution", "visualHint",
];
type CommentRecordExtensions = Partial<Record<"target" | "sourceAnchor", Record<string, unknown>>>;
type CommentWithRecordExtensions = CommentItem & { [COMMENT_RECORD_EXTENSIONS]?: CommentRecordExtensions };

function withoutFields(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}

function targetRecordExtensions(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const extensions = withoutFields(value, TARGET_RECORD_FIELDS);
  for (const [key, fields] of [
    ["textLocator", ["quote", "startOffset", "endOffset", "affinity"]],
    ["sourceAnchor", ["startOffset", "endOffset", "sourceSha256"]],
    ["fingerprint", ["tagName", "stableAttributes", "ancestorFingerprint", "textPrefix", "textSuffix"]],
  ] as const) {
    const nested = withoutFields(value[key], fields);
    if (Object.keys(nested).length) extensions[key] = nested;
  }
  return extensions;
}

function withTargetRecordExtensions(
  target: PersistedTargetRef,
  extensions: Record<string, unknown> = {},
): PersistedTargetRef {
  const result = { ...extensions, ...target };
  for (const key of ["textLocator", "sourceAnchor", "fingerprint"] as const) {
    // Removed locators/anchors stay removed; extensions cannot revive authority.
    if (!target[key]) delete result[key];
    else if (isRecord(extensions[key])) {
      Object.assign(result, { [key]: { ...extensions[key], ...target[key] } });
    }
  }
  return result;
}

export function persistedComment(comment: CommentItem) {
  const sourceTarget = comment.sourceAnchor;
  const sourceAnchor = persistedTargetRef(sourceTarget);
  const visualHint = comment.visualHint;
  const { [COMMENT_RECORD_EXTENSIONS]: extensions, ...fields } = comment as CommentWithRecordExtensions;
  return {
    ...fields,
    ...(comment.attachments?.length
      ? { attachments: comment.attachments.map(persistedAttachment) }
      : {}),
    target: withTargetRecordExtensions(sourceAnchor, extensions?.target),
    sourceAnchor: withTargetRecordExtensions(sourceAnchor, extensions?.sourceAnchor),
    ...(visualHint ? { visualHint } : {}),
  };
}

export function persistedChangeEvent(event: DirectEditEvent) {
  return {
    ...event,
    target: persistedTargetRef(event.target),
  };
}

export function commentsFromRecords(raw: unknown): CommentItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const createdAt = String(value.createdAt || "");
    const commentId = String(value.commentId || "");
    if (!commentId) return [];
    const recordedSourceAnchor = isRecord(value.sourceAnchor)
      && (
        value.sourceAnchor.targetId
        || value.sourceAnchor.elementId
      )
      ? value.sourceAnchor
      : value.target || value;
    const { visualHint: sourceVisualHint, ...sourceAnchor } = selectionFromRecord(recordedSourceAnchor);
    const visualHint = normalizeRuntimeVisualHint(value.visualHint)
      || normalizeRuntimeVisualHint(isRecord(value.target) ? value.target.visualHint : undefined)
      || sourceVisualHint;
    const persistedSourceAnchor = independentCommentTarget(sourceAnchor, commentId);
    const fields = withoutFields(value, [
      "commentId", "createdAt", "updatedAt", "target", "sourceAnchor", "visualHint", "text",
      "attachments", "basedOnVersionId", "requestId", "attemptId", "resultVersionId",
      ...(recordedSourceAnchor === value ? TARGET_RECORD_FIELDS : []),
    ]);
    return [{
      ...fields,
      [COMMENT_RECORD_EXTENSIONS]: {
        target: targetRecordExtensions(value.target),
        sourceAnchor: targetRecordExtensions(value.sourceAnchor),
      },
      commentId,
      createdAt,
      updatedAt: String(value.updatedAt || createdAt),
      sourceAnchor: persistedSourceAnchor,
      ...(visualHint ? { visualHint } : {}),
      text: String(value.text || ""),
      ...(Array.isArray(value.attachments)
        ? {
            attachments: value.attachments
              .map(attachmentFromRecord)
              .filter((item): item is CommentAttachment => Boolean(item)),
          }
        : {}),
      basedOnVersionId: value.basedOnVersionId ? String(value.basedOnVersionId) : null,
      ...(value.requestId ? { requestId: String(value.requestId) } : {}),
      ...(value.attemptId ? { attemptId: String(value.attemptId) } : {}),
      ...(value.resultVersionId
        ? { resultVersionId: String(value.resultVersionId) }
        : {}),
    }];
  });
}

export function uniqueTargets(comments: CommentItem[]): HtmlCanvasSelection[] {
  const seen = new Set<string>();
  return comments.flatMap((comment) => {
    const target = comment.sourceAnchor;
    if (seen.has(target.id)) return [];
    seen.add(target.id);
    return [target];
  });
}

export function insertionLabel(target: HtmlCanvasSelection): string {
  const label = persistedTargetRef(target).label;
  return target.level === "insertion" ? `添加位置：${label}` : label;
}

export function targetResolutionLabel(
  resolution: HtmlCanvasSelection["resolution"],
): string {
  if (resolution === "exact") return "精确定位";
  if (resolution === "rebound") return "已唯一重绑";
  if (resolution === "ambiguous") return "多个候选，已阻止定位";
  return "目标已失联";
}
