import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import {
  finalizeProjectFileAttempt,
} from "../bridge/project-file-finalizer.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";

function html(label) {
  return `<!doctype html><html data-pageroot-id="pr1_11111111111141118111111111111111"><head data-pageroot-id="pr1_22222222222242229222222222222222"><title data-pageroot-id="pr1_3333333333334333a333333333333333">${label}</title></head><body data-pageroot-id="pr1_4444444444444444b444444444444444"><h1 data-pageroot-id="pr1_55555555555545558555555555555555">${label}</h1></body></html>`;
}

function requestFor(summary) {
  const target = { targetId: "target_test" };
  return {
    freezeCutoffRevision: 0,
    summary,
    comments: [{
      commentId: "comment_test",
      text: summary,
      target,
      attachments: [],
    }],
    changeEvents: [],
    targets: [target],
  };
}

async function preparedRequest(t, requestId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-finalizer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.html");
  const source = html("V1");
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({ projectsRoot: path.join(root, "projects") });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
  });
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId,
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("Generate the Candidate."),
    prompt: "# Candidate\n",
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  await writeFile(outputPath, html("Candidate"), "utf8");
  return { repository, imported, request, requestRoot };
}

test("project-file finalizer freezes a Candidate output without publishing a Version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-finalizer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.html");
  const source = html("V1");
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({ projectsRoot: path.join(root, "projects") });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
  });
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_finalizer",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("Generate the Candidate."),
    prompt: "# Candidate\n",
  });
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  await writeFile(outputPath, html("Candidate"), "utf8");

  const finalized = await finalizeProjectFileAttempt({
    projectRoot: imported.target.projectRootPath,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.status, "completed");
  assert.equal(finalized.proposedVersionId, "ver_0002");
  const runtime = JSON.parse(await readFile(
    path.join(imported.target.projectRootPath, ".pageroot", "runtime-state.json"),
    "utf8",
  ));
  assert.equal(runtime.activeRequest.candidateOutputSha256, null);
  assert.equal(runtime.activeRequest.candidateRecordSha256, null);
  const replayed = await finalizeProjectFileAttempt({
    projectRoot: imported.target.projectRootPath,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(replayed.replayed, true);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  const manifest = JSON.parse(await readFile(
    path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(manifest.versions.length, 1);

  const registryPath = path.join(root, "projects", ".pageroot-registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  delete registry.projects[imported.target.projectId];
  await writeFile(registryPath, JSON.stringify(registry), "utf8");
  await assert.rejects(
    finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
    }),
    (error) => error?.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
});

for (const legacyCompletion of [false, true]) {
  test(`identical HTML finalization retains one Candidate across replay and restart (legacy completion: ${legacyCompletion})`, async (t) => {
    const { repository, imported, request, requestRoot } = await preparedRequest(t, "req_identical_finalizer");
    const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
    const record = JSON.parse(await readFile(path.join(requestRoot, "request.json"), "utf8"));
    const input = await readFile(path.join(controlRoot, record.inputRelativePath), "utf8");
    const outputPath = path.join(controlRoot, request.outputRelativePath);
    await writeFile(outputPath, input);
    const finalizerInput = { projectRoot: imported.target.projectRootPath,
      requestId: request.requestId, attemptId: request.attemptId };
    const finalized = await finalizeProjectFileAttempt(finalizerInput);
    assert.equal(finalized.status, "completed");
    assert.equal(finalized.outputSha256, request.expectedSourceSha256);
    const completionPath = path.join(requestRoot, "attempts", request.attemptId, "completion.json");
    if (legacyCompletion) {
      // Old finalizer output with a still-processing Request; this is not a
      // historical terminal Request and must still receive current validation.
      const oldCompletion = JSON.parse(await readFile(completionPath, "utf8"));
      oldCompletion.status = "no-change";
      await writeFile(completionPath, `${JSON.stringify(oldCompletion, null, 2)}\n`);
    }
    const completionBytes = await readFile(completionPath, "utf8");
    const replayed = await finalizeProjectFileAttempt(finalizerInput);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.status, legacyCompletion ? "no-change" : "completed");
    assert.equal(await readFile(completionPath, "utf8"), completionBytes);
    const statusInput = { target: imported.target, requestId: request.requestId, attemptId: request.attemptId };
    const ready = await repository.requestStatus(statusInput);
    assert.equal(ready.status, "candidate-ready");
    assert.equal(ready.candidate.candidateId, request.candidateId);
    assert.equal((await repository.requestStatus(statusInput)).candidate.candidateId, request.candidateId);
    const restarted = new ProjectFileRepository({ projectsRoot: path.dirname(imported.target.projectRootPath) });
    const reopened = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    assert.equal(reopened.activeCandidate.candidateId, request.candidateId);
    assert.equal((await restarted.requestStatus(statusInput)).candidate.candidateId, request.candidateId);
    assert.equal(reopened.manifest.versions.length, 1);
    assert.equal(await readFile(path.join(requestRoot, "candidate.html"), "utf8"), input);
    assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), input);
    assert.equal(await readFile(completionPath, "utf8"), completionBytes);
  });
}

