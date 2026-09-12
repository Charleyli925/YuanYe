import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import {
  DEFAULT_PROJECT_RULES_TEMPLATE,
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  WORKSPACE_PERFORMANCE_TIMING_FIELDS,
} from "../bridge/project-file-repository/workspace-performance-timing.mjs";
import {
  inspectSourceElementIdentity,
} from "../bridge/project-file-repository/working-copy.mjs";
import {
  fixture,
  html,
  importSource,
  initializedRepository,
  json,
  promoteNextVersion,
  reconcileInput,
  registryPath,
} from "./project-file-repository-harness.mjs";

test("atomic import creates V1 facts once and ordinary saves never create a Version", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "原文件.htm");
  const original = await readFile(imported.sourcePath);

  await assert.rejects(
    () => lstat(path.join(path.dirname(imported.sourcePath), "PROJECT.md")),
    { code: "ENOENT" },
  );

  assert.equal(imported.target.targetKind, "working-copy");
  assert.equal(imported.target.workingCopyId, "work_ver_0001");
  assert.equal(imported.target.versionId, "ver_0001");
  assert.match(imported.target.exactSourcePath, /原文件-V1\.htm$/u);
  assert.deepEqual(
    Object.keys(await json(path.join(imported.target.projectRootPath, ".pageroot", "project.json"))).sort(),
    ["createdAt", "documentId", "projectId", "schemaVersion"],
  );
  const importRecovery = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    "import.json",
  ));
  assert.equal("externalSourcePath" in importRecovery, false);
  assert.deepEqual(await readFile(imported.sourcePath), original);

  let target = imported.target;
  for (let revision = 1; revision <= 100; revision += 1) {
    const content = html(`save-${revision}`);
    const result = await value.repository.saveWorkingCopy({
      target,
      html: content,
      expectedSourceSha256: target.sourceSha256,
      editRevision: revision,
    });
    assert.equal(result.versionCreated, false);
    target = result.target;
  }

  const manifest = await json(path.join(target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(await readFile(imported.sourcePath, "utf8"), original.toString("utf8"));
  assert.deepEqual(
    await readdir(path.join(target.projectRootPath, ".pageroot", "recovery")),
    ["import.json"],
  );
});

test("PROJECT.md starts with the long-term rules template and can be cleared", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "项目规则.html");
  const projectNotesPath = path.join(imported.target.projectRootPath, "PROJECT.md");

  assert.equal(await readFile(projectNotesPath, "utf8"), DEFAULT_PROJECT_RULES_TEMPLATE);
  const cleared = await value.repository.updateProjectNotes({
    target: imported.target,
    content: "",
  });

  assert.equal(cleared.updated, true);
  assert.equal(cleared.content, "");
  assert.equal(await readFile(projectNotesPath, "utf8"), "");
});

test("an older managed project receives the default PROJECT.md on first read", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "缺少规则文件.html");
  const projectNotesPath = path.join(imported.target.projectRootPath, "PROJECT.md");
  await unlink(projectNotesPath);

  const notes = await value.repository.readProjectNotes({ target: imported.target });
  assert.equal(notes.content, DEFAULT_PROJECT_RULES_TEMPLATE);
  assert.equal(await readFile(projectNotesPath, "utf8"), DEFAULT_PROJECT_RULES_TEMPLATE);
});

test("a legacy v4 Runtime without historyActivation opens as null and normalizes on write", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "legacy-runtime.html");
  const runtimePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  );
  const legacyRuntime = await json(runtimePath);
  delete legacyRuntime.historyActivation;
  await writeFile(runtimePath, JSON.stringify(legacyRuntime), "utf8");

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(workspace.runtime.historyActivation, null);
  assert.equal("historyActivation" in await json(runtimePath), false);

  const saved = await restarted.saveWorkingCopy({
    target: workspace.target,
    html: html("legacy runtime normalized"),
    expectedSourceSha256: workspace.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.versionCreated, false);
  assert.equal((await json(runtimePath)).historyActivation, null);
});

test("workspace reports complete non-authoritative repository stage timing", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "timed-workspace.html");
  const restarted = new ProjectFileRepository({
    projectsRoot: value.projects,
  });

  const workspace = await restarted.workspace({
    sourcePath: imported.target.exactSourcePath,
  });

  assert.deepEqual(
    Object.keys(workspace.performanceTiming),
    [...WORKSPACE_PERFORMANCE_TIMING_FIELDS],
  );
  for (const valueMs of Object.values(workspace.performanceTiming)) {
    assert.equal(Number.isFinite(valueMs), true);
    assert.ok(valueMs >= 0);
  }
  assert.ok(workspace.performanceTiming.workspaceTotalMs > 0);
  assert.equal(workspace.content, html("V1"));
});

