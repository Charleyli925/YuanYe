import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { expect, test } from "@playwright/test";

import { EDIT_AUTHOR_RUNTIME_BUDGET } from "../../../app/domain/edit-runtime-contract.js";

import {
  activateNativeEdit,
  closePageRootGracefully,
  currentEditorFrame,
  documentToken,
  ECHARTS_STUB,
  expectCheckpointPersisted,
  keyShortcut,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdirSync,
  mkdtempSync,
  path,
  readFileSync,
  removeValidatedTemporaryDirectory,
  stopPageRoot,
  tmpdir,
  writeFileSync,
} from "./electron-native-harness.mjs";

async function withRuntimeProject(prefix, files, run, launchOptions = {}) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), prefix));
  const sourcePath = path.join(sourceDirectory, "runtime-report.html");
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDirectory, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  const session = {
    electronApp: null,
    page: null,
    isolatedUserData: null,
  };
  try {
    Object.assign(session, await launchPageRoot({
      activeSourcePath: sourcePath,
      ...launchOptions,
    }));
    await run({
      get page() {
        return session.page;
      },
      get electronApp() {
        return session.electronApp;
      },
      sourcePath,
      isolatedUserData: session.isolatedUserData,
      relaunch: async () => {
        if (!session.electronApp || !session.page) {
          throw new Error("PageRoot session is not running.");
        }
        const closedApp = session.electronApp;
        const closedPage = session.page;
        session.electronApp = null;
        session.page = null;
        let closedProcess = null;
        try {
          closedProcess = closedApp.process();
        } catch {
          closedProcess = null;
        }
        await closePageRootGracefully(closedApp, closedPage);
        if (closedProcess && closedProcess.exitCode == null && !closedProcess.killed) {
          await Promise.race([
            new Promise((resolve) => closedProcess.once("exit", resolve)),
            new Promise((resolve) => {
              setTimeout(resolve, 15_000);
            }),
          ]);
        }
        Object.assign(session, await launchPageRoot({
          isolatedUserData: session.isolatedUserData,
        }));
        return session;
      },
    });
  } finally {
    if (session.electronApp && session.isolatedUserData) {
      try {
        await stopPageRoot(session.electronApp, session.isolatedUserData);
      } catch {
        removeValidatedTemporaryDirectory(session.isolatedUserData, "pageroot-native-e2e-");
      }
    } else if (session.isolatedUserData) {
      removeValidatedTemporaryDirectory(session.isolatedUserData, "pageroot-native-e2e-");
    }
    removeValidatedTemporaryDirectory(sourceDirectory, prefix);
  }
}

async function enableContinuityProbe(page) {
  await expect.poll(() => page.evaluate(() => ({
    editor: Boolean(document.querySelector('[data-testid="html-canvas-editor"]')),
    enable: typeof window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__,
  })), { timeout: 30_000 }).toEqual({
    editor: true,
    enable: "function",
  });
  await page.evaluate(() => window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__());
}

async function continuitySummary(page) {
  return page.evaluate(() => window.__PAGEROOT_SUMMARIZE_RUNTIME_CONTINUITY__());
}

async function enterNativeEdit(page, frame, caseId, { scrollTop = 480 } = {}) {
  const reviewStage = page.locator(".review-scroll-stage");
  const target = frame.locator(`[data-native-case="${caseId}"]`);
  await target.click();
  await reviewStage.evaluate((element, nextTop) => {
    element.scrollTop = nextTop;
  }, scrollTop);
  await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(400);
  await activateNativeEdit(frame, caseId);
  await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
  await target.press("End");
  return { reviewStage, target };
}

const STATIC_PAGE = `<!doctype html>
<html><head><title>Static continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-static">静态页连续编辑不得替换 Runtime 文档。</p>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

const NESTED_SCROLL_PAGE = `<!doctype html>
<html><head><title>Nested scroll continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <div style="height:280px;overflow:auto;border:1px solid #ccc">
      <p data-native-case="continuity-nested">嵌套滚动页输入时评论栏宽度必须保持。</p>
      <div aria-hidden="true" style="height:1400px"></div>
    </div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

