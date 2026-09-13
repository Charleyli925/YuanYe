import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  buildSourceIndex,
} from "../../../app/lib/source-patch-core.js";
import {
  normalizeEditableIslandHtml,
} from "../../../app/lib/editable-island.js";
import {
  materializeSourceElementIdentity,
} from "../../../bridge/project-file-repository/working-copy.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const productRoot = path.resolve(currentDirectory, "../../..");
export const fixtureRoot = path.join(productRoot, "tests/fixtures/native-dom");

export function fixturePath(name) {
  if (!/^[a-z0-9][a-z0-9.-]*\.html$/i.test(name)) {
    throw new TypeError(`Unsafe native DOM fixture name: ${name}`);
  }
  return path.join(fixtureRoot, name);
}

export function fixtureBuffer(name) {
  return readFileSync(fixturePath(name));
}

export function loadCaseManifest() {
  return JSON.parse(readFileSync(path.join(fixtureRoot, "cases.json"), "utf8"));
}

export function identifiedHtmlBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  return Buffer.from(materializeSourceElementIdentity(text).html, "utf8");
}

export function withBomAndCrLf(buffer) {
  const source = buffer.toString("utf8").replace(/\r?\n/g, "\r\n");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source, "utf8")]);
}

function pageForFrame(frameOrPage) {
  if (frameOrPage && typeof frameOrPage.mainFrame === "function") return frameOrPage;
  if (frameOrPage && typeof frameOrPage.page === "function") return frameOrPage.page();
  throw new TypeError("Expected a Playwright Page or PageRoot edit Frame.");
}

async function dismissCanvasToolbar(page) {
  const toolbar = page.getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('[role="toolbar"]');
  // Escape exits native text editing first, then clears the leftover block
  // selection. One press is not enough when the toolbar flipped below the
  // previous host and covers the next census target.
  for (let step = 0; step < 2; step += 1) {
    if (!await toolbar.isVisible().catch(() => false)) return;
    await page.keyboard.press("Escape");
  }
  await toolbar.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
}

export function currentEditorIframe(frameOrPage) {
  const page = pageForFrame(frameOrPage);
  return page
    .getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('iframe[title*="HTML"]');
}

export async function currentEditorFrame(frameOrPage) {
  const page = pageForFrame(frameOrPage);
  const iframe = currentEditorIframe(page);
  await iframe.waitFor({ state: "attached" });

  // A source-authority fence deliberately replaces the iframe element. The locator is
  // resilient to that replacement, while an ElementHandle/Frame is not. A
  // short retry closes the tiny gap between resolving the current element and
  // Chromium exposing its new same-origin browsing context.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const iframeHandle = await iframe.elementHandle();
    const frame = await iframeHandle?.contentFrame();
    if (frame && !frame.isDetached()) return frame;
    await page.waitForTimeout(10);
  }
  throw new Error("PageRoot edit iframe did not expose a current same-origin Frame.");
}

export function currentNativeTarget(frameOrPage, id) {
  return currentEditorIframe(frameOrPage).contentFrame().locator(caseSelector(id));
}

function resilientEditorFrame(page) {
  const runInCurrentFrame = async (operation) => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const frame = await currentEditorFrame(page);
      try {
        return await operation(frame);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const wasReplaced = frame.isDetached()
          || /detached|Execution context was destroyed|Cannot find context/i.test(message);
        if (!wasReplaced) throw error;
      }
    }
    throw lastError || new Error("PageRoot edit Frame was repeatedly replaced.");
  };

  return {
    page: () => page,
    locator: (selector, options) => (
      currentEditorIframe(page).contentFrame().locator(selector, options)
    ),
    evaluate: (pageFunction, arg) => (
      runInCurrentFrame((frame) => frame.evaluate(pageFunction, arg))
    ),
    waitForFunction: (pageFunction, arg, options) => (
      runInCurrentFrame((frame) => frame.waitForFunction(pageFunction, arg, options))
    ),
    frameElement: () => runInCurrentFrame((frame) => frame.frameElement()),
  };
}

