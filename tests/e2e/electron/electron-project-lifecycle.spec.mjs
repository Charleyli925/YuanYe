import { seedLegacyHistoryActivation } from "../../helpers/legacy-history-activation.mjs";
import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  ProjectFileRepository,
  activateNativeEdit,
  addCanvasComment,
  bridgeJson,
  caseSelector,
  chooseClipboardDelivery,
  closePageRootGracefully,
  cpSync,
  createSourceFixture,
  currentEditorFrame,
  existsSync,
  expectCheckpointPersisted,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdirSync,
  mkdtempSync,
  openRailGlobalCommentComposer,
  openRecentProject,
  path,
  readDesktopProjectState,
  readFileSync,
  readManagedManifest,
  readdirSync,
  realpathSync,
  removeIsolatedUserData,
  removeSourceFixture,
  removeValidatedTemporaryDirectory,
  renameSync,
  sameDesktopSourcePath,
  setTextSelection,
  stopPageRoot,
  symlinkSync,
  tmpdir,
  titleStemLocator,
  waitForActiveSourcePath,
  waitForDesktopActivePath,
  waitForProjectReady,
  waitForTitleStem,
  writeFileSync,
} from "./electron-native-harness.mjs";

function identityPreservingCandidateHtml(target, title) {
  const current = readFileSync(target.exactSourcePath, "utf8");
  const candidate = current.replace(
    /(<title\b[^>]*>)[\s\S]*?(<\/title>)/iu,
    (_match, opening, closing) => `${opening}${title}${closing}`,
  );
  return candidate === current
    ? current.replace(/<\/html\s*>/iu, `<!-- ${title} --></html>`)
    : candidate;
}

