// Sandboxed Electron preload scripts intentionally use Electron's limited
// CommonJS `require` polyfill, even when the file has a .mjs extension.
/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  getActiveProject: "html-projects:get-active",
  openHtml: "html-projects:open",
  readHtml: "html-projects:read",
  exportHtmlCopy: "html-projects:export-copy",
  showInFolder: "html-projects:show-in-folder",
  openProjectsRoot: "html-projects:open-projects-root",
  openInDefaultBrowser: "html-projects:open-in-default-browser",
  renameHtml: "html-projects:rename",
  activateGeneratedVersion: "html-projects:activate-generated-version",
  activateManagedWorkingCopy: "html-projects:activate-managed-working-copy",
  reconcileActiveManagedSource: "html-projects:reconcile-active-managed-source",
  sourceFileMayHaveChanged: "html-projects:source-file-may-have-changed",
  revealVersionFile: "html-projects:reveal-version-file",
  revealAiTask: "html-projects:reveal-ai-task",
  listRecentProjects: "html-projects:list-recent",
  listRegisteredProjects: "html-projects:list-registered",
  restoreRegisteredWorkingCopy: "html-projects:restore-working-copy",
  listRegisteredProjectVersionSummaries: "html-projects:list-registered-version-summaries",
  readRegisteredProjectProjection: "html-projects:read-registered-projection",
  openRegisteredProject: "html-projects:open-registered",
  openRecent: "html-projects:open-recent",
  forgetRecent: "html-projects:forget-recent",
  acceptExternalOpen: "html-projects:accept-external-open",
  acknowledgeExternalOpen: "html-projects:ack-external-open",
  commitPreparedHtmlOpen: "html-projects:commit-prepared-open",
  cancelPreparedHtmlOpen: "html-projects:cancel-prepared-open",
  finalizePreparedHtmlOpen: "html-projects:finalize-prepared-open",
  rollbackPreparedHtmlOpen: "html-projects:rollback-prepared-open",
  commitRecoveryJournal: "html-projects:commit-recovery-journal",
  readRecoveryJournal: "html-projects:read-recovery-journal",
  rebaseRecoveryJournal: "html-projects:rebase-recovery-journal",
  removeRecoveryJournal: "html-projects:remove-recovery-journal",
  listRecoveryJournals: "html-projects:list-recovery-journals",
});
const appChannels = Object.freeze({
  prepareClose: "html-app:prepare-close",
  closeResult: "html-app:close-result",
  closeAborted: "html-app:close-aborted",
  aboutRequested: "html-app:about-requested",
  workspaceUnavailable: "html-app:workspace-unavailable",
  workspaceRecoveryReady: "html-app:workspace-recovery-ready",
  externalOpenRequested: "html-app:external-open-requested",
  externalOpenReady: "html-app:external-open-ready",
  externalOpenFailed: "html-app:external-open-failed",
  externalOpenFailedReady: "html-app:external-open-failed-ready",
  bridgeReady: "html-app:bridge-ready",
  relaunch: "html-app:relaunch",
  openUserNotice: "html-app:open-user-notice",
});
const integrationChannels = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
  openAgentLogin: "html-agent-access:open-login",
  openVendorApiKey: "html-agent-access:open-vendor-key",
  persistSessionCredential: "html-agent-access:persist-credential",
  clearSessionCredential: "html-agent-access:clear-credential",
  sessionCredentialStatus: "html-agent-access:credential-status",
  restoreSessionCredential: "html-agent-access:restore-credential",
});
const updateChannels = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  downloadAvailable: "html-updates:download-available",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});
const usageChannels = Object.freeze({
  capture: "html-usage:capture",
});
const uiPreferenceChannels = Object.freeze({
  get: "html-ui-preferences:get",
  record: "html-ui-preferences:record",
});
const workbenchTabChannels = Object.freeze({
  get: "html-workbench-tabs:get",
  set: "html-workbench-tabs:set",
});
const previewChannels = Object.freeze({
  createSession: "html-preview:create-session",
  revokeSession: "html-preview:revoke-session",
});
const editRuntimeChannels = Object.freeze({
  prepare: "html-edit-runtime:prepare",
  revoke: "html-edit-runtime:revoke",
});
const editChannels = Object.freeze({
  historyRequested: "html-edit:history-requested",
  nativeHistory: "html-edit:native-history",
});
const PROJECT_IPC_PROTOCOL = "html-ai-project-result";
const PROJECT_IPC_VERSION = 1;
let bridgeConnectionWait = null;

