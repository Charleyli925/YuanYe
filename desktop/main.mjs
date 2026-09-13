import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectFileError,
  ensureManagedWelcomeHtml,
  managedWelcomeSourcePath,
  readHtmlFile,
  writeHtmlCopy,
} from "./project-files.mjs";
import { WELCOME_LOGO_RELATIVE_PATH } from "./welcome-project-content.mjs";
import {
  createSafeExportDefaultPath,
  isProtectedExportDestination,
  normalizeHtmlExportPath,
  selectExportDestination,
} from "./export-copy.mjs";
import {
  createWorkspaceRecoveryMailbox,
  stopBridgeProcessGracefully,
} from "./bridge-shutdown.mjs";
import {
  BridgeExitedBeforeReadyError,
  waitForBridgeReady,
} from "./bridge-startup.mjs";
import { createOpenInDefaultBrowserOperation } from "./open-in-default-browser.mjs";
import { publicAgentLoginUrl } from "./agent-login-url.mjs";
import {
  createExternalFileOpenDeliveryCoordinator,
  createExternalFileOpenExitHandoff,
  createExternalFileOpenMailbox,
  createExternalOpenFailureMailbox,
  externalOpenFailurePresentation,
  externalHtmlPathsFromArgv,
} from "./external-file-open.mjs";
import {
  readWorkbenchTabsState,
  writeWorkbenchTabsState,
} from "./workbench-tabs-state.mjs";
import {
  assertCommitAction,
  assertExactPayload,
  createPreparedHtmlOpenStore,
  formatProjectsRootLabel,
  publicExternalOpenRequest,
  publicFactsFromClassification,
  resolveOpenDialogDefaultPath,
} from "./prepared-html-open.mjs";
import { createProjectOpenQueue } from "./project-open-queue.mjs";
import { createTrustedIpc } from "./ipc/trusted-ipc.mjs";
import {
  registerProjectIpc as registerProjectIpcChannels,
  unregisterProjectIpc,
} from "./ipc/project-ipc.mjs";
import { registerAgentIpc, unregisterAgentIpc } from "./ipc/agent-ipc.mjs";
import { publicAgentVendorKeyUrl } from "../shared/agent-vendor-key-url.mjs";
import { createAgentSessionCredentialStore } from "./agent-session-credential-store.mjs";
import {
  assertRuntimeEnvironment,
  createRuntimeEnvironment,
  resolveRuntimeChannel,
} from "./runtime-environment.mjs";
import { registerUpdateIpc, unregisterUpdateIpc } from "./ipc/update-ipc.mjs";
import { registerWindowIpc, unregisterWindowIpc } from "./ipc/window-ipc.mjs";
import { createWindowLifecycle } from "./app-lifecycle.mjs";
import { createRecoveryJournalStore } from "./recovery-journal-store.mjs";
import { createStartupPerformanceTimeline } from "./startup-performance-timeline.mjs";
import {
  closeAbortPayload,
  normalizeCloseResult,
  runGuardedFinalExit,
  shouldRetryCloseBlock,
  stopBridgeOrNotifyCloseAborted,
} from "./close-recovery.mjs";
import {
  PRODUCT_MAX_HTML_BYTES,
  isGeneratedWorkingCopyFileName,
} from "./product-contract.mjs";
import { createSourceFileWatcher } from "./source-file-watch.mjs";
import {
  isActiveProjectIdentity,
  isManagedVersionRelativePath,
} from "./project-path-policy.mjs";
import {
  LATEST_RELEASE_PAGE_URL,
  PROJECT_REPOSITORY_URL,
} from "./product-links.mjs";
import { createApplicationUpdateController } from "./application-update.mjs";
import {
  normalizeCompletedSourceRename,
  normalizePendingSourceRename,
  recoverPendingSourceRename,
  renameHtmlSource,
} from "./source-rename.mjs";
import {
  activeManagedLocatorForActivatedPath,
  normalizeActiveManagedLocator,
  rebaseActiveManagedLocator,
  sameManagedPath,
} from "./active-managed-locator.mjs";
import {
  createTelemetryBuildConfig,
  createUsageTelemetry,
  readTelemetryBuildConfig,
} from "./usage-telemetry.mjs";
import {
  readUiPreferences,
  recordUiWorkspacePreferences,
} from "./ui-preferences.mjs";
import { readOrCreateDeviceIdentity } from "./device-identity.mjs";
import {
  createPreviewProtocolController,
  createPreviewSessionOperation,
  registerPreviewProtocolScheme,
} from "./preview-protocol.mjs";
import {
  createEditRuntimeProtocolController,
  registerEditRuntimeProtocolScheme,
} from "./edit-runtime-protocol.mjs";
import { createEditRuntimeLibraryStore } from "./edit-runtime-library-store.mjs";
import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  editRuntimeProgramIdentity,
  isEditRuntimeRequestId,
} from "../app/domain/edit-runtime-contract.js";
import {
  createEditRuntimePreparationFence,
} from "./edit-runtime-preparation-fence.mjs";
import {
  forgetImportedAssetRootsForPath,
  importedAssetRootForProjectPath,
  isExternalOriginalPath,
  normalizeImportedAssetRoots,
  previewAssetSourcePath,
  rememberImportedAssetRoot,
  resolveLiveImportedAssetSource,
} from "./imported-asset-root.mjs";

// electron-updater is CommonJS; the default import is the supported ESM bridge.
const { autoUpdater } = electronUpdater;
const startupPerformanceTimeline = createStartupPerformanceTimeline();

registerPreviewProtocolScheme(protocol);
registerEditRuntimeProtocolScheme(protocol);

const directory = path.dirname(fileURLToPath(import.meta.url));
const USER_NOTICE_FILE_NAME = "PageRoot 用户声明与免责声明.txt";
const e2eUserDataPath = (() => {
  if (process.env.PAGEROOT_E2E !== "1") return null;
  const candidate = process.env.PAGEROOT_E2E_USER_DATA_DIR;
  if (!candidate) throw new Error("PAGEROOT_E2E_USER_DATA_DIR is required in E2E mode.");
  const resolved = path.resolve(candidate);
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (
    relative === ""
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || !path.basename(resolved).startsWith("pageroot-native-e2e-")
  ) {
    throw new Error("PageRoot E2E userData must be an isolated pageroot-native-e2e-* directory under the system temporary directory.");
  }
  return resolved;
})();
const e2eWindowForeground = Boolean(e2eUserDataPath)
  && process.env.PAGEROOT_E2E_FOREGROUND === "1";
const e2eWindowRunsInBackground = Boolean(e2eUserDataPath)
  && !e2eWindowForeground;
// 前台调试只改变测试窗口的可见性，不应允许自动化测试弹出任何
// macOS 原生对话框并打断用户；所有 E2E 启动方式都记录错误而不弹窗。
const e2eNativeDialogsSuppressed = Boolean(e2eUserDataPath);
const e2eEditRuntimePrepareGate = {
  held: null,
};
if (process.env.PAGEROOT_E2E === "1") {
  globalThis.__pagerootE2eHoldEditRuntimePrepare = () => {
    if (e2eEditRuntimePrepareGate.held) return;
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    e2eEditRuntimePrepareGate.held = { barrier, release };
  };
  globalThis.__pagerootE2eReleaseEditRuntimePrepare = () => {
    e2eEditRuntimePrepareGate.held?.release();
    e2eEditRuntimePrepareGate.held = null;
  };
}
const runtimeChannel = resolveRuntimeChannel({
  environment: process.env.PAGEROOT_E2E === "1"
    ? { ...process.env, PAGEROOT_RUNTIME_CHANNEL: "e2e" }
    : process.env,
  resourcesPath: process.resourcesPath || path.resolve(directory, "..", "resources"),
  defaultApp: process.defaultApp === true,
  // A packaged app must obey the marker embedded by its build. E2E is the
  // sole intentional packaged override so its disposable root cannot touch a
  // signed build's real user data.
  allowEnvironmentOverride: process.env.PAGEROOT_E2E === "1" || process.defaultApp === true,
});
const runtimeEnvironment = assertRuntimeEnvironment(createRuntimeEnvironment({
  channel: runtimeChannel,
  environment: process.env,
  appDataPath: app.getPath("appData"),
  documentsPath: app.getPath("documents"),
  logsBasePath: path.join(app.getPath("appData"), "..", "Logs"),
  e2eUserDataPath,
}));
app.setPath("userData", runtimeEnvironment.userDataPath);
app.setPath("sessionData", runtimeEnvironment.sessionDataPath);
if (typeof app.setAppLogsPath === "function") app.setAppLogsPath(runtimeEnvironment.logsPath);
// Preserve Electron's packaged identity contract: the formal app and a
// packaged Preview launched under E2E must report the executable's product
// name, while source development keeps the localized runtime name.
const applicationName = app.isPackaged
  ? path.basename(process.execPath, path.extname(process.execPath))
  : runtimeEnvironment.applicationName;
app.setName(applicationName);
// 后台 E2E 保留常规激活策略：窗口本身仍不显示、不抢焦点，但 macOS Dock
// 里保留应用图标，开发者可以主动点击图标把窗口调出来查看测试进度，
// 也可以自行最小化或隐藏。测试代码绝不主动把窗口拉到前台。
if (e2eUserDataPath) {
  // Background E2E still needs deterministic timers, visibility state and
  // frame commits. Production launch behavior remains unchanged.
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}

const BRIDGE_STARTUP_SLOW_MS = 12_000;
const RENDERER_CLOSE_TIMEOUT_MS = 30_000;
// This parent deadline must stay strictly beyond AgentBridgeService's 12 s
// cleanup budget. Otherwise the desktop could announce an aborted exit and
// then lose a Bridge that finishes its still-running shutdown moments later.
const BRIDGE_SHUTDOWN_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_RECENT_PROJECTS = 12;
const MAX_ACTIVATION_RECEIPTS = 32;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const PROJECT_STATE_VERSION = 2;
const PROJECT_CHANNELS = Object.freeze({
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
  sourceFileMayHaveChanged: "html-projects:source-file-may-have-changed",
});
const APP_CHANNELS = Object.freeze({
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
const WORKBENCH_TAB_CHANNELS = Object.freeze({
  get: "html-workbench-tabs:get",
  set: "html-workbench-tabs:set",
});
const INTEGRATION_CHANNELS = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
  openAgentLogin: "html-agent-access:open-login",
  openVendorApiKey: "html-agent-access:open-vendor-key",
  persistSessionCredential: "html-agent-access:persist-credential",
  clearSessionCredential: "html-agent-access:clear-credential",
  sessionCredentialStatus: "html-agent-access:credential-status",
  restoreSessionCredential: "html-agent-access:restore-credential",
});
const UPDATE_CHANNELS = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  downloadAvailable: "html-updates:download-available",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});
const USAGE_CHANNELS = Object.freeze({
  capture: "html-usage:capture",
});
const UI_PREFERENCE_CHANNELS = Object.freeze({
  get: "html-ui-preferences:get",
  record: "html-ui-preferences:record",
});
const PREVIEW_CHANNELS = Object.freeze({
  createSession: "html-preview:create-session",
  revokeSession: "html-preview:revoke-session",
});
const EDIT_RUNTIME_CHANNELS = Object.freeze({
  prepare: "html-edit-runtime:prepare",
  revoke: "html-edit-runtime:revoke",
});
const EDIT_CHANNELS = Object.freeze({
  historyRequested: "html-edit:history-requested",
  nativeHistory: "html-edit:native-history",
});

let bridgeProcess = null;
let bridgePort = null;
let bridgeStartupPromise = null;
let deviceIdentityPromise = null;
const bridgeAuthToken = randomBytes(32).toString("base64url");
let mainWindow = null;
let rendererHasLoaded = false;
let rendererLoadQuery = null;
let isQuitting = false;
let finalExitStarted = false;
let closeRequest = null;
let coordinatedExit = null;
let projectIpcRegistered = false;
let projectState = null;
let stateWriteQueue = Promise.resolve();
let workbenchTabsWriteQueue = Promise.resolve();
let latestUpdateResult = null;
let applicationUpdate = null;
let usageTelemetry = null;
let managedWelcomeRegistration = null;
let previewProtocolController = null;
let editRuntimeProtocolController = null;
const editRuntimePreparationFence = createEditRuntimePreparationFence();
const sourceFileWatcher = createSourceFileWatcher({
  debounceMs: 200,
  onChange(info) {
    void recoverWatchedManagedSource(info);
  },
});
const desktopRuntime = {
  get mainWindow() { return mainWindow; },
  set mainWindow(value) { mainWindow = value; },
  get rendererHasLoaded() { return rendererHasLoaded; },
  set rendererHasLoaded(value) { rendererHasLoaded = value; },
  get rendererLoadQuery() { return rendererLoadQuery; },
  set rendererLoadQuery(value) { rendererLoadQuery = value; },
  get isQuitting() { return isQuitting; },
  get finalExitStarted() { return finalExitStarted; },
  get applicationUpdate() { return applicationUpdate; },
  get editRuntimeProtocolController() { return editRuntimeProtocolController; },
  set editRuntimeProtocolController(value) { editRuntimeProtocolController = value; },
  get previewProtocolController() { return previewProtocolController; },
  e2eWindowForeground,
  e2eWindowRunsInBackground,
  directory,
  applicationName,
  bridgeAuthToken,
  runtimeEnvironment,
  runtimeChannel,
  APP_CHANNELS,
  markStartupStage: (stage) => startupPerformanceTimeline.mark(stage),
  startupTimingSnapshot: () => startupPerformanceTimeline.snapshot(),
  startUsageTelemetryAfterFirstPaint,
  deliverPendingExternalOpenFailure,
};
const {
  presentMainWindow,
  createWindow,
} = createWindowLifecycle(desktopRuntime);

function publishSourceFileMayHaveChanged(info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sourcePath = String(info?.sourcePath || "");
  if (!sourcePath) return;
  const payload = {
    sourcePath,
    watcherGeneration: Number(info?.watcherGeneration || 0),
  };
  if (info?.sourceMissing === true || info?.sourceMissing === false) {
    payload.sourceMissing = info.sourceMissing;
  }
  mainWindow.webContents.send(PROJECT_CHANNELS.sourceFileMayHaveChanged, payload);
}

async function recoverWatchedManagedSource(info) {
  const hint = info && typeof info === "object" ? info : {};
  try {
    await projectOpenQueue.run(async () => {
      const state = await loadProjectState();
      const activePath = state.activePath;
      const locator = state.activeManagedLocator;
      if (!activePath) {
        publishSourceFileMayHaveChanged(hint);
        return;
      }
      const missing = await lstat(activePath).then(
        (information) => !information.isFile() || information.isSymbolicLink(),
        (error) => error?.code === "ENOENT",
      );
      if (!missing) {
        publishSourceFileMayHaveChanged({ ...hint, sourceMissing: false });
        return;
      }
      if (!locator) {
        publishSourceFileMayHaveChanged({ ...hint, sourceMissing: true });
        return;
      }
      let sourceMissing = true;
      try {
        const reconciled = await reconcileActiveManagedSourceOperation({
          previousSourcePath: activePath,
          expectedSourceSha256: locator.sourceSha256,
          projectId: locator.projectId,
          documentId: locator.documentId,
          workingCopyId: locator.workingCopyId,
          versionId: locator.versionId,
          reason: "watch",
        });
        sourceMissing = !sameManagedPath(reconciled.sourcePath, activePath);
      } catch {
        // A queued reconcile may reject the pre-save Hash after publication
        // has already restored this path. Report the current presence so a
        // save echo cannot fence and rebuild an active native-edit session.
        // Present files still go through the renderer's content observation.
        sourceMissing = await lstat(activePath).then(
          (information) => !information.isFile() || information.isSymbolicLink(),
          () => true,
        );
      }
      // A recovered same-path publication is a save echo, not a relocation.
      // Keep the old path only for a real Finder rename so the renderer can
      // rebase it. A stale missing hint would invalidate an in-flight Request.
      publishSourceFileMayHaveChanged({
        sourcePath: activePath,
        watcherGeneration: Number(hint.watcherGeneration || sourceFileWatcher.watcherGeneration),
        sourceMissing,
      });
    });
  } catch {
    publishSourceFileMayHaveChanged(hint);
  }
}

// An imported V1 may be an HTML-only managed Working Copy while its selected
// external source directory still owns declared relative assets. This is
// session-only provenance established by Main during the verified hand-off;
// it is never accepted from the renderer or persisted as project authority.
let activeImportedAssetSourcePath = null;
const workspaceRecoveryMailbox = createWorkspaceRecoveryMailbox();
const externalFileOpenMailbox = createExternalFileOpenMailbox();
const externalOpenFailureMailbox = createExternalOpenFailureMailbox();
const externalFileOpenDelivery = createExternalFileOpenDeliveryCoordinator();
const preparedHtmlOpenStore = createPreparedHtmlOpenStore();
const recoveryJournalStore = createRecoveryJournalStore({
  rootPath: runtimeEnvironment.recoveryJournalPath,
});
const agentSessionCredentialStore = createAgentSessionCredentialStore({
  userDataPath: runtimeEnvironment.userDataPath,
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (buffer) => safeStorage.decryptString(buffer),
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() === true,
});
let rememberedCredentialRestoreFailure = null;
let rememberedCredentialRestorePromise = Promise.resolve();
let recoveryJournalAvailable = true;
let recoveryJournalUnavailableReason = "";

function requireRecoveryJournal() {
  if (recoveryJournalAvailable) return recoveryJournalStore;
  const error = new Error(
    recoveryJournalUnavailableReason || "恢复日志当前不可用，请导出当前 HTML 作为恢复副本。",
  );
  error.code = "RECOVERY_JOURNAL_UNAVAILABLE";
  throw error;
}
const externalFileOpenExitHandoff = createExternalFileOpenExitHandoff({
  handoffPath: path.join(runtimeEnvironment.userDataPath, "external-open-handoff.json"),
});
const projectOpenQueue = createProjectOpenQueue();

async function initializeRuntimeEnvironment() {
  const requiredPaths = [
    mkdir(runtimeEnvironment.userDataPath, { recursive: true, mode: 0o700 }),
    mkdir(runtimeEnvironment.sessionDataPath, { recursive: true, mode: 0o700 }),
    mkdir(runtimeEnvironment.projectFilesRoot, { recursive: true, mode: 0o700 }),
    mkdir(runtimeEnvironment.workspacePath, { recursive: true, mode: 0o700 }),
    mkdir(runtimeEnvironment.agentsRoot, { recursive: true, mode: 0o700 }),
    mkdir(runtimeEnvironment.logsPath, { recursive: true, mode: 0o700 }),
  ];
  if (runtimeEnvironment.channel !== "preview") {
    // Stable, source and E2E retain the pre-isolation best-effort startup
    // contract. Their explicit roots are still passed to Bridge, but a
    // temporarily unavailable optional directory must not block the window.
    await Promise.all(requiredPaths).catch(() => {});
    return;
  }
  // Preview is the only channel whose complete isolated environment is a hard
  // startup requirement; it must never silently continue with a missing root.
  requiredPaths.push(
    mkdir(runtimeEnvironment.recoveryJournalPath, { recursive: true, mode: 0o700 }),
  );
  await Promise.all(requiredPaths);
}

function ensurePreviewProtocolController() {
  if (!previewProtocolController) {
    previewProtocolController = createPreviewProtocolController({
      protocolApi: protocol,
      netFetch: (url, options) => net.fetch(url, options),
      maxHtmlBytes: MAX_HTML_BYTES,
    });
    previewProtocolController.install();
  }
  return previewProtocolController;
}

