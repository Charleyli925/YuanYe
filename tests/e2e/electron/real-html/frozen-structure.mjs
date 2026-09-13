import { parse, parseFragment } from "parse5";
import { expect } from "@playwright/test";
import { keyShortcut, waitForRuntimeHandoffSettled } from "../electron-native-harness.mjs";
import { executeFrozenSelection, frozenDigest, frozenFrameAccess } from "./frozen-selection.mjs";
import { readFrozenActiveGeneration, requireCurrentTextDocument, requireFrozenTextFocus,
  requireTextOperationLedger, verifyFrozenHistory } from "./frozen-text.mjs";
import { compareElementScopedMutation, SOURCE_SCOPE_POLICIES } from "./source-scope.mjs";

const ID = /^pr1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u;
const failUnless = (condition, code, details) => {
  if (!condition) throw Object.assign(new Error(code), { code, details });
};
const idOf = node => node?.attrs?.find(attribute => attribute.name === "data-pageroot-id")?.value;
function byteChanges(before, after) {
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (suffix < Math.min(before.length, after.length) - start
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { before: { start, end: before.length - suffix }, after: { start, end: after.length - suffix } };
}
function sourceNodes(source) {
  const nodes = [];
  const visit = node => {
    if (node.tagName) nodes.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(source, { sourceCodeLocationInfo: true }));
  return nodes;
}

// Parse source to validate one predeclared insertion, never to choose a target.
// No production structure planner/materializer is used by this byte oracle.
export function bindFrozenCopy(beforeBytes, afterBytes, target) {
  const before = beforeBytes.toString("utf8"), after = afterBytes.toString("utf8");
  const nodes = sourceNodes(before), matches = nodes.filter(node => idOf(node) === target.selectedId);
  const original = matches.length === 1 ? matches[0] : null;
  const loc = original?.sourceCodeLocation, binding = target.copyBinding;
  const raw = loc ? before.slice(loc.startOffset, loc.endOffset) : "";
  const parent = original?.parentNode;
  const siblings = parent?.childNodes?.filter(node => node.tagName) || [];
  const next = siblings[siblings.indexOf(original) + 1];
  const insertion = next?.sourceCodeLocation?.startOffset ?? parent?.sourceCodeLocation?.endTag?.startOffset;
  const offset = binding.byteOffset, addedLength = afterBytes.length - beforeBytes.length;
  const insertedBytes = afterBytes.subarray(offset, offset + Math.max(addedLength, 0));
  const inserted = insertedBytes.toString("utf8");
  const fragment = parseFragment(inserted, { sourceCodeLocationInfo: true });
  const copy = fragment.childNodes.length === 1 ? fragment.childNodes[0] : null;
  const attr = loc?.attrs?.["data-pageroot-id"], copyAttr = copy?.sourceCodeLocation?.attrs?.["data-pageroot-id"];
  const identityFreeOriginal = attr ? before.slice(loc.startOffset, attr.startOffset)
    + before.slice(attr.endOffset, loc.endOffset) : null;
  // The kernel adds exactly one preceding space with the new identity attribute.
  const identityFreeCopy = copyAttr ? inserted.slice(0, copyAttr.startOffset - 1)
    + inserted.slice(copyAttr.endOffset) : null;
  const allAfter = sourceNodes(after), ids = allAfter.map(idOf).filter(Boolean);
  const copyId = idOf(copy);
  const conditions = {
    originalUnique: matches.length === 1,
    originalBytesMatch: frozenDigest(raw) === binding.originalElementSha256,
    originalLeaf: Boolean(original?.childNodes.length === 1 && original.childNodes[0].nodeName === "#text"),
    parentMatches: idOf(parent) === binding.parentId,
    siblingMatches: (idOf(next) || null) === binding.beforeSiblingId,
    offsetMatches: Number.isInteger(insertion) && Buffer.byteLength(before.slice(0, insertion)) === offset,
    positiveInsertion: addedLength > 0,
    prefixUnchanged: beforeBytes.subarray(0, offset).equals(afterBytes.subarray(0, offset)),
    suffixUnchanged: beforeBytes.subarray(offset).equals(afterBytes.subarray(offset + Math.max(addedLength, 0))),
    oneLeafInserted: Boolean(copy?.tagName === target.selectedTag && copy.childNodes.length === 1
      && copy.childNodes[0].nodeName === "#text" && copy.sourceCodeLocation?.startOffset === 0
      && copy.sourceCodeLocation?.endOffset === inserted.length),
    freshId: ID.test(copyId || "") && !nodes.some(node => idOf(node) === copyId),
    idsUnique: ids.length === new Set(ids).size,
    exactlyOneAdded: allAfter.length === nodes.length + 1,
    copyAttributeShape: Boolean(copyAttr && inserted[copyAttr.startOffset - 1] === " "
      && inserted.slice(copyAttr.startOffset, copyAttr.endOffset) === `data-pageroot-id="${copyId}"`),
    equivalentBytes: identityFreeOriginal !== null && identityFreeCopy === identityFreeOriginal,
    copyParentMatches: idOf(allAfter.find(node => idOf(node) === copyId)?.parentNode) === binding.parentId,
  };
  const changedRanges = { before: { start: offset, end: offset }, after: { start: offset, end: offset + addedLength } };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_COPY_SOURCE_INVALID",
    { conditions, changedRanges, actualChangedRanges: byteChanges(beforeBytes, afterBytes) });
  return { copyId, conditions, changedRanges };
}

