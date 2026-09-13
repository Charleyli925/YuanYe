import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "@playwright/test";

import { sha256 } from "../../../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../../../bridge/project-file-repository.mjs";
import { collectEditRuntimeScripts } from "../../../app/domain/edit-runtime-contract.js";

import {
  activateNativeEdit,
  caseSelector,
  currentEditorFrame,
  currentNativeTarget,
  documentToken,
  fixtureBuffer,
  geometrySnapshot,
  installInputRecorder,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  recordedInputEvents,
  replaceEditableIslandBytes,
  replaceUniqueBytes,
  setTextSelection,
  withBomAndCrLf,
} from "../browser/pageroot-driver.mjs";
import {
  closePageRootGracefully,
  createSourceFixture as createSharedSourceFixture,
  launchPageRoot,
  loadedDiskFrame as loadDiskFrame,
  openRailGlobalCommentComposer,
  removeValidatedTemporaryDirectory,
  removeSourceFixture as removeSharedSourceFixture,
  sendToMainRenderer,
  stopPageRoot,
  waitForProjectReady as waitForSharedProjectReady,
} from "./helpers/pageroot-app-fixture.mjs";

export {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
};
export { tmpdir, path, expect, sha256, ProjectFileRepository };
export {
  activateNativeEdit,
  caseSelector,
  currentEditorFrame,
  documentToken,
  fixtureBuffer,
  geometrySnapshot,
  installInputRecorder,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  recordedInputEvents,
  replaceEditableIslandBytes,
  replaceUniqueBytes,
  setTextSelection,
  withBomAndCrLf,
};
export {
  closePageRootGracefully,
  launchPageRoot,
  openRailGlobalCommentComposer,
  removeValidatedTemporaryDirectory,
  sendToMainRenderer,
  stopPageRoot,
};

export const ORIGINAL_LIST_TEXT = "列表项中的文字保持项目符号和缩进。";

export function removeIsolatedUserData(isolatedUserData) {
  removeValidatedTemporaryDirectory(isolatedUserData, "pageroot-native-e2e-");
}

export function createSourceFixture(
  fileName = "generated-native-e2e.html",
  transform = (source) => source,
) {
  return createSharedSourceFixture({ fileName, transform });
}

export function removeSourceFixture(sourceDirectory) {
  removeSharedSourceFixture(sourceDirectory);
}

export async function waitForProjectReady(page, timeout = 60_000) {
  return waitForSharedProjectReady(page, { timeout, includeFailureDetail: true });
}