function projectOperationError(payload) {
  const message = typeof payload?.message === "string" && payload.message.trim()
    ? payload.message.trim()
    : "本地文件操作没有完成，请重试。";
  const error = new Error(message);
  Object.defineProperty(error, "code", {
    value: typeof payload?.code === "string" ? payload.code : "PROJECT_SERVICE_ERROR",
    enumerable: true,
  });
  if (payload?.details && typeof payload.details === "object") {
    Object.defineProperty(error, "details", {
      value: Object.freeze({ ...payload.details }),
      enumerable: true,
    });
  }
  return error;
}

async function invokeProject(channel, ...args) {
  if (bridgeConnectionWait) await bridgeConnectionWait;
  let result;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch {
    throw projectOperationError({
      code: "PROJECT_SERVICE_UNAVAILABLE",
      message: "本地文件服务暂时不可用，请重试。",
    });
  }

  if (
    !result
    || typeof result !== "object"
    || result.protocol !== PROJECT_IPC_PROTOCOL
    || result.version !== PROJECT_IPC_VERSION
    || typeof result.ok !== "boolean"
  ) {
    throw projectOperationError({
      code: "INVALID_PROJECT_RESPONSE",
      message: "本地文件服务返回了无效结果，请重试。",
    });
  }
  if (!result.ok) throw projectOperationError(result.error);
  return result.value;
}

