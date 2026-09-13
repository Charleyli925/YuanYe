import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  activateNativeEdit,
  bridgeJson,
  caseSelector,
  closePageRootGracefully,
  createSourceFixture,
  keyShortcut,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdtempSync,
  path,
  readFileSync,
  readdirSync,
  readDesktopProjectState,
  removeIsolatedUserData,
  removeSourceFixture,
  renameSync,
  sameDesktopSourcePath,
  setTextSelection,
  stopPageRoot,
  tmpdir,
  waitForActiveSourcePath,
  waitForTitleStem,
  writeFileSync,
} from "./electron-native-harness.mjs";

test("an unavailable recovery journal root degrades without blocking the main window", {
  tag: ["@smoke-recovery"],
}, async () => {
  const fixture = createSourceFixture("journal-root-unavailable.html");
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  writeFileSync(path.join(isolatedUserData, "recovery-journals-v1"), "not-a-directory");
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: fixture.sourcePath,
    });
    electronApp = launched.electronApp;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    await expect(launched.page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready");
    await expect.poll(() => launched.page.evaluate(() => (
      window.htmlAIProjects?.listRecoveryJournals?.()
    ))).toMatchObject({ entries: [], unavailable: true });
    await launched.page.getByRole("button", { name: "更多" }).click();
    await expect(launched.page.getByRole("menuitem", { name: "导出当前 HTML…" }))
      .toBeVisible();
  } finally {
    if (electronApp) await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("permanent autosave failure keeps H0, protects H1, navigates, closes, and restores", {
  tag: ["@smoke-recovery"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("autosave-protected-restart.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      injectedEnv: { PAGEROOT_E2E_AUTOSAVE_FAILURE: "1" },
    });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const h0 = readFileSync(managedSourcePath);
    const h1Text = "恢复日志保护的 H1";
    const { frame } = await loadedDiskFrame(
      launched.page,
      managedSourcePath,
      "list-item",
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await launched.page.keyboard.insertText(h1Text);
    await launched.page.keyboard.press(keyShortcut("S"));

    const workbench = launched.page.locator("main.workbench");
    await expect(workbench).toHaveAttribute("data-persist-state", "failed", {
      timeout: 30_000,
    });
    const failure = launched.page.locator(".document-persistence-banner");
    await expect(failure).toBeVisible();
    await expect(failure.getByText("当前修改还没有写入文件")).toBeVisible();
    await expect(failure.getByRole("button", { name: "导出当前 HTML" })).toBeVisible();
    expect(readFileSync(managedSourcePath)).toEqual(h0);

    const journalRoot = path.join(isolatedUserData, "recovery-journals-v1");
    await expect.poll(() => readdirSync(journalRoot)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(path.join(journalRoot, name), "utf8")))
      .find((record) => record.html.includes(h1Text)) || null).toMatchObject({
      schemaVersion: "2.0.0",
      revision: 1,
    });

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" });
    const documentTitle = (await tabs.getByRole("tab").first().innerText()).trim();
    await launched.page.getByRole("button", { name: "新标签页" }).click();
    await expect(workbench).toHaveAttribute("data-start-page", "true");
    const expandSidebar = launched.page.getByRole("button", { name: "展开左侧边栏" });
    if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click();
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    await expect(workbench).toHaveAttribute("data-settings-page", "true");
    await tabs.getByRole("tab").filter({ hasText: documentTitle }).click();
    await expect(workbench).toHaveAttribute("data-persist-state", "failed");
    await expect.poll(() => loadedDiskFrame(
      launched.page,
      managedSourcePath,
      "list-item",
    ).then(({ frame: currentFrame }) => currentFrame
      .locator(caseSelector("list-item"))
      .textContent())).toBe(h1Text);

    await closePageRootGracefully(electronApp, launched.page);
    electronApp = null;
    const restarted = await launchPageRoot({
      isolatedUserData,
      injectedEnv: { PAGEROOT_E2E_AUTOSAVE_FAILURE: "1" },
    });
    electronApp = restarted.electronApp;
    const { frame: recoveredFrame } = await loadedDiskFrame(
      restarted.page,
      managedSourcePath,
      "list-item",
      { allowSourceNotAuthoritative: true },
    );
    await expect.poll(() => recoveredFrame.locator(caseSelector("list-item")).textContent(), {
      timeout: 60_000,
    }).toBe(h1Text);
    expect(readFileSync(managedSourcePath)).toEqual(h0);
    await expect(restarted.page.locator("main.workbench"))
      .toHaveAttribute("data-persist-state", /^(?:queued|writing|failed)$/u);

    const restartedTabs = restarted.page.getByRole("tablist", { name: "已打开的页面" });
    await restartedTabs.getByRole("tab").first().focus();
    await restartedTabs.getByRole("tab").first().press(
      process.platform === "darwin" ? "Meta+w" : "Control+w",
    );
    await expect(restarted.page.locator("main.workbench"))
      .toHaveAttribute("data-start-page", "true");
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    if (isolatedUserData) removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Desktop fails closed when the Working Copy is replaced between Bridge reconcile and Desktop read", {
  tag: ["@smoke-recovery"],
}, async () => {
  const fixture = createSourceFixture("reconcile-hash-race.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      injectedEnv: { PAGEROOT_E2E_RECONCILE_REPLACE_BEFORE_READ: "1" },
    });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const expectedSha256 = beforeWorkspace.body?.currentHtmlSha256;
    const beforeState = await readDesktopProjectState(isolatedUserData);

    // Drive the exact race window: the Bridge verifies the Working Copy, and
    // the E2E injection replaces its bytes before Desktop reads them again.
    const outcome = await launched.page.evaluate(async (payload) => {
      try {
        const result = await window.htmlAIProjects.reconcileActiveManagedSource(payload);
        return { resolved: true, result };
      } catch (error) {
        return {
          resolved: false,
          code: error?.code || null,
          message: String(error?.message || error || ""),
          details: error?.details || null,
          hasStack: "stack" in Object(error),
          hasChannel: "channel" in Object(error),
          hasInternalClass: "ProjectFileError" in Object(error),
        };
      }
    }, {
      operationId: "reconcile_e2e_hash_race_0001",
      previousSourcePath: managedSourcePath,
      expectedSourceSha256: expectedSha256,
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId,
      versionId: beforeTarget.versionId,
      reason: "safe-action",
    });

    // The trusted IPC boundary exposes only the structured product DTO. It
    // preserves the public code/details while redacting Main-process Error
    // implementation fields before the value crosses contextBridge.
    expect(outcome.resolved).toBe(false);
    expect(outcome.code).toBe("MANAGED_WORKING_COPY_HASH_MISMATCH");
    expect(outcome.message).toBe("托管工作文件与已确认的项目内容不一致，当前文件没有切换。");
    expect(outcome.details).toEqual(expect.objectContaining({
      expectedSha256,
    }));
    expect(outcome.details.actualSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(outcome.hasStack).toBe(false);
    expect(outcome.hasChannel).toBe(false);
    expect(outcome.hasInternalClass).toBe(false);

    // The replacement must have landed inside the race window.
    expect(readFileSync(managedSourcePath, "utf8"))
      .toContain("data-e2e-reconcile-hash-race");

    // Fail closed: neither the active path nor the managed locator may move.
    const afterState = await readDesktopProjectState(isolatedUserData);
    expect(afterState.activePath).toBe(beforeState.activePath);
    expect(afterState.activeManagedLocator).toEqual(beforeState.activeManagedLocator);

    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    expect(sameDesktopSourcePath(activeProject?.sourcePath, managedSourcePath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron restores a Finder rename after the process is killed", {
  tag: ["@smoke-recovery"],
}, async () => {
  const fixture = createSourceFixture("finder-rename-restart.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const finderName = "重启后仍是同一文件-V1.html";
    const finderPath = path.join(path.dirname(managedSourcePath), finderName);
    renameSync(managedSourcePath, finderPath);
    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);

    await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    electronApp = null;
    const relaunched = await launchPageRoot({ isolatedUserData });
    electronApp = relaunched.electronApp;
    await waitForTitleStem(relaunched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(relaunched.page, finderPath);
    const afterWorkspace = await bridgeJson(
      relaunched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeTarget.projectId);
    expect(afterTarget.documentId).toBe(beforeTarget.documentId);
    expect(afterTarget.workingCopyId).toBe(beforeTarget.workingCopyId);
    expect(readFileSync(finderPath, "utf8")).toContain(ORIGINAL_LIST_TEXT);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    if (isolatedUserData) removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
