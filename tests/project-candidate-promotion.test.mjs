import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { inspectSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

test("a Candidate is not a Version until adoption, rejection consumes no ordinal, and promotion is idempotent", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const firstCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_rejected",
    candidateId: "candidate_rejected_0001",
    html: html("rejected candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });

  assert.equal(firstCandidate.candidate.status, "pending-review");
  assert.equal(firstCandidate.candidate.proposedVersionId, "ver_0002");
  assert.ok(["ready", "attention"].includes(firstCandidate.candidate.assessment.status));
  let manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");

  const rejected = await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: firstCandidate.candidate.candidateId,
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.latestOfficialVersionId, "ver_0001");

  const secondCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_adopted",
    candidateId: "candidate_adopted_0001",
    html: html("adopted candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(secondCandidate.candidate.proposedVersionId, "ver_0002");

  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
    decisionOperationId: `promote_${secondCandidate.candidate.candidateId}`,
  });
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.version.versionId, "ver_0002");
  assert.equal(promoted.target.workingCopyId, "work_ver_0002");

  const repeated = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
    decisionOperationId: `promote_${secondCandidate.candidate.candidateId}`,
  });
  assert.equal(repeated.version.versionId, "ver_0002");
  manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0002");
});

test("Candidate adoption requires its own decision receipt and retries one lost response", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "candidate-receipt.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_candidate_receipt",
    candidateId: "candidate_candidate_receipt_0001",
    html: html("candidate receipt"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    { code: "DECISION_IDENTITY_MISMATCH" },
  );
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: "promote_candidate_other_0001",
    }),
    { code: "DECISION_IDENTITY_MISMATCH" },
  );
  let lostResponse = true;
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "promotion-manifest-committed" && lostResponse) {
        lostResponse = false;
        return true;
      }
      return false;
    },
  });
  const input = {
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  };
  await assert.rejects(
    interrupted.promoteCandidate(input),
    { code: "INJECTED_FAILPOINT" },
  );
  const afterLostResponse = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(afterLostResponse.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
  const recovered = await new ProjectFileRepository({ projectsRoot: value.projects }).promoteCandidate(input);
  assert.equal(recovered.version.versionId, "ver_0002");
  const replayed = await new ProjectFileRepository({ projectsRoot: value.projects }).promoteCandidate(input);
  assert.equal(replayed.version.versionId, "ver_0002");
  const finalManifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(finalManifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
});

test("promotion preserves the identity-normalized Candidate in its Version and Working Copy", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-identity.html");
  const candidateSubmission = html("Candidate").replace(
    /<h1 data-pageroot-id="[^"]+">Candidate<\/h1>/u,
    "<main>Candidate</main>",
  );
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_identity",
    candidateId: "candidate_promotion_identity_0001",
    html: candidateSubmission,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const candidateHtml = await readFile(path.join(
    controlRoot,
    "requests",
    "req_promotion_identity",
    "candidate.html",
  ), "utf8");
  assert.notEqual(candidateHtml, candidateSubmission);
  assert.equal(inspectSourceElementIdentity(candidateHtml).complete, true);
  assert.equal(
    await readFile(path.join(controlRoot, "versions", "ver_0002", "index.html"), "utf8"),
    candidateHtml,
  );
  const managedHtml = await readFile(promoted.target.exactSourcePath, "utf8");
  assert.equal(managedHtml, candidateHtml);
  assert.equal(inspectSourceElementIdentity(managedHtml).complete, true);
  assert.equal(promoted.target.sourceSha256, sha256(Buffer.from(managedHtml, "utf8")));
  const state = await json(path.join(controlRoot, "working-copies", "work_ver_0002.json"));
  assert.equal(state.baseSha256, candidate.candidate.outputSha256);
  assert.equal(state.currentSha256, promoted.target.sourceSha256);
  assert.equal(state.differsFromBase, false);
  assert.equal(state.sourceElementIdentitySchemaVersion, 1);
  const transaction = await json(path.join(
    controlRoot,
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  assert.equal(transaction.candidateOutputSha256, candidate.candidate.outputSha256);
  assert.equal(transaction.workingCopySourceSha256, promoted.target.sourceSha256);
});

