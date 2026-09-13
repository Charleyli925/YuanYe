import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Exact persisted v4 shape authored by the retired activation command. Test
// setup writes the old record directly; production can only replay/confirm it.
export async function seedLegacyHistoryActivation(input) {
  const { target, versionId, operationId, expectedActiveWorkingCopyId } = input;
  const root = path.join(target.projectRootPath, ".pageroot");
  const runtimePath = path.join(root, "runtime-state.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(runtime.schemaVersion, "4.0.0");
  assert.equal(runtime.projectId, target.projectId);
  assert.equal(runtime.documentId, target.documentId);
  assert.equal(runtime.activeWorkingCopyId, expectedActiveWorkingCopyId);
  assert.equal(runtime.activeRequest, null);
  const matches = manifest.workingCopies.filter((entry) => (
    entry.versionId === versionId && entry.basedOnVersionId === versionId
  ));
  assert.equal(matches.length, 1);
  runtime.activeWorkingCopyId = matches[0].workingCopyId;
  runtime.historyActivation = {
    operationId,
    projectId: target.projectId,
    documentId: target.documentId,
    previousWorkingCopyId: expectedActiveWorkingCopyId,
    activatedWorkingCopyId: matches[0].workingCopyId,
    versionId,
    state: "desktop-pending",
    createdAt: "2026-08-12T00:00:03.000Z",
  };
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  return input;
}