test("the Registry alone determines catalog membership and secure project opens", async (t) => {
  const value = await fixture(t);
  const a = await importSource(value, "A.html");
  const b = await importSource(value, "B.html");

  const initial = await value.repository.listRegisteredProjects();
  assert.deepEqual(
    new Set(initial.map((row) => row.projectId)),
    new Set([a.target.projectId, b.target.projectId]),
  );
  assert.equal(initial.every((row) => row.availability === "ready"), true);

  const bBeforeRename = initial.find((row) => row.projectId === b.target.projectId);
  assert.equal(bBeforeRename?.activeWorkingCopyId, "work_ver_0001");
  assert.equal(bBeforeRename?.currentBasedOnVersionId, "ver_0001");
  assert.equal(bBeforeRename?.latestOfficialVersionId, "ver_0001");
  for (const project of [a, b]) {
    const row = initial.find((entry) => entry.projectId === project.target.projectId);
    const manifest = await json(path.join(project.target.projectRootPath, ".pageroot", "manifest.json"));
    const workingState = await json(path.join(
      project.target.projectRootPath,
      ".pageroot",
      "working-copies",
      `${project.target.workingCopyId}.json`,
    ));
    const rules = await lstat(path.join(project.target.projectRootPath, "PROJECT.md"));
    const expectedLastUpdatedAt = new Date(Math.max(
      Date.parse(workingState.lastSavedAt),
      Date.parse(rules.mtime.toISOString()),
      ...manifest.versions.map((version) => Date.parse(version.createdAt)),
    )).toISOString();
    assert.equal(row?.lastUpdatedAt, expectedLastUpdatedAt);
    assert.equal(Object.hasOwn(row || {}, "lastOpenedAt"), false);
  }

  const renamedRoot = path.join(value.projects, "B renamed");
  await rename(b.target.projectRootPath, renamedRoot);
  const afterRename = await value.repository.listRegisteredProjects();
  const bAfterRename = afterRename.find((row) => row.projectId === b.target.projectId);
  assert.equal(bAfterRename?.availability, "ready");
  assert.equal(bAfterRename?.projectName, "B renamed");
  assert.equal(bAfterRename?.registeredProjectRootPath, renamedRoot);

  const resolved = await value.repository.resolveRegisteredProjectOpenTarget({
    projectId: b.target.projectId,
  });
  assert.equal(resolved.target.projectId, b.target.projectId);
  assert.equal(resolved.target.documentId, b.target.documentId);
  assert.equal(resolved.target.workingCopyId, "work_ver_0001");
  assert.equal(resolved.target.projectRootPath, renamedRoot);
  assert.equal(resolved.sourceSha256, resolved.target.sourceSha256);

  const finderRenamedWorkingCopy = path.join(renamedRoot, "B Finder renamed.html");
  await rename(resolved.target.exactSourcePath, finderRenamedWorkingCopy);
  const afterWorkingCopyRename = await value.repository.listRegisteredProjects();
  const bAfterWorkingCopyRename = afterWorkingCopyRename.find(
    (row) => row.projectId === b.target.projectId,
  );
  assert.equal(bAfterWorkingCopyRename?.availability, "ready");
  assert.equal(bAfterWorkingCopyRename?.activeSourcePath, finderRenamedWorkingCopy);
  const rebound = await value.repository.resolveRegisteredProjectOpenTarget({
    projectId: b.target.projectId,
  });
  assert.equal(rebound.target.exactSourcePath, finderRenamedWorkingCopy);
  const reboundManifest = await json(path.join(
    renamedRoot,
    ".pageroot",
    "manifest.json",
  ));
  assert.equal(
    reboundManifest.workingCopies.find(
      (entry) => entry.workingCopyId === rebound.target.workingCopyId,
    )?.sourceRelativePath,
    "B Finder renamed.html",
  );

  const copiedRoot = path.join(value.root, "unregistered copy");
  await cp(renamedRoot, copiedRoot, { recursive: true });
  assert.equal((await value.repository.listRegisteredProjects()).length, 2);

  const movedRoot = path.join(value.root, "moved B");
  await rename(renamedRoot, movedRoot);
  await symlink(movedRoot, renamedRoot);
  const unavailable = await value.repository.listRegisteredProjects();
  const bUnavailable = unavailable.find((row) => row.projectId === b.target.projectId);
  const aReady = unavailable.find((row) => row.projectId === a.target.projectId);
  assert.equal(bUnavailable?.availability, "unavailable");
  assert.equal(aReady?.availability, "ready");
  await assert.rejects(
    value.repository.resolveRegisteredProjectOpenTarget({ projectId: b.target.projectId }),
    (error) => error instanceof ProjectFileRepositoryError
      && ["REGISTERED_PROJECT_UNAVAILABLE", "PATH_ESCAPES_PROJECT"].includes(error.code),
  );
});

test("registered version summaries stay content-free and expose the safe active filename", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "summary repository.html");
  const summary = await value.repository.listRegisteredProjectVersionSummaries({
    projectId: imported.target.projectId,
  });
  assert.equal(summary.projectId, imported.target.projectId);
  assert.equal(summary.documentId, imported.target.documentId);
  assert.equal(summary.versions.length, 1);
  assert.deepEqual(summary.versions[0], {
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    versionId: "ver_0001",
    ordinal: 1,
    basedOnVersionId: null,
    previousVersionId: null,
    displayFileName: "summary repository-V1.html",
    modifiedAt: summary.versions[0].modifiedAt,
    isActiveWorkingCopy: true,
    isLatestOfficial: true,
  });
  assert.equal(Object.hasOwn(summary.versions[0], "content"), false);
  assert.equal(Object.hasOwn(summary.versions[0], "comments"), false);
  assert.equal(Object.hasOwn(summary.versions[0], "attachments"), false);
});

