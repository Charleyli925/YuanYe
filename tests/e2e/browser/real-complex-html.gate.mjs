import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSourceIndex,
  createTargetRef,
} from "../../../app/lib/source-patch-core.js";
import {
  isEditableIslandTarget,
} from "../../../app/lib/editable-island.js";
import {
  currentEditorFrame,
  documentToken,
  exportCurrentHtml,
  identifiedHtmlBuffer,
  loadFixture,
  replaceEditableIslandTextBytes,
  sha256,
} from "./pageroot-driver.mjs";

const repositoryRealHtmlPath = fileURLToPath(
  new URL("../../fixtures/native-dom/complex-layout.html", import.meta.url),
);
const realHtmlPath = process.env.PAGEROOT_REAL_HTML_PATH || repositoryRealHtmlPath;

function validatedRealHtmlPath() {
  if (!path.isAbsolute(realHtmlPath) || path.extname(realHtmlPath).toLowerCase() !== ".html") {
    throw new Error(`PAGEROOT_REAL_HTML_PATH must be an absolute .html path: ${realHtmlPath}`);
  }
  return realHtmlPath;
}

function firstByteDifference(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < limit && actual[offset] === expected[offset]) offset += 1;
  const start = Math.max(0, offset - 48);
  const end = Math.min(Math.max(actual.length, expected.length), offset + 128);
  return JSON.stringify({
    offset,
    actualLength: actual.length,
    expectedLength: expected.length,
    actual: actual.subarray(start, Math.min(actual.length, end)).toString("utf8"),
    expected: expected.subarray(start, Math.min(expected.length, end)).toString("utf8"),
  });
}

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function editableSourceElementIds(source) {
  const index = buildSourceIndex(source.toString("utf8"));
  return new Set(index.elements.flatMap((element) => {
    if (!element.textContent?.trim()) return [];
    const targetRef = createTargetRef(index, element, { level: "subregion" });
    return isEditableIslandTarget(index, targetRef).editable
      ? [element.pagerootId || element.nodeId]
      : [];
  }));
}

async function discoverVisibleEditableHosts(frame, source) {
  const eligibleIds = [...editableSourceElementIds(source)];
  return frame.locator("[data-pageroot-id]").evaluateAll(
    (elements, allowedSourceIds) => {
      const allowed = new Set(allowedSourceIds);
      const transparent = new Set([
        "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn",
        "em", "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small",
        "span", "strong", "sub", "sup", "time", "u", "var",
      ]);
      const sourceIdOf = (element) => element.getAttribute("data-pageroot-id");
      const sourceParent = (element) => element.parentElement?.closest(
        "[data-pageroot-id]",
      ) ?? null;
      const stableDomSelector = (element) => {
        const parts = [];
        let current = element;
        while (current && current !== document.documentElement) {
          const parent = current.parentElement;
          if (!parent) return null;
          parts.push(`:nth-child(${Array.from(parent.children).indexOf(current) + 1})`);
          current = parent;
        }
        return current === document.documentElement
          ? `html${parts.reverse().map((part) => ` > ${part}`).join("")}`
          : null;
      };
      const resolved = new Map();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const match = /\S/u.exec(node.data);
        if (!match || !node.parentElement) continue;
        let host = node.parentElement.closest("[data-pageroot-id]");
        while (host) {
          const style = getComputedStyle(host);
          const standalone = style.display !== "inline" && style.display !== "contents";
          if (!transparent.has(host.localName) || standalone) break;
          const parent = sourceParent(host);
          if (!parent || parent === document.body || parent === document.documentElement) break;
          host = parent;
        }
        const sourceId = host ? sourceIdOf(host) : null;
        if (!host || !sourceId || !allowed.has(sourceId) || resolved.has(sourceId)) continue;
        const rect = host.getBoundingClientRect();
        const style = getComputedStyle(host);
        const insideClosedDetails = Boolean(
          host.closest("details:not([open])")
          && !host.closest("summary"),
        );
        let hiddenByFixedAncestor = false;
        for (let ancestor = host; ancestor; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (
            ancestorStyle.display === "none"
            || ancestorStyle.visibility === "hidden"
          ) {
            hiddenByFixedAncestor = true;
            break;
          }
          if (ancestorStyle.position === "fixed") {
            const ancestorRect = ancestor.getBoundingClientRect();
            if (
              ancestorRect.bottom <= 0
              || ancestorRect.top >= innerHeight
              || ancestorRect.right <= 0
              || ancestorRect.left >= innerWidth
            ) {
              hiddenByFixedAncestor = true;
              break;
            }
          }
        }
        if (
          rect.width <= 2
          || rect.height <= 2
          || style.display === "none"
          || style.visibility === "hidden"
          || style.pointerEvents === "none"
          || insideClosedDetails
          || hiddenByFixedAncestor
        ) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const glyphRect = range.getClientRects()[0] || range.getBoundingClientRect();
        if (!glyphRect || (!glyphRect.width && !glyphRect.height)) continue;
        if (
          style.position === "fixed"
          && (
            glyphRect.bottom <= 0
            || glyphRect.top >= innerHeight
            || glyphRect.right <= 0
            || glyphRect.left >= innerWidth
          )
        ) continue;
        resolved.set(sourceId, {
          sourceId,
          domSelector: stableDomSelector(host),
          tagName: host.localName,
          text: host.textContent || "",
          documentOrder: elements.indexOf(host),
          clickPosition: {
            x: glyphRect.left - rect.left
              + (glyphRect.width ? Math.min(glyphRect.width / 2, 3) : 1),
            y: glyphRect.top - rect.top
              + (glyphRect.height ? glyphRect.height / 2 : 1),
          },
        });
      }
      return [...resolved.values()].sort(
        (left, right) => left.documentOrder - right.documentOrder,
      );
    },
    eligibleIds,
  );
}

