export function planDocumentEnqueue({
  disposed = false,
  persistState = "idle",
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_WORKFLOW_DISPOSED",
      reason: "文档持久化工作流已经停止。",
    });
  }
  if (persistState === "conflict") {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_PERSISTENCE_CONFLICT",
      reason: "当前 HTML 与外部文件存在冲突，请先选择要保留的版本。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planDocumentSave({
  disposed = false,
  flushInFlight = false,
  pendingWrite = null,
  editRevision = 0,
  lastPersistedRevision = 0,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_WORKFLOW_DISPOSED",
      reason: "文档持久化工作流已经停止。",
    });
  }
  if (flushInFlight) {
    return Object.freeze({ kind: "wait" });
  }
  if (!pendingWrite) {
    if (Number(editRevision) <= Number(lastPersistedRevision)) {
      return Object.freeze({
        kind: "ready",
        action: "idle",
        revision: Number(lastPersistedRevision),
      });
    }
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_SOURCE_UNBOUND",
      reason: "当前编辑尚未绑定本地 HTML，无法写回源文件。",
    });
  }
  if (!pendingWrite.sourcePath) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_SOURCE_UNBOUND",
      reason: "当前编辑尚未绑定本地 HTML，无法写回源文件。",
    });
  }
  return Object.freeze({
    kind: "ready",
    action: "write",
  });
}

export function planDocumentLeaveReadiness({
  obligationsResolved = false,
  hasPendingNativeEdit = false,
  hasHistoryAction = false,
  persistState = "idle",
  pendingWrite = false,
  flushInFlight = false,
  editRevision = 0,
  lastPersistedRevision = 0,
  sourcePath = "",
  persistedSourceSha256 = "",
  workingHtmlSha256 = persistedSourceSha256,
  canvasStatus = "idle",
  renderedSha256 = "",
  canvasRenderedSha256 = renderedSha256,
} = {}) {
  const reusable = obligationsResolved
    && !hasPendingNativeEdit
    && !hasHistoryAction
    && persistState === "idle"
    && !pendingWrite
    && !flushInFlight
    && Number(editRevision) === Number(lastPersistedRevision)
    && Boolean(sourcePath)
    && Boolean(persistedSourceSha256)
    && Boolean(workingHtmlSha256)
    && canvasStatus === "verified"
    && String(canvasRenderedSha256) === String(workingHtmlSha256)
    && String(workingHtmlSha256) === String(persistedSourceSha256);
  return Object.freeze({
    kind: "ready",
    action: reusable ? "reuse-verified" : "full-check",
  });
}

export function planDocumentLeaveAfterDrain({
  editRevision = 0,
  cutoffRevision = 0,
  pendingWrite = false,
  flushInFlight = false,
  hasHistoryAction = false,
  recoveryProtected = false,
} = {}) {
  if (
    Number(editRevision) !== Number(cutoffRevision)
    || (pendingWrite && !recoveryProtected)
    || flushInFlight
    || hasHistoryAction
  ) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_SOURCE_CHANGED",
      reason: "当前 HTML 在切换边界后仍有修改尚未安全写回。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planDocumentLeaveProtection({
  needsSourceProtection = false,
  sourcePath = "",
  lastPersistedRevision = 0,
  cutoffRevision = 0,
  committedSourceSha256 = "",
  persistedSourceSha256 = "",
  workingHtmlSha256 = persistedSourceSha256,
  protectionHtmlSha256 = "",
  recoveryProtected = false,
} = {}) {
  if (!needsSourceProtection) {
    return Object.freeze({ kind: "ready" });
  }
  const workingHash = String(workingHtmlSha256 || "");
  const committedHash = String(committedSourceSha256 || "");
  if (recoveryProtected && (
    !workingHash
    || committedHash !== workingHash
    || String(protectionHtmlSha256 || "") !== workingHash
  )) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_PROTECTION_MISMATCH",
      reason: "当前 HTML、画布与恢复保护凭证不一致。",
    });
  }
  if (!recoveryProtected && sourcePath && (
    Number(lastPersistedRevision) !== Number(cutoffRevision)
    || String(persistedSourceSha256 || "") !== workingHash
    || committedHash !== workingHash
  )) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_SOURCE_MISMATCH",
      reason: "当前 HTML 与已持久化源的最终身份不一致。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
