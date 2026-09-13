import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";
import {
  finalizeProjectFileAttempt,
} from "../bridge/project-file-finalizer.mjs";
import {
  DEFAULT_PROJECT_RULES_TEMPLATE,
  ProjectFileRepository,
} from "../bridge/project-file-repository.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";

function html(label) {
  return `<!doctype html><html data-pageroot-id="pr1_11111111111141118111111111111111"><head data-pageroot-id="pr1_22222222222242229222222222222222"><title data-pageroot-id="pr1_3333333333334333a333333333333333">${label}</title></head><body data-pageroot-id="pr1_4444444444444444b444444444444444"><h1 data-pageroot-id="pr1_55555555555545558555555555555555">${label}</h1></body></html>`;
}

async function postJson(bridge, pathname, body) {
  return bridge.postJson(pathname, body);
}

test("project-file PR1 import switches to V1 before the queued save and leaves external bytes untouched", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-bridge-",
  });
  const original = html("external V1");
  const sourcePath = await environment.createSource("external.htm", original);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.registered, false);
  assert.equal(Number.isFinite(preview.body.performanceTiming.bridgeWorkspaceTotalMs), true);
  assert.ok(preview.body.performanceTiming.bridgeWorkspaceTotalMs >= 0);

  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal(ensured.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(ensured.body.imported, true);
  assert.equal(ensured.body.importSourceSha256, preview.body.currentHtmlSha256);
  assert.match(ensured.body.sourcePath, /external-V1\.htm$/u);
  assert.equal(ensured.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(Number.isFinite(ensured.body.performanceTiming.workspaceTotalMs), true);
  const envelope = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&operationId=hydration_bridge_1&shape=core-supplemental`,
  );
  assert.equal(envelope.response.status, 200, JSON.stringify(envelope.body));
  assert.equal(envelope.body.workspaceEnvelopeVersion, 1);
  assert.equal(envelope.body.operationId, "hydration_bridge_1");
  assert.equal(envelope.body.core.content, original);
  assert.equal(envelope.body.core.sourceSha256, ensured.body.sourceSha256);
  assert.equal(envelope.body.supplemental.operationId, "hydration_bridge_1");
  assert.equal(
    envelope.body.supplemental.snapshotRevision,
    envelope.body.snapshotRevision,
  );
  assert.ok(Array.isArray(envelope.body.supplemental.versions));
  assert.equal(await readFile(sourcePath, "utf8"), original);

  const edited = html("queued first edit");
  const saved = await postJson(bridge, "/autosave", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    editRevision: 1,
    html: edited,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.versionCreated, false);
  assert.equal(saved.body.content, edited);
  assert.equal(saved.body.currentExactVersionId, null);
  assert.equal(await readFile(sourcePath, "utf8"), original);
  const manifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("the Bridge exposes every Registry member and opens one only by projectId", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-catalog-",
  });
  const aPath = await environment.createSource("A.html", html("A"));
  const bPath = await environment.createSource("B.html", html("B"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });

  const ensure = async (sourcePath) => {
    const preview = await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
    );
    return postJson(bridge, "/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.body.currentHtmlSha256,
      projectStorageVersion: "4.0.0",
    });
  };
  const [a, b] = await Promise.all([ensure(aPath), ensure(bPath)]);
  assert.equal(a.response.status, 200, JSON.stringify(a.body));
  assert.equal(b.response.status, 200, JSON.stringify(b.body));

  const catalog = await bridge.requestJson("/registered-projects");
  assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
  assert.equal(catalog.body.ok, true);
  assert.deepEqual(
    new Set(catalog.body.projects.map((project) => project.projectId)),
    new Set([a.body.projectId, b.body.projectId]),
  );
  assert.equal(catalog.body.projects.every((project) => project.availability === "ready"), true);

  const opened = await bridge.requestJson(
    `/registered-project/open?projectId=${encodeURIComponent(b.body.projectId)}`,
  );
  assert.equal(opened.response.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.projectId, b.body.projectId);
  assert.equal(opened.body.documentId, b.body.documentId);
  assert.equal(opened.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(opened.body.sourcePath, b.body.sourcePath);
  assert.equal(opened.body.sourceSha256, opened.body.openTarget.sourceSha256);
  assert.equal(opened.body.content, html("B"));
  assert.equal(typeof opened.body.lastModifiedAt, "string");

  const finderRenamedWorkingCopy = join(
    b.body.projectRoot,
    "B Finder renamed.html",
  );
  await rename(b.body.sourcePath, finderRenamedWorkingCopy);
  const reboundCatalog = await bridge.requestJson("/registered-projects");
  assert.equal(reboundCatalog.response.status, 200, JSON.stringify(reboundCatalog.body));
  const reboundRow = reboundCatalog.body.projects.find(
    (project) => project.projectId === b.body.projectId,
  );
  assert.equal(reboundRow?.availability, "ready");
  assert.equal(reboundRow?.activeSourcePath, finderRenamedWorkingCopy);
  const reboundOpen = await bridge.requestJson(
    `/registered-project/open?projectId=${encodeURIComponent(b.body.projectId)}`,
  );
  assert.equal(reboundOpen.response.status, 200, JSON.stringify(reboundOpen.body));
  assert.equal(reboundOpen.body.sourcePath, finderRenamedWorkingCopy);

  const invalid = await bridge.requestJson("/registered-project/open?projectId=project_not_valid");
  assert.equal(invalid.response.status, 400);
});

test("the Bridge exposes content-free version summaries without rewriting a renamed Working Copy", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-version-summary-",
  });
  const sourcePath = await environment.createSource("summary.html", html("summary"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const manifestPath = join(ensured.body.projectRoot, ".pageroot", "manifest.json");
  const manifestBeforeRename = await readFile(manifestPath);
  const renamed = join(ensured.body.projectRoot, "summary renamed.html");
  await rename(ensured.body.sourcePath, renamed);

  const summaries = await bridge.requestJson(
    `/registered-project/versions?projectId=${encodeURIComponent(ensured.body.projectId)}`,
  );
  assert.equal(summaries.response.status, 200, JSON.stringify(summaries.body));
  assert.equal(summaries.body.projectId, ensured.body.projectId);
  assert.equal(summaries.body.documentId, ensured.body.documentId);
  assert.equal(summaries.body.currentBasedOnVersionId, "ver_0001");
  assert.equal(summaries.body.latestVersionId, "ver_0001");
  assert.equal(summaries.body.versions.length, 1);
  assert.deepEqual(summaries.body.versions[0], {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    versionId: "ver_0001",
    ordinal: 1,
    basedOnVersionId: null,
    previousVersionId: null,
    displayFileName: "summary renamed.html",
    modifiedAt: summaries.body.versions[0].modifiedAt,
    isActiveWorkingCopy: true,
    isLatestOfficial: true,
  });
  assert.equal(typeof summaries.body.versions[0].modifiedAt, "string");
  assert.equal(Object.hasOwn(summaries.body.versions[0], "content"), false);
  assert.equal(Object.hasOwn(summaries.body.versions[0], "comments"), false);
  assert.equal(Object.hasOwn(summaries.body.versions[0], "attachments"), false);
  assert.deepEqual(await readFile(manifestPath), manifestBeforeRename);
});

test("a new v4 import never enters or mutates the legacy v3 project main path", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-pre-v4-",
  });
  const original = html("pre-v4 external source");
  const sourcePath = await environment.createSource("pre-v4.html", original);
  const legacyProjectId = "project_aaaaaaaaaaaaaaaa";
  const legacyStorageDirectoryName = "pre-v4-legacy__20260101T000000__aaaaaaaa";
  const legacyProjectRoot = join(environment.workspace, "projects", legacyStorageDirectoryName);
  await mkdir(join(legacyProjectRoot, "versions"), { recursive: true });
  const legacyRegistryPath = join(environment.workspace, "project-registry.json");
  const legacyProjectPath = join(legacyProjectRoot, "project.json");
  await writeFile(
    legacyRegistryPath,
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projects: {
        [legacyProjectId]: {
          displayName: "pre-v4",
          sourcePath,
          createdAt: "2026-01-01T00:00:00.000Z",
          storageDirectoryName: legacyStorageDirectoryName,
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    legacyProjectPath,
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projectId: legacyProjectId,
      documentId: "doc_aaaaaaaaaaaaaaaa",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
      storageDirectoryName: legacyStorageDirectoryName,
    }, null, 2)}\n`,
  );
  const legacyRegistryBefore = await readFile(legacyRegistryPath);
  const legacyProjectBefore = await readFile(legacyProjectPath);
  const legacyTreeBefore = await readdir(legacyProjectRoot, { recursive: true });
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  assert.equal(preview.body.projectId, null);
  const source = await bridge.requestJson(
    `/source?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(source.response.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.registered, false);
  assert.equal(source.body.content, original);

  const imported = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(imported.body.imported, true);
  assert.notEqual(imported.body.projectId, legacyProjectId);
  assert.match(imported.body.sourcePath, /pre-v4-V1\.html$/u);
  const managedProjectsRoot = await realpath(join(environment.root, "project-files"));
  assert.equal(
    (await realpath(imported.body.projectRoot)).startsWith(`${managedProjectsRoot}/`),
    true,
  );
  assert.equal(await readFile(sourcePath, "utf8"), original);
  assert.deepEqual(await readFile(legacyRegistryPath), legacyRegistryBefore);
  assert.deepEqual(await readFile(legacyProjectPath), legacyProjectBefore);
  assert.deepEqual(await readdir(legacyProjectRoot, { recursive: true }), legacyTreeBefore);
  const manifest = JSON.parse(await readFile(
    join(imported.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  const newControlEntries = await readdir(join(imported.body.projectRoot, ".pageroot"));
  assert.equal(newControlEntries.includes("project-state.v3.json"), false);
  assert.equal(newControlEntries.includes("source-history.json"), false);
  assert.equal(newControlEntries.includes("history"), false);

  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(imported.body.sourcePath)}`,
  );
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.registered, true);
  assert.equal(reopened.body.projectId, imported.body.projectId);
});