test("reading a current V4 Registry never rewrites its bytes", async (t) => {
  const value = await fixture(t);
  await importSource(value, "current-registry.html");
  const before = await readFile(registryPath(value));

  await initializedRepository(value);

  assert.deepEqual(await readFile(registryPath(value)), before);
});

// An unrecognized Registry shape is refused rather than replaced. Returning an
// empty Registry instead would let the next import overwrite the real file, which
// would destroy every recorded external-source binding and root identity while
// leaving the project directories orphaned on disk. The shape seeded here is the
// pre-hardening V4 one: same schemaVersion, but no pendingImports and records
// without a durable root identity.

test("an unrecognized Registry shape fails closed without changing its bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "未知形状.html");
  const managedBefore = await readFile(imported.target.exactSourcePath);
  const current = JSON.parse(await readFile(registryPath(value), "utf8"));
  const unknown = {
    schemaVersion: current.schemaVersion,
    updatedAt: current.updatedAt,
    projects: Object.fromEntries(Object.entries(current.projects).map(([id, record]) => [
      id,
      { projectRootPath: record.registeredProjectRootPath, updatedAt: record.updatedAt },
    ])),
  };
  const unknownBytes = Buffer.from(`${JSON.stringify(unknown, null, 2)}\n`, "utf8");
  await writeFile(registryPath(value), unknownBytes);

  for (const run of [
    (repository) => repository.listRegisteredProjects(),
    (repository) => repository.classifyOpenPath({ sourcePath: imported.sourcePath }),
    (repository) => repository.importExternal({
      sourcePath: imported.sourcePath,
      expectedSourceSha256: sha256(managedBefore),
    }),
  ]) {
    await assert.rejects(
      run(new ProjectFileRepository({
        projectsRoot: value.projects,
        registryWriteLockTimeoutMs: 200,
      })),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "UNSUPPORTED_REGISTRY_SCHEMA",
    );
  }

  assert.deepEqual(await readFile(registryPath(value)), unknownBytes);
  assert.deepEqual(await readFile(imported.target.exactSourcePath), managedBefore);
  assert.equal(
    (await readdir(value.projects)).some((entry) => entry.startsWith(".pageroot-registry-backups")),
    false,
  );
});

test("exact path, rather than equal bytes, determines the opened document", async (t) => {
  const value = await fixture(t);
  const sameBytes = html("same bytes");
  const first = await importSource(value, "left/same.html", sameBytes);
  const second = await importSource(value, "right/same.html", sameBytes);

  assert.equal(first.target.sourceSha256, second.target.sourceSha256);
  assert.notEqual(first.target.projectId, second.target.projectId);
  assert.notEqual(first.target.exactSourcePath, second.target.exactSourcePath);
  assert.equal(path.basename(first.target.projectRootPath), "same");
  assert.equal(path.basename(second.target.projectRootPath), "same (2)");

  const reopenedFirst = await value.repository.resolveOpenTarget({
    sourcePath: first.target.exactSourcePath,
  });
  const reopenedSecond = await value.repository.resolveOpenTarget({
    sourcePath: second.target.exactSourcePath,
  });
  assert.equal(reopenedFirst.projectId, first.target.projectId);
  assert.equal(reopenedFirst.exactSourcePath, first.target.exactSourcePath);
  assert.equal(reopenedSecond.projectId, second.target.projectId);
  assert.equal(reopenedSecond.exactSourcePath, second.target.exactSourcePath);
});

test("unlisted HTML never acquires a v4 binding from equal bytes or an inode", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "managed.html");
  const equalBytesPath = path.join(imported.target.projectRootPath, "unmanaged-copy.html");
  const hardLinkPath = path.join(imported.target.projectRootPath, "unmanaged-hard-link.html");
  await writeFile(equalBytesPath, await readFile(imported.target.exactSourcePath));
  await link(imported.target.exactSourcePath, hardLinkPath);

  for (const sourcePath of [equalBytesPath, hardLinkPath]) {
    assert.equal(
      await value.repository.resolveOpenTarget({ sourcePath }),
      null,
      sourcePath,
    );
    assert.equal(await value.repository.workspace({ sourcePath }), null, sourcePath);
  }
  const manifestBeforeImport = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(
    manifestBeforeImport.workingCopies.map((entry) => entry.sourceRelativePath),
    ["managed-V1.html"],
  );

  const fresh = await value.repository.importExternal({
    sourcePath: equalBytesPath,
    expectedSourceSha256: sha256(await readFile(equalBytesPath)),
  });
  assert.notEqual(fresh.target.projectId, imported.target.projectId);
  assert.equal(await readFile(hardLinkPath, "utf8"), html("V1"));
  const manifestAfterImport = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifestAfterImport, manifestBeforeImport);
});

test("a duplicate project identity is isolated until the extra copy is moved out", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const copiedRoot = path.join(value.projects, "copied-project");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const copiedHtml = path.join(copiedRoot, path.basename(imported.target.exactSourcePath));
  const before = await readFile(copiedHtml);
  await assert.rejects(value.repository.resolveOpenTarget({ sourcePath: copiedHtml }), { code: "REGISTERED_PROJECT_AMBIGUOUS" });
  await assert.rejects(value.repository.importExternal({ sourcePath: copiedHtml }), { code: "REGISTERED_PROJECT_AMBIGUOUS" });
  assert.deepEqual(await readFile(copiedHtml), before);
  await rename(copiedRoot, path.join(value.root, "extra-copy"));
  assert.ok(await value.repository.resolveOpenTarget({ sourcePath: imported.target.exactSourcePath }));
});

