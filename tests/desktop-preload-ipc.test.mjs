import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import {
  PROJECT_IPC_PROTOCOL,
  PROJECT_IPC_VERSION,
} from "../desktop/export-copy.mjs";

async function loadPreloadApis(invoke, { env = {}, search = "" } = {}) {
  const source = await readFile(
    new URL("../desktop/preload.mjs", import.meta.url),
    "utf8",
  );
  const exposed = new Map();
  const listeners = new Map();
  const sent = [];
  const ipcRenderer = {
    invoke,
    send(...args) {
      sent.push(args);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  };
  const context = vm.createContext({
    console,
    location: { search },
    URLSearchParams,
    process: { env },
    require(specifier) {
      assert.equal(specifier, "electron");
      return { contextBridge, ipcRenderer };
    },
  });
  vm.runInContext(source, context, {
    filename: "desktop/preload.mjs",
  });
  return {
    worlds: Object.fromEntries(exposed),
    projects: exposed.get("htmlAIProjects"),
    integrations: exposed.get("htmlAIIntegrations"),
    updates: exposed.get("htmlAIUpdates"),
    runtime: exposed.get("htmlAIRuntime"),
    lifecycle: exposed.get("htmlAIAppLifecycle"),
    usage: exposed.get("htmlAIUsage"),
    uiPreferences: exposed.get("htmlAIUiPreferences"),
    preview: exposed.get("htmlAIPreview"),
    editRuntime: exposed.get("htmlAIEditRuntime"),
    edit: exposed.get("htmlAIEdit"),
    sent,
    emit(channel, payload) {
      listeners.get(channel)?.({}, payload);
    },
  };
}

async function loadPreload(invoke) {
  return (await loadPreloadApis(invoke)).projects;
}

function success(value) {
  return {
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: true,
    value,
  };
}

test("preload declares one immutable desktop runtime capability manifest", async () => {
  const { runtime } = await loadPreloadApis(async () => success(null));
  assert.equal(runtime.capabilities.sourceEditing, "enabled");
  assert.equal(runtime.betaAgentModelsEnabled, false);
  assert.equal(runtime.capabilities.projectOpening, "desktop-dialog");
  assert.equal(runtime.capabilities.attachmentPersistence, "bridge");
  assert.equal(runtime.capabilities.closeCoordination, "electron-handshake");
  assert.equal(runtime.capabilities.interactivePreview, "independent-url");
  assert.equal(Object.isFrozen(runtime.capabilities), true);
});

test("preload publishes one validated Bridge connection without reloading the shell", async () => {
  let projectInvocations = 0;
  const loaded = await loadPreloadApis(async () => {
    projectInvocations += 1;
    return success(null);
  }, { search: "?bridgeDeferred=1" });
  assert.equal(loaded.runtime.getBridgeConnection(), null);
  const pendingProject = loaded.projects.getActiveProject();
  await Promise.resolve();
  assert.equal(projectInvocations, 0);
  const received = [];
  const unsubscribe = loaded.runtime.onBridgeReady((connection) => received.push(connection));
  loaded.emit("html-app:bridge-ready", {
    bridgePort: "43179",
    bridgeAuthToken: "a".repeat(43),
    appVersion: "0.9.8",
    startupTiming: {
      schemaVersion: 1,
      timeOriginUnixMs: 1_000,
      marks: [{ stage: "bridge-ready", atUnixMs: 1_020 }],
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.runtime.getBridgeConnection())), {
    bridgePort: "43179",
    bridgeAuthToken: "a".repeat(43),
    appVersion: "0.9.8",
  });
  assert.equal(received.length, 1);
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(loaded.runtime.getStartupTiming().marks[0].stage, "bridge-ready");
  await pendingProject;
  assert.equal(projectInvocations, 1);
  loaded.emit("html-app:bridge-ready", {
    bridgePort: "70000",
    bridgeAuthToken: "unsafe",
  });
  assert.equal(received.length, 1);
  unsubscribe();
});

test("preload exposes only validated content-free startup timing", async () => {
  const startupTiming = encodeURIComponent(JSON.stringify({
    schemaVersion: 1,
    timeOriginUnixMs: 1_000,
    marks: [
      { stage: "process-start", atUnixMs: 1_001 },
      { stage: "bridge-ready", atUnixMs: 1_020 },
      { stage: "invalid stage", atUnixMs: 1_030 },
    ],
  }));
  const { runtime } = await loadPreloadApis(
    async () => success(null),
    { search: `?startupTiming=${startupTiming}` },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.diagnostics.startupTiming)),
    {
      schemaVersion: 1,
      timeOriginUnixMs: 1_000,
      marks: [
        { stage: "process-start", atUnixMs: 1_001 },
        { stage: "bridge-ready", atUnixMs: 1_020 },
      ],
    },
  );
  assert.equal(Object.isFrozen(runtime.diagnostics), true);
  assert.equal(Object.isFrozen(runtime.diagnostics.startupTiming.marks), true);
});

