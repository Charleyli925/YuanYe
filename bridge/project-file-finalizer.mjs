import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  requireCompleteHtml,
  sha256,
} from "./lifecycle-core.mjs";
import { prepareCandidateSourceIdentity } from "./project-file-repository/candidate-identity.mjs";
import { PROJECT_FILE_SCHEMA_VERSION } from "./project-file-repository.mjs";

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const FROZEN_REQUEST_FILES = Object.freeze([
  ["PROMPT.md", "prompt"],
  ["input/AI_RULES.md", "policy"],
  ["change-request.json", "change-request"],
  ["input/PROJECT.md", "project-rules"],
  ["input/annotations/records.json", "annotations"],
]);

export class ProjectFileFinalizerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectFileFinalizerError";
    this.code = code;
    this.details = details;
  }
}

function safeId(value, label) {
  const id = String(value || "");
  if (!SAFE_ID.test(id)) {
    throw new ProjectFileFinalizerError("INVALID_ID", `${label} is invalid.`);
  }
  return id;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || "")).normalize("NFC");
  if (process.platform === "darwin") {
    if (resolved === "/private/var" || resolved.startsWith("/private/var/")) {
      return resolved.slice("/private".length);
    }
    if (resolved === "/private/tmp" || resolved.startsWith("/private/tmp/")) {
      return resolved.slice("/private".length);
    }
  }
  return resolved;
}

function inside(root, candidate, { allowRoot = false } = {}) {
  const resolvedRoot = normalizedPath(root);
  const resolvedCandidate = normalizedPath(candidate);
  const comparableRoot = process.platform === "darwin" || process.platform === "win32"
    ? resolvedRoot.toLocaleLowerCase("en-US")
    : resolvedRoot;
  const comparableCandidate = process.platform === "darwin" || process.platform === "win32"
    ? resolvedCandidate.toLocaleLowerCase("en-US")
    : resolvedCandidate;
  if (allowRoot && comparableCandidate === comparableRoot) return true;
  const prefix = comparableRoot.endsWith(path.sep)
    ? comparableRoot
    : `${comparableRoot}${path.sep}`;
  return comparableCandidate.startsWith(prefix);
}

function samePath(left, right) {
  const first = normalizedPath(left);
  const second = normalizedPath(right);
  if (process.platform === "darwin" || process.platform === "win32") {
    return first.toLocaleLowerCase("en-US") === second.toLocaleLowerCase("en-US");
  }
  return first === second;
}

function safeRelativePath(value, label) {
  const relative = String(value || "");
  const segments = relative.split("/");
  if (
    !relative
    || path.isAbsolute(relative)
    || relative.includes("\0")
    || relative.includes("\\")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      `${label} is not a safe Request-relative path.`,
    );
  }
  return relative;
}