test("a damaged v4 record is ignored and its HTML imports as a fresh V1", async (t) => {
  const value = await fixture(t);
  const damaged = await importSource(value, "damaged.html");
  const healthy = await importSource(value, "healthy.html");
  await rm(damaged.target.projectRootPath, { recursive: true, force: true });
  await mkdir(damaged.target.projectRootPath);
  const damagedHtml = path.join(damaged.target.projectRootPath, "damaged.html");
  await writeFile(damagedHtml, html("replacement"), "utf8");

  const resolvedHealthy = await value.repository.resolveOpenTarget({
    sourcePath: healthy.target.exactSourcePath,
  });
  assert.equal(resolvedHealthy.projectId, healthy.target.projectId);
  assert.equal(
    await value.repository.resolveOpenTarget({ sourcePath: damagedHtml }),
    null,
  );
  const imported = await value.repository.importExternal({
    sourcePath: damagedHtml,
    expectedSourceSha256: sha256(await readFile(damagedHtml)),
  });
  assert.equal(imported.imported, true);
  assert.notEqual(imported.target.projectId, damaged.target.projectId);
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("external import preserves original and V1 bytes while identifying every managed resource form", async (t) => {
  const value = await fixture(t);
  const cases = [
    ["unquoted-src", "<img src=assets/chart.svg>"],
    ["srcset", "<source srcset='assets/hero.webp 1x, https://cdn.example/hero.webp 2x'>"],
    ["poster", "<video poster='assets/poster.jpg'></video>"],
    ["object-data", "<object data=assets/report.pdf></object>"],
    ["style-attribute", "<div style=\"background-image: url(assets/background.png)\"></div>"],
    ["style-url", "<style>.card { background: url('./assets/card.png'); }</style>"],
    ["style-import", "<style>@import \"./assets/theme.css\";</style>"],
  ];
  for (const [name, markup] of cases) {
    const sourcePath = path.join(value.sources, `${name}.html`);
    const source = `<!doctype html><html><head><title>${name}</title></head><body>${markup}</body></html>`;
    const buffer = Buffer.from(source, "utf8");
    await writeFile(sourcePath, buffer);
    const imported = await value.repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    });
    assert.equal(imported.imported, true, name);
    assert.deepEqual(await readFile(sourcePath), buffer, `${name} source`);
    const manifest = await json(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "manifest.json",
    ));
    assert.deepEqual(
      await readFile(path.join(
        imported.target.projectRootPath,
        ".pageroot",
        manifest.versions[0].snapshotRelativePath,
      )),
      buffer,
      `${name} immutable V1`,
    );
    const managed = await readFile(imported.target.exactSourcePath, "utf8");
    assert.equal(inspectSourceElementIdentity(managed).complete, true, `${name} identity`);
    assert.equal(
      managed.replace(/ data-pageroot-id="pr1_[a-f0-9]{32}"/gu, ""),
      source,
      `${name} managed source outside identity attributes`,
    );
  }

  const safeSourcePath = path.join(value.sources, "safe-resources.html");
  const safeSource = `<!doctype html><html><head><title>safe</title></head><body><img src=\"data:image/svg+xml;base64,PHN2Zy8+\"><source srcset=\"data:image/svg+xml;base64,PHN2Zy8+ 1x, https://cdn.example/image.webp 2x\"></body></html>`;
  const safeBuffer = Buffer.from(safeSource, "utf8");
  await writeFile(safeSourcePath, safeBuffer);
  const imported = await value.repository.importExternal({
    sourcePath: safeSourcePath,
    expectedSourceSha256: sha256(safeBuffer),
  });
  assert.equal(imported.imported, true);
  const safeManaged = await readFile(imported.target.exactSourcePath, "utf8");
  assert.equal(inspectSourceElementIdentity(safeManaged).complete, true);
  assert.equal(
    safeManaged.replace(/ data-pageroot-id="pr1_[a-f0-9]{32}"/gu, ""),
    safeSource,
  );
});

test("import fails before publication without registration debris, and rejects symbolic links", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-files-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.html");
  await writeFile(sourcePath, html("fault"), "utf8");
  const projects = path.join(root, "projects");
  const repository = new ProjectFileRepository({
    projectsRoot: projects,
    failpoint: async (name) => name === "import-metadata-written",
  });
  await assert.rejects(
    repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(html("fault"), "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const entries = await readdir(projects);
  assert.deepEqual(entries.filter((entry) => entry !== ".pageroot-registry.json"), []);

  const symlinkPath = path.join(root, "linked.html");
  await symlink(sourcePath, symlinkPath);
  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: path.join(root, "safe-projects") })
      .importExternal({ sourcePath: symlinkPath }),
    (error) => error instanceof ProjectFileRepositoryError && error.code === "UNSAFE_FILE",
  );
});

