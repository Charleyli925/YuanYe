import {
  link,
  lstat,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { ProjectFileError } from "./project-files.mjs";
import { rebaseActiveManagedLocator } from "./active-managed-locator.mjs";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_PATH_LENGTH = 4096;
const MAX_FILE_COMPONENT_BYTES = 255;
const WINDOWS_RESERVED_STEM =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function normalizedPathKey(value, platform = process.platform) {
  let normalized = path.resolve(value).normalize("NFC");
  if (platform === "darwin" || platform === "win32") {
    normalized = normalized.toLocaleLowerCase("en-US");
  }
  return normalized;
}

function assertSourcePath(value, label = "sourcePath") {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
  ) {
    throw new TypeError(`${label} 无效。`);
  }
  const resolved = path.resolve(value);
  if (!HTML_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new TypeError(`${label} 必须以 .html 或 .htm 结尾。`);
  }
  return resolved;
}

function normalizedStem(value, extension) {
  if (typeof value !== "string") {
    throw new TypeError("文件名无效。");
  }
  let stem = value.normalize("NFC").trim();
  if (stem.toLowerCase().endsWith(extension.toLowerCase())) {
    stem = stem.slice(0, -extension.length).trim();
  }
  if (
    !stem
    || stem === "."
    || stem === ".."
    || stem.startsWith(".")
    || stem.endsWith(".")
    || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(stem)
    || WINDOWS_RESERVED_STEM.test(stem)
  ) {
    throw new ProjectFileError(
      "INVALID_RENAME_STEM",
      "请输入不含路径、后缀和特殊符号的文件名。",
    );
  }
  if (Buffer.byteLength(`${stem}${extension}`, "utf8") > MAX_FILE_COMPONENT_BYTES) {
    throw new ProjectFileError(
      "RENAME_STEM_TOO_LONG",
      "文件名太长，请缩短后再试。",
    );
  }
  return stem;
}

function assertOperationId(value) {
  if (
    typeof value !== "string"
    || !OPERATION_ID_PATTERN.test(value)
  ) {
    throw new TypeError("operationId 无效。");
  }
  return value;
}

function assertExpectedSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError("expectedSha256 无效。");
  }
  return normalized;
}

function sourceRenameRecord(value, { completed = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const previousPath = assertSourcePath(value.previousPath, "previousPath");
    const sourcePath = assertSourcePath(value.sourcePath, "sourcePath");
    const extension = path.extname(previousPath);
    const stem = normalizedStem(value.stem, extension);
    const record = {
      version: 1,
      operationId: assertOperationId(value.operationId),
      previousPath,
      sourcePath,
      stem,
      expectedSha256: assertExpectedSha256(value.expectedSha256),
      preparedAt: Number(value.preparedAt) || Date.now(),
    };
    if (completed) {
      record.completedAt = Number(value.completedAt) || record.preparedAt;
    }
    return record;
  } catch {
    return null;
  }
}

export function normalizePendingSourceRename(value) {
  return sourceRenameRecord(value);
}

export function normalizeCompletedSourceRename(value) {
  return sourceRenameRecord(value, { completed: true });
}

export function validateSourceRenamePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("重命名参数无效。");
  }
  const allowedKeys = new Set([
    "operationId",
    "sourcePath",
    "stem",
    "expectedSha256",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("重命名参数包含未支持的字段。");
  }
  const sourcePath = assertSourcePath(payload.sourcePath);
  const extension = path.extname(sourcePath);
  const stem = normalizedStem(payload.stem, extension);
  return {
    operationId: assertOperationId(payload.operationId),
    sourcePath,
    stem,
    extension,
    expectedSha256: assertExpectedSha256(payload.expectedSha256),
    targetPath: path.join(path.dirname(sourcePath), `${stem}${extension}`),
  };
}

function sameFileIdentity(left, right) {
  return Boolean(
    left
    && right
    && String(left.ino) !== "0"
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino),
  );
}

function isCaseOnlySameFile({
  previousPath,
  sourcePath,
  previousInformation,
  nextInformation,
  platform,
}) {
  return Boolean(
    nextInformation
    && (platform === "darwin" || platform === "win32")
    && normalizedPathKey(previousPath, platform)
      === normalizedPathKey(sourcePath, platform)
    && sameFileIdentity(previousInformation, nextInformation)
  );
}

