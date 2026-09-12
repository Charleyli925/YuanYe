export declare const SEMANTIC_OPERATION_SCHEMA_VERSION: 1;

export interface SemanticElementPrecondition {
  elementId: string;
  tagName: string;
  expectedOuterHtmlSha256: string;
}

interface SemanticOperationEnvelope {
  schemaVersion: 1;
  operationId: string;
  baseRevision: number;
  expectedSourceSha256: string;
}

export type SemanticOperation = SemanticOperationEnvelope & (
  | {
    type: "setText";
    target: SemanticElementPrecondition;
    text: string;
    contentHtml?: string;
    createdPagerootIds?: string[];
  }
  | {
    type: "replaceTextRange";
    target: SemanticElementPrecondition;
    range: { startOffset: number; endOffset: number; quote: string };
    text: string;
  }
  | {
    type: "setAttribute";
    target: SemanticElementPrecondition;
    name: string;
    value: string | null;
  }
  | {
    type: "setStyle";
    target: SemanticElementPrecondition;
    property: string;
    value: string;
    important: boolean;
    range?: { startOffset: number; endOffset: number; quote: string };
    createdPagerootIds?: string[];
  }
  | {
    type: "insertElement";
    parent: SemanticElementPrecondition;
    before: SemanticElementPrecondition | null;
    html: string;
  }
  | { type: "deleteElement"; target: SemanticElementPrecondition }
  | {
    type: "moveElement";
    target: SemanticElementPrecondition;
    parent: SemanticElementPrecondition;
    before: SemanticElementPrecondition | null;
  }
  | { type: "replaceSubtree"; target: SemanticElementPrecondition; html: string }
);

export interface GeneratedSemanticInverseOperation extends SemanticOperationEnvelope {
  readonly type: "restoreExactSource";
}

export interface SemanticLineageEntry {
  operationId: string;
  type: string;
  baseRevision: number;
  nextRevision: number;
  beforeSourceSha256: string;
  afterSourceSha256: string;
}

export interface SemanticDocumentState {
  schemaVersion: 1;
  revision: number;
  sourceSha256: string;
  html: string;
  lineage: SemanticLineageEntry[];
}

export interface SemanticOperationResult {
  changed: boolean;
  html: string;
  sourceSha256: string;
  previousSourceSha256: string;
  baseRevision: number;
  nextRevision: number;
  lineageEntry: SemanticLineageEntry;
  inverseOperation: GeneratedSemanticInverseOperation;
  nextState: SemanticDocumentState;
  allocatedElementIds?: string[];
  insertedRootElementId?: string;
  identityDelta?: SemanticIdentityDelta;
  materialization: {
    kind: "source-patch" | "trusted-exact-source-restore";
    planType?: string;
    [key: string]: unknown;
  };
}

export interface SemanticIdentityDelta {
  schemaVersion: 1;
  operationId: string;
  operationType: SemanticOperation["type"];
  direction: "forward" | "undo" | "redo";
  targetElementId: string | null;
  parentElementId: string | null;
  beforeElementId: string | null;
  retainedTargetRootElementId: string | null;
  addedElementIds: readonly string[];
  removedElementIds: readonly string[];
  movedElementIds: readonly string[];
  tagChangedElementIds: readonly string[];
  targetPlacementBefore: Readonly<{
    parentElementId: string | null;
    beforeElementId: string | null;
  }> | null;
  targetPlacementAfter: Readonly<{
    parentElementId: string | null;
    beforeElementId: string | null;
  }> | null;
}

export declare class SemanticOperationError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare function createSemanticDocumentState(
  html: string,
  options?: {
    revision?: number;
    lineage?: SemanticLineageEntry[];
    sourceIndex?: unknown;
  },
): SemanticDocumentState;

export declare function createSemanticElementPrecondition(
  indexOrHtml: unknown,
  elementId: string,
): SemanticElementPrecondition;

export declare function applySemanticOperation(
  state: SemanticDocumentState,
  operation: SemanticOperation | GeneratedSemanticInverseOperation,
  options?: {
    randomUUID?: () => string;
    trackedTargetRefs?: readonly unknown[];
  },
): SemanticOperationResult;

export declare function deriveSemanticOperationIdentityDelta(
  beforeHtml: string,
  afterHtml: string,
  operation: SemanticOperation,
  options?: {
    direction?: "forward" | "undo" | "redo";
    beforeIndex?: unknown;
    afterIndex?: unknown;
  },
): SemanticIdentityDelta;

export declare class SemanticOperationKernel {
  createState(
    html: string,
    options?: { revision?: number; lineage?: SemanticLineageEntry[] },
  ): SemanticDocumentState;
  createTarget(indexOrHtml: unknown, elementId: string): SemanticElementPrecondition;
  apply(
    state: SemanticDocumentState,
    operation: SemanticOperation | GeneratedSemanticInverseOperation,
    options?: {
      randomUUID?: () => string;
      trackedTargetRefs?: readonly unknown[];
    },
  ): SemanticOperationResult;
}