test("preload exposes no Agent executable, spawn, command, or path capability", async () => {
  const { worlds } = await loadPreloadApis(async () => success(null));
  assert.equal("htmlAIAgent" in worlds, false);
  const visit = (value, location) => {
    if (!value || typeof value !== "object") return;
    for (const [name, nested] of Object.entries(value)) {
      assert.doesNotMatch(name, /(?:executable|spawn|command|path)/iu, `${location}.${name}`);
      visit(nested, `${location}.${name}`);
    }
  };
  for (const [name, value] of Object.entries(worlds)) visit(value, name);
});

test("preload exposes a narrow verified recovery journal API", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    if (args[0] === "html-projects:list-recovery-journals") {
      return success({ entries: [], invalidCount: 0 });
    }
    return success({
      projectId: "project_0123456789abcdef",
      documentId: "doc_0123456789abcdef",
      journalSha256: `sha256:${"b".repeat(64)}`,
    });
  });
  const payload = {
    projectId: "project_0123456789abcdef",
    documentId: "doc_0123456789abcdef",
    sourcePath: "/tmp/report.html",
    revision: 2,
    html: "<!doctype html><html></html>",
  };

  await api.commitRecoveryJournal(payload);
  await api.readRecoveryJournal({
    projectId: payload.projectId,
    documentId: payload.documentId,
  });
  await api.rebaseRecoveryJournal({
    projectId: payload.projectId,
    documentId: payload.documentId,
    previousSourcePath: payload.sourcePath,
    sourcePath: "/tmp/moved-report.html",
  });
  await api.removeRecoveryJournal({
    projectId: payload.projectId,
    documentId: payload.documentId,
  });
  await api.listRecoveryJournals({ cursor: `${"a".repeat(64)}.json` });

  assert.deepEqual(calls, [
    ["html-projects:commit-recovery-journal", payload],
    ["html-projects:read-recovery-journal", {
      projectId: payload.projectId,
      documentId: payload.documentId,
    }],
    ["html-projects:rebase-recovery-journal", {
      projectId: payload.projectId,
      documentId: payload.documentId,
      previousSourcePath: payload.sourcePath,
      sourcePath: "/tmp/moved-report.html",
    }],
    ["html-projects:remove-recovery-journal", {
      projectId: payload.projectId,
      documentId: payload.documentId,
    }],
    ["html-projects:list-recovery-journals", { cursor: `${"a".repeat(64)}.json` }],
  ]);
  for (const exposedName of Object.keys(api)) {
    assert.doesNotMatch(exposedName, /(?:journalPath|userDataPath|readFile)/u);
  }
});

test("preload exposes one narrow disposable Edit runtime resource port", async () => {
  const calls = [];
  const { editRuntime } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-edit-runtime:prepare") {
      return success({
        contractVersion: 2,
        sessionId: "0123456789abcdef0123456789abcdef",
        executionId: "abcdefabcdefabcdefabcdef",
      });
    }
    return success({ revoked: true });
  });
  const payload = {
    contractVersion: 2,
    requestId: "edit-runtime-request-0001",
    sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    html: "<!doctype html><main id=chart></main>",
    programIdentity: "[]",
    canvasGeneration: 4,
  };

  assert.deepEqual(await editRuntime.prepare(payload), {
    contractVersion: 2,
    sessionId: "0123456789abcdef0123456789abcdef",
    executionId: "abcdefabcdefabcdefabcdef",
  });
  assert.deepEqual(calls[0], ["html-edit-runtime:prepare", payload]);
  assert.deepEqual(
    await editRuntime.revoke("0123456789abcdef0123456789abcdef"),
    { revoked: true },
  );
  assert.deepEqual(calls[1], [
    "html-edit-runtime:revoke",
    "0123456789abcdef0123456789abcdef",
  ]);
  assert.deepEqual(Object.keys(editRuntime).sort(), [
    "prepare",
    "revoke",
  ]);
});

