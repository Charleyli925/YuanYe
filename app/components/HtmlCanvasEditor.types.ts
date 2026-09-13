import type { PageViewContext } from "../lib/page-view-context.js";
import type {
  NativeEditCheckpointTrigger,
  NativeEditSelection,
} from "./native-edit-types";
import type { NoticeUsageCapture } from "./NoticeBar";
import type { EditRuntimeGrant } from "../domain/edit-runtime-contract.js";
import type { DocumentSourceReceipt } from "../application/document-session.js";
import type { RuntimeFrameIdentity } from "./runtime-frame-coordinator.js";
import type {
  SemanticIdentityDelta,
  SemanticOperation,
} from "../lib/semantic-operation-kernel.js";

export type HtmlCanvasSelectionLevel = "module" | "part" | "insertion";
export type HtmlCanvasTargetResolution =
  | "exact"
  | "rebound"
  | "ambiguous"
  | "orphaned";

export type HtmlCanvasFingerprint = {
  tagName: string;
  stableAttributes: Record<string, string>;
  ancestorFingerprint: string[];
  textPrefix?: string;
  textSuffix?: string;
};

export type HtmlCanvasRuntimeVisualHintKind =
  | "table"
  | "table-cell"
  | "chart"
  | "svg"
  | "canvas"
  | "runtime-region";