function ensureEditRuntimeProtocolController() {
  if (!editRuntimeProtocolController) {
    const bundledEchartsPaths = app.isPackaged
      ? Object.freeze({
          "5.4.3": path.join(
            process.resourcesPath,
            "edit-runtime-libraries",
            "echarts",
            "5.4.3",
            "echarts.min.js",
          ),
          "5.6.0": path.join(
            process.resourcesPath,
            "edit-runtime-libraries",
            "echarts",
            "5.6.0",
            "echarts.min.js",
          ),
        })
      : Object.freeze({
          "5.4.3": path.resolve(
            directory,
            "../node_modules/echarts-5-4-3/dist/echarts.min.js",
          ),
          "5.6.0": path.resolve(directory, "../node_modules/echarts/dist/echarts.min.js"),
        });
    editRuntimeProtocolController = createEditRuntimeProtocolController({
      protocolApi: protocol,
      netFetch: (url, options) => net.fetch(url, options),
      bundledEchartsPaths,
      runtimeLibraryStore: createEditRuntimeLibraryStore({
        userDataPath: app.getPath("userData"),
      }),
    });
    editRuntimeProtocolController.install();
  }
  return editRuntimeProtocolController;
}

function telemetryFingerprint(value) {
  const text = value instanceof Error
    ? `${value.name}\n${value.stack || value.message}`
    : String(value ?? "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function telemetryReasonCode(value, fallback = "UNKNOWN") {
  const normalized = String(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  return normalized || fallback;
}

function captureUsage(event, properties = {}, context = {}) {
  try {
    return usageTelemetry?.capture(event, properties, context) ?? false;
  } catch {
    return false;
  }
}

async function initializeUsageTelemetry() {
  let environmentConfig;
  try {
    environmentConfig = createTelemetryBuildConfig(process.env);
  } catch {
    environmentConfig = createTelemetryBuildConfig({});
  }
  let packagedConfig = null;
  if (app.isPackaged) {
    packagedConfig = await readTelemetryBuildConfig(
      path.join(process.resourcesPath, "usage-telemetry-config.json"),
    ).catch(() => null);
  }
  const config = environmentConfig.enabled
    ? environmentConfig
    : packagedConfig || environmentConfig;
  const runtimeEnabled = (
    process.env.PAGEROOT_TELEMETRY_DISABLED !== "1"
    && process.env.PAGEROOT_E2E !== "1"
    && (
      app.isPackaged
      || process.env.PAGEROOT_TELEMETRY_DEV === "1"
    )
  );
  usageTelemetry = createUsageTelemetry({
    userDataPath: app.getPath("userData"),
    projectToken: config.projectToken,
    host: config.host,
    enabled: runtimeEnabled && config.enabled,
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    fetchImpl: (url, options) => net.fetch(url, options),
  });
  await usageTelemetry.start();
}

let startupTelemetryPromise = null;
function startUsageTelemetryAfterFirstPaint() {
  if (startupTelemetryPromise) return startupTelemetryPromise;
  startupPerformanceTimeline.mark("telemetry-start");
  startupTelemetryPromise = initializeUsageTelemetry().then(() => {
    startupPerformanceTimeline.mark("telemetry-ready");
    return true;
  }).catch(() => {
    startupPerformanceTimeline.mark("telemetry-failed");
    return false;
  });
  return startupTelemetryPromise;
}

process.on("uncaughtExceptionMonitor", (error) => {
  captureUsage("runtime_fault", {
    process: "main",
    kind: "main_uncaught",
    reason_code: telemetryReasonCode(error?.name, "UNCAUGHT_EXCEPTION"),
    fingerprint: telemetryFingerprint(error),
  });
});

function reportSuppressedNativeDialog(title, message) {
  console.error(
    `[PageRoot E2E] 后台测试模式拦截原生弹窗：${title} — ${message}`,
  );
}

function requestAboutPageRoot() {
  if (
    !rendererHasLoaded
    || !mainWindow
    || mainWindow.isDestroyed()
  ) {
    return;
  }
  presentMainWindow();
  mainWindow.webContents.send(APP_CHANNELS.aboutRequested);
}

function requestRendererHistory(direction) {
  if (
    !rendererHasLoaded
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return;
  mainWindow.webContents.send(EDIT_CHANNELS.historyRequested, { direction });
}

function installApplicationMenu() {
  if (process.platform !== "darwin") return;
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {
          label: "关于源页",
          click: requestAboutPageRoot,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      role: "editMenu",
      submenu: [
        {
          label: "撤销",
          accelerator: "CommandOrControl+Z",
          click: () => requestRendererHistory("undo"),
        },
        {
          label: "重做",
          accelerator: "CommandOrControl+Shift+Z",
          click: () => requestRendererHistory("redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { role: "startSpeaking" },
        { role: "stopSpeaking" },
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

function emptyProjectState() {
  return {
    version: PROJECT_STATE_VERSION,
    activePath: null,
    recent: [],
    pendingRename: null,
    lastRename: null,
    lastManagedActivation: null,
    activeEffect: null,
    activeEffectGeneration: 0,
    activationReceipts: [],
    importedAssetRoots: [],
    activeManagedLocator: null,
  };
}

function projectStatePath() {
  return path.join(app.getPath("userData"), "html-projects.json");
}

function assertHtmlPath(value, label = "HTML 文件路径") {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
  ) {
    throw new TypeError(`${label}无效。`);
  }

  const resolved = path.resolve(value);
  if (!HTML_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new TypeError(`${label}必须以 .html 或 .htm 结尾。`);
  }
  return resolved;
}

async function existingPathIdentity(value) {
  const resolved = path.resolve(value);
  return realpath(resolved).catch(() => resolved);
}

function assertOptionalSuggestedName(value) {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (
    typeof trimmed !== "string"
    || trimmed.length === 0
    || trimmed.length > 180
    || trimmed.includes("\0")
    || trimmed !== path.basename(trimmed)
    || trimmed.includes("\\")
    || trimmed === "."
    || trimmed === ".."
  ) {
    throw new TypeError("建议文件名无效。");
  }
  return trimmed;
}

function assertHtmlPayload(payload, { allowSuggestedName = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("保存参数无效。");
  }
  const allowedKeys = allowSuggestedName
    ? new Set(["html", "sourcePath", "suggestedName", "expectedSha256"])
    : new Set(["html", "sourcePath", "expectedSha256"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("保存参数包含未支持的字段。");
  }
  if (typeof payload.html !== "string") {
    throw new TypeError("HTML 内容必须是字符串。");
  }
  if (Buffer.byteLength(payload.html, "utf8") > MAX_HTML_BYTES) {
    throw new RangeError("HTML 文件不能超过 25 MB。");
  }

  const sourcePath = payload.sourcePath === undefined || payload.sourcePath === null
    ? null
    : assertHtmlPath(payload.sourcePath, "sourcePath");
  const suggestedName = allowSuggestedName
    ? assertOptionalSuggestedName(payload.suggestedName)
    : null;
  const expectedSha256 = payload.expectedSha256 === undefined || payload.expectedSha256 === null
    ? null
    : String(payload.expectedSha256).trim().toLowerCase();
  if (expectedSha256 && !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError("expectedSha256 必须使用 sha256:<64 位十六进制> 格式。");
  }

  return { html: payload.html, sourcePath, suggestedName, expectedSha256 };
}

function assertReadPayload(sourcePath) {
  return assertHtmlPath(sourcePath, "sourcePath");
}

function assertExportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("导出参数无效。");
  }
  const allowedKeys = new Set(["html", "suggestedName", "sourcePath"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("导出参数包含未支持的字段。");
  }
  const { html, sourcePath, suggestedName } = assertHtmlPayload(
    {
      html: payload.html,
      sourcePath: payload.sourcePath ?? null,
      suggestedName: payload.suggestedName,
    },
    { allowSuggestedName: true },
  );
  return { html, sourcePath, suggestedName };
}

function isValidRecentEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  try {
    assertHtmlPath(entry.path);
  } catch {
    return false;
  }
  return Number.isFinite(entry.lastOpenedAt);
}

function normalizeManagedWorkingCopyActivation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const operationId = String(value.operationId || "");
    const projectId = String(value.projectId || "");
    const documentId = String(value.documentId || "");
    const workingCopyId = String(value.workingCopyId || "");
    const versionId = String(value.versionId || "");
    const expectedSha256 = String(value.expectedSha256 || "").trim().toLowerCase();
    const projectRootPath = String(value.projectRootPath || "");
    if (
      !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
      || !/^project_[A-Za-z0-9_-]+$/.test(projectId)
      || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
      || !/^work_ver_\d{4,}$/.test(workingCopyId)
      || !/^ver_\d{4,}$/.test(versionId)
      || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)
      || !projectRootPath
      || projectRootPath.length > MAX_PATH_LENGTH
      || projectRootPath.includes("\0")
      || !Number.isFinite(Number(value.completedAt))
    ) return null;
    return {
      operationId,
      projectId,
      documentId,
      workingCopyId,
      versionId,
      expectedSha256,
      previousSourcePath: assertHtmlPath(value.previousSourcePath, "previousSourcePath"),
      nextSourcePath: assertHtmlPath(value.nextSourcePath, "nextSourcePath"),
      projectRootPath: path.resolve(projectRootPath),
      completedAt: Number(value.completedAt),
    };
  } catch {
    return null;
  }
}

function normalizeActivationEffectTuple(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operationId = String(value.operationId || "");
  const kind = String(value.kind || "");
  const effectKind = String(value.effectKind || "active-path");
  try {
    const projectId = String(value.projectId || "");
    const documentId = String(value.documentId || "");
    const versionId = String(value.versionId || "");
    const expectedSha256 = String(value.expectedSha256 || "").trim().toLowerCase();
    const projectRootPath = value.projectRootPath == null
      ? null
      : String(value.projectRootPath);
    const committedAt = Number(value.committedAt ?? value.updatedAt);
    if (
      !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
      || !["managed-working-copy", "generated-version"].includes(kind)
      || effectKind !== "active-path"
      || !/^project_[A-Za-z0-9_-]+$/.test(projectId)
      || (documentId && !/^doc_[A-Za-z0-9_-]+$/.test(documentId))
      || !/^ver_\d{4,}$/.test(versionId)
      || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)
      || (kind === "managed-working-copy" && !/^work_ver_\d{4,}$/.test(String(value.workingCopyId || "")))
      || (projectRootPath !== null && (!projectRootPath || projectRootPath.length > MAX_PATH_LENGTH || projectRootPath.includes("\0")))
      || !Number.isFinite(committedAt)
    ) return null;
    return Object.freeze({
      operationId,
      kind,
      effectKind,
      projectId,
      documentId: documentId || null,
      workingCopyId: kind === "managed-working-copy" ? String(value.workingCopyId) : null,
      versionId,
      expectedSha256,
      previousSourcePath: assertHtmlPath(value.previousSourcePath, "previousSourcePath"),
      nextSourcePath: assertHtmlPath(value.nextSourcePath, "nextSourcePath"),
      projectRootPath: projectRootPath === null ? null : path.resolve(projectRootPath),
      committedAt,
    });
  } catch {
    return null;
  }
}

function normalizeActiveEffectGeneration(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

function bumpActiveEffectGeneration(state) {
  const current = normalizeActiveEffectGeneration(state.activeEffectGeneration);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new ProjectFileError(
      "ACTIVE_EFFECT_GENERATION_EXHAUSTED",
      "活动文件切换序列已达到上限，不能安全继续切换。",
    );
  }
  state.activeEffectGeneration = current + 1;
  return state.activeEffectGeneration;
}

function normalizeActivationReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operationId = String(value.operationId || "");
  const kind = String(value.kind || "");
  const effectKind = String(value.effectKind || "active-path");
  const status = String(value.status || "");
  if (
    !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
    || !["managed-working-copy", "generated-version"].includes(kind)
    || effectKind !== "active-path"
    || !["pending", "completed"].includes(status)
  ) return null;
  try {
    const projectId = String(value.projectId || "");
    const documentId = String(value.documentId || "");
    const versionId = String(value.versionId || "");
    const expectedSha256 = String(value.expectedSha256 || "").trim().toLowerCase();
    const projectRootPath = value.projectRootPath == null
      ? null
      : String(value.projectRootPath);
    const predecessorGeneration = value.predecessorGeneration == null
      ? null
      : Number(value.predecessorGeneration);
    const hasPredecessorEffect = Object.prototype.hasOwnProperty.call(
      value,
      "predecessorEffect",
    );
    const predecessorEffect = value.predecessorEffect === null
      ? null
      : normalizeActivationEffectTuple(value.predecessorEffect);
    const predecessorProofValid = (
      value.predecessorProofValid !== false
      && Number.isSafeInteger(predecessorGeneration)
      && predecessorGeneration >= 0
      && hasPredecessorEffect
      && (value.predecessorEffect === null || predecessorEffect !== null)
    );
    if (
      !/^project_[A-Za-z0-9_-]+$/.test(projectId)
      || (documentId && !/^doc_[A-Za-z0-9_-]+$/.test(documentId))
      || !/^ver_\d{4,}$/.test(versionId)
      || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)
      || (kind === "managed-working-copy" && !/^work_ver_\d{4,}$/.test(String(value.workingCopyId || "")))
      || (projectRootPath !== null && (!projectRootPath || projectRootPath.length > MAX_PATH_LENGTH || projectRootPath.includes("\0")))
      || !Number.isFinite(Number(value.updatedAt))
    ) return null;
    return Object.freeze({
      operationId,
      kind,
      effectKind,
      status,
      projectId,
      documentId: documentId || null,
      workingCopyId: kind === "managed-working-copy" ? String(value.workingCopyId) : null,
      versionId,
      expectedSha256,
      previousSourcePath: assertHtmlPath(value.previousSourcePath, "previousSourcePath"),
      nextSourcePath: assertHtmlPath(value.nextSourcePath, "nextSourcePath"),
      projectRootPath: projectRootPath === null ? null : path.resolve(projectRootPath),
      updatedAt: Number(value.updatedAt),
      predecessorGeneration: Number.isSafeInteger(predecessorGeneration)
        && predecessorGeneration >= 0
        ? predecessorGeneration
        : null,
      predecessorEffect,
      predecessorProofValid,
    });
  } catch {
    return null;
  }
}

function normalizeActivationReceipts(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const receipts = [];
  for (const value of values) {
    const receipt = normalizeActivationReceipt(value);
    if (!receipt || seen.has(receipt.operationId)) continue;
    seen.add(receipt.operationId);
    receipts.push(receipt);
    if (receipts.length >= MAX_ACTIVATION_RECEIPTS) break;
  }
  return receipts;
}

function normalizeActiveEffect(value) {
  return normalizeActivationEffectTuple(value);
}

function activationReceiptFor(state, operationId) {
  const key = String(operationId || "");
  return state.activationReceipts.find((receipt) => receipt.operationId === key)
    || (state.lastManagedActivation?.operationId === key
      ? normalizeActivationReceipt({
        ...state.lastManagedActivation,
        kind: "managed-working-copy",
        status: "completed",
        updatedAt: state.lastManagedActivation.completedAt,
      })
      : null);
}

function sameActivationReceipt(receipt, candidate) {
  return Boolean(
    receipt
    && candidate
    && receipt.operationId === candidate.operationId
    && receipt.kind === candidate.kind
    && receipt.effectKind === candidate.effectKind
    && receipt.projectId === candidate.projectId
    && receipt.documentId === candidate.documentId
    && receipt.workingCopyId === candidate.workingCopyId
    && receipt.versionId === candidate.versionId
    && receipt.expectedSha256 === candidate.expectedSha256
    && receipt.previousSourcePath === candidate.previousSourcePath
    && receipt.nextSourcePath === candidate.nextSourcePath
    && receipt.projectRootPath === candidate.projectRootPath
  );
}

function sameActivationEffect(effect, receipt) {
  return Boolean(
    effect
    && receipt
    && effect.operationId === receipt.operationId
    && effect.kind === receipt.kind
    && effect.effectKind === receipt.effectKind
    && effect.projectId === receipt.projectId
    && effect.documentId === receipt.documentId
    && effect.workingCopyId === receipt.workingCopyId
    && effect.versionId === receipt.versionId
    && effect.expectedSha256 === receipt.expectedSha256
    && effect.previousSourcePath === receipt.previousSourcePath
    && effect.nextSourcePath === receipt.nextSourcePath
    && effect.projectRootPath === receipt.projectRootPath
  );
}

function sameActivationPredecessor(state, receipt) {
  if (!receipt?.predecessorProofValid) return false;
  if (normalizeActiveEffectGeneration(state.activeEffectGeneration) !== receipt.predecessorGeneration) {
    return false;
  }
  const activeEffect = normalizeActiveEffect(state.activeEffect);
  if (!activeEffect && !receipt.predecessorEffect) return true;
  return sameActivationEffect(activeEffect, receipt.predecessorEffect);
}

function rememberActivationReceipt(state, receipt) {
  state.activationReceipts = [
    receipt,
    ...(state.activationReceipts || []).filter((entry) => entry.operationId !== receipt.operationId),
  ].slice(0, MAX_ACTIVATION_RECEIPTS);
}

async function persistActivationReceipt(state, receipt) {
  rememberActivationReceipt(state, Object.freeze({ ...receipt, updatedAt: Date.now() }));
  await persistProjectState();
}

function activationReceiptCandidate({
  kind,
  operationId,
  projectId,
  documentId = null,
  workingCopyId = null,
  versionId,
  expectedSha256,
  previousSourcePath,
  nextSourcePath,
  projectRootPath = null,
  predecessorGeneration,
  predecessorEffect,
}) {
  const normalizedPredecessorGeneration = normalizeActiveEffectGeneration(
    predecessorGeneration,
  );
  return Object.freeze({
    kind,
    effectKind: "active-path",
    status: "pending",
    operationId,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    expectedSha256,
    previousSourcePath,
    nextSourcePath,
    projectRootPath,
    predecessorGeneration: normalizedPredecessorGeneration,
    predecessorEffect: normalizeActiveEffect(predecessorEffect),
    predecessorProofValid: true,
    updatedAt: Date.now(),
  });
}

async function loadProjectState() {
  if (projectState) return projectState;

  const statePath = projectStatePath();
  try {
    const stateStats = await stat(statePath);
    if (!stateStats.isFile() || stateStats.size > MAX_STATE_BYTES) {
      projectState = emptyProjectState();
      return projectState;
    }

    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter(isValidRecentEntry).slice(0, MAX_RECENT_PROJECTS).map((entry) => ({
        path: path.resolve(entry.path),
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : path.basename(entry.path),
        lastOpenedAt: entry.lastOpenedAt,
      }))
      : [];
    const activePath = typeof parsed.activePath === "string"
      && recent.some((entry) => entry.path === path.resolve(parsed.activePath))
      ? path.resolve(parsed.activePath)
      : null;

    projectState = {
      version: PROJECT_STATE_VERSION,
      activePath,
      recent,
      pendingRename: normalizePendingSourceRename(parsed.pendingRename),
      lastRename: normalizeCompletedSourceRename(parsed.lastRename),
      lastManagedActivation: normalizeManagedWorkingCopyActivation(parsed.lastManagedActivation),
      activeEffect: normalizeActiveEffect(parsed.activeEffect),
      activeEffectGeneration: normalizeActiveEffectGeneration(parsed.activeEffectGeneration),
      activationReceipts: normalizeActivationReceipts(parsed.activationReceipts),
      importedAssetRoots: normalizeImportedAssetRoots(parsed.importedAssetRoots),
      activeManagedLocator: normalizeActiveManagedLocator(parsed.activeManagedLocator),
    };
    if (projectState.pendingRename) {
      await recoverPendingSourceRename({
        state: projectState,
        readProject: readHtmlProject,
        persistState: persistProjectState,
      }).catch((error) => {
        console.error(
          "[source-rename:recovery]",
          error instanceof Error ? error.stack || error.message : String(error),
        );
      });
    }
  } catch {
    projectState = emptyProjectState();
  }

  return projectState;
}