const projectsApi = Object.freeze({
  getActiveProject: () => invokeProject(channels.getActiveProject),
  openHtml: () => invokeProject(channels.openHtml),
  readHtml: (sourcePath) => invokeProject(channels.readHtml, sourcePath),
  exportHtmlCopy: (payload) => invokeProject(channels.exportHtmlCopy, payload),
  showInFolder: (sourcePath) => invokeProject(channels.showInFolder, sourcePath),
  openProjectsRoot: () => invokeProject(channels.openProjectsRoot),
  openInDefaultBrowser: (sourcePath) => invokeProject(
    channels.openInDefaultBrowser,
    sourcePath,
  ),
  renameHtml: (payload) => invokeProject(channels.renameHtml, payload),
  activateGeneratedVersion: (payload) => invokeProject(
    channels.activateGeneratedVersion,
    payload,
  ),
  activateManagedWorkingCopy: (payload) => invokeProject(
    channels.activateManagedWorkingCopy,
    payload,
  ),
  reconcileActiveManagedSource: (payload) => invokeProject(
    channels.reconcileActiveManagedSource,
    payload,
  ),
  revealVersionFile: (payload) => invokeProject(channels.revealVersionFile, payload),
  revealAiTask: (payload) => invokeProject(channels.revealAiTask, payload),
  listRecentProjects: () => invokeProject(channels.listRecentProjects),
  listRegisteredProjects: () => invokeProject(channels.listRegisteredProjects),
  restoreRegisteredWorkingCopy: (projectId) => invokeProject(channels.restoreRegisteredWorkingCopy, projectId),
  listRegisteredProjectVersionSummaries: (projectId) => invokeProject(
    channels.listRegisteredProjectVersionSummaries,
    projectId,
  ),
  readRegisteredProjectProjection: (projectId) => invokeProject(
    channels.readRegisteredProjectProjection,
    projectId,
  ),
  openRegisteredProject: (projectId) => invokeProject(
    channels.openRegisteredProject,
    projectId,
  ),
  openRecent: (sourcePath) => invokeProject(channels.openRecent, sourcePath),
  forgetRecent: (sourcePath) => invokeProject(channels.forgetRecent, sourcePath),
  acceptExternalOpen: (requestId) => invokeProject(
    channels.acceptExternalOpen,
    { requestId },
  ),
  acknowledgeExternalOpen: (requestId) => invokeProject(
    channels.acknowledgeExternalOpen,
    { requestId },
  ),
  commitPreparedHtmlOpen: (payload) => invokeProject(
    channels.commitPreparedHtmlOpen,
    {
      requestId: payload?.requestId,
      action: payload?.action,
      ...(payload?.deleteOriginal === true ? { deleteOriginal: true } : {}),
    },
  ),
  cancelPreparedHtmlOpen: (requestId) => invokeProject(
    channels.cancelPreparedHtmlOpen,
    { requestId },
  ),
  finalizePreparedHtmlOpen: (requestId) => invokeProject(
    channels.finalizePreparedHtmlOpen,
    { requestId },
  ),
  rollbackPreparedHtmlOpen: (requestId) => invokeProject(
    channels.rollbackPreparedHtmlOpen,
    { requestId },
  ),
  commitRecoveryJournal: (payload) => invokeProject(
    channels.commitRecoveryJournal,
    payload,
  ),
  readRecoveryJournal: (payload) => invokeProject(
    channels.readRecoveryJournal,
    payload,
  ),
  rebaseRecoveryJournal: (payload) => invokeProject(
    channels.rebaseRecoveryJournal,
    payload,
  ),
  removeRecoveryJournal: (payload) => invokeProject(
    channels.removeRecoveryJournal,
    payload,
  ),
  listRecoveryJournals: (payload) => payload
    ? invokeProject(channels.listRecoveryJournals, payload)
    : invokeProject(channels.listRecoveryJournals),
  onSourceFileChanged: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onSourceFileChanged listener must be a function.");
    }
    const wrapped = (_event, payload) => {
      const sourcePath = typeof payload?.sourcePath === "string"
        ? payload.sourcePath.trim()
        : "";
      if (!sourcePath) return;
      const next = {
        sourcePath,
        watcherGeneration: Number(payload?.watcherGeneration || 0),
      };
      if (payload?.sourceMissing === true || payload?.sourceMissing === false) {
        next.sourceMissing = payload.sourceMissing;
      }
      listener(next);
    };
    ipcRenderer.on(channels.sourceFileMayHaveChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.sourceFileMayHaveChanged, wrapped);
    };
  },
});
const integrationsApi = Object.freeze({
  handoffToQoderWork: (payload) => invokeProject(
    integrationChannels.qoderHandoff,
    payload,
  ),
  openAgentLogin: (payload) => {
    const providerId = String(payload?.providerId || "").trim();
    if (providerId !== "qoder" && providerId !== "codex") {
      return Promise.reject(new TypeError("官方登录入口无效。"));
    }
    return invokeProject(integrationChannels.openAgentLogin, { providerId });
  },
  openVendorApiKeyPage: (vendorId) => {
    const id = String(vendorId || "").trim();
    if (!["deepseek", "zhipu", "dashscope", "openai"].includes(id)) {
      throw projectOperationError({
        code: "AGENT_VENDOR_KEY_UNSUPPORTED",
        message: "当前服务没有经过校验的 API Key 页面。",
      });
    }
    return invokeProject(integrationChannels.openVendorApiKey, { vendorId: id });
  },
  persistSessionCredential: (payload) => invokeProject(
    integrationChannels.persistSessionCredential,
    {
      vendorId: String(payload?.vendorId || "").trim(),
      baseUrl: String(payload?.baseUrl || "").trim(),
      apiKey: String(payload?.apiKey || ""),
    },
  ),
  clearSessionCredential: () => invokeProject(integrationChannels.clearSessionCredential),
  sessionCredentialStatus: () => invokeProject(integrationChannels.sessionCredentialStatus),
  restoreSessionCredential: () => invokeProject(integrationChannels.restoreSessionCredential),
});
const updateStatusListeners = new Map();
const updatesApi = Object.freeze({
  getStatus: () => invokeProject(updateChannels.getStatus),
  checkNow: () => invokeProject(updateChannels.checkNow),
  downloadAvailable: () => invokeProject(updateChannels.downloadAvailable),
  onStatus: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onStatus listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(
      payload && typeof payload === "object"
        ? Object.freeze({ ...payload })
        : null,
    );
    updateStatusListeners.set(listener, wrapped);
    ipcRenderer.on(updateChannels.status, wrapped);
    return () => {
      const registered = updateStatusListeners.get(listener);
      if (!registered) return;
      updateStatusListeners.delete(listener);
      ipcRenderer.removeListener(updateChannels.status, registered);
    };
  },
  installDownloaded: () => invokeProject(updateChannels.installDownloaded),
  openLatestRelease: () => invokeProject(updateChannels.openLatestRelease),
  openRepository: () => invokeProject(updateChannels.openRepository),
});