const CHART_PAGE = `<!doctype html>
<html><head><title>Chart continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-blank-caret">图表页空行必须落到对应 br，而不是最近文本。</p>
    <div id="chart" style="width:320px;height:180px"></div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script src="echarts.js"></script>
  <script>
    parent.__PAGEROOT_BLANK_CARET_RUNTIME_COUNT__ =
      (parent.__PAGEROOT_BLANK_CARET_RUNTIME_COUNT__ || 0) + 1;
    echarts.init(document.querySelector('#chart')).setOption({series:[{type:'bar',data:[1,2,3]}]});
  </script>
</body></html>`;

test("a restored save publication is not reported as a missing source after stale-hash reconcile", async () => {
  await withRuntimeProject("pageroot-continuity-publication-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, electronApp, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-static");
    const { target } = await enterNativeEdit(page, frame, "continuity-static");
    const beforeDocument = await documentToken(page);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await page.evaluate(() => {
      window.__publicationWatchHints = [];
      window.htmlAIProjects.onSourceFileChanged((hint) => window.__publicationWatchHints.push(hint));
    });
    await electronApp.evaluate(async ({ net }, source) => {
      const { rename } = process.getBuiltinModule("fs/promises");
      const path = process.getBuiltinModule("path");
      const parked = path.join(path.dirname(source), ".pageroot", "publication-race.html");
      const originalFetch = net.fetch.bind(net);
      let pending = true;
      net.fetch = async (...args) => {
        if (pending && new URL(String(args[0])).pathname === "/managed-working-copy/reconcile") {
          pending = false;
          // The queued Repository reply can reject the locator's old Hash
          // after the current save has already restored the visible path.
          await rename(parked, source);
          net.fetch = originalFetch;
          return new Response(JSON.stringify({ error: {
            code: "WORKING_COPY_CONFLICT", message: "stale pre-save hash",
          } }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(...args);
      };
      await rename(source, parked);
    }, workingCopyPath);
    await expect.poll(() => page.evaluate(() => window.__publicationWatchHints.length))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__publicationWatchHints.every((hint) => hint.sourceMissing === false)))
      .toBe(true);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await target.press("End");
    await page.keyboard.insertText("PUBLICATION_RECOVERED");
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain("PUBLICATION_RECOVERED");
  });
});

test("continuous editing keeps the Runtime document through type, Enter, style and save", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = `CONTINUITY_TRANSACTION_MARKER_${"x".repeat(68)}`;
  await withRuntimeProject("pageroot-continuity-static-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, sourcePath, relaunch }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-static");
    const { target } = await enterNativeEdit(page, frame, "continuity-static");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");

    await page.keyboard.insertText(typed);
    await expect(target).toContainText(typed);
    for (let index = 0; index < 20; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(20);
    await target.evaluate((element) => {
      const node = Array.from(element.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("静态页连续编辑"),
      );
      if (!(node instanceof Text)) throw new Error("Original continuity sentence is missing.");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(4, node.data.length));
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    const toolbar = page.getByTestId("html-canvas-editor").getByRole("toolbar");
    await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/font-weight:\s*700/u);
    await expectCheckpointPersisted(page, 0);
    await page.keyboard.press(keyShortcut("S"));
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);

    const saved = readFileSync(workingCopyPath, "utf8");
    expect(saved).toContain(typed);
    expect(saved).toMatch(/font-weight:\s*700/u);
    const reopened = await relaunch();
    frame = (await loadedDiskFrame(reopened.page, workingCopyPath, "continuity-static")).frame;
    await expect(frame.locator('[data-native-case="continuity-static"]'))
      .toContainText(typed);
    expect(readFileSync(workingCopyPath, "utf8")).toContain(typed);
  });
});

test("continuous editing on a Script page keeps the Runtime document", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = "DYNAMIC_CONTINUITY_MARKER";
  await withRuntimeProject("pageroot-continuity-dynamic-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    const { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    for (const character of typed) {
      await page.keyboard.insertText(character);
    }
    await expect(target).toContainText(typed);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    expect(duringEdit.unexpectedCandidate).toBe(false);
  });
});

