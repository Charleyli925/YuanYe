import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { retireSaveTransaction } from "../bridge/project-file-repository/save-retirement.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { fixture as projectFixture, importSource, html, json } from "./project-file-repository-harness.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stemmio-retirement-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recovery = path.join(root, "recovery", "save_1");
  const transaction = path.join(root, "transactions", "save_1.json");
  await fs.mkdir(recovery, { recursive: true });
  await fs.mkdir(path.dirname(transaction));
  await fs.writeFile(path.join(recovery, "previous.html"), "old bytes");
  await fs.writeFile(transaction, "committed journal");
  return { root, recovery, transaction, args: {
    projectRootPath: root, recoveryPath: recovery, transactionPath: transaction,
    publicationDirectories: [root], verify: async () => {},
  } };
}

for (const stage of ["publication", "remove", "recovery-sync", "unlink", "transaction-sync"]) {
  for (const code of stage.includes("sync") || stage === "publication"
    ? ["EINVAL", "EISDIR", "EPERM", "EIO"] : ["EIO"]) {
    test(`retirement retains recovery responsibility after ${stage} ${code}`, async (t) => {
      const f = await fixture(t);
      const original = { open: fs.open, rm: fs.rm, unlink: fs.unlink };
      const order = [];
      const fail = (name) => {
        order.push(name);
        if (name === stage) throw Object.assign(new Error("injected filesystem failure"), { code });
      };
      fs.open = async (...args) => {
        const handle = await original.open(...args);
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          fail(args[0] === f.root ? "publication"
            : args[0] === path.dirname(f.recovery) ? "recovery-sync" : "transaction-sync");
          return sync();
        };
        return handle;
      };
      fs.rm = async (...args) => { fail("remove"); return original.rm(...args); };
      fs.unlink = async (...args) => { fail("unlink"); return original.unlink(...args); };
      syncBuiltinESMExports();
      let result;
      try { result = await retireSaveTransaction(f.args); }
      finally { Object.assign(fs, original); syncBuiltinESMExports(); }
      assert.equal(result, stage === "transaction-sync" ? "unlink-unconfirmed" : "retained");
      if (stage !== "transaction-sync") assert.equal(await fs.readFile(f.transaction, "utf8"), "committed journal");
      if (stage === "remove") {
        assert.equal(await fs.readFile(path.join(f.recovery, "previous.html"), "utf8"), "old bytes");
      }
      if (order.includes("unlink")) assert.ok(order.indexOf("recovery-sync") < order.indexOf("unlink"));
      // Model a crash restoring a deletion that was not yet durable. The
      // journal survives exactly the window in which recovery can reappear.
      if (stage === "recovery-sync") {
        await fs.mkdir(f.recovery);
        await fs.writeFile(path.join(f.recovery, "previous.html"), "late external bytes");
        assert.equal(await fs.readFile(f.transaction, "utf8"), "committed journal");
      }
    });
  }
}

test("retirement verifies after synchronization and preserves a late-write conflict", async (t) => {
  const f = await fixture(t);
  await assert.rejects(retireSaveTransaction({ ...f.args, verify: async () => {
    await fs.writeFile(path.join(f.recovery, "previous.html"), "late external bytes");
    throw new Error("source conflict");
  } }), /source conflict/);
  assert.equal(await fs.readFile(path.join(f.recovery, "previous.html"), "utf8"), "late external bytes");
  assert.equal(await fs.readFile(f.transaction, "utf8"), "committed journal");
});

test("successful retirement removes only the exact save recovery and journal", async (t) => {
  const f = await fixture(t);
  const other = path.join(path.dirname(f.transaction), "history_receipt.json");
  await fs.writeFile(other, "history receipt");
  assert.equal(await retireSaveTransaction(f.args), "retired");
  await assert.rejects(fs.stat(f.recovery), { code: "ENOENT" });
  await assert.rejects(fs.stat(f.transaction), { code: "ENOENT" });
  assert.equal(await fs.readFile(other, "utf8"), "history receipt");
  // A journal reappearing after a final sync failure has no recovery bytes to
  // resurrect. Retrying the same exact cleanup is idempotent.
  await fs.writeFile(f.transaction, "committed journal");
  assert.equal(await retireSaveTransaction(f.args), "retired");
});