const query = new URLSearchParams(globalThis.location.search);
const bridgePort = query.get("bridgePort") || "";
const bridgeAuthToken = query.get("bridgeAuthToken") || "";
const appVersion = query.get("appVersion") || "";
let releaseBridgeConnectionWait = null;
if (query.get("bridgeDeferred") === "1" && !bridgePort) {
  bridgeConnectionWait = new Promise((resolve) => {
    releaseBridgeConnectionWait = resolve;
  });
}
function startupTimingFromValue(value) {
  try {
    const parsed = typeof value === "string"
      ? JSON.parse(String(value || "null"))
      : value;
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.schemaVersion !== 1
      || !Array.isArray(parsed.marks)
    ) return null;
    const marks = parsed.marks.slice(0, 32).flatMap((entry) => {
      if (
        !entry
        || typeof entry !== "object"
        || !/^[a-z][a-z0-9-]{0,63}$/u.test(String(entry.stage || ""))
        || !Number.isFinite(Number(entry.atUnixMs))
      ) return [];
      return [Object.freeze({
        stage: String(entry.stage),
        atUnixMs: Number(entry.atUnixMs),
      })];
    });
    return Object.freeze({
      schemaVersion: 1,
      timeOriginUnixMs: Number.isFinite(Number(parsed.timeOriginUnixMs))
        ? Number(parsed.timeOriginUnixMs)
        : 0,
      marks: Object.freeze(marks),
    });
  } catch {
    return null;
  }
}
let startupTiming = startupTimingFromValue(query.get("startupTiming"));
function bridgeConnectionFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const port = String(value.bridgePort || "");
  const token = String(value.bridgeAuthToken || "");
  const version = String(value.appVersion || appVersion || "");
  if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) return null;
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) return null;
  return Object.freeze({ bridgePort: port, bridgeAuthToken: token, appVersion: version });
}
let bridgeConnection = bridgeConnectionFrom({ bridgePort, bridgeAuthToken, appVersion });
const bridgeReadyListeners = new Set();
ipcRenderer.on(appChannels.bridgeReady, (_event, payload) => {
  const next = bridgeConnectionFrom(payload);
  if (!next) return;
  bridgeConnection = next;
  startupTiming = startupTimingFromValue(payload?.startupTiming) || startupTiming;
  releaseBridgeConnectionWait?.();
  releaseBridgeConnectionWait = null;
  bridgeConnectionWait = null;
  for (const listener of bridgeReadyListeners) listener(next);
});
const desktopRuntimeCapabilities = Object.freeze({
  sourceEditing: "enabled",
  projectOpening: "desktop-dialog",
  attachmentPersistence: "bridge",
  closeCoordination: "electron-handshake",
  interactivePreview: "independent-url",
});
const e2eStaticCandidateFailure = typeof process !== "undefined"
  && process.env?.PAGEROOT_E2E === "1"
  && process.env?.PAGEROOT_E2E_STATIC_CANDIDATE_FAILURE === "1";
const e2eRuntimeCommitHooks = typeof process !== "undefined"
  && process.env?.PAGEROOT_E2E === "1"
  && process.env?.PAGEROOT_E2E_RUNTIME_COMMIT_HOOKS === "1";
const e2eCanvasCapabilityProbe = typeof process !== "undefined"
  && process.env?.PAGEROOT_E2E === "1";
