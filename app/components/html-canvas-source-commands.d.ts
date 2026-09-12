import type { SemanticOperation } from "../lib/semantic-operation-kernel.js";
import type { SourceTextSegment } from "../lib/source-text-map.js";
import type { SourceIndexValue } from "./html-canvas-internal-types";

type OperationOptions = {
  elementId: string;
  baseRevision: number;
  operationId?: string;
};

export function inlineStyleOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & { property: string; value: string; important: boolean },
): Extract<SemanticOperation, { type: "setStyle" }>;

export function textRangeStyleOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & {
    segments: readonly SourceTextSegment[];
    property: string;
    value: string;
    important: boolean;
  },
): Extract<SemanticOperation, { type: "setStyle" }>;

export function editableIslandTextOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & { text: string; contentHtml: string },
): Extract<SemanticOperation, { type: "setText" }>;

export function textRangeStyleCreatesWrapper(
  materialization: { patches: readonly { kind?: string }[] },
): boolean;

export function siblingReorderOperation(
  sourceIndex: SourceIndexValue,
  options: OperationOptions & { toIndex: number },
): Extract<SemanticOperation, { type: "moveElement" }>;