test("Bridge continues a historical Version through one durable Working Copy receipt", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-history-bridge-",
  });
  const projectsRoot = join(environment.root, "project-files");
  const sourcePath = await environment.createSource("history-bridge.html", html("external V1"));
  const bridge = await environment.start({ HTML_AI_PROJECT_FILES_ROOT: projectsRoot });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const repository = new ProjectFileRepository({ projectsRoot });
  let active = (await repository.workspace({ sourcePath: ensured.body.sourcePath })).target;
  let v2WorkingCopyPath = null;
  const v2Html = html("immutable V2");
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const candidate = await repository.createCandidate({
      target: active,
      requestId: `req_bridge_history_${ordinal}`,
      candidateId: `candidate_bridge_history_${ordinal}_0001`,
      html: ordinal === 2 ? v2Html : html(`V${ordinal}`),
      expectedSourceSha256: active.sourceSha256,
    });
    active = (await repository.promoteCandidate({
      target: active,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    })).target;
    if (ordinal === 2) v2WorkingCopyPath = active.exactSourcePath;
  }
  assert.equal(active.versionId, "ver_0006");

  const finderRenamedV2 = join(
    ensured.body.projectRoot,
    "history-bridge-V2 Finder renamed.html",
  );
  await rename(v2WorkingCopyPath, finderRenamedV2);

  const viewed = await bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(active.exactSourcePath)}&versionId=ver_0002`,
  );
  assert.equal(viewed.response.status, 200, JSON.stringify(viewed.body));
  assert.equal(viewed.body.readOnly, true);
  assert.equal(viewed.body.content, v2Html);
  assert.equal(viewed.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(viewed.body.workingCopyId, "work_ver_0002");
  assert.equal(viewed.body.visibleWorkingCopyPath, finderRenamedV2);
  assert.equal(viewed.body.visibleWorkingCopyPath.includes("/.pageroot/"), false);
  assert.match(viewed.body.workingCopySha256, /^sha256:[a-f0-9]{64}$/u);
  const reboundManifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.equal(
    reboundManifest.workingCopies.find(
      (entry) => entry.workingCopyId === "work_ver_0002",
    )?.sourceRelativePath,
    "history-bridge-V2 Finder renamed.html",
  );
  const beforeContinue = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(active.exactSourcePath)}`,
  );
  assert.equal(beforeContinue.body.sourcePath, active.exactSourcePath);
  assert.equal(beforeContinue.body.latestVersionId, "ver_0006");

  const request = {
    sourcePath: active.exactSourcePath,
    projectId: active.projectId,
    documentId: active.documentId,
    versionId: "ver_0002",
    operationId: "bridge_history_continue_v2_0001",
  };
  const continued = await postJson(bridge, "/history-version/continue", request);
  assert.equal(continued.response.status, 200, JSON.stringify(continued.body));
  assert.equal(continued.body.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(continued.body.historyActivation.state, "desktop-pending");
  assert.equal(continued.body.operationId, request.operationId);

  const replayedAfterLostResponse = await postJson(bridge, "/history-version/continue", {
    ...request,
    operationId: "bridge_history_retry_after_loss_0001",
  });
  assert.equal(replayedAfterLostResponse.response.status, 200, JSON.stringify(replayedAfterLostResponse.body));
  assert.equal(replayedAfterLostResponse.body.replayed, true);
  assert.equal(replayedAfterLostResponse.body.operationId, request.operationId);

  const confirmation = {
    sourcePath: active.exactSourcePath,
    projectId: active.projectId,
    documentId: active.documentId,
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    operationId: request.operationId,
  };
  const confirmed = await postJson(bridge, "/history-version/desktop-confirmed", confirmation);
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.historyActivation.state, "desktop-confirmed");
  const confirmedReplay = await postJson(
    bridge,
    "/history-version/desktop-confirmed",
    confirmation,
  );
  assert.equal(confirmedReplay.response.status, 200, JSON.stringify(confirmedReplay.body));
  assert.equal(confirmedReplay.body.confirmed, false);

  const replayedAfterConfirmationLoss = await postJson(bridge, "/history-version/continue", {
    ...request,
    operationId: "bridge_history_retry_after_confirm_0001",
  });
  assert.equal(replayedAfterConfirmationLoss.response.status, 200, JSON.stringify(replayedAfterConfirmationLoss.body));
  assert.equal(replayedAfterConfirmationLoss.body.operationId, request.operationId);

  const stale = await postJson(bridge, "/history-version/continue", {
    ...request,
    versionId: "ver_0003",
    operationId: "bridge_history_stale_v3_0001",
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error.code, "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT");
});