test("comment rail and canvas width stay visually continuous while typing in a nested scroller", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("pageroot-continuity-nested-e2e-", {
    "runtime-report.html": NESTED_SCROLL_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-nested");
    const rail = page.locator(".review-scroll-stage > .comments-panel.comment-rail");
    await expect(rail).toBeVisible();
    const { target } = await enterNativeEdit(page, frame, "continuity-nested");
    await enableContinuityProbe(page);
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_READ_RUNTIME_CONTINUITY__?.()?.samples.length || 0
    ))).toBeGreaterThan(0);
    await page.keyboard.insertText("宽度连续");
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await page.waitForFunction(() => {
      const samples = window.__PAGEROOT_READ_RUNTIME_CONTINUITY__?.()?.samples || [];
      if (samples.length < 2) return false;
      return samples.at(-1).t - samples[0].t >= 500;
    });
    const summary = await continuitySummary(page);
    expect(summary.maxCanvasWidthDelta).toBeLessThanOrEqual(4);
    expect(summary.railDisappeared).toBe(false);
    expect(summary.jumpedToTop).toBe(false);
    expect(summary.missingVisibleFrame).toBe(false);
    expect(summary.frameCreated).toBe(0);
    expect(summary.candidateCreated).toBe(0);
    await expect(rail).toBeVisible();
  });
});

test("ending Runtime text editing keeps the document and the sixth blank-line caret", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const marker = "SIXTH_BLANK_LINE_MARKER";
  await withRuntimeProject("pageroot-continuity-blank-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    let { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_BLANK_CARET_RUNTIME_COUNT__ || 0
    ));

    await page.keyboard.press("Escape");
    await expect(target).not.toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.waitForTimeout(900);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__PAGEROOT_BLANK_CARET_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    const afterBoundary = await continuitySummary(page);
    expect(afterBoundary.frameCreated).toBe(0);
    expect(afterBoundary.framePromoted).toBe(0);
    expect(afterBoundary.candidateCreated).toBe(0);
    frame = await currentEditorFrame(page);
    target = frame.locator('[data-native-case="continuity-blank-caret"]');
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const sixthBreak = await target.evaluate((element) => {
      const breaks = [...element.querySelectorAll(":scope > br")];
      if (breaks.length < 6) {
        throw new Error(`Need six blank lines, found ${breaks.length}.`);
      }
      const br = breaks[5];
      const range = document.createRange();
      range.setStartBefore(br);
      range.setEndAfter(br);
      const glyph = range.getBoundingClientRect();
      const host = element.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
      const fallbackY = lineHeight * 5 + lineHeight / 2;
      return {
        x: glyph.width >= 1 ? glyph.left - host.left + Math.max(4, glyph.width / 2) : 8,
        y: glyph.height >= 1 ? glyph.top - host.top + Math.max(2, glyph.height / 2) : fallbackY,
      };
    });
    await target.dblclick({ position: sixthBreak });
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.keyboard.insertText(marker);
    await expect(target).toContainText(marker);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
    const inner = readFileSync(workingCopyPath, "utf8").match(
      /data-native-case="continuity-blank-caret"[^>]*>([\s\S]*?)<\/p>/u,
    )?.[1] ?? "";
    expect(inner).toContain(marker);
    expect(inner).not.toMatch(/^\s*SIXTH_BLANK_LINE_MARKER/u);
    expect(inner).not.toMatch(/对应 br，而不是最近文本。SIXTH_BLANK_LINE_MARKER/u);
    const beforeMarker = inner.slice(0, inner.indexOf(marker));
    expect((beforeMarker.match(/<br\b/giu) || []).length).toBe(5);
  });
});

const DELAYED_CHART_PAGE = `<!doctype html><html><head><title>Continuous report</title>
<style>body{font:18px system-ui;padding:32px;color:#25232a}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}#chart{height:180px}canvas{width:320px;height:180px}</style></head>
<body><h1>Quarterly report</h1><main><p data-native-case="format-chart">Revenue grew steadily this quarter.</p><div id="chart"></div></main>
<script>
 parent.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ =
   (parent.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0) + 1;
 const text = document.querySelector('[data-native-case="format-chart"]').textContent;
 if (text.includes('FAIL_CHART')) {
   parent.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ =
     (parent.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0) + 1;
   throw new Error('synthetic chart initialization failure');
 }
 setTimeout(() => {
   const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180;
   document.querySelector('#chart').append(canvas);
   const ctx = canvas.getContext('2d'); ctx.fillStyle='#6054d9';
   [70,120,155].forEach((height,index)=>ctx.fillRect(20+index*95,180-height,60,height));
 }, text.includes('UPDATED') ? 700 : 30);
</script></body></html>`;