async function exerciseEditableHost(handle) {
  return handle.evaluate((element) => {
    const textNodes = () => {
      const result = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        result.push(node);
      }
      return result;
    };
    const select = (absoluteOffset) => {
      let consumed = 0;
      let point = null;
      for (const node of textNodes()) {
        if (absoluteOffset <= consumed + node.data.length) {
          point = [node, absoluteOffset - consumed];
          break;
        }
        consumed += node.data.length;
      }
      if (!point) throw new RangeError(`Selection offset ${absoluteOffset} is outside the host.`);
      element.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(point[0], point[1]);
      range.collapse(true);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const insert = (data) => {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data,
        inputType: "insertText",
      }));
    };
    const key = (value) => {
      element.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: value,
      }));
    };
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const beforeText = element.textContent || "";
    const segments = [...new Intl.Segmenter("zh-CN", {
      granularity: "grapheme",
    }).segment(beforeText)];
    const offsets = [...new Set([
      0,
      segments[Math.floor(segments.length / 2)]?.index ?? 0,
      beforeText.length,
    ])];
    let operations = 0;

    for (const offset of offsets) {
      select(offset);
      insert("测");
      assert(element.textContent !== beforeText, `insert failed at ${offset}`);
      operations += 1;
      key("Backspace");
      assert(element.textContent === beforeText, `delete failed at ${offset}`);
      operations += 1;
    }

    select(beforeText.length);
    const beforeBreaks = element.querySelectorAll("br").length;
    key("Enter");
    assert(
      element.querySelectorAll("br").length > beforeBreaks,
      "line-break insertion failed",
    );
    operations += 1;
    key("Backspace");
    assert(
      element.querySelectorAll("br").length === beforeBreaks,
      "line-break deletion failed",
    );
    operations += 1;

    const finalSegment = segments.filter(({ segment }) => segment.trim()).at(-1);
    if (finalSegment) {
      select(finalSegment.index + finalSegment.segment.length);
      key("Backspace");
      assert(element.textContent !== beforeText, "authored grapheme deletion failed");
      operations += 1;
      insert(finalSegment.segment);
      assert(element.textContent === beforeText, "authored grapheme restoration failed");
      operations += 1;
    }
    return { beforeText, operations };
  });
}

async function renderedTokenPosition(handle, token) {
  return handle.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let consumed = "";
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node);
      consumed += node.data;
    }
    const tokenOffset = consumed.lastIndexOf(wanted);
    if (tokenOffset < 0) throw new Error(`Rendered token is missing: ${wanted}`);
    let traversed = 0;
    for (const node of nodes) {
      if (tokenOffset < traversed + node.data.length) {
        const localOffset = tokenOffset - traversed;
        const range = document.createRange();
        range.setStart(node, localOffset);
        range.setEnd(node, localOffset + 1);
        const glyphRect = range.getClientRects()[0] || range.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        return {
          x: glyphRect.left - elementRect.left + Math.min(glyphRect.width / 2, 3),
          y: glyphRect.top - elementRect.top + glyphRect.height / 2,
        };
      }
      traversed += node.data.length;
    }
    throw new Error(`Rendered token has no glyph: ${wanted}`);
  }, token);
}

async function waitForEditableHost(frame, editor, expectedTarget, label) {
  try {
    await expect.poll(
      () => expectedTarget.getAttribute("contenteditable"),
      { timeout: 2_000 },
    ).toBe("true");
  } catch (cause) {
    const active = frame.locator('[contenteditable="true"]');
    const activeCount = await active.count();
    const activeId = activeCount > 0
      ? await active.first().getAttribute("data-pageroot-id")
      : null;
    throw new Error(
      `${label} did not activate. `
      + `status=${await editor.getAttribute("data-native-start-status")} `
      + `capability=${await editor.getAttribute("data-native-capability-detail")} `
      + `block=${await editor.getAttribute("data-edit-block-detail")} `
      + `activeCount=${activeCount} `
      + `activeId=${activeId}`,
      { cause },
    );
  }
}

async function loadRealHtml(page, sourcePath, source, { navigate = true } = {}) {
  const previousToken = navigate
    ? null
    : await documentToken(page).catch(() => null);
  if (navigate) {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 });
  }
  const name = path.basename(sourcePath);
  const { editor, iframe, frame } = await loadFixture(page, name, {
    buffer: source,
    identifiedWorkingCopy: false,
    requireComplete: false,
    requireNativeCase: false,
  });
  if (previousToken) {
    await expect.poll(
      () => documentToken(page),
      { timeout: 10_000 },
    ).not.toBe(previousToken);
  }

  // A user HTML file may intentionally keep external media or fonts pending.
  // DOM readiness is sufficient for source-backed editing; waiting for the
  // window load event would make the real-file gate hang on unrelated assets.
  await frame.waitForFunction(() => document.readyState !== "loading" && Boolean(document.body));
  return { editor, iframe, frame };
}

