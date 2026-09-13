import { expect } from "@playwright/test";
import { parse } from "parse5";
import { executeFrozenSelection, frozenFrameAccess, frozenDigest, FROZEN_TEXT_OPERATIONS, FROZEN_REENTRY_FORMAT_OPERATIONS,
  verifyFrozenBytes, verifyFrozenDisplay } from "./frozen-selection.mjs";
import { executeFrozenText, requireTextOperationLedger } from "./frozen-text.mjs";
import { executeFrozenStructure } from "./frozen-structure.mjs";

function requireFact(condition, code, details) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

// Bind evolving bytes, never discover a target. The caller supplies only source
// snapshots already verified by completed operations and the original frozen IDs.
export function bindMixedSource(baseline, current, text, structure) {
  const locate = bytes => {
    const source = bytes.toString(), found = [];
    const visit = node => {
      if (node.attrs?.some(a => a.name === "data-pageroot-id" && a.value === text.selectedId)) found.push(node);
      for (const child of node.childNodes || []) visit(child);
      if (node.content) visit(node.content);
    };
    visit(parse(source, { sourceCodeLocationInfo: true }));
    requireFact(found.length === 1 && found[0].tagName === text.selectedTag && found[0].sourceCodeLocation,
      "FROZEN_MIXED_SOURCE_IDENTITY_INVALID");
    const node = found[0], loc = node.sourceCodeLocation;
    return { node, start: Buffer.byteLength(source.slice(0, loc.startOffset)),
      end: Buffer.byteLength(source.slice(0, loc.endOffset)) };
  };
  const before = locate(baseline), after = locate(current), offset = structure.copyBinding.byteOffset;
  const conditions = {
    prefixUnchanged: baseline.subarray(0, before.start).equals(current.subarray(0, after.start)),
    suffixUnchanged: baseline.subarray(before.end).equals(current.subarray(after.end)),
    separateStructure: offset <= before.start || offset >= before.end,
  };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_MIXED_SOURCE_SCOPE_DRIFT", conditions);
  const rebound = { ...text };
  if (text.textEntry) {
    const originalEntry = text.textEntry.path.reduce((node, index) => node?.childNodes[index], before.node);
    requireFact(originalEntry?.nodeName === "#text" && frozenDigest(originalEntry.value) === text.textEntry.textSha256,
      "FROZEN_MIXED_BASELINE_ENTRY_DRIFT");
    const node = text.textEntry.path.reduce((node, index) => node?.childNodes[index], after.node);
    requireFact(node?.nodeName === "#text", "FROZEN_MIXED_ENTRY_PATH_DRIFT");
    rebound.textEntry = { ...text.textEntry, textSha256: frozenDigest(node.value) };
  }
  if (text.selectedId === structure.selectedId)
    requireFact(frozenDigest(baseline.subarray(before.start, before.end)) === structure.copyBinding.originalElementSha256,
      "FROZEN_MIXED_BASELINE_STRUCTURE_DRIFT");
  return { text: rebound, structure: { ...structure, copyBinding: { ...structure.copyBinding,
    originalElementSha256: text.selectedId === structure.selectedId
      ? frozenDigest(current.subarray(after.start, after.end)) : structure.copyBinding.originalElementSha256,
    byteOffset: offset + (offset >= before.end ? current.length - baseline.length : 0) } }, conditions };
}

export const frozenRows = (operations, targetId) => operations.map(operation => ({ operation, targetId,
  state: "NOT_EXECUTED", reason: "DEPENDENCY_NOT_COMPLETED", durationMs: null }));

export const mixedCheckpointOperations = plan => ["reopen-cumulative",
  ...Array.from({ length: plan.cycles }, (_, index) => `delete-comment-${index + 1}`)];
const continuationOperations = target => target.historyResume === "explicit-reentry"
  ? FROZEN_REENTRY_FORMAT_OPERATIONS.slice(0, -2) : FROZEN_TEXT_OPERATIONS;

export function verifyMixedMarkers(content, fileId, count, newline) {
  const conditions = Array.from({ length: count }, (_, index) => {
    const suffix = `${fileId}_C${index + 1}`, marker = `PRCORE_${suffix}`;
    return { cycle: index + 1, editedTextRetained: content.includes(`${marker}${newline ? `PRLINE_${suffix}` : " "}`),
      continuationRetained: content.includes(`${marker}_RESUME`) };
  });
  requireFact(conditions.every(c => c.editedTextRetained && c.continuationRetained), "FROZEN_CUMULATIVE_TEXT_LOST", { conditions });
  return conditions;
}