test("import rechecks the bytes read after stat before publishing a project", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "stat-race.html");
  const source = html("small before stat race");
  await writeFile(sourcePath, source, "utf8");
  const oversized = Buffer.alloc((20 * 1024 * 1024) + 1, 0x61);
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "html-read-after-stat") await writeFile(sourcePath, oversized);
      return false;
    },
  });
  await assert.rejects(
    repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError && error.code === "SOURCE_TOO_LARGE",
  );
  assert.deepEqual(
    (await readdir(value.projects)).filter((entry) => entry !== ".pageroot-registry.json"),
    [],
  );
});

test("import reserves UTF-8 component space and skips every occupied project-root placeholder", async (t) => {
  const utf8 = await fixture(t);
  const longName = `${"中".repeat(80)}.html`;
  const imported = await importSource(utf8, longName);
  assert.ok(Buffer.byteLength(path.basename(imported.target.exactSourcePath), "utf8") <= 255);
  assert.ok(Buffer.byteLength(path.basename(imported.target.projectRootPath), "utf8") <= 255);
  assert.match(path.basename(imported.target.exactSourcePath), /-V1\.html$/u);

  for (const kind of ["file", "directory", "symlink"]) {
    const value = await fixture(t);
    const blocker = path.join(value.projects, "occupied");
    await mkdir(value.projects, { recursive: true });
    if (kind === "file") {
      await writeFile(blocker, "placeholder", "utf8");
    } else if (kind === "directory") {
      await mkdir(blocker);
    } else {
      const outside = path.join(value.root, "occupied-target");
      await writeFile(outside, "placeholder", "utf8");
      await symlink(outside, blocker, "file");
    }
    const occupied = await importSource(value, "occupied.html");
    assert.notEqual(path.basename(occupied.target.projectRootPath), "occupied", kind);
    const information = await lstat(blocker);
    assert.equal(
      kind === "file" ? information.isFile() : (kind === "directory"
        ? information.isDirectory()
        : information.isSymbolicLink()),
      true,
      kind,
    );
  }
});

test("classifyOpenPath is read-only for managed, known and new HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "分类只读.html");
  const freshPath = path.join(value.sources, "尚未导入.html");
  await writeFile(freshPath, html("fresh"), "utf8");
  const registryBefore = await readFile(registryPath(value));

  const managed = await value.repository.classifyOpenPath({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(managed.kind, "managed-project");
  assert.equal(managed.target.projectId, imported.target.projectId);

  const known = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(known.kind, "known-external");
  assert.equal(known.projectFacts.projectId, imported.target.projectId);
  assert.equal("importSourceKey" in known, false);
  assert.equal("importSourceKey" in known.projectFacts, false);

  const fresh = await value.repository.classifyOpenPath({ sourcePath: freshPath });
  assert.equal(fresh.kind, "new-external");
  assert.equal(fresh.sourceFileName, "尚未导入.html");
  assert.equal(fresh.visibleV1FileName, "尚未导入-V1.html");

  assert.deepEqual(await readFile(registryPath(value)), registryBefore);
});

// Forward compatibility. A Registry that carries every required member plus a
// member a newer PageRoot added is fully explainable, so it is read normally
// and that member survives the next Registry write. Refusing it instead would
// lock every project out of an older build, and dropping it would destroy the
// newer build's data just as silently as replacing the whole file.

test("a newer Registry member survives an older build's read and write", async (t) => {
  const value = await fixture(t);
  const first = await importSource(value, "第一个.html");
  const seeded = JSON.parse(await readFile(registryPath(value), "utf8"));
  seeded.futureRegistrySection = { schemaChannel: "next" };
  seeded.projects[first.target.projectId].ownerAccountId = "account_future";
  await writeFile(
    registryPath(value),
    `${JSON.stringify(seeded, null, 2)}\n`,
    "utf8",
  );

  await assert.doesNotReject(() => value.repository.listRegisteredProjects());

  // A second import forces a full Registry read, mutation and atomic write.
  const second = await importSource(value, "第二个.html");

  const after = JSON.parse(await readFile(registryPath(value), "utf8"));
  assert.deepEqual(after.futureRegistrySection, { schemaChannel: "next" });
  assert.equal(
    after.projects[first.target.projectId].ownerAccountId,
    "account_future",
  );
  assert.ok(after.projects[second.target.projectId]);
});

// The stored Draft is an envelope: #saveDraft rebuilds schemaVersion, project,
// document, Working Copy and base Version from the loaded project and then
// spreads the active snapshot over it. Those five members are authored by the
// writer on every save, so they must never be carried back from disk as if they
// were unknown members — a stale file would otherwise overwrite the
// authoritative identity and pin the schema version forever.

test("editing the V1 working file still binds the original external path to the same project", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "编辑后重开.html");
  const originalBytes = await readFile(imported.sourcePath);
  const originalSha256 = sha256(originalBytes);
  const edited = html("local edit after import");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: edited,
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(classified.projectFacts.currentDiffersFromBase, true);
  assert.equal(classified.projectFacts.sourceRelation, "unchanged");
  assert.equal(classified.sourceSha256, originalSha256);
  assert.equal(await readFile(imported.sourcePath, "utf8"), originalBytes.toString("utf8"));
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: originalSha256,
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(retried.target.workingCopyId, saved.target.workingCopyId);
  assert.equal(retried.target.exactSourcePath, saved.target.exactSourcePath);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("promoting V2 still returns the current V2 working copy for the original path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "晋升后重开.html");
  const active = await promoteNextVersion(value.repository, imported.target, "promoted_reopen");
  assert.equal(active.workingCopyId, "work_ver_0002");
  assert.equal(active.versionId, "ver_0002");

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(classified.projectFacts.latestOfficialVersionId, "ver_0002");
  assert.equal(classified.projectFacts.currentBasedOnVersionId, "ver_0002");
  assert.equal(classified.projectFacts.initialVersionId, "ver_0001");
  assert.equal(classified.projectFacts.currentDiffersFromBase, false);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.workingCopyId, "work_ver_0002");
  assert.equal(retried.target.versionId, "ver_0002");
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("a historical active Working Copy is returned instead of silently jumping to latest", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "历史工作稿.html");
  let active = imported.target;
  for (const label of ["history_v2", "history_v3"]) {
    active = await promoteNextVersion(value.repository, active, label);
  }
  assert.equal(active.workingCopyId, "work_ver_0003");
  const activated = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_reopen_0001",
    expectedActiveWorkingCopyId: "work_ver_0003",
  });
  assert.equal(activated.target.workingCopyId, "work_ver_0002");
  const editedHistory = html("continue from V2");
  const saved = await value.repository.saveWorkingCopy({
    target: activated.target,
    html: editedHistory,
    expectedSourceSha256: activated.target.sourceSha256,
    editRevision: 1,
  });

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(classified.projectFacts.currentBasedOnVersionId, "ver_0002");
  assert.equal(classified.projectFacts.latestOfficialVersionId, "ver_0003");
  assert.equal(classified.projectFacts.currentDiffersFromBase, true);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.workingCopyId, "work_ver_0002");
  assert.equal(retried.target.exactSourcePath, saved.target.exactSourcePath);
  assert.notEqual(retried.target.workingCopyId, "work_ver_0003");
});