async function moveRegularFileNoReplace({
  previousPath,
  sourcePath,
  expectedInformation,
  expectedSha256,
  readProject,
  lstatFile,
  linkFile,
  unlinkFile,
  destinationAlreadyLinked = false,
}) {
  if (!destinationAlreadyLinked) {
    try {
      await linkFile(previousPath, sourcePath);
    } catch (cause) {
      if (cause?.code === "EEXIST") {
        throw new ProjectFileError(
          "RENAME_DESTINATION_EXISTS",
          "同一文件夹里已经有这个文件名。",
          { targetPath: sourcePath },
        );
      }
      throw cause;
    }
  }

  try {
    const linkedInformation = await lstatFile(sourcePath);
    if (!sameFileIdentity(expectedInformation, linkedInformation)) {
      throw new ProjectFileError(
        "RENAME_SOURCE_CHANGED",
        "文件内容在重命名前发生了变化，源页没有修改文件名。",
        { sourcePath: previousPath },
      );
    }
    await verifiedProject(sourcePath, expectedSha256, readProject);
  } catch (cause) {
    try {
      await unlinkFile(sourcePath);
    } catch (rollbackCause) {
      cause.destinationCreated = true;
      cause.details = {
        ...(cause.details || {}),
        rollbackCause:
          rollbackCause instanceof Error
            ? rollbackCause.message
            : String(rollbackCause),
      };
    }
    throw cause;
  }

  try {
    await unlinkFile(previousPath);
  } catch (cause) {
    const error = new ProjectFileError(
      "RENAME_MOVE_INCOMPLETE",
      "文件名已开始更改，但旧路径尚未清理；源页会在下次打开时自动恢复。",
      {
        previousPath,
        sourcePath,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
    error.destinationCreated = true;
    throw error;
  }

  try {
    await verifiedProject(sourcePath, expectedSha256, readProject);
  } catch (cause) {
    try {
      await linkFile(sourcePath, previousPath);
      await unlinkFile(sourcePath);
    } catch (rollbackCause) {
      cause.destinationCreated = true;
      cause.details = {
        ...(cause.details || {}),
        rollbackCause:
          rollbackCause instanceof Error
            ? rollbackCause.message
            : String(rollbackCause),
      };
    }
    throw cause;
  }
}

async function optionalLstat(filePath, lstatFile) {
  try {
    return await lstatFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularSource(information, sourcePath) {
  if (!information?.isFile() || information.isSymbolicLink()) {
    throw new ProjectFileError(
      "UNSAFE_RENAME_SOURCE",
      "只能重命名普通 HTML 文件。",
      { sourcePath },
    );
  }
}

function sameRenameIntent(record, request) {
  return Boolean(
    record
    && record.operationId === request.operationId
    && normalizedPathKey(record.previousPath) === normalizedPathKey(request.sourcePath)
    && normalizedPathKey(record.sourcePath) === normalizedPathKey(request.targetPath)
    && record.stem === request.stem
    && record.expectedSha256 === request.expectedSha256
  );
}

function bumpActiveEffectGeneration(state) {
  const current = Number(state.activeEffectGeneration);
  const normalized = Number.isSafeInteger(current) && current >= 0 ? current : 0;
  if (normalized >= Number.MAX_SAFE_INTEGER) {
    throw new ProjectFileError(
      "ACTIVE_EFFECT_GENERATION_EXHAUSTED",
      "活动文件切换序列已达到上限，不能安全继续重命名。",
    );
  }
  state.activeEffectGeneration = normalized + 1;
}

function renameResult(project, record, {
  renamed = true,
  replayed = false,
  workspaceRelinked = false,
} = {}) {
  const sourcePath = path.resolve(project.sourcePath || record.sourcePath);
  return {
    ...project,
    operationId: record.operationId,
    previousSourcePath: record.previousPath,
    sourcePath,
    path: sourcePath,
    fileName: path.basename(sourcePath),
    stem: path.basename(sourcePath, path.extname(sourcePath)),
    extension: path.extname(sourcePath),
    renamed,
    replayed,
    workspaceRelinked,
  };
}

function applySourcePathTransition(state, record, now) {
  const previousKey = normalizedPathKey(record.previousPath);
  const nextKey = normalizedPathKey(record.sourcePath);
  const activeWasRenamed = Boolean(
    state.activePath
    && normalizedPathKey(state.activePath) === previousKey
  );
  const nextEntry = {
    path: record.sourcePath,
    name: path.basename(record.sourcePath),
    lastOpenedAt: now,
  };
  let replacementIndex = -1;
  let replacementLastOpenedAt = now;
  const retained = [];
  for (const entry of Array.isArray(state.recent) ? state.recent : []) {
    const key = normalizedPathKey(entry.path);
    if (key === previousKey || key === nextKey) {
      if (replacementIndex < 0) {
        replacementIndex = retained.length;
        replacementLastOpenedAt = Number(entry.lastOpenedAt) || now;
      }
      continue;
    }
    retained.push(entry);
  }
  nextEntry.lastOpenedAt = activeWasRenamed ? now : replacementLastOpenedAt;
  if (activeWasRenamed) {
    // A rename changes the active locator without producing a new activation
    // effect. Advance the same durable generation used by Desktop activation
    // and clear the old effect atomically with the path/recent update, so an
    // old pending receipt cannot resume after A→C→A ABA navigation.
    bumpActiveEffectGeneration(state);
    state.activeEffect = null;
    state.activePath = record.sourcePath;
    state.recent = [nextEntry, ...retained];
  } else if (replacementIndex >= 0) {
    retained.splice(Math.min(replacementIndex, retained.length), 0, nextEntry);
    state.recent = retained;
  }
  state.activeManagedLocator = rebaseActiveManagedLocator(state.activeManagedLocator, {
    previousSourcePath: record.previousPath,
    nextSourcePath: record.sourcePath,
  });
}

async function verifiedProject(sourcePath, expectedSha256, readProject) {
  const project = await readProject(sourcePath);
  if (project.sha256 !== expectedSha256) {
    throw new ProjectFileError(
      "RENAME_SOURCE_CHANGED",
      "文件内容在重命名前发生了变化，源页没有修改文件名。",
      {
        sourcePath,
        expectedSha256,
        actualSha256: project.sha256,
      },
    );
  }
  return project;
}

async function finalizeRenameState({
  state,
  pending,
  readProject,
  persistState,
  now,
  realpathFile,
}) {
  const canonicalSourcePath = await realpathFile(pending.sourcePath);
  const project = await verifiedProject(
    canonicalSourcePath,
    pending.expectedSha256,
    readProject,
  );
  const completed = {
    ...pending,
    sourcePath: canonicalSourcePath,
    completedAt: now(),
  };
  applySourcePathTransition(state, completed, completed.completedAt);
  state.pendingRename = null;
  state.lastRename = completed;
  await persistState();
  return { project, completed };
}

export async function recoverPendingSourceRename({
  state,
  readProject,
  persistState,
  platform = process.platform,
  lstatFile = lstat,
  realpathFile = realpath,
  renameFile = rename,
  linkFile = link,
  unlinkFile = unlink,
  now = Date.now,
}) {
  const pending = normalizePendingSourceRename(state?.pendingRename);
  if (!pending) {
    if (state?.pendingRename) {
      state.pendingRename = null;
      await persistState();
      return { changed: true, recovered: false };
    }
    return { changed: false, recovered: false };
  }
  state.pendingRename = pending;
  const [previousInformation, nextInformation] = await Promise.all([
    optionalLstat(pending.previousPath, lstatFile),
    optionalLstat(pending.sourcePath, lstatFile),
  ]);

  if (!previousInformation && !nextInformation) {
    state.pendingRename = null;
    await persistState();
    return { changed: true, recovered: false };
  }

  if (previousInformation && nextInformation) {
    if (!sameFileIdentity(previousInformation, nextInformation)) {
      state.pendingRename = null;
      await persistState();
      return { changed: true, recovered: false };
    }
  }

  if (previousInformation) {
    assertRegularSource(previousInformation, pending.previousPath);
    try {
      await verifiedProject(
        pending.previousPath,
        pending.expectedSha256,
        readProject,
      );
    } catch {
      state.pendingRename = null;
      await persistState();
      return { changed: true, recovered: false };
    }
    if (isCaseOnlySameFile({
      previousPath: pending.previousPath,
      sourcePath: pending.sourcePath,
      previousInformation,
      nextInformation,
      platform,
    })) {
      await renameFile(pending.previousPath, pending.sourcePath);
    } else if (nextInformation) {
      await moveRegularFileNoReplace({
        previousPath: pending.previousPath,
        sourcePath: pending.sourcePath,
        expectedInformation: previousInformation,
        expectedSha256: pending.expectedSha256,
        readProject,
        lstatFile,
        linkFile,
        unlinkFile,
        destinationAlreadyLinked: true,
      });
    } else {
      await moveRegularFileNoReplace({
        previousPath: pending.previousPath,
        sourcePath: pending.sourcePath,
        expectedInformation: previousInformation,
        expectedSha256: pending.expectedSha256,
        readProject,
        lstatFile,
        linkFile,
        unlinkFile,
      });
    }
  }

  try {
    const finalized = await finalizeRenameState({
      state,
      pending,
      readProject,
      persistState,
      now,
      realpathFile,
    });
    return {
      changed: true,
      recovered: true,
      project: finalized.project,
      record: finalized.completed,
    };
  } catch {
    // Keep the prepared record. A later invocation can reconcile the same
    // stable operation without guessing whether the filesystem rename landed.
    return { changed: false, recovered: false };
  }
}

export async function renameHtmlSource({
  payload,
  state,
  persistState,
  resolveKnownSource,
  readProject,
  rebindWorkspace = async () => false,
  platform = process.platform,
  lstatFile = lstat,
  realpathFile = realpath,
  renameFile = rename,
  linkFile = link,
  unlinkFile = unlink,
  now = Date.now,
}) {
  if (!state || typeof state !== "object") {
    throw new TypeError("项目状态无效。");
  }
  const request = validateSourceRenamePayload(payload);

  if (state.pendingRename) {
    await recoverPendingSourceRename({
      state,
      readProject,
      persistState,
      platform,
      lstatFile,
      realpathFile,
      renameFile,
      linkFile,
      unlinkFile,
      now,
    });
  }

  const completed = normalizeCompletedSourceRename(state.lastRename);
  if (completed?.operationId === request.operationId) {
    if (!sameRenameIntent(completed, request)) {
      throw new ProjectFileError(
        "RENAME_OPERATION_ID_CONFLICT",
        "这次重命名操作与已经完成的记录不一致，请重新输入文件名。",
      );
    }
    const project = await verifiedProject(
      completed.sourcePath,
      completed.expectedSha256,
      readProject,
    );
    return renameResult(project, completed, {
      replayed: true,
      workspaceRelinked: true,
    });
  }

  const canonicalSourcePath = await resolveKnownSource(request.sourcePath);
  const canonicalRequest = {
    ...request,
    sourcePath: canonicalSourcePath,
    targetPath: path.join(
      path.dirname(canonicalSourcePath),
      `${request.stem}${path.extname(canonicalSourcePath)}`,
    ),
  };
  const project = await verifiedProject(
    canonicalRequest.sourcePath,
    canonicalRequest.expectedSha256,
    readProject,
  );
  if (canonicalRequest.sourcePath === canonicalRequest.targetPath) {
    return renameResult(project, {
      version: 1,
      operationId: canonicalRequest.operationId,
      previousPath: canonicalRequest.sourcePath,
      sourcePath: canonicalRequest.sourcePath,
      stem: canonicalRequest.stem,
      expectedSha256: canonicalRequest.expectedSha256,
      preparedAt: now(),
      completedAt: now(),
    }, {
      renamed: false,
      workspaceRelinked: true,
    });
  }

  const [sourceInformation, destinationInformation] = await Promise.all([
    lstatFile(canonicalRequest.sourcePath),
    optionalLstat(canonicalRequest.targetPath, lstatFile),
  ]);
  assertRegularSource(sourceInformation, canonicalRequest.sourcePath);
  const caseOnlySameFile = isCaseOnlySameFile({
    previousPath: canonicalRequest.sourcePath,
    sourcePath: canonicalRequest.targetPath,
    previousInformation: sourceInformation,
    nextInformation: destinationInformation,
    platform,
  });
  if (destinationInformation && !caseOnlySameFile) {
    throw new ProjectFileError(
      "RENAME_DESTINATION_EXISTS",
      "同一文件夹里已经有这个文件名。",
      { targetPath: canonicalRequest.targetPath },
    );
  }

  const pending = {
    version: 1,
    operationId: canonicalRequest.operationId,
    previousPath: canonicalRequest.sourcePath,
    sourcePath: canonicalRequest.targetPath,
    stem: canonicalRequest.stem,
    expectedSha256: canonicalRequest.expectedSha256,
    preparedAt: now(),
  };
  state.pendingRename = pending;
  await persistState();

  try {
    if (caseOnlySameFile) {
      await renameFile(pending.previousPath, pending.sourcePath);
    } else {
      await moveRegularFileNoReplace({
        previousPath: pending.previousPath,
        sourcePath: pending.sourcePath,
        expectedInformation: sourceInformation,
        expectedSha256: pending.expectedSha256,
        readProject,
        lstatFile,
        linkFile,
        unlinkFile,
      });
    }
  } catch (error) {
    if (!error?.destinationCreated) {
      state.pendingRename = null;
      await persistState();
    }
    throw error;
  }

  const finalized = await finalizeRenameState({
    state,
    pending,
    readProject,
    persistState,
    now,
    realpathFile,
  });
  const workspaceRelinked = await rebindWorkspace(
    finalized.completed.sourcePath,
    finalized.completed.expectedSha256,
  ).catch(() => false);
  return renameResult(finalized.project, finalized.completed, {
    workspaceRelinked,
  });
}