test("project-file PROJECT.md remains available through the shared project-file inspector", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-rules-",
  });
  const sourcePath = await environment.createSource("rules.html", html("external V1"));
  const bridge = await environment.start();
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const inspect = async () => bridge.requestJson(
    `/file?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&path=PROJECT.md`,
  );
  const initial = await inspect();
  assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.relativePath, "PROJECT.md");
  assert.equal(initial.body.readOnly, false);
  assert.equal(initial.body.content, DEFAULT_PROJECT_RULES_TEMPLATE);

  const content = "# 项目规则\n\n- 只修改首页标题。\n";
  const saved = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const refreshed = await inspect();
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.content, content);

  const cleared = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content: "",
  });
  assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
  assert.equal((await inspect()).body.content, "");
});

test("project-file Request becomes a Candidate on finalization and a Version only on adoption", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-candidate-",
  });
  const original = html("external V1");
  const sourcePath = await environment.createSource("candidate.html", original);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const taskText = "将标题改为 Candidate。确保标题保持可读；本轮不需要修改导航栏。";
  const runtimeSourceAnchor = {
    targetId: "target_candidate",
    elementId: "pr1_11111111111141118111111111111111",
    label: "财务数据表",
    level: "subregion",
    selector: "main",
    resolution: "exact",
  };
  const runtimeVisualHint = {
    runtimeGenerated: true,
    kind: "table",
    label: "财务数据表",
    renderedText: "项目（百万元） 2025Q1 2025Q2 2026Q2",
    relativePath: "table:nth-of-type(1)",
    relativeBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.3 },
  };
  const projectRules = "# 本轮前的长期规则\n\n- 只修改标题。\n";
  const savedRules = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content: projectRules,
  });
  assert.equal(savedRules.response.status, 200, JSON.stringify(savedRules.body));
  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: taskText,
    comments: [{
      commentId: "comment_candidate",
      text: taskText,
      target: { targetId: "target_candidate" },
      sourceAnchor: runtimeSourceAnchor,
      visualHint: runtimeVisualHint,
      attachments: [],
    }],
    targets: [{ targetId: "target_candidate" }],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  assert.equal(request.body.activeRun.status, "processing");
  assert.equal(request.body.activeRun.sourceWorkingCopyId, ensured.body.openTarget.workingCopyId);
  const changedAfterFreeze = "# 下一次任务的长期规则\n";
  const changedRules = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content: changedAfterFreeze,
  });
  assert.equal(changedRules.response.status, 200, JSON.stringify(changedRules.body));
  assert.equal(
    await readFile(join(
      ensured.body.projectRoot,
      ".pageroot",
      "requests",
      request.body.requestId,
      "input",
      "PROJECT.md",
    ), "utf8"),
  projectRules);
  const frozenTask = JSON.parse(await readFile(join(
    ensured.body.projectRoot,
    ".pageroot",
    "requests",
    request.body.requestId,
    "change-request.json",
  ), "utf8"));
  assert.equal(frozenTask.requirements.objective, taskText);
  assert.equal(
    frozenTask.requirements.scopePolicy,
    "targets-plus-required-dependencies",
  );
  assert.equal(frozenTask.requirements.instructions[0].text, taskText);
  assert.equal("comments" in frozenTask.requirements, false);
  assert.equal("changeEvents" in frozenTask.requirements, false);
  assert.equal("preserveOutsideTargets" in frozenTask.requirements, false);
  const processingAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(processingAiTask.response.status, 200, JSON.stringify(processingAiTask.body));
  assert.equal(processingAiTask.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(processingAiTask.body.requestId, request.body.requestId);
  assert.equal(processingAiTask.body.candidatePath, null);
  assert.match(processingAiTask.body.aiTaskRelativePath, /^AI任务\//u);
  assert.equal(processingAiTask.body.aiTaskPath.includes("/.pageroot/"), false);
  const prompt = await readFile(
    join(ensured.body.projectRoot, ".pageroot", "requests", request.body.requestId, "PROMPT.md"),
    "utf8",
  );
  assert.match(prompt, /## 本轮目标/u);
  assert.match(prompt, /将标题改为 Candidate/u);
  assert.match(prompt, /## 修改范围/u);
  assert.match(prompt, /评论目标及实现要求所需的直接依赖/u);
  assert.match(prompt, /## 验收标准/u);
  assert.match(prompt, /确保标题保持可读/u);
  assert.match(prompt, /## 明确不做/u);
  assert.match(prompt, /本轮不需要修改导航栏/u);
  assert.match(prompt, /## 冻结输入与输出/u);
  assert.match(prompt, /## 完成/u);
  assert.match(prompt, /运行时可见内容评论规则/u);
  assert.match(prompt, /财务数据表/u);
  assert.match(prompt, /table:nth-of-type\(1\)/u);
  assert.match(prompt, /项目（百万元） 2025Q1 2025Q2 2026Q2/u);
  assert.doesNotMatch(prompt, /data-pageroot-id|data-html-ai-source-node-id/u);

  const outputPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    ...request.body.outputRelativePath.split("/"),
  );
  const candidateHtml = html("Candidate V2");
  await writeFile(outputPath, candidateHtml, "utf8");
  const finalized = await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });
  assert.equal(finalized.status, "completed");

  const ready = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(ready.response.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.status, "ready-to-open");
  assert.equal(ready.body.activeRun.sourceWorkingCopyId, ensured.body.openTarget.workingCopyId);
  assert.equal(ready.body.versionId, "ver_0002");
  assert.ok(["ready", "attention"].includes(ready.body.candidateAssessment.status));
  const readyAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(readyAiTask.response.status, 200, JSON.stringify(readyAiTask.body));
  assert.match(readyAiTask.body.candidatePath, /-V2-待审阅\.html$/u);
  assert.equal(await readFile(readyAiTask.body.candidatePath, "utf8"), candidateHtml);
  const controlRoot = join(ensured.body.projectRoot, ".pageroot");
  const candidateRecordPath = join(
    controlRoot,
    "requests",
    request.body.requestId,
    "candidate.json",
  );
  const [runtimeText, candidateRecord] = await Promise.all([
    readFile(join(controlRoot, "runtime-state.json")),
    readFile(candidateRecordPath),
  ]);
  const runtime = JSON.parse(runtimeText);
  assert.equal(
    runtime.activeRequest.candidateOutputSha256,
    sha256(Buffer.from(candidateHtml, "utf8")),
  );
  assert.equal(runtime.activeRequest.candidateRecordSha256, sha256(candidateRecord));
  const tamperedCandidateRecord = JSON.parse(candidateRecord.toString("utf8"));
  tamperedCandidateRecord.createdAt = "2000-01-01T00:00:00.000Z";
  await writeFile(candidateRecordPath, JSON.stringify(tamperedCandidateRecord), "utf8");
  const sealRejected = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(sealRejected.response.status, 409, JSON.stringify(sealRejected.body));
  assert.equal(sealRejected.body.error.code, "CANDIDATE_AUTHORITY_MISMATCH");
  await writeFile(candidateRecordPath, candidateRecord);
  const beforeAdoption = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(beforeAdoption.versions.map((version) => version.versionId), ["ver_0001"]);

  const review = await bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&versionId=ver_0002`,
  );
  assert.equal(review.response.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.content, candidateHtml);
  assert.equal(review.body.candidate.status, "pending-review");

  const adoptionIdentity = {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    versionId: "ver_0002",
  };
  const missingCandidate = await postJson(bridge, "/ready-version/activate", {
    ...adoptionIdentity,
    decisionOperationId: `promote_${ready.body.candidateId}`,
  });
  assert.equal(missingCandidate.response.status, 422, JSON.stringify(missingCandidate.body));
  assert.equal(missingCandidate.body.error.code, "INVALID_CANDIDATE_ID");
  const missingDecision = await postJson(bridge, "/ready-version/activate", {
    ...adoptionIdentity,
    candidateId: ready.body.candidateId,
  });
  assert.equal(missingDecision.response.status, 409, JSON.stringify(missingDecision.body));
  assert.equal(missingDecision.body.error.code, "DECISION_IDENTITY_MISMATCH");
  const wrongDecision = await postJson(bridge, "/ready-version/activate", {
    ...adoptionIdentity,
    candidateId: ready.body.candidateId,
    decisionOperationId: "promote_candidate_wrong_identity_0001",
  });
  assert.equal(wrongDecision.response.status, 409, JSON.stringify(wrongDecision.body));
  assert.equal(wrongDecision.body.error.code, "DECISION_IDENTITY_MISMATCH");
  const afterRejectedAdoptions = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(
    afterRejectedAdoptions.versions.map((version) => version.versionId),
    ["ver_0001"],
  );

  const adopted = await postJson(bridge, "/ready-version/activate", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    versionId: "ver_0002",
    candidateId: ready.body.candidateId,
    decisionOperationId: `promote_${ready.body.candidateId}`,
  });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.versionId, "ver_0002");
  assert.equal(adopted.body.openTarget.workingCopyId, "work_ver_0002");
  const adoptedRequest = JSON.parse(await readFile(
    join(controlRoot, "requests", request.body.requestId, "request.json"), "utf8",
  ));
  assert.equal(adoptedRequest.sourceWorkingCopyId, "work_ver_0001");
  assert.match(adopted.body.sourcePath, /candidate-V2\.html$/u);
  const afterAdoption = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(afterAdoption.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
});

test("Bridge reveals a sealed terminal AI task after no-change", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-no-change-ai-task-",
  });
  const original = html("no-change source");
  const sourcePath = await environment.createSource("no-change.html", original);
  let bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "不修改当前 HTML",
    comments: [{
      commentId: "comment_no_change",
      text: "不修改当前 HTML",
      target: { targetId: "target_no_change" },
      attachments: [],
    }],
    targets: [{ targetId: "target_no_change" }],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  await writeFile(
    join(
      ensured.body.projectRoot,
      ".pageroot",
      ...request.body.outputRelativePath.split("/"),
    ),
    original,
    "utf8",
  );
  await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });

  const status = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.status, "no-change");
  await bridge.stop();
  bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.activeRun, null);
  assert.equal(reopened.body.runtimeState.activeRun, null);
  assert.equal(reopened.body.recentRunOutcome?.status, "no-change");
  assert.equal(reopened.body.recentRunOutcome?.requestId, request.body.requestId);
  assert.equal(reopened.body.recentRunOutcome?.attemptId, request.body.attemptId);
  assert.equal(reopened.body.recentRunOutcome?.completionObserved, true);
  const terminalAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(terminalAiTask.response.status, 200, JSON.stringify(terminalAiTask.body));
  assert.equal(terminalAiTask.body.status, "no-change");
  assert.equal(terminalAiTask.body.requestId, request.body.requestId);
  assert.equal(terminalAiTask.body.candidatePath, null);
  assert.equal(
    await readFile(join(terminalAiTask.body.aiTaskPath, "PROMPT.md"), "utf8"),
    await readFile(
      join(ensured.body.projectRoot, ".pageroot", "requests", request.body.requestId, "PROMPT.md"),
      "utf8",
    ),
  );
  const requestPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    "requests",
    request.body.requestId,
    "request.json",
  );
  const tamperedRequest = JSON.parse(await readFile(requestPath, "utf8"));
  tamperedRequest.completedAt = "2000-01-01T00:00:00.000Z";
  await writeFile(requestPath, JSON.stringify(tamperedRequest), "utf8");
  const tamperRejected = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(tamperRejected.response.status, 409, JSON.stringify(tamperRejected.body));
  assert.equal(tamperRejected.body.error.code, "REQUEST_RUNTIME_ANCHOR_MISMATCH");
});

test("a finalized but unusable Candidate remains an error and never creates a Version", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-validation-",
  });
  const sourcePath = await environment.createSource("validation.html", html("external V1"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "生成一个空页面",
    comments: [{
      commentId: "comment_empty_page",
      text: "生成一个空页面",
      target: { targetId: "target_empty_page" },
      attachments: [],
    }],
    targets: [{ targetId: "target_empty_page" }],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  const outputPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    ...request.body.outputRelativePath.split("/"),
  );
  await writeFile(
    outputPath,
    "<!doctype html><html data-pageroot-id=\"pr1_11111111111141118111111111111111\"><head data-pageroot-id=\"pr1_22222222222242229222222222222222\"><title data-pageroot-id=\"pr1_3333333333334333a333333333333333\">empty</title></head><body data-pageroot-id=\"pr1_4444444444444444b444444444444444\"></body></html>",
    "utf8",
  );
  await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });

  const status = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.status, "error");
  assert.equal(status.body.request.error.code, "CANDIDATE_UNUSABLE");
  const terminalAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(terminalAiTask.response.status, 200, JSON.stringify(terminalAiTask.body));
  assert.equal(terminalAiTask.body.status, "error");
  assert.equal(terminalAiTask.body.requestId, request.body.requestId);
  assert.equal(terminalAiTask.body.candidatePath, null);
  assert.equal(terminalAiTask.body.aiTaskPath.includes("/.pageroot/"), false);
  const manifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  await assert.rejects(access(join(
    ensured.body.projectRoot,
    ".pageroot",
    "requests",
    request.body.requestId,
    "candidate.json",
  )));
});

test("unmanaged HTML stays an import source and mutations fail closed without a v4 project", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-unmanaged-open-",
  });
  const original = html("unmanaged");
  const sourcePath = await environment.createSource("open.html", original);
  const bridge = await environment.start();

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  const source = await bridge.requestJson(
    `/source?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(source.response.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.registered, false);
  assert.equal(source.body.content, original);

  const autosave = await postJson(bridge, "/autosave", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    editRevision: 1,
    html: html("should not write"),
  });
  assert.equal(autosave.response.status, 404);
  assert.equal(autosave.body.error.code, "PROJECT_NOT_FOUND");

  const draft = await postJson(bridge, "/draft", {
    sourcePath,
    operationId: "draftop_unmanaged_1",
    expectedDraftRevision: 0,
    comments: [],
    changeEvents: [],
  });
  assert.equal(draft.response.status, 404);
  assert.equal(draft.body.error.code, "PROJECT_NOT_FOUND");

  const conflict = await bridge.requestJson(
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(conflict.response.status, 404);
  assert.equal(conflict.body.error.code, "PROJECT_NOT_FOUND");
  assert.equal(await readFile(sourcePath, "utf8"), original);
});

test("v4 attachments and absent conflicts stay bound to the project root", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-v4-attachments-",
  });
  const sourcePath = await environment.createSource("attach.html", html("attach"));
  const bridge = await environment.start();
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal("sourceHistory" in ensured.body, false);
  const workingPath = ensured.body.sourcePath;
  const commentId = "comment_attach";
  const attachmentId = "attachment_one";
  const fileName = "note.txt";
  const payload = Buffer.from("pageroot-v4-attachment", "utf8");
  const saved = await postJson(bridge, "/attachment", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    commentId,
    attachmentId,
    fileName,
    mediaType: "text/plain",
    dataBase64: payload.toString("base64"),
    byteLength: payload.byteLength,
  });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.attachment.sha256, sha256(payload));
  assert.equal(
    saved.body.attachment.relativePath,
    `draft/attachments/${commentId}/${attachmentId}-${fileName}`,
  );
  const onDisk = await readFile(join(
    ensured.body.projectRoot,
    saved.body.attachment.relativePath,
  ));
  assert.deepEqual(onDisk, payload);

  const downloaded = await fetch(
    `${bridge.baseUrl}/attachment?sourcePath=${encodeURIComponent(workingPath)}&relativePath=${encodeURIComponent(saved.body.attachment.relativePath)}`,
  );
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), payload);

  const removed = await postJson(bridge, "/attachment/delete", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    relativePath: saved.body.attachment.relativePath,
  });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.removed, true);
  await assert.rejects(access(join(
    ensured.body.projectRoot,
    saved.body.attachment.relativePath,
  )));

  const emptyConflict = await bridge.requestJson(
    `/conflict-candidate?sourcePath=${encodeURIComponent(workingPath)}`,
  );
  assert.equal(emptyConflict.response.status, 200, JSON.stringify(emptyConflict.body));
  assert.equal(emptyConflict.body.content, undefined);

  const resolve = await postJson(bridge, "/conflict/resolve", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    resolution: "keep-external",
  });
  assert.equal(resolve.response.status, 404);
  assert.equal(resolve.body.error.code, "CONFLICT_NOT_FOUND");

  const unlocked = await postJson(bridge, "/conflict/resolve", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    action: "force-unlock",
  });
  assert.equal(unlocked.response.status, 200, JSON.stringify(unlocked.body));
  assert.equal(unlocked.body.status, "force-unlocked");
  assert.equal(unlocked.body.content, html("attach"));

  const sourcePreview = await bridge.requestJson(
    `/source-preview?sourcePath=${encodeURIComponent(workingPath)}`,
  );
  assert.equal(sourcePreview.response.status, 200, JSON.stringify(sourcePreview.body));
  assert.equal(sourcePreview.body.content, html("attach"));
  assert.equal(typeof sourcePreview.body.sha256, "string");

  const sourceStat = await bridge.requestJson(
    `/source-stat?sourcePath=${encodeURIComponent(workingPath)}`,
  );
  assert.equal(sourceStat.response.status, 200, JSON.stringify(sourceStat.body));
  assert.equal(sourceStat.body.sha256, sourcePreview.body.sha256);
});