export function verifyFrozenStructureLifecycle({ path, before, after, sourceHash, records }) {
  if (path === "runtime-candidate") {
    const lifecycle = verifyFrozenHistory({ expectedPath: path, before,
      after: { ...after, path }, sourceHash, records });
    const terminalConditions = { phaseSettled: after.phase === "settled", runtimeReady: after.outcome === "ready" };
    failUnless(Object.values(terminalConditions).every(Boolean), "FROZEN_STRUCTURE_RUNTIME_TERMINAL_INVALID",
      { conditions: terminalConditions, phase: after.phase, outcome: after.outcome });
    return { ...lifecycle, terminalConditions };
  }
  const conditions = {
    knownPath: path === "static-rebuild",
    documentChanged: Boolean(before.documentId && after.documentId && before.documentId !== after.documentId),
    generationChanged: Number(before.generation) > 0 && Number(after.generation) > Number(before.generation),
    sourceMatches: after.working === sourceHash && after.displayed === sourceHash,
    candidateAbsent: !records.some(row => row.kind === "candidate-created" || row.kind === "candidate-terminal"),
    staticTerminal: after.phase === "static" && after.outcome === "not-candidate",
  };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_STATIC_REBUILD_INVALID", { conditions, before, after });
  return { conditions, candidate: { state: "NOT_APPLICABLE", reason: "AUTHORED_STATIC_PAGE_NOT_RUNTIME_CANDIDATE" },
    generation: after.generation, runtime: "static:not-candidate" };
}

export async function readFrozenCopyCapability(editor, target, sourceBytes) {
  // Selection DOM and React's toolbar commit are separate signals. Wait only
  // for the one toolbar, never for a copy button that may correctly be absent.
  await expect(editor.getByRole("toolbar").filter({ visible: true })).toHaveCount(1, { timeout: 2_000 });
  const actual = await editor.evaluate(element => {
    const attr = name => element.getAttribute(name);
    const probeBefore = Number(attr("data-e2e-copy-probe-sequence") || 0);
    element.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe"));
    return { probeBefore, probeAfter: Number(attr("data-e2e-copy-probe-sequence")),
      ui: attr("data-element-copy-availability"), uiReason: attr("data-element-copy-reason"),
      uiDiagnostic: attr("data-element-copy-diagnostic"),
      live: attr("data-e2e-copy-live-availability"), liveReason: attr("data-e2e-copy-live-reason"),
      liveDiagnostic: attr("data-e2e-copy-live-diagnostic"), liveId: attr("data-e2e-copy-live-target-id"),
      sessionEnded: attr("data-e2e-copy-native-edit-ended"),
      candidateId: attr("data-runtime-candidate-id"),
      candidateCount: element.querySelectorAll('iframe[data-runtime-slot-role="candidate"]').length,
      working: attr("data-working-source-sha256"), displayed: attr("data-rendered-projection-sha256") };
  });
  const button = editor.getByRole("button", { name: "复制元素", exact: true });
  actual.buttonCount = await button.count();
  actual.buttonEnabled = actual.buttonCount === 1 && await button.isEnabled();
  actual.generation = await readFrozenActiveGeneration(editor);
  return verifyFrozenCopyCapability(actual, target, sourceBytes);
}

