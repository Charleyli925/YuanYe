import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  documentToken,
  exportCurrentHtml,
  fixtureBuffer,
  identifiedHtmlBuffer,
  installInputRecorder,
  installLongTaskRecorder,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  recordedInputEvents,
  recordedLongTasks,
  selectionSnapshot,
  setTextSelection,
  waitForFramePaint,
} from "./pageroot-driver.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a renderer without Desktop preload fails explicitly", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const failure = page.locator('.canvas-loading[role="alert"]');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("能力声明缺失或无效");
  await expect(page.getByTestId("html-canvas-editor")).toHaveCount(0);
  await expect(page.locator('iframe[title="HTML 交互预览"]')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.htmlAIProjects))).toBe(false);
});

test("the edit iframe is same-origin but never executes author scripts or refresh", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const { iframe, frame } = await loadFixture(page, "complex-layout.html");
  await expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");
  expect((await iframe.getAttribute("sandbox")).split(/\s+/)).not.toContain("allow-scripts");

  const boundary = await frame.evaluate(() => ({
    authorScriptRan: document.documentElement.hasAttribute("data-author-script-ran"),
    nestedScriptRan: document.documentElement.hasAttribute("data-nested-script-ran"),
    disabledScriptCount: document.querySelectorAll(
      'script[type="application/x-html-canvas-disabled"][data-html-canvas-disabled-script]',
    ).length,
    activeRefreshCount: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
    disabledRefreshCount: document.querySelectorAll('meta[http-equiv="x-html-canvas-disabled-refresh" i]').length,
  }));
  expect(boundary).toMatchObject({
    authorScriptRan: false,
    nestedScriptRan: false,
    disabledScriptCount: 1,
    activeRefreshCount: 0,
    disabledRefreshCount: 1,
  });
});

test("clicking a filled module's padding selects that module", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const copy = frame.locator(caseSelector("module-padding-copy"));
  const filledModule = frame.locator(caseSelector("filled-module"));
  const emptyModule = frame.locator(caseSelector("empty-module"));

  await copy.click();
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(copy).toHaveAttribute("data-html-canvas-selected", "part");

  await filledModule.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(filledModule).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(copy).not.toHaveAttribute("data-html-canvas-selected", /.+/u);

  await emptyModule.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole("toolbar")).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
});

test("selected chrome reuses hover geometry outside authored clipping", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html");
  const target = frame.locator(caseSelector("selected-overlay-target"));
  const inlineChild = target.locator("strong");
  const hoverOutline = editor.locator(
    '[data-testid="canvas-capability-outline"][data-tone="hover"]',
  );
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );

  await inlineChild.hover();
  await expect(hoverOutline).toBeVisible();
  const hoverRect = await hoverOutline.boundingBox();
  expect(hoverRect).not.toBeNull();
  const hoverPresentation = await hoverOutline.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderTopWidth,
    };
  });

  await inlineChild.click();
  await expect(selectedOutline).toBeVisible();
  await expect(hoverOutline).toHaveCount(0);
  await expect(target).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(target.locator("strong[data-html-canvas-selected], em[data-html-canvas-selected]"))
    .toHaveCount(0);
  expect(await target.locator("strong").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      offset: style.outlineOffset,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  })).toEqual({
    color: "rgb(20, 150, 90)",
    offset: "3px",
    style: "solid",
    width: "2px",
  });

  const selectedRect = await selectedOutline.boundingBox();
  expect(selectedRect).toEqual(hoverRect);
  expect(selectedRect.height).toBeGreaterThan(92);
  const selectedPresentation = await selectedOutline.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderTopWidth,
    };
  });
  expect(selectedPresentation.borderRadius).toBe(hoverPresentation.borderRadius);
  expect(selectedPresentation.borderWidth).toBe(hoverPresentation.borderWidth);
  expect(selectedPresentation.borderColor).not.toBe(hoverPresentation.borderColor);

  const coexistParent = frame.locator(caseSelector("coexist-parent"));
  await coexistParent.click({ position: { x: 4, y: 4 } });
  await expect(selectedOutline).toBeVisible();
  const coexistSelectedRect = await selectedOutline.boundingBox();
  await frame.locator(caseSelector("coexist-child")).hover();
  await expect(hoverOutline).toBeVisible();
  await expect(selectedOutline).toBeVisible();
  expect(await hoverOutline.boundingBox()).not.toEqual(coexistSelectedRect);
});