test("formatting preserves charts without an edit-boundary Runtime rebuild", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({}, testInfo) => {
  await withRuntimeProject("pageroot-chart-format-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "format-chart");
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const editor = page.getByTestId('html-canvas-editor');
    const generation = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute('data-frame-generation');
    const beforeDocument = await documentToken(page);
    const beforeScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    await activateNativeEdit(frame, 'format-chart');
    const target = frame.locator('[data-native-case="format-chart"]');
    await target.press('End');
    await page.keyboard.insertText(' UPDATED');
    await target.press('Home');
    await target.press('Shift+End');
    for (const name of ['加粗', '下划线', '加粗', '下划线']) {
      await editor.getByRole('button', { name, exact: true }).click();
      await expect(frame.locator('#chart canvas')).toHaveCount(1);
      expect(await frame.locator('#chart canvas').evaluate((canvas) => canvas.getContext('2d').getImageData(30,160,1,1).data[3])).toBe(255);
      await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', generation);
    }
    await page.evaluate(() => {
      window.__chartContinuitySamples = [];
      window.__chartContinuityTimer = setInterval(() => {
        const frame = document.querySelector('iframe[data-runtime-slot-role="active"]');
        if (frame?.contentDocument) window.__chartContinuitySamples.push(frame.contentDocument.querySelectorAll('#chart canvas').length);
      }, 16);
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press(keyShortcut('s'));
    await page.waitForTimeout(1_100);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', generation);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    expect(await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    await expect(editor).not.toHaveAttribute('data-runtime-refresh-pending', '');
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const samples = await page.evaluate(() => { clearInterval(window.__chartContinuityTimer); return window.__chartContinuitySamples; });
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((count) => count === 1)).toBe(true);
    const working = await managedWorkingCopyPath(page, sourcePath);
    expect(await readPublishedWorkingCopy(working, 'utf8')).toContain('UPDATED');
    await page.screenshot({ path: testInfo.outputPath('chart-format-continuity.png') });
  });
});

test("failed chart refresh keeps the latest static source quietly editable across repeated retries", async ({}, testInfo) => {
  await withRuntimeProject("pageroot-chart-failure-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor').filter({ visible: true }).first();
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await activateNativeEdit(frame, 'format-chart');
    await frame.locator('[data-native-case="format-chart"]').press('End');
    await page.keyboard.insertText(' FAIL_CHART');
    await page.keyboard.press('Escape');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('FAIL_CHART');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const failuresBeforeFirstRetry = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await editor.getByRole('button', { name: '复制元素', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeFirstRetry);
    await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    await expect(editor).toHaveAttribute(
      'data-runtime-degradation',
      'static-visible',
      { timeout: EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs + 8_000 },
    );
    await expect(editor).toHaveAttribute('data-runtime-surface-budget', 'exceeded');
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#chart canvas')).toHaveCount(0);

    let target = frame.locator('[data-native-case="format-chart"]').first();
    await target.dblclick();
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press('End');
    await page.keyboard.insertText('        CONTINUED');
    await page.keyboard.press(keyShortcut('s'));
    await page.keyboard.press('Escape');
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('CONTINUED');
    await expect(editor).toHaveAttribute('aria-readonly', 'false');

    const failuresBeforeRetry = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '重新加载动态内容', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeRetry);
    await expect(editor).toHaveAttribute(
      'data-runtime-degradation',
      'static-visible',
      { timeout: EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs + 8_000 },
    );
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    frame = await currentEditorFrame(page);
    target = frame.locator('[data-native-case="format-chart"]').first();
    await target.dblclick();
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press('End');
    await page.keyboard.insertText(' STILL_EDITABLE');
    await page.keyboard.press('Escape');
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('STILL_EDITABLE');
    await page.screenshot({ path: testInfo.outputPath('chart-failed-refresh-editable.png') });
  });
});

