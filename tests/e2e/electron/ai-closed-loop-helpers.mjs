import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

import { expect } from "@playwright/test";

import { sha256 } from "../../../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../../../bridge/project-file-repository.mjs";
import {
  activateNativeEdit,
  caseSelector,
  fixtureBuffer,
  productRoot,
  setTextSelection,
} from "../browser/pageroot-driver.mjs";
import {
  closePageRootGracefully as closeSharedPageRootGracefully,
  createSourceFixture as createSharedSourceFixture,
  launchPageRoot as launchSharedPageRoot,
  loadedDiskFrame,
  openRailGlobalCommentComposer,
  removeValidatedTemporaryDirectory,
  removeSourceFixture as removeSharedSourceFixture,
  seedLegacyV3Project,
  stopPageRoot,
  waitForProjectReady,
} from "./helpers/pageroot-app-fixture.mjs";
import { startOpenAiCompatibleHttpAgent } from "../../fixtures/openai-compatible-http-agent.mjs";

export {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
};
export { spawnSync, tmpdir, path, inflateSync, expect, sha256 };
export {
  activateNativeEdit,
  caseSelector,
  fixtureBuffer,
  productRoot,
  setTextSelection,
};
export {
  loadedDiskFrame,
  openRailGlobalCommentComposer,
  seedLegacyV3Project,
  stopPageRoot,
  waitForProjectReady,
};

export async function launchPageRoot(options = {}) {
  return launchSharedPageRoot({
    userDataPrefix: "pageroot-native-e2e-ai-loop-",
    ...options,
  });
}