// The destination is chosen in the AI conversation now, not in a dialog over the page.
export async function chooseClipboardDelivery(page) {
  const sidebar = page.getByTestId("ai-conversation-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
  await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
  await sidebar.getByLabel("更多发送选项", { exact: true }).click();
  await sidebar.getByRole("button", { name: /复制给别的 AI/u }).click();
}

export async function loadedDiskFrame(page, sourcePath, caseId, {
  allowSourceNotAuthoritative = false,
} = {}) {
  const loaded = await loadDiskFrame(page, sourcePath, {
    expectedCase: caseId,
    includeEditor: true,
    timeout: 60_000,
  });
  const scriptContract = collectEditRuntimeScripts(
    readFileSync(sourcePath, "utf8"),
  );
  if (
    scriptContract.executableScripts.length < 1
    && !scriptContract.unsupportedReason
  ) return loaded;
  const expectedSourceRevision = sha256(readFileSync(loaded.sourcePath));
  const editSurface = loaded.editor.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' canvas-edit-surface ')][1]",
  );
  await expect.poll(async () => {
    const lastKnownGoodRevision = await loaded.editor.getAttribute(
      "data-runtime-last-known-good-source-revision",
    );
    const staticFallbackVisible = await editSurface.getByTestId(
      "edit-runtime-static-fallback",
    ).count();
    const runtimePhase = await editSurface.getAttribute("data-edit-runtime-phase");
    const runtimeOutcome = await editSurface.getAttribute("data-edit-runtime-outcome");
    const staticFrameVerified = runtimePhase === "static-fallback"
      && await loaded.editor.getAttribute("data-render-verified") === "true"
      && await loaded.editor.getAttribute("aria-readonly") === "false"
      && await loaded.editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute("sandbox") === "allow-same-origin";
    let activeBootstrapCount = 0;
    try {
      const activeHandle = await loaded.editor.locator(
        'iframe[data-runtime-slot-role="active"]',
      ).elementHandle();
      const activeFrame = await activeHandle?.contentFrame();
      activeBootstrapCount = await activeFrame?.locator(
        "[data-pageroot-edit-runtime-bootstrap]",
      ).count() || 0;
    } catch {
      activeBootstrapCount = 0;
    }
    const probe = {
      lastKnownGoodRevision,
      expectedSourceRevision,
      staticFallbackVisible,
      runtimePhase,
      runtimeOutcome,
      staticFrameVerified,
      activeBootstrapCount,
      candidateId: await loaded.editor.getAttribute("data-runtime-candidate-id"),
      candidateRevision: await loaded.editor.getAttribute(
        "data-runtime-candidate-source-revision",
      ),
      handoff: await loaded.editor.getAttribute("data-runtime-handoff"),
      canvasGeneration: await loaded.editor.getAttribute("data-canvas-generation"),
    };
    return (
      lastKnownGoodRevision === expectedSourceRevision
      && activeBootstrapCount === 1
    ) || staticFrameVerified || staticFallbackVisible > 0
      || (
        allowSourceNotAuthoritative
        && runtimePhase === "static"
        && runtimeOutcome === "source-not-authoritative"
      ) ? true : probe;
  }, { timeout: 60_000 }).toBe(true);
  const frame = await currentEditorFrame(page);
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector(caseId),
  );
  return { ...loaded, frame };
}

export async function openRecentProject(
  page,
  sourcePath,
  caseId = "list-item",
  recentName = path.basename(sourcePath),
) {
  const visibleToast = page.locator(".toast.show");
  await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await visibleToast.isVisible()) {
    await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
    await expect(visibleToast).toBeHidden();
  }
  const startPage = page.locator(".workbench-start-page").filter({ visible: true }).first();
  if (!await startPage.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "新标签页" }).click();
  }
  await startPage.waitFor({ state: "visible" });
  const sidebar = page.locator(".workbench-global-sidebar");
  if (await sidebar.getAttribute("data-open") !== "true") {
    await page.getByRole("button", { name: "展开左侧边栏" }).click();
  }
  const projectName = path.basename(recentName, path.extname(recentName));
  let projectRow = sidebar.getByRole("button", { name: projectName, exact: true });
  if (await projectRow.count() === 0) {
    const activeSourcePath = await page.evaluate(
      async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
    );
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(activeSourcePath)),
    });
    await repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(readFileSync(sourcePath)),
    });
    await page.getByRole("button", { name: "收起左侧边栏" }).click();
    await page.getByRole("button", { name: "展开左侧边栏" }).click();
    projectRow = sidebar.getByRole("button", { name: projectName, exact: true });
  }
  if (await projectRow.getAttribute("aria-expanded") !== "true") {
    await projectRow.click();
  }
  const projectContainer = projectRow.locator("xpath=..");
  await projectContainer.locator(".sidebar-version-file").first().click();
  return loadedDiskFrame(page, sourcePath, caseId);
}

export async function waitForFreshDiskFrame(page, previousDocumentToken, caseId) {
  await expect.poll(async () => {
    try {
      return await documentToken(page);
    } catch {
      return previousDocumentToken;
    }
  }).not.toBe(previousDocumentToken);
  const frame = await currentEditorFrame(page);
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector(caseId),
  );
  return frame;
}

