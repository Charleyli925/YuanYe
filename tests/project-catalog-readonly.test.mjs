import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fixture, html, importSource, promoteNextVersion, registryPath } from "./project-file-repository-harness.mjs";
async function observeReads(action) {
  const originals = Object.fromEntries(["writeFile", "rename", "link", "unlink", "mkdir", "rm", "open", "readFile", "readdir"].map((key) => [key, fs[key]]));
  const writes = []; const htmlReads = [];
  const reads = []; const directoryReads = [];
  for (const key of Object.keys(originals)) fs[key] = async (...args) => {
    if (["writeFile", "rename", "link", "unlink", "mkdir", "rm"].includes(key)
      || (key === "open" && /[wa+]/u.test(String(args[1])))) writes.push([key, String(args[0])]);
    if (["open", "readFile"].includes(key) && /\.html?$/iu.test(String(args[0]))) htmlReads.push(String(args[0]));
    if (key === "readFile") reads.push(String(args[0]));
    if (key === "readdir") directoryReads.push(String(args[0]));
    return originals[key](...args);
  };
  syncBuiltinESMExports();
  let result;
  try { result = await action(); } finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
  assert.deepEqual(writes, []); assert.deepEqual(htmlReads, []);
  return { result, reads, directoryReads };
}
test("catalog expansion and refresh do not write or read HTML after startup recovery", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await promoteNextVersion(f.repository, target, "catalog_v2");
  await f.repository.initialize();
  await observeReads(async () => {
    for (let i = 0; i < 3; i++) {
      const rows = await f.repository.listRegisteredProjects();
      assert.equal(rows[0].sourceStatus, "unknown");
      assert.equal((await f.repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions.length, 2);
    }
  });
});
test("catalog discovers renamed folders without rebinding registry and retains missing-file metadata", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await f.repository.initialize();
  const before = await fs.readFile(registryPath(f));
  const renamed = `${target.projectRootPath}-renamed`;
  await fs.rename(target.projectRootPath, renamed);
  await fs.rm(path.join(renamed, path.basename(target.exactSourcePath)));
  await observeReads(async () => {
    const rows = await f.repository.listRegisteredProjects();
    assert.equal(rows[0].documentId, target.documentId);
    assert.equal(rows[0].sourceStatus, "missing");
    assert.equal((await f.repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions.length, 1);
  });
  assert.deepEqual(await fs.readFile(registryPath(f)), before);
});

test("each catalog query scans project identities once while validating every registered project", async (t) => {
  const f = await fixture(t);
  const projects = [];
  for (let i = 0; i < 4; i++) projects.push(await importSource(f, `catalog-${i}.html`));
  await f.repository.initialize();
  const decoyRoot = path.join(f.projects, "unregistered-metadata");
  await fs.mkdir(path.join(decoyRoot, ".pageroot"), { recursive: true });
  const decoyIdentity = path.join(decoyRoot, ".pageroot", "project.json");
  const project = JSON.parse(await fs.readFile(path.join(projects[0].target.projectRootPath, ".pageroot", "project.json"), "utf8"));
  await fs.writeFile(decoyIdentity, JSON.stringify({ ...project, projectId: `project_${"a".repeat(32)}` }));
  const registryBefore = await fs.readFile(registryPath(f));
  for (let query = 0; query < 2; query++) {
    const observed = await observeReads(() => f.repository.listRegisteredProjects());
    assert.equal(observed.result.length, projects.length);
    assert.ok(observed.result.every((row) => row.availability === "ready" && row.sourceStatus === "unknown"));
    assert.equal(observed.directoryReads.filter((file) => file === f.projects).length, 1);
    assert.equal(observed.reads.filter((file) => file === decoyIdentity).length, 1);
    const identityReads = observed.reads.filter((file) => file.endsWith("/.pageroot/project.json"));
    t.diagnostic(`query ${query + 1}: ${projects.length} Registry members, 5 visible directories, 1 census, ${identityReads.length} project identity reads including complete contract validation`);
  }
  assert.deepEqual(await fs.readFile(registryPath(f)), registryBefore);
});