async function showAuthoredTab(frame, panelId) {
  await frame.evaluate((activePanelId) => {
    const controls = Array.from(document.querySelectorAll('[role="tab"][aria-controls]'));
    for (const control of controls) {
      const selected = control.getAttribute("aria-controls") === activePanelId;
      control.setAttribute("aria-selected", String(selected));
      control.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(control.getAttribute("aria-controls") || "");
      if (panel) panel.hidden = !selected;
    }
    window.dispatchEvent(new Event("resize"));
  }, panelId);
  await expect(frame.locator(`#${panelId}`)).toBeVisible();
}

async function waitForFreshFenceFrame(page, editor, previousDocumentToken) {
  await expect.poll(async () => {
    try {
      return await documentToken(page);
    } catch {
      return previousDocumentToken;
    }
  }, { timeout: 10_000 }).not.toBe(previousDocumentToken);
  await expect.poll(() => editor.getAttribute("data-render-verified"), {
    timeout: 10_000,
  }).toBe("true");
  return currentEditorFrame(page);
}

function uniqueLiteralForCandidate(source, text) {
  const normalized = text.trim();
  const codePoints = Array.from(normalized);
  for (const length of [12, 10, 8, 6, 4]) {
    if (codePoints.length < length) continue;
    const maxStart = Math.min(codePoints.length - length, 24);
    for (let start = 0; start <= maxStart; start += 1) {
      const token = codePoints.slice(start, start + length).join("");
      if (/\r|\n/u.test(token) || !token.trim()) continue;
      const bytes = Buffer.from(token, "utf8");
      const first = source.indexOf(bytes);
      if (first >= 0 && source.indexOf(bytes, first + bytes.length) < 0) {
        return { token, textOffset: text.indexOf(token) };
      }
    }
  }
  return null;
}

async function discoverEditableCandidate(frame, source) {
  const candidates = await frame.locator("[data-pageroot-id]").evaluateAll((elements) => {
    const preferredTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]);
    const tagPriority = new Map([
      ["p", 0],
      ["h1", 1], ["h2", 1], ["h3", 1], ["h4", 1], ["h5", 1], ["h6", 1],
      ["li", 2],
      ["td", 3], ["th", 3],
    ]);
    const hasMotion = (element) => {
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        const nonZero = (value) => value.split(",").some((part) => parseFloat(part) > 0);
        if (nonZero(style.transitionDuration)
          || (style.animationName !== "none" && nonZero(style.animationDuration))) return true;
        current = current.parentElement;
      }
      return false;
    };
    const pseudoContent = (element) => ["::before", "::after"].some((pseudo) => {
      const content = getComputedStyle(element, pseudo).content;
      return Boolean(content && content !== "none" && content !== "normal" && content !== '""');
    });
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        index,
        sourceId: element.getAttribute("data-pageroot-id"),
        tagName: element.localName,
        text: element.textContent || "",
        childElementCount: element.childElementCount,
        visible: rect.width > 2 && rect.height > 2
          && style.display !== "none" && style.visibility !== "hidden",
        preferredTag: preferredTags.has(element.localName),
        tagPriority: tagPriority.get(element.localName) ?? 9,
        horizontal: style.writingMode === "horizontal-tb",
        pseudoContent: pseudoContent(element),
        motion: hasMotion(element),
        forbiddenDescendant: Boolean(element.querySelector(
          "br,img,svg,math,canvas,iframe,input,textarea,select,video,audio,object,embed,pre,code",
        )),
      };
    });
  });

  const diagnostics = [];
  const sorted = candidates
    .filter((candidate) => candidate.visible && candidate.preferredTag)
    .sort((left, right) => (
      left.tagPriority - right.tagPriority
      || Number(left.childElementCount > 0) - Number(right.childElementCount > 0)
      || Number(left.motion) - Number(right.motion)
      || left.text.length - right.text.length
      || left.index - right.index
    ));
  for (const candidate of sorted) {
    const literal = uniqueLiteralForCandidate(source, candidate.text);
    const reasons = [
      candidate.childElementCount > 0 ? "nested-elements" : null,
      candidate.forbiddenDescendant ? "structural-descendant" : null,
      candidate.pseudoContent ? "generated-content" : null,
      candidate.motion ? "animated-ancestor" : null,
      !candidate.horizontal ? "non-horizontal-writing" : null,
      !literal ? "no-unique-source-literal" : null,
    ].filter(Boolean);
    diagnostics.push({
      sourceId: candidate.sourceId,
      tagName: candidate.tagName,
      text: candidate.text.trim().slice(0, 80),
      reasons,
    });
    if (reasons.length === 0 && literal && literal.textOffset >= 0) {
      return { ...candidate, ...literal, diagnostics };
    }
  }
  throw new Error(
    `No fail-closed native-edit candidate was found. Candidates: ${JSON.stringify(diagnostics.slice(0, 12))}`,
  );
}

