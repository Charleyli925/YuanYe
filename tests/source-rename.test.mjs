import assert from "node:assert/strict";
import {
  access,
  link,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  htmlSha256,
  readHtmlFile,
} from "../desktop/project-files.mjs";
import {
  recoverPendingSourceRename,
  renameHtmlSource,
  validateSourceRenamePayload,
} from "../desktop/source-rename.mjs";

const HTML = "<!doctype html><html><body><h1>源页测试</h1></body></html>";
const SOURCE_SHA256 = htmlSha256(HTML);

function projectState(sourcePath) {
  return {
    version: 2,
    activePath: sourcePath,
    recent: [{
      path: sourcePath,
      name: path.basename(sourcePath),
      lastOpenedAt: 100,
    }],
    pendingRename: null,
    lastRename: null,
    activeEffect: null,
    activeEffectGeneration: 0,
    activeManagedLocator: null,
  };
}

function renamePayload(
  sourcePath,
  stem = "新的文件名",
  operationId = "rename_test_operation_0001",
) {
  return {
    operationId,
    sourcePath,
    stem,
    expectedSha256: SOURCE_SHA256,
  };
}

async function createFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "pageroot-rename-test-"));
  const sourcePath = path.join(directory, "原文件.html");
  await writeFile(sourcePath, HTML, "utf8");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    sourcePath: await realpath(sourcePath),
  };
}

function serviceOptions(payload, state, writes, rebinds) {
  return {
    payload,
    state,
    persistState: async () => {
      writes.push(structuredClone(state));
    },
    resolveKnownSource: realpath,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    rebindWorkspace: async (sourcePath, expectedSha256) => {
      rebinds.push({ sourcePath, expectedSha256 });
      return true;
    },
    platform: "linux",
    now: () => 1_000,
  };
}

test("source rename preserves exact bytes and atomically moves active and recent identity", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const rebinds = [];
  const result = await renameHtmlSource(serviceOptions(
    renamePayload(fixture.sourcePath),
    state,
    writes,
    rebinds,
  ));
  const targetPath = await realpath(
    path.join(fixture.directory, "新的文件名.html"),
  );

  assert.equal(result.sourcePath, targetPath);
  assert.equal(result.previousSourcePath, fixture.sourcePath);
  assert.equal(result.stem, "新的文件名");
  assert.equal(result.extension, ".html");
  assert.equal(result.sha256, SOURCE_SHA256);
  assert.equal(result.workspaceRelinked, true);
  assert.equal(await readFile(targetPath, "utf8"), HTML);
  await assert.rejects(access(fixture.sourcePath), { code: "ENOENT" });
  assert.equal(state.activePath, targetPath);
  assert.deepEqual(state.recent.map((entry) => entry.path), [targetPath]);
  assert.equal(state.recent[0].name, "新的文件名.html");
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.operationId, "rename_test_operation_0001");
  assert.equal(state.activeEffect, null);
  assert.equal(state.activeEffectGeneration, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(rebinds, [{
    sourcePath: targetPath,
    expectedSha256: SOURCE_SHA256,
  }]);
});

test("source rename invalidates managed and generated activation predecessors across A-to-C-to-A", async (t) => {
  for (const kind of ["managed-working-copy", "generated-version"]) {
    const fixture = await createFixture(t);
    const state = projectState(fixture.sourcePath);
    const originalPath = fixture.sourcePath;
    state.activeEffectGeneration = 7;
    state.activeEffect = {
      operationId: `pending_${kind}_activation_0001`,
      kind,
      effectKind: "active-path",
      projectId: "project_rename_aba",
      documentId: kind === "managed-working-copy" ? "doc_rename_aba_0001" : null,
      workingCopyId: kind === "managed-working-copy" ? "work_ver_0001" : null,
      versionId: "ver_0001",
      expectedSha256: SOURCE_SHA256,
      previousSourcePath: originalPath,
      nextSourcePath: path.join(fixture.directory, "待提交.html"),
      projectRootPath: fixture.directory,
      committedAt: 700,
    };
    const writes = [];

    const first = await renameHtmlSource(serviceOptions(
      renamePayload(originalPath, "中间路径", `rename_${kind}_to_c_0001`),
      state,
      writes,
      [],
    ));
    const second = await renameHtmlSource(serviceOptions(
      renamePayload(first.sourcePath, "原文件", `rename_${kind}_back_to_a_0001`),
      state,
      writes,
      [],
    ));

    assert.equal(second.sourcePath, originalPath);
    assert.equal(state.activePath, originalPath);
    assert.equal(state.activeEffect, null);
    assert.equal(state.activeEffectGeneration, 9);
    assert.equal(state.lastRename.operationId, `rename_${kind}_back_to_a_0001`);
    assert.equal(writes.length, 4);
  }
});