function persistProjectState() {
  const writeState = async () => {
    const statePath = projectStatePath();
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(projectState, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, statePath);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
  };
  stateWriteQueue = stateWriteQueue.then(writeState, writeState);
  return stateWriteQueue;
}

function persistWorkbenchTabsState(payload) {
  const writeState = () => writeWorkbenchTabsState({
    userDataPath: app.getPath("userData"),
    state: payload,
  });
  workbenchTabsWriteQueue = workbenchTabsWriteQueue.then(writeState, writeState);
  return workbenchTabsWriteQueue;
}

async function restoreActiveImportedAssetSource(projectSourcePath) {
  const state = await loadProjectState();
  const record = await importedAssetRootForProjectPath(
    state.importedAssetRoots,
    projectSourcePath,
  );
  if (!record) {
    activeImportedAssetSourcePath = null;
    return;
  }
  const [live, projectIdentity] = await Promise.all([
    resolveLiveImportedAssetSource(record.originalSourcePath),
    existingPathIdentity(projectSourcePath),
  ]);
  activeImportedAssetSourcePath = live && live !== projectIdentity
    ? live
    : null;
}

async function rememberAndBindImportedAssetSource({
  originalPath,
  projectSourcePath,
}) {
  if (
    typeof originalPath !== "string"
    || typeof projectSourcePath !== "string"
    || !isExternalOriginalPath(originalPath, projectSourcePath)
  ) {
    return;
  }
  const state = await loadProjectState();
  const projectRootPath = await realpath(path.dirname(projectSourcePath)).catch(
    () => path.resolve(path.dirname(projectSourcePath)),
  );
  const originalIdentity = await existingPathIdentity(originalPath);
  state.importedAssetRoots = rememberImportedAssetRoot(state.importedAssetRoots, {
    projectRootPath,
    originalSourcePath: originalIdentity,
  });
  await persistProjectState();
  await restoreActiveImportedAssetSource(projectSourcePath);
}

async function activateProject(filePath, { managedLocator = null } = {}) {
  const normalizedPath = await existingPathIdentity(assertHtmlPath(filePath));
  const state = await loadProjectState();
  const currentIdentity = state.activePath
    ? await existingPathIdentity(state.activePath).catch(() => null)
    : null;
  if (currentIdentity === normalizedPath) {
    if (managedLocator) {
      state.activeManagedLocator = normalizeActiveManagedLocator(managedLocator);
      await persistProjectState();
    }
    await restoreActiveImportedAssetSource(normalizedPath);
    sourceFileWatcher.watch(normalizedPath);
    return;
  }
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  const now = Date.now();
  bumpActiveEffectGeneration(state);
  state.activePath = normalizedPath;
  state.lastManagedActivation = null;
  state.activeEffect = null;
  state.activeManagedLocator = normalizeActiveManagedLocator(managedLocator);
  state.recent = [
    {
      path: normalizedPath,
      name: path.basename(normalizedPath),
      lastOpenedAt: now,
    },
    ...state.recent.filter(
      (_entry, index) => recentPathIdentities[index] !== normalizedPath,
    ),
  ].slice(0, MAX_RECENT_PROJECTS);
  await persistProjectState();
  await restoreActiveImportedAssetSource(normalizedPath);
  sourceFileWatcher.watch(normalizedPath);
}

async function forgetProject(filePath) {
  const state = await loadProjectState();
  const forgottenIdentity = await existingPathIdentity(filePath);
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  state.recent = state.recent.filter(
    (_entry, index) => recentPathIdentities[index] !== forgottenIdentity,
  );
  if (
    state.activePath
    && await existingPathIdentity(state.activePath) === forgottenIdentity
  ) {
    bumpActiveEffectGeneration(state);
    state.activePath = null;
    state.activeEffect = null;
    state.activeManagedLocator = null;
    sourceFileWatcher.close();
  }
  state.importedAssetRoots = await forgetImportedAssetRootsForPath(
    state.importedAssetRoots,
    filePath,
  );
  await persistProjectState();
  if (state.activePath) {
    await restoreActiveImportedAssetSource(state.activePath);
  } else {
    activeImportedAssetSourcePath = null;
  }
}

async function inspectHtmlFile(filePath) {
  const normalizedPath = assertHtmlPath(filePath);
  const fileStats = await lstat(normalizedPath);
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "UNSAFE_EXTERNAL_HTML",
      "只能打开普通 HTML 文件。",
    );
  }
  if (fileStats.size > MAX_HTML_BYTES) {
    throw new ProjectFileError(
      "HTML_TOO_LARGE",
      "HTML 文件不能超过 25 MB。",
    );
  }
  return normalizedPath;
}

async function readHtmlProject(filePath) {
  try {
    const normalizedPath = await inspectHtmlFile(filePath);
    const canonicalPath = await realpath(normalizedPath);
    return await readHtmlFile({ sourcePath: canonicalPath, maxHtmlBytes: MAX_HTML_BYTES });
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
    const state = await loadProjectState();
    const locator = state.activeManagedLocator;
    if (!locator || !sameManagedPath(locator.sourcePath, filePath)) throw cause;
    // A source may be in the Repository's durable publication interval. Join
    // its serialized read/recovery instead of surfacing an internal missing-file
    // observation or retrying an unregistered filesystem path.
    const recovered = await readRegisteredProjectProjection(locator.projectId);
    if (recovered.openTarget.documentId !== locator.documentId
      || recovered.openTarget.workingCopyId !== locator.workingCopyId) throw cause;
    return recovered;
  }
}

function projectWithIdentity(project, identity) {
  const projectId = String(identity?.projectId || "");
  const documentId = String(identity?.documentId || "");
  if (
    !project
    || !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
  ) return project;
  return Object.freeze({ ...project, projectId, documentId });
}

function taggedProject(project) {
  if (!project || typeof project.name !== "string" || typeof project.html !== "string") {
    return null;
  }
  const projectId = String(project.projectId || "");
  const documentId = String(project.documentId || "");
  const hasIdentity = (
    /^project_[A-Za-z0-9_-]+$/.test(projectId)
    && /^doc_[A-Za-z0-9_-]+$/.test(documentId)
  );
  return Object.freeze({
    openKind: "project",
    name: project.name,
    html: project.html,
    sourcePath: project.sourcePath || null,
    sha256: project.sha256 || null,
    ...(hasIdentity ? { projectId, documentId } : {}),
    ...(project.lastModifiedAt ? { lastModifiedAt: String(project.lastModifiedAt) } : {}),
    ...(project.path ? { path: String(project.path) } : {}),
  });
}

function taggedConfirmation(descriptor) {
  if (!descriptor || typeof descriptor.requestId !== "string") return null;
  return Object.freeze({
    openKind: "confirmation",
    ...descriptor,
  });
}

function projectsRootPath() {
  return runtimeEnvironment.projectFilesRoot;
}

function isInsideDirectory(filePath, directoryPath) {
  const resolvedFile = path.resolve(filePath);
  const resolvedDirectory = path.resolve(directoryPath);
  return resolvedFile === resolvedDirectory
    || resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`);
}

function publicMailboxRequest(request) {
  return publicExternalOpenRequest(request);
}

async function fetchBridgePost(pathname, body) {
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }
  const response = await net.fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProjectFileError(
      payload?.error?.code || "BRIDGE_REQUEST_FAILED",
      payload?.error?.message || "项目记录服务暂时无法完成这次操作。",
      payload?.error?.details && typeof payload.error.details === "object"
        ? payload.error.details
        : {},
    );
  }
  return payload;
}

async function classifyViaBridge(sourcePath) {
  const classified = await fetchBridgePost("/project/open-classification", {
    sourcePath,
  });
  if (
    !classified
    || (
      classified.kind !== "managed-project"
      && classified.kind !== "known-external"
      && classified.kind !== "new-external"
    )
    || typeof classified.sourceSha256 !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(classified.sourceSha256)
  ) {
    throw new ProjectFileError(
      "OPEN_CLASSIFICATION_FAILED",
      "无法判断这个 HTML 应该如何打开。",
    );
  }
  return classified;
}

function publicFactsForClassified(classified, sourcePath) {
  return publicFactsFromClassification({
    ...classified,
    classification: classified.kind,
    sourceFileName: classified.sourceFileName || path.basename(sourcePath),
    projectsRootLabel: formatProjectsRootLabel(projectsRootPath()),
  });
}

async function prepareOrOpenFromPath(sourcePath, { requestId } = {}) {
  const inspected = await inspectHtmlFile(sourcePath);
  const canonicalPath = await realpath(inspected);
  const classified = await classifyViaBridge(canonicalPath);
  if (classified.kind === "managed-project") {
    const project = await readHtmlProject(canonicalPath);
    await activateProject(project.sourcePath);
    return taggedProject(projectWithIdentity(project, classified.openTarget));
  }
  const nextRequestId = String(requestId || "");
  const reusable = preparedHtmlOpenStore.findPreparedBySourcePath(canonicalPath);
  if (
    reusable
    && (!nextRequestId || nextRequestId === reusable.requestId)
  ) {
    return taggedConfirmation(
      preparedHtmlOpenStore.publicDescriptor(reusable.requestId),
    );
  }
  preparedHtmlOpenStore.cancelOthers(nextRequestId);
  const descriptor = preparedHtmlOpenStore.prepare({
    ...(nextRequestId ? { requestId: nextRequestId } : {}),
    sourcePath: canonicalPath,
    classifiedAtSha256: classified.sourceSha256,
    classification: classified.kind,
    boundProjectId: classified.projectId || null,
    openTarget: classified.openTarget || null,
    publicFacts: publicFactsForClassified(classified, canonicalPath),
  });
  return taggedConfirmation(descriptor);
}

function presentExternalOpenFailure(error) {
  const presentation = externalOpenFailurePresentation(error);
  console.error("[external-open]", presentation.code, error);
  const issue = externalOpenFailureMailbox.publish({
    title: "无法打开这个 HTML",
    message: presentation.message,
  });
  if (e2eNativeDialogsSuppressed) {
    reportSuppressedNativeDialog(issue.title, issue.message);
  }
  deliverPendingExternalOpenFailure();
}

function deliverPendingExternalOpenFailure() {
  const issue = externalOpenFailureMailbox.peek();
  if (!issue || !rendererCanReceive()) return false;
  try {
    mainWindow.webContents.send(APP_CHANNELS.externalOpenFailed, issue);
  } catch {
    return false;
  }
  externalOpenFailureMailbox.take();
  return true;
}

function focusMainWindow() {
  return presentMainWindow();
}

function sameCloseAuthority(left, right) {
  return Boolean(
    left
    && right
    && left.requestId === right.requestId
    && left.generation === right.generation,
  );
}

function deliverExternalMailboxHead() {
  if (!rendererHasLoaded || !rendererCanReceive()) return false;
  const request = externalFileOpenMailbox.peek();
  if (!request || !externalFileOpenDelivery.shouldDeliver(request.requestId)) return false;
  try {
    mainWindow.webContents.send(
      APP_CHANNELS.externalOpenRequested,
      publicMailboxRequest(request),
    );
  } catch {
    return false;
  }
  externalFileOpenDelivery.markDelivered(request.requestId);
  return true;
}

function interruptCloseForExternalOpen() {
  if (!coordinatedExit || isQuitting || finalExitStarted) return null;
  const authority = externalFileOpenDelivery.invalidateClose();
  if (!authority || !closeRequest) return authority;
  const pending = closeRequest;
  if (!sameCloseAuthority(pending.closeAuthority, authority)) return authority;
  closeRequest = null;
  clearTimeout(pending.timeout);
  pending.resolve({
    requestId: pending.requestId,
    closeGeneration: authority.generation,
    ready: false,
    reason: "收到新的外部 HTML 打开请求，已取消关闭。",
    presentation: "in-app",
  });
  return authority;
}

function deferExternalFileOpenUntilNextLaunch(filePath) {
  try {
    return externalFileOpenExitHandoff.defer(filePath);
  } catch {
    // The exiting process must never accept a new path after close has
    // committed. A failed private handoff leaves the request unaccepted.
    return null;
  }
}

function resumeDeferredExternalFileOpenAfterExitAbort() {
  if (isQuitting || finalExitStarted) return;
  let restored = false;
  for (let sourcePath = externalFileOpenExitHandoff.take(); sourcePath; sourcePath = externalFileOpenExitHandoff.take()) {
    externalFileOpenMailbox.publish(sourcePath);
    restored = true;
  }
  if (restored) focusMainWindow();
  deliverExternalMailboxHead();
}

function publishExternalFileOpen(filePath) {
  if (isQuitting || finalExitStarted) {
    return deferExternalFileOpenUntilNextLaunch(filePath);
  }
  try {
    const request = externalFileOpenMailbox.publish(filePath);
    interruptCloseForExternalOpen();
    focusMainWindow();
    deliverExternalMailboxHead();
    return request;
  } catch (error) {
    if (app.isReady()) presentExternalOpenFailure(error);
    return null;
  }
}

async function openExternalFileRequest(request) {
  return prepareOrOpenFromPath(request.sourcePath, {
    requestId: request.requestId,
  });
}

async function adoptPendingExternalFileAtStartup() {
  return publicMailboxRequest(externalFileOpenMailbox.peek());
}

async function acceptExternalFileOpen(payload) {
  assertExactPayload(payload, ["requestId"], {
    code: "INVALID_EXTERNAL_OPEN_REQUEST",
    message: "外部 HTML 打开请求无效。",
  });
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    throw new ProjectFileError(
      "INVALID_EXTERNAL_OPEN_REQUEST",
      "外部 HTML 打开请求无效。",
    );
  }
  const request = externalFileOpenMailbox.peek();
  if (!request) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_REQUEST_EXPIRED",
      "这次外部打开请求已经失效，请从 QoderWork 再点一次 PageRoot。",
    );
  }
  if (request.requestId !== payload.requestId) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_REQUEST_OUT_OF_ORDER",
      "请先完成前一个外部 HTML 打开请求。",
    );
  }
  const begun = externalFileOpenMailbox.begin(
    request.requestId,
    (next) => projectOpenQueue.run(() => openExternalFileRequest(next)),
  );
  if (!begun) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_REQUEST_BUSY",
      "前一个外部 HTML 仍在等待处理。",
    );
  }
  return begun;
}

function acknowledgeExternalFileOpen(payload) {
  assertExactPayload(payload, ["requestId"], {
    code: "INVALID_EXTERNAL_OPEN_ACK",
    message: "外部 HTML 打开回执无效。",
  });
  const requestId = String(payload.requestId || "");
  const consumed = externalFileOpenMailbox.acknowledge(requestId);
  if (!consumed) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACK_OUT_OF_ORDER",
      "外部 HTML 打开回执与队首请求不一致。",
    );
  }
  externalFileOpenDelivery.acknowledge(requestId);
  deliverExternalMailboxHead();
  return { acknowledged: true, requestId };
}

async function currentActivePath() {
  const state = await loadProjectState();
  return state.activePath;
}

async function ensureBridgeProjectRegistered(project) {
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "欢迎页已经建立，但项目记录服务尚未就绪。",
    );
  }
  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/project/ensure`);
  const response = await net.fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
    body: JSON.stringify({
      sourcePath: project.sourcePath,
      expectedSourceSha256: project.sha256,
    }),
  });
  const workspace = await response.json().catch(() => null);
  const registeredSourcePath = typeof workspace?.sourcePath === "string"
    ? workspace.sourcePath
    : "";
  const [workspaceSourceIdentity, projectSourceIdentity] = await Promise.all([
    registeredSourcePath
      ? existingPathIdentity(registeredSourcePath)
      : Promise.resolve(null),
    existingPathIdentity(project.sourcePath),
  ]);
  const importedWorkingCopy = (
    workspace?.imported === true
    && Boolean(workspaceSourceIdentity)
    && workspaceSourceIdentity !== projectSourceIdentity
  );
  const workspaceCurrentSha256 = String(workspace?.currentHtmlSha256 || "");
  const sourceHashMatches = importedWorkingCopy
    ? workspace?.importSourceSha256 === project.sha256
    : workspaceCurrentSha256 === project.sha256;
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.registered !== true
    || typeof workspace.projectId !== "string"
    || !/^project_[A-Za-z0-9_-]+$/.test(workspace.projectId)
    || typeof workspace.documentId !== "string"
    || !/^doc_[A-Za-z0-9_-]+$/.test(workspace.documentId)
    || !/^sha256:[a-f0-9]{64}$/u.test(workspaceCurrentSha256)
    || !sourceHashMatches
    || !workspaceSourceIdentity
    || (!importedWorkingCopy && workspaceSourceIdentity !== projectSourceIdentity)
  ) {
    throw new ProjectFileError(
      "WELCOME_WORKSPACE_REGISTRATION_FAILED",
      "欢迎页已经建立，但对应的项目工作区没有通过完整性校验。",
      { sourcePath: project.sourcePath },
    );
  }
  if (importedWorkingCopy) {
    const importedProject = await readHtmlProject(registeredSourcePath);
    if (importedProject.sha256 !== workspaceCurrentSha256) {
      throw new ProjectFileError(
        "WELCOME_WORKSPACE_REGISTRATION_FAILED",
        "欢迎页已经建立，但对应的项目工作区没有通过完整性校验。",
        { sourcePath: project.sourcePath },
      );
    }
    const originalLogoPath = path.join(
      path.dirname(project.sourcePath),
      WELCOME_LOGO_RELATIVE_PATH,
    );
    const importedLogoPath = path.join(
      path.dirname(registeredSourcePath),
      WELCOME_LOGO_RELATIVE_PATH,
    );
    try {
      await copyFile(originalLogoPath, importedLogoPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new ProjectFileError(
          "WELCOME_WORKSPACE_REGISTRATION_FAILED",
          "欢迎页已经建立，但对应的项目工作区没有通过完整性校验。",
          { sourcePath: project.sourcePath },
        );
      }
    }
    const state = await loadProjectState();
    await commitActivatedProjectPath({
      state,
      previousSourcePath: projectSourceIdentity,
      nextSourcePath: workspaceSourceIdentity,
      project: importedProject,
      importedAssetSourcePath: projectSourceIdentity,
      managedLocator: activeManagedLocatorForActivatedPath(
        workspace.openTarget, workspaceSourceIdentity, importedProject.sha256,
      ),
    });
    managedWelcomeRegistration = `${workspaceSourceIdentity}\0${importedProject.sha256}`;
    return projectWithIdentity(importedProject, workspace);
  }
  managedWelcomeRegistration = `${projectSourceIdentity}\0${project.sha256}`;
  return projectWithIdentity(project, workspace);
}

async function getActiveProject() {
  return projectOpenQueue.run(getActiveProjectOperation);
}