async function discoverCommentCandidate(frame) {
  const candidates = await frame.locator("[data-pageroot-id]").evaluateAll((elements) => {
    const dedicatedEditorRoots = new Set([
      "input", "textarea", "select", "option", "script", "style", "template", "title",
      "canvas", "iframe", "svg", "math",
    ]);
    const dedicatedEditorSelector = [...dedicatedEditorRoots].join(",");
    const documentContainers = new Set(["html", "head", "body"]);
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const pseudoContent = ["::before", "::after"].some((name) => {
        const content = getComputedStyle(element, name).content;
        return Boolean(
          content
          && content !== "none"
          && content !== "normal"
          && content !== '""'
          && content !== "''",
        );
      });
      const tagName = element.localName;
      const insideDedicatedEditorRoot = Boolean(
        element.parentElement?.closest(dedicatedEditorSelector),
      );
      return {
        index,
        sourceId: element.getAttribute("data-pageroot-id"),
        tagName,
        text: (element.textContent || "").trim().slice(0, 80),
        rendered: rect.width > 2 && rect.height > 2
          && style.display !== "none" && style.visibility !== "hidden",
        href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
        childElementCount: element.childElementCount,
        documentContainer: documentContainers.has(tagName),
        dedicatedEditorRoot: dedicatedEditorRoots.has(tagName),
        insideDedicatedEditorRoot,
        pseudoContent,
      };
    });
  });
  const candidate = candidates
    .filter(({ rendered, text, documentContainer, insideDedicatedEditorRoot, dedicatedEditorRoot }) => (
      rendered && !documentContainer
      && !insideDedicatedEditorRoot
      && text.length > 0
      && dedicatedEditorRoot
    ))
    .sort((left, right) => (
      left.childElementCount - right.childElementCount
      || left.text.length - right.text.length
      || left.index - right.index
    ))[0];
  if (!candidate) {
    throw new Error(
      `No explicit select-comment/comment-only candidate was found. `
      + `Expected a rendered dedicated editor root. `
      + `Sample: ${JSON.stringify(candidates.slice(0, 12))}`,
    );
  }
  return candidate;
}

async function visualGeometrySnapshot(handle) {
  return handle.evaluate((target) => {
    const roundedRect = (rect) => ({
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    });
    const visibleSourceRects = Array.from(document.querySelectorAll("[data-pageroot-id]"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.bottom >= 0 && rect.top <= innerHeight
          && rect.right >= 0 && rect.left <= innerWidth
          && rect.width > 0 && rect.height > 0
          && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({
        sourceId: element.getAttribute("data-pageroot-id"),
        rect: roundedRect(element.getBoundingClientRect()),
      }));
    const targetRect = target.getBoundingClientRect();
    const textRects = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) textRects.push(roundedRect(rect));
    }
    return {
      target: roundedRect(targetRect),
      textRects,
      visibleSourceRects,
      scroll: { x: scrollX, y: scrollY },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    };
  });
}

function expectGeometryStable(before, after) {
  expect(after.scroll).toEqual(before.scroll);
  expect(after.documentSize).toEqual(before.documentSize);
  expect(after.visibleSourceRects.map(({ sourceId }) => sourceId))
    .toEqual(before.visibleSourceRects.map(({ sourceId }) => sourceId));
  const compareRect = (left, right, label) => {
    for (const key of ["x", "y", "width", "height"]) {
      expect(right[key], `${label}.${key}`).toBeCloseTo(left[key], 0);
    }
  };
  compareRect(before.target, after.target, "target");
  expect(after.textRects).toHaveLength(before.textRects.length);
  before.textRects.forEach((rect, index) => compareRect(rect, after.textRects[index], `textRect[${index}]`));
  before.visibleSourceRects.forEach((entry, index) => (
    compareRect(entry.rect, after.visibleSourceRects[index].rect, `visible[${entry.sourceId}]`)
  ));
}

function geometrySnapshotsClose(left, right, tolerance = 0.5) {
  const rectClose = (first, second) => (
    ["x", "y", "width", "height"].every(
      (key) => Math.abs(first[key] - second[key]) <= tolerance,
    )
  );
  return left.scroll.x === right.scroll.x
    && left.scroll.y === right.scroll.y
    && left.documentSize.width === right.documentSize.width
    && left.documentSize.height === right.documentSize.height
    && rectClose(left.target, right.target)
    && left.textRects.length === right.textRects.length
    && left.textRects.every((rect, index) => rectClose(rect, right.textRects[index]))
    && left.visibleSourceRects.length === right.visibleSourceRects.length
    && left.visibleSourceRects.every((entry, index) => (
      entry.sourceId === right.visibleSourceRects[index].sourceId
      && rectClose(entry.rect, right.visibleSourceRects[index].rect)
    ));
}

async function waitForGeometrySettled(target) {
  let previous = await visualGeometrySnapshot(target);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = await visualGeometrySnapshot(target);
    if (geometrySnapshotsClose(previous, current)) return current;
    previous = current;
  }
  throw new Error("The real HTML layout did not settle before native editing.");
}

async function setHandleTextSelection(handle, start, end = start) {
  return handle.evaluate((target, offsets) => {
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
      throw new RangeError(`Text offset ${absoluteOffset} is outside the candidate.`);
    };
    const [startNode, startOffset] = pointAt(offsets.start);
    const [endNode, endOffset] = pointAt(offsets.end);
    target.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { start, end });
}