test("source rename refuses a live destination and does not overwrite either file", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "已有文件.html");
  await writeFile(destinationPath, "<html>已有内容</html>", "utf8");
  const state = projectState(fixture.sourcePath);
  const writes = [];

  await assert.rejects(
    renameHtmlSource(serviceOptions(
      renamePayload(fixture.sourcePath, "已有文件"),
      state,
      writes,
      [],
    )),
    (error) => {
      assert.equal(error.code, "RENAME_DESTINATION_EXISTS");
      assert.equal(error.message, "同一文件夹里已经有这个文件名。");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), HTML);
  assert.equal(await readFile(destinationPath, "utf8"), "<html>已有内容</html>");
  assert.equal(state.activePath, fixture.sourcePath);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 0);
});

test("source rename cannot overwrite a destination created after its preflight check", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "竞态目标.html");
  const racedHtml = "<html><body>竞态创建的内容</body></html>";
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const options = serviceOptions(
    renamePayload(fixture.sourcePath, "竞态目标"),
    state,
    writes,
    [],
  );
  options.linkFile = async (sourcePath, targetPath) => {
    await writeFile(targetPath, racedHtml, "utf8");
    return link(sourcePath, targetPath);
  };

  await assert.rejects(
    renameHtmlSource(options),
    (error) => {
      assert.equal(error.code, "RENAME_DESTINATION_EXISTS");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), HTML);
  assert.equal(await readFile(destinationPath, "utf8"), racedHtml);
  assert.equal(state.activePath, fixture.sourcePath);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 2);
});

test("source rename rolls back when the source identity changes after preflight", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "身份竞态.html");
  const replacementPath = path.join(fixture.directory, "外部替换.html");
  const replacementHtml = "<html><body>外部编辑器替换后的内容</body></html>";
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const options = serviceOptions(
    renamePayload(fixture.sourcePath, "身份竞态"),
    state,
    writes,
    [],
  );
  options.linkFile = async (sourcePath, targetPath) => {
    await writeFile(replacementPath, replacementHtml, "utf8");
    await rename(replacementPath, sourcePath);
    return link(sourcePath, targetPath);
  };

  await assert.rejects(
    renameHtmlSource(options),
    (error) => {
      assert.equal(error.code, "RENAME_SOURCE_CHANGED");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), replacementHtml);
  await assert.rejects(access(destinationPath), { code: "ENOENT" });
  assert.equal(state.activePath, fixture.sourcePath);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 2);
});

test("source rename restores the old name when content changes before final commit", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "内容竞态.html");
  const changedHtml = "<html><body>提交窗口中的外部修改</body></html>";
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const options = serviceOptions(
    renamePayload(fixture.sourcePath, "内容竞态"),
    state,
    writes,
    [],
  );
  const readProject = options.readProject;
  let reads = 0;
  options.readProject = async (sourcePath) => {
    reads += 1;
    if (reads === 3) await writeFile(sourcePath, changedHtml, "utf8");
    return readProject(sourcePath);
  };

  await assert.rejects(
    renameHtmlSource(options),
    (error) => {
      assert.equal(error.code, "RENAME_SOURCE_CHANGED");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), changedHtml);
  await assert.rejects(access(destinationPath), { code: "ENOENT" });
  assert.equal(state.activePath, fixture.sourcePath);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 2);
});

test("source rename recovers a no-replace move interrupted after linking the destination", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "中断后恢复.html");
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const options = serviceOptions(
    renamePayload(fixture.sourcePath, "中断后恢复"),
    state,
    writes,
    [],
  );
  let failOldPathRemoval = true;
  options.unlinkFile = async (sourcePath) => {
    if (failOldPathRemoval) {
      failOldPathRemoval = false;
      throw Object.assign(new Error("测试注入：旧路径尚未删除。"), {
        code: "EIO",
      });
    }
    return unlink(sourcePath);
  };

  await assert.rejects(
    renameHtmlSource(options),
    (error) => {
      assert.equal(error.code, "RENAME_MOVE_INCOMPLETE");
      assert.equal(error.destinationCreated, true);
      return true;
    },
  );

  const [previousInformation, nextInformation] = await Promise.all([
    lstat(fixture.sourcePath),
    lstat(destinationPath),
  ]);
  assert.equal(previousInformation.dev, nextInformation.dev);
  assert.equal(previousInformation.ino, nextInformation.ino);
  assert.equal(state.pendingRename.operationId, "rename_test_operation_0001");
  assert.equal(writes.length, 1);

  const recovery = await recoverPendingSourceRename({
    state,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    persistState: async () => writes.push(structuredClone(state)),
    platform: "linux",
    now: () => 1_001,
  });

  assert.equal(recovery.recovered, true);
  assert.equal(await readFile(destinationPath, "utf8"), HTML);
  await assert.rejects(access(fixture.sourcePath), { code: "ENOENT" });
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.completedAt, 1_001);
  assert.equal(state.activeEffect, null);
  assert.equal(state.activeEffectGeneration, 1);
  assert.equal(writes.length, 2);
});

test("source rename rejects a stale content Hash before creating an intent record", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const payload = {
    ...renamePayload(fixture.sourcePath),
    expectedSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  await assert.rejects(
    renameHtmlSource(serviceOptions(payload, state, writes, [])),
    (error) => {
      assert.equal(error.code, "RENAME_SOURCE_CHANGED");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), HTML);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 0);
});