test("caption selection promotes rich children to one canonical visual host", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html", {
    identifiedWorkingCopy: true,
  });
  const first = frame.locator(caseSelector("rich-child-a"));
  const second = frame.locator(caseSelector("rich-child-b"));
  const canonicalTarget = frame.locator(caseSelector("selected-overlay-target"));
  const hint = editor.getByTestId("canvas-capability-hint");

  await first.hover();
  await expect(hint).toBeVisible();
  const canonicalTargetId = await canonicalTarget.getAttribute("data-pageroot-id");
  const activeGeneration = await editor
    .locator('iframe[data-runtime-slot-role="active"]')
    .getAttribute("data-frame-generation");
  await expect(hint).toHaveAttribute("data-capability-target-id", canonicalTargetId || "");
  await expect(hint).toHaveAttribute("data-capability-target-key", `element:${canonicalTargetId}`);
  await expect(hint).toHaveAttribute("data-capability-active-frame-generation", activeGeneration || "");
  const targetDomGeneration = await hint.getAttribute("data-capability-target-dom-generation");
  await expect(hint).toHaveAttribute(
    "data-capability-current-dom-generation",
    targetDomGeneration || "",
  );
  await second.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + (rect.width / 2),
      clientY: rect.top + (rect.height / 2),
      pointerId: 1,
      pointerType: "mouse",
    }));
  });
  await expect(hint).toBeVisible();
  await hint.click();

  await expect(frame.locator(caseSelector("selected-overlay-target")))
    .toHaveAttribute("data-html-canvas-selected", "module");
  await expect(first).not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect(second).not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect(editor.getByRole("toolbar")).toHaveAttribute(
    "aria-label",
    /文章模块/u,
  );
  await expect(editor.getByRole("toolbar")).not.toHaveAttribute(
    "aria-label",
    /富文本/u,
  );

  await editor.getByRole("toolbar").getByRole("button", { name: /留评论/u }).click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await expect(composer).toContainText("文章模块");
  await expect(composer).not.toContainText("富文本 B");
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("完整文字宿主应作为同一个评论目标。");
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  const savedCard = page.locator(".comment-card").filter({
    hasText: "完整文字宿主应作为同一个评论目标。",
  });
  await expect(savedCard).toHaveAttribute("data-resolution", "exact");
  await expect(savedCard).toContainText("文章模块");
  await expect(savedCard).not.toContainText("富文本 B");
});

test("double click keeps the canonical rich-text host while caret stays in the exact child", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html", {
    identifiedWorkingCopy: true,
  });
  const target = frame.locator(caseSelector("selected-overlay-target"));
  const richChild = frame.locator(caseSelector("rich-child-a"));
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );

  await richChild.dblclick();
  await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
  await expect(richChild).not.toHaveAttribute("contenteditable", "true");
  await expect(target).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(selectedOutline).toBeVisible();
  const selectedRect = await selectedOutline.boundingBox();
  expect(selectedRect?.height).toBeGreaterThan(92);

  const caret = await frame.evaluate(() => {
    const current = document.getSelection();
    return {
      collapsed: Boolean(current?.isCollapsed),
      insideRichChild: Boolean(
        current?.anchorNode
        && document.querySelector('[data-native-case="rich-child-a"]')?.contains(current.anchorNode),
      ),
    };
  });
  expect(caret).toEqual({ collapsed: true, insideRichChild: true });
});

test("a block-level strong remains its own canonical target", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html");
  const blockStrong = frame.locator(caseSelector("block-strong"));
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );

  await blockStrong.click();
  await expect(blockStrong).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(frame.locator(caseSelector("selected-overlay-target")))
    .not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect(editor.getByRole("toolbar")).toHaveAttribute(
    "aria-label",
    /独立强调文字/u,
  );
  await expect(selectedOutline).toBeVisible();
  const selectedRect = await selectedOutline.boundingBox();
  const elementRect = await blockStrong.boundingBox();
  expect(selectedRect).toEqual(elementRect);
});