export async function managedWorkingCopyPath(page, externalSourcePath) {
  await waitForProjectReady(page);
  const externalPath = realpathSync(externalSourcePath);
  const extension = path.extname(externalPath);
  const expectedWorkingCopyName = `${path.basename(externalPath, extension)}-V1${extension}`;
  let active = null;
  await expect.poll(async () => {
    active = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
    const sourcePath = active?.sourcePath || "";
    if (!sourcePath) return "";
    try {
      const canonical = realpathSync(sourcePath);
      return path.basename(canonical) === expectedWorkingCopyName
        ? canonical
        : "";
    } catch {
      return "";
    }
  }).not.toBe("");
  expect(active?.sourcePath).toBeTruthy();
  return active.sourcePath;
}

export async function bridgeJson(page, pathname, { method = "GET", body = null } = {}) {
  await page.waitForFunction(
    () => Boolean(window.htmlAIRuntime?.getBridgeConnection?.()),
    undefined,
    { timeout: 30_000 },
  );
  const runtime = await page.evaluate(() => ({
    port: window.htmlAIRuntime?.getBridgeConnection?.()?.bridgePort
      || window.htmlAIRuntime?.bridgePort || "",
    token: window.htmlAIRuntime?.getBridgeConnection?.()?.bridgeAuthToken
      || window.htmlAIRuntime?.bridgeAuthToken || "",
  }));
  if (!runtime.port || !runtime.token) {
    throw new Error("Electron did not expose a usable Bridge connection.");
  }
  const response = await fetch(`http://127.0.0.1:${runtime.port}${pathname}`, {
    method,
    headers: {
      "X-HTML-AI-Bridge-Token": runtime.token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

export async function rememberCurrentNativeHost(page, caseId) {
  const iframe = page
    .getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('iframe[title*="HTML"]');
  await iframe.evaluate((frameElement, selector) => {
    window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__ =
      frameElement.contentDocument?.querySelector(selector) || null;
  }, caseSelector(caseId));
}

export async function retiredNativeHostState(page) {
  return page.evaluate(() => {
    const host = window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__;
    if (!host || host.nodeType !== 1) {
      throw new Error("Electron source-authority fence lost the retired native host reference.");
    }
    const state = {
      contenteditable: host.getAttribute("contenteditable"),
      editingMarker: host.getAttribute("data-html-canvas-editing"),
    };
    delete window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__;
    return state;
  });
}

export async function expectCheckpointPersisted(page, afterRevision) {
  const indicator = page.locator("[data-persist-state]").first();
  await expect.poll(async () => indicator.evaluate((element, minimumRevision) => {
    const editRevision = Number(element.getAttribute("data-edit-revision"));
    const persistedRevision = Number(
      element.getAttribute("data-persisted-revision"),
    );
    return {
      state: element.getAttribute("data-persist-state"),
      editRevision,
      persistedRevision,
      error: document.querySelector(".source-conflict-banner span")?.textContent || "",
      synchronized:
        Number.isSafeInteger(editRevision)
        && editRevision > minimumRevision
        && editRevision === persistedRevision,
    };
  }, afterRevision), { timeout: 30_000 }).toMatchObject({
    state: "idle",
    error: "",
    synchronized: true,
  });
  return Number(await indicator.getAttribute("data-persisted-revision"));
}

function emptyRuntimeHandoffSnapshot(readError = null) {
  return {
    editorPresent: false,
    handoff: null,
    runtimeRefreshPending: false,
    runtimeRefreshPendingSourceRevision: null,
    candidateId: null,
    candidatePhase: null,
    candidateSourceRevision: null,
    candidateGeneration: null,
    candidateFrameCount: 0,
    activeFrameCount: 0,
    activeFrameRole: null,
    activeFrameDataRole: null,
    activeFrameGeneration: null,
    activeFrameDocumentToken: null,
    activeFrameConnected: false,
    activeFrameDocumentReady: false,
    previousFrameCount: 0,
    renderVerified: false,
    workingProjectionSha256: null,
    renderedProjectionSha256: null,
    runtimeSurfacePhase: null,
    runtimeSurfaceOutcome: null,
    activeIdentityStable: false,
    activeStabilitySampleCount: 0,
    ...(readError ? { readError } : {}),
  };
}

function normalizeRuntimeHandoffWaitOptions(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Runtime handoff wait options must be an object.");
  }
  const timeout = options.timeout ?? 30_000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError("Runtime handoff wait timeout must be a positive number.");
  }
  const expectedSourceRevision = options.expectedSourceRevision;
  if (
    expectedSourceRevision !== undefined
    && (typeof expectedSourceRevision !== "string" || expectedSourceRevision.length === 0)
  ) {
    throw new TypeError("expectedSourceRevision must be a non-empty string when provided.");
  }
  const priorGeneration = options.priorGeneration;
  if (
    priorGeneration !== undefined
    && (!Number.isSafeInteger(priorGeneration) || priorGeneration < 0)
  ) {
    throw new TypeError("priorGeneration must be a non-negative safe integer when provided.");
  }
  const requireGenerationAdvance = options.requireGenerationAdvance ?? false;
  if (typeof requireGenerationAdvance !== "boolean") {
    throw new TypeError("requireGenerationAdvance must be boolean when provided.");
  }
  if (requireGenerationAdvance && priorGeneration === undefined) {
    throw new TypeError(
      "priorGeneration is required when requireGenerationAdvance is true.",
    );
  }
  return {
    timeout,
    expectedSourceRevision,
    priorGeneration,
    requireGenerationAdvance,
  };
}

function runtimeHandoffConditions(snapshot, options) {
  const activeGeneration = snapshot.activeFrameGeneration === null
    ? null
    : Number(snapshot.activeFrameGeneration);
  const activeGenerationKnown = Number.isSafeInteger(activeGeneration)
    && activeGeneration >= 0;
  const generationMatches = options.priorGeneration === undefined
    ? true
    : activeGenerationKnown && (
      options.requireGenerationAdvance
        ? activeGeneration > options.priorGeneration
        : activeGeneration === options.priorGeneration
    );
  const sourceRevisionMatches = options.expectedSourceRevision === undefined
    ? true
    : snapshot.workingProjectionSha256 === options.expectedSourceRevision
      && snapshot.renderedProjectionSha256 === options.expectedSourceRevision;
  const conditions = {
    handoffCleared: snapshot.handoff === null,
    refreshSettled: snapshot.runtimeRefreshPending === false,
    candidateIdAbsent: snapshot.candidateId === null,
    candidateFramesAbsent: snapshot.candidateFrameCount === 0,
    oneActiveFrame: snapshot.activeFrameCount === 1,
    activeFrameRole: snapshot.activeFrameRole === "active"
      && snapshot.activeFrameDataRole === null,
    previousFramesAbsent: snapshot.previousFrameCount === 0,
    renderVerified: snapshot.renderVerified === true,
    activeIdentityStable: snapshot.activeIdentityStable === true,
    sourceRevisionMatches,
    generationMatches,
  };
  return {
    ...conditions,
    settled: Object.values(conditions).every(Boolean),
  };
}

function sanitizedRuntimeHandoffSnapshot(snapshot) {
  return {
    ...snapshot,
    // The token is an opaque per-document identity. Its presence is useful in
    // timeout diagnostics, while the token value itself is unnecessary and
    // should not be copied into test output.
    activeFrameDocumentToken: snapshot.activeFrameDocumentToken ? "<present>" : null,
  };
}

export async function readRuntimeHandoffSnapshot(page) {
  try {
    return await page.evaluate(async ({ stabilityFrames }) => {
      const tokenKey = "__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__";
      const findVisibleEditor = () => Array.from(
        document.querySelectorAll('[data-testid="html-canvas-editor"]'),
      ).find((candidate) => {
        const style = getComputedStyle(candidate);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && candidate.getClientRects().length > 0;
      }) || document.querySelector('[data-testid="html-canvas-editor"]');

      const read = () => {
        const visibleEditor = findVisibleEditor();
        const candidateFrames = Array.from(visibleEditor?.querySelectorAll(
          'iframe[data-frame-role="runtime-candidate"]',
        ) || []);
        const activeFrames = Array.from(visibleEditor?.querySelectorAll(
          'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
        ) || []);
        const activeFrame = activeFrames.length === 1 ? activeFrames[0] : null;
        const activeDocument = activeFrame?.contentDocument || null;
        let activeFrameDocumentToken = null;
        try {
          const activeWindow = activeFrame?.contentWindow;
          activeFrameDocumentToken = typeof activeWindow?.[tokenKey] === "string"
            ? activeWindow[tokenKey]
            : null;
        } catch {
          activeFrameDocumentToken = null;
        }
        const surface = visibleEditor?.closest(".canvas-edit-surface");
        return {
          editorPresent: Boolean(visibleEditor),
          handoff: visibleEditor?.getAttribute("data-runtime-handoff") || null,
          runtimeRefreshPending: Boolean(visibleEditor?.hasAttribute(
            "data-runtime-refresh-pending",
          )),
          runtimeRefreshPendingSourceRevision: visibleEditor?.getAttribute(
            "data-runtime-refresh-pending-source-revision",
          ) || null,
          candidateId: visibleEditor?.getAttribute("data-runtime-candidate-id") || null,
          candidatePhase: visibleEditor?.getAttribute("data-runtime-candidate-phase") || null,
          candidateSourceRevision: visibleEditor?.getAttribute(
            "data-runtime-candidate-source-revision",
          ) || null,
          candidateGeneration: visibleEditor?.getAttribute(
            "data-runtime-candidate-generation",
          ) || null,
          candidateFrameCount: candidateFrames.length,
          activeFrameCount: activeFrames.length,
          activeFrameRole: activeFrame?.getAttribute("data-runtime-slot-role") || null,
          activeFrameDataRole: activeFrame?.getAttribute("data-frame-role") || null,
          activeFrameGeneration: activeFrame?.getAttribute("data-frame-generation") || null,
          activeFrameDocumentToken,
          activeFrameConnected: Boolean(activeFrame?.isConnected),
          activeFrameDocumentReady: Boolean(activeDocument?.documentElement),
          previousFrameCount: visibleEditor?.querySelectorAll(
            'iframe[data-frame-role="runtime-previous"]',
          ).length || 0,
          renderVerified: visibleEditor?.getAttribute("data-render-verified") === "true",
          workingProjectionSha256: visibleEditor?.getAttribute(
            "data-working-source-sha256",
          ) || null,
          renderedProjectionSha256: visibleEditor?.getAttribute(
            "data-rendered-projection-sha256",
          ) || null,
          runtimeSurfacePhase: surface?.getAttribute("data-edit-runtime-phase") || null,
          runtimeSurfaceOutcome: surface?.getAttribute("data-edit-runtime-outcome") || null,
          __activeFrame: activeFrame,
          __activeDocument: activeDocument,
        };
      };
      const withoutFrameHandles = (snapshot) => {
        const publicSnapshot = { ...snapshot };
        delete publicSnapshot.__activeFrame;
        delete publicSnapshot.__activeDocument;
        return publicSnapshot;
      };

      const first = read();
      if (!first.editorPresent) {
        return {
          ...withoutFrameHandles(first),
          activeIdentityStable: false,
          activeStabilitySampleCount: 1,
        };
      }

      const samples = [first];
      await new Promise((resolve) => {
        let remaining = stabilityFrames;
        const sampleNextFrame = () => {
          samples.push(read());
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
            return;
          }
          window.requestAnimationFrame(sampleNextFrame);
        };
        window.requestAnimationFrame(sampleNextFrame);
      });
      const last = samples[samples.length - 1];
      const sameIdentity = (left, right) => (
        left.__activeFrame !== null
        && left.__activeFrame === right.__activeFrame
        && left.__activeDocument !== null
        && left.__activeDocument === right.__activeDocument
        && left.activeFrameGeneration === right.activeFrameGeneration
        && left.activeFrameDocumentToken === right.activeFrameDocumentToken
      );
      const validSample = (sample) => (
        sample.activeFrameCount === 1
        && sample.activeFrameRole === "active"
        && sample.activeFrameDataRole === null
        && sample.activeFrameConnected
        && sample.activeFrameDocumentReady
        && sample.activeFrameGeneration !== null
      );
      const activeIdentityStable = samples.every(validSample)
        && samples.slice(1).every((sample, index) => sameIdentity(samples[index], sample));
      return {
        ...withoutFrameHandles(last),
        activeIdentityStable,
        activeStabilitySampleCount: samples.length,
      };
    }, { stabilityFrames: 2 });
  } catch (error) {
    const message = String(error?.message || error).replace(/\s+/gu, " ").slice(0, 240);
    return emptyRuntimeHandoffSnapshot(message);
  }
}

export async function waitForRuntimeHandoffSettled(page, options = {}) {
  const normalizedOptions = normalizeRuntimeHandoffWaitOptions(options);
  let latestSnapshot = emptyRuntimeHandoffSnapshot();
  let pollError = null;
  try {
    await expect.poll(async () => {
      latestSnapshot = await readRuntimeHandoffSnapshot(page);
      return runtimeHandoffConditions(latestSnapshot, normalizedOptions);
    }, {
      timeout: normalizedOptions.timeout,
      intervals: [50, 100, 250, 500, 1_000],
    }).toMatchObject({ settled: true });
  } catch (error) {
    pollError = error;
    latestSnapshot = await readRuntimeHandoffSnapshot(page);
    const conditions = runtimeHandoffConditions(latestSnapshot, normalizedOptions);
    const details = {
      timeoutMs: normalizedOptions.timeout,
      conditions,
      actual: sanitizedRuntimeHandoffSnapshot(latestSnapshot),
    };
    const timeoutError = new Error(
      `Runtime handoff did not settle before timeout: ${JSON.stringify(details)}`,
    );
    timeoutError.name = "RuntimeHandoffSettlementTimeout";
    timeoutError.code = "RUNTIME_HANDOFF_SETTLEMENT_TIMEOUT";
    timeoutError.details = details;
    timeoutError.cause = pollError;
    throw timeoutError;
  }
  return latestSnapshot;
}

export async function clickEditHistoryMenu(electronApp, page, direction) {
  const mainRendererUrl = page.url();
  await electronApp.evaluate(
    ({ BrowserWindow, Menu }, { requestedDirection, rendererUrl }) => {
      const menu = Menu.getApplicationMenu();
      const expectedLabel = requestedDirection === "undo" ? "撤销" : "重做";
      const editMenu = menu?.items.find((item) => (
        item.submenu?.items.some(
          (candidate) => candidate.label === expectedLabel,
        )
      ));
      const item = editMenu?.submenu?.items.find(
        (candidate) => candidate.label === expectedLabel,
      );
      if (!item?.click) {
        throw new Error(`Edit > ${expectedLabel} is not installed.`);
      }
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) {
        throw new Error("PageRoot main BrowserWindow is unavailable for Edit history.");
      }
      item.click(item, mainWindow, {});
    },
    { requestedDirection: direction, rendererUrl: mainRendererUrl },
  );
}