test("Electron first launch imports the welcome HTML as V1 and sends its comment to Qoder", {
  tag: ["@gate-smoke","@smoke-project-lifecycle","@smoke-agent"],
}, async () => {
  const launched = await launchPageRoot();
  const welcomePath = path.join(launched.isolatedUserData, "欢迎来到源页.html");
  const welcomeLogoPath = path.join(
    launched.isolatedUserData,
    "brand-logo.png",
  );
  try {
    const canonicalWelcomePath = path.join(
      realpathSync(launched.isolatedUserData),
      "欢迎来到源页.html",
    );
    await waitForProjectReady(launched.page);
    let managedWelcomePath = "";
    await expect.poll(
      async () => {
        const active = await launched.page.evaluate(
          () => window.htmlAIProjects?.getActiveProject(),
        );
        managedWelcomePath = String(active?.sourcePath || "");
        return Boolean(
          managedWelcomePath && managedWelcomePath !== canonicalWelcomePath,
        );
      },
      { timeout: 20_000 },
    ).toBe(true);
    expect(path.basename(managedWelcomePath)).toBe("欢迎来到源页-V1.html");
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    const globalCommentButton = launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true });
    await expect(globalCommentButton)
      .toBeVisible({ timeout: 30_000 });
    await expect(globalCommentButton)
      .toBeEnabled({ timeout: 30_000 });
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    await expect.poll(() => (
      existsSync(welcomePath)
      && existsSync(welcomeLogoPath)
      && existsSync(path.join(managedWelcomePath, "..", ".pageroot", "manifest.json"))
    )).toBe(true);
    const projectRoot = path.dirname(managedWelcomePath);
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    expect(manifest.workingCopies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workingCopyId: "work_ver_0001",
        sourceRelativePath: "欢迎来到源页-V1.html",
      }),
    ]));
    const originalWelcome = readFileSync(welcomePath);
    const managedWelcome = readFileSync(managedWelcomePath);
    expect(managedWelcome).not.toEqual(originalWelcome);
    const managedSourceIds = [...managedWelcome.toString("utf8").matchAll(
      /data-pageroot-id="(pr1_[0-9a-f]{32})"/gu,
    )].map((match) => match[1]);
    expect(managedSourceIds.length).toBeGreaterThan(0);
    expect(new Set(managedSourceIds).size).toBe(managedSourceIds.length);
    const firstVersion = manifest.versions[0];
    expect(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      firstVersion.snapshotRelativePath,
    ))).toEqual(originalWelcome);
    const firstWorkingCopy = manifest.workingCopies[0];
    const workingCopyState = JSON.parse(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      firstWorkingCopy.stateRelativePath,
    ), "utf8"));
    expect(workingCopyState.sourceElementIdentitySchemaVersion).toBe(1);
    expect(workingCopyState.baseSha256).toBe(firstVersion.contentSha256);
    expect(workingCopyState.currentSha256).not.toBe(workingCopyState.baseSha256);

    const editor = launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first();
    await editor.waitFor({ state: "visible" });
    const editorHandle = await editor.elementHandle();
    await launched.page.waitForFunction(
      (element) => element?.getAttribute("data-render-verified") === "true",
      editorHandle,
    );
    const welcomeFrame = await currentEditorFrame(launched.page);
    await expect.poll(() =>
      welcomeFrame.locator('img[alt="源页 Logo"]').evaluate(
        (image) => image.complete && image.naturalWidth > 0,
      )
    ).toBe(true);
    await launched.electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await openRailGlobalCommentComposer(launched.page);
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill("把欢迎页主标题改得更简洁。");
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(launched.page);
    await expect(
      launched.page.getByTestId("ai-conversation-action-bar")
        .getByText("任务已复制，等你的 AI 改完", { exact: true }),
    ).toBeVisible();

    let promptPath = "";
    await expect.poll(async () => {
      const copied = await launched.electronApp.evaluate(
        ({ clipboard }) => clipboard.readText(),
      );
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const changeRequest = JSON.parse(
      readFileSync(path.join(path.dirname(promptPath), "change-request.json"), "utf8"),
    );
    expect(changeRequest.projectId).toBe(manifest.projectId);
    expect(changeRequest.requirements.instructions[0].text)
      .toBe("把欢迎页主标题改得更简洁。");
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron retries a managed Working Copy activation after the first response is lost", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture("managed-activation-retry.html");
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const v1Path = await managedWorkingCopyPath(launched.page, source.sourcePath);
    const projectsRoot = path.dirname(path.dirname(v1Path));
    const repository = new ProjectFileRepository({ projectsRoot });
    const workspace = await repository.workspace({ sourcePath: v1Path });
    const candidate = await repository.createCandidate({
      target: workspace.target,
      requestId: "req_e2e_managed_activation_retry",
      candidateId: "candidate_e2e_managed_activation_retry_0001",
      html: identityPreservingCandidateHtml(workspace.target, "V2 retry"),
      expectedSourceSha256: workspace.sourceSha256,
    });
    const promoted = await repository.promoteCandidate({
      target: workspace.target,
      candidateId: candidate.candidate.candidateId,
    });
    const expectedManagedPath = realpathSync(promoted.target.exactSourcePath);
    const payload = {
      previousSourcePath: v1Path,
      nextSourcePath: promoted.target.exactSourcePath,
      expectedSha256: promoted.target.sourceSha256,
      projectId: promoted.target.projectId,
      documentId: promoted.target.documentId,
      workingCopyId: promoted.target.workingCopyId,
      versionId: promoted.target.versionId,
      projectRootPath: promoted.target.projectRootPath,
      operationId: "e2e_managed_activation_retry_0001",
    };

    // The first call commits the main-process project state. Treat the return
    // value as lost, then replay exactly the same operation as the renderer
    // would after a Bridge response interruption.
    await launched.page.evaluate((input) => (
      window.htmlAIProjects.activateManagedWorkingCopy(input)
    ), payload);
    const replayed = await launched.page.evaluate((input) => (
      window.htmlAIProjects.activateManagedWorkingCopy(input)
    ), payload);
    expect(replayed.sourcePath).toBe(expectedManagedPath);
    expect(replayed.sha256).toBe(promoted.target.sourceSha256);
    const active = await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
    expect(active?.sourcePath).toBe(expectedManagedPath);
    const state = JSON.parse(readFileSync(
      path.join(launched.isolatedUserData, "html-projects.json"),
      "utf8",
    ));
    expect(state.lastManagedActivation?.operationId).toBe(payload.operationId);
    const staleOperation = await launched.page.evaluate(async (input) => {
      try {
        const result = await window.htmlAIProjects.activateManagedWorkingCopy(input);
        return { inputOperationId: input.operationId, result };
      } catch (error) {
        return {
          inputOperationId: input.operationId,
          message: error?.message || null,
        };
      }
    }, {
      ...payload,
      operationId: "e2e_managed_activation_stale_0001",
    });
    const stateAfterStaleAttempt = JSON.parse(readFileSync(
      path.join(launched.isolatedUserData, "html-projects.json"),
      "utf8",
    ));
    expect(staleOperation).toMatchObject({
      inputOperationId: "e2e_managed_activation_stale_0001",
      message: "当前桌面文件已变化，不能提交过期的托管工作文件切换。",
    });
    expect(stateAfterStaleAttempt.lastManagedActivation?.operationId).toBe(payload.operationId);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});

