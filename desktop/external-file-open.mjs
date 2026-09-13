import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectFileError } from "./project-files.mjs";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const EXTERNAL_OPEN_FAILURE = Object.freeze({
  code: "EXTERNAL_OPEN_FAILED",
  message: "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
});
const EXIT_HANDOFF_VERSION = 2;
const EXIT_HANDOFF_MAX_BYTES = 8 * 1024;
const EXIT_HANDOFF_FILESYSTEM = Object.freeze({
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
});

function pathImplementation(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function normalizeExternalHtmlPath(
  value,
  { platform = process.platform } = {},
) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new TypeError("外部 HTML 路径无效。");
  }

  let candidate = value.trim();
  if (/^file:/iu.test(candidate)) {
    candidate = fileURLToPath(new URL(candidate), {
      windows: platform === "win32",
    });
  }

  const pathApi = pathImplementation(platform);
  if (!pathApi.isAbsolute(candidate)) {
    throw new TypeError("外部 HTML 路径必须是绝对路径。");
  }
  const normalized = pathApi.normalize(candidate);
  if (!HTML_EXTENSIONS.has(pathApi.extname(normalized).toLowerCase())) {
    throw new TypeError("只能从外部打开 .html 或 .htm 文件。");
  }
  return normalized;
}

export function externalHtmlPathsFromArgv(
  argv,
  { platform = process.platform } = {},
) {
  if (!Array.isArray(argv)) return [];
  const results = [];
  const identities = new Set();
  for (const argument of argv) {
    if (typeof argument !== "string" || argument.startsWith("-")) continue;
    try {
      const sourcePath = normalizeExternalHtmlPath(argument, { platform });
      const identity = platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
      if (identities.has(identity)) continue;
      identities.add(identity);
      results.push(sourcePath);
    } catch {
      // Chromium flags, the executable path and unrelated arguments are ignored.
    }
  }
  return results;
}

/**
 * Native startup happens before a renderer can safely present an IPC error.
 * Keep the native dialog product-facing: filesystem exceptions commonly
 * include a full local path, syscall and platform-specific implementation
 * detail. Product file errors already carry a stable code and message.
 */
export function externalOpenFailurePresentation(error) {
  if (error instanceof ProjectFileError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
    });
  }
  return EXTERNAL_OPEN_FAILURE;
}

export function createExternalOpenFailureMailbox() {
  let pendingIssue = null;
  return Object.freeze({
    publish(issue) {
      pendingIssue = Object.freeze({
        title: typeof issue?.title === "string" && issue.title.trim()
          ? issue.title.trim()
          : "无法打开这个 HTML",
        message: typeof issue?.message === "string" && issue.message.trim()
          ? issue.message.trim()
          : EXTERNAL_OPEN_FAILURE.message,
      });
      return pendingIssue;
    },
    take() {
      const issue = pendingIssue;
      pendingIssue = null;
      return issue;
    },
    peek() {
      return pendingIssue;
    },
  });
}

/**
 * Carries one native external-open intent across a shutdown that has already
 * been committed. The main process must not accept a new request into an
 * exiting renderer: it atomically records the validated path, and the next
 * process consumes the record before it asks the renderer to accept it.
 */