test("preload exposes one narrow UI-preferences get/record port", async () => {
  const calls = [];
  const { uiPreferences } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-ui-preferences:get") {
      return success({
        schemaVersion: 2,
        workspace: {
          rememberPanelWidths: true,
          sidebarWidth: 264,
          inspectorWidth: 376,
          motion: "system",
          restoreTabsOnLaunch: true,
          defaultAgentProviderId: "qoder",
        },
      });
    }
    return success({
      schemaVersion: 2,
      workspace: {
        rememberPanelWidths: true,
        sidebarWidth: 320,
        inspectorWidth: 376,
        motion: "system",
        restoreTabsOnLaunch: true,
        defaultAgentProviderId: "qoder",
      },
    });
  });

  assert.deepEqual(await uiPreferences.get(), {
    schemaVersion: 2,
    workspace: {
      rememberPanelWidths: true,
      sidebarWidth: 264,
      inspectorWidth: 376,
      motion: "system",
      restoreTabsOnLaunch: true,
      defaultAgentProviderId: "qoder",
    },
  });
  assert.deepEqual(calls[0], ["html-ui-preferences:get"]);
  assert.deepEqual(await uiPreferences.record({ workspace: { sidebarWidth: 320 } }), {
    schemaVersion: 2,
    workspace: {
      rememberPanelWidths: true,
      sidebarWidth: 320,
      inspectorWidth: 376,
      motion: "system",
      restoreTabsOnLaunch: true,
      defaultAgentProviderId: "qoder",
    },
  });
  await uiPreferences.record({
    workspace: {
      reviewChangeContextVisibility: 31,
      reviewCommentContextVisibility: 19,
    },
  });
  assert.equal(calls[1][0], "html-ui-preferences:record");
  assert.equal(calls[1][1].workspace.sidebarWidth, 320);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2][1].workspace)), {
    reviewChangeContextVisibility: 31,
    reviewCommentContextVisibility: 19,
  });
  await assert.rejects(
    () => uiPreferences.record({ action: "dismissed" }),
    /工作台偏好记录无效/u,
  );
  await assert.rejects(
    () => uiPreferences.record({ workspace: { sidebarWidth: 999 } }),
    /工作台偏好记录无效/u,
  );
  await assert.rejects(
    () => uiPreferences.record({ workspace: { reviewChangeContextVisibility: 101 } }),
    /工作台偏好记录无效/u,
  );
  await assert.rejects(
    () => uiPreferences.record({ workspace: { defaultAgentProviderId: "gemini" } }),
    /工作台偏好记录无效/u,
  );
  assert.equal(calls.length, 3);
  await uiPreferences.record({ workspace: { defaultAgentProviderId: "pageroot" } });
  assert.equal(calls[3][1].workspace.defaultAgentProviderId, "pageroot");
  await assert.rejects(
    () => uiPreferences.record({ workspace: { disabledAgentProviderIds: ["gemini"] } }),
    /工作台偏好记录无效/u,
  );
  await uiPreferences.record({ workspace: { disabledAgentProviderIds: ["codex"] } });
  assert.deepEqual(calls[4][1].workspace.disabledAgentProviderIds, ["codex"]);
  assert.deepEqual(Object.keys(uiPreferences).sort(), ["get", "record"]);
});

test("preload exposes runtime commit hooks only for explicit E2E launches", async () => {
  const ordinary = await loadPreloadApis(async () => success(null), {
    env: { PAGEROOT_E2E: "1" },
  });
  assert.equal(ordinary.runtime.diagnostics.e2eRuntimeCommitHooks, false);

  const hooked = await loadPreloadApis(async () => success(null), {
    env: { PAGEROOT_E2E: "1", PAGEROOT_E2E_RUNTIME_COMMIT_HOOKS: "1" },
  });
  assert.equal(hooked.runtime.diagnostics.e2eRuntimeCommitHooks, true);
});

test("preload exposes the UI-preferences port during E2E launches", async () => {
  const { uiPreferences } = await loadPreloadApis(async () => success({}), {
    env: { PAGEROOT_E2E: "1" },
  });
  assert.equal(typeof uiPreferences.get, "function");
  assert.equal(typeof uiPreferences.record, "function");
});

test("preload exposes only preview session creation and revocation", async () => {
  const calls = [];
  const { preview } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-preview:create-session") {
      return success({
        sessionId: "0123456789abcdef0123456789abcdef",
        url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
      });
    }
    return success({ revoked: true });
  });
  const payload = {
    html: "<!doctype html><p>preview</p>",
    bootstrapJavaScript: "void 0;",
    sourcePath: "/Users/demo/report.html",
  };

  assert.deepEqual(
    await preview.createSession(payload),
    {
      sessionId: "0123456789abcdef0123456789abcdef",
      url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
    },
  );
  assert.deepEqual(calls[0], ["html-preview:create-session", payload]);
  assert.deepEqual(
    await preview.revokeSession("0123456789abcdef0123456789abcdef"),
    { revoked: true },
  );
  assert.deepEqual(calls[1], [
    "html-preview:revoke-session",
    "0123456789abcdef0123456789abcdef",
  ]);
  assert.deepEqual(Object.keys(preview).sort(), [
    "createSession",
    "revokeSession",
  ]);
});

test("preload exposes one fire-and-forget usage channel with a narrow payload", async () => {
  const preload = await loadPreloadApis(async () => success(null));
  preload.usage.capture(
    "notification_presented",
    {
      notice_code: "source_reload",
      tone: "warning",
      disposition: "direct-action",
      surface: "global",
      has_action: true,
    },
    "project_demo",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(preload.sent)),
    [[
      "html-usage:capture",
      {
        event: "notification_presented",
        properties: {
          notice_code: "source_reload",
          tone: "warning",
          disposition: "direct-action",
          surface: "global",
          has_action: true,
        },
        projectId: "project_demo",
      },
    ]],
  );

  preload.usage.capture(
    "renderer_fault",
    { nested: { raw: "not allowed" } },
    "project_demo",
  );
  preload.usage.capture(
    "renderer_fault",
    { kind: "window_error" },
    "/Users/demo/private.html",
  );
  assert.equal(preload.sent.length, 1);
  assert.deepEqual(Object.keys(preload.usage), ["capture"]);
});

