import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareOriginalFileIdentity,
  workspaceSourceFingerprint,
} from "./e2e/electron/real-html/workspace-provenance.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

test("workspace provenance changes for untracked source bytes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pageroot-provenance-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "PageRoot Test"]);
  writeFileSync(path.join(root, "tracked.txt"), "tracked\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-qm", "fixture"]);
  const clean = workspaceSourceFingerprint(root);
  assert.match(clean.tree, /^[0-9a-f]{40}$/u);
  writeFileSync(path.join(root, "tracked.txt"), "unstaged\n");
  const unstaged = workspaceSourceFingerprint(root);
  git(root, ["add", "tracked.txt"]);
  const staged = workspaceSourceFingerprint(root);
  writeFileSync(path.join(root, "new-source.mjs"), "export const value = 1;\n");
  const first = workspaceSourceFingerprint(root);
  writeFileSync(path.join(root, "new-source.mjs"), "export const value = 2;\n");
  const second = workspaceSourceFingerprint(root);
  assert.notEqual(unstaged.workspaceSourceSha256, clean.workspaceSourceSha256);
  assert.notEqual(staged.workspaceSourceSha256, unstaged.workspaceSourceSha256);
  assert.notEqual(first.workspaceSourceSha256, staged.workspaceSourceSha256);
  assert.equal(first.head, clean.head);
  assert.notEqual(first.workspaceSourceSha256, clean.workspaceSourceSha256);
  assert.notEqual(second.workspaceSourceSha256, first.workspaceSourceSha256);
  assert.equal(second.untrackedFileCount, 1);
});

test("original file identity requires both the exact hash and exact size", () => {
  const expected = {
    expectedSha256: "a".repeat(64),
    expectedSize: 128,
  };
  assert.deepEqual(compareOriginalFileIdentity({
    ...expected,
    observedSha256: "a".repeat(64),
    observedSize: 128,
  }), {
    ok: true,
    exactReason: "ORIGINAL_HASH_AND_SIZE_UNCHANGED",
    hashMatches: true,
    sizeMatches: true,
    ...expected,
    observedSha256: "a".repeat(64),
    observedSize: 128,
  });
  assert.equal(compareOriginalFileIdentity({
    ...expected,
    observedSha256: "b".repeat(64),
    observedSize: 128,
  }).ok, false);
  assert.equal(compareOriginalFileIdentity({
    ...expected,
    observedSha256: "a".repeat(64),
    observedSize: 127,
  }).ok, false);
});
