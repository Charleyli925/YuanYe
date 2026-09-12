import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveWorkbenchInspector } from "../app/workbench/inspector-presentation.js";

function lastCssRule(css, selector) {
  const marker = `${selector} {`;
  const start = css.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule: ${selector}`);
  return css.slice(start, end + 1);
}

async function readWorkbenchCascadeCss() {
  const entryUrl = new URL("../app/globals.css", import.meta.url);
  const entry = await readFile(entryUrl, "utf8");
  const imports = [...entry.matchAll(/@import\s+"(\.\/styles\/[^"]+\.css)";/gu)]
    .map((match) => match[1]);
  assert.deepEqual(imports, [
    "./styles/tokens-and-base.css",
    "./styles/workbench-shell.css",
    "./styles/workbench-tabs.css",
    "./styles/review-v5.css",
    "./styles/review-v51.css",
    "./styles/review-v52-canvas.css",
    "./styles/comment-hierarchy.css",
    "./styles/about-and-chrome.css",
    "./styles/settings-workspace.css",
    "./styles/top-toolbar.css",
    "./styles/workbench-chrome.css",
    "./styles/project-sidebar.css",
    "./styles/project-rules.css",
  ]);
  assert.equal(entry.trim(), imports.map((file) => `@import "${file}";`).join("\n"));
  const parts = await Promise.all(imports.map((file) => (
    readFile(new URL(file, entryUrl), "utf8")
  )));
  return parts.join("");
}

test("top toolbar keeps one compact cross-mode visual contract", async () => {
  const css = await readWorkbenchCascadeCss();

  const header = lastCssRule(css, ".workbench > .workbench-header");
  assert.match(header, /grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(header, /background:\s*var\(--chrome-toolbar-surface\)/u);
  assert.match(
    css,
    /\.workbench > \.workbench-tabbar,\n\.workbench > \.workbench-header \{[\s\S]*?backdrop-filter:\s*blur\(22px\)/u,
  );

  const modeFrame = lastCssRule(css, ".canvas-mode-switch");
  assert.match(modeFrame, /width:\s*180px/u);
  assert.match(modeFrame, /height:\s*34px/u);
  assert.match(modeFrame, /grid-template-columns:\s*repeat\(3, 1fr\)/u);
  assert.match(modeFrame, /padding:\s*2px/u);
  assert.match(modeFrame, /border:\s*1px solid var\(--chrome-divider\)/u);

  const sendButton = css.match(
    /\.header-actions \.header-send-button,\n\.workbench-review-tools-slot > \.header-send-button \{[\s\S]*?\}/u,
  );
  assert.ok(sendButton, "missing shared send/review decision button rule");
  assert.match(sendButton[0], /height:\s*32px/u);
  assert.match(sendButton[0], /margin:\s*0/u);
  assert.match(sendButton[0], /box-shadow:\s*0 2px 5px rgb\(65 57 166 \/ 13%\)/u);
});

test("global sidebar owns the full shell column and start page has no card surface", async () => {
  const css = await readWorkbenchCascadeCss();

  assert.match(
    css,
    /\.workbench\[data-left-sidebar="open"\] \{\s*--workbench-sidebar-width:\s*clamp\(200px, var\(--workbench-sidebar-width-saved\), 420px\)/u,
  );
  assert.match(css, /--chrome-sidebar-surface:\s*rgb\(239 239 243 \/ 72%\)/u);
  assert.match(css, /\.workbench-toolbar-primary,\n\.workbench-toolbar-center,\n\.workbench-toolbar-actions \{/u);
  assert.match(css, /grid-template-columns:\s*180px minmax\(0, 1fr\) auto/u);
  assert.match(css, /\.workbench-resizer\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/u);
  assert.match(css, /\.workbench-sidebar-titlebar\s*\{[\s\S]*?border-bottom:\s*0/u);
  assert.match(css, /\.workbench-tooltip-overlay\s*\{[\s\S]*?position:\s*fixed/u);
  const sidebar = lastCssRule(css, ".workbench-global-sidebar");
  const shell = lastCssRule(css, ".workbench > .workbench-global-sidebar");
  assert.match(shell, /grid-column:\s*1/u);
  assert.match(shell, /grid-row:\s*1 \/ -1/u);
  assert.doesNotMatch(sidebar, /position:\s*fixed/u);

  const startContent = lastCssRule(css, ".workbench-start-content");
  assert.match(startContent, /width:\s*min\(840px, 100%\)/u);
  assert.match(startContent, /gap:\s*40px/u);
  assert.doesNotMatch(startContent, /border|box-shadow|background/u);

  assert.match(
    css,
    /\.workbench-start-page \{\s*min-width:[\s\S]*?padding:\s*clamp\(64px, 8vh, 92px\)/u,
  );
  assert.match(
    css,
    /\.workbench-start-resume \{\s*width:[\s\S]*?border:\s*1px solid var\(--line-soft\)[\s\S]*?border-radius:\s*15px/u,
  );
  assert.match(
    css,
    /\.workbench-start-task-list > button \{\s*width:[\s\S]*?border-bottom:\s*1px solid var\(--line-soft\)[\s\S]*?background:\s*transparent/u,
  );

  const footer = lastCssRule(css, ".workbench-sidebar-footer");
  assert.match(footer, /display:\s*flex/u);
  assert.match(footer, /justify-content:\s*flex-end/u);
  const settings = lastCssRule(css, ".workbench-sidebar-settings");
  assert.match(settings, /width:\s*26px/u);
  assert.match(settings, /height:\s*26px/u);
  assert.match(settings, /margin-left:\s*auto/u);
});

test("sidebar controls share inset and tab chrome is vertically centered without a grip line", async () => {
  const css = await readWorkbenchCascadeCss();
  const tabs = css.match(/\.workbench-tablist\s*\{[\s\S]*?\}/u)?.[0];
  assert.ok(tabs, "missing base tablist rule");
  assert.match(tabs, /align-items:\s*center/u);
  assert.match(tabs, /padding:\s*0 8px 0 140px/u);

  for (const selector of [
    ".workbench-sidebar-product",
    ".workbench-sidebar-body",
    ".workbench-sidebar-footer",
  ]) {
    assert.match(
      lastCssRule(css, selector),
      /var\(--sidebar-content-inset, 14px\)/u,
      `${selector} must use the shared left inset`,
    );
  }
  assert.match(css, /\.workbench-resizer-grip\s*\{[\s\S]*?display:\s*none/u);
  assert.match(css, /\.workbench-resizer\s*\{[\s\S]*?width:\s*18px/u);
});

test("project version lists retain compact unweighted rows", async () => {
  const css = await readWorkbenchCascadeCss();

  const projectRow = lastCssRule(css, ".sidebar-project-row");
  assert.match(projectRow, /font-size:\s*12px/u);
  assert.match(projectRow, /font-weight:\s*400/u);
  assert.match(projectRow, /display:\s*grid/u);
  assert.match(projectRow, /grid-template-columns:\s*var\(--sidebar-row-icon-column\) minmax\(0, 1fr\)/u);
  assert.doesNotMatch(css, /sidebar-project-row-current|sidebar-project-pending/u);
  assert.match(css, /\.sidebar-project-row > \.sidebar-project-icon\s*\{[\s\S]*?width:\s*16px[\s\S]*?height:\s*16px/u);

  const versionRow = lastCssRule(css, ".sidebar-version-row");
  assert.match(versionRow, /grid-template-columns:\s*var\(--sidebar-row-icon-column\) minmax\(0, 1fr\) 68px/u);
  assert.match(versionRow, /padding:\s*0/u);
  assert.match(css, /\.sidebar-version-row\[data-selected="true"\]/u);
  assert.doesNotMatch(css, /sidebar-version-file > svg/u);
  assert.doesNotMatch(css, /sidebar-version-current-label/u);
  assert.doesNotMatch(css, /sidebar-skeleton-icon/u);
  const rulesRow = lastCssRule(css, ".sidebar-project-rules-row");
  assert.match(rulesRow, /min-height:\s*34px/u);
  assert.match(rulesRow, /grid-template-columns:\s*var\(--sidebar-row-icon-column\) minmax\(0, 1fr\)/u);
  assert.doesNotMatch(css, /sidebar-project-rules-copy|<small>PROJECT\.md/u);
});

test("cache handoff waits for static display readiness and uses live canvas geometry", async () => {
  const moduleCss = await readFile(new URL(
    "../app/workbench/workbench-document-surface-cache.module.css",
    import.meta.url,
  ), "utf8");
  const cacheComponent = await readFile(new URL(
    "../app/workbench/WorkbenchDocumentSurfaceCache.tsx",
    import.meta.url,
  ), "utf8");

  assert.match(moduleCss, /\.cache\s*\{[\s\S]*?grid-column:\s*2/u);
  assert.match(moduleCss, /\.cache\[data-visible="true"\]\s*\{[\s\S]*?padding:\s*0/u);
  assert.match(cacheComponent, /data-display-ready/u);
  assert.match(cacheComponent, /candidateTabId/u);
  assert.match(cacheComponent, /presentedToken/u);
  assert.match(cacheComponent, /data-source-sha256=\{entry\.sourceSha256\}/u);
  assert.match(cacheComponent, /hidden=\{entry\.tabId !== renderedPresentedToken\?\.tabId[\s\S]*?entry\.sourceSha256 !== renderedPresentedToken\?\.sourceSha256/u);
});

test("settings stays a flat 780px canvas with one bordered row container", async () => {
  const css = await readWorkbenchCascadeCss();
  assert.match(css, /\.workbench-settings-page\s*\{[\s\S]*?background:\s*#fff/u);
  assert.match(css, /\.settings-page-inner\s*\{[\s\S]*?width:\s*min\(780px, 100%\)/u);
  assert.match(css, /\.settings-page-header h1\s*\{[\s\S]*?font-size:\s*26px/u);
  const rows = lastCssRule(css, ".settings-section-rows");
  assert.match(rows, /border:\s*1px solid/u);
  assert.match(rows, /border-radius:\s*12px/u);
  assert.doesNotMatch(rows, /box-shadow/u);
  assert.match(css, /\.settings-row\s*\{[\s\S]*?min-height:\s*62px/u);
  assert.match(css, /\.settings-row\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0, 1fr\) auto/u);
  assert.doesNotMatch(css, /\.settings-close-button/u);
  assert.doesNotMatch(css, /\.settings-update-card/u);
  assert.match(css, /\.workbench-settings-sidebar\[data-open="true"\]\s*\{[\s\S]*?display:\s*block/u);
});

test("removed project/status/review navigation surfaces have no CSS or import owner", async () => {
  const css = await readWorkbenchCascadeCss();
  for (const retired of [
    "project-resources.css",
    "\.workbench-toolbar-status",
    "\.toolbar-change-navigator",
    "\.side-drawer",
    "\.drawer-overlay",
    "\.project-panel-title",
  ]) assert.doesNotMatch(css, new RegExp(retired, "u"), retired);
});

test("embedded review stays in the content row instead of covering the header", async () => {
  const css = await readWorkbenchCascadeCss();
  const reviewCss = await readFile(
    new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url),
    "utf8",
  );
  const stage = css.match(/\.workbench > \.review-scroll-stage \{[\s\S]*?\}/u);
  assert.ok(stage, "missing .workbench > .review-scroll-stage rule");
  assert.match(stage[0], /position:\s*relative/u);
  assert.doesNotMatch(stage[0], /overflow:\s*hidden/u);

  const header = lastCssRule(css, ".workbench-header");
  assert.doesNotMatch(header, /z-index:\s*80/u);
  assert.match(
    reviewCss,
    /@media \(max-width: 1120px\)[\s\S]*?\.reviewMainWithSidebar \.reviewSidebar \{[\s\S]*?z-index:\s*80[\s\S]*?grid-column:\s*auto[\s\S]*?grid-row:\s*auto/u,
  );
});

test("document persistence failures occupy a workspace row with copyable details", async () => {
  const shell = await readFile(
    new URL("../app/styles/workbench-shell.css", import.meta.url),
    "utf8",
  );
  const workbench = await readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  assert.match(
    shell,
    /\.workbench\[data-document-persistence-banner="true"\][\s\S]*?grid-template-rows:[\s\S]*?auto[\s\S]*?minmax\(0, 1fr\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.document-persistence-banner\s*\{[\s\S]*?position:\s*relative[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*3/u,
  );
  assert.match(
    shell,
    /\.workbench > \.document-persistence-banner span\s*\{[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?white-space:\s*normal/u,
  );
  assert.match(workbench, /className="source-conflict-banner document-persistence-banner"/u);
  assert.match(workbench, /<summary>错误详情<\/summary>/u);
  assert.match(workbench, />复制错误详情<\/button>/u);
});

test("a hover tooltip stays pointer-scoped and yields to the surface it opened", async () => {
  const css = await readWorkbenchCascadeCss();

  // Chromium leaves a clicked button focused. Revealing the bubble on any focus
  // state (:focus, or :focus-within which also matches the element itself)
  // pins it on screen long after the pointer left.
  assert.match(
    css,
    /\[data-tooltip\]:hover::after,\n\[data-tooltip\]:focus-visible::after \{/u,
  );
  assert.doesNotMatch(css, /\[data-tooltip\][^\n{,]*:focus-within::after/u);
  assert.doesNotMatch(css, /\[data-tooltip\][^\n{,]*:focus::after/u);

  const openedTrigger = lastCssRule(css, '[data-tooltip][aria-expanded="true"]::after');
  assert.match(openedTrigger, /opacity:\s*0/u);
  assert.match(openedTrigger, /visibility:\s*hidden/u);
  // The reveal rules carry the same specificity, so only source order keeps the
  // suppression in force while the trigger's own surface is open.
  assert.ok(
    css.lastIndexOf('[data-tooltip][aria-expanded="true"]::after')
      > css.lastIndexOf("[data-tooltip]:focus-visible::after"),
    "the opened-trigger suppression must follow every tooltip reveal rule",
  );
});

test("the shell owns the outer grid and one fixed inspector contract", async () => {
  const stylesUrl = new URL("../app/styles/", import.meta.url);
  const [tokens, shell, tabs, reviewV5, reviewV51, reviewModule, noticeBar, workbench] =
    await Promise.all([
      readFile(new URL("tokens-and-base.css", stylesUrl), "utf8"),
      readFile(new URL("workbench-shell.css", stylesUrl), "utf8"),
      readFile(new URL("workbench-tabs.css", stylesUrl), "utf8"),
      readFile(new URL("review-v5.css", stylesUrl), "utf8"),
      readFile(new URL("review-v51.css", stylesUrl), "utf8"),
      readFile(new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/components/NoticeBar.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    ]);
  const outerGridRule = /\.workbench(?:\[[^\]]+\])?\s*\{[^}]*grid-template-(?:columns|rows)/u;

  assert.match(shell, /--workbench-inspector-width:\s*376px/u);
  assert.match(
    shell,
    /grid-template-columns:\s*var\(--workbench-sidebar-width\)\s+minmax\(0, 1fr\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.workbench-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 250px\)\s+minmax\(0, 1fr\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.workbench-header > \.header-actions\s*\{[\s\S]*?justify-self:\s*stretch/u,
  );
  assert.match(
    shell,
    /\.workbench > \.review-scroll-stage\[data-inspector="comments"\][\s\S]*?var\(--workbench-inspector-width\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.review-scroll-stage\[data-inspector="ai"\][\s\S]*?position: absolute/u,
  );
  assert.doesNotMatch(tokens, outerGridRule);
  assert.doesNotMatch(tabs, outerGridRule);
  assert.doesNotMatch(reviewV5, outerGridRule);
  assert.doesNotMatch(reviewV51, outerGridRule);
  assert.doesNotMatch(tabs, /--workbench-sidebar-width:\s*240px/u);
  assert.doesNotMatch(reviewModule, /:has\(/u);
  assert.doesNotMatch(noticeBar, /--notice-rail-width/u);
  assert.match(noticeBar, /\.viewport\s*\{[^}]*left:\s*50%/u);
  assert.equal((workbench.match(/data-inspector=\{workbenchInspector\}/gu) || []).length, 1);

  assert.equal(deriveWorkbenchInspector({
    canvasMode: "edit",
    commentsAvailable: true,
  }), "comments");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "preview",
    aiVisible: true,
  }), "ai");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "preview",
    aiVisible: true,
    reviewVisible: true,
  }), "review");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "edit",
    commentsAvailable: false,
  }), "none");
});