export function createExternalFileOpenExitHandoff({
  handoffPath,
  platform = process.platform,
  filesystem = EXIT_HANDOFF_FILESYSTEM,
  createTemporaryPath = () => `${handoffPath}.${process.pid}.${randomUUID()}.tmp`,
  maxBytes = EXIT_HANDOFF_MAX_BYTES,
} = {}) {
  if (typeof handoffPath !== "string" || !handoffPath.trim()) {
    throw new TypeError("外部打开交接路径无效。");
  }
  if (
    !filesystem
    || ["mkdirSync", "readFileSync", "renameSync", "unlinkSync", "writeFileSync"]
      .some((name) => typeof filesystem[name] !== "function")
  ) {
    throw new TypeError("外部打开交接存储无效。");
  }
  if (typeof createTemporaryPath !== "function") {
    throw new TypeError("外部打开交接临时路径生成器无效。");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128) {
    throw new TypeError("外部打开交接大小上限无效。");
  }

  const resolvedHandoffPath = path.resolve(handoffPath);
  const discard = () => {
    try {
      filesystem.unlinkSync(resolvedHandoffPath);
    } catch {
      // A missing or unremovable handoff remains fail-closed: it is not opened.
    }
  };
  const decode = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (
      value.version === 1
      && Object.keys(value).length === 2
      && "sourcePath" in value
    ) {
      try {
        return [normalizeExternalHtmlPath(value.sourcePath, { platform })];
      } catch {
        return null;
      }
    }
    if (
      Object.keys(value).length !== 2
      || value.version !== EXIT_HANDOFF_VERSION
      || !Array.isArray(value.sourcePaths)
      || value.sourcePaths.length === 0
      || value.sourcePaths.length > 32
    ) return null;
    try {
      return value.sourcePaths.map((sourcePath) => (
        normalizeExternalHtmlPath(sourcePath, { platform })
      ));
    } catch {
      return null;
    }
  };
  const writePaths = (sourcePaths) => {
    const contents = `${JSON.stringify({
      version: EXIT_HANDOFF_VERSION,
      sourcePaths,
    })}\n`;
    if (Buffer.byteLength(contents, "utf8") > maxBytes) {
      throw new RangeError("外部打开交接内容超过上限。");
    }
    const temporaryPath = createTemporaryPath();
    if (typeof temporaryPath !== "string" || !temporaryPath.trim()) {
      throw new TypeError("外部打开交接临时路径无效。");
    }
    try {
      filesystem.mkdirSync(path.dirname(resolvedHandoffPath), {
        recursive: true,
        mode: 0o700,
      });
      filesystem.writeFileSync(temporaryPath, contents, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      filesystem.renameSync(temporaryPath, resolvedHandoffPath);
    } finally {
      try {
        filesystem.unlinkSync(temporaryPath);
      } catch {
        // `renameSync` consumes the temporary record on success.
      }
    }
  };

  return Object.freeze({
    defer(value) {
      const sourcePath = normalizeExternalHtmlPath(value, { platform });
      let existing = [];
      try {
        const raw = filesystem.readFileSync(resolvedHandoffPath, "utf8");
        existing = Buffer.byteLength(String(raw), "utf8") <= maxBytes
          ? decode(JSON.parse(String(raw)))
          : null;
      } catch (error) {
        if (error?.code !== "ENOENT") existing = null;
      }
      if (!existing) existing = [];
      if (existing.length >= 32) {
        throw new RangeError("外部打开交接队列已满。");
      }
      writePaths([...existing, sourcePath]);
      return sourcePath;
    },
    take() {
      let raw;
      try {
        raw = filesystem.readFileSync(resolvedHandoffPath, "utf8");
      } catch {
        return null;
      }
      const contents = String(raw);
      if (Buffer.byteLength(contents, "utf8") > maxBytes) {
        discard();
        return null;
      }
      let sourcePaths = null;
      try {
        sourcePaths = decode(JSON.parse(contents));
      } catch {
        // Malformed crash handoffs never gain filesystem authority.
      }
      if (!sourcePaths?.length) {
        discard();
        return null;
      }
      if (sourcePaths.length > 1) {
        try {
          writePaths(sourcePaths.slice(1));
        } catch {
          return null;
        }
      } else {
        try {
          filesystem.unlinkSync(resolvedHandoffPath);
        } catch {
          return null;
        }
      }
      return sourcePaths[0];
    },
  });
}

export function createExternalFileOpenMailbox({
  createRequestId = randomUUID,
  platform = process.platform,
} = {}) {
  const pending = [];
  const acknowledged = new Map();
  let activationTail = Promise.resolve();
  let inFlight = null;

  const rememberAcknowledged = (request) => {
    acknowledged.set(request.requestId, request);
    while (acknowledged.size > 32) {
      acknowledged.delete(acknowledged.keys().next().value);
    }
  };

  const consume = (requestId) => {
    if (
      pending.length === 0
      || typeof requestId !== "string"
      || requestId !== pending[0].requestId
    ) return null;
    return pending.shift();
  };

  return Object.freeze({
    publish(value) {
      const request = Object.freeze({
        requestId: createRequestId(),
        sourcePath: normalizeExternalHtmlPath(value, { platform }),
      });
      // The renderer still mounts one authoritative document at a time, but
      // native open intents are FIFO input. A burst from Finder/Open With must
      // not silently erase an earlier validated request.
      pending.push(request);
      return request;
    },
    peek() {
      return pending[0] || null;
    },
    size() {
      return pending.length;
    },
    begin(requestId, activate) {
      const request = pending[0] || null;
      if (!request || request.requestId !== requestId || typeof activate !== "function") {
        return null;
      }
      if (inFlight?.requestId === requestId) return inFlight.promise;
      if (inFlight) return null;
      const promise = activationTail.then(() => activate(request));
      activationTail = promise.catch(() => undefined);
      inFlight = Object.freeze({ requestId, promise });
      return promise;
    },
    acknowledge(requestId) {
      const replay = typeof requestId === "string"
        ? acknowledged.get(requestId)
        : null;
      if (replay) return replay;
      if (inFlight && inFlight.requestId !== requestId) return null;
      const request = consume(requestId);
      if (!request) return null;
      inFlight = null;
      rememberAcknowledged(request);
      return request;
    },
    consume,
    accept(requestId, activate) {
      const request = consume(requestId);
      if (!request) return null;
      if (typeof activate !== "function") {
        throw new TypeError("外部 HTML 打开处理器无效。");
      }
      // `activate` owns the read + active-project mutation. Keep that entire
      // operation in one FIFO so a slow earlier request cannot overwrite the
      // newer active/recent source after the renderer has moved on.
      const operation = activationTail.then(() => activate(request));
      activationTail = operation.catch(() => undefined);
      return operation;
    },
  });
}