function rendererHarnessProject(name, buffer) {
  const html = buffer.toString("utf8");
  const sourceSha256 = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  const identity = sourceSha256.slice("sha256:".length);
  return {
    openKind: "project",
    name,
    sourcePath: null,
    html,
    sha256: sourceSha256,
    projectId: `project_renderer_${identity}`,
    documentId: `doc_renderer_${identity}`,
  };
}

export async function ensureDesktopRendererTestHarness(page, initialProject = null) {
  const hasDesktopHost = await page.evaluate(() => (
    window.__PAGEROOT_RENDERER_TEST_HARNESS__?.kind === "desktop-preload"
    || (
      window.htmlAIRuntime?.capabilities?.projectOpening === "desktop-dialog"
      && typeof window.htmlAIProjects?.openHtml === "function"
    )
  ));
  if (hasDesktopHost) return;

  await page.addInitScript((startupProject) => {
    const state = {
      kind: "desktop-preload",
      activeProject: startupProject,
      openQueue: [],
      previewUrls: new Map(),
    };
    Object.defineProperty(window, "__PAGEROOT_RENDERER_TEST_HARNESS__", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(window, "htmlAIRuntime", {
      configurable: true,
      value: {
        bridgePort: "1",
        bridgeAuthToken: "renderer-harness-desktop-token-00000001",
        appVersion: "0.0.0-test",
        getBridgeConnection: () => ({
          bridgePort: "1",
          bridgeAuthToken: "renderer-harness-desktop-token-00000001",
          appVersion: "0.0.0-test",
        }),
        capabilities: {
          sourceEditing: "enabled",
          projectOpening: "desktop-dialog",
          attachmentPersistence: "bridge",
          closeCoordination: "electron-handshake",
          interactivePreview: "independent-url",
        },
      },
    });
    Object.defineProperty(window, "htmlAIProjects", {
      configurable: true,
      value: {
        getActiveProject: async () => state.activeProject,
        openHtml: async () => {
          const project = state.openQueue.shift() || null;
          if (project) state.activeProject = project;
          return project;
        },
        openRecent: async () => null,
        listRecentProjects: async () => [],
        listRegisteredProjects: async () => [],
      },
    });
    Object.defineProperty(window, "htmlAIPreview", {
      configurable: true,
      value: {
        createSession: async ({ html, bootstrapJavaScript }) => {
          const sessionId = crypto.randomUUID();
          const documentHtml = String(html).replace(
            /<\/body\s*>/iu,
            `<script>${bootstrapJavaScript}<\/script></body>`,
          );
          const url = URL.createObjectURL(new Blob([documentHtml], { type: "text/html" }));
          state.previewUrls.set(sessionId, url);
          return { sessionId, url };
        },
        revokeSession: async (sessionId) => {
          const url = state.previewUrls.get(sessionId);
          if (url) URL.revokeObjectURL(url);
          state.previewUrls.delete(sessionId);
          return { revoked: Boolean(url) };
        },
      },
    });
    Object.defineProperty(window, "htmlAIAppLifecycle", {
      configurable: true,
      value: {
        onPrepareClose: () => () => {},
        onCloseAborted: () => () => {},
        reportReady: async () => ({ accepted: true }),
        reportBlocked: async () => ({ accepted: true }),
      },
    });
  }, initialProject);
  if (page.url() !== "about:blank") await page.reload();
}

const FIXTURE_OPEN_ATTEMPTS = 3;
const FIXTURE_OPEN_ATTEMPT_TIMEOUT = 18_000;

async function openFixtureThroughDesktopHarness({
  page,
  editor,
  name,
  buffer,
}) {
  const fixtureTitle = page.getByRole("tab", { name, exact: true });
  let lastError;

  for (let attempt = 1; attempt <= FIXTURE_OPEN_ATTEMPTS; attempt += 1) {
    if (await editor.isVisible().catch(() => false)) {
      await expect(editor).toHaveAttribute("data-render-verified", "true");
    }
    const project = rendererHarnessProject(name, buffer);
    await page.evaluate((queuedProject) => {
      const harness = window.__PAGEROOT_RENDERER_TEST_HARNESS__;
      if (!harness || harness.kind !== "desktop-preload") {
        throw new Error("Desktop Renderer Test Harness is unavailable.");
      }
      harness.openQueue.push(queuedProject);
    }, project);
    const startCreateProject = page.locator(".workbench-start-page")
      .getByRole("button", { name: "新建项目", exact: true })
      .first();
    if (await startCreateProject.isVisible().catch(() => false)) {
      await startCreateProject.click();
    } else {
      const expandSidebar = page.getByRole("button", {
        name: "展开左侧边栏",
        exact: true,
      });
      if (await expandSidebar.isVisible().catch(() => false)) {
        await expandSidebar.click();
      }
      await page.locator(".workbench-global-sidebar")
        .getByRole("button", { name: "新建项目", exact: true })
        .click();
    }
    try {
      await fixtureTitle.waitFor({
        state: "visible",
        timeout: FIXTURE_OPEN_ATTEMPT_TIMEOUT,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === FIXTURE_OPEN_ATTEMPTS) break;

      // The renderer harness uses the real Desktop open command and the same
      // switch fence. Re-prove the old canvas before one bounded re-submission
      // if a just-launched editor was still finishing its first verification.
      if (await editor.isVisible().catch(() => false)) {
        await expect(editor).toHaveAttribute("data-render-verified", "true");
      }
    }
  }

  const currentTitle = await page.locator(
    '.workbench-tab[data-selected="true"] button[role="tab"] > span:last-child',
  )
    .textContent()
    .catch(() => "");
  throw new Error(
    `PageRoot did not open fixture ${JSON.stringify(name)} after ${FIXTURE_OPEN_ATTEMPTS} bounded submissions; current title: ${JSON.stringify(currentTitle?.trim() || "")}.`,
    { cause: lastError },
  );
}

export async function loadFixture(
  page,
  name,
  {
    buffer = fixtureBuffer(name),
    identifiedWorkingCopy,
    requireComplete = true,
    requireNativeCase = true,
  } = {},
) {
  const startingFromBlankPage = page.url() === "about:blank";
  const identifyWorkingCopy = identifiedWorkingCopy ?? requireComplete;
  const sourceBuffer = identifyWorkingCopy
    ? Buffer.from(materializeSourceElementIdentity(buffer.toString("utf8")).html, "utf8")
    : buffer;
  const host = await page.evaluate(() => ({
    harness: window.__PAGEROOT_RENDERER_TEST_HARNESS__?.kind === "desktop-preload",
    desktop: window.htmlAIRuntime?.capabilities?.projectOpening === "desktop-dialog"
      && typeof window.htmlAIProjects?.openHtml === "function",
  }));
  // Fast browser tests exercise the Renderer through a simulated Desktop
  // preload boundary. They do not expose or validate a second Browser product.
  await ensureDesktopRendererTestHarness(
    page,
    host.harness || host.desktop ? null : rendererHarnessProject(name, sourceBuffer),
  );
  if (startingFromBlankPage) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  if (host.harness) {
    await openFixtureThroughDesktopHarness({
      page,
      editor,
      name,
      buffer: sourceBuffer,
    });
  }

  await editor.waitFor({ state: "visible" });
  await expect(editor).toHaveAttribute("data-render-verified", "true");

  const iframe = editor.locator('iframe[title*="HTML"]');
  await iframe.waitFor({ state: "visible" });
  const initialFrame = await currentEditorFrame(page);
  await initialFrame.waitForFunction((complete) => (
    complete ? document.readyState === "complete" : document.readyState !== "loading"
  ), requireComplete);
  if (requireNativeCase) {
    await initialFrame.waitForFunction(() => Boolean(document.querySelector("[data-native-case]")));
  }
  return { editor, iframe, frame: resilientEditorFrame(page), source: sourceBuffer };
}

export function caseSelector(id) {
  return `[data-native-case=${JSON.stringify(id)}]`;
}

export async function documentToken(frameOrPage) {
  return currentEditorIframe(frameOrPage).evaluate((frameElement) => {
    const key = "__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__";
    const view = frameElement.contentWindow;
    if (!view) throw new Error("PageRoot edit iframe has no active window.");
    if (!view[key]) view[key] = crypto.randomUUID();
    return view[key];
  });
}

export async function geometrySnapshot(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const parentRect = target.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(target);
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      parentRect: parentRect ? {
        x: parentRect.x,
        y: parentRect.y,
        width: parentRect.width,
        height: parentRect.height,
      } : null,
      parentScroll: target.parentElement ? {
        left: target.parentElement.scrollLeft,
        top: target.parentElement.scrollTop,
      } : null,
      scroll: {
        left: target.scrollLeft,
        top: target.scrollTop,
        width: target.scrollWidth,
        height: target.scrollHeight,
      },
      style: {
        display: style.display,
        position: style.position,
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        whiteSpace: style.whiteSpace,
        writingMode: style.writingMode,
        direction: style.direction,
        transform: style.transform,
      },
    };
  });
}