const HIDDEN_TAB_CHART_PAGE = `<!doctype html><html><head><title>Tabbed report</title>
<style>body{font:18px system-ui;padding:32px}.panel[hidden]{display:none}#chart{width:500px;height:240px}</style>
<script src="echarts.js"></script></head><body>
<nav role="tablist"><button role="tab" aria-controls="overview" aria-selected="true" class="tab" data-p="overview">Overview</button><button role="tab" aria-controls="details" aria-selected="false" class="tab" data-p="details">Details</button></nav>
<section role="tabpanel" id="overview" class="panel"><p data-native-case="overview-copy">Report overview</p></section>
<section role="tabpanel" id="details" class="panel" hidden><p data-native-case="hidden-chart-copy">Revenue grew this quarter.</p><div id="chart"></div></section>
<script>
parent.__PAGEROOT_HIDDEN_CHART_RUNTIME_COUNT__ =
 (parent.__PAGEROOT_HIDDEN_CHART_RUNTIME_COUNT__ || 0) + 1;
const chart = echarts.init(document.querySelector('#chart'));
chart.setOption({animation:false,xAxis:{data:['A','B']},yAxis:{},series:[{type:'bar',data:[30,60]}]});
window.addEventListener('resize',()=>chart.resize());
</script></body></html>`;

test("an active hidden tab keeps chart geometry without ordinary edit promotion", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({}, testInfo) => {
  await withRuntimeProject('pageroot-hidden-chart-e2e-', {
    'runtime-report.html': HIDDEN_TAB_CHART_PAGE,
    'echarts.js': readFileSync(new URL('../../../node_modules/echarts/dist/echarts.min.js', import.meta.url), 'utf8'),
  }, async ({ page, sourcePath }) => {
    let { frame, editor } = await loadedDiskFrame(page, sourcePath, 'overview-copy');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await frame.locator('.tab[data-p="details"]').click();
    await editor.getByRole('button', { name: '切换到此页签', exact: true }).click();
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#details')).toBeVisible();
    const chartWidth = () => frame.locator('#chart canvas').first().evaluate(canvas => canvas.width);
    await expect.poll(chartWidth).toBeGreaterThan(400);
    const initialDocument = await documentToken(page);
    const initialGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute('data-frame-generation');
    const initialScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_HIDDEN_CHART_RUNTIME_COUNT__ || 0
    ));
    for (const marker of [' First edit.', ' Second edit.']) {
      await activateNativeEdit(frame, 'hidden-chart-copy');
      await frame.locator('[data-native-case="hidden-chart-copy"]').press('End');
      await page.keyboard.insertText(marker);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', initialGeneration);
      await expect.poll(() => documentToken(page)).toBe(initialDocument);
      expect(await page.evaluate(() => (
        window.__PAGEROOT_HIDDEN_CHART_RUNTIME_COUNT__ || 0
      ))).toBe(initialScriptCount);
      await expect(editor).not.toHaveAttribute('data-runtime-refresh-pending', '');
      frame = await currentEditorFrame(page);
      await expect(frame.locator('#details')).toBeVisible();
      await expect.poll(chartWidth).toBeGreaterThan(400);
      await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath('restored-tab-chart.png') });
  });
});


test("owned composition snapshots keep formatted source nodes editable but author clones stay comment-only", {
  tag: ["@cap-canvas-editing"],
}, async ({}, testInfo) => {
  const source = DELAYED_CHART_PAGE.replace("Revenue grew steadily this quarter.", "Revenue <strong>grew steadily</strong> this quarter.");
  await withRuntimeProject("pageroot-owned-snapshot-e2e-", { "runtime-report.html": source }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, "format-chart");
    const editor = page.getByTestId("html-canvas-editor");
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const paragraph = frame.locator('[data-native-case="format-chart"]');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await paragraph.dblclick();
    await expect(paragraph).toHaveAttribute("contenteditable", "true");
    await paragraph.press(keyShortcut("ArrowRight"));
    await paragraph.dispatchEvent("compositionstart", { data: "" });
    await paragraph.dispatchEvent("compositionend", { data: "续写" });
    await paragraph.press(keyShortcut("ArrowLeft"));
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await editor.getByRole("button", { name: "加粗", exact: true }).click();
    await paragraph.locator("strong").dblclick();
    await expect(editor.getByRole("button", { name: "斜体", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "斜体", exact: true }).click();
    await paragraph.press(keyShortcut("ArrowRight"));
    await page.keyboard.insertText(" CONTINUED");
    await page.keyboard.press(keyShortcut("s"));
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(async () => await readPublishedWorkingCopy(working, "utf8")).toContain("CONTINUED");
    const activeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute('data-frame-generation');
    const activeDocument = await documentToken(page);
    const activeScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    await page.keyboard.press("Escape");
    await expect(paragraph).not.toHaveAttribute("contenteditable", "true");
    await page.waitForTimeout(900);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', activeGeneration);
    await expect.poll(() => documentToken(page)).toBe(activeDocument);
    expect(await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(activeScriptCount);
    // Both physical slots persist, but an ordinary successful text/style edit
    // leaves the second slot empty instead of preparing a deferred Candidate.
    await expect(editor.locator('iframe[data-runtime-slot-role="inactive"]')).toHaveCount(1);
    await expect(editor.locator('iframe[data-runtime-slot-role="candidate"]')).toHaveCount(0);
    await expect(editor).toHaveAttribute('data-render-verified', 'true');
    // Public attributes and source-identical bytes cannot grant authority.
    await paragraph.evaluate((node) => {
      const clone = node.cloneNode(true);
      clone.setAttribute("data-untrusted-copy", "true");
      node.after(clone);
    });
    await frame.locator('[data-untrusted-copy] strong').first().click();
    await expect(editor.getByRole("button", { name: "加粗", exact: true })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: /评论/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("owned-snapshot-authority.png") });
  });
});