function pathInside(root, relativePath, label) {
  const relative = safeRelativePath(relativePath, label);
  const candidate = path.join(root, ...relative.split("/"));
  if (!inside(root, candidate)) {
    throw new ProjectFileFinalizerError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its Request.`,
    );
  }
  return candidate;
}

function requestRelativePath(requestId, value, label) {
  const prefix = `requests/${requestId}/`;
  const relative = safeRelativePath(value, label);
  if (!relative.startsWith(prefix)) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PATH_MISMATCH",
      `${label} is not owned by this Request.`,
    );
  }
  return relative.slice(prefix.length);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function copyFileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

function validFileIdentity(value) {
  return Boolean(
    value
    && typeof value === "object"
    && String(value.device || "")
    && String(value.inode || "")
    && Number.isFinite(Number(value.birthtimeMs))
    && Number(value.birthtimeMs) >= 0,
  );
}

function sameFileIdentity(left, right) {
  return Boolean(
    validFileIdentity(left)
    && validFileIdentity(right)
    && String(left.device) !== "0"
    && String(left.device) === String(right.device)
    && String(left.inode) !== "0"
    && String(left.inode) === String(right.inode)
    && (
      !Number(left.birthtimeMs)
      || !Number(right.birthtimeMs)
      || Number(left.birthtimeMs) === Number(right.birthtimeMs)
    ),
  );
}

async function regularFile(filePath, label, { projectRoot = null } = {}) {
  if (projectRoot) {
    const checked = await assertRealPathInsideProject(
      projectRoot,
      filePath,
      label,
      { expectedKind: "file" },
    );
    return checked.information;
  }
  let information;
  try {
    information = await lstat(filePath);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new ProjectFileFinalizerError("FILE_NOT_FOUND", `${label} was not found.`);
    }
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new ProjectFileFinalizerError("UNSAFE_FILE", `${label} must be a regular file.`);
  }
  return information;
}

async function regularDirectory(directoryPath, label, { projectRoot = null } = {}) {
  if (projectRoot) {
    const checked = await assertRealPathInsideProject(
      projectRoot,
      directoryPath,
      label,
      { expectedKind: "directory" },
    );
    return checked.information;
  }
  let information;
  try {
    information = await lstat(directoryPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new ProjectFileFinalizerError("DIRECTORY_NOT_FOUND", `${label} was not found.`);
    }
    throw cause;
  }
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new ProjectFileFinalizerError("UNSAFE_DIRECTORY", `${label} must be a real directory.`);
  }
  return information;
}

async function readJson(filePath, label, options = {}) {
  await regularFile(filePath, label, options);
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (cause) {
    if (cause instanceof ProjectFileFinalizerError) throw cause;
    throw new ProjectFileFinalizerError("INVALID_JSON", `${label} is not valid JSON.`);
  }
}

// The finalizer receives an Agent-writable Request / Attempt path. A lexical
// containment check is not enough: an Agent could replace `attempts/<id>`
// (or any other ancestor) with a symbolic link and redirect a later read or
// completion write outside the registered Project. Revalidate every existing
// component against the real project root immediately before access.
async function assertRealPathInsideProject(root, candidate, label, {
  allowMissing = false,
  expectedKind = null,
} = {}) {
  const projectRoot = normalizedPath(root);
  const target = normalizedPath(candidate);
  if (!inside(projectRoot, target, { allowRoot: true })) {
    throw new ProjectFileFinalizerError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its project.`,
    );
  }
  let rootInformation;
  try {
    rootInformation = await lstat(projectRoot);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new ProjectFileFinalizerError(
        "DIRECTORY_NOT_FOUND",
        "The project root was not found.",
      );
    }
    throw cause;
  }
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw new ProjectFileFinalizerError(
      "UNSAFE_DIRECTORY",
      "The project root must be a real directory.",
    );
  }
  const realRoot = normalizedPath(await realpath(projectRoot));
  const relative = path.relative(projectRoot, target);
  const parts = relative === "" ? [] : relative.split(path.sep);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ProjectFileFinalizerError(
      "PATH_ESCAPES_PROJECT",
      `${label} escapes its project.`,
    );
  }

  let current = projectRoot;
  let information = rootInformation;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      information = await lstat(current);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
      if (!allowMissing) {
        throw new ProjectFileFinalizerError(
          expectedKind === "directory" ? "DIRECTORY_NOT_FOUND" : "FILE_NOT_FOUND",
          `${label} was not found.`,
        );
      }
      const parentRealPath = normalizedPath(await realpath(path.dirname(current)));
      if (!inside(realRoot, parentRealPath, { allowRoot: true })) {
        throw new ProjectFileFinalizerError(
          "PATH_ESCAPES_PROJECT",
          `${label} escapes its project through an unsafe parent.`,
        );
      }
      return { exists: false, path: target, information: null };
    }
    if (information.isSymbolicLink()) {
      throw new ProjectFileFinalizerError(
        "PATH_ESCAPES_PROJECT",
        `${label} reaches a symbolic link inside its project.`,
      );
    }
    if (index < parts.length - 1 && !information.isDirectory()) {
      throw new ProjectFileFinalizerError(
        "UNSAFE_DIRECTORY",
        `${label} has a non-directory parent.`,
      );
    }
    const realCurrent = normalizedPath(await realpath(current));
    if (!inside(realRoot, realCurrent, { allowRoot: true })) {
      throw new ProjectFileFinalizerError(
        "PATH_ESCAPES_PROJECT",
        `${label} escapes its project through an unsafe path.`,
      );
    }
  }
  if (expectedKind === "file" && !information.isFile()) {
    throw new ProjectFileFinalizerError("UNSAFE_FILE", `${label} must be a regular file.`);
  }
  if (expectedKind === "directory" && !information.isDirectory()) {
    throw new ProjectFileFinalizerError("UNSAFE_DIRECTORY", `${label} must be a real directory.`);
  }
  return { exists: true, path: target, information };
}

