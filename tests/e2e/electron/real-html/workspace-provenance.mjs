import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
  });
}

function splitNullSeparated(value) {
  return value.split("\0").filter(Boolean);
}

export function workspaceSourceFingerprint(root = process.cwd()) {
  const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  const unstaged = git(repositoryRoot, ["diff", "--binary", "--no-ext-diff", "--"]);
  const staged = git(repositoryRoot, [
    "diff", "--cached", "--binary", "--no-ext-diff", "HEAD", "--",
  ]);
  const untracked = splitNullSeparated(git(repositoryRoot, [
    "ls-files", "--others", "--exclude-standard", "-z",
  ])).sort();
  const hash = createHash("sha256");
  hash.update("head\0");
  hash.update(`${head}\n`);
  hash.update("\0unstaged\0");
  hash.update(unstaged);
  hash.update("\0staged\0");
  hash.update(staged);
  for (const file of untracked) {
    const absolute = path.resolve(repositoryRoot, file);
    if (!absolute.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error(`Untracked path escapes the repository: ${file}.`);
    }
    hash.update("\0untracked\0");
    hash.update(file);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) {
      hash.update(`\0symlink:${info.mode.toString(8)}\0`);
      hash.update(readlinkSync(absolute));
    } else if (info.isFile()) {
      hash.update(`\0file:${info.mode.toString(8)}\0`);
      hash.update(readFileSync(absolute));
    } else {
      hash.update(`\0other:${info.mode.toString(8)}`);
    }
  }
  return {
    head,
    tree,
    workspaceSourceSha256: hash.digest("hex"),
    untrackedFileCount: untracked.length,
  };
}

export function compareOriginalFileIdentity({
  expectedSha256,
  expectedSize,
  observedSha256,
  observedSize,
} = {}) {
  const hashMatches = typeof expectedSha256 === "string"
    && expectedSha256 !== ""
    && observedSha256 === expectedSha256;
  const sizeMatches = Number.isInteger(expectedSize)
    && expectedSize >= 0
    && observedSize === expectedSize;
  return {
    ok: hashMatches && sizeMatches,
    exactReason: hashMatches && sizeMatches
      ? "ORIGINAL_HASH_AND_SIZE_UNCHANGED"
      : "FINAL_ORIGINAL_HASH_OR_SIZE_CHANGED",
    hashMatches,
    sizeMatches,
    expectedSha256,
    observedSha256,
    expectedSize,
    observedSize,
  };
}
