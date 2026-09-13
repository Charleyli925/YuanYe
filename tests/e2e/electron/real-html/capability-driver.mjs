import { expect } from "@playwright/test";

import {
  buildSourceIndex,
  createTargetRef,
} from "../../../../app/lib/source-patch-core.js";
import { isEditableIslandTarget } from "../../../../app/lib/editable-island.js";
import { CAPABILITY_STABLE_ID_PATTERN } from "./capability-manifest.mjs";

const TEXT_TAGS = new Set([
  "address", "blockquote", "caption", "dd", "dt", "figcaption", "h1", "h2",
  "h3", "h4", "h5", "h6", "label", "legend", "li", "p", "pre", "summary",
  "td", "th",
]);
const CONTROL_TAGS = new Set(["a", "button", "input", "option", "select", "textarea"]);
const MEDIA_TAGS = new Set(["audio", "canvas", "embed", "iframe", "img", "object", "svg", "video"]);
const TABLE_TAGS = new Set(["table", "tbody", "tfoot", "thead", "tr", "td", "th"]);
const LIST_TAGS = new Set(["dl", "ol", "ul", "li", "dd", "dt"]);

export function majorElementType(tagName) {
  const tag = String(tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTROL_TAGS.has(tag)) return "control";
  if (MEDIA_TAGS.has(tag)) return "media";
  if (TABLE_TAGS.has(tag)) return "table";
  if (LIST_TAGS.has(tag)) return "list";
  if (["form", "fieldset"].includes(tag)) return "form";
  return "container";
}

export function authoredTabActivationDecision(snapshot) {
  if (snapshot.tabCount !== 1) {
    return { state: "failed", reason: "TAB_STABLE_ID_NOT_UNIQUE" };
  }
  if (snapshot.active === true) return { state: "active", reason: "TAB_ALREADY_ACTIVE" };
  if (snapshot.activationButtonCount > 1) {
    return { state: "failed", reason: "TAB_ACTIVATION_ACTION_AMBIGUOUS" };
  }
  if (
    snapshot.activationButtonCount === 1
    && snapshot.activationButtonVisible === true
    && snapshot.activationButtonEnabled === true
  ) return { state: "activate", reason: "TAB_ACTIVATION_ACTION_READY" };
  return { state: "pending", reason: "TAB_ACTIVATION_PENDING" };
}