async function firstRenderedTextPosition(handle) {
  return handle.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = /\S/u.exec(node.data);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const glyphRect = range.getClientRects()[0];
      const elementRect = element.getBoundingClientRect();
      if (!glyphRect?.width || !glyphRect.height) continue;
      return {
        x: glyphRect.left - elementRect.left + Math.min(glyphRect.width / 2, 3),
        y: glyphRect.top - elementRect.top + glyphRect.height / 2,
      };
    }
    throw new Error("No rendered text glyph was found for the real-HTML candidate.");
  });
}

test("DOM editing compatibility scan keeps layout and editable-island source authority", async ({ page }, testInfo) => {
  const sourcePath = validatedRealHtmlPath();
  const beforeStat = statSync(sourcePath);
  const original = readFileSync(sourcePath);
  const originalSha = sha256(original);
  const identified = identifiedHtmlBuffer(original);
  const { editor, iframe, frame } = await loadRealHtml(page, sourcePath, identified);
  const beforeDocument = await documentToken(frame);

  const candidate = await discoverEditableCandidate(frame, identified);
  const sourceNodes = frame.locator("[data-pageroot-id]");
  const target = await sourceNodes.nth(candidate.index).elementHandle();
  if (!target) throw new Error(`Editable candidate detached before activation: ${JSON.stringify(candidate)}`);
  await target.scrollIntoViewIfNeeded();
  await testInfo.attach("dom-editing-compatibility-before-edit.png", {
    body: await iframe.screenshot(),
    contentType: "image/png",
  });
  // Chromium may finalize lazy glyph metrics while taking the first iframe
  // screenshot. Capture the geometry baseline after that rendering barrier so
  // the edit assertion compares two settled layouts rather than font warm-up.
  const beforeGeometry = await waitForGeometrySettled(target);

  await target.dblclick({ position: await firstRenderedTextPosition(target) });
  await expect.poll(
    () => target.getAttribute("contenteditable"),
    {
      message: `Candidate did not enter native edit. candidate=${JSON.stringify(candidate)} block=${await editor.getAttribute("data-edit-block-detail")} capability=${await editor.getAttribute("data-native-capability-detail")}`,
    },
  ).toBe("true");
  const activeState = await target.evaluate((element) => {
    const selection = document.getSelection();
    const selectionNode = selection?.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentNode
      : selection?.anchorNode;
    return {
      active: document.activeElement === element,
      editable: element.isContentEditable,
      selectionInside: Boolean(selectionNode && element.contains(selectionNode)),
    };
  });
  expect(activeState).toEqual({ active: true, editable: true, selectionInside: true });
  expect(await documentToken(frame)).toBe(beforeDocument);
  expectGeometryStable(beforeGeometry, await visualGeometrySnapshot(target));

  await setHandleTextSelection(target, candidate.textOffset);
  const caret = await target.evaluate((element) => {
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return {
      collapsed: selection?.isCollapsed,
      active: document.activeElement === element,
      inside: Boolean(selection?.anchorNode && element.contains(
        selection.anchorNode.nodeType === Node.TEXT_NODE
          ? selection.anchorNode.parentNode
          : selection.anchorNode,
      )),
      rectHeight: range?.getBoundingClientRect().height || 0,
    };
  });
  expect(caret).toMatchObject({ collapsed: true, active: true, inside: true });
  expect(caret.rectHeight).toBeGreaterThan(0);

  const replacement = "PageRoot真实原位门禁";
  if (identified.includes(Buffer.from(replacement))) {
    throw new Error(`Replacement oracle already exists in source: ${replacement}`);
  }
  const expected = replaceEditableIslandTextBytes(
    identified,
    candidate.sourceId,
    candidate.token,
    replacement,
  );
  await setHandleTextSelection(
    target,
    candidate.textOffset,
    candidate.textOffset + candidate.token.length,
  );
  await page.keyboard.insertText(replacement);
  await expect.poll(() => target.textContent()).toContain(replacement);
  const checkpointDocumentToken = await documentToken(page);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
  await expect.poll(() => documentToken(page)).toBe(checkpointDocumentToken);
  await expect(editor).toHaveAttribute("data-render-verified", "true");
  await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]'))
    .toHaveCount(0);
  const modified = await exportCurrentHtml(page);
  expect(
    modified.equals(expected),
    `Only the selected literal may change: ${firstByteDifference(modified, expected)}`,
  ).toBe(true);

  let currentFrame = await currentEditorFrame(page);
  const remainingEditHost = currentFrame.locator('[contenteditable="true"]');
  await expect(remainingEditHost).toHaveCount(1);
  await expect.poll(() => remainingEditHost.evaluate((element) => (
    element.ownerDocument.activeElement === element
    || element.contains(element.ownerDocument.activeElement)
  ))).toBe(true);
  await remainingEditHost.press("Escape");
  await expect(remainingEditHost).toHaveCount(0);
  currentFrame = await currentEditorFrame(page);
  const commentCandidate = await discoverCommentCandidate(currentFrame);
  const commentTarget = currentFrame
    .locator(
      `[data-pageroot-id="${escapeAttributeValue(commentCandidate.sourceId)}"]`,
    );
  await expect(commentTarget, `Comment candidate must stay uniquely source-backed: ${JSON.stringify(commentCandidate)}`)
    .toHaveCount(1);
  await commentTarget.dblclick({
    force: true,
    position: { x: 4, y: 4 },
  });
  expect(await currentFrame.locator('[contenteditable="true"]').count()).toBe(0);
  // Dedicated surfaces use the Canvas Target contract directly: double-click
  // selects and comments, but never enters the generic native text editor.
  await expect(page.getByRole("button", { name: /留评论|评论/ }).filter({ visible: true }).first())
    .toBeVisible();
  const notice = page.locator('[role="status"], [role="alert"]').filter({ hasText: /评论/ });
  await expect(notice).toHaveCount(0);
  await page.keyboard.insertText("FALLBACK_MUST_NOT_EDIT");
  const afterFallback = await exportCurrentHtml(page);
  expect(afterFallback.equals(expected), firstByteDifference(afterFallback, expected)).toBe(true);

  const afterStat = statSync(sourcePath);
  const diskAfter = readFileSync(sourcePath);
  expect(sha256(diskAfter), "the original desktop file SHA").toBe(originalSha);
  expect(afterStat.size).toBe(beforeStat.size);
  expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
});

