import { seedLegacyHistoryActivation } from "./helpers/legacy-history-activation.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import path from "node:path";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fixture, html, importSource, promoteNextVersion } from "./project-file-repository-harness.mjs";

test("history creation allocates V9 from V3 and replays the same operation", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  let target = imported.target;
  for (let ordinal = 2; ordinal <= 8; ordinal += 1) target = await promoteNextVersion(value.repository, target, `Version${ordinal}`);
  const before = await readFile(target.exactSourcePath, "utf8");
  const request = { target, versionId: "ver_0003", operationId: "history_create_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: sha256(Buffer.from(html("Version3"))) };
  const result = await value.repository.createVersionFromHistory(request);
  assert.equal(result.status, "created");
  assert.equal(result.versionId, "ver_0009");
  assert.equal(result.basedOnVersionId, "ver_0003");
  assert.equal(result.previousVersionId, "ver_0008");
  assert.match(await readFile(result.sourcePath, "utf8"), /Version3/);
  assert.equal(await readFile(target.exactSourcePath, "utf8"), before);
  assert.deepEqual(await value.repository.createVersionFromHistory(request), result);
  assert.deepEqual(await value.repository.queryHistoryCreation({ target, operationId: request.operationId }), result);
  const workspace = await value.repository.workspace({ sourcePath: result.sourcePath });
  assert.equal(workspace.manifest.versions.length, 9);
  assert.equal(workspace.runtime.activeWorkingCopyId, "work_ver_0009");
  assert.equal(workspace.manifest.versions.at(-1).sourceType, "history-copy");
});

for (const stage of ["prepared", "working-copy-prepared", "working-copy-created", "manifest-committed", "completed"]) {
  test(`history creation recovers after ${stage} without duplicating the Version`, async (t) => {
    const value = await fixture(t);
    const { target } = await importSource(value);
    await value.repository.saveDraft({ target, operationId: "draftop_history_preserved", expectedDraftRevision: 0,
      comments: [{ commentId: "comment_preserve", text: "keep original task" }], changeEvents: [], deletedCommentIds: [] });
    const draftPath = path.join(target.projectRootPath, ".pageroot/drafts/work_ver_0001.json");
    const draftBefore = await readFile(draftPath, "utf8");
    const rulesBefore = await readFile(path.join(target.projectRootPath, "PROJECT.md"), "utf8");
    const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: (name) => name === `history-creation-${stage}` });
    const request = { target, versionId: "ver_0001", operationId: "history_recover_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
    await assert.rejects(repository.createVersionFromHistory(request), { code: "INJECTED_FAILPOINT" });
    const recovered = new ProjectFileRepository({ projectsRoot: value.projects });
    await recovered.recoverProject({ projectRootPath: target.projectRootPath });
    const result = await recovered.queryHistoryCreation({ target, operationId: request.operationId });
    assert.equal(result.status, "created");
    assert.equal(result.versionId, "ver_0002");
    assert.deepEqual(await recovered.createVersionFromHistory(request), result);
    const workspace = await recovered.workspace({ sourcePath: result.sourcePath });
    assert.equal(workspace.manifest.versions.length, 2);
    assert.equal(workspace.draft, null);
    assert.equal(await readFile(draftPath, "utf8"), draftBefore);
    assert.equal(await readFile(path.join(target.projectRootPath, "PROJECT.md"), "utf8"), rulesBefore);
    const opened = await recovered.queryHistoryCreation({ target, operationId: request.operationId, markOpened: true });
    assert.ok(opened.openedAt);
    assert.equal((await recovered.queryHistoryCreation({ target, operationId: request.operationId })).openedAt, opened.openedAt);
  });
}

test("two repository instances replay one creation and preserve a colliding user file", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  let collisionPath;
  const collideBeforePublication = async (name, details) => {
    if (name === "history-creation-before-link" && !collisionPath) {
      collisionPath = details.visiblePath;
      await writeFile(collisionPath, "user owned file");
    }
    return false;
  };
  const first = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: collideBeforePublication });
  const second = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: collideBeforePublication });
  const request = { target, versionId: "ver_0001", operationId: "history_concurrent_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  const [a, b] = await Promise.all([first.createVersionFromHistory(request), second.createVersionFromHistory(request)]);
  assert.deepEqual(a, b);
  assert.notEqual(a.sourcePath, collisionPath);
  assert.equal(await readFile(collisionPath, "utf8"), "user owned file");
});

test("creation refuses changed snapshots, changed current bytes and pending Candidates", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const request = { target, versionId: "ver_0001", operationId: "history_reject_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, expectedSnapshotSha256: `sha256:${"a".repeat(64)}` }), { code: "VERSION_SNAPSHOT_HASH_MISMATCH" });
  assert.equal((await value.repository.queryHistoryCreation({ target, operationId: request.operationId })).status, "not-created");
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, expectedSourceSha256: `sha256:${"b".repeat(64)}` }), { code: "HISTORY_CREATION_SOURCE_CHANGED" });
  await value.repository.createCandidate({ target, candidateId: "candidate_history_pending_0001", requestId: "req_history_pending_0001", html: html("candidate"), expectedSourceSha256: target.sourceSha256 });
  await assert.rejects(value.repository.createVersionFromHistory(request), { code: "HISTORY_CREATION_RUN_LOCKED" });
});

test("a replayed operation cannot change its source and a query cannot cross project identity", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const request = { target, versionId: "ver_0001", operationId: "history_identity_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  const result = await value.repository.createVersionFromHistory(request);
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, versionId: "ver_0002" }), { code: "HISTORY_CREATION_OPERATION_MISMATCH" });
  const b = await importSource(value, "second.html", html("B"));
  const other = await value.repository.queryHistoryCreation({ target: b.target, operationId: request.operationId });
  assert.equal(other.status, "not-created");
  assert.equal(other.projectId, b.target.projectId);
  await writeFile(result.sourcePath, html("edited after creation"));
  assert.equal((await value.repository.queryHistoryCreation({ target, operationId: request.operationId })).versionId, result.versionId);
});

