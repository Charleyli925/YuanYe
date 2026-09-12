import type { ProjectContext } from "./project-session.js";

export type DocumentPersistState =
  | "idle"
  | "preview-dirty"
  | "queued"
  | "writing"
  | "failed"
  | "conflict";

export type DocumentCanvasAuthorityStatus =
  | "idle"
  | "pending"
  | "verified"
  | "failed";

export type DocumentCanvasAuthority = {
  status: DocumentCanvasAuthorityStatus;
  generation: number;
  renderedSha256: string | null;
  error: string | null;
};

export type DocumentSourceReceipt = Readonly<{
  sessionIncarnation: number;
  sequence: number;
  origin: "local-edit" | "history" | "authority";
  operationId: string;
  editRevision: number;
  canvasGeneration: number;
  sourceSha256: string;
  context: ProjectContext | null;
  epoch: number | null;
  projectId: string | null;
  documentId: string | null;
  sourcePath: string | null;
  sessionEpoch: number | null;
}>;

export function isSourceReceipt(value: unknown): value is DocumentSourceReceipt;
export function sameSourceReceiptContext(left: unknown, right: unknown): boolean;
export function sameSourceReceipt(left: unknown, right: unknown): boolean;

export type DocumentCanvasRenderObservation = Readonly<{
  receipt: DocumentSourceReceipt;
  renderedHtml: string;
  renderedSha256: string;
  frameGeneration: number;
}>;

export type DocumentSessionSnapshot = {
  html: string;
  persistedSourceSha256: string | null;
  workingHtmlSha256: string | null;
  canvasGeneration: number;
  sourceReceipt: DocumentSourceReceipt | null;
  canvasAuthority: DocumentCanvasAuthority;
  editRevision: number;
  lastPersistedRevision: number;
  persistState: DocumentPersistState;
  persistError: string;
  hasPendingWrite: boolean;
  isFlushing: boolean;
};

export type PersistedBoundaryResult =
  | {
      ready: true;
      repaired: boolean;
      sourceSha256: string;
      lastModifiedAt: string;
    }
  | {
      ready: false;
      code:
        | "frozen-integrity-unavailable"
        | "session-changed"
        | "source-unavailable"
        | "source-identity-changed"
        | "source-integrity-failed"
        | "source-diverged";
      reason: string;
      confirmed: boolean;
    };

export class DocumentSession<TWrite = unknown> {
  constructor(options?: {
    html?: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    context?: ProjectContext | null;
    operationId?: string;
  });
  setObserver(
    observer: ((snapshot: DocumentSessionSnapshot) => void) | null,
  ): void;
  update(value: {
    html?: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    persistState?: DocumentPersistState;
    persistError?: string;
    pendingWrite?: TWrite | null;
  }): DocumentSessionSnapshot;
  reset(value: {
    html: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  publishAuthority(value: {
    html: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    sourceSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    persistState?: DocumentPersistState;
    persistError?: string;
    pendingWrite?: TWrite | null;
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  reloadCanvas(value?: {
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  confirmWorkingHtml(value: {
    revision: number;
    htmlSha256: string;
  }): boolean;
  confirmCanvas(value: {
    generation: number;
    renderedSha256: string;
    workingHtmlSha256?: string;
    renderedHtml?: string;
    receipt: DocumentSourceReceipt;
  }): boolean;
  failCanvas(value: {
    generation: number;
    error?: string;
    receipt: DocumentSourceReceipt;
  }): boolean;
  beginEdit(html: string, value?: {
    origin?: "local-edit" | "history";
    operationId?: string;
    sourceSha256?: string;
    context?: ProjectContext | null;
  }): number;
  setHtml(html: string): void;
  setPersistedSourceSha256(persistedSourceSha256: string | null): void;
  setEditRevision(value: number): void;
  setLastPersistedRevision(value: number): void;
  setPersistence(value?: {
    state?: DocumentPersistState;
    error?: string;
  }): void;
  setPersistState(state: DocumentPersistState): void;
  setPersistError(error: string): void;
  setPendingWrite(write: TWrite | null): TWrite | null;
  takePendingWrite(): TWrite | null;
  setFlushPromise(
    promise: Promise<boolean> | null,
  ): Promise<boolean> | null;
  clearFlushPromise(promise: Promise<boolean>): boolean;
  reconcilePersistedBoundary(value: {
    frozenHtml: string;
    reportedSourceSha256?: string | null;
    cutoffRevision: number;
    hashHtml: (html: string) => Promise<string>;
    readSource: () => Promise<Record<string, unknown>>;
    isCurrent: () => boolean;
    acceptsSource: (source: Record<string, unknown>) => boolean;
  }): Promise<PersistedBoundaryResult>;
  readonly html: string;
  readonly persistedSourceSha256: string | null;
  readonly workingHtmlSha256: string | null;
  readonly canvasGeneration: number;
  readonly sourceReceipt: DocumentSourceReceipt | null;
  readonly canvasAuthority: DocumentCanvasAuthority;
  readonly editRevision: number;
  readonly lastPersistedRevision: number;
  readonly persistState: DocumentPersistState;
  readonly persistError: string;
  readonly pendingWrite: TWrite | null;
  readonly flushPromise: Promise<boolean> | null;
  readonly snapshot: DocumentSessionSnapshot;
}
