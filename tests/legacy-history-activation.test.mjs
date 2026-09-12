import assert from "node:assert/strict";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { fixture, html, importSource, promoteNextVersion } from "./project-file-repository-harness.mjs";
import { seedLegacyHistoryActivation } from "./helpers/legacy-history-activation.mjs";

async function diskBytes(root, relative = "") {
  const result = {};
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await diskBytes(root, name));
    else result[name] = await readFile(path.join(root, name));
  }
  return result;
}

test("retired history commands reject before source reconciliation or registered-root repair", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const active = await promoteNextVersion(value.repository, target, "legacy_v2");
  await writeFile(active.exactSourcePath, html("external predecessor edit"));
  const replay = { target: active, versionId: "ver_0001", operationId: "retired_history_0001", expectedActiveWorkingCopyId: "work_ver_0002" };
  const confirm = { target: active, operationId: replay.operationId, previousWorkingCopyId: "work_ver_0002", activatedWorkingCopyId: "work_ver_0001", versionId: "ver_0001" };
  const before = await diskBytes(value.projects);
  await assert.rejects(value.repository.replayHistoryVersionActivation(replay), { code: "HISTORY_ACTIVATION_RECEIPT_MISMATCH" });
  await assert.rejects(value.repository.confirmVersionWorkingCopyActivation(confirm), { code: "HISTORY_ACTIVATION_RECEIPT_MISMATCH" });
  assert.deepEqual(await diskBytes(value.projects), before);

  // The old route must not turn a failed activation into Registry rename repair.
  const movedRoot = `${active.projectRootPath}-renamed`;
  await rename(active.projectRootPath, movedRoot);
  const afterMove = await diskBytes(value.projects);
  await assert.rejects(value.repository.replayHistoryVersionActivation(replay), { code: "HISTORY_ACTIVATION_RECEIPT_MISMATCH" });
  await assert.rejects(value.repository.confirmVersionWorkingCopyActivation(confirm), { code: "HISTORY_ACTIVATION_RECEIPT_MISMATCH" });
  assert.deepEqual(await diskBytes(value.projects), afterMove);
});

test("legacy receipt replays across restart and rejects mismatched identity without changing disk", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const active = await promoteNextVersion(value.repository, target, "legacy_v2");
  const replay = await seedLegacyHistoryActivation({ target: active, versionId: "ver_0001", operationId: "legacy_replay_0001", expectedActiveWorkingCopyId: "work_ver_0002" });
  const repository = new ProjectFileRepository({ projectsRoot: value.projects });
  const runtimePath = path.join(active.projectRootPath, ".pageroot/runtime-state.json");
  const runtimeBefore = await readFile(runtimePath);
  const replayed = await repository.replayHistoryVersionActivation({ ...replay, operationId: "new_click_after_restart_0001" });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.activated, false);
  assert.equal(replayed.historyActivation.operationId, replay.operationId);
  assert.equal(replayed.target.workingCopyId, "work_ver_0001");
  assert.deepEqual(await readFile(runtimePath), runtimeBefore);
  const replayedFromActivatedTarget = await repository.replayHistoryVersionActivation({
    ...replay, target: replayed.target, operationId: "activated_target_retry_0001",
  });
  assert.equal(replayedFromActivatedTarget.historyActivation.operationId, replay.operationId);
  assert.equal(replayedFromActivatedTarget.target.workingCopyId, "work_ver_0001");
  assert.deepEqual(await readFile(runtimePath), runtimeBefore);

  await writeFile(active.exactSourcePath, html("external predecessor edit"));
  const before = await diskBytes(value.projects);
  for (const changed of [
    { versionId: "ver_0002" },
    { expectedActiveWorkingCopyId: "work_ver_0001" },
    { target: { ...active, workingCopyId: "work_ver_0001" } },
    { target: { ...active, exactSourcePath: target.exactSourcePath } },
    { target: { ...active, projectId: `project_${"f".repeat(32)}` } },
    { target: { ...active, documentId: `doc_${"f".repeat(32)}` } },
  ]) {
    await assert.rejects(repository.replayHistoryVersionActivation({ ...replay, ...changed }), {
      code: changed.target?.projectId !== undefined && changed.target.projectId !== active.projectId
        ? "REGISTERED_PROJECT_UNAVAILABLE"
        : changed.target?.documentId !== undefined && changed.target.documentId !== active.documentId
          ? "PROJECT_IDENTITY_CHANGED"
          : "HISTORY_ACTIVATION_RECEIPT_MISMATCH",
    });
    assert.deepEqual(await diskBytes(value.projects), before);
  }
  const confirm = { target: active, operationId: replay.operationId, previousWorkingCopyId: "work_ver_0002", activatedWorkingCopyId: "work_ver_0001", versionId: "ver_0001" };
  for (const changed of [
    { operationId: "unknown_operation_0001" },
    { previousWorkingCopyId: "work_ver_0001" },
    { activatedWorkingCopyId: "work_ver_0002" },
    { versionId: "ver_0002" },
  ]) {
    await assert.rejects(repository.confirmVersionWorkingCopyActivation({ ...confirm, ...changed }), { code: "HISTORY_ACTIVATION_RECEIPT_MISMATCH" });
    assert.deepEqual(await diskBytes(value.projects), before);
  }
});

test("legacy replay still rejects tampered immutable snapshots and missing Working Copies", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const active = await promoteNextVersion(value.repository, target, "legacy_v2");
  const replay = await seedLegacyHistoryActivation({ target: active, versionId: "ver_0001", operationId: "legacy_integrity_0001", expectedActiveWorkingCopyId: "work_ver_0002" });
  const snapshotPath = path.join(active.projectRootPath, ".pageroot/versions/ver_0001/index.html");
  const snapshot = await readFile(snapshotPath);
  await writeFile(snapshotPath, html("tampered snapshot"));
  await assert.rejects(value.repository.replayHistoryVersionActivation(replay), { code: "VERSION_SNAPSHOT_HASH_MISMATCH" });
  await writeFile(snapshotPath, snapshot);
  await rename(target.exactSourcePath, `${target.exactSourcePath}.missing`);
  await assert.rejects(value.repository.replayHistoryVersionActivation(replay), { code: "SOURCE_NOT_FOUND" });
  const runtime = JSON.parse(await readFile(path.join(active.projectRootPath, ".pageroot/runtime-state.json"), "utf8"));
  assert.equal(runtime.activeWorkingCopyId, "work_ver_0001");
  assert.equal(runtime.historyActivation.operationId, replay.operationId);
});
