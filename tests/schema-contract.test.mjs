import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import {
  readStatus,
  runOfficialFinalizer,
  submitRequest,
  writeAttemptOutput,
} from "./helpers/ai-attempt-fixture.mjs";
import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";

const pairs = [
  ["annotation-records.v3.schema.json", "annotation-records.frozen.json"],
  ["attempt-outcome.v1.schema.json", "attempt-outcome.cancelled.json"],
  [
    "attempt-outcome.v1.schema.json",
    "attempt-outcome.external-source-kept.json",
  ],
  ["attempt-outcome.v1.schema.json", "attempt-outcome.failed.json"],
  ["attempt-outcome.v1.schema.json", "attempt-outcome.no-change.json"],
  ["attempt-outcome.v1.schema.json", "attempt-outcome.version-created.json"],
  ["candidate-assessment.v1.schema.json", "candidate-assessment.ready.json"],
  ["change-request.v3.schema.json", "change-request.frozen.json"],
  ["committed-marker.v1.schema.json", "committed-marker.initial.json"],
  ["committed-marker.v1.schema.json", "committed-marker.valid.json"],
  ["completion.v1.schema.json", "completion.no-change.json"],
  ["completion.v1.schema.json", "completion.valid.json"],
  ["completion.v1.schema.json", "completion.versioned-output.json"],
  ["change-request.v3.schema.json", "change-request.versioned-output.json"],
  ["input-manifest.v1.schema.json", "input-manifest.frozen.json"],
  ["project-state.v3.schema.json", "project-state.current-edited.json"],
  ["project-state.v3.schema.json", "project-state.current-version.json"],
  ["runtime-state.v3.schema.json", "runtime-state.autosave-pending.json"],
  ["runtime-state.v3.schema.json", "runtime-state.autosave-conflict.json"],
  [
    "runtime-state.v3.schema.json",
    "runtime-state.awaiting-conflict-resolution.json",
  ],
  ["runtime-state.v3.schema.json", "runtime-state.processing.json"],
  ["runtime-state.v3.schema.json", "runtime-state.versioned-output.json"],
  ["runtime-state.v3.schema.json", "runtime-state.ready-to-open.json"],
  ["runtime-state.v3.schema.json", "runtime-state.ready.json"],
  ["runtime-state.v3.schema.json", "runtime-state.submitting.json"],
  [
    "runtime-state.v3.schema.json",
    "runtime-state.recovering-transaction.json",
  ],
  ["version-manifest.v3.schema.json", "version-manifest.initial.json"],
  ["version-manifest.v3.schema.json", "version-manifest.internal-ai.json"],
  ["user-supplement.v1.schema.json", "user-supplement.sealed.json"],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.cache-rebuilt.json",
  ],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.conflict-confirmed.json",
  ],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.external-kept.json",
  ],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.prepared.json",
  ],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.ready-to-open.json",
  ],
  [
    "version-transaction.v1.schema.json",
    "version-transaction.source-applied.json",
  ],
];

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function schema(name) {
  return json(new URL(`../schemas/${name}`, import.meta.url));
}

async function fixture(name) {
  return json(new URL(`../fixtures/v3/${name}`, import.meta.url));
}

function schemaValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  return ajv;
}

async function validator(schemaName) {
  const ajv = schemaValidator();
  if (schemaName === "task-spec.v1.schema.json") {
    ajv.addSchema(await schema("change-request.v3.schema.json"));
  }
  const contract = await schema(schemaName);
  assert.equal(
    ajv.validateSchema(contract),
    true,
    `${schemaName} is not itself a valid JSON Schema: ${ajv.errorsText(
      ajv.errors,
      { separator: "\n" },
    )}`,
  );
  return { ajv, validate: ajv.compile(contract) };
}

function assertValid(ajv, validate, value, label) {
  assert.equal(
    validate(value),
    true,
    `${label}: ${ajv.errorsText(validate.errors, { separator: "\n" })}`,
  );
}

function assertVersionIdentity(record, expected) {
  assert.equal(record.candidateVersionId, expected.versionId);
  assert.equal(record.candidateVersionOrdinal, expected.ordinal);
  assert.equal(record.candidateVersionLabel, expected.label);
  assert.equal(
    Number.parseInt(record.candidateVersionId.slice("ver_".length), 10),
    expected.ordinal,
  );
  assert.equal(
    Number.parseInt(record.candidateVersionLabel.slice(1), 10),
    expected.ordinal,
  );
}