export async function addCanvasComment(page, frame, caseId, text) {
  await page.keyboard.press("Escape");
  // A source-authority fence can replace the active iframe after a persisted
  // edit. Resolve the comment target through the current iframe locator so
  // the click follows that replacement instead of waiting on a retired Frame.
  const target = currentNativeTarget(frame, caseId);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  await page.getByRole("textbox", { name: "评论内容" }).fill(text);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  const card = page.locator(".comment-card").filter({ hasText: text });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
  return card;
}

export const ECHARTS_STUB = `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(1, 2, 3)";
    context.fillRect(0, 0, 640, 360);
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`;

export function requestDirectoryCount(workspace) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyCount = !existsSync(projectsRoot) ? 0 : readdirSync(projectsRoot).reduce((total, projectDirectoryName) => {
    const requestsRoot = path.join(
      projectsRoot,
      projectDirectoryName,
      "requests",
    );
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0
    );
  }, 0);
  const managedProjectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(managedProjectsRoot)) return legacyCount;
  return legacyCount + readdirSync(managedProjectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .reduce((total, entry) => {
      const requestsRoot = path.join(
        managedProjectsRoot,
        entry.name,
        ".pageroot",
        "requests",
      );
      return total + (
        existsSync(requestsRoot)
          ? readdirSync(requestsRoot).filter((name) => !name.startsWith(".")).length
          : 0
      );
    }, 0);
}