export async function driveAuthoredTabActivation({
  readState,
  prepareSelection,
  selectTab,
  activateTab,
  timeoutMs = 5_000,
  pollIntervalMs = 25,
}) {
  const deadline = Date.now() + timeoutMs;
  let selected = false;
  try {
    await prepareSelection();
  } catch (cause) {
    const error = new Error("The previous selection did not settle before tab activation.");
    error.code = "TAB_ACTIVATION_NOT_SETTLED";
    error.details = {
      phase: "prepare-selection",
      causeCode: cause?.code || null,
      cause: String(cause?.message || cause),
    };
    throw error;
  }
  let latest = await readState();
  let lastActionError = null;
  while (Date.now() <= deadline) {
    const decision = authoredTabActivationDecision(latest);
    if (decision.state === "active") return { decision, snapshot: latest };
    if (decision.state === "failed") {
      const error = new Error("The authored tab activation state was ambiguous.");
      error.code = decision.reason;
      error.details = latest;
      throw error;
    }
    if (!selected) {
      try {
        await selectTab();
        selected = true;
      } catch (cause) {
        const error = new Error("The authored tab could not be selected for activation.");
        error.code = "TAB_ACTIVATION_NOT_SETTLED";
        error.details = {
          phase: "select-tab",
          causeCode: cause?.code || null,
          cause: String(cause?.message || cause),
        };
        throw error;
      }
    } else if (decision.state === "activate") {
      const confirmed = await readState();
      const confirmedDecision = authoredTabActivationDecision(confirmed);
      if (confirmedDecision.state === "active") {
        return { decision: confirmedDecision, snapshot: confirmed };
      }
      if (confirmedDecision.state === "activate") {
        try {
          await activateTab();
          lastActionError = null;
        } catch (cause) {
          lastActionError = String(cause?.message || cause);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    latest = await readState();
  }
  const error = new Error("The authored tab did not reach its active terminal state.");
  error.code = "TAB_ACTIVATION_NOT_SETTLED";
  error.details = {
    decision: authoredTabActivationDecision(latest),
    snapshot: latest,
    lastActionError,
  };
  throw error;
}

export function sourceElementsForCapabilityManifest(source) {
  const index = buildSourceIndex(source);
  return index.elements.map((element, sourceOrder) => {
    let sourceEditable = false;
    if (element.pagerootIdentityStatus === "valid") {
      try {
        sourceEditable = isEditableIslandTarget(
          index,
          createTargetRef(index, element, { level: "subregion" }),
        ).editable;
      } catch {
        sourceEditable = false;
      }
    }
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    return {
      pagerootId: element.pagerootId,
      pagerootIdentityStatus: element.pagerootIdentityStatus,
      tagName: element.tagName,
      parentId: parent?.type === "element" ? parent.pagerootId || null : null,
      sourceOrder,
      sourceEditable,
      boundarySafe: element.boundarySafe === true,
    };
  });
}

export async function collectVisibleAuthoredCandidates(frame, sourceElements, tabId = null) {
  return frame.locator("[data-pageroot-id]").evaluateAll((elements, payload) => {
    const sourceById = new Map(payload.sourceElements.map((entry) => [entry.pagerootId, entry]));
    const viewportHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      innerHeight,
    );
    const regionFor = (rect) => {
      const center = scrollY + rect.top + rect.height / 2;
      if (center < viewportHeight / 3) return "top";
      if (center < viewportHeight * 2 / 3) return "middle";
      return "bottom";
    };
    const scrollContainerFor = (element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (/(?:auto|scroll)/u.test(`${style.overflowY} ${style.overflow}`)
          && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          return ancestor.getAttribute("data-pageroot-id") || "nested-authored-scroller";
        }
        ancestor = ancestor.parentElement;
      }
      return "document";
    };
    return elements.map((element) => {
      const stableId = element.getAttribute("data-pageroot-id");
      const source = sourceById.get(stableId);
      if (!source) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = element.hasAttribute("hidden")
        || element.closest('[aria-hidden="true"], [hidden]') != null
        || style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity || 1) === 0
        || rect.width <= 1
        || rect.height <= 1
        || element.getClientRects().length === 0;
      return {
        stableId,
        tag: element.localName,
        sourceOrder: source.sourceOrder,
        sourceEditable: source.sourceEditable === true,
        visible: !hidden,
        isConnected: element.isConnected,
        inert: element.closest("[inert]") != null,
        runtimeGenerated: false,
        tabId: payload.tabId,
        region: regionFor(rect),
        scrollContainer: scrollContainerFor(element),
      };
    }).filter(Boolean);
  }, { sourceElements, tabId });
}

async function safeAuthoredHitPoint(target) {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + Math.max(1, rect.width * xFraction);
        const y = rect.top + Math.max(1, rect.height * yFraction);
        const hit = element.ownerDocument.elementFromPoint(x, y);
        if (hit?.closest("[data-pageroot-id]") === element) {
          return {
            targetX: x - rect.left,
            targetY: y - rect.top,
            clientX: x,
            clientY: y,
          };
        }
      }
    }
    return null;
  });
}

async function pageSpaceAuthoredHitPoint({ frame, editor, target }) {
  const position = await safeAuthoredHitPoint(target);
  if (!position) return null;
  const topLevel = typeof frame.mainFrame === "function";
  if (topLevel) {
    return {
      ...position,
      pageX: position.clientX,
      pageY: position.clientY,
      topLevel,
    };
  }
  const frameGeometry = await editor.evaluate((root) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    if (frames.length !== 1) return { count: frames.length };
    const iframe = frames[0];
    const rect = iframe.getBoundingClientRect();
    const scaleX = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
    const scaleY = iframe.offsetHeight > 0 ? rect.height / iframe.offsetHeight : 1;
    return {
      count: 1,
      contentLeft: rect.left + iframe.clientLeft * scaleX,
      contentTop: rect.top + iframe.clientTop * scaleY,
      scaleX,
      scaleY,
    };
  });
  if (frameGeometry.count !== 1) {
    const error = new Error("The capability probe did not find one active Runtime iframe.");
    error.code = "CAPABILITY_PROBE_ACTIVE_FRAME_NOT_UNIQUE";
    error.details = { activeFrameCount: frameGeometry.count };
    throw error;
  }
  return {
    ...position,
    pageX: frameGeometry.contentLeft + position.clientX * frameGeometry.scaleX,
    pageY: frameGeometry.contentTop + position.clientY * frameGeometry.scaleY,
    topLevel,
  };
}