async function getActiveProjectOperation() {
  const workspaceRoot = await workspacePath();
  const welcomeSourcePath = managedWelcomeSourcePath(workspaceRoot);
  const state = await loadProjectState();
  let activePath = state.activePath;
  let project;
  if (activePath) {
    const missing = await lstat(activePath).then(
      (info) => !info.isFile() || info.isSymbolicLink(),
      (error) => error?.code === "ENOENT",
    );
    if (missing && state.activeManagedLocator) {
      try {
        const reconciled = await reconcileActiveManagedSourceOperation({
          previousSourcePath: activePath,
          expectedSourceSha256: state.activeManagedLocator.sourceSha256,
          projectId: state.activeManagedLocator.projectId,
          documentId: state.activeManagedLocator.documentId,
          workingCopyId: state.activeManagedLocator.workingCopyId,
          versionId: state.activeManagedLocator.versionId,
          reason: "startup",
        });
        activePath = reconciled.sourcePath;
      } catch {
        // Fall through to the existing missing-file recovery path.
      }
    }
  } else if (state.activeManagedLocator) {
    try {
      const reconciled = await reconcileActiveManagedSourceOperation({
        previousSourcePath: state.activeManagedLocator.sourcePath,
        expectedSourceSha256: state.activeManagedLocator.sourceSha256,
        projectId: state.activeManagedLocator.projectId,
        documentId: state.activeManagedLocator.documentId,
        workingCopyId: state.activeManagedLocator.workingCopyId,
        versionId: state.activeManagedLocator.versionId,
        reason: "startup",
      });
      activePath = reconciled.sourcePath;
    } catch {
      // Fall through to welcome provisioning.
    }
  }
  if (!activePath) {
    project = await ensureManagedWelcomeHtml({
      workspaceRoot,
      maxHtmlBytes: MAX_HTML_BYTES,
    });
    activePath = project.sourcePath;
    await activateProject(activePath);
    project = null;
  }
  try {
    // Registered reads join the Repository queue even while the visible name is
    // being published. Carry its bytes and identity together instead of doing
    // another Main read/classification after that serialized proof.
    const classified = await classifyViaBridge(activePath);
    if (classified.kind === "managed-project" && classified.openTarget?.targetKind === "working-copy") {
      project = await readRegisteredProjectProjection(classified.openTarget.projectId, classified.openTarget);
      if (!sameManagedPath(activePath, project.sourcePath)
        || !sameManagedPath(classified.openTarget.projectRootPath, project.openTarget.projectRootPath)) {
        // Finder may move this same member between classification and the
        // serialized read. Rebase Main's locator and watcher before exposing
        // the verified tuple; a later watcher notification is not the receipt.
        await commitActivatedProjectPath({
          state: await loadProjectState(),
          previousSourcePath: await existingPathIdentity(activePath),
          nextSourcePath: project.sourcePath,
          project,
          managedLocator: activeManagedLocatorForActivatedPath(
            project.openTarget, project.sourcePath, project.sha256,
          ),
        });
        activePath = project.sourcePath;
      }
    }
    project ||= await readHtmlProject(activePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProjectFileError(
        "ACTIVE_PROJECT_MISSING",
        `上次打开的 HTML 已不在原位置：${activePath}`,
        { sourcePath: activePath },
      );
    }
    throw error;
  }
  const [activePathIdentity, welcomePathIdentity, projectSourceIdentity] =
    await Promise.all([
      existingPathIdentity(activePath),
      existingPathIdentity(welcomeSourcePath),
      existingPathIdentity(project.sourcePath),
    ]);
  if (activePathIdentity === welcomePathIdentity) {
    const registrationKey = `${projectSourceIdentity}\0${project.sha256}`;
    if (managedWelcomeRegistration !== registrationKey) {
      project = await ensureBridgeProjectRegistered(project);
    }
    return taggedProject(project);
  }
  if (project.openTarget) {
    sourceFileWatcher.watch(project.sourcePath);
    return taggedProject(project);
  }
  return prepareOrOpenFromPath(project.sourcePath);
}

async function openHtml() {
  return projectOpenQueue.run(async () => {
    // 始终交出一个 defaultPath：macOS 只有在缺省时才沿用上次选择过的目录。
    const defaultPath = await resolveOpenDialogDefaultPath({
      projectsRoot: projectsRootPath(),
      documentsRoot: path.dirname(projectsRootPath()),
      lstat,
    });
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开 HTML 项目",
      buttonLabel: "打开",
      ...(defaultPath ? { defaultPath } : {}),
      properties: ["openFile"],
      filters: [
        { name: "HTML 文件", extensions: ["html", "htm"] },
      ],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    return prepareOrOpenFromPath(result.filePaths[0]);
  });
}

async function importExternalViaBridge(sourcePath, expectedSourceSha256) {
  const workspace = await fetchBridgePost("/project/ensure", {
    sourcePath,
    expectedSourceSha256,
  });
  const registeredSourcePath = typeof workspace?.sourcePath === "string"
    ? workspace.sourcePath
    : "";
  if (
    !workspace
    || workspace.ok !== true
    || workspace.registered !== true
    || typeof workspace.projectId !== "string"
    || !/^project_[A-Za-z0-9_-]+$/.test(workspace.projectId)
    || typeof workspace.documentId !== "string"
    || !/^doc_[A-Za-z0-9_-]+$/.test(workspace.documentId)
    || !registeredSourcePath
  ) {
    throw new ProjectFileError(
      "EXTERNAL_IMPORT_FAILED",
      "这次导入没有通过完整性校验，当前项目没有改变。",
    );
  }
  const importedProject = await readHtmlProject(registeredSourcePath);
  if (
    workspace.imported === true
    && (
      workspace.importSourceSha256 !== expectedSourceSha256
      || importedProject.sha256 !== workspace.sourceSha256
    )
  ) {
    throw new ProjectFileError(
      "EXTERNAL_IMPORT_FAILED",
      "导入后的项目与刚才选择的文件不一致，当前项目没有改变。",
    );
  }
  const [originalIdentity, importedIdentity] = await Promise.all([
    existingPathIdentity(sourcePath),
    existingPathIdentity(importedProject.sourcePath),
  ]);
  const managedLocator = activeManagedLocatorForActivatedPath(
    workspace.openTarget, importedIdentity, importedProject.sha256,
  );
  if (!managedLocator
    || managedLocator.projectId !== workspace.projectId
    || managedLocator.documentId !== workspace.documentId
    || !sameManagedPath(workspace.openTarget.exactSourcePath, importedIdentity)) {
    throw new ProjectFileError("EXTERNAL_IMPORT_FAILED", "导入后的工作文件定位不完整。");
  }
  await rememberAndBindImportedAssetSource({
    originalPath: originalIdentity,
    projectSourcePath: importedIdentity,
  });
  await activateProject(importedProject.sourcePath, { managedLocator });
  return {
    project: projectWithIdentity(importedProject, workspace),
    imported: workspace.imported === true,
  };
}

function replayCommittedProject(intent) {
  const project = intent?.commitReceipt?.project;
  return taggedProject(project) || project;
}

async function commitPreparedHtmlOpen(payload) {
  assertExactPayload(payload, ["requestId", "action", "deleteOriginal"]);
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    throw new ProjectFileError(
      "INVALID_PREPARED_OPEN_REQUEST",
      "这次打开请求无效。",
    );
  }
  return projectOpenQueue.run(() => commitPreparedHtmlOpenOperation(payload));
}

async function commitPreparedHtmlOpenOperation(payload) {
  const requestId = payload.requestId;
  const action = payload.action;
  const deleteOriginal = payload.deleteOriginal === true;
  const existing = preparedHtmlOpenStore.peek(requestId);
  if (existing?.state === "committed" || existing?.state === "finalized") {
    return replayCommittedProject(existing);
  }
  const intent = preparedHtmlOpenStore.beginCommit(requestId, {
    action,
    deleteOriginal,
  });
  try {
    const previousActivePath = await currentActivePath();
    const current = await readHtmlProject(intent.sourcePath);
    if (current.sha256 !== intent.classifiedAtSha256) {
      throw new ProjectFileError(
        "OPEN_INTENT_SOURCE_CHANGED",
        "文件在确认期间被修改，没有导入。",
      );
    }
    const classified = await classifyViaBridge(intent.sourcePath);
    if (classified.kind !== intent.classification) {
      preparedHtmlOpenStore.failCommit(requestId);
      preparedHtmlOpenStore.cancel(requestId);
      if (
        intent.classification === "new-external"
        && classified.kind === "known-external"
      ) {
        const descriptor = preparedHtmlOpenStore.prepare({
          requestId,
          sourcePath: intent.sourcePath,
          classifiedAtSha256: classified.sourceSha256,
          classification: "known-external",
          boundProjectId: classified.projectId || null,
          openTarget: classified.openTarget || null,
          publicFacts: publicFactsForClassified(classified, intent.sourcePath),
        });
        throw new ProjectFileError(
          "OPEN_INTENT_RECLASSIFIED",
          "这个文件之前已经导入过了，请确认后打开之前的项目。",
          { confirmation: taggedConfirmation(descriptor) },
        );
      }
      throw new ProjectFileError(
        "OPEN_INTENT_SOURCE_CHANGED",
        "这个文件的打开方式已变化，请重新打开。",
      );
    }
    let project = null;
    let imported = false;
    if (action === "continue-current") {
      const targetPath = classified.openTarget?.exactSourcePath;
      if (!targetPath) {
        throw new ProjectFileError(
          "EXTERNAL_OPEN_TARGET_MISSING",
          "无法打开已关联项目的当前工作文件。",
        );
      }
      project = await readHtmlProject(targetPath);
      project = projectWithIdentity(project, classified.openTarget || classified);
      await rememberAndBindImportedAssetSource({
        originalPath: intent.sourcePath,
        projectSourcePath: project.sourcePath,
      });
      await activateProject(project.sourcePath);
    } else if (action === "import-new") {
      const importedResult = await importExternalViaBridge(
        intent.sourcePath,
        intent.classifiedAtSha256,
      );
      project = importedResult.project;
      imported = importedResult.imported;
    } else if (action === "open-managed") {
      project = await readHtmlProject(intent.sourcePath);
      project = projectWithIdentity(project, classified.openTarget || classified);
      await activateProject(project.sourcePath);
    } else {
      assertCommitAction({
        classification: intent.classification,
        action,
        deleteOriginal,
      });
    }
    preparedHtmlOpenStore.completeCommit(requestId, {
      project,
      imported,
      previousActivePath,
      committedSourcePath: project.sourcePath,
      classifiedAtSha256: intent.classifiedAtSha256,
      originalSourcePath: intent.sourcePath,
    });
    return taggedProject(project);
  } catch (error) {
    preparedHtmlOpenStore.failCommit(requestId);
    throw error;
  }
}

async function cancelPreparedHtmlOpen(payload) {
  assertExactPayload(payload, ["requestId"]);
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    throw new ProjectFileError(
      "INVALID_PREPARED_OPEN_REQUEST",
      "这次打开请求无效。",
    );
  }
  return { canceled: preparedHtmlOpenStore.cancel(payload.requestId) };
}

async function assertTrashableOriginal(intent) {
  const originalPath = intent.sourcePath;
  const stats = await lstat(originalPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
      "只能把刚才选择的普通 HTML 移入废纸篓。",
    );
  }
  const canonical = await realpath(originalPath);
  if (isInsideDirectory(canonical, projectsRootPath())) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
      "不能删除项目目录里的文件。",
    );
  }
  const current = await readHtmlProject(canonical);
  if (current.sha256 !== intent.classifiedAtSha256) {
    throw new ProjectFileError(
      "OPEN_INTENT_SOURCE_CHANGED",
      "原文件在导入后已变化，没有移入废纸篓。",
    );
  }
  const committed = intent.commitReceipt?.committedSourcePath;
  if (committed) {
    const [activeIdentity, committedIdentity, originalIdentity] = await Promise.all([
      currentActivePath().then((active) => (
        active ? existingPathIdentity(active) : null
      )),
      existingPathIdentity(committed),
      existingPathIdentity(canonical),
    ]);
    if (activeIdentity !== committedIdentity) {
      throw new ProjectFileError(
        "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
        "当前打开的已不是这次导入的项目，没有删除原文件。",
      );
    }
    if (originalIdentity === committedIdentity) {
      throw new ProjectFileError(
        "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
        "不能删除当前 HTML 文件。",
      );
    }
  }
  return canonical;
}

async function finalizePreparedHtmlOpen(payload) {
  assertExactPayload(payload, ["requestId"]);
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    throw new ProjectFileError(
      "INVALID_PREPARED_OPEN_REQUEST",
      "这次打开请求无效。",
    );
  }
  return projectOpenQueue.run(async () => {
    const requestId = payload.requestId;
    const intent = preparedHtmlOpenStore.peek(requestId);
    if (intent?.state === "finalized") {
      return { disposition: intent.originalDisposition };
    }
    if (!preparedHtmlOpenStore.shouldTrash(requestId)) {
      return {
        disposition: preparedHtmlOpenStore.recordDisposition(requestId, "kept"),
      };
    }
    try {
      const canonical = await assertTrashableOriginal(intent);
      await shell.trashItem(canonical);
      return {
        disposition: preparedHtmlOpenStore.recordDisposition(requestId, "trashed"),
      };
    } catch {
      return {
        disposition: preparedHtmlOpenStore.recordDisposition(
          requestId,
          "trash-failed",
        ),
      };
    }
  });
}

async function rollbackPreparedHtmlOpen(payload) {
  assertExactPayload(payload, ["requestId"]);
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    throw new ProjectFileError(
      "INVALID_PREPARED_OPEN_REQUEST",
      "这次打开请求无效。",
    );
  }
  return projectOpenQueue.run(async () => {
    const intent = preparedHtmlOpenStore.peek(payload.requestId);
    const receipt = intent?.commitReceipt;
    if (!receipt?.committedSourcePath) {
      throw new ProjectFileError(
        "EXTERNAL_OPEN_REQUEST_EXPIRED",
        "这次打开请求已经失效，请重新选择文件。",
      );
    }
    const state = await loadProjectState();
    const currentIdentity = state.activePath
      ? await existingPathIdentity(state.activePath)
      : null;
    const committedIdentity = await existingPathIdentity(receipt.committedSourcePath);
    if (currentIdentity !== committedIdentity) {
      return { rolledBack: false, project: null };
    }
    const previous = receipt.previousActivePath;
    if (previous) {
      try {
        const project = await readHtmlProject(previous);
        await activateProject(project.sourcePath);
        return { rolledBack: true, project: taggedProject(project) };
      } catch {
        bumpActiveEffectGeneration(state);
        state.activePath = null;
        state.activeEffect = null;
        await persistProjectState();
        return { rolledBack: true, project: null };
      }
    }
    bumpActiveEffectGeneration(state);
    state.activePath = null;
    state.activeEffect = null;
    await persistProjectState();
    return { rolledBack: true, project: null };
  });
}

async function assertKnownProjectPath(sourcePath) {
  const state = await loadProjectState();
  const requestedIdentity = await existingPathIdentity(sourcePath);
  const knownIdentities = await Promise.all([
    state.activePath,
    ...state.recent.map((entry) => entry.path),
  ].filter(Boolean).map(existingPathIdentity));
  const known = knownIdentities.includes(requestedIdentity);
  if (!known) {
    throw new ProjectFileError(
      "UNKNOWN_SOURCE",
      "只能更新已经由工作台打开的 HTML 文件。",
      { sourcePath },
    );
  }
}