test("preload exposes one narrow native/source history router", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return { applied: true };
  });
  const requested = [];
  const unsubscribe = preload.edit.onHistoryRequested((direction) => {
    requested.push(direction);
  });
  preload.emit("html-edit:history-requested", { direction: "undo" });
  preload.emit("html-edit:history-requested", { direction: "invalid" });
  assert.deepEqual(requested, ["undo"]);
  assert.deepEqual(
    await preload.edit.runNativeHistory("redo"),
    { applied: true },
  );
  assert.deepEqual(calls, [["html-edit:native-history", "redo"]]);
  assert.throws(
    () => preload.edit.runNativeHistory("invalid"),
    /direction must be undo or redo/,
  );
  unsubscribe();
  preload.emit("html-edit:history-requested", { direction: "redo" });
  assert.deepEqual(requested, ["undo"]);
});

test("preload exposes a source-file change listener", async () => {
  const preload = await loadPreloadApis(async () => success(null));
  const received = [];
  const unsubscribe = preload.projects.onSourceFileChanged((info) => {
    received.push(info.sourcePath);
  });
  preload.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "/tmp/page.html",
  });
  preload.emit("html-projects:source-file-may-have-changed", { sourcePath: " " });
  assert.deepEqual(received, ["/tmp/page.html"]);
  unsubscribe();
  preload.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "/tmp/page.html",
  });
  assert.deepEqual(received, ["/tmp/page.html"]);
});

test("preload unwraps structured project IPC success results", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success([{ name: "demo.html" }]);
  });

  assert.deepEqual(
    await api.listRecentProjects(),
    [{ name: "demo.html" }],
  );
  assert.equal(calls[0][0], "html-projects:list-recent");
});

test("preload exposes Registry catalog reads and projectId-only opens", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success(args[0] === "html-projects:list-registered"
      ? [{
        projectId: "project_0123456789abcdef",
        projectName: "报告",
        availability: "ready",
      }]
      : args[0] === "html-projects:list-registered-version-summaries"
        ? {
          projectId: args[1],
          documentId: "doc_0123456789abcdef",
          versions: [],
        }
      : {
        sourcePath: "/Users/demo/Documents/PageRoot/项目/报告/报告-V1.html",
        html: "<!doctype html><html><body>报告</body></html>",
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
  });

  assert.deepEqual(await api.listRegisteredProjects(), [{
    projectId: "project_0123456789abcdef",
    projectName: "报告",
    availability: "ready",
  }]);
  assert.deepEqual(
    await api.listRegisteredProjectVersionSummaries("project_0123456789abcdef"),
    {
      projectId: "project_0123456789abcdef",
      documentId: "doc_0123456789abcdef",
      versions: [],
    },
  );
  assert.equal(
    (await api.readRegisteredProjectProjection("project_0123456789abcdef")).sourcePath,
    "/Users/demo/Documents/PageRoot/项目/报告/报告-V1.html",
  );
  assert.deepEqual(
    await api.openRegisteredProject("project_0123456789abcdef"),
    {
      sourcePath: "/Users/demo/Documents/PageRoot/项目/报告/报告-V1.html",
      html: "<!doctype html><html><body>报告</body></html>",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  );
  assert.deepEqual(calls, [
    ["html-projects:list-registered"],
    ["html-projects:list-registered-version-summaries", "project_0123456789abcdef"],
    ["html-projects:read-registered-projection", "project_0123456789abcdef"],
    ["html-projects:open-registered", "project_0123456789abcdef"],
  ]);
});

test("preload exposes the structured Finder reveal operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/report.html" });
  });

  assert.deepEqual(
    await api.showInFolder("/Users/demo/report.html"),
    { sourcePath: "/Users/demo/report.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:show-in-folder",
    "/Users/demo/report.html",
  ]);
});

test("preload exposes the narrow configured PageRoot projects-root operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ opened: true });
  });

  assert.deepEqual(await api.openProjectsRoot(), { opened: true });
  assert.deepEqual(calls[0], [
    "html-projects:open-projects-root",
  ]);
});

test("preload exposes the narrow default-browser HTML operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/report.html" });
  });

  assert.deepEqual(
    await api.openInDefaultBrowser("/Users/demo/report.html"),
    { sourcePath: "/Users/demo/report.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:open-in-default-browser",
    "/Users/demo/report.html",
  ]);
});

test("preload exposes the narrow source rename operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/新名称.html",
      previousSourcePath: "/Users/demo/report.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: "rename_demo_operation",
    });
  });
  const payload = {
    operationId: "rename_demo_operation",
    sourcePath: "/Users/demo/report.html",
    stem: "新名称",
    expectedSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  assert.deepEqual(
    await api.renameHtml(payload),
    {
      sourcePath: "/Users/demo/新名称.html",
      previousSourcePath: "/Users/demo/report.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: "rename_demo_operation",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:rename",
    payload,
  ]);
});