function validateRequest(record, { requestId, attemptId }) {
  const required = [
    "projectId",
    "documentId",
    "candidateId",
    "expectedSourceSha256",
    "proposedVersionId",
    "proposedVersionOrdinal",
    "basedOnVersionId",
    "previousVersionId",
    "sourceWorkingCopyId",
    "inputRelativePath",
    "inputManifestRelativePath",
    "inputManifestSha256",
    "outputRelativePath",
  ];
  if (
    record.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || record.requestId !== requestId
    || record.attemptId !== attemptId
    || required.some((key) => record[key] === undefined || record[key] === null)
    || !SHA256.test(String(record.expectedSourceSha256))
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_IDENTITY_MISMATCH",
      "The Request is not a valid frozen PageRoot project-file Request.",
    );
  }
  const expectedInput = `requests/${requestId}/input/base/index.html`;
  const expectedInputManifest = `requests/${requestId}/input-manifest.json`;
  const expectedOutput = `requests/${requestId}/attempts/${attemptId}/output/candidate.html`;
  if (
    record.inputRelativePath !== expectedInput
    || record.inputManifestRelativePath !== expectedInputManifest
    || record.outputRelativePath !== expectedOutput
    || !SHA256.test(String(record.inputManifestSha256))
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PATH_MISMATCH",
      "The Request output path is not the one frozen for this Attempt.",
    );
  }
  return record;
}

function assertRequestAnchor({ record, identity, manifest, runtime }) {
  const workingCopies = Array.isArray(manifest?.workingCopies) ? manifest.workingCopies : [];
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  const workingCopy = workingCopies.find((candidate) => (
    candidate?.workingCopyId === record.sourceWorkingCopyId
  ));
  const latestVersion = versions.find((candidate) => (
    candidate?.versionId === manifest?.latestOfficialVersionId
  ));
  const expectedOrdinal = Number(latestVersion?.ordinal) + 1;
  const expectedVersionId = `ver_${String(expectedOrdinal).padStart(4, "0")}`;
  const expectedCandidateId = `candidate_${sha256(
    Buffer.from(`${identity.projectId}:${record.requestId}`, "utf8"),
  ).slice("sha256:".length, "sha256:".length + 32)}`;
  const activeRequest = runtime?.activeRequest;
  const activeMatches = Boolean(
    activeRequest
    && activeRequest.requestId === record.requestId
    && activeRequest.attemptId === record.attemptId
    && (
      (
        activeRequest.status === "processing"
        && activeRequest.candidateId === null
        && activeRequest.candidateOutputSha256 === null
        && activeRequest.candidateRecordSha256 === null
      )
      || (
        activeRequest.status === "pending-review"
        && activeRequest.candidateId === record.candidateId
        && runtime.activeCandidateId === record.candidateId
        && SHA256.test(String(activeRequest.candidateOutputSha256 || ""))
        && SHA256.test(String(activeRequest.candidateRecordSha256 || ""))
      )
    ),
  );
  if (
    manifest?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || manifest?.projectId !== identity.projectId
    || manifest?.documentId !== identity.documentId
    || !workingCopy
    || workingCopy.basedOnVersionId !== record.basedOnVersionId
    || !latestVersion
    || record.previousVersionId !== latestVersion.versionId
    || record.proposedVersionOrdinal !== expectedOrdinal
    || record.proposedVersionId !== expectedVersionId
    || record.candidateId !== expectedCandidateId
    || runtime?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || runtime?.projectId !== identity.projectId
    || runtime?.documentId !== identity.documentId
    || !activeMatches
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_IDENTITY_MISMATCH",
      "The Request no longer matches the registered project's frozen identity.",
    );
  }
  if (activeRequest.inputManifestSha256 !== record.inputManifestSha256) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest no longer matches runtime authority.",
    );
  }
  return activeRequest.inputManifestSha256;
}