async function readHtml(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  await assertKnownProjectPath(sourcePath);
  return readHtmlFile({
    sourcePath,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
}

async function showInFolder(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  shell.showItemInFolder(sourcePath);
  return { sourcePath };
}

async function openProjectsRoot() {
  const rootPath = projectsRootPath();
  const information = await lstat(rootPath).catch(() => null);
  if (!information?.isDirectory() || information.isSymbolicLink()) {
    throw new ProjectFileError(
      "PROJECTS_ROOT_UNAVAILABLE",
      "PageRoot 项目目录暂时无法打开，请稍后重试。",
    );
  }
  const openError = await shell.openPath(rootPath);
  if (openError) {
    throw new ProjectFileError(
      "PROJECTS_ROOT_OPEN_FAILED",
      "PageRoot 项目目录暂时无法打开，请稍后重试。",
      { reason: openError },
    );
  }
  return { opened: true };
}

const openInDefaultBrowser = createOpenInDefaultBrowserOperation({
  assertKnownProjectPath,
  inspectHtmlFile,
  openExternal: (sourceUrl) => shell.openExternal(sourceUrl),
});

const createPreviewSession = createPreviewSessionOperation({
  createSession: (payload) => (
    ensurePreviewProtocolController().createSession(payload)
  ),
  authorizeSourcePath: async (sourcePathInput) => {
    const sourcePath = assertReadPayload(sourcePathInput);
    await assertKnownProjectPath(sourcePath);
    const inspected = await inspectHtmlFile(sourcePath);
    const liveImportedAssetSourcePath = activeImportedAssetSourcePath
      ? await resolveLiveImportedAssetSource(activeImportedAssetSourcePath)
      : null;
    return previewAssetSourcePath({
      authorizedProjectSourcePath: inspected,
      liveImportedAssetSourcePath,
    });
  },
});

async function prepareEditAuthorRuntime(payload) {
  if (process.env.PAGEROOT_E2E === "1" && e2eEditRuntimePrepareGate.held) {
    await e2eEditRuntimePrepareGate.held.barrier;
  }
  const activeSourcePath = await currentActivePath();
  if (!activeSourcePath) throw new Error("Edit runtime requires an active source path.");
  const activeSource = await readHtmlFile({
    sourcePath: activeSourcePath,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
  if (
    !payload
    || typeof payload !== "object"
    || payload.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || !isEditRuntimeRequestId(payload.requestId)
    || typeof payload.html !== "string"
    || payload.html !== activeSource.html
    || payload.programIdentity !== editRuntimeProgramIdentity(activeSource.html)
    || String(payload.sourceSha256 || "").toLowerCase() !== activeSource.sha256
    || !Number.isSafeInteger(payload.canvasGeneration)
    || payload.canvasGeneration < 0
  ) {
    throw new Error("Edit runtime source is no longer the active persisted document.");
  }
  let releasePreparation;
  try {
    releasePreparation = editRuntimePreparationFence.claim({
      requestId: payload.requestId,
      sourcePath: activeSource.sourcePath,
      sourceSha256: activeSource.sha256,
      canvasGeneration: payload.canvasGeneration,
    });
  } catch (cause) {
    if (cause instanceof Error && /already consumed/u.test(cause.message)) {
      throw new ProjectFileError(
        "EDIT_RUNTIME_PREPARATION_REPLAYED",
        "当前画布的运行时准备已经完成。",
      );
    }
    if (cause instanceof Error && /in progress/u.test(cause.message)) {
      throw new ProjectFileError(
        "EDIT_RUNTIME_PREPARATION_LIMITED",
        "当前画布正在安全准备，请稍后重试。",
      );
    }
    throw cause;
  }
  const assetSourcePath = activeImportedAssetSourcePath || activeSource.sourcePath;
  let session = null;
  try {
    session = await ensureEditRuntimeProtocolController().createSession({
      html: activeSource.html,
      sourcePath: assetSourcePath,
    });
    return Object.freeze({
      contractVersion: session.contractVersion,
      sessionId: session.sessionId,
      executionId: session.executionId,
      sourceSha256: activeSource.sha256,
      resourceSha256: session.resourceSha256,
      documentBasePath: session.documentBasePath,
      libraryOrigins: session.libraryOrigins,
      runtimeLibraries: session.runtimeLibraries,
      resourceMode: session.resourceMode,
      scriptCount: session.scriptCount,
      byteLength: session.byteLength,
      canvasGeneration: payload.canvasGeneration,
      programIdentity: payload.programIdentity,
    });
  } catch (cause) {
    if (session) {
      try {
        ensureEditRuntimeProtocolController().revokeSession(session.sessionId);
      } catch {
        // A failed preparation must not leave a live resource session.
      }
    }
    throw cause;
  } finally {
    releasePreparation();
  }
}

const revokeEditAuthorRuntime = (sessionId) => (
  ensureEditRuntimeProtocolController().revokeSession(sessionId)
);

async function resolveKnownRenameSource(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  const state = await loadProjectState();
  const [requestedIdentity, activeIdentity] = await Promise.all([
    existingPathIdentity(sourcePath),
    state.activePath
      ? existingPathIdentity(state.activePath)
      : Promise.resolve(null),
  ]);
  if (!isActiveProjectIdentity({ requestedIdentity, activeIdentity })) {
    throw new ProjectFileError(
      "INACTIVE_RENAME_SOURCE",
      "只能重命名当前正在编辑的 HTML 文件。",
      { sourcePath },
    );
  }
  await inspectHtmlFile(sourcePath);
  return realpath(sourcePath);
}

async function rebindRenamedWorkspace(sourcePath, expectedSha256) {
  if (!bridgePort) return false;
  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/workspace`);
  endpoint.searchParams.set("sourcePath", sourcePath);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const workspace = await response.json().catch(() => null);
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.currentHtmlSha256 !== expectedSha256
    || typeof workspace.sourcePath !== "string"
  ) return false;
  const [workspaceIdentity, renamedIdentity] = await Promise.all([
    existingPathIdentity(workspace.sourcePath),
    existingPathIdentity(sourcePath),
  ]);
  return workspaceIdentity === renamedIdentity;
}

async function renameHtml(payload) {
  return projectOpenQueue.run(() => renameHtmlOperation(payload));
}

async function renameHtmlOperation(payload) {
  const state = await loadProjectState();
  const result = await renameHtmlSource({
    payload,
    state,
    persistState: persistProjectState,
    resolveKnownSource: resolveKnownRenameSource,
    readProject: readHtmlProject,
    rebindWorkspace: rebindRenamedWorkspace,
  });
  if (result?.sourcePath) sourceFileWatcher.watch(result.sourcePath);
  return result;
}

async function activateGeneratedVersion(payload) {
  return projectOpenQueue.run(() => activateGeneratedVersionOperation(payload));
}

function assertManagedWorkingCopyActivationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("托管工作文件参数无效。");
  }
  const allowedKeys = new Set([
    "previousSourcePath",
    "nextSourcePath",
    "expectedSha256",
    "projectId",
    "documentId",
    "workingCopyId",
    "versionId",
    "projectRootPath",
    "operationId",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("托管工作文件参数包含未支持的字段。");
  }
  const previousSourcePath = assertHtmlPath(
    payload.previousSourcePath,
    "previousSourcePath",
  );
  const nextSourcePath = assertHtmlPath(
    payload.nextSourcePath,
    "nextSourcePath",
  );
  const expectedSha256 = String(payload.expectedSha256 || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError("expectedSha256 必须使用 sha256:<64 位十六进制> 格式。");
  }
  const projectId = String(payload.projectId || "");
  const documentId = String(payload.documentId || "");
  const workingCopyId = String(payload.workingCopyId || "");
  const versionId = String(payload.versionId || "");
  const projectRootPath = String(payload.projectRootPath || "");
  const operationId = payload.operationId === undefined || payload.operationId === null
    ? ""
    : String(payload.operationId);
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !/^work_ver_\d{4,}$/.test(workingCopyId)
    || !/^ver_\d{4,}$/.test(versionId)
    || !projectRootPath
    || projectRootPath.length > MAX_PATH_LENGTH
    || projectRootPath.includes("\0")
    || !/^[A-Za-z0-9_-]{8,160}$/.test(operationId || "")
  ) {
    throw new TypeError("托管工作文件身份无效。");
  }
  return {
    previousSourcePath,
    nextSourcePath,
    expectedSha256,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    projectRootPath: path.resolve(projectRootPath),
    operationId,
  };
}

async function commitActivatedProjectPath({
  state,
  previousSourcePath,
  nextSourcePath,
  project,
  importedAssetSourcePath = null,
  managedActivation = null,
  managedLocator = undefined,
  activeEffect = null,
}) {
  const now = Date.now();
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  const activatesCurrentProject =
    activePathIdentity === previousSourcePath
    || activePathIdentity === nextSourcePath;
  const replacedIndex = recentPathIdentities.findIndex(
    (identity) => identity === previousSourcePath || identity === nextSourcePath,
  );
  const replacedEntry = replacedIndex >= 0
    ? state.recent[replacedIndex]
    : null;
  const replacement = {
    path: nextSourcePath,
    name: replacedEntry?.name || path.basename(nextSourcePath),
    lastOpenedAt: activatesCurrentProject
      ? now
      : replacedEntry?.lastOpenedAt ?? now,
  };
  const retained = state.recent.filter(
    (_entry, index) => (
      recentPathIdentities[index] !== previousSourcePath
      && recentPathIdentities[index] !== nextSourcePath
    ),
  );
  if (activatesCurrentProject) {
    bumpActiveEffectGeneration(state);
    state.activePath = nextSourcePath;
    state.recent = [replacement, ...retained].slice(0, MAX_RECENT_PROJECTS);
    sourceFileWatcher.watch(nextSourcePath);
  } else {
    retained.splice(
      Math.min(
        replacedIndex >= 0 ? replacedIndex : retained.length,
        retained.length,
      ),
      0,
      replacement,
    );
    state.recent = retained.slice(0, MAX_RECENT_PROJECTS);
  }
  state.lastManagedActivation = managedActivation;
  if (activatesCurrentProject) {
    state.activeEffect = normalizeActiveEffect(activeEffect);
  }
  if (
    importedAssetSourcePath
    && isExternalOriginalPath(importedAssetSourcePath, nextSourcePath)
  ) {
    const projectRootPath = await realpath(path.dirname(nextSourcePath)).catch(
      () => path.resolve(path.dirname(nextSourcePath)),
    );
    state.importedAssetRoots = rememberImportedAssetRoot(state.importedAssetRoots, {
      projectRootPath,
      originalSourcePath: importedAssetSourcePath,
    });
  }
  if (managedLocator !== undefined) {
    state.activeManagedLocator = normalizeActiveManagedLocator(managedLocator);
  } else if (managedActivation) {
    state.activeManagedLocator = normalizeActiveManagedLocator({
      projectId: managedActivation.projectId,
      documentId: managedActivation.documentId,
      workingCopyId: managedActivation.workingCopyId,
      versionId: managedActivation.versionId,
      sourcePath: nextSourcePath,
      sourceSha256: managedActivation.expectedSha256,
      projectRootPath: managedActivation.projectRootPath,
    });
  } else if (activatesCurrentProject) {
    state.activeManagedLocator = rebaseActiveManagedLocator(
      state.activeManagedLocator,
      {
        previousSourcePath,
        nextSourcePath,
        sourceSha256: project?.sha256,
      },
    );
  }
  await persistProjectState();
  if (activatesCurrentProject) {
    await restoreActiveImportedAssetSource(nextSourcePath);
  }
  return {
    ...project,
    previousSourcePath,
  };
}

async function replayActivationReceipt(state, receipt) {
  if (receipt.effectKind !== "active-path") {
    throw new ProjectFileError(
      "ACTIVATION_EFFECT_UNKNOWN",
      "这次桌面切换的回执缺少可核对的活动路径 effect，不能重放。",
      { operationId: receipt.operationId },
    );
  }
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const activeCommitted = activePathIdentity === receipt.nextSourcePath;
  const activeEffect = normalizeActiveEffect(state.activeEffect);
  const effectCommitted = activeCommitted && sameActivationEffect(activeEffect, receipt);
  // Recent membership is only a ranked catalog observation. It is not an
  // operation-specific host effect and must never make a pending/completed
  // activation look replayable after another project became active.
  if (effectCommitted) {
    const project = await readHtmlProject(receipt.nextSourcePath);
    if (project.sha256 !== receipt.expectedSha256) {
      throw new ProjectFileError(
        "ACTIVATION_RECEIPT_HASH_MISMATCH",
        "桌面切换回执指向的文件 Hash 已变化，不能重放旧结果。",
        { operationId: receipt.operationId },
      );
    }
    if (receipt.status === "pending") {
      await persistActivationReceipt(state, {
        ...receipt,
        status: "completed",
      });
    }
    return {
      ...project,
      previousSourcePath: receipt.previousSourcePath,
      ...(receipt.kind === "managed-working-copy"
        ? { operationId: receipt.operationId }
        : { versionId: receipt.versionId, operationId: receipt.operationId }),
    };
  }
  if (
    receipt.status === "pending"
    && activePathIdentity === receipt.previousSourcePath
    && sameActivationPredecessor(state, receipt)
  ) {
    // A pre-commit crash leaves the exact predecessor active. The caller may
    // continue the same durable operation, but it must never mint a new ID.
    // The persisted generation/effect pair is the identity fence; path alone
    // is intentionally insufficient because another activation may have
    // returned to the same path.
    return null;
  }
  if (receipt.status === "pending" && !receipt.predecessorProofValid) {
    throw new ProjectFileError(
      "ACTIVATION_PREDECESSOR_UNKNOWN",
      "这次桌面切换缺少可核对的前序 active effect，不能恢复。",
      { operationId: receipt.operationId },
    );
  }
  throw new ProjectFileError(
    "ACTIVATION_OPERATION_NOT_COMMITTED",
    "这次桌面切换的持久回执与当前活动 effect 不一致，不能伪造重放结果。",
    { operationId: receipt.operationId },
  );
}

function assertActiveManagedReconcilePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("活动工作文件定位参数无效。");
  }
  const allowedKeys = new Set([
    "previousSourcePath",
    "expectedSourceSha256",
    "projectId",
    "documentId",
    "workingCopyId",
    "versionId",
    "reason",
    "operationId",
    "watcherGeneration",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("活动工作文件定位参数包含未支持的字段。");
  }
  const previousSourcePath = assertHtmlPath(
    payload.previousSourcePath,
    "previousSourcePath",
  );
  const expectedSourceSha256 = String(payload.expectedSourceSha256 || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSourceSha256)) {
    throw new TypeError("expectedSourceSha256 必须使用 sha256:<64 位十六进制> 格式。");
  }
  const projectId = String(payload.projectId || "");
  const documentId = String(payload.documentId || "");
  const workingCopyId = String(payload.workingCopyId || "");
  const versionId = String(payload.versionId || "");
  const reason = String(payload.reason || "");
  const operationId = payload.operationId === undefined || payload.operationId === null
    ? ""
    : String(payload.operationId);
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !/^work_ver_\d{4,}$/.test(workingCopyId)
    || !/^ver_\d{4,}$/.test(versionId)
    || !["watch", "rename", "startup", "safe-action"].includes(reason)
    || !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
  ) {
    throw new TypeError("活动工作文件身份无效。");
  }
  return {
    previousSourcePath,
    expectedSourceSha256,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    reason,
    operationId,
    watcherGeneration: Number.isSafeInteger(Number(payload.watcherGeneration))
      ? Number(payload.watcherGeneration)
      : null,
  };
}

async function reconcileActiveManagedSource(payload) {
  return projectOpenQueue.run(() => reconcileActiveManagedSourceOperation(payload));
}

const E2E_RECONCILE_HASH_RACE_OPERATION_ID = "reconcile_e2e_hash_race_0001";
const E2E_RECONCILE_HASH_RACE_REPLACEMENT_HTML = [
  "<!doctype html>",
  "<html lang=\"zh-CN\">",
  "<head><meta charset=\"utf-8\"><title>竞态替换</title></head>",
  "<body><h1 data-e2e-reconcile-hash-race=\"1\">Bridge 核对完成后被外部替换的字节。</h1></body>",
  "</html>",
].join("\n");

async function reconcileActiveManagedSourceOperation(payload) {
  const requested = assertActiveManagedReconcilePayload(payload);
  const reconciled = await fetchBridgeCommand("/managed-working-copy/reconcile", {
    operationId: requested.operationId,
    previousSourcePath: requested.previousSourcePath,
    projectId: requested.projectId,
    documentId: requested.documentId,
    workingCopyId: requested.workingCopyId,
    versionId: requested.versionId,
    expectedSourceSha256: requested.expectedSourceSha256,
    reason: requested.reason,
  });
  const openTarget = reconciled.openTarget;
  if (
    !openTarget
    || typeof openTarget !== "object"
    || openTarget.targetKind !== "working-copy"
    || openTarget.projectId !== requested.projectId
    || openTarget.documentId !== requested.documentId
    || openTarget.workingCopyId !== requested.workingCopyId
    || openTarget.versionId !== requested.versionId
    || reconciled.operationId !== requested.operationId
    || openTarget.sourceSha256 !== reconciled.sourceSha256
    || typeof openTarget.exactSourcePath !== "string"
    || typeof openTarget.projectRootPath !== "string"
    || typeof reconciled.sourceSha256 !== "string"
  ) {
    throw new ProjectFileError(
      "MANAGED_SOURCE_IDENTITY_MISMATCH",
      "当前工作文件身份无法核对，PageRoot 没有切换路径。",
    );
  }
  const [previousSourcePath, nextSourcePath] = await Promise.all([
    existingPathIdentity(requested.previousSourcePath),
    existingPathIdentity(openTarget.exactSourcePath),
  ]);
  if (
    process.env.PAGEROOT_E2E === "1"
    && process.env.PAGEROOT_E2E_RECONCILE_REPLACE_BEFORE_READ === "1"
    && requested.operationId === E2E_RECONCILE_HASH_RACE_OPERATION_ID
  ) {
    // E2E-only injection: model an external editor replacing the Working Copy
    // after the Bridge reconcile finished but before Desktop reads the bytes.
    // The final hash comparison below must fail closed on this exact window.
    await writeFile(
      nextSourcePath,
      E2E_RECONCILE_HASH_RACE_REPLACEMENT_HTML,
      "utf8",
    );
  }
  const project = await readHtmlProject(nextSourcePath);
  if (project.sha256 !== reconciled.sourceSha256) {
    throw new ProjectFileError(
      "MANAGED_WORKING_COPY_HASH_MISMATCH",
      "托管工作文件与已确认的项目内容不一致，当前文件没有切换。",
      {
        expectedSha256: reconciled.sourceSha256,
        actualSha256: project.sha256,
      },
    );
  }
  const state = await loadProjectState();
  await commitActivatedProjectPath({
    state,
    previousSourcePath,
    nextSourcePath,
    project,
    managedLocator: activeManagedLocatorForActivatedPath(
      openTarget,
      nextSourcePath,
      reconciled.sourceSha256,
    ),
  });
  return {
    operationId: requested.operationId,
    status: reconciled.status,
    previousSourcePath,
    sourcePath: openTarget.exactSourcePath,
    sourceSha256: reconciled.sourceSha256,
    openTarget,
    watcherGeneration: sourceFileWatcher.watcherGeneration,
  };
}

async function activateManagedWorkingCopy(payload) {
  return projectOpenQueue.run(() => activateManagedWorkingCopyOperation(payload));
}

async function activateManagedWorkingCopyOperation(payload) {
  const requested = assertManagedWorkingCopyActivationPayload(payload);
  if (
    process.env.PAGEROOT_E2E === "1"
    && process.env.PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE === "1"
    && requested.versionId !== "ver_0001"
  ) {
    throw new ProjectFileError(
      "E2E_MANAGED_WORKING_COPY_OPEN_FAILED",
      "测试注入：新版本文件暂时无法打开。",
    );
  }
  const state = await loadProjectState();
  const [previousSourcePath, nextSourcePath] = await Promise.all([
    existingPathIdentity(requested.previousSourcePath),
    existingPathIdentity(requested.nextSourcePath),
  ]);
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const requestedActivation = {
    operationId: requested.operationId,
    projectId: requested.projectId,
    documentId: requested.documentId,
    workingCopyId: requested.workingCopyId,
    versionId: requested.versionId,
    expectedSha256: requested.expectedSha256,
    previousSourcePath,
    nextSourcePath,
    projectRootPath: requested.projectRootPath,
    completedAt: Date.now(),
  };
  const receiptCandidate = activationReceiptCandidate({
    kind: "managed-working-copy",
    operationId: requested.operationId,
    projectId: requested.projectId,
    documentId: requested.documentId,
    workingCopyId: requested.workingCopyId,
    versionId: requested.versionId,
    expectedSha256: requested.expectedSha256,
    previousSourcePath,
    nextSourcePath,
    projectRootPath: requested.projectRootPath,
    predecessorGeneration: state.activeEffectGeneration,
    predecessorEffect: state.activeEffect,
  });
  const existingReceipt = activationReceiptFor(state, requested.operationId);
  if (existingReceipt) {
    if (!sameActivationReceipt(existingReceipt, receiptCandidate)) {
      throw new ProjectFileError(
        "MANAGED_WORKING_COPY_OPERATION_MISMATCH",
        "同一托管工作文件操作不能改变目标或前序文件。",
        { operationId: requested.operationId },
      );
    }
    const replayed = await replayActivationReceipt(state, existingReceipt);
    if (replayed) return replayed;
    // A pending receipt with the exact predecessor is the pre-commit crash
    // window. Continue the already-recorded operation with the same receipt;
    // replayActivationReceipt throws for every other pending/completed mismatch.
  } else {
    if (activePathIdentity !== previousSourcePath) {
      throw new ProjectFileError(
        "MANAGED_WORKING_COPY_PREDECESSOR_CONFLICT",
        "当前桌面文件已变化，不能提交过期的托管工作文件切换。",
        {
          previousSourcePath: requested.previousSourcePath,
          activePath: state.activePath,
        },
      );
    }
    await persistActivationReceipt(state, receiptCandidate);
  }
  const managedActivation = requestedActivation;
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，当前文件没有切换。",
    );
  }

  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/workspace`);
  endpoint.searchParams.set("sourcePath", nextSourcePath);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: { "X-HTML-AI-Bridge-Token": bridgeAuthToken },
  });
  const workspace = await response.json().catch(() => null);
  const target = workspace?.openTarget;
  const exactTargetPath = typeof target?.exactSourcePath === "string"
    ? await existingPathIdentity(target.exactSourcePath)
    : null;
  const targetRootPath = typeof target?.projectRootPath === "string"
    ? path.resolve(target.projectRootPath)
    : "";
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.projectFileSchemaVersion !== "4.0.0"
    || workspace.projectId !== requested.projectId
    || workspace.documentId !== requested.documentId
    || workspace.currentHtmlSha256 !== requested.expectedSha256
    || !target
    || target.targetKind !== "working-copy"
    || target.projectId !== requested.projectId
    || target.documentId !== requested.documentId
    || target.workingCopyId !== requested.workingCopyId
    || target.versionId !== requested.versionId
    || target.sourceSha256 !== requested.expectedSha256
    || targetRootPath !== requested.projectRootPath
    || exactTargetPath !== nextSourcePath
  ) {
    throw new ProjectFileError(
      "MANAGED_WORKING_COPY_IDENTITY_MISMATCH",
      "项目记录无法确认这个托管工作文件，当前文件没有切换。",
      { nextSourcePath: requested.nextSourcePath },
    );
  }
  const project = await readHtmlProject(nextSourcePath);
  if (project.sha256 !== requested.expectedSha256) {
    throw new ProjectFileError(
      "MANAGED_WORKING_COPY_HASH_MISMATCH",
      "托管工作文件与已确认的项目内容不一致，当前文件没有切换。",
      {
        expectedSha256: requested.expectedSha256,
        actualSha256: project.sha256,
      },
    );
  }
  const activated = await commitActivatedProjectPath({
    state,
    previousSourcePath,
    nextSourcePath,
    project,
    importedAssetSourcePath: previousSourcePath,
    managedActivation,
    activeEffect: receiptCandidate,
  });
  await persistActivationReceipt(state, {
    ...receiptCandidate,
    status: "completed",
  });
  return {
    ...activated,
    operationId: requested.operationId,
  };
}