test("Bridge POST /managed-working-copy/reconcile rebinds a Finder rename by stable IDs", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-managed-reconcile-",
  });
  const sourcePath = await environment.createSource("bridge-rename.html", html("bridge V1"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const renamedPath = join(ensured.body.projectRoot, "bridge Finder renamed.html");
  await rename(ensured.body.sourcePath, renamedPath);

  const getAttempt = await bridge.requestJson("/managed-working-copy/reconcile");
  assert.equal(getAttempt.response.status, 404);

  const reconciled = await postJson(bridge, "/managed-working-copy/reconcile", {
    operationId: "reconcile_bridge_operation_01",
    previousSourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    workingCopyId: ensured.body.openTarget.workingCopyId,
    versionId: ensured.body.openTarget.versionId,
    expectedSourceSha256: ensured.body.sourceSha256,
    reason: "watch",
  });
  assert.equal(reconciled.response.status, 200, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.status, "relocated");
  assert.equal(reconciled.body.sourcePath, renamedPath);
  assert.equal(reconciled.body.openTarget.projectId, ensured.body.projectId);
  assert.equal(reconciled.body.openTarget.workingCopyId, ensured.body.openTarget.workingCopyId);
  assert.equal(reconciled.body.openTarget.versionId, ensured.body.openTarget.versionId);
  assert.equal(reconciled.body.sourceSha256, ensured.body.sourceSha256);

  const missing = await postJson(bridge, "/managed-working-copy/reconcile", {
    operationId: "reconcile_bridge_operation_02",
    previousSourcePath: renamedPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    workingCopyId: "work_ver_9999",
    versionId: ensured.body.openTarget.versionId,
    expectedSourceSha256: ensured.body.sourceSha256,
    reason: "watch",
  });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "WORKING_COPY_UNAVAILABLE");
});