export function verifyFrozenCopyCapability(actual, target, sourceBytes) {
  const expected = target.copyCapability.expected === "AVAILABLE" ? "available" : "unsupported";
  const diagnostic = target.copyCapability.diagnostic ?? null;
  const conditions = { knownExpectation: ["AVAILABLE", "UNSUPPORTED"].includes(target.copyCapability.expected),
    probeFresh: Number.isInteger(actual.probeBefore) && actual.probeBefore >= 0 && actual.probeAfter === actual.probeBefore + 1,
    uiMatches: actual.ui === expected && actual.uiReason === target.copyCapability.reason,
    liveMatches: actual.live === expected && actual.liveReason === target.copyCapability.reason,
    diagnosticMatches: actual.uiDiagnostic === diagnostic && actual.liveDiagnostic === diagnostic,
    identityMatches: actual.liveId === target.selectedId,
    sessionEnded: actual.sessionEnded === "true", candidateAbsent: !actual.candidateId && actual.candidateCount === 0,
    sourceMatches: actual.working === `sha256:${frozenDigest(sourceBytes)}` && actual.displayed === actual.working,
    buttonMatches: expected === "available" ? actual.buttonCount === 1 && actual.buttonEnabled === true
      : actual.buttonCount === 0 && actual.buttonEnabled === false };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_COPY_CAPABILITY_MISMATCH", { conditions, actual });
  return { conditions, actual };
}

// Source-only witness verification; never discovers or substitutes a live target.
export function verifyFrozenDenialWitness(sourceBytes, target, live) {
  const html = sourceBytes.toString(), nodes = sourceNodes(html), proof = target.denialEvidence;
  const roots = nodes.filter(node => idOf(node) === target.selectedId);
  const witnesses = nodes.filter(node => idOf(node) === proof.witnessId);
  const root = roots[0], witness = witnesses[0], loc = root?.sourceCodeLocation;
  const ancestry = []; let cursor = witness;
  while (cursor && cursor !== root) {
    const parent = cursor.parentNode;
    // Copy diagnostics count maximal adjacent text runs, including whitespace.
    const children = (parent?.childNodes || []).filter(n => n.nodeName !== "#text" || n.value !== "");
    ancestry.unshift(`/${parent?.tagName}[${children.indexOf(cursor)}]`); cursor = parent;
  }
  const conditions = { uniqueRoot: roots.length === 1, uniqueWitness: witnesses.length === 1,
    rootBytesMatch: Boolean(loc) && frozenDigest(html.slice(loc.startOffset, loc.endOffset)) === proof.sourceElementSha256,
    witnessInRoot: Boolean(root && witness && cursor === root), witnessTagMatches: witness?.tagName === proof.witnessTag,
    diagnosticPathMatches: `root${ancestry.join("")}` === proof.diagnosticPath,
    liveIdentityMatches: live.count === 1 && live.id === proof.witnessId && live.tag === proof.witnessTag && live.connected === true };
  if (proof.kind === "attribute-extra") {
    conditions.sourceAttributeAbsent = Boolean(witness) && !witness.attrs.some(a => a.name.toLowerCase() === proof.attribute.toLowerCase());
    conditions.liveAttributeNonempty = typeof live.attributeValue === "string" && live.attributeValue.trim().length > 0;
  } else if (proof.kind === "empty-container-populated") {
    conditions.sourceContainerEmpty = witness?.childNodes.length === 0;
    conditions.liveChildrenPresent = Number.isInteger(live.childCount) && live.childCount > 0;
  } else conditions.opaqueCanvas = proof.kind === "opaque-canvas" && witness?.tagName === "canvas" && live.tag === "canvas";
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_DENIAL_WITNESS_MISMATCH", { conditions, proof, live,
    sourceRange: loc ? { start: loc.startOffset, end: loc.endOffset } : null });
  return { conditions, sourceRange: { start: loc.startOffset, end: loc.endOffset }, live };
}