async function hostPointerSnapshot({
  editor,
  candidate,
  point,
  mode,
  expectedOperationStableId,
}) {
  return editor.evaluate((root, payload) => {
    const {
      stableId,
      hitPoint,
      probeMode,
      expectedOperationId,
    } = payload;
    const hit = document.elementFromPoint(hitPoint.pageX, hitPoint.pageY);
    if (hitPoint.topLevel) {
      return {
        accepted: hit?.closest("[data-pageroot-id]")?.getAttribute("data-pageroot-id") === stableId,
        hitKind: hit?.closest("[data-pageroot-id]") ? "authored-target" : hit?.localName || null,
      };
    }
    const activeFrame = root.querySelector('iframe[data-runtime-slot-role="active"]');
    const hint = hit?.closest?.('[data-testid="canvas-capability-hint"]');
    const activeGeneration = activeFrame?.getAttribute("data-frame-generation") || null;
    const hintTargetId = hint?.getAttribute("data-capability-target-id") || null;
    const hintTargetKey = hint?.getAttribute("data-capability-target-key") || null;
    const hintTargetDomGeneration = hint?.getAttribute(
      "data-capability-target-dom-generation",
    ) || null;
    const hintCurrentDomGeneration = hint?.getAttribute(
      "data-capability-current-dom-generation",
    ) || null;
    const hintActiveFrameGeneration = hint?.getAttribute(
      "data-capability-active-frame-generation",
    ) || null;
    const frameDocument = activeFrame?.contentDocument || null;
    const probeElement = frameDocument
      ? Array.from(frameDocument.querySelectorAll("[data-pageroot-id]"))
        .find((element) => element.getAttribute("data-pageroot-id") === stableId) || null
      : null;
    const hintedOperationElement = frameDocument && hintTargetId
      ? Array.from(frameDocument.querySelectorAll("[data-pageroot-id]"))
        .find((element) => element.getAttribute("data-pageroot-id") === hintTargetId) || null
      : null;
    const hintMapsProbeToOperation = Boolean(
      probeElement
      && hintedOperationElement
      && hintedOperationElement.contains(probeElement)
      && (probeMode === "discover"
        || hintTargetId === expectedOperationId),
    );
    const validGeneration = (value) => Boolean(
      typeof value === "string"
      && /^(?:0|[1-9]\d*)$/u.test(value)
      && Number.isSafeInteger(Number(value)),
    );
    const exactCapabilityHint = Boolean(
      activeFrame
      && hint
      && hintMapsProbeToOperation
      && hintTargetKey === `element:${hintTargetId}`
      && validGeneration(activeGeneration)
      && validGeneration(hintTargetDomGeneration)
      && validGeneration(hintCurrentDomGeneration)
      && validGeneration(hintActiveFrameGeneration)
      && hintTargetDomGeneration === hintCurrentDomGeneration
      && hintActiveFrameGeneration === activeGeneration
    );
    return {
      accepted: Boolean(activeFrame && (hit === activeFrame || exactCapabilityHint)),
      hitKind: hit === activeFrame
        ? "active-runtime-frame"
        : exactCapabilityHint
          ? "exact-capability-hint"
          : hint
            ? "capability-hint-identity-mismatch"
            : hit?.localName || null,
      activeGeneration,
      hintTargetId,
      hintTargetKey,
      hintTargetDomGeneration,
      hintCurrentDomGeneration,
      hintActiveFrameGeneration,
      hintedOperationContainsProbe: hintMapsProbeToOperation,
    };
  }, {
    stableId: candidate.stableId,
    hitPoint: point,
    probeMode: mode,
    expectedOperationId: expectedOperationStableId,
  });
}

export function canonicalSourceRelationship(sourceElements, probeStableId, operationStableId) {
  const elements = Array.isArray(sourceElements) ? sourceElements : [];
  const matches = (stableId) => elements.filter((element) => element?.pagerootId === stableId);
  const probeMatches = matches(probeStableId);
  const operationMatches = matches(operationStableId);
  const validProbe = CAPABILITY_STABLE_ID_PATTERN.test(probeStableId || "")
    && probeMatches.length === 1
    && probeMatches[0].pagerootIdentityStatus === "valid";
  const validOperation = CAPABILITY_STABLE_ID_PATTERN.test(operationStableId || "")
    && operationMatches.length === 1
    && operationMatches[0].pagerootIdentityStatus === "valid";
  let sourceAncestor = validProbe && validOperation;
  if (sourceAncestor && probeStableId !== operationStableId) {
    const byId = new Map();
    for (const element of elements) {
      if (!element?.pagerootId) continue;
      const group = byId.get(element.pagerootId) || [];
      group.push(element);
      byId.set(element.pagerootId, group);
    }
    let parentId = probeMatches[0].parentId || null;
    sourceAncestor = false;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      const parentMatches = byId.get(parentId) || [];
      if (
        parentMatches.length !== 1
        || parentMatches[0].pagerootIdentityStatus !== "valid"
      ) break;
      if (parentId === operationStableId) {
        sourceAncestor = true;
        break;
      }
      visited.add(parentId);
      parentId = parentMatches[0].parentId || null;
    }
  }
  return {
    validProbe,
    validOperation,
    sourceAncestor,
    probe: probeMatches[0] || null,
    operation: operationMatches[0] || null,
  };
}