export async function doubleClickRenderedText(frame, id, position) {
  await dismissCanvasToolbar(pageForFrame(frame));
  // Playwright's pointer retry sleeps inside the target iframe. In a
  // scripts-disabled frame that timer can stall after a layout transition
  // makes its first stability check fail. Wait in the host realm, without
  // changing sandbox permissions or bypassing pointer actionability.
  await currentEditorIframe(frame).evaluate(async (iframe) => {
    const running = () => {
      const animations = [];
      for (let node = iframe; node; node = node.parentElement)
        animations.push(...node.getAnimations().filter(animation => animation.playState === "running"
          && Number.isFinite(animation.effect?.getComputedTiming().endTime)));
      return animations;
    };
    for (let animations = running(); animations.length; animations = running()) {
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    }
  });
  const target = currentNativeTarget(frame, id);
  const textPosition = position || await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = /\S/u.exec(node.data);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const glyphRect = range.getClientRects()[0];
      const elementRect = element.getBoundingClientRect();
      const isVertical = getComputedStyle(element).writingMode.startsWith("vertical");
      // Chromium on Linux can report a zero-sized inline axis for a valid
      // vertical-writing glyph. The other axis still identifies a real hit
      // target, so pad only the missing axis instead of rejecting the glyph.
      if (!glyphRect || (!glyphRect.width && !glyphRect.height)) continue;
      let glyphOffsetX = 1;
      if (glyphRect.width) {
        glyphOffsetX = Math.min(glyphRect.width / 2, 3);
        if (isVertical) glyphOffsetX = glyphRect.width / 2;
      }
      return {
        x: glyphRect.left - elementRect.left + glyphOffsetX,
        y: glyphRect.top - elementRect.top
          + (glyphRect.height ? glyphRect.height / 2 : 1),
      };
    }
    throw new Error(`No rendered text glyph found for native edit case ${element.getAttribute("data-native-case")}.`);
  });
  await target.dblclick({ position: textPosition });
  return target;
}