export function workspaceContainsDraftComment(workspace, text) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyContains = existsSync(projectsRoot) && readdirSync(projectsRoot).some((projectDirectoryName) => {
    const draftPath = path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    );
    if (!existsSync(draftPath)) return false;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    return Array.isArray(draft.comments)
      && draft.comments.some((comment) => comment.text === text);
  });
  if (legacyContains) return true;
  const managedProjectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(managedProjectsRoot)) return false;
  return readdirSync(managedProjectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .some((entry) => {
      const draftsRoot = path.join(
        managedProjectsRoot,
        entry.name,
        ".pageroot",
        "drafts",
      );
      return existsSync(draftsRoot) && readdirSync(draftsRoot)
        .filter((name) => name.endsWith(".json"))
        .some((name) => {
          const draft = JSON.parse(readFileSync(path.join(draftsRoot, name), "utf8"));
          return Array.isArray(draft.comments)
            && draft.comments.some((comment) => comment.text === text);
        });
    });
}

export async function replayApplePinyinStyledWrapperCommit(frame, caseId) {
  const target = frame.locator(caseSelector(caseId));
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  if (wordStart < 0) throw new Error("Apple Pinyin fixture word is missing.");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);
  await target.evaluate((element) => {
    const dispatchCompositionInput = (data) => {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) {
      throw new Error("Authored em wrapper is missing.");
    }
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    authoredEm.textContent = "ni";
    dispatchCompositionInput("ni");
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "ni hao";
    authoredEm.replaceWith(temporaryItalic);
    dispatchCompositionInput("ni hao");
    temporaryItalic.textContent = "你好";
    dispatchCompositionInput("你好");
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
  });
}