async function assertCandidateRuntimeAuthority({
  projectRoot,
  controlRoot,
  identity,
  record,
  runtime,
}) {
  const activeRequest = runtime?.activeRequest;
  if (activeRequest?.status !== "pending-review") return;
  const candidatePath = path.join(controlRoot, "requests", record.requestId, "candidate.json");
  await regularFile(candidatePath, "Candidate record", { projectRoot });
  const candidateBuffer = await readFile(candidatePath);
  let candidate;
  try {
    candidate = JSON.parse(candidateBuffer.toString("utf8"));
  } catch {
    throw new ProjectFileFinalizerError(
      "CANDIDATE_AUTHORITY_MISMATCH",
      "The runtime-sealed Candidate record is not valid JSON.",
    );
  }
  const expectedOutputRelativePath = `requests/${record.requestId}/candidate.html`;
  const outputPath = path.join(controlRoot, "requests", record.requestId, "candidate.html");
  await regularFile(outputPath, "Candidate output", { projectRoot });
  const output = await readFile(outputPath);
  if (
    !isObject(candidate)
    || candidate.candidateId !== record.candidateId
    || candidate.projectId !== identity.projectId
    || candidate.documentId !== identity.documentId
    || candidate.requestId !== record.requestId
    || candidate.attemptId !== record.attemptId
    || candidate.status !== "pending-review"
    || candidate.outputRelativePath !== expectedOutputRelativePath
    || candidate.outputSha256 !== sha256(output)
    || activeRequest.candidateOutputSha256 !== sha256(output)
    || activeRequest.candidateRecordSha256 !== sha256(candidateBuffer)
  ) {
    throw new ProjectFileFinalizerError(
      "CANDIDATE_AUTHORITY_MISMATCH",
      "The pending-review Candidate no longer matches runtime authority.",
    );
  }
}

async function verifyFrozenRequestBundle({
  projectRoot,
  requestRoot,
  record,
  identity,
  expectedInputManifestSha256,
}) {
  const manifestRelativePath = requestRelativePath(
    record.requestId,
    record.inputManifestRelativePath,
    "input manifest path",
  );
  const manifestPath = pathInside(requestRoot, manifestRelativePath, "input manifest path");
  await regularFile(manifestPath, "Frozen Request input manifest", { projectRoot });
  const manifestBuffer = await readFile(manifestPath);
  if (sha256(manifestBuffer) !== expectedInputManifestSha256) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest changed after submission.",
    );
  }

  let inputManifest;
  try {
    inputManifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest is not valid JSON.",
    );
  }
  if (
    !isObject(inputManifest)
    || inputManifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || inputManifest.projectId !== identity.projectId
    || inputManifest.documentId !== identity.documentId
    || inputManifest.requestId !== record.requestId
    || inputManifest.attemptId !== record.attemptId
    || inputManifest.frozen !== true
    || !Array.isArray(inputManifest.readOrder)
    || !Array.isArray(inputManifest.files)
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen Request input manifest no longer describes this Request.",
    );
  }

  const files = new Map();
  for (const entry of inputManifest.files) {
    if (
      !isObject(entry)
      || typeof entry.role !== "string"
      || typeof entry.mediaType !== "string"
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 0
      || !SHA256.test(String(entry.sha256))
    ) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest contains an invalid file record.",
      );
    }
    const relativePath = safeRelativePath(entry.path, "frozen input path");
    if (files.has(relativePath)) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest contains a duplicate file path.",
      );
    }
    const filePath = pathInside(requestRoot, relativePath, "frozen input path");
    await regularFile(filePath, `Frozen Request input ${relativePath}`, { projectRoot });
    const buffer = await readFile(filePath);
    if (buffer.byteLength !== entry.byteLength || sha256(buffer) !== entry.sha256) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        `Frozen Request input ${relativePath} changed after submission.`,
      );
    }
    files.set(relativePath, { entry, buffer });
  }

  const readOrder = new Set();
  for (const value of inputManifest.readOrder) {
    const relativePath = safeRelativePath(value, "frozen input readOrder path");
    if (readOrder.has(relativePath) || !files.has(relativePath)) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input read order is inconsistent with its inventory.",
      );
    }
    readOrder.add(relativePath);
  }

  const expectedInput = requestRelativePath(
    record.requestId,
    record.inputRelativePath,
    "frozen HTML path",
  );
  for (const [relativePath, role] of [
    ...FROZEN_REQUEST_FILES,
    [expectedInput, "base-html"],
  ]) {
    const frozen = files.get(relativePath);
    if (!frozen || frozen.entry.role !== role) {
      throw new ProjectFileFinalizerError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        `The frozen Request is missing its required ${role} input.`,
      );
    }
  }

  let changeRequest;
  try {
    changeRequest = JSON.parse(files.get("change-request.json").buffer.toString("utf8"));
  } catch {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "The frozen change request is not valid JSON.",
    );
  }
  const immutableKeys = [
    "projectId",
    "documentId",
    "requestId",
    "attemptId",
    "sourceWorkingCopyId",
    "expectedSourceSha256",
    "proposedVersionId",
    "proposedVersionOrdinal",
    "basedOnVersionId",
    "previousVersionId",
  ];
  const taskSpec = record.request?.taskSpec;
  const frozenRequirements = taskSpec || record.request || {};
  if (
    !isObject(changeRequest)
    || immutableKeys.some((key) => changeRequest[key] !== record[key])
    || (
      taskSpec
      && (
        changeRequest.policyVersion !== record.policyVersion
        || changeRequest.promptTemplateVersion !== record.promptTemplateVersion
      )
    )
    || canonicalJson(changeRequest.requirements) !== canonicalJson(frozenRequirements)
  ) {
    throw new ProjectFileFinalizerError(
      "FROZEN_REQUEST_BUNDLE_MISMATCH",
      "request.json no longer matches the frozen change request.",
    );
  }

  return files.get(expectedInput).buffer;
}

