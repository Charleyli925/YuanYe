import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  activateNativeEdit,
  addCanvasComment,
  caseSelector,
  chooseClipboardDelivery,
  closePageRootGracefully,
  createSourceFixture,
  documentToken,
  expectCheckpointPersisted,
  existsSync,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdirSync,
  mkdtempSync,
  openRailGlobalCommentComposer,
  path,
  readFileSync,
  readdirSync,
  removeIsolatedUserData,
  removeSourceFixture,
  requestDirectoryCount,
  removeValidatedTemporaryDirectory,
  sendToMainRenderer,
  setTextSelection,
  stopPageRoot,
  tmpdir,
  workspaceContainsDraftComment,
  writeFileSync,
} from "./electron-native-harness.mjs";

function managedDraftComment(managedSourcePath, text) {
  const draftsRoot = path.join(
    path.dirname(managedSourcePath),
    ".pageroot",
    "drafts",
  );
  if (!existsSync(draftsRoot)) return null;
  for (const name of readdirSync(draftsRoot)) {
    if (!name.endsWith(".json")) continue;
    const draft = JSON.parse(readFileSync(path.join(draftsRoot, name), "utf8"));
    const comment = Array.isArray(draft.comments)
      ? draft.comments.find((candidate) => candidate.text === text)
      : null;
    if (comment) return comment;
  }
  return null;
}

async function retainedEditorDocumentToken(page) {
  return page.locator(
    '[data-testid="workbench-active-document-canvas"] iframe[title*="HTML"]',
  ).first().evaluate((frameElement) => {
    const key = "__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__";
    const view = frameElement.contentWindow;
    if (!view) throw new Error("Retained PageRoot edit iframe has no active window.");
    if (!view[key]) view[key] = crypto.randomUUID();
    return view[key];
  });
}