const runtimeConfig = Object.freeze({
  bridgePort,
  bridgeAuthToken,
  appVersion,
  betaAgentModelsEnabled: typeof process !== "undefined"
    && (process.env?.PAGEROOT_ENABLE_BETA_AGENT_MODELS === "1"
      || process.env?.PAGEROOT_E2E === "1"),
  getBridgeConnection: () => bridgeConnection,
  onBridgeReady: (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function.");
    bridgeReadyListeners.add(listener);
    return () => bridgeReadyListeners.delete(listener);
  },
  getStartupTiming: () => startupTiming,
  capabilities: desktopRuntimeCapabilities,
  diagnostics: Object.freeze({
    startupTiming,
    e2eStaticCandidateFailure,
    e2eRuntimeCommitHooks,
    e2eCanvasCapabilityProbe,
  }),
});

const previewApi = Object.freeze({
  createSession: (payload) => invokeProject(previewChannels.createSession, payload),
  revokeSession: (sessionId) => invokeProject(
    previewChannels.revokeSession,
    sessionId,
  ),
});

const editRuntimeApi = Object.freeze({
  prepare: (payload) => invokeProject(editRuntimeChannels.prepare, payload),
  revoke: (sessionId) => invokeProject(editRuntimeChannels.revoke, sessionId),
});

const closeListeners = new Map();
const closeAbortListeners = new Map();
const aboutRequestListeners = new Map();
const workspaceUnavailableListeners = new Map();
const externalOpenListeners = new Map();
const externalOpenFailedListeners = new Map();
function normalizedWorkspaceIssue(payload) {
  return Object.freeze({
    title: typeof payload?.title === "string"
      ? payload.title
      : "本地项目资料暂时不可用",
    message: typeof payload?.message === "string"
      ? payload.message
      : "当前页面内容仍保留，可以先导出当前 HTML，再重新打开源页。",
  });
}
function normalizedExternalOpenRequest(payload) {
  if (
    !payload
    || typeof payload.requestId !== "string"
    || !payload.requestId
  ) return null;
  return Object.freeze({
    requestId: payload.requestId,
  });
}
const appLifecycleApi = Object.freeze({
  onAboutRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onAboutRequested listener must be a function.");
    }
    const wrapped = () => listener();
    aboutRequestListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.aboutRequested, wrapped);
    return () => {
      const registered = aboutRequestListeners.get(listener);
      if (!registered) return;
      aboutRequestListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.aboutRequested, registered);
    };
  },
  onPrepareClose: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onPrepareClose listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(Object.freeze({
      requestId: payload?.requestId,
      reason: payload?.reason,
      deadlineAt: payload?.deadlineAt,
    }));
    closeListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.prepareClose, wrapped);
    return () => {
      const registered = closeListeners.get(listener);
      if (!registered) return;
      closeListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.prepareClose, registered);
    };
  },
  onCloseAborted: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onCloseAborted listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(Object.freeze({
      requestId: payload?.requestId,
      reason: payload?.reason,
    }));
    closeAbortListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.closeAborted, wrapped);
    return () => {
      const registered = closeAbortListeners.get(listener);
      if (!registered) return;
      closeAbortListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.closeAborted, registered);
    };
  },
  reportReady: (requestId) => ipcRenderer.invoke(appChannels.closeResult, {
    requestId,
    ready: true,
  }),
  reportBlocked: (requestId, reason, presentation = "in-app", retry = false) => ipcRenderer.invoke(appChannels.closeResult, {
    requestId,
    ready: false,
    reason,
    presentation,
    ...(retry === true ? { retry: true } : {}),
  }),
  onWorkspaceUnavailable: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onWorkspaceUnavailable listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(
      normalizedWorkspaceIssue(payload),
    );
    workspaceUnavailableListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.workspaceUnavailable, wrapped);
    void ipcRenderer.invoke(appChannels.workspaceRecoveryReady)
      .then((payload) => {
        if (
          workspaceUnavailableListeners.get(listener) === wrapped
          && payload?.issue
        ) {
          wrapped(null, payload.issue);
        }
      })
      .catch(() => {});
    return () => {
      const registered = workspaceUnavailableListeners.get(listener);
      if (!registered) return;
      workspaceUnavailableListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.workspaceUnavailable, registered);
    };
  },
  onExternalOpenRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onExternalOpenRequested listener must be a function.");
    }
    let liveDeliveryGeneration = 0;
    const wrapped = (_event, payload) => {
      const request = normalizedExternalOpenRequest(payload);
      if (!request) return;
      liveDeliveryGeneration += 1;
      listener(request);
    };
    externalOpenListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.externalOpenRequested, wrapped);
    const catchUpGeneration = liveDeliveryGeneration;
    void ipcRenderer.invoke(appChannels.externalOpenReady)
      .then((payload) => {
        if (
          externalOpenListeners.get(listener) !== wrapped
          || !payload
          // A live IPC delivery is newer than the asynchronous readiness
          // snapshot. Never let that stale catch-up response replace the
          // currently pending mailbox request in the renderer session.
          || liveDeliveryGeneration !== catchUpGeneration
        ) return;
        const request = normalizedExternalOpenRequest(payload);
        if (request) listener(request);
      })
      .catch(() => {});
    return () => {
      const registered = externalOpenListeners.get(listener);
      if (!registered) return;
      externalOpenListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.externalOpenRequested, registered);
    };
  },
  getInitialExternalOpen: async () => {
    const payload = await ipcRenderer.invoke(appChannels.externalOpenReady);
    return normalizedExternalOpenRequest(payload);
  },
  onExternalOpenFailed: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onExternalOpenFailed listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(Object.freeze({
      title: typeof payload?.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : "无法打开这个 HTML",
      message: typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
    }));
    externalOpenFailedListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.externalOpenFailed, wrapped);
    void ipcRenderer.invoke(appChannels.externalOpenFailedReady)
      .then((payload) => {
        if (externalOpenFailedListeners.get(listener) !== wrapped || !payload) return;
        wrapped(null, payload);
      })
      .catch(() => {});
    return () => {
      const registered = externalOpenFailedListeners.get(listener);
      if (!registered) return;
      externalOpenFailedListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.externalOpenFailed, registered);
    };
  },
  relaunch: () => ipcRenderer.invoke(appChannels.relaunch),
  openUserNotice: () => invokeProject(appChannels.openUserNotice),
});

