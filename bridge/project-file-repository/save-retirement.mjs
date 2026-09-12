// Optional garbage collection after Repository has committed an ordinary save.
// This owns no durable state: a retained journal is handled by normal recovery.
import { open, rm, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { assertRealPathInsideProject } from "./path-safety.mjs";

async function syncRequired(projectRootPath, target, expectedKind = "directory") {
  await assertRealPathInsideProject(projectRootPath, target, "save retirement publication", { expectedKind });
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    // Unlike best-effort publication sync, unsupported directory sync is not
    // proof that it is safe to discard the last recovery journal.
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function retireSaveTransaction({
  projectRootPath, transactionPath, recoveryPath, publicationDirectories, publicationFiles = [], verify,
}) {
  // Preserve the existing save cleanup boundary: unsupported publication sync
  // must not newly leave old recovery directories across later valid saves.
  await verify();
  try {
    await assertRealPathInsideProject(projectRootPath, recoveryPath, "save recovery");
    await rm(recoveryPath, { recursive: true, force: true });
    await syncRequired(projectRootPath, path.dirname(recoveryPath));
    for (const file of new Set(publicationFiles)) {
      await syncRequired(projectRootPath, file, "file");
    }
    for (const directory of new Set(publicationDirectories)) {
      await syncRequired(projectRootPath, directory);
    }
  } catch {
    return "retained";
  }
  // Journal deletion is new and requires every durability proof above. A
  // source/identity change during synchronization remains a real save error.
  await verify();
  let unlinked = false;
  try {
    await assertRealPathInsideProject(projectRootPath, transactionPath, "save transaction");
    await unlink(transactionPath);
    unlinked = true;
    await syncRequired(projectRootPath, path.dirname(transactionPath));
    return "retired";
  } catch {
    // A final sync failure cannot honestly promise the unlinked file remains.
    // Its possible reappearance is harmless: recovery removal was durable first.
    return unlinked ? "unlink-unconfirmed" : "retained";
  }
}