export type HtmlCanvasRuntimeVisualHint = {
  /** Runtime DOM is explanatory context only and never a source authority. */
  runtimeGenerated: true;
  kind: HtmlCanvasRuntimeVisualHintKind;
  label: string;
  renderedText?: string;
  relativePath?: string;
  /** All four coordinates are normalized to the source host's box. */
  relativeBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type HtmlCanvasTextLocator = {
  quote: string;
  /** UTF-16 offsets in the owning source element's decoded descendant text. */
  startOffset: number;
  endOffset: number;
  affinity: "forward" | "backward";
};

export type HtmlCanvasSelection = {
  id: string;
  /** Persistent source identity. Unlike `id`, this is shared by comments on the same element. */
  elementId?: string;
  /** Canonical source Hash expected at the target's last deterministic refresh. */
  expectedSourceSha256?: string;
  /** Ephemeral preview identity. It is never written to the user's source HTML. */
  nodeId?: string;
  label: string;
  selector: string;
  level: HtmlCanvasSelectionLevel;
  tagName: string;
  text: string;
  resolution: HtmlCanvasTargetResolution;
  textQuote?: string;
  textLocator?: HtmlCanvasTextLocator;
  sourceAnchor?: {
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  };
  fingerprint?: HtmlCanvasFingerprint;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Ephemeral bridge from a runtime visual target to its proven source host. */
  commentAnchor?: HtmlCanvasSelection;
  /** Ephemeral runtime context; never included in a persisted TargetRef. */
  visualHint?: HtmlCanvasRuntimeVisualHint;
};

export type HtmlCanvasMutation = {
  kind: "text" | "style" | "reorder" | "structure";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  /** Ephemeral post-patch refs for host state; never persisted as audit payload. */
  targetUpdates?: HtmlCanvasSelection[];
  /** Every input targetId covered by the deterministic patch refresh. */
  trackedTargetIds?: string[];
};

export type HtmlCanvasSourceTransaction = {
  kind: HtmlCanvasMutation["kind"];
  property?: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  forwardPatches: Array<{
    startOffset: number;
    endOffset: number;
    before: string;
    after: string;
    kind: string;
  }>;
  reversePatches: Array<{
    startOffset: number;
    endOffset: number;
    before: string;
    after: string;
    kind: string;
  }>;
  beforeTarget: HtmlCanvasSelection;
  afterTarget: HtmlCanvasSelection;
  beforeSelection?: NativeEditSelection;
  afterSelection?: NativeEditSelection;
  semanticOperation?: SemanticOperation;
  identityDelta?: SemanticIdentityDelta;
};

export type HtmlCanvasInteractionMode = "editing" | "processing" | "history";

export type HtmlCanvasEditRuntimeLoadOutcome =
  | "ready"
  | "rejected"
  | "failed"
  | "superseded";

export type HtmlCanvasRuntimeDegradation =
  | "none"
  | "runtime-partial"
  | "static-preparing"
  | "static-visible"
  | "last-known-good-readonly";

export type HtmlCanvasEditRuntimeAttempt = RuntimeFrameIdentity;

export type HtmlCanvasEditRuntimeSettlement = Readonly<{
  /** The physical candidate controller still has a usable active Runtime iframe. */
  preserveLastKnownGood: boolean;
  /** A real failure has no usable Runtime projection and may enter static fallback. */
  shouldUseStaticFallback: boolean;
  /** A usable Runtime was promoted with a noncritical author-script error. */
  runtimePartial: boolean;
}>;

export type HtmlCanvasFreezeSnapshot = {
  ok: boolean;
  html: string;
  /** Hash of the latest complete source returned in html. */
  workingSourceSha256: string;
  /** Hash of the source bytes represented by the currently visible verified projection. */
  renderedProjectionSha256: string;
  /** True when the visible projection is only a last-known-good view of older source. */
  renderedProjectionStale: boolean;
  /** Compatibility name for renderedProjectionSha256. Never aliases working source. */
  canvasRenderedSha256: string;
  pendingMutation: HtmlCanvasMutation | null;
  reason?: string;
};

export type HtmlCanvasCommitResult = {
  ok: boolean;
  html: string;
  /** Hash of the latest complete source returned in html. */
  workingSourceSha256: string;
  /** Hash of the source bytes represented by the currently visible verified projection. */
  renderedProjectionSha256: string;
  /** True when the visible projection is only a last-known-good view of older source. */
  renderedProjectionStale: boolean;
  /** Compatibility name for renderedProjectionSha256. Never aliases working source. */
  canvasRenderedSha256: string;
  pendingMutation: HtmlCanvasMutation | null;
  reason?: string;
};

export type NativeDeferredCommandAuthority = "user-explicit" | "system";

export type NativeDeferredCommandDiscardReason =
  | "superseded"
  | "blocked-by-user-command"
  | "stale-session"
  | "session-ended"
  | "unmounted";

export type NativeDeferredCommandOptions = {
  /** System work may wait for IME settling, but can never authorize fallback text. */
  authority?: NativeDeferredCommandAuthority;
  /** Always called if a queued callback will never execute. */
  onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
};

export type HtmlCanvasCommentLayoutTarget = {
  target: HtmlCanvasSelection;
  visualHint?: HtmlCanvasRuntimeVisualHint;
};

export type HtmlCanvasCommentedTarget = {
  target: HtmlCanvasSelection;
  /**
   * Every persisted comment keeps an independent target id even when several
   * comments share one canvas marker. Layout reporting must retain those ids so
   * the rail can position and group each card independently.
   */
  layoutTargets?: readonly (
    | HtmlCanvasSelection
    | HtmlCanvasCommentLayoutTarget
  )[];
  visualHint?: HtmlCanvasRuntimeVisualHint;
  count?: number;
  label?: string;
  /** Report target layout without rendering a saved-comment marker. */
  showMarker?: boolean;
  /** A current unsaved composer draft shares this source target. */
  hasDraft?: boolean;
};

export type HtmlCanvasCommentLayoutState = {
  sourceSha256: string;
  viewContextGeneration: number;
  ready: boolean;
  textEditing: boolean;
  targetIds: string[];
  scrollTop: number;
  contentHeight: number;
  clientHeight: number;
  targets: Array<{
    targetId: string;
    status: "visible" | "hidden" | "missing";
    resolution: HtmlCanvasTargetResolution;
    top?: number;
    height?: number;
    tabGroupKey?: string;
    tabGroupLabel?: string;
  }>;
};

export type HtmlCanvasEditorHandle = {
  /** Returns the exact source string held by the single SourcePatchEngine. */
  getSourceHtml: () => string;
  /** Exact source string whose sanitized representation has finished loading in the iframe. */
  getRenderedSourceHtml: () => string | null;
  /** Identifies a verified physical frame, including same-source reloads. */
  getRenderedFrameGeneration: () => number | null;
  /** Returns the physical iframe Document for identity fencing. */
  getRenderedFrameDocument: () => Document | null;
  /** Readiness only; semantic commits still validate their own source target. */
  isCurrentProjectionEditable: () => boolean;
  /**
   * Rebuilds the visible Active frame from the current source as static first.
   * Used when Canvas generation advances without a new React host (reload
   * recovery). Runtime A/B may follow on the grant path.
   */
  rebuildActiveFrame: () => void;
  /** Current scroll coordinate inside the authored iframe viewport. */
  getScrollTop: () => number;
  /** Restores the authored iframe viewport without changing source. */
  scrollToTop: (scrollTop: number) => boolean;
  /** Saves the current native text intent without ending it. Runtime stays live. */
  checkpointNativeTextIntent: (options?: {
    trigger?: NativeEditCheckpointTrigger;
  }) => HtmlCanvasCommitResult;
  /**
   * Freezes Working Copy source for a leave/submit/history boundary.
   * May rebuild Runtime after the caller decides whether source changed.
   */
  freezeWorkingSource: (options?: {
    resumeEditing?: boolean;
    /** Keeps the active target/caret bookmark for the pending history result. */
    preserveForHistory?: boolean;
    trigger?: NativeEditCheckpointTrigger;
    /**
     * A leave boundary retires native editing without rebuilding the Runtime
     * projection that the caller is about to leave.
     */
    endBehavior?: "refresh-current-canvas" | "leave-canvas";
  }) => HtmlCanvasCommitResult;
  /** Ends the native text intent without a later resume. */
  endNativeTextIntent: () => HtmlCanvasCommitResult;
  /** Captures pending text and synchronously blocks every mutation entrypoint. */
  freezeNow: () => HtmlCanvasFreezeSnapshot;
  /** Releases an imperative freeze when the controlled mode is editing. */
  unlockNow: () => boolean;
  /** Keeps a failed commit explanation beside the canvas instead of escalating it globally. */
  showCommitBlocked: (reason?: string) => void;
  /** True while source-uncommitted native text or marked text still exists. */
  hasPendingNativeEdit: () => boolean;
  clearSelection: () => void;
  select: (
    target: HtmlCanvasSelection,
    options?: {
      reveal?: boolean;
      showToolbar?: boolean;
      visualHint?: HtmlCanvasRuntimeVisualHint | null;
    },
  ) => HtmlCanvasSelection | null;
  startEditing: () => boolean;
  moveSelected: (direction: "up" | "down") => boolean;
  /** Duplicates the selected authored source subtree with fresh stable IDs. */
  duplicateSelected: () => boolean;
  /** Deletes the selected authored source element; document roots are protected. */
  deleteSelected: () => boolean;
  /** Inserts one identity-free HTML element into an authored source parent. */
  insertElement: (options: {
    parentElementId: string;
    beforeElementId?: string | null;
    html: string;
  }) => boolean;
  /** Moves the selected authored element, preserving its stable ID. */
  moveSelectedTo: (options: {
    parentElementId: string;
    beforeElementId?: string | null;
  }) => boolean;
  /** Adopts one Bridge-validated history result in place when proven safe, otherwise with a fresh frame. */
  adoptHistorySource: (
    source: string,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection | null,
  ) => boolean;
  /** Restores the pre-action target/caret when a history request fails or becomes ineligible. */
  cancelHistoryAction: (options?: { restore?: boolean }) => boolean;
  /** Defers one explicit user command until the current native composition is stable/cancelled. */
  deferNativeCommand: (
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: NativeDeferredCommandOptions,
  ) => boolean;
  /** Applies disposable source-backed presentation state without changing source bytes. */
  applyPageViewContext: (context: PageViewContext | null) => boolean;
};

export type HtmlCanvasEditorProps = {
  /** A complete document or an HTML fragment. Fragments are normalized to a complete document. */
  html: string;
  /** Source-owner receipt for this exact HTML projection. */
  sourceReceipt: DocumentSourceReceipt | null;
  /** Host-owned edit revision used as the semantic operation base revision. */
  semanticRevision?: number;
  /** Called with the exact next source; returns the source-owner receipt synchronously. */
  onChange: (
    nextSourceHtml: string,
    mutation?: HtmlCanvasMutation,
    transaction?: HtmlCanvasSourceTransaction,
  ) => DocumentSourceReceipt | false;
  /** Called when an element is selected or the selection is cleared. */
  onSelect?: (selection: HtmlCanvasSelection | null) => void;
  /** Notifies the host about any pointer interaction inside the isolated iframe. */
  onInteraction?: () => void;
  /** A main-process-authorized, source-bound disposable runtime grant. */
  editRuntimeGrant?: EditRuntimeGrant | null;
  /** State-owner transition when a visible disposable document begins loading. */
  onEditRuntimeLoadStart?: (
    grant: EditRuntimeGrant,
    attempt: HtmlCanvasEditRuntimeAttempt,
  ) => void;
  /** State-owner transition after the disposable document loads or fails. */
  onEditRuntimeLoadOutcome?: (
    grant: EditRuntimeGrant,
    outcome: HtmlCanvasEditRuntimeLoadOutcome,
    attempt: HtmlCanvasEditRuntimeAttempt,
    settlement: HtmlCanvasEditRuntimeSettlement,
  ) => void;
  /** Reports renderer-only degradation without changing Working HTML authority. */
  onRuntimeDegradationChange?: (state: HtmlCanvasRuntimeDegradation) => void;
  /** Mirrors the authored page scroll coordinate into the host comment rail. */
  onCommentLayout?: (state: HtmlCanvasCommentLayoutState) => void;
  /** Opens the host product's comment composer for the current selection. */
  onRequestComment?: (selection: HtmlCanvasSelection) => void;
  /** Callback alternative to using a ref. Receives null when the editor unmounts. */
  onReady?: (api: HtmlCanvasEditorHandle | null) => void;
  /** Handles Cmd/Ctrl+S inside the iframe without exposing the browser's native Save dialog. */
  onRequestFlush?: () => void;
  /** Handles Shift+Cmd/Ctrl+E inside the iframe using the host product's source-safe export path. */
  onRequestExport?: () => void;
  /** Routes canvas-owned undo/redo shortcuts to the persistent source history owner. */
  onRequestHistory?: (direction: "undo" | "redo") => void;
  /** Reloads the current source after the editor cannot build a safe source map. */
  onRequestReload?: () => void;
  /** Labels the source-map recovery action when the host must ask for the file again. */
  reloadActionLabel?: string;
  /** Reports a fail-closed edit whose source target could not be patched safely. */
  onEditBlocked?: (message: string) => void;
  /** Project identity is used only by the main process to derive a local pseudonymous key. */
  usageProjectId?: string;
  usageCapture?: NoticeUsageCapture;
  /** Optional base URL for relative assets. The injected base element is not included in serialized output. */
  baseHref?: string;
  /** Absolute path or file URL of the source HTML. Used to derive baseHref when baseHref is absent. */
  sourcePath?: string;
  className?: string;
  iframeTitle?: string;
  height?: number | string;
  /** Soft read-only mode: blocks direct HTML mutations while selection and comments remain available. */
  readOnly?: boolean;
  /** Explicit interaction state. Processing and history are both strongly read-only. */
  interactionMode?: HtmlCanvasInteractionMode;
  /** Strong round lock: the canvas becomes browse-only and hides every selection-based action. */
  locked?: boolean;
  /** Reordering is limited to safe element siblings and can be disabled by the host. */
  enableReorder?: boolean;
  /** CSS selectors that already have comments and should receive a compact canvas marker. */
  commentedTargets?: readonly HtmlCanvasCommentedTarget[];
  /** Non-visual audit targets that must retain identity through later source patches. */
  trackedTargets?: readonly HtmlCanvasSelection[];
  /** Disposable source-backed presentation state for the current document. */
  pageViewContext?: PageViewContext | null;
  /** Stable host-owned identity for disposable presentation state. */
  pageViewDocumentKey?: string;
  /** Accepts source-backed presentation state without treating it as an HTML edit. */
  onPageViewContextChange?: (
    context: PageViewContext | null,
    documentKey: string,
  ) => boolean;
  /** Presentation-only viewport restored while a cached surface hands off. */
  initialScrollTop?: number;
  /** Continuous pointer-capability hover; off on the built-in welcome page. */
  pointerCapabilityHoverEnabled?: boolean;
};