const REAL_CENSUS_SHARD_COUNT = 32;

for (let shardIndex = 0; shardIndex < REAL_CENSUS_SHARD_COUNT; shardIndex += 1) {
test(`DOM editing compatibility scan covers every visible V2 host (${shardIndex + 1}/${REAL_CENSUS_SHARD_COUNT})`, async ({ page }, testInfo) => {
  test.skip(
    !process.env.PAGEROOT_REAL_HTML_PATH,
    "The exhaustive census runs only when an explicit real HTML path is supplied.",
  );
  test.setTimeout(15 * 60_000);
  const sourcePath = validatedRealHtmlPath();
  const original = readFileSync(sourcePath);
  const beforeStat = statSync(sourcePath);
  const originalSha = sha256(original);
  const identified = identifiedHtmlBuffer(original);
  let loaded = await loadRealHtml(page, sourcePath, identified);
  const hosts = await discoverVisibleEditableHosts(loaded.frame, identified);
  const onlyIndex = process.env.PAGEROOT_CENSUS_ONLY_INDEX === undefined
    ? null
    : Number.parseInt(process.env.PAGEROOT_CENSUS_ONLY_INDEX, 10);
  const scheduledHosts = Number.isInteger(onlyIndex)
    ? hosts.map((host, index) => ({ host, hostIndex: index }))
      .filter(({ hostIndex }) => (
        hostIndex === onlyIndex
        && hostIndex % REAL_CENSUS_SHARD_COUNT === shardIndex
      ))
    : hosts.map((host, hostIndex) => ({ host, hostIndex }))
      .filter(({ hostIndex }) => (
        hostIndex % REAL_CENSUS_SHARD_COUNT === shardIndex
      ));
  if (Number.isInteger(onlyIndex) && scheduledHosts.length === 0) test.skip();
  if (scheduledHosts.length === 0) {
    throw new Error(`PAGEROOT_CENSUS_ONLY_INDEX did not match a host: ${onlyIndex}`);
  }
  console.log(`PageRootV2 real census discovered ${hosts.length} visible hosts.`);
  const stats = {
    sourcePath: path.basename(sourcePath),
    discoveredEditableHosts: 0,
    successfulHosts: 0,
    failedHosts: 0,
    successfulOperations: 0,
    failedOperations: 0,
    failures: [],
    hosts: [],
  };
  const testedHostPaths = new Set();

  for (const { hostIndex, host } of scheduledHosts) {
    const hostResult = {
      sourceId: host.sourceId,
      tagName: host.tagName,
      text: host.text.trim().slice(0, 80),
      operations: 0,
      status: "passed",
    };
    try {
      if (!host.domSelector) throw new Error("Editable host has no stable DOM path.");
      let target = loaded.frame.locator(host.domSelector);
      await expect(target).toHaveCount(1);
      const stillIndependentlyTestable = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return Boolean((element.textContent || "").length)
          && rect.width > 2
          && rect.height > 2
          && style.display !== "none"
          && style.visibility !== "hidden";
      });
      if (!stillIndependentlyTestable) {
        throw new Error("Editable host was altered by an earlier host in the same isolated shard.");
      }
      await target.evaluate((element) => element.scrollIntoView({
        block: "center",
        inline: "center",
      }));
      const activate = async () => {
        // The fixture intentionally contains perpetual CSS motion. `force`
        // preserves a browser-generated pointer sequence without waiting for
        // an animation to become "stable", which can never happen for cards.
        await target.dblclick({
          position: host.clickPosition,
          force: true,
          timeout: 2_000,
        });
        await waitForEditableHost(
          loaded.frame,
          loaded.editor,
          target,
          `${host.tagName}:${host.sourceId}`,
        );
      };
      await activate();
      const active = loaded.frame.locator('[contenteditable="true"]');
      await expect(active).toHaveCount(1);
      const activeId = await active.getAttribute("data-pageroot-id");
      if (!activeId) throw new Error("Activated host lost its source identity.");
      if (testedHostPaths.has(host.domSelector)) {
        throw new Error(`Duplicate editable-host DOM path: ${host.domSelector}`);
      }
      testedHostPaths.add(host.domSelector);
      hostResult.sourceId = activeId;
      hostResult.tagName = await active.evaluate((element) => element.localName);
      hostResult.text = (await active.textContent()).trim().slice(0, 80);
      const activeHandle = await active.elementHandle();
      if (!activeHandle) throw new Error("Activated host detached before its operation matrix.");
      hostResult.operations += 1;
      stats.successfulOperations += 1;
      const exercised = await exerciseEditableHost(activeHandle);
      hostResult.operations += exercised.operations;
      stats.successfulOperations += exercised.operations;

      expect(
        await loaded.editor.getAttribute("data-edit-block-detail"),
        `${host.tagName}:${host.sourceId}`,
      ).toBeNull();
      const tokenBeforeExit = await documentToken(page);
      const deferredFence = (
        await loaded.editor.getAttribute("data-native-commit-path")
      )?.includes("fence-deferred");
      await page.keyboard.press("Escape");
      if (deferredFence) {
        loaded = {
          ...loaded,
          frame: await waitForFreshFenceFrame(
            page,
            loaded.editor,
            tokenBeforeExit,
          ),
        };
      }
      await expect(loaded.frame.locator('[contenteditable="true"]')).toHaveCount(0);
      stats.successfulHosts += 1;
      if (stats.successfulHosts % 50 === 0) {
        console.log(`PageRootV2 real census progress: ${stats.successfulHosts}/${hosts.length}`);
      }
    } catch (error) {
      hostResult.status = "failed";
      hostResult.error = error instanceof Error ? error.message : String(error);
      stats.failedHosts += 1;
      stats.failedOperations += 1;
      stats.failures.push({
        index: hostIndex,
        sourceId: host.sourceId,
        tagName: host.tagName,
        text: host.text.trim().slice(0, 120),
        error: hostResult.error,
      });
      console.log(`PageRootV2 census failure: ${JSON.stringify(stats.failures.at(-1))}`);
      await page.keyboard.press("Escape").catch(() => undefined);
      if (process.env.PAGEROOT_CENSUS_STOP_AFTER_FAILURE === "1") break;
      loaded = await loadRealHtml(page, sourcePath, identified);
    }
    stats.hosts.push(hostResult);
  }

  stats.discoveredEditableHosts = scheduledHosts.length;
  console.log(`PageRootV2 real census summary: ${JSON.stringify({
    discoveredEditableHosts: stats.discoveredEditableHosts,
    successfulHosts: stats.successfulHosts,
    failedHosts: stats.failedHosts,
    successfulOperations: stats.successfulOperations,
    failedOperations: stats.failedOperations,
  })}`);
  await testInfo.attach("pageroot-v2-real-editability-census.json", {
    body: Buffer.from(JSON.stringify(stats, null, 2)),
    contentType: "application/json",
  });
  expect(
    stats.failures,
    `V2 real-page census failures: ${JSON.stringify(stats.failures, null, 2)}`,
  ).toEqual([]);
  expect(stats.successfulHosts).toBe(scheduledHosts.length);
  expect(stats.successfulOperations).toBeGreaterThanOrEqual(scheduledHosts.length * 9);
  const afterStat = statSync(sourcePath);
  expect(sha256(readFileSync(sourcePath))).toBe(originalSha);
  expect(afterStat.size).toBe(beforeStat.size);
  expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
});
}

