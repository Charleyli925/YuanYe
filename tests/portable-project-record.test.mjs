import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";

// manifest.json travels with the project directory: a user who copies or
// synchronises that folder carries it verbatim to another machine. Every member
// must therefore still mean something there.
//
// `workingCopies[].fileIdentity` is the single documented exception. It is not
// a cache: the promotion protocol compares it to detect that the allocated
// Version Working Copy was replaced (`PROMOTION_PATH_REPLACED`) and that the
// committed facts still match the sealed transaction
// (`PROMOTION_COMMIT_MISMATCH`). Moving it to a device-local sidecar would turn
// two fail-closed controls into checks that silently pass when the sidecar is
// absent, so ADR 0034 keeps it here and requires a future sync layer to
// recompute it rather than transport it.
const PORTABLE_MANIFEST_MEMBERS = {
  root: [
    "schemaVersion",
    "projectId",
    "documentId",
    "latestOfficialVersionId",
    "versions",
    "workingCopies",
  ],
  version: [
    "versionId",
    "ordinal",
    "basedOnVersionId",
    "previousVersionId",
    "contentSha256",
    "snapshotRelativePath",
    "sourceRequestId",
    "sourceCandidateId",
    // Historical creation provenance is project data, never a device locator.
    "sourceType",
    "sourceOperationId",
    "createdAt",
  ],
  workingCopy: [
    "workingCopyId",
    "versionId",
    "basedOnVersionId",
    "sourceRelativePath",
    "preferredFileStem",
    "preferredExtension",
    "stateRelativePath",
  ],
};
const DEVICE_SCOPED_MANIFEST_MEMBERS = { workingCopy: ["fileIdentity"] };

function html(label) {
  return `<!doctype html><html data-pageroot-id="pr1_11111111111141118111111111111111"><head data-pageroot-id="pr1_22222222222242229222222222222222"><title data-pageroot-id="pr1_3333333333334333a333333333333333">${label}</title></head><body data-pageroot-id="pr1_4444444444444444b444444444444444"><h1 data-pageroot-id="pr1_55555555555545558555555555555555">${label}</h1></body></html>`;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-portable-record-"));
  const sources = path.join(root, "sources");
  const projects = path.join(root, "projects");
  await mkdir(sources, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    sources,
    projects,
    repository: new ProjectFileRepository({ projectsRoot: projects }),
  };
}

function absolutePathsIn(value, trail = "manifest") {
  if (typeof value === "string") {
    return path.isAbsolute(value) ? [`${trail} = ${value}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => absolutePathsIn(item, `${trail}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, item]) => absolutePathsIn(item, `${trail}.${key}`));
  }
  return [];
}

test("the manifest schema classifies every member as portable or device scoped", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../schemas/project-manifest.v4.schema.json", import.meta.url),
    "utf8",
  ));
  const declared = {
    root: Object.keys(schema.properties),
    version: Object.keys(schema.properties.versions.items.properties),
    workingCopy: Object.keys(schema.properties.workingCopies.items.properties),
  };
  for (const level of ["root", "version", "workingCopy"]) {
    assert.deepEqual(
      declared[level].slice().sort(),
      [
        ...PORTABLE_MANIFEST_MEMBERS[level],
        ...(DEVICE_SCOPED_MANIFEST_MEMBERS[level] || []),
      ].sort(),
      `${level} has an unclassified manifest member; decide whether it travels `
      + "with the project or belongs to this device, and record it here.",
    );
  }
  assert.deepEqual(DEVICE_SCOPED_MANIFEST_MEMBERS, {
    workingCopy: ["fileIdentity"],
  });
});

test("a written manifest carries no absolute path from this machine", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "可移植记录.html");
  const buffer = Buffer.from(html("V1"), "utf8");
  await writeFile(sourcePath, buffer);
  const imported = await value.repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(buffer),
  });

  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_portable_record",
    candidateId: "candidate_portable_record_0001",
    html: html("V2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });

  const manifest = JSON.parse(await readFile(
    path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(absolutePathsIn(manifest), []);
  assert.equal(manifest.versions.length >= 2, true);

  // The device-scoped witness is present and stays inside its own member, so a
  // reader can strip exactly one member to obtain a portable record.
  for (const workingCopy of manifest.workingCopies) {
    assert.deepEqual(
      Object.keys(workingCopy.fileIdentity).sort(),
      ["birthtimeMs", "device", "inode"],
    );
    const portableMembers = Object.keys(workingCopy)
      .filter((key) => key !== "fileIdentity");
    assert.deepEqual(
      portableMembers.filter(
        (key) => !PORTABLE_MANIFEST_MEMBERS.workingCopy.includes(key),
      ),
      [],
    );
  }
});