async function validateRegistryAuthority({
  projectRoot,
  projectsRoot,
  registryPath,
  identity,
}) {
  const configuredRoot = normalizedPath(projectsRoot || path.dirname(projectRoot));
  const expectedRegistryPath = normalizedPath(
    registryPath || path.join(configuredRoot, ".pageroot-registry.json"),
  );
  if (!samePath(path.dirname(projectRoot), configuredRoot)) {
    throw new ProjectFileFinalizerError(
      "UNREGISTERED_PROJECT_ROOT",
      "The finalizer only accepts a direct child of the configured PageRoot project directory.",
    );
  }
  await regularDirectory(configuredRoot, "configured project directory");
  const rootInformation = await regularDirectory(projectRoot, "project root", {
    projectRoot: configuredRoot,
  });
  const registry = await readJson(expectedRegistryPath, "project Registry", {
    projectRoot: configuredRoot,
  });
  const record = registry?.projects?.[identity.projectId];
  if (
    registry?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || !registry?.projects
    || !registry?.pendingImports
    || !record
    || typeof record !== "object"
    || !samePath(record.registeredProjectRootPath, projectRoot)
    || !validFileIdentity(record.rootFileIdentity)
  ) {
    throw new ProjectFileFinalizerError(
      "REGISTERED_PROJECT_UNAVAILABLE",
      "The project is not authorized by the v4 Registry for finalization.",
      { projectId: identity.projectId },
    );
  }
  const observedIdentity = copyFileIdentity(rootInformation);
  // A finalizer may repair the root inode clue after a verified return to the
  // exact registered path, but that write must happen only after every
  // Request, frozen-input, Candidate and completion validation has passed.
  // Keep this phase read-only so malformed Agent output never changes Registry
  // authority as a side effect of being inspected.
  return {
    configuredRoot,
    registryPath: expectedRegistryPath,
    projectRoot,
    projectId: identity.projectId,
    registeredRootFileIdentity: record.rootFileIdentity,
    observedRootFileIdentity: observedIdentity,
  };
}

async function refreshRegistryAuthority(authority) {
  if (sameFileIdentity(
    authority.registeredRootFileIdentity,
    authority.observedRootFileIdentity,
  )) return;
  const rootInformation = await regularDirectory(authority.projectRoot, "project root", {
    projectRoot: authority.configuredRoot,
  });
  const observed = copyFileIdentity(rootInformation);
  if (!sameFileIdentity(observed, authority.observedRootFileIdentity)) {
    throw new ProjectFileFinalizerError(
      "REGISTERED_PROJECT_RACE",
      "The project root changed while finalization was being verified.",
    );
  }
  const registry = await readJson(authority.registryPath, "project Registry", {
    projectRoot: authority.configuredRoot,
  });
  const record = registry?.projects?.[authority.projectId];
  if (
    registry?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || !registry?.projects
    || !registry?.pendingImports
    || !record
    || !samePath(record.registeredProjectRootPath, authority.projectRoot)
    || !validFileIdentity(record.rootFileIdentity)
  ) {
    throw new ProjectFileFinalizerError(
      "REGISTERED_PROJECT_UNAVAILABLE",
      "The project Registry changed while finalization was being completed.",
    );
  }
  if (sameFileIdentity(record.rootFileIdentity, observed)) return;
  if (!sameFileIdentity(record.rootFileIdentity, authority.registeredRootFileIdentity)) {
    throw new ProjectFileFinalizerError(
      "REGISTERED_PROJECT_RACE",
      "The Registry root authority changed while finalization was being completed.",
    );
  }
  const refreshedAt = new Date().toISOString();
  record.rootFileIdentity = observed;
  record.updatedAt = refreshedAt;
  registry.updatedAt = refreshedAt;
  await atomicWriteJson(authority.registryPath, registry);
}