test("preload exposes the narrow active managed source reconcile operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      operationId: "reconcile_demo_operation",
      status: "relocated",
      previousSourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
      sourcePath: "/Users/demo/Documents/PageRoot/项目/report/Finder 新名字-V1.html",
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      openTarget: {
        projectId: "project_demo",
        documentId: "doc_demo0123456789",
        workingCopyId: "work_ver_0001",
        versionId: "ver_0001",
      },
      watcherGeneration: 2,
    });
  });
  const payload = {
    previousSourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
    expectedSourceSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "project_demo",
    documentId: "doc_demo0123456789",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    reason: "watch",
    watcherGeneration: 1,
  };

  assert.deepEqual(
    await api.reconcileActiveManagedSource(payload),
    {
      operationId: "reconcile_demo_operation",
      status: "relocated",
      previousSourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
      sourcePath: "/Users/demo/Documents/PageRoot/项目/report/Finder 新名字-V1.html",
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      openTarget: {
        projectId: "project_demo",
        documentId: "doc_demo0123456789",
        workingCopyId: "work_ver_0001",
        versionId: "ver_0001",
      },
      watcherGeneration: 2,
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:reconcile-active-managed-source",
    payload,
  ]);
});

test("preload delivers directory-change hints without claiming a new path", async () => {
  const seen = [];
  const loaded = await loadPreloadApis(async () => success(null));
  const unsubscribe = loaded.projects.onSourceFileChanged((payload) => {
    seen.push(payload);
  });
  loaded.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
    watcherGeneration: 3,
  });
  loaded.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "",
    watcherGeneration: 4,
  });
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].sourcePath,
    "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
  );
  assert.equal(seen[0].watcherGeneration, 3);
  assert.equal("nextSourcePath" in seen[0], false);
  assert.equal("sourceMissing" in seen[0], false);
  loaded.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
    watcherGeneration: 5,
    sourceMissing: false,
  });
  loaded.emit("html-projects:source-file-may-have-changed", {
    sourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
    watcherGeneration: 6,
    sourceMissing: true,
  });
  assert.equal(seen[1].sourceMissing, false);
  assert.equal(seen[2].sourceMissing, true);
  unsubscribe();
});

test("preload exposes explicit recent-record removal", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/moved.html" });
  });

  assert.deepEqual(
    await api.forgetRecent("/Users/demo/moved.html"),
    { sourcePath: "/Users/demo/moved.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:forget-recent",
    "/Users/demo/moved.html",
  ]);
});

test("preload accepts and acknowledges only an opaque main-process external-open request", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/qoder-output.html" });
  });

  assert.deepEqual(
    await api.acceptExternalOpen("external_request_1"),
    { sourcePath: "/Users/demo/qoder-output.html" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "html-projects:accept-external-open",
    { requestId: "external_request_1" },
  ]);
  await api.acknowledgeExternalOpen("external_request_1");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), [
    "html-projects:ack-external-open",
    { requestId: "external_request_1" },
  ]);
});

test("preload prepared-open methods never submit a filesystem path", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ openKind: "project", name: "page", html: "<html></html>" });
  });

  await api.commitPreparedHtmlOpen({
    requestId: "req_1",
    action: "import-new",
    deleteOriginal: true,
    sourcePath: "/Users/demo/secret.html",
  });
  await api.cancelPreparedHtmlOpen("req_1");
  await api.finalizePreparedHtmlOpen("req_1");
  await api.rollbackPreparedHtmlOpen("req_1");

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["html-projects:commit-prepared-open", {
      requestId: "req_1",
      action: "import-new",
      deleteOriginal: true,
    }],
    ["html-projects:cancel-prepared-open", { requestId: "req_1" }],
    ["html-projects:finalize-prepared-open", { requestId: "req_1" }],
    ["html-projects:rollback-prepared-open", { requestId: "req_1" }],
  ]);
});

test("preload replays a pending external-open request and receives later requests", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:external-open-ready") {
      return {
        requestId: "external_startup",
        sourcePath: "/Users/demo/startup.html",
      };
    }
    return null;
  });
  const requests = [];
  const unsubscribe = preload.lifecycle.onExternalOpenRequested((request) => {
    requests.push(request);
  });
  await new Promise((resolve) => setImmediate(resolve));
  preload.emit("html-app:external-open-requested", {
    requestId: "external_live",
    sourcePath: "/Users/demo/live.html",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      requestId: "external_startup",
    },
    {
      requestId: "external_live",
    },
  ]);
  assert.deepEqual(calls, [["html-app:external-open-ready"]]);
  unsubscribe();
});

test("preload ignores a stale external-open catch-up after a newer live delivery", async () => {
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:external-open-ready") return ready;
    return null;
  });
  const requests = [];
  const unsubscribe = preload.lifecycle.onExternalOpenRequested((request) => {
    requests.push(request);
  });
  await new Promise((resolve) => setImmediate(resolve));

  preload.emit("html-app:external-open-requested", {
    requestId: "external_live",
    sourcePath: "/Users/demo/live.html",
  });
  resolveReady({
    requestId: "external_startup",
    sourcePath: "/Users/demo/startup.html",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{
    requestId: "external_live",
  }]);
  assert.deepEqual(calls, [["html-app:external-open-ready"]]);
  unsubscribe();
});