test("the read-only recovery notice reloads source authority even when dynamic preparation fails", async ({}, testInfo) => {
  await withRuntimeProject("pageroot-static-reload-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, electronApp, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]').first();
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await target.dblclick();
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' FAIL_CHART');
    await page.keyboard.press('Escape');
    const failuresBeforeReload = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await editor.getByRole('button', { name: '复制元素', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeReload);
    await expect(editor).toHaveAttribute('aria-readonly', 'true', { timeout: 20_000 });
    await expect(page.getByTestId('edit-runtime-static-fallback')).toContainText('页面暂时无法编辑');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('FAIL_CHART');
    const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
    await activeFrame.evaluate((frame) => {
      window.__M5_BEFORE_AUTHORITY_CONTENT_DOCUMENT__ = frame.contentDocument;
    });
    // A second, independent failure during reload used to retain the previous
    // runtime's read-only flag forever, despite a verified static document.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('html-edit-runtime:prepare');
      ipcMain.handle('html-edit-runtime:prepare', () => { throw new Error('synthetic preparation unavailable'); });
    });
    await page.getByTestId('edit-runtime-static-fallback')
      .getByRole('button', { name: '重新载入当前 HTML', exact: true }).click();
    await expect(page.locator('.workbench-chrome-status')).toHaveText('页面已重新加载，可以继续编辑');
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    await expect.poll(() => activeFrame.evaluate((frame) => Boolean(
      frame.contentDocument
      && frame.contentDocument !== window.__M5_BEFORE_AUTHORITY_CONTENT_DOCUMENT__
    ))).toBe(true);
    await target.dblclick();
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' RECOVERED');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('RECOVERED');
    await page.screenshot({ path: testInfo.outputPath('reload-editing-restored.png') });
  }, {
    injectedEnv: {
      PAGEROOT_E2E_STATIC_CANDIDATE_FAILURE: "1",
    },
  });
});

test("Canvas shortcuts follow the promoted frame and same-source reload keeps charts running", async ({}, testInfo) => {
  await withRuntimeProject("pageroot-history-focus-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, "format-chart");
    const editor = page.getByTestId("html-canvas-editor");
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await target.dblclick();
    await target.press(keyShortcut("ArrowLeft"));
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await editor.getByRole("button", { name: "加粗", exact: true }).click();
    await target.press(keyShortcut("ArrowRight"));
    await page.keyboard.insertText(" HISTORY_CONTINUITY");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain("HISTORY_CONTINUITY");
    const generation = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute("data-frame-generation");
    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(() => readPublishedWorkingCopy(working)).not.toContain("HISTORY_CONTINUITY");
    // No extra click or history-settlement wait: a distinct Redo arriving
    // during Undo's save/acknowledgement must execute after it, not disappear.
    await page.keyboard.press(keyShortcut("Shift+z"));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain("HISTORY_CONTINUITY");
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).not.toHaveAttribute("data-frame-generation", generation);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-runtime-slot-role"))).toBe("active");
    await expect(editor).toHaveAttribute("data-runtime-activation", "activation-ready");
    await expect(editor).not.toHaveAttribute("data-runtime-candidate-id", /.+/u);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
    const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
    const beforeReloadDocument = await documentToken(page);
    const beforeReloadScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    const beforeReloadLastKnownGood = await editor.getAttribute(
      "data-runtime-last-known-good-id",
    );
    await activeFrame.evaluate((frame) => {
      window.__M5_BEFORE_SAME_BYTE_AUTHORITY_CONTENT_DOCUMENT__ = frame.contentDocument;
    });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect(page.locator(".workbench-chrome-status")).toHaveText("页面已重新加载，可以继续编辑");
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(beforeReloadScriptCount + 1);
    await expect.poll(() => documentToken(page)).not.toBe(beforeReloadDocument);
    await expect.poll(() => activeFrame.evaluate((frame) => Boolean(
      frame.contentDocument
      && frame.contentDocument !== window.__M5_BEFORE_SAME_BYTE_AUTHORITY_CONTENT_DOCUMENT__
    ))).toBe(true);
    await expect(editor).toHaveAttribute("data-runtime-activation", "activation-ready");
    await expect(editor).not.toHaveAttribute("data-runtime-candidate-id", /.+/u);
    await expect.poll(() => editor.getAttribute("data-runtime-last-known-good-id"))
      .not.toBe(beforeReloadLastKnownGood);
    await expect.poll(() => frame.locator("#chart canvas").evaluateAll(canvases => canvases.filter(canvas => (
      canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)
    )).length)).toBe(1);
    await target.dblclick();
    await expect(target).toHaveAttribute("contenteditable", "true");
    await page.screenshot({ path: testInfo.outputPath("history-focus-and-reload-chart.png") });
  });
});