async function activateGeneratedVersionOperation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("新版本文件参数无效。");
  }
  const allowedKeys = new Set([
    "operationId",
    "previousSourcePath",
    "nextSourcePath",
    "expectedSha256",
    "projectId",
    "versionId",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("新版本文件参数包含未支持的字段。");
  }
  const previousSourcePath = assertHtmlPath(
    payload.previousSourcePath,
    "previousSourcePath",
  );
  const nextSourcePath = assertHtmlPath(
    payload.nextSourcePath,
    "nextSourcePath",
  );
  const operationId = payload.operationId === undefined || payload.operationId === null
    ? ""
    : String(payload.operationId);
  if (
    typeof payload.projectId !== "string"
    || !/^project_[A-Za-z0-9_-]+$/.test(payload.projectId)
    || typeof payload.versionId !== "string"
    || !/^ver_\d{4,}$/.test(payload.versionId)
    || typeof payload.expectedSha256 !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedSha256)
    || !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
  ) {
    throw new TypeError("新版本文件身份无效。");
  }
  if (
    process.env.PAGEROOT_E2E === "1"
    && process.env.PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE === "1"
  ) {
    throw new ProjectFileError(
      "E2E_GENERATED_VERSION_OPEN_FAILED",
      "测试注入：新版本文件暂时无法打开。",
    );
  }

  const state = await loadProjectState();
  const [resolvedPreviousPath, resolvedNextPath] = await Promise.all([
    realpath(previousSourcePath),
    realpath(nextSourcePath),
  ]);
  const receiptCandidate = activationReceiptCandidate({
    kind: "generated-version",
    operationId,
    projectId: payload.projectId,
    versionId: payload.versionId,
    expectedSha256: payload.expectedSha256,
    previousSourcePath: resolvedPreviousPath,
    nextSourcePath: resolvedNextPath,
    predecessorGeneration: state.activeEffectGeneration,
    predecessorEffect: state.activeEffect,
  });
  const existingReceipt = activationReceiptFor(state, operationId);
  if (existingReceipt) {
    if (!sameActivationReceipt(existingReceipt, receiptCandidate)) {
      throw new ProjectFileError(
        "GENERATED_VERSION_OPERATION_MISMATCH",
        "同一生成版本操作不能改变目标或前序文件。",
        { operationId },
      );
    }
    const replayed = await replayActivationReceipt(state, existingReceipt);
    if (replayed) return replayed;
    // The exact predecessor means the host commit did not reach the durable
    // active-effect record. Continue this pending operation with its original
    // operationId; any other pending/completed mismatch already throws above.
  }
  const knownPathIdentities = new Set(await Promise.all([
    state.activePath,
    ...state.recent.map((entry) => entry.path),
  ].filter(Boolean).map(existingPathIdentity)));
  if (
    !knownPathIdentities.has(resolvedPreviousPath)
    && !knownPathIdentities.has(resolvedNextPath)
  ) {
    throw new ProjectFileError(
      "UNKNOWN_SOURCE",
      "只能切换当前工作台已经打开的 HTML 项目。",
      { previousSourcePath, nextSourcePath },
    );
  }
  if (!existingReceipt) await persistActivationReceipt(state, receiptCandidate);
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，当前文件没有切换。",
    );
  }

  const sourceEndpoint = new URL(`http://127.0.0.1:${bridgePort}/source`);
  sourceEndpoint.searchParams.set("sourcePath", resolvedPreviousPath);
  const sourceResponse = await net.fetch(sourceEndpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const authoritativeSource = await sourceResponse.json().catch(() => null);
  if (
    !sourceResponse.ok
    || !authoritativeSource
    || authoritativeSource.ok !== true
    || authoritativeSource.projectId !== payload.projectId
    || authoritativeSource.currentExactVersionId !== payload.versionId
    || authoritativeSource.sha256 !== payload.expectedSha256
    || typeof authoritativeSource.sourcePath !== "string"
  ) {
    throw new ProjectFileError(
      "GENERATED_VERSION_IDENTITY_MISMATCH",
      "项目记录无法确认这个 AI 新版本，当前文件没有切换。",
    );
  }
  const authoritativeSourcePath = await realpath(authoritativeSource.sourcePath);
  if (authoritativeSourcePath !== resolvedNextPath) {
    throw new ProjectFileError(
      "GENERATED_VERSION_PATH_MISMATCH",
      "新版本路径与项目记录不一致，当前文件没有切换。",
      {
        expectedPath: authoritativeSource.sourcePath,
        requestedPath: nextSourcePath,
      },
    );
  }

  const workspaceRoot = await workspacePath().then((value) => realpath(value));
  const relativeNextPath = path.relative(workspaceRoot, resolvedNextPath);
  const pathParts = relativeNextPath.split(path.sep);
  if (
    typeof authoritativeSource.storageDirectoryName !== "string"
    || !authoritativeSource.storageDirectoryName
    || pathParts.length !== 4
    || pathParts[0] !== "projects"
    || pathParts[1] !== authoritativeSource.storageDirectoryName
    || pathParts[2] !== "working"
    || !isGeneratedWorkingCopyFileName(pathParts[3])
  ) {
    throw new ProjectFileError(
      "UNSAFE_GENERATED_VERSION_PATH",
      "只能打开当前项目记录中新生成的版本 HTML。",
      { nextSourcePath: resolvedNextPath },
    );
  }
  const nextStats = await lstat(resolvedNextPath);
  if (!nextStats.isFile() || nextStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "GENERATED_VERSION_NOT_REGULAR",
      "新版本不是可编辑的普通 HTML 文件。",
    );
  }
  const project = await readHtmlProject(resolvedNextPath);
  if (project.sha256 !== payload.expectedSha256) {
    throw new ProjectFileError(
      "GENERATED_VERSION_HASH_MISMATCH",
      "新版本文件与已确认的 AI 结果不一致，当前项目没有切换。",
      {
        expectedSha256: payload.expectedSha256,
        actualSha256: project.sha256,
      },
    );
  }

  const activated = await commitActivatedProjectPath({
    state,
    previousSourcePath: resolvedPreviousPath,
    nextSourcePath: resolvedNextPath,
    project,
    activeEffect: receiptCandidate,
  });
  await persistActivationReceipt(state, {
    ...receiptCandidate,
    status: "completed",
  });
  return {
    ...activated,
    versionId: payload.versionId,
    operationId,
  };
}

async function revealVersionFile(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("历史版本参数无效。");
  }
  const allowedKeys = new Set(["sourcePath", "versionId"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("历史版本参数包含未支持的字段。");
  }
  const sourcePath = assertReadPayload(payload.sourcePath);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  if (
    typeof payload.versionId !== "string"
    || !/^ver_\d{4,}$/.test(payload.versionId)
  ) {
    throw new TypeError("历史版本编号无效。");
  }
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }

  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/version-file`);
  endpoint.searchParams.set("sourcePath", sourcePath);
  endpoint.searchParams.set("versionId", payload.versionId);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const versionRecord = await response.json().catch(() => null);
  if (
    !response.ok
    || !versionRecord
    || versionRecord.ok !== true
    || versionRecord.versionId !== payload.versionId
    || typeof versionRecord.projectId !== "string"
    || typeof versionRecord.path !== "string"
  ) {
    throw new ProjectFileError(
      "VERSION_FILE_UNAVAILABLE",
      "这个历史版本文件暂时无法显示，请重新打开版本历史后再试。",
    );
  }

  if (versionRecord.projectFileSchemaVersion === "4.0.0") {
    if (
      typeof versionRecord.projectRootPath !== "string"
      || typeof versionRecord.workingCopyId !== "string"
      || !/^work_ver_\d{4,}$/.test(versionRecord.workingCopyId)
      || typeof versionRecord.visibleWorkingCopyPath !== "string"
      || typeof versionRecord.workingCopySha256 !== "string"
    ) {
      throw new ProjectFileError(
        "VERSION_WORKING_COPY_UNAVAILABLE",
        "这个版本没有可验证的可见 Working Copy。",
      );
    }
    const [resolvedProjectRoot, resolvedWorkingCopyPath] = await Promise.all([
      realpath(path.resolve(versionRecord.projectRootPath)),
      realpath(path.resolve(versionRecord.visibleWorkingCopyPath)),
    ]);
    const rootStats = await lstat(resolvedProjectRoot);
    const relativeWorkingCopyPath = path.relative(
      resolvedProjectRoot,
      resolvedWorkingCopyPath,
    );
    if (
      !rootStats.isDirectory()
      || rootStats.isSymbolicLink()
      || !relativeWorkingCopyPath
      || relativeWorkingCopyPath.startsWith(`..${path.sep}`)
      || relativeWorkingCopyPath === ".."
      || path.isAbsolute(relativeWorkingCopyPath)
      || relativeWorkingCopyPath.split(path.sep).includes(".pageroot")
      || !HTML_EXTENSIONS.has(path.extname(resolvedWorkingCopyPath).toLowerCase())
    ) {
      throw new ProjectFileError(
        "UNSAFE_VERSION_WORKING_COPY_PATH",
        "只能显示该项目已验证的可见 Version Working Copy。",
        { versionPath: resolvedWorkingCopyPath },
      );
    }
    const workingCopyStats = await lstat(resolvedWorkingCopyPath);
    if (!workingCopyStats.isFile() || workingCopyStats.isSymbolicLink()) {
      throw new ProjectFileError(
        "VERSION_WORKING_COPY_NOT_REGULAR",
        "这个 Version Working Copy 不是可显示的普通 HTML 文件。",
      );
    }
    const workingCopy = await readHtmlProject(resolvedWorkingCopyPath);
    if (workingCopy.sha256 !== versionRecord.workingCopySha256) {
      throw new ProjectFileError(
        "VERSION_WORKING_COPY_HASH_MISMATCH",
        "Version Working Copy 在验证后已改变，尚未在文件夹中打开。",
        {
          expectedSha256: versionRecord.workingCopySha256,
          actualSha256: workingCopy.sha256,
        },
      );
    }
    shell.showItemInFolder(resolvedWorkingCopyPath);
    return {
      sourcePath,
      versionId: payload.versionId,
      versionPath: resolvedWorkingCopyPath,
    };
  }

  const [workspaceRoot, resolvedVersionPath] = await Promise.all([
    workspacePath().then((value) => realpath(value)),
    realpath(path.resolve(versionRecord.path)),
  ]);
  const relativeVersionPath = path.relative(
    workspaceRoot,
    resolvedVersionPath,
  );
  if (
    typeof versionRecord.storageDirectoryName !== "string"
    ||
    !relativeVersionPath
    || relativeVersionPath.startsWith(`..${path.sep}`)
    || relativeVersionPath === ".."
    || path.isAbsolute(relativeVersionPath)
    || !isManagedVersionRelativePath(relativeVersionPath, {
      projectId: versionRecord.projectId,
      storageDirectoryName: versionRecord.storageDirectoryName,
      versionId: payload.versionId,
    })
  ) {
    throw new ProjectFileError(
      "UNSAFE_VERSION_PATH",
      "只能显示当前项目记录中的历史 HTML。",
      { versionPath: resolvedVersionPath },
    );
  }
  const versionStats = await lstat(resolvedVersionPath);
  if (!versionStats.isFile() || versionStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "VERSION_FILE_NOT_REGULAR",
      "这个历史版本不是可显示的普通 HTML 文件。",
    );
  }
  shell.showItemInFolder(resolvedVersionPath);
  return {
    sourcePath,
    versionId: payload.versionId,
    versionPath: resolvedVersionPath,
  };
}

async function revealAiTask(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("AI 任务参数无效。");
  }
  const allowedKeys = new Set(["sourcePath"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("AI 任务参数包含未支持的字段。");
  }
  const sourcePath = assertReadPayload(payload.sourcePath);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }

  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/ai-task`);
  endpoint.searchParams.set("sourcePath", sourcePath);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const taskRecord = await response.json().catch(() => null);
  if (
    !response.ok
    || !taskRecord
    || taskRecord.ok !== true
    || taskRecord.projectFileSchemaVersion !== "4.0.0"
    || typeof taskRecord.projectId !== "string"
    || typeof taskRecord.documentId !== "string"
    || typeof taskRecord.sourcePath !== "string"
    || typeof taskRecord.projectRootPath !== "string"
    || typeof taskRecord.aiTaskPath !== "string"
    || typeof taskRecord.aiTaskRelativePath !== "string"
  ) {
    throw new ProjectFileError(
      "AI_TASK_UNAVAILABLE",
      "这个 AI 任务暂时无法在文件夹中打开，请稍后重试。",
    );
  }
  const [resolvedSourcePath, returnedSourcePath, resolvedProjectRoot, resolvedTaskPath] = await Promise.all([
    realpath(path.resolve(sourcePath)),
    realpath(path.resolve(taskRecord.sourcePath)),
    realpath(path.resolve(taskRecord.projectRootPath)),
    realpath(path.resolve(taskRecord.aiTaskPath)),
  ]);
  const rootStats = await lstat(resolvedProjectRoot);
  const relativeTaskPath = path.relative(resolvedProjectRoot, resolvedTaskPath);
  const expectedRelativePath = taskRecord.aiTaskRelativePath.replaceAll("/", path.sep);
  if (
    returnedSourcePath !== resolvedSourcePath
    || !rootStats.isDirectory()
    || rootStats.isSymbolicLink()
    || !relativeTaskPath
    || relativeTaskPath.startsWith(`..${path.sep}`)
    || relativeTaskPath === ".."
    || path.isAbsolute(relativeTaskPath)
    || relativeTaskPath !== expectedRelativePath
    || !taskRecord.aiTaskRelativePath.startsWith("AI任务/")
    || taskRecord.aiTaskRelativePath.split("/").length !== 2
    || taskRecord.aiTaskRelativePath.includes("/.pageroot/")
  ) {
    throw new ProjectFileError(
      "UNSAFE_AI_TASK_PATH",
      "只能打开当前项目已经验证的 AI任务 文件夹。",
      { aiTaskPath: resolvedTaskPath },
    );
  }
  const taskStats = await lstat(resolvedTaskPath);
  if (!taskStats.isDirectory() || taskStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "AI_TASK_NOT_DIRECTORY",
      "这个 AI任务 不是可打开的普通文件夹。",
    );
  }
  const openError = await shell.openPath(resolvedTaskPath);
  if (openError) throw new Error(openError);
  return {
    sourcePath,
    aiTaskPath: resolvedTaskPath,
    requestId: taskRecord.requestId,
    candidateId: taskRecord.candidateId,
  };
}

async function exportHtmlCopy(payload) {
  const { html, sourcePath, suggestedName } = assertExportPayload(payload);
  const activePath = await currentActivePath();
  const defaultDirectory = sourcePath
    ? path.dirname(sourcePath)
      : activePath
        ? path.dirname(activePath)
        : path.dirname(projectsRootPath());
  const requestedName = suggestedName
    || (sourcePath ? path.basename(sourcePath) : null)
    || (activePath ? path.basename(activePath) : null)
    || "HTML.html";
  const protectedPaths = [sourcePath, activePath].filter(Boolean);
  const defaultPath = await createSafeExportDefaultPath({
    directoryPath: defaultDirectory,
    suggestedName: requestedName,
    sourcePath,
    activePath,
  });
  const destinationPath = await selectExportDestination({
    defaultPath,
    protectedPaths,
    normalizeDestination: (value) => assertHtmlPath(normalizeHtmlExportPath(value)),
    showSaveDialog: (safeDefaultPath) => dialog.showSaveDialog(mainWindow, {
      title: "导出 HTML 副本",
      buttonLabel: "导出 HTML 副本",
      defaultPath: safeDefaultPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
      filters: [
        { name: "HTML 文件", extensions: ["html", "htm"] },
      ],
    }),
  });
  if (!destinationPath) return null;

  // Recheck immediately before writing so a path alias or hard link created
  // while the save dialog was open still cannot target the source file.
  if (await isProtectedExportDestination(destinationPath, protectedPaths)) {
    throw new ProjectFileError(
      "EXPORT_OVER_SOURCE",
      "导出位置刚刚发生变化，源文件没有被改动。请重新选择位置。",
      { destinationPath },
    );
  }
  const exported = await writeHtmlCopy({
    destinationPath,
    html,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
  // Export is deliberately not activated and does not mutate recent files.
  return {
    ...exported,
    exported: true,
  };
}

async function listRecentProjects() {
  const state = await loadProjectState();
  return Promise.all(state.recent.map(async (entry) => {
    const sourcePath = await existingPathIdentity(entry.path);
    return {
      path: sourcePath,
      sourcePath,
      name: entry.name,
      lastOpenedAt: entry.lastOpenedAt,
    };
  }));
}

function assertRegisteredProjectId(value) {
  const projectId = String(value || "");
  if (!/^project_[a-f0-9]{16,64}$/u.test(projectId)) {
    throw new TypeError("项目身份无效。");
  }
  return projectId;
}

function assertRegisteredProjectCatalogRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_CATALOG_INVALID",
      "项目目录返回了无效记录。",
    );
  }
  const availability = String(value.availability || "");
  const projectId = assertRegisteredProjectId(value.projectId);
  const lastUpdatedAt = value.lastUpdatedAt == null
    ? null
    : String(value.lastUpdatedAt);
  if (
    !["ready", "unavailable", "invalid"].includes(availability)
    || typeof value.projectName !== "string"
    || !value.projectName
    || typeof value.registeredProjectRootPath !== "string"
    || !value.registeredProjectRootPath
    || (lastUpdatedAt !== null && Number.isNaN(Date.parse(lastUpdatedAt)))
  ) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_CATALOG_INVALID",
      "项目目录包含无效记录。",
    );
  }
  const ready = availability === "ready";
  if (
    ready
    && (
      !/^doc_[a-f0-9]{16,64}$/u.test(String(value.documentId || ""))
      || !/^work_ver_\d{4,}$/u.test(String(value.activeWorkingCopyId || ""))
      || !/^ver_\d{4,}$/u.test(String(value.currentBasedOnVersionId || ""))
      || !/^ver_\d{4,}$/u.test(String(value.latestOfficialVersionId || ""))
      || !value.activeSourcePath
    )
  ) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_CATALOG_INVALID",
      "可打开项目缺少经过验证的目标。",
    );
  }
  return Object.freeze({
    projectId,
    documentId: /^doc_[a-f0-9]{16,64}$/u.test(String(value.documentId || "")) ? String(value.documentId) : null,
    projectName: value.projectName,
    registeredProjectRootPath: path.resolve(value.registeredProjectRootPath),
    activeWorkingCopyId: ready ? String(value.activeWorkingCopyId) : null,
    activeSourcePath: ready ? assertHtmlPath(value.activeSourcePath, "activeSourcePath") : null,
    currentBasedOnVersionId: ready ? String(value.currentBasedOnVersionId) : null,
    latestOfficialVersionId: ready ? String(value.latestOfficialVersionId) : null,
    hasPendingCandidate: value.hasPendingCandidate === true,
    availability,
    sourceStatus: ["unknown", "ready", "external-change", "missing", "duplicate", "invalid"].includes(value.sourceStatus) ? value.sourceStatus : "invalid",
    canRestoreWorkingCopy: value.canRestoreWorkingCopy === true,
    availabilityReason: typeof value.availabilityReason === "string"
      ? value.availabilityReason
      : null,
    lastUpdatedAt,
  });
}

function registeredProjectTimestamp(value) {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function assertRegisteredProjectVersionSummary(value, projectId, documentId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_VERSIONS_INVALID",
      "项目版本摘要包含无效记录。",
    );
  }
  const versionId = String(value.versionId || "");
  const ordinal = Number(value.ordinal);
  const basedOnVersionId = value.basedOnVersionId ? String(value.basedOnVersionId) : null;
  const previousVersionId = value.previousVersionId ? String(value.previousVersionId) : null;
  const displayFileName = String(value.displayFileName || "");
  const modifiedAt = String(value.modifiedAt || "");
  if (
    value.projectId !== projectId
    || value.documentId !== documentId
    || !/^ver_\d{4,}$/u.test(versionId)
    || !Number.isSafeInteger(ordinal)
    || ordinal < 1
    || (basedOnVersionId !== null && !/^ver_\d{4,}$/u.test(basedOnVersionId))
    || (previousVersionId !== null && !/^ver_\d{4,}$/u.test(previousVersionId))
    || !/^[^/\\\u0000-\u001f]{1,255}\.html?$/iu.test(displayFileName)
    || !modifiedAt
    || Number.isNaN(Date.parse(modifiedAt))
    || typeof value.isActiveWorkingCopy !== "boolean"
    || typeof value.isLatestOfficial !== "boolean"
  ) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_VERSIONS_INVALID",
      "项目版本摘要包含无效字段。",
    );
  }
  return Object.freeze({
    projectId,
    documentId,
    versionId,
    ordinal,
    basedOnVersionId,
    previousVersionId,
    displayFileName,
    modifiedAt,
    isActiveWorkingCopy: value.isActiveWorkingCopy,
    isLatestOfficial: value.isLatestOfficial,
  });
}