test("a range inside a rich child keeps the complete host selected", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html");
  const target = frame.locator(caseSelector("selected-overlay-target"));
  const richChild = frame.locator(caseSelector("rich-child-a"));
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );

  await richChild.click();
  await richChild.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await target.dispatchEvent("mouseup");

  await expect(target).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(richChild).not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect(selectedOutline).toBeVisible();
  const selectedRect = await selectedOutline.boundingBox();
  expect(selectedRect?.height).toBeGreaterThan(92);
});

test("selected chrome clips to the iframe viewport while retaining selection", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "selected-overlay-clipping.html");
  const iframe = editor.locator('iframe[data-runtime-slot-role="active"]');
  const target = frame.locator(caseSelector("viewport-top-target"));
  const hoverOutline = editor.locator(
    '[data-testid="canvas-capability-outline"][data-tone="hover"]',
  );
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );

  await target.hover({ position: { x: 24, y: 72 } });
  await expect(hoverOutline).toBeVisible();
  const hoverRect = await hoverOutline.boundingBox();
  expect(hoverRect).not.toBeNull();
  await target.click({ position: { x: 24, y: 72 } });
  await expect(target).toHaveAttribute("data-html-canvas-selected", "module");
  const iframeRect = await iframe.boundingBox();
  const targetRect = await target.boundingBox();
  expect(iframeRect).not.toBeNull();
  expect(targetRect).not.toBeNull();

  await expect(selectedOutline).toBeVisible();
  const outlineRect = await selectedOutline.boundingBox();
  expect(outlineRect).toEqual(hoverRect);
  expect(outlineRect.y).toBeGreaterThanOrEqual(iframeRect.y);
  expect(outlineRect.y + outlineRect.height).toBeLessThanOrEqual(
    iframeRect.y + iframeRect.height,
  );
  expect(outlineRect.height).toBeLessThan(targetRect.height);
  await expect(target).toHaveAttribute("data-html-canvas-selected", "module");
});

test("the contextual edit toolbar stays on one quiet-glass row and defers secondary controls", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  await frame.locator(caseSelector("module-padding-copy")).click();

  const toolbar = editor.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "加粗", exact: true })).toHaveText("B加粗");
  await expect(toolbar.getByRole("button", { name: "斜体", exact: true })).toHaveText("I斜体");
  await expect(toolbar.getByRole("button", { name: "下划线", exact: true })).toHaveText("U下划线");

  const presentation = await toolbar.evaluate((element) => {
    const row = element.firstElementChild;
    const commentButton = element.querySelector('button[aria-label*="留评论"]');
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      flexWrap: row ? getComputedStyle(row).flexWrap : null,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      commentShadow: commentButton ? getComputedStyle(commentButton).boxShadow : null,
    };
  });
  expect(presentation.height).toBeGreaterThanOrEqual(42);
  expect(presentation.height).toBeLessThanOrEqual(44);
  expect(presentation.flexWrap).toBe("nowrap");
  expect(presentation.backdropFilter).toContain("blur(17px)");
  expect(presentation.commentShadow).toBe("none");

  await expect(toolbar.getByRole("button", { name: "上移", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "下移", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "复制元素", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toBeVisible();
  await expect(toolbar.getByLabel("字号")).toBeHidden();
  await expect(toolbar.getByLabel("文字颜色")).toBeHidden();
  await expect(toolbar.getByLabel("元素填充色")).toBeHidden();

  await toolbar.getByText("样式与间距", { exact: true }).click();
  await expect(toolbar.getByLabel("字号")).toBeVisible();
  await expect(toolbar.getByLabel("文字颜色")).toBeVisible();
  await expect(toolbar.getByLabel("元素填充色")).toBeVisible();
  await expect(toolbar.getByLabel("内边距")).toBeVisible();
  await expect(toolbar.getByLabel("外间距")).toBeVisible();
  await expect(toolbar.getByLabel("行距")).toBeVisible();
});

test("source structure toolbar duplicates with fresh IDs and deletes only the selected source element", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html", {
    identifiedWorkingCopy: true,
  });
  const copies = frame.locator(caseSelector("module-padding-copy"));
  await copies.first().click();
  await editor.getByRole("button", { name: "复制元素", exact: true }).click();

  await expect(copies).toHaveCount(2);
  const duplicatedIds = await copies.evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id"))
  ));
  expect(duplicatedIds.every(Boolean)).toBe(true);
  expect(new Set(duplicatedIds).size).toBe(2);

  await copies.nth(1).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByRole("button", { name: "删除元素", exact: true }).click();
  await expect(copies).toHaveCount(2);
  await editor.getByRole("button", { name: "复制元素", exact: true }).click();
  await expect(copies).toHaveCount(3);
  await copies.nth(1).click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "删除元素", exact: true }).click();
  await expect(copies).toHaveCount(2);

  const exported = (await exportCurrentHtml(page)).toString("utf8");
  expect(exported).toContain(duplicatedIds[0]);
  expect(exported).not.toContain(duplicatedIds[1]);
});

