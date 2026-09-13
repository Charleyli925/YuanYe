export function copyProjectContext(context) {
  if (!context) return null;
  const epoch = Number(context.epoch);
  const projectId = String(context.projectId || "");
  const documentId = String(context.documentId || "");
  const sourcePath = String(context.sourcePath || "");
  if (!Number.isSafeInteger(epoch) || !sourcePath) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? epoch),
    }
    : {};
  return Object.freeze({ epoch, projectId, documentId, sourcePath, ...target });
}

export function verifyProjectContext(candidate, live, {
  disposed = false,
  sameSourcePath = (left, right) => left === right,
} = {}) {
  if (disposed) return null;
  const context = copyProjectContext(candidate);
  if (!context || !live) return null;
  if (context.projectId && context.documentId) {
    return typeof live.matches === "function" && live.matches(context)
      ? context
      : null;
  }
  if (Number(live.epoch) !== context.epoch) return null;
  if (!sameSourcePath(live.sourcePath, context.sourcePath)) return null;
  return context;
}

const OPEN_TARGET_SHA256 = /^sha256:[a-f0-9]{64}$/u;

/**
 * Validate a complete managed OpenTarget without borrowing identity fields
 * from a surrounding workspace/request payload. Callers may provide a
 * verified source hash; when present it is an exact fence, never a fallback.
 */
export function verifyOpenTarget(target, {
  projectId = null,
  documentId = null,
  sourcePath = null,
  sourceSha256 = null,
  sameSourcePath = (left, right) => left === right,
  targetKind = null,
} = {}) {
  if (
    !target
    || typeof target !== "object"
    || Array.isArray(target)
    || !String(target.projectId || "")
    || !String(target.documentId || "")
    || !String(target.projectRootPath || "")
    || !["working-copy", "version"].includes(String(target.targetKind || ""))
    || (targetKind && String(target.targetKind) !== String(targetKind))
    || !String(target.exactSourcePath || "")
    || !OPEN_TARGET_SHA256.test(String(target.sourceSha256 || ""))
    || (projectId && String(target.projectId) !== String(projectId))
    || (documentId && String(target.documentId) !== String(documentId))
    || (sourcePath && !sameSourcePath(String(target.exactSourcePath), String(sourcePath)))
    || (sourceSha256 && String(target.sourceSha256) !== String(sourceSha256))
    || (String(target.targetKind) === "working-copy"
      && (!String(target.workingCopyId || "") || !String(target.versionId || "")))
    || (String(target.targetKind) === "version" && !String(target.versionId || ""))
  ) return null;
  return Object.freeze({ ...target });
}