async function fetchBridgeJson(pathname) {
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }
  const response = await net.fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    cache: "no-store",
    headers: { "X-HTML-AI-Bridge-Token": bridgeAuthToken },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_BRIDGE_REJECTED",
      "项目目录暂时无法完成安全核对。",
    );
  }
  return payload;
}

async function fetchBridgeCommand(pathname, body) {
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }
  const response = await net.fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const error = payload?.error && typeof payload.error === "object"
    ? payload.error
    : {};
  if (!response.ok || !payload || payload.ok !== true) {
    throw new ProjectFileError(
      String(error.code || "REGISTERED_PROJECT_BRIDGE_REJECTED"),
      String(error.message || "项目目录暂时无法完成安全核对。"),
      error.details && typeof error.details === "object" ? error.details : {},
    );
  }
  return payload;
}

async function restoreRememberedAgentCredential() {
  if (process.env.PAGEROOT_E2E === "1") {
    return Object.freeze({ ok: true, restored: false });
  }
  try {
    const preferences = await readUiPreferences({
      userDataPath: app.getPath("userData"),
    });
    if (preferences.workspace.disabledAgentProviderIds.includes("pageroot")) {
      return Object.freeze({ ok: true, restored: false });
    }
    const loaded = typeof agentSessionCredentialStore.loadResult === "function"
      ? await agentSessionCredentialStore.loadResult()
      : Object.freeze({
        status: "loaded",
        credential: await agentSessionCredentialStore.load(),
      });
    if (loaded.status === "missing") {
      rememberedCredentialRestoreFailure = null;
      return Object.freeze({ ok: true, restored: false });
    }
    if (loaded.status !== "loaded" || !loaded.credential?.apiKey) {
      rememberedCredentialRestoreFailure = Object.freeze({
        code: loaded.reason || "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
        reason: "无法读取已保存的连接凭证。你仍可编辑项目。",
        reconnectRequired: true,
      });
      return Object.freeze({
        ok: false,
        restored: false,
        code: rememberedCredentialRestoreFailure.code,
        reason: rememberedCredentialRestoreFailure.reason,
        reconnectRequired: true,
      });
    }
    const credential = loaded.credential;
    await fetchBridgePost("/agent/session-credential", {
      providerId: credential.providerId,
      apiKey: credential.apiKey,
      vendorId: credential.vendorId,
      baseUrl: credential.baseUrl,
      ...(credential.modelId ? { modelId: credential.modelId } : {}),
    });
    rememberedCredentialRestoreFailure = null;
    return Object.freeze({ ok: true, restored: true });
  } catch {
    // Remembered Key restore is best-effort; the user can reconnect this session.
    rememberedCredentialRestoreFailure = Object.freeze({
      code: "AGENT_CREDENTIAL_RESTORE_FAILED",
      reason: "无法读取已保存的连接凭证。你仍可编辑项目。",
      reconnectRequired: true,
    });
    return Object.freeze({
      ok: false,
      restored: false,
      code: rememberedCredentialRestoreFailure.code,
      reason: rememberedCredentialRestoreFailure.reason,
      reconnectRequired: true,
    });
  }
}

async function sessionCredentialStatus() {
  // Startup restore is deliberately best-effort, but wait for its one attempt
  // before reporting the remembered state so a keychain denial is visible to
  // the renderer instead of being mistaken for a healthy saved credential.
  await rememberedCredentialRestorePromise.catch(() => {});
  const status = await agentSessionCredentialStore.publicStatus();
  return rememberedCredentialRestoreFailure
    ? Object.freeze({ ...status, ...rememberedCredentialRestoreFailure, unreadable: true })
    : status;
}

async function restoreRegisteredWorkingCopy(projectIdInput) {
  return fetchBridgePost("/registered-project/restore-working-copy", { projectId: assertRegisteredProjectId(projectIdInput) });
}

async function listRegisteredProjects() {
  const payload = await fetchBridgeJson("/registered-projects");
  if (!Array.isArray(payload.projects)) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_CATALOG_INVALID",
      "项目目录返回了无效列表。",
    );
  }
  const state = await loadProjectState();
  const recentTimes = new Map(state.recent.map((entry) => [
    path.resolve(entry.path),
    Number(entry.lastOpenedAt) || 0,
  ]));
  return payload.projects
    .map(assertRegisteredProjectCatalogRow)
    .map((project) => Object.freeze({
      ...project,
      lastOpenedAt: project.activeSourcePath
        ? recentTimes.get(path.resolve(project.activeSourcePath)) || null
        : null,
    }))
    .sort((left, right) => (
      (registeredProjectTimestamp(right.lastUpdatedAt) === null)
        - (registeredProjectTimestamp(left.lastUpdatedAt) === null)
      || (registeredProjectTimestamp(right.lastUpdatedAt) || 0)
        - (registeredProjectTimestamp(left.lastUpdatedAt) || 0)
      || left.projectName.localeCompare(right.projectName, "zh-CN")
      || left.projectId.localeCompare(right.projectId)
    ));
}

async function listRegisteredProjectVersionSummaries(projectIdInput) {
  const projectId = assertRegisteredProjectId(projectIdInput);
  const payload = await fetchBridgeJson(
    `/registered-project/versions?projectId=${encodeURIComponent(projectId)}`,
  );
  const documentId = String(payload.documentId || "");
  if (
    payload.projectId !== projectId
    || !/^doc_[a-f0-9]{16,64}$/u.test(documentId)
    || !Array.isArray(payload.versions)
  ) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_VERSIONS_INVALID",
      "项目目录未返回可展示的版本摘要。",
    );
  }
  return Object.freeze({
    projectId,
    documentId,
    currentBasedOnVersionId: payload.currentBasedOnVersionId ?? null,
    latestVersionId: payload.latestVersionId ?? null,
    versions: Object.freeze(payload.versions.map((version) => (
      assertRegisteredProjectVersionSummary(version, projectId, documentId)
    ))),
  });
}

async function readRegisteredProjectProjection(projectIdInput, expectedTarget = null) {
  const projectId = assertRegisteredProjectId(projectIdInput);
  const payload = await fetchBridgeJson(
    `/registered-project/open?projectId=${encodeURIComponent(projectId)}${expectedTarget ? `&workingCopyId=${encodeURIComponent(expectedTarget.workingCopyId)}` : ""}`,
  );
  const target = payload.openTarget;
  if (
    !target
    || typeof target !== "object"
    || target.targetKind !== "working-copy"
    || target.projectId !== projectId
    || (expectedTarget && (target.documentId !== expectedTarget.documentId
      || target.workingCopyId !== expectedTarget.workingCopyId
      || target.versionId !== expectedTarget.versionId))
    || payload.projectId !== projectId
    || !/^doc_[a-f0-9]{16,64}$/u.test(String(target.documentId || ""))
    || !/^work_ver_\d{4,}$/u.test(String(target.workingCopyId || ""))
    || !/^ver_\d{4,}$/u.test(String(target.versionId || ""))
    || typeof target.projectRootPath !== "string"
    || !target.projectRootPath
    || !/^sha256:[a-f0-9]{64}$/u.test(String(payload.sourceSha256 || ""))
    || target.sourceSha256 !== payload.sourceSha256
    || typeof payload.content !== "string"
    || typeof payload.lastModifiedAt !== "string"
    || !payload.lastModifiedAt
  ) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_TARGET_INVALID",
      "项目目录未返回可安全打开的工作文件。",
    );
  }
  const requestedSourcePath = assertHtmlPath(payload.sourcePath, "sourcePath");
  const targetSourcePath = assertHtmlPath(target.exactSourcePath, "openTarget.exactSourcePath");
  const [sourcePath, exactTargetPath] = await Promise.all([
    existingPathIdentity(requestedSourcePath),
    existingPathIdentity(targetSourcePath),
  ]);
  if (!sameManagedPath(sourcePath, exactTargetPath)) {
    throw new ProjectFileError(
      "REGISTERED_PROJECT_PATH_MISMATCH",
      "项目目录目标路径与经过验证的工作文件不一致。",
    );
  }

  // Renderer supplied only projectId. Repository has already resolved the
  // Registry, recovered the Working Copy locator and read the exact bytes in
  // one serialized operation. Keep that tuple intact here; repeating
  // /workspace and readHtmlProject delayed first paint and widened the race
  // window without adding a stronger authority boundary.
  const project = Object.freeze({
    sourcePath,
    path: sourcePath,
    name: path.basename(sourcePath),
    html: payload.content,
    sha256: payload.sourceSha256,
    lastModifiedAt: payload.lastModifiedAt,
  });
  return Object.freeze({
    ...projectWithIdentity(project, target),
    openTarget: Object.freeze({ ...target }),
  });
}

async function openRegisteredProject(projectIdInput) {
  return projectOpenQueue.run(async () => {
    const project = await readRegisteredProjectProjection(projectIdInput);
    const { sourcePath, openTarget: target } = project;
    const state = await loadProjectState();
    const recentIdentities = await Promise.all(state.recent.map(async (entry) => ({
      entry,
      identity: await existingPathIdentity(entry.path).catch(() => null),
    })));
    bumpActiveEffectGeneration(state);
    state.activePath = sourcePath;
    state.lastManagedActivation = null;
    state.activeEffect = null;
    state.activeManagedLocator = activeManagedLocatorForActivatedPath(
      target,
      sourcePath,
      project.sha256,
    );
    state.recent = [
      {
        path: sourcePath,
        name: path.basename(sourcePath),
        lastOpenedAt: Date.now(),
      },
      ...recentIdentities
        .filter((entry) => entry.identity !== sourcePath)
        .map((entry) => entry.entry),
    ].slice(0, MAX_RECENT_PROJECTS);
    await persistProjectState();
    await restoreActiveImportedAssetSource(sourcePath);
    sourceFileWatcher.watch(sourcePath);
    return project;
  });
}

async function openRecent(filePath) {
  return projectOpenQueue.run(async () => {
    const normalizedPath = assertHtmlPath(filePath);
    const state = await loadProjectState();
    const requestedIdentity = await existingPathIdentity(normalizedPath);
    const recentIdentities = await Promise.all(
      state.recent.map((entry) => existingPathIdentity(entry.path)),
    );
    if (!recentIdentities.includes(requestedIdentity)) {
      throw new ProjectFileError(
        "NOT_RECENT_PROJECT",
        "该文件已从最近项目中移除，请用“打开本地 HTML”重新选择。",
      );
    }

    try {
      return await prepareOrOpenFromPath(normalizedPath);
    } catch (error) {
      if (error?.code === "ENOENT") await forgetProject(normalizedPath);
      throw error;
    }
  });
}

async function forgetRecentProject(filePath) {
  return projectOpenQueue.run(async () => {
    const normalizedPath = assertHtmlPath(filePath);
    await forgetProject(normalizedPath);
    return { sourcePath: normalizedPath };
  });
}

function publishApplicationUpdateStatus(result) {
  latestUpdateResult = result;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UPDATE_CHANNELS.status, result);
  }
}

function ensureApplicationUpdateController() {
  if (applicationUpdate) return applicationUpdate;
  applicationUpdate = createApplicationUpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    architecture: process.arch,
    enabled: (
      runtimeChannel === "stable"
      && app.isPackaged
      && process.platform === "darwin"
      && process.env.PAGEROOT_E2E !== "1"
    ),
    onStatus: publishApplicationUpdateStatus,
  });
  latestUpdateResult = applicationUpdate.getStatus();
  return applicationUpdate;
}

async function checkForApplicationUpdates() {
  return ensureApplicationUpdateController().checkForUpdates();
}

async function downloadApplicationUpdate() {
  return ensureApplicationUpdateController().downloadAvailableUpdate();
}

async function openLatestRelease() {
  await shell.openExternal(LATEST_RELEASE_PAGE_URL);
  return { opened: true };
}

async function openProjectRepository() {
  await shell.openExternal(PROJECT_REPOSITORY_URL);
  return { opened: true };
}

function userNoticePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, USER_NOTICE_FILE_NAME)
    : path.join(directory, "..", USER_NOTICE_FILE_NAME);
}

async function openUserNotice() {
  const openError = await shell.openPath(userNoticePath());
  if (openError) {
    throw new ProjectFileError(
      "USER_NOTICE_OPEN_FAILED",
      "声明文件没有打开，请重新安装源页后重试。",
    );
  }
  return { opened: true };
}

function registerProjectIpc() {
  if (projectIpcRegistered) return;
  projectIpcRegistered = true;

  const { assertTrustedEvent, trusted, trustedProject } = createTrustedIpc({
    getMainWindow: () => mainWindow,
    isTrustedRendererUrl,
    captureUsage,
  });

  registerProjectIpcChannels({
    ipcMain,
    trustedProject,
    PROJECT_CHANNELS,
    PREVIEW_CHANNELS,
    EDIT_RUNTIME_CHANNELS,
    handlers: {
      getActiveProject,
      openHtml,
      readHtml,
      exportHtmlCopy,
      showInFolder,
      openProjectsRoot,
      openInDefaultBrowser,
      renameHtml,
      activateGeneratedVersion,
      activateManagedWorkingCopy,
      reconcileActiveManagedSource,
      revealVersionFile,
      revealAiTask,
      listRecentProjects,
      listRegisteredProjects,
      restoreRegisteredWorkingCopy,
      listRegisteredProjectVersionSummaries,
      readRegisteredProjectProjection,
      openRegisteredProject,
      openRecent,
      forgetRecentProject,
      acceptExternalFileOpen,
      acknowledgeExternalFileOpen,
      commitPreparedHtmlOpen,
      cancelPreparedHtmlOpen,
      finalizePreparedHtmlOpen,
      rollbackPreparedHtmlOpen,
      commitRecoveryJournal: (payload) => requireRecoveryJournal().commit(payload),
      readRecoveryJournal: (payload) => requireRecoveryJournal().readVerified(payload),
      rebaseRecoveryJournal: (payload) => requireRecoveryJournal().rebase(payload),
      removeRecoveryJournal: (payload) => requireRecoveryJournal().remove(payload),
      listRecoveryJournals: (payload) => recoveryJournalAvailable
        ? recoveryJournalStore.listRecoverable(payload)
        : Promise.resolve({
            entries: [],
            invalidCount: 0,
            scannedCount: 0,
            totalBytes: 0,
            truncated: false,
            nextCursor: null,
            unavailable: true,
          }),
      createPreviewSession,
      revokePreviewSession: (sessionId) => (
        ensurePreviewProtocolController().revokeSession(sessionId)
      ),
      prepareEditAuthorRuntime,
      revokeEditAuthorRuntime,
    },
  });
  registerAgentIpc({
    ipcMain,
    trustedProject,
    INTEGRATION_CHANNELS,
    clipboard,
    openAgentLogin: async (providerId) => {
      const payload = await fetchBridgeJson(
        `/agent/login/url?providerId=${encodeURIComponent(providerId)}`,
      );
      const loginUrl = publicAgentLoginUrl(payload?.loginUrl, { providerId });
      if (!loginUrl) {
        throw new ProjectFileError(
          "AGENT_LOGIN_URL_UNAVAILABLE",
          "官方登录页暂时无法打开。",
        );
      }
      await shell.openExternal(loginUrl);
      return Object.freeze({ opened: true });
    },
    openVendorApiKeyPage: async (vendorId) => {
      const keyUrl = publicAgentVendorKeyUrl(vendorId);
      if (!keyUrl) {
        throw new ProjectFileError(
          "AGENT_VENDOR_KEY_UNSUPPORTED",
          "当前服务没有经过校验的 API Key 页面。",
        );
      }
      await shell.openExternal(keyUrl);
      return Object.freeze({ opened: true });
    },
    persistSessionCredential: async (payload) => {
      const result = await agentSessionCredentialStore.persist(payload);
      if (result?.ok === true) rememberedCredentialRestoreFailure = null;
      return result;
    },
    clearSessionCredential: async () => {
      const result = await agentSessionCredentialStore.clear();
      rememberedCredentialRestoreFailure = null;
      return result;
    },
    sessionCredentialStatus,
    restoreSessionCredential: () => restoreRememberedAgentCredential(),
  });
  registerUpdateIpc({
    ipcMain,
    trustedProject,
    UPDATE_CHANNELS,
    getLatestUpdateResult: () => latestUpdateResult,
    checkForApplicationUpdates,
    downloadApplicationUpdate,
    ensureApplicationUpdateController,
    coordinateApplicationUpdateInstall,
    openLatestRelease,
    openProjectRepository,
  });
  registerWindowIpc({
    ipcMain,
    trusted,
    trustedProject,
    APP_CHANNELS,
    EDIT_CHANNELS,
    UI_PREFERENCE_CHANNELS,
    USAGE_CHANNELS,
    WORKBENCH_TAB_CHANNELS,
    openUserNotice,
    reportCloseResult,
    acknowledgeWorkspaceRecoveryReady: () => ({
      issue: workspaceRecoveryMailbox.acknowledgeRendererReady(),
    }),
    peekExternalOpenReady: () => publicMailboxRequest(externalFileOpenMailbox.peek()),
    peekExternalOpenFailed: () => externalOpenFailureMailbox.peek(),
    relaunchApplication: async () => ({
      relaunched: await coordinateApplicationRelaunch("user-relaunch"),
    }),
    applyNativeHistory: (direction) => {
      if (direction !== "undo" && direction !== "redo") {
        throw new TypeError("原生编辑历史方向无效。");
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { applied: false };
      }
      if (direction === "undo") mainWindow.webContents.undo();
      else mainWindow.webContents.redo();
      return { applied: true };
    },
    getUiPreferences: async () => readUiPreferences({
      userDataPath: app.getPath("userData"),
    }),
    recordUiPreference: async (payload) => {
      const userDataPath = app.getPath("userData");
      return recordUiWorkspacePreferences({
        userDataPath,
        workspace: payload?.workspace,
      });
    },
    getWorkbenchTabs: () => readWorkbenchTabsState({
      userDataPath: app.getPath("userData"),
    }),
    setWorkbenchTabs: (payload) => persistWorkbenchTabsState(payload),
    assertTrustedEvent,
    captureUsageFromRenderer: (payload) => usageTelemetry?.captureFromRenderer(payload),
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("无法分配本地服务端口。"));
      });
    });
  });
}

function bridgeScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "workspace-bridge.mjs")
    : path.join(directory, "..", "bridge", "workspace-bridge.mjs");
}

function rendererPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "dist-desktop", "renderer", "index.html")
    : path.join(directory, "..", "dist-desktop", "renderer", "index.html");
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "file:"
      && path.resolve(fileURLToPath(url)) === path.resolve(rendererPath());
  } catch {
    return false;
  }
}

async function reportCloseResult(payload) {
  const result = normalizeCloseResult(payload);
  if (!closeRequest || closeRequest.requestId !== result.requestId) {
    return { accepted: false, reason: "request-expired" };
  }

  const pending = closeRequest;
  closeRequest = null;
  clearTimeout(pending.timeout);
  pending.resolve({
    ...result,
    closeGeneration: pending.closeAuthority.generation,
  });
  return { accepted: true };
}