// A denied UI action is not force-dispatched through a private product command.
export async function executeFrozenCopyDenied({ frame, target, editor, readSource, rows, calls }) {
  const row = rows[0], started = performance.now();
  row.expected = target.copyCapability;
  try {
    const before = await readSource(), html = before.toString();
    const matches = sourceNodes(html).filter(node => idOf(node) === target.selectedId);
    const node = matches.length === 1 ? matches[0] : null, loc = node?.sourceCodeLocation;
    const proof = target.denialEvidence;
    const boundary = target.copyCapability.basis === "REVIEWED_AUTHORED_COPY_BOUNDARY";
    const sourceConditions = { uniqueSource: matches.length === 1,
      exactSource: Boolean(loc) && frozenDigest(html.slice(loc.startOffset, loc.endOffset)) === proof.sourceElementSha256,
      ...(!boundary ? { attributeAbsentFromSource: Boolean(node) && !node.attrs.some(attr => attr.name === proof.attribute) } : {}) };
    failUnless(Object.values(sourceConditions).every(Boolean), "FROZEN_DENIAL_SOURCE_MISMATCH", { conditions: sourceConditions });
    const handle = await frozenFrameAccess(frame, target, calls).target(target.selectedId).elementHandle();
    const documentHandle = await frame.evaluateHandle(() => document);
    const generation = await readFrozenActiveGeneration(editor);
    try {
      let runtimeValue, witness;
      if (boundary) {
        // The witness ID was independently frozen from source review.
        calls.push({ kind: "fixed-denial-witness", id: proof.witnessId });
        const exact = frame.locator(`[data-pageroot-id="${proof.witnessId}"]`), count = await exact.count();
        const live = count === 1 ? await exact.evaluate((e, attribute) => ({ id: e.getAttribute("data-pageroot-id"),
          tag: e.localName, connected: e.isConnected, childCount: e.childNodes.length,
          attributeValue: attribute ? e.getAttribute(attribute) : null }), proof.attribute) : {};
        witness = verifyFrozenDenialWitness(before, target, { ...live, count });
      } else {
        runtimeValue = await handle.getAttribute(proof.attribute);
        failUnless(runtimeValue === proof.value, "FROZEN_DENIAL_RUNTIME_DRIFT", { expected: proof.value, actual: runtimeValue });
      }
      const capability = await readFrozenCopyCapability(editor, target, before);
      const document = await requireCurrentTextDocument(frame, documentHandle, handle);
      const unchanged = (await readSource()).equals(before);
      const sameGeneration = await readFrozenActiveGeneration(editor) === generation;
      failUnless(unchanged && sameGeneration, "DENIED_COPY_CHANGED_STATE", { conditions: { unchanged, sameGeneration } });
      row.actual = { sourceConditions, runtimeValue, witness, capability, document, unchanged, sameGeneration };
    } finally { await handle.dispose(); await documentHandle.dispose(); }
    Object.assign(row, { state: "PASS", reason: "FROZEN_COPY_REFUSAL_MATCHES_SOURCE_AND_RUNTIME" });
  } catch (error) {
    Object.assign(row, { state: "FAIL", reason: error.code || "DENIED_COPY_ASSERTION_FAILED", details: error.details });
    throw error;
  } finally { row.durationMs = performance.now() - started; }
  requireTextOperationLedger(rows, target.operations);
}