test("preload exposes workspace failure recovery and a narrow relaunch action", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:workspace-recovery-ready") {
      return {
        issue: {
          title: "启动期间本地项目资料不可用",
          message: "已为较晚注册的监听器保留恢复信息。",
        },
      };
    }
    return { relaunched: false };
  });
  const issues = [];
  let aboutRequests = 0;
  const unsubscribeAbout = preload.lifecycle.onAboutRequested(() => {
    aboutRequests += 1;
  });
  const unsubscribe = preload.lifecycle.onWorkspaceUnavailable((issue) => {
    issues.push(issue);
  });
  await new Promise((resolve) => setImmediate(resolve));

  preload.emit("html-app:workspace-unavailable", {
    title: "本地项目资料暂时不可用",
    message: "请先导出当前 HTML。",
  });
  preload.emit("html-app:about-requested");
  assert.equal(aboutRequests, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(issues)),
    [
      {
        title: "启动期间本地项目资料不可用",
        message: "已为较晚注册的监听器保留恢复信息。",
      },
      {
        title: "本地项目资料暂时不可用",
        message: "请先导出当前 HTML。",
      },
    ],
  );
  assert.deepEqual(
    await preload.lifecycle.relaunch(),
    { relaunched: false },
  );
  assert.deepEqual(calls, [
    ["html-app:workspace-recovery-ready"],
    ["html-app:relaunch"],
  ]);
  unsubscribeAbout();
  unsubscribe();
});

test("preload reports close blockers in-app and can request retry", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return { accepted: true };
  });
  await preload.lifecycle.reportBlocked("close-request-0001", "正在保存。");
  await preload.lifecycle.reportBlocked("close-request-0002", "正在保存。", "in-app", true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["html-app:close-result", {
      requestId: "close-request-0001",
      ready: false,
      reason: "正在保存。",
      presentation: "in-app",
    }],
    ["html-app:close-result", {
      requestId: "close-request-0002",
      ready: false,
      reason: "正在保存。",
      presentation: "in-app",
      retry: true,
    }],
  ]);
});

test("preload replays a pending external-open failure and receives later failures", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:external-open-failed-ready") {
      return {
        title: "无法打开这个 HTML",
        message: "启动期间未能读取这个 HTML 文件。",
      };
    }
    return null;
  });
  const issues = [];
  const unsubscribe = preload.lifecycle.onExternalOpenFailed((issue) => {
    issues.push(issue);
  });
  await new Promise((resolve) => setImmediate(resolve));
  preload.emit("html-app:external-open-failed", {
    title: "无法打开这个 HTML",
    message: "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(issues)), [
    {
      title: "无法打开这个 HTML",
      message: "启动期间未能读取这个 HTML 文件。",
    },
    {
      title: "无法打开这个 HTML",
      message: "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
    },
  ]);
  assert.deepEqual(calls, [["html-app:external-open-failed-ready"]]);
  unsubscribe();
});

test("preload opens only the fixed packaged user notice", async () => {
  const calls = [];
  const { lifecycle } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ opened: true });
  });

  assert.deepEqual(
    await lifecycle.openUserNotice(),
    { opened: true },
  );
  assert.deepEqual(calls, [["html-app:open-user-notice"]]);
});

test("preload exposes the narrow generated-version activation operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previousSourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    });
  });
  const payload = {
    previousSourcePath: "/Users/demo/report.html",
    nextSourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
    expectedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "project_demo",
    versionId: "ver_0002",
  };

  assert.deepEqual(
    await api.activateGeneratedVersion(payload),
    {
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previousSourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:activate-generated-version",
    payload,
  ]);
});

test("preload exposes the exact managed Working Copy activation operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      html: "<!doctype html><html><body>V1</body></html>",
      previousSourcePath: "/Users/demo/report.html",
    });
  });
  const payload = {
    previousSourcePath: "/Users/demo/report.html",
    nextSourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
    expectedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "project_demo",
    documentId: "doc_demo",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    projectRootPath: "/Users/demo/Documents/PageRoot/项目/report",
  };

  assert.deepEqual(
    await api.activateManagedWorkingCopy(payload),
    {
      sourcePath: "/Users/demo/Documents/PageRoot/项目/report/report-V1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      html: "<!doctype html><html><body>V1</body></html>",
      previousSourcePath: "/Users/demo/report.html",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:activate-managed-working-copy",
    payload,
  ]);
});

test("preload exposes the narrow history-version Finder operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
      versionPath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/versions/ver_0002/files/index.html",
    });
  });
  const payload = {
    sourcePath: "/Users/demo/report.html",
    versionId: "ver_0002",
  };

  assert.deepEqual(
    await api.revealVersionFile(payload),
    {
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
      versionPath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/versions/ver_0002/files/index.html",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:reveal-version-file",
    payload,
  ]);
});

test("preload exposes the narrow AI task Finder operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/report.html",
      aiTaskPath: "/Users/demo/PageRoot/项目/报告/AI任务/2026-08-15-候选版本2",
      requestId: "req_0001",
      candidateId: "candidate_00000000000000000000000000000000",
    });
  });
  const payload = {
    sourcePath: "/Users/demo/report.html",
  };

  assert.deepEqual(
    await api.revealAiTask(payload),
    {
      sourcePath: "/Users/demo/report.html",
      aiTaskPath: "/Users/demo/PageRoot/项目/报告/AI任务/2026-08-15-候选版本2",
      requestId: "req_0001",
      candidateId: "candidate_00000000000000000000000000000000",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:reveal-ai-task",
    payload,
  ]);
});