test("project-file finalizer refreshes Registry identity only after every Candidate check succeeds", async (t) => {
  const { imported, request } = await preparedRequest(t, "req_registry_refresh_order");
  const projectsRoot = path.dirname(imported.target.projectRootPath);
  const registryPath = path.join(projectsRoot, ".pageroot-registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const originalIdentity = registry.projects[imported.target.projectId].rootFileIdentity;
  const staleIdentity = {
    ...originalIdentity,
    inode: `${originalIdentity.inode}-stale`,
  };
  registry.projects[imported.target.projectId].rootFileIdentity = staleIdentity;
  await writeFile(registryPath, JSON.stringify(registry), "utf8");
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  await writeFile(outputPath, "not a complete html document", "utf8");

  await assert.rejects(
    finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
    }),
    (error) => error?.code === "INCOMPLETE_HTML",
  );
  const afterRejected = JSON.parse(await readFile(registryPath, "utf8"));
  assert.deepEqual(
    afterRejected.projects[imported.target.projectId].rootFileIdentity,
    staleIdentity,
  );

  await writeFile(outputPath, html("Candidate after full validation"), "utf8");
  const finalized = await finalizeProjectFileAttempt({
    projectRoot: imported.target.projectRootPath,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(finalized.status, "completed");
  const afterCompleted = JSON.parse(await readFile(registryPath, "utf8"));
  assert.deepEqual(
    afterCompleted.projects[imported.target.projectId].rootFileIdentity,
    originalIdentity,
  );
});

test("project-file finalizer rechecks Candidate bytes after the size stat", async (t) => {
  const { imported, request, requestRoot } = await preparedRequest(
    t,
    "req_candidate_post_read_limit",
  );
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  await assert.rejects(
    finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
      testHooks: {
        afterCandidateOutputStat: async () => {
          await writeFile(outputPath, Buffer.alloc((20 * 1024 * 1024) + 1, 0x61));
        },
      },
    }),
    (error) => error?.code === "OUTPUT_TOO_LARGE",
  );
  await assert.rejects(readFile(
    path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
  ));
});