const usageApi = Object.freeze({
  capture: (event, properties = {}, projectId) => {
    if (
      typeof event !== "string"
      || event.length > 80
      || !properties
      || typeof properties !== "object"
      || Array.isArray(properties)
      || Object.keys(properties).length > 12
      || Object.values(properties).some((value) => (
        value !== null
        && value !== undefined
        && typeof value !== "string"
        && typeof value !== "number"
        && typeof value !== "boolean"
      ))
      || (
        projectId !== undefined
        && (
          typeof projectId !== "string"
          || !/^project_[A-Za-z0-9_-]{1,180}$/.test(projectId)
        )
      )
    ) return;
    ipcRenderer.send(usageChannels.capture, {
      event,
      properties: { ...properties },
      ...(projectId ? { projectId } : {}),
    });
  },
});

const workspacePreferenceKeys = new Set([
  "rememberPanelWidths",
  "sidebarWidth",
  "inspectorWidth",
  "motion",
  "restoreTabsOnLaunch",
  "reviewChangeContextVisibility",
  "reviewCommentContextVisibility",
  "defaultAgentProviderId",
  "agentConfigurations",
  "documentAgentSelections",
  "disabledAgentProviderIds",
]);

function validWorkspacePreferencePatch(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Object.keys(value).length
    || Object.keys(value).some((key) => !workspacePreferenceKeys.has(key))
  ) return false;
  return Object.entries(value).every(([key, next]) => {
    if (key === "documentAgentSelections") {
      return next && typeof next === "object" && !Array.isArray(next)
        && Object.keys(next).length <= 128
        && Object.entries(next).every(([id, provider]) => (
          /^doc_[a-f0-9]{16,64}$/u.test(id) && ["pageroot", "qoder", "codex"].includes(provider)
        ));
    }
    if (key === "agentConfigurations") {
      return next && typeof next === "object" && !Array.isArray(next)
        && Object.entries(next).every(([id, entry]) => ["pageroot", "qoder", "codex"].includes(id)
          && entry && typeof entry === "object" && !Array.isArray(entry)
          && Object.keys(entry).every((name) => name === "modelId" || name === "reasoning")
          && (entry.modelId === null || (typeof entry.modelId === "string"
            && entry.modelId.length <= 160 && entry.modelId.startsWith(`${id}:`)
            && /^[A-Za-z0-9._/:+-]+$/u.test(entry.modelId)))
          && (entry.reasoning === null || (typeof entry.reasoning === "string"
            && /^[A-Za-z0-9_-]{1,40}$/u.test(entry.reasoning))));
    }
    if (key === "rememberPanelWidths" || key === "restoreTabsOnLaunch") {
      return typeof next === "boolean";
    }
    if (key === "motion") return next === "system" || next === "reduced";
    if (key === "defaultAgentProviderId") {
      return next === "pageroot" || next === "qoder" || next === "codex";
    }
    if (key === "disabledAgentProviderIds") {
      return Array.isArray(next) && next.every((id) => (
        id === "pageroot" || id === "qoder" || id === "codex"
      ));
    }
    if (key === "sidebarWidth") {
      return typeof next === "number" && Number.isFinite(next) && next >= 200 && next <= 420;
    }
    if (key === "inspectorWidth") {
      return typeof next === "number" && Number.isFinite(next) && next >= 280 && next <= 520;
    }
    if (key === "reviewChangeContextVisibility" || key === "reviewCommentContextVisibility") {
      return typeof next === "number" && Number.isFinite(next) && next >= 0 && next <= 100;
    }
    return false;
  });
}