export function verifyFrozenEndedContinuation(actual) {
  const conditions = Object.fromEntries(["sessionEnded", "frameFocusIsBody", "targetNotEditable", "outerFocusSafe",
    "sourceUnchanged", "targetTextUnchanged", "generationUnchanged", "currentDocument"].map(key => [key, actual[key] === true]));
  conditions.noInputDelivered = Array.isArray(actual.inputEvents) && actual.inputEvents.length === 0;
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_DIRECT_CONTINUATION_MISMATCH", { conditions, actual });
  return { conditions, actual, mode: "session-ended-no-refocus" };
}

// One direct keyboard probe before any refocus. Observe input delivery rather
// than searching the document for the marker or guessing where it landed.
export async function probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker }) {
  const locator = frozenFrameAccess(frame, target, calls).target(target.selectedId);
  const handle = await locator.elementHandle(), documentHandle = await frame.evaluateHandle(() => document);
  const source = await readSource(), text = await handle.textContent(), generation = await readFrozenActiveGeneration(editor);
  const start = () => {
    const events = [];
    const listener = event => events.push({ type: event.type, tag: event.target?.localName,
      id: event.target?.getAttribute?.("data-pageroot-id") || null });
    document.addEventListener("beforeinput", listener, true); document.addEventListener("input", listener, true);
    globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__ = { events, stop: () => {
      document.removeEventListener("beforeinput", listener, true); document.removeEventListener("input", listener, true);
      delete globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__; return events;
    } };
  };
  const stop = () => {
    if (!globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__) throw new Error("FROZEN_INPUT_OBSERVER_MISSING");
    const events = globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__.stop();
    if (!Array.isArray(events)) throw new Error("FROZEN_INPUT_OBSERVER_INVALID");
    return events;
  };
  try {
    await editor.evaluate(element => element.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe")));
    const before = await handle.evaluate(element => ({ targetNotEditable: !element.isContentEditable,
      frameFocusIsBody: element.ownerDocument.activeElement === element.ownerDocument.body,
      frameFocusTag: element.ownerDocument.activeElement?.localName,
      frameFocusId: element.ownerDocument.activeElement?.getAttribute("data-pageroot-id") || null }));
    const outer = await page.evaluate(() => ({ tag: document.activeElement?.localName,
      safe: ["body", "iframe", "button"].includes(document.activeElement?.localName) && !document.activeElement?.isContentEditable }));
    before.sessionEnded = await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true";
    // An already wrong editable focus is sufficient failure; never type into it.
    const focusConditions = { sessionEnded: before.sessionEnded, frameFocusIsBody: before.frameFocusIsBody,
      targetNotEditable: before.targetNotEditable, outerFocusSafe: outer.safe };
    failUnless(Object.values(focusConditions).every(Boolean),
      "FROZEN_CONTINUATION_UNSAFE_FOCUS", { conditions: focusConditions, before, outer });
    await page.evaluate(start); await frame.evaluate(start);
    await page.keyboard.type(marker);
    const inputEvents = [...(await page.evaluate(stop)), ...(await frame.evaluate(stop))];
    const document = await requireCurrentTextDocument(frame, documentHandle, handle);
    return verifyFrozenEndedContinuation({ ...before, outerFocusSafe: outer.safe, outerFocusTag: outer.tag,
      sourceUnchanged: (await readSource()).equals(source), targetTextUnchanged: await handle.textContent() === text,
      generationUnchanged: await readFrozenActiveGeneration(editor) === generation,
      currentDocument: Object.values(document).every(Boolean), inputEvents });
  } finally {
    await page.evaluate(stop).catch(() => {}); await frame.evaluate(stop).catch(() => {});
    await handle.dispose(); await documentHandle.dispose();
  }
}

export async function executeFrozenStructure({ frame, target, page, editor, fileId, readSource, rows, calls }) {
  const baseline = await readSource();
  let currentBytes = baseline, copyTarget, copiedBytes, savedBytes;
  let handle, documentHandle;
  const marker = ` PRCOPY_${fileId}`;
  const originalText = await frozenFrameAccess(frame, target, calls).target(target.selectedId).textContent();
  const documentId = () => frame.evaluate(() => globalThis.__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__ ||= crypto.randomUUID());
  let generation = await readFrozenActiveGeneration(editor);
  const record = async (operation, expected, action) => {
    const row = rows.find(item => item.operation === operation), start = performance.now();
    row.expected = expected; row.targetId = operation === "copy" || operation.startsWith("probe-") ? target.selectedId : copyTarget.selectedId;
    try { row.actual = await action(); Object.assign(row, { state: "PASS", reason: "EXPECTED_CHANGE_OBSERVED" }); }
    catch (error) { Object.assign(row, { state: "FAIL", reason: error.code || "OPERATION_ASSERTION_FAILED", details: error.details }); throw error; }
    finally { row.durationMs = performance.now() - start; }
  };
  const selectCopy = async (priorSelectionId) => {
    const audit = [];
    try { return await executeFrozenSelection({ access: frozenFrameAccess(frame, copyTarget, audit),
      keyboard: page.keyboard, mouse: page.mouse, target: copyTarget, calls: audit, priorSelectionId }); }
    finally { calls.push(...audit); }
  };
  const rebuild = async (action, verifySource) => {
    const before = { generation, documentId: await documentId() };
    const cursor = await editor.evaluate(() => ({ candidate: globalThis.__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__.records.length,
      lifecycle: globalThis.__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__.lifecycleRecords.length }));
    await action();
    await expect.poll(async () => !(await readSource()).equals(currentBytes), { timeout: 5_000 }).toBe(true);
    const afterBytes = await readSource(), source = verifySource(afterBytes);
    const sourceHash = `sha256:${frozenDigest(afterBytes)}`;
    const settled = await waitForRuntimeHandoffSettled(page, { timeout: 7_000, expectedSourceRevision: sourceHash,
      priorGeneration: Number(generation), requireGenerationAdvance: true });
    const active = editor.locator('iframe[data-runtime-slot-role="active"]');
    failUnless(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
    frame = await (await active.elementHandle()).contentFrame();
    const records = await editor.evaluate((_element, cursor) => {
      const state = globalThis.__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__;
      return [...state.records.slice(cursor.candidate), ...state.lifecycleRecords.slice(cursor.lifecycle)];
    }, cursor);
    const runtime = verifyFrozenStructureLifecycle({ path: target.rebuildPath, before, sourceHash, records,
      after: { documentId: await documentId(), generation: settled.activeFrameGeneration,
        working: settled.workingProjectionSha256, displayed: settled.renderedProjectionSha256,
        phase: settled.runtimeSurfacePhase, outcome: settled.runtimeSurfaceOutcome } });
    currentBytes = afterBytes; generation = settled.activeFrameGeneration;
    return { source, runtime };
  };
  const sameDocument = async () => {
    await requireCurrentTextDocument(frame, documentHandle, handle);
    failUnless(await readFrozenActiveGeneration(editor) === generation, "UNEXPECTED_COPY_TEXT_REBUILD");
  };
  try {
    await record("copy", { newLeafAtByteOffset: target.copyBinding.byteOffset }, async () => {
      const capability = await readFrozenCopyCapability(editor, target, baseline);
      const result = await rebuild(() => editor.getByRole("button", { name: "复制元素", exact: true }).click({ timeout: 2_000 }), after => {
        const source = bindFrozenCopy(baseline, after, target);
        copyTarget = Object.freeze({ ...target, clickId: source.copyId, selectedId: source.copyId });
        calls.push({ kind: "operation-output-binding", from: target.selectedId, id: source.copyId,
          byteOffset: target.copyBinding.byteOffset });
        return source;
      });
      copiedBytes = currentBytes;
      failUnless(await editor.getAttribute("data-element-copy-command-availability") === "available"
        && await editor.getAttribute("data-element-copy-command-reason") === "available", "COPY_COMMAND_REFUSED");
      return { capability, ...result };
    });
    if (target.continuationProbe) await record("probe-after-copy", { mode: target.continuationProbe }, () =>
      probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker: `PRDIRECT_${fileId}_COPY` }));
    await record("select-copy", { id: copyTarget.selectedId }, () => selectCopy(target.selectedId));
    await record("activate-copy", { editableId: copyTarget.selectedId }, async () => {
      const locator = frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId);
      handle = await locator.elementHandle(); documentHandle = await frame.evaluateHandle(() => document);
      const position = await handle.evaluate(element => {
        if (element.childNodes.length !== 1 || element.firstChild.nodeType !== 3) return null;
        const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1);
        const rect = range.getBoundingClientRect(), outer = element.getBoundingClientRect();
        return { x: rect.left - outer.left + rect.width / 2, y: rect.top - outer.top + rect.height / 2 };
      });
      failUnless(position, "COPY_PLAIN_LEAF_DRIFT");
      await handle.dblclick({ position, timeout: 2_000 });
      await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
      await page.keyboard.press(keyShortcut("ArrowDown"));
      await sameDocument();
      return requireFrozenTextFocus(handle, copyTarget.selectedId, { atEnd: true });
    });
    await record("input-copy", { appended: marker }, async () => {
      await sameDocument(); await requireFrozenTextFocus(handle, copyTarget.selectedId, { atEnd: true });
      await page.keyboard.type(marker);
      failUnless(await handle.textContent() === `${originalText}${marker}`, "FROZEN_COPY_INPUT_LANDING_MISMATCH");
      await sameDocument(); return { appended: marker, id: copyTarget.selectedId };
    });
    await record("save-copy", { sourceContains: marker, originalUnchanged: true }, async () => {
      await page.keyboard.press(keyShortcut("s"));
      await expect.poll(async () => (await readSource()).includes(marker), { timeout: 5_000 }).toBe(true);
      savedBytes = await readSource();
      const oracle = compareElementScopedMutation({ before: copiedBytes, after: savedBytes, sourceId: copyTarget.selectedId,
        normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE, expectedAfterContains: [marker],
        expectedAppendedPattern: new RegExp(marker, "u") });
      failUnless(oracle.ok, "SOURCE_SCOPE_ORACLE_FAILED", oracle);
      await sameDocument(); currentBytes = savedBytes;
      return { outsideUnchanged: oracle.outsideUnchanged, changedRanges: oracle.changedRanges };
    });
    await record("select-copy-for-delete", { id: copyTarget.selectedId }, async () => {
      await page.keyboard.press("Escape");
      await editor.evaluate(element => element.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe")));
      failUnless(await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true", "COPY_EDIT_SESSION_NOT_ENDED");
      return selectCopy(copyTarget.selectedId);
    });
    await record("delete-copy", { sourceRestored: frozenDigest(baseline) }, async () => {
      const result = await rebuild(async () => {
        page.once("dialog", dialog => dialog.accept());
        await editor.getByRole("button", { name: "删除元素", exact: true }).click({ timeout: 2_000 });
      }, after => {
        const restored = after.equals(baseline);
        failUnless(restored, "DELETE_COPY_SOURCE_NOT_RESTORED", { restored,
          expectedSha256: frozenDigest(baseline), actualSha256: frozenDigest(after),
          actualChangedRanges: byteChanges(currentBytes, after), remainingChanges: byteChanges(baseline, after) });
        return { restored };
      });
      failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 0, "DELETED_COPY_STILL_PRESENT");
      const original = frozenFrameAccess(frame, target, calls).target(target.selectedId);
      failUnless(await original.count() === 1 && await original.textContent() === originalText, "ORIGINAL_IDENTITY_CHANGED");
      return result;
    });
    if (target.continuationProbe) await record("probe-after-delete", { mode: target.continuationProbe }, () =>
      probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker: `PRDIRECT_${fileId}_DELETE` }));
    requireTextOperationLedger(rows, target.operations);
    return { finalSha256: frozenDigest(currentBytes), finalSize: currentBytes.length, originalText, copyId: copyTarget.selectedId };
  } finally { await handle?.dispose(); await documentHandle?.dispose(); }
}