export function comparableDesktopPath(value) {
  const resolved = path.resolve(String(value || "")).normalize("NFC");
  if (resolved === "/private/var" || resolved.startsWith("/private/var/")) {
    return resolved.slice("/private".length);
  }
  if (resolved === "/private/tmp" || resolved.startsWith("/private/tmp/")) {
    return resolved.slice("/private".length);
  }
  return resolved;
}

export function sameDesktopSourcePath(left, right) {
  return comparableDesktopPath(left) === comparableDesktopPath(right);
}

export function titleStemLocator(page) {
  return page.locator(
    '.workbench-tab[data-selected="true"] button[role="tab"] > span:last-child',
  ).first();
}

export async function waitForTitleStem(page, stem) {
  await expect(titleStemLocator(page)).toContainText(stem, { timeout: 30_000 });
}

export async function waitForActiveSourcePath(page, expectedPath) {
  await expect.poll(async () => {
    try {
      const active = await page.evaluate(() => (
        window.htmlAIProjects?.getActiveProject()
      ));
      return sameDesktopSourcePath(active?.sourcePath, expectedPath);
    } catch {
      return false;
    }
  }).toBe(true);
}

export async function readDesktopProjectState(isolatedUserData) {
  return JSON.parse(readFileSync(
    path.join(isolatedUserData, "html-projects.json"),
    "utf8",
  ));
}

export async function waitForDesktopActivePath(isolatedUserData, expectedPath) {
  await expect.poll(async () => {
    try {
      const state = await readDesktopProjectState(isolatedUserData);
      return sameDesktopSourcePath(state.activePath, expectedPath);
    } catch {
      return false;
    }
  }, { timeout: 30_000 }).toBe(true);
}

export async function readManagedManifest(sourcePath) {
  return JSON.parse(readFileSync(
    path.join(path.dirname(sourcePath), ".pageroot", "manifest.json"),
    "utf8",
  ));
}