export async function activateNativeEdit(frame, id, position) {
  const target = await doubleClickRenderedText(frame, id, position);
  try {
    await currentEditorFrame(frame).then((currentFrame) => currentFrame.waitForFunction((caseId) => {
      const expected = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
      return ["plaintext-only", "true"].includes(
        expected?.getAttribute("contenteditable"),
      )
        && document.activeElement === expected
        && expected.isContentEditable;
    }, id, { timeout: 7_000 }));
  } catch (cause) {
    const page = pageForFrame(frame);
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    throw new Error(
      `Native edit ${id} did not activate. status=${await editor.getAttribute("data-native-start-status")} `
      + `capability=${await editor.getAttribute("data-native-capability-detail")} `
      + `block=${await editor.getAttribute("data-edit-block-detail")}`,
      { cause },
    );
  }
  return target;
}

export async function nativeEditingState(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const active = document.activeElement;
    const selection = document.getSelection();
    return {
      targetIsActive: active === target,
      contenteditable: target.getAttribute("contenteditable"),
      isContentEditable: target.isContentEditable,
      activeCase: active instanceof Element ? active.getAttribute("data-native-case") : null,
      activeIsLegacySurface: Boolean(active?.closest?.("[data-html-canvas-text-flow-surface]")),
      legacySurfaceCount: document.querySelectorAll("[data-html-canvas-text-flow-surface]").length,
      authoredNodeHidden: getComputedStyle(target).visibility === "hidden"
        || getComputedStyle(target).display === "none",
      selectionInside: Boolean(
        selection?.anchorNode
        && target.contains(selection.anchorNode.nodeType === Node.TEXT_NODE
          ? selection.anchorNode.parentNode
          : selection.anchorNode),
      ),
    };
  });
}