/**
 * Main-process authority for the ordering boundary between a renderer close
 * generation and external-mailbox delivery. It owns no paths: the mailbox
 * remains the sole FIFO, while this coordinator prevents that FIFO head from
 * crossing into a renderer before the exact close abort has been observed.
 */
export function createExternalFileOpenDeliveryCoordinator() {
  let generation = 0;
  let currentClose = null;
  let barrier = null;
  let deliveredHeadRequestId = null;
  const attempts = new Map();

  const keyOf = (authority) => (
    authority
    && typeof authority.requestId === "string"
    && authority.requestId
    && Number.isSafeInteger(authority.generation)
    && authority.generation > 0
  ) ? `${authority.generation}:${authority.requestId}` : null;
  const matching = (left, right) => {
    const leftKey = keyOf(left);
    return Boolean(leftKey && leftKey === keyOf(right));
  };
  const publicAuthority = (record) => record ? Object.freeze({
    requestId: record.requestId,
    generation: record.generation,
  }) : null;
  const remember = (record) => {
    attempts.set(keyOf(record), record);
    while (attempts.size > 32) attempts.delete(attempts.keys().next().value);
  };

  return Object.freeze({
    beginClose(requestId) {
      const id = String(requestId || "");
      if (!id || currentClose) return null;
      generation += 1;
      currentClose = {
        requestId: id,
        generation,
        phase: "preparing",
        abortNotified: false,
      };
      remember(currentClose);
      return publicAuthority(currentClose);
    },
    isCurrent(authority) {
      return matching(currentClose, authority)
        && currentClose.phase === "preparing";
    },
    commitClose(authority) {
      if (!matching(currentClose, authority) || currentClose.phase !== "preparing") {
        return false;
      }
      currentClose.phase = "committed";
      return true;
    },
    invalidateClose() {
      if (barrier) return publicAuthority(barrier);
      if (!currentClose || currentClose.phase !== "preparing") return null;
      currentClose.phase = "invalidated";
      barrier = currentClose;
      return publicAuthority(barrier);
    },
    markCloseAborted(authority) {
      const record = attempts.get(keyOf(authority));
      if (!record || record.abortNotified) return false;
      record.abortNotified = true;
      return true;
    },
    releaseBarrier(authority) {
      if (!matching(barrier, authority)) return false;
      barrier = null;
      return true;
    },
    abortClose(authority) {
      const record = attempts.get(keyOf(authority));
      if (!record) return false;
      record.phase = "aborted";
      if (matching(currentClose, authority)) currentClose = null;
      return true;
    },
    canDeliver() {
      return barrier === null;
    },
    beginRendererLoad() {
      deliveredHeadRequestId = null;
    },
    shouldDeliver(requestId) {
      const id = String(requestId || "");
      return Boolean(id && barrier === null && deliveredHeadRequestId !== id);
    },
    markDelivered(requestId) {
      const id = String(requestId || "");
      if (!id || barrier) return false;
      deliveredHeadRequestId = id;
      return true;
    },
    acknowledge(requestId) {
      const id = String(requestId || "");
      if (!id || deliveredHeadRequestId !== id) return false;
      deliveredHeadRequestId = null;
      return true;
    },
  });
}