async function assertCancellationAuthority({
  projectRoot,
  controlRoot,
  identity,
  record,
  requestId,
  attemptId,
}) {
  const authorityPath = path.join(
    controlRoot,
    "recovery",
    "cancellations",
    `${requestId}.${attemptId}.json`,
  );
  let authority;
  try {
    authority = await readJson(authorityPath, "request cancellation authority", {
      projectRoot,
    });
  } catch (cause) {
    if (cause instanceof ProjectFileFinalizerError && cause.code === "FILE_NOT_FOUND") {
      throw new ProjectFileFinalizerError(
        "CANCELLATION_AUTHORITY_MISMATCH",
        "The cancelled Request has no trusted cancellation authority outside its Request tree.",
      );
    }
    throw cause;
  }
  if (
    authority.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || authority.kind !== "request-cancellation"
    || authority.projectId !== identity.projectId
    || authority.documentId !== identity.documentId
    || authority.requestId !== requestId
    || authority.attemptId !== attemptId
    || authority.sourceWorkingCopyId !== record.sourceWorkingCopyId
    || authority.expectedSourceSha256 !== record.expectedSourceSha256
    || authority.inputManifestSha256 !== record.inputManifestSha256
    || typeof authority.cancelledAt !== "string"
    || Number.isNaN(Date.parse(authority.cancelledAt))
  ) {
    throw new ProjectFileFinalizerError(
      "CANCELLATION_AUTHORITY_MISMATCH",
      "The cancelled Request does not match its trusted cancellation authority.",
    );
  }
}

