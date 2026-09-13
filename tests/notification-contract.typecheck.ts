import type { GlobalInterruption } from "../app/lib/global-interruption";

const recopy: GlobalInterruption = {
  kind: "handoff-recopy",
  succeeded: true,
};

const exportFailed: GlobalInterruption = {
  kind: "export-failed",
  detail: "请选择另一个文件名或位置后重试。",
};

const attachmentRejected: GlobalInterruption = {
  kind: "attachment-rejected",
  detail: "请选择其他文件。",
  needsRemoval: false,
  target: { kind: "composer", commentId: "comment-1" },
};

const retryPreparedOpen: GlobalInterruption = {
  kind: "project-open-failed",
  detail: "这次打开没有完成。",
  requestId: "opaque-prepared-request",
};

const forbiddenProjectOpenPath: GlobalInterruption = {
  kind: "project-open-failed",
  // @ts-expect-error retry state carries an opaque requestId, never path authority
  sourcePath: "/private/source.html",
};

// @ts-expect-error unknown kinds are not part of the closed interruption catalog
const invented: GlobalInterruption = { kind: "made-up-toast" };

const freeFormTitle: GlobalInterruption = {
  kind: "export-failed",
  detail: "请选择另一个文件名或位置后重试。",
  // @ts-expect-error callers pass facts, not banner copy
  title: "anything",
};

void [
  recopy,
  exportFailed,
  attachmentRejected,
  retryPreparedOpen,
  forbiddenProjectOpenPath,
  invented,
  freeFormTitle,
];