test("长期规则入口打开唯一规则标签并保留 HTML 画布", async () => {
  test.setTimeout(90_000);
  const fixture = createSourceFixture("project-rules-first-stage.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const { frame } = await loadedDiskFrame(
      launched.page,
      fixture.sourcePath,
      "list-item",
    );
    const beforeDocumentToken = await documentToken(launched.page);
    const sidebarToggle = launched.page.getByRole("button", { name: "展开左侧边栏" });
    if (await sidebarToggle.count()) await sidebarToggle.click();
    const rulesEntry = launched.page.locator(".sidebar-project-rules-row");
    await expect(rulesEntry).toBeVisible();
    await expect(rulesEntry).toContainText("长期规则");
    await expect(rulesEntry).not.toContainText("PROJECT.md");

    await rulesEntry.click();
    const rulesTab = launched.page.getByRole("tab", { name: "长期规则", exact: true });
    await expect(rulesTab).toHaveAttribute("aria-selected", "true");
    const editor = launched.page.getByRole("textbox", { name: "长期规则内容" });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(/## 项目目标/u);
    await editor.fill("只修改首页标题");
    await expect(editor).toHaveValue("只修改首页标题");
    await editor.selectText();
    await launched.page.getByRole("toolbar", { name: "Markdown 基础格式" })
      .getByRole("button", { name: "加粗" })
      .click();
    await expect(editor).toHaveValue("**只修改首页标题**");
    await launched.page.keyboard.press("Meta+s");

    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    await expect.poll(() => readFileSync(
      path.join(path.dirname(managedSourcePath), "PROJECT.md"),
      "utf8",
    )).toContain("只修改首页标题");

    await editor.focus();
    await editor.press("End");
    await editor.evaluate((element) => {
      window.__rulesCompositionTextarea = element;
      window.__rulesCompositionEvents = [];
      for (const type of ["compositionstart", "compositionend"]) {
        element.addEventListener(type, () => window.__rulesCompositionEvents.push(type));
      }
    });
    const cdp = await launched.page.context().newCDPSession(launched.page);
    await cdp.send("Input.imeSetComposition", { text: "zhongwen", selectionStart: 8, selectionEnd: 8 });
    await cdp.send("Input.insertText", { text: "中文" });
    await editor.pressSequentially("规则");
    await expect(editor).toHaveValue("**只修改首页标题**中文规则");
    expect(await editor.evaluate((element) => ({
      sameElement: element === window.__rulesCompositionTextarea,
      focused: document.activeElement === element,
      caret: element.selectionStart,
      end: element.selectionEnd,
      length: element.value.length,
      events: window.__rulesCompositionEvents,
    }))).toEqual({
      sameElement: true, focused: true, caret: "**只修改首页标题**中文规则".length, end: "**只修改首页标题**中文规则".length, length: "**只修改首页标题**中文规则".length,
      events: ["compositionstart", "compositionend"],
    });
    await launched.page.keyboard.press("Meta+s");
    await expect.poll(() => readFileSync(
      path.join(path.dirname(managedSourcePath), "PROJECT.md"), "utf8",
    )).toBe("**只修改首页标题**中文规则");
    await cdp.detach();

    await rulesEntry.click();
    await expect(launched.page.getByRole("tab", { name: "长期规则", exact: true }))
      .toHaveCount(1);
    await expect.poll(() => retainedEditorDocumentToken(launched.page)).toBe(beforeDocumentToken);

    const documentTab = launched.page.locator(".workbench-tab")
      .filter({ hasNotText: "长期规则" })
      .getByRole("tab")
      .first();
    await documentTab.click();
    await expect.poll(() => documentToken(launched.page)).toBe(beforeDocumentToken);
    await expect(frame.locator(caseSelector("list-item"))).toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("selected-text comments persist stable identity and stay exact after text replacement", async () => {
  test.setTimeout(90_000);
  const fixture = createSourceFixture("stable-selected-text-comment.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const commentText = "这三个字需要更直接。";
  try {
    const { editor, frame } = await loadedDiskFrame(
      launched.page,
      fixture.sourcePath,
      "list-item",
    );
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, 3);
    const editDocument = await documentToken(frame);
    const editGeneration = await editor.locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    await launched.page.getByRole("toolbar", { name: /编辑/u })
      .getByRole("button", { name: /留评论/u })
      .click();
    await expect(frame.locator(caseSelector("list-item")))
      .toHaveAttribute("contenteditable", "true");
    await expect.poll(() => documentToken(frame)).toBe(editDocument);
    await expect(editor.locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", editGeneration);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    const composer = launched.page.getByRole("region", { name: "添加评论" });
    await composer.getByRole("textbox", { name: "评论内容" }).fill(commentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();
    await expect(frame.locator(caseSelector("list-item")))
      .toHaveAttribute("contenteditable", "true");
    await expect.poll(() => documentToken(frame)).toBe(editDocument);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);

    await expect.poll(
      () => managedDraftComment(managedSourcePath, commentText),
      { timeout: 20_000 },
    ).not.toBeNull();
    const comment = managedDraftComment(managedSourcePath, commentText);
    expect(comment.target.elementId).toMatch(/^pr1_[0-9a-f]{32}$/u);
    expect(comment.target.expectedSourceSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(comment.target.textLocator).toEqual({
      quote: ORIGINAL_LIST_TEXT.slice(0, 3),
      startOffset: 0,
      endOffset: 3,
      affinity: "forward",
    });

    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await launched.page.keyboard.insertText("替换后的评论目标文字。");
    const card = launched.page.locator(".comment-card").filter({ hasText: commentText });
    await expect(card).toHaveAttribute("data-resolution", "exact", { timeout: 20_000 });
    await expect(card.getByText("原位置已变化")).toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron preview shows the read-only comment marker and opens it on hover and keyboard focus", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-preview-comment-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "commented-page.html");
  const commentText = "这个标题再简洁一些。";
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>带评论的页面</title></head>
<body>
  <main>
    <h1 id="headline" data-native-case="preview-comment-headline">季度经营大盘</h1>
    <p id="summary">本季度整体达成预期。</p>
  </main>
</body>
</html>
`,
    "utf8",
  );

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "preview-comment-headline",
    );

    // A comment anchored to one element, not a global page comment: only an
    // element target has a place on the page to mark.
    await editFrame.locator(caseSelector("preview-comment-headline")).click();
    await launched.page.getByRole("toolbar", { name: /编辑/u })
      .getByRole("button", { name: /留评论/u })
      .click();
    const composer = launched.page.getByRole("region", { name: "添加评论" });
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox", { name: "评论内容" }).fill(commentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    const marker = launched.page.getByTestId("preview-comment-marker");
    await expect(marker).toHaveCount(1, { timeout: 30_000 });
    await expect(marker).toBeVisible();
    // The marker sits over the page, never at the viewport origin.
    await expect.poll(async () => {
      const box = await marker.boundingBox();
      return box ? box.x > 0 && box.y > 0 : false;
    }).toBe(true);

    // Comment text lives in the trusted host, never inside the previewed page.
    const previewFrame = launched.page.frames().find(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    );
    if (previewFrame) {
      await expect.poll(() => previewFrame.locator("html").evaluate(
        (element, text) => element.innerHTML.includes(text),
        commentText,
      )).toBe(false);
    }

    const bubble = marker.getByTestId("preview-comment-bubble");
    await expect(bubble).toBeHidden();
    await marker.hover();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(commentText);

    await launched.page.getByRole("button", { name: "编辑", exact: true }).hover();
    await expect(bubble).toBeHidden();

    // Keyboard focus reaches the same bubble. Press Tab first so the input
    // modality is keyboard again; the bubble binds :focus-visible.
    await launched.page.keyboard.press("Tab");
    await marker.focus();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(commentText);

    // The marker is read-only: it never enters editing or moves the selection.
    await launched.page.keyboard.press("Enter");
    await launched.page.keyboard.press("Space");
    await expect(bubble).toBeVisible();
    await expect(launched.page.getByRole("region", { name: "添加评论" }))
      .toHaveCount(0);
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    await marker.blur();
    await expect(bubble).toBeHidden();
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-preview-comment-e2e-",
    );
  }
});

test("Electron preview mounts the modification-only AI sidebar across reopen", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-ai-sidebar-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "sidebar-page.html");
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>侧栏页面</title></head>
<body><main><h1 id="headline" data-native-case="sidebar-headline">季度大盘</h1></main></body>
</html>
`,
    "utf8",
  );

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, sourcePath, "sidebar-headline");

    await openRailGlobalCommentComposer(launched.page);
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill("请把季度大盘标题改得更简洁。");
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    // The sidebar is opt-in in preview: a docked aside, not a modal.
    const openToggle = launched.page.getByRole("button", { name: "AI 助手" });
    await expect(openToggle).toHaveCount(1);
    await expect(openToggle).toBeVisible();
    await openToggle.click();

    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(launched.page.getByTestId("ai-conversation-mode"))
      .toHaveText("待发送");
    // The preview iframe stays alive beside the sidebar — not replaced by a modal.
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    // Wait for the conversation to finish loading: the empty-state copy appears
    // only once the Bridge has established this Document's conversation. Typing
    // before that would be dropped by the controlled composer.
    await expect(sidebar.getByText("还没有修改记录", { exact: false }))
      .toBeVisible({ timeout: 15_000 });
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-context-summary"))
      .toContainText("1 条修改意见");

    // Collapsing and reopening keeps the same single-purpose product surface.
    await openToggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(openToggle).toHaveAttribute("aria-expanded", "false");
    await openToggle.click();
    await expect(launched.page.getByTestId("ai-conversation-mode"))
      .toHaveText("待发送", { timeout: 15_000 });
    await expect(launched.page.getByTestId("ai-conversation-input")).toHaveCount(0);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-ai-sidebar-e2e-",
    );
  }
});


test("orphaned comments stay card-local and block send without a relink flow", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("orphaned-comments-resume-send.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const firstComment = "把原列表项改成更简洁的表达。";
  const secondComment = "把原表格单元格改成更清楚的说明。";
  let activeLaunch = firstLaunch;
  let firstAppClosed = false;
  try {
    const { frame: firstCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      fixture.sourcePath,
      "list-item",
    );
    await addCanvasComment(
      firstLaunch.page,
      firstCommentFrame,
      "list-item",
      firstComment,
    );
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      fixture.sourcePath,
    );
    const { frame: secondCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "table-cell",
    );
    await addCanvasComment(
      firstLaunch.page,
      secondCommentFrame,
      "table-cell",
      secondComment,
    );
    const { frame: editingFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "list-item",
    );
    const persistedRevision = Number(await firstLaunch.page
      .locator("[data-persist-state]")
      .first()
      .getAttribute("data-persisted-revision"));

    await activateNativeEdit(editingFrame, "list-item");
    await setTextSelection(editingFrame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await firstLaunch.page.keyboard.insertText("失联评论登记测试");
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, secondComment),
      { timeout: 20_000 },
    ).toBe(true);
    await expectCheckpointPersisted(firstLaunch.page, persistedRevision);

    const externallyChanged = readFileSync(managedSourcePath, "utf8")
      .replace(
        /<li data-native-case="list-item"[^>]*>[\s\S]*?<\/li>/u,
        "",
      )
      .replace(
        /<td data-native-case="table-cell"[^>]*>[\s\S]*?<\/td>/u,
        "",
      );
    writeFileSync(managedSourcePath, externallyChanged, "utf8");

    // Removing source elements also removes their stable identities. The PR2
    // identity contract must fail closed until the user explicitly adopts the
    // external bytes; a restart may not silently bless the identity loss.
    const conflictBanner = firstLaunch.page.locator(".source-conflict-banner");
    await expect(conflictBanner).toBeVisible({ timeout: 5_000 });
    await expect(conflictBanner.locator("strong"))
      .toContainText("源文件在磁盘上被其他程序修改了");
    firstLaunch.page.once("dialog", (dialog) => dialog.accept());
    await conflictBanner.getByRole("button", { name: "采用磁盘版本" }).click();
    await expect(conflictBanner).toHaveCount(0, { timeout: 20_000 });
    await loadedDiskFrame(firstLaunch.page, managedSourcePath, "flex-copy");

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstAppClosed = true;

    activeLaunch = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    await loadedDiskFrame(
      activeLaunch.page,
      managedSourcePath,
      "flex-copy",
    );
    const recoveredComments = activeLaunch.page.locator(".comment-card");
    await expect(recoveredComments).toHaveCount(2);
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "orphaned");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toContainText("建议删除这条评论，并在正确位置重新评论");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toContainText("建议删除这条评论，并在正确位置重新评论");

    await activeLaunch.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(activeLaunch.page);
    // A blocked handoff returns to Edit, which closes the AI presentation while
    // preserving its Document history and restores the orphaned comment cards.
    await expect(activeLaunch.page.getByRole("button", { name: "AI 助手", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await expect(activeLaunch.page.locator(".comment-rail")).toBeVisible();
    await expect(activeLaunch.page.locator(".comment-rail .rail-relink-status"))
      .toHaveCount(0);
    await expect(activeLaunch.page.getByText(/评论需要重新定位/u)).toHaveCount(0);
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-focused", "true");
    await expect.poll(
      () => requestDirectoryCount(activeLaunch.workspace),
    ).toBe(0);

    const firstLostCard = recoveredComments.filter({ hasText: firstComment });
    await firstLostCard.hover();
    await firstLostCard.getByRole("button", { name: "删除评论" }).click();
    await firstLostCard.getByRole("button", { name: "删除", exact: true }).click();
    const secondLostCard = recoveredComments.filter({ hasText: secondComment });
    await secondLostCard.hover();
    await secondLostCard.getByRole("button", { name: "删除评论" }).click();
    await secondLostCard.getByRole("button", { name: "删除", exact: true }).click();
    await expect(recoveredComments).toHaveCount(0);
  } finally {
    if (activeLaunch !== firstLaunch) {
      await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    } else if (!firstAppClosed) {
      await stopPageRoot(firstLaunch.electronApp, firstLaunch.isolatedUserData);
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("automatic update actions keep the sidebar product geometry and split About from Settings", async () => {
  const fixture = createSourceFixture("update-indicator.html");
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    const toolbarCleanupOutput = process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP
      ? path.resolve(
        process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP_DIR
          || path.join(process.cwd(), "output", "design-qa", "toolbar-cleanup"),
      )
      : null;
    if (toolbarCleanupOutput) {
      mkdirSync(toolbarCleanupOutput, { recursive: true });
    }
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect.poll(() => sidebar.evaluate((element) => {
      const actualWidth = element.getBoundingClientRect().width;
      const workbench = element.closest(".workbench");
      const targetWidth = workbench
        ? Number.parseFloat(getComputedStyle(workbench).gridTemplateColumns.split(" ")[0])
        : 0;
      return Math.abs(actualWidth - targetWidth);
    })).toBeLessThanOrEqual(0.5);
    await launched.page.evaluate(async () => {
      const workbench = document.querySelector(".workbench");
      if (!workbench) throw new Error("Workbench geometry owner is unavailable.");
      await Promise.all(workbench.getAnimations().map((animation) => (
        animation.finished.catch(() => undefined)
      )));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    });
    const captureSidebarProduct = async ({ badgeExpected = true } = {}) => {
      const geometry = await launched.page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        };
        return {
          sidebar: rect(".workbench-global-sidebar"),
          product: rect(".workbench-sidebar-product"),
          about: rect(".workbench-sidebar-product > button:first-child"),
          icon: rect(".workbench-sidebar-product > button:first-child > span"),
          badge: rect(".workbench-sidebar-update"),
        };
      });
      expect(geometry.sidebar).not.toBeNull();
      expect(geometry.product).not.toBeNull();
      expect(geometry.about).not.toBeNull();
      expect(geometry.icon).not.toBeNull();
      expect(Math.abs(
        (geometry.icon.top + geometry.icon.bottom) / 2
        - (geometry.about.top + geometry.about.bottom) / 2,
      )).toBeLessThanOrEqual(0.5);
      if (badgeExpected) {
        expect(geometry.badge).not.toBeNull();
        expect(geometry.badge.top).toBeGreaterThanOrEqual(geometry.product.top);
        expect(geometry.badge.bottom).toBeLessThanOrEqual(geometry.product.bottom);
        expect(geometry.badge.right).toBeLessThanOrEqual(geometry.product.right);
        expect(geometry.badge.left).toBeGreaterThan(geometry.icon.right);
      } else {
        expect(geometry.badge).toBeNull();
      }
      return geometry;
    };

    const noUpdateGeometry = await captureSidebarProduct({ badgeExpected: false });
    if (toolbarCleanupOutput) {
      const visibleToast = launched.page.locator(".toast.show");
      await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      if (await visibleToast.isVisible().catch(() => false)) {
        await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
        await expect(visibleToast).toBeHidden();
      }
      await launched.page.screenshot({
        path: path.join(toolbarCleanupOutput, "01-sidebar-header.png"),
        animations: "disabled",
      });
    }
    const updateStatus = {
      currentVersion: "0.8.6",
      latestVersion: "9.9.9",
      minimumMacOS: "12.0",
      architecture: "arm64",
      publishedAt: "2026-07-23T00:00:00.000Z",
    };
    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "available" },
    );
    await expect(launched.page.getByRole("button", {
      name: "发现 PageRoot 9.9.9，下载更新",
    })).toBeVisible();
    const availableGeometry = await captureSidebarProduct();

    await sidebar.getByRole("button", { name: "源页", exact: true }).click();
    await expect(launched.page.getByRole("dialog", { name: "源页" }))
      .toBeVisible();
    await expect(launched.page.getByRole("dialog", { name: "源页" })
      .getByRole("heading", { name: "AI Agent" })).toHaveCount(0);
    await expect(launched.page.getByRole("dialog", { name: "源页" })
      .getByRole("heading", { name: "软件更新" })).toHaveCount(0);
    const aboutDialog = launched.page.getByRole("dialog", { name: "源页" });
    if (toolbarCleanupOutput) {
      await launched.page.screenshot({
        path: path.join(toolbarCleanupOutput, "02-about.png"),
        animations: "disabled",
      });
    }
    await aboutDialog.getByRole("button", { name: "关闭关于源页" }).press("Escape");
    await expect(launched.page.locator("dialog.about-dialog[open]"))
      .toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "源页", exact: true })).toBeFocused();

    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    const settings = launched.page.locator(".workbench-settings-page");
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("heading", { name: "常规" })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "AI 服务", exact: true }))
      .toBeVisible();
    await expect(settings.getByRole("heading", { name: "常规" })).toBeFocused();
    await launched.page.getByRole("button", { name: "软件更新", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "软件更新" })).toBeFocused();
    await expect(settings.getByRole("button", { name: "下载更新" })).toBeVisible();
    if (toolbarCleanupOutput) {
      await launched.page.screenshot({
        path: path.join(toolbarCleanupOutput, "03-settings.png"),
        animations: "disabled",
      });
    }
    await settings.getByRole("heading", { name: "软件更新" }).press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "设置", exact: true })).toBeFocused();

    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "downloaded" },
    );
    await expect(launched.page.getByRole("button", {
      name: "PageRoot 9.9.9 已下载，重启更新",
    })).toBeVisible();
    await expect(launched.page.getByRole("dialog", {
      name: "现在重启并安装更新？",
    })).toHaveCount(0);
    await expect(launched.page.locator("dialog.restart-update-dialog[open]"))
      .toHaveCount(0);
    const downloadedGeometry = await captureSidebarProduct();
    for (const geometry of [availableGeometry, downloadedGeometry]) {
      expect(geometry.icon).toEqual(noUpdateGeometry.icon);
      expect(geometry.about).toEqual(noUpdateGeometry.about);
      expect(geometry.product).toEqual(noUpdateGeometry.product);
      expect(geometry.sidebar).toEqual(noUpdateGeometry.sidebar);
    }
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron shell keeps the global rail fixed while the context inspector swaps", async () => {
  test.setTimeout(90_000);
  const fixture = createSourceFixture("workbench-shell-geometry.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const stage = launched.page.locator(".review-scroll-stage");
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect.poll(() => sidebar.evaluate((element) => {
      const workbench = element.closest(".workbench");
      const targetWidth = workbench
        ? Number.parseFloat(getComputedStyle(workbench).gridTemplateColumns.split(" ")[0])
        : 0;
      return Math.abs(element.getBoundingClientRect().width - targetWidth);
    })).toBeLessThanOrEqual(0.5);
    await launched.page.waitForTimeout(220);

    const expandedToggle = launched.page.getByRole("button", { name: "收起左侧边栏" });
    const expandedToggleBox = await expandedToggle.boundingBox();
    const moreButton = launched.page.getByRole("button", { name: "更多", exact: true });
    await moreButton.click();
    const moreMenu = launched.page.getByRole("menu", { name: "更多操作" });
    await expect(moreMenu).toBeVisible();
    expect(await moreMenu.evaluate((element) => element.parentElement === document.body)).toBe(true);
    await expect(moreMenu.getByRole("menuitem", { name: "在 Finder 中显示" })).toBeVisible();
    await expect(moreMenu.getByRole("menuitem", { name: "在默认浏览器中打开" })).toBeVisible();
    await expect(moreMenu.getByRole("menuitem", { name: "导出当前 HTML…" })).toBeVisible();
    await expect(moreMenu.getByRole("menuitem", { name: "在 Finder 中显示" })).toBeFocused();
    await launched.page.keyboard.press("Tab");
    await expect(moreMenu).toHaveCount(0);
    await expect(moreButton).toBeFocused();

    await moreButton.click();
    await expect(moreMenu).toBeVisible();
    await expect(moreMenu.getByRole("menuitem", { name: "在 Finder 中显示" })).toBeFocused();
    await launched.page.keyboard.press("ArrowDown");
    await expect(moreMenu.getByRole("menuitem", { name: "在默认浏览器中打开" })).toBeFocused();
    await launched.page.keyboard.press("Escape");
    await expect(moreMenu).toHaveCount(0);
    await expect(moreButton).toBeFocused();

    await expandedToggle.hover();
    await expect(launched.page.getByRole("tooltip")).toHaveText("收起左侧边栏");
    const tooltip = launched.page.getByRole("tooltip");
    const tooltipBox = await tooltip.boundingBox();
    const tabbarBox = await launched.page.locator(".workbench-tabbar").boundingBox();
    expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
    expect(tooltipBox).not.toBeNull();
    expect(tabbarBox).not.toBeNull();
    expect(tooltipBox?.y || 0).toBeGreaterThanOrEqual((tabbarBox?.bottom || 0) - 1);

    await expandedToggle.click();
    const collapsedToggle = launched.page.getByRole("button", { name: "展开左侧边栏" });
    await expect(collapsedToggle).toBeVisible();
    const collapsedToggleBox = await collapsedToggle.boundingBox();
    expect(expandedToggleBox).not.toBeNull();
    expect(collapsedToggleBox).not.toBeNull();
    await expect.poll(async () => {
      const box = await collapsedToggle.boundingBox();
      return box ? Math.abs(box.x - (expandedToggleBox?.x || 0)) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(0.5);
    await expect.poll(async () => {
      const box = await collapsedToggle.boundingBox();
      return box ? Math.abs(box.y - (expandedToggleBox?.y || 0)) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(0.5);
    await collapsedToggle.click();
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect.poll(() => sidebar.evaluate((element) => {
      const workbench = element.closest(".workbench");
      const targetWidth = workbench
        ? Number.parseFloat(getComputedStyle(workbench).gridTemplateColumns.split(" ")[0])
        : 0;
      return Math.abs(element.getBoundingClientRect().width - targetWidth);
    })).toBeLessThanOrEqual(0.5);
    await launched.page.waitForTimeout(220);

    const readGeometry = () => launched.page.evaluate(() => {
      const readRect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      };
      const workbench = document.querySelector("main.workbench");
      const styles = workbench ? getComputedStyle(workbench) : null;
      const reviewStage = document.querySelector(".review-scroll-stage");
      const comments = document.querySelector(".review-scroll-stage > .comments-panel.comment-rail");
      const ai = document.querySelector(".review-scroll-stage > .ai-conversation-aside");
      return {
        workbench: readRect("main.workbench"),
        sidebar: readRect(".workbench-global-sidebar"),
        tabbar: readRect(".workbench-tabbar"),
        header: readRect(".workbench-header"),
        stage: readRect(".review-scroll-stage"),
        canvas: readRect(".review-scroll-stage > .canvas-column"),
        comments: readRect(".review-scroll-stage > .comments-panel.comment-rail"),
        ai: readRect(".review-scroll-stage > .ai-conversation-aside"),
        inspector: reviewStage?.dataset.inspector || null,
        commentsPosition: comments ? getComputedStyle(comments).position : null,
        aiPosition: ai ? getComputedStyle(ai).position : null,
        viewportWidth: window.innerWidth,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
        sidebarWidth: styles
          ? Number.parseFloat(styles.gridTemplateColumns.split(" ")[0])
          : 0,
        sidebarSavedWidth: Number.parseFloat(
          styles?.getPropertyValue("--workbench-sidebar-width-saved") || "0",
        ),
        inspectorWidth: Number.parseFloat(
          styles?.getPropertyValue("--workbench-inspector-width") || "0",
        ),
      };
    });
    const assertShellGeometry = (geometry) => {
      for (const key of ["workbench", "sidebar", "tabbar", "header", "stage", "canvas"]) {
        expect(geometry[key], `missing ${key} geometry`).not.toBeNull();
      }
      expect(Math.abs(geometry.sidebar.width - geometry.sidebarWidth)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.tabbar.left - geometry.sidebar.right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.header.left - geometry.sidebar.right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.stage.left - geometry.sidebar.right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.stage.right - geometry.workbench.right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.sidebar.right - geometry.stage.left)).toBeLessThanOrEqual(0.5);
    };
    const assertLeftRailStable = (geometry, reference) => {
      for (const key of ["sidebar", "tabbar", "header", "stage"]) {
        expect(Math.abs(geometry[key].left - reference[key].left), `${key} moved`).toBeLessThanOrEqual(0.5);
      }
      expect(Math.abs(geometry.sidebar.width - reference.sidebar.width)).toBeLessThanOrEqual(0.5);
    };

    await expect(stage).toHaveAttribute("data-inspector", "comments");
    await expect(launched.page.locator(".review-scroll-stage > .comments-panel.comment-rail"))
      .toBeVisible();
    const editGeometry = await readGeometry();
    assertShellGeometry(editGeometry);
    expect(editGeometry.comments).not.toBeNull();
    expect(Math.abs(editGeometry.comments.width - editGeometry.inspectorWidth))
      .toBeLessThanOrEqual(0.5);
    if (process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP) {
      const visibleToast = launched.page.locator(".toast.show");
      await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      if (await visibleToast.isVisible().catch(() => false)) {
        await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
        await expect(visibleToast).toBeHidden();
      }
      const captureDirectory = path.resolve(
        process.cwd(),
        process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP_DIR
          || path.join("output", "design-qa", "toolbar-cleanup"),
      );
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "04-comments-top.png"),
        animations: "disabled",
      });
    }

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();
    await expect(stage).toHaveAttribute("data-inspector", "none");
    await expect(launched.page.locator(".review-scroll-stage > .comments-panel.comment-rail"))
      .toHaveCount(0);
    const previewGeometry = await readGeometry();
    assertShellGeometry(previewGeometry);
    assertLeftRailStable(previewGeometry, editGeometry);
    const previewSurface = launched.page.getByTestId("html-interaction-preview");
    const previewReloadRevision = Number(await previewSurface.getAttribute("data-reload-revision"));
    const refreshButton = launched.page.getByRole("button", { name: "刷新预览" });
    await expect(refreshButton).toBeEnabled();
    await refreshButton.click();
    await expect(previewSurface).toHaveAttribute(
      "data-reload-revision",
      String(previewReloadRevision + 1),
    );
    expect(Math.abs(
      previewGeometry.canvas.width - editGeometry.canvas.width - editGeometry.inspectorWidth,
    )).toBeLessThanOrEqual(2);

    await launched.page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(stage).toHaveAttribute("data-inspector", "comments");
    const reopenedEditGeometry = await readGeometry();
    assertShellGeometry(reopenedEditGeometry);
    assertLeftRailStable(reopenedEditGeometry, editGeometry);

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeVisible();
    await expect(stage).toHaveAttribute("data-inspector", "ai");
    const aiGeometry = await readGeometry();
    assertShellGeometry(aiGeometry);
    assertLeftRailStable(aiGeometry, editGeometry);
    expect(aiGeometry.ai).not.toBeNull();
    expect(Math.abs(aiGeometry.ai.width - editGeometry.comments.width))
      .toBeLessThanOrEqual(0.5);

    const originalWindowBounds = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ));
      return window?.getBounds() || null;
    });
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ));
      window?.setBounds(bounds, false);
    }, { ...(originalWindowBounds || {}), width: 1024, height: 768 });
    await expect.poll(() => launched.page.evaluate(() => window.innerWidth))
      .toBeLessThanOrEqual(1120);
    await expect.poll(() => sidebar.evaluate((element) => {
      const workbench = element.closest(".workbench");
      const targetWidth = workbench
        ? Number.parseFloat(getComputedStyle(workbench).gridTemplateColumns.split(" ")[0])
        : 0;
      return Math.abs(element.getBoundingClientRect().width - targetWidth);
    })).toBeLessThanOrEqual(0.5);
    await launched.page.waitForTimeout(220);
    const narrowAiGeometry = await readGeometry();
    assertShellGeometry(narrowAiGeometry);
    expect(narrowAiGeometry.sidebarWidth).toBe(240);
    expect(narrowAiGeometry.aiPosition).toBe("absolute");
    expect(narrowAiGeometry.documentWidth - narrowAiGeometry.viewportWidth)
      .toBeLessThanOrEqual(1);

    const toolbarGeometry = await launched.page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const controls = [...document.querySelectorAll(
        ".workbench-header .header-actions button",
      )].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(element).display !== "none";
      }).map((element) => {
        const box = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });
      const intersections = [];
      for (let index = 0; index < controls.length; index += 1) {
        for (let next = index + 1; next < controls.length; next += 1) {
          const first = controls[index];
          const second = controls[next];
          if (first.left < second.right && second.left < first.right
            && first.top < second.bottom && second.top < first.bottom) {
            intersections.push([first.label, second.label]);
          }
        }
      }
      return {
        groups: [
          rect(".workbench-toolbar-primary"),
          rect(".workbench-toolbar-center"),
          rect(".workbench-toolbar-actions"),
        ],
        controls,
        intersections,
        innerWidth: window.innerWidth,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      };
    });
    expect(toolbarGeometry.intersections).toEqual([]);
    expect(toolbarGeometry.documentWidth - toolbarGeometry.innerWidth).toBeLessThanOrEqual(1);
    expect(toolbarGeometry.groups.every((group) => group)).toBe(true);
    for (let index = 0; index < toolbarGeometry.groups.length - 1; index += 1) {
      expect(toolbarGeometry.groups[index].right)
        .toBeLessThanOrEqual(toolbarGeometry.groups[index + 1].left + 0.5);
    }

    const shellWidthBeforeResize = await launched.page.evaluate(() => ({
      width: document.querySelector("main.workbench")?.getBoundingClientRect().width || 0,
      innerWidth: window.innerWidth,
    }));
    const sidebarResizer = launched.page.getByTestId("workbench-resizer-sidebar");
    await expect(sidebarResizer).toBeVisible();
    const sidebarResizerBox = await sidebarResizer.boundingBox();
    expect(sidebarResizerBox).not.toBeNull();
    await launched.page.mouse.move(
      (sidebarResizerBox?.x || 0) + (sidebarResizerBox?.width || 0) / 2,
      (sidebarResizerBox?.y || 0) + 400,
    );
    const sidebarWidthBeforeResize = narrowAiGeometry.sidebarSavedWidth;
    await launched.page.mouse.down();
    await launched.page.mouse.move(
      (sidebarResizerBox?.x || 0) + (sidebarResizerBox?.width || 0) / 2 + 32,
      (sidebarResizerBox?.y || 0) + 400,
      { steps: 4 },
    );
    await launched.page.mouse.up();
    await expect.poll(() => launched.page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.querySelector("main.workbench")).getPropertyValue(
        "--workbench-sidebar-width-saved",
      ),
    ))).toBeGreaterThan(sidebarWidthBeforeResize + 24);
    const shellWidthAfterResize = await launched.page.evaluate(() => ({
      width: document.querySelector("main.workbench")?.getBoundingClientRect().width || 0,
      innerWidth: window.innerWidth,
    }));
    expect(Math.abs(shellWidthAfterResize.width - shellWidthBeforeResize.width)).toBeLessThanOrEqual(0.5);
    expect(shellWidthAfterResize.innerWidth).toBe(shellWidthBeforeResize.innerWidth);
    await sidebarResizer.dblclick();
    await expect.poll(() => launched.page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.querySelector("main.workbench")).getPropertyValue(
        "--workbench-sidebar-width-saved",
      ),
    ))).toBe(264);

    const inspectorResizer = launched.page.getByTestId("workbench-resizer-inspector");
    await expect(inspectorResizer).toBeVisible();
    const inspectorResizerBox = await inspectorResizer.boundingBox();
    expect(inspectorResizerBox).not.toBeNull();
    const inspectorWidthBeforeResize = narrowAiGeometry.inspectorWidth;
    await launched.page.mouse.move(
      (inspectorResizerBox?.x || 0) + (inspectorResizerBox?.width || 0) / 2,
      (inspectorResizerBox?.y || 0) + 400,
    );
    await launched.page.mouse.down();
    await launched.page.mouse.move(
      (inspectorResizerBox?.x || 0) + (inspectorResizerBox?.width || 0) / 2 - 32,
      (inspectorResizerBox?.y || 0) + 400,
      { steps: 4 },
    );
    await launched.page.mouse.up();
    await expect.poll(() => launched.page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.querySelector("main.workbench")).getPropertyValue(
        "--workbench-inspector-width",
      ),
    ))).toBeGreaterThan(inspectorWidthBeforeResize + 24);
    await inspectorResizer.dblclick();
    await expect.poll(() => launched.page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.querySelector("main.workbench")).getPropertyValue(
        "--workbench-inspector-width",
      ),
    ))).toBe(376);

    const aiToggle = launched.page.getByRole("button", { name: "AI 助手", exact: true });
    await expect(aiToggle).toHaveAttribute("aria-expanded", "true");
    await launched.page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(aiToggle).toHaveAttribute("aria-expanded", "false");
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-inspector", "comments");
    await expect(launched.page.locator(".review-scroll-stage > .comments-panel.comment-rail"))
      .toBeVisible();
    const narrowCommentsGeometry = await readGeometry();
    assertShellGeometry(narrowCommentsGeometry);
    expect(narrowCommentsGeometry.commentsPosition).toBe("absolute");
    expect(Math.abs(
      narrowCommentsGeometry.comments.width - narrowCommentsGeometry.inspectorWidth,
    )).toBeLessThanOrEqual(0.5);
    expect(narrowCommentsGeometry.documentWidth - narrowCommentsGeometry.viewportWidth)
      .toBeLessThanOrEqual(1);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});


test("workspace failure keeps the current page visible with export and relaunch paths", async () => {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "workspace-recovery.html");
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    await loadedDiskFrame(launched.page, sourcePath, "list-item");
    const mainRendererUrl = launched.page.url();
    await launched.electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) {
        throw new Error("PageRoot main BrowserWindow is unavailable for workspace recovery.");
      }
      mainWindow.webContents.send(
        "html-app:workspace-unavailable",
        {
          title: "本地项目资料暂时不可用",
          message: "当前页面内容仍保留。可先导出当前 HTML，再重新打开源页。",
        },
      );
    }, mainRendererUrl);

    const recovery = launched.page.getByRole("alert")
      .filter({ hasText: "本地项目资料暂时不可用" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "导出当前 HTML" }))
      .toBeVisible();
    await expect(recovery.getByRole("button", { name: "重新定位文件" }))
      .toBeVisible();
    await expect(recovery.getByRole("button", { name: "重新打开" }))
      .toBeVisible();
    const globalCommentButton = launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true });
    await expect(globalCommentButton).toBeVisible();
    await expect(globalCommentButton).toBeDisabled();
    await expect(launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first()
      .locator('iframe[title*="本轮已锁定"]')).toBeVisible();
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});