test("a later change to the external original stays bound and reports sourceRelation=changed", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "原稿已改.html");
  const changed = html("external original changed");
  const changedBytes = Buffer.from(changed, "utf8");
  const changedSha256 = sha256(changedBytes);
  await writeFile(imported.sourcePath, changedBytes);
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.sourceRelation, "changed");
  assert.equal(classified.projectFacts.sourceRelation, "changed");
  assert.equal(classified.sourceSha256, changedSha256);
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: changedSha256,
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("equal bytes on another path remain a new external source", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "left/same-bytes.html");
  const otherPath = path.join(value.sources, "right/same-bytes.html");
  await mkdir(path.dirname(otherPath), { recursive: true });
  await writeFile(otherPath, imported.buffer);
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({ sourcePath: otherPath });
  assert.equal(classified.kind, "new-external");
  assert.equal(classified.sourceFileName, "same-bytes.html");
  assert.equal(classified.visibleV1FileName, "same-bytes-V1.html");
  assert.equal(classified.sourceSha256, sha256(imported.buffer));
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const second = await value.repository.importExternal({
    sourcePath: otherPath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(second.imported, true);
  assert.notEqual(second.target.projectId, imported.target.projectId);
});

test("macOS /var and /private/var aliases share one external source binding", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS path-alias regression");
    return;
  }
  const value = await fixture(t);
  const imported = await importSource(value, "外部路径别名.html");
  const aliasPath = imported.sourcePath === "/var"
    || imported.sourcePath.startsWith("/var/")
    ? `/private${imported.sourcePath}`
    : imported.sourcePath.startsWith("/private/var/")
      ? imported.sourcePath.slice("/private".length)
      : null;
  if (!aliasPath || aliasPath === imported.sourcePath) {
    t.skip("temporary directory is not exposed through /var");
    return;
  }

  const classified = await value.repository.classifyOpenPath({ sourcePath: aliasPath });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);

  const retried = await value.repository.importExternal({
    sourcePath: aliasPath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

// Releasing the lock is cleanup, never authority. A release that cannot complete
// must not become the outcome of an operation that already committed, and must not
// replace the original error whose code drives recovery in the renderer.

test("a bound project with a missing Working Copy fails closed instead of becoming a new import", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "损坏绑定.html");
  await rm(imported.target.exactSourcePath);
  const registryBefore = await readFile(registryPath(value));

  await assert.rejects(
    value.repository.classifyOpenPath({ sourcePath: imported.sourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code !== "SOURCE_NOT_FOUND"
      && !String(error.code).includes("new-external"),
  );
  await assert.rejects(
    value.repository.importExternal({
      sourcePath: imported.sourcePath,
      expectedSourceSha256: sha256(imported.buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code !== "SOURCE_NOT_FOUND",
  );
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("reconcileWorkingCopyLocator rebinds a same-directory Finder rename without creating IDs", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "活动页.html");
  const renamedPath = path.join(imported.target.projectRootPath, "Finder 新名字.html");
  await rename(imported.target.exactSourcePath, renamedPath);

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(reconciled.status, "relocated");
  assert.equal(reconciled.openTarget.projectId, imported.target.projectId);
  assert.equal(reconciled.openTarget.documentId, imported.target.documentId);
  assert.equal(reconciled.openTarget.workingCopyId, imported.target.workingCopyId);
  assert.equal(reconciled.openTarget.versionId, imported.target.versionId);
  assert.equal(reconciled.sourcePath, renamedPath);
  assert.equal(reconciled.sourceSha256, imported.target.sourceSha256);
  assert.equal(reconciled.openTarget.exactSourcePath, renamedPath);

  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  assert.equal(workingCopy.sourceRelativePath, "Finder 新名字.html");
  assert.equal(workingCopy.preferredFileStem, "Finder 新名字");
  assert.equal(workingCopy.preferredExtension, ".html");

  const again = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(again.status, "unchanged");
  assert.equal(again.sourcePath, renamedPath);
});

test("reconcileWorkingCopyLocator follows a same-parent project folder rename", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "文件夹页.html");
  const renamedRoot = path.join(value.projects, "改名后的项目");
  await rename(imported.target.projectRootPath, renamedRoot);
  const previousSourcePath = path.join(renamedRoot, path.basename(imported.target.exactSourcePath));
  const renamedHtml = path.join(renamedRoot, "文件夹页 Finder.html");
  await rename(previousSourcePath, renamedHtml);

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, {
      previousSourcePath: imported.target.exactSourcePath,
    }),
  );
  assert.equal(reconciled.status, "relocated");
  assert.equal(reconciled.openTarget.projectId, imported.target.projectId);
  assert.equal(reconciled.openTarget.projectRootPath, renamedRoot);
  assert.equal(reconciled.sourcePath, renamedHtml);
});

test("reconcileWorkingCopyLocator reports content-changed after a Finder rename plus edit", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "内容变化.html");
  const renamedPath = path.join(imported.target.projectRootPath, "内容变化 Finder.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const edited = html("Finder also edited the bytes");
  await writeFile(renamedPath, edited, "utf8");

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(reconciled.status, "content-changed");
  assert.equal(reconciled.sourcePath, renamedPath);
  assert.equal(reconciled.openTarget.workingCopyId, imported.target.workingCopyId);
  assert.notEqual(reconciled.sourceSha256, imported.target.sourceSha256);
  assert.equal(await readFile(renamedPath, "utf8"), edited);
});