test("a layout-safe format refusal keeps the Runtime text session active", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const source = `<!doctype html><html><head><title>Flex format refusal</title></head><body>
  <p style="display:inline-flex;gap:8px" data-native-case="flex-format-refusal">Flexible source text</p>
  <script>
    parent.__PAGEROOT_FLEX_FORMAT_RUNTIME_COUNT__ =
      (parent.__PAGEROOT_FLEX_FORMAT_RUNTIME_COUNT__ || 0) + 1;
  </script></body></html>`;
  await withRuntimeProject("pageroot-flex-format-refusal-e2e-", {
    "runtime-report.html": source,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "flex-format-refusal");
    const editor = page.getByTestId("html-canvas-editor");
    const target = frame.locator('[data-native-case="flex-format-refusal"]');
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_FLEX_FORMAT_RUNTIME_COUNT__ || 0
    ));

    await activateNativeEdit(frame, "flex-format-refusal");
    await target.evaluate((element) => {
      const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!(text instanceof Text) || text.data.length < 4) {
        throw new Error("Flex formatting fixture text is missing.");
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, text.data.length - 4);
      range.setEnd(text, text.data.length);
      const selection = element.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    const bold = editor.getByRole("button", { name: "加粗", exact: true });
    await expect(bold).toBeEnabled();
    await bold.click();
    await expect(editor).toHaveAttribute(
      "data-native-format-resume",
      "rejected:requested:resumed",
    );
    await expect(target).toHaveAttribute("contenteditable", "true");
    await target.press("End");
    await page.keyboard.insertText(" STILL_TYPING_AFTER_REFUSAL");
    await page.keyboard.press(keyShortcut("s"));
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("STILL_TYPING_AFTER_REFUSAL");
    expect(await readPublishedWorkingCopy(working, "utf8")).not.toMatch(/font-weight\s*:/u);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__PAGEROOT_FLEX_FORMAT_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
  });
});

test("a partial background fill refusal validates the Kernel result before publication", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const source = `<!doctype html><html><head><title>Background format refusal</title></head><body>
  <p data-native-case="background-format-refusal">Background source text</p>
  <script>
    parent.__PAGEROOT_BACKGROUND_FORMAT_RUNTIME_COUNT__ =
      (parent.__PAGEROOT_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0) + 1;
  </script></body></html>`;
  await withRuntimeProject("pageroot-background-format-refusal-e2e-", {
    "runtime-report.html": source,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "background-format-refusal");
    const editor = page.getByTestId("html-canvas-editor");
    const target = frame.locator('[data-native-case="background-format-refusal"]');
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__PAGEROOT_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0
    ));

    await activateNativeEdit(frame, "background-format-refusal");
    await target.evaluate((element) => {
      const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!(text instanceof Text) || text.data.length < 10) {
        throw new Error("Background formatting fixture text is missing.");
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 10);
      const selection = element.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    await editor.getByText("样式与间距", { exact: true }).click();
    const fill = editor.getByLabel("元素填充色");
    await expect(fill).toBeEnabled();
    await fill.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) throw new Error("Fill input is missing.");
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(element, "#ff0000");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(editor).toHaveAttribute(
      "data-native-format-resume",
      "rejected:requested:resumed",
    );
    await expect(target).toHaveAttribute("contenteditable", "true");
    const working = await managedWorkingCopyPath(page, sourcePath);
    expect(await readPublishedWorkingCopy(working, "utf8"))
      .not.toMatch(/background-color\s*:/u);
    await target.press("End");
    await page.keyboard.insertText(" STILL_TYPING_AFTER_BACKGROUND_REFUSAL");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("STILL_TYPING_AFTER_BACKGROUND_REFUSAL");
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__PAGEROOT_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
  });
});