export async function finalizeProjectFileAttempt({
  projectRoot,
  projectsRoot = null,
  registryPath = null,
  requestId,
  attemptId = "attempt_001",
  testHooks = null,
} = {}) {
  const root = normalizedPath(projectRoot);
  const request = safeId(requestId, "requestId");
  const attempt = safeId(attemptId, "attemptId");
  await regularDirectory(root, "project root");
  const controlRoot = path.join(root, ".pageroot");
  await regularDirectory(controlRoot, ".pageroot", { projectRoot: root });
  const identity = await readJson(path.join(controlRoot, "project.json"), "project.json", {
    projectRoot: root,
  });
  if (identity.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileFinalizerError(
      "UNSUPPORTED_PROJECT_SCHEMA",
      "project.json is not a supported PageRoot project-file identity.",
    );
  }
  const registryAuthority = await validateRegistryAuthority({
    projectRoot: root,
    projectsRoot,
    registryPath,
    identity,
  });
  const requestRoot = path.join(controlRoot, "requests", request);
  await regularDirectory(requestRoot, "Request root", { projectRoot: root });
  const record = validateRequest(
    await readJson(path.join(requestRoot, "request.json"), "request.json", {
      projectRoot: root,
    }),
    { requestId: request, attemptId: attempt },
  );
  if (
    record.projectId !== identity.projectId
    || record.documentId !== identity.documentId
  ) {
    throw new ProjectFileFinalizerError(
      "REQUEST_PROJECT_MISMATCH",
      "The Request does not belong to this project identity.",
    );
  }
  // Cancellation is a terminal user decision. A late AI finalizer must be
  // able to acknowledge it without creating completion evidence or trying to
  // re-establish the now-cleared active Request runtime anchor.
  if (record.status === "cancelled") {
    await assertCancellationAuthority({
      projectRoot: root,
      controlRoot,
      identity,
      record,
      requestId: request,
      attemptId: attempt,
    });
    return {
      ok: true,
      status: "cancelled",
      accepted: false,
      retryable: false,
      message: "本轮已在源页结束。请停止 AI Agent，不要重试。",
    };
  }
  const [manifest, runtime] = await Promise.all([
    readJson(path.join(controlRoot, "manifest.json"), "manifest.json", { projectRoot: root }),
    readJson(path.join(controlRoot, "runtime-state.json"), "runtime-state.json", { projectRoot: root }),
  ]);
  const inputManifestSha256 = assertRequestAnchor({ record, identity, manifest, runtime });
  await assertCandidateRuntimeAuthority({
    projectRoot: root,
    controlRoot,
    identity,
    record,
    runtime,
  });
  const inputPath = path.join(controlRoot, ...record.inputRelativePath.split("/"));
  const outputPath = path.join(controlRoot, ...record.outputRelativePath.split("/"));
  if (!inside(controlRoot, inputPath) || !inside(controlRoot, outputPath)) {
    throw new ProjectFileFinalizerError("PATH_ESCAPES_PROJECT", "A frozen Request path escapes its project.");
  }
  const input = await verifyFrozenRequestBundle({
    projectRoot: root,
    requestRoot,
    record,
    identity,
    expectedInputManifestSha256: inputManifestSha256,
  });
  if (sha256(input) !== record.expectedSourceSha256) {
    throw new ProjectFileFinalizerError(
      "FROZEN_INPUT_HASH_MISMATCH",
      "The frozen Request input changed after submission.",
    );
  }
  const outputInfo = await regularFile(outputPath, "Candidate output", { projectRoot: root });
  if (outputInfo.size > MAX_HTML_BYTES) {
    throw new ProjectFileFinalizerError("OUTPUT_TOO_LARGE", "Candidate output is too large.");
  }
  if (typeof testHooks?.afterCandidateOutputStat === "function") {
    await testHooks.afterCandidateOutputStat({ outputPath, outputInfo });
  }
  const output = await readFile(outputPath);
  if (output.byteLength > MAX_HTML_BYTES) {
    throw new ProjectFileFinalizerError("OUTPUT_TOO_LARGE", "Candidate output is too large.");
  }
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
  } catch {
    throw new ProjectFileFinalizerError("UNSUPPORTED_HTML_ENCODING", "Candidate output must be valid UTF-8.");
  }
  try {
    requireCompleteHtml(html, "Candidate output");
  } catch (cause) {
    throw new ProjectFileFinalizerError(
      "INCOMPLETE_HTML",
      cause instanceof Error ? cause.message : "Candidate output is incomplete.",
    );
  }
  // A rejected Candidate must never acquire completion evidence, including manual agents.
  prepareCandidateSourceIdentity(input.toString("utf8"), html);
  const outputSha256 = sha256(output);
  const completion = {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    kind: "candidate-finalization",
    projectId: identity.projectId,
    documentId: identity.documentId,
    requestId: request,
    attemptId: attempt,
    candidateId: record.candidateId,
    proposedVersionId: record.proposedVersionId,
    proposedVersionOrdinal: record.proposedVersionOrdinal,
    basedOnVersionId: record.basedOnVersionId,
    previousVersionId: record.previousVersionId,
    expectedSourceSha256: record.expectedSourceSha256,
    inputManifestSha256: record.inputManifestSha256,
    outputRelativePath: record.outputRelativePath,
    outputSha256,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  const completionPath = path.join(requestRoot, "attempts", attempt, "completion.json");
  let existingCompletion = null;
  try {
    const existing = await readJson(completionPath, "completion.json", { projectRoot: root });
    if (
      existing.projectId !== completion.projectId
      || existing.documentId !== completion.documentId
      || existing.requestId !== completion.requestId
      || existing.attemptId !== completion.attemptId
      || existing.outputSha256 !== completion.outputSha256
      || existing.outputRelativePath !== completion.outputRelativePath
    ) {
      throw new ProjectFileFinalizerError(
        "COMPLETION_COLLISION",
        "A different completion is already recorded for this Attempt.",
      );
    }
    existingCompletion = existing;
  } catch (cause) {
    if (!(cause instanceof ProjectFileFinalizerError) || cause.code !== "FILE_NOT_FOUND") {
      throw cause;
    }
  }
  await assertRealPathInsideProject(root, completionPath, "completion.json", {
    allowMissing: true,
  });
  await refreshRegistryAuthority(registryAuthority);
  if (existingCompletion) return { ok: true, replayed: true, ...existingCompletion };
  await atomicWriteJson(completionPath, completion);
  return { ok: true, replayed: false, ...completion };
}