export async function closePageRootGracefully(electronApp, page) {
  return closeSharedPageRootGracefully(electronApp, page, { timeout: 20_000 });
}
export const ORIGINAL_TEXT = "列表项中的文字保持项目符号和缩进。";
export const UPDATED_TEXT = "自动闭环验收通过";
export const SECOND_UPDATED_TEXT = "自动闭环第二版通过";
export const QODER_VISUAL_OUTPUT = path.join(
  productRoot,
  "output/playwright/qoder-auto-connection-sync",
);
mkdirSync(QODER_VISUAL_OUTPUT, { recursive: true });
export const PICKER_TEXT = "项目切换原子发布验收通过";
export const READABLE_REWRITE_BEFORE = "综搜整体仍处于放缓背景，关键不在于单纯增加曝光，而在于识别商品需求，并用更匹配的供给承接；核心仍是让模型识别电商意图，再优化结果组织，把模糊兴趣转化为可验证需求。";
export const READABLE_REWRITE_AFTER = "综搜放缓，但电商搜索仍有较高大盘。关键是识别内容浏览中的潜在商品需求，并用匹配供给承接。供给可归纳为电商意图识别、优化结果组织，将模糊兴趣转为可验证需求。";
export const LINE_SCOPE_BEFORE = "甲旧，中间稳定文字保持不变，乙旧。";
export const LINE_SCOPE_AFTER = "甲新，中间稳定文字保持不变，乙新。";
export const SCOPE_PROMOTION_BEFORE = "稳定开场。甲旧，稳甲，乙旧，稳乙，丙旧。<br>丁旧，稳丁，戊旧，稳戊，己旧。<br>庚旧，稳庚，辛旧，稳辛，壬旧。<br>稳定收尾行。";
export const SCOPE_PROMOTION_AFTER = "稳定开场。甲新，稳甲，乙新，稳乙，丙新。<br>丁新，稳丁，戊新，稳戊，己新。<br>庚新，稳庚，辛新，稳辛，壬新。<br>稳定收尾行。";
// A page footer lives outside <main>; a single-file page has no site chrome, so
// a rewrite there must still be reviewed instead of silently disappearing.
export const OUTSIDE_MAIN_BEFORE = "口径说明：数据来自公开披露的季度公告（未经审计）；分类目口径与公告分部不同，跨期可比性受限。";
export const OUTSIDE_MAIN_AFTER = "口径说明：数据来自公开披露的季度公告（未经审计）；分类目口径与公告分部一致。";
export const REVIEW_METRIC_BEFORE_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #d9dcec;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #ffffff;
        color: #2d2d39;
      }
      [data-review-metric] strong { color: #6d5ce7; font-size: 28px; }
      [data-review-metric] span { color: #555767; }
      [data-review-metric] small { color: #239b56; }
      [data-review-inherited-copy] { color: #555767; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 54px; inline-size: 240px; overflow: hidden; }
`;
export const REVIEW_METRIC_AFTER_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #241d58;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #241d58;
        color: #ffffff;
      }
      [data-review-metric] strong { color: #ffffff; font-size: 28px; }
      [data-review-metric] span { color: #dedcf2; }
      [data-review-metric] small { color: #9fe6bf; }
      [data-review-inherited-copy] { color: #ffffff; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 84px; inline-size: 240px; overflow: hidden; }
`;

export const REVIEW_MASK_UNION_BEFORE = `
      <style data-review-hostile-mask-css>
        svg path, mask rect, path, rect {
          fill: #00ff00 !important;
          fill-opacity: .05 !important;
          stroke: #00ffff !important;
          opacity: .05 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
        [id^="pageroot-review-mask"] {
          display: none !important;
          opacity: .01 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
      </style>
      <section data-review-mask-union-fixture>
        <h2>遮罩并集</h2>
        <div data-review-mask-stage style="position:relative;display:flow-root;width:300px;height:170px;margin:20px 0;background:rgb(204, 0, 0)">
          <div id="review-mask-fact-alpha" data-review-mask-fact="alpha" style="display:block;margin:24px 0 0 24px;width:150px;height:86px;border:2px solid #4a1111;color:transparent">A</div>
          <div id="review-mask-fact-beta" data-review-mask-fact="beta" style="display:block;margin:-52px 0 0 96px;width:150px;height:86px;border:2px solid #114a11;color:transparent">B</div>
          <svg aria-hidden="true" width="1" height="1"><mask id="pageroot-review-mask-forged"><rect width="1" height="1"></rect></mask></svg>
        </div>
      </section>`;

export const REVIEW_MASK_UNION_AFTER = `
      <style data-review-hostile-mask-css>
        svg path, mask rect, path, rect {
          fill: #00ff00 !important;
          fill-opacity: .05 !important;
          stroke: #00ffff !important;
          opacity: .05 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
        [id^="pageroot-review-mask"] {
          display: none !important;
          opacity: .01 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
      </style>
      <section data-review-mask-union-fixture>
        <h2>遮罩并集</h2>
        <div data-review-mask-stage style="position:relative;display:flow-root;width:300px;height:170px;margin:20px 0;background:rgb(204, 0, 0)">
          <div id="review-mask-fact-alpha" data-review-mask-fact="alpha" style="display:block;margin:24px 0 0 24px;width:150px;height:86px;border:6px solid #6d5ce7;color:transparent">A</div>
          <div id="review-mask-fact-beta" data-review-mask-fact="beta" style="display:block;margin:-52px 0 0 96px;width:150px;height:86px;border:6px solid #d26a81;color:transparent">B</div>
          <svg aria-hidden="true" width="1" height="1"><mask id="pageroot-review-mask-forged"><rect width="1" height="1"></rect></mask></svg>
        </div>
      </section>`;

export function decodePngPixels(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Expected a PNG screenshot.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error("Unsupported screenshot PNG format.");
  }
  const bytesPerRow = width * channels;
  const source = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(bytesPerRow * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = source[sourceOffset];
    sourceOffset += 1;
    const rowOffset = row * bytesPerRow;
    for (let column = 0; column < bytesPerRow; column += 1) {
      const raw = source[sourceOffset + column];
      const left = column >= channels ? pixels[rowOffset + column - channels] : 0;
      const up = row > 0 ? pixels[rowOffset - bytesPerRow + column] : 0;
      const upLeft = row > 0 && column >= channels
        ? pixels[rowOffset - bytesPerRow + column - channels]
        : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 0xff;
      if (filter === 2) value = (raw + up) & 0xff;
      if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) {
        const predictor = left + up - upLeft;
        const leftDistance = Math.abs(predictor - left);
        const upDistance = Math.abs(predictor - up);
        const upLeftDistance = Math.abs(predictor - upLeft);
        const paeth = leftDistance <= upDistance && leftDistance <= upLeftDistance
          ? left
          : upDistance <= upLeftDistance ? up : upLeft;
        value = (raw + paeth) & 0xff;
      }
      if (filter > 4) throw new Error("Unsupported screenshot PNG filter.");
      pixels[rowOffset + column] = value;
    }
    sourceOffset += bytesPerRow;
  }
  return {
    width,
    height,
    pixelAt(x, y) {
      const column = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const row = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const offset = (row * width + column) * channels;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    },
  };
}

export function createSourceFixture(
  fileName = "generated-ai-loop.html",
  transform = (source) => source,
) {
  return createSharedSourceFixture({
    fileName,
    transform,
    sourceDirectoryPrefix: "pageroot-ai-loop-source-",
  });
}

export function removeSourceFixture(sourceDirectory) {
  removeSharedSourceFixture(sourceDirectory, "pageroot-ai-loop-source-");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function createQoderAcpE2ECommand(directory, {
  hang = false,
  pidFile = null,
  authRequired = false,
  capacityUnavailable = false,
  runtimeFailure = false,
  visibleText = false,
  visibleTextGateMs = 0,
} = {}) {
  const command = path.join(directory, "pageroot-qoder-acp-e2e");
  const agent = path.join(productRoot, "tests", "fixtures", "qoder-acp-agent.mjs");
  const fixtureArgs = [
    hang ? "--hang" : null,
    pidFile ? `--pid-file=${pidFile}` : null,
    authRequired ? "--auth-required" : null,
    capacityUnavailable ? "--capacity-unavailable" : null,
    runtimeFailure ? "--runtime-failure" : null,
    visibleText ? "--visible-text" : null,
    visibleTextGateMs > 0 ? `--visible-text-gate-ms=${visibleTextGateMs}` : null,
  ].filter(Boolean).map(shellQuote).join(" ");
  writeFileSync(
    command,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(agent)}${
      fixtureArgs ? ` ${fixtureArgs}` : ""
    } "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  chmodSync(command, 0o755);
  return command;
}

export function createCodexAcpE2ECommand(directory, {
  javascript = false,
  hang = false,
  pidFile = null,
  authRequired = false,
  visibleText = false,
  visibleTextGateMs = 0,
} = {}) {
  const command = path.join(directory, javascript ? "pageroot-codex-acp-e2e.mjs" : "pageroot-codex-acp-e2e");
  const agent = path.join(productRoot, "tests", "fixtures", "codex-acp-agent.mjs");
  const fixtureArgs = [
    hang ? "--hang" : null,
    pidFile ? `--pid-file=${pidFile}` : null,
    authRequired ? "--auth-required" : null,
    visibleText ? "--visible-text" : null,
    visibleTextGateMs > 0 ? `--visible-text-gate-ms=${visibleTextGateMs}` : null,
  ].filter(Boolean);
  const shellArgs = fixtureArgs.map(shellQuote).join(" ");
  writeFileSync(
    command,
    javascript
      ? `#!${process.execPath}\nprocess.argv.push(...${JSON.stringify(fixtureArgs)});\nawait import(${JSON.stringify(pathToFileURL(agent).href)});\n`
      : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(agent)}${
        shellArgs ? ` ${shellArgs}` : ""
      } "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  chmodSync(command, 0o755);
  return command;
}

export function startPagerootHttpAgent(options) {
  return startOpenAiCompatibleHttpAgent(options);
}

export function pagerootHttpAgentEnv(baseUrl) {
  return {
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: baseUrl,
  };
}

// The destination is chosen in the AI conversation now; the dialog over the page is gone.
// A specific change is reached by clicking its page marker. This keeps the E2E helper
// aligned with the review contract: markers locate changes, while the toolbar only
// controls filtering and view state.
// Qoder availability lives in the tabbed Settings page; About remains product-only.
export async function openAgentSettingsPage(page) {
  const sidebar = page.locator(".workbench-global-sidebar");
  if (await sidebar.getAttribute("data-open") !== "true") {
    await page.getByRole("button", { name: "展开左侧边栏" }).click();
  }
  await expect(sidebar).toHaveAttribute("data-open", "true");
  // Provider assertions start in Settings. Keyboard activation avoids making
  // this precondition depend on a moving sidebar's pointer hit target;
  // project-lifecycle tests retain real pointer navigation coverage.
  await sidebar.getByRole("button", { name: "设置", exact: true }).press("Enter");
  const settings = page.locator(".workbench-settings-page");
  await expect(settings).toBeVisible();
  await page.getByRole("button", { name: "AI 服务", exact: true }).click();
  return settings;
}

export async function openQoderAvailability(page) {
  const settings = await openAgentSettingsPage(page);
  const row = settings.getByTestId("settings-agent-row-qoder");
  await expect(row).toBeVisible();
  if (await row.getAttribute("data-expanded") !== "true") {
    await row.locator(".settings-agent-service-main").click();
  }
  const card = settings.locator(".qoder-availability-card").first();
  await expect(card).toBeVisible();
  return row;
}

export async function expandSettingsAgent(settings, providerId) {
  const row = settings.getByTestId(`settings-agent-row-${providerId}`);
  await expect(row).toBeVisible();
  if (await row.getAttribute("data-expanded") !== "true") {
    await row.locator(".settings-agent-service-main").click();
  }
  return row;
}

export async function setDefaultSettingsAgent(settings, providerId) {
  const action = settings.getByTestId(`settings-agent-row-action-${providerId}`);
  await expect(action).toHaveText("设为默认", { timeout: 60_000 });
  await action.click();
}

export async function closeQoderAvailability(page) {
  await page.getByRole("button", { name: "返回工作台" }).click();
}

export async function focusChangeById(page, frame, changeId) {
  const selector = `[data-pageroot-review-region-bar="${changeId}"]`;
  const candidates = [
    frame.locator(selector),
    page.frameLocator('iframe[title^="修改前"]').locator(selector),
    page.frameLocator('iframe[title^="修改后"]').locator(selector),
  ];
  let marker = candidates[0];
  for (const candidate of candidates) {
    if (await candidate.count() > 0 && await candidate.first().isVisible().catch(() => false)) {
      marker = candidate.first();
      break;
    }
  }
  await expect(marker).toBeVisible();
  await marker.click();
  await expect.poll(async () => frame.locator("html")
    .getAttribute("data-pageroot-review-focus")).toBe(changeId);
}

export async function chooseModifyIntent(page) {
  const sidebar = page.getByTestId("ai-conversation-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
  await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
  return sidebar;
}

export async function chooseClipboardDelivery(page) {
  const sidebar = await chooseModifyIntent(page);
  await sidebar.getByLabel("更多发送选项", { exact: true }).click();
  await sidebar.getByRole("button", { name: /复制给别的 AI/u }).click();
}


export function removeAiLoopUserData(isolatedUserData) {
  removeValidatedTemporaryDirectory(
    isolatedUserData,
    "pageroot-native-e2e-ai-loop-",
  );
}

export async function addCommentAndSubmit(
  page,
  electronApp,
  sourcePath,
  updatedText = UPDATED_TEXT,
  additionalComments = [],
) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  let activeSourcePath = await addComment(
    page,
    sourcePath,
    `只把这个列表项改为“${updatedText}”，其他地方保持不变。`,
  );
  for (const comment of additionalComments) {
    activeSourcePath = await addComment(
      page,
      activeSourcePath,
      comment.text,
      comment.targetCase,
      comment.targetSelector,
    );
  }
  const isolatedUserData = await electronApp.evaluate(({ app }) => app.getPath("userData"));
  const workspace = path.join(isolatedUserData, "workspace");
  const existingPromptPaths = new Set(requestPromptPaths(workspace));
  await page.getByRole("button", { name: /AI 助手/u }).click();
  await chooseClipboardDelivery(page);
  await expect(page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
    .toBeVisible();
  await expect(page.getByTestId("ai-conversation-run-progress"))
    .toContainText("等待你的 AI 完成修改");
  let promptPath = "";
  await expect.poll(async () => {
    const newPromptPaths = requestPromptPaths(workspace)
      .filter((candidate) => !existingPromptPaths.has(candidate));
    if (newPromptPaths.length === 1) {
      [promptPath] = newPromptPaths;
      return true;
    }
    if (newPromptPaths.length > 1) return false;
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    const match = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u);
    const copiedPromptPath = match?.[1] || "";
    promptPath = copiedPromptPath.startsWith(`${isolatedUserData}${path.sep}`)
      ? copiedPromptPath
      : "";
    return Boolean(promptPath && existsSync(promptPath));
  }, { timeout: 20_000 }).toBe(true);
  // The round is carried by the conversation now, not by a header button opening a panel.
  await expect(page.getByTestId("ai-conversation-run-progress")).toBeVisible();
  const requestRoot = path.dirname(promptPath);
  const changeRequest = JSON.parse(
    readFileSync(path.join(requestRoot, "change-request.json"), "utf8"),
  );
  expect(changeRequest.requirements.instructions).toHaveLength(
    1 + additionalComments.length,
  );
  expect(changeRequest.requirements.instructions.some(
    (instruction) => instruction.text.includes(updatedText),
  )).toBe(true);
  expect(changeRequest.requirements.scopePolicy)
    .toBe("targets-plus-required-dependencies");
  expect(changeRequest.requirements).not.toHaveProperty("preserveOutsideTargets");
  return { promptPath, requestRoot, changeRequest, sourcePath: activeSourcePath };
}

export async function addComment(page, sourcePath, text = (
  `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`
), targetCase = "list-item", targetSelector = "") {
  // Opening an external HTML immediately switches the active document to its
  // managed V1 Working Copy. Comments must target that authoritative file,
  // while the original source remains untouched.
  const active = await page.evaluate(
    () => window.htmlAIProjects?.getActiveProject(),
  );
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  // A fixed-slot Runtime promotion can finish between resolving a frame and
  // clicking it. Start the comment gesture only after the active slot is
  // stable, then resolve the current frame instead of retaining the retiring
  // iframe from the handoff.
  await expect(editor).not.toHaveAttribute(
    "data-runtime-handoff",
    /^(?:preparing|positioning|active)$/u,
    { timeout: 60_000 },
  );
  await loadedDiskFrame(page, active?.sourcePath || sourcePath);
  await page.keyboard.press("Escape");
  // Escape may end a pending edit boundary and start the latest Runtime
  // handoff. Resolve both the frame and target only after that handoff has
  // settled; a fixed physical slot is never proof that its Document is Active.
  // Runtime can replace the Active iframe after the handoff attribute clears.
  // Re-resolve the current frame until the native target actually receives the
  // click; a detached list item is not proof that commenting is unavailable.
  await expect(async () => {
    await expect(editor).not.toHaveAttribute(
      "data-runtime-handoff",
      /^(?:preparing|positioning|active)$/u,
      { timeout: 60_000 },
    );
    const current = await page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    const frame = await loadedDiskFrame(page, current?.sourcePath || sourcePath);
    const target = frame.locator(targetSelector || caseSelector(targetCase));
    await frame.locator("body").click({ position: { x: 2, y: 2 } });
    await target.scrollIntoViewIfNeeded();
    await target.click({ timeout: 8_000 });
  }).toPass({ timeout: 60_000, intervals: [250, 500, 1_000] });
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  const composer = page.getByRole("textbox", { name: "评论内容" });
  await composer.fill(text);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  // Saving the first comment may need the Bridge's bounded project/draft
  // authority recovery (two 15 s read attempts). Wait for the actual save
  // boundary and the resulting geometry authority instead of racing the
  // default 20 s assertion timeout against that recovery path.
  await expect(composer).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole("complementary", { name: "本轮评论" }))
    .toHaveAttribute("data-layout-ready", "true", { timeout: 45_000 });
  await expect(page.locator(".comment-card").filter({ hasText: text }))
    .toHaveCount(1);
  return (await page.evaluate(
    () => window.htmlAIProjects?.getActiveProject(),
  ))?.sourcePath || sourcePath;
}

export async function openRecentProject(page, sourcePath, options) {
  const visibleToast = page.locator(".toast.show");
  await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await visibleToast.isVisible()) {
    await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
    await expect(visibleToast).toBeHidden();
  }
  const activeBefore = await page.evaluate(
    async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
  );
  const startPage = page.locator(".workbench-start-page").filter({ visible: true }).first();
  if (!await startPage.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "新标签页" }).click();
  }
  await startPage.waitFor({ state: "visible" });
  const sidebar = page.locator(".workbench-global-sidebar");
  if (await sidebar.getAttribute("data-open") !== "true") {
    await page.getByRole("button", { name: "展开左侧边栏" }).click();
  }
  const projectName = path.basename(sourcePath, path.extname(sourcePath));
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
  await projectRow.locator("xpath=..").locator(".sidebar-version-file").first().click();
  await waitForProjectReady(page);
  await expect.poll(async () => {
    const active = await page.evaluate(
      async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
    );
    return active && active !== activeBefore ? active : "";
  }, { timeout: 30_000 }).not.toBe("");
  const activeSourcePath = await page.evaluate(
    async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
  );
  return loadedDiskFrame(page, activeSourcePath, options);
}