test("continuous ordinary saves retire journals without creating Versions and reopen exact bytes", async (t) => {
  const value = await projectFixture(t);
  const imported = await importSource(value, "retire-saves.html");
  let target = imported.target;
  for (let revision = 1; revision <= 8; revision += 1) {
    const saved = await value.repository.saveWorkingCopy({ target, html: html(`edit ${revision}`),
      expectedSourceSha256: target.sourceSha256, editRevision: revision });
    target = saved.target;
    assert.equal((await fs.readdir(path.join(target.projectRootPath, ".pageroot", "transactions")))
      .filter((entry) => entry.startsWith("save_")).length, 0);
  }
  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({ sourcePath: target.exactSourcePath });
  assert.equal(reopened.content, html("edit 8"));
  assert.equal(reopened.workingCopyState.lastPersistedRevision, 8);
  assert.equal((await json(path.join(target.projectRootPath, ".pageroot", "manifest.json"))).versions.length, 1);
});

test("unsupported publication sync retains the journal and allows subsequent save and reopen", async (t) => {
  const value = await projectFixture(t);
  const imported = await importSource(value, "unsupported-sync.html");
  const originalOpen = fs.open;
  const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: async (name) => {
    if (name === "save-committed") {
      fs.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (args[0] === imported.target.projectRootPath) handle.sync = async () => {
          throw Object.assign(new Error("unsupported directory sync"), { code: "EINVAL" });
        };
        return handle;
      };
      syncBuiltinESMExports();
    }
    return false;
  } });
  let saved;
  try {
    saved = await repository.saveWorkingCopy({ target: imported.target, html: html("saved"),
      expectedSourceSha256: imported.target.sourceSha256, editRevision: 1 });
    assert.equal(saved.currentSha256, saved.target.sourceSha256);
  } finally { fs.open = originalOpen; syncBuiltinESMExports(); }
  const control = path.join(imported.target.projectRootPath, ".pageroot");
  const journals = (await fs.readdir(path.join(control, "transactions"))).filter((name) => name.startsWith("save_"));
  assert.equal(journals.length, 1);
  const journal = await json(path.join(control, "transactions", journals[0]));
  assert.equal(journal.state, "committed");
  await assert.rejects(fs.stat(path.join(control, "recovery", journal.recoveryId)), { code: "ENOENT" });
  const next = await value.repository.saveWorkingCopy({ target: saved.target, html: html("saved again"),
    expectedSourceSha256: saved.target.sourceSha256, editRevision: 2 });
  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(reopened.content, html("saved again"));
  assert.equal(reopened.workingCopyState.currentSha256, next.currentSha256);
  assert.equal((await json(path.join(control, "transactions", journals[0]))).state, "committed");
});