function validateLifecycleBundle(bundle) {
  const {
    request,
    annotations,
    inputManifest,
    completion,
    transaction,
    manifest,
    marker,
    outcome,
    project,
    runtime,
  } = bundle;
  const identity = {
    projectId: request.projectId,
    documentId: request.documentId,
    requestId: request.requestId,
    attemptId: request.attemptId,
  };
  const candidate = {
    versionId: request.versionIdentity.candidateVersionId,
    ordinal: request.versionIdentity.candidateVersionOrdinal,
    label: request.versionIdentity.candidateVersionLabel,
  };
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  for (const record of [
    annotations,
    inputManifest,
    completion,
    transaction,
    manifest,
    marker,
    outcome,
  ]) {
    for (const [key, value] of Object.entries(identity)) {
      check(record[key] === value, `${key} diverged`);
    }
  }
  for (const record of [completion, transaction, outcome]) {
    check(record.candidateVersionId === candidate.versionId, "candidate id drift");
    check(
      record.candidateVersionOrdinal === candidate.ordinal,
      "candidate ordinal drift",
    );
    check(
      record.candidateVersionLabel === candidate.label,
      "candidate label drift",
    );
  }
  check(manifest.versionId === candidate.versionId, "manifest id drift");
  check(manifest.versionOrdinal === candidate.ordinal, "manifest ordinal drift");
  check(manifest.versionLabel === candidate.label, "manifest label drift");
  check(marker.versionId === candidate.versionId, "marker id drift");
  check(marker.versionOrdinal === candidate.ordinal, "marker ordinal drift");
  check(marker.versionLabel === candidate.label, "marker label drift");
  check(outcome.versionId === candidate.versionId, "outcome version drift");
  check(
    Number.parseInt(candidate.versionId.slice(4), 10) === candidate.ordinal,
    "candidate id/ordinal mismatch",
  );
  check(
    Number.parseInt(candidate.label.slice(1), 10) === candidate.ordinal,
    "candidate label/ordinal mismatch",
  );

  for (const record of [
    completion,
    transaction,
    manifest,
    marker,
    outcome,
  ]) {
    check(
      record.previousVersionId === request.versionIdentity.previousVersionId,
      "previous lineage drift",
    );
    check(
      record.basedOnVersionId === request.versionIdentity.basedOnVersionId,
      "based-on lineage drift",
    );
    check(
      record.baseSnapshotSha256 === request.baseSnapshot.sha256,
      "base snapshot drift",
    );
  }
  check(
    completion.baseComparisonSha256 === request.baseSnapshot.comparisonSha256,
    "base comparison drift",
  );
  check(
    completion.canonicalizationVersion
      === request.baseSnapshot.canonicalizationVersion,
    "canonicalizer drift",
  );
  const waitingForManualOpen = runtime.lifecycleState === "ready-to-open";
  for (const value of [
    transaction.candidateContentSha256,
    manifest.contentSha256,
    manifest.files[0]?.sha256,
    marker.contentSha256,
    marker.sourceSha256,
    outcome.contentSha256,
  ]) {
    check(value === completion.outputSha256, "committed content hash drift");
  }
  if (waitingForManualOpen) {
    check(
      project.currentHtmlSha256 === request.baseSnapshot.sha256,
      "ready result replaced current project content before confirmation",
    );
    check(
      runtime.view.renderedContentSha256 === request.baseSnapshot.sha256,
      "ready result replaced rendered content before confirmation",
    );
  } else {
    for (const value of [
      project.currentHtmlSha256,
      runtime.view.renderedContentSha256,
    ]) {
      check(value === completion.outputSha256, "committed content hash drift");
    }
  }
  check(
    transaction.candidateManifestSha256 === marker.manifestSha256,
    "manifest hash drift",
  );
  check(
    transaction.completionSha256 === marker.completionSha256
      && marker.completionSha256 === outcome.completionSha256,
    "completion hash drift",
  );
  check(
    completion.inputManifestSha256 === manifest.inputManifestSha256,
    "input manifest hash drift",
  );

  const requestRoot = `requests/${identity.requestId}`;
  const attemptRoot = `${requestRoot}/attempts/${identity.attemptId}`;
  check(request.paths.requestRelativePath === requestRoot, "request path drift");
  check(
    request.paths.attemptRelativePath === attemptRoot,
    "attempt path drift",
  );
  check(
    request.paths.promptRelativePath === `${requestRoot}/PROMPT.md`,
    "prompt path drift",
  );
  check(
    request.paths.inputManifestRelativePath
      === `${requestRoot}/input-manifest.json`,
    "input manifest path drift",
  );
  check(
    manifest.completionRelativePath === `${attemptRoot}/completion.json`,
    "completion path drift",
  );
  check(
    manifest.outcomeRelativePath === `${attemptRoot}/outcome.json`,
    "outcome path drift",
  );
  check(
    outcome.versionManifestRelativePath
      === `versions/${candidate.versionId}/version.json`,
    "outcome manifest path drift",
  );
  check(
    outcome.commitMarkerRelativePath
      === `versions/${candidate.versionId}/committed.json`,
    "outcome marker path drift",
  );

  const filePaths = inputManifest.files.map((file) => file.path);
  check(
    new Set(filePaths).size === filePaths.length,
    "input manifest contains duplicate paths",
  );
  check(
    [
      filePaths,
      inputManifest.files
        .filter((file) => file.role !== "annotations")
        .map((file) => file.path),
    ].some((expected) => (
      JSON.stringify(inputManifest.readOrder) === JSON.stringify(expected)
    )),
    "input manifest read order is not the ordered execution subset",
  );
  const baseFile = inputManifest.files.find((file) => file.role === "base-html");
  const annotationFile = inputManifest.files.find(
    (file) => file.role === "annotations",
  );
  check(baseFile?.sha256 === request.baseSnapshot.sha256, "base file hash drift");
  check(
    annotationFile?.sha256 === request.annotations.sha256,
    "annotation input hash drift",
  );

  const targetIds = new Set(
    request.requirements.targets.map((target) => target.targetId),
  );
  check(
    targetIds.size === request.requirements.targets.length,
    "duplicate target ids",
  );
  for (const instruction of request.requirements.instructions) {
    for (const targetRef of instruction.targetRefs) {
      check(targetIds.has(targetRef), "instruction references missing target");
    }
  }
  for (const comment of annotations.comments) {
    check(
      comment.capturedRevision <= request.freezeCutoffRevision,
      "comment captured after freeze",
    );
  }
  for (const event of annotations.editEvents) {
    check(
      event.revision <= request.freezeCutoffRevision,
      "edit event captured after freeze",
    );
    check(
      event.basedOnVersionId === request.versionIdentity.basedOnVersionId,
      "edit event lineage drift",
    );
  }
  check(
    annotations.comments.length === request.annotations.commentCount,
    "comment count drift",
  );
  check(
    annotations.editEvents.length === request.annotations.editEventCount,
    "edit event count drift",
  );

  for (const value of [project.latestVersionId, runtime.view.latestVersionId]) {
    check(value === candidate.versionId, "latest Version pointer drift");
  }
  const expectedCurrentVersionId = waitingForManualOpen
    ? request.versionIdentity.basedOnVersionId
    : candidate.versionId;
  for (const value of [
    project.currentBasedOnVersionId,
    project.currentExactVersionId,
    runtime.view.currentBasedOnVersionId,
    runtime.view.currentExactVersionId,
  ]) {
    check(value === expectedCurrentVersionId, "current Version pointer drift");
  }
  check(runtime.view.viewMode === "current", "post-commit view is not current");
  check(runtime.view.viewingVersionId === null, "history view leaked after commit");
  check(
    Date.parse(completion.completedAt) <= Date.parse(manifest.generatedAt),
    "Version generated before completion",
  );
  check(
    manifest.generatedAt === marker.committedAt,
    "Version generation time must equal its successful commit time",
  );
  check(
    transaction.versionGeneratedAt === marker.committedAt,
    "transaction generation time drift",
  );
  check(marker.committedAt === outcome.committedAt, "outcome timestamp drift");

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

function validateRuntimeSemantics(runtime) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  check(
    runtime.lastPersistedRevision <= runtime.editRevision,
    "persisted revision exceeds edit revision",
  );
  if (runtime.pendingWrite) {
    check(
      runtime.pendingWrite.revision > runtime.lastPersistedRevision,
      "pending revision is not newer than persisted revision",
    );
    check(
      runtime.pendingWrite.revision <= runtime.editRevision,
      "pending revision exceeds edit revision",
    );
    check(
      runtime.pendingWrite.recoveryHtmlSha256
        === runtime.pendingWrite.targetHtmlSha256,
      "pending recovery hash differs from target hash",
    );
  }
  if (runtime.pendingSubmission) {
    check(
      runtime.pendingSubmission.freezeCutoffRevision
        === runtime.freezeCutoffRevision,
      "submission freeze cutoff drift",
    );
    check(
      runtime.pendingSubmission.baseSnapshotSha256
        === runtime.autosave.expectedSourceSha256,
      "submission base hash drift",
    );
  }
  if (runtime.activeRun && runtime.freezeCutoffRevision !== null) {
    check(
      runtime.lastPersistedRevision >= runtime.freezeCutoffRevision,
      "active run began before freeze revision persisted",
    );
  }
  if (runtime.conflict?.type === "ai-source") {
    check(
      runtime.activeRun?.requestId === runtime.conflict.requestId,
      "AI conflict Request drift",
    );
    check(
      runtime.activeRun?.attemptId === runtime.conflict.attemptId,
      "AI conflict Attempt drift",
    );
    check(
      runtime.activeRun?.candidateVersionId
        === runtime.conflict.candidateVersionId,
      "AI conflict candidate drift",
    );
    check(
      runtime.activeTransaction?.transactionId
        === runtime.conflict.transactionId,
      "AI conflict transaction drift",
    );
    check(
      runtime.activeRun?.baseSnapshotSha256
        === runtime.conflict.expectedSourceSha256,
      "AI conflict expected source drift",
    );
  }
  if (runtime.recovery) {
    check(
      runtime.activeTransaction?.transactionId === runtime.recovery.transactionId,
      "recovery transaction id drift",
    );
    check(
      runtime.activeTransaction?.transactionRelativePath
        === runtime.recovery.transactionRelativePath,
      "recovery transaction path drift",
    );
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("every lifecycle fixture satisfies a meta-valid strict JSON Schema", async () => {
  for (const [schemaName, fixtureName] of pairs) {
    const { ajv, validate } = await validator(schemaName);
    assertValid(ajv, validate, await fixture(fixtureName), fixtureName);
  }
});

test("only a frozen project rules file may be empty in an input manifest", async () => {
  const { ajv, validate } = await validator("input-manifest.v1.schema.json");
  const emptyProjectRules = await fixture("input-manifest.frozen.json");
  const projectRules = emptyProjectRules.files.find(
    (file) => file.role === "project-rules",
  );
  projectRules.byteLength = 0;
  projectRules.sha256 = sha256("");
  assertValid(ajv, validate, emptyProjectRules, "empty PROJECT.md input manifest");

  const emptyBaseHtml = structuredClone(emptyProjectRules);
  const baseHtml = emptyBaseHtml.files.find((file) => file.role === "base-html");
  baseHtml.byteLength = 0;
  baseHtml.sha256 = sha256("");
  assert.equal(validate(emptyBaseHtml), false);
});

test("the candidate assessment Schema accepts only the current bounded shape", async () => {
  const { ajv, validate } = await validator(
    "candidate-assessment.v1.schema.json",
  );
  const current = await json(
    new URL(
      "../fixtures/candidate-assessment-compat/candidate-assessment.pre-executable-dev.json",
      import.meta.url,
    ),
  );
  assertValid(ajv, validate, current, "current candidate assessment");
  const bounded = {
    ...current,
    changedElementCount: 120,
    requestedTargetCount: 1,
    outsideTargetCount: 120,
    changedElementIdSample: [
      "pr1_11111111111141118111111111111111",
    ],
    outsideTargetElementIdSample: [
      "pr1_11111111111141118111111111111111",
    ],
    truncated: true,
  };
  assertValid(ajv, validate, bounded, "bounded candidate assessment");
  const oversizedSample = structuredClone(bounded);
  oversizedSample.changedElementIdSample = Array.from(
    { length: 101 },
    () => "pr1_11111111111141118111111111111111",
  );
  assert.equal(validate(oversizedSample), false);
  const mixedImpact = structuredClone(bounded);
  mixedImpact.changedStableElementIds = [];
  assert.equal(validate(mixedImpact), false);

  const legacy = await json(
    new URL(
      "../fixtures/candidate-assessment-compat/candidate-assessment.retired-executable-dev.json",
      import.meta.url,
    ),
  );
  assert.equal(validate(legacy), false);

  const healthOnly = structuredClone(current);
  healthOnly.health.executableSurfaceUnchanged = false;
  assert.equal(validate(healthOnly), false);

  const executableOnly = structuredClone(current);
  executableOnly.executable = legacy.executable;
  assert.equal(validate(executableOnly), false);
});

test("the success bundle preserves one identity, lineage, content and archive across every artifact", async () => {
  const [
    request,
    annotations,
    completion,
    inputManifest,
    transaction,
    manifest,
    marker,
    outcome,
    runtime,
    readyRuntime,
    currentProject,
  ] = await Promise.all([
    fixture("change-request.frozen.json"),
    fixture("annotation-records.frozen.json"),
    fixture("completion.valid.json"),
    fixture("input-manifest.frozen.json"),
    fixture("version-transaction.cache-rebuilt.json"),
    fixture("version-manifest.internal-ai.json"),
    fixture("committed-marker.valid.json"),
    fixture("attempt-outcome.version-created.json"),
    fixture("runtime-state.processing.json"),
    fixture("runtime-state.ready.json"),
    fixture("project-state.current-version.json"),
  ]);

  const identity = {
    projectId: request.projectId,
    documentId: request.documentId,
    requestId: request.requestId,
    attemptId: request.attemptId,
  };
  const version = {
    versionId: request.versionIdentity.candidateVersionId,
    ordinal: request.versionIdentity.candidateVersionOrdinal,
    label: request.versionIdentity.candidateVersionLabel,
  };
  const records = [
    annotations,
    inputManifest,
    completion,
    transaction,
    manifest,
    marker,
    outcome,
    runtime.activeRun,
  ];

  for (const record of records) {
    for (const [key, value] of Object.entries(identity)) {
      if (key === "projectId" || key === "documentId") {
        if (record === runtime.activeRun) continue;
      }
      assert.equal(record[key], value, `${key} diverged`);
    }
  }

  for (const record of [
    completion,
    transaction,
    outcome,
    runtime.activeRun,
  ]) {
    assertVersionIdentity(record, version);
  }
  assert.equal(manifest.versionId, version.versionId);
  assert.equal(manifest.versionOrdinal, version.ordinal);
  assert.equal(manifest.versionLabel, version.label);
  assert.equal(marker.versionId, version.versionId);
  assert.equal(marker.versionOrdinal, version.ordinal);
  assert.equal(marker.versionLabel, version.label);
  assert.equal(outcome.versionId, version.versionId);

  for (const record of [
    completion,
    transaction,
    manifest,
    marker,
    outcome,
    runtime.activeRun,
  ]) {
    assert.equal(record.previousVersionId, request.versionIdentity.previousVersionId);
    assert.equal(record.basedOnVersionId, request.versionIdentity.basedOnVersionId);
    assert.equal(record.baseSnapshotSha256, request.baseSnapshot.sha256);
  }

  assert.equal(completion.outputSha256, transaction.candidateContentSha256);
  assert.equal(completion.outputSha256, manifest.contentSha256);
  assert.equal(completion.outputSha256, manifest.files[0].sha256);
  assert.equal(completion.outputSha256, marker.contentSha256);
  assert.equal(completion.outputSha256, marker.sourceSha256);
  assert.equal(completion.outputSha256, outcome.contentSha256);
  assert.equal(
    outcome.versionManifestRelativePath,
    `versions/${version.versionId}/version.json`,
  );
  assert.equal(
    outcome.commitMarkerRelativePath,
    `versions/${version.versionId}/committed.json`,
  );
  assert.equal(completion.baseComparisonSha256, manifest.baseComparisonSha256);
  assert.equal(
    completion.outputComparisonSha256,
    manifest.contentComparisonSha256,
  );
  assert.equal(completion.canonicalizationVersion, manifest.canonicalizationVersion);
  assert.equal(completion.inputManifestSha256, manifest.inputManifestSha256);
  assert.ok(
    inputManifest.readOrder.every((relativePath) =>
      inputManifest.files.some((file) => file.path === relativePath)
    ),
  );
  assert.equal(
    inputManifest.files.find((file) => file.role === "base-html").sha256,
    request.baseSnapshot.sha256,
  );
  assert.equal(
    inputManifest.files.find((file) => file.role === "annotations").sha256,
    request.annotations.sha256,
  );
  assert.equal(transaction.candidateManifestSha256, marker.manifestSha256);
  assert.equal(transaction.completionSha256, marker.completionSha256);
  assert.equal(transaction.completionSha256, outcome.completionSha256);

  const archives = [
    manifest.annotationArchive,
    outcome.annotationArchive,
  ];
  for (const archive of archives) {
    assert.equal(archive.sha256, request.annotations.sha256);
    assert.equal(archive.sha256, runtime.activeRun.frozenAnnotationsSha256);
    assert.equal(archive.commentCount, request.annotations.commentCount);
    assert.equal(archive.editEventCount, request.annotations.editEventCount);
    assert.equal(
      archive.requestRelativePath,
      "requests/req_metrics_cards/input/annotations/records.json",
    );
    assert.equal(
      archive.attemptRelativePath,
      "requests/req_metrics_cards/attempts/attempt_001/annotations.json",
    );
  }
  assert.equal(
    manifest.annotationArchive.versionRelativePath,
    "annotations/records.json",
  );
  assert.equal(annotations.comments.length, request.annotations.commentCount);
  assert.equal(annotations.editEvents.length, request.annotations.editEventCount);
  assert.equal(
    manifest.completionRelativePath,
    "requests/req_metrics_cards/attempts/attempt_001/completion.json",
  );
  assert.equal(
    manifest.outcomeRelativePath,
    "requests/req_metrics_cards/attempts/attempt_001/outcome.json",
  );

  for (const value of [
    currentProject.latestVersionId,
    currentProject.currentBasedOnVersionId,
    currentProject.currentExactVersionId,
    readyRuntime.view.latestVersionId,
    readyRuntime.view.currentBasedOnVersionId,
    readyRuntime.view.currentExactVersionId,
  ]) {
    assert.equal(value, version.versionId);
  }
  for (const value of [
    currentProject.currentHtmlSha256,
    readyRuntime.view.renderedContentSha256,
    manifest.contentSha256,
    manifest.files[0].sha256,
    marker.contentSha256,
    marker.sourceSha256,
  ]) {
    assert.equal(value, completion.outputSha256);
  }
  assert.equal(readyRuntime.view.viewMode, "current");
  assert.equal(readyRuntime.view.viewingVersionId, null);
  assert.equal(currentProject.restoredFromVersionId, null);
  assert.ok(
    Date.parse(completion.completedAt) <= Date.parse(manifest.generatedAt),
  );
  assert.equal(manifest.generatedAt, marker.committedAt);
  assert.equal(transaction.versionGeneratedAt, marker.committedAt);
  assert.equal(marker.committedAt, outcome.committedAt);
  validateLifecycleBundle({
    request,
    annotations,
    inputManifest,
    completion,
    transaction,
    manifest,
    marker,
    outcome,
    project: currentProject,
    runtime: readyRuntime,
  });
});

test("semantic bundle validation rejects schema-valid identity, path, revision and hash drift", async () => {
  const names = {
    request: "change-request.frozen.json",
    annotations: "annotation-records.frozen.json",
    inputManifest: "input-manifest.frozen.json",
    completion: "completion.valid.json",
    transaction: "version-transaction.cache-rebuilt.json",
    manifest: "version-manifest.internal-ai.json",
    marker: "committed-marker.valid.json",
    outcome: "attempt-outcome.version-created.json",
    project: "project-state.current-version.json",
    runtime: "runtime-state.ready.json",
  };
  const bundle = Object.fromEntries(
    await Promise.all(
      Object.entries(names).map(async ([key, name]) => [key, await fixture(name)]),
    ),
  );
  validateLifecycleBundle(bundle);

  const mutations = [
    ["candidate ordinal drift", (value) => {
      value.completion.candidateVersionOrdinal = 10;
    }],
    ["manifest entry hash drift", (value) => {
      value.manifest.files[0].sha256 =
        "sha256:3131313131313131313131313131313131313131313131313131313131313131";
    }],
    ["marker source hash drift", (value) => {
      value.marker.sourceSha256 =
        "sha256:3232323232323232323232323232323232323232323232323232323232323232";
    }],
    ["outcome version drift", (value) => {
      value.outcome.versionId = "ver_0010";
    }],
    ["request path identity drift", (value) => {
      value.request.paths.requestRelativePath = "requests/req_other";
    }],
    ["input order drift", (value) => {
      value.inputManifest.readOrder.reverse();
    }],
    ["comment beyond freeze", (value) => {
      value.annotations.comments[0].capturedRevision = 43;
    }],
    ["missing target reference", (value) => {
      value.request.requirements.instructions[0].targetRefs = ["target_missing"];
    }],
    ["rendered hash drift", (value) => {
      value.runtime.view.renderedContentSha256 =
        "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(bundle);
    mutate(changed);
    assert.throws(
      () => validateLifecycleBundle(changed),
      undefined,
      label,
    );
  }
});

test("no-change is auditable but cannot masquerade as a committed Version", async () => {
  const completion = await fixture("completion.no-change.json");
  const outcome = await fixture("attempt-outcome.no-change.json");

  assert.equal(
    completion.baseComparisonSha256,
    completion.outputComparisonSha256,
  );
  assert.equal(outcome.baseComparisonSha256, outcome.outputComparisonSha256);
  assert.equal(outcome.status, "no-change");
  assert.equal(outcome.candidateVersionId, completion.candidateVersionId);
  assert.equal(outcome.inputManifestSha256, completion.inputManifestSha256);
  assert.equal(outcome.canonicalizationVersion, completion.canonicalizationVersion);
  assert.equal("transactionId" in outcome, false);
  assert.equal("contentSha256" in outcome, false);
  assert.equal("committedAt" in outcome, false);
});

test("version manifest v3 is a discriminated strict union", async () => {
  const { validate } = await validator("version-manifest.v3.schema.json");
  const initial = await fixture("version-manifest.initial.json");
  const internalAi = await fixture("version-manifest.internal-ai.json");

  assert.equal(validate({ ...initial, requestId: "req_forbidden" }), false);
  assert.equal(validate({ ...initial, sourceType: "local-editor" }), false);
  assert.equal(validate({ ...initial, sourceType: "restore" }), false);

  const missingArchivePath = structuredClone(internalAi);
  delete missingArchivePath.annotationArchive.attemptRelativePath;
  assert.equal(validate(missingArchivePath), false);
  assert.equal(
    validate({
      ...internalAi,
      completionRelativePath: "../another-project/completion.json",
    }),
    false,
  );
  assert.equal(
    validate({
      ...internalAi,
      completionRelativePath:
        "C:\\workspace\\requests\\req_metrics_cards\\completion.json",
    }),
    false,
  );
  assert.equal(validate({ ...internalAi, extraUndeclaredField: true }), false);
});

test("completion contract rejects weak or ambiguous completion signals", async () => {
  const { validate } = await validator("completion.v1.schema.json");
  const completion = await fixture("completion.valid.json");

  const missingInputManifest = structuredClone(completion);
  delete missingInputManifest.inputManifestSha256;
  assert.equal(validate(missingInputManifest), false);
  assert.equal(validate({ ...completion, candidateVersionLabel: "version-nine" }), false);
  assert.equal(validate({ ...completion, status: "looks-complete" }), false);
  assert.equal(validate({ ...completion, handwritten: true }), false);
});

test("runtime contract enforces locks, durable pending writes and explicit view state", async () => {
  const { validate } = await validator("runtime-state.v3.schema.json");
  const processing = await fixture("runtime-state.processing.json");
  const pending = await fixture("runtime-state.autosave-pending.json");
  const submitting = await fixture("runtime-state.submitting.json");
  const aiConflict = await fixture(
    "runtime-state.awaiting-conflict-resolution.json",
  );
  const recovering = await fixture("runtime-state.recovering-transaction.json");

  for (const runtime of [
    processing,
    pending,
    submitting,
    aiConflict,
    recovering,
  ]) {
    validateRuntimeSemantics(runtime);
  }

  assert.equal(validate({ ...processing, projectLocked: false }), false);

  const missingFrozenManifest = structuredClone(processing);
  delete missingFrozenManifest.activeRun.inputManifestSha256;
  assert.equal(validate(missingFrozenManifest), false);

  const editableWithRun = structuredClone(pending);
  editableWithRun.activeRun = processing.activeRun;
  assert.equal(validate(editableWithRun), false);

  const incompletePendingWrite = structuredClone(pending);
  delete incompletePendingWrite.pendingWrite.recoveryHtmlRelativePath;
  assert.equal(validate(incompletePendingWrite), false);

  const invalidHistory = structuredClone(pending);
  invalidHistory.view.viewMode = "history";
  invalidHistory.view.viewingVersionId = null;
  assert.equal(validate(invalidHistory), false);

  const weakAutosaveError = structuredClone(pending);
  weakAutosaveError.autosave.status = "error";
  delete weakAutosaveError.autosave.errorCode;
  delete weakAutosaveError.autosave.errorMessage;
  assert.equal(validate(weakAutosaveError), false);

  const oldPending = structuredClone(pending);
  oldPending.pendingWrite.revision = oldPending.lastPersistedRevision;
  assert.throws(() => validateRuntimeSemantics(oldPending), /pending revision/);

  const badRecoveryHash = structuredClone(pending);
  badRecoveryHash.pendingWrite.recoveryHtmlSha256 =
    "sha256:3434343434343434343434343434343434343434343434343434343434343434";
  assert.throws(() => validateRuntimeSemantics(badRecoveryHash), /recovery hash/);

  const unfrozenProcessing = structuredClone(processing);
  unfrozenProcessing.lastPersistedRevision =
    unfrozenProcessing.freezeCutoffRevision - 1;
  assert.throws(
    () => validateRuntimeSemantics(unfrozenProcessing),
    /before freeze revision persisted/,
  );

  const wrongConflictRun = structuredClone(aiConflict);
  wrongConflictRun.conflict.requestId = "req_other";
  assert.throws(
    () => validateRuntimeSemantics(wrongConflictRun),
    /conflict Request drift/,
  );

  const wrongRecoveryTransaction = structuredClone(recovering);
  wrongRecoveryTransaction.recovery.transactionId = "txn_other";
  assert.throws(
    () => validateRuntimeSemantics(wrongRecoveryTransaction),
    /recovery transaction id drift/,
  );
});

test("transaction contract keeps immutable AI input separate from the replace precondition", async () => {
  const { validate } = await validator("version-transaction.v1.schema.json");
  const prepared = await fixture("version-transaction.prepared.json");
  const adopted = await fixture("version-transaction.conflict-confirmed.json");

  assert.equal(prepared.baseSnapshotSha256, prepared.expectedSourceSha256);
  assert.notEqual(adopted.baseSnapshotSha256, adopted.expectedSourceSha256);
  assert.equal(adopted.expectedSourceSha256, adopted.confirmedExternalSha256);
  assert.equal(adopted.recoverySourceSha256, adopted.confirmedExternalSha256);

  const missingFrozenBase = structuredClone(prepared);
  delete missingFrozenBase.baseSnapshotSha256;
  assert.equal(validate(missingFrozenBase), false);

  const missingRecoveryHash = structuredClone(prepared);
  delete missingRecoveryHash.recoverySourceSha256;
  assert.equal(validate(missingRecoveryHash), false);

  const unpairedConfirmation = structuredClone(adopted);
  delete unpairedConfirmation.conflictConfirmedAt;
  assert.equal(validate(unpairedConfirmation), false);

  const versionedOutput = {
    ...prepared,
    outputRelativePath:
      "requests/req_metrics_cards/attempts/attempt_001/output/仪表盘-V1.8.html",
  };
  assert.equal(validate(versionedOutput), true);

  const unsafeVersionedOutput = {
    ...versionedOutput,
    outputRelativePath:
      "requests/req_metrics_cards/attempts/attempt_001/output/subdir/仪表盘-V1.8.html",
  };
  assert.equal(validate(unsafeVersionedOutput), false);
});

test("project state cannot become a second active-run authority", async () => {
  const { validate } = await validator("project-state.v3.schema.json");
  const project = await fixture("project-state.current-edited.json");

  assert.equal(validate({
    ...project,
    storageDirectoryName: project.projectId,
  }), true);
  assert.equal(validate({ ...project, activeRun: {} }), false);
  assert.equal(validate({ ...project, projectLocked: true }), false);
  assert.equal(validate({ ...project, conflict: {} }), false);
  assert.equal(validate({
    ...project,
    storageDirectoryName: "project_../escape",
  }), false);
});

test(
  "a real Bridge run emits a fully schema-valid v4 Project File bundle",
  { timeout: 30_000 },
  async (t) => {
    const environment = await createBridgeTestEnvironment(t, {
      prefix: "html-ai-schema-export-",
    });
    const initialHtml =
      "<!doctype html><html data-pageroot-id=\"pr1_11111111111141118111111111111111\"><head data-pageroot-id=\"pr1_22222222222242229222222222222222\"><meta charset=\"utf-8\" data-pageroot-id=\"pr1_3333333333334333a333333333333333\"><title data-pageroot-id=\"pr1_4444444444444444b444444444444444\">合同</title></head><body data-pageroot-id=\"pr1_55555555555545558555555555555555\"><main id=\"main\" data-pageroot-id=\"pr1_66666666666646669666666666666666\"><h1 data-pageroot-id=\"pr1_7777777777774777a777777777777777\">合同</h1></main></body></html>";
    const sourcePath = await environment.createSource("contract.html", initialHtml);
    const bridge = await environment.start();

    const preview = await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    );
    assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.registered, false);

    const opened = await bridge.postJson("/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.body.currentHtmlSha256,
    });
    assert.equal(opened.response.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.registered, true);
    assert.equal(opened.body.projectFileSchemaVersion, "4.0.0");
    const workingPath = opened.body.sourcePath;
    const projectRoot = opened.body.projectRoot;
    const controlRoot = join(projectRoot, ".pageroot");
    const sourceBeforeAi = await readFile(sourcePath);

    const validateArtifact = async (schemaName, value, label) => {
      const { ajv, validate } = await validator(schemaName);
      assertValid(ajv, validate, value, label);
    };

    await validateArtifact(
      "project-identity.v4.schema.json",
      await json(new URL(`file://${join(controlRoot, "project.json")}`)),
      "generated v4 project.json",
    );
    await validateArtifact(
      "project-manifest.v4.schema.json",
      await json(new URL(`file://${join(controlRoot, "manifest.json")}`)),
      "generated v4 manifest.json",
    );
    await validateArtifact(
      "project-runtime-state.v4.schema.json",
      await json(new URL(`file://${join(controlRoot, "runtime-state.json")}`)),
      "generated v4 runtime-state.json",
    );

    const submitted = await submitRequest(bridge, {
      sourcePath: workingPath,
      expectedSourceSha256: opened.body.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "增加合同验证结果",
      comments: [{
        commentId: "comment_contract",
        text: "增加合同验证结果",
        target: {
          targetId: "target_contract",
          elementId: "pr1_7777777777774777a777777777777777",
          expectedSourceSha256: opened.body.currentHtmlSha256,
          label: "合同标题",
          level: "module",
          selector: "h1",
          fingerprint: {
            tagName: "h1",
            stableAttributes: {},
            ancestorFingerprint: [],
          },
          resolution: "exact",
        },
        attachments: [],
      }],
      targets: [{
        targetId: "target_contract",
        elementId: "pr1_7777777777774777a777777777777777",
        expectedSourceSha256: opened.body.currentHtmlSha256,
        label: "合同标题",
        level: "module",
        selector: "h1",
        fingerprint: {
          tagName: "h1",
          stableAttributes: {},
          ancestorFingerprint: [],
        },
        resolution: "exact",
      }],
      changeEvents: [],
    });
    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
    const run = submitted.body;
    const generatedChangeRequest = await json(new URL(
      `file://${join(controlRoot, "requests", run.requestId, "change-request.json")}`,
    ));
    assert.equal(generatedChangeRequest.policyVersion, "2.0.0");
    assert.equal(generatedChangeRequest.promptTemplateVersion, "2.0.0");
    assert.equal("comments" in generatedChangeRequest.requirements, false);
    assert.equal("changeEvents" in generatedChangeRequest.requirements, false);
    assert.equal("preserveOutsideTargets" in generatedChangeRequest.requirements, false);
    await validateArtifact(
      "task-spec.v1.schema.json",
      generatedChangeRequest.requirements,
      "generated Task Spec v1",
    );
    const generatedHtml =
      "<!doctype html><html data-pageroot-id=\"pr1_11111111111141118111111111111111\"><head data-pageroot-id=\"pr1_22222222222242229222222222222222\"><meta charset=\"utf-8\" data-pageroot-id=\"pr1_3333333333334333a333333333333333\"><title data-pageroot-id=\"pr1_4444444444444444b444444444444444\">合同</title></head><body data-pageroot-id=\"pr1_55555555555545558555555555555555\"><main id=\"main\" data-pageroot-id=\"pr1_66666666666646669666666666666666\"><h1 data-pageroot-id=\"pr1_7777777777774777a777777777777777\">合同</h1><p id=\"verified\">验证通过</p></main></body></html>";
    await writeAttemptOutput(run, generatedHtml);
    await runOfficialFinalizer(environment.workspace, run);
    const completed = await readStatus(bridge, {
      sourcePath: workingPath,
      ...run,
    });
    assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.status, "ready-to-open");

    const candidate = await json(new URL(
      `file://${join(controlRoot, "requests", run.requestId, "candidate.json")}`,
    ));
    await validateArtifact("candidate.v4.schema.json", candidate, "generated candidate.json");
    const normalizedCandidateHtml = await readFile(
      join(controlRoot, "requests", run.requestId, "candidate.html"),
      "utf8",
    );
    assert.equal(candidate.identityReport.assignedElementCount, 1);
    assert.match(
      normalizedCandidateHtml,
      /<p id="verified" data-pageroot-id="pr1_[a-f0-9]{32}">验证通过<\/p>/u,
    );

    const activated = await bridge.postJson("/ready-version/activate", {
      sourcePath: workingPath,
      projectId: completed.body.projectId,
      documentId: completed.body.documentId,
      requestId: completed.body.requestId,
      attemptId: completed.body.attemptId,
      candidateId: completed.body.candidateId,
      decisionOperationId: `promote_${completed.body.candidateId}`,
      versionId: completed.body.versionId,
    });
    assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.status, "version-activated");
    await validateArtifact(
      "project-manifest.v4.schema.json",
      await json(new URL(`file://${join(controlRoot, "manifest.json")}`)),
      "promoted v4 manifest.json",
    );
    await validateArtifact(
      "project-runtime-state.v4.schema.json",
      await json(new URL(`file://${join(controlRoot, "runtime-state.json")}`)),
      "promoted v4 runtime-state.json",
    );
    assert.deepEqual(await readFile(sourcePath), sourceBeforeAi);
    assert.equal(
      await readFile(activated.body.currentPath, "utf8"),
      normalizedCandidateHtml,
    );
  },
);