export function managedProjectRoots(workspace) {
  const projectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(projectsRoot)) return [];
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(projectsRoot, entry.name))
    .filter((projectRoot) => existsSync(path.join(projectRoot, ".pageroot", "project.json")));
}

export function managedProjectRootForId(workspace, projectId) {
  return managedProjectRoots(workspace).find((projectRoot) => {
    const project = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "project.json"),
      "utf8",
    ));
    return project.projectId === projectId;
  }) || null;
}

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
  return legacyCount + managedProjectRoots(workspace).reduce((total, projectRoot) => {
    const requestsRoot = path.join(projectRoot, ".pageroot", "requests");
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((name) => !name.startsWith(".")).length
        : 0
    );
  }, 0);
}

function requestPromptPaths(workspace) {
  const promptPaths = [];
  const projectsRoot = path.join(workspace, "projects");
  if (existsSync(projectsRoot)) {
    for (const projectDirectoryName of readdirSync(projectsRoot)) {
      const requestsRoot = path.join(
        projectsRoot,
        projectDirectoryName,
        "requests",
      );
      if (!existsSync(requestsRoot)) continue;
      for (const requestId of readdirSync(requestsRoot)) {
        const promptPath = path.join(requestsRoot, requestId, "PROMPT.md");
        if (existsSync(promptPath)) promptPaths.push(promptPath);
      }
    }
  }
  for (const projectRoot of managedProjectRoots(workspace)) {
    const requestsRoot = path.join(projectRoot, ".pageroot", "requests");
    if (!existsSync(requestsRoot)) continue;
    for (const requestId of readdirSync(requestsRoot)) {
      const promptPath = path.join(requestsRoot, requestId, "PROMPT.md");
      if (existsSync(promptPath)) promptPaths.push(promptPath);
    }
  }
  return promptPaths.sort();
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
  return managedProjectRoots(workspace).some((projectRoot) => {
    const draftsRoot = path.join(projectRoot, ".pageroot", "drafts");
    return existsSync(draftsRoot) && readdirSync(draftsRoot)
      .filter((name) => name.endsWith(".json"))
      .some((name) => {
        const draft = JSON.parse(readFileSync(path.join(draftsRoot, name), "utf8"));
        return Array.isArray(draft.comments)
          && draft.comments.some((comment) => comment.text === text);
      });
  });
}

