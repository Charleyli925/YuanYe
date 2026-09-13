import {
  commentVisualTarget,
  insertionLabel,
  selectionFromRecord,
} from "./comment-model";
import { displayVersionLabel } from "./project-model";
import { isRecord } from "./record-model";
import {
  decodeDraftAuditChange,
  decodeVersionAuditChange,
} from "./version-compatibility-decoder.js";
import { versionEntryTitle } from "./version-graph";
import type {
  DirectEditEvent,
  UserSupplementRecord,
  Version,
} from "./types";

// The row label for a version. A version manifest has no dependable
// AI-authored change summary and every managed file in a project shares one
// name, so the user's own first requirement is the only stable, meaningful
// title. See app/workbench/version-graph.ts for the rule. `peers` lets a
// branch head fall back to naming the version it forked from.
export function versionTitle(
  version: Version,
  peers: readonly Version[] = [],
): string {
  const branchedFrom = version.basedOnVersionId
    && version.basedOnVersionId !== version.previousVersionId
    ? peers.find((peer) => peer.id === version.basedOnVersionId) ?? null
    : null;
  return versionEntryTitle({
    isInitial: version.source === "初始页面",
    comments: version.comments.map((comment) => {
      const displayTarget = commentVisualTarget(comment);
      return {
        label: insertionLabel(displayTarget),
        text: comment.text,
      };
    }),
    requirement: version.requirement,
    directEditCount: version.directEdits.length,
    branchedFromOrdinal: branchedFrom ? branchedFrom.ordinal : null,
  });
}

export function changesFromRecords(raw: unknown): DirectEditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const decoded = decodeVersionAuditChange(value);
    if (!decoded) return [];
    return [{
      eventId: decoded.eventId,
      createdAt: decoded.createdAt,
      kind: decoded.kind as DirectEditEvent["kind"],
      target: selectionFromRecord(decoded.target),
      ...(decoded.property ? { property: decoded.property } : {}),
      before: decoded.before,
      after: decoded.after,
      basedOnVersionId: decoded.basedOnVersionId,
      revision: decoded.revision,
    }];
  });
}

export function changesFromDraftRecords(
  raw: unknown,
): DirectEditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const decoded = decodeDraftAuditChange(value);
    if (!decoded) return [];
    return [{
      eventId: decoded.eventId,
      createdAt: decoded.createdAt,
      kind: decoded.kind as DirectEditEvent["kind"],
      target: selectionFromRecord(decoded.target),
      ...(decoded.property ? { property: decoded.property } : {}),
      before: decoded.before,
      after: decoded.after,
      basedOnVersionId: decoded.basedOnVersionId,
      revision: decoded.revision,
    }];
  });
}

export function supplementsFromRecords(raw: unknown): UserSupplementRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const action = String(value.action || "");
    const evidenceState = String(value.evidenceState || "text-only");
    if (!(["add", "amend", "retract"] as const).includes(
      action as "add" | "amend" | "retract",
    )) return [];
    if (!(["text-only", "original-file", "description-only"] as const).includes(
      evidenceState as "text-only" | "original-file" | "description-only",
    )) return [];
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.flatMap((attachment) => {
          if (!isRecord(attachment)) return [];
          return [{
            attachmentId: String(attachment.attachmentId || ""),
            fileName: String(attachment.fileName || "附件"),
            mediaType: String(
              attachment.mediaType || "application/octet-stream",
            ),
            ...(attachment.relativePath
              ? { relativePath: String(attachment.relativePath) }
              : {}),
            ...(attachment.sha256 ? { sha256: String(attachment.sha256) } : {}),
          }];
        })
      : [];
    const refersTo = Array.isArray(value.refersTo)
      ? value.refersTo.map(String).filter(Boolean)
      : [];
    return [{
      recordId: String(value.recordId || ""),
      action: action as UserSupplementRecord["action"],
      text: String(value.userText || ""),
      createdAt: String(value.recordedAt || ""),
      ...(refersTo[0] ? { referenceId: refersTo[0] } : {}),
      evidenceState: evidenceState as UserSupplementRecord["evidenceState"],
      ...(value.evidenceDescription
        ? { evidenceDescription: String(value.evidenceDescription) }
        : {}),
      attachments,
    }];
  });
}