test("open-classification is read-only and returns A/B/C without source keys or original paths", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-open-classification-",
  });
  const original = html("classify original");
  const sourcePath = await environment.createSource("classify-me.html", original);
  const projectFilesRoot = join(environment.root, "project-files");
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: projectFilesRoot,
  });
  const registryFile = join(projectFilesRoot, ".pageroot-registry.json");

  const beforeImport = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(beforeImport.response.status, 200, JSON.stringify(beforeImport.body));
  assert.equal(beforeImport.body.kind, "new-external");
  assert.equal(beforeImport.body.sourceFileName, "classify-me.html");
  assert.equal(beforeImport.body.visibleV1FileName, "classify-me-V1.html");
  assert.equal(beforeImport.body.sourceSha256, sha256(Buffer.from(original, "utf8")));
  assert.equal("importSourceKey" in beforeImport.body, false);
  assert.equal(JSON.stringify(beforeImport.body).includes(sourcePath), false);

  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: beforeImport.body.sourceSha256,
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const registryBefore = await readFile(registryFile);

  const managed = await postJson(bridge, "/project/open-classification", {
    sourcePath: ensured.body.sourcePath,
  });
  assert.equal(managed.response.status, 200, JSON.stringify(managed.body));
  assert.equal(managed.body.kind, "managed-project");
  assert.equal(managed.body.openTarget.projectId, ensured.body.projectId);
  assert.equal(managed.body.openTarget.workingCopyId, "work_ver_0001");

  const known = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(known.response.status, 200, JSON.stringify(known.body));
  assert.equal(known.body.kind, "known-external");
  assert.equal(known.body.projectId, ensured.body.projectId);
  assert.equal(known.body.sourceRelation, "unchanged");
  assert.equal(known.body.currentBasedOnVersionId, "ver_0001");
  assert.equal(known.body.latestOfficialVersionId, "ver_0001");
  assert.equal(known.body.currentDiffersFromBase, false);
  assert.equal(known.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(known.body.openTarget.exactSourcePath, ensured.body.sourcePath);
  assert.equal("importSourceKey" in known.body, false);
  assert.equal(JSON.stringify(known.body).includes(sourcePath), false);
  assert.deepEqual(await readFile(registryFile), registryBefore);

  const edited = html("classify after edit");
  const saved = await postJson(bridge, "/autosave", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    editRevision: 1,
    html: edited,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));

  const knownAfterEdit = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(knownAfterEdit.response.status, 200, JSON.stringify(knownAfterEdit.body));
  assert.equal(knownAfterEdit.body.kind, "known-external");
  assert.equal(knownAfterEdit.body.projectId, ensured.body.projectId);
  assert.equal(knownAfterEdit.body.currentDiffersFromBase, true);
  assert.equal(knownAfterEdit.body.openTarget.workingCopyId, "work_ver_0001");
  assert.deepEqual(await readFile(registryFile), registryBefore);
});