test("style copy equivalence accepts only exact source or an empty live residue", async ({ page }) => {
  const source = Buffer.from(`<!doctype html>
<html><head><title>Style copy equivalence</title></head><body>
  <h1 data-native-case="style-missing">Source has no style</h1>
  <h1 data-native-case="style-empty" style="">Source has an empty style</h1>
  <h1 data-native-case="style-authored" style="color: red">Source has authored style</h1>
</body></html>`, "utf8");
  const { editor, frame } = await loadFixture(page, "style-copy-equivalence.html", {
    buffer: source,
    identifiedWorkingCopy: true,
  });
  const duplicateButton = editor.getByRole("button", {
    name: "复制元素",
    exact: true,
  });
  const assertAvailability = async (caseId, mutation, expected) => {
    await page.keyboard.press("Escape");
    const target = frame.locator(caseSelector(caseId));
    if (mutation) await target.evaluate(mutation);
    await target.click();
    if (expected === "available") {
      await expect(duplicateButton).toBeVisible();
    } else {
      await expect(duplicateButton).toHaveCount(0);
      await expect(editor).toHaveAttribute(
        "data-element-copy-reason",
        "runtime-subtree-diverged",
      );
    }
  };

  await assertAvailability(
    "style-missing",
    (element) => element.setAttribute("style", ""),
    "available",
  );
  await assertAvailability(
    "style-missing",
    (element) => element.setAttribute("style", "color: blue"),
    "unsupported",
  );
  await assertAvailability("style-empty", null, "available");
  await assertAvailability(
    "style-empty",
    (element) => element.removeAttribute("style"),
    "unsupported",
  );
  await assertAvailability("style-authored", null, "available");
  await assertAvailability(
    "style-authored",
    (element) => element.setAttribute("style", ""),
    "unsupported",
  );
  await assertAvailability(
    "style-authored",
    (element) => element.setAttribute("style", "color: blue"),
    "unsupported",
  );
});

test("hovering a filled module's padding advertises the same module click selects", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const filledModule = frame.locator(caseSelector("filled-module"));

  await filledModule.hover({ position: { x: 24, y: 24 } });
  const hint = editor.getByTestId("canvas-capability-hint");
  await expect(hint).toBeVisible({ timeout: 1500 });
  await expect(hint).toHaveText("单击选择并评论");

  const box = await hint.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
  await expect(filledModule).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(editor.getByRole("toolbar")).toBeVisible();
});

test("static reorder keeps the existing preview document", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const filledModule = frame.locator(caseSelector("filled-module"));
  await filledModule.click({ position: { x: 24, y: 72 } });
  const beforeDocument = await documentToken(page);

  await editor.getByRole("button", { name: "上移", exact: true }).click();

  await expect.poll(() => documentToken(page)).toBe(beforeDocument);
  await expect.poll(() => frame.locator("body > section").evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-native-case"))
  ))).toEqual(["filled-module", "empty-module"]);
  await expect(filledModule).toHaveAttribute("data-html-canvas-selected", "module");
});

test("text-edit hover caption hugs its copy instead of a fixed ribbon", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));

  await target.hover({ position: { x: 20, y: 20 } });
  const hint = editor.getByTestId("canvas-capability-hint");
  await expect(hint).toBeVisible({ timeout: 1500 });
  await expect(hint).toHaveText("双击文字直接编辑");

  const metrics = await hint.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      inlineWidth: element.style.width,
      width: rect.width,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(metrics.inlineWidth).toBe("");
  expect(metrics.width).toBeLessThan(160);
  expect(Math.abs(metrics.width - metrics.scrollWidth)).toBeLessThanOrEqual(2);
});