test("legacy Promotion journals without a Working Copy hash remain recoverable", async (t) => {
  for (const failpoint of [
    "promotion-snapshot-created",
    "promotion-working-copy-prepared",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, `legacy-${failpoint}.html`);
    const candidateHtml = html(`legacy ${failpoint}`);
    const suffix = failpoint.replaceAll("-", "_");
    const candidate = await value.repository.createCandidate({
      target: imported.target,
      requestId: `req_legacy_${suffix}`,
      candidateId: `candidate_legacy_${suffix}_0001`,
      html: candidateHtml,
      expectedSourceSha256: imported.target.sourceSha256,
    });
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.promoteCandidate({
        target: imported.target,
        candidateId: candidate.candidate.candidateId,
        decisionOperationId: `promote_${candidate.candidate.candidateId}`,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
    );

    const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
    const transactionPath = path.join(
      controlRoot,
      "transactions",
      `promote_${candidate.candidate.candidateId}`,
      "transaction.json",
    );
    const transaction = await json(transactionPath);
    delete transaction.workingCopySourceSha256;
    if (failpoint === "promotion-working-copy-prepared") {
      await writeFile(
        path.join(controlRoot, transaction.preparedWorkingCopyRelativePath),
        candidateHtml,
        "utf8",
      );
    }
    await writeFile(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");

    const recovery = new ProjectFileRepository({
      projectsRoot: value.projects,
    });
    const reopened = await recovery.workspace({
      sourcePath: imported.target.exactSourcePath,
    });
    assert.equal(reopened.manifest.latestOfficialVersionId, "ver_0002");
    const recoveredWorkingCopy = reopened.manifest.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === "work_ver_0002",
    );
    assert.ok(recoveredWorkingCopy);
    const recoveredV2 = await recovery.workspace({
      sourcePath: path.join(
        imported.target.projectRootPath,
        recoveredWorkingCopy.sourceRelativePath,
      ),
    });
    assert.equal(recoveredV2.target.workingCopyId, "work_ver_0002");
    assert.equal(inspectSourceElementIdentity(recoveredV2.content).complete, true);
    const recoveredTransaction = await json(transactionPath);
    assert.match(recoveredTransaction.workingCopySourceSha256, /^sha256:[a-f0-9]{64}$/u);
  }
});

test("a historical Version reactivates its original Working Copy without changing its immutable snapshot", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "history-lineage.html");
  let active = imported.target;
  let v2Target = null;
  const v2Snapshot = html("immutable V2");
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const candidate = await value.repository.createCandidate({
      target: active,
      requestId: `req_history_${ordinal}`,
      candidateId: `candidate_history_${ordinal}_0001`,
      html: ordinal === 2 ? v2Snapshot : html(`V${ordinal}`),
      expectedSourceSha256: active.sourceSha256,
    });
    const promoted = await value.repository.promoteCandidate({
      target: active,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    });
    active = promoted.target;
    if (ordinal === 2) v2Target = active;
  }
  assert.equal(active.versionId, "ver_0006");
  assert.equal(v2Target?.workingCopyId, "work_ver_0002");

  const workspaceBeforeHistory = await value.repository.workspace({
    sourcePath: active.exactSourcePath,
  });
  assert.deepEqual(
    workspaceBeforeHistory.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === "work_ver_0002",
    ),
    {
      workingCopyId: "work_ver_0002",
      versionId: "ver_0002",
      basedOnVersionId: "ver_0002",
      differsFromBase: false,
      saveState: "saved",
    },
  );
  const visibleV2 = await value.repository.resolveVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
  });
  assert.equal(visibleV2.workingCopyId, "work_ver_0002");
  assert.equal(visibleV2.workingCopyPath, v2Target?.exactSourcePath);
  assert.equal(visibleV2.sourceSha256, v2Target?.sourceSha256);

  const activated = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(activated.activated, true);
  assert.equal(activated.previousWorkingCopyId, "work_ver_0006");
  assert.equal(activated.target.versionId, "ver_0002");
  assert.equal(activated.target.workingCopyId, "work_ver_0002");
  assert.equal(activated.historyActivation.state, "desktop-pending");
  const retried = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(retried.activated, false);
  assert.equal(retried.replayed, true);
  assert.equal(retried.previousWorkingCopyId, "work_ver_0006");
  assert.equal(retried.target.workingCopyId, activated.target.workingCopyId);

  const resumedAfterLostResponse = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_retry_after_lost_response_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(resumedAfterLostResponse.replayed, true);
  assert.equal(
    resumedAfterLostResponse.historyActivation.operationId,
    "history_continue_v2_0001",
  );

  const confirmed = await value.repository.confirmVersionWorkingCopyActivation({
    target: active,
    operationId: "history_continue_v2_0001",
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.historyActivation.state, "desktop-confirmed");
  const confirmRetry = await value.repository.confirmVersionWorkingCopyActivation({
    target: active,
    operationId: "history_continue_v2_0001",
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
  });
  assert.equal(confirmRetry.confirmed, false);
  const runtimeAfterActivation = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtimeAfterActivation.activeWorkingCopyId, "work_ver_0002");
  assert.equal(runtimeAfterActivation.historyActivation.state, "desktop-confirmed");

  const resumedAfterConfirmationLoss = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_retry_after_confirmation_loss_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(resumedAfterConfirmationLoss.replayed, true);
  assert.equal(
    resumedAfterConfirmationLoss.historyActivation.operationId,
    "history_continue_v2_0001",
  );

  await assert.rejects(
    value.repository.activateVersionWorkingCopy({
      target: active,
      versionId: "ver_0003",
      operationId: "history_stale_v3_0001",
      expectedActiveWorkingCopyId: "work_ver_0006",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT",
  );

  const v2Edited = html("editable V2 after history continuation");
  const saved = await value.repository.saveWorkingCopy({
    target: activated.target,
    html: v2Edited,
    expectedSourceSha256: activated.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(await readFile(
    path.join(saved.target.projectRootPath, ".pageroot", "versions", "ver_0002", "index.html"),
    "utf8",
  ), v2Snapshot);
  const revealedEditedV2 = await value.repository.resolveVersionWorkingCopy({
    target: saved.target,
    versionId: "ver_0002",
  });
  assert.equal(revealedEditedV2.workingCopyPath, saved.target.exactSourcePath);
  assert.equal(revealedEditedV2.sourceSha256, saved.target.sourceSha256);
  assert.equal(revealedEditedV2.workingCopyState.differsFromBase, true);

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const reopened = await restarted.workspace({ sourcePath: saved.target.exactSourcePath });
  assert.equal(reopened.target.versionId, "ver_0002");
  assert.equal(reopened.target.workingCopyId, "work_ver_0002");
  assert.equal(reopened.content, v2Edited);

  const candidate = await restarted.createCandidate({
    target: reopened.target,
    requestId: "req_history_v7",
    candidateId: "candidate_history_v7_0001",
    html: html("V7 based on V2"),
    expectedSourceSha256: reopened.target.sourceSha256,
  });
  const promoted = await restarted.promoteCandidate({
    target: reopened.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  assert.equal(promoted.version.versionId, "ver_0007");
  assert.equal(promoted.version.basedOnVersionId, "ver_0002");
  assert.equal(promoted.version.previousVersionId, "ver_0006");
  const runtimeAfterPromotion = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtimeAfterPromotion.historyActivation, null);
});

test("blocked Candidate validation never reserves a Version", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  await assert.rejects(
    value.repository.createCandidate({
      target: imported.target,
      requestId: "req_empty_candidate",
      candidateId: "candidate_empty_0001",
      html: html("empty").replace(/<h1[^>]*>empty<\/h1>/u, ""),
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_UNUSABLE",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("createCandidate ignores authored script changes and keeps weak continuity as review", async (t) => {
  const value = await fixture(t);
  const base = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Scope fixture</title>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <main id="target"><p id="inside">目标正文</p></main>
  <aside id="outside">目标外正文</aside>
</body>
</html>`;
  const imported = await importSource(value, "scope.html", base);
  const identityBase = await readFile(imported.target.exactSourcePath, "utf8");

  const scriptOnly = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_script_only",
    candidateId: "candidate_script_only_0001",
    html: identityBase.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(scriptOnly.candidate.status, "pending-review");
  assert.equal(scriptOnly.candidate.assessment.status, "ready");
  assert.deepEqual(scriptOnly.candidate.assessment.issueCodes, []);
  assert.equal("executable" in scriptOnly.candidate.assessment, false);
  assert.equal(
    "executableSurfaceUnchanged" in scriptOnly.candidate.assessment.health,
    false,
  );
  assert.equal(scriptOnly.candidate.proposedVersionId, "ver_0002");

  await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: scriptOnly.candidate.candidateId,
  });

  const unrelated = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_unrelated_page",
    candidateId: "candidate_unrelated_0001",
    html: identityBase
      .replace(">Scope fixture</title>", ">另一页</title>")
      .replace(
        /<body([^>]*)>[\s\S]*<\/body>/u,
        '<body$1><article>全新的内容与结构</article></body>',
      ),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(unrelated.candidate.status, "pending-review");
  assert.equal(unrelated.candidate.assessment.status, "attention");
  assert.deepEqual(
    unrelated.candidate.assessment.issueCodes,
    ["PAGE_CONTINUITY_UNCERTAIN"],
  );
  assert.equal(unrelated.candidate.proposedVersionId, "ver_0002");
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("runtime authority seals Candidate record and output after review begins", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_candidate_authority",
    candidateId: "candidate_authority_0001",
    html: html("reviewed candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_candidate_authority",
  );
  const runtimePath = path.join(imported.target.projectRootPath, ".pageroot", "runtime-state.json");
  const runtimeBefore = await json(runtimePath);
  const rewrittenHtml = html("unreviewed replacement");
  const rewrittenRecord = await json(path.join(requestRoot, "candidate.json"));
  rewrittenRecord.outputSha256 = sha256(Buffer.from(rewrittenHtml, "utf8"));
  await writeFile(path.join(requestRoot, "candidate.html"), rewrittenHtml, "utf8");
  await writeFile(path.join(requestRoot, "candidate.json"), JSON.stringify(rewrittenRecord), "utf8");

  await assert.rejects(
    value.repository.readCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );

  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest.candidateOutputSha256,
    runtimeBefore.activeRequest.candidateOutputSha256,
  );
  assert.equal(
    runtimeAfter.activeRequest.candidateRecordSha256,
    runtimeBefore.activeRequest.candidateRecordSha256,
  );
});

test("request recovery promotes a prepared Candidate only when its runtime seal survives", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const request = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_candidate_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "recover sealed candidate",
      comments: [{
        commentId: "comment_candidate_recovery",
        text: "recover sealed candidate",
        target: { targetId: "target_candidate_recovery" },
      }],
      targets: [{ targetId: "target_candidate_recovery" }],
    },
    prompt: "# recover sealed candidate\n",
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "candidate-prepared",
  });
  await assert.rejects(
    interrupted.completeRequest({
      target: imported.target,
      requestId: request.requestId,
      attemptId: request.attemptId,
      html: html("candidate after interrupted completion"),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const recovered = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(recovered.activeRequest.status, "candidate-ready");
  assert.equal(recovered.activeCandidate.candidateId, request.candidateId);
});

test("Promotion recovery does not bypass the runtime-sealed Candidate record", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "sealed-promotion.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_sealed_promotion",
    candidateId: "candidate_sealed_promotion_0001",
    html: html("sealed Candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-prepared",
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const candidatePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_sealed_promotion",
    "candidate.json",
  );
  const replacement = await json(candidatePath);
  replacement.createdAt = "2000-01-01T00:00:00.000Z";
  await writeFile(candidatePath, JSON.stringify(replacement), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
});

test("Promotion recovery re-derives every Candidate-backed transaction field", async (t) => {
  const mutations = [
    ["transaction ID", (transaction) => { transaction.transactionId = "promote_candidate_other_0001"; }],
    ["request ID", (transaction) => { transaction.requestId = "req_other"; }],
    ["Version ID", (transaction) => { transaction.versionId = "ver_0999"; }],
    ["Version ordinal", (transaction) => { transaction.versionOrdinal = 999; }],
    ["base lineage", (transaction) => { transaction.basedOnVersionId = "ver_0999"; }],
    ["previous lineage", (transaction) => { transaction.previousVersionId = "ver_0999"; }],
    ["Candidate output hash", (transaction) => { transaction.candidateOutputSha256 = "sha256:" + "0".repeat(64); }],
    ["preferred stem", (transaction) => { transaction.preferredFileStem = "unrelated"; }],
    ["preferred extension", (transaction) => { transaction.preferredExtension = ".htm"; }],
    ["visible Working Copy path", (transaction) => { transaction.finalWorkingCopyRelativePath = "unrelated-V2.html"; }],
    ["prepared Working Copy path", (transaction) => {
      transaction.preparedWorkingCopyRelativePath = "transactions/"
        + transaction.transactionId + "/prepared-working-copy.htm";
    }],
  ];
  for (const [index, [label, mutate]] of mutations.entries()) {
    const value = await fixture(t);
    const imported = await importSource(value, `transaction-authority-${index}.html`);
    const candidate = await value.repository.createCandidate({
      target: imported.target,
      requestId: `req_transaction_authority_${index}`,
      candidateId: `candidate_transaction_authority_${index.toString().padStart(4, "0")}`,
      html: html(`sealed Candidate ${label}`),
      expectedSourceSha256: imported.target.sourceSha256,
    });
    const interrupted = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === "promotion-working-copy-prepared",
    });
    await assert.rejects(
      interrupted.promoteCandidate({
        target: imported.target,
        candidateId: candidate.candidate.candidateId,
        decisionOperationId: `promote_${candidate.candidate.candidateId}`,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      label,
    );
    const transactionPath = path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "transactions",
      `promote_${candidate.candidate.candidateId}`,
      "transaction.json",
    );
    const transaction = await json(transactionPath);
    mutate(transaction);
    await writeFile(transactionPath, JSON.stringify(transaction), "utf8");

    await assert.rejects(
      new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
        sourcePath: imported.target.exactSourcePath,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "PROMOTION_TRANSACTION_MISMATCH",
      label,
    );
    const manifest = await json(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "manifest.json",
    ));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], label);
  }
});

test("Promotion recovery validates the recorded Working Copy against sealed authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-working-copy-authority.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_working_copy_authority",
    candidateId: "candidate_promotion_working_copy_authority_0001",
    html: html("sealed Candidate Working Copy"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-created",
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const transactionPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  );
  const transaction = await json(transactionPath);
  transaction.workingCopy = {
    ...transaction.workingCopy,
    basedOnVersionId: "ver_0001",
    sourceRelativePath: "unrelated-V2.html",
    stateRelativePath: "working-copies/work_ver_0999.json",
  };
  await writeFile(transactionPath, JSON.stringify(transaction), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_TRANSACTION_MISMATCH",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("a Candidate cannot be adopted after its frozen Working Copy changes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_stale_candidate",
    candidateId: "candidate_stale_0001",
    html: html("candidate from V1"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const edited = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("working copy changed after review"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });

  await assert.rejects(
    value.repository.promoteCandidate({
      target: edited.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  const persistedCandidate = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_stale_candidate",
    "candidate.json",
  ));
  assert.equal(persistedCandidate.status, "pending-review");
});

test("promotion rechecks the Candidate base before manifest publication and recovery", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-boundary.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_boundary",
    candidateId: "candidate_promotion_boundary_0001",
    html: html("candidate based on V1"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const externalHtml = html("external edit before promotion commit");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "promotion-working-copy-created") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );
  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).recoverProject({
      projectRootPath: imported.target.projectRootPath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  const persistedCandidate = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_promotion_boundary",
    "candidate.json",
  ));
  assert.equal(persistedCandidate.status, "pending-review");
});

test("promotion uses the latest Working Copy name and allocates around file, directory and symlink collisions", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "A.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_renamed_promotion",
    candidateId: "candidate_renamed_promotion_0001",
    html: html("promoted from latest name"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const renamedPath = path.join(imported.target.projectRootPath, "B-V1.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const renamed = await value.repository.resolveOpenTarget({ sourcePath: renamedPath });
  assert.equal(renamed.workingCopyId, "work_ver_0001");

  const collisionFile = path.join(imported.target.projectRootPath, "B-V2.html");
  const collisionDirectory = path.join(imported.target.projectRootPath, "B-V2-V2.html");
  const collisionSymlink = path.join(imported.target.projectRootPath, "B-V2-V2-V2.html");
  const outside = path.join(value.root, "promotion-collision.html");
  await writeFile(collisionFile, html("user file collision"), "utf8");
  await mkdir(collisionDirectory);
  await writeFile(outside, html("user symlink collision"), "utf8");
  await symlink(outside, collisionSymlink, "file");

  const promoted = await value.repository.promoteCandidate({
    target: renamed,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  assert.equal(
    path.basename(promoted.target.exactSourcePath),
    "B-V2-V2-V2-V2.html",
  );
  assert.equal(await readFile(collisionFile, "utf8"), html("user file collision"));
  assert.equal((await lstat(collisionDirectory)).isDirectory(), true);
  assert.equal((await lstat(collisionSymlink)).isSymbolicLink(), true);
});

test("promotion retries the next same-ordinal path after an OS no-replace collision", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "A.html");
  const candidateHtml = html("same bytes as concurrent user file");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_no_replace_race",
    candidateId: "candidate_no_replace_race_0001",
    html: candidateHtml,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const renamedPath = path.join(imported.target.projectRootPath, "B-V1.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const renamed = await value.repository.resolveOpenTarget({ sourcePath: renamedPath });
  let raced = false;
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name === "promotion-visible-publication-before-link" && !raced) {
        raced = true;
        await writeFile(details.visiblePath, candidateHtml, "utf8");
      }
      return false;
    },
  });

  const promoted = await repository.promoteCandidate({
    target: renamed,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  assert.equal(raced, true);
  assert.equal(path.basename(promoted.target.exactSourcePath), "B-V2-V2.html");
  assert.equal(
    await readFile(path.join(imported.target.projectRootPath, "B-V2.html"), "utf8"),
    candidateHtml,
  );
  assert.equal(await readFile(promoted.target.exactSourcePath, "utf8"), candidateHtml);
  const transaction = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  assert.equal(transaction.finalWorkingCopyRelativePath, "B-V2-V2.html");
  assert.equal(transaction.pathAllocationOrdinal, 1);
});

test("request finalization creates a reviewable Candidate only, and manifest path traversal is refused", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_workflow",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "candidate lifecycle",
      comments: [{
        commentId: "comment_candidate_lifecycle",
        text: "candidate lifecycle",
        target: { targetId: "target_candidate_lifecycle" },
      }],
      targets: [{ targetId: "target_candidate_lifecycle" }],
    },
    prompt: "# Frozen candidate request\n",
  });
  assert.equal(prepared.status, "processing");
  assert.equal(prepared.proposedVersionId, "ver_0002");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: html("request candidate"),
  });
  assert.equal(completed.status, "candidate-ready");
  assert.equal(completed.candidate.status, "pending-review");
  const beforeAdoption = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.equal(beforeAdoption.latestOfficialVersionId, "ver_0001");
  assert.equal(beforeAdoption.versions.length, 1);

  const manifestPath = path.join(imported.target.projectRootPath, ".pageroot", "manifest.json");
  const tampered = await json(manifestPath);
  tampered.workingCopies[0].sourceRelativePath = "../escape.html";
  await writeFile(manifestPath, JSON.stringify(tampered), "utf8");
  await assert.rejects(
    value.repository.resolveOpenTarget({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "INVALID_RELATIVE_PATH" || error.code === "PATH_ESCAPES_PROJECT"),
  );
});

test("request finalization seals Candidate impact against its requested Stable ID targets", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "candidate-impact.html", html("V1"));
  const baseHtml = await readFile(imported.target.exactSourcePath, "utf8");
  const identity = inspectSourceElementIdentity(baseHtml);
  const targetId = identity.elements.find((element) => element.tagName === "h1")?.pagerootId;
  const outsideId = identity.elements.find((element) => element.tagName === "title")?.pagerootId;
  assert.ok(targetId);
  assert.ok(outsideId);
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_candidate_impact",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "验证评论目标之外的修改提示",
      comments: [],
      changeEvents: [],
      instructions: [{
        instructionId: "instruction_h1",
        text: "只修改标题。",
        targetRefs: ["target_h1"],
      }],
      targets: [{
        targetId: "target_h1",
        elementId: targetId,
        label: "页面标题",
        level: "module",
        selector: "h1",
        resolution: "exact",
      }],
    },
    prompt: "# Candidate impact\n",
  });
  const candidateHtml = baseHtml
    .replace(">V1</title>", ">V1 页面标题</title>")
    .replace(">V1</h1>", ">V1 页面标题</h1>");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  assert.equal(completed.candidate.assessment.requestedTargetCount, 1);
  assert.deepEqual(completed.candidate.assessment.changedElementIdSample, [targetId, outsideId].sort());
  assert.equal(completed.candidate.assessment.outsideTargetCount, 1);
  assert.deepEqual(completed.candidate.assessment.outsideTargetElementIdSample, [outsideId]);
  assert.equal(completed.candidate.assessment.truncated, false);
  const reread = await value.repository.readCandidate({
    target: imported.target,
    candidateId: completed.candidate.candidateId,
  });
  assert.deepEqual(
    reread.candidate.assessment.outsideTargetElementIdSample,
    [outsideId],
  );
});

test("request finalization treats a comment root and its descendants as one allowed impact scope", async (t) => {
  const value = await fixture(t);
  const ids = {
    html: "pr1_11111111111141118111111111111111",
    head: "pr1_22222222222242229222222222222222",
    title: "pr1_3333333333334333a333333333333333",
    body: "pr1_4444444444444444b444444444444444",
    section: "pr1_77777777777747778077777777777777",
    heading: "pr1_88888888888848888088888888888888",
    paragraph: "pr1_99999999999949999099999999999999",
    outside: "pr1_aaaaaaaabbbb4ccc8ddddeeeeeeeeeee",
  };
  const baseHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Scope</title></head><body data-pageroot-id="${ids.body}"><section data-pageroot-id="${ids.section}"><h2 data-pageroot-id="${ids.heading}">标题</h2><p data-pageroot-id="${ids.paragraph}">正文</p></section><aside data-pageroot-id="${ids.outside}">旁支</aside></body></html>`;
  const imported = await importSource(value, "comment-root-scope.html", baseHtml);
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_comment_root_scope",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "评论整个 Section",
      comments: [{
        commentId: "comment_section",
        text: "调整 Section 内的标题和正文",
        target: {
          targetId: "target_section",
          elementId: ids.section,
          level: "module",
          selector: "section",
          resolution: "exact",
        },
      }],
      targets: [{
        targetId: "target_section",
        elementId: ids.section,
        level: "module",
        selector: "section",
        resolution: "exact",
      }],
      instructions: [{
        instructionId: "instruction_section",
        text: "更新 Section 内容",
        targetRefs: ["target_section"],
      }],
    },
    prompt: "# Section scope\n",
  });
  const candidate = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: baseHtml
      .replace(">标题</h2>", ">更新标题</h2>")
      .replace(">正文</p>", ">更新正文</p>"),
  });
  assert.equal(candidate.status, "candidate-ready");
  assert.equal(candidate.candidate.assessment.requestedTargetCount, 1);
  assert.deepEqual(
    candidate.candidate.assessment.changedElementIdSample,
    [ids.heading, ids.paragraph].sort(),
  );
  assert.equal(candidate.candidate.assessment.outsideTargetCount, 0);
});