export async function waitForResumedNativeSession(frame, id) {
  await expect.poll(() => nativeEditingState(frame, id)).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    isContentEditable: true,
    activeCase: id,
    selectionInside: true,
  });
}

export async function selectionSnapshot(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { rangeCount: 0, text: "", collapsed: true };
    }

    const linearOffset = (node, offset) => {
      if (!node || !target.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node)) {
        return null;
      }
      const probe = document.createRange();
      probe.selectNodeContents(target);
      probe.setEnd(node, offset);
      return probe.toString().length;
    };
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    const anchorOffset = linearOffset(selection.anchorNode, selection.anchorOffset);
    const focusOffset = linearOffset(selection.focusNode, selection.focusOffset);
    const nativeDirection = selection.direction || null;
    return {
      rangeCount: selection.rangeCount,
      text: selection.toString(),
      collapsed: selection.isCollapsed,
      anchorOffset,
      focusOffset,
      direction: nativeDirection && nativeDirection !== "none"
        ? nativeDirection
        : anchorOffset !== null && focusOffset !== null && anchorOffset > focusOffset
          ? "backward"
          : anchorOffset !== focusOffset ? "forward" : "none",
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      activeCase: document.activeElement?.getAttribute?.("data-native-case") || null,
    };
  });
}

export async function setTextSelection(frameOrPage, id, start, end = start) {
  const page = pageForFrame(frameOrPage);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const frame = await currentEditorFrame(page);
    try {
      return await frame.locator(caseSelector(id)).evaluate((target, offsets) => {
        const textNodes = [];
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
        const totalLength = textNodes.reduce((sum, node) => sum + node.data.length, 0);
        if (offsets.start < 0 || offsets.end < offsets.start || offsets.end > totalLength) {
          throw new RangeError(`Selection ${offsets.start}:${offsets.end} exceeds ${totalLength}.`);
        }
        const pointAt = (absoluteOffset) => {
          let consumed = 0;
          for (const node of textNodes) {
            const next = consumed + node.data.length;
            if (absoluteOffset <= next) return [node, absoluteOffset - consumed];
            consumed = next;
          }
          const last = textNodes.at(-1);
          return [last, last?.data.length || 0];
        };
        const [startNode, startOffset] = pointAt(offsets.start);
        const [endNode, endOffset] = pointAt(offsets.end);
        if (!startNode || !endNode) throw new Error("Editable case has no text nodes.");
        target.focus({ preventScroll: true });
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      }, { start, end });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !frame.isDetached()
        && !/detached|Execution context was destroyed|Cannot find context/iu.test(message)
      ) throw error;
    }
  }
  throw lastError ?? new Error("Unable to set selection in the current edit frame.");
}