test("reconcileWorkingCopyLocator does not claim copies, hard links, symlinks or escaped roots", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "唯一身份.html");
  const renamedPath = path.join(imported.target.projectRootPath, "唯一身份 Finder.html");
  await rename(imported.target.exactSourcePath, renamedPath);

  const hardLinkPath = path.join(imported.target.projectRootPath, "hard-link.html");
  await link(renamedPath, hardLinkPath);
  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(reconcileInput(imported.target)),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "MANAGED_PATH_AMBIGUOUS",
  );
  await unlink(hardLinkPath);

  const copiedRoot = path.join(value.root, "copied-project");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const copiedHtml = path.join(copiedRoot, "唯一身份 Finder.html");
  const originalReconcile = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(originalReconcile.sourcePath, renamedPath);
  assert.notEqual(originalReconcile.sourcePath, copiedHtml);

  const symlinkPath = path.join(imported.target.projectRootPath, "alias.html");
  await symlink(renamedPath, symlinkPath);
  const afterSymlink = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(afterSymlink.sourcePath, renamedPath);

  const movedRoot = path.join(value.root, "escaped-project");
  await rename(imported.target.projectRootPath, movedRoot);
  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(
      reconcileInput(imported.target, { previousSourcePath: renamedPath }),
    ),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
});

test("reconcileWorkingCopyLocator refuses a version mismatch and does not guess by hash", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "不猜测.html");
  const decoy = path.join(imported.target.projectRootPath, "decoy.html");
  await writeFile(decoy, html("V1"), "utf8");
  await rename(
    imported.target.exactSourcePath,
    path.join(imported.target.projectRootPath, "不猜测 Finder.html"),
  );

  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(
      reconcileInput(imported.target, { versionId: "ver_0002" }),
    ),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "MANAGED_SOURCE_IDENTITY_MISMATCH",
  );

  const equalBytes = await importSource(value, "另一份同字节.html", html("V1"));
  await rename(
    equalBytes.target.exactSourcePath,
    path.join(equalBytes.target.projectRootPath, "另一份同字节 Finder.html"),
  );
  const recovered = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(recovered.openTarget.projectId, imported.target.projectId);
  assert.notEqual(recovered.openTarget.projectId, equalBytes.target.projectId);
});

test("unknown Runtime root and historyActivation members survive a confirmation", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "运行态未知成员.html");
  const active = await promoteNextVersion(
    value.repository,
    imported.target,
    "runtime_unknown",
  );
  const runtimeFile = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  );

  const activated = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0001",
    operationId: "runtime_unknown_activation_0001",
    expectedActiveWorkingCopyId: "work_ver_0002",
  });
  assert.equal(activated.historyActivation.state, "desktop-pending");

  const runtime = await json(runtimeFile);
  runtime.ownerAccountId = "account_future";
  runtime.historyActivation.provenance = { seq: 1 };
  await writeFile(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

  const confirmed = await value.repository.confirmVersionWorkingCopyActivation({
    target: activated.target,
    operationId: "runtime_unknown_activation_0001",
    previousWorkingCopyId: "work_ver_0002",
    activatedWorkingCopyId: "work_ver_0001",
    versionId: "ver_0001",
  });
  assert.equal(confirmed.confirmed, true);

  const rewritten = await json(runtimeFile);
  assert.equal(rewritten.historyActivation.state, "desktop-confirmed");
  assert.equal(rewritten.ownerAccountId, "account_future");
  assert.deepEqual(rewritten.historyActivation.provenance, { seq: 1 });
});