test("format state ignores unselected boundary text and unchanged formatting keeps the native session", async () => {
  const source = DELAYED_CHART_PAGE.replace('Revenue grew steadily this quarter.', '<span style="font-style:italic">Selected</span> unselected normal text.');
  await withRuntimeProject('pageroot-format-boundary-e2e-', { 'runtime-report.html': source }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await target.dblclick();
    await target.evaluate(node => {
      const span = node.querySelector('span');
      const range = node.ownerDocument.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.nextSibling, 0);
      const selection = node.ownerDocument.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      node.ownerDocument.dispatchEvent(new Event('selectionchange'));
    });
    const italic = editor.getByRole('button', { name: '斜体', exact: true });
    await expect(italic).toHaveAttribute('aria-pressed', 'true');
    await italic.click();
    await expect.poll(() => target.locator('span').first().evaluate(node => getComputedStyle(node).fontStyle)).toBe('normal');
    await editor.getByText('样式与间距', { exact: true }).click();
    const size = editor.getByLabel('字号（像素）');
    await size.fill('24');
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('font-size: 24px');
    const saved = await readPublishedWorkingCopy(working);
    // A different numeric spelling requests the same valid 24px style.
    await editor.getByText('样式与间距', { exact: true }).click();
    await size.fill('024');
    await expect(editor).toHaveAttribute('data-native-format-resume', 'unchanged:requested:resumed');
    await expect(target).toHaveAttribute('contenteditable', 'true');
    expect(await readPublishedWorkingCopy(working)).toBe(saved);
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' STILL_EDITING');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('STILL_EDITING');
  });
});


test("editing a published Undo projection remains available while its save receipt waits", async () => {
  await withRuntimeProject('pageroot-history-followup-e2e-', { 'runtime-report.html': DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await target.dblclick();
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' BEFORE_UNDO');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('BEFORE_UNDO');
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let started;
    const saving = new Promise(resolve => { started = resolve; });
    const routePattern = /\/autosave(?:\?|$)/u;
    let finishRoute;
    const routeDone = new Promise(resolve => { finishRoute = resolve; });
    let routeStarted = false;
    const routeHandler = async route => {
      routeStarted = true;
      started();
      try {
        await barrier;
        await route.continue();
      } finally {
        finishRoute();
      }
    };
    await page.route(routePattern, routeHandler);
    try {
      await page.keyboard.press(keyShortcut('z'));
      await saving;
      await expect(target).not.toContainText('BEFORE_UNDO');
      await expect(editor).toHaveAttribute('data-render-verified', 'true');
      await expect.poll(() => editor.getAttribute('data-runtime-handoff'))
        .not.toBe('positioning');
      await target.dblclick();
      await expect(target).toHaveAttribute('contenteditable', 'true');
      await target.press(keyShortcut('ArrowLeft'));
      for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
      await editor.getByRole('button', { name: '加粗', exact: true }).click();
      await expect(editor).toHaveAttribute(
        'data-native-format-resume',
        'source:requested:resumed',
      );
      await expect(target).toHaveAttribute('contenteditable', 'true');
      await target.press(keyShortcut('ArrowRight'));
      await page.keyboard.insertText(' AFTER_UNDO');
      release();
      await page.keyboard.press(keyShortcut('s'));
      await expect.poll(() => readPublishedWorkingCopy(working)).toContain('AFTER_UNDO');
      expect(await readPublishedWorkingCopy(working)).not.toContain('BEFORE_UNDO');
    } finally {
      release();
      if (routeStarted) await routeDone;
      await page.unroute(routePattern, routeHandler);
    }
  });
});