export function versionsFromWorkspace(
  payload: Record<string, unknown>,
): Version[] {
  if (!Array.isArray(payload.versions)) throw new TypeError("工作区缺少版本列表。");
  if (payload.versions.length && (!payload.projectId || !payload.documentId)) {
    throw new TypeError("工作区缺少项目或文档身份。");
  }
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const raw of payload.versions) {
    if (!isRecord(raw) || raw.schemaVersion !== "4.0.0"
      || typeof raw.versionId !== "string" || !raw.versionId.trim()
      || !Number.isSafeInteger(raw.ordinal) || Number(raw.ordinal) < 1
      || ids.has(raw.versionId) || ordinals.has(Number(raw.ordinal))
      || (raw.projectId !== undefined && raw.projectId !== payload.projectId)
      || (raw.documentId !== undefined && raw.documentId !== payload.documentId)
      || !["initial", "internal-ai", "history-copy"].includes(String(raw.sourceType))) {
      throw new TypeError("工作区版本身份或序号无效，已保留原会话。");
    }
    if (raw.sourceType === "history-copy" && (
      !/^[A-Za-z0-9_-]{8,160}$/.test(String(raw.sourceOperationId || ""))
      || raw.sourceRequestId !== null || raw.sourceCandidateId !== null
      || !payload.versions.some((entry) => isRecord(entry) && entry.versionId === raw.basedOnVersionId && Number(entry.ordinal) < Number(raw.ordinal) && entry.contentSha256 === raw.contentSha256)
      || !payload.versions.some((entry) => isRecord(entry) && entry.versionId === raw.previousVersionId && Number(entry.ordinal) + 1 === Number(raw.ordinal))
    )) throw new TypeError("历史创建版本的来源记录无效，已保留原会话。");
    ids.add(raw.versionId);
    ordinals.add(Number(raw.ordinal));
  }
  if (isRecord(payload.project) && (
    (payload.project.projectId !== undefined && payload.project.projectId !== payload.projectId)
    || (payload.project.documentId !== undefined && payload.project.documentId !== payload.documentId)
  )) throw new TypeError("工作区所属项目不一致。");
  for (const key of ["latestVersionId", "currentBasedOnVersionId", "currentExactVersionId"]) {
    if (payload[key] != null && !ids.has(String(payload[key]))) {
      throw new TypeError(`工作区 ${key} 无法解析。`);
    }
  }
  return payload.versions.map<Version>((raw) => {
    const id = String(raw.versionId || "");
    const ordinal = Number(raw.ordinal);
    const sourceType = String(raw.sourceType || "");
    return {
      id,
      ordinal,
      label: displayVersionLabel(ordinal),
      summary: String(raw.summary || (sourceType === "initial" ? "初始登记基线" : sourceType === "history-copy" ? "基于历史创建的新版本" : "已采纳的 AI Candidate")),
      generatedAt: String(raw.generatedAt || raw.createdAt || ""),
      source: (
        sourceType === "internal-ai" ? "内部 AI" : sourceType === "history-copy" ? "历史创建" : "初始页面"
      ) as Version["source"],
      requirement: raw.requirement ? String(raw.requirement) : null,
      contentSha256: String(raw.contentSha256 || ""),
      previousVersionId: raw.previousVersionId ? String(raw.previousVersionId) : null,
      basedOnVersionId: raw.basedOnVersionId ? String(raw.basedOnVersionId) : null,
      requestId: raw.requestId ? String(raw.requestId) : null,
      attemptId: raw.attemptId ? String(raw.attemptId) : null,
      committed: true,
      comments: [],
      directEdits: [],
      supplements: [],
      validationReview: null,
      candidateAssessment: null,
      workingCopyId: raw.workingCopyId ? String(raw.workingCopyId) : null,
      displayFileName: raw.displayFileName ? String(raw.displayFileName) : undefined,
      modifiedAt: raw.modifiedAt ? String(raw.modifiedAt) : undefined,
      isActiveWorkingCopy: payload.currentBasedOnVersionId == null ? undefined : id === payload.currentBasedOnVersionId,
      isLatestOfficial: payload.latestVersionId == null ? undefined : id === payload.latestVersionId,
      differsFromBase: raw.differsFromBase === true,
      saveState: ["saved", "saving", "failed"].includes(String(raw.saveState || ""))
        ? String(raw.saveState) as Version["saveState"]
        : null,
    };
  }).sort((a, b) => b.ordinal - a.ordinal);
}

