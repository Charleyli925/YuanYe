export function planProjectSwitchEntry({
  disposed = false,
  drainBlockedReason = null,
  projectLoadError = false,
  runLocked = false,
  hasHistoryAction = false,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_WORKFLOW_DISPOSED",
      reason: "项目切换工作流已经停止。",
    });
  }
  if (drainBlockedReason) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_BLOCKED",
      reason: String(drainBlockedReason),
    });
  }
  if (projectLoadError) {
    return Object.freeze({ kind: "ready", action: "reset-failed" });
  }
  if (runLocked) {
    return Object.freeze({ kind: "ready", action: "drain-run-lock" });
  }
  if (hasHistoryAction) {
    return Object.freeze({ kind: "wait", reason: "history" });
  }
  return Object.freeze({ kind: "ready", action: "continue" });
}

export function planProjectSwitchFence({
  needsCanvasCommit = false,
  fenceOk = true,
  fenceReason = "",
} = {}) {
  if (!needsCanvasCommit) {
    return Object.freeze({ kind: "ready" });
  }
  if (!fenceOk) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_NATIVE_EDIT",
      reason: String(fenceReason || "请点回文字完成输入，再切换项目。"),
    });
  }
  return Object.freeze({ kind: "ready" });
}