function requestRendererClose(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({
      requestId: null,
      closeGeneration: null,
      ready: true,
      reason: null,
      presentation: null,
    });
  }
  // Before the first renderer load there is no editable document or queued
  // renderer write to drain, so startup failures can exit without a timeout.
  if (!rendererHasLoaded) {
    return Promise.resolve({
      requestId: null,
      closeGeneration: null,
      ready: true,
      reason: null,
      presentation: null,
    });
  }
  if (closeRequest) return closeRequest.promise;

  const requestId = randomUUID();
  const closeAuthority = externalFileOpenDelivery.beginClose(requestId);
  if (!closeAuthority) {
    return Promise.resolve({
      requestId,
      closeGeneration: null,
      ready: false,
      reason: "另一个关闭世代仍在协调。",
      presentation: "in-app",
    });
  }
  const deadlineAt = Date.now() + RENDERER_CLOSE_TIMEOUT_MS;
  let resolveRequest;
  const promise = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const timeout = setTimeout(() => {
    if (!closeRequest || closeRequest.requestId !== requestId) return;
    closeRequest = null;
    resolveRequest({
      requestId,
      closeGeneration: closeAuthority.generation,
      ready: false,
      reason: "等待编辑器写入完成超时。请保持应用开启，确认自动保存状态后再关闭。",
      presentation: "in-app",
      retry: true,
    });
  }, RENDERER_CLOSE_TIMEOUT_MS);
  closeRequest = {
    requestId,
    promise,
    resolve: resolveRequest,
    timeout,
    closeAuthority,
  };
  if (!rendererCanReceive()) {
    // No frame to ask, so there is nothing to wait for: settle instead of hanging on
    // a reply that can never arrive.
    closeRequest = null;
    clearTimeout(timeout);
    resolveRequest({
      ready: true,
      requestId,
      closeGeneration: closeAuthority.generation,
      reason: "renderer-unavailable",
    });
    return promise;
  }
  mainWindow.webContents.send(APP_CHANNELS.prepareClose, {
    requestId,
    reason,
    deadlineAt,
  });
  return promise;
}

function rendererCanReceive() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const contents = mainWindow.webContents;
  /*
   * isDestroyed() is not enough: the window can outlive its render frame, and
   * sending to a disposed frame throws "Render frame was disposed". That throw used
   * to escape mid-way through close coordination and leave the app stuck.
   */
  if (!contents || contents.isDestroyed()) return false;
  return Boolean(contents.mainFrame);
}

function notifyRendererCloseAborted(requestId, error) {
  const payload = closeAbortPayload(requestId, error);
  if (!payload || !rendererCanReceive()) return;
  mainWindow.webContents.send(APP_CHANNELS.closeAborted, payload);
}

function closeAuthorityFromResult(result) {
  const requestId = String(result?.requestId || "");
  const generation = Number(result?.closeGeneration);
  if (!requestId || !Number.isSafeInteger(generation) || generation <= 0) return null;
  return Object.freeze({ requestId, generation });
}

function notifyRendererCloseAbortedOnce(authority, error) {
  if (!authority || !externalFileOpenDelivery.markCloseAborted(authority)) return false;
  notifyRendererCloseAborted(authority.requestId, error);
  return true;
}

function finishCloseAbort(authority, error, { restoreHandoff = false } = {}) {
  notifyRendererCloseAbortedOnce(authority, error);
  if (authority) {
    externalFileOpenDelivery.releaseBarrier(authority);
    externalFileOpenDelivery.abortClose(authority);
  }
  if (restoreHandoff) resumeDeferredExternalFileOpenAfterExitAbort();
  else deliverExternalMailboxHead();
}

async function stopBridgeGracefully() {
  const child = bridgeProcess;
  if (!child) {
    bridgePort = null;
    return { code: null };
  }

  const result = await stopBridgeProcessGracefully(child, {
    timeoutMs: BRIDGE_SHUTDOWN_TIMEOUT_MS,
    // UtilityProcess.kill sends SIGTERM. The bridge handles SIGTERM by
    // closing its HTTP server before exiting, so in-flight writes can finish.
    // There is deliberately no SIGKILL fallback: an unconfirmed shutdown
    // keeps the application open instead of risking an interrupted fsync.
    requestStop: (target) => target.kill(),
  });

  if (bridgeProcess === child) bridgeProcess = null;
  bridgePort = null;
  return result;
}

function unregisterIpc() {
  unregisterProjectIpc({
    ipcMain,
    PROJECT_CHANNELS,
    EDIT_RUNTIME_CHANNELS,
  });
  unregisterAgentIpc({ ipcMain, INTEGRATION_CHANNELS });
  unregisterUpdateIpc({ ipcMain, UPDATE_CHANNELS });
  unregisterWindowIpc({
    ipcMain,
    APP_CHANNELS,
    EDIT_CHANNELS,
    UI_PREFERENCE_CHANNELS,
    USAGE_CHANNELS,
    WORKBENCH_TAB_CHANNELS,
  });
  projectIpcRegistered = false;
}

const EXIT_INTENTS = Object.freeze({
  quit: Object.freeze({
    errorTitle: "无法安全关闭源页",
  }),
  relaunch: Object.freeze({
    errorTitle: "暂时无法重新打开源页",
  }),
  update: Object.freeze({
    errorTitle: "暂时无法安装更新",
  }),
});

async function coordinateApplicationExit(reason, intent = "quit") {
  if (coordinatedExit) return coordinatedExit;
  const exitIntent = EXIT_INTENTS[intent];
  if (!exitIntent) throw new TypeError(`Unsupported exit intent: ${intent}`);
  let coordinatedCloseAuthority = null;
  coordinatedExit = (async () => {
    let result = null;
    let retryCount = 0;
    while (true) {
      result = await requestRendererClose(reason);
      coordinatedCloseAuthority = closeAuthorityFromResult(result);
      if (
        coordinatedCloseAuthority
        && !externalFileOpenDelivery.isCurrent(coordinatedCloseAuthority)
      ) {
        finishCloseAbort(
          coordinatedCloseAuthority,
          "收到新的外部 HTML 打开请求，已取消关闭。",
        );
        presentMainWindow();
        coordinatedExit = null;
        return false;
      }
      if (result.ready) break;

      captureUsage("interruption_changed", {
        interruption_code: "close_safety",
        phase: "started",
        result: "unknown",
        surface: "global",
      });
      const retry = !e2eNativeDialogsSuppressed && shouldRetryCloseBlock(result, {
        retryCount,
        maxRetries: 1,
      });
      if (retry) {
        // Every attempt owns a distinct renderer freeze. Release it before the
        // single bounded retry so the next request can change the condition.
        finishCloseAbort(coordinatedCloseAuthority, result.reason);
        presentMainWindow();
        retryCount += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, 400);
        });
        continue;
      }

      finishCloseAbort(coordinatedCloseAuthority, result.reason);
      presentMainWindow();
      captureUsage("interruption_changed", {
        interruption_code: "close_safety",
        phase: "resolved",
        result: "continued",
        surface: "global",
      });
      coordinatedExit = null;
      return false;
    }

    if (
      coordinatedCloseAuthority
      && !externalFileOpenDelivery.commitClose(coordinatedCloseAuthority)
    ) {
      finishCloseAbort(
        coordinatedCloseAuthority,
        "关闭核对已经失效，已返回当前页面。",
      );
      presentMainWindow();
      coordinatedExit = null;
      return false;
    }

    isQuitting = true;
    const watchedSourcePath = sourceFileWatcher.watchedPath;
    await Promise.all([
      stateWriteQueue.catch(() => {}),
      workbenchTabsWriteQueue.catch(() => {}),
    ]);
    await stopBridgeOrNotifyCloseAborted({
      requestId: result.requestId,
      stopBridge: stopBridgeGracefully,
      notifyCloseAborted: (payload) => {
        notifyRendererCloseAbortedOnce(coordinatedCloseAuthority, payload.reason);
      },
    });
    // Keep file-authority monitoring alive until the Bridge has proved every
    // managed Agent stopped. A failed relaunch/quit must return to a fully live
    // editor instead of silently losing external-file observation.
    sourceFileWatcher.close();
    await usageTelemetry?.shutdown({
      reason: intent === "quit" ? "quit" : intent,
    }).catch(() => {});
    await runGuardedFinalExit({
      armFinalExit: () => {
        unregisterIpc();
        finalExitStarted = true;
      },
      executeFinalExit: () => {
        if (intent === "relaunch") {
          app.relaunch();
          setImmediate(() => app.exit(0));
        } else if (intent === "update") {
          const installing = ensureApplicationUpdateController()
            .installDownloadedUpdate();
          if (!installing) throw new Error("下载的更新已不再可安装。");
        } else {
          app.quit();
        }
        return true;
      },
      restoreFinalExit: async (error) => {
        finalExitStarted = false;
        let restartError = null;
        try {
          await startBridge();
          await initializeUsageTelemetry();
        } catch (caught) {
          restartError = caught;
        } finally {
          try {
            registerProjectIpc();
            if (watchedSourcePath) sourceFileWatcher.watch(watchedSourcePath);
          } finally {
            // Keep late native paths in the durable handoff until restored
            // infrastructure has sent the exact close abort and released its
            // delivery barrier. No external head may reach the renderer in
            // the middle of final-exit recovery.
            isQuitting = false;
            finishCloseAbort(coordinatedCloseAuthority, error, {
              restoreHandoff: true,
            });
          }
        }
        if (restartError) throw restartError;
      },
    });
    return true;
  })().catch((error) => {
    coordinatedExit = null;
    isQuitting = false;
    finishCloseAbort(coordinatedCloseAuthority, error, {
      restoreHandoff: true,
    });
    console.error("[close]", exitIntent.errorTitle, error);
    if (e2eNativeDialogsSuppressed) {
      reportSuppressedNativeDialog(
        exitIntent.errorTitle,
        error instanceof Error ? error.message : String(error),
      );
    }
    return false;
  });
  return coordinatedExit;
}

async function coordinateApplicationRelaunch(reason) {
  return coordinateApplicationExit(reason, "relaunch");
}

async function coordinateApplicationUpdateInstall(reason) {
  return coordinateApplicationExit(reason, "update");
}

async function showWorkspaceUnavailableRecovery() {
  captureUsage("runtime_fault", {
    process: "bridge",
    kind: "bridge_exit",
    reason_code: "BRIDGE_UNAVAILABLE",
  });
  const delivery = workspaceRecoveryMailbox.publish({
    title: "本地项目资料暂时不可用",
    message: "当前页面内容仍保留。可先导出当前 HTML，再重新打开源页恢复本地服务。",
  });
  if (
    delivery.deliverToRenderer
    && mainWindow
    && !mainWindow.isDestroyed()
  ) {
    mainWindow.webContents.send(
      APP_CHANNELS.workspaceUnavailable,
      delivery.issue,
    );
    return;
  }
  if (e2eNativeDialogsSuppressed) {
    reportSuppressedNativeDialog(
      delivery.issue.title,
      "源页的本地项目服务已停止。当前窗口中的内容仍保留。",
    );
  }
  return null;
}

async function workspacePath() {
  return runtimeEnvironment.workspacePath;
}

// The device identity is read once per launch and reused by every Bridge
// restart, so a crash-and-restart cycle keeps attributing records to the same
// device instead of minting a new one.
function deviceIdentity() {
  deviceIdentityPromise ??= readOrCreateDeviceIdentity({
    userDataPath: app.getPath("userData"),
  });
  return deviceIdentityPromise;
}

async function launchBridge() {
  startupPerformanceTimeline.mark("bridge-start");
  const [port, workspace, device] = await Promise.all([
    findAvailablePort(),
    workspacePath(),
    deviceIdentity(),
  ]);

  const child = utilityProcess.fork(bridgeScriptPath(), [], {
    env: {
      ...process.env,
      HTML_AI_ALLOW_FILE_ORIGIN: "1",
      HTML_AI_BRIDGE_AUTH_TOKEN: bridgeAuthToken,
      HTML_AI_BRIDGE_PORT: String(port),
      HTML_AI_DEVICE_ID: device.deviceId,
      HTML_AI_RUNTIME_CHANNEL: runtimeChannel,
      HTML_AI_USER_DATA_ROOT: runtimeEnvironment.userDataPath,
      HTML_AI_SESSION_DATA_ROOT: runtimeEnvironment.sessionDataPath,
      HTML_AI_PROJECT_FILES_ROOT: runtimeEnvironment.projectFilesRoot,
      HTML_AI_WORKSPACE: workspace,
      HTML_AI_AGENTS_ROOT: runtimeEnvironment.agentsRoot,
      HTML_AI_RECOVERY_JOURNALS_ROOT: runtimeEnvironment.recoveryJournalPath,
      PAGEROOT_LOGS_ROOT: runtimeEnvironment.logsPath,
    },
    serviceName: "HTML AI Workspace Bridge",
    stdio: "pipe",
  });

  bridgeProcess = child;
  let ready = false;

  child.once("exit", (code) => {
    const ownedProcess = bridgeProcess === child;
    if (ownedProcess) {
      bridgeProcess = null;
      bridgePort = null;
    }
    if (!ownedProcess || !ready) return;
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_exit",
      reason_code: "BRIDGE_EXITED_AFTER_READY",
      exit_code: Number.isInteger(code) ? code : -1,
    });
    if (!isQuitting) void showWorkspaceUnavailableRecovery();
  });
  child.once("error", (_type, _location, report) => {
    const ownedProcess = bridgeProcess === child;
    if (!ownedProcess || !ready) return;
    bridgeProcess = null;
    bridgePort = null;
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_exit",
      reason_code: "BRIDGE_PROCESS_ERROR",
      fingerprint: telemetryFingerprint(report || "bridge-process-error"),
    });
    if (!isQuitting) void showWorkspaceUnavailableRecovery();
  });

  try {
    await waitForBridgeReady(child, {
      expectedPort: port,
      slowAfterMs: BRIDGE_STARTUP_SLOW_MS,
      onStillStarting: () => {
        console.warn(
          "[bridge-startup] 本地工作区服务仍在启动；继续等待系统权限处理。",
        );
      },
    });
    if (bridgeProcess !== child) {
      throw new BridgeExitedBeforeReadyError(null);
    }
    bridgePort = port;
    ready = true;
    startupPerformanceTimeline.mark("bridge-ready");
    rememberedCredentialRestorePromise = restoreRememberedAgentCredential();
    void rememberedCredentialRestorePromise;
    return port;
  } catch (error) {
    // If the child is still alive, keep its handle so the coordinated fatal
    // shutdown can request a graceful stop instead of orphaning the process.
    bridgePort = null;
    startupPerformanceTimeline.mark("bridge-failed");
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_start",
      reason_code: telemetryReasonCode(
        error?.code || error?.name,
        "BRIDGE_START_FAILED",
      ),
      fingerprint: telemetryFingerprint(error),
      ...(Number.isInteger(error?.exitCode)
        ? { exit_code: error.exitCode }
        : {}),
    });
    throw error;
  }
}

async function startBridge() {
  if (bridgeProcess && bridgePort) return bridgePort;
  if (bridgeStartupPromise) return bridgeStartupPromise;

  const startup = launchBridge();
  bridgeStartupPromise = startup;
  try {
    return await startup;
  } finally {
    if (bridgeStartupPromise === startup) bridgeStartupPromise = null;
  }
}

desktopRuntime.startBridge = startBridge;
desktopRuntime.ensurePreviewProtocolController = ensurePreviewProtocolController;
desktopRuntime.adoptPendingExternalFileAtStartup = adoptPendingExternalFileAtStartup;
desktopRuntime.workspaceRecoveryMailbox = workspaceRecoveryMailbox;
desktopRuntime.registerProjectIpc = registerProjectIpc;
desktopRuntime.isTrustedRendererUrl = isTrustedRendererUrl;
desktopRuntime.rendererPath = rendererPath;
desktopRuntime.ensureApplicationUpdateController = ensureApplicationUpdateController;
desktopRuntime.externalFileOpenMailbox = externalFileOpenMailbox;
desktopRuntime.publicMailboxRequest = publicMailboxRequest;
desktopRuntime.captureUsage = captureUsage;
desktopRuntime.telemetryReasonCode = telemetryReasonCode;
desktopRuntime.coordinateApplicationExit = coordinateApplicationExit;


const hasSingleInstanceLock = app.requestSingleInstanceLock();

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  publishExternalFileOpen(filePath);
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Only the process that owns Electron's single-instance lock may consume
  // the durable one-shot record. A losing secondary process forwards its
  // command line to the owner and must leave this record for the authoritative
  // next launch. Keep ordinary argv opens in the same sequence so a newer
  // launch argument still supersedes an older committed-exit handoff.
  const deferredExternalPaths = [];
  for (let sourcePath = externalFileOpenExitHandoff.take(); sourcePath; sourcePath = externalFileOpenExitHandoff.take()) {
    deferredExternalPaths.push(sourcePath);
  }
  for (const sourcePath of [
    ...deferredExternalPaths,
    ...externalHtmlPathsFromArgv(process.argv.slice(1)),
  ]) {
    externalFileOpenMailbox.publish(sourcePath);
  }

  app.on("second-instance", (_event, commandLine) => {
    captureUsage("app_launched", { launch_reason: "second_instance" });
    for (const sourcePath of externalHtmlPathsFromArgv(commandLine)) {
      publishExternalFileOpen(sourcePath);
    }
    if (!isQuitting && !finalExitStarted) presentMainWindow();
  });

  app.whenReady().then(async () => {
    startupPerformanceTimeline.mark("app-ready");
    if (
      process.platform === "darwin"
      && app.dock
      && !app.isPackaged
    ) {
      app.dock.setIcon(path.join(directory, "resources", "icon.png"));
    }
    installApplicationMenu();
    await initializeRuntimeEnvironment();
    ensureApplicationUpdateController();
    try {
      await recoveryJournalStore.initialize();
    } catch (error) {
      recoveryJournalAvailable = false;
      recoveryJournalUnavailableReason = error instanceof Error
        ? error.message
        : "恢复日志初始化失败。";
      captureUsage("runtime_fault", {
        process: "main",
        kind: "recovery_journal_degraded",
        reason_code: telemetryReasonCode(error?.code, "RECOVERY_JOURNAL_UNAVAILABLE"),
        fingerprint: telemetryFingerprint(error),
      });
    }
    await createWindow();
  }).catch(async (error) => {
    captureUsage("runtime_fault", {
      process: "main",
      kind: "startup_failure",
      reason_code: telemetryReasonCode(error?.name, "STARTUP_FAILURE"),
      fingerprint: telemetryFingerprint(error),
    });
    await usageTelemetry?.shutdown({ reason: "quit" }).catch(() => {});
    if (e2eNativeDialogsSuppressed) {
      reportSuppressedNativeDialog(
        "源页启动失败",
        error instanceof Error ? error.message : String(error),
      );
    } else {
      dialog.showErrorBox(
        "源页启动失败",
        error instanceof Error ? error.message : String(error),
      );
    }
    app.quit();
  });
}

app.on("activate", () => {
  // 用户主动点击 Dock 图标或通过应用切换器选中源页：后台 E2E 模式下
  // 也允许把窗口调到前台查看，之后仍可自行最小化或隐藏；自动化路径
  // 仍然不会主动抢占前台。
  presentMainWindow({ userInitiated: true });
});

app.on("window-all-closed", () => {
  if (finalExitStarted) app.quit();
  else void coordinateApplicationExit("window-all-closed");
});

app.on("before-quit", (event) => {
  if (finalExitStarted) return;
  event.preventDefault();
  void coordinateApplicationExit("app-quit");
});