test("preload never replays a failed local side-effect request", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    throw new Error("desktop operation unavailable");
  });
  const actions = [
    ["showInFolder", "/Users/demo/report.html"],
    ["openProjectsRoot"],
    ["openInDefaultBrowser", "/Users/demo/report.html"],
    ["revealAiTask", {
      sourcePath: "/Users/demo/report.html",
    }],
    ["revealVersionFile", {
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    }],
  ];

  for (const [method, payload] of actions) {
    const before = calls.length;
    await assert.rejects(
      () => api[method](payload),
      (error) => error?.code === "PROJECT_SERVICE_UNAVAILABLE",
    );
    assert.equal(calls.length, before + 1, `${method} must invoke once`);

    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(calls.length, before + 1, `${method} must not retry on a timer`);

    await assert.rejects(() => api[method](payload));
    assert.equal(calls.length, before + 2, `${method} runs again only for a new call`);
  }
});

test("preload exposes the narrow QoderWork handoff integration", async () => {
  const calls = [];
  const { integrations } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({
      status: "copied",
      copied: true,
      opened: false,
      pasted: false,
      reason: null,
    });
  });

  assert.deepEqual(
    await integrations.handoffToQoderWork({ message: "handoff" }),
    {
      status: "copied",
      copied: true,
      opened: false,
      pasted: false,
      reason: null,
    },
  );
  assert.deepEqual(calls[0], [
    "html-integrations:qoder-handoff",
    { message: "handoff" },
  ]);
  assert.deepEqual(
    await integrations.openAgentLogin({ providerId: "qoder" }),
    {
      status: "copied",
      copied: true,
      opened: false,
      pasted: false,
      reason: null,
    },
  );
  assert.equal(calls[1][0], "html-agent-access:open-login");
  assert.equal(calls[1][1].providerId, "qoder");
  await assert.rejects(
    () => integrations.openAgentLogin({ providerId: "pageroot" }),
    /官方登录入口无效/u,
  );
});

test("preload opens only allowlisted vendor Key pages and never reads stored secrets", async () => {
  const calls = [];
  const { integrations } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ opened: true, ok: true, remembered: false });
  });
  assert.deepEqual(
    await integrations.openVendorApiKeyPage("deepseek"),
    { opened: true, ok: true, remembered: false },
  );
  assert.equal(calls[0][0], "html-agent-access:open-vendor-key");
  assert.equal(calls[0][1].vendorId, "deepseek");
  let unsupportedVendorError = null;
  try {
    integrations.openVendorApiKeyPage("custom");
  } catch (error) {
    unsupportedVendorError = error;
  }
  assert.match(String(unsupportedVendorError?.message || ""), /API Key 页面/u);
  assert.equal(unsupportedVendorError?.code, "AGENT_VENDOR_KEY_UNSUPPORTED");
  await integrations.persistSessionCredential({
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(calls[1][0], "html-agent-access:persist-credential");
  assert.equal(calls[1][1].vendorId, "deepseek");
  assert.equal(calls[1][1].apiKey, "sk-secret");
  await integrations.restoreSessionCredential();
  assert.equal(calls[2][0], "html-agent-access:restore-credential");
  await integrations.clearSessionCredential();
  assert.equal(calls[3][0], "html-agent-access:clear-credential");
});

test("preload exposes update status, restart installation, and the fixed release fallback", async () => {
  const calls = [];
  const { updates } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ status: "current", currentVersion: "0.7.4" });
  });

  assert.deepEqual(
    await updates.getStatus(),
    { status: "current", currentVersion: "0.7.4" },
  );
  assert.deepEqual(calls[0], ["html-updates:get-status"]);

  const unsubscribe = updates.onStatus(() => {});
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();

  await updates.checkNow();
  assert.deepEqual(calls[1], ["html-updates:check-now"]);

  await updates.downloadAvailable();
  assert.deepEqual(calls[2], ["html-updates:download-available"]);

  await updates.installDownloaded();
  assert.deepEqual(calls[3], ["html-updates:install-downloaded"]);

  await updates.openLatestRelease();
  assert.deepEqual(calls[4], ["html-updates:open-latest-release"]);

  await updates.openRepository();
  assert.deepEqual(calls[5], ["html-updates:open-repository"]);
  assert.deepEqual(Object.keys(updates).sort(), [
    "checkNow",
    "downloadAvailable",
    "getStatus",
    "installDownloaded",
    "onStatus",
    "openLatestRelease",
    "openRepository",
  ]);
});

