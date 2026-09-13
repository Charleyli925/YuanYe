#!/usr/bin/env node

import { submissionRequestMatches } from "./project-file-repository/submission.mjs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { performance as nodePerformance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  atomicWriteFile,
  ensureDirectory,
  LIFECYCLE_SCHEMA_VERSION,
  LifecycleError,
  projectDisplayName,
  requireCompleteHtml,
  sha256,
  sha256Hex,
} from "./lifecycle-core.mjs";
import {
  PRODUCT_MAX_BRIDGE_BODY_BYTES,
  PRODUCT_MAX_HTML_BYTES,
} from "./product-contract.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "./project-file-repository.mjs";
import {
  conversationListResponse,
  conversationResponse,
  ensureCurrentConversation,
  readConversation,
  readConversationDraft,
  readConversationIndex,
  writeConversationDraft,
} from "./conversation-repository.mjs";
import { AgentBridgeService } from "./agent-bridge-service.mjs";
import {
  closeWorkspaceBridgeAfterAgentCleanup,
} from "./workspace-bridge-shutdown.mjs";
import {
  defaultManagedAgentDelivery,
  legacyDriverForAgentDelivery,
  normalizeAgentDelivery,
} from "../shared/agent-delivery.mjs";
import {
  compileTaskSpec,
} from "../shared/task-spec.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const SERVICE_NAME = "html-ai-workspace-bridge";
const RUNTIME_CHANNEL = String(process.env.HTML_AI_RUNTIME_CHANNEL || "test").trim().toLowerCase();
if (!["stable", "preview", "source", "e2e", "test"].includes(RUNTIME_CHANNEL)) {
  const error = new Error(`Unsupported runtime channel: ${RUNTIME_CHANNEL || "(missing)"}.`);
  error.code = "RUNTIME_CHANNEL_INVALID";
  throw error;
}

function requiredRuntimeRoot(name) {
  const configured = String(process.env[name] || "").trim();
  if (!configured || !path.isAbsolute(configured)) {
    const error = new Error(`${name} must be an absolute path for runtime channel ${RUNTIME_CHANNEL || "(missing)"}.`);
    error.code = "RUNTIME_PATH_REQUIRED";
    throw error;
  }
  return path.resolve(configured);
}

const WORKSPACE_ROOT = requiredRuntimeRoot("HTML_AI_WORKSPACE");
const PROJECT_FILE_ROOT = requiredRuntimeRoot("HTML_AI_PROJECT_FILES_ROOT");

function e2eAgentInstallFetch(_url, { signal } = {}) {
  if (process.env.PAGEROOT_AGENT_INSTALL_STUB_FETCH === "pending") {
    return new Promise((_, reject) => {
      const abort = () => reject(signal?.reason || new Error("Agent install cancelled."));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }
  return Promise.resolve({
    ok: false,
    status: 503,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  });
}

const agentBridgeService = new AgentBridgeService({
  resolveTask: resolveAgentBridgeTask,
  recordExecutionFact: async (identity, event) => {
    const target = await projectFileTargetForBody(identity);
    if (!target) throw projectNotFoundError();
    await projectFileRepository.recordExecutionFact({ target, requestId: identity.requestId,
      attemptId: identity.attemptId, event });
  },
  ...(process.env.PAGEROOT_E2E === "1" && process.env.PAGEROOT_AGENT_INSTALL_STUB_FETCH
    ? {
      installerOptions: {
        fetchImpl: e2eAgentInstallFetch,
      },
    }
    : {}),
});
function normalizeDispatchableAgentDelivery(value) {
  const delivery = normalizeAgentDelivery(value, { allowLegacy: false });
  if (delivery.mode === "managed-agent") {
    agentBridgeService.assertSelection(delivery.selection, "execution");
  }
  return delivery;
}
const projectFileRepository = new ProjectFileRepository({
  projectsRoot: PROJECT_FILE_ROOT,
  deviceId: process.env.HTML_AI_DEVICE_ID || null,
  agentDeliveryNormalizer: normalizeDispatchableAgentDelivery,
  failpoint: process.env.HTML_AI_FAILPOINT
    ? async (name) => name === process.env.HTML_AI_FAILPOINT
    : null,
});
const FINALIZER_PATH = fileURLToPath(
  new URL("./finalize-attempt.mjs", import.meta.url),
);
const MAX_BODY_BYTES = PRODUCT_MAX_BRIDGE_BODY_BYTES;
const MAX_FILE_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const BRIDGE_AUTH_TOKEN = process.env.HTML_AI_BRIDGE_AUTH_TOKEN || null;
const execFileAsync = promisify(execFile);

const configuredPort = Number.parseInt(
  process.env.HTML_AI_BRIDGE_PORT ?? String(DEFAULT_PORT),
  10,
);
if (
  !Number.isSafeInteger(configuredPort)
  || configuredPort < 1
  || configuredPort > 65_535
) {
  process.stderr.write(
    `${JSON.stringify({
      type: "fatal",
      error: {
        code: "INVALID_PORT",
        message: "HTML_AI_BRIDGE_PORT must be an integer from 1 to 65535.",
      },
    })}\n`,
  );
  process.exit(1);
}
const PORT = configuredPort;

class HttpError extends LifecycleError {
  constructor(status, code, message, details) {
    super(code, message, details, status);
    this.name = "HttpError";
  }
}

const PROJECT_NOT_FOUND_MESSAGE =
  "No v4 project file is registered for this source.";

function projectNotFoundError() {
  return new HttpError(404, "PROJECT_NOT_FOUND", PROJECT_NOT_FOUND_MESSAGE);
}

function requireFound(value) {
  if (!value) throw projectNotFoundError();
  return value;
}

function cleanText(value, maxLength = 10_000) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\0", "").trim().slice(0, maxLength);
}

function attachmentRecordId(value, label) {
  const normalized = cleanText(value, 180);
  if (!new RegExp(`^${label}_[A-Za-z0-9_-]+$`).test(normalized)) {
    throw new HttpError(
      422,
      `INVALID_${label.toUpperCase()}_ID`,
      `${label} id is invalid.`,
    );
  }
  return normalized;
}

function safeAttachmentFileName(value) {
  const baseName = path.posix.basename(
    String(value ?? "").replaceAll("\\", "/"),
  );
  const cleaned = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("/", "-")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new HttpError(422, "INVALID_ATTACHMENT_NAME", "Attachment file name is invalid.");
  }
  if (cleaned.length <= 180) return cleaned;
  const extension = path.extname(cleaned).slice(0, 24);
  return `${cleaned.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function attachmentMediaType(value) {
  const normalized = cleanText(value, 200) || "application/octet-stream";
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(normalized)) {
    return "application/octet-stream";
  }
  return normalized.toLowerCase();
}

function attachmentKind(value, mediaType, fileName) {
  if (value === "image") return "image";
  if (mediaType.startsWith("image/")) return "image";
  if (/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(fileName)) {
    return "image";
  }
  return "file";
}

function decodeAttachmentBase64(value) {
  if (typeof value !== "string") {
    throw new HttpError(422, "INVALID_ATTACHMENT_DATA", "Attachment data is missing.");
  }
  const compact = value.replace(/\s+/g, "");
  if (
    compact.length === 0
    || compact.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new HttpError(422, "INVALID_ATTACHMENT_DATA", "Attachment data is not valid base64.");
  }
  const buffer = Buffer.from(compact, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(
      buffer.byteLength > MAX_ATTACHMENT_BYTES ? 413 : 422,
      buffer.byteLength > MAX_ATTACHMENT_BYTES
        ? "ATTACHMENT_TOO_LARGE"
        : "EMPTY_ATTACHMENT",
      `Each attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return buffer;
}

function resolveAttachmentPath(projectRoot, relativePath, { draftOnly = false } = {}) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  const allowed = draftOnly
    ? /^draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+$/
    : /^(?:draft\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+|requests\/req_[A-Za-z0-9_-]+\/input\/attachments\/comment_[A-Za-z0-9_-]+\/attachment_[A-Za-z0-9_-]+-[^/]+)$/;
  if (!allowed.test(normalized)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path is invalid.");
  }
  const absolutePath = path.resolve(projectRoot, ...normalized.split("/"));
  const projectPrefix = `${path.resolve(projectRoot)}${path.sep}`;
  if (!absolutePath.startsWith(projectPrefix)) {
    throw new HttpError(422, "INVALID_ATTACHMENT_PATH", "Attachment path escapes the project.");
  }
  return { relativePath: normalized, absolutePath };
}

function normalizeSourcePath(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new HttpError(
      400,
      "INVALID_SOURCE_PATH",
      "sourcePath must be an absolute HTML file path.",
    );
  }
  const normalized = path.normalize(value);
  if (
    !path.isAbsolute(normalized)
    || ![".html", ".htm"].includes(path.extname(normalized).toLowerCase())
  ) {
    throw new HttpError(
      400,
      "INVALID_SOURCE_PATH",
      "sourcePath must be an absolute .html or .htm path.",
    );
  }
  return normalized;
}

function requireSha256(value, label = "sha256") {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(
      400,
      "INVALID_SHA256",
      `${label} must use sha256:<64 lowercase hex>.`,
    );
  }
  return value;
}

async function inspectSourceFile(sourcePath, { requireComplete = true } = {}) {
  let information;
  try {
    information = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(
        404,
        "SOURCE_NOT_FOUND",
        "The source HTML file was not found.",
      );
    }
    throw error;
  }
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new HttpError(
      409,
      "UNSAFE_SOURCE_FILE",
      "The source HTML must be a regular file, not a symbolic link.",
    );
  }
  if (information.size > MAX_FILE_BYTES) {
    throw new HttpError(413, "SOURCE_TOO_LARGE", "The source HTML is too large.");
  }
  const buffer = await readFile(sourcePath);
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new HttpError(
      415,
      "UNSUPPORTED_HTML_ENCODING",
      "The source HTML is not valid UTF-8 and was left unchanged.",
    );
  }
  if (requireComplete) requireCompleteHtml(html, "source HTML");
  return {
    buffer,
    html,
    sha256: sha256(buffer),
    information,
    lastModifiedAt: information.mtime.toISOString(),
  };
}

async function readSourceFile(sourcePath) {
  return inspectSourceFile(sourcePath, { requireComplete: true });
}

