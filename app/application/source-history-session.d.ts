import type {
  SourceHistoryDirection,
  SourceHistoryEntry,
} from "../domain/source-history.js";
import type {
  SemanticIdentityDelta,
  SemanticOperation,
} from "../lib/semantic-operation-kernel.js";

export const SOURCE_HISTORY_MEMORY_LIMIT: 20;

export type SourceHistoryContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type OpenDocumentMemoryHistory = {
  scope: "open-document-memory";
  projectId: string;
  documentId: string;
  sourcePath: string;
  baseSourceSha256: string;
  cursor: number;
  revision: number;
  entries: SourceHistoryEntry[];
};

export type CanvasSourceTransaction = {
  kind: SourceHistoryEntry["kind"];
  property?: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  forwardPatches: SourceHistoryEntry["forwardPatches"];
  reversePatches: SourceHistoryEntry["reversePatches"];
  beforeTarget: SourceHistoryEntry["beforeTarget"];
  afterTarget: SourceHistoryEntry["afterTarget"];
  beforeSelection?: SourceHistoryEntry["beforeSelection"];
  afterSelection?: SourceHistoryEntry["afterSelection"];
  semanticOperation?: SemanticOperation;
  identityDelta?: SemanticIdentityDelta;
};

export type SourceHistoryAcknowledgeResult =
  | Readonly<{ status: "accepted-head" }>
  | Readonly<{ status: "accepted-prefix"; pendingCount: number }>
  | Readonly<{ status: "invalid"; reason: string }>;

export class SourceHistorySession {
  constructor();
  activate(
    context: SourceHistoryContext,
    sourceSha256: string,
    historyValue: unknown,
    options?: { preservePending?: boolean },
  ): OpenDocumentMemoryHistory;
  deactivate(): void;
  isActive(context: SourceHistoryContext): boolean;
  record(
    context: SourceHistoryContext,
    transaction: CanvasSourceTransaction,
    editRevision: number,
    createdAt?: string,
  ): SourceHistoryEntry;
  restorePendingEvidence(
    context: SourceHistoryContext,
    operations: SourceHistoryEntry[],
  ): boolean;
  acknowledge(
    context: SourceHistoryContext,
    sentOperations: SourceHistoryEntry[],
    sourceSha256: string,
  ): SourceHistoryAcknowledgeResult;
  apply(
    context: SourceHistoryContext,
    direction: SourceHistoryDirection,
    sourceHtml: string,
    editRevision: number,
    createdAt?: string,
  ): {
    html: string;
    sourceSha256: string;
    kind: SourceHistoryEntry["kind"];
    property?: string;
    target: SourceHistoryEntry["beforeTarget"];
    targetTransition: {
      fromTarget: SourceHistoryEntry["beforeTarget"];
      toTarget: SourceHistoryEntry["afterTarget"];
    };
    selection?: SourceHistoryEntry["beforeSelection"];
  } | null;
  readonly pendingOperations: SourceHistoryEntry[];
  readonly snapshot: OpenDocumentMemoryHistory | null;
  readonly capabilities: {
    canUndo: boolean;
    canRedo: boolean;
    cursor: number;
    depth: number;
    revision: number;
    sourceSha256: string;
  };
}