test("stock cleanup is bounded and preserves legacy, rollback and stale-target journals", async (t) => {
  const value = await projectFixture(t);
  const imported = await importSource(value, "stock-cleanup.html");
  const repository = new ProjectFileRepository({ projectsRoot: value.projects,
    failpoint: async (name) => name === "save-committed" });
  await assert.rejects(repository.saveWorkingCopy({ target: imported.target, html: html("current"),
    expectedSourceSha256: imported.target.sourceSha256, editRevision: 1 }), { code: "INJECTED_FAILPOINT" });
  const control = path.join(imported.target.projectRootPath, ".pageroot");
  const transactions = path.join(control, "transactions");
  const [original] = (await fs.readdir(transactions)).filter((name) => name.startsWith("save_"));
  const record = await json(path.join(transactions, original));
  // Synthetic stock from the earlier writer: committed journal and already
  // cleaned recovery directory, with no new product schema or marker.
  await fs.rm(path.join(control, "recovery", record.recoveryId), { recursive: true });
  await fs.unlink(path.join(transactions, original));
  for (let index = 0; index < 20; index += 1) {
    const recoveryId = `save_${record.workingCopyId}_1_${index.toString(16).padStart(32, "0")}`;
    await fs.writeFile(path.join(transactions, `${recoveryId}.json`), JSON.stringify({ ...record, recoveryId }));
  }
  const protectedRecords = [
    { ...record, recoveryId: undefined },
    { ...record, recovery: "rolled-back" },
    { ...record, targetSourceSha256: imported.target.sourceSha256 },
  ];
  for (let index = 0; index < protectedRecords.length; index += 1) {
    const entry = protectedRecords[index];
    const id = `save_${record.workingCopyId}_1_${(100 + index).toString(16).padStart(32, "0")}`;
    if (entry.recoveryId) entry.recoveryId = id;
    await fs.writeFile(path.join(transactions, `${id}.json`), JSON.stringify(entry));
  }
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.recoverProject({ projectRootPath: imported.target.projectRootPath });
  assert.equal((await fs.readdir(transactions)).filter((name) => name.startsWith("save_")).length, 7);
  await restarted.recoverProject({ projectRootPath: imported.target.projectRootPath });
  assert.equal((await fs.readdir(transactions)).filter((name) => name.startsWith("save_")).length, 3);
  assert.equal(await fs.readFile(imported.target.exactSourcePath, "utf8"), html("current"));
  assert.equal((await json(path.join(control, "working-copies", `${record.workingCopyId}.json`))).currentSha256, record.targetSourceSha256);
});

test("persistent unsupported directory sync permits two saves and reopening latest bytes", async (t) => {
  const value = await projectFixture(t);
  const imported = await importSource(value, "persistent-sync.html");
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if ((await handle.stat()).isDirectory()) handle.sync = async () => {
      throw Object.assign(new Error("unsupported directory sync"), { code: "EINVAL" });
    };
    return handle;
  };
  syncBuiltinESMExports();
  try {
    let target = imported.target;
    for (let revision = 1; revision <= 2; revision += 1) {
      target = (await value.repository.saveWorkingCopy({ target, html: html(`persistent ${revision}`),
        expectedSourceSha256: target.sourceSha256, editRevision: revision })).target;
    }
    const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({ sourcePath: target.exactSourcePath });
    assert.equal(reopened.content, html("persistent 2"));
    const control = path.join(target.projectRootPath, ".pageroot");
    assert.equal((await fs.readdir(path.join(control, "transactions"))).filter((name) => name.startsWith("save_")).length, 2);
    assert.deepEqual((await fs.readdir(path.join(control, "recovery"))).filter((name) => name.startsWith("save_")), []);
  } finally { fs.open = originalOpen; syncBuiltinESMExports(); }
});

test("source changed during retirement synchronization is retained as a real conflict", async (t) => {
  const value = await projectFixture(t);
  const imported = await importSource(value, "sync-external-write.html");
  const originalOpen = fs.open;
  const external = html("external during synchronization");
  const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: async (name) => {
    if (name === "save-committed") {
      fs.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (args[0] === imported.target.projectRootPath) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => { await fs.writeFile(imported.target.exactSourcePath, external); await sync(); };
        }
        return handle;
      };
      syncBuiltinESMExports();
    }
    return false;
  } });
  try {
    await assert.rejects(repository.saveWorkingCopy({ target: imported.target, html: html("editor save"),
      expectedSourceSha256: imported.target.sourceSha256, editRevision: 1 }), { code: "SAVE_RECOVERY_CONFLICT" });
  } finally { fs.open = originalOpen; syncBuiltinESMExports(); }
  assert.equal(await fs.readFile(imported.target.exactSourcePath, "utf8"), external);
  assert.equal((await fs.readdir(path.join(imported.target.projectRootPath, ".pageroot", "transactions")))
    .filter((name) => name.startsWith("save_")).length, 1);
});