export function capabilityObservationSnapshot(entry) {
  return {
    capabilityFamilies: [...(entry.capabilityFamilies || [])].sort(),
    behaviorFamilies: [...(entry.behaviorFamilies || [])].sort(),
    copyAvailability: entry.copyAvailability || null,
    copyReason: entry.copyReason || null,
    runtimeGenerated: entry.runtimeGenerated === true,
    tag: entry.tag || null,
    sourceEditable: entry.sourceEditable === true,
    region: entry.region || null,
    scrollContainer: entry.scrollContainer || null,
  };
}

export function normalizeCapabilityProbeObservations(
  observations,
  { allowConflicts = false } = {},
) {
  const preProbeRejectionReasons = new Set([
    "HIDDEN_ELEMENT",
    "LIVE_DUPLICATE_STABLE_ID",
    "NO_EXACT_HIT_POINT",
  ]);
  const passthrough = [];
  const groups = new Map();
  for (const observation of observations || []) {
    const canonicalObservation = (
      CAPABILITY_STABLE_ID_PATTERN.test(observation?.probeStableId || "")
      && CAPABILITY_STABLE_ID_PATTERN.test(observation?.operationStableId || "")
      && observation.stableId === observation.operationStableId
    );
    if (!canonicalObservation) {
      const explicitPreProbeRejection = (
        preProbeRejectionReasons.has(observation?.probeReason)
        && !observation?.probeStableId
        && !observation?.operationStableId
        && (observation?.capabilityFamilies?.length || 0) === 0
        && (observation?.behaviorFamilies?.length || 0) === 0
      );
      if (explicitPreProbeRejection) {
        passthrough.push(observation);
        continue;
      }
      const error = new Error("Capability observation is missing a valid canonical identity.");
      error.code = "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID";
      error.details = {
        stableId: observation?.stableId || null,
        probeStableId: observation?.probeStableId || null,
        operationStableId: observation?.operationStableId || null,
        probeReason: observation?.probeReason || null,
      };
      throw error;
    }
    const group = groups.get(observation.stableId) || [];
    group.push(observation);
    groups.set(observation.stableId, group);
  }
  const liveDom = [];
  const aliases = [];
  const conflicts = [];
  for (const [operationStableId, group] of groups) {
    const observationsByProbe = group.map((entry) => ({
      probeStableId: entry.probeStableId,
      snapshot: capabilityObservationSnapshot(entry),
    }));
    const signatures = new Set(observationsByProbe.map(({ snapshot }) => JSON.stringify(snapshot)));
    if (signatures.size > 1) {
      const conflict = {
        operationStableId,
        probeStableIds: group.map((entry) => entry.probeStableId),
        observations: observationsByProbe,
      };
      if (allowConflicts) {
        conflicts.push(conflict);
      } else {
      const error = new Error("Canonical probe aliases observed conflicting operation capabilities.");
      error.code = "CAPABILITY_PROBE_ALIAS_CAPABILITY_CONFLICT";
      error.details = conflict;
      throw error;
      }
    }
    group.sort((left, right) => (
      Number(right.probeStableId === operationStableId)
      - Number(left.probeStableId === operationStableId)
      || Number(left.probeSourceOrder ?? Number.MAX_SAFE_INTEGER)
      - Number(right.probeSourceOrder ?? Number.MAX_SAFE_INTEGER)
      || String(left.probeStableId || "").localeCompare(String(right.probeStableId || ""))
    ));
    liveDom.push(group[0]);
    for (const entry of group) {
      if (entry.probeStableId !== operationStableId) {
        aliases.push({
          probeStableId: entry.probeStableId,
          operationStableId,
        });
      }
    }
  }
  return { liveDom: [...passthrough, ...liveDom], aliases, conflicts };
}