// Provenance answers "who wrote this" and is authored by the repository, never
// taken from the caller. An existing record keeps the author already persisted
// on disk, so resending the whole comment list cannot turn authorship into
// "who saved last", and a caller that supplies its own provenance is ignored in
// both directions.

// Observe the real recovery directory reads rather than exposing a production
// counter or replacing the Repository's recovery implementation.
async function observeWorkspaceRecovery(action, afterRead = null) {
  const original = fs.readdir;
  const recoveredProjects = [];
  fs.readdir = async (...args) => {
    const result = await original(...args);
    const directory = String(args[0]);
    if (directory.endsWith(`${path.sep}.pageroot${path.sep}transactions`)) {
      const project = await json(path.join(path.dirname(directory), "project.json"));
      recoveredProjects.push(project.projectId);
    }
    if (afterRead) await afterRead(directory);
    return result;
  };
  syncBuiltinESMExports();
  try { return { workspace: await action(), recoveredProjects }; }
  finally { fs.readdir = original; syncBuiltinESMExports(); }
}

for (const recovery of ["none", "missing-save-source", "promotion"]) {
  test(`workspace recovers one exact project once (${recovery})`, async (t) => {
    const value = await fixture(t);
    const imported = await importSource(value);
    await value.repository.initialize();
    const changed = html("settled before workspace facts");
    if (recovery === "missing-save-source") {
      const interrupted = new ProjectFileRepository({ projectsRoot: value.projects,
        failpoint: (name) => name === "save-source-displaced" });
      await assert.rejects(interrupted.saveWorkingCopy({ target: imported.target,
        expectedSourceSha256: imported.target.sourceSha256, html: changed, editRevision: 1 }), { code: "INJECTED_FAILPOINT" });
      await assert.rejects(readFile(imported.target.exactSourcePath), { code: "ENOENT" });
    } else if (recovery === "promotion") {
      const candidate = await value.repository.createCandidate({ target: imported.target,
        requestId: "req_catalog_recovery", candidateId: "candidate_catalog_recovery",
        expectedSourceSha256: imported.target.sourceSha256, html: changed });
      const interrupted = new ProjectFileRepository({ projectsRoot: value.projects,
        failpoint: (name) => name === "promotion-working-copy-created" });
      await assert.rejects(interrupted.promoteCandidate({ target: imported.target,
        candidateId: candidate.candidate.candidateId }), { code: "INJECTED_FAILPOINT" });
    }
    const observed = await observeWorkspaceRecovery(() => value.repository.workspace({ sourcePath: imported.target.exactSourcePath }));
    assert.deepEqual(observed.recoveredProjects, [imported.target.projectId]);
    assert.equal(observed.workspace.target.projectId, imported.target.projectId);
    assert.equal(observed.workspace.target.documentId, imported.target.documentId);
    assert.equal(observed.workspace.manifest.versions.length, recovery === "promotion" ? 2 : 1);
    assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), recovery === "missing-save-source" ? changed : html("V1"));
    if (recovery === "promotion") {
      const latest = observed.workspace.manifest.workingCopies.find((workingCopy) => workingCopy.versionId === "ver_0002");
      assert.equal(await readFile(path.join(imported.target.projectRootPath, latest.sourceRelativePath), "utf8"), changed);
    }
    t.diagnostic(`${recovery}: 1 transaction-directory scan; source and recovered Version bytes verified`);
  });
}

test("workspace recovers a different resolved project after an external directory exchange", async (t) => {
  const value = await fixture(t);
  const first = await importSource(value, "first/shared.html", html("first project"));
  const second = await importSource(value, "second/shared.html", html("second project"));
  await value.repository.initialize();
  const firstRoot = first.target.projectRootPath;
  const secondRoot = second.target.projectRootPath;
  const firstSubmissions = path.join(firstRoot, ".pageroot", "submissions");
  await mkdir(firstSubmissions, { recursive: true });
  await mkdir(path.join(secondRoot, ".pageroot", "submissions"), { recursive: true });
  let exchanged = false;
  const observed = await observeWorkspaceRecovery(
    () => value.repository.workspace({ sourcePath: first.target.exactSourcePath }),
    async (directory) => {
      // This is the final read of the first recovery. Exchange complete valid
      // synthetic projects before resolveOpenTarget performs its fresh reads.
      if (directory !== firstSubmissions || exchanged) return;
      exchanged = true;
      const parked = path.join(value.root, "parked-project");
      await rename(firstRoot, parked);
      await rename(secondRoot, firstRoot);
      await rename(parked, secondRoot);
      const registry = await json(registryPath(value));
      registry.projects[first.target.projectId].registeredProjectRootPath = secondRoot;
      registry.projects[second.target.projectId].registeredProjectRootPath = firstRoot;
      await writeFile(registryPath(value), JSON.stringify(registry));
    },
  );
  assert.equal(exchanged, true);
  assert.deepEqual(observed.recoveredProjects, [first.target.projectId, second.target.projectId]);
  assert.equal(observed.workspace.target.projectId, second.target.projectId);
  assert.equal(observed.workspace.target.documentId, second.target.documentId);
  assert.equal(observed.workspace.content, html("second project"));
});