function projectFileHttpError(cause) {
  if (!(cause instanceof ProjectFileRepositoryError)) return cause;
  const code = String(cause.code || "PROJECT_FILE_ERROR");
  const status = new Set([
    "SOURCE_NOT_FOUND",
    "PROJECT_ROOT_NOT_FOUND",
    "PROJECT_CONTROL_NOT_FOUND",
    "PROJECT_FILE_NOT_FOUND",
    "PROJECTS_ROOT_NOT_FOUND",
    "CANDIDATE_NOT_FOUND",
    "WORKING_COPY_NOT_FOUND",
    "VERSION_NOT_FOUND",
    "REGISTERED_PROJECT_UNAVAILABLE",
    "WORKING_COPY_UNAVAILABLE",
  ]).has(code)
    ? 404
    : new Set([
      "SOURCE_HASH_CONFLICT",
      "PROJECT_IDENTITY_CHANGED",
      "REGISTERED_PROJECT_PATH_MISMATCH",
      "REGISTERED_PROJECT_IDENTITY_CHANGED",
      "REGISTERED_PROJECT_AMBIGUOUS",
      "MANAGED_PATH_AMBIGUOUS",
      "MANAGED_SOURCE_IDENTITY_MISMATCH",
      "WORKING_COPY_CONFLICT",
      "AMBIGUOUS_SOURCE_FILE_IDENTITY",
      "ACTIVE_REQUEST_EXISTS",
      "STALE_CANDIDATE",
      "CANDIDATE_SOURCE_CHANGED",
      "CANDIDATE_NOT_PENDING_REVIEW",
      "CANDIDATE_AUTHORITY_MISMATCH",
      "CANDIDATE_HASH_MISMATCH",
      "DECISION_IDENTITY_MISMATCH",
      "REQUEST_OUTPUT_CHANGED",
      "FROZEN_INPUT_HASH_MISMATCH",
      "REQUEST_COLLISION",
      "FILE_COLLISION",
      "PROMOTION_PATH_REPLACED",
      "PROMOTION_PREPARED_PATH_CONFLICT",
      "PROMOTION_PREPARED_FILE_CHANGED",
      "PROMOTION_TRANSACTION_MISMATCH",
      "PROMOTION_TRANSACTION_INVALID",
      "PROMOTION_WORKING_COPY_MISSING",
      "PROMOTION_VERSION_MISSING",
      "IMPORT_REGISTRY_CONFLICT",
      "IMPORT_IDENTITY_MISMATCH",
      "IMPORT_RECOVERY_INVALID",
      "IMPORT_RECOVERY_AMBIGUOUS",
      "IMPORT_INTENT_NOT_FOUND",
      "EXTERNAL_SOURCE_BINDING_CONFLICT",
      "EXTERNAL_SOURCE_BINDING_INVALID",
      "SOURCE_IMPORT_PENDING",
      "REGISTRY_BUSY",
      "REGISTERED_PROJECT_RACE",
      "WORKING_COPY_VERSION_MISMATCH",
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT",
      "HISTORY_ACTIVATION_RECEIPT_MISMATCH",
      "REQUEST_RUNTIME_ANCHOR_MISMATCH",
      "CANCELLATION_AUTHORITY_MISMATCH",
      "AI_TASK_NOT_ACTIVE",
    ]).has(code)
      ? 409
      : code === "UNSUPPORTED_HTML_ENCODING"
      ? 415
      : new Set([
        "UNSAFE_FILE",
        "UNSAFE_DIRECTORY",
        "UNSUPPORTED_HTML_EXTENSION",
        "INCOMPLETE_HTML",
        "PATH_ESCAPES_PROJECT",
        "INVALID_RELATIVE_PATH",
        "INVALID_ID",
        "INVALID_OPERATION_ID",
        "INVALID_RECONCILE_REASON",
        "INVALID_FILE_STEM",
        "PATH_COMPONENT_TOO_LONG",
        "INVALID_CANDIDATE_ID",
        "CANDIDATE_UNUSABLE",
        "CANDIDATE_VALIDATION_INVALID",
        "INVALID_REQUEST_ID",
        "INVALID_HISTORY_ACTIVATION_OPERATION",
        "INVALID_ATTEMPT_ID",
        "INVALID_REGISTRY",
        "UNSUPPORTED_REGISTRY_SCHEMA",
        "UNREGISTERED_PROJECT_ROOT",
        "WORKING_COPY_STATE_INVALID",
        "REGISTERED_PROJECT_VERSIONS_INVALID",
      ]).has(code)
        ? 422
        : 500;
  return new HttpError(status, code, cause.message, cause.details);
}

function registeredProjectId(value) {
  const projectId = String(value || "");
  if (!/^project_[a-f0-9]{16,64}$/u.test(projectId)) {
    throw new HttpError(400, "INVALID_PROJECT_ID", "projectId is invalid.");
  }
  return projectId;
}