export function mixedCycleRows(plan) {
  const [text, structure] = plan.targets;
  return Array.from({ length: plan.cycles }, (_, index) => ({ cycle: index + 1,
    control: frozenRows(["select-text", "create-comment", "select-structure", "resume-text", "verify-cycle"], text.selectedId)
      .map(row => ({ ...row, targetId: row.operation === "select-structure" ? structure.selectedId : text.selectedId })),
    text: frozenRows(text.operations, text.selectedId), structure: frozenRows(structure.operations, structure.selectedId),
    continuation: frozenRows(continuationOperations(text), text.selectedId) }));
}

export function verifyFrozenComment(comment, expected) {
  const conditions = {
    exactCommentId: typeof expected.commentId === "string" && expected.commentId.length > 0
      && comment?.commentId === expected.commentId,
    exactText: comment?.text === expected.text,
    exactSourceAnchor: comment?.sourceAnchor?.elementId === expected.targetId,
    exactResolution: comment?.sourceAnchor?.resolution === "exact",
  };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_COMMENT_IDENTITY_MISMATCH", conditions);
  return { commentId: expected.commentId, targetId: expected.targetId, conditions };
}

export function verifyFreshCommentStorage(state, fileExists) {
  const conditions = { exactWorkingCopy: state.workingCopyId === "work_ver_0001",
    exactDraftPath: state.draftRelativePath === "drafts/work_ver_0001.json",
    zeroRevision: state.draftRevision === 0, noPublishedHash: state.draftSha256 === null,
    fileAbsent: fileExists === false };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_INITIAL_COMMENT_STORAGE_INVALID", conditions);
  return conditions;
}

async function record(rows, operation, action) {
  const row = rows.find(item => item.operation === operation), started = performance.now();
  requireFact(row && row.state === "NOT_EXECUTED", "FROZEN_OPERATION_LEDGER_INVALID");
  try {
    row.actual = await action(); Object.assign(row, { state: "PASS", reason: "EXPECTED_CHANGE_OBSERVED" });
    return row.actual;
  } catch (error) {
    Object.assign(row, { state: "FAIL", reason: error.code || "OPERATION_ASSERTION_FAILED", details: error.details });
    throw error;
  } finally { row.durationMs = performance.now() - started; }
}