export async function clickTextPosition(frame, id, position) {
  if (!["start", "middle", "end"].includes(position)) {
    throw new TypeError(`Unknown text click position: ${position}`);
  }
  const target = currentNativeTarget(frame, id);
  const point = await target.evaluate((element, requestedPosition) => {
    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data.length > 0) textNodes.push(node);
    }
    const length = textNodes.reduce((total, node) => total + node.data.length, 0);
    if (length === 0) throw new Error("Editable case has no visible text glyphs.");
    const characterIndex = requestedPosition === "start"
      ? 0
      : requestedPosition === "end"
        ? length - 1
        : Math.floor((length - 1) / 2);
    let consumed = 0;
    let textNode = textNodes[0];
    let localOffset = 0;
    for (const candidate of textNodes) {
      if (characterIndex < consumed + candidate.data.length) {
        textNode = candidate;
        localOffset = characterIndex - consumed;
        break;
      }
      consumed += candidate.data.length;
    }
    const range = document.createRange();
    range.setStart(textNode, localOffset);
    range.setEnd(textNode, localOffset + 1);
    const glyphRect = range.getClientRects()[0] || range.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const horizontalBias = requestedPosition === "start"
      ? 0.15
      : requestedPosition === "end" ? 0.85 : 0.5;
    return {
      x: glyphRect.left - targetRect.left + glyphRect.width * horizontalBias,
      y: glyphRect.top - targetRect.top + glyphRect.height / 2,
    };
  }, position);
  await target.click({ position: point });
  return selectionSnapshot(frame, id);
}

export async function reverseTextSelection(frame, id, start, end) {
  return currentNativeTarget(frame, id).evaluate((target, offsets) => {
    const textNodes = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
    const pointAt = (absoluteOffset) => {
      let consumed = 0;
      for (const node of textNodes) {
        if (absoluteOffset <= consumed + node.data.length) {
          return [node, absoluteOffset - consumed];
        }
        consumed += node.data.length;
      }
      throw new RangeError("Reverse selection offset is outside the case text.");
    };
    const [startNode, startOffset] = pointAt(offsets.start);
    const [endNode, endOffset] = pointAt(offsets.end);
    target.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.setBaseAndExtent(endNode, endOffset, startNode, startOffset);
    return selection.toString();
  }, { start, end });
}

export async function installInputRecorder(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => {
    frameElement.__PAGEROOT_NATIVE_QA_MUTATION_OBSERVER__?.disconnect();
    const events = [];
    let sequence = 0;
    const documentNode = frameElement.contentDocument;
    const view = frameElement.contentWindow;
    const caseForNode = (node) => {
      const element = node?.nodeType === view.Node.ELEMENT_NODE
        ? node
        : node?.parentElement;
      return element?.closest?.("[data-native-case]") || null;
    };
    const selectionState = (host) => {
      const selection = documentNode.getSelection();
      if (
        !host
        || !selection
        || selection.rangeCount !== 1
        || !selection.anchorNode
        || !selection.focusNode
        || !host.contains(selection.anchorNode)
        || !host.contains(selection.focusNode)
      ) return null;
      const logicalOffset = (node, offset) => {
        const range = documentNode.createRange();
        range.selectNodeContents(host);
        try {
          range.setEnd(node, offset);
        } catch {
          return null;
        }
        return range.toString().length;
      };
      const range = selection.getRangeAt(0);
      const collapsed = selection.isCollapsed;
      const anchor = logicalOffset(selection.anchorNode, selection.anchorOffset);
      const focus = logicalOffset(selection.focusNode, selection.focusOffset);
      const direction = collapsed
        ? "none"
        : selection.anchorNode === range.startContainer
          && selection.anchorOffset === range.startOffset
          ? "forward"
          : "backward";
      return {
        anchor,
        focus,
        direction,
        collapsed,
        text: selection.toString(),
      };
    };
    const snapshot = (host) => ({
      activeCase: caseForNode(documentNode.activeElement)?.getAttribute("data-native-case") || null,
      selection: selectionState(host),
      innerHTML: host?.innerHTML ?? null,
      textContent: host?.textContent ?? null,
    });
    const record = (event) => {
      const host = caseForNode(event.target) || caseForNode(documentNode.activeElement);
      const entry = {
        sequence: ++sequence,
        type: event.type,
        key: typeof event.key === "string" ? event.key : null,
        code: typeof event.code === "string" ? event.code : null,
        inputType: event.inputType || null,
        data: typeof event.data === "string" ? event.data : null,
        isComposing: Boolean(event.isComposing),
        isTrusted: event.isTrusted,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
        targetCase: host?.getAttribute("data-native-case") || null,
        targetRangeCount: typeof event.getTargetRanges === "function"
          ? event.getTargetRanges().length
          : null,
        ...snapshot(host),
      };
      events.push(entry);
      // The recorder is attached at document capture so it can see the exact
      // platform event before PageRoot handles it. Refresh this one field in a
      // microtask so diagnostics also preserve the final preventDefault state.
      view.queueMicrotask(() => {
        entry.defaultPrevented = event.defaultPrevented;
      });
    };
    for (const type of [
      "keydown",
      "keyup",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "paste",
      "cut",
      "focusin",
      "focusout",
      "selectionchange",
    ]) frameElement.contentDocument.addEventListener(type, record, true);
    const mutationObserver = new view.MutationObserver((records) => {
      const relevant = records.filter((mutation) => (
        Boolean(caseForNode(mutation.target))
        || Array.from(mutation.addedNodes).some((node) => Boolean(caseForNode(node)))
        || Array.from(mutation.removedNodes).some((node) => Boolean(caseForNode(node)))
      ));
      if (relevant.length === 0) return;
      const host = caseForNode(relevant[0].target)
        || relevant.flatMap((mutation) => Array.from(mutation.addedNodes))
          .map(caseForNode)
          .find(Boolean)
        || caseForNode(documentNode.activeElement);
      events.push({
        sequence: ++sequence,
        type: "mutation",
        targetCase: host?.getAttribute("data-native-case") || null,
        mutations: relevant.map((mutation) => ({
          type: mutation.type,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
          added: Array.from(mutation.addedNodes).map((node) => (
            node.nodeType === view.Node.TEXT_NODE
              ? `#text:${node.data}`
              : node.nodeName.toLowerCase()
          )),
          removed: Array.from(mutation.removedNodes).map((node) => (
            node.nodeType === view.Node.TEXT_NODE
              ? `#text:${node.data}`
              : node.nodeName.toLowerCase()
          )),
        })),
        ...snapshot(host),
      });
    });
    mutationObserver.observe(documentNode.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeOldValue: true,
    });
    frameElement.__PAGEROOT_NATIVE_QA_INPUT_EVENTS__ = events;
    frameElement.__PAGEROOT_NATIVE_QA_MUTATION_OBSERVER__ = mutationObserver;
  });
}