test("project-file finalizer seals the complete frozen Request bundle", async (t) => {
  await t.test("acknowledges a cancelled Request without creating completion evidence", async (subtest) => {
    const { repository, imported, request, requestRoot } = await preparedRequest(
      subtest,
      "req_cancelled_finalizer",
    );
    await repository.cancelRequest({
      target: imported.target,
      requestId: request.requestId,
      attemptId: request.attemptId,
    });
    const cancellationAuthority = JSON.parse(await readFile(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "recovery",
      "cancellations",
      `${request.requestId}.${request.attemptId}.json`,
    ), "utf8"));
    assert.equal(cancellationAuthority.kind, "request-cancellation");
    assert.equal(cancellationAuthority.requestId, request.requestId);
    assert.equal(cancellationAuthority.attemptId, request.attemptId);

    const finalized = await finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
    });
    assert.deepEqual(finalized, {
      ok: true,
      status: "cancelled",
      accepted: false,
      retryable: false,
      message: "本轮已在源页结束。请停止 AI Agent，不要重试。",
    });
    await assert.rejects(readFile(
      path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
    ));
  });

  await t.test("rejects a cancelled Request without external cancellation authority", async (subtest) => {
    const { imported, request, requestRoot } = await preparedRequest(
      subtest,
      "req_cancelled_without_authority",
    );
    const requestPath = path.join(requestRoot, "request.json");
    const runtimePath = path.join(imported.target.projectRootPath, ".pageroot", "runtime-state.json");
    const requestRecord = JSON.parse(await readFile(requestPath, "utf8"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    requestRecord.status = "cancelled";
    requestRecord.cancelledAt = "2026-08-14T00:00:00.000Z";
    runtime.activeRequest = null;
    runtime.activeCandidateId = null;
    await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");
    await writeFile(runtimePath, JSON.stringify(runtime), "utf8");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
        attemptId: request.attemptId,
      }),
      (error) => error?.code === "CANCELLATION_AUTHORITY_MISMATCH",
    );
  });

  await t.test("rejects a changed frozen input even when the base HTML is intact", async (subtest) => {
    const { imported, requestRoot } = await preparedRequest(subtest, "req_bundle_input");
    await writeFile(
      path.join(requestRoot, "input", "annotations", "records.json"),
      JSON.stringify({ changed: true }),
      "utf8",
    );
    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: "req_bundle_input",
      }),
      (error) => error?.code === "FROZEN_REQUEST_BUNDLE_MISMATCH",
    );
  });

  await t.test("anchors request metadata to the registered manifest and active Request", async (subtest) => {
    const { imported, request, requestRoot } = await preparedRequest(subtest, "req_bundle_anchor");
    const requestPath = path.join(requestRoot, "request.json");
    const changeRequestPath = path.join(requestRoot, "change-request.json");
    const inputManifestPath = path.join(requestRoot, "input-manifest.json");
    const requestRecord = JSON.parse(await readFile(requestPath, "utf8"));
    const changeRequest = JSON.parse(await readFile(changeRequestPath, "utf8"));
    requestRecord.basedOnVersionId = "ver_9999";
    changeRequest.basedOnVersionId = "ver_9999";
    const changeRequestBuffer = Buffer.from(JSON.stringify(changeRequest), "utf8");
    await writeFile(changeRequestPath, changeRequestBuffer);
    const inputManifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
    const changeEntry = inputManifest.files.find((entry) => entry.path === "change-request.json");
    changeEntry.byteLength = changeRequestBuffer.byteLength;
    changeEntry.sha256 = sha256(changeRequestBuffer);
    const inputManifestBuffer = Buffer.from(JSON.stringify(inputManifest), "utf8");
    requestRecord.inputManifestSha256 = sha256(inputManifestBuffer);
    await writeFile(inputManifestPath, inputManifestBuffer);
    await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
      }),
      (error) => error?.code === "REQUEST_IDENTITY_MISMATCH",
    );
  });

  await t.test("rejects non-null Candidate seals while the Request is still processing", async (subtest) => {
    const { imported, request } = await preparedRequest(subtest, "req_candidate_seal_shape");
    const runtimePath = path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "runtime-state.json",
    );
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    runtime.activeRequest.candidateOutputSha256 = sha256(Buffer.from(html("untrusted"), "utf8"));
    runtime.activeRequest.candidateRecordSha256 = sha256(Buffer.from("untrusted record", "utf8"));
    await writeFile(runtimePath, JSON.stringify(runtime), "utf8");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
        attemptId: request.attemptId,
      }),
      (error) => error?.code === "REQUEST_IDENTITY_MISMATCH",
    );
  });

  await t.test("replay verifies pending-review Candidate record and output seals", async (subtest) => {
    const { repository, imported, request, requestRoot } = await preparedRequest(
      subtest,
      "req_candidate_seal_replay",
    );
    await finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
    });
    await repository.completeRequest({
      target: imported.target,
      requestId: request.requestId,
      attemptId: request.attemptId,
      html: html("Candidate"),
    });
    const candidatePath = path.join(requestRoot, "candidate.json");
    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    candidate.createdAt = "2000-01-01T00:00:00.000Z";
    await writeFile(candidatePath, JSON.stringify(candidate), "utf8");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
        attemptId: request.attemptId,
      }),
      (error) => error?.code === "CANDIDATE_AUTHORITY_MISMATCH",
    );
  });

  await t.test("rejects a coordinated Request rewrite that updates its local manifest hash", async (subtest) => {
    const { imported, request, requestRoot } = await preparedRequest(subtest, "req_runtime_anchor");
    const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
    const requestPath = path.join(requestRoot, "request.json");
    const changeRequestPath = path.join(requestRoot, "change-request.json");
    const inputManifestPath = path.join(requestRoot, "input-manifest.json");
    const runtimePath = path.join(controlRoot, "runtime-state.json");
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    const runtimeManifestSha256 = runtime.activeRequest?.inputManifestSha256;
    assert.equal(runtimeManifestSha256, request.inputManifestSha256);

    const requestRecord = JSON.parse(await readFile(requestPath, "utf8"));
    const changeRequest = JSON.parse(await readFile(changeRequestPath, "utf8"));
    const alteredRequirements = {
      ...changeRequest.requirements,
      untrustedRewrite: true,
    };
    changeRequest.requirements = alteredRequirements;
    const changeRequestBuffer = Buffer.from(JSON.stringify(changeRequest), "utf8");
    await writeFile(changeRequestPath, changeRequestBuffer);

    const inputManifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
    const changeEntry = inputManifest.files.find((entry) => entry.path === "change-request.json");
    changeEntry.byteLength = changeRequestBuffer.byteLength;
    changeEntry.sha256 = sha256(changeRequestBuffer);
    const inputManifestBuffer = Buffer.from(JSON.stringify(inputManifest), "utf8");
    requestRecord.request = alteredRequirements;
    requestRecord.inputManifestSha256 = sha256(inputManifestBuffer);
    await writeFile(inputManifestPath, inputManifestBuffer);
    await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
      }),
      (error) => error?.code === "FROZEN_REQUEST_BUNDLE_MISMATCH",
    );
    const runtimeAfter = JSON.parse(await readFile(runtimePath, "utf8"));
    assert.equal(runtimeAfter.activeRequest?.inputManifestSha256, runtimeManifestSha256);
  });

  await t.test("rejects a symlinked Attempt ancestor before writing completion", async (subtest) => {
    const { imported, request, requestRoot } = await preparedRequest(subtest, "req_symlink_attempt");
    const attemptRoot = path.join(requestRoot, "attempts", request.attemptId);
    const outsideAttemptRoot = path.join(
      path.dirname(imported.target.projectRootPath),
      "outside-attempt",
    );
    await mkdir(path.join(outsideAttemptRoot, "output"), { recursive: true });
    await writeFile(path.join(outsideAttemptRoot, "output", "candidate.html"), html("Outside"), "utf8");
    await rm(attemptRoot, { recursive: true, force: true });
    await symlink(outsideAttemptRoot, attemptRoot, "dir");

    await assert.rejects(
      finalizeProjectFileAttempt({
        projectRoot: imported.target.projectRootPath,
        requestId: request.requestId,
      }),
      (error) => error?.code === "PATH_ESCAPES_PROJECT",
    );
    await assert.rejects(readFile(path.join(outsideAttemptRoot, "completion.json")));
  });
});

test("manual finalizer rejects identity corruption without completion and allows a corrected retry", async (t) => {
  const { imported, request, requestRoot } = await preparedRequest(t, "req_manual_identity_repair");
  const outputPath = path.join(imported.target.projectRootPath, ".pageroot", request.outputRelativePath);
  const completionPath = path.join(requestRoot, "attempts", request.attemptId, "completion.json");
  const good = await readFile(outputPath, "utf8");
  await writeFile(outputPath, good.replace("pr1_11111111111141118111111111111111", "pr1_ffffffffffff4fff8fffffffffffffff"));
  const args = { projectRoot: imported.target.projectRootPath, requestId: request.requestId, attemptId: request.attemptId };
  await assert.rejects(finalizeProjectFileAttempt(args), { code: "CANDIDATE_SOURCE_IDENTITY_FORGED" });
  await assert.rejects(readFile(completionPath), { code: "ENOENT" });
  await writeFile(outputPath, good);
  assert.equal((await finalizeProjectFileAttempt(args)).ok, true);
});
