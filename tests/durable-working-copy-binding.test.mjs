import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, link, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { readHtmlFile } from "../bridge/project-file-repository/path-safety.mjs";
import { sourceBindingPath } from "../bridge/project-file-repository/source-binding.mjs";
import { fixture, importSource, html, json } from "./project-file-repository-harness.mjs";
import { createBridgeTestEnvironment } from "./helpers/bridge-test-environment.mjs";
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
async function restart(projectsRoot) {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
    import { ProjectFileRepository } from './bridge/project-file-repository.mjs';
    const repository = new ProjectFileRepository({projectsRoot:process.argv[1]});
    await repository.initialize();
    console.log(JSON.stringify(await repository.listRegisteredProjects()));
  `, projectsRoot], { cwd: root });
  return JSON.parse(stdout);
}
async function drift(target, fields = ["device", "inode", "birthtimeMs"]) {
  const manifestPath = path.join(target.projectRootPath, ".pageroot", "manifest.json");
  const manifest = await json(manifestPath);
  for (const member of manifest.workingCopies) for (const field of fields) {
    member.fileIdentity[field] = field === "birthtimeMs" ? 123 : "123";
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
}
for (const fields of [["device"], ["inode"], ["birthtimeMs"], ["device", "inode", "birthtimeMs"]]) {
  test(`new process recovers persisted ${fields.join("/")} drift without changing source or Version`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const before = await readFile(target.exactSourcePath);
    await drift(target, fields);
    const rows = await restart(value.projects);
    assert.equal(rows[0].availability, "ready");
    assert.deepEqual(await readFile(target.exactSourcePath), before);
    const manifest = await json(path.join(target.projectRootPath, ".pageroot", "manifest.json"));
    assert.equal(manifest.versions.length, 1);
    assert.equal(manifest.workingCopies[0].fileIdentity.device, String((await lstat(target.exactSourcePath)).dev));
    assert.equal((await lstat(sourceBindingPath(target.projectRootPath, target.workingCopyId))).ino, (await lstat(target.exactSourcePath)).ino);
  });
}
test("five projects migrate all fifteen Working Copies without touching HTML", async (t) => {
  const value = await fixture(t); const copies = [];
  for (let i = 0; i < 5; i += 1) {
    const { target } = await importSource(value, `project-${i}.html`);
    copies.push(target);
    for (let version = 2; version <= 3; version += 1) {
      const candidateId = `candidate_binding_${i}_${version}`;
      await value.repository.createCandidate({target, requestId:`req_binding_${i}_${version}`, candidateId, html:html(`v${version}`), expectedSourceSha256:target.sourceSha256});
      const promoted = await value.repository.promoteCandidate({target, candidateId, decisionOperationId: `promote_${candidateId}`}); copies.push(promoted.target);
    }
    await drift(target);
  }
  const bytes = await Promise.all(copies.map((target) => readFile(target.exactSourcePath)));
  for (const target of copies) await rm(sourceBindingPath(target.projectRootPath, target.workingCopyId), {force:true});
  const rows = await restart(value.projects);
  assert.equal(rows.length, 5); assert.ok(rows.every((row) => row.availability === "ready"));
  for (const [index,target] of copies.entries()) {
    assert.deepEqual(await readFile(target.exactSourcePath), bytes[index]);
    assert.equal((await lstat(sourceBindingPath(target.projectRootPath,target.workingCopyId))).ino, (await lstat(target.exactSourcePath)).ino);
  }
});
for (const removeBindings of [false, true]) {
  test(`startup migration batches observations and bounds binding scans (missing anchors: ${removeBindings})`, async (t) => {
    const value = await fixture(t);
    const imported = await importSource(value);
    let target = imported.target;
    const count = 12;
    for (let ordinal = 2; ordinal <= count; ordinal += 1) {
      const candidateId = `candidate_startup_scale_${ordinal}`;
      await value.repository.createCandidate({ target, requestId: `req_startup_scale_${ordinal}`, candidateId,
        html: html(`version ${ordinal}`), expectedSourceSha256: target.sourceSha256 });
      target = (await value.repository.promoteCandidate({ target, candidateId, decisionOperationId: `promote_${candidateId}` })).target;
    }
    await drift(target);
    const manifestPath = path.join(target.projectRootPath, ".pageroot/manifest.json");
    const before = await json(manifestPath);
    if (removeBindings) for (const member of before.workingCopies) {
      await rm(sourceBindingPath(target.projectRootPath, member.workingCopyId));
    }
    const original = { readdir: filesystem.readdir, lstat: filesystem.lstat, rename: filesystem.rename };
    let sourceScans = 0; let bindingStats = 0; let manifestWrites = 0;
    filesystem.readdir = async (targetPath, ...options) => {
      if (String(targetPath) === target.projectRootPath) sourceScans += 1;
      return original.readdir(targetPath, ...options);
    };
    filesystem.lstat = async (targetPath, ...options) => {
      if (String(targetPath).endsWith(".ref")) bindingStats += 1;
      return original.lstat(targetPath, ...options);
    };
    filesystem.rename = async (source, destination, ...options) => {
      if (String(destination) === manifestPath) manifestWrites += 1;
      return original.rename(source, destination, ...options);
    };
    syncBuiltinESMExports();
    try { await new ProjectFileRepository({ projectsRoot: value.projects }).initialize(); }
    finally { Object.assign(filesystem, original); syncBuiltinESMExports(); }
    assert.equal(manifestWrites, 1, "all observation refreshes share one manifest publication");
    assert.ok(sourceScans <= 2, `unexpected repeated source scans: ${sourceScans}`);
    assert.ok(bindingStats <= count * 8, `binding checks must grow linearly: ${bindingStats}`);
    const after = await json(manifestPath);
    assert.deepEqual(after.versions, before.versions);
    for (const member of after.workingCopies) {
      const sourcePath = path.join(target.projectRootPath, member.sourceRelativePath);
      const source = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath: target.projectRootPath });
      const state = await json(path.join(target.projectRootPath, ".pageroot", member.stateRelativePath));
      assert.equal(source.sha256, state.currentSha256);
      assert.equal(member.fileIdentity.device, String(source.information.dev));
      assert.equal((await lstat(sourceBindingPath(target.projectRootPath, member.workingCopyId))).ino, source.information.ino);
    }
  });
}
test("Bridge startup migrates inactive members before serving the project catalog", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  const candidateId = "candidate_bridge_migration_0001";
  await value.repository.createCandidate({ target, requestId: "req_bridge_migration_0001", candidateId, html: html("next"), expectedSourceSha256: target.sourceSha256 });
  const promoted = await value.repository.promoteCandidate({ target, candidateId, decisionOperationId: `promote_${candidateId}` });
  const members = [target, promoted.target];
  const bytes = await Promise.all(members.map((member) => readFile(member.exactSourcePath)));
  await drift(target);
  for (const member of members) await rm(sourceBindingPath(member.projectRootPath, member.workingCopyId));
  const bridge = await createBridgeTestEnvironment(t);
  await bridge.start({ HTML_AI_PROJECT_FILES_ROOT: value.projects });
  const { response, body } = await bridge.requestJson("/registered-projects");
  assert.equal(response.status, 200);
  assert.equal(body.projects[0].availability, "ready");
  for (const [index, member] of members.entries()) {
    assert.deepEqual(await readFile(member.exactSourcePath), bytes[index]);
    assert.equal((await lstat(sourceBindingPath(member.projectRootPath, member.workingCopyId))).ino, (await lstat(member.exactSourcePath)).ino);
  }
});
test("Finder HTML and folder rename survives stale observations and a new process", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); await drift(target);
  const renamedHtml = path.join(target.projectRootPath,"renamed.html"); await rename(target.exactSourcePath,renamedHtml);
  const renamedRoot = path.join(value.projects,"renamed-project"); await rename(target.projectRootPath,renamedRoot);
  const rows = await restart(value.projects);
  assert.equal(rows[0].availability,"ready"); assert.equal(rows[0].activeSourcePath,path.join(renamedRoot,"renamed.html"));
});
test("copy-delete move with broken hard links rebinds exact member paths", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value);
  const destination = path.join(value.projects,"moved-to-new-volume"); await cp(target.projectRootPath,destination,{recursive:true}); await rm(target.projectRootPath,{recursive:true});
  const rows = await restart(value.projects); assert.equal(rows[0].availability,"ready");
  const memberPath = path.join(destination,path.basename(target.exactSourcePath));
  assert.equal((await lstat(sourceBindingPath(destination,target.workingCopyId))).ino,(await lstat(memberPath)).ino);
});
test("duplicate project quarantines only that identity, even at an existing registered path", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); const healthy = await importSource(value,"healthy.html");
  await cp(target.projectRootPath,path.join(value.projects,"duplicate"),{recursive:true});
  const rows = await restart(value.projects);
  assert.equal(rows.find((row)=>row.projectId===target.projectId).sourceStatus,"duplicate");
  assert.equal(rows.find((row)=>row.projectId===healthy.target.projectId).availability,"ready");
  assert.ok(await value.repository.resolveOpenTarget({sourcePath:healthy.target.exactSourcePath}));
  await assert.rejects(value.repository.saveWorkingCopy({target,html:html("denied"),expectedSourceSha256:target.sourceSha256}),{code:"REGISTERED_PROJECT_AMBIGUOUS"});
});
test("incomplete copied project records do not quarantine a complete registered project", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  for (const missing of ["manifest.json", "runtime-state.json"]) {
    const partialRoot = path.join(value.projects, `partial-${missing}`);
    await cp(target.projectRootPath, partialRoot, { recursive: true });
    await rm(path.join(partialRoot, ".pageroot", missing));
  }
  const rows = await restart(value.projects);
  assert.equal(rows[0].availability, "ready");
  assert.equal(rows[0].sourceStatus, "unknown");
  const current = await value.repository.resolveOpenTarget({ sourcePath: target.exactSourcePath });
  assert.equal(current.projectId, target.projectId);
  await value.repository.saveWorkingCopy({ target: current, html: html("saved"), expectedSourceSha256: current.sourceSha256 });
  assert.equal(await readFile(target.exactSourcePath, "utf8"), html("saved"));
});
test("same-hash unregistered copies never become managed; duplicate hard links isolate the binding", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value);
  const copy = path.join(target.projectRootPath,"copy.html"); await cp(target.exactSourcePath,copy);
  assert.equal(await value.repository.resolveOpenTarget({sourcePath:copy}),null);
  await link(target.exactSourcePath,path.join(target.projectRootPath,"hardlink.html"));
  const rows = await restart(value.projects); assert.equal(rows[0].sourceStatus,"duplicate");
  await assert.rejects(value.repository.saveWorkingCopy({target,html:html("denied"),expectedSourceSha256:target.sourceSha256}),{code:"MANAGED_PATH_AMBIGUOUS"});
});
test("missing HTML retains version browsing and restores only verified anchor bytes without overwrite", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); const bytes=await readFile(target.exactSourcePath);
  await rm(target.exactSourcePath); const rows=await restart(value.projects);
  assert.equal(rows[0].sourceStatus,"missing"); assert.equal(rows[0].canRestoreWorkingCopy,true); assert.equal(rows[0].documentId,target.documentId);
  assert.equal((await value.repository.listRegisteredProjectVersionSummaries({projectId:target.projectId})).versions.length,1);
  await value.repository.restoreRegisteredWorkingCopy({projectId:target.projectId}); assert.deepEqual(await readFile(target.exactSourcePath),bytes);
  await assert.rejects(value.repository.restoreRegisteredWorkingCopy({projectId:target.projectId}),{code:"WORKING_COPY_CONFLICT"});
});
for (const atomic of [false,true]) test(`external ${atomic?"replacement":"in-place write"} stays an external-content state`,async(t)=>{
  const value=await fixture(t);const {target}=await importSource(value); const external=html("external");
  if(atomic){await writeFile(`${target.exactSourcePath}.tmp`,external);await rename(`${target.exactSourcePath}.tmp`,target.exactSourcePath);}else await writeFile(target.exactSourcePath,external);
  const rows=await restart(value.projects);assert.equal(rows[0].sourceStatus,"unknown");assert.equal((await value.repository.resolveRegisteredProjectOpenTarget({projectId:target.projectId})).html,external);assert.equal(await readFile(target.exactSourcePath,"utf8"),external);
});
test("a replaced path during descriptor read is rejected",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const replacement=path.join(target.projectRootPath,"replacement.tmp");await writeFile(replacement,html("replacement"));
 await assert.rejects(readHtmlFile(target.exactSourcePath,"Working Copy",{beforeRead:()=>rename(replacement,target.exactSourcePath)}),{code:"SOURCE_HASH_CONFLICT"});
});
for (const stage of ["save-prepared","save-source-displaced","save-source-written","save-anchor-switched","save-state-written","save-manifest-written","save-committed"]) test(`new process resolves ${stage} crash plus device drift`,async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const before=await readFile(target.exactSourcePath,"utf8");const after=html("saved");
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:(name)=>name===stage});
 await assert.rejects(writer.saveWorkingCopy({target,html:after,expectedSourceSha256:target.sourceSha256,editRevision:1}));await drift(target);
 assert.equal((await restart(value.projects))[0].availability,"ready");assert.equal(await readFile(target.exactSourcePath,"utf8"),stage==="save-prepared"?before:after);
});
test("save detects same-hash physical replacement at the commit boundary",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value); const before=await readFile(target.exactSourcePath);
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:async(name)=>{if(name==="save-before-commit"){await writeFile(`${target.exactSourcePath}.tmp`,before);await rename(`${target.exactSourcePath}.tmp`,target.exactSourcePath);}return false;}});
 await assert.rejects(writer.saveWorkingCopy({target,html:html("must not overwrite"),expectedSourceSha256:target.sourceSha256,editRevision:1}),{code:"WORKING_COPY_CONFLICT"});assert.deepEqual(await readFile(target.exactSourcePath),before);
});

for (const stage of ["promotion-prepared", "promotion-snapshot-created", "promotion-working-copy-prepared", "promotion-working-copy-created", "promotion-manifest-committed"]) {
  test(`new process recovers ${stage} with stale transaction and manifest observations`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const candidateId = "candidate_binding_crash_01";
    await value.repository.createCandidate({ target, requestId:"req_binding_crash_01", candidateId, html:html("V2"), expectedSourceSha256:target.sourceSha256 });
    const writer = new ProjectFileRepository({ projectsRoot:value.projects, failpoint:(name)=>name===stage });
    await assert.rejects(writer.promoteCandidate({target,candidateId,decisionOperationId: `promote_${candidateId}`}));
    await drift(target);
    const journalPath=path.join(target.projectRootPath,".pageroot","transactions",`promote_${candidateId}`,"transaction.json");
    // Promotion journals keep legacy observations for compatibility, not authority.
    const transaction=await json(journalPath);
    if(transaction.preparedWorkingCopyFileIdentity) transaction.preparedWorkingCopyFileIdentity.device="777";
    if(transaction.workingCopy) transaction.workingCopy.fileIdentity.device="888";
    await writeFile(journalPath,JSON.stringify(transaction));
    const rows=await restart(value.projects);assert.equal(rows[0].availability,"ready");
    const manifest=await json(path.join(target.projectRootPath,".pageroot","manifest.json"));
    assert.equal(manifest.versions.length,2);assert.equal(manifest.latestOfficialVersionId,"ver_0002");
  });
}
test("architecture rejects persisted physical comparisons including local aliases", async () => {
  const { parseModule, persistentFileIdentityComparisons } = await import("../scripts/architecture-ast-query.mjs");
  for (const source of [
    "sameFileIdentity(member.fileIdentity, copyFileIdentity(stat))",
    "const stored = member.fileIdentity; const saved = stored; sameFileIdentity(saved, current)",
    "const { fileIdentity: old } = member; sameFileIdentity(old, current)",
    "import { sameFileIdentity as equal } from './path-safety.mjs'; equal(record['rootFileIdentity'], current)",
  ]) assert.ok(persistentFileIdentityComparisons(parseModule("example.mjs",source)).length);
  assert.equal(persistentFileIdentityComparisons(parseModule("example.mjs","sameFileIdentity(copyFileIdentity(anchor.information), copyFileIdentity(current))")).length,0);
});

test("replacement after the final Hash check is preserved instead of overwritten",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const external=html("late external replacement");
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:async(name)=>{
   if(name==="save-before-publication"){await writeFile(`${target.exactSourcePath}.external`,external);await rename(`${target.exactSourcePath}.external`,target.exactSourcePath);}return false;
 }});
 await assert.rejects(writer.saveWorkingCopy({target,html:html("must not overwrite"),expectedSourceSha256:target.sourceSha256,editRevision:1}),{code:"WORKING_COPY_CONFLICT"});
 assert.equal(await readFile(target.exactSourcePath,"utf8"),external);
});


test("two Working Copy anchors cannot claim one surviving visible HTML", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  await value.repository.createCandidate({ target, requestId: "req_binding_duplicate", candidateId: "candidate_binding_duplicate", html: html("v2"), expectedSourceSha256: target.sourceSha256 });
  const promoted = await value.repository.promoteCandidate({ target, candidateId: "candidate_binding_duplicate", decisionOperationId: "promote_candidate_binding_duplicate" });
  const second = promoted.target;
  await rm(sourceBindingPath(second.projectRootPath, second.workingCopyId));
  await rm(second.exactSourcePath);
  await link(sourceBindingPath(target.projectRootPath, target.workingCopyId), sourceBindingPath(second.projectRootPath, second.workingCopyId));
  assert.equal((await restart(value.projects))[0].sourceStatus, "duplicate");
  await assert.rejects(value.repository.saveWorkingCopy({ target, html: html("denied"), expectedSourceSha256: target.sourceSha256 }), { code: "MANAGED_PATH_AMBIGUOUS" });
});


test("registered projection reads an exact inactive Working Copy without activating another Version", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  await value.repository.createCandidate({ target, requestId: "req_binding_projection", candidateId: "candidate_binding_projection", html: html("v2"), expectedSourceSha256: target.sourceSha256 });
  const promoted = await value.repository.promoteCandidate({ target, candidateId: "candidate_binding_projection", decisionOperationId: "promote_candidate_binding_projection" });
  const exact = await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId, workingCopyId: target.workingCopyId });
  assert.equal(exact.target.workingCopyId, target.workingCopyId);
  assert.equal(exact.html, await readFile(target.exactSourcePath, "utf8"));
  assert.equal((await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId })).target.workingCopyId, promoted.target.workingCopyId);
  await assert.rejects(value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId, workingCopyId: "../escape" }));
});

for (const [readNumber, sameBytes] of [[1, true], [1, false], [2, true]]) {
  test(`renamed binding rejects replacement before read ${readNumber} with ${sameBytes ? "same" : "different"} bytes`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const manifestPath = path.join(target.projectRootPath, ".pageroot", "manifest.json");
    const manifestBefore = await readFile(manifestPath);
    const bindingPath = sourceBindingPath(target.projectRootPath, target.workingCopyId);
    const bindingBefore = await lstat(bindingPath);
    const renamed = path.join(target.projectRootPath, "renamed.html");
    await rename(target.exactSourcePath, renamed);
    const replacement = path.join(target.projectRootPath, "replacement.tmp");
    const bytes = sameBytes ? await readFile(renamed) : Buffer.from(html("unregistered replacement"));
    await writeFile(replacement, bytes);
    const original = { open: filesystem.open, lstat: filesystem.lstat };
    let replaced = false;
    filesystem.lstat = async (filePath, ...options) => {
      const information = await original.lstat(filePath, ...options);
      const stack = new Error().stack || "";
      if (readNumber === 1 && !replaced && String(filePath) === renamed
        && stack.includes("findBoundSource") && stack.split("\n")[2]?.includes("regularInformation")) {
        await rename(replacement, renamed); replaced = true;
      }
      return information;
    };
    filesystem.open = async (filePath, ...options) => {
      const handle = await original.open(filePath, ...options);
      if (readNumber === 2 && !replaced && String(filePath) === renamed) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (!replaced) { await rename(replacement, renamed); replaced = true; }
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId }),
        { code: "WORKING_COPY_CONFLICT" });
    } finally { Object.assign(filesystem, original); syncBuiltinESMExports(); }
    assert.equal(replaced, true);
    assert.deepEqual(await readFile(manifestPath), manifestBefore);
    assert.equal((await lstat(bindingPath)).ino, bindingBefore.ino);
    assert.deepEqual(await readFile(renamed), bytes);
  });
}

for (const collision of ["occupied-copy", "occupied-link", "replaced-link"]) {
  test(`restore rejects ${collision} without adopting the occupied file`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const bindingPath = sourceBindingPath(target.projectRootPath, target.workingCopyId);
    const bindingBefore = await lstat(bindingPath);
    const bytes = await readFile(target.exactSourcePath);
    const manifestPath = path.join(target.projectRootPath, ".pageroot", "manifest.json");
    const manifestBefore = await readFile(manifestPath);
    await rm(target.exactSourcePath);
    const originalLink = filesystem.link;
    let injected = false;
    filesystem.link = async (source, destination) => {
      if (!injected && String(source) === bindingPath && String(destination) === target.exactSourcePath) {
        injected = true;
        if (collision === "occupied-copy") await writeFile(destination, bytes);
        if (collision === "occupied-link") await originalLink(source, destination);
        if (collision === "replaced-link") {
          await originalLink(source, destination);
          const temporary = `${destination}.replacement`;
          await writeFile(temporary, bytes); await rename(temporary, destination);
          return;
        }
      }
      return originalLink(source, destination);
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(value.repository.restoreRegisteredWorkingCopy({ projectId: target.projectId }),
        { code: "WORKING_COPY_CONFLICT" });
    } finally { filesystem.link = originalLink; syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.deepEqual(await readFile(manifestPath), manifestBefore);
    assert.equal((await lstat(bindingPath)).ino, bindingBefore.ino);
    assert.deepEqual(await readFile(target.exactSourcePath), bytes);
  });
}

for (const replacementStage of ["before-recovery", "before-binding-refresh", "after-binding-refresh"]) {
  test(`Promotion recovery rejects identical-byte replacement ${replacementStage}`, async (t) => {
    const value = await fixture(t);
    const { target } = await importSource(value);
    const candidateId = "candidate_promotion_live_identity";
    await value.repository.createCandidate({ target, requestId: "req_promotion_live_identity", candidateId,
      html: html("V2"), expectedSourceSha256: target.sourceSha256 });
    const writer = new ProjectFileRepository({ projectsRoot: value.projects,
      failpoint: (name) => name === "promotion-working-copy-created" });
    await assert.rejects(writer.promoteCandidate({ target, candidateId, decisionOperationId: `promote_${candidateId}` }));
    const transaction = await json(path.join(target.projectRootPath, ".pageroot", "transactions",
      `promote_${candidateId}`, "transaction.json"));
    const visiblePath = path.join(target.projectRootPath, transaction.workingCopy.sourceRelativePath);
    const original = await readFile(visiblePath);
    const originalInformation = await lstat(visiblePath);
    const manifestPath = path.join(target.projectRootPath, ".pageroot", "manifest.json");
    const manifestBefore = await readFile(manifestPath);
    let replaced = false;
    const replace = async () => {
      await writeFile(`${visiblePath}.replacement`, original);
      await rename(`${visiblePath}.replacement`, visiblePath);
      replaced = true;
    };
    const originalOpen = filesystem.open;
    const originalRename = filesystem.rename;
    try {
      if (replacementStage === "before-recovery") await replace();
      else if (replacementStage === "after-binding-refresh") {
        filesystem.rename = async function (source, destination) {
          await originalRename(source, destination);
          if (!replaced && destination === sourceBindingPath(target.projectRootPath, transaction.workingCopy.workingCopyId)) await replace();
        };
        syncBuiltinESMExports();
      } else {
        filesystem.open = async function (filePath, ...args) {
          const handle = await originalOpen.call(this, filePath, ...args);
          if (!replaced && filePath === path.join(target.projectRootPath, ".pageroot", transaction.preparedWorkingCopyRelativePath)) {
            const close = handle.close.bind(handle);
            handle.close = async () => { await close(); if (!replaced) await replace(); };
          }
          return handle;
        };
        syncBuiltinESMExports();
      }
      const recovery = new ProjectFileRepository({ projectsRoot: value.projects });
      await assert.rejects(recovery.promoteCandidate({ target, candidateId, decisionOperationId: `promote_${candidateId}` }),
        (error) => ["PROMOTION_PATH_REPLACED", "WORKING_COPY_CONFLICT"].includes(error.code));
    } finally {
      filesystem.open = originalOpen;
      filesystem.rename = originalRename;
      syncBuiltinESMExports();
    }
    assert.equal(replaced, true);
    assert.notEqual((await lstat(visiblePath)).ino, originalInformation.ino);
    assert.deepEqual(await readFile(visiblePath), original);
    assert.deepEqual(await readFile(manifestPath), manifestBefore);
    const binding = await lstat(sourceBindingPath(target.projectRootPath, transaction.workingCopy.workingCopyId)).catch(() => null);
    assert.ok(!binding || binding.ino === originalInformation.ino);
  });
}