test("DOM compatibility scan preserves nested-list headings and wbr structure", async ({
  page,
}) => {
  test.skip(
    !process.env.PAGEROOT_REAL_HTML_PATH,
    "The reported structural regressions run only against the explicit real HTML.",
  );
  const sourcePath = validatedRealHtmlPath();
  const original = readFileSync(sourcePath);
  const beforeStat = statSync(sourcePath);
  const originalSha = sha256(original);
  const identified = identifiedHtmlBuffer(original);
  const loaded = await loadRealHtml(page, sourcePath, identified);
  const { editor } = loaded;
  let { frame } = loaded;

  await showAuthoredTab(frame, "panel-outline");
  const nested = frame.locator("#panel-outline > ol > li").first();
  const nestedHandle = await nested.elementHandle();
  if (!nestedHandle) throw new Error("The reported nested-list heading is missing.");
  const nestedSourceId = await nested.getAttribute("data-pageroot-id");
  if (!nestedSourceId) throw new Error("The nested-list heading lost source identity.");
  await nested.dblclick({
    position: await renderedTokenPosition(nestedHandle, "发现阶段"),
  });
  await waitForEditableHost(frame, editor, nested, "reported nested-list heading");
  await expect(nested.locator(":scope > ul")).toHaveAttribute("contenteditable", "false");
  const nestedText = await nested.textContent();
  const nestedStart = nestedText.indexOf("发现阶段");
  await setHandleTextSelection(
    nestedHandle,
    nestedStart,
    nestedStart + "发现阶段".length,
  );
  await page.keyboard.insertText("发现与验证阶段");
  await page.keyboard.press("Escape");
  await expect(nested).not.toHaveAttribute("contenteditable", "true");
  const nestedExpected = replaceEditableIslandTextBytes(
    identified,
    nestedSourceId,
    "发现阶段",
    "发现与验证阶段",
  );
  const nestedDocumentToken = await documentToken(page);
  expect((await exportCurrentHtml(page)).equals(nestedExpected)).toBe(true);
  frame = await waitForFreshFenceFrame(page, editor, nestedDocumentToken);

  await showAuthoredTab(frame, "panel-terms");
  const wbrCandidate = frame.locator("#panel-terms p").filter({
    hasText: "软换行机会：HypertextMarkupLanguage",
  });
  const wbrSourceId = await wbrCandidate.getAttribute("data-pageroot-id");
  if (!wbrSourceId) throw new Error("The wbr paragraph lost source identity.");
  const wbr = frame.locator(
    `[data-pageroot-id="${escapeAttributeValue(wbrSourceId)}"]`,
  );
  const wbrHandle = await wbr.elementHandle();
  if (!wbrHandle) throw new Error("The reported wbr paragraph is missing.");
  await wbr.dblclick({
    position: await renderedTokenPosition(wbrHandle, "Hypertext"),
  });
  await waitForEditableHost(frame, editor, wbr, "reported wbr paragraph");
  const wbrText = await wbr.textContent();
  const wbrStart = wbrText.indexOf("Hypertext");
  await setHandleTextSelection(
    wbrHandle,
    wbrStart,
    wbrStart + "Hypertext".length,
  );
  await page.keyboard.insertText("Hypertextual");
  const updatedWbr = frame.locator("#panel-terms p").filter({
    hasText: "软换行机会：HypertextualMarkupLanguage",
  });
  await expect(updatedWbr.locator("wbr")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  const expected = replaceEditableIslandTextBytes(
    nestedExpected,
    wbrSourceId,
    "Hypertext",
    "Hypertextual",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

  const afterStat = statSync(sourcePath);
  expect(sha256(readFileSync(sourcePath))).toBe(originalSha);
  expect(afterStat.size).toBe(beforeStat.size);
  expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
});

test("DOM compatibility scan round-trips end boundaries with only island normalization", async ({ page }, testInfo) => {
  test.skip(
    !process.env.PAGEROOT_REAL_HTML_PATH,
    "Named regressions run only when an explicit real HTML path is supplied.",
  );
  test.setTimeout(3 * 60_000);
  const sourcePath = validatedRealHtmlPath();
  const original = readFileSync(sourcePath);
  const originalSha = sha256(original);
  const identified = identifiedHtmlBuffer(original);
  const scenarios = [
    {
      name: "header brand",
      selector: "header.site-header a.brand-lockup > span:last-child[data-pageroot-id]",
      boundaryToken: "2030",
    },
    {
      name: "hero real-world paragraph",
      selector: ".hero .hero-lede[data-pageroot-id]",
      boundaryToken: "保存。",
    },
    {
      name: "start-browsing link",
      selector: '.hero .button-row > a.button[href="#dashboard"][data-pageroot-id]',
      boundaryToken: "开始浏览",
    },
    {
      name: "module-ordering paragraph",
      selector: "#dashboard .section-heading > p:not(.kicker)[data-pageroot-id]",
      boundaryToken: "模块排序。",
    },
  ];
  const report = [];

  for (const scenario of scenarios) {
    const { editor, frame } = await loadRealHtml(page, sourcePath, identified);
    const target = frame.locator(scenario.selector);
    await expect(target, scenario.name).toHaveCount(1);
    const handle = await target.elementHandle();
    if (!handle) throw new Error(`${scenario.name} detached before activation.`);
    await handle.scrollIntoViewIfNeeded();
    await handle.dblclick({
      position: await renderedTokenPosition(handle, scenario.boundaryToken),
    });
    await waitForEditableHost(frame, editor, target, scenario.name);
    const sourceId = await target.getAttribute("data-pageroot-id");
    if (!sourceId) throw new Error(`${scenario.name} lost its source identity.`);
    const beforeText = await target.textContent();
    const boundaryStart = beforeText.lastIndexOf(scenario.boundaryToken);
    if (boundaryStart < 0) {
      throw new Error(`${scenario.name} boundary token is not rendered.`);
    }
    const boundaryOffset = boundaryStart + scenario.boundaryToken.length;
    await setHandleTextSelection(handle, boundaryOffset);
    await page.keyboard.insertText("测");
    await expect.poll(() => target.textContent()).not.toBe(beforeText);
    await page.keyboard.press("Backspace");
    await expect.poll(() => target.textContent()).toBe(beforeText);
    await setHandleTextSelection(handle, boundaryOffset);
    const beforeBreaks = await target.locator("br").count();
    await page.keyboard.press("Enter");
    await expect.poll(() => target.locator("br").count()).toBeGreaterThan(beforeBreaks);
    await page.keyboard.press("Backspace");
    await expect.poll(() => target.locator("br").count()).toBe(beforeBreaks);
    expect(await editor.getAttribute("data-edit-block-detail"), scenario.name).toBeNull();
    await page.keyboard.press("Escape");

    const expected = replaceEditableIslandTextBytes(
      identified,
      sourceId,
      scenario.boundaryToken,
      scenario.boundaryToken,
    );
    const exported = await exportCurrentHtml(page);
    expect(
      exported.equals(expected),
      `${scenario.name}: ${firstByteDifference(exported, expected)}`,
    ).toBe(true);
    report.push({ ...scenario, status: "passed", operations: 4 });
  }

  await testInfo.attach("pageroot-v2-reported-boundaries.json", {
    body: Buffer.from(JSON.stringify({
      targets: scenarios.length,
      successfulTargets: report.length,
      successfulOperations: report.reduce((sum, item) => sum + item.operations, 0),
      failedOperations: 0,
      report,
    }, null, 2)),
    contentType: "application/json",
  });
  expect(sha256(readFileSync(sourcePath))).toBe(originalSha);
});