async function registeredProjectCatalog() {
  try {
    return {
      ok: true,
      projects: await projectFileRepository.listRegisteredProjects(),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function registeredProjectVersionSummaries(projectId) {
  try {
    const summary = await projectFileRepository.listRegisteredProjectVersionSummaries({
      projectId: registeredProjectId(projectId),
    });
    return {
      ok: true,
      projectId: summary.projectId,
      documentId: summary.documentId,
      currentBasedOnVersionId: summary.currentBasedOnVersionId,
      latestVersionId: summary.latestVersionId,
      versions: summary.versions,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function registeredProjectOpen(projectId, workingCopyId = null) {
  try {
    const resolved = await projectFileRepository.resolveRegisteredProjectOpenTarget({
      projectId: registeredProjectId(projectId),
      workingCopyId,
    });
    return {
      ok: true,
      projectId: resolved.target.projectId,
      documentId: resolved.target.documentId,
      sourcePath: resolved.target.exactSourcePath,
      sourceSha256: resolved.sourceSha256,
      content: resolved.html,
      lastModifiedAt: resolved.lastModifiedAt,
      openTarget: resolved.target,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function reconcileManagedWorkingCopy(body = {}) {
  try {
    const reconciled = await projectFileRepository.reconcileWorkingCopyLocator({
      operationId: body.operationId,
      previousSourcePath: body.previousSourcePath,
      projectId: body.projectId,
      documentId: body.documentId,
      workingCopyId: body.workingCopyId,
      versionId: body.versionId,
      expectedSourceSha256: body.expectedSourceSha256,
      reason: body.reason,
    });
    return {
      ok: true,
      operationId: reconciled.operationId,
      status: reconciled.status,
      previousSourcePath: reconciled.previousSourcePath,
      sourcePath: reconciled.sourcePath,
      sourceSha256: reconciled.sourceSha256,
      openTarget: reconciled.openTarget,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileWorkspaceForSource(sourcePath) {
  try {
    return await projectFileRepository.workspace({ sourcePath });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function projectFileTargetFromWorkspace(workspace) {
  if (!workspace?.target || workspace.target.targetKind !== "working-copy") {
    throw new HttpError(
      409,
      "WORKING_COPY_REQUIRED",
      "This operation requires an editable Working Copy, not an immutable Version snapshot.",
    );
  }
  return workspace.target;
}

function projectFileTargetFromBody(body = {}) {
  if (
    !body
    || typeof body !== "object"
    || !body.projectRootPath
    || !body.projectId
    || !body.documentId
    || !body.workingCopyId
  ) return null;
  return {
    projectId: String(body.projectId),
    documentId: String(body.documentId),
    projectRootPath: String(body.projectRootPath),
    targetKind: String(body.targetKind || "working-copy"),
    workingCopyId: String(body.workingCopyId),
    versionId: body.versionId ? String(body.versionId) : null,
    exactSourcePath: String(body.exactSourcePath || body.sourcePath || ""),
    sourceSha256: String(
      body.sourceSha256
      || body.expectedSourceSha256
      || "",
    ),
    sessionEpoch: Number(body.sessionEpoch || body.epoch || 0),
  };
}

function projectFileVersionRows(workspace, requirements = new Map()) {
  return workspace.manifest.versions.map((version) => {
    const workingCopy = Array.isArray(workspace.manifest.workingCopies)
      ? workspace.manifest.workingCopies.find((entry) => entry.versionId === version.versionId)
      : null;
    const workingCopyProjection = Array.isArray(workspace.workingCopies)
      ? workspace.workingCopies.find((entry) => entry.versionId === version.versionId)
      : null;
    const isActiveWorkingCopy = Boolean(
      workingCopy
      && workspace.workingCopy?.workingCopyId === workingCopy.workingCopyId,
    );
    return {
      schemaVersion: "4.0.0",
      ...version,
      sourceType: version.sourceType || (version.sourceCandidateId ? "internal-ai" : "initial"),
      versionLabel: `V${version.ordinal}`,
      generatedAt: version.createdAt,
      requestId: version.sourceRequestId,
      attemptId: null,
      committed: true,
      // What the user asked for in the round that produced this version, so the
      // version tree can name it in their own words. Absent for the initial
      // import and for rounds whose records are gone.
      requirement: requirements.get(version.versionId) || null,
      workingCopyId: workingCopy?.workingCopyId || null,
      displayFileName: workingCopy?.sourceRelativePath
        ? path.basename(workingCopy.sourceRelativePath)
        : `版本-${version.ordinal}.html`,
      // Version timestamps are immutable. The active Working Copy is the one
      // exception: show its last successful PageRoot write, never Finder mtime.
      modifiedAt: isActiveWorkingCopy
        ? String(workspace.workingCopyState?.lastSavedAt || version.createdAt)
        : version.createdAt,
      isActiveWorkingCopy,
      isLatestOfficial: version.versionId === workspace.manifest.latestOfficialVersionId,
      differsFromBase: workingCopyProjection?.differsFromBase === true,
      saveState: workingCopyProjection?.saveState || null,
    };
  });
}

// A promoted version's round never changes, so a requirement that was read once
// is cached for the life of the bridge process: the first workspace read pays
// for it and every later refresh costs nothing. Failures are deliberately not
// cached, so a round that is merely busy is retried instead of being hidden for
// the rest of the session.
const versionRequirementCache = new Map();
const VERSION_REQUIREMENT_LIMIT = 120;
const VERSION_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{1,64}$/u;

function condenseVersionRequirement(value) {
  const collapsed = String(value || "").replace(/\s+/gu, " ").trim();
  if (!collapsed) return "";
  return collapsed.length > VERSION_REQUIREMENT_LIMIT
    ? `${collapsed.slice(0, VERSION_REQUIREMENT_LIMIT)}…`
    : collapsed;
}

async function versionRequirement(cacheScope, projectRootPath, requestId) {
  // Reject anything that is not a plain request id so the id can never walk out
  // of the project's own request directory.
  if (!requestId || !VERSION_REQUEST_ID_PATTERN.test(String(requestId))) return "";
  // Keyed by project identity rather than by path: the same root can be spelled
  // differently between reads (symlinked temp roots, renames), which would keep
  // missing the cache.
  const cacheKey = `${cacheScope}\u0000${requestId}`;
  const cached = versionRequirementCache.get(cacheKey);
  if (cached) return cached;
  let requirement = "";
  try {
    const raw = await readFile(
      path.join(
        projectRootPath,
        ".pageroot",
        "requests",
        String(requestId),
        "change-request.json",
      ),
      "utf8",
    );
    const record = JSON.parse(raw);
    // v4 Task Specs keep the user-authored objective under
    // `requirements.objective`; v3 and older records used summary fields.
    requirement = condenseVersionRequirement(
      record?.requirements?.objective
        ?? record?.requirements?.summary
        ?? record?.request?.taskSpec?.objective
        ?? record?.request?.summary,
    );
  } catch {
    // A retired or unreadable round simply has no requirement to show. The
    // version tree falls back to its branch label; the workspace read never
    // fails because of it.
    return "";
  }
  if (requirement) versionRequirementCache.set(cacheKey, requirement);
  return requirement;
}

async function projectFileVersionRequirements(workspace) {
  const projectRootPath = workspace.target?.projectRootPath;
  const cacheScope = workspace.project?.projectId || projectRootPath;
  const versions = Array.isArray(workspace.manifest?.versions)
    ? workspace.manifest.versions
    : [];
  if (!projectRootPath || versions.length === 0) return new Map();
  const entries = await Promise.all(versions.map(async (version) => [
    version.versionId,
    await versionRequirement(cacheScope, projectRootPath, version.sourceRequestId),
  ]));
  return new Map(entries.filter(([, requirement]) => requirement));
}

function projectFileDraftState(workspace) {
  const state = workspace.draft || workspace.workingCopyState || {};
  return {
    draftRevision: Number(state.draftRevision || 0),
    comments: Array.isArray(state.comments) ? state.comments : [],
    changeEvents: Array.isArray(state.changeEvents) ? state.changeEvents : [],
    deletedCommentIds: Array.isArray(state.deletedCommentIds)
      ? state.deletedCommentIds
      : [],
    appliedOperationIds: Array.isArray(state.appliedOperationIds)
      ? state.appliedOperationIds
      : [],
  };
}

function verifiedReadyCandidate(request, candidate, target) {
  if (!request || typeof request !== "object" || !candidate || typeof candidate !== "object") {
    return null;
  }
  const candidateId = String(candidate.candidateId || "");
  if (
    !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(candidateId)
    || candidateId !== String(request.candidateId || "")
    || candidate.projectId !== request.projectId
    || candidate.documentId !== request.documentId
    || candidate.requestId !== request.requestId
    || candidate.attemptId !== request.attemptId
    || candidate.sourceWorkingCopyId !== request.sourceWorkingCopyId
    || candidate.proposedVersionId !== request.proposedVersionId
    || candidate.expectedSourceSha256 !== request.expectedSourceSha256
    || !target
    || target.targetKind !== "working-copy"
    || target.projectId !== candidate.projectId
    || target.documentId !== candidate.documentId
    // The current workspace may already be a newer Working Copy. Candidate
    // identity keeps the Request-origin sourceWorkingCopyId independently;
    // only the authoritative project/document/path/hash may be shared here.
    || target.sourceSha256 !== candidate.expectedSourceSha256
  ) return null;
  return structuredClone(candidate);
}

function projectFileActiveRun(workspace, target) {
  return projectFileRunForRequest({
    request: workspace.activeRequest,
    candidate: workspace.activeCandidate,
    target,
  });
}

function projectFileRunForRequest({ request, candidate = null, target }) {
  if (!request || typeof request !== "object") return null;
  const verifiedCandidate = request.status === "candidate-ready"
    ? verifiedReadyCandidate(request, candidate, target)
    : null;
  const candidateReady = Boolean(verifiedCandidate);
  const terminalStatus = ["no-change", "error"].includes(request.status)
    ? request.status
    : null;
  const status = candidateReady ? "ready-to-open" : terminalStatus || "processing";
  const sourcePath = target.exactSourcePath;
  const requestPath = path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const attemptPath = path.join(requestPath, "attempts", request.attemptId);
  const outputPath = path.join(
    target.projectRootPath,
    ".pageroot",
    ...String(request.outputRelativePath || "").split("/"),
  );
  const completion = candidateReady
    ? {
      completedAt: verifiedCandidate.createdAt,
      projectId: request.projectId,
      documentId: request.documentId,
      requestId: request.requestId,
      attemptId: request.attemptId,
      versionId: verifiedCandidate.proposedVersionId,
      contentSha256: verifiedCandidate.outputSha256,
    }
    : null;
  const readyPayload = candidateReady
    ? {
      status: "ready-to-open",
      readyToOpen: true,
      projectId: request.projectId,
      documentId: request.documentId,
      requestId: request.requestId,
      attemptId: request.attemptId,
      candidateId: verifiedCandidate.candidateId,
      versionId: verifiedCandidate.proposedVersionId,
      candidateVersionId: verifiedCandidate.proposedVersionId,
      candidateDisplayVersionLabel: `版本 ${verifiedCandidate.proposedVersionOrdinal}`,
      contentSha256: verifiedCandidate.outputSha256,
      sourceSha256: verifiedCandidate.expectedSourceSha256,
      // A ready Candidate may belong to a background project while another
      // project is currently mounted. Carry its complete managed OpenTarget
      // so renderer activation never borrows identity fields from the screen.
      openTarget: target,
      version: {
        versionId: verifiedCandidate.proposedVersionId,
        generatedAt: verifiedCandidate.createdAt,
        contentSha256: verifiedCandidate.outputSha256,
        projectId: request.projectId,
        documentId: request.documentId,
      },
      outcome: completion,
      completion,
      candidate: verifiedCandidate,
    }
    : null;
  return {
    projectId: request.projectId,
    documentId: request.documentId,
    sourceWorkingCopyId: request.sourceWorkingCopyId,
    requestId: request.requestId,
    attemptId: request.attemptId,
    ...(candidateReady ? { candidateId: verifiedCandidate.candidateId } : {}),
    status,
    sourcePath,
    requestPath,
    attemptPath,
    promptPath: path.join(requestPath, "PROMPT.md"),
    outputPath,
    completionPath: path.join(attemptPath, "completion.json"),
    handoffMessage: String(
      request.request?.handoffMessage
      || `请执行 ${path.join(requestPath, "PROMPT.md")} 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`,
    ),
    agentDelivery: request.request?.agentDelivery || { mode: "clipboard" },
    baseSnapshotSha256: request.expectedSourceSha256,
    previousVersionId: request.previousVersionId,
    basedOnVersionId: request.basedOnVersionId,
    freezeCutoffRevision: Number(request.request?.freezeCutoffRevision || 0),
    candidateVersionId: request.proposedVersionId,
    candidateVersionOrdinal: request.proposedVersionOrdinal,
    candidateVersionLabel: `版本 ${request.proposedVersionOrdinal}`,
    submittedAt: request.createdAt,
    summary: String(request.request?.summary || ""),
    commentCount: Array.isArray(request.request?.comments)
      ? request.request.comments.length
      : 0,
    changeEventCount: Array.isArray(request.request?.changeEvents)
      ? request.request.changeEvents.length
      : 0,
    ...(candidateReady ? {
      completionObserved: true,
      candidateOutputSha256: verifiedCandidate.outputSha256,
      candidateAssessment: verifiedCandidate.assessment,
      readyPayload,
    } : terminalStatus ? {
      completionObserved: true,
      ...(request.error ? { error: request.error } : {}),
    } : {}),
  };
}

function projectFileTerminalRunOutcome(workspace, target) {
  return projectFileRunForRequest({
    request: workspace.terminalRequest,
    target,
  });
}

async function projectFileBaseWorkspaceState(workspace) {
  const target = workspace.target;
  const requirements = await projectFileVersionRequirements(workspace);
  const currentVersion = workspace.manifest.versions.find(
    (version) => version.versionId === target.versionId,
  ) || null;
  const currentExactVersionId = (
    target.targetKind === "working-copy"
    && currentVersion
    && workspace.sourceSha256 === currentVersion.contentSha256
  ) ? currentVersion.versionId : null;
  const activeDraft = projectFileDraftState(workspace);
  const activeRun = projectFileActiveRun(workspace, target);
  const recentRunOutcome = projectFileTerminalRunOutcome(workspace, target);
  const runtime = {
    lifecycleState: activeRun?.status || "ready",
    activeRun,
    conflict: null,
    editRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    lastPersistedRevision: Number(workspace.workingCopyState?.lastPersistedRevision || 0),
    draft: activeDraft,
  };
  return {
    ok: true,
    registered: true,
    projectFileSchemaVersion: "4.0.0",
    workspace: PROJECT_FILE_ROOT,
    projectRoot: target.projectRootPath,
    paths: {
      currentHtml: target.exactSourcePath,
      projectRecords: target.projectRootPath,
    },
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourcePath: target.exactSourcePath,
    openTarget: target,
    currentHtmlSha256: workspace.sourceSha256,
    sourceSha256: workspace.sourceSha256,
    lastModifiedAt: workspace.lastModifiedAt,
    latestVersionId: workspace.manifest.latestOfficialVersionId,
    currentBasedOnVersionId: target.versionId || null,
    currentExactVersionId,
    restoredFromVersionId: null,
    project: {
      schemaVersion: "4.0.0",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      displayName: path.basename(target.projectRootPath),
      createdAt: workspace.project.createdAt,
      sourcePath: target.exactSourcePath,
      latestVersionId: workspace.manifest.latestOfficialVersionId,
      currentBasedOnVersionId: target.versionId || null,
      currentExactVersionId,
      currentHtmlSha256: workspace.sourceSha256,
    },
    runtimeState: runtime,
    activeRun,
    recentRunOutcome,
    historyCreation: workspace.runtime.historyCreation || null,
    activeDraft,
    workingCopyRecovered: workspace.workingCopyRecovered === true,
    recoveryIdentity: null,
    versions: projectFileVersionRows(workspace, requirements),
    current: {
      path: target.exactSourcePath,
      entryPath: target.exactSourcePath,
      sha256: workspace.sourceSha256,
    },
    content: workspace.content,
    performanceTiming: workspace.performanceTiming || null,
  };
}

async function projectFileWorkspaceState(sourcePath, options = {}) {
  const workspace = await projectFileWorkspaceForSource(sourcePath, options);
  return workspace ? await projectFileBaseWorkspaceState(workspace) : null;
}

function workspaceSnapshotRevision(state, operationId) {
  const operation = String(operationId || "workspace");
  const projectId = String(state.projectId || "unmanaged");
  const documentId = String(state.documentId || "unmanaged");
  const sourceSha256 = String(
    state.sourceSha256
    || state.currentHtmlSha256
    || state.sha256
    || "unhashed",
  );
  return `${operation}:${projectId}:${documentId}:${sourceSha256}`;
}

function coreSupplementalWorkspaceEnvelope(state, { operationId } = {}) {
  const revision = workspaceSnapshotRevision(state, operationId);
  const {
    paths = null,
    project = null,
    versions = [],
    performanceTiming = null,
    ...core
  } = state;
  return {
    ok: state.ok !== false,
    workspaceEnvelopeVersion: 1,
    operationId: String(operationId || ""),
    snapshotRevision: revision,
    core,
    supplemental: {
      operationId: String(operationId || ""),
      snapshotRevision: revision,
      paths,
      project,
      versions,
    },
    performanceTiming,
  };
}

function projectFileBodyIdentityMatches(workspace, body) {
  if (
    body.projectId
    && String(body.projectId) !== workspace.project.projectId
  ) return false;
  if (
    body.documentId
    && String(body.documentId) !== workspace.project.documentId
  ) return false;
  return true;
}

async function ensureProjectFile(body) {
  const expectedSourceSha256 = requireSha256(
    body.expectedSourceSha256,
    "expectedSourceSha256",
  );
  let imported;
  try {
    imported = await projectFileRepository.importExternal({
      sourcePath: normalizeSourcePath(body.sourcePath),
      expectedSourceSha256,
    });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  const workspace = await projectFileWorkspaceForSource(imported.target.exactSourcePath);
  return {
    ...(await projectFileBaseWorkspaceState(workspace)),
    imported: imported.imported,
    ...(imported.imported ? {
      importSourceSha256: requireSha256(
        imported.importSourceSha256,
        "importSourceSha256",
      ),
    } : {}),
  };
}

function publicOpenClassification(classified) {
  if (classified.kind === "managed-project") {
    return {
      kind: "managed-project",
      sourceSha256: classified.sourceSha256,
      openTarget: classified.target,
    };
  }
  if (classified.kind === "known-external") {
    const facts = classified.projectFacts;
    return {
      kind: "known-external",
      sourceSha256: classified.sourceSha256,
      sourceRelation: facts.sourceRelation,
      projectId: facts.projectId,
      documentId: facts.documentId,
      projectName: facts.projectName,
      currentBasedOnVersionId: facts.currentBasedOnVersionId,
      currentBasedOnOrdinal: facts.currentBasedOnOrdinal,
      latestOfficialVersionId: facts.latestOfficialVersionId,
      latestOfficialOrdinal: facts.latestOfficialOrdinal,
      currentDiffersFromBase: facts.currentDiffersFromBase,
      initialVersionId: facts.initialVersionId,
      initialVersionOrdinal: facts.initialVersionOrdinal,
      openTarget: facts.openTarget,
    };
  }
  return {
    kind: "new-external",
    sourceSha256: classified.sourceSha256,
    sourceFileName: classified.sourceFileName,
    visibleV1FileName: classified.visibleV1FileName,
  };
}

async function classifyOpenPath(body) {
  const sourcePath = normalizeSourcePath(body.sourcePath);
  let classified;
  try {
    classified = await projectFileRepository.classifyOpenPath({ sourcePath });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  return publicOpenClassification(classified);
}

async function saveProjectFileAutosave(body) {
  const bodyTarget = projectFileTargetFromBody(body);
  if (bodyTarget && bodyTarget.targetKind !== "working-copy") {
    throw new HttpError(
      409,
      "WORKING_COPY_REQUIRED",
      "This operation requires an editable Working Copy.",
    );
  }
  const workspace = bodyTarget
    ? null
    : await projectFileWorkspaceForSource(body.sourcePath);
  if (!bodyTarget && !workspace) return null;
  if (workspace && !projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The autosave identity does not match the selected project file.",
    );
  }
  const target = bodyTarget || projectFileTargetFromWorkspace(workspace);
  const editRevision = Number(body.editRevision);
  if (!Number.isSafeInteger(editRevision) || editRevision < 1) {
    throw new HttpError(400, "INVALID_EDIT_REVISION", "editRevision must be a positive integer.");
  }
  let saved;
  try {
    saved = await projectFileRepository.saveWorkingCopy({
      target,
      html: body.html ?? body.baseHtml,
      expectedSourceSha256: requireSha256(
        body.expectedSourceSha256 ?? body.sourceSha256,
        "expectedSourceSha256",
      ),
      editRevision,
      sourceHistoryOperations: Array.isArray(body.sourceHistoryOperations)
        ? body.sourceHistoryOperations
        : [],
    });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  const next = await projectFileWorkspaceForSource(saved.target.exactSourcePath);
  const state = await projectFileBaseWorkspaceState(next);
  return {
    ok: true,
    status: "saved",
    projectId: next.project.projectId,
    documentId: next.project.documentId,
    sourcePath: saved.target.exactSourcePath,
    openTarget: saved.target,
    content: next.content,
    sha256: saved.currentSha256,
    sourceSha256: saved.currentSha256,
    currentHtmlSha256: saved.currentSha256,
    lastModifiedAt: next.lastModifiedAt,
    lastSavedAt: String(state.workingCopyState?.lastSavedAt || saved.lastSavedAt || ""),
    persistedRevision: saved.lastPersistedRevision,
    lastPersistedRevision: saved.lastPersistedRevision,
    versionCreated: false,
    currentExactVersionId: state.currentExactVersionId,
    activeDraft: state.activeDraft,
    recoveryIdentity: null,
  };
}

async function sourceProjectFile(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  const state = await projectFileBaseWorkspaceState(workspace);
  return {
    ok: true,
    registered: true,
    projectFileSchemaVersion: "4.0.0",
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
    sourcePath: workspace.target.exactSourcePath,
    openTarget: workspace.target,
    content: workspace.content,
    sha256: workspace.sourceSha256,
    sourceSha256: workspace.sourceSha256,
    currentBasedOnVersionId: state.currentBasedOnVersionId,
    currentExactVersionId: state.currentExactVersionId,
    restoredFromVersionId: null,
    lastModifiedAt: workspace.lastModifiedAt,
  };
}

async function projectFileTargetForBody(body = {}) {
  const direct = projectFileTargetFromBody(body);
  if (direct) return direct;
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  return workspace?.target || null;
}

function projectFileFinalizerCommand(target, request) {
  const nodeRuntime = process.versions.electron
    ? `ELECTRON_RUN_AS_NODE=1 ${shellQuoted(process.execPath)}`
    : shellQuoted(process.execPath);
  return [
    nodeRuntime,
    shellQuoted(FINALIZER_PATH),
    "--project-root",
    shellQuoted(target.projectRootPath),
    "--request-id",
    shellQuoted(request.requestId),
    "--attempt-id",
    shellQuoted(request.attemptId),
  ].join(" ");
}

function agentDeliveryForRequest(body = {}) {
  try {
    return normalizeDispatchableAgentDelivery(body.agentDelivery || { mode: "clipboard" });
  } catch (cause) {
    throw new HttpError(
      422,
      cause?.code || "AGENT_DELIVERY_INVALID",
      "The Request Agent delivery policy is invalid.",
    );
  }
}

const TASK_SCOPE_LABELS = Object.freeze({
  "targets-only": "仅评论目标",
  "targets-plus-required-dependencies": "评论目标及实现要求所需的直接依赖",
  "whole-page": "整页",
});

function promptListItem(value) {
  return String(value || "").trim().replace(/\r?\n/gu, "\n  ");
}

function projectFilePromptForRequest(target, request, taskSpec) {
  const requestRoot = path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const inputPath = path.join(requestRoot, "input", "base", "index.html");
  const inputManifestPath = path.join(requestRoot, "input-manifest.json");
  const changeRequestPath = path.join(requestRoot, "change-request.json");
  const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
  const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
  const outputPath = path.join(
    target.projectRootPath,
    ".pageroot",
    ...String(request.outputRelativePath || "").split("/"),
  );
  const objective = promptListItem(taskSpec.objective);
  const scopePolicy = String(taskSpec.scopePolicy || "");
  const scopeLabel = TASK_SCOPE_LABELS[scopePolicy] || scopePolicy;
  const visualContextByTargetId = new Map(
    (Array.isArray(request.comments) ? request.comments : []).flatMap((comment) => {
      const sourceAnchor = comment?.sourceAnchor || comment?.target;
      const targetId = String(sourceAnchor?.targetId || "");
      const hint = comment?.visualHint || comment?.target?.visualHint;
      return targetId && hint?.runtimeGenerated === true
        ? [[targetId, hint]]
        : [];
    }),
  );
  const instructionLines = taskSpec.instructions.map((instruction) => {
    const targets = instruction.targetRefs.join("、");
    const visualLines = instruction.targetRefs.flatMap((targetId) => {
      const hint = visualContextByTargetId.get(targetId);
      if (!hint) return [];
      const box = hint.relativeBox
        ? `相对位置：${hint.relativeBox.x},${hint.relativeBox.y},${hint.relativeBox.width},${hint.relativeBox.height}`
        : "";
      return [
        `  - 可见对象：${promptListItem(hint.label)}；类型：${promptListItem(hint.kind)}${hint.relativePath ? `；宿主内路径：${promptListItem(hint.relativePath)}` : ""}${box ? `；${box}` : ""}${hint.renderedText ? `；可见文字摘要：${promptListItem(hint.renderedText)}` : ""}`,
      ];
    });
    return `- ${promptListItem(instruction.text)}\n  - 目标源码锚点：${targets}${visualLines.length > 0 ? `\n${visualLines.join("\n")}` : ""}`;
  });
  const acceptanceLines = [
    ...taskSpec.globalAcceptanceCriteria.map((criterion) => (
      `- ${promptListItem(criterion)}（全局）`
    )),
    ...taskSpec.instructions.flatMap((instruction) => (
      instruction.acceptanceCriteria.map((criterion) => (
        `- ${promptListItem(criterion)}（${instruction.instructionId}）`
      ))
    )),
  ];
  const nonGoalLines = taskSpec.nonGoals.map((nonGoal) => `- ${promptListItem(nonGoal)}`);
  return `# PageRoot AI Candidate\n\n## 本轮目标\n\n${objective}\n\n## 修改范围\n\n${scopeLabel}（\`${scopePolicy}\`）\n\n## 本轮要求\n\n${instructionLines.join("\n")}\n\n## 运行时可见内容评论规则\n\n评论可能指向由某个源码宿主生成的表格、图表、SVG、Canvas 或其他可见内容。每条评论的 \`sourceAnchor\` 是唯一拥有保存、跨版本重绑和源码定位权限的稳定源码 TargetRef；\`visualHint\` 只用于区分用户实际看到的对象。用户评论的是由该源码宿主生成的可见内容。请修改生成该内容的 HTML、数据或 Script，不要修改或保存临时 Runtime DOM，也不要把 \`visualHint\` 当作源码身份或编辑权限。\n\n${acceptanceLines.length > 0 ? `## 验收标准\n\n${acceptanceLines.join("\n")}\n\n` : ""}## 明确不做\n\n${nonGoalLines.length > 0 ? nonGoalLines.join("\n") : "评论中没有额外明确的不做项。"}\n\n## 冻结输入与输出\n\n从 \`${inputManifestPath}\` 开始，严格按 \`readOrder\` 读取。跨任务不变的合同在 \`input/AI_RULES.md\`；本轮 Task Spec 以 \`${changeRequestPath}\` 为准。\n\n- 项目长期规则：\`${projectRulesPath}\`\n- 冻结 HTML：\`${inputPath}\`\n- 评论、目标与审计上下文：\`${annotationsPath}\`\n- 唯一输出：\`${outputPath}\`\n\n## 完成\n\n完成输出写入后，最后执行唯一最终化命令：\n\n\`\`\`sh\n${projectFileFinalizerCommand(target, request)}\n\`\`\`\n`;
}

function projectFileReadyPayload({ request, candidate: candidateInput, target }) {
  const candidate = verifiedReadyCandidate(request, candidateInput, target);
  if (!candidate) {
    throw new ProjectFileError(
      "CANDIDATE_IDENTITY_INVALID",
      "候选版本缺少可核对的完整身份，不能进入采用流程。",
    );
  }
  const completedAt = String(candidate.createdAt || request.createdAt || nowIso());
  const version = {
    versionId: candidate.proposedVersionId,
    generatedAt: completedAt,
    contentSha256: candidate.outputSha256,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
  };
  const completion = {
    completedAt,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
    requestId: candidate.requestId,
    attemptId: candidate.attemptId,
    candidateId: candidate.candidateId,
    versionId: candidate.proposedVersionId,
    contentSha256: candidate.outputSha256,
  };
  return {
    ok: true,
    status: "ready-to-open",
    readyToOpen: true,
    projectId: candidate.projectId,
    documentId: candidate.documentId,
    sourcePath: target.exactSourcePath,
    currentPath: target.exactSourcePath,
    workingCopyPath: target.exactSourcePath,
    openTarget: target,
    requestId: candidate.requestId,
    attemptId: candidate.attemptId,
    candidateId: candidate.candidateId,
    versionId: candidate.proposedVersionId,
    candidateVersionId: candidate.proposedVersionId,
    candidateVersionLabel: `V${candidate.proposedVersionOrdinal}`,
    candidateDisplayVersionLabel: `版本 ${candidate.proposedVersionOrdinal}`,
    contentSha256: candidate.outputSha256,
    sourceSha256: candidate.expectedSourceSha256,
    currentHtmlSha256: candidate.expectedSourceSha256,
    version,
    completion,
    outcome: completion,
    candidate,
    candidateAssessment: candidate.assessment,
    activeRun: {
      projectId: candidate.projectId,
      documentId: candidate.documentId,
      sourceWorkingCopyId: candidate.sourceWorkingCopyId,
      requestId: candidate.requestId,
      attemptId: candidate.attemptId,
      status: "ready-to-open",
      sourcePath: target.exactSourcePath,
      requestPath: path.join(target.projectRootPath, ".pageroot", "requests", candidate.requestId),
      attemptPath: path.join(target.projectRootPath, ".pageroot", "requests", candidate.requestId, "attempts", candidate.attemptId),
      handoffMessage: String(request.request?.handoffMessage || ""),
      agentDelivery: request.request?.agentDelivery || { mode: "clipboard" },
      baseSnapshotSha256: candidate.expectedSourceSha256,
      candidateId: candidate.candidateId,
      previousVersionId: candidate.previousVersionId,
      basedOnVersionId: candidate.basedOnVersionId,
      freezeCutoffRevision: Number(request.request?.freezeCutoffRevision || 0),
      candidateVersionId: candidate.proposedVersionId,
      candidateVersionOrdinal: candidate.proposedVersionOrdinal,
      candidateVersionLabel: `版本 ${candidate.proposedVersionOrdinal}`,
      submittedAt: request.createdAt,
      summary: String(request.request?.summary || ""),
      commentCount: Array.isArray(request.request?.comments)
        ? request.request.comments.length
        : 0,
      changeEventCount: Array.isArray(request.request?.changeEvents)
        ? request.request.changeEvents.length
        : 0,
      completionObserved: true,
      candidateOutputSha256: candidate.outputSha256,
      candidateAssessment: candidate.assessment,
    },
  };
}

async function saveProjectFileDraft(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  if (target.targetKind !== "working-copy") {
    throw new HttpError(409, "WORKING_COPY_REQUIRED", "Drafts belong to an editable Working Copy.");
  }
  try {
    const saved = await projectFileRepository.saveDraft({
      target,
      operationId: body.operationId,
      expectedDraftRevision: body.expectedDraftRevision,
      basedOnVersionId: body.basedOnVersionId,
      comments: body.comments,
      changeEvents: body.changeEvents,
      deletedCommentIds: body.deletedCommentIds,
    });
    return {
      ok: true,
      projectId: target.projectId,
      documentId: target.documentId,
      ...saved,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function createProjectFileRequest(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  if (target.targetKind !== "working-copy") {
    throw new HttpError(409, "WORKING_COPY_REQUIRED", "AI Requests require an editable Working Copy.");
  }
  const submission = body.submissionOperationId
    ? await projectFileRepository.submissionReceipt({ target, operationId: body.submissionOperationId }) : null;
  if (body.submissionOperationId && (!submission || submission.status === "not-started")) {
    throw new HttpError(409, "SUBMISSION_NOT_ACCEPTED", "A recorded submission is required.");
  }
  const requestId = submission?.requestId || `req_${randomUUID().replaceAll("-", "")}`;
  const attemptId = "attempt_001";
  let taskSpec;
  try {
    taskSpec = compileTaskSpec({
      comments: Array.isArray(body.comments) ? body.comments : [],
      targets: Array.isArray(body.targets) ? body.targets : [],
    });
  } catch (cause) {
    throw new HttpError(
      422,
      cause?.code || "TASK_SPEC_INVALID",
      "The current comments could not be compiled into a valid Task Spec.",
    );
  }
  if (submission && !submissionRequestMatches(submission.snapshot, body, taskSpec)) {
    throw new HttpError(409, "SUBMISSION_SNAPSHOT_CHANGED", "Submitted requirements cannot be replaced.");
  }
  const request = {
    ...(submission ? { submissionOperationId: submission.operationId } : {}),
    freezeCutoffRevision: Number(body.freezeCutoffRevision || 0),
    summary: taskSpec.objective,
    taskSpec,
    comments: Array.isArray(body.comments) ? body.comments : [],
    changeEvents: Array.isArray(body.changeEvents) ? body.changeEvents : [],
    agentDelivery: agentDeliveryForRequest(body),
  };
  const promptDescriptor = {
    requestId,
    attemptId,
    outputRelativePath: `requests/${requestId}/attempts/${attemptId}/output/candidate.html`,
  };
  const handoffMessage = `请执行 ${path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    requestId,
    "PROMPT.md",
  )} 中的单轮任务，完成后运行其中的最终化（finalizer）命令。`;
  const prompt = projectFilePromptForRequest(
    target,
    { ...promptDescriptor, comments: request.comments },
    taskSpec,
  );
  try {
    const durable = await projectFileRepository.prepareRequest({
      target,
      requestId,
      attemptId,
      expectedSourceSha256: requireSha256(
        body.expectedSourceSha256 ?? body.sourceSha256,
        "expectedSourceSha256",
      ),
      request: { ...request, handoffMessage },
      prompt,
    });
    if (submission) await projectFileRepository.finishSubmission({ target,
      operationId: submission.operationId, status: "request-created" });
    const run = projectFileActiveRun({
      activeRequest: durable,
      activeCandidate: null,
    }, target);
    return {
      ok: true,
      ...durable,
      candidateVersionId: durable.proposedVersionId,
      candidateDisplayVersionLabel: `版本 ${durable.proposedVersionOrdinal}`,
      projectRoot: target.projectRootPath,
      inputPath: path.join(
        target.projectRootPath,
        ".pageroot",
        "requests",
        requestId,
        "input",
        "base",
        "index.html",
      ),
      attemptPath: run.attemptPath,
      outputPath: run.outputPath,
      completionPath: run.completionPath,
      activeRun: run,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileRequestStatus(sourcePath, requestId, attemptId) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const status = await projectFileRepository.requestStatus({
      target: projectFileTargetFromWorkspace(workspace),
      requestId,
      attemptId,
    });
    if (status.status === "candidate-ready") {
      const refreshed = await projectFileWorkspaceForSource(workspace.target.exactSourcePath);
      const ready = projectFileReadyPayload({
        request: status.request,
        candidate: status.candidate,
        target: refreshed.target,
      });
      return {
        ...ready,
        agentSession: agentSessionForStatus({
          request: status.request,
          run: ready.activeRun,
          lifecycleStatus: status.status,
        }),
      };
    }
    const activeRun = projectFileActiveRun(workspace, workspace.target);
    return {
      ok: true,
      status: status.status,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      sourcePath: workspace.target.exactSourcePath,
      openTarget: workspace.target,
      requestId,
      attemptId,
      activeRun,
      agentSession: agentSessionForStatus({
        request: status.request,
        run: activeRun,
        lifecycleStatus: status.status,
      }),
      ...(status.request ? { request: status.request } : {}),
      ...(status.request?.error ? { error: status.request.error } : {}),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function resolveAgentBridgeTask(identity) {
  const workspace = await projectFileWorkspaceForSource(identity.sourcePath);
  if (!workspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(workspace, identity)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The Agent task does not belong to the requested Project File.",
    );
  }
  const target = projectFileTargetFromWorkspace(workspace);
  let status;
  try {
    status = await projectFileRepository.requestStatus({
      target,
      requestId: identity.requestId,
      attemptId: identity.attemptId,
    });
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
  const run = status.request
    ? projectFileRunForRequest({ request: status.request, target })
    : null;
  return { target, request: status.request || null, run };
}

function compatibilityDriverForAgentDelivery(delivery) {
  try {
    return legacyDriverForAgentDelivery(delivery);
  } catch {
    return null;
  }
}

function agentSessionForStatus({ request, run, lifecycleStatus }) {
  const delivery = request?.request?.agentDelivery;
  if (!run || delivery?.mode === "clipboard") return null;
  let normalizedDelivery;
  try {
    normalizedDelivery = normalizeAgentDelivery(delivery);
  } catch {
    return null;
  }
  const compatibilityDriver = compatibilityDriverForAgentDelivery(normalizedDelivery);
  const publicDriver = compatibilityDriver || normalizedDelivery.selection.providerId;
  const identity = {
    projectId: run.projectId,
    documentId: run.documentId,
    sourcePath: run.sourcePath,
    requestId: run.requestId,
    attemptId: run.attemptId,
  };
  const session = agentBridgeService.status(identity);
  if (session) return session;
  if (lifecycleStatus === "candidate-ready") {
    return {
      providerId: normalizedDelivery.selection.providerId,
      runtimeId: normalizedDelivery.selection.runtimeId,
      driver: publicDriver,
      state: "completed",
      phase: "awaiting-validation",
      startedAt: null,
      lastActivityAt: null,
      updatedAt: String(request.createdAt || nowIso()),
      agentName: null,
      agentVersion: null,
      eventCount: 0,
      receivedBytes: 0,
      visibleText: "",
      visibleTextUpdates: [],
      textTruncated: false,
      retryable: false,
    };
  }
  return agentBridgeService.interrupted(identity, {
    selection: normalizedDelivery.selection,
  });
}

async function activateProjectFileCandidate(body) {
  const candidateId = String(body?.candidateId || "");
  if (!/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(candidateId)) {
    throw new HttpError(422, "INVALID_CANDIDATE_ID", "candidateId is required for Candidate adoption.");
  }
  const expectedDecisionOperationId = `promote_${candidateId}`;
  if (body?.decisionOperationId !== expectedDecisionOperationId) {
    throw new HttpError(
      409,
      "DECISION_IDENTITY_MISMATCH",
      "decisionOperationId must identify the Candidate being adopted.",
    );
  }
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  try {
    const promoted = await projectFileRepository.promoteCandidate({
      target,
      // `versionId` is a proposed Version label in the renderer protocol, not
      // the opaque Candidate id owned by the v4 repository.  Do not let that
      // label select a different Candidate (or turn a valid adoption into an
      // invalid-id error).
      candidateId,
      expectedSourceSha256: body.expectedSourceSha256,
      decisionOperationId: body.decisionOperationId,
    });
    const workspace = await projectFileWorkspaceForSource(promoted.target.exactSourcePath);
    const source = workspace.content;
    return {
      ok: true,
      status: "version-activated",
      retainedDraft: workspace.draft || null,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      versionId: promoted.version.versionId,
      sourcePath: promoted.target.exactSourcePath,
      currentPath: promoted.target.exactSourcePath,
      workingCopyPath: promoted.target.exactSourcePath,
      openTarget: promoted.target,
      contentSha256: promoted.version.contentSha256,
      sourceSha256: promoted.version.contentSha256,
      currentHtmlSha256: promoted.version.contentSha256,
      lastModifiedAt: workspace.lastModifiedAt,
      version: {
        ...promoted.version,
        generatedAt: promoted.version.createdAt,
        projectId: workspace.project.projectId,
        documentId: workspace.project.documentId,
      },
      content: source,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function cancelProjectFileRequest(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) return null;
  try {
    const cancelled = await agentBridgeService.cancelDurable({
      identity: {
        projectId: target.projectId,
        documentId: target.documentId,
        sourcePath: target.exactSourcePath,
        requestId: body.requestId,
        attemptId: body.attemptId || "attempt_001",
      },
      cancelRequest: () => projectFileRepository.cancelRequest({
        target,
        discardCandidate: body.intent === "discard",
        requestId: body.requestId,
        attemptId: body.attemptId || "attempt_001",
      }),
    });
    return {
      ok: true,
      projectId: target.projectId,
      documentId: target.documentId,
      ...cancelled,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function canonicalDeliveryFromAgentBody(body) {
  if (body?.driver && !body?.selection && !body?.agentDelivery) {
    throw new HttpError(
      400,
      "AGENT_SELECTION_UNSUPPORTED",
      "Current Agent execution requires a canonical selection.",
    );
  }
  if (body?.selection) {
    return normalizeAgentDelivery({
      mode: "managed-agent",
      selection: body.selection,
      trustPolicyVersion: body.trustPolicyAccepted,
    });
  }
  if (body?.agentDelivery) {
    return normalizeAgentDelivery(body.agentDelivery);
  }
  return defaultManagedAgentDelivery();
}

async function preflightAgent(body) {
  const delivery = canonicalDeliveryFromAgentBody(body);
  const { driver: _ignored, ...rest } = body || {};
  return agentBridgeService.preflight({
    ...rest,
    selection: delivery.selection,
    trustPolicyAccepted: delivery.trustPolicyVersion,
  });
}

function availabilitySelection(value) {
  if (!value) return null;
  try {
    return normalizeAgentDelivery({
      mode: "managed-agent",
      selection: JSON.parse(value),
      trustPolicyVersion: defaultManagedAgentDelivery().trustPolicyVersion,
    }, { allowLegacy: false }).selection;
  } catch {
    throw new HttpError(
      400,
      "AGENT_SELECTION_INVALID",
      "The Agent availability selection is invalid.",
    );
  }
}

async function agentAvailability(selectionInput = null) {
  const selection = availabilitySelection(selectionInput);
  return agentBridgeService.availability(selection ? { selection } : {});
}

async function agentDiagnose(selectionInput = null) {
  const selection = availabilitySelection(selectionInput);
  return agentBridgeService.diagnose(selection ? { selection } : {});
}

async function agentProviders() {
  return agentBridgeService.providers();
}

async function installAgent(body) {
  const providerId = String(body?.providerId || "").trim();
  const result = await agentBridgeService.install(providerId);
  return Object.freeze({
    ok: true,
    providerId: result.providerId,
    installSource: result.installSource,
    installState: "idle",
  });
}

async function setAgentSessionCredential(body) {
  const providerId = String(body?.providerId || "").trim();
  if (body?.apiKey == null || body?.apiKey === "") {
    return agentBridgeService.clearSessionCredential(providerId);
  }
  const modelId = String(body?.modelId || "").trim();
  const selection = body.selection || (modelId
    ? {
      providerId,
      runtimeId: "http",
      requestedModelId: modelId.startsWith(`${providerId}:`) ? modelId : `${providerId}:${modelId}`,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }
    : undefined);
  return agentBridgeService.setSessionCredential(providerId, body.apiKey, {
    vendorId: body.vendorId,
    baseUrl: body.baseUrl,
    selection,
  });
}

async function updateAgentConfiguration(body) {
  const providerId = String(body?.providerId || "").trim();
  if (body?.disconnect === true) return agentBridgeService.clearSessionCredential(providerId);
  return agentBridgeService.updateAgentConfiguration(providerId, {
    apiKey: body.apiKey,
    vendorId: body.vendorId,
    baseUrl: body.baseUrl,
    selection: body.selection,
  });
}

async function cancelAgentConfiguration(body) {
  const providerId = String(body?.providerId || "").trim();
  return agentBridgeService.cancelAgentConfiguration(providerId, body?.generation);
}

async function cancelAgentInstall(body) {
  const providerId = String(body?.providerId || "").trim();
  const snapshot = await agentBridgeService.cancelInstall(providerId);
  return Object.freeze({
    ok: true,
    providerId: snapshot.providerId,
    installState: snapshot.installState,
  });
}

async function loginAgent(body) {
  const providerId = String(body?.providerId || "").trim();
  const snapshot = await agentBridgeService.login(providerId);
  return Object.freeze({
    ok: true,
    providerId: snapshot.providerId,
    loginState: snapshot.loginState,
    generation: snapshot.generation,
    startedAt: snapshot.startedAt,
    errorCode: snapshot.errorCode,
    loginUrlPresent: snapshot.loginUrlPresent === true,
    activeOperation: agentBridgeService.accessOperation(providerId),
  });
}

async function cancelAgentLogin(body) {
  const providerId = String(body?.providerId || "").trim();
  const snapshot = await agentBridgeService.cancelLogin(providerId);
  return Object.freeze({
    ok: true,
    providerId: snapshot.providerId,
    loginState: snapshot.loginState,
    generation: snapshot.generation,
    startedAt: snapshot.startedAt,
    errorCode: snapshot.errorCode,
    loginUrlPresent: snapshot.loginUrlPresent === true,
    activeOperation: agentBridgeService.accessOperation(providerId),
  });
}

async function logoutAgent(body) {
  const providerId = String(body?.providerId || "").trim();
  const snapshot = await agentBridgeService.logout(providerId);
  return Object.freeze({
    ok: true,
    providerId,
    ...snapshot,
  });
}

async function agentLoginUrl(providerIdInput) {
  const providerId = String(providerIdInput || "").trim();
  const loginUrl = agentBridgeService.loginUrl(providerId);
  if (!loginUrl) {
    return Object.freeze({ ok: true, providerId, loginUrl: null });
  }
  return Object.freeze({ ok: true, providerId, loginUrl });
}

async function startAgent(body) {
  const target = await projectFileTargetForBody(body);
  if (!target) throw projectNotFoundError();
  if (
    String(body.projectId || "") !== target.projectId
    || String(body.documentId || "") !== target.documentId
  ) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The Agent task identity does not match the registered Project File.",
    );
  }
  const delivery = canonicalDeliveryFromAgentBody(body);
  return agentBridgeService.submit({
    selection: delivery.selection,
    trustPolicyAccepted: delivery.trustPolicyVersion,
    preflightId: body.preflightId,
    configurationDigest: body.configurationDigest,
    projectId: target.projectId,
    documentId: target.documentId,
    sourcePath: target.exactSourcePath,
    requestId: body.requestId,
    attemptId: body.attemptId || "attempt_001",
  });
}

async function projectFileVersionFile(sourcePath, versionId) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const file = await projectFileRepository.readVersionFile({
      target: projectFileTargetFromWorkspace(workspace),
      versionId,
    });
    const visibleWorkingCopy = file.kind === "version"
      ? await projectFileRepository.resolveVersionWorkingCopy({
        target: projectFileTargetFromWorkspace(workspace),
        versionId,
      })
      : null;
    return {
      ok: true,
      projectFileSchemaVersion: "4.0.0",
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      projectRootPath: workspace.target.projectRootPath,
      versionId: file.version.versionId,
      content: file.content,
      sha256: file.sha256,
      contentSha256: file.sha256,
      path: file.path,
      relativePath: file.kind === "candidate"
        ? file.candidate.outputRelativePath
        : file.version.snapshotRelativePath,
      readOnly: true,
      ...(visibleWorkingCopy ? {
        workingCopyId: visibleWorkingCopy.workingCopyId,
        visibleWorkingCopyPath: visibleWorkingCopy.workingCopyPath,
        workingCopySha256: visibleWorkingCopy.sourceSha256,
      } : {}),
      ...(file.kind === "candidate" ? { candidate: file.candidate } : {}),
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileAiTask(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) return null;
  try {
    const projection = await projectFileRepository.materializeCurrentAiTaskProjection({
      target: projectFileTargetFromWorkspace(workspace),
    });
    return {
      ok: true,
      projectFileSchemaVersion: "4.0.0",
      projectId: projection.projectId,
      documentId: projection.documentId,
      sourcePath: workspace.target.exactSourcePath,
      projectRootPath: projection.projectRootPath,
      requestId: projection.requestId,
      attemptId: projection.attemptId,
      candidateId: projection.candidateId,
      status: projection.status,
      aiTaskPath: projection.taskPath,
      aiTaskRelativePath: projection.taskRelativePath,
      candidatePath: projection.candidatePath,
      candidateSha256: projection.candidateSha256,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileHistoryCreation(body, action) {
  const allowedKeys = new Set(["target", "versionId", "operationId", "expectedSourceSha256", "expectedSnapshotSha256"]);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "INVALID_HISTORY_CREATION", "The history creation payload is invalid.");
  }
  const target = projectFileTargetFromBody(body.target);
  if (!target || target.targetKind !== "working-copy") throw new HttpError(400, "OPEN_TARGET_REQUIRED", "A managed Working Copy identity is required.");
  try {
    const result = action === "create"
      ? await projectFileRepository.createVersionFromHistory({ target, versionId: body.versionId, operationId: body.operationId, expectedSourceSha256: body.expectedSourceSha256, expectedSnapshotSha256: body.expectedSnapshotSha256 })
      : await projectFileRepository.queryHistoryCreation({ target, operationId: body.operationId, markOpened: action === "opened" });
    return { ok: true, ...result };
  } catch (cause) { throw projectFileHttpError(cause); }
}

async function continueProjectFileHistoryVersion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_HISTORY_CONTINUE", "The history continuation payload is invalid.");
  }
  const allowedKeys = new Set([
    "sourcePath",
    "projectId",
    "documentId",
    "versionId",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "INVALID_HISTORY_CONTINUE", "The history continuation payload has unsupported fields.");
  }
  if (!/^ver_\d{4,}$/.test(String(body.versionId || ""))) {
    throw new HttpError(400, "INVALID_VERSION_ID", "versionId is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(String(body.operationId || ""))) {
    throw new HttpError(400, "INVALID_OPERATION_ID", "operationId is invalid.");
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) return null;
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The history continuation identity does not match the selected project.",
    );
  }
  try {
    const sourceTarget = projectFileTargetFromWorkspace(workspace);
    const activated = await projectFileRepository.activateVersionWorkingCopy({
      target: sourceTarget,
      versionId: String(body.versionId),
      operationId: String(body.operationId),
      expectedActiveWorkingCopyId: sourceTarget.workingCopyId,
    });
    const next = await projectFileWorkspaceForSource(activated.target.exactSourcePath);
    return {
      ...(await projectFileBaseWorkspaceState(next)),
      status: "history-working-copy-activated",
      historyActivation: activated.historyActivation,
      operationId: activated.historyActivation.operationId,
      replayed: activated.replayed === true,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function confirmProjectFileHistoryVersion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation payload is invalid.");
  }
  const allowedKeys = new Set([
    "sourcePath",
    "projectId",
    "documentId",
    "previousWorkingCopyId",
    "activatedWorkingCopyId",
    "versionId",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation payload has unsupported fields.");
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) return null;
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The history activation confirmation identity does not match the selected project.",
    );
  }
  if (
    body.previousWorkingCopyId !== null
    && !/^work_ver_\d{4,}$/.test(String(body.previousWorkingCopyId || ""))
  ) {
    throw new HttpError(400, "INVALID_WORKING_COPY_ID", "previousWorkingCopyId is invalid.");
  }
  if (
    !/^[A-Za-z0-9_-]{8,160}$/.test(String(body.operationId || ""))
    || !/^work_ver_\d{4,}$/.test(String(body.activatedWorkingCopyId || ""))
    || !/^ver_\d{4,}$/.test(String(body.versionId || ""))
  ) {
    throw new HttpError(400, "INVALID_HISTORY_CONFIRM", "The history activation confirmation is invalid.");
  }
  try {
    const confirmed = await projectFileRepository.confirmVersionWorkingCopyActivation({
      target: projectFileTargetFromWorkspace(workspace),
      operationId: String(body.operationId),
      previousWorkingCopyId: body.previousWorkingCopyId,
      activatedWorkingCopyId: String(body.activatedWorkingCopyId),
      versionId: String(body.versionId),
    });
    return {
      ok: true,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      status: "history-working-copy-desktop-confirmed",
      historyActivation: confirmed.historyActivation,
      confirmed: confirmed.confirmed,
      operationId: confirmed.historyActivation.operationId,
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

function shellQuoted(value) {
  return JSON.stringify(String(value));
}

async function unmanagedWorkspaceState(sourcePath) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const source = await readSourceFile(normalizedSourcePath);
  return {
    ok: true,
    registered: false,
    workspace: WORKSPACE_ROOT,
    projectRoot: null,
    paths: {
      currentHtml: normalizedSourcePath,
      projectRecords: null,
    },
    projectId: null,
    documentId: null,
    sourcePath: normalizedSourcePath,
    currentHtmlSha256: source.sha256,
    sourceSha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    latestVersionId: null,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    project: {
      displayName: projectDisplayName(normalizedSourcePath),
      sourcePath: normalizedSourcePath,
    },
    runtimeState: {
      lifecycleState: "preview",
      editRevision: 0,
      lastPersistedRevision: 0,
      activeRun: null,
      conflict: null,
    },
    activeRun: null,
    recentRunOutcome: null,
    activeDraft: null,
    recoveryIdentity: null,
    versions: [],
    current: {
      path: normalizedSourcePath,
      entryPath: normalizedSourcePath,
      sha256: source.sha256,
    },
  };
}

async function unmanagedSourceFile(sourcePath) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const source = await readSourceFile(normalizedSourcePath);
  return {
    ok: true,
    registered: false,
    projectId: null,
    documentId: null,
    sourcePath: normalizedSourcePath,
    content: source.html,
    sha256: source.sha256,
    sourceSha256: source.sha256,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    lastModifiedAt: source.lastModifiedAt,
  };
}

async function workspaceState(sourcePath, { operationId, split = false } = {}) {
  const startedAt = nodePerformance.now();
  const projectFileState = await projectFileWorkspaceState(sourcePath);
  const state = projectFileState || await unmanagedWorkspaceState(sourcePath);
  const timedState = {
    ...state,
    performanceTiming: {
      ...(state.performanceTiming || {}),
      bridgeWorkspaceTotalMs: Math.round(
        Math.max(0, nodePerformance.now() - startedAt) * 1_000,
      ) / 1_000,
    },
  };
  return split
    ? coreSupplementalWorkspaceEnvelope(timedState, { operationId })
    : timedState;
}

async function sourceFile(sourcePath) {
  const projectFileSource = await sourceProjectFile(sourcePath);
  return projectFileSource || unmanagedSourceFile(sourcePath);
}

async function ensureProject(body) {
  return ensureProjectFile(body);
}

async function saveAutosave(body) {
  return requireFound(await saveProjectFileAutosave(body));
}

async function saveDraft(body) {
  return requireFound(await saveProjectFileDraft(body));
}

async function createRequest(body) {
  return requireFound(await createProjectFileRequest(body));
}

async function activateReadyVersion(body) {
  return requireFound(await activateProjectFileCandidate(body));
}

async function statusFor(sourcePath, requestId, attemptId = "attempt_001") {
  return requireFound(
    await projectFileRequestStatus(sourcePath, requestId, attemptId),
  );
}

async function cancelActiveRun(body) {
  return requireFound(await cancelProjectFileRequest(body));
}

async function versionFile(sourcePath, versionId) {
  return requireFound(await projectFileVersionFile(sourcePath, versionId));
}

async function requireEditableProjectFileTarget(body) {
  const direct = projectFileTargetFromBody(body);
  if (direct) {
    if (direct.targetKind !== "working-copy") {
      throw new HttpError(
        409,
        "WORKING_COPY_REQUIRED",
        "This operation requires an editable Working Copy.",
      );
    }
    return direct;
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The project file identity does not match the selected project.",
    );
  }
  return projectFileTargetFromWorkspace(workspace);
}

async function saveDraftAttachment(body) {
  const target = await requireEditableProjectFileTarget(body);
  const commentId = attachmentRecordId(body.commentId, "comment");
  const attachmentId = attachmentRecordId(body.attachmentId, "attachment");
  const fileName = safeAttachmentFileName(body.fileName);
  const mediaType = attachmentMediaType(body.mediaType);
  const buffer = decodeAttachmentBase64(body.dataBase64);
  if (
    body.byteLength !== undefined
    && Number(body.byteLength) !== buffer.byteLength
  ) {
    throw new HttpError(
      422,
      "ATTACHMENT_LENGTH_MISMATCH",
      "Attachment byteLength does not match its decoded data.",
    );
  }
  const relativePath = [
    "draft",
    "attachments",
    commentId,
    `${attachmentId}-${fileName}`,
  ].join("/");
  const { absolutePath } = resolveAttachmentPath(
    target.projectRootPath,
    relativePath,
    { draftOnly: true },
  );
  await ensureDirectory(path.dirname(absolutePath));
  await atomicWriteFile(absolutePath, buffer);
  return {
    ok: true,
    projectId: target.projectId,
    documentId: target.documentId,
    attachment: {
      attachmentId,
      kind: attachmentKind(body.kind, mediaType, fileName),
      fileName,
      mediaType,
      byteLength: buffer.byteLength,
      sha256: sha256(buffer),
      relativePath,
      source: body.source === "clipboard" ? "clipboard" : "file-picker",
    },
  };
}

async function readAttachment(sourcePath, relativePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  const resolved = resolveAttachmentPath(
    workspace.target.projectRootPath,
    relativePath,
  );
  const information = await lstat(resolved.absolutePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment was not found.");
    }
    throw error;
  });
  if (
    !information.isFile()
    || information.isSymbolicLink()
    || information.size <= 0
    || information.size > MAX_ATTACHMENT_BYTES
  ) {
    throw new HttpError(422, "INVALID_ATTACHMENT_FILE", "Attachment file is not safe to read.");
  }
  return {
    buffer: await readFile(resolved.absolutePath),
    fileName: path.basename(resolved.absolutePath).replace(
      /^attachment_[A-Za-z0-9_-]+-/,
      "",
    ),
  };
}

async function deleteDraftAttachment(body) {
  const target = await requireEditableProjectFileTarget(body);
  const relativePath = String(body.relativePath ?? "").replaceAll("\\", "/");
  if (!relativePath.startsWith("draft/attachments/")) {
    return { ok: true, removed: false, retainedImmutableCopy: true };
  }
  const resolved = resolveAttachmentPath(
    target.projectRootPath,
    relativePath,
    { draftOnly: true },
  );
  await rm(resolved.absolutePath, { force: true });
  await rm(path.dirname(resolved.absolutePath)).catch(() => {});
  return { ok: true, removed: true };
}

// Conversation reads and draft writes. The Bridge is the only conversation
// writer; the renderer receives a projection and never touches these files.
// A conversation belongs to exactly one Document, so the context is always
// derived from the resolved workspace rather than from the request body.
function conversationContext(workspace) {
  return {
    // The repository's `projectRoot` is the managed control root, matching the
    // convention already used by the source-history service.
    projectRoot: path.join(workspace.target.projectRootPath, ".pageroot"),
    projectId: workspace.project.projectId,
    documentId: workspace.project.documentId,
  };
}

async function currentConversation(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  const context = conversationContext(workspace);
  const conversation = await ensureCurrentConversation(context);
  const draft = await readConversationDraft(context, conversation.conversationId);
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    ...conversationResponse(conversation, draft),
  };
}

async function documentConversations(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  const context = conversationContext(workspace);
  const index = await readConversationIndex(context);
  return {
    ok: true,
    projectId: context.projectId,
    ...conversationListResponse(index, context.documentId),
  };
}

async function saveConversationDraft(body) {
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(workspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The conversation identity does not match the selected project.",
    );
  }
  const context = conversationContext(workspace);
  // Reading the current conversation first keeps a draft from being written for
  // a conversation that does not belong to this Document.
  const conversation = await readConversation(context, body.conversationId);
  if (!conversation) {
    throw new HttpError(
      404,
      "CONVERSATION_MISSING",
      "That conversation does not exist for this document.",
    );
  }
  const draft = await writeConversationDraft(context, conversation.conversationId, {
    text: typeof body.text === "string" ? body.text : "",
    intent: body.intent,
    ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
    ...(body.modelDisplayName === undefined
      ? {}
      : { modelDisplayName: body.modelDisplayName }),
    ...(body.deliveryMode === undefined
      ? {}
      : { deliveryMode: body.deliveryMode }),
  });
  return {
    ok: true,
    projectId: context.projectId,
    documentId: context.documentId,
    draft,
  };
}

async function autosaveConflictCandidate(sourcePath) {
  const workspace = await projectFileWorkspaceForSource(sourcePath);
  if (!workspace) throw projectNotFoundError();
  return { ok: true };
}

async function resolveConflict(body) {
  const action = String(body.action || body.resolution || "");
  if (action === "force-unlock") {
    try {
      const unlocked = await projectFileRepository.forceUnlockWorkingCopy({
        sourcePath: requiredSourcePath(body.sourcePath),
      });
      return { ok: true, ...unlocked };
    } catch (cause) {
      throw projectFileHttpError(cause);
    }
  }
  const workspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!workspace) throw projectNotFoundError();
  throw new HttpError(
    404,
    "CONFLICT_NOT_FOUND",
    "No conflict exists for this v4 project.",
  );
}

async function sourcePreview(sourcePath) {
  const source = await inspectSourceFile(sourcePath, { requireComplete: true });
  return {
    ok: true,
    content: source.html,
    sha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    size: source.information.size,
  };
}

async function sourceStat(sourcePath) {
  const source = await inspectSourceFile(sourcePath, { requireComplete: false });
  return {
    ok: true,
    sha256: source.sha256,
    lastModifiedAt: source.lastModifiedAt,
    size: source.information.size,
  };
}

async function inspectProjectFile(sourcePath, relativePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  const normalized = cleanText(relativePath, 500).replaceAll("\\", "/");
  if (normalized !== "PROJECT.md") {
    throw new HttpError(
      403,
      "PROJECT_FILE_NOT_INSPECTABLE",
      "The requested project file is not available in the read-only inspector.",
    );
  }
  return {
    ...await projectFileGet(sourcePath),
    readOnly: false,
  };
}

async function projectFileGet(sourcePath) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  try {
    const notes = await projectFileRepository.readProjectNotes({
      target: projectFileTargetFromWorkspace(projectFileWorkspace),
    });
    return {
      ok: true,
      projectId: notes.projectId,
      documentId: notes.documentId,
      sourcePath: projectFileWorkspace.target.exactSourcePath,
      content: notes.content,
      sha256: notes.sha256,
      updatedAt: notes.updatedAt,
      path: notes.path,
      relativePath: "PROJECT.md",
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function projectFileUpdate(body) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  if (!projectFileBodyIdentityMatches(projectFileWorkspace, body)) {
    throw new HttpError(
      409,
      "PROJECT_CONTEXT_IDENTITY_MISMATCH",
      "The project file identity does not match the selected project.",
    );
  }
  try {
    const notes = await projectFileRepository.updateProjectNotes({
      target: projectFileTargetFromWorkspace(projectFileWorkspace),
      content: body.content,
    });
    return {
      ok: true,
      updated: notes.updated,
      projectId: notes.projectId,
      documentId: notes.documentId,
      content: notes.content,
      sha256: notes.sha256,
      path: notes.path,
      relativePath: "PROJECT.md",
    };
  } catch (cause) {
    throw projectFileHttpError(cause);
  }
}

async function openProjectFolder(body) {
  const projectFileWorkspace = await projectFileWorkspaceForSource(body.sourcePath);
  if (!projectFileWorkspace) throw projectNotFoundError();
  const projectRoot = projectFileWorkspace.target.projectRootPath;
  if (process.platform !== "darwin") {
    throw new HttpError(
      501,
      "PLATFORM_NOT_SUPPORTED",
      "Opening Finder is only supported on macOS.",
    );
  }
  await execFileAsync("open", [projectRoot]);
  return { ok: true, path: projectRoot };
}
async function readBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("object required");
    }
    return parsed;
  } catch {
    throw new HttpError(
      400,
      "INVALID_JSON",
      "Request body must be a JSON object.",
    );
  }
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === "null" && process.env.HTML_AI_ALLOW_FILE_ORIGIN === "1") {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!originAllowed(origin)) {
    throw new HttpError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "Only localhost origins may call this bridge.",
    );
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-HTML-AI-Bridge-Token",
  );
}

function requireBridgeAuthorization(request) {
  if (!BRIDGE_AUTH_TOKEN) return;
  const suppliedHeader = request.headers["x-html-ai-bridge-token"];
  const suppliedToken =
    typeof suppliedHeader === "string"
      ? suppliedHeader
      : Array.isArray(suppliedHeader)
        ? suppliedHeader[0] ?? ""
        : "";
  const expectedDigest = Buffer.from(sha256Hex(BRIDGE_AUTH_TOKEN), "hex");
  const suppliedDigest = Buffer.from(sha256Hex(suppliedToken), "hex");
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "A valid workspace bridge token is required.",
    );
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendBinary(response, status, buffer, fileName) {
  const asciiName = safeAttachmentFileName(fileName).replace(/[^\x20-\x7e]/g, "_");
  response.writeHead(status, {
    "Content-Type": "application/octet-stream",
    "Content-Length": buffer.byteLength,
    "Content-Disposition": `inline; filename="${asciiName.replaceAll('"', "")}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(buffer);
}

function normalizeError(error) {
  if (error instanceof LifecycleError) {
    return {
      status: error.status ?? 422,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error.",
      },
    },
  };
}

function requiredSourcePath(value) {
  if (!value) {
    throw new HttpError(
      400,
      "SOURCE_PATH_REQUIRED",
      "sourcePath is required.",
    );
  }
  return value;
}

async function route(request, response) {
  applyCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  requireBridgeAuthorization(request);
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: SERVICE_NAME,
      host: HOST,
      port: PORT,
      workspace: WORKSPACE_ROOT,
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/workspace") {
    const split = url.searchParams.get("shape") === "core-supplemental";
    sendJson(
      response,
      200,
      await workspaceState(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        {
          operationId: url.searchParams.get("operationId") || "",
          split,
        },
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source") {
    sendJson(
      response,
      200,
      await sourceFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source-preview") {
    sendJson(
      response,
      200,
      await sourcePreview(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/source-stat") {
    sendJson(
      response,
      200,
      await sourceStat(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/registered-project/restore-working-copy") {
    const body = await readBody(request);
    try {
      sendJson(response, 200, await projectFileRepository.restoreRegisteredWorkingCopy({ projectId: registeredProjectId(body.projectId) }));
    } catch (cause) { throw projectFileHttpError(cause); }
    return;
  }
  if (request.method === "GET" && url.pathname === "/registered-projects") {
    sendJson(response, 200, await registeredProjectCatalog());
    return;
  }
  if (request.method === "GET" && url.pathname === "/registered-project/versions") {
    sendJson(
      response,
      200,
      await registeredProjectVersionSummaries(url.searchParams.get("projectId")),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/registered-project/open") {
    sendJson(
      response,
      200,
      await registeredProjectOpen(url.searchParams.get("projectId"), url.searchParams.get("workingCopyId")),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/managed-working-copy/reconcile") {
    const body = await readBody(request);
    sendJson(response, 200, await reconcileManagedWorkingCopy(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/project/ensure") {
    const body = await readBody(request);
    sendJson(response, 200, await ensureProject(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/project/open-classification") {
    const body = await readBody(request);
    sendJson(response, 200, await classifyOpenPath(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/conflict-candidate") {
    sendJson(
      response,
      200,
      await autosaveConflictCandidate(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/autosave") {
    if (
      process.env.PAGEROOT_E2E === "1"
      && process.env.PAGEROOT_E2E_AUTOSAVE_FAILURE === "1"
    ) {
      await readBody(request);
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "E2E_AUTOSAVE_FAILED",
          message: "E2E injected a permanent autosave failure.",
        },
      });
      return;
    }
    const body = await readBody(request);
    sendJson(response, 200, await saveAutosave(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/conversation") {
    sendJson(
      response,
      200,
      await currentConversation(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/conversation/list") {
    sendJson(
      response,
      200,
      await documentConversations(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/conversation/draft") {
    const body = await readBody(request);
    sendJson(response, 200, await saveConversationDraft(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/version") {
    throw new HttpError(
      410,
      "LOCAL_VERSIONING_REMOVED",
      "Manual save no longer creates a Version; use /autosave.",
    );
  }
  if (request.method === "POST" && url.pathname === "/draft") {
    const body = await readBody(request);
    sendJson(response, 200, await saveDraft(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/attachment") {
    const body = await readBody(request);
    sendJson(response, 201, await saveDraftAttachment(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/attachment") {
    const attachment = await readAttachment(
      requiredSourcePath(url.searchParams.get("sourcePath")),
      url.searchParams.get("relativePath"),
    );
    sendBinary(response, 200, attachment.buffer, attachment.fileName);
    return;
  }
  if (request.method === "POST" && url.pathname === "/attachment/delete") {
    const body = await readBody(request);
    sendJson(response, 200, await deleteDraftAttachment(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/agent/availability") {
    sendJson(response, 200, await agentAvailability(url.searchParams.get("selection")));
    return;
  }
  if (request.method === "GET" && url.pathname === "/agent/diagnose") {
    sendJson(response, 200, await agentDiagnose(url.searchParams.get("selection")));
    return;
  }
  if (request.method === "GET" && url.pathname === "/agent/providers") {
    sendJson(response, 200, await agentProviders());
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/install") {
    const body = await readBody(request);
    sendJson(response, 202, await installAgent(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/install/cancel") {
    const body = await readBody(request);
    sendJson(response, 200, await cancelAgentInstall(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/login") {
    const body = await readBody(request);
    sendJson(response, 202, await loginAgent(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/login/cancel") {
    const body = await readBody(request);
    sendJson(response, 200, await cancelAgentLogin(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/logout") {
    const body = await readBody(request);
    sendJson(response, 200, await logoutAgent(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/agent/login/url") {
    sendJson(response, 200, await agentLoginUrl(url.searchParams.get("providerId")));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/session-credential") {
    const body = await readBody(request);
    sendJson(response, 200, await setAgentSessionCredential(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/configuration") {
    const body = await readBody(request);
    sendJson(response, 200, await updateAgentConfiguration(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/configuration/cancel") {
    const body = await readBody(request);
    sendJson(response, 200, await cancelAgentConfiguration(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/preflight") {
    const body = await readBody(request);
    sendJson(response, 200, await preflightAgent(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/start") {
    const body = await readBody(request);
    sendJson(response, 202, await startAgent(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/agent/status") {
    sendJson(
      response,
      200,
      await statusFor(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        url.searchParams.get("requestId"),
        url.searchParams.get("attemptId") || "attempt_001",
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/agent/cancel") {
    const body = await readBody(request);
    sendJson(response, 200, await cancelActiveRun(body));
    return;
  }
  if (request.method === "POST" && ["/submission", "/submission/finish"].includes(url.pathname)) {
    const body = await readBody(request);
    const target = await requireEditableProjectFileTarget(body);
    const receipt = url.pathname === "/submission"
      ? await projectFileRepository.recordSubmission({ target, operationId: body.submissionOperationId, input: body })
      : await projectFileRepository.finishSubmission({ target, operationId: body.submissionOperationId,
        status: "not-started", errorCode: body.errorCode });
    sendJson(response, 200, { ok: true, operationId: receipt.operationId,
      turnId: receipt.turnId, requestId: receipt.requestId, status: receipt.status });
    return;
  }
  if (request.method === "POST" && url.pathname === "/request") {
    const body = await readBody(request);
    sendJson(response, 201, await createRequest(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/status") {
    const sourcePath = requiredSourcePath(url.searchParams.get("sourcePath"));
    const requestId = url.searchParams.get("requestId");
    if (!requestId) {
      throw new HttpError(
        400,
        "REQUEST_ID_REQUIRED",
        "requestId is required.",
      );
    }
    sendJson(
      response,
      200,
      await statusFor(
        sourcePath,
        requestId,
        url.searchParams.get("attemptId") ?? "attempt_001",
      ),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/ready-version/activate"
  ) {
    const body = await readBody(request);
    sendJson(response, 200, await activateReadyVersion(body));
    return;
  }
  if (request.method === "POST" && ["/history-version/create", "/history-version/result", "/history-version/opened"].includes(url.pathname)) {
    const body = await readBody(request);
    sendJson(response, 200, await projectFileHistoryCreation(body,
      url.pathname === "/history-version/create" ? "create" : url.pathname === "/history-version/opened" ? "opened" : "result"));
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/history-version/continue"
  ) {
    const body = await readBody(request);
    sendJson(
      response,
      200,
      requireFound(await continueProjectFileHistoryVersion(body)),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/history-version/desktop-confirmed"
  ) {
    const body = await readBody(request);
    sendJson(
      response,
      200,
      requireFound(await confirmProjectFileHistoryVersion(body)),
    );
    return;
  }
  if (
    request.method === "POST"
    && url.pathname === "/active-run/cancel"
  ) {
    const body = await readBody(request);
    sendJson(response, 200, await cancelActiveRun(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/conflict/resolve") {
    const body = await readBody(request);
    sendJson(response, 200, await resolveConflict(body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/version-file") {
    sendJson(
      response,
      200,
      await versionFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        url.searchParams.get("versionId"),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/ai-task") {
    sendJson(
      response,
      200,
      requireFound(await projectFileAiTask(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      )),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/project-file") {
    sendJson(
      response,
      200,
      await projectFileGet(
        requiredSourcePath(url.searchParams.get("sourcePath")),
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/file") {
    sendJson(
      response,
      200,
      await inspectProjectFile(
        requiredSourcePath(url.searchParams.get("sourcePath")),
        url.searchParams.get("path"),
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/project-file") {
    const body = await readBody(request);
    sendJson(response, 200, await projectFileUpdate(body));
    return;
  }
  if (request.method === "POST" && url.pathname === "/open-folder") {
    const body = await readBody(request);
    sendJson(response, 200, await openProjectFolder(body));
    return;
  }
  throw new HttpError(404, "NOT_FOUND", "Endpoint was not found.");
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    const normalized = normalizeError(error);
    if (!response.headersSent) {
      try {
        applyCors(request, response);
      } catch {
        // The normalized error is sufficient.
      }
      sendJson(response, normalized.status, normalized.body);
    } else {
      response.destroy();
    }
  });
});

server.on("error", (error) => {
  process.stderr.write(
    `${JSON.stringify({
      type: "fatal",
      error: {
        code: error?.code ?? "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Server failed.",
      },
    })}\n`,
  );
  process.exitCode = 1;
});

if (RUNTIME_CHANNEL === "preview") {
  // Preview is a fully isolated environment. Its project repository and
  // workspace root must be ready before the Bridge advertises readiness; a
  // failure must not fall back to the formal PageRoot directory.
  try {
    await Promise.all([
      ensureDirectory(WORKSPACE_ROOT),
      projectFileRepository.initialize(),
    ]);
  } catch (cause) {
    process.stderr.write(`${JSON.stringify({
      type: "fatal",
      error: {
        code: cause?.code || "PROJECT_REPOSITORY_INITIALIZATION_FAILED",
        message: cause instanceof Error ? cause.message : "Project initialization failed.",
      },
    })}\n`);
    process.exit(1);
  }
} else {
  // Stable, source and test callers retain the pre-isolation behavior: the
  // Bridge can report readiness while an unavailable project repository is
  // recorded as a warning and handled by its existing request-time guards.
  void projectFileRepository.initialize().catch((cause) => {
    process.stderr.write(`${JSON.stringify({
      type: "warning",
      code: "PROJECT_REPOSITORY_INITIALIZATION_FAILED",
      message: cause instanceof Error ? cause.message : "Project initialization failed.",
    })}\n`);
  });
}

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      service: SERVICE_NAME,
      host: HOST,
      port: PORT,
      workspace: WORKSPACE_ROOT,
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    })}\n`,
  );
});

let shuttingDown = false;
async function shutdownBridge() {
  if (shuttingDown) return;
  shuttingDown = true;
  const accepted = await closeWorkspaceBridgeAfterAgentCleanup({
    agentBridgeService,
    closeServer: (onClosed) => {
      server.close(onClosed);
      // Main reaches this signal only after renderer writes are drained and
      // Agent cleanup is confirmed. Retire any idle/poll connection now so the
      // Bridge exit is bounded inside the desktop's longer shutdown deadline.
      server.closeAllConnections?.();
    },
    exitProcess: (code) => process.exit(code),
    writeDiagnostic: (line) => process.stderr.write(line),
  });
  if (!accepted) shuttingDown = false;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdownBridge());
}