test("text-edit hover caption regains its intrinsic width after the canvas widens", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));

  await editor.evaluate((element) => {
    Object.assign(element.style, {
      width: "64px",
      minWidth: "0px",
    });
  });
  await target.evaluate((element) => {
    Object.assign(element.style, {
      position: "fixed",
      top: "120px",
      left: "8px",
      width: "48px",
    });
  });
  await target.hover({ position: { x: 12, y: 12 } });
  const hint = editor.getByTestId("canvas-capability-hint");
  await expect(hint).toBeVisible({ timeout: 1500 });
  await expect.poll(() => hint.evaluate((element) => (
    element.scrollWidth - element.clientWidth
  ))).toBeGreaterThan(1);

  await editor.evaluate((element) => {
    element.style.width = "600px";
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));

  await expect(hint).toBeVisible();
  await expect.poll(() => hint.evaluate((element) => (
    element.scrollWidth - element.clientWidth
  ))).toBeLessThanOrEqual(1);
});

test("clicking blank header and comment-rail surfaces commits editing and clears selection", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));
  const toolbar = editor.getByRole("toolbar");

  await activateNativeEdit(frame, "paragraph-entities");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(toolbar).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await page.locator(".comments-panel.comment-rail").click({
    position: { x: 4, y: 4 },
  });

  await expect(toolbar).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
  await expect(target).not.toHaveAttribute("contenteditable", "true");

  await activateNativeEdit(frame, "paragraph-entities");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(toolbar).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await page.locator(".workbench-header").click({
    position: { x: 4, y: 4 },
  });

  await expect(toolbar).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
  await expect(target).not.toHaveAttribute("contenteditable", "true");
});

test("continuous source typing is immediately visible without iframe replacement or scroll jumps", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  const beforeDocument = await documentToken(frame);
  await activateNativeEdit(frame, "scroll-copy");
  const textLength = (await frame.locator(caseSelector("scroll-copy")).textContent()).length;
  await setTextSelection(frame, "scroll-copy", textLength - 2);
  await frame.locator(caseSelector("scroll-copy")).evaluate((target) => {
    target.parentElement.scrollTop = target.parentElement.scrollHeight;
  });
  const beforeScrollTop = await frame.locator(caseSelector("scroll-copy")).evaluate(
    (target) => target.parentElement.scrollTop,
  );
  const chunks = ["原生光标", "连续输入", "不应丢字或乱序。"];
  let inserted = "";
  for (const chunk of chunks) {
    await page.keyboard.insertText(chunk);
    inserted += chunk;
    expect(await documentToken(frame)).toBe(beforeDocument);
    expect(await frame.locator(caseSelector("scroll-copy")).textContent()).toContain(inserted);
  }

  expect(await documentToken(frame)).toBe(beforeDocument);
  expect(await frame.locator(caseSelector("scroll-copy")).textContent()).toContain(inserted);
  const afterScrollTop = await frame.locator(caseSelector("scroll-copy")).evaluate(
    (target) => target.parentElement.scrollTop,
  );
  expect(beforeScrollTop).toBeGreaterThan(0);
  expect(afterScrollTop).toBeGreaterThan(0);
});

test("100-character typing has no loss, iframe reload, or over-50ms editor long task", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  const beforeDocument = await documentToken(frame);
  await activateNativeEdit(frame, "paragraph-entities");
  await setTextSelection(frame, "paragraph-entities", 0);
  await installLongTaskRecorder(frame);

  const input = Array.from({ length: 100 }, (_, index) => String(index % 10)).join("");
  await page.keyboard.type(input, { delay: 0 });
  await waitForFramePaint(frame);

  expect(await documentToken(frame)).toBe(beforeDocument);
  const text = await frame.locator(caseSelector("paragraph-entities")).textContent();
  expect(text.startsWith(input)).toBe(true);
  expect(text.slice(0, input.length)).toBe(input);
  const longTasks = await recordedLongTasks(frame);
  expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(50);
});