test("Electron Finder reveals verified project, visible Version Working Copy and derived AI task", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture("finder-derived-projections.html");
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const initialWorkingCopyPath = await managedWorkingCopyPath(
      launched.page,
      source.sourcePath,
    );
    const projectsRoot = path.dirname(path.dirname(initialWorkingCopyPath));
    const repository = new ProjectFileRepository({ projectsRoot });
    let active = (await repository.workspace({ sourcePath: initialWorkingCopyPath })).target;
    let v2Target = null;
    for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
      const candidate = await repository.createCandidate({
        target: active,
        requestId: `req_e2e_finder_${ordinal}`,
        candidateId: `candidate_e2e_finder_${ordinal}_0001`,
        html: identityPreservingCandidateHtml(active, `Finder V${ordinal}`),
        expectedSourceSha256: active.sourceSha256,
      });
      active = (await repository.promoteCandidate({
        target: active,
        candidateId: candidate.candidate.candidateId,
      })).target;
      if (ordinal === 2) v2Target = active;
    }
    expect(v2Target?.workingCopyId).toBe("work_ver_0002");
    const continued = await repository.replayHistoryVersionActivation(await seedLegacyHistoryActivation({
      target: active,
      versionId: "ver_0002",
      operationId: "e2e_finder_continue_v2_0001",
      expectedActiveWorkingCopyId: "work_ver_0006",
    }));
    const desktopV2 = await launched.page.evaluate((payload) => (
      window.htmlAIProjects.activateManagedWorkingCopy(payload)
    ), {
      previousSourcePath: initialWorkingCopyPath,
      nextSourcePath: continued.target.exactSourcePath,
      expectedSha256: continued.target.sourceSha256,
      projectId: continued.target.projectId,
      documentId: continued.target.documentId,
      workingCopyId: continued.target.workingCopyId,
      versionId: continued.target.versionId,
      projectRootPath: continued.target.projectRootPath,
      operationId: continued.historyActivation.operationId,
    });
    expect(desktopV2.sourcePath).toBe(realpathSync(continued.target.exactSourcePath));
    await repository.confirmVersionWorkingCopyActivation({
      target: active,
      operationId: continued.historyActivation.operationId,
      previousWorkingCopyId: "work_ver_0006",
      activatedWorkingCopyId: "work_ver_0002",
      versionId: "ver_0002",
    });

    const revealedVersion = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealVersionFile({ sourcePath, versionId: "ver_0002" })
    ), desktopV2.sourcePath);
    expect(revealedVersion.versionPath).toBe(realpathSync(v2Target.exactSourcePath));
    expect(revealedVersion.versionPath.includes(`${path.sep}.pageroot${path.sep}`)).toBe(false);
    const openedRoot = await bridgeJson(launched.page, "/open-folder", {
      method: "POST",
      body: { sourcePath: desktopV2.sourcePath },
    });
    expect(openedRoot.status).toBe(200);
    expect(openedRoot.body.path).toBe(continued.target.projectRootPath);

    const requestId = "req_e2e_visible_ai_task_0001";
    const request = await repository.prepareRequest({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      expectedSourceSha256: continued.target.sourceSha256,
      request: {
        freezeCutoffRevision: 0,
        summary: "从历史 Version 2 生成待审阅的 Version 7",
        comments: [{
          commentId: "comment_e2e_history_candidate",
          text: "从历史 Version 2 生成待审阅的 Version 7",
          target: { targetId: "target_e2e_history_candidate" },
          attachments: [],
        }],
        changeEvents: [],
        targets: [{ targetId: "target_e2e_history_candidate" }],
      },
      prompt: "# E2E AI task\n\n只生成候选 HTML。\n",
    });
    const processingTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    expect(processingTask.aiTaskPath).toMatch(/\/AI任务\/\d{4}-\d{2}-\d{2}-候选版本7$/u);
    expect(processingTask.aiTaskPath.includes(`${path.sep}.pageroot${path.sep}`)).toBe(false);
    expect(readFileSync(path.join(processingTask.aiTaskPath, "PROMPT.md"), "utf8"))
      .toBe("# E2E AI task\n\n只生成候选 HTML。\n");

    const candidateHtml = identityPreservingCandidateHtml(
      continued.target,
      "Finder V7 Candidate",
    );
    const completed = await repository.completeRequest({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      html: candidateHtml,
    });
    expect(completed.status).toBe("candidate-ready");
    const readyTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    const readyProjection = await repository.materializeAiTaskProjection({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    });
    expect(readyTask.aiTaskPath).toBe(realpathSync(readyProjection.taskPath));
    expect(readFileSync(readyProjection.candidatePath, "utf8")).toBe(candidateHtml);

    writeFileSync(readyProjection.candidatePath, "<!doctype html><html><head><title>tampered</title></head><body><p>tampered</p></body></html>", "utf8");
    const rebuiltTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    expect(rebuiltTask.aiTaskPath).not.toBe(realpathSync(readyProjection.taskPath));
    const hiddenCandidate = await repository.readCandidate({
      target: continued.target,
      candidateId: request.candidateId,
    });
    expect(hiddenCandidate.content).toBe(candidateHtml);
    const promoted = await repository.promoteCandidate({
      target: continued.target,
      candidateId: request.candidateId,
    });
    expect(promoted.version).toMatchObject({
      versionId: "ver_0007",
      basedOnVersionId: "ver_0002",
      previousVersionId: "ver_0006",
    });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});