export function rewriteWorkspaceDraftComment(workspace, text, update) {
  const projectsRoot = path.join(workspace, "projects");
  const draftPaths = existsSync(projectsRoot)
    ? readdirSync(projectsRoot).map((projectDirectoryName) => path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    ))
    : [];
  for (const projectRoot of managedProjectRoots(workspace)) {
    const draftsRoot = path.join(projectRoot, ".pageroot", "drafts");
    if (!existsSync(draftsRoot)) continue;
    for (const name of readdirSync(draftsRoot)) {
      if (name.endsWith(".json")) draftPaths.push(path.join(draftsRoot, name));
    }
  }
  for (const draftPath of draftPaths) {
    if (!existsSync(draftPath)) continue;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    const comment = Array.isArray(draft.comments)
      ? draft.comments.find((candidate) => candidate.text === text)
      : null;
    if (!comment) continue;
    update(comment);
    draft.draftRevision = Math.max(0, Number(draft.draftRevision) || 0) + 1;
    draft.updatedAt = new Date().toISOString();
    const draftBytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`, "utf8");
    const managedProjectRoot = managedProjectRoots(workspace).find((projectRoot) => (
      draftPath.startsWith(`${path.join(projectRoot, ".pageroot", "drafts")}${path.sep}`)
    ));
    if (managedProjectRoot) {
      const controlRoot = path.join(managedProjectRoot, ".pageroot");
      const manifest = JSON.parse(readFileSync(path.join(controlRoot, "manifest.json"), "utf8"));
      const workingCopy = manifest.workingCopies.find(
        (entry) => entry.workingCopyId === draft.workingCopyId,
      );
      if (!workingCopy?.stateRelativePath) return false;
      const statePath = path.join(
        controlRoot,
        ...String(workingCopy.stateRelativePath).split("/"),
      );
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      state.draftRevision = draft.draftRevision;
      state.draftSha256 = sha256(draftBytes);
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
    writeFileSync(draftPath, draftBytes);
    return true;
  }
  return false;
}

export function frozenAiOutputPath(requestRoot, changeRequest) {
  const legacyRelativePath = changeRequest.finalization?.outputRelativePath;
  if (typeof legacyRelativePath === "string" && legacyRelativePath.startsWith("output/")) {
    return path.join(
      requestRoot,
      "attempts",
      "attempt_001",
      ...legacyRelativePath.split("/"),
    );
  }
  const requestRecord = JSON.parse(readFileSync(
    path.join(requestRoot, "request.json"),
    "utf8",
  ));
  const outputRelativePath = requestRecord.outputRelativePath;
  const expectedPrefix = `requests/${changeRequest.requestId}/attempts/${changeRequest.attemptId}/output/`;
  if (
    typeof outputRelativePath !== "string"
    || !outputRelativePath.startsWith(expectedPrefix)
  ) {
    throw new Error("Request is missing its frozen AI output path.");
  }
  const controlRoot = path.dirname(path.dirname(requestRoot));
  const outputPath = path.resolve(controlRoot, ...outputRelativePath.split("/"));
  if (!outputPath.startsWith(`${controlRoot}${path.sep}`)) {
    throw new Error("Request output escaped its managed control directory.");
  }
  return outputPath;
}

export function writeAiOutput(requestRoot, transform) {
  const base = readFileSync(
    path.join(requestRoot, "input", "base", "index.html"),
    "utf8",
  );
  const output = transform(base);
  const changeRequest = JSON.parse(readFileSync(
    path.join(requestRoot, "change-request.json"),
    "utf8",
  ));
  const outputPath = frozenAiOutputPath(requestRoot, changeRequest);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, "utf8");
}

export function runOfficialFinalizer(requestRoot, changeRequest) {
  const command = changeRequest.finalization?.finalizerCommand
    || readFileSync(path.join(requestRoot, "PROMPT.md"), "utf8")
      .match(/```sh\s*\r?\n([^\r\n]+)\r?\n```/u)?.[1];
  if (!command) throw new Error("Request is missing its frozen finalizer command.");
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: requestRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Finalizer failed:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

export function workingHtmlFiles(workspace, projectId) {
  const legacyRegistryPath = path.join(workspace, "project-registry.json");
  if (existsSync(legacyRegistryPath)) {
    const registry = JSON.parse(readFileSync(legacyRegistryPath, "utf8"));
    const storageDirectoryName = registry.projects?.[projectId]?.storageDirectoryName;
    if (storageDirectoryName) {
      const directory = path.join(workspace, "projects", storageDirectoryName, "working");
      if (!existsSync(directory)) return [];
      return readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".html"))
        .map((fileName) => path.join(directory, fileName));
    }
  }

  const projectRoot = managedProjectRootForId(workspace, projectId);
  if (!projectRoot) return [];
  const manifest = JSON.parse(readFileSync(
    path.join(projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  return (Array.isArray(manifest.workingCopies) ? manifest.workingCopies : [])
    .map((workingCopy) => String(workingCopy.sourceRelativePath || ""))
    .filter((relativePath) => relativePath.endsWith(".html"))
    .map((relativePath) => path.join(projectRoot, relativePath))
    .filter((filePath) => existsSync(filePath));
}

export function candidateHtmlFiles(workspace, projectId) {
  const projectRoot = managedProjectRootForId(workspace, projectId);
  if (!projectRoot) return [];
  const requestsRoot = path.join(projectRoot, ".pageroot", "requests");
  if (!existsSync(requestsRoot)) return [];
  return readdirSync(requestsRoot)
    .filter((requestId) => !requestId.startsWith("."))
    .map((requestId) => path.join(requestsRoot, requestId, "candidate.html"))
    .filter((filePath) => existsSync(filePath));
}

export async function adoptReadyResult(page) {
  const review = page.getByRole("button", { name: "查看修改", exact: true });
  if (!await page.getByTestId("ai-review-workspace").isVisible()) await review.click();
  await page.getByRole("button", { name: "采用修改", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: /采纳 AI 修改后（.+）？/u,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "确认并采纳" }).click();
}

export const REVIEW_PROJECTION_CASES = Object.freeze([
  {
    id: "added-table-row",
    sourceFixture: "generated-ai-loop.html",
    filter: "all",
    pageMode: "split",
    contextPercent: "25",
    changeType: "structure",
    ownerSelector: '[data-review-brand-row="added"]',
    rangeSelector: null,
    expectedFrameCount: 1,
    expectedMaskCount: 1,
    tolerance: 0.75,
    negativeSelectors: [
      '[data-review-brand-row="alpha"] [data-pageroot-review-overlay-box]',
      '[data-review-brand-row="beta"] [data-pageroot-review-overlay-box]',
    ],
  },
]);

export async function assertReviewControlDefaults(
  page,
  beforeReviewFrame,
  expectedNavigationTarget,
) {
  await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
    "data-pageroot-review-filter",
  ), { timeout: 30_000 }).toBe("all");
  await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
    "data-pageroot-review-focus",
  )).toBe(expectedNavigationTarget);
  await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
    "data-pageroot-review-focus-group",
  )).toBe("");
  await expect(page.getByRole("slider", {
    name: "非修改区域上下文可见度",
  })).toHaveCount(0);
  await expect(page.locator('[data-view="split"]')).toBeVisible();
  await expect(page.getByRole("button", {
    name: "双页对比",
  })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "全部变化" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "原始大小", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(beforeReviewFrame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(0);
  await expect(beforeReviewFrame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(0);
  await expect(beforeReviewFrame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
  await expect.poll(async () => beforeReviewFrame.locator(
    "[data-pageroot-review-region-bar]",
  ).count(), { timeout: 30_000 }).toBeGreaterThan(0);
}

export async function assertReviewFocusPaint(beforeReviewFrame, afterReviewFrame) {
  // A selected region always owns navigation and a context mask. Its outline is
  // a separate paint decision, so text focus legitimately has no box.
  for (const frame of [beforeReviewFrame, afterReviewFrame]) {
    await expect.poll(async () => frame.locator("html").evaluate((html) => (
      !html.hasAttribute("data-pageroot-review-transitioning")
    )), { timeout: 30_000 }).toBe(true);
  }
  for (const frame of [beforeReviewFrame, afterReviewFrame]) {
    await expect.poll(
      async () => frame.locator("[data-pageroot-review-mask-hole]").count(),
      { timeout: 30_000 },
    ).toBe(1);
    expect(await frame.locator("[data-pageroot-review-overlay-box]").count()).toBeLessThanOrEqual(1);
  }
}

export async function assertProjectionGeometryCase(frame, geometryCase) {
  const ownerElement = frame.locator(geometryCase.ownerSelector);
  const owner = await ownerElement.getAttribute("data-pageroot-review-semantic-owner");
  expect(owner, `${geometryCase.id} must retain a semantic owner`).toBeTruthy();
  const focusGroupId = await ownerElement.evaluate((element) => {
    const changeId = element.getAttribute("data-pageroot-review-marker") || "";
    const facts = JSON.parse(
      element.getAttribute("data-pageroot-review-projection-facts") || "[]",
    );
    const fact = facts.find((candidate) => candidate.type === "structure") || facts[0];
    const displayGroupId = fact?.displayGroupId || `display-fact-${fact?.id || ""}`;
    return fact?.structureChange === "style"
      ? `focus-${displayGroupId}`
      : `focus-${changeId}-${displayGroupId}`;
  });
  const regionBar = frame.locator(
    `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${focusGroupId}"]`,
  ).first();
  const frames = frame.locator(
    `[data-pageroot-review-overlay-box][data-tone="${geometryCase.changeType}"][data-pageroot-review-semantic-owner="${owner}"]`,
  );
  const masks = frame.locator(
    `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${owner}"]`,
  );
  // Region bars activate one explicit region. Retrying while its asynchronous
  // state arrives is unnecessary; wait for the requested transition.
  const root = frame.locator("html");
  await expect(root).not.toHaveAttribute("data-pageroot-review-transitioning", /./);
  if (await root.getAttribute("data-pageroot-review-focus-group") !== focusGroupId) {
    await regionBar.click({ timeout: 8_000 });
  }
  await expect(root).toHaveAttribute("data-pageroot-review-focus-group", focusGroupId);
  await expect(root).not.toHaveAttribute("data-pageroot-review-transitioning", /./);
  await expect(frames).toHaveCount(geometryCase.expectedFrameCount);
  await expect(masks).toHaveCount(geometryCase.expectedMaskCount);
  await expect.poll(() => frames.evaluate((overlay, { ownerSelector, tolerance }) => {
    const owner = document.querySelector(ownerSelector);
    if (!owner) return false;
    const overlayRect = overlay.getBoundingClientRect();
    const ownerRect = owner.getBoundingClientRect();
    return Math.abs(overlayRect.left - (ownerRect.left - 3)) < tolerance
      && Math.abs(overlayRect.top - (ownerRect.top - 3)) < tolerance
      && Math.abs(overlayRect.width - (ownerRect.width + 6)) < tolerance
      && Math.abs(overlayRect.height - (ownerRect.height + 6)) < tolerance;
  }, geometryCase)).toBe(true);
  for (const selector of geometryCase.negativeSelectors) {
    await expect(frame.locator(selector)).toHaveCount(0);
  }
  return owner;
}

