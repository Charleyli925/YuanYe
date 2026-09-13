import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
  prepareAiTaskRequest,
} from "./project-file-repository-harness.mjs";

test("AI task projections are re-creatable, collision-safe and never Candidate authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-projection.html");
  const requestId = "req_ai_task_projection_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);

  const processingProjection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.match(processingProjection.taskRelativePath, /^AI任务\/\d{4}-\d{2}-\d{2}-候选版本2$/u);
  assert.equal(processingProjection.candidatePath, null);
  assert.equal(
    await readFile(processingProjection.promptPath, "utf8"),
    `# ${requestId}\n\n只生成本轮候选页面。\n`,
  );

  const candidateHtml = html("AI task projection candidate");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const readyProjection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.match(readyProjection.candidatePath, /-V2-待审阅\.html$/u);
  assert.equal(await readFile(readyProjection.candidatePath, "utf8"), candidateHtml);

  await writeFile(readyProjection.candidatePath, html("user tampered projection"), "utf8");
  const collisionRecovered = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(collisionRecovered.taskPath, readyProjection.taskPath);
  assert.equal(await readFile(collisionRecovered.candidatePath, "utf8"), candidateHtml);
  const hiddenCandidate = await value.repository.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  const beforePromotion = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(beforePromotion.versions.map((version) => version.versionId), ["ver_0001"]);

  await rm(collisionRecovered.taskPath, { recursive: true, force: true });
  const rebuilt = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(rebuilt.taskPath, collisionRecovered.taskPath);
  assert.equal(await readFile(rebuilt.candidatePath, "utf8"), candidateHtml);

  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: request.candidateId,
    decisionOperationId: `promote_${request.candidateId}`,
  });
  assert.equal(promoted.version.versionId, "ver_0002");
  assert.equal(await readFile(rebuilt.candidatePath, "utf8"), candidateHtml);
});

test("AI task projection never adopts a directory that wins its allocation race", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-directory-race.html");
  let racedDirectoryPath = "";
  let injected = false;
  const racing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name !== "ai-task-projection-before-directory-claim" || injected) return false;
      injected = true;
      racedDirectoryPath = details.taskDirectoryPath;
      await mkdir(racedDirectoryPath, { recursive: true });
      return false;
    },
  });
  const requestId = "req_ai_task_directory_race_0001";
  const request = await prepareAiTaskRequest(racing, imported.target, requestId);
  assert.equal(injected, true);
  assert.notEqual(racedDirectoryPath, "");
  assert.deepEqual(await readdir(racedDirectoryPath), []);

  const candidateHtml = html("Candidate after an allocation race");
  const completed = await racing.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const projection = await racing.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(projection.taskPath, racedDirectoryPath);
  assert.equal(await readFile(projection.candidatePath, "utf8"), candidateHtml);
  assert.deepEqual(await readdir(racedDirectoryPath), []);
});

test("AI task projection rebinds its display filename after a controlled Working Copy rename", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "before-ai-task-rename.html");
  const requestId = "req_ai_task_rename_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  const processing = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(processing.candidatePath, null);

  const renamedWorkingCopy = path.join(
    imported.target.projectRootPath,
    "after-ai-task-rename.html",
  );
  await rename(imported.target.exactSourcePath, renamedWorkingCopy);
  const candidateHtml = html("Candidate after a Finder rename");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");

  const projection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(projection.taskPath, processing.taskPath);
  assert.match(
    path.basename(projection.candidatePath),
    /^after-ai-task-rename-V2-待审阅\.html$/u,
  );
  assert.equal(await readFile(projection.candidatePath, "utf8"), candidateHtml);
  const receipt = await json(projection.receiptPath);
  assert.equal(receipt.candidateFileName, path.basename(projection.candidatePath));

  const replay = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(replay.taskPath, processing.taskPath);
  assert.equal(replay.candidatePath, projection.candidatePath);

  const renamedAgain = path.join(
    imported.target.projectRootPath,
    "after-candidate-rename.html",
  );
  await rename(renamedWorkingCopy, renamedAgain);
  const rebuiltAfterCandidateRename = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(rebuiltAfterCandidateRename.taskPath, projection.taskPath);
  assert.match(
    path.basename(rebuiltAfterCandidateRename.candidatePath),
    /^after-candidate-rename-V2-待审阅\.html$/u,
  );
  assert.equal(
    await readFile(rebuiltAfterCandidateRename.candidatePath, "utf8"),
    candidateHtml,
  );
});

test("AI task display publication cannot make a sealed Candidate unavailable", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-display-failure.html");
  const requestId = "req_ai_task_display_failure_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    "ai-task-projections",
  );
  const outside = path.join(value.root, "outside-ai-task-display");
  await mkdir(outside);
  await rm(recoveryRoot, { recursive: true, force: true });
  await symlink(outside, recoveryRoot, "dir");

  const candidateHtml = html("Candidate survives display failure");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");

  const status = await value.repository.requestStatus({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.candidateId, request.candidateId);
  const hiddenCandidate = await value.repository.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  await assert.rejects(
    value.repository.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "AI_TASK_PROJECTION_PATH_ESCAPE",
  );
});

test("AI task projection replays every publication failpoint without a second Candidate", async (t) => {
  const processingStages = [
    "ai-task-projection-receipt-written",
    "ai-task-projection-directory-allocated",
    "ai-task-projection-prompt-written",
    "ai-task-projection-completed",
    "ai-task-projection-finder-returning",
  ];
  for (const stage of processingStages) {
    const value = await fixture(t);
    const imported = await importSource(value, `projection-${stage}.html`);
    const requestId = `req_${stage.replaceAll("ai-task-projection-", "")}_0001`;
    let injected = true;
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: (name) => name === stage && injected,
    });
    const prepared = await prepareAiTaskRequest(failing, imported.target, requestId);
    assert.equal(prepared.status, "processing", stage);
    injected = false;
    const retry = new ProjectFileRepository({ projectsRoot: value.projects });
    const projection = await retry.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
    });
    assert.equal(projection.candidatePath, null, stage);
    const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], stage);
  }

  const value = await fixture(t);
  const imported = await importSource(value, "projection-candidate-written.html");
  const requestId = "req_candidate_written_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  let injected = true;
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: (name) => name === "ai-task-projection-candidate-written" && injected,
  });
  const candidateHtml = html("candidate failpoint recovery");
  const completedWithDeferredDisplay = await failing.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completedWithDeferredDisplay.status, "candidate-ready");
  await assert.rejects(
    failing.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  injected = false;
  const retry = new ProjectFileRepository({ projectsRoot: value.projects });
  const completed = await retry.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const hiddenCandidate = await retry.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  const requests = await readdir(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
  ));
  assert.equal(requests.filter((name) => name === requestId).length, 1);
  const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});
