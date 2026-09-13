import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  activeManagedLocatorForActivatedPath,
  activeManagedLocatorFromOpenTarget,
  createActiveManagedReconcileOperationId,
  normalizeActiveManagedLocator,
  rebaseActiveManagedLocator,
  sameManagedPath,
} from "../desktop/active-managed-locator.mjs";

test("managed reconcile operation IDs are explicit and validated", () => {
  assert.equal(
    createActiveManagedReconcileOperationId(
      () => "12345678-90ab-cdef-1234-567890abcdef",
    ),
    "reconcile_1234567890abcdef1234567890abcdef",
  );
  assert.throws(
    () => createActiveManagedReconcileOperationId(() => "not-a-uuid"),
    /操作 ID 无效/u,
  );
});

const LOCATOR = {
  projectId: "project_aaaaaaaaaaaaaaaa",
  documentId: "doc_bbbbbbbbbbbbbbbb",
  workingCopyId: "work_ver_0001",
  versionId: "ver_0001",
  sourcePath: "/tmp/PageRoot/项目/demo/page-V1.html",
  sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  projectRootPath: "/tmp/PageRoot/项目/demo",
};

test("old desktop state without activeManagedLocator stays inert", () => {
  assert.equal(normalizeActiveManagedLocator(undefined), null);
  assert.equal(normalizeActiveManagedLocator(null), null);
  assert.equal(normalizeActiveManagedLocator({ activePath: "/tmp/page.html" }), null);
  assert.equal(normalizeActiveManagedLocator({
    ...LOCATOR,
    sourceSha256: "not-a-hash",
  }), null);
});

test("a valid locator round-trips and rebases with active/recent paths", () => {
  const normalized = normalizeActiveManagedLocator(LOCATOR);
  assert.equal(normalized.projectId, LOCATOR.projectId);
  assert.equal(normalized.sourcePath, path.resolve(LOCATOR.sourcePath));
  assert.equal(normalized.projectRootPath, path.resolve(LOCATOR.projectRootPath));

  const nextPath = "/tmp/PageRoot/项目/demo/Finder renamed.html";
  const rebased = rebaseActiveManagedLocator(normalized, {
    previousSourcePath: LOCATOR.sourcePath,
    nextSourcePath: nextPath,
    sourceSha256: LOCATOR.sourceSha256,
    projectRootPath: "/tmp/PageRoot/项目/demo-renamed",
  });
  assert.equal(rebased.workingCopyId, "work_ver_0001");
  assert.equal(rebased.versionId, "ver_0001");
  assert.equal(rebased.sourcePath, path.resolve(nextPath));
  assert.equal(rebased.projectRootPath, path.resolve("/tmp/PageRoot/项目/demo-renamed"));

  const unrelated = rebaseActiveManagedLocator(normalized, {
    previousSourcePath: "/tmp/other.html",
    nextSourcePath: "/tmp/other-renamed.html",
  });
  assert.equal(unrelated.sourcePath, normalized.sourcePath);
});

test("an OpenTarget can seed the restart locator cache", () => {
  const locator = activeManagedLocatorFromOpenTarget({
    projectId: LOCATOR.projectId,
    documentId: LOCATOR.documentId,
    workingCopyId: LOCATOR.workingCopyId,
    versionId: LOCATOR.versionId,
    exactSourcePath: LOCATOR.sourcePath,
    sourceSha256: LOCATOR.sourceSha256,
    projectRootPath: LOCATOR.projectRootPath,
    targetKind: "working-copy",
  });
  assert.deepEqual(locator, normalizeActiveManagedLocator(LOCATOR));
});

test("activated path spelling wins over OpenTarget aliases and rebases across /var", () => {
  const aliasedRoot = "/var/folders/jx/example/T/pageroot/demo";
  const aliasedPath = `${aliasedRoot}/page-V1.html`;
  const activatedPath = `/private${aliasedPath}`;
  const locator = activeManagedLocatorForActivatedPath({
    projectId: LOCATOR.projectId,
    documentId: LOCATOR.documentId,
    workingCopyId: LOCATOR.workingCopyId,
    versionId: LOCATOR.versionId,
    exactSourcePath: aliasedPath,
    sourceSha256: LOCATOR.sourceSha256,
    projectRootPath: aliasedRoot,
    targetKind: "working-copy",
  }, activatedPath, LOCATOR.sourceSha256);
  assert.equal(locator.sourcePath, path.resolve(activatedPath));

  const finderPath = `/private${aliasedRoot}/Finder renamed.html`;
  const rebased = rebaseActiveManagedLocator(locator, {
    previousSourcePath: aliasedPath,
    nextSourcePath: finderPath,
  });
  assert.equal(rebased.sourcePath, path.resolve(finderPath));
  assert.equal(rebased.workingCopyId, "work_ver_0001");
});


test("publication reads match macOS path aliases without matching a different file", () => {
  assert.equal(sameManagedPath("/private/var/folders/test/page.html", "/var/folders/test/page.html"), true);
  assert.equal(sameManagedPath("/private/tmp/test/page.html", "/tmp/test/page.html"), true);
  assert.equal(sameManagedPath("/private/var/folders/test/page.html", "/var/folders/test/other.html"), false);
  assert.equal(sameManagedPath(null, "/tmp/page.html"), false);
});