function behaviorFamiliesFor(capabilities) {
  const families = new Set(["activation", "persistence", "stable-id"]);
  if (capabilities.includes("text")) {
    for (const family of ["input", "backspace", "delete-key", "enter", "selection-replace", "undo-redo", "paste", "source-scope"]) {
      families.add(family);
    }
  }
  if (capabilities.includes("format")) {
    for (const family of [
      "bold",
      "italic",
      "underline",
      "font-size",
      "text-color",
      "fill-color",
      "padding",
      "margin",
      "line-height",
    ]) families.add(family);
  }
  if (capabilities.includes("comment")) {
    for (const family of ["comment-create", "comment-edit", "comment-delete", "comment-reopen"]) families.add(family);
  }
  if (capabilities.includes("copy")) {
    for (const family of ["duplicate", "delete-duplicate"]) families.add(family);
    if (capabilities.includes("text")) families.add("edit-duplicate");
  }
  if (capabilities.some((value) => value.startsWith("move-"))) families.add("move");
  return [...families];
}

const RUNTIME_GENERATED_DISCOVERY_SELECTOR = [
  "table",
  "td",
  "th",
  "svg",
  "canvas",
  "[data-chart]",
  "[data-chart-root]",
  "[data-echarts]",
  "[role='img']",
].join(", ");

export function runtimeGeneratedDiagnosticsIssue(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_MISSING";
  }
  if (diagnostics.some((entry) => entry.truncated === true)) {
    return "RUNTIME_GENERATED_DISCOVERY_TRUNCATED";
  }
  if (diagnostics.some((entry) => entry.probeFailureCount > 0)) {
    return "RUNTIME_GENERATED_PROBE_FAILED";
  }
  if (diagnostics.some((entry) => entry.rejectedDiagnosticCount > 0)) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_INCOMPLETE";
  }
  return null;
}