export async function recordedInputEvents(frame) {
  const iframe = await frame.frameElement();
  return iframe.evaluate(
    (frameElement) => frameElement.__PAGEROOT_NATIVE_QA_INPUT_EVENTS__ || [],
  );
}

export async function installLongTaskRecorder(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => {
    const durations = [];
    const FramePerformanceObserver = frameElement.contentWindow.PerformanceObserver;
    const observer = new FramePerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    frameElement.__PAGEROOT_NATIVE_QA_LONG_TASKS__ = durations;
    frameElement.__PAGEROOT_NATIVE_QA_LONG_TASK_OBSERVER__ = observer;
  });
}

export async function recordedLongTasks(frame) {
  const iframe = await frame.frameElement();
  return iframe.evaluate(
    (frameElement) => frameElement.__PAGEROOT_NATIVE_QA_LONG_TASKS__ || [],
  );
}

export async function waitForFramePaint(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => new Promise((resolve) => {
    const view = frameElement.ownerDocument.defaultView;
    view.requestAnimationFrame(() => view.requestAnimationFrame(resolve));
  }));
}

export async function dragSelection(page, frame, id, { from = 0.12, to = 0.88 } = {}) {
  const box = await currentNativeTarget(frame, id).boundingBox();
  if (!box) throw new Error(`Cannot drag-select invisible case ${id}.`);
  const y = box.y + Math.min(box.height / 2, 22);
  const startX = box.x + box.width * from;
  const endX = box.x + box.width * to;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: startX,
      y,
      button: "none",
      buttons: 0,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: startX,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    // Chromium can keep drag-selection moves pending until it receives the
    // release. Queue the gesture before awaiting the protocol responses.
    const moves = [];
    for (let step = 1; step <= 4; step += 1) {
      moves.push(cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: startX + ((endX - startX) * step) / 4,
        y,
        button: "left",
        buttons: 1,
      }));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const release = cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: endX,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await Promise.all([...moves, release]);
  } finally {
    await cdp.detach();
  }
  return selectionSnapshot(frame, id);
}