test("Bridge creates and queries a manual historical Version with a distinct source type", async (t) => {
  const environment = await createBridgeTestEnvironment(t, { prefix: "stemmio-history-create-" });
  const sourcePath = await environment.createSource("manual.html", html("initial"));
  const bridge = await environment.start({ HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files") });
  const preview = await bridge.requestJson(`/workspace?sourcePath=${encodeURIComponent(sourcePath)}`);
  const ensured = await postJson(bridge, "/project/ensure", { sourcePath, expectedSourceSha256: preview.body.currentHtmlSha256, projectStorageVersion: "4.0.0" });
  assert.equal(ensured.response.status, 200);
  const request = { target: ensured.body.openTarget, versionId: "ver_0001", operationId: "history_bridge_create_0001",
    expectedSourceSha256: ensured.body.sourceSha256, expectedSnapshotSha256: ensured.body.versions[0].contentSha256 };
  const created = await postJson(bridge, "/history-version/create", request);
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.versionId, "ver_0002");
  const replayed = await postJson(bridge, "/history-version/create", request);
  assert.deepEqual(replayed.body, created.body);
  const queried = await postJson(bridge, "/history-version/result", { target: request.target, operationId: request.operationId });
  assert.equal(queried.body.versionId, "ver_0002");
  const workspace = await bridge.requestJson(`/workspace?sourcePath=${encodeURIComponent(created.body.sourcePath)}`);
  assert.equal(workspace.body.versions.length, 2);
  assert.equal(workspace.body.versions[1].sourceType, "history-copy");
  assert.equal(workspace.body.versions[1].sourceRequestId, null);
  const { loadWorkbenchModel } = await import("./helpers/workbench-model-loader.mjs");
  const { versionsFromWorkspace } = await loadWorkbenchModel("version-model");
  assert.equal(versionsFromWorkspace(workspace.body).find((version) => version.id === "ver_0002").source, "历史创建");
});