export async function discoverRuntimeGeneratedTargets({ page, frame, editor, tabId = null }) {
  const candidates = frame.locator(RUNTIME_GENERATED_DISCOVERY_SELECTOR);
  const candidateCount = await candidates.count();
  const targets = [];
  const keys = new Set();
  const diagnostics = {
    candidateCount,
    truncated: candidateCount > 512,
    probedCount: 0,
    visibleCount: 0,
    runtimeGeneratedCount: 0,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 0,
    diagnosticTargetMismatchCount: 0,
    probeFailureCount: 0,
  };
  for (let index = 0; index < Math.min(candidateCount, 512); index += 1) {
    const target = candidates.nth(index);
    if (!await target.isVisible().catch(() => false)) continue;
    const box = await target.boundingBox();
    if (!box || box.width <= 2 || box.height <= 2) continue;
    diagnostics.visibleCount += 1;
    try {
      await page.keyboard.press("Escape");
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      if (await editor.getAttribute("data-selection-runtime-generated") !== null) {
        throw new Error("Selection diagnostics did not clear before the Runtime probe.");
      }
      await target.scrollIntoViewIfNeeded();
      await target.click({
        position: {
          x: Math.max(1, Math.min(box.width - 1, box.width / 2)),
          y: Math.max(1, Math.min(box.height - 1, box.height / 2)),
        },
      });
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      diagnostics.probedCount += 1;
    } catch {
      diagnostics.probeFailureCount += 1;
      continue;
    }
    const snapshot = await editor.evaluate((element) => ({
      runtimeGenerated: element.getAttribute("data-selection-runtime-generated"),
      generation: element.getAttribute("data-selection-runtime-generation"),
      sourceAnchorId: element.getAttribute("data-selection-runtime-source-anchor-id"),
      kind: element.getAttribute("data-selection-runtime-kind"),
      relativePath: element.getAttribute("data-selection-runtime-path"),
    }));
    if (snapshot.runtimeGenerated === null) {
      diagnostics.probeFailureCount += 1;
      continue;
    }
    if (snapshot.runtimeGenerated !== "true") continue;
    diagnostics.runtimeGeneratedCount += 1;
    if (
      !snapshot.generation
      || !snapshot.sourceAnchorId
      || !snapshot.kind
      || !snapshot.relativePath
    ) {
      diagnostics.rejectedDiagnosticCount += 1;
      continue;
    }
    const diagnosticMatchesCandidate = await target.evaluate((element, payload) => {
      const anchors = [...document.querySelectorAll("[data-pageroot-id]")].filter(
        (candidate) => candidate.getAttribute("data-pageroot-id") === payload.sourceAnchorId,
      );
      if (anchors.length !== 1) return false;
      let resolved = null;
      try {
        resolved = anchors[0].querySelector(payload.relativePath);
      } catch {
        return false;
      }
      return resolved === element || element.contains(resolved) || resolved?.contains(element) === true;
    }, snapshot);
    if (!diagnosticMatchesCandidate) {
      diagnostics.rejectedDiagnosticCount += 1;
      diagnostics.diagnosticTargetMismatchCount += 1;
      continue;
    }
    if (keys.has(snapshot.kind)) continue;
    keys.add(snapshot.kind);
    const key = [snapshot.sourceAnchorId, snapshot.kind, snapshot.relativePath].join(":");
    targets.push({
      targetKey: key,
      tabId,
      generation: snapshot.generation,
      sourceAnchorId: snapshot.sourceAnchorId,
      kind: snapshot.kind,
      relativePath: snapshot.relativePath,
      capabilityFamilies: ["comment"],
      deniedCapabilityFamilies: ["text", "format", "copy", "move", "delete"],
    });
    diagnostics.frozenTargetCount = targets.length;
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { targets, diagnostics };
}

async function authoredProbeSelectionSnapshot(frame, editor) {
  return {
    selectedMarkerCount: await frame.locator("[data-html-canvas-selected]").count(),
    visibleToolbarCount: await editor.getByRole("toolbar").filter({ visible: true }).count(),
  };
}

export async function resetAuthoredProbeSelection({ page, frame, editor }) {
  await page.keyboard.press("Escape");
  try {
    await expect.poll(
      () => authoredProbeSelectionSnapshot(frame, editor),
      { timeout: 2_000 },
    ).toEqual({ selectedMarkerCount: 0, visibleToolbarCount: 0 });
  } catch {
    const snapshot = await authoredProbeSelectionSnapshot(frame, editor);
    return {
      ok: false,
      reason: "PREVIOUS_SELECTION_OVERLAY_DID_NOT_CLOSE",
      ...snapshot,
    };
  }
  return {
    ok: true,
    reason: "PREVIOUS_SELECTION_CLEARED",
    ...(await authoredProbeSelectionSnapshot(frame, editor)),
  };
}

export async function probeAuthoredCapability({
  page,
  frame,
  editor,
  candidate,
  mode = "verify",
  sourceElements = [],
  selectedSnapshotReader = null,
}) {
  if (mode !== "discover" && mode !== "verify") {
    throw new Error(`Unknown capability probe mode: ${mode}`);
  }
  const expectedOperationStableId = candidate.expectedOperationStableId
    || candidate.stableId;
  const selectionReset = await resetAuthoredProbeSelection({ page, frame, editor });
  if (!selectionReset.ok) {
    const error = new Error("The previous capability selection overlay did not close.");
    error.code = "CAPABILITY_PROBE_SELECTION_NOT_CLEARED";
    error.details = { stableId: candidate.stableId, selectionReset };
    throw error;
  }
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(candidate.stableId)}]`);
  const count = await target.count();
  if (count !== 1) {
    const error = new Error("The frozen Stable ID did not resolve to exactly one live element.");
    error.code = count ? "CAPABILITY_PROBE_DUPLICATE_STABLE_ID" : "CAPABILITY_PROBE_STALE_STABLE_ID";
    error.details = { stableId: candidate.stableId, count };
    throw error;
  }
  const liveTag = await target.evaluate((element) => element.localName);
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const relocated = await target.evaluate((element) => ({
    stableId: element.getAttribute("data-pageroot-id"),
    tag: element.localName,
    connected: element.isConnected,
  }));
  if (
    relocated.stableId !== candidate.stableId
    || relocated.tag !== liveTag
    || !relocated.connected
  ) {
    const error = new Error("The frozen capability target changed during viewport preparation.");
    error.code = "CAPABILITY_PROBE_TARGET_CHANGED_DURING_SCROLL";
    error.details = { expectedStableId: candidate.stableId, expectedTag: liveTag, relocated };
    throw error;
  }
  const initialPoint = await pageSpaceAuthoredHitPoint({ frame, editor, target });
  if (!initialPoint) {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "NO_EXACT_HIT_POINT",
      selectionReset,
    };
  }
  let point = null;
  let hostPointer = null;
  let iframeHitStillExact = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    point = await pageSpaceAuthoredHitPoint({ frame, editor, target });
    if (!point) break;
    await page.mouse.move(point.pageX, point.pageY);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    hostPointer = await hostPointerSnapshot({
      editor,
      candidate,
      point,
      mode,
      expectedOperationStableId,
    });
    if (!hostPointer.accepted) break;
    iframeHitStillExact = await target.evaluate((element, hitPoint) => (
      element.ownerDocument.elementFromPoint(hitPoint.clientX, hitPoint.clientY)
        ?.closest("[data-pageroot-id]") === element
    ), point);
    if (iframeHitStillExact) break;
  }
  if (!point || !hostPointer?.accepted) {
    const error = new Error("A host overlay intercepted the real capability probe point.");
    error.code = "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED";
    error.details = {
      stableId: candidate.stableId,
      hitKind: hostPointer?.hitKind || "no-exact-hit-point",
      hostPointer,
    };
    throw error;
  }
  if (!iframeHitStillExact) {
    const error = new Error("The iframe target moved away from the verified capability probe point.");
    error.code = "CAPABILITY_PROBE_TARGET_MOVED_BEFORE_POINTER_DOWN";
    error.details = { stableId: candidate.stableId };
    throw error;
  }
  await page.mouse.down();
  await page.mouse.up();
  let selectedId = null;
  let selectedSnapshot = null;
  const readSelectedSnapshot = selectedSnapshotReader || (async () => (
    frame.locator("[data-html-canvas-selected]").evaluateAll((selectedElements, expectedStableId) => {
      const expectedElement = Array.from(document.querySelectorAll("[data-pageroot-id]"))
        .find((element) => element.getAttribute("data-pageroot-id") === expectedStableId) || null;
      const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
      const rect = selectedElement?.getBoundingClientRect() || null;
      const style = selectedElement ? getComputedStyle(selectedElement) : null;
      const documentHeight = Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        innerHeight,
      );
      const center = rect ? scrollY + rect.top + rect.height / 2 : null;
      let scrollContainer = "document";
      let ancestor = selectedElement?.parentElement || null;
      while (ancestor && ancestor !== document.body) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (/(?:auto|scroll)/u.test(`${ancestorStyle.overflowY} ${ancestorStyle.overflow}`)
          && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          scrollContainer = ancestor.getAttribute("data-pageroot-id") || "nested-authored-scroller";
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return {
        available: true,
        reasonCode: "SELECTION_SNAPSHOT_OBSERVED",
        selectedCount: selectedElements.length,
        selectedId: selectedElement?.getAttribute("data-pageroot-id") || null,
        selectedTag: selectedElement?.localName || null,
        selectedConnected: selectedElement?.isConnected === true,
        selectedVisible: Boolean(
          selectedElement
          && rect
          && style
          && rect.width > 1
          && rect.height > 1
          && style.display !== "none"
          && style.visibility !== "hidden",
        ),
        selectedInert: selectedElement?.closest("[inert]") != null,
        selectedRegion: center == null
          ? null
          : center < documentHeight / 3
            ? "top"
            : center < documentHeight * 2 / 3
              ? "middle"
              : "bottom",
        selectedScrollContainer: scrollContainer,
        selectedContainsExpected: Boolean(
          selectedElement && expectedElement && selectedElement.contains(expectedElement),
        ),
        expectedContainsSelected: Boolean(
          selectedElement && expectedElement && expectedElement.contains(selectedElement),
        ),
      };
    }, candidate.stableId)
  ));
  const unavailableSnapshot = () => ({
    available: false,
    reasonCode: "SELECTION_SNAPSHOT_UNAVAILABLE",
    selectedCount: null,
    selectedId: null,
    selectedTag: null,
    selectedConnected: false,
    selectedVisible: false,
    selectedInert: false,
    selectedRegion: null,
    selectedScrollContainer: null,
    selectedContainsExpected: false,
    expectedContainsSelected: false,
  });
  try {
    await expect.poll(async () => {
      selectedSnapshot = await readSelectedSnapshot().catch(unavailableSnapshot);
      selectedId = selectedSnapshot.selectedId;
      return mode === "discover"
        ? selectedSnapshot.available
          && selectedSnapshot.selectedCount === 1
          && CAPABILITY_STABLE_ID_PATTERN.test(selectedId || "")
        : selectedId;
    }, { timeout: 2_000 }).toBe(
      mode === "discover" ? true : expectedOperationStableId,
    );
  } catch {
    selectedSnapshot ||= await readSelectedSnapshot().catch(unavailableSnapshot);
    const error = new Error("The real pointer probe did not select the frozen Stable ID.");
    error.code = "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH";
    error.details = {
      expectedStableId: candidate.stableId,
      selectedId,
      selectedSnapshot,
      hostPointer,
      hitPoint: { x: point.pageX, y: point.pageY },
    };
    throw error;
  }
  const sourceRelationship = canonicalSourceRelationship(
    sourceElements,
    candidate.stableId,
    selectedId,
  );
  const sourceProofRequired = sourceElements.length > 0
    || mode === "discover"
    || selectedId !== candidate.stableId;
  const domAncestor = selectedId === candidate.stableId
    || selectedSnapshot?.selectedContainsExpected === true;
  const canonicalMappingValid = Boolean(
    selectedSnapshot?.available
    && selectedSnapshot.selectedCount === 1
    && selectedSnapshot.selectedConnected
    && !selectedSnapshot.selectedInert
    && domAncestor
    && (!sourceProofRequired || (
      sourceRelationship.validProbe
      && sourceRelationship.validOperation
      && sourceRelationship.sourceAncestor
    ))
  );
  const selectedStableIdCount = await frame.locator(
    `[data-pageroot-id=${JSON.stringify(selectedId)}]`,
  ).count();
  if (!canonicalMappingValid || selectedStableIdCount !== 1) {
    const error = new Error("The selected operation target was not the frozen authored target or its proven ancestor.");
    error.code = "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID";
    error.details = {
      probeStableId: candidate.stableId,
      expectedOperationStableId,
      selectedId,
      selectedStableIdCount,
      selectedSnapshot,
      sourceRelationship: {
        validProbe: sourceRelationship.validProbe,
        validOperation: sourceRelationship.validOperation,
        sourceAncestor: sourceRelationship.sourceAncestor,
      },
    };
    throw error;
  }
  const operationSourceEditable = sourceRelationship.operation?.sourceEditable
    ?? candidate.sourceEditable;
  const operationObservation = {
    ...candidate,
    stableId: selectedId,
    operationStableId: selectedId,
    probeStableId: candidate.stableId,
    probeTag: liveTag,
    probeSourceOrder: candidate.sourceOrder,
    tag: selectedSnapshot.selectedTag,
    sourceEditable: operationSourceEditable,
    parentId: sourceRelationship.operation?.parentId ?? candidate.parentId ?? null,
    sourceOrder: sourceRelationship.operation?.sourceOrder ?? candidate.sourceOrder,
    visible: selectedSnapshot.selectedVisible,
    isConnected: selectedSnapshot.selectedConnected,
    inert: selectedSnapshot.selectedInert,
    region: selectedSnapshot.selectedRegion,
    scrollContainer: selectedSnapshot.selectedScrollContainer,
  };

  const toolbar = editor.getByRole("toolbar").filter({ visible: true });
  try {
    // Selection's DOM marker can precede the React toolbar commit. This is an
    // observation boundary, not evidence that the selected element has no capabilities.
    await expect.poll(() => toolbar.count(), { timeout: 2_000 }).toBe(1);
  } catch (cause) {
    throw Object.assign(new Error("The selected target toolbar did not settle.", { cause }), {
      code: "CAPABILITY_PROBE_TOOLBAR_NOT_SETTLED",
      details: { selectedId, visibleToolbarCount: await toolbar.count() },
    });
  }
  const toolbarLabel = await toolbar.getAttribute("aria-label");
  const runtimeGenerated = Boolean(toolbarLabel?.startsWith("评论"));
  if (runtimeGenerated) {
    const error = new Error("An authored capability probe resolved to Runtime-generated content.");
    error.code = "CAPABILITY_PROBE_RUNTIME_GENERATED_OPERATION_TARGET";
    error.details = {
      probeStableId: candidate.stableId,
      operationStableId: selectedId,
    };
    throw error;
  }
  const enabled = async (name) => {
    const button = toolbar.getByRole("button", { name, exact: true });
    return await button.count() === 1 && await button.isEnabled().catch(() => false);
  };
  const capabilityFamilies = ["selection"];
  if (await toolbar.getByRole("button", { name: /留评论/u }).count()) capabilityFamilies.push("comment");
  if (!runtimeGenerated && operationSourceEditable && await enabled("编辑")) {
    capabilityFamilies.push("text", "format");
  }
  const copyAvailability = await editor.getAttribute("data-element-copy-availability");
  const copyReason = await editor.getAttribute("data-element-copy-reason");
  if (!runtimeGenerated && copyAvailability === "available" && await enabled("复制元素")) {
    capabilityFamilies.push("copy");
  }
  if (!runtimeGenerated && await enabled("上移")) capabilityFamilies.push("move-up");
  if (!runtimeGenerated && await enabled("下移")) capabilityFamilies.push("move-down");
  if (!runtimeGenerated && await toolbar.getByRole("button", { name: "删除元素", exact: true }).count()) {
    capabilityFamilies.push("delete");
  }
  return {
    ...operationObservation,
    runtimeGenerated,
    selectedId,
    capabilityFamilies,
    behaviorFamilies: behaviorFamiliesFor(capabilityFamilies),
    copyAvailability,
    copyReason,
    toolbarLabel,
    probeReason: "CAPABILITY_OBSERVED",
    selectionReset,
  };
}