test("beforeinput target ranges and Selection remain inside the authored case", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  await activateNativeEdit(frame, "heading-inline");
  await installInputRecorder(frame);
  await setTextSelection(frame, "heading-inline", 2, 8);
  const before = await selectionSnapshot(frame, "heading-inline");
  expect(before.text.length).toBeGreaterThan(0);

  await page.keyboard.insertText("原位");

  const events = await recordedInputEvents(frame);
  const beforeInput = events.find(({ type }) => type === "beforeinput");
  expect(beforeInput).toMatchObject({
    inputType: "insertText",
    targetCase: "heading-inline",
    defaultPrevented: false,
  });
  expect(beforeInput.targetRangeCount).toBeGreaterThanOrEqual(0);
  expect((await selectionSnapshot(frame, "heading-inline")).activeCase).toBe("heading-inline");
});

async function glyphPointForText(locator, snippet) {
  return locator.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const index = text.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const glyph = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (glyph.width > 0 && glyph.height > 0) {
          return {
            x: glyph.left - box.left + Math.min(Math.max(glyph.width / 2, 1), 6),
            y: glyph.top - box.top + Math.max(glyph.height / 2, 1),
          };
        }
      }
      node = walker.nextNode();
    }
    throw new Error(`No rendered glyph for ${JSON.stringify(needle)}`);
  }, snippet);
}

test("clicking a canvas selects the dedicated surface instead of the wrapping module", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const canvas = frame.locator(caseSelector("canvas-surface"));
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click({ force: true, position: { x: 8, y: 8 } });
  await expect(canvas).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(canvas.locator("xpath=ancestor::section[1]"))
    .not.toHaveAttribute("data-html-canvas-selected", /.+/u);
});

test("double-clicking a canvas selects the dedicated root without entering text editing", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const canvas = frame.locator(caseSelector("canvas-surface"));
  await canvas.scrollIntoViewIfNeeded();
  await canvas.dblclick({ force: true, position: { x: 4, y: 4 } });
  await expect(canvas).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(canvas.locator("xpath=ancestor::section[1]"))
    .not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  expect(await frame.locator('[contenteditable="true"]').count()).toBe(0);
  await expect(editor).not.toHaveAttribute("data-native-start-status", "started");
});

test("first double-click places a caret; a second double-click selects the word", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("heading-inline"));
  const toolbar = editor.getByRole("toolbar");
  const wordPoint = await glyphPointForText(target, "Word");
  await activateNativeEdit(frame, "heading-inline", wordPoint);
  await expect(toolbar.getByRole("button", { name: "编辑中", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    selectionInside: true,
  });
  const first = await selectionSnapshot(frame, "heading-inline");
  expect(first.collapsed).toBe(true);
  expect(first.text).toBe("");
  expect(first.rangeCount).toBe(1);

  await target.dblclick({ position: wordPoint, force: true });
  await expect.poll(async () => (
    await selectionSnapshot(frame, "heading-inline")
  ).text).toBe("Word");
  const second = await selectionSnapshot(frame, "heading-inline");
  expect(second.collapsed).toBe(false);
  expect(second.activeCase).toBe("heading-inline");
  await expect(toolbar.getByRole("button", { name: "编辑中", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});

test("an out-of-band authored DOM mutation fails closed and never reaches source", async ({ page }) => {
  const original = identifiedHtmlBuffer(fixtureBuffer("complex-layout.html"));
  const { editor, frame } = await loadFixture(page, "complex-layout.html", {
    buffer: original,
    identifiedWorkingCopy: false,
  });
  const target = frame.locator(caseSelector("grid-card"));
  const beforeText = await target.textContent();
  await activateNativeEdit(frame, "grid-card");

  await target.evaluate((element) => {
    const textNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    if (!textNode) throw new Error("fixture grid-card has no direct text node");
    textNode.data += "UNAUTHORISED_DOM_DRIFT";
  });
  await expect.poll(() => editor.getAttribute("data-edit-block-detail"))
    .toContain("编辑之外发生了变化");

  await page.keyboard.press(keyShortcut("S"));
  await expect.poll(() => target.textContent()).toBe(beforeText);
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});