export async function assertActiveFocusPaintBudget(frame) {
  return frame.locator("html").evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")];
    const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")];
    const width = Math.max(innerWidth, document.documentElement.scrollWidth);
    const height = Math.max(innerHeight, document.documentElement.scrollHeight);
    const insideDocument = (element) => {
      const left = Number(element.getAttribute("data-left"));
      const top = Number(element.getAttribute("data-top"));
      const elementWidth = Number(element.getAttribute("data-width"));
      const elementHeight = Number(element.getAttribute("data-height"));
      return left >= 0 && top >= 0
        && left + elementWidth <= width
        && top + elementHeight <= height;
    };
    return holes.length === 1
      && boxes.length <= 1
      && holes.every(insideDocument)
      && boxes.every((box) => insideDocument(box) && holes.some((hole) => (
        box.getAttribute("data-pageroot-review-overlay-box")
        === hole.getAttribute("data-pageroot-review-mask-hole")
      && box.getAttribute("data-pageroot-review-semantic-owner")
        === hole.getAttribute("data-pageroot-review-semantic-owner")
      && box.getAttribute("data-pageroot-review-fact")
        === hole.getAttribute("data-pageroot-review-fact")
      && Math.abs(Number(box.getAttribute("data-left")) - Number(hole.getAttribute("data-left"))) < .02
      && Math.abs(Number(box.getAttribute("data-top")) - Number(hole.getAttribute("data-top"))) < .02
      && Math.abs(Number(box.getAttribute("data-width")) - Number(hole.getAttribute("data-width"))) < .02
      && Math.abs(Number(box.getAttribute("data-height")) - Number(hole.getAttribute("data-height"))) < .02
      && Boolean(box.getAttribute("data-path"))
      && box.getAttribute("data-path") === hole.getAttribute("d")
      )));
  });
}

