import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";

export function html(label) {
  return `<!doctype html><html data-pageroot-id="pr1_11111111111141118111111111111111"><head data-pageroot-id="pr1_22222222222242229222222222222222"><title data-pageroot-id="pr1_3333333333334333a333333333333333">${label}</title></head><body data-pageroot-id="pr1_4444444444444444b444444444444444"><h1 data-pageroot-id="pr1_55555555555545558555555555555555">${label}</h1></body></html>`;
}

export async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-files-"));
  const sources = path.join(root, "sources");
  const projects = path.join(root, "projects");
  await Promise.all([
    writeFile(path.join(root, ".keep"), "", "utf8"),
    mkdir(sources, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    sources,
    projects,
    repository: new ProjectFileRepository({ projectsRoot: projects }),
  };
}

export async function importSource(fixtureValue, name = "原文件.html", content = html("V1")) {
  const sourcePath = path.join(fixtureValue.sources, name);
  const buffer = Buffer.from(content, "utf8");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, buffer);
  const imported = await fixtureValue.repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(buffer),
  });
  assert.equal(imported.imported, true);
  return {
    sourcePath,
    buffer,
    importSourceSha256: imported.importSourceSha256,
    target: imported.target,
  };
}

export async function promoteNextVersion(repository, target, label) {
  const candidate = await repository.createCandidate({
    target,
    requestId: `req_${label}`,
    candidateId: `candidate_${label}_0001`,
    html: html(label),
    expectedSourceSha256: target.sourceSha256,
  });
  const promoted = await repository.promoteCandidate({
    target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  assert.equal(promoted.promoted, true);
  return promoted.target;
}

export function currentRegistryWriteLockPath(fixtureValue) {
  return path.join(fixtureValue.projects, ".pageroot-registry-write-lock");
}

export function currentRegistryWriteLockOwnerPath(fixtureValue, token) {
  return path.join(
    currentRegistryWriteLockPath(fixtureValue),
    `.owner-${token}.json`,
  );
}

export async function seedCurrentRegistryWriteLock(fixtureValue, pid) {
  const token = "00000000-0000-4000-8000-000000000002";
  await mkdir(currentRegistryWriteLockPath(fixtureValue));
  await writeFile(
    currentRegistryWriteLockOwnerPath(fixtureValue, token),
    `${JSON.stringify({
      pid,
      token,
      createdAt: "2026-08-16T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  return { token };
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function prepareAiTaskRequest(repository, target, requestId) {
  return repository.prepareRequest({
    target,
    requestId,
    attemptId: "attempt_001",
    expectedSourceSha256: target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "生成一份可审阅的候选页面",
      comments: [{
        commentId: "comment_candidate_page",
        text: "生成一份可审阅的候选页面",
        target: { targetId: "target_candidate_page" },
        attachments: [],
      }],
      changeEvents: [],
      targets: [{ targetId: "target_candidate_page" }],
    },
    prompt: `# ${requestId}\n\n只生成本轮候选页面。\n`,
  });
}

export function registryPath(fixtureValue) {
  return path.join(fixtureValue.projects, ".pageroot-registry.json");
}

export async function initializedRepository(fixtureValue, options = {}) {
  const repository = new ProjectFileRepository({
    projectsRoot: fixtureValue.projects,
    ...options,
  });
  await repository.initialize();
  return repository;
}

export function reconcileInput(target, extra = {}) {
  return {
    operationId: extra.operationId || "reconcile_test_operation_01",
    previousSourcePath: extra.previousSourcePath || target.exactSourcePath,
    projectId: extra.projectId || target.projectId,
    documentId: extra.documentId || target.documentId,
    workingCopyId: extra.workingCopyId || target.workingCopyId,
    versionId: extra.versionId || target.versionId,
    expectedSourceSha256: extra.expectedSourceSha256 || target.sourceSha256,
    reason: extra.reason || "watch",
  };
}