test("Electron v4 registry recovers Finder rename and isolates duplicate project copies", async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "finder-registry-state.html");
  const originalExternal = fixtureBuffer("source-fidelity.html");
  writeFileSync(sourcePath, originalExternal);
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "pageroot-managed-root-outside-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({ isolatedUserData });
    electronApp = launched.electronApp;

    const preview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ registered: false });
    const ensured = await bridgeJson(launched.page, "/project/ensure", {
      method: "POST",
      body: {
        sourcePath,
        expectedSourceSha256: preview.body.sourceSha256,
        projectStorageVersion: "4.0.0",
      },
    });
    expect(ensured.status).toBe(200);
    expect(ensured.body).toMatchObject({
      registered: true,
      projectFileSchemaVersion: "4.0.0",
      imported: true,
    });
    expect(readFileSync(sourcePath)).toEqual(originalExternal);

    const firstTarget = ensured.body.openTarget;
    const projectsRoot = path.dirname(firstTarget.projectRootPath);
    const finderRenamedRoot = path.join(projectsRoot, "Finder 改名项目");
    const firstWorkingCopyName = path.basename(firstTarget.exactSourcePath);
    renameSync(firstTarget.projectRootPath, finderRenamedRoot);
    const finderRenamedPath = path.join(finderRenamedRoot, firstWorkingCopyName);

    const rootRecovered = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedPath)}`,
    );
    expect(rootRecovered.status).toBe(200);
    expect(rootRecovered.body).toMatchObject({
      registered: true,
      projectId: firstTarget.projectId,
      documentId: firstTarget.documentId,
    });
    expect(rootRecovered.body.openTarget.projectRootPath).toBe(finderRenamedRoot);

    const finderRenamedHtml = path.join(finderRenamedRoot, "Finder-B-V1.html");
    renameSync(finderRenamedPath, finderRenamedHtml);
    const htmlRecovered = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedHtml)}`,
    );
    expect(htmlRecovered.status).toBe(200);
    expect(htmlRecovered.body.openTarget).toMatchObject({
      projectId: firstTarget.projectId,
      workingCopyId: firstTarget.workingCopyId,
      exactSourcePath: finderRenamedHtml,
    });
    const renamedManifest = JSON.parse(readFileSync(
      path.join(finderRenamedRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(renamedManifest.workingCopies[0]).toMatchObject({
      sourceRelativePath: "Finder-B-V1.html",
      preferredFileStem: "Finder-B",
      preferredExtension: ".html",
      workingCopyId: firstTarget.workingCopyId,
    });

    const movedRoot = path.join(outsideRoot, "moved-project");
    const bytesBeforeMove = readFileSync(finderRenamedHtml);
    const targetBeforeMove = htmlRecovered.body.openTarget;
    renameSync(finderRenamedRoot, movedRoot);
    const movedHtml = path.join(movedRoot, "Finder-B-V1.html");
    const blockedSave = await bridgeJson(launched.page, "/autosave", {
      method: "POST",
      body: {
        ...targetBeforeMove,
        html: "<!doctype html><html><head><title>blocked</title></head><body><p>blocked</p></body></html>",
        expectedSourceSha256: targetBeforeMove.sourceSha256,
        editRevision: 1,
      },
    });
    expect(blockedSave.status).toBe(404);
    expect(blockedSave.body?.error?.code).toBe("REGISTERED_PROJECT_UNAVAILABLE");
    expect(readFileSync(movedHtml)).toEqual(bytesBeforeMove);

    const movedPreview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(movedHtml)}`,
    );
    expect(movedPreview.status).toBe(200);
    expect(movedPreview.body).toMatchObject({ registered: false });

    renameSync(movedRoot, finderRenamedRoot);
    const returned = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedHtml)}`,
    );
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({
      registered: true,
      projectId: firstTarget.projectId,
      documentId: firstTarget.documentId,
    });

    const copiedRoot = path.join(projectsRoot, "Finder 副本项目");
    cpSync(finderRenamedRoot, copiedRoot, { recursive: true });
    const copiedHtml = path.join(copiedRoot, "Finder-B-V1.html");
    const copiedManifestPath = path.join(copiedRoot, ".pageroot", "manifest.json");
    const copiedManifestBefore = readFileSync(copiedManifestPath);
    const copiedPreview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(copiedHtml)}`,
    );
    expect(copiedPreview.status).toBe(409);
    expect(copiedPreview.body?.error?.code).toBe("REGISTERED_PROJECT_AMBIGUOUS");
    expect(readFileSync(copiedManifestPath)).toEqual(copiedManifestBefore);
    const duplicateRows = await bridgeJson(launched.page, "/registered-projects");
    expect(duplicateRows.body.projects.find((row) => row.projectId === firstTarget.projectId))
      .toMatchObject({ sourceStatus: "duplicate" });
    renameSync(copiedRoot, path.join(outsideRoot, "duplicate-project"));

    const repository = new ProjectFileRepository({ projectsRoot });
    await repository.initialize();
    const workspace = await repository.workspace({ sourcePath: finderRenamedHtml });
    const candidate = await repository.createCandidate({
      target: workspace.target,
      requestId: "req_e2e_registered_root",
      candidateId: "candidate_e2e_registered_root_0001",
      html: identityPreservingCandidateHtml(workspace.target, "Finder candidate"),
      expectedSourceSha256: workspace.sourceSha256,
    });
    const userFile = path.join(finderRenamedRoot, "Finder-B-V2.html");
    const userDirectory = path.join(finderRenamedRoot, "Finder-B-V2-V2.html");
    const userSymlink = path.join(finderRenamedRoot, "Finder-B-V2-V2-V2.html");
    const userSymlinkTarget = path.join(outsideRoot, "user-symlink-target.html");
    writeFileSync(userFile, "user file must not be overwritten", "utf8");
    mkdirSync(userDirectory);
    writeFileSync(userSymlinkTarget, "user symlink target", "utf8");
    symlinkSync(userSymlinkTarget, userSymlink);

    const promoted = await repository.promoteCandidate({
      target: workspace.target,
      candidateId: candidate.candidate.candidateId,
    });
    expect(path.basename(promoted.target.exactSourcePath)).toBe("Finder-B-V2-V2-V2-V2.html");
    expect(readFileSync(userFile, "utf8")).toBe("user file must not be overwritten");
    expect(readdirSync(userDirectory)).toEqual([]);
    expect(readFileSync(userSymlinkTarget, "utf8")).toBe("user symlink target");
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(outsideRoot, "pageroot-managed-root-outside-");
    removeValidatedTemporaryDirectory(sourceDirectory, "pageroot-native-source-e2e-");
  }
});

test("Electron keeps managed V1 identity in the selected tab and retires title-bar rename", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  const launched = await launchPageRoot();
  const externalOriginalPath = path.join(
    realpathSync(launched.isolatedUserData),
    "欢迎来到源页.html",
  );
  try {
    await waitForProjectReady(launched.page);
    let managedOriginalPath = "";
    await expect.poll(
      async () => {
        const active = await launched.page.evaluate(
          () => window.htmlAIProjects?.getActiveProject(),
        );
        managedOriginalPath = String(active?.sourcePath || "");
        return Boolean(
          managedOriginalPath && managedOriginalPath !== externalOriginalPath,
        );
      },
      { timeout: 20_000 },
    ).toBe(true);
    expect(path.basename(managedOriginalPath)).toBe("欢迎来到源页-V1.html");
    const projectRoot = path.dirname(managedOriginalPath);
    const originalBytes = readFileSync(externalOriginalPath);
    const originalManifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    const projectId = originalManifest.projectId;

    await expect(titleStemLocator(launched.page)).toHaveText("欢迎来到源页-V1.html");
    await expect(launched.page.getByRole("button", { name: /重命名文件/u }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("textbox", { name: "文件名（不含后缀）" }))
      .toHaveCount(0);
    expect(readFileSync(externalOriginalPath)).toEqual(originalBytes);
    const managedBytes = readFileSync(managedOriginalPath);
    expect(managedBytes).not.toEqual(originalBytes);
    const managedSourceIds = [...managedBytes.toString("utf8").matchAll(
      /data-pageroot-id="(pr1_[0-9a-f]{32})"/gu,
    )].map((match) => match[1]);
    expect(managedSourceIds.length).toBeGreaterThan(0);
    expect(new Set(managedSourceIds).size).toBe(managedSourceIds.length);
    const firstVersion = originalManifest.versions.find(
      (version) => version.versionId === "ver_0001",
    );
    expect(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      firstVersion.snapshotRelativePath,
    ))).toEqual(originalBytes);

    const state = JSON.parse(
      readFileSync(path.join(launched.isolatedUserData, "html-projects.json"), "utf8"),
    );
    expect(state.version).toBe(2);
    expect(state.activePath).toBe(managedOriginalPath);
    expect(state.recent[0].path).toBe(managedOriginalPath);
    expect(state.pendingRename).toBeNull();

    const currentManifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(currentManifest.projectId).toBe(projectId);
    expect(currentManifest.documentId).toBe(originalManifest.documentId);
    expect(currentManifest.workingCopies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workingCopyId: "work_ver_0001",
        sourceRelativePath: "欢迎来到源页-V1.html",
        preferredFileStem: "欢迎来到源页",
        preferredExtension: ".html",
      }),
    ]));
    const registry = JSON.parse(readFileSync(
      path.join(path.dirname(projectRoot), ".pageroot-registry.json"),
      "utf8",
    ));
    expect(realpathSync(registry.projects[projectId].registeredProjectRootPath))
      .toBe(realpathSync(projectRoot));
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron rapid project switching and immediate close preserve the last native edit", async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("close-switch-a.html");
  const projectB = createSourceFixture("close-switch-b.html");
  const firstLaunch = await launchPageRoot({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  let firstClosed = false;
  let reopened = null;
  try {
    const switchedText = "快速切换仍然安全写回";
    const closeText = "关闭前最后一次原位编辑";
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      projectA.sourcePath,
      "list-item",
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await firstLaunch.page.keyboard.insertText(switchedText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);
    const projectAWorkingCopyPath = await managedWorkingCopyPath(
      firstLaunch.page,
      projectA.sourcePath,
    );

    await openRecentProject(firstLaunch.page, projectB.sourcePath);
    await expect.poll(
      () => readFileSync(projectAWorkingCopyPath, "utf8"),
      { timeout: 20_000 },
    ).toContain(switchedText);
    expect(readFileSync(projectA.sourcePath, "utf8")).not.toContain(switchedText);

    ({ frame } = await openRecentProject(
      firstLaunch.page,
      projectAWorkingCopyPath,
      "list-item",
      path.basename(projectA.sourcePath),
    ));
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, switchedText.length);
    await firstLaunch.page.keyboard.insertText(closeText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(closeText);

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstClosed = true;
    reopened = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      projectAWorkingCopyPath,
      "list-item",
    );
    await expect(reopenedFrame.locator(caseSelector("list-item")))
      .toHaveText(closeText);
    expect(readFileSync(projectAWorkingCopyPath, "utf8")).toContain(closeText);
    expect(readFileSync(projectA.sourcePath, "utf8")).not.toContain(closeText);
  } finally {
    if (reopened) {
      await stopPageRoot(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(
        firstLaunch.electronApp,
        firstLaunch.isolatedUserData,
      );
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

for (const renameKind of ["HTML", "project folder"]) {
  test(`Electron rebases a ${renameKind} rename between active-project classification and read`, async () => {
    const fixture = createSourceFixture("startup-read-rename.html");
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    try {
      await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
      const sourcePath = await managedWorkingCopyPath(launched.page, fixture.sourcePath);
      const before = await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
      const root = path.dirname(sourcePath);
      const nextRoot = renameKind === "HTML" ? root : `${root}-renamed`;
      const nextPath = renameKind === "HTML"
        ? path.join(root, "renamed-between-reads-V1.html")
        : path.join(nextRoot, path.basename(sourcePath));
      const bytes = readFileSync(sourcePath);
      // Change the real filesystem only when Main starts the second read.
      // Hold background reconciliation so it cannot repair a stale locator
      // before the assertions observe this operation's own result.
      await launched.electronApp.evaluate(({ net }) => {
        const fetch = net.fetch.bind(net);
        let pending = true;
        globalThis.__PAGEROOT_READ_RENAME_WAITING__ = false;
        const renamed = new Promise((resolve) => {
          globalThis.__PAGEROOT_RELEASE_READ_RENAME__ = resolve;
        });
        let release;
        const barrier = new Promise((resolve) => { release = resolve; });
        globalThis.__PAGEROOT_FINISH_READ_RENAME__ = () => {
          net.fetch = fetch;
          release();
          globalThis.__PAGEROOT_RELEASE_READ_RENAME__();
        };
        net.fetch = async (input, options) => {
          const url = new URL(String(input));
          if (url.pathname === "/managed-working-copy/reconcile") await barrier;
          if (pending && url.pathname === "/registered-project/open"
            && url.searchParams.has("workingCopyId")) {
            pending = false;
            globalThis.__PAGEROOT_READ_RENAME_WAITING__ = true;
            await renamed;
          }
          return fetch(input, options);
        };
      });
      const activeRead = launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
      await expect.poll(() => launched.electronApp.evaluate(() => globalThis.__PAGEROOT_READ_RENAME_WAITING__)).toBe(true);
      renameSync(renameKind === "HTML" ? sourcePath : root, renameKind === "HTML" ? nextPath : nextRoot);
      await launched.electronApp.evaluate(() => globalThis.__PAGEROOT_RELEASE_READ_RENAME__());
      const current = await activeRead;
      expect(current.projectId).toBe(before.projectId);
      expect(current.documentId).toBe(before.documentId);
      expect(sameDesktopSourcePath(current.sourcePath, nextPath)).toBe(true);
      const state = await readDesktopProjectState(launched.isolatedUserData);
      expect(sameDesktopSourcePath(state.activePath, nextPath)).toBe(true);
      expect(sameDesktopSourcePath(state.recent[0].path, nextPath)).toBe(true);
      expect(sameDesktopSourcePath(state.activeManagedLocator.sourcePath, nextPath)).toBe(true);
      expect(sameDesktopSourcePath(state.activeManagedLocator.projectRootPath, nextRoot)).toBe(true);
      expect(readFileSync(nextPath)).toEqual(bytes);
      await launched.electronApp.evaluate(() => globalThis.__PAGEROOT_FINISH_READ_RENAME__());
      await launched.page.evaluate(() => {
        window.__PAGEROOT_READ_RENAME_EVENTS__ = [];
        window.htmlAIProjects.onSourceFileChanged((event) => {
          window.__PAGEROOT_READ_RENAME_EVENTS__.push(event.sourcePath);
        });
      });
      writeFileSync(nextPath, bytes);
      await expect.poll(async () => (
        await launched.page.evaluate(() => window.__PAGEROOT_READ_RENAME_EVENTS__)
      ).some((value) => sameDesktopSourcePath(value, nextPath))).toBe(true);
    } finally {
      await launched.electronApp.evaluate(() => globalThis.__PAGEROOT_FINISH_READ_RENAME__?.());
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}

test("Electron follows a same-directory Finder rename and keeps the selected tab synchronized", async () => {
  const fixture = createSourceFixture("finder-rename-sync.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      fixture.sourcePath,
      "list-item",
    );
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const beforeIds = {
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId || beforeTarget.activeWorkingCopyId,
      versionId: beforeTarget.versionId
        || beforeTarget.currentExactVersionId
        || beforeTarget.currentBasedOnVersionId,
    };
    const beforeManifest = await readManagedManifest(managedSourcePath);
    const beforeVersionCount = beforeManifest.versions.length;
    const finderName = "Finder 新名字-V1.html";
    const finderPath = path.join(path.dirname(managedSourcePath), finderName);
    renameSync(managedSourcePath, finderPath);

    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);
    const { frame } = await loadedDiskFrame(
      launched.page,
      finderPath,
      "list-item",
      { allowSourceNotAuthoritative: true },
    );

    const afterWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeIds.projectId);
    expect(afterTarget.documentId).toBe(beforeIds.documentId);
    expect(afterTarget.workingCopyId || afterTarget.activeWorkingCopyId)
      .toBe(beforeIds.workingCopyId);
    expect(
      afterTarget.versionId
      || afterTarget.currentExactVersionId
      || afterTarget.currentBasedOnVersionId,
    ).toBe(beforeIds.versionId);
    const desktopState = await readDesktopProjectState(isolatedUserData);
    expect(sameDesktopSourcePath(desktopState.activePath, finderPath)).toBe(true);
    expect(sameDesktopSourcePath(desktopState.recent[0].path, finderPath)).toBe(true);
    expect(sameDesktopSourcePath(
      desktopState.activeManagedLocator.sourcePath,
      finderPath,
    )).toBe(true);
    const afterManifest = await readManagedManifest(finderPath);
    expect(afterManifest.versions.length).toBe(beforeVersionCount);
    expect(afterManifest.workingCopies[0].sourceRelativePath).toBe(finderName);

    const beforeRevision = Number(
      await launched.page.locator("[data-persist-state]").first()
        .getAttribute("data-persisted-revision"),
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, 0);
    await launched.page.keyboard.insertText("定位后仍可编辑。");
    await launched.page.keyboard.press("Escape");
    await expectCheckpointPersisted(launched.page, beforeRevision);
    expect(readFileSync(finderPath, "utf8")).toContain("定位后仍可编辑。");
    expect(readFileSync(finderPath, "utf8")).toContain(ORIGINAL_LIST_TEXT);
    await addCanvasComment(
      launched.page,
      await currentEditorFrame(launched.page),
      "list-item",
      "Finder 改名后评论仍保留。",
    );

    await expect(launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "Finder 新名字-V1" }))
      .toHaveCount(1);
    await expect(launched.page.getByRole("button", { name: /重命名文件/u }))
      .toHaveCount(0);
    const finalManifest = await readManagedManifest(finderPath);
    expect(finalManifest.versions.length).toBe(beforeVersionCount);
    expect(readFileSync(finderPath, "utf8")).toContain("定位后仍可编辑。");
    await expect(launched.page.locator(".comment-card").filter({
      hasText: "Finder 改名后评论仍保留。",
    })).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron keeps project identity after Finder rename without restoring title-bar rename", async () => {
  const fixture = createSourceFixture("title-bar-finder-loop.html");
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
    const beforeIds = {
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId || beforeTarget.activeWorkingCopyId,
    };
    const projectDirectory = path.dirname(managedSourcePath);

    const finalFinderName = "finder-final-V1.html";
    const finalPath = path.join(projectDirectory, finalFinderName);
    renameSync(managedSourcePath, finalPath);
    await waitForTitleStem(launched.page, path.basename(finalFinderName, ".html"));
    await waitForActiveSourcePath(launched.page, finalPath);
    await expect(launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "finder-final-V1" }))
      .toHaveCount(1);
    await expect(launched.page.getByRole("button", { name: /重命名文件/u }))
      .toHaveCount(0);

    const afterWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finalPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeIds.projectId);
    expect(afterTarget.documentId).toBe(beforeIds.documentId);
    expect(afterTarget.workingCopyId || afterTarget.activeWorkingCopyId)
      .toBe(beforeIds.workingCopyId);
    const afterManifest = await readManagedManifest(finalPath);
    expect(afterManifest.workingCopies[0].sourceRelativePath)
      .toBe(finalFinderName);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron keeps PageRoot bytes when Finder renames and edits the same file", async () => {
  const fixture = createSourceFixture("finder-rename-conflict.html");
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
    const finderPath = path.join(
      path.dirname(managedSourcePath),
      "finder-conflict-V1.html",
    );
    const original = readFileSync(managedSourcePath);
    renameSync(managedSourcePath, finderPath);
    writeFileSync(finderPath, `${original.toString("utf8")}\n<!-- finder-external -->\n`, "utf8");

    await waitForTitleStem(launched.page, "finder-conflict-V1");
    await waitForActiveSourcePath(launched.page, finderPath);
    await expect.poll(async () => (
      launched.page.locator("[data-persist-state]").first().getAttribute("data-persist-state")
    )).toBe("conflict");
    expect(readFileSync(finderPath, "utf8")).toContain("finder-external");
    const editorFrame = await currentEditorFrame(launched.page);
    await expect(editorFrame.locator(caseSelector("list-item")))
      .toContainText(ORIGINAL_LIST_TEXT);
    expect(await editorFrame.locator("body").innerHTML()).not.toContain("finder-external");
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron does not follow a copied Working Copy or expose the retired title-bar rename", async () => {
  const fixture = createSourceFixture("finder-rename-copy.html");
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
    const originalStem = path.basename(managedSourcePath, path.extname(managedSourcePath));
    const copiedPath = path.join(
      path.dirname(managedSourcePath),
      "copied-working-copy.html",
    );
    cpSync(managedSourcePath, copiedPath);
    const copyDeadline = Date.now() + 800;
    await expect.poll(async () => {
      const current = await launched.page.evaluate(() => (
        window.htmlAIProjects?.getActiveProject()
      ));
      if (current?.sourcePath !== managedSourcePath) return current?.sourcePath || "";
      return Date.now() >= copyDeadline ? managedSourcePath : "";
    }).toBe(managedSourcePath);
    await expect(titleStemLocator(launched.page)).toContainText(originalStem);
    await expect(launched.page.getByRole("button", { name: /重命名文件/u }))
      .toHaveCount(0);
    expect(existsSync(managedSourcePath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron follows a same-parent project folder rename without restoring title-bar rename", async () => {
  const fixture = createSourceFixture("finder-folder-rename.html");
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
    const projectRoot = path.dirname(managedSourcePath);
    const renamedRoot = path.join(path.dirname(projectRoot), "Finder 项目文件夹");
    const relocatedPath = path.join(renamedRoot, path.basename(managedSourcePath));
    renameSync(projectRoot, renamedRoot);
    await waitForDesktopActivePath(isolatedUserData, relocatedPath);
    await waitForActiveSourcePath(launched.page, relocatedPath);
    await waitForTitleStem(
      launched.page,
      path.basename(managedSourcePath, path.extname(managedSourcePath)),
    );

    await expect(launched.page.getByRole("button", { name: /重命名文件/u }))
      .toHaveCount(0);
    expect(existsSync(relocatedPath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron does not follow a Working Copy moved out of the registered project root", async () => {
  const fixture = createSourceFixture("finder-rename-escaped.html");
  let electronApp = null;
  let isolatedUserData = null;
  let outsideDirectory = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const originalStem = path.basename(managedSourcePath, path.extname(managedSourcePath));
    outsideDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-escaped-"));
    const escapedPath = path.join(outsideDirectory, path.basename(managedSourcePath));
    renameSync(managedSourcePath, escapedPath);
    const moveDeadline = Date.now() + 1_200;
    await expect.poll(async () => {
      try {
        const state = await readDesktopProjectState(isolatedUserData);
        if (sameDesktopSourcePath(state.activePath, escapedPath)) return "followed";
      } catch {
        return "";
      }
      return Date.now() >= moveDeadline ? "stayed" : "";
    }).toBe("stayed");
    await expect(titleStemLocator(launched.page)).toContainText(originalStem);
    expect(existsSync(escapedPath)).toBe(true);
    expect(existsSync(managedSourcePath)).toBe(false);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    if (outsideDirectory) {
      removeValidatedTemporaryDirectory(outsideDirectory, "pageroot-native-escaped-");
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});
