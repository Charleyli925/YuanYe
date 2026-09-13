import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath) => new URL(relativePath, import.meta.url);

test("Electron automation stays backgrounded unless foreground debugging is explicit", async () => {
  const nativeSpecFiles = [
    "./e2e/electron/electron-native-harness.mjs",
    "./e2e/electron/electron-project-lifecycle.spec.mjs",
    "./e2e/electron/electron-edit-runtime.spec.mjs",
    "./e2e/electron/electron-runtime-continuity.spec.mjs",
    "./e2e/electron/electron-seeded-faults.spec.mjs",
    "./e2e/electron/electron-native-input.spec.mjs",
    "./e2e/electron/electron-comments-and-rules.spec.mjs",
    "./e2e/electron/electron-source-recovery.spec.mjs",
  ];
  const [
    mainProcess,
    appLifecycle,
    appFixture,
    ...productSuites
  ] = await Promise.all([
    readFile(sourceUrl("../desktop/main.mjs"), "utf8"),
    readFile(sourceUrl("../desktop/app-lifecycle.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/helpers/electron-app-launch.mjs"), "utf8"),
    ...nativeSpecFiles.map((file) => readFile(sourceUrl(file), "utf8")),
    readFile(sourceUrl("./e2e/electron/ai-closed-loop-helpers.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/ci-environment-preflight.spec.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/fixtures/ci-preflight-main.mjs"), "utf8"),
  ]);
  const preflightSuite = productSuites.at(-2);
  const preflightMain = productSuites.at(-1);
  const nativeAndAiSuites = productSuites.slice(0, -2);

  const desktopSource = `${mainProcess}\n${appLifecycle}`;
  assert.match(mainProcess, /PAGEROOT_E2E_FOREGROUND === "1"/u);
  // 后台 E2E 不再使用 accessory 激活策略彻底隐藏应用：Dock 图标保留，
  // 窗口仍默认不显示，只有用户主动点击 Dock 图标才调到前台。
  assert.doesNotMatch(desktopSource, /setActivationPolicy\("accessory"\)/u);
  assert.match(mainProcess, /app\.on\("activate"/u);
  assert.match(mainProcess, /presentMainWindow\(\{ userInitiated: true \}\)/u);
  assert.match(appLifecycle, /show:\s*e2eWindowForeground/u);
  assert.match(
    mainProcess,
    /const e2eNativeDialogsSuppressed = Boolean\(e2eUserDataPath\);/u,
  );
  assert.match(
    mainProcess,
    /if \(process\.env\.PAGEROOT_E2E === "1"\) \{[\s\S]*?__pagerootE2eHoldEditRuntimePrepare/u,
  );
  assert.match(
    mainProcess,
    /if \(process\.env\.PAGEROOT_E2E === "1" && e2eEditRuntimePrepareGate\.held\)/u,
  );
  assert.match(
    appLifecycle,
    /function presentMainWindow\(\{ userInitiated = false \} = \{\}\)[\s\S]*?e2eWindowRunsInBackground[\s\S]*?return false;/u,
  );
  // 即使显式前台观察 E2E，自动触发的原生弹窗也必须走日志拦截，
  // 不能弹在屏幕中央。
  assert.match(
    mainProcess,
    /if \(e2eNativeDialogsSuppressed\) \{[\s\S]*?reportSuppressedNativeDialog\([\s\S]*?\} else \{[\s\S]*?dialog\.showErrorBox\(/u,
  );
  assert.match(
    mainProcess,
    /shouldRetryCloseBlock\(result, \{[\s\S]*?retryCount,[\s\S]*?maxRetries: 1/u,
  );
  assert.doesNotMatch(mainProcess, /dialog\.showMessageBox/u);

  assert.match(appFixture, /window\.isVisible\(\)/u);
  assert.match(appFixture, /PAGEROOT_E2E_FOREGROUND/u);
  assert.doesNotMatch(appFixture, /page\.bringToFront\(\)/u);
  assert.doesNotMatch(appFixture, /app\.focus\(\{\s*steal:\s*true\s*\}\)/u);
  assert.doesNotMatch(appFixture, /window\?\.show\(\)/u);
  assert.doesNotMatch(appFixture, /window\?\.focus\(\)/u);

  assert.match(nativeAndAiSuites[0], /\.\/helpers\/pageroot-app-fixture\.mjs/u);
  for (const productSuite of nativeAndAiSuites) {
    assert.doesNotMatch(productSuite, /page\.bringToFront\(\)/u);
    assert.doesNotMatch(productSuite, /app\.focus\(\{\s*steal:\s*true\s*\}\)/u);
    assert.doesNotMatch(productSuite, /window\?\.show\(\)/u);
    assert.doesNotMatch(productSuite, /window\?\.focus\(\)/u);
  }

  for (const preflightSource of [preflightSuite, preflightMain]) {
    assert.match(preflightSource, /showInactive\(\)/u);
    assert.doesNotMatch(preflightSource, /bringToFront\(\)/u);
    assert.doesNotMatch(preflightSource, /app\.focus\(/u);
    assert.doesNotMatch(preflightSource, /\.focus\(\)/u);
  }
});

test("window loads the real renderer shell before Bridge readiness", async () => {
  const mainProcess = await readFile(sourceUrl("../desktop/app-lifecycle.mjs"), "utf8");
  const createWindow = mainProcess.slice(
    mainProcess.indexOf("async function createWindow()"),
  );
  assert.ok(createWindow.startsWith("async function createWindow()"));

  // The renderer shell must begin navigating before the utility process can
  // occupy the startup critical path. Its endpoint arrives later over preload
  // IPC, without a second navigation.
  const startCall = createWindow.indexOf("const bridgeStartup = startBridge();");
  assert.notEqual(startCall, -1);
  assert.doesNotMatch(createWindow, /const port = await startBridge\(\);/u);

  // An early throw between the start and the await must not surface the deferred
  // rejection as an unhandled one.
  assert.match(createWindow, /bridgeStartup\.catch\(\(\) => \{\}\);/u);

  const windowConstruction = createWindow.indexOf("mainWindow = new BrowserWindow({");
  const registerIpc = createWindow.indexOf("registerProjectIpc();");
  const loadRenderer = createWindow.indexOf("const shellLoad = mainWindow.loadFile(rendererPath()");
  const awaitShell = createWindow.indexOf("await shellLoad;");
  const awaitBridge = createWindow.indexOf("const port = await bridgeStartup;");
  const publishConnection = createWindow.indexOf("ctx.APP_CHANNELS.bridgeReady");
  for (const offset of [windowConstruction, registerIpc, loadRenderer, awaitShell, awaitBridge, publishConnection]) {
    assert.notEqual(offset, -1);
  }
  assert.ok(windowConstruction < registerIpc);
  assert.ok(registerIpc < loadRenderer);
  assert.ok(loadRenderer < startCall);
  assert.ok(startCall < awaitShell);
  assert.ok(awaitShell < awaitBridge);
  assert.ok(awaitBridge < publishConnection);
  assert.equal(createWindow.match(/\.loadFile\(/gu)?.length, 2);
  assert.match(createWindow, /bridge-connection-published/u);
});

test("direct Edit frames block author location navigation at the frame boundary", async () => {
  const appLifecycle = await readFile(sourceUrl("../desktop/app-lifecycle.mjs"), "utf8");
  assert.match(appLifecycle, /will-frame-navigate/u);
  assert.match(appLifecycle, /EDIT_RUNTIME_PROTOCOL_SCHEME/u);
  assert.match(appLifecycle, /details\.frame\?\.url === "about:srcdoc"[\s\S]*?details\.preventDefault\(\)/u);
  assert.match(appLifecycle, /resourceType === "subFrame"[\s\S]*?parentFrame\?\.frameTreeNodeId[\s\S]*?requestProtocol !== `\$\{PREVIEW_PROTOCOL_SCHEME\}:`[\s\S]*?cancel: blockCanvasNavigation/u);
  assert.match(appLifecycle, /initiatedByEditRuntime[\s\S]*?details\.preventDefault\(\)/u);
  assert.match(appLifecycle, /loadedDirectChildFrames[\s\S]*?new WeakRef\(frame\)/u);
  assert.match(appLifecycle, /directChildFrameWasLoaded[\s\S]*?details\.preventDefault\(\)/u);
});

test("usage telemetry starts only after the renderer is ready to show", async () => {
  const [mainProcess, appLifecycle] = await Promise.all([
    readFile(sourceUrl("../desktop/main.mjs"), "utf8"),
    readFile(sourceUrl("../desktop/app-lifecycle.mjs"), "utf8"),
  ]);
  const coldStart = mainProcess.slice(mainProcess.indexOf("app.whenReady().then"));
  assert.doesNotMatch(
    coldStart.slice(0, coldStart.indexOf("await createWindow();")),
    /initializeUsageTelemetry/u,
  );
  assert.match(
    appLifecycle,
    /once\("ready-to-show"[\s\S]*?window-ready-to-show[\s\S]*?startUsageTelemetryAfterFirstPaint/u,
  );
  assert.match(mainProcess, /telemetry-failed/u);
});

test("a recovery journal initialization failure degrades before the main window is created", async () => {
  const mainProcess = await readFile(sourceUrl("../desktop/main.mjs"), "utf8");
  const coldStart = mainProcess.slice(mainProcess.indexOf("app.whenReady().then"));
  const recoveryInitialization = coldStart.indexOf("await recoveryJournalStore.initialize()");
  const degradedCapability = coldStart.indexOf("recoveryJournalAvailable = false", recoveryInitialization);
  const createWindow = coldStart.indexOf("await createWindow()", recoveryInitialization);
  assert.ok(recoveryInitialization >= 0);
  assert.ok(degradedCapability > recoveryInitialization);
  assert.ok(createWindow > degradedCapability);
  assert.match(
    coldStart.slice(recoveryInitialization, createWindow),
    /catch \(error\)[\s\S]*?recovery_journal_degraded/u,
  );
});

test("runtime directory initialization is strict only for Developer Preview", async () => {
  const mainProcess = await readFile(sourceUrl("../desktop/main.mjs"), "utf8");
  const initialization = mainProcess.slice(
    mainProcess.indexOf("async function initializeRuntimeEnvironment()"),
    mainProcess.indexOf("function ensurePreviewProtocolController()"),
  );
  assert.match(
    initialization,
    /if \(runtimeEnvironment\.channel !== "preview"\)[\s\S]*?Promise\.all\(requiredPaths\)\.catch\(\(\) => \{\}\)[\s\S]*?return;/u,
  );
  assert.match(
    initialization,
    /runtimeEnvironment\.channel === "preview"|channel !== "preview"[\s\S]*?requiredPaths\.push\([\s\S]*?recoveryJournalPath/u,
  );
});

test("packaged launches preserve the executable product identity under E2E", async () => {
  const mainProcess = await readFile(sourceUrl("../desktop/main.mjs"), "utf8");
  assert.match(
    mainProcess,
    /const applicationName = app\.isPackaged\s*\?\s*path\.basename\(process\.execPath, path\.extname\(process\.execPath\)\)\s*:\s*runtimeEnvironment\.applicationName;/u,
  );
});

test("final-exit IPC unregister and close-abort registration include workbench tabs", async () => {
  const [mainProcess, windowIpc, projectIpc] = await Promise.all([
    readFile(sourceUrl("../desktop/main.mjs"), "utf8"),
    readFile(sourceUrl("../desktop/ipc/window-ipc.mjs"), "utf8"),
    readFile(sourceUrl("../desktop/ipc/project-ipc.mjs"), "utf8"),
  ]);
  assert.match(mainProcess, /WORKBENCH_TAB_CHANNELS/u);
  assert.match(mainProcess, /restoreFinalExit:[\s\S]*?registerProjectIpc\(\)/u);
  assert.match(windowIpc, /WORKBENCH_TAB_CHANNELS\.get/u);
  assert.match(windowIpc, /WORKBENCH_TAB_CHANNELS\.set/u);
  assert.match(windowIpc, /\.\.\.Object\.values\(WORKBENCH_TAB_CHANNELS/u);
  assert.match(windowIpc, /APP_CHANNELS\.externalOpenFailedReady/u);
  assert.match(projectIpc, /acknowledgeExternalOpen/u);
});

test("pending desktop activation recovery requires a persistent predecessor fence", async () => {
  const mainProcess = await readFile(sourceUrl("../desktop/main.mjs"), "utf8");
  assert.match(mainProcess, /activeEffectGeneration: 0/u);
  assert.match(mainProcess, /predecessorEffect/u);
  assert.match(mainProcess, /function sameActivationPredecessor\(state, receipt\)[\s\S]*?activeEffectGeneration[\s\S]*?predecessorGeneration[\s\S]*?predecessorEffect/u);
  const replay = mainProcess.slice(mainProcess.indexOf("async function replayActivationReceipt"));
  assert.match(
    replay,
    /receipt\.status === "pending"[\s\S]*?activePathIdentity === receipt\.previousSourcePath[\s\S]*?sameActivationPredecessor\(state, receipt\)/u,
  );
  assert.doesNotMatch(
    replay,
    /if \(receipt\.status === "pending" && activePathIdentity === receipt\.previousSourcePath\)/u,
  );
});