export function changeKindLabel(event: DirectEditEvent): string {
  if (event.kind === "text") return "文字修改";
  if (event.kind === "reorder") return "位置移动";
  if (event.kind === "structure") return "结构调整";
  const labels: Record<string, string> = {
    fontSize: "字号",
    color: "文字颜色",
    backgroundColor: "模块填充",
    fontWeight: "加粗",
    fontStyle: "斜体",
    padding: "内边距",
    margin: "外间距",
    lineHeight: "行距",
  };
  return labels[event.property || ""] || "样式调整";
}

function compactHistoryText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function recordValueScalar(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (
    value.inlineValue !== null
    && value.inlineValue !== undefined
    && value.inlineValue !== ""
  ) {
    return value.inlineValue;
  }
  if (
    value.computedValue !== null
    && value.computedValue !== undefined
    && value.computedValue !== ""
  ) {
    return value.computedValue;
  }
  return value.value ?? value.index ?? value.toIndex ?? value.fromIndex ?? null;
}

function friendlyStyleValue(
  property: string | undefined,
  value: unknown,
): string {
  const scalar = recordValueScalar(value);
  const normalized = String(scalar ?? "").trim().toLowerCase();
  if (!normalized) return "未设置";
  if (property === "fontWeight") {
    const numeric = Number.parseInt(normalized, 10);
    if (
      normalized === "bold"
      || Number.isFinite(numeric) && numeric >= 600
    ) return "加粗";
    if (
      normalized === "normal"
      || Number.isFinite(numeric) && numeric < 600
    ) return "常规";
  }
  if (property === "fontStyle") {
    if (normalized === "italic" || normalized === "oblique") return "斜体";
    if (normalized === "normal") return "常规";
  }
  if (
    property === "backgroundColor"
    && ["transparent", "rgba(0, 0, 0, 0)"].includes(normalized)
  ) {
    return "透明";
  }
  return compactHistoryText(scalar);
}

export function historyRecordValue(
  event: DirectEditEvent,
  value: unknown,
): string {
  if (event.kind === "reorder" && isRecord(value)) {
    const index = Number(value.index ?? value.toIndex ?? value.fromIndex);
    return Number.isFinite(index) ? `第 ${index + 1} 位` : "原位置";
  }
  if (event.kind === "text") {
    const text = compactHistoryText(value);
    return text === "未设置" ? text : `“${text}”`;
  }
  if (event.kind === "style") return friendlyStyleValue(event.property, value);
  return compactHistoryText(recordValueScalar(value));
}

export function summarizeChangeEvents(
  events: DirectEditEvent[],
): DirectEditEvent[] {
  const summaries = new Map<string, DirectEditEvent>();
  for (const event of events) {
    const key = [
      event.target.id || event.target.selector,
      event.kind,
      event.property || "",
    ].join("::");
    const existing = summaries.get(key);
    summaries.set(key, existing
      ? {
          ...event,
          eventId: existing.eventId,
          before: existing.before,
          createdAt: event.createdAt,
        }
      : event);
  }
  return [...summaries.values()];
}
