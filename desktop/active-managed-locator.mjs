import { randomUUID } from "node:crypto";
import path from "node:path";

const PROJECT_ID = /^project_[A-Za-z0-9_-]+$/u;
const DOCUMENT_ID = /^doc_[A-Za-z0-9_-]+$/u;
const WORKING_COPY_ID = /^work_ver_\d{4,}$/u;
const VERSION_ID = /^ver_\d{4,}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const MAX_PATH_LENGTH = 4096;

export function createActiveManagedReconcileOperationId(uuid = randomUUID) {
  const suffix = String(uuid()).replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(suffix)) {
    throw new TypeError("活动工作文件核对操作 ID 无效。");
  }
  return `reconcile_${suffix}`;
}

function assertHtmlPath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
  ) {
    throw new TypeError(`${label}无效。`);
  }
  const resolved = path.resolve(value);
  if (!HTML_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new TypeError(`${label}必须以 .html 或 .htm 结尾。`);
  }
  return resolved;
}

function comparableManagedPath(value) {
  let resolved = path.resolve(String(value || "")).normalize("NFC");
  if (resolved === "/private/var" || resolved.startsWith("/private/var/")) {
    resolved = resolved.slice("/private".length);
  } else if (resolved === "/private/tmp" || resolved.startsWith("/private/tmp/")) {
    resolved = resolved.slice("/private".length);
  }
  if (process.platform === "darwin" || process.platform === "win32") {
    resolved = resolved.toLocaleLowerCase("en-US");
  }
  return resolved;
}

export function sameManagedPath(left, right) {
  return Boolean(left && right && comparableManagedPath(left) === comparableManagedPath(right));
}

export function normalizeActiveManagedLocator(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const projectId = String(value.projectId || "");
    const documentId = String(value.documentId || "");
    const workingCopyId = String(value.workingCopyId || "");
    const versionId = String(value.versionId || "");
    const sourceSha256 = String(value.sourceSha256 || "").trim().toLowerCase();
    const projectRootPath = String(value.projectRootPath || "");
    if (
      !PROJECT_ID.test(projectId)
      || !DOCUMENT_ID.test(documentId)
      || !WORKING_COPY_ID.test(workingCopyId)
      || !VERSION_ID.test(versionId)
      || !SHA256.test(sourceSha256)
      || !projectRootPath
      || projectRootPath.length > MAX_PATH_LENGTH
      || projectRootPath.includes("\0")
    ) return null;
    return {
      projectId,
      documentId,
      workingCopyId,
      versionId,
      sourcePath: assertHtmlPath(value.sourcePath, "sourcePath"),
      sourceSha256,
      projectRootPath: path.resolve(projectRootPath),
    };
  } catch {
    return null;
  }
}

export function activeManagedLocatorFromOpenTarget(target, sourceSha256 = null) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  return normalizeActiveManagedLocator({
    projectId: target.projectId,
    documentId: target.documentId,
    workingCopyId: target.workingCopyId,
    versionId: target.versionId,
    sourcePath: target.exactSourcePath || target.sourcePath,
    sourceSha256: sourceSha256 || target.sourceSha256,
    projectRootPath: target.projectRootPath,
  });
}

export function activeManagedLocatorForActivatedPath(
  target,
  activatedSourcePath,
  sourceSha256 = null,
) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  return activeManagedLocatorFromOpenTarget({
    ...target,
    exactSourcePath: activatedSourcePath,
    sourcePath: activatedSourcePath,
  }, sourceSha256);
}

export function rebaseActiveManagedLocator(locator, {
  previousSourcePath,
  nextSourcePath,
  sourceSha256 = null,
  projectRootPath = null,
} = {}) {
  const current = normalizeActiveManagedLocator(locator);
  if (!current) return null;
  let previousKey = "";
  let nextKey = "";
  try {
    previousKey = previousSourcePath ? path.resolve(previousSourcePath) : "";
    nextKey = nextSourcePath ? path.resolve(nextSourcePath) : "";
  } catch {
    return current;
  }
  if (
    !sameManagedPath(current.sourcePath, previousKey)
    && !sameManagedPath(current.sourcePath, nextKey)
  ) return current;
  return normalizeActiveManagedLocator({
    ...current,
    sourcePath: nextKey || current.sourcePath,
    sourceSha256: sourceSha256 || current.sourceSha256,
    projectRootPath: projectRootPath || current.projectRootPath,
  });
}