async function activeFrame(editor) {
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  requireFact(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
  const frame = await (await active.elementHandle()).contentFrame();
  requireFact(frame, "FROZEN_ACTIVE_FRAME_MISSING");
  return frame;
}

async function select(page, frame, target, calls, priorSelectionId) {
  const localCalls = [], access = frozenFrameAccess(frame, target, localCalls);
  try { return await executeFrozenSelection({ page, access, target, calls: localCalls, keyboard: page.keyboard, mouse: page.mouse, priorSelectionId }); }
  finally { calls.push(...localCalls); }
}

export async function verifyMixedComments(readComments, comments) {
  const stored = await readComments();
  requireFact(Array.isArray(stored) && stored.length === comments.length, "FROZEN_COMMENT_COLLECTION_MISMATCH",
    { expectedCount: comments.length, actualCount: stored?.length });
  const facts = [];
  for (const expected of comments) {
    const matches = stored.filter(comment => comment.commentId === expected.commentId);
    requireFact(matches.length === 1, "FROZEN_COMMENT_ID_NOT_UNIQUE");
    facts.push(verifyFrozenComment(matches[0], expected));
  }
  return facts;
}

export async function verifyFrozenCommentCard(page, expected) {
  const card = page.locator(`.comment-card[data-comment-measure="${expected.commentId}"]`);
  await expect(card).toHaveCount(1, { timeout: 2_000 });
  await expect(card).toHaveAttribute("data-resolution", "exact", { timeout: 2_000 });
  await expect(card).toContainText(expected.text, { timeout: 2_000 });
  return card;
}

// Scroll only toward the already-bound comment ID; never choose another card,
// force virtualization off, or read a private presentation/controller store.
export async function revealFrozenCommentCard(page, expected, reset = false) {
  const rail = page.locator('aside[aria-label="本轮评论"]');
  const stage = page.locator(".review-scroll-stage");
  const card = page.locator(`.comment-card[data-comment-measure="${expected.commentId}"]`);
  async function wheel(delta) {
    const r = await rail.boundingBox(), s = await stage.boundingBox();
    requireFact(r && s, "FROZEN_COMMENT_SCROLL_SURFACE_MISSING");
    await page.mouse.move(r.x + r.width / 2, (Math.max(r.y, s.y) + Math.min(r.y + r.height, s.y + s.height)) / 2);
    await page.mouse.wheel(0, delta);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  if (reset) await wheel(-1_000_000);
  for (let step = 0; step < 80; step += 1) {
    const count = await card.count(); requireFact(count <= 1, "FROZEN_COMMENT_CARD_DUPLICATE");
    const box = count === 1 ? await card.boundingBox() : null;
    let delta = 600;
    if (box) {
      const r = await rail.boundingBox(), s = await stage.boundingBox();
      const header = await rail.locator(".comments-header").boundingBox();
      requireFact(r && s && header, "FROZEN_COMMENT_SCROLL_SURFACE_MISSING");
      const top = Math.max(r.y, s.y, header.y + header.height), bottom = Math.min(r.y + r.height, s.y + s.height);
      const center = box.y + box.height / 2;
      if (center > top + 8 && center < bottom - 8) return verifyFrozenCommentCard(page, expected);
      delta = Math.max(-600, Math.min(600, center - (top + bottom) / 2));
    }
    await wheel(delta);
  }
  requireFact(false, "FROZEN_COMMENT_REVEAL_EXHAUSTED", { commentId: expected.commentId, wheelSteps: 80 });
}

export async function revealFrozenCommentDelete(card) {
  await expect(card).toHaveCount(1, { timeout: 2_000 });
  // Comment tools are intentionally pointer-events:none until the card is
  // hovered/focused. A user's hover is required; never force-click hidden tools.
  await card.hover({ timeout: 2_000 });
  const button = card.getByRole("button", { name: "删除评论", exact: true });
  await expect(button).toHaveCount(1, { timeout: 2_000 });
  await expect.poll(() => button.evaluate(element => getComputedStyle(element).pointerEvents),
    { timeout: 2_000 }).toBe("auto");
  return button;
}

// Three predeclared cycles, two fixed authored targets. Copy IDs are exclusively
// operation outputs proven by bindFrozenCopy; no target discovery is imported.
export async function executeFrozenMixed({ plan, page, editor, readSource, readComments, report, calls }) {
  const [textTarget, structureTarget] = plan.targets;
  let frame = await activeFrame(editor), finalSource;
  const baseline = await readSource();
  let verifiedSource = baseline;
  let priorBookmark = null;
  report.comments = []; report.copyIds = [];
  for (const cycle of report.cycles) {
    const markerId = `${plan.fileId}_C${cycle.cycle}`;
    // Later initial bold is the preceding verified operation's promised result,
    // not an expectation inferred from current DOM or live capability.
    verifyFrozenBytes(await readSource(), { sha256: frozenDigest(verifiedSource), size: verifiedSource.length }, "FROZEN_MIXED_CHECKPOINT_DRIFT");
    const binding = plan.sourceEvolution ? bindMixedSource(baseline, verifiedSource, textTarget, structureTarget) : { text: textTarget };
    const target = Object.freeze({ ...binding.text, initialBold: cycle.cycle === 1 ? textTarget.initialBold : true });
    await record(cycle.control, "select-text", () => select(page, frame, target, calls,
      cycle.cycle === 1 ? null : target.selectedId));
    await executeFrozenText({ frame, target, access: frozenFrameAccess(frame, target, calls), page, editor,
      fileId: markerId, readSource, rows: cycle.text, calls,
      undoBookmark: plan.sourceEvolution && textTarget.historyAdoption === "editable-island-in-place" ? priorBookmark : null });
    frame = await activeFrame(editor); // Text executor has independently verified history adoption.
    verifiedSource = await readSource();
    const nextBinding = plan.sourceEvolution ? bindMixedSource(baseline, verifiedSource, textTarget, structureTarget)
      : { text: target, structure: structureTarget };
    await record(cycle.control, "create-comment", async () => {
      const before = await readSource(), text = `PRCOMMENT_${markerId}`;
      const selected = frame.locator("[data-html-canvas-selected]");
      await expect(selected).toHaveCount(1); await expect(selected).toHaveAttribute("data-pageroot-id", target.selectedId);
      const button = editor.getByRole("button", { name: /留评论/u });
      await expect(button).toHaveCount(1); await button.click({ timeout: 2_000 });
      const composer = page.getByRole("region", { name: "添加评论" });
      await composer.getByRole("textbox", { name: "评论内容" }).fill(text);
      await composer.getByRole("button", { name: "评论", exact: true }).click();
      let matches;
      await expect.poll(async () => {
        matches = (await readComments()).filter(comment => comment.text === text);
        return matches.length;
      }, { timeout: 5_000 }).toBe(1);
      const commentId = matches[0].commentId;
      requireFact(/^[a-zA-Z0-9_-]+$/u.test(commentId), "FROZEN_COMMENT_ID_INVALID");
      const expected = { commentId, text, targetId: target.selectedId };
      const fact = verifyFrozenComment(matches[0], expected);
      await verifyFrozenCommentCard(page, expected);
      report.comments.push(expected);
      verifyFrozenBytes(await readSource(), { sha256: frozenDigest(before), size: before.length }, "COMMENT_CHANGED_SOURCE");
      return fact;
    });
    await record(cycle.control, "select-structure", async () => {
      const source = await readSource();
      if (!plan.sourceEvolution) requireFact(frozenDigest(source.subarray(0, structureTarget.copyBinding.byteOffset)) === plan.structurePrefixSha256,
        "FROZEN_STRUCTURE_PREFIX_DRIFT");
      else verifyFrozenBytes(source, { sha256: frozenDigest(verifiedSource), size: verifiedSource.length }, "FROZEN_MIXED_CHECKPOINT_DRIFT");
      return select(page, frame, structureTarget, calls, target.selectedId);
    });
    const structure = await executeFrozenStructure({ frame, target: nextBinding.structure, page, editor,
      fileId: markerId, readSource, rows: cycle.structure, calls });
    report.copyIds.push(structure.copyId);
    frame = await activeFrame(editor); // Only after proven Candidate/generation/terminal and direct-focus probe.
    await record(cycle.control, "resume-text", () => select(page, frame, nextBinding.text, calls, null));
    const continuation = Object.freeze({ ...nextBinding.text, operations: continuationOperations(nextBinding.text) });
    await executeFrozenText({ frame, target: continuation, access: frozenFrameAccess(frame, continuation, calls), page,
      editor, fileId: `${markerId}_RESUME`, readSource, rows: cycle.continuation, calls });
    frame = await activeFrame(editor);
    priorBookmark = cycle.continuation.find(row => row.operation === "redo")?.actual?.focus || null;
    if (plan.sourceEvolution && textTarget.historyAdoption === "editable-island-in-place")
      requireFact(priorBookmark, "FROZEN_PRIOR_BOOKMARK_MISSING");
    await record(cycle.control, "verify-cycle", async () => {
      finalSource = await readSource();
      verifiedSource = finalSource;
      const expected = { sha256: frozenDigest(finalSource), size: finalSource.length };
      const display = verifyFrozenDisplay({ working: await editor.getAttribute("data-working-source-sha256"),
        displayed: await editor.getAttribute("data-rendered-projection-sha256") }, expected);
      const markers = Array.from({ length: cycle.cycle }, (_, index) => `PRCORE_${plan.fileId}_C${index + 1}`);
      const target = frozenFrameAccess(frame, textTarget, calls).target(textTarget.selectedId);
      const content = await target.textContent();
      verifyMixedMarkers(content, plan.fileId, cycle.cycle, textTarget.operations.includes("enter-and-continue"));
      return { cycle: cycle.cycle, display, retainedMarkers: markers.length * 2,
        comments: await verifyMixedComments(readComments, report.comments) };
    });
    for (const rows of [cycle.control, cycle.text, cycle.structure, cycle.continuation])
      requireTextOperationLedger(rows, rows.map(row => row.operation));
  }
  return { sha256: frozenDigest(finalSource), size: finalSource.length };
}

export async function finishFrozenMixed({ plan, page, editor, readSource, readComments, report, expectedFinal, calls }) {
  const frame = await activeFrame(editor), target = frozenFrameAccess(frame, plan.targets[0], calls).target(plan.targets[0].selectedId);
  await record(report.checkpoint, "reopen-cumulative", async () => {
    await expect(target).toHaveCount(1);
    requireFact(await target.evaluate(element => element.localName) === plan.targets[0].selectedTag, "FROZEN_IDENTITY_TAG_MISMATCH");
    for (let cycle = 1; cycle <= plan.cycles; cycle += 1)
      await expect(target).toContainText(`PRCORE_${plan.fileId}_C${cycle}_RESUME`);
    for (const copyId of report.copyIds) await expect(frame.locator(`[data-pageroot-id="${copyId}"]`)).toHaveCount(0);
    const source = verifyFrozenBytes(await readSource(), expectedFinal, "REOPEN_SOURCE_CHANGED");
    return { source, comments: await verifyMixedComments(readComments, report.comments) };
  });
  for (let index = 0; index < report.comments.length; index += 1) {
    const comment = report.comments[index];
    await record(report.checkpoint, `delete-comment-${index + 1}`, async () => {
      const card = await revealFrozenCommentCard(page, comment, index === 0);
      await (await revealFrozenCommentDelete(card)).click({ timeout: 2_000 });
      await card.getByRole("button", { name: "删除", exact: true }).click({ timeout: 2_000 });
      await expect(card).toHaveCount(0);
      await expect.poll(async () => (await readComments()).some(item => item.commentId === comment.commentId),
        { timeout: 5_000 }).toBe(false);
      verifyFrozenBytes(await readSource(), expectedFinal, "COMMENT_DELETE_CHANGED_SOURCE");
      return { deletedCommentId: comment.commentId, remaining: report.comments.length - index - 1 };
    });
  }
  requireFact((await readComments()).length === 0, "FROZEN_COMMENT_DELETE_INCOMPLETE");
  requireTextOperationLedger(report.checkpoint, mixedCheckpointOperations(plan));
}
