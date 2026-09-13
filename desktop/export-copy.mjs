import { lstat, stat } from "node:fs/promises";
import path from "node:path";

import { ProjectFileError } from "./project-files.mjs";

export const PROJECT_IPC_PROTOCOL = "html-ai-project-result";
export const PROJECT_IPC_VERSION = 1;

const GENERIC_PROJECT_ERROR = Object.freeze({
  code: "FILE_OPERATION_FAILED",
  message: "本地文件操作没有完成，请重试或选择其他位置。",
});

const PUBLIC_CONFIRMATION_STRING_FIELDS = [
  "sourceFileName",
  "projectName",
  "currentBasedOnVersionId",
  "latestOfficialVersionId",
];
const PUBLIC_CONFIRMATION_NULLABLE_STRING_FIELDS = new Set([
  "currentBasedOnVersionId",
  "latestOfficialVersionId",
]);

function boundedPublicString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function serializableConfirmation(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (code !== "OPEN_INTENT_RECLASSIFIED" || value.classification !== "known-external") {
    return undefined;
  }
  if (value.openKind !== "confirmation") return undefined;
  const requestId = boundedPublicString(value.requestId);
  const classification = "known-external";
  if (!requestId) {
    return undefined;
  }
  const confirmation = { requestId, classification };
  confirmation.openKind = "confirmation";
  for (const key of PUBLIC_CONFIRMATION_STRING_FIELDS) {
    if (value[key] === null && PUBLIC_CONFIRMATION_NULLABLE_STRING_FIELDS.has(key)) {
      confirmation[key] = null;
      continue;
    }
    const safeValue = boundedPublicString(value[key]);
    if (safeValue === null) return undefined;
    confirmation[key] = safeValue;
  }
  for (const key of ["currentBasedOnOrdinal", "latestOfficialOrdinal"]) {
    if (!Number.isSafeInteger(value[key])) return undefined;
    confirmation[key] = value[key];
  }
  if (typeof value.currentDiffersFromBase !== "boolean") return undefined;
  confirmation.currentDiffersFromBase = value.currentDiffersFromBase;
  if (value.sourceRelation !== "changed" && value.sourceRelation !== "unchanged") {
    return undefined;
  }
  confirmation.sourceRelation = value.sourceRelation;
  for (const key of ["deleteOriginal", "busy"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return undefined;
    if (value[key] !== undefined) confirmation[key] = value[key];
  }
  return confirmation;
}

function serializableDetails(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const details = {};
  for (const [key, detail] of Object.entries(value)) {
    if (key === "confirmation") {
      const confirmation = serializableConfirmation(detail, code);
      if (confirmation) details.confirmation = confirmation;
      continue;
    }
    if (
      detail === null
      || typeof detail === "string"
      || typeof detail === "number"
      || typeof detail === "boolean"
    ) {
      details[key] = detail;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function normalizeProjectIpcError(error) {
  if (error instanceof ProjectFileError) {
    const details = serializableDetails(error.details, error.code);
    return {
      code: error.code,
      message: error.message,
      ...(details ? { details } : {}),
    };
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      code: "INVALID_FILE_REQUEST",
      message: error.message,
    };
  }

  if (
    typeof error?.code === "string"
    && error.code.startsWith("RECOVERY_JOURNAL_")
  ) {
    return {
      code: error.code,
      message: typeof error.message === "string" && error.message
        ? error.message
        : "恢复副本没有安全完成，请重试。",
    };
  }

  switch (error?.code) {
    case "ENOENT":
      return {
        code: "FILE_NOT_FOUND",
        message: "文件或文件夹已不存在，请重新选择。",
      };
    case "EACCES":
    case "EPERM":
      return {
        code: "PERMISSION_DENIED",
        message: "没有访问该位置的权限，请选择其他位置。",
      };
    case "ENOSPC":
      return {
        code: "DISK_FULL",
        message: "磁盘空间不足，源文件没有被改动。",
      };
    case "EROFS":
      return {
        code: "READ_ONLY_DESTINATION",
        message: "所选位置是只读的，请选择其他位置。",
      };
    case "ENOTDIR":
    case "EISDIR":
      return {
        code: "INVALID_DESTINATION",
        message: "所选导出位置无效，请重新选择文件夹和文件名。",
      };
    default:
      return GENERIC_PROJECT_ERROR;
  }
}

export async function runProjectIpcOperation(operation, { onError } = {}) {
  try {
    return {
      protocol: PROJECT_IPC_PROTOCOL,
      version: PROJECT_IPC_VERSION,
      ok: true,
      value: await operation(),
    };
  } catch (error) {
    const normalized = normalizeProjectIpcError(error);
    onError?.(error, normalized);
    return {
      protocol: PROJECT_IPC_PROTOCOL,
      version: PROJECT_IPC_VERSION,
      ok: false,
      error: normalized,
    };
  }
}

export function normalizedPathKey(value, platform = process.platform) {
  let normalized = path.resolve(value).normalize("NFC");
  if (platform === "darwin" || platform === "win32") {
    normalized = normalized.toLocaleLowerCase("en-US");
  }
  return normalized;
}

async function existingIdentity(filePath, statFile) {
  try {
    const information = await statFile(filePath);
    return {
      dev: String(information.dev),
      ino: String(information.ino),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function pathsReferToSameFile(
  firstPath,
  secondPath,
  {
    platform = process.platform,
    statFile = stat,
  } = {},
) {
  if (!firstPath || !secondPath) return false;
  if (
    normalizedPathKey(firstPath, platform)
    === normalizedPathKey(secondPath, platform)
  ) {
    return true;
  }

  const [firstIdentity, secondIdentity] = await Promise.all([
    existingIdentity(firstPath, statFile),
    existingIdentity(secondPath, statFile),
  ]);
  return Boolean(
    firstIdentity
    && secondIdentity
    && firstIdentity.ino !== "0"
    && firstIdentity.dev === secondIdentity.dev
    && firstIdentity.ino === secondIdentity.ino,
  );
}

export async function isProtectedExportDestination(
  destinationPath,
  protectedPaths,
  options = {},
) {
  for (const protectedPath of new Set(protectedPaths.filter(Boolean))) {
    if (await pathsReferToSameFile(destinationPath, protectedPath, options)) {
      return true;
    }
  }
  return false;
}

function exportNameParts(suggestedName) {
  const name = path.basename(suggestedName || "HTML.html");
  const parsed = path.parse(name);
  const hasHtmlExtension = [".html", ".htm"].includes(parsed.ext.toLowerCase());
  const extension = hasHtmlExtension ? parsed.ext : ".html";
  // A product/version name such as "页面-V1.3" does not have a file
  // extension. Keep the dotted version intact and append the canonical HTML
  // extension at the single export boundary.
  const stem = (hasHtmlExtension ? parsed.name : name) || "HTML";
  return { stem, extension };
}

export function normalizeHtmlExportPath(value) {
  const resolved = path.resolve(value);
  return [".html", ".htm"].includes(path.extname(resolved).toLowerCase())
    ? resolved
    : `${resolved}.html`;
}

export async function createSafeExportDefaultPath({
  directoryPath,
  suggestedName,
  sourcePath,
  activePath,
  platform = process.platform,
  lstatFile = lstat,
  statFile = stat,
}) {
  const { stem, extension } = exportNameParts(suggestedName);
  const protectedPaths = [sourcePath, activePath].filter(Boolean);
  for (let index = 1; index <= 1_000; index += 1) {
    const suffix = index === 1 ? "-副本" : `-副本-${index}`;
    const candidate = path.join(directoryPath, `${stem}${suffix}${extension}`);
    const protectedDestination = await isProtectedExportDestination(
      candidate,
      protectedPaths,
      {
        platform,
        statFile,
      },
    );
    if (protectedDestination) continue;
    try {
      await lstatFile(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new ProjectFileError(
    "NO_SAFE_EXPORT_NAME",
    "无法为 HTML 副本生成安全文件名，请选择其他文件夹。",
  );
}

export async function selectExportDestination({
  defaultPath,
  protectedPaths,
  showSaveDialog,
  normalizeDestination = (value) => path.resolve(value),
  platform = process.platform,
  statFile = stat,
  lstatFile = lstat,
}) {
  const result = await showSaveDialog(defaultPath);
  if (!result || result.canceled || !result.filePath) return null;

  const destinationPath = normalizeDestination(result.filePath);
  if (!await isProtectedExportDestination(destinationPath, protectedPaths, {
    platform,
    statFile,
  })) {
    return destinationPath;
  }

  return createSafeExportDefaultPath({
    directoryPath: path.dirname(destinationPath),
    suggestedName: path.basename(destinationPath),
    sourcePath: protectedPaths[0],
    activePath: protectedPaths[1],
    platform,
    lstatFile,
    statFile,
  });
}