export function keyShortcut(key) {
  return `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
}

export async function requestExportCurrentHtml(page, shortcut = keyShortcut("Shift+E")) {
  await page.keyboard.press(shortcut);
}

export async function exportCurrentHtml(page, shortcut) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    requestExportCurrentHtml(page, shortcut),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function replaceEditableIslandTextByCase(source, caseId, beforeText, afterText) {
  const beforeInnerHtml = editableIslandInnerHtml(source, caseId);
  const first = beforeInnerHtml.indexOf(beforeText);
  if (first < 0 || beforeInnerHtml.indexOf(beforeText, first + beforeText.length) >= 0) {
    throw new Error(
      `Editable island oracle token must occur exactly once inside ${caseId}: ${beforeText}`,
    );
  }
  return replaceEditableIslandBytes(
    source,
    caseId,
    beforeInnerHtml.slice(0, first)
      + afterText
      + beforeInnerHtml.slice(first + beforeText.length),
  );
}

export function replaceUniqueBytes(source, beforeText, afterText) {
  const before = Buffer.from(beforeText, "utf8");
  const after = Buffer.from(afterText, "utf8");
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + before.length) >= 0) {
    throw new Error(`Byte oracle token must occur exactly once: ${beforeText}`);
  }
  return Buffer.concat([
    source.subarray(0, start),
    after,
    source.subarray(start + before.length),
  ]);
}

export function editableIslandInnerHtml(source, caseId) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const sourceText = buffer.toString("utf8");
  const index = buildSourceIndex(sourceText);
  const element = index.elements.find((candidate) => (
    candidate.stableAttributes?.["data-native-case"] === caseId
  ));
  if (!element) {
    throw new Error(`Editable island fixture target is missing: ${caseId}`);
  }
  return sourceText.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
}

export function replaceEditableIslandBytes(source, caseId, nextInnerHtml) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const sourceText = buffer.toString("utf8");
  const beforeInnerHtml = editableIslandInnerHtml(sourceText, caseId);
  const index = buildSourceIndex(sourceText);
  const element = index.elements.find((candidate) => (
    candidate.stableAttributes?.["data-native-case"] === caseId
  ));
  const normalized = normalizeEditableIslandHtml(nextInnerHtml, {
    baselineInnerHtml: beforeInnerHtml,
  });
  return Buffer.from(
    sourceText.slice(0, element.contentRange.startOffset)
      + normalized
      + sourceText.slice(element.contentRange.endOffset),
    "utf8",
  );
}

export function replaceEditableIslandTextBytes(
  source,
  sourceNodeId,
  beforeText,
  afterText,
) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const sourceText = buffer.toString("utf8");
  const index = buildSourceIndex(sourceText);
  const element = index.byPagerootId.get(sourceNodeId)
    ?? index.byNodeId.get(sourceNodeId);
  if (!element || element.type !== "element") {
    throw new Error(`Editable island source element is missing: ${sourceNodeId}`);
  }
  const beforeInnerHtml = sourceText.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  const first = beforeInnerHtml.indexOf(beforeText);
  if (first < 0 || beforeInnerHtml.indexOf(beforeText, first + beforeText.length) >= 0) {
    throw new Error(
      `Editable island oracle token must occur exactly once inside ${sourceNodeId}: ${beforeText}`,
    );
  }
  const nextInnerHtml = beforeInnerHtml.slice(0, first)
    + afterText
    + beforeInnerHtml.slice(first + beforeText.length);
  const normalized = normalizeEditableIslandHtml(nextInnerHtml, {
    baselineInnerHtml: beforeInnerHtml,
  });
  return Buffer.from(
    sourceText.slice(0, element.contentRange.startOffset)
      + normalized
      + sourceText.slice(element.contentRange.endOffset),
    "utf8",
  );
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readDownloadPath(downloadPath) {
  const chunks = [];
  for await (const chunk of createReadStream(downloadPath)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