test("a changed source before manifest commit aborts without overwriting user files and does not block restart", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: async (name) => {
    if (name === "history-creation-working-copy-created") await writeFile(target.exactSourcePath, html("external current"));
    return false;
  } });
  const request = { target, versionId: "ver_0001", operationId: "history_abort_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  const outcome = await repository.createVersionFromHistory(request);
  assert.equal(outcome.status, "not-created");
  assert.equal(outcome.aborted, true);
  assert.equal(await readFile(target.exactSourcePath, "utf8"), html("external current"));
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.recoverProject({ projectRootPath: target.projectRootPath });
  assert.equal((await restarted.queryHistoryCreation({ target, operationId: request.operationId })).status, "not-created");
  await writeFile(target.exactSourcePath, html("V1"));
  const next = await restarted.createVersionFromHistory({ ...request, operationId: "history_after_abort_0001" });
  assert.equal(next.versionId, "ver_0002");
  await restarted.recoverProject({ projectRootPath: target.projectRootPath });
  assert.equal((await restarted.workspace({ sourcePath: next.sourcePath })).manifest.versions.length, 2);
});

test("legacy current Working Copy remains selected until explicit historical creation", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const latest = await promoteNextVersion(value.repository, target, "latest");
  const activated = await value.repository.replayHistoryVersionActivation(await seedLegacyHistoryActivation({ target: latest, versionId: "ver_0001",
    operationId: "legacy_activation_0001", expectedActiveWorkingCopyId: "work_ver_0002" }));
  await value.repository.confirmVersionWorkingCopyActivation({ target: latest, operationId: "legacy_activation_0001",
    previousWorkingCopyId: "work_ver_0002", activatedWorkingCopyId: "work_ver_0001", versionId: "ver_0001" });
  const before = await value.repository.workspace({ sourcePath: activated.target.exactSourcePath });
  assert.equal(before.runtime.activeWorkingCopyId, "work_ver_0001");
  assert.equal(before.manifest.latestOfficialVersionId, "ver_0002");
  const created = await value.repository.createVersionFromHistory({ target: activated.target, versionId: "ver_0001",
    operationId: "history_legacy_create_0001", expectedSourceSha256: activated.target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 });
  assert.equal(created.versionId, "ver_0003");
  assert.equal(created.basedOnVersionId, "ver_0001");
  assert.equal(created.previousVersionId, "ver_0002");
  assert.equal(await readFile(activated.target.exactSourcePath, "utf8"), html("V1"));
});


test("completed creation survives registered rename and reports supersession without changing its fact", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const operationId = "history_rename_0001";
  const created = await value.repository.createVersionFromHistory({ target, versionId: "ver_0001", operationId,
    expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 });
  await value.repository.workspace({ sourcePath: created.sourcePath });
  await value.repository.queryHistoryCreation({ target, operationId, markOpened: true });
  const renamedPath = path.join(target.projectRootPath, "renamed-created.html");
  await rename(created.sourcePath, renamedPath);
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const workspace = await restarted.workspace({ sourcePath: renamedPath });
  const receipt = await restarted.queryHistoryCreation({ target: workspace.target, operationId });
  assert.equal(receipt.status, "created");
  assert.equal(receipt.versionId, created.versionId);
  assert.equal(receipt.sourcePath, renamedPath);
  assert.equal(receipt.recoveryState, "opened");
  const next = await promoteNextVersion(restarted, workspace.target, "after_history_rename");
  const older = await new ProjectFileRepository({ projectsRoot: value.projects }).queryHistoryCreation({ target: next, operationId });
  assert.equal(older.recoveryState, "superseded");
  assert.equal(older.versionId, created.versionId);
});

for (const stage of ["working-copy-prepared", "working-copy-created"]) {
  for (const replacement of [null, "prepared", "visible"]) {
    if (stage === "working-copy-prepared" && replacement === "visible") continue;
    test(`history recovery ${stage}: ${replacement || "observation drift"}`, async (t) => {
      const value = await fixture(t);
      const { target } = await importSource(value);
      const operationId = "history_identity_recovery_0001";
      const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: (name) => name === `history-creation-${stage}` });
      await assert.rejects(repository.createVersionFromHistory({ target, versionId: "ver_0001", operationId,
        expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 }), { code: "INJECTED_FAILPOINT" });
      const directory = path.join(target.projectRootPath, ".pageroot/transactions", `history_${operationId}`);
      const journalPath = path.join(directory, "transaction.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      // Durable observations differ from this process; no authority is inferred
      // from these values. Current anchor links must still prove the object.
      journal.preparedFileIdentity.device += 17;
      journal.preparedFileIdentity.inode += 23;
      await writeFile(journalPath, JSON.stringify(journal));
      if (replacement) {
        const file = replacement === "prepared" ? path.join(directory, "working-copy.html")
          : path.join(target.projectRootPath, journal.finalWorkingCopyRelativePath);
        const bytes = await readFile(file);
        await unlink(file);
        await writeFile(file, bytes);
      }
      const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
      await restarted.recoverProject({ projectRootPath: target.projectRootPath });
      const result = await restarted.queryHistoryCreation({ target, operationId });
      assert.equal(result.status, replacement ? "not-created" : "created");
      if (replacement) assert.equal(result.code, "HISTORY_CREATION_FILE_CHANGED");
      else assert.equal(result.versionId, "ver_0002");
      assert.equal(await readFile(target.exactSourcePath, "utf8"), html("V1"));
    });
  }
}