export async function assertReviewHasNoRuntimeVisualSupplement(
  page,
  beforeReviewFrame,
  afterReviewFrame,
) {
  const reviewWorkspace = page.getByTestId("ai-review-workspace");
  await expect(reviewWorkspace).not.toHaveAttribute("data-review-runtime-visual-state", /.+/u);
  await expect(reviewWorkspace).not.toHaveAttribute("data-review-runtime-visual-delivery", /.+/u);
  for (const frame of [beforeReviewFrame, afterReviewFrame]) {
    await expect(frame.locator(
      "[data-pageroot-review-runtime-marker], [data-pageroot-review-runtime-host], [data-pageroot-review-runtime-source-box]",
    )).toHaveCount(0);
  }
}

export async function assertReviewAcceptPersistence({
  page,
  sourcePath,
  original,
  expectedText,
  versionPathPattern,
}) {
  await expect.poll(async () => page.evaluate(async () => {
    const project = await window.htmlAIProjects?.getActiveProject();
    const reviewVisible = Boolean(document.querySelector('[data-testid="ai-review-workspace"]'));
    return { sourcePath: project?.sourcePath || "", reviewVisible };
  }), { timeout: 30_000 }).toMatchObject({
    sourcePath: expect.stringMatching(versionPathPattern),
    reviewVisible: false,
  });
  const opened = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
  expect(opened.sourcePath).not.toBe(sourcePath);
  expect(opened.sourcePath).toMatch(versionPathPattern);
  expect(readFileSync(sourcePath).equals(original)).toBe(true);
  expect(readFileSync(opened.sourcePath, "utf8")).toContain(expectedText);
  return opened;
}
