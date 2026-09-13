import assert from "node:assert/strict";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSafeExportDefaultPath,
  isProtectedExportDestination,
  normalizeHtmlExportPath,
  normalizedPathKey,
  pathsReferToSameFile,
  PROJECT_IPC_PROTOCOL,
  PROJECT_IPC_VERSION,
  runProjectIpcOperation,
  selectExportDestination,
} from "../desktop/export-copy.mjs";
import { ProjectFileError } from "../desktop/project-files.mjs";

test("the default export name is a free numbered copy and never the source", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-name-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "页面.html");
  const firstCopyPath = path.join(directory, "页面-副本.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "页面.html",
      sourcePath,
      activePath: sourcePath,
    }),
    firstCopyPath,
  );

  await writeFile(firstCopyPath, "existing copy", "utf8");
  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "页面.html",
      sourcePath,
      activePath: sourcePath,
    }),
    path.join(directory, "页面-副本-2.html"),
  );
});

test("a dotted product version remains part of the export file name", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "复杂HTML综合测试页-V1.3",
      sourcePath: null,
      activePath: null,
    }),
    path.join(directory, "复杂HTML综合测试页-V1.3-副本.html"),
  );
});

test("the selected destination gets one canonical HTML extension", () => {
  assert.equal(
    normalizeHtmlExportPath("/tmp/复杂HTML综合测试页-V1.3"),
    path.resolve("/tmp/复杂HTML综合测试页-V1.3.html"),
  );
  assert.equal(
    normalizeHtmlExportPath("/tmp/页面.htm"),
    path.resolve("/tmp/页面.htm"),
  );
  assert.equal(
    normalizeHtmlExportPath("/tmp/页面.notes"),
    path.resolve("/tmp/页面.notes.html"),
  );
});

test("the default export name skips aliases and existing paths", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-alias-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.htm");
  const hardLinkCopy = path.join(directory, "source-副本.htm");
  await writeFile(sourcePath, "<html></html>", "utf8");
  await link(sourcePath, hardLinkCopy);

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "source.htm",
      sourcePath,
      activePath: sourcePath,
    }),
    path.join(directory, "source-副本-2.htm"),
  );
});

test("the default export name also avoids a different active project", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-active-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "draft.html");
  const activePath = path.join(directory, "draft-副本.html");
  await writeFile(sourcePath, "<html>draft</html>", "utf8");
  await writeFile(activePath, "<html>active</html>", "utf8");

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "draft.html",
      sourcePath,
      activePath,
    }),
    path.join(directory, "draft-副本-2.html"),
  );
});

test("macOS path comparison protects case and Unicode aliases", async () => {
  const composed = "/tmp/项目/ÉXAMPLE.HTML";
  const decomposed = "/tmp/项目/e\u0301xample.html";
  assert.equal(
    normalizedPathKey(composed, "darwin"),
    normalizedPathKey(decomposed, "darwin"),
  );
  assert.equal(
    await pathsReferToSameFile(composed, decomposed, {
      platform: "darwin",
      statFile: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
    }),
    true,
  );
});

test("existing inode identity protects hard links to the source", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-inode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  const aliasPath = path.join(directory, "alias.html");
  await writeFile(sourcePath, "<html></html>", "utf8");
  await link(sourcePath, aliasPath);

  assert.equal(await pathsReferToSameFile(sourcePath, aliasPath), true);
  assert.equal(
    await isProtectedExportDestination(aliasPath, [sourcePath]),
    true,
  );
});

test("selecting the source auto-generates a free copy name instead of warning", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  const defaultPath = path.join(directory, "source-副本.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  const selected = await selectExportDestination({
    defaultPath,
    protectedPaths: [sourcePath],
    showSaveDialog: async () => ({ canceled: false, filePath: sourcePath }),
  });

  assert.equal(selected, defaultPath);
});

test("canceling the save dialog is a normal null result", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-cancel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  const selected = await selectExportDestination({
    defaultPath: path.join(directory, "source-副本.html"),
    protectedPaths: [sourcePath],
    showSaveDialog: async () => ({ canceled: true }),
  });

  assert.equal(selected, null);
  assert.equal(await readFile(sourcePath, "utf8"), "<html></html>");
});

test("project IPC envelopes preserve safe errors and redact unknown failures", async () => {
  const success = await runProjectIpcOperation(async () => ({ path: "/tmp/copy.html" }));
  assert.deepEqual(success, {
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: true,
    value: { path: "/tmp/copy.html" },
  });

  const expected = await runProjectIpcOperation(async () => {
    throw new ProjectFileError(
      "EXPORT_OVER_SOURCE",
      "源文件没有被改动。",
      { destinationPath: "/tmp/source.html" },
    );
  });
  assert.equal(expected.ok, false);
  assert.equal(expected.error.code, "EXPORT_OVER_SOURCE");
  assert.equal(expected.error.message, "源文件没有被改动。");
  assert.equal(expected.error.details.destinationPath, "/tmp/source.html");
  assert.equal("stack" in expected.error, false);
  assert.equal("name" in expected.error, false);

  const unknown = await runProjectIpcOperation(async () => {
    throw new Error("secret internal stack and channel");
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "FILE_OPERATION_FAILED");
  assert.equal(
    unknown.error.message,
    "本地文件操作没有完成，请重试或选择其他位置。",
  );
  assert.doesNotMatch(JSON.stringify(unknown), /secret|channel|stack/i);
});

test("project IPC envelopes preserve only the public reclassification confirmation schema", async () => {
  const confirmation = {
    openKind: "confirmation",
    requestId: "req_reclassified",
    classification: "known-external",
    sourceFileName: "产品首页.html",
    visibleV1FileName: "产品首页.html",
    projectsRootLabel: "HTML编辑器",
    projectName: "产品首页",
    currentBasedOnVersionId: "version_0006",
    currentBasedOnOrdinal: 6,
    latestOfficialVersionId: null,
    latestOfficialOrdinal: 6,
    currentDiffersFromBase: true,
    sourceRelation: "unchanged",
    sourcePath: "/private/secret.html",
    nested: { secret: "do-not-forward" },
  };
  const result = await runProjectIpcOperation(async () => {
    throw new ProjectFileError(
      "OPEN_INTENT_RECLASSIFIED",
      "这个文件之前已经导入过了，请确认后打开之前的项目。",
      {
        confirmation,
        safeReason: "reclassified",
        unknownNested: { channel: "html-projects:open" },
      },
    );
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.error.details, {
    confirmation: {
      openKind: "confirmation",
      requestId: "req_reclassified",
      classification: "known-external",
      sourceFileName: "产品首页.html",
      projectName: "产品首页",
      currentBasedOnVersionId: "version_0006",
      currentBasedOnOrdinal: 6,
      latestOfficialVersionId: null,
      latestOfficialOrdinal: 6,
      currentDiffersFromBase: true,
      sourceRelation: "unchanged",
    },
    safeReason: "reclassified",
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|channel|html-projects|sourcePath/u);

  const invalid = await runProjectIpcOperation(async () => {
    throw new ProjectFileError(
      "OPEN_INTENT_RECLASSIFIED",
      "reclassification",
      { confirmation: { requestId: "missing-classification", classification: "unknown" } },
    );
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.details, undefined);

  const forgedCode = await runProjectIpcOperation(async () => {
    throw new ProjectFileError(
      "PERMISSION_DENIED",
      "拒绝访问。",
      { confirmation },
    );
  });
  assert.equal(forgedCode.ok, false);
  assert.equal(forgedCode.error.details, undefined);
});