test("preload exposes a clean product error without IPC implementation details", async () => {
  const api = await loadPreload(async () => ({
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: false,
    error: {
      code: "PERMISSION_DENIED",
      message: "没有访问该位置的权限，请选择其他位置。",
      details: { operationId: "operation_0001", reason: "destination" },
    },
  }));

  await assert.rejects(
    api.exportHtmlCopy({ html: "<html></html>" }),
    (error) => {
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, "没有访问该位置的权限，请选择其他位置。");
      assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
        operationId: "operation_0001",
        reason: "destination",
      });
      assert.equal("stack" in error, false);
      assert.equal("channel" in error, false);
      assert.doesNotMatch(
        error.message,
        /Error invoking remote method|html-projects:|ProjectFileError|stack/i,
      );
      return true;
    },
  );
});

test("preload preserves only a validated public reclassification confirmation", async () => {
  const api = await loadPreload(async () => ({
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: false,
    error: {
      code: "OPEN_INTENT_RECLASSIFIED",
      message: "这个文件之前已经导入过了，请确认后打开之前的项目。",
      details: {
        confirmation: {
          openKind: "confirmation",
          requestId: "req_reclassified",
          classification: "known-external",
          sourceFileName: "产品首页.html",
          visibleV1FileName: "产品首页.html",
          projectsRootLabel: "HTML编辑器",
          projectName: "产品首页",
          currentBasedOnVersionId: null,
          currentBasedOnOrdinal: 0,
          latestOfficialVersionId: null,
          latestOfficialOrdinal: 0,
          currentDiffersFromBase: false,
          sourceRelation: "unchanged",
          sourcePath: "/private/secret.html",
          nested: { secret: "do-not-forward" },
        },
        safeReason: "reclassified",
        unknownNested: { channel: "html-projects:open" },
      },
    },
  }));

  await assert.rejects(
    api.openHtml(),
    (error) => {
      assert.equal(error.code, "OPEN_INTENT_RECLASSIFIED");
      assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
        confirmation: {
          openKind: "confirmation",
          requestId: "req_reclassified",
          classification: "known-external",
          sourceFileName: "产品首页.html",
          projectName: "产品首页",
          currentBasedOnVersionId: null,
          currentBasedOnOrdinal: 0,
          latestOfficialVersionId: null,
          latestOfficialOrdinal: 0,
          currentDiffersFromBase: false,
          sourceRelation: "unchanged",
        },
        safeReason: "reclassified",
      });
      assert.doesNotMatch(JSON.stringify(error), /secret|channel|html-projects|sourcePath/u);
      return true;
    },
  );

  const forgedCodeApi = await loadPreload(async () => ({
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: false,
    error: {
      code: "PERMISSION_DENIED",
      message: "拒绝访问。",
      details: {
        confirmation: {
          openKind: "confirmation",
          requestId: "req_reclassified",
          classification: "known-external",
          sourceFileName: "产品首页.html",
          visibleV1FileName: "产品首页.html",
          projectsRootLabel: "HTML编辑器",
          projectName: "产品首页",
          currentBasedOnVersionId: null,
          currentBasedOnOrdinal: 0,
          latestOfficialVersionId: null,
          latestOfficialOrdinal: 0,
          currentDiffersFromBase: false,
          sourceRelation: "unchanged",
        },
      },
    },
  }));
  await assert.rejects(
    forgedCodeApi.openHtml(),
    (error) => {
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.details, undefined);
      return true;
    },
  );
});

test("preload redacts raw Electron IPC rejections and malformed responses", async () => {
  const rejectedApi = await loadPreload(async () => {
    throw new Error(
      "Error invoking remote method 'html-projects:export-copy': ProjectFileError: secret",
    );
  });
  await assert.rejects(
    rejectedApi.exportHtmlCopy({ html: "<html></html>" }),
    (error) => {
      assert.equal(error.code, "PROJECT_SERVICE_UNAVAILABLE");
      assert.equal(error.message, "本地文件服务暂时不可用，请重试。");
      assert.doesNotMatch(
        error.message,
        /remote method|html-projects:|ProjectFileError|secret/i,
      );
      return true;
    },
  );

  const malformedApi = await loadPreload(async () => ({
    ok: false,
    error: { message: "internal class and stack" },
  }));
  await assert.rejects(
    malformedApi.openHtml(),
    (error) => {
      assert.equal(error.code, "INVALID_PROJECT_RESPONSE");
      assert.equal(error.message, "本地文件服务返回了无效结果，请重试。");
      assert.doesNotMatch(error.message, /internal|class|stack/i);
      return true;
    },
  );
});


test("document AI choices cross preload without poisoning subsequent preference saves", async () => {
  const calls = [];
  const { uiPreferences } = await loadPreloadApis(async (...args) => { calls.push(args); return success({}); });
  const documentId = "doc_" + "a".repeat(32);
  await uiPreferences.record({ workspace: { documentAgentSelections: { [documentId]: "codex" }, defaultAgentProviderId: "codex" } });
  await uiPreferences.record({ workspace: { sidebarWidth: 280 } });
  assert.equal(calls.length, 2);
  for (const choices of [{ invalid: "codex" }, { [documentId]: "other" }, Array(129).fill("codex")]) {
    await assert.rejects(uiPreferences.record({ workspace: { documentAgentSelections: choices } }));
  }
  assert.equal(calls.length, 2);
});
