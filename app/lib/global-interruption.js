// Closed allowlisted interruptions. Business code names a kind and facts;
// title, tone, duration and action labels live only here.

export const GLOBAL_INTERRUPTION_KINDS = Object.freeze([
  "import-trash-failed",
  "external-agent-may-still-run",
  "external-open-unavailable",
  "project-open-failed",
  "attachment-rejected",
  "attachment-batch-partial",
  "show-in-folder-failed",
  "open-in-browser-failed",
  "export-failed",
  "handoff-recopy",
]);

/**
 * @param {import("./global-interruption").GlobalInterruption} interruption
 * @returns {import("./global-interruption").GlobalInterruptionPresentation | null}
 */
export function globalInterruptionPresentation(interruption) {
  if (!interruption || !GLOBAL_INTERRUPTION_KINDS.includes(interruption.kind)) {
    return null;
  }
  switch (interruption.kind) {
    case "import-trash-failed":
      return {
        kind: interruption.kind,
        title: "已导入 PageRoot",
        message: `已保存为${interruption.fileName || "项目内的 V1 文件"}，原文件未能移至废纸篓，仍留在原来的位置。`,
        tone: "warning",
        dismissMs: 8_000,
        actionId: interruption.sourcePath ? "reveal-imported-project" : null,
        actionLabel: interruption.sourcePath ? "在文件夹中打开" : null,
        usageKey: "external-html-imported",
      };
    case "external-agent-may-still-run":
      return {
        kind: interruption.kind,
        title: interruption.current ? "本轮已结束，已恢复编辑" : "本轮已结束",
        message: "AI Agent 不会被自动停止；如仍在运行，请手动停止。",
        tone: "info",
        dismissMs: 8_000,
        actionId: null,
        actionLabel: null,
        usageKey: `ai-run-cancelled:${interruption.sourcePath || ""}`,
      };
    case "external-open-unavailable":
      return {
        kind: interruption.kind,
        title: "无法接收外部 HTML",
        message: interruption.detail || "当前 PageRoot 版本缺少外部文件打开通道。",
        tone: "error",
        dismissMs: null,
        actionId: null,
        actionLabel: null,
        usageKey: "external-project-open-unavailable",
      };
    case "project-open-failed":
      return {
        kind: interruption.kind,
        title: "无法打开这个 HTML",
        message: interruption.detail || "文件暂时无法完成安全切换。",
        tone: "error",
        dismissMs: null,
        actionId: "retry-project-open",
        actionLabel: interruption.recent ? "重新选择位置" : "重新选择",
        actionRequestId: typeof interruption.requestId === "string"
          && interruption.requestId
          ? interruption.requestId
          : undefined,
        usageKey: "project-open-error",
      };
    case "attachment-rejected":
      return {
        kind: interruption.kind,
        title: "附件没有加入",
        message: interruption.detail || "请选择其他文件。",
        tone: "warning",
        dismissMs: null,
        actionId: interruption.needsRemoval
          ? "review-comment-attachments"
          : "open-attachment-picker",
        actionLabel: interruption.needsRemoval ? "查看附件" : "重新选择",
        usageKey: `attachment-batch-${interruption.target?.commentId || ""}`,
      };
    case "attachment-batch-partial":
      return {
        kind: interruption.kind,
        title: interruption.added ? "部分附件没有加入" : "附件没有加入",
        message: interruption.detail || "已加入的附件仍然保留。",
        tone: interruption.composerOpen && interruption.failed ? "error" : "warning",
        dismissMs: interruption.composerOpen ? null : 8_000,
        actionId: interruption.composerOpen
          ? (interruption.needsRemoval
            ? "review-comment-attachments"
            : "open-attachment-picker")
          : null,
        actionLabel: interruption.composerOpen
          ? (interruption.needsRemoval ? "查看附件" : "重新选择")
          : null,
        usageKey: `attachment-batch-${interruption.target?.commentId || ""}`,
      };
    case "show-in-folder-failed":
      return {
        kind: interruption.kind,
        title: "无法在文件夹中打开",
        message: interruption.detail
          || "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        tone: "warning",
        dismissMs: 8_000,
        actionId: null,
        actionLabel: null,
        usageKey: "show-project-in-folder-error",
      };
    case "open-in-browser-failed":
      return {
        kind: interruption.kind,
        title: "无法在默认浏览器中打开",
        message: interruption.detail
          || "请确认修改已写入源 HTML 后重试；当前项目仍保持打开。",
        tone: "warning",
        dismissMs: 8_000,
        actionId: null,
        actionLabel: null,
        usageKey: "open-project-in-default-browser-error",
      };
    case "export-failed":
      return {
        kind: interruption.kind,
        title: "副本没有导出",
        message: interruption.detail || "请选择另一个文件名或位置后重试。",
        tone: "error",
        dismissMs: null,
        actionId: "retry-export",
        actionLabel: "重新选择位置",
        usageKey: "export",
      };
    case "handoff-recopy":
      return {
        kind: interruption.kind,
        title: interruption.succeeded ? "本轮要求已复制" : "复制没有成功",
        message: interruption.succeeded
          ? "粘贴给你的 AI；改完回到这里。"
          : "再试一次；本轮要求就在这条对话里。",
        tone: interruption.succeeded ? "success" : "warning",
        dismissMs: 3_500,
        actionId: null,
        actionLabel: null,
        usageKey: "handoff-recopied",
      };
    default:
      return null;
  }
}