const uiPreferencesApi = Object.freeze({
  get: () => invokeProject(uiPreferenceChannels.get),
  record: (payload) => {
    if (validWorkspacePreferencePatch(payload?.workspace)) {
      return invokeProject(uiPreferenceChannels.record, {
        workspace: { ...payload.workspace },
      });
    }
    return Promise.reject(new TypeError("工作台偏好记录无效。"));
  },
});
const workbenchTabsApi = Object.freeze({
  get: () => invokeProject(workbenchTabChannels.get),
  set: (state) => invokeProject(workbenchTabChannels.set, state),
});
const historyRequestListeners = new Map();
const editApi = Object.freeze({
  onHistoryRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onHistoryRequested listener must be a function.");
    }
    const wrapped = (_event, payload) => {
      const direction = payload?.direction;
      if (direction === "undo" || direction === "redo") listener(direction);
    };
    historyRequestListeners.set(listener, wrapped);
    ipcRenderer.on(editChannels.historyRequested, wrapped);
    return () => {
      const registered = historyRequestListeners.get(listener);
      if (!registered) return;
      historyRequestListeners.delete(listener);
      ipcRenderer.removeListener(editChannels.historyRequested, registered);
    };
  },
  runNativeHistory: (direction) => {
    if (direction !== "undo" && direction !== "redo") {
      throw new TypeError("direction must be undo or redo.");
    }
    return ipcRenderer.invoke(editChannels.nativeHistory, direction);
  },
});

contextBridge.exposeInMainWorld("htmlAIProjects", projectsApi);
contextBridge.exposeInMainWorld("htmlAIIntegrations", integrationsApi);
contextBridge.exposeInMainWorld("htmlAIUpdates", updatesApi);
contextBridge.exposeInMainWorld("htmlAIPreview", previewApi);
contextBridge.exposeInMainWorld("htmlAIEditRuntime", editRuntimeApi);
contextBridge.exposeInMainWorld("htmlAIRuntime", runtimeConfig);
contextBridge.exposeInMainWorld("htmlAIAppLifecycle", appLifecycleApi);
contextBridge.exposeInMainWorld("htmlAIUsage", usageApi);
contextBridge.exposeInMainWorld("htmlAIUiPreferences", uiPreferencesApi);
contextBridge.exposeInMainWorld("htmlAIWorkbenchTabs", workbenchTabsApi);
contextBridge.exposeInMainWorld("htmlAIEdit", editApi);