test("a replaced private promotion file fails recovery without deleting user bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-tamper.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_tampered_promotion",
    candidateId: "candidate_tampered_promotion_0001",
    html: html("candidate before user replacement"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-prepared",
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const transactionPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  );
  const transaction = await json(transactionPath);
  const preparedPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...transaction.preparedWorkingCopyRelativePath.split("/"),
  );
  const replacement = html("user replaced preparation file");
  await rm(preparedPath);
  await writeFile(preparedPath, replacement, "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_PREPARED_FILE_CHANGED",
  );
  assert.equal(await readFile(preparedPath, "utf8"), replacement);
});

test("a replaced published promotion file fails recovery without deleting user bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "published-promotion.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_replaced_published_promotion",
    candidateId: "candidate_replaced_published_promotion_0001",
    html: html("Candidate before visible replacement"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const replacement = html("user-owned replacement after publication");
  let publishedPath = null;
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name === "promotion-working-copy-created") {
        const transaction = await json(path.join(details.transactionRoot, "transaction.json"));
        publishedPath = path.join(
          imported.target.projectRootPath,
          transaction.finalWorkingCopyRelativePath,
        );
        await rm(publishedPath);
        await writeFile(publishedPath, replacement, "utf8");
        return true;
      }
      return false;
    },
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  assert.ok(publishedPath);

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_PATH_REPLACED",
  );
  assert.equal(await readFile(publishedPath, "utf8"), replacement);
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("promotion fault recovery leaves exactly one formal Version and regular files at every commit point", async (t) => {
  for (const failpoint of [
    "promotion-prepared",
    "promotion-snapshot-created",
    "promotion-working-copy-prepared",
    "promotion-working-copy-created",
    "promotion-manifest-committed",
    "promotion-candidate-promoted",
    "promotion-completed",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value);
    const candidate = await value.repository.createCandidate({
      target: imported.target,
      requestId: "req_fault",
      candidateId: "candidate_fault_0001",
      html: html("fault recovery candidate"),
      expectedSourceSha256: imported.target.sourceSha256,
    });
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.promoteCandidate({
        target: imported.target,
        candidateId: candidate.candidate.candidateId,
        decisionOperationId: `promote_${candidate.candidate.candidateId}`,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );
    const recovery = new ProjectFileRepository({ projectsRoot: value.projects });
    const reopened = await recovery.workspace({
      sourcePath: imported.target.exactSourcePath,
    });
    assert.equal(reopened.manifest.latestOfficialVersionId, "ver_0002");
    const recovered = await recovery.recoverProject({
      projectRootPath: imported.target.projectRootPath,
    });
    assert.deepEqual(recovered, []);
    const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
    assert.equal(manifest.latestOfficialVersionId, "ver_0002");
    const htmlInfo = await lstat(path.join(imported.target.projectRootPath, "原文件-V2.html"));
    assert.equal(htmlInfo.isFile(), true);
    assert.equal(htmlInfo.isSymbolicLink(), false);
    await assert.rejects(
      readFile(path.join(imported.target.projectRootPath, "原文件-V2-V2.html")),
      (error) => error?.code === "ENOENT",
      failpoint,
    );
  }
});
