import { createSourceOperationId } from "../domain/source-history.js";
import { createSemanticElementPrecondition } from "../lib/semantic-operation-kernel.js";
import { createMoveElementOperation } from "../lib/source-structure-edit.js";
import { buildSourceTextMap, sourceSegmentsToTextRange } from "../lib/source-text-map.js";

// Canvas intent only. The kernel still validates and materializes each operation.
export function inlineStyleOperation(sourceIndex, options) {
  return {
    schemaVersion: 1,
    operationId: options.operationId || createSourceOperationId(),
    baseRevision: options.baseRevision,
    expectedSourceSha256: sourceIndex.sourceSha256,
    type: "setStyle",
    target: createSemanticElementPrecondition(sourceIndex, options.elementId),
    property: options.property,
    value: options.value,
    important: options.important,
  };
}

export function textRangeStyleOperation(sourceIndex, options) {
  const target = sourceIndex.byPagerootId.get(options.elementId);
  if (target?.type !== "element") {
    throw new Error("语义文字样式需要稳定源码元素。");
  }
  const textMap = buildSourceTextMap(sourceIndex, target.nodeId, { allowEmpty: true });
  const range = sourceSegmentsToTextRange(textMap, options.segments);
  return {
    schemaVersion: 1,
    operationId: options.operationId || createSourceOperationId(),
    baseRevision: options.baseRevision,
    expectedSourceSha256: sourceIndex.sourceSha256,
    type: "setStyle",
    target: createSemanticElementPrecondition(sourceIndex, options.elementId),
    property: options.property,
    value: options.value,
    important: options.important,
    range: {
      ...range,
      quote: textMap.text.slice(range.startOffset, range.endOffset),
    },
  };
}

export function editableIslandTextOperation(sourceIndex, options) {
  if (typeof options.text !== "string" || typeof options.contentHtml !== "string") {
    throw new TypeError("可编辑岛文字语义操作需要 text 与 canonical contentHtml。");
  }
  return {
    schemaVersion: 1,
    operationId: options.operationId || createSourceOperationId(),
    baseRevision: options.baseRevision,
    expectedSourceSha256: sourceIndex.sourceSha256,
    type: "setText",
    target: createSemanticElementPrecondition(sourceIndex, options.elementId),
    text: options.text,
    contentHtml: options.contentHtml,
  };
}

export function textRangeStyleCreatesWrapper(materialization) {
  return Array.isArray(materialization?.patches)
    && materialization.patches.some((patch) => patch?.kind === "text-range-style-open");
}

export function siblingReorderOperation(sourceIndex, options) {
  const target = sourceIndex.byPagerootId.get(options.elementId);
  const parent = target?.parentId
    ? sourceIndex.byNodeId.get(target.parentId)
    : null;
  if (target?.type !== "element" || parent?.type !== "element") {
    throw new Error("语义排序需要稳定源码父元素。");
  }
  const remaining = parent.childElementIds.filter((nodeId) => nodeId !== target.nodeId);
  if (!Number.isSafeInteger(options.toIndex) || options.toIndex < 0 || options.toIndex > remaining.length) {
    throw new Error("语义排序目标位置无效。");
  }
  const before = sourceIndex.byNodeId.get(remaining[options.toIndex]);
  return createMoveElementOperation(sourceIndex, {
    baseRevision: options.baseRevision,
    operationId: options.operationId,
    elementId: options.elementId,
    parentElementId: parent.pagerootId,
    beforeElementId: before?.pagerootId ?? null,
  });
}