test("prepared rename recovers after a crash before the filesystem move", async (t) => {
  const fixture = await createFixture(t);
  const targetPath = path.join(fixture.directory, "恢复后的文件名.html");
  const state = projectState(fixture.sourcePath);
  state.pendingRename = {
    version: 1,
    operationId: "rename_recovery_before_move",
    previousPath: fixture.sourcePath,
    sourcePath: targetPath,
    stem: "恢复后的文件名",
    expectedSha256: SOURCE_SHA256,
    preparedAt: 900,
  };
  const writes = [];

  const recovery = await recoverPendingSourceRename({
    state,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    persistState: async () => writes.push(structuredClone(state)),
    platform: "linux",
    now: () => 1_000,
  });
  const canonicalTargetPath = await realpath(targetPath);

  assert.equal(recovery.recovered, true);
  assert.equal(await readFile(targetPath, "utf8"), HTML);
  await assert.rejects(access(fixture.sourcePath), { code: "ENOENT" });
  assert.equal(state.activePath, canonicalTargetPath);
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.completedAt, 1_000);
  assert.equal(writes.length, 1);
});

test("prepared rename recovers after a crash between filesystem move and state commit", async (t) => {
  const fixture = await createFixture(t);
  const targetPath = path.join(fixture.directory, "已经移动.html");
  await rename(fixture.sourcePath, targetPath);
  const state = projectState(fixture.sourcePath);
  state.pendingRename = {
    version: 1,
    operationId: "rename_recovery_after_move",
    previousPath: fixture.sourcePath,
    sourcePath: targetPath,
    stem: "已经移动",
    expectedSha256: SOURCE_SHA256,
    preparedAt: 900,
  };
  const writes = [];

  const recovery = await recoverPendingSourceRename({
    state,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    persistState: async () => writes.push(structuredClone(state)),
    platform: "linux",
    now: () => 1_000,
  });
  const canonicalTargetPath = await realpath(targetPath);

  assert.equal(recovery.recovered, true);
  assert.equal(state.activePath, canonicalTargetPath);
  assert.equal(state.recent[0].path, canonicalTargetPath);
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.operationId, "rename_recovery_after_move");
  assert.equal(state.activeEffect, null);
  assert.equal(state.activeEffectGeneration, 1);
  assert.equal(writes.length, 1);
});

test("replaying the same rename operation returns its durable result without moving again", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const payload = renamePayload(fixture.sourcePath);
  const writes = [];
  const rebinds = [];
  const options = serviceOptions(payload, state, writes, rebinds);

  const first = await renameHtmlSource(options);
  const second = await renameHtmlSource(options);

  assert.equal(second.sourcePath, first.sourcePath);
  assert.equal(second.replayed, true);
  assert.equal(second.sha256, SOURCE_SHA256);
  assert.equal(writes.length, 2);
  assert.equal(rebinds.length, 1);
});

test("rename payload keeps the HTML extension outside the editable stem", () => {
  const sourcePath = "/Users/demo/页面.htm";
  assert.deepEqual(
    validateSourceRenamePayload({
      ...renamePayload(sourcePath, "新版页面.htm"),
      sourcePath,
    }),
    {
      operationId: "rename_test_operation_0001",
      sourcePath,
      stem: "新版页面",
      extension: ".htm",
      expectedSha256: SOURCE_SHA256,
      targetPath: "/Users/demo/新版页面.htm",
    },
  );
  assert.throws(
    () => validateSourceRenamePayload(renamePayload(sourcePath, "../越界")),
    (error) => error.code === "INVALID_RENAME_STEM",
  );
  assert.throws(
    () => validateSourceRenamePayload(renamePayload(sourcePath, ".隐藏文件")),
    (error) => error.code === "INVALID_RENAME_STEM",
  );
});

test("source rename rebases activeManagedLocator with active and recent in one write", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  state.activeManagedLocator = {
    projectId: "project_rename_sync",
    documentId: "doc_0123456789abcdef",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    sourcePath: fixture.sourcePath,
    sourceSha256: SOURCE_SHA256,
    projectRootPath: fixture.directory,
  };
  const writes = [];
  const rebinds = [];
  const result = await renameHtmlSource(serviceOptions(
    renamePayload(fixture.sourcePath),
    state,
    writes,
    rebinds,
  ));

  assert.equal(state.activePath, result.sourcePath);
  assert.equal(state.activeManagedLocator.sourcePath, result.sourcePath);
  assert.equal(state.activeManagedLocator.projectId, "project_rename_sync");
  assert.equal(state.activeManagedLocator.workingCopyId, "work_ver_0001");
  assert.equal(writes.at(-1).activePath, result.sourcePath);
  assert.equal(writes.at(-1).activeManagedLocator.sourcePath, result.sourcePath);
  assert.equal(writes.at(-1).recent[0].path, result.sourcePath);
});