test("census retains duplicate identities and isolates malformed, hidden and symlink directories", async (t) => {
  const f = await fixture(t);
  const healthy = await importSource(f, "healthy.html");
  const duplicated = await importSource(f, "duplicated.html");
  const damaged = await importSource(f, "damaged.html");
  await f.repository.initialize();
  await fs.cp(healthy.target.projectRootPath, path.join(f.projects, ".hidden-copy"), { recursive: true });
  await fs.symlink(healthy.target.projectRootPath, path.join(f.projects, "linked-copy"));
  await fs.cp(duplicated.target.projectRootPath, path.join(f.projects, "duplicate-copy"), { recursive: true });
  const malformed = path.join(f.projects, "malformed", ".pageroot");
  await fs.mkdir(malformed, { recursive: true });
  await fs.writeFile(path.join(malformed, "project.json"), "{invalid");
  const incompleteCopy = path.join(f.projects, "incomplete-copy");
  await fs.cp(healthy.target.projectRootPath, incompleteCopy, { recursive: true });
  await fs.writeFile(path.join(incompleteCopy, ".pageroot", "manifest.json"), "{}");
  const runtimePath = path.join(damaged.target.projectRootPath, ".pageroot", "runtime-state.json");
  const runtime = JSON.parse(await fs.readFile(runtimePath, "utf8"));
  await fs.writeFile(runtimePath, JSON.stringify({ ...runtime, documentId: healthy.target.documentId }));
  const registryBefore = await fs.readFile(registryPath(f));
  const observed = await observeReads(() => f.repository.listRegisteredProjects());
  const byId = new Map(observed.result.map((row) => [row.projectId, row]));
  assert.equal(byId.get(healthy.target.projectId).availability, "ready");
  assert.equal(byId.get(duplicated.target.projectId).sourceStatus, "duplicate");
  assert.equal(byId.get(damaged.target.projectId).sourceStatus, "invalid");
  assert.equal(observed.directoryReads.filter((file) => file === f.projects).length, 1);
  assert.equal(observed.reads.some((file) => /\/(?:\.hidden-copy|linked-copy)\//u.test(file)), false);
  assert.deepEqual(await fs.readFile(registryPath(f)), registryBefore);
});

test("a catalog census never authorizes a later open or save after an external duplicate appears", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await f.repository.initialize();
  assert.equal((await f.repository.listRegisteredProjects())[0].availability, "ready");
  const original = await fs.readFile(target.exactSourcePath);
  const duplicateRoot = path.join(f.projects, "late-copy");
  await fs.cp(target.projectRootPath, duplicateRoot, { recursive: true });
  await assert.rejects(f.repository.resolveOpenTarget({ sourcePath: target.exactSourcePath }), { code: "REGISTERED_PROJECT_AMBIGUOUS" });
  await assert.rejects(f.repository.saveWorkingCopy({ target, expectedSourceSha256: target.sourceSha256,
    html: html("must not save"), editRevision: 1 }), { code: "REGISTERED_PROJECT_AMBIGUOUS" });
  assert.deepEqual(await fs.readFile(target.exactSourcePath), original);
  assert.deepEqual(await fs.readFile(path.join(duplicateRoot, path.basename(target.exactSourcePath))), original);
  assert.equal((await f.repository.listRegisteredProjects())[0].sourceStatus, "duplicate");
});

test("a common census read failure remains isolated in catalog rows", async (t) => {
  const f = await fixture(t);
  await importSource(f, "one.html"); await importSource(f, "two.html");
  await f.repository.initialize();
  const original = fs.readdir;
  fs.readdir = async (...args) => {
    if (String(args[0]) === f.projects) throw Object.assign(new Error("synthetic directory unavailable"), { code: "EACCES" });
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    const observed = await observeReads(() => f.repository.listRegisteredProjects());
    assert.equal(observed.result.length, 2);
    assert.ok(observed.result.every((row) => row.availability !== "ready"));
    assert.equal(observed.directoryReads.filter((file) => file === f.projects).length, 1);
  } finally { fs.readdir = original; syncBuiltinESMExports(); }
});

test("open rereads replaced HTML and save refuses the stale catalog Hash", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await f.repository.initialize();
  const observed = await observeReads(() => f.repository.listRegisteredProjects());
  assert.equal(observed.result[0].availability, "ready");
  const external = html("external replacement after catalog");
  const replacement = path.join(target.projectRootPath, "replacement.tmp");
  await fs.writeFile(replacement, external);
  await fs.rename(replacement, target.exactSourcePath);
  const opened = await f.repository.resolveOpenTarget({ sourcePath: target.exactSourcePath });
  assert.equal(opened.projectId, target.projectId);
  assert.notEqual(opened.sourceSha256, target.sourceSha256);
  await assert.rejects(f.repository.saveWorkingCopy({ target, expectedSourceSha256: target.sourceSha256,
    html: html("stale editor write"), editRevision: 1 }), { code: "WORKING_COPY_CONFLICT" });
  assert.equal(await fs.readFile(target.exactSourcePath, "utf8"), external);
});
