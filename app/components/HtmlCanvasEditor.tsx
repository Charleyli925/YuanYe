"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  editRuntimeProgramIdentity,
  editRuntimeRegistrationProperty,
  isEditRuntimeFrameToken,
} from "../domain/edit-runtime-contract.js";
import {
  decideEditRuntimeRefresh,
  type EditRuntimeRefreshDecision,
} from "./edit-runtime-refresh-decision.js";
import {
  attachRuntimeContinuityProbe,
  recordRuntimeContinuityEvent,
} from "./runtime-continuity-probe.js";
import { installEditPipelineTestHooks } from "../lib/edit-pipeline-counters.js";
import {
  editableIslandTextOperation,
  inlineStyleOperation,
  siblingReorderOperation,
  textRangeStyleCreatesWrapper,
  textRangeStyleOperation,
} from "./html-canvas-source-commands.js";
import {
  createPagePresentationAction,
  type PagePresentationAction,
  type PageViewContext,
} from "../lib/page-view-context.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";
import {
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import {
  editableIslandDraftHtml,
  editableIslandForTarget,
  isEditableIslandTarget,
} from "../lib/editable-island.js";
import {
  sourceTargetRefForSelection,
} from "../lib/canvas-target-rebind.js";
import {
  applySemanticOperation,
  createSemanticDocumentState,
  type SemanticOperation,
} from "../lib/semantic-operation-kernel.js";
import {
  buildSourceTextMap,
  sourceSegmentsToTextRange,
  textRangeToSourceSegments,
  type SourceTextMap,
} from "../lib/source-text-map.js";
import {
  NATIVE_EDIT_CHECKPOINT_DELAY_MS,
  IslandEditingController,
  nativeLogicalText,
  type NativeEditBaseline,
  type NativeEditCheckpointTrigger,
  type NativeEditSelection,
  type NativeEditSessionState,
} from "./IslandEditingController";
import {
  nativeLayoutFingerprint,
  sameNativeLayout,
  sameNativeTextStyle,
} from "./native-layout-fingerprint";
import {
  readComputedEditableStyle,
  STYLE_PROPERTY_CONFIGS,
  TEXT_RANGE_EDITABLE_PROPERTIES,
  type EditableStyleProperty,
  type SelectedStyle,
} from "./html-canvas-computed-style";
import {
  deterministicOperationTargetUpdate,
  deterministicTargetUpdates,
  isPageRootElement,
  isPageRootSelection,
  selectionForElement,
  selectionFromRefreshedTarget,
  sourceMoveAvailability,
  trackedSourceTargetRefs,
  uniqueSelections,
  type MoveAvailability,
} from "./html-canvas-selection";
import {
  SOURCE_ELEMENT_ATTRIBUTE,
  registerProvedStableSourceElements,
  sourceElementId,
  uniqueSourceElement,
} from "./html-canvas-source-element";
import {
  insertStructureCommand,
  selectedStructureCommand,
  type SelectedStructureAction,
  type StructureDestination,
} from "./html-canvas-structure-commands";
import type {
  ActiveTextRange,
  SourceElementValue,
  SourceIndexValue,
  SourceTargetRef,
} from "./html-canvas-internal-types";
import {
  activateContainingTab,
  applyPageViewContextToDocument,
  commentLayoutTargets,
  isRenderedCommentTarget,
  naturalDocumentContentHeight,
  sortedCommentLayoutTargetIds,
  tabAssociations,
} from "./html-canvas-page-view";
import {
  applyReadingPosition,
  correctReadingPositionOnce,
  frameDocumentMatchesExpected,
  frameScrollMetricsReady,
  outerScrollMetricsReady,
  runtimeElementIsInReadingViewport,
  runtimeElementScreenRect,
  runtimeRectIntersectsClip,
  sameRuntimeGrant,
  scheduleWhenReady,
  type RuntimeFrameContext,
} from "./html-canvas-frame";
import { useCanvasPresentationScroll } from "./html-canvas-presentation-scroll";
import {
  NativeDeferredCommandQueue,
  nativeEditLeasesMatch,
} from "./html-canvas-native-commands";
import {
  insertionLayoutNeedsRefresh,
  layoutCommentMarkers,
  layoutInsertionPoints,
  measureCommentTargetLayouts,
  type InsertionLayoutAuthority,
  type InsertionPoint,
} from "./html-canvas-comment-layout";
import {
  adoptCanonicalHistoryIslandInPlace,
  canonicalNativeHostPreview,
  remountNativeHostFromSource,
  reconcileRangeStyleInPlace,
  runtimeSurfacesReady,
  nativeEditHostForElement,
  refreshStableMountedPreviewSourceNodeIds,
  sourceBackedPreviewElements,
  alignPreviewSourceSurface,
  sourceTextParentsForSegments,
} from "./html-canvas-preview-sync";
import { usePreviewResourceBase } from "./use-preview-resource-base";
import {
  activeTextRangeFromDocument,
  boundedHistorySelection,
  caretPointFromMouseEvent,
  findDedicatedSourceSurfaceAtPoint,
  findNativeActionTarget,
  historySelectionFromMutationValue,
  identifyingTextRangeAtPoint,
  sourceHistoryDirectionForShortcut,
  textLocatorForActiveRange,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  canvasVisualTargetElement,
  canvasPointerCapabilityFromProof,
  createCanvasTargetIdentityScope,
  elementCopyAvailabilityForTarget,
  resolveCanvasTarget,
  type CanvasTargetIdentityScope,
  type ResolvedCanvasTarget,
} from "./html-canvas-pointer-capability";
import {
  disposeRuntimeVisualTargetIndex,
  runtimeVisualTargetForHint,
} from "./html-canvas-runtime-target";
import {
  clipCanvasTargetRectToViewport,
  createCanvasCapabilityHoverController,
  layoutCanvasHoverChrome,
  placeCanvasHoverHint,
  type CanvasCapabilityHoverSnapshot,
} from "./html-canvas-capability-hover";
import {
  HtmlCanvasSelectionChrome,
  type HtmlCanvasCommentMarker,
  type HtmlCanvasEditFeedback,
} from "./html-canvas-selection-chrome";
import {
  deriveCapabilityHoverState,
  deriveSelectionOverlay,
  stabilizeSelectionChromeProjection,
  type SelectionChromeActions,
  type SelectionChromeModel,
  type SelectionChromeProjection,
} from "./html-canvas-selection-chrome-contract";
import {
  RuntimeFrameCoordinator,
  runtimeCandidateAlreadyActive,
  type RuntimeFrameIdentity,
  type RuntimeFrameSettlement,
  type RuntimeFrameSlotId,
} from "./runtime-frame-coordinator.js";
import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommitResult,
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditorHandle,
  HtmlCanvasEditorProps,
  HtmlCanvasFreezeSnapshot,
  HtmlCanvasInteractionMode,
  HtmlCanvasMutation,
  HtmlCanvasRuntimeDegradation,
  HtmlCanvasSelection,
  HtmlCanvasSelectionLevel,
  HtmlCanvasSourceTransaction,
  HtmlCanvasTargetResolution,
  NativeDeferredCommandDiscardReason,
  NativeDeferredCommandOptions,
  HtmlCanvasRuntimeVisualHint,
} from "./HtmlCanvasEditor.types";
export type {
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommentLayoutTarget,
  HtmlCanvasCommentLayoutState,
  HtmlCanvasCommitResult,
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditRuntimeAttempt,
  HtmlCanvasEditorHandle,
  HtmlCanvasEditorProps,
  HtmlCanvasFingerprint,
  HtmlCanvasFreezeSnapshot,
  HtmlCanvasInteractionMode,
  HtmlCanvasMutation,
  HtmlCanvasRuntimeDegradation,
  HtmlCanvasSelection,
  HtmlCanvasSourceTransaction,
  HtmlCanvasTargetResolution,
  HtmlCanvasTextLocator,
  HtmlCanvasRuntimeVisualHint,
  HtmlCanvasRuntimeVisualHintKind,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
  NativeDeferredCommandOptions,
} from "./HtmlCanvasEditor.types";
import {
  EDITOR_STYLE_ATTRIBUTE,
  FRAME_VERIFICATION_ATTRIBUTE,
  baseHrefFromSourcePath,
  disableExecutableMarkup,
  prepareCanvasFrameDocument,
  prepareVerifiedFrameDocument,
} from "./html-preview-sandbox.js";
import {
  isSourceReceipt,
  sameSourceReceipt,
  sameSourceReceiptContext,
} from "../application/document-session.js";
import type { DocumentSourceReceipt } from "../application/document-session.js";
import styles from "./HtmlCanvasEditor.module.css";

function sourceSubtreeElementIds(
  sourceIndex: SourceIndexValue | null,
  rootElementId: string | undefined,
): Set<string> {
  const root = rootElementId ? sourceIndex?.byPagerootId.get(rootElementId) : null;
  if (!root || root.type !== "element") return new Set();
  const elementIds = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) continue;
    if (element.pagerootId) elementIds.add(element.pagerootId);
    for (const childNodeId of element.childElementIds) {
      const child = sourceIndex?.byNodeId.get(childNodeId);
      if (child?.type === "element") pending.push(child);
    }
  }
  return elementIds;
}

function reconcileAllocatedLineBreakIds(
  hostElement: HTMLElement,
  previousSourceInnerHtml: string,
  nextSourceInnerHtml: string,
) {
  const liveDraft = editableIslandDraftHtml(hostElement.innerHTML, {
    baselineInnerHtml: previousSourceInnerHtml,
  });
  const sourceDraft = editableIslandDraftHtml(nextSourceInnerHtml, {
    baselineInnerHtml: previousSourceInnerHtml,
  });
  if (liveDraft !== sourceDraft) {
    throw new Error("实时编辑 DOM 与已保存的源码换行结构不一致。");
  }
  const document = hostElement.ownerDocument;
  const previousTemplate = document.createElement("template");
  const nextTemplate = document.createElement("template");
  previousTemplate.innerHTML = previousSourceInnerHtml;
  nextTemplate.innerHTML = nextSourceInnerHtml;
  const previousIds = new Set(Array.from(
    previousTemplate.content.querySelectorAll(`[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`),
  ).map((element) => element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)));
  const liveElements = Array.from(hostElement.querySelectorAll("*"));
  const sourceElements = Array.from(nextTemplate.content.querySelectorAll("*"));
  if (liveElements.length !== sourceElements.length) {
    throw new Error("实时编辑 DOM 与已保存的源码元素数量不一致。");
  }
  const assignments: Array<{ element: Element; elementId: string }> = [];
  const assignedIds = new Set<string>();
  for (let index = 0; index < sourceElements.length; index += 1) {
    const liveElement = liveElements[index];
    const sourceElement = sourceElements[index];
    if (liveElement.localName !== sourceElement.localName) {
      throw new Error("实时编辑 DOM 与已保存的源码元素顺序不一致。");
    }
    const liveId = liveElement.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    const sourceId = sourceElement.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (liveId === sourceId) continue;
    if (
      liveId !== null
      || sourceElement.localName !== "br"
      || typeof sourceId !== "string"
      || !isValidPagerootElementId(sourceId)
      || previousIds.has(sourceId)
      || assignedIds.has(sourceId)
    ) {
      throw new Error("已保存的源码身份无法安全同步到实时换行节点。");
    }
    assignedIds.add(sourceId);
    assignments.push({ element: liveElement, elementId: sourceId });
  }
  for (const assignment of assignments) {
    assignment.element.setAttribute(
      PAGEROOT_ELEMENT_ID_ATTRIBUTE,
      assignment.elementId,
    );
  }
}

const GLOBAL_SELECTION_ATTRIBUTE = "data-html-canvas-global-selected";

const EDITOR_DOCUMENT_STYLES = `
  /*
   * The shared review stage owns page scrolling. A root-frame scrollbar changes
   * the authored viewport width and can feed a ResizeObserver back into Canvas
   * height; nested authored overflow containers remain untouched.
   */
  html:root,
  html:root > body {
    overflow-y: hidden !important;
  }

  ::selection {
    color: inherit !important;
    background: rgba(90, 85, 223, 0.2) !important;
  }

  [data-html-canvas-global-selected] {
    min-height: 100vh !important;
  }

  [data-html-canvas-editing] {
    cursor: text !important;
    outline: none !important;
  }

  [data-html-canvas-native-editing] {
    -webkit-user-select: text !important;
    user-select: text !important;
    caret-color: currentColor !important;
    outline: none !important;
  }

  html[data-html-canvas-locked] [contenteditable] {
    cursor: default !important;
    caret-color: transparent !important;
  }

  html[data-html-canvas-pointer="text"],
  html[data-html-canvas-pointer="text"] body,
  html[data-html-canvas-pointer="text"] body * {
    cursor: text !important;
  }

  html[data-html-canvas-pointer="pointer"],
  html[data-html-canvas-pointer="pointer"] body,
  html[data-html-canvas-pointer="pointer"] body * {
    cursor: pointer !important;
  }

  noscript {
    display: none !important;
  }

  html:not([data-html-canvas-locked]) iframe,
  html:not([data-html-canvas-locked]) audio,
  html:not([data-html-canvas-locked]) video,
  html:not([data-html-canvas-locked]) canvas,
  html:not([data-html-canvas-locked]) object,
  html:not([data-html-canvas-locked]) embed {
    pointer-events: none !important;
  }

  html:not([data-html-canvas-locked]) body,
  html:not([data-html-canvas-locked]) body * {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  [data-pageroot-edit-runtime-host] {
    cursor: default !important;
  }

  [data-pageroot-edit-runtime-host] * {
    pointer-events: none !important;
    -webkit-user-select: none !important;
    user-select: none !important;
  }

`;

const EMPTY_COMMENTED_TARGETS: readonly HtmlCanvasCommentedTarget[] = [];
const EMPTY_TRACKED_TARGETS: readonly HtmlCanvasSelection[] = [];
const EMPTY_RUNTIME_SLOT_DOCUMENT = "<!doctype html><html><head></head><body></body></html>";

type OverlayPosition = {
  toolbarLeft: number;
  toolbarTop: number;
};

type RuntimeSourceElements = {
  elementGeneration: number;
  executionId: string;
  elements: WeakSet<HTMLElement>;
  pagerootIds: WeakMap<HTMLElement, string>;
  runtimeShadowHosts: WeakSet<HTMLElement>;
};

type RuntimeCandidateRender = {
  html: string;
  elementGeneration: number;
  runtime: boolean;
};

type RuntimeRefreshPending = {
  sourceRevision: string;
  reason: string;
  coalescedCount: number;
};

type RuntimePresentationAnchor = {
  selectedStableId: string | null;
  viewportAnchorStableId: string | null;
  viewportAnchorScreenOffsetY: number | null;
  iframeScrollLeft: number;
  iframeScrollTop: number;
  outerScrollLeft: number | null;
  outerScrollTop: number | null;
  zoom: number;
};

type RuntimeHandoffContext = {
  presentationAnchor: RuntimePresentationAnchor;
  pendingSelection: HtmlCanvasSelection | null;
  pendingToolbarVisible: boolean;
  restoreCanvasFocus: boolean;
};

type RuntimeSlotRetirement = {
  slotId: RuntimeFrameSlotId;
  render: RuntimeCandidateRender;
  cleanupFrame: () => void;
  registrationCleanup: () => void;
  generation: number;
};

type RuntimeCandidate = {
  attempt: RuntimeFrameIdentity;
  source: string;
  sourceIndex: SourceIndexValue | null;
  prepared: string;
  verificationToken: string;
  render: RuntimeCandidateRender;
  runtimeFrame: RuntimeFrameContext | null;
  sourceElements: RuntimeSourceElements | null;
  registrationCleanup: () => void;
  loaded: boolean;
  candidateInertInjected: boolean;
  handoffContext: RuntimeHandoffContext;
  retiredSlot: RuntimeSlotRetirement | null;
  viewContext: PageViewContext | null;
};

type RuntimeCandidateStartOptions = {
  kind?: RuntimeFrameIdentity["kind"];
  handoffContext?: RuntimeHandoffContext;
};

function runtimeActivationUsable(frame: RuntimeFrameContext): boolean {
  return frame.activation === "ready" || frame.activation === "partial";
}

type DeferredRuntimeCandidate = {
  lease: number;
  source: string;
  sourceRevision: string;
  kind: RuntimeFrameIdentity["kind"];
  predecessorCandidateId: string | null;
  handoffContext: RuntimeHandoffContext | null;
};

function sharedScrollbarPointerDown(
  element: HTMLElement,
  event: PointerEvent,
): boolean {
  const rect = element.getBoundingClientRect();
  const verticalScrollbarWidth = Math.max(12, element.offsetWidth - element.clientWidth);
  const horizontalScrollbarHeight = Math.max(12, element.offsetHeight - element.clientHeight);
  const vertical = element.scrollHeight > element.clientHeight + 1
    && event.clientX >= rect.right - verticalScrollbarWidth
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  const horizontal = element.scrollWidth > element.clientWidth + 1
    && event.clientY >= rect.bottom - horizontalScrollbarHeight
    && event.clientX >= rect.left
    && event.clientX <= rect.right;
  return vertical || horizontal;
}

function runtimeSourceElementForStableId(
  documentNode: Document,
  sourceIndex: SourceIndexValue | null,
  stableId: string | null | undefined,
): Element | null {
  if (!sourceIndex || !stableId || !isValidPagerootElementId(stableId)) return null;
  const sourceEntry = sourceIndex.byPagerootId.get(stableId);
  if (!sourceEntry || sourceEntry.type !== "element") return null;
  return uniqueSourceElement(documentNode, stableId);
}

function runtimeStableIdForElement(
  element: Element | null,
  sourceIndex: SourceIndexValue | null,
): string | null {
  const stableId = element?.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
  const sourceEntry = stableId ? sourceIndex?.byPagerootId.get(stableId) : null;
  if (
    !stableId
    || !isValidPagerootElementId(stableId)
    || sourceEntry?.type !== "element"
    || sourceEntry.tagName !== element?.localName
  ) return null;
  return stableId;
}

function captureRuntimePresentationAnchor({
  iframe,
  outerScrollElement,
  sourceIndex,
  selectedElement,
  selectedSourceSelection,
}: {
  iframe: HTMLIFrameElement | null;
  outerScrollElement: HTMLElement | null;
  sourceIndex: SourceIndexValue | null;
  selectedElement: Element | null;
  selectedSourceSelection: HtmlCanvasSelection | null;
}): RuntimePresentationAnchor {
  const documentNode = iframe?.contentDocument;
  const frameView = iframe?.contentWindow;
  const selectedStableId = (
    isValidPagerootElementId(selectedSourceSelection?.elementId)
      ? selectedSourceSelection?.elementId
      : runtimeStableIdForElement(selectedElement, sourceIndex)
  ) || null;
  const selectedAnchor = documentNode && selectedStableId
    ? runtimeSourceElementForStableId(documentNode, sourceIndex, selectedStableId)
    : null;
  const iframeRect = iframe?.getBoundingClientRect();
  const clipRect = (outerScrollElement || iframe)?.getBoundingClientRect();
  const selectedVisible = Boolean(
    selectedAnchor
    && iframe
    && clipRect
    && runtimeElementIsInReadingViewport(iframe, selectedAnchor, clipRect)
  );
  const firstVisibleAnchor = documentNode && sourceIndex && iframe && iframeRect && clipRect
    ? Array.from(documentNode.querySelectorAll<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`))
      .reduce<HTMLElement | null>((best, element) => {
        if (!runtimeStableIdForElement(element, sourceIndex)) return best;
        const screenRect = runtimeElementScreenRect(iframe, element);
        if (!screenRect || !runtimeRectIntersectsClip(screenRect, clipRect)) return best;
        const clipCenter = (clipRect.top + clipRect.bottom) / 2;
        const elementCenter = (screenRect.top + screenRect.bottom) / 2;
        if (!best) return element;
        const bestRect = best.getBoundingClientRect();
        const bestCenter = iframeRect.top + (bestRect.top + bestRect.bottom) / 2;
        return Math.abs(elementCenter - clipCenter) < Math.abs(bestCenter - clipCenter)
          ? element
          : best;
      }, null)
    : null;
  const anchorElement = (selectedVisible ? selectedAnchor : null) || firstVisibleAnchor;
  const viewportAnchorStableId = runtimeStableIdForElement(anchorElement, sourceIndex);
  const anchorTop = anchorElement?.getBoundingClientRect().top;
  const frameTop = iframe?.getBoundingClientRect().top;
  const anchorScreenTop = Number(anchorTop) + Number(frameTop);
  const iframeWidth = iframe?.clientWidth || 0;
  const renderedWidth = iframe?.getBoundingClientRect().width || iframeWidth;
  return {
    selectedStableId,
    viewportAnchorStableId,
    viewportAnchorScreenOffsetY: Number.isFinite(anchorScreenTop)
      ? anchorScreenTop
      : null,
    iframeScrollLeft: Number(frameView?.scrollX || 0),
    iframeScrollTop: Number(frameView?.scrollY || 0),
    outerScrollLeft: outerScrollElement?.scrollLeft ?? null,
    outerScrollTop: outerScrollElement?.scrollTop ?? null,
    zoom: iframeWidth > 0 && Number.isFinite(renderedWidth / iframeWidth)
      ? renderedWidth / iframeWidth
      : 1,
  };
}

function rememberVisibleCanvasViewport({
  container,
  iframe,
  sourceIndex,
  destination,
}: {
  container: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
  sourceIndex: SourceIndexValue | null;
  destination: { current: RuntimePresentationAnchor | null };
}) {
  if (!container?.getClientRects().length || !iframe) return;
  const next = captureRuntimePresentationAnchor({
    iframe,
    outerScrollElement: container.closest(".review-scroll-stage"),
    sourceIndex,
    selectedElement: null,
    selectedSourceSelection: null,
  });
  const previous = destination.current;
  // Comment-rail alignment can jump the shared stage back toward a marker
  // near the top. Same-document HTML replacement should keep the last
  // reading position instead of that snap.
  if (
    previous
    && previous.outerScrollTop !== null
    && next.outerScrollTop !== null
    && previous.outerScrollTop - next.outerScrollTop > 400
  ) {
    return;
  }
  destination.current = next;
}

function canvasTargetOutlineStyle(
  container: HTMLElement | null,
  iframe: HTMLIFrameElement | null,
  element: HTMLElement | null,
  global = false,
): ReturnType<typeof layoutCanvasHoverChrome>["outline"] | undefined {
  if (!container || !iframe || !element?.isConnected) return undefined;
  const containerRect = container.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const targetRect = global
    ? {
      left: 0,
      top: 0,
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    }
    : clipCanvasTargetRectToViewport({
      left: elementRect.left,
      top: elementRect.top,
      width: elementRect.width,
      height: elementRect.height,
    }, {
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    });
  if (!targetRect) return undefined;
  const chrome = layoutCanvasHoverChrome({
    left: iframeRect.left - containerRect.left + targetRect.left,
    top: iframeRect.top - containerRect.top + targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
  });
  return chrome.outline;
}

type ActiveNativeEdit = {
  rootElement: HTMLElement;
  selectionElement: HTMLElement;
  target: HtmlCanvasSelection;
  projection: SourceTextMap;
  rootTargetRef: SourceTargetRef;
  sourceInnerHtml: string;
  liveElementId: string | null;
  session: IslandEditingController;
  selection: NativeEditSelection;
  lease: {
    sessionId: string;
    domGeneration: number;
    sourceRevision: string;
    hostId: string;
  };
};

type RetainedNativeEditFocus = {
  session: IslandEditingController;
  lease: ActiveNativeEdit["lease"];
  targetId: string;
  selection: NativeEditSelection;
  textRange: ActiveTextRange | null;
};

function cloneActiveTextRange(
  range: ActiveTextRange | null,
  target?: HtmlCanvasSelection,
): ActiveTextRange | null {
  if (!range) return null;
  return {
    ...range,
    target: target ?? range.target,
    segments: range.segments.map((segment) => ({ ...segment })),
    styleElements: [...range.styleElements],
  };
}

function textRangeMatchesTarget(
  range: ActiveTextRange,
  target: HtmlCanvasSelection | null,
): boolean {
  if (!target) return false;
  return Boolean(
    range.target.id === target.id
    || (
      range.target.elementId
      && target.elementId
      && range.target.elementId === target.elementId
    )
    || (
      range.target.nodeId
      && target.nodeId
      && range.target.nodeId === target.nodeId
    )
  );
}

type NativeEditFenceBookmark = {
  fenceId: number;
  target: HtmlCanvasSelection;
  selection: NativeEditSelection;
  focus: boolean;
  toolbarVisible: boolean;
};

type NativeFormatShortcut = "bold" | "italic" | "underline";

type NativeEditCommitResult = {
  ok: boolean;
  mutation: HtmlCanvasMutation | null;
  reason?: string;
  frameReloading?: boolean;
};

type FinishNativeEditingOptions = {
  replayQueuedUserCommand?: boolean;
  deferRuntimeRefresh?: boolean;
};


type DirectSemanticCommand = {
  type: "direct-semantic-operation";
  operation: SemanticOperation;
};
type CanvasSourceCommand = DirectSemanticCommand;
type SourcePatchResult = ReturnType<typeof applyPatchPlan>;
type ForwardProjectionPlan = {
  type: string;
  targetRefs: SourceTargetRef[];
};
type InlineStylePriority = "" | "important";
type InlineStyleFacts = {
  inlineValue: string | null;
  inlinePriority: InlineStylePriority;
  computedValue: string;
};
type InlineStyleOverride = {
  priority: InlineStylePriority;
  computedValue: string;
};

function sourceIndexIdentityReady(sourceIndex: SourceIndexValue | null | undefined): boolean {
  const identity = (sourceIndex as {
    pagerootIdentity?: { complete?: unknown; valid?: unknown };
  } | null | undefined)?.pagerootIdentity;
  return identity?.complete === true && identity?.valid === true;
}

type PagePresentationActionCache = {
  target: HtmlCanvasSelection;
  sourceIndex: ReturnType<typeof buildSourceIndex>;
  sourceHtml: string;
  documentKey: string;
  generation: number;
  currentContext: PageViewContext | null;
  action: PagePresentationAction | null;
};

function computedCssValue(element: HTMLElement, cssProperty: string): string {
  return element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .getPropertyValue(cssProperty)
    .trim() || "";
}

function inlineStyleFacts(element: HTMLElement, cssProperty: string): InlineStyleFacts {
  const inlineValue = element.style.getPropertyValue(cssProperty).trim();
  const priority = element.style.getPropertyPriority(cssProperty);
  return {
    inlineValue: inlineValue || null,
    inlinePriority: priority === "important" ? "important" : "",
    computedValue: computedCssValue(element, cssProperty),
  };
}

function restoreStyleAttribute(element: HTMLElement, styleAttribute: string | null): void {
  if (styleAttribute === null) element.removeAttribute("style");
  else element.setAttribute("style", styleAttribute);
}

function runInlineStyleMutation<T>(
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
  operation: () => T,
): T | undefined {
  return activeNativeEdit
    ? activeNativeEdit.session.runExpectedMutation(operation)
    : operation();
}

function expectedInlineComputedValue(
  element: HTMLElement,
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): string | null {
  return runInlineStyleMutation(activeNativeEdit, () => {
    const previousStyle = element.getAttribute("style");
    try {
      // Resolve the requested value on the real target so structural selectors
      // such as :last-child remain unchanged during the browser comparison.
      // Inline !important is only a temporary canonicalization step; the exact
      // original style attribute is restored before normal/important trials.
      element.style.setProperty(cssProperty, value, "important");
      if (value.trim() && !element.style.getPropertyValue(cssProperty).trim()) return null;
      return computedCssValue(element, cssProperty) || null;
    } finally {
      restoreStyleAttribute(element, previousStyle);
    }
  }) ?? null;
}

function verifyInlineStyleOverride(
  element: HTMLElement,
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): InlineStyleOverride | null {
  const expectedValue = expectedInlineComputedValue(
    element,
    cssProperty,
    value,
    activeNativeEdit,
  );
  if (expectedValue === null) return null;

  const tryPriority = (priority: InlineStylePriority): string | null => (
    runInlineStyleMutation(activeNativeEdit, () => {
      const previousStyle = element.getAttribute("style");
      try {
        element.style.setProperty(cssProperty, value, priority);
        if (value.trim() && !element.style.getPropertyValue(cssProperty).trim()) {
          return null;
        }
        const actualValue = computedCssValue(element, cssProperty);
        return actualValue === expectedValue ? actualValue : null;
      } finally {
        restoreStyleAttribute(element, previousStyle);
      }
    }) ?? null
  );

  const ordinaryValue = tryPriority("");
  if (ordinaryValue !== null) return { priority: "", computedValue: ordinaryValue };
  const importantValue = tryPriority("important");
  if (importantValue !== null) {
    return { priority: "important", computedValue: importantValue };
  }
  return null;
}

function verifyInlineStyleOverrideForTargets(
  elements: readonly HTMLElement[],
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): InlineStyleOverride | null {
  let resolved: InlineStyleOverride | null = null;
  for (const element of elements) {
    const candidate = verifyInlineStyleOverride(
      element,
      cssProperty,
      value,
      activeNativeEdit,
    );
    if (!candidate) return null;
    resolved = resolved && resolved.priority === "important"
      ? resolved
      : candidate.priority === "important"
        ? candidate
        : resolved || candidate;
  }
  return resolved;
}

const HtmlCanvasEditor = forwardRef<HtmlCanvasEditorHandle, HtmlCanvasEditorProps>(function HtmlCanvasEditor(
  {
    html,
    sourceReceipt,
    semanticRevision = 0,
    onChange,
    onSelect,
    onInteraction,
    editRuntimeGrant = null,
    onEditRuntimeLoadStart,
    onEditRuntimeLoadOutcome,
    onRuntimeDegradationChange,
    onCommentLayout,
    onRequestComment,
    onReady,
    onRequestFlush,
    onRequestExport,
    onRequestHistory,
    onRequestReload,
    reloadActionLabel = "重新载入",
    onEditBlocked,
    usageProjectId,
    usageCapture,
    baseHref,
    sourcePath,
    className,
    iframeTitle = "HTML 可视化编辑画布",
    height = 720,
    readOnly = false,
    interactionMode = "editing",
    locked = false,
    enableReorder = true,
    commentedTargets = EMPTY_COMMENTED_TARGETS,
    trackedTargets = EMPTY_TRACKED_TARGETS,
    pageViewContext = null,
    pageViewDocumentKey = "",
    onPageViewContextChange,
    initialScrollTop,
    pointerCapabilityHoverEnabled = true,
  },
  forwardedRef,
) {
  const documentBaseHref = baseHref || baseHrefFromSourcePath(sourcePath);
  const { resourceBase: previewResourceBase, ready: previewAssetsReady } = usePreviewResourceBase(
    html,
    sourcePath,
    Boolean(baseHref),
  );
  const staticAssetBaseHref = previewResourceBase || documentBaseHref;
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeSlotARef = useRef<HTMLIFrameElement | null>(null);
  const runtimeSlotBRef = useRef<HTMLIFrameElement | null>(null);
  const hoverHintMeasureRef = useRef<HTMLDivElement>(null);
  const selectionChromeProjectionRef = useRef<SelectionChromeProjection | null>(null);
  const pagePresentationActionCacheRef = useRef<PagePresentationActionCache | null>(null);
  const frameWrittenHtmlRef = useRef<string | null>(null);
  const connectFrameRef = useRef<(
    iframe: HTMLIFrameElement,
    connectedFrameGeneration: number,
  ) => boolean>(() => false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const spacingMenuRef = useRef<HTMLDetailsElement>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const runtimeGeneratedSelectionRef = useRef(false);
  const selectedSourceSelectionRef = useRef<HtmlCanvasSelection | null>(null);
  const selectedCommentAnchorRef = useRef<HtmlCanvasSelection | null>(null);
  const selectedVisualHintRef = useRef<HtmlCanvasRuntimeVisualHint | null>(null);
  const activeTextRangeRef = useRef<ActiveTextRange | null>(null);
  const activeNativeEditRef = useRef<ActiveNativeEdit | null>(null);
  const nativeCommandQueueRef = useRef(new NativeDeferredCommandQueue());
  const deferNativeCommandRef = useRef<(
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: NativeDeferredCommandOptions,
  ) => boolean>(() => false);
  const drainPendingNativeCommandRef = useRef<(
    session: IslandEditingController,
  ) => void>(() => undefined);
  const nativeEditCheckpointTimerRef = useRef<number | null>(null);
  const nativeEditCheckpointRef = useRef<() => void>(() => undefined);
  const finishNativeEditingRef = useRef<(
    shouldApply: boolean,
    trigger?: NativeEditCheckpointTrigger,
    options?: FinishNativeEditingOptions,
  ) => NativeEditCommitResult>(() => ({
    ok: false,
    mutation: null,
    reason: "文字编辑会话尚未准备完成。",
  }));
  const nativeEditSessionSequenceRef = useRef(0);
  const nativeDomGenerationRef = useRef(0);
  const canvasTargetIdentityScopeRef = useRef<CanvasTargetIdentityScope>(
    createCanvasTargetIdentityScope(0),
  );
  const canvasTargetIdentityScopeForGeneration = useCallback((generation: number) => {
    const normalizedGeneration = Number.isSafeInteger(Number(generation))
      ? Math.max(0, Number(generation))
      : 0;
    const current = canvasTargetIdentityScopeRef.current;
    if (current.generation === normalizedGeneration) return current;
    disposeRuntimeVisualTargetIndex(current.runtimeVisualTargetIndex);
    const next = createCanvasTargetIdentityScope(normalizedGeneration);
    canvasTargetIdentityScopeRef.current = next;
    return next;
  }, []);
  const nativeSessionNeedsCanonicalFenceRef = useRef(false);
  const nativeEditFenceSequenceRef = useRef(0);
  const currentNativeEditLeaseRef = useRef<ActiveNativeEdit["lease"] | null>(null);
  const pendingHistoryBookmarkRef = useRef<NativeEditFenceBookmark | null>(null);
  const pendingHistoryCanonicalFenceRef = useRef(false);
  const fencedDocumentCleanupRef = useRef<() => void>(() => undefined);
  const installFencedDocumentGuardRef = useRef<(documentNode: Document) => void>(
    () => undefined,
  );
  const queueNativeFenceReloadRef = useRef<(
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
  ) => void>(() => undefined);
  const applyNativeFormatShortcutRef = useRef<(
    shortcut: NativeFormatShortcut,
  ) => boolean>(() => false);
  const restartCanonicalNativeEditRef = useRef<(
    active: ActiveNativeEdit,
    target: HtmlCanvasSelection,
    selection: NativeEditSelection,
    previousIndex: SourceIndexValue,
    nextIndex: SourceIndexValue,
  ) => boolean>(() => false);
  const nativeEditFinishingRef = useRef(false);
  const nativeEditNeedsReloadRef = useRef(false);
  const retainNativeEditFocusRef = useRef<RetainedNativeEditFocus | null>(null);
  const blockedOuterCompositionGestureRef = useRef(false);
  const insertionPointsRef = useRef<InsertionPoint[]>([]);
  const insertionLayoutAuthorityRef = useRef<InsertionLayoutAuthority | null>(null);
  const cleanupFrameRef = useRef<() => void>(() => undefined);
  const connectedFrameRef = useRef<{
    iframe: HTMLIFrameElement;
    generation: number;
  } | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameInitializedRef = useRef(false);
  const lastSourceReceiptRef = useRef<DocumentSourceReceipt | null>(sourceReceipt);
  const renderedSourceHtmlRef = useRef<string | null>(null);
  const renderedProjectionSha256Ref = useRef("");
  const frameSourceHtmlRef = useRef(html);
  const sourceIndexRef = useRef<SourceIndexValue | null>(null);
  const latestSourceProjectionRef = useRef<{
    source: string;
    sourceIndex: SourceIndexValue | null;
  }>({ source: html, sourceIndex: null });
  const pendingSelectionRef = useRef<HtmlCanvasSelection | null>(null);
  const pendingToolbarVisibleRef = useRef(false);
  const pendingFrameRestoreEpochRef = useRef(0);
  const toolbarVisibleRef = useRef(false);
  const pointerCapabilityHoverEnabledRef = useRef(pointerCapabilityHoverEnabled);
  const hoverControllerRef = useRef<ReturnType<typeof createCanvasCapabilityHoverController> | null>(null);
  const hoverHintPointerInsideRef = useRef(false);
  const pendingFrameViewportRef = useRef<{ left: number; top: number } | null>(null);
  const pendingSharedViewportRef = useRef<{
    element: HTMLElement;
    left: number;
    top: number;
  } | null>(null);
  const pendingStaticPresentationAnchorRef = useRef<RuntimePresentationAnchor | null>(null);
  const lastSameDocumentPresentationAnchorRef = useRef<RuntimePresentationAnchor | null>(null);
  const expectedFrameHtmlRef = useRef<string | null>(null);
  const expectedFrameTokenRef = useRef<string | null>(null);
  const frameLoadGenerationRef = useRef(0);
  const frameGenerationSequenceRef = useRef(0);
  const activeFrameConnectionPendingRef = useRef(false);
  const runtimeFrameRef = useRef<RuntimeFrameContext | null>(null);
  const runtimeReadyReportedRef = useRef(new WeakSet<RuntimeFrameContext>());
  const runtimeSourceElementsRef = useRef<RuntimeSourceElements | null>(null);
  const runtimeSourceRegistrationCleanupRef = useRef<() => void>(() => undefined);
  const runtimeRefreshPendingRef = useRef<RuntimeRefreshPending | null>(null);
  const lastEditRuntimeGrantRef = useRef(editRuntimeGrant);
  const runtimeFrameCoordinatorRef = useRef<RuntimeFrameCoordinator | null>(null);
  if (!runtimeFrameCoordinatorRef.current) {
    runtimeFrameCoordinatorRef.current = new RuntimeFrameCoordinator();
  }
  const runtimeCandidateRef = useRef<RuntimeCandidate | null>(null);
  const deferredRuntimeCandidateRef = useRef<DeferredRuntimeCandidate | null>(null);
  const deferredRuntimeCandidateLeaseRef = useRef(0);
  const lastRuntimeCandidateFailureRef = useRef<string | null>(null);
  const replayDeferredRuntimeCandidateRef = useRef<() => void>(() => undefined);
  const runtimeCandidateIframeRef = useRef<HTMLIFrameElement | null>(null);
  const runtimePromotionRef = useRef<RuntimeCandidate | null>(null);
  const runtimeInactiveCleanupFrameRef = useRef<number | null>(null);
  const runtimeInactiveGenerationRef = useRef<number | null>(null);
  const finalizeRuntimePromotionRef = useRef<(candidate: RuntimeCandidate) => void>(
    () => undefined,
  );
  const commitRuntimeCandidateRef = useRef<
    (candidate: RuntimeCandidate, iframe: HTMLIFrameElement) => boolean
  >(() => false);
  const abortInFlightRuntimeCommitRef = useRef<
    ((outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">) => boolean) | null
  >(null);
  const failRuntimeCandidateActivationRef = useRef<(
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ) => boolean>(() => false);
  const cancelRuntimeCandidateRef = useRef<(
    candidate: RuntimeCandidate,
    outcome?: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
    keepHandoffPreparing?: boolean,
  ) => boolean>(
    () => false,
  );
  const startRuntimeCandidateRef = useRef<(
    source: string,
    options?: RuntimeCandidateStartOptions,
  ) => boolean>(
    () => false,
  );
  const connectRuntimeCandidateRef = useRef<(
    iframe: HTMLIFrameElement,
    generation: number,
  ) => boolean>(() => false);
  const updateOverlayPositionRef = useRef<() => void>(() => undefined);
  const imperativeLockRef = useRef(false);
  const lastPropRef = useRef({
    sessionIncarnation: sourceReceipt?.sessionIncarnation ?? null,
    receiptSequence: sourceReceipt?.sequence ?? null,
  });
  const semanticRevisionRef = useRef(semanticRevision);
  const lastSemanticRevisionPropRef = useRef(semanticRevision);
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const onInteractionRef = useRef(onInteraction);
  const onEditRuntimeLoadStartRef = useRef(onEditRuntimeLoadStart);
  const onEditRuntimeLoadOutcomeRef = useRef(onEditRuntimeLoadOutcome);
  const onRuntimeDegradationChangeRef = useRef(onRuntimeDegradationChange);
  const onCommentLayoutRef = useRef(onCommentLayout);
  const onRequestCommentRef = useRef(onRequestComment);
  const onRequestFlushRef = useRef(onRequestFlush);
  const onRequestExportRef = useRef(onRequestExport);
  const onRequestHistoryRef = useRef(onRequestHistory);
  const onEditBlockedRef = useRef(onEditBlocked);
  const readOnlyRef = useRef(readOnly);
  const lockedRef = useRef(locked);
  const enableReorderRef = useRef(enableReorder);
  const commentedTargetsRef = useRef(commentedTargets);
  const trackedTargetsRef = useRef(trackedTargets);
  const pageViewContextRef = useRef<PageViewContext | null>(pageViewContext);
  const lastPageViewContextPropRef = useRef<PageViewContext | null>(pageViewContext);
  const appliedPageViewContextRef = useRef<PageViewContext | null>(null);
  const pageViewDocumentKeyRef = useRef(pageViewDocumentKey);
  const onPageViewContextChangeRef = useRef(onPageViewContextChange);
  const controlledMode = locked ? "processing" : interactionMode;
  const controlledInteractionLocked = controlledMode !== "editing";
  const [imperativeLocked, setImperativeLocked] = useState(false);
  const interactionLocked = controlledInteractionLocked || imperativeLocked;
  const [runtimeDegradation, setRuntimeDegradation] = useState<HtmlCanvasRuntimeDegradation>("none");
  const runtimeFallbackReadOnly = runtimeDegradation === "static-preparing"
    || runtimeDegradation === "last-known-good-readonly";
  const effectiveReadOnly = readOnly || runtimeFallbackReadOnly;
  const renderedMode: HtmlCanvasInteractionMode =
    controlledMode === "history"
      ? "history"
      : interactionLocked
        ? "processing"
        : "editing";

  onChangeRef.current = onChange;
  if (lastSemanticRevisionPropRef.current !== semanticRevision) {
    lastSemanticRevisionPropRef.current = semanticRevision;
    semanticRevisionRef.current = semanticRevision;
  }
  onSelectRef.current = onSelect;
  onInteractionRef.current = onInteraction;
  onEditRuntimeLoadStartRef.current = onEditRuntimeLoadStart;
  onEditRuntimeLoadOutcomeRef.current = onEditRuntimeLoadOutcome;
  onRuntimeDegradationChangeRef.current = onRuntimeDegradationChange;
  onCommentLayoutRef.current = onCommentLayout;
  onRequestCommentRef.current = onRequestComment;
  onRequestFlushRef.current = onRequestFlush;
  onRequestExportRef.current = onRequestExport;
  onRequestHistoryRef.current = onRequestHistory;
  onEditBlockedRef.current = onEditBlocked;
  readOnlyRef.current = effectiveReadOnly
    || controlledInteractionLocked
    || imperativeLockRef.current;
  lockedRef.current = controlledInteractionLocked || imperativeLockRef.current;
  enableReorderRef.current = enableReorder && !lockedRef.current;
  commentedTargetsRef.current = commentedTargets;
  trackedTargetsRef.current = trackedTargets;
  if (lastPageViewContextPropRef.current !== pageViewContext) {
    lastPageViewContextPropRef.current = pageViewContext;
    pageViewContextRef.current = pageViewContext;
  }
  pageViewDocumentKeyRef.current = pageViewDocumentKey;
  onPageViewContextChangeRef.current = onPageViewContextChange;
  pointerCapabilityHoverEnabledRef.current = pointerCapabilityHoverEnabled;

  const currentRuntimeSourceProof = useCallback(() => {
    const runtimeFrame = runtimeFrameRef.current;
    if (
      !runtimeFrame?.settled
      || runtimeFrame.elementGeneration !== frameLoadGenerationRef.current
    ) return null;
    const registered = runtimeSourceElementsRef.current;
    return (element: HTMLElement) => {
      const registeredPagerootId = registered?.pagerootIds.get(element);
      const livePagerootId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
      const liveSourceEntry = livePagerootId
        ? sourceIndexRef.current?.byPagerootId.get(livePagerootId)
        : null;
      return Boolean(
        registered
        && registered.elementGeneration === runtimeFrame.elementGeneration
        && registered.executionId === runtimeFrame.grant.executionId
        && registered.elements.has(element)
        && element.isConnected
        && registeredPagerootId
        && registeredPagerootId === livePagerootId
        && registeredPagerootId === element.getAttribute(
          EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
        )
        && liveSourceEntry?.type === "element"
        && liveSourceEntry.tagName === element.localName
      );
    };
  }, []);

  const currentRuntimeShadowProof = useCallback(() => {
    const runtimeFrame = runtimeFrameRef.current;
    const registered = runtimeSourceElementsRef.current;
    if (
      !runtimeFrame?.settled
      || runtimeFrame.elementGeneration !== frameLoadGenerationRef.current
      || registered?.elementGeneration !== runtimeFrame.elementGeneration
      || registered.executionId !== runtimeFrame.grant.executionId
    ) return null;
    return (element: HTMLElement) => registered.runtimeShadowHosts.has(element);
  }, []);

  // Snapshots and canonical remounts create new objects. Only these private,
  // controller-owned paths may transfer identity; matching public attributes
  // on an author-created clone never confers mutation authority.
  const transferRuntimeSourceElement = useCallback((original: Element, clone: Element) => {
    const registered = runtimeSourceElementsRef.current;
    const runtime = runtimeFrameRef.current;
    const id = registered?.pagerootIds.get(original as HTMLElement);
    if (!registered || !runtime || !id
      || registered.elementGeneration !== runtime.elementGeneration
      || registered.executionId !== runtime.grant.executionId
      || runtime.elementGeneration !== frameLoadGenerationRef.current
      || original.ownerDocument !== iframeRef.current?.contentDocument
      || clone.ownerDocument !== original.ownerDocument
      || !registered.elements.has(original as HTMLElement)
      || original.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) !== id
      || clone.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) !== id
      || clone.localName !== original.localName) return;
    registered.elements.add(clone as HTMLElement);
    registered.pagerootIds.set(clone as HTMLElement, id);
    clone.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, id);
  }, []);

  const registerRestoredRuntimeElements = useCallback((
    authorityRoot: HTMLElement,
    elements: readonly Element[],
    sourceIndex = sourceIndexRef.current,
  ) => {
    const registered = runtimeSourceElementsRef.current;
    const runtime = runtimeFrameRef.current;
    const rootId = registered?.pagerootIds.get(authorityRoot);
    if (!registered || !runtime || !sourceIndex || !rootId
      || !registered.elements.has(authorityRoot)
      || authorityRoot.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) !== rootId
      || registered.elementGeneration !== runtime.elementGeneration
      || registered.executionId !== runtime.grant.executionId
      || runtime.elementGeneration !== frameLoadGenerationRef.current
      || authorityRoot.ownerDocument !== iframeRef.current?.contentDocument) return;
    for (const element of elements) {
      const id = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
      const entry = id ? sourceIndex.byPagerootId.get(id) : null;
      if (!id || entry?.type !== "element" || entry.tagName !== element.localName
        || element.ownerDocument !== authorityRoot.ownerDocument) continue;
      registered.elements.add(element as HTMLElement);
      registered.pagerootIds.set(element as HTMLElement, id);
      element.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, id);
    }
  }, []);

  const selectedElementHasSourceMutationAuthority = useCallback(() => {
    const element = selectedElementRef.current;
    if (
      !element?.isConnected
      || runtimeGeneratedSelectionRef.current
    ) return false;
    if (!runtimeFrameRef.current) return true;
    return Boolean(currentRuntimeSourceProof()?.(element));
  }, [currentRuntimeSourceProof]);

  // Keep the server and hydration value deterministic, then normalize through DOMParser after mount.
  const [frameRender, setFrameRender] = useState(() => ({
    html: disableExecutableMarkup(html),
    elementGeneration: 0,
    runtime: false,
  }));
  const [activeRuntimeSlotId, setActiveRuntimeSlotId] = useState<RuntimeFrameSlotId>("a");
  const { getScrollTop, restoreInitialScroll, scrollToTop } = useCanvasPresentationScroll({
    iframeRef,
    frameGeneration: frameRender.elementGeneration,
    initialScrollTop,
  });
  const [canvasTransitionActive, setCanvasTransitionActive] = useState(false);
  const [runtimeCandidateRender, setRuntimeCandidateRender] = useState<RuntimeCandidateRender | null>(null);
  const [runtimeInactiveRender, setRuntimeInactiveRender] = useState<RuntimeCandidateRender | null>(null);
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [runtimeGeneratedSelection, setRuntimeGeneratedSelection] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [hoverChrome, setHoverChrome] = useState<CanvasCapabilityHoverSnapshot>({
    cursor: "default",
    outline: false,
    hint: false,
    capability: null,
  });
  const [hoverHintMeasurement, setHoverHintMeasurement] = useState<{
    copy: string;
    width: number;
  } | null>(null);
  const [hasTextRange, setHasTextRange] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyle>({
    fontSize: 16,
    color: "#202124",
    backgroundColor: "#ffffff",
    padding: 0,
    margin: 0,
    lineHeight: 24,
    isBold: false,
    isItalic: false,
    isUnderline: false,
  });
  const [moveAvailability, setMoveAvailability] = useState<MoveAvailability>({ up: false, down: false });
  const [isEditing, setIsEditing] = useState(false);
  const [commentMarkers, setCommentMarkers] = useState<HtmlCanvasCommentMarker[]>([]);
  const [editFeedback, setEditFeedback] = useState<HtmlCanvasEditFeedback | null>(null);
  const [editFeedbackPaused, setEditFeedbackPaused] = useState(false);
  const [spacingMenuOpen, setSpacingMenuOpen] = useState(false);

  toolbarVisibleRef.current = toolbarVisible;

  useEffect(() => {
    const controller = createCanvasCapabilityHoverController({
      onChange: setHoverChrome,
    });
    hoverControllerRef.current = controller;
    return () => {
      controller.dispose();
      hoverControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    installEditPipelineTestHooks();
    return attachRuntimeContinuityProbe(() => containerRef.current);
  }, []);

  useEffect(() => {
    if (pointerCapabilityHoverEnabled) return;
    hoverControllerRef.current?.hide();
  }, [pointerCapabilityHoverEnabled]);

  useEffect(() => {
    // contentDocument can be alive while documentElement is null: that is the
    // iframe navigation window, where the old document is detached and the next
    // one has not parsed its root element yet. Touching the root there throws
    // during commit and unmounts the whole tree, so the effect simply waits for
    // the next run, which the cursor/hover state change already schedules.
    const rootElement = iframeRef.current?.contentDocument?.documentElement;
    if (!rootElement) return;
    if (!pointerCapabilityHoverEnabled || hoverChrome.cursor === "default") {
      rootElement.removeAttribute("data-html-canvas-pointer");
      return;
    }
    rootElement.setAttribute(
      "data-html-canvas-pointer",
      hoverChrome.cursor,
    );
  }, [hoverChrome.cursor, pointerCapabilityHoverEnabled]);

  useEffect(() => {
    const documentNode = containerRef.current?.ownerDocument;
    if (!documentNode) return undefined;
    const closeOutsideSpacingMenu = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || spacingMenuRef.current?.contains(target)) return;
      setSpacingMenuOpen(false);
    };
    documentNode.addEventListener("pointerdown", closeOutsideSpacingMenu, true);
    return () => {
      documentNode.removeEventListener("pointerdown", closeOutsideSpacingMenu, true);
    };
  }, []);

  useEffect(() => {
    const documentNode = containerRef.current?.ownerDocument;
    if (!documentNode) return undefined;
    const preserveCompositionFocus = (event: Event) => {
      const activeNativeEdit = activeNativeEditRef.current;
      if (!activeNativeEdit?.session.isComposing()) return;
      blockedOuterCompositionGestureRef.current = true;
      // Prevent only the focus-moving pointer default. The click must still
      // reach its real save/export/style handler so that handler can
      // enqueue one explicit latest-wins command.
      event.preventDefault();
    };
    const releaseGestureToken = () => {
      blockedOuterCompositionGestureRef.current = false;
    };

    documentNode.addEventListener("pointerdown", preserveCompositionFocus, true);
    documentNode.addEventListener("mousedown", preserveCompositionFocus, true);
    documentNode.addEventListener("click", releaseGestureToken, true);
    documentNode.addEventListener("pointercancel", releaseGestureToken, true);
    return () => {
      blockedOuterCompositionGestureRef.current = false;
      documentNode.removeEventListener("pointerdown", preserveCompositionFocus, true);
      documentNode.removeEventListener("mousedown", preserveCompositionFocus, true);
      documentNode.removeEventListener("click", releaseGestureToken, true);
      documentNode.removeEventListener("pointercancel", releaseGestureToken, true);
    };
  }, []);

  useEffect(() => {
    setEditFeedbackPaused(false);
  }, [editFeedback?.title, editFeedback?.message]);

  useEffect(() => {
    if (!editFeedback || editFeedback.sticky || editFeedbackPaused) return undefined;
    const timer = window.setTimeout(() => {
      setEditFeedback((current) => current === editFeedback ? null : current);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [editFeedback, editFeedbackPaused]);

  const syncRuntimeRefreshDiagnostics = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const pending = runtimeRefreshPendingRef.current;
    root.toggleAttribute("data-runtime-refresh-pending", Boolean(pending));
    if (pending) {
      root.setAttribute(
        "data-runtime-refresh-pending-source-revision",
        pending.sourceRevision,
      );
      root.setAttribute("data-runtime-refresh-pending-reason", pending.reason);
      root.setAttribute(
        "data-runtime-refresh-coalesced-count",
        String(pending.coalescedCount),
      );
    } else {
      root.removeAttribute("data-runtime-refresh-pending-source-revision");
      root.removeAttribute("data-runtime-refresh-pending-reason");
      root.removeAttribute("data-runtime-refresh-coalesced-count");
    }
  }, []);

  const recordRuntimeRefreshDecision = useCallback((
    decision: EditRuntimeRefreshDecision,
  ) => {
    const root = containerRef.current;
    root?.setAttribute("data-runtime-refresh-decision", decision.action);
    root?.setAttribute("data-runtime-refresh-reason", decision.reason);
  }, []);

  const markRuntimeRefreshPending = useCallback((
    sourceRevision: string,
    reason: string,
  ) => {
    const previous = runtimeRefreshPendingRef.current;
    runtimeRefreshPendingRef.current = {
      sourceRevision,
      reason,
      coalescedCount: previous ? previous.coalescedCount + 1 : 1,
    };
    syncRuntimeRefreshDiagnostics();
  }, [syncRuntimeRefreshDiagnostics]);

  const advanceRuntimeRefreshPending = useCallback((sourceRevision: string) => {
    const pending = runtimeRefreshPendingRef.current;
    if (!pending || pending.sourceRevision === sourceRevision) return;
    runtimeRefreshPendingRef.current = { ...pending, sourceRevision };
    syncRuntimeRefreshDiagnostics();
  }, [syncRuntimeRefreshDiagnostics]);

  const clearRuntimeRefreshPending = useCallback((sourceRevision: string) => {
    if (runtimeRefreshPendingRef.current?.sourceRevision !== sourceRevision) return false;
    runtimeRefreshPendingRef.current = null;
    syncRuntimeRefreshDiagnostics();
    return true;
  }, [syncRuntimeRefreshDiagnostics]);

  const supersedeRuntimeRefreshPending = useCallback(() => {
    if (!runtimeRefreshPendingRef.current) return false;
    runtimeRefreshPendingRef.current = null;
    syncRuntimeRefreshDiagnostics();
    return true;
  }, [syncRuntimeRefreshDiagnostics]);

  const syncRuntimeCandidateDiagnostics = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const snapshot = runtimeFrameCoordinatorRef.current!.snapshot;
    const latest = snapshot.latestCandidate;
    const lastKnownGood = snapshot.lastKnownGood;
    if (latest) {
      root.setAttribute("data-runtime-candidate-id", latest.candidateId);
      root.setAttribute("data-runtime-candidate-generation", String(latest.generation));
      root.setAttribute("data-runtime-candidate-source-revision", latest.sourceRevision);
      root.setAttribute("data-runtime-candidate-phase", snapshot.latestPhase || "preparing");
    } else {
      root.removeAttribute("data-runtime-candidate-id");
      root.removeAttribute("data-runtime-candidate-generation");
      root.removeAttribute("data-runtime-candidate-source-revision");
      root.removeAttribute("data-runtime-candidate-phase");
    }
    if (lastKnownGood) {
      root.setAttribute("data-runtime-last-known-good-id", lastKnownGood.candidateId);
      root.setAttribute(
        "data-runtime-last-known-good-generation",
        String(lastKnownGood.generation),
      );
      root.setAttribute(
        "data-runtime-last-known-good-source-revision",
        lastKnownGood.sourceRevision,
      );
    } else {
      root.removeAttribute("data-runtime-last-known-good-id");
      root.removeAttribute("data-runtime-last-known-good-generation");
      root.removeAttribute("data-runtime-last-known-good-source-revision");
    }
    root.setAttribute(
      "data-runtime-ignored-callback-count",
      String(snapshot.ignoredCallbackCount),
    );
  }, []);

  const publishRuntimeDegradation = useCallback((
    state: HtmlCanvasRuntimeDegradation,
  ) => {
    setRuntimeDegradation(state);
    onRuntimeDegradationChangeRef.current?.(state);
  }, []);

  const beginRuntimeAttempt = useCallback((
    generation: number,
    sourceRevision: string,
    kind: RuntimeFrameIdentity["kind"] = "dynamic",
  ): RuntimeFrameIdentity => {
    const { identity } = runtimeFrameCoordinatorRef.current!.beginCandidate({
      generation,
      sourceRevision,
      kind,
    });
    syncRuntimeCandidateDiagnostics();
    return identity;
  }, [syncRuntimeCandidateDiagnostics]);

  const endRuntimeNativeEdit = useCallback(() => {
    runtimeFrameCoordinatorRef.current!.endNativeEdit();
    syncRuntimeCandidateDiagnostics();
    window.requestAnimationFrame(() => replayDeferredRuntimeCandidateRef.current());
  }, [syncRuntimeCandidateDiagnostics]);

  const deferRuntimeCandidate = useCallback((
    source: string,
    sourceRevision: string,
    kind: RuntimeFrameIdentity["kind"],
    predecessorCandidateId: string | null = null,
    handoffContext: RuntimeHandoffContext | null = null,
  ): DeferredRuntimeCandidate | null => {
    const latest = latestSourceProjectionRef.current;
    if (
      latest.source !== source
      || (
        latest.sourceIndex
        && latest.sourceIndex.sourceSha256 !== sourceRevision
      )
    ) return null;
    const request: DeferredRuntimeCandidate = {
      lease: deferredRuntimeCandidateLeaseRef.current + 1,
      source,
      sourceRevision,
      kind,
      predecessorCandidateId,
      handoffContext,
    };
    deferredRuntimeCandidateLeaseRef.current = request.lease;
    deferredRuntimeCandidateRef.current = request;
    window.requestAnimationFrame(() => replayDeferredRuntimeCandidateRef.current());
    return request;
  }, []);

  const deferLatestStaticRuntimeCandidate = useCallback((
    predecessorCandidateId: string,
    handoffContext: RuntimeHandoffContext,
  ): DeferredRuntimeCandidate | null => {
    const latest = latestSourceProjectionRef.current;
    let sourceIndex = latest.sourceIndex;
    if (!sourceIndex) {
      try {
        sourceIndex = buildSourceIndex(latest.source);
        latestSourceProjectionRef.current = { source: latest.source, sourceIndex };
      } catch {
        return null;
      }
    }
    // A user may finish a Native Edit while the dynamic failure is waiting to
    // queue its static replacement. Carry the original reading intent forward
    // and refresh only selection intent from the authoritative Active. Source
    // revision, generation and slot authorization remain solely owned by the
    // deferred request and RuntimeFrameCoordinator candidate identity.
    const nextPendingSelection = selectedSourceSelectionRef.current
      ?? handoffContext.pendingSelection;
    const nextHandoffContext = {
      ...handoffContext,
      pendingSelection: nextPendingSelection,
      pendingToolbarVisible: Boolean(
        nextPendingSelection && toolbarVisibleRef.current,
      ),
    };
    lastRuntimeCandidateFailureRef.current = predecessorCandidateId;
    return deferRuntimeCandidate(
      latest.source,
      sourceIndex.sourceSha256,
      "static-disabled",
      predecessorCandidateId,
      nextHandoffContext,
    );
  }, [deferRuntimeCandidate]);

  const scheduleLatestStaticFallbackAfterFailure = useCallback((
    predecessorCandidateId: string,
    handoffContext: RuntimeHandoffContext,
  ) => {
    lastRuntimeCandidateFailureRef.current = predecessorCandidateId;
    const run = () => {
      if (lastRuntimeCandidateFailureRef.current !== predecessorCandidateId) return;
      publishRuntimeDegradation("static-preparing");
      if (!deferLatestStaticRuntimeCandidate(predecessorCandidateId, handoffContext)) {
        lastRuntimeCandidateFailureRef.current = null;
        publishRuntimeDegradation("last-known-good-readonly");
      }
    };
    // E2E-only: pause after the dynamic Candidate has failed, before the
    // static-preparing lock. The callback only continues scheduling; it does
    // not mark the failed Candidate ready.
    if (window.htmlAIRuntime?.diagnostics?.e2eRuntimeCommitHooks === true) {
      const releases = window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__;
      if (Array.isArray(releases)) {
        releases.push(run);
        return;
      }
    }
    run();
  }, [deferLatestStaticRuntimeCandidate, publishRuntimeDegradation]);

  const visibleAuthoritativeFrameReady = useCallback((): boolean => {
    const currentRuntime = runtimeFrameRef.current;
    if (
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current
    ) return true;
    return Boolean(
      !currentRuntime
      && iframeRef.current?.contentDocument?.documentElement
      && frameRender.elementGeneration === frameLoadGenerationRef.current
      && renderedSourceHtmlRef.current
      && containerRef.current?.getAttribute("data-render-verified") === "true"
    );
  }, [frameRender.elementGeneration]);

  const scheduleDynamicRuntimeRefresh = useCallback((source: string): boolean => {
    try {
      const latest = latestSourceProjectionRef.current;
      const sourceRevision = latest.source === source && latest.sourceIndex
        ? latest.sourceIndex.sourceSha256
        : buildSourceIndex(source).sourceSha256;
      recordRuntimeContinuityEvent("runtimeRefreshRequested", { reason: "dynamic" });
      return Boolean(deferRuntimeCandidate(source, sourceRevision, "dynamic"));
    } catch {
      deferredRuntimeCandidateRef.current = null;
      return false;
    }
  }, [deferRuntimeCandidate]);

  const requestDynamicRuntimeRefresh = useCallback((source: string): boolean => {
    if (!editRuntimeGrant) return false;
    if (activeNativeEditRef.current || !visibleAuthoritativeFrameReady()) {
      return scheduleDynamicRuntimeRefresh(source);
    }
    if (startRuntimeCandidateRef.current(source)) return true;
    return scheduleDynamicRuntimeRefresh(source);
  }, [editRuntimeGrant, scheduleDynamicRuntimeRefresh, visibleAuthoritativeFrameReady]);

  const completeRuntimeAttempt = useCallback((
    frame: RuntimeFrameContext,
    outcome: HtmlCanvasEditRuntimeLoadOutcome,
  ): RuntimeFrameSettlement => {
    const settlement = runtimeFrameCoordinatorRef.current!.settle(
      frame.attempt,
      outcome,
    );
    syncRuntimeCandidateDiagnostics();
    if (!settlement.accepted) return settlement;
    frame.settled = true;
    if (outcome === "ready") {
      publishRuntimeDegradation(
        frame.activation === "partial" ? "runtime-partial" : "none",
      );
    }
    onEditRuntimeLoadOutcomeRef.current?.(
      frame.grant,
      outcome,
      frame.attempt,
      {
        preserveLastKnownGood: settlement.preserveLastKnownGood,
        shouldUseStaticFallback: settlement.shouldUseStaticFallback,
        runtimePartial: outcome === "ready" && frame.activation === "partial",
      },
    );
    return settlement;
  }, [publishRuntimeDegradation, syncRuntimeCandidateDiagnostics]);

  const loadFrameSource = useCallback((
    source: string,
    options: {
      preserveViewport?: boolean;
      immediate?: boolean;
      forceStatic?: boolean;
      reuseDocument?: boolean;
    } = {},
  ) => {
    if (options.forceStatic) {
      deferredRuntimeCandidateRef.current = null;
      deferredRuntimeCandidateLeaseRef.current += 1;
      lastRuntimeCandidateFailureRef.current = null;
    }
    const abortInFlightCommit = abortInFlightRuntimeCommitRef.current;
    if (abortInFlightCommit) {
      abortInFlightCommit("superseded");
    } else {
      const promotedCandidate = runtimePromotionRef.current;
      if (promotedCandidate) {
        failRuntimeCandidateActivationRef.current(promotedCandidate, "superseded")
          || cancelRuntimeCandidateRef.current(promotedCandidate, "superseded");
      }
    }
    const pendingCandidate = runtimeCandidateRef.current;
    if (pendingCandidate) {
      cancelRuntimeCandidateRef.current(pendingCandidate, "superseded");
    }
    performance.mark("pageroot:canvas:load-start");
    const frameView = iframeRef.current?.contentWindow;
    const sharedScrollElement = containerRef.current?.closest<HTMLElement>(
      ".review-scroll-stage",
    ) ?? null;
    pendingFrameViewportRef.current = options.preserveViewport && frameView
      ? { left: frameView.scrollX, top: frameView.scrollY }
      : null;
    const rememberedAnchor = lastSameDocumentPresentationAnchorRef.current;
    pendingSharedViewportRef.current = options.preserveViewport && sharedScrollElement
      ? {
          element: sharedScrollElement,
          left: rememberedAnchor?.outerScrollLeft ?? sharedScrollElement.scrollLeft,
          top: rememberedAnchor?.outerScrollTop ?? sharedScrollElement.scrollTop,
        }
      : null;
    pendingStaticPresentationAnchorRef.current = options.forceStatic && options.preserveViewport
      ? rememberedAnchor ?? captureRuntimePresentationAnchor({
          iframe: iframeRef.current,
          outerScrollElement: sharedScrollElement,
          sourceIndex: sourceIndexRef.current,
          selectedElement: null,
          selectedSourceSelection: null,
        })
      : null;
    runtimeSourceRegistrationCleanupRef.current();
    runtimeSourceRegistrationCleanupRef.current = () => undefined;
    runtimeSourceElementsRef.current = null;
    // A frame load invalidates every DOM reference. Keep only the logical
    // selection snapshot for the existing selectTarget() rebind path.
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
    selectedElementRef.current = null;
    selectedCommentAnchorRef.current = null;
    selectedVisualHintRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    const reuseCandidate = Boolean(options.reuseDocument)
      && !options.immediate
      && !options.forceStatic
      && Boolean(iframeRef.current?.contentDocument?.documentElement);
    // Retire the old document's canvas handlers before advancing any source,
    // token, or generation authority. A non-immediate React remount may not
    // commit until the current task ends; without this cut the old DOM could
    // briefly dispatch against the next source map (or keep listeners forever
    // if the replacement document never reaches load).
    hoverControllerRef.current?.hide();
    cleanupFrameRef.current();
    connectedFrameRef.current = null;
    const previousRuntimeFrame = runtimeFrameRef.current;
    runtimeFrameRef.current = null;
    if (previousRuntimeFrame && !previousRuntimeFrame.settled) {
      completeRuntimeAttempt(previousRuntimeFrame, "superseded");
    }
    pendingFrameRestoreEpochRef.current += 1;
    if (!reuseCandidate) {
      frameLoadGenerationRef.current += 1;
    }
    const nextFrameGeneration = frameLoadGenerationRef.current;
    frameGenerationSequenceRef.current = Math.max(
      frameGenerationSequenceRef.current,
      nextFrameGeneration,
    );
    nativeDomGenerationRef.current += 1;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    nativeEditNeedsReloadRef.current = false;
    currentNativeEditLeaseRef.current = null;
    retainNativeEditFocusRef.current = null;
    const randomPart = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const token = `frame_${frameLoadGenerationRef.current}_${randomPart}`;
    const instrumentedSource = source;
    try {
      const sourceIndex = buildSourceIndex(source);
      sourceIndexRef.current = sourceIndex;
      latestSourceProjectionRef.current = { source, sourceIndex };
      if (!sourceIndexIdentityReady(sourceIndex)) {
        throw new Error("PAGEROOT_IDENTITY_INCOMPLETE");
      }
      setEditFeedback(null);
    } catch (cause) {
      sourceIndexRef.current = null;
      latestSourceProjectionRef.current = { source, sourceIndex: null };
      void cause;
      const message = "页面仍可正常浏览。请重新载入后再试，或添加评论说明要改什么。";
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: "暂时不能直接编辑这个页面",
        message,
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      onEditBlockedRef.current?.(message);
    }
    performance.mark("pageroot:canvas:instrumented");
    const verificationToken = token;
    const prepared = prepareCanvasFrameDocument(instrumentedSource, token, {
      mode: "static",
      baseUrl: staticAssetBaseHref,
      editorStyles: EDITOR_DOCUMENT_STYLES,
    }) || prepareVerifiedFrameDocument(instrumentedSource, token, {
      baseUrl: staticAssetBaseHref,
      editorStyles: EDITOR_DOCUMENT_STYLES,
    });
    frameSourceHtmlRef.current = source;
    expectedFrameTokenRef.current = verificationToken;
    expectedFrameHtmlRef.current = prepared;
    renderedSourceHtmlRef.current = null;
    renderedProjectionSha256Ref.current = "";
    containerRef.current?.removeAttribute("data-runtime-bootstrap-count");
    runtimeFrameRef.current = null;
    if (editRuntimeGrant) scheduleDynamicRuntimeRefresh(source);
    const iframe = iframeRef.current;
    if (reuseCandidate && iframe && prepared) {
      try {
        containerRef.current?.setAttribute("data-canvas-transition", "true");
        setCanvasTransitionActive(true);
        const documentNode = iframe.contentDocument;
        if (!documentNode) throw new Error("missing content document");
        documentNode.open();
        documentNode.write(prepared);
        documentNode.close();
        frameWrittenHtmlRef.current = prepared;
        connectFrameRef.current(iframe, nextFrameGeneration);
        window.requestAnimationFrame(() => {
          containerRef.current?.removeAttribute("data-canvas-transition");
          setCanvasTransitionActive(false);
        });
        return;
      } catch {
        containerRef.current?.removeAttribute("data-canvas-transition");
        setCanvasTransitionActive(false);
        frameWrittenHtmlRef.current = null;
        frameLoadGenerationRef.current += 1;
      }
    }
    frameWrittenHtmlRef.current = null;
    containerRef.current?.setAttribute("data-render-verified", "false");
    const remountGeneration = frameLoadGenerationRef.current;
    const replaceFrameElement = () => {
      recordRuntimeContinuityEvent("frameCreated", { reason: options.immediate ? "immediate" : "scheduled" });
      setFrameRender({
        html: prepared,
        elementGeneration: remountGeneration,
        runtime: false,
      });
    };
    if (options.immediate) {
      // Keep the physical slot stable, but commit its sandbox-before-srcdoc
      // navigation before the caller proceeds. The new Document, rather than a
      // new iframe node, retires the previous native-edit browsing context.
      flushSync(replaceFrameElement);
    } else {
      replaceFrameElement();
    }
  }, [
    completeRuntimeAttempt,
    editRuntimeGrant,
    scheduleDynamicRuntimeRefresh,
    staticAssetBaseHref,
  ]);

  const clearRuntimeInactiveSlot = useCallback(() => {
    const cleanupFrame = runtimeInactiveCleanupFrameRef.current;
    if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
    runtimeInactiveCleanupFrameRef.current = null;
    runtimeInactiveGenerationRef.current = null;
    setRuntimeInactiveRender(null);
  }, []);

  const scheduleRuntimeInactiveSlotClear = useCallback((generation: number) => {
    const cleanupFrame = runtimeInactiveCleanupFrameRef.current;
    if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
    runtimeInactiveGenerationRef.current = generation;
    runtimeInactiveCleanupFrameRef.current = window.requestAnimationFrame(() => {
      runtimeInactiveCleanupFrameRef.current = null;
      if (runtimeInactiveGenerationRef.current !== generation) return;
      runtimeInactiveGenerationRef.current = null;
      flushSync(() => {
        setRuntimeInactiveRender(null);
        if (containerRef.current?.getAttribute("data-runtime-handoff") === "active") {
          containerRef.current.removeAttribute("data-runtime-handoff");
        }
      });
    });
  }, []);

  const cancelRuntimeCandidate = useCallback((
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready"> = "failed",
    keepHandoffPreparing = false,
  ): boolean => {
    if (
      runtimeCandidateRef.current !== candidate
      || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
    ) {
      syncRuntimeCandidateDiagnostics();
      return false;
    }
    candidate.registrationCleanup();
    if (candidate.runtimeFrame) completeRuntimeAttempt(candidate.runtimeFrame, outcome);
    else runtimeFrameCoordinatorRef.current!.settle(candidate.attempt, outcome);
    if (activeNativeEditRef.current) {
      // Native Edit won the wait window. Keep the live toolbar/selection;
      // restoring the Candidate's pre-edit chrome would hide the session.
      pendingSelectionRef.current = selectedSourceSelectionRef.current;
      pendingToolbarVisibleRef.current = true;
    } else {
      pendingSelectionRef.current = candidate.handoffContext.pendingSelection;
      const restoredToolbarVisible = candidate.handoffContext.pendingToolbarVisible;
      pendingToolbarVisibleRef.current = restoredToolbarVisible;
      setToolbarVisible(restoredToolbarVisible);
    }
    runtimeCandidateRef.current = null;
    runtimeCandidateIframeRef.current = null;
    runtimePromotionRef.current = null;
    abortInFlightRuntimeCommitRef.current = null;
    setRuntimeCandidateRender(null);
    if (keepHandoffPreparing) {
      containerRef.current?.setAttribute("data-runtime-handoff", "preparing");
    } else {
      containerRef.current?.removeAttribute("data-runtime-handoff");
    }
    requestAnimationFrame(() => updateOverlayPositionRef.current());
    syncRuntimeCandidateDiagnostics();
    return true;
  }, [completeRuntimeAttempt, syncRuntimeCandidateDiagnostics]);
  cancelRuntimeCandidateRef.current = cancelRuntimeCandidate;

  const startRuntimeCandidate = useCallback((
    source: string,
    options: RuntimeCandidateStartOptions = {},
  ): boolean => {
    // Sole author-Script start path. Active never prepares a disposable-runtime
    // document; first-open, late grant, grant-during-edit, retry and history
    // all reach this function or defer until the static Active frame is ready.
    const candidateKind = options.kind ?? "dynamic";
    const staticDisabled = candidateKind === "static-disabled";
    const currentRuntime = runtimeFrameRef.current;
    const activeFrameReady = currentRuntime
      ? currentRuntime.settled
        && currentRuntime.elementGeneration === frameLoadGenerationRef.current
      : Boolean(
          iframeRef.current?.contentDocument?.documentElement
          && frameRender.elementGeneration === frameLoadGenerationRef.current
          && renderedSourceHtmlRef.current
          && containerRef.current?.getAttribute("data-render-verified") === "true"
        );
    if (
      activeNativeEditRef.current
      || !activeFrameReady
    ) return false;

    if (runtimeInactiveGenerationRef.current !== null) {
      clearRuntimeInactiveSlot();
    }
    abortInFlightRuntimeCommitRef.current?.("superseded");
    const supersededCandidate = runtimeCandidateRef.current;
    if (supersededCandidate) {
      supersededCandidate.handoffContext.pendingSelection =
        selectedSourceSelectionRef.current ?? pendingSelectionRef.current;
      supersededCandidate.handoffContext.pendingToolbarVisible = Boolean(
        supersededCandidate.handoffContext.pendingSelection && toolbarVisibleRef.current,
      );
      cancelRuntimeCandidateRef.current(supersededCandidate, "superseded");
    }
    const previousPendingSelection = selectedSourceSelectionRef.current
      ?? pendingSelectionRef.current;
    const previousPendingToolbarVisible = Boolean(
      previousPendingSelection && toolbarVisibleRef.current,
    );
    const currentFrame = iframeRef.current;
    const sharedScrollElement = containerRef.current?.closest<HTMLElement>(
      ".review-scroll-stage",
    ) ?? null;
    const previousSelectedElement = selectedElementRef.current;
    const previousSelectedSourceSelection = selectedSourceSelectionRef.current;
    const presentationAnchor = captureRuntimePresentationAnchor({
      iframe: currentFrame,
      outerScrollElement: sharedScrollElement,
      sourceIndex: sourceIndexRef.current,
      selectedElement: previousSelectedElement,
      selectedSourceSelection: previousSelectedSourceSelection,
    });
    if (!pendingSelectionRef.current && selectedSourceSelectionRef.current) {
      pendingSelectionRef.current = selectedSourceSelectionRef.current;
    }
    pendingToolbarVisibleRef.current = Boolean(
      pendingSelectionRef.current && toolbarVisibleRef.current,
    );

    const candidateGeneration = Math.max(
      frameLoadGenerationRef.current + 1,
      frameGenerationSequenceRef.current + 1,
    );
    frameGenerationSequenceRef.current = candidateGeneration;
    let sourceIndex: SourceIndexValue | null = null;
    const instrumentedSource = source;
    let sourceMapFailed = false;
    try {
      sourceIndex = buildSourceIndex(source);
      latestSourceProjectionRef.current = { source, sourceIndex };
      if (!sourceIndexIdentityReady(sourceIndex)) {
        throw new Error("PAGEROOT_IDENTITY_INCOMPLETE");
      }
    } catch (cause) {
      latestSourceProjectionRef.current = { source, sourceIndex: null };
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: "暂时不能直接编辑这个页面",
        message: "页面仍可正常浏览。请重新载入后再试，或添加评论说明要改什么。",
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      onEditBlockedRef.current?.(
        cause instanceof Error ? cause.message : String(cause),
      );
      sourceMapFailed = true;
    }
    if (sourceMapFailed) {
      pendingSelectionRef.current = previousPendingSelection;
      pendingToolbarVisibleRef.current = previousPendingToolbarVisible;
      containerRef.current?.removeAttribute("data-runtime-handoff");
      if (staticDisabled) publishRuntimeDegradation("last-known-good-readonly");
      return true;
    }

    const handoffContext = options.handoffContext ?? {
      presentationAnchor,
      pendingSelection: pendingSelectionRef.current ?? previousPendingSelection,
      pendingToolbarVisible: pendingToolbarVisibleRef.current,
      restoreCanvasFocus: false,
    };
    containerRef.current?.setAttribute("data-runtime-handoff", "preparing");

    const runtimeGrant = staticDisabled ? null : editRuntimeGrant;
    if ((!staticDisabled && !runtimeGrant) || !sourceIndex) {
      pendingSelectionRef.current = previousPendingSelection;
      pendingToolbarVisibleRef.current = previousPendingToolbarVisible;
      containerRef.current?.removeAttribute("data-runtime-handoff");
      if (staticDisabled) publishRuntimeDegradation("last-known-good-readonly");
      return true;
    }
    const attempt = beginRuntimeAttempt(
      candidateGeneration,
      sourceIndex.sourceSha256,
      candidateKind,
    );
    if (runtimeGrant) onEditRuntimeLoadStartRef.current?.(runtimeGrant, attempt);
    let runtimeFrame: RuntimeFrameContext | null = null;
    let verificationToken = `frame_${candidateGeneration}_${
      globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`
    }`;
    let prepared: string | null = null;
    const candidateInertOwnership = { injected: false };
    if (staticDisabled) {
      prepared = prepareCanvasFrameDocument(
        instrumentedSource,
        verificationToken,
        {
          mode: "static",
          baseUrl: staticAssetBaseHref,
          editorStyles: EDITOR_DOCUMENT_STYLES,
          candidateInert: true,
          candidateInertOwnership,
        },
      ) || prepareVerifiedFrameDocument(instrumentedSource, verificationToken, {
        baseUrl: staticAssetBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
        candidateInert: true,
        candidateInertOwnership,
      });
      if (
        prepared
        && window.htmlAIRuntime?.diagnostics?.e2eStaticCandidateFailure === true
      ) {
        prepared = prepared.replaceAll(
          verificationToken,
          `${verificationToken}-invalid-static-candidate`,
        );
      }
    } else if (
      runtimeGrant
      && sourceIndex?.source === source
      && editRuntimeProgramIdentity(source) === runtimeGrant.programIdentity
    ) {
      const runtimeToken = `edit-runtime-frame-${runtimeGrant.executionId}`;
      if (isEditRuntimeFrameToken(runtimeToken)) {
        prepared = prepareCanvasFrameDocument(
          instrumentedSource,
          runtimeToken,
          {
            mode: "disposable-runtime",
            sessionId: runtimeGrant.sessionId,
            executionId: runtimeGrant.executionId,
            documentBasePath: runtimeGrant.documentBasePath,
            baseUrl: documentBaseHref,
            editorStyles: EDITOR_DOCUMENT_STYLES,
            candidateInertOwnership,
          },
        );
        if (prepared) {
          verificationToken = runtimeToken;
          runtimeFrame = {
            attempt,
            grant: runtimeGrant,
            verificationToken: runtimeToken,
            elementGeneration: candidateGeneration,
            activation: "pending",
            activationSettledAt: null,
            authorErrorCount: 0,
            resourceFailureCount: 0,
            activationElapsedMs: null,
            settled: false,
          };
        }
      }
    }
    if ((!staticDisabled && !runtimeFrame) || !prepared) {
      if (runtimeGrant) {
        completeRuntimeAttempt({
          attempt,
          grant: runtimeGrant,
          verificationToken,
          elementGeneration: candidateGeneration,
          activation: "failed",
          activationSettledAt: performance.now(),
          authorErrorCount: 0,
          resourceFailureCount: 1,
          activationElapsedMs: null,
          settled: false,
        }, "rejected");
        scheduleLatestStaticFallbackAfterFailure(attempt.candidateId, handoffContext);
      } else {
        runtimeFrameCoordinatorRef.current!.settle(attempt, "rejected");
        publishRuntimeDegradation("last-known-good-readonly");
      }
      pendingSelectionRef.current = previousPendingSelection;
      pendingToolbarVisibleRef.current = previousPendingToolbarVisible;
      containerRef.current?.removeAttribute("data-runtime-handoff");
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: staticDisabled ? "静态页面也没有完成" : "页面预览没有完成",
        message: staticDisabled
          ? "当前画布已切为只读；最新 HTML 仍可重新加载或导出。"
          : "正在用最新 HTML 准备静态页面。",
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      return true;
    }

    const candidate: RuntimeCandidate = {
      attempt,
      source,
      sourceIndex,
      prepared,
      verificationToken,
      render: {
        html: prepared,
        elementGeneration: candidateGeneration,
        runtime: Boolean(runtimeFrame),
      },
      runtimeFrame,
      sourceElements: null,
      registrationCleanup: () => undefined,
      loaded: false,
      candidateInertInjected: candidateInertOwnership.injected,
      handoffContext,
      retiredSlot: null,
      viewContext: null,
    };
    if (runtimeFrame) {
      const registrationProperty = editRuntimeRegistrationProperty(
        runtimeFrame.grant.executionId,
      );
      if (registrationProperty) {
        const parentGlobals = window as unknown as Record<string, unknown>;
        const openRegistration = (
          sourceWindow: unknown,
          identity: {
            sessionId?: unknown;
            executionId?: unknown;
            frameToken?: unknown;
          } | null,
        ) => {
          const activeCandidate = runtimeCandidateRef.current;
          const iframe = runtimeCandidateIframeRef.current;
          if (
            activeCandidate !== candidate
            || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
            || identity?.sessionId !== runtimeFrame.grant.sessionId
            || identity?.executionId !== runtimeFrame.grant.executionId
            || identity?.frameToken !== runtimeFrame.verificationToken
            || sourceWindow !== iframe?.contentWindow
          ) return null;
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
          const elements = new WeakSet<HTMLElement>();
          const runtimeShadowHosts = new WeakSet<HTMLElement>();
          const claimedByPagerootId = new Map<string, HTMLElement>();
          const pagerootIdByElement = new WeakMap<HTMLElement, string>();
          const conflictedPagerootIds = new Set<string>();
          candidate.sourceElements = {
            elementGeneration: candidateGeneration,
            executionId: runtimeFrame.grant.executionId,
            elements,
            pagerootIds: pagerootIdByElement,
            runtimeShadowHosts,
          };
          const registerProved = (candidates: unknown) => {
            const currentCandidate = runtimeCandidateRef.current;
            const activeIframe = runtimeCandidateIframeRef.current;
            if (
              !Array.isArray(candidates)
              || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
              || currentCandidate !== candidate
              || !activeIframe
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            const registered = registerProvedStableSourceElements({
              candidates,
              documentNode: activeIframe.contentDocument,
              sourceIndex,
              elements,
              pagerootIds: pagerootIdByElement,
              claimed: claimedByPagerootId,
              conflicted: conflictedPagerootIds,
              markerAttribute: EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
            });
            // Source registration runs before author scripts. Restore the visible
            // tab now so chart libraries initialize against its actual layout.
            if (registered && activeIframe.contentDocument) {
              applyPageViewContextToDocument(
                activeIframe.contentDocument, candidate.source,
                pageViewContextRef.current, candidate.viewContext,
              );
              candidate.viewContext = pageViewContextRef.current;
            }
            return registered;
          };
          const registerRuntimeShadowHost = (host: unknown) => {
            const candidateIframe = runtimeCandidateIframeRef.current;
            const activeIframe = (
              runtimeCandidateRef.current === candidate
              && !runtimePromotionRef.current
              && runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
              && sourceWindow === candidateIframe?.contentWindow
            )
              ? candidateIframe
              : (
                runtimeFrameRef.current === runtimeFrame
                && runtimeSourceElementsRef.current === candidate.sourceElements
                && runtimeFrame.elementGeneration === frameLoadGenerationRef.current
                && candidate.sourceElements?.executionId === runtimeFrame.grant.executionId
                && sourceWindow === iframeRef.current?.contentWindow
              )
                ? iframeRef.current
                : null;
            const HTMLElementConstructor = activeIframe?.contentDocument
              ?.defaultView?.HTMLElement;
            if (
              !HTMLElementConstructor
              || !(host instanceof HTMLElementConstructor)
              || host.ownerDocument !== activeIframe?.contentDocument
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            runtimeShadowHosts.add(host as HTMLElement);
            return true;
          };
          const reportActivationOutcome = (outcome: unknown) => {
            const currentCandidate = runtimeCandidateRef.current;
            const activeIframe = runtimeCandidateIframeRef.current;
            if (
              currentCandidate !== candidate
              || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
              || runtimeFrame.activation !== "pending"
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            if (!outcome || typeof outcome !== "object") return false;
            const detail = outcome as Record<string, unknown>;
            const status = detail.status;
            const authorErrorCount = detail.authorErrorCount;
            const resourceFailureCount = detail.resourceFailureCount;
            const elapsedMs = detail.elapsedMs;
            if (
              ![
                "activation-ready",
                "activation-author-error",
                "activation-resource-failed",
              ].includes(String(status))
              || !Number.isSafeInteger(authorErrorCount)
              || Number(authorErrorCount) < 0
              || Number(authorErrorCount) > 10_000
              || !Number.isSafeInteger(resourceFailureCount)
              || Number(resourceFailureCount) < 0
              || Number(resourceFailureCount) > 10_000
              || !Number.isSafeInteger(elapsedMs)
              || Number(elapsedMs) < 0
              || (status === "activation-ready"
                && (authorErrorCount !== 0 || resourceFailureCount !== 0))
              || (status === "activation-author-error"
                && (Number(authorErrorCount) < 1 || resourceFailureCount !== 0))
              || (status === "activation-resource-failed" && Number(resourceFailureCount) < 1)
            ) return false;
            runtimeFrame.activationSettledAt = performance.now();
            runtimeFrame.authorErrorCount = Number(authorErrorCount);
            runtimeFrame.resourceFailureCount = Number(resourceFailureCount);
            runtimeFrame.activationElapsedMs = Number(elapsedMs);
            containerRef.current?.setAttribute("data-runtime-activation", String(status));
            containerRef.current?.setAttribute(
              "data-runtime-author-error-count",
              String(authorErrorCount),
            );
            containerRef.current?.setAttribute(
              "data-runtime-resource-failure-count",
              String(resourceFailureCount),
            );
            containerRef.current?.setAttribute("data-runtime-activation-ms", String(elapsedMs));
            const activationExceededBudget = Number(elapsedMs)
              >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs;
            if (activationExceededBudget) {
              containerRef.current?.setAttribute("data-runtime-activation-budget", "exceeded");
            } else {
              containerRef.current?.removeAttribute("data-runtime-activation-budget");
            }
            if (status === "activation-ready" || status === "activation-author-error") {
              runtimeFrame.activation = status === "activation-ready" ? "ready" : "partial";
              return true;
            }
            runtimeFrame.activation = "failed";
            queueMicrotask(() => {
              failRuntimeCandidateActivationRef.current(candidate, "failed");
            });
            return true;
          };
          const canAcceptFocus = () => Boolean(
            candidate.runtimeFrame?.settled
            && runtimeFrameRef.current === candidate.runtimeFrame
            && iframeRef.current?.contentWindow === sourceWindow
          );
          return {
            registerProved,
            registerRuntimeShadowHost,
            reportActivationOutcome,
            canAcceptFocus,
          };
        };
        Object.defineProperty(parentGlobals, registrationProperty, {
          configurable: true,
          enumerable: false,
          writable: false,
          value: openRegistration,
        });
        candidate.registrationCleanup = () => {
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
        };
      }
    }
    runtimeCandidateRef.current = candidate;
    if (candidateKind === "dynamic") {
      containerRef.current?.setAttribute("data-runtime-activation", "pending");
      containerRef.current?.removeAttribute("data-runtime-activation-ms");
      containerRef.current?.removeAttribute("data-runtime-activation-budget");
      containerRef.current?.removeAttribute("data-runtime-surface-budget");
      lastRuntimeCandidateFailureRef.current = null;
    }
    deferredRuntimeCandidateRef.current = null;
    setRuntimeCandidateRender(candidate.render);
    recordRuntimeContinuityEvent("candidateCreated", { reason: candidateKind });
    recordRuntimeContinuityEvent("framePrepared", { reason: candidateKind });
    return true;
  }, [
    beginRuntimeAttempt,
    clearRuntimeInactiveSlot,
    completeRuntimeAttempt,
    documentBaseHref,
    editRuntimeGrant,
    publishRuntimeDegradation,
    scheduleLatestStaticFallbackAfterFailure,
    staticAssetBaseHref,
  ]);
  startRuntimeCandidateRef.current = startRuntimeCandidate;

  const replayDeferredRuntimeCandidate = useCallback(() => {
    const request = deferredRuntimeCandidateRef.current;
    if (!request || activeNativeEditRef.current) return;
    if (
      request.predecessorCandidateId
      && lastRuntimeCandidateFailureRef.current !== request.predecessorCandidateId
    ) {
      if (deferredRuntimeCandidateRef.current?.lease === request.lease) {
        deferredRuntimeCandidateRef.current = null;
      }
      return;
    }
    const latest = latestSourceProjectionRef.current;
    if (
      latest.source !== request.source
      || (
        latest.sourceIndex
        && latest.sourceIndex.sourceSha256 !== request.sourceRevision
      )
    ) {
      if (deferredRuntimeCandidateRef.current?.lease !== request.lease) return;
      deferredRuntimeCandidateRef.current = null;
      if (
        request.kind === "static-disabled"
        && request.predecessorCandidateId
        && request.handoffContext
        && !deferLatestStaticRuntimeCandidate(
          request.predecessorCandidateId,
          request.handoffContext,
        )
      ) {
        lastRuntimeCandidateFailureRef.current = null;
        publishRuntimeDegradation("last-known-good-readonly");
      }
      return;
    }
    // A grant arriving during positioning belongs to the next frame. Keep it
    // until promotion finalizes instead of mistaking the busy slot for a match.
    if (runtimePromotionRef.current) return;
    if (runtimeCandidateRef.current) {
      if (deferredRuntimeCandidateRef.current?.lease === request.lease) {
        deferredRuntimeCandidateRef.current = null;
      }
      return;
    }
    if (runtimeCandidateAlreadyActive({
      request,
      runtimeFrame: runtimeFrameRef.current,
      frameLoadGeneration: frameLoadGenerationRef.current,
      snapshot: runtimeFrameCoordinatorRef.current!.snapshot,
    })) {
      if (deferredRuntimeCandidateRef.current?.lease === request.lease) {
        deferredRuntimeCandidateRef.current = null;
      }
      lastRuntimeCandidateFailureRef.current = null;
      if (request.kind === "static-disabled") {
        publishRuntimeDegradation("static-visible");
      }
      return;
    }
    const started = startRuntimeCandidateRef.current(request.source, {
      kind: request.kind,
      ...(request.handoffContext
        ? { handoffContext: request.handoffContext }
        : {}),
    });
    if (
      started
      && deferredRuntimeCandidateRef.current?.lease === request.lease
    ) deferredRuntimeCandidateRef.current = null;
  }, [deferLatestStaticRuntimeCandidate, publishRuntimeDegradation]);
  replayDeferredRuntimeCandidateRef.current = replayDeferredRuntimeCandidate;

  const finalizeRuntimeCandidatePromotion = useCallback((candidate: RuntimeCandidate) => {
    if (runtimePromotionRef.current !== candidate) return;
    if (candidate.attempt.kind === "static-disabled") {
      lastRuntimeCandidateFailureRef.current = null;
    }
    abortInFlightRuntimeCommitRef.current = null;
    const retired = candidate.retiredSlot;
    retired?.registrationCleanup();
    retired?.cleanupFrame();
    clearRuntimeRefreshPending(candidate.attempt.sourceRevision);
    runtimePromotionRef.current = null;
    containerRef.current?.setAttribute("data-runtime-handoff", "active");
    if (retired) scheduleRuntimeInactiveSlotClear(retired.generation);
    // A recovered grant may arrive while this slot is positioning. Its first
    // replay cannot start until the visible frame is fully committed.
    syncRuntimeCandidateDiagnostics();
    window.requestAnimationFrame(() => replayDeferredRuntimeCandidateRef.current());
  }, [
    clearRuntimeRefreshPending,
    scheduleRuntimeInactiveSlotClear,
    syncRuntimeCandidateDiagnostics,
  ]);
  finalizeRuntimePromotionRef.current = finalizeRuntimeCandidatePromotion;

  const refreshRuntimeHandoffContextFromActive = useCallback((
    handoffContext: RuntimeHandoffContext,
  ) => {
    handoffContext.presentationAnchor = captureRuntimePresentationAnchor({
      iframe: iframeRef.current,
      outerScrollElement: containerRef.current?.closest<HTMLElement>(
        ".review-scroll-stage",
      ) ?? null,
      sourceIndex: sourceIndexRef.current,
      selectedElement: selectedElementRef.current,
      selectedSourceSelection: selectedSourceSelectionRef.current,
    });
    handoffContext.pendingSelection = selectedSourceSelectionRef.current;
    handoffContext.pendingToolbarVisible = Boolean(
      selectedSourceSelectionRef.current && toolbarVisibleRef.current,
    );
    pendingSelectionRef.current = handoffContext.pendingSelection;
    pendingToolbarVisibleRef.current = handoffContext.pendingToolbarVisible;
  }, []);

  const commitRuntimeCandidate = useCallback((
    candidate: RuntimeCandidate,
    iframe: HTMLIFrameElement,
  ): boolean => {
    if (
      runtimeCandidateRef.current !== candidate
      || runtimePromotionRef.current
      || latestSourceProjectionRef.current.source !== candidate.source
      || latestSourceProjectionRef.current.sourceIndex?.sourceSha256
        !== candidate.attempt.sourceRevision
      || activeNativeEditRef.current
      || !runtimeFrameCoordinatorRef.current!.canPromote(candidate.attempt)
    ) {
      failRuntimeCandidateActivationRef.current(candidate, "superseded")
        || cancelRuntimeCandidateRef.current(candidate, "superseded");
      return false;
    }
    // The Candidate may have waited through size checks or a commit hold while
    // the still-authoritative Active accepted a new selection or scroll. Take
    // the final intent snapshot in the same task that begins positioning; an
    // older preparation snapshot must not win the handoff.
    refreshRuntimeHandoffContextFromActive(candidate.handoffContext);
    if (!runtimeFrameCoordinatorRef.current!.beginPositioning(candidate.attempt)) {
      syncRuntimeCandidateDiagnostics();
      failRuntimeCandidateActivationRef.current(candidate, "superseded")
        || cancelRuntimeCandidateRef.current(candidate, "superseded");
      return false;
    }
    runtimePromotionRef.current = candidate;
    pendingSelectionRef.current = candidate.handoffContext.pendingSelection;
    pendingToolbarVisibleRef.current = candidate.handoffContext.pendingToolbarVisible;
    syncRuntimeCandidateDiagnostics();

    const previousRenderVerified = containerRef.current?.getAttribute(
      "data-render-verified",
    ) ?? null;
    const previousSlotId = activeRuntimeSlotId;
    const previousIframe = iframeRef.current;
    const transferCanvasFocus = Boolean(previousIframe
      && previousIframe.ownerDocument.activeElement === previousIframe);
    candidate.handoffContext.restoreCanvasFocus = transferCanvasFocus;
    const previousRender = frameRender;
    const previousCleanup = cleanupFrameRef.current;
    const previousRegistration = runtimeSourceRegistrationCleanupRef.current;
    const previousRuntimeFrame = runtimeFrameRef.current;
    const previousSourceElements = runtimeSourceElementsRef.current;
    const previousGeneration = frameLoadGenerationRef.current;
    const previousNativeDomGeneration = nativeDomGenerationRef.current;
    const previousSourceIndex = sourceIndexRef.current;
    const previousFrameSourceHtml = frameSourceHtmlRef.current;
    const previousFrameWrittenHtml = frameWrittenHtmlRef.current;
    const previousExpectedFrameHtml = expectedFrameHtmlRef.current;
    const previousExpectedFrameToken = expectedFrameTokenRef.current;
    const previousRenderedSourceHtml = renderedSourceHtmlRef.current;
    const previousRenderedProjectionSha256 = renderedProjectionSha256Ref.current;
    const previousConnectedFrame = connectedFrameRef.current;
    const promotedGeneration = candidate.render.elementGeneration;
    const abortCommit = (
      outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
    ): boolean => {
      if (abortInFlightRuntimeCommitRef.current !== abortCommit) return false;
      abortInFlightRuntimeCommitRef.current = null;
      const committedCleanup = cleanupFrameRef.current;
      if (committedCleanup !== previousCleanup) committedCleanup();
      runtimeSourceElementsRef.current = previousSourceElements;
      runtimeSourceRegistrationCleanupRef.current = previousRegistration;
      runtimeFrameRef.current = previousRuntimeFrame;
      frameLoadGenerationRef.current = previousGeneration;
      nativeDomGenerationRef.current = previousNativeDomGeneration;
      sourceIndexRef.current = previousSourceIndex;
      frameSourceHtmlRef.current = previousFrameSourceHtml;
      frameWrittenHtmlRef.current = previousFrameWrittenHtml;
      expectedFrameHtmlRef.current = previousExpectedFrameHtml;
      expectedFrameTokenRef.current = previousExpectedFrameToken;
      renderedSourceHtmlRef.current = previousRenderedSourceHtml;
      renderedProjectionSha256Ref.current = previousRenderedProjectionSha256;
      cleanupFrameRef.current = previousCleanup;
      connectedFrameRef.current = previousConnectedFrame;
      activeFrameConnectionPendingRef.current = false;
      candidate.retiredSlot = null;
      pendingFrameRestoreEpochRef.current += 1;
      runtimeCandidateRef.current = candidate;
      runtimePromotionRef.current = null;
      if (previousRenderVerified === null) {
        containerRef.current?.removeAttribute("data-render-verified");
      } else {
        containerRef.current?.setAttribute(
          "data-render-verified",
          previousRenderVerified,
        );
      }
      flushSync(() => {
        setFrameRender(previousRender);
        setRuntimeInactiveRender(null);
        setRuntimeCandidateRender(candidate.render);
        setActiveRuntimeSlotId(previousSlotId);
      });
      if (iframe.ownerDocument.activeElement === iframe) {
        previousIframe?.focus({ preventScroll: true });
      }
      failRuntimeCandidateActivationRef.current(candidate, outcome)
        || cancelRuntimeCandidateRef.current(candidate, outcome);
      return true;
    };

    candidate.retiredSlot = {
      slotId: previousSlotId,
      render: previousRender,
      cleanupFrame: previousCleanup,
      registrationCleanup: previousRegistration,
      generation: previousGeneration,
    };
    abortInFlightRuntimeCommitRef.current = abortCommit;
    candidate.registrationCleanup();
    runtimeSourceElementsRef.current = candidate.sourceElements;
    runtimeSourceRegistrationCleanupRef.current = () => undefined;
    runtimeFrameRef.current = candidate.runtimeFrame;
    activeFrameConnectionPendingRef.current = true;
    frameLoadGenerationRef.current = promotedGeneration;
    frameGenerationSequenceRef.current = Math.max(
      frameGenerationSequenceRef.current,
      promotedGeneration,
    );
    nativeDomGenerationRef.current += 1;
    sourceIndexRef.current = candidate.sourceIndex;
    frameSourceHtmlRef.current = candidate.source;
    frameWrittenHtmlRef.current = null;
    expectedFrameHtmlRef.current = candidate.prepared;
    expectedFrameTokenRef.current = candidate.verificationToken;
    renderedSourceHtmlRef.current = null;
    pendingFrameViewportRef.current = null;
    pendingSharedViewportRef.current = null;
    pendingStaticPresentationAnchorRef.current = null;
    pendingFrameRestoreEpochRef.current += 1;
    containerRef.current?.setAttribute("data-runtime-handoff", "positioning");
    flushSync(() => {
      setRuntimeInactiveRender(previousRender);
      setFrameRender(candidate.render);
      setRuntimeCandidateRender(null);
      setActiveRuntimeSlotId(candidate.attempt.slotId);
    });
    recordRuntimeContinuityEvent("framePromoted");
    recordRuntimeContinuityEvent("frameCleared", { reason: "promoted" });
    const promotedIframe = iframeRef.current;
    if (!promotedIframe || promotedIframe !== iframe) {
      abortCommit("failed");
      return false;
    }
    const promotedDocument = promotedIframe.contentDocument;
    if (!promotedDocument) {
      abortCommit("failed");
      return false;
    }
    const promotedRoot = promotedDocument.documentElement;
    if (candidate.candidateInertInjected) {
      promotedRoot.removeAttribute("inert");
    }
    applyReadingPosition({
      iframe: promotedIframe,
      documentNode: promotedDocument,
      outer: containerRef.current?.closest<HTMLElement>(".review-scroll-stage"),
      anchor: candidate.handoffContext.presentationAnchor,
      anchorElement: runtimeSourceElementForStableId(
        promotedDocument,
        candidate.sourceIndex,
        candidate.handoffContext.presentationAnchor.viewportAnchorStableId,
      ),
      adjustOuter: true,
    });
    if (
      window.htmlAIRuntime?.diagnostics?.e2eRuntimeCommitHooks === true
      && window.__PAGEROOT_E2E_FAIL_NEXT_RUNTIME_COMMIT__ === true
    ) {
      window.__PAGEROOT_E2E_FAIL_NEXT_RUNTIME_COMMIT__ = false;
      const marker = promotedDocument.head.querySelector<HTMLMetaElement>(
        `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
      );
      marker?.setAttribute(
        FRAME_VERIFICATION_ATTRIBUTE,
        `${candidate.verificationToken}-invalid-commit`,
      );
      marker?.setAttribute("content", `${candidate.verificationToken}-invalid-commit`);
    }
    if (!connectFrameRef.current(promotedIframe, promotedGeneration)) {
      abortCommit("failed");
      return false;
    }
    runtimeCandidateRef.current = null;
    runtimeCandidateIframeRef.current = null;
    return true;
  }, [
    activeRuntimeSlotId,
    frameRender,
    refreshRuntimeHandoffContextFromActive,
    syncRuntimeCandidateDiagnostics,
  ]);
  commitRuntimeCandidateRef.current = commitRuntimeCandidate;

  const promoteRuntimeCandidate = useCallback((candidate: RuntimeCandidate): boolean => {
    if (
      runtimeCandidateRef.current !== candidate
      || !runtimeFrameCoordinatorRef.current!.canPromote(candidate.attempt)
    ) {
      syncRuntimeCandidateDiagnostics();
      return false;
    }
    const iframe = runtimeCandidateIframeRef.current;
    const documentNode = iframe?.contentDocument;
    const frameView = documentNode?.defaultView;
    if (!iframe || !documentNode?.documentElement || !frameView) return false;
    if (
      candidate.runtimeFrame
      && (
        !runtimeActivationUsable(candidate.runtimeFrame)
        || !candidate.sourceElements
      )
    ) return false;
    try {
      applyPageViewContextToDocument(
        documentNode,
        candidate.source,
        pageViewContextRef.current,
        null,
      );
      documentNode.documentElement.toggleAttribute("data-html-canvas-locked", lockedRef.current);
    } catch {
      return false;
    }
    refreshRuntimeHandoffContextFromActive(candidate.handoffContext);
    // Hidden size/position waits still belong to runtimeCandidateRef. The
    // visible Active must keep accepting Native Edit until beginPositioning.
    const isCurrent = () => (
      runtimeCandidateRef.current === candidate
      && !runtimePromotionRef.current
      && runtimeCandidateIframeRef.current === iframe
      && iframe.contentDocument === documentNode
      && runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
    );
    const commitWhenUnblocked = () => {
      if (!isCurrent()) return;
      commitRuntimeCandidateRef.current(candidate, iframe);
    };
    scheduleWhenReady({
      isCurrent,
      isReady: () => frameScrollMetricsReady(iframe, documentNode),
      onReady: () => {
        if (!isCurrent()) return;
        refreshRuntimeHandoffContextFromActive(candidate.handoffContext);
        applyReadingPosition({
          iframe,
          documentNode,
          anchor: candidate.handoffContext.presentationAnchor,
          anchorElement: runtimeSourceElementForStableId(
            documentNode,
            candidate.sourceIndex,
            candidate.handoffContext.presentationAnchor.viewportAnchorStableId,
          ),
          adjustOuter: false,
        });
        requestAnimationFrame(() => {
          if (!isCurrent()) return;
          if (window.htmlAIRuntime?.diagnostics?.e2eRuntimeCommitHooks === true) {
            const releases = window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__;
            if (Array.isArray(releases)) {
              releases.push(commitWhenUnblocked);
              return;
            }
          }
          commitWhenUnblocked();
        });
      },
    });
    return true;
  }, [refreshRuntimeHandoffContextFromActive, syncRuntimeCandidateDiagnostics]);

  const failRuntimeCandidate = useCallback((
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ): boolean => {
    if (
      runtimeCandidateRef.current !== candidate
      && runtimePromotionRef.current !== candidate
    ) return false;
    runtimeCandidateRef.current = candidate;
    const candidateKind = candidate.attempt.kind;
    const rememberedAnchor = lastSameDocumentPresentationAnchorRef.current;
    if (
      containerRef.current?.getAttribute("data-runtime-handoff") === "preparing"
      && rememberedAnchor
    ) {
      // The stage-scroll listener records only the still-authoritative Active
      // document during preparation. Once positioning starts, keep the anchor
      // already captured for this handoff so rollback cannot turn a transient
      // commit state into the next static Candidate's baseline.
      candidate.handoffContext.presentationAnchor = {
        ...rememberedAnchor,
        selectedStableId: isValidPagerootElementId(
          selectedSourceSelectionRef.current?.elementId,
        )
          ? selectedSourceSelectionRef.current?.elementId ?? null
          : candidate.handoffContext.presentationAnchor.selectedStableId,
      };
    }
    candidate.handoffContext.pendingSelection = selectedSourceSelectionRef.current
      ?? candidate.handoffContext.pendingSelection;
    candidate.handoffContext.pendingToolbarVisible = Boolean(
      candidate.handoffContext.pendingSelection && toolbarVisibleRef.current,
    );
    const cancelled = cancelRuntimeCandidateRef.current(
      candidate,
      outcome,
      candidateKind === "dynamic" && outcome !== "superseded",
    );
    if (!cancelled || outcome === "superseded") return cancelled;
    if (candidateKind === "static-disabled") {
      lastRuntimeCandidateFailureRef.current = null;
      publishRuntimeDegradation("last-known-good-readonly");
      return true;
    }
    scheduleLatestStaticFallbackAfterFailure(
      candidate.attempt.candidateId,
      candidate.handoffContext,
    );
    return true;
  }, [publishRuntimeDegradation, scheduleLatestStaticFallbackAfterFailure]);
  failRuntimeCandidateActivationRef.current = failRuntimeCandidate;

  const connectRuntimeCandidate = useCallback((
    iframe: HTMLIFrameElement,
    candidateGeneration: number,
  ): boolean => {
    const candidate = runtimeCandidateRef.current;
    if (
      !candidate
      || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
      || candidate.render.elementGeneration !== candidateGeneration
      || iframe !== runtimeCandidateIframeRef.current
    ) return false;
    const documentNode = iframe.contentDocument;
    const marker = documentNode?.head?.querySelector<HTMLMetaElement>(
      `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
    );
    if (
      !documentNode?.documentElement
      || !frameDocumentMatchesExpected(iframe, candidate.prepared, null)
      || marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) !== candidate.verificationToken
      || marker.getAttribute("content") !== candidate.verificationToken
      || (candidate.runtimeFrame && !candidate.loaded)
      || (candidate.runtimeFrame && !runtimeActivationUsable(candidate.runtimeFrame))
      || (candidate.runtimeFrame && !candidate.sourceElements)
    ) return false;
    if (!runtimeFrameCoordinatorRef.current!.canPromote(candidate.attempt)) {
      syncRuntimeCandidateDiagnostics();
      return false;
    }
    if (candidate.viewContext !== pageViewContextRef.current) {
      applyPageViewContextToDocument(
        documentNode, candidate.source, pageViewContextRef.current, candidate.viewContext,
      );
      candidate.viewContext = pageViewContextRef.current;
      // A tab may change while a candidate is preparing. Notify existing author
      // layout listeners once, then allow a paint before checking its surfaces.
      iframe.contentWindow?.dispatchEvent(new Event("resize"));
      return false;
    }
    const sameRuntimeProgram = Boolean(
      candidate.runtimeFrame
      && runtimeFrameRef.current?.grant.programIdentity
        === candidate.runtimeFrame.grant.programIdentity,
    );
    const partialRuntime = candidate.runtimeFrame?.activation === "partial";
    const runtimeUsesEcharts = Boolean(
      candidate.runtimeFrame?.grant.runtimeLibraries?.includes("echarts"),
    );
    const connectedRuntimeFrame = runtimeFrameRef.current;
    const activeRuntimeDocument = connectedRuntimeFrame
      && runtimeActivationUsable(connectedRuntimeFrame)
      ? iframeRef.current?.contentDocument ?? null
      : null;
    if (candidate.runtimeFrame
      && (sameRuntimeProgram || partialRuntime)
      && !runtimeSurfacesReady(
        activeRuntimeDocument,
        documentNode,
        candidate.sourceIndex,
        {
          requireCandidateSurface: partialRuntime,
          requireCandidateEchartsInstance: partialRuntime && runtimeUsesEcharts,
        },
      )) {
      return false;
    }
    // Runtime-generated Canvas/SVG surfaces are presentation state, not edit
    // authority. A Script-disabled candidate is the verified projection of the
    // latest Working HTML and must remain editable even when it cannot recreate
    // those surfaces. This usable degradation stays quiet; an optional bounded
    // Runtime retry remains available through the More menu.
    return promoteRuntimeCandidate(candidate);
  }, [promoteRuntimeCandidate, syncRuntimeCandidateDiagnostics]);
  connectRuntimeCandidateRef.current = connectRuntimeCandidate;

  const fallBackToStaticRuntimeFrame = useCallback((
    frame: RuntimeFrameContext,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ): boolean => {
    const current = runtimeFrameRef.current;
    if (
      !current
      || current.settled
      || current.elementGeneration !== frame.elementGeneration
      || !sameRuntimeGrant(current.grant, frame.grant)
    ) return false;
    const settlement = completeRuntimeAttempt(current, outcome);
    if (!settlement.accepted) return false;
    runtimeFrameRef.current = null;
    if (!settlement.shouldUseStaticFallback) return true;
    // A rejected or timed-out program never replaces this iframe with another
    // executable document. The same authoritative source resumes as static.
    loadFrameSource(frameSourceHtmlRef.current, {
      preserveViewport: true,
      immediate: true,
      forceStatic: true,
    });
    return true;
  }, [completeRuntimeAttempt, loadFrameSource]);

  const updateSelectedStyle = useCallback(() => {
    const element = selectedElementRef.current;
    const activeStyleElements = (
      activeTextRangeRef.current?.styleElements
      ?? activeNativeEditRef.current?.session.getStyleElementsForSelection()
      ?? []
    ).filter((candidate) => candidate.isConnected);
    const styleElement = activeStyleElements[0] ?? element;
    const view = styleElement?.ownerDocument.defaultView;
    if (!element || !styleElement || !view) return;
    setSelectedStyle(readComputedEditableStyle(
      styleElement,
      activeStyleElements.length > 0 ? activeStyleElements : undefined,
    ));
  }, []);

  const updateMoveAvailability = useCallback(() => {
    const element = selectedElementRef.current;
    if (!element) {
      setMoveAvailability(sourceMoveAvailability(
        sourceIndexRef.current,
        selectedSourceSelectionRef.current,
      ));
      return;
    }
    if (runtimeGeneratedSelectionRef.current) {
      setMoveAvailability({ up: false, down: false });
      return;
    }
    const parent = element?.parentElement;
    const isSafeParent = parent && !["HTML", "HEAD"].includes(parent.tagName);
    const isSafeElement = element && !["BODY", "HTML"].includes(element.tagName);
    setMoveAvailability({
      up: Boolean(
        enableReorderRef.current
        && isSafeParent
        && isSafeElement
        && element.previousElementSibling
      ),
      down: Boolean(
        enableReorderRef.current
        && isSafeParent
        && isSafeElement
        && element.nextElementSibling
      ),
    });
  }, []);

  const updateOverlayPosition = useCallback((
    options: { allowRuntimeHandoff?: boolean } = {},
  ) => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const runtimeHandoff = container?.getAttribute("data-runtime-handoff");
    if (runtimeHandoff === "positioning" && !options.allowRuntimeHandoff) {
      // The still-visible previous frame owns the last published layout.
      // Do not republish it as proof that the new revision was measured, and
      // do not publish an empty measurement that would collapse the rail.
      return;
    }
    const element = canvasVisualTargetElement(
      selectedElementRef.current,
      sourceIndexRef.current,
      { runtimeGenerated: runtimeGeneratedSelectionRef.current },
    );
    const sourceSha256 = sourceIndexRef.current?.sourceSha256 ?? "";
    const viewContextGeneration =
      appliedPageViewContextRef.current?.generation ?? 0;
    const layoutTargets = commentLayoutTargets(commentedTargetsRef.current);
    const targetIds = sortedCommentLayoutTargetIds(layoutTargets);
    const textEditing = Boolean(
      activeNativeEditRef.current
    );
    const preservePreparedFrameOverlay = Boolean(
      container?.getAttribute("data-runtime-handoff") === "preparing"
      && selectedElementRef.current?.isConnected
      && renderedSourceHtmlRef.current === frameSourceHtmlRef.current,
    );
    if (!container || !iframe || !documentNode?.body) {
      container?.removeAttribute("data-runtime-layout-ready");
      onCommentLayoutRef.current?.({
        sourceSha256,
        viewContextGeneration,
        ready: false,
        textEditing,
        targetIds,
        scrollTop: 0,
        contentHeight: 0,
        clientHeight: 0,
        targets: [],
      });
      if (!preservePreparedFrameOverlay) setOverlayPosition(null);
      setCommentMarkers([]);
      insertionLayoutAuthorityRef.current = null;
      insertionPointsRef.current = [];
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const frameOffsetLeft = iframeRect.left - containerRect.left;
    const frameOffsetTop = iframeRect.top - containerRect.top;
    const frameHeight = iframe.clientHeight;
    const frameWidth = iframe.clientWidth;
    const positionSelectedOverlay = (): boolean => {
      if (!element?.isConnected) return false;
      const elementRect = element.getBoundingClientRect();
      if (elementRect.bottom < 0 || elementRect.top > frameHeight) return false;
      const elementLeft = frameOffsetLeft + elementRect.left;
      const elementTop = frameOffsetTop + elementRect.top;
      const toolbarWidth = toolbarRef.current?.offsetWidth
        || Math.min(700, Math.max(120, containerRect.width - 16));
      const toolbarHeight = toolbarRef.current?.offsetHeight || 42;
      const maxToolbarLeft = Math.max(8, containerRect.width - toolbarWidth - 8);
      const aboveTop = elementTop - toolbarHeight - 10;
      const toolbarTop = aboveTop >= 8
        ? aboveTop
        : elementTop + elementRect.height + 10;
      setOverlayPosition({
        toolbarLeft: Math.max(8, Math.min(maxToolbarLeft, elementLeft)),
        toolbarTop: Math.max(8, toolbarTop),
      });
      return true;
    };
    const scrollingElement = documentNode.scrollingElement || documentNode.documentElement;
    const frameView = documentNode.defaultView;
    const scrollTop = Math.max(
      0,
      Number(frameView?.scrollY || scrollingElement.scrollTop || 0),
    );
    const measurementReady = Boolean(
      sourceSha256
      && renderedSourceHtmlRef.current === frameSourceHtmlRef.current
      && container.getClientRects().length > 0
      && iframe.getClientRects().length > 0
      && frameHeight > 0
      && frameWidth > 0
    );
    if (!measurementReady) {
      container.removeAttribute("data-runtime-layout-ready");
      onCommentLayoutRef.current?.({
        sourceSha256,
        viewContextGeneration,
        ready: false,
        textEditing,
        targetIds,
        scrollTop,
        contentHeight: naturalDocumentContentHeight(documentNode, frameHeight),
        clientHeight: frameHeight,
        targets: [],
      });
      const selectedSourceElement = selectedElementRef.current;
      const lastKnownGoodSelectionProven = Boolean(
        runtimeFrameRef.current?.settled
        && selectedSourceElement?.isConnected
        && currentRuntimeSourceProof()?.(selectedSourceElement),
      );
      if (
        !lastKnownGoodSelectionProven
        || !positionSelectedOverlay()
      ) {
        if (!preservePreparedFrameOverlay) setOverlayPosition(null);
      }
      setCommentMarkers([]);
      return;
    }
    const commentTabAssociations = tabAssociations(documentNode);
    const commentLayouts = measureCommentTargetLayouts({
      documentNode,
      layoutTargets,
      sourceIndex: sourceIndexRef.current,
      scrollTop,
      commentTabAssociations,
      isProvenSourceElement: currentRuntimeSourceProof(),
    });
    const commentLayoutsByTargetId = new Map(
      commentLayouts.map((layout) => [layout.targetId, layout]),
    );
    const layoutState: HtmlCanvasCommentLayoutState = {
      sourceSha256,
      viewContextGeneration,
      ready: true,
      textEditing,
      targetIds,
      scrollTop,
      contentHeight: naturalDocumentContentHeight(documentNode, frameHeight),
      clientHeight: frameHeight,
      targets: commentLayouts,
    };
    container.setAttribute("data-runtime-layout-ready", "true");
    onCommentLayoutRef.current?.(layoutState);

    if (lockedRef.current) {
      setOverlayPosition(null);
      setCommentMarkers([]);
      insertionLayoutAuthorityRef.current = null;
      insertionPointsRef.current = [];
      return;
    }

    if (!positionSelectedOverlay()) {
      if (!preservePreparedFrameOverlay) setOverlayPosition(null);
    }

    const sourceIndex = sourceIndexRef.current;
    const nextInsertionAuthority = sourceIndex?.sourceSha256
      ? { sourceSha256: sourceIndex.sourceSha256, documentNode }
      : null;
    if (insertionLayoutNeedsRefresh(insertionLayoutAuthorityRef.current, nextInsertionAuthority)) {
      insertionLayoutAuthorityRef.current = nextInsertionAuthority;
      insertionPointsRef.current = nextInsertionAuthority
        ? layoutInsertionPoints({
          documentNode,
          sourceIndex,
        }).allInsertionPoints
        : [];
    }
    setCommentMarkers(layoutCommentMarkers({
      documentNode,
      commentedTargets: commentedTargetsRef.current,
      commentLayoutsByTargetId,
      commentTabAssociations,
      sourceIndex: sourceIndexRef.current,
      frameHeight,
      frameOffsetLeft,
      frameOffsetTop,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      isProvenSourceElement: currentRuntimeSourceProof(),
    }));
  }, [currentRuntimeSourceProof]);
  updateOverlayPositionRef.current = updateOverlayPosition;

  const observeSelectedElement = useCallback(
    (element: HTMLElement, runtimeGenerated = false) => {
      resizeObserverRef.current?.disconnect();
      const visualElement = canvasVisualTargetElement(
        element,
        sourceIndexRef.current,
        { runtimeGenerated },
      ) ?? element;
      const ResizeObserverConstructor = visualElement.ownerDocument.defaultView?.ResizeObserver;
      if (!ResizeObserverConstructor) return;
      const observer = new ResizeObserverConstructor(() => updateOverlayPosition());
      observer.observe(visualElement);
      resizeObserverRef.current = observer;
    },
    [updateOverlayPosition],
  );

  const synchronizeStablePreview = useCallback((
    previousIndex: SourceIndexValue,
    result: SourcePatchResult,
    plan: ForwardProjectionPlan,
    originalMutation: HtmlCanvasMutation,
    appliedMutation: HtmlCanvasMutation,
    provedRuntimeMutationElement: HTMLElement | null,
  ): boolean => {
    const failPreviewSync = (reason: string): false => {
      containerRef.current?.setAttribute("data-native-preview-sync", reason);
      return false;
    };
    const currentRuntime = runtimeFrameRef.current;
    const runtimeIsCurrent = Boolean(
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
    );
    const targetedRuntimeSync = runtimeIsCurrent;
    if (
      originalMutation.kind !== "style"
      && originalMutation.kind !== "text"
      && originalMutation.kind !== "reorder"
    ) return false;
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const LiveHTMLElement = documentNode?.defaultView?.HTMLElement;
    if (!iframe || !documentNode?.documentElement || !LiveHTMLElement) {
      return failPreviewSync("document-unavailable");
    }

    try {
      const isTextRangeStyle = plan.type === "set-text-range-style";
      const mutationBefore = originalMutation.before;
      const preservesTextRange = isTextRangeStyle || (
        originalMutation.kind === "style"
        && mutationBefore !== null
        && typeof mutationBefore === "object"
        && "segments" in mutationBefore
        && Array.isArray(mutationBefore.segments)
      );
      const detachedDocument = new DOMParser().parseFromString(result.html, "text/html");
      const liveNodes = sourceBackedPreviewElements(documentNode);
      const detachedNodes = sourceBackedPreviewElements(detachedDocument);
      const previousElements = previousIndex.elements as SourceElementValue[];
      const nextElements = result.sourceIndex.elements as SourceElementValue[];
      const previousSurface = alignPreviewSourceSurface(previousIndex, liveNodes);
      if (!previousSurface && !targetedRuntimeSync) {
        return failPreviewSync("previous-surface");
      }
      if (!targetedRuntimeSync && previousSurface?.some((entry, index) => (
        liveNodes[index].getAttribute(SOURCE_ELEMENT_ATTRIBUTE)
          !== previousElements[index]?.pagerootId
      ))) return failPreviewSync("previous-surface-order");
      const detachedSurface = alignPreviewSourceSurface(result.sourceIndex, detachedNodes);
      if (
        !detachedSurface
        || detachedSurface.length !== nextElements.length
      ) return failPreviewSync("detached-surface");

      const previousTargetRef = plan.targetRefs.find(
        (target: SourceTargetRef) => target.targetId === originalMutation.target.id,
      ) || plan.targetRefs[0];
      if (!previousTargetRef) return failPreviewSync("previous-target-ref");
      const previousTarget = resolveTargetRef(previousIndex, previousTargetRef).target;
      const nextTarget = resolveTargetRef(
        result.sourceIndex,
        sourceTargetRefForSelection(appliedMutation.target),
      ).target;
      if (
        previousTarget?.type !== "element"
        || nextTarget?.type !== "element"
      ) return failPreviewSync("target-resolution");
      const liveTargetCandidates = liveNodes.filter((node) => (
        node.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) === previousTarget.pagerootId
      ));
      const liveTarget = targetedRuntimeSync
        ? (() => {
            const sourceProof = currentRuntimeSourceProof();
            const provedCandidates = liveTargetCandidates.filter(
              (node): node is HTMLElement => (
                node instanceof LiveHTMLElement
                && sourceProof?.(node as HTMLElement) === true
              ),
            );
            if (
              provedCandidates.length !== 1
              || provedCandidates[0] !== provedRuntimeMutationElement
            ) return null;
            return provedCandidates[0];
          })()
        : liveTargetCandidates[0];
      const detachedTarget = detachedNodes.find((node) => (
        node.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) === nextTarget.pagerootId
      ));
      if (!(liveTarget instanceof LiveHTMLElement)) return failPreviewSync("live-target");
      if (!detachedTarget) return failPreviewSync("detached-target");

      let selectedRangeElements: HTMLElement[] = [];
      let trustedImportedRuntimeElements: HTMLElement[] = [];

      if (originalMutation.kind === "reorder") {
        const liveParent = liveTarget.parentNode;
        if (
          !liveParent
          || previousTarget.parentId !== nextTarget.parentId
          || !("children" in liveParent)
        ) return false;
        const sourceBackedSiblings = Array.from(liveParent.children).filter(
          (element): element is Element => (
            element instanceof documentNode.defaultView!.Element
            && element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)
          ),
        );
        const nextParent = nextTarget.parentId
          ? result.sourceIndex.byNodeId.get(nextTarget.parentId)
          : null;
        if (
          nextParent?.type !== "element"
          || nextParent.childElementIds.indexOf(nextTarget.nodeId) < 0
          || sourceBackedSiblings.length !== nextParent.childElementIds.length
          || sourceBackedSiblings.length !== liveParent.children.length
          || !sourceBackedSiblings.includes(liveTarget)
        ) return failPreviewSync("reorder-sibling-surface");
        const desiredPagerootIds: Array<string | null> = nextParent.childElementIds.map(
          (nodeId: string) => {
            const element = result.sourceIndex.byNodeId.get(nodeId);
            return element?.type === "element" ? element.pagerootId : null;
          },
        );
        if (desiredPagerootIds.some((pagerootId: string | null) => !pagerootId)) {
          return failPreviewSync("reorder-next-identity");
        }
        const liveByPagerootId = new Map<string, Element>();
        const sourceProof = targetedRuntimeSync ? currentRuntimeSourceProof() : null;
        for (const sibling of sourceBackedSiblings) {
          const pagerootId = sibling.getAttribute(SOURCE_ELEMENT_ATTRIBUTE);
          if (
            !pagerootId
            || liveByPagerootId.has(pagerootId)
            || (targetedRuntimeSync && (
              !(sibling instanceof LiveHTMLElement)
              || sourceProof?.(sibling) !== true
            ))
          ) return failPreviewSync("reorder-live-identity");
          liveByPagerootId.set(pagerootId, sibling);
        }
        const desiredSiblings: Array<Element | null> = desiredPagerootIds.map(
          (pagerootId: string | null) => (
            pagerootId ? liveByPagerootId.get(pagerootId) ?? null : null
          ),
        );
        if (desiredSiblings.some((sibling: Element | null) => !sibling)) {
          return failPreviewSync("reorder-identity-mismatch");
        }
        for (let index = 0; index < desiredSiblings.length; index += 1) {
          const currentSibling = Array.from(liveParent.children).filter(
            (element) => element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE),
          )[index];
          const desiredSibling = desiredSiblings[index]!;
          if (currentSibling !== desiredSibling) {
            liveParent.insertBefore(desiredSibling, currentSibling ?? null);
          }
        }
        const finalPagerootIds = Array.from(liveParent.children)
          .filter((element) => element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE))
          .map((element) => element.getAttribute(SOURCE_ELEMENT_ATTRIBUTE));
        if (finalPagerootIds.some((pagerootId, index) => (
          pagerootId !== desiredPagerootIds[index]
        ))) return failPreviewSync("reorder-final-order");
      } else if (originalMutation.kind === "style") {
        if (isTextRangeStyle) {
          const imported = reconcileRangeStyleInPlace(liveTarget, detachedTarget, previousIndex, result.sourceIndex);
          if (!imported) return failPreviewSync("runtime-subtree-needs-candidate");
          if (targetedRuntimeSync) trustedImportedRuntimeElements = [...imported];
          const openingPatches = result.patches.filter(
            (patch: { kind?: string }) => patch.kind === "text-range-style-open",
          );
          const insertedSpanNodeIds = openingPatches.flatMap((openingPatch) => {
            const shiftedStartOffset = openingPatch.startOffset + result.patches.reduce(
              (total: number, patch: { startOffset: number; before: string; after: string }) => (
                patch.startOffset < openingPatch.startOffset
                  ? total + patch.after.length - patch.before.length
                  : total
              ),
              0,
            );
            const insertedSpan = nextElements.find((element) => (
              element.tagName === "span"
              && element.startTagRange.startOffset === shiftedStartOffset
            ));
            return insertedSpan ? [insertedSpan.pagerootId] : [];
          });
          selectedRangeElements = insertedSpanNodeIds.flatMap((pagerootId) => {
            if (!pagerootId) return [];
            const selectedSpan = liveTarget.querySelector<HTMLElement>(
              `[${SOURCE_ELEMENT_ATTRIBUTE}="${pagerootId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
            );
            return selectedSpan ? [selectedSpan] : [];
          });
          if (selectedRangeElements.length !== openingPatches.length) {
            return failPreviewSync("range-wrapper-count");
          }
          const coalescedElementId = result.patches.find(
            (patch: { nodeId?: string }) => typeof patch.nodeId === "string",
          )?.nodeId;
          if (openingPatches.length === 0 && coalescedElementId) {
            const previousStyleElementIndex = previousElements.findIndex(
              (element) => element.pagerootId === coalescedElementId
                || element.nodeId === coalescedElementId,
            );
            const nextStyleElementId = previousStyleElementIndex >= 0
              ? nextElements[previousStyleElementIndex]?.pagerootId
              : null;
            if (!nextStyleElementId) return false;
            const selectedStyleElement = liveTarget.querySelector<HTMLElement>(
              `[${SOURCE_ELEMENT_ATTRIBUTE}="${nextStyleElementId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
            );
            if (!selectedStyleElement) return false;
            selectedRangeElements = [selectedStyleElement];
          }
        } else {
          const nextStyle = detachedTarget.getAttribute("style");
          if (nextStyle === null) liveTarget.removeAttribute("style");
          else liveTarget.setAttribute("style", nextStyle);
        }
      } else {
        // Legacy direct-text patches may update one exact Text node only.
        // Assigning element.textContent here would flatten semantic children
        // such as <strong>/<em> and destroy otherwise untouched source shape.
        const liveTextNodes = Array.from(liveTarget.childNodes).filter(
          (node): node is Text => node.nodeType === node.TEXT_NODE,
        );
        const detachedTextNodes = Array.from(detachedTarget.childNodes).filter(
          (node): node is Text => node.nodeType === node.TEXT_NODE,
        );
        if (
          liveTarget.children.length > 0
          || detachedTarget.children.length > 0
          || liveTarget.childNodes.length !== 1
          || detachedTarget.childNodes.length !== 1
          || liveTextNodes.length !== 1
          || detachedTextNodes.length !== 1
        ) return false;
        liveTextNodes[0].data = detachedTextNodes[0].data;
      }

      const stableNodes = sourceBackedPreviewElements(documentNode);
      const stableSurface = alignPreviewSourceSurface(result.sourceIndex, stableNodes);
      if (!stableSurface && !targetedRuntimeSync) {
        return failPreviewSync("stable-surface");
      }

      // Direct patches refresh the mounted preview and every ephemeral source
      // identity in place. The DOM remains a preview only; it is never
      // serialized back into the user's source.
      if (targetedRuntimeSync) {
        const stableUpdates = refreshStableMountedPreviewSourceNodeIds(
          documentNode,
          result.sourceIndex,
        );
        const trustedImported = new Set(trustedImportedRuntimeElements);
        const registered = runtimeSourceElementsRef.current;
        stableUpdates.forEach(({ element: stableElement, pagerootId }) => {
          if (
            !registered
            || registered.elementGeneration !== currentRuntime?.elementGeneration
            || registered.executionId !== currentRuntime?.grant.executionId
            || (
              !registered.elements.has(stableElement)
              && !trustedImported.has(stableElement)
            )
          ) return;
          stableElement.setAttribute(
            EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
            pagerootId,
          );
          registered.pagerootIds.set(stableElement, pagerootId);
          registered.elements.add(stableElement);
        });
      }
      sourceIndexRef.current = result.sourceIndex;
      frameSourceHtmlRef.current = result.html;
      renderedSourceHtmlRef.current = result.html;
      renderedProjectionSha256Ref.current = result.sourceIndex.sourceSha256;
      containerRef.current?.setAttribute("data-render-verified", "true");
      pendingFrameRestoreEpochRef.current += 1;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;

      const stableSelectionElement = isTextRangeStyle
        && selectedRangeElements.length === 1
        ? selectedRangeElements[0]
        : liveTarget;
      const stableSelection = selectionForElement(
        stableSelectionElement,
        result.sourceIndex,
        appliedMutation.target,
        appliedMutation.target.resolution,
      );
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = stableSelectionElement;
      stableSelectionElement.setAttribute(
        "data-html-canvas-selected",
        stableSelection.level,
      );
      selectedSourceSelectionRef.current = stableSelection;
      setSelection(stableSelection);
      setToolbarVisible(true);
      onSelectRef.current?.(stableSelection);
      if (preservesTextRange && !isTextRangeStyle) {
        selectedRangeElements = [liveTarget];
      }
      if (preservesTextRange && selectedRangeElements.length > 0) {
        const selectedDomRange = documentNode.createRange();
        const firstSelected = selectedRangeElements[0];
        const lastSelected = selectedRangeElements[selectedRangeElements.length - 1];
        selectedDomRange.setStart(firstSelected, 0);
        selectedDomRange.setEnd(lastSelected, lastSelected.childNodes.length);
        const domSelection = documentNode.getSelection();
        domSelection?.removeAllRanges();
        domSelection?.addRange(selectedDomRange);
        const refreshedTextRange = activeTextRangeFromDocument(
          documentNode,
          result.sourceIndex,
        );
        activeTextRangeRef.current = refreshedTextRange
          ? { ...refreshedTextRange, target: stableSelection }
          : null;
        setHasTextRange(Boolean(activeTextRangeRef.current));
      } else {
        activeTextRangeRef.current = null;
        setHasTextRange(false);
      }
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(stableSelectionElement);
      if (originalMutation.kind === "reorder" && targetedRuntimeSync) {
        requestAnimationFrame(() => documentNode.defaultView?.dispatchEvent(new Event("resize")));
      }
      requestAnimationFrame(() => updateOverlayPosition());
      containerRef.current?.setAttribute("data-native-preview-sync", "ready");
      return true;
    } catch (cause) {
      return failPreviewSync(
        `exception:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 240),
      );
    }
  }, [
    currentRuntimeSourceProof,
    observeSelectedElement,
    updateMoveAvailability,
    updateOverlayPosition,
    updateSelectedStyle,
  ]);

  // Fail-closed edit refusals stay silent in the UI; the container attribute
  // below is the diagnostic trail relied on by tests and support tooling.
  const reportBlockedEdit = useCallback((cause: unknown) => {
    const rawDetail = cause instanceof Error
      ? cause.message
      : String(cause || "");
    containerRef.current?.setAttribute(
      "data-edit-block-detail",
      rawDetail.slice(0, 240),
    );
  }, []);

  const reportInlineStyleOverrideFailure = useCallback(() => {
    const message = "这个样式无法通过当前元素的局部修改可靠生效。可以把修改要求交给 Agent，由 Agent 调整页面样式结构。";
    setEditFeedback({
      code: "canvas_c02_style_override",
      title: "暂时不能直接修改这个样式",
      message,
      tone: "warning",
      sticky: false,
      recovery: "none",
    });
    onEditBlockedRef.current?.(message);
  }, []);

  const advanceLastKnownGoodRuntimeProjection = useCallback((
    source: string,
    nextIndex: SourceIndexValue,
  ): boolean => {
    const activeRuntime = runtimeFrameRef.current;
    const documentNode = iframeRef.current?.contentDocument;
    if (
      !activeRuntime?.settled
      || activeRuntime.elementGeneration !== frameLoadGenerationRef.current
      || !documentNode?.documentElement
    ) return false;

    let stableIdsRebound = false;
    try {
      const stableUpdates = refreshStableMountedPreviewSourceNodeIds(
        documentNode,
        nextIndex,
      );
      const registered = runtimeSourceElementsRef.current;
      stableUpdates.forEach(({ element, pagerootId }) => {
        if (
          registered?.elements.has(element)
          && registered.pagerootIds.get(element) === pagerootId
        ) {
          element.setAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE, pagerootId);
        }
      });
      stableIdsRebound = true;
    } catch {
      // The last-known-good document remains visible. Advancing source
      // authority below intentionally makes any unproved old mapping
      // non-editable until a newer candidate succeeds.
    }
    sourceIndexRef.current = nextIndex;
    frameSourceHtmlRef.current = source;
    latestSourceProjectionRef.current = { source, sourceIndex: nextIndex };
    renderedSourceHtmlRef.current = null;
    markRuntimeRefreshPending(
      nextIndex.sourceSha256,
      "runtime-source-authority-advanced",
    );
    return stableIdsRebound;
  }, [markRuntimeRefreshPending]);

  const applySourceCommand = useCallback((
    command: CanvasSourceCommand,
    mutation: HtmlCanvasMutation,
    options: {
      validateResult?: (result: SourcePatchResult) => void;
      onUnchanged?: () => void;
      islandTextCommit?: {
        selection: NativeEditSelection;
        deferPreviewReconcile?: boolean;
      };
    } = {},
  ): SourcePatchResult | null => {
    const sourceIndex = sourceIndexRef.current;
    const currentSource = frameSourceHtmlRef.current;
    const blockedDetailAtCommandStart = containerRef.current?.getAttribute(
      "data-edit-block-detail",
    );
    const provedRuntimeMutationElement = runtimeFrameRef.current
      ? activeNativeEditRef.current?.selectionElement
        ?? selectedElementRef.current
      : null;
    if (runtimeFrameRef.current) {
      const sourceProof = currentRuntimeSourceProof();
      if (
        !provedRuntimeMutationElement?.isConnected
        || !sourceProof?.(provedRuntimeMutationElement)
      ) {
        reportBlockedEdit(new Error(
          "运行页面中的源码目标身份已变化，本次修改已停止。",
        ));
        return null;
      }
    }
    if (!sourceIndex || sourceIndex.source !== currentSource) {
      reportBlockedEdit(new Error("源码地图已过期，请等待画布重新载入后重试。"));
      return null;
    }
    if (
      mutation.target.resolution === "ambiguous"
      || mutation.target.resolution === "orphaned"
    ) {
      reportBlockedEdit(new Error(
        mutation.target.resolution === "ambiguous"
          ? "目标存在多个候选，无法唯一定位。"
          : "目标已不存在，无法定位。",
      ));
      return null;
    }

    try {
      const documentState = createSemanticDocumentState(currentSource, {
        revision: semanticRevisionRef.current,
        sourceIndex,
      });
      const semanticOperation = command.operation;
      const operationTargetRefs = [sourceTargetRefForSelection(mutation.target)];
      const ambientTargets = uniqueSelections([
        ...commentedTargetsRef.current.map((entry) => entry.target),
        ...trackedTargetsRef.current,
      ]);
      const originalTargets = uniqueSelections([
        mutation.target,
        ...ambientTargets,
      ]);
      const trackedTargetRefs = trackedSourceTargetRefs(
        originalTargets,
        // A direct semantic operation materializes its own canonical
        // subregion TargetRef. Keep the caller's presentation-level identity
        // (for example a module selection) in the same apply as a tracked
        // mapping so the Canvas can restore its original targetId and level.
        [],
      );
      const semanticResult = applySemanticOperation(
        documentState,
        semanticOperation,
        { trackedTargetRefs },
      );
      const result = semanticResult.materialization
        .sourcePatchResult as ReturnType<typeof applyPatchPlan> | undefined;
      if (!result) {
        throw new Error("语义操作未产出可发布的源码物化结果。");
      }
      if (result.html === currentSource) {
        options.onUnchanged?.();
        return null;
      }
      const forwardPlan: ForwardProjectionPlan = {
        type: semanticResult.materialization.planType || "source-patch",
        targetRefs: operationTargetRefs,
      };
      options.validateResult?.(result);
      const currentRuntime = runtimeFrameRef.current;
      const runtimeIsCurrent = Boolean(
        currentRuntime?.settled
        && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
      );
      const refreshDecision = decideEditRuntimeRefresh({
        hasRuntime: runtimeIsCurrent,
        mutationKind: mutation.kind,
        elementTagName: mutation.target.tagName,
        programIdentityChanged: (
          editRuntimeProgramIdentity(currentSource)
          !== editRuntimeProgramIdentity(result.html)
        ),
      });
      const targetUpdates = deterministicTargetUpdates(result, originalTargets);
      const targetUpdatesById = new Map(
        targetUpdates.map((target) => [target.id, target]),
      );
      const operationTargetUpdate = deterministicOperationTargetUpdate(
        result,
        mutation.target,
      );
      const appliedMutation: HtmlCanvasMutation = {
        ...mutation,
        target: operationTargetUpdate
          || targetUpdatesById.get(mutation.target.id)
          || {
            ...mutation.target,
            resolution: "orphaned",
          },
        targetUpdates,
        trackedTargetIds: [
          ...new Set([
            ...forwardPlan.targetRefs.map(
              (target: SourceTargetRef) => target.targetId,
            ),
            ...trackedTargetRefs.map((target) => target.targetId),
          ]),
        ],
      };
      const beforeHistorySelection = historySelectionFromMutationValue(
        mutation.before,
      );
      const afterHistorySelection = historySelectionFromMutationValue(
        mutation.after,
      );
      // Range wrappers are allocated by the same Kernel materialization. Seal
      // those returned IDs into the accepted save evidence only after every
      // caller validation has passed; Canvas never precomputes them.
      const acceptedSemanticOperation = (() => {
        if (
          semanticOperation.type !== "setStyle"
          && semanticOperation.type !== "setText"
        ) return semanticOperation;
        const nextTarget = result.sourceIndex.byPagerootId.get(
          semanticOperation.target.elementId,
        );
        const canonicalContentHtml = semanticOperation.type === "setText"
          && semanticOperation.contentHtml !== undefined
          && nextTarget?.type === "element"
          ? result.sourceIndex.source.slice(
            nextTarget.contentRange.startOffset,
            nextTarget.contentRange.endOffset,
          )
          : null;
        return {
          ...semanticOperation,
          ...(canonicalContentHtml !== null ? { contentHtml: canonicalContentHtml } : {}),
          ...(semanticOperation.type === "setStyle"
            && semanticOperation.range
            && !semanticOperation.createdPagerootIds
            && semanticResult.allocatedElementIds?.length
            ? { createdPagerootIds: [...semanticResult.allocatedElementIds] }
            : {}),
          ...(semanticOperation.type === "setText"
            && semanticOperation.contentHtml !== undefined
            && !semanticOperation.createdPagerootIds
            && semanticResult.allocatedElementIds?.length
            ? { createdPagerootIds: [...semanticResult.allocatedElementIds] }
            : {}),
        } as SemanticOperation;
      })();
      const sourceTransaction: HtmlCanvasSourceTransaction = {
        kind: appliedMutation.kind,
        ...(appliedMutation.property
          ? { property: appliedMutation.property }
          : {}),
        beforeSourceSha256: result.previousSourceSha256,
        afterSourceSha256: result.sourceSha256,
        forwardPatches: result.patches.map((patch) => ({ ...patch })),
        reversePatches: result.inversePlan.patches.map((patch) => ({ ...patch })),
        beforeTarget: mutation.target,
        afterTarget: appliedMutation.target,
        ...(beforeHistorySelection
          ? { beforeSelection: beforeHistorySelection }
          : {}),
        ...(afterHistorySelection
          ? { afterSelection: afterHistorySelection }
          : {}),
        ...(semanticOperation
          ? {
              semanticOperation: acceptedSemanticOperation,
              identityDelta: semanticResult?.identityDelta,
            }
          : {}),
      };
      const acceptedReceipt = onChangeRef.current(
        result.html,
        appliedMutation,
        sourceTransaction,
      );
      if (!acceptedReceipt) {
        reportBlockedEdit(new Error("宿主状态已锁定，本次画布修改未被接受。"));
        return null;
      }
      lastSourceReceiptRef.current = acceptedReceipt;
      recordRuntimeRefreshDecision(refreshDecision);
      latestSourceProjectionRef.current = {
        source: result.html,
        sourceIndex: result.sourceIndex,
      };
      semanticRevisionRef.current = semanticResult?.nextRevision
        ?? semanticRevisionRef.current + 1;
      advanceRuntimeRefreshPending(result.sourceSha256);
      if (!blockedDetailAtCommandStart) setEditFeedback(null);
      const activeNativeEdit = activeNativeEditRef.current;
      if (
        activeNativeEdit
        && options.islandTextCommit
        && forwardPlan.type === "replace-editable-island"
        && activeNativeEdit.target.id === mutation.target.id
      ) {
        if (refreshDecision.markRuntimeRefreshPending) {
          markRuntimeRefreshPending(
            result.sourceSha256,
            refreshDecision.reason,
          );
        }
        const refreshedRootRef = result.refreshedTargetRefs.find(
          (targetRef: SourceTargetRef) => (
            targetRef.targetId === activeNativeEdit.rootTargetRef.targetId
          ),
        );
        if (!refreshedRootRef || refreshedRootRef.resolution !== "exact") {
          throw new Error("V2 可编辑岛提交后无法精确重绑源码目标。");
        }
        const refreshedIsland = editableIslandForTarget(
          result.sourceIndex,
          refreshedRootRef,
        );
        const refreshedProjection = buildSourceTextMap(
          result.sourceIndex,
          refreshedRootRef,
          { allowEmpty: true, ignoreComments: true },
        );
        const nextLease = {
          ...activeNativeEdit.lease,
          sourceRevision: result.sourceSha256,
        };
        sourceIndexRef.current = result.sourceIndex;
        frameSourceHtmlRef.current = result.html;
        activeNativeEdit.rootTargetRef = refreshedRootRef;
        const nextLiveElementId = refreshedIsland.element.pagerootId
          ?? activeNativeEdit.liveElementId;
        activeNativeEdit.liveElementId = typeof nextLiveElementId === "string"
          ? nextLiveElementId
          : activeNativeEdit.liveElementId;
        activeNativeEdit.target = appliedMutation.target;
        selectedSourceSelectionRef.current = appliedMutation.target;
        setSelection(appliedMutation.target);
        onSelectRef.current?.(appliedMutation.target);
        const nextSourceInnerHtml = refreshedIsland.innerHtml;
        const rebased = activeNativeEdit.session.applyExternalIslandBaseline({
          revision: result.sourceSha256,
          text: refreshedProjection.text,
          innerHtml: nextSourceInnerHtml,
          selection: options.islandTextCommit.selection,
        }, {
          preserveLiveSelection: true,
          lease: nextLease,
          reconcileDomBeforeRebase: () => reconcileAllocatedLineBreakIds(
            activeNativeEdit.session.hostElement,
            activeNativeEdit.sourceInnerHtml,
            nextSourceInnerHtml,
          ),
        });
        if (!rebased) {
          throw new Error("V2 可编辑岛已写入源码，但实时编辑会话无法推进到新版本。");
        }
        activeNativeEdit.projection = refreshedProjection;
        activeNativeEdit.sourceInnerHtml = nextSourceInnerHtml;
        activeNativeEdit.selection = options.islandTextCommit.selection;
        nativeEditNeedsReloadRef.current = false;
        renderedSourceHtmlRef.current = result.html;
        renderedProjectionSha256Ref.current = result.sourceIndex.sourceSha256;
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          options.islandTextCommit.deferPreviewReconcile
            ? "v2-island-fence-deferred"
            : "v2-island-preserved",
        );
        containerRef.current?.setAttribute("data-render-verified", "true");
        return result;
      }
      if (activeNativeEdit) {
        throw new Error(
          "V2 文字会话只能提交当前受控文字命令。",
        );
      }
      const previewStayedMounted = refreshDecision.synchronizeCurrentFrame
        && synchronizeStablePreview(
          sourceIndex,
          result,
          forwardPlan,
          mutation,
          appliedMutation,
          provedRuntimeMutationElement,
        );
      if (
        previewStayedMounted
        && refreshDecision.markRuntimeRefreshPending
      ) {
        markRuntimeRefreshPending(
          result.sourceSha256,
          refreshDecision.reason,
        );
      }
      const staleCandidate = runtimeCandidateRef.current;
      if (
        previewStayedMounted
        && runtimeIsCurrent
        && staleCandidate
        && staleCandidate.source !== result.html
      ) {
        pendingSelectionRef.current = appliedMutation.target;
        pendingToolbarVisibleRef.current = toolbarVisibleRef.current;
        recordRuntimeRefreshDecision({
          action: "candidate-now",
          reason: "supersede-stale-candidate",
          synchronizeCurrentFrame: true,
          markRuntimeRefreshPending: true,
        });
        requestDynamicRuntimeRefresh(result.html);
      }
      if (!previewStayedMounted) {
        const activeRuntime = runtimeFrameRef.current;
        if (
          activeRuntime?.settled
          && activeRuntime.elementGeneration === frameLoadGenerationRef.current
          && iframeRef.current?.contentDocument
        ) {
          advanceLastKnownGoodRuntimeProjection(result.html, result.sourceIndex);
        }
        const selectionDeleted = mutation.property === "delete";
        pendingSelectionRef.current = selectionDeleted
          ? null
          : appliedMutation.target;
        pendingToolbarVisibleRef.current = selectionDeleted
          ? false
          : toolbarVisibleRef.current;
        selectedSourceSelectionRef.current = selectionDeleted
          ? null
          : appliedMutation.target;
        const currentRuntime = runtimeFrameRef.current;
        const preserveRuntimeActiveFrame = Boolean(
          currentRuntime?.settled
          && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
        );
        if (selectionDeleted || !preserveRuntimeActiveFrame) {
          renderedSourceHtmlRef.current = null;
          selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
          selectedElementRef.current = null;
          resizeObserverRef.current?.disconnect();
        }
        if (mutation.kind !== "reorder" && !preserveRuntimeActiveFrame) {
          setOverlayPosition(null);
        }
        setMoveAvailability(
          mutation.kind === "reorder"
            ? sourceMoveAvailability(result.sourceIndex, appliedMutation.target)
            : { up: false, down: false },
        );
        if (preserveRuntimeActiveFrame) requestDynamicRuntimeRefresh(result.html);
        else loadFrameSource(result.html, { preserveViewport: true });
      }
      return result;
    } catch (cause) {
      reportBlockedEdit(cause);
      return null;
    }
  }, [
    advanceLastKnownGoodRuntimeProjection,
    advanceRuntimeRefreshPending,
    currentRuntimeSourceProof,
    loadFrameSource,
    markRuntimeRefreshPending,
    recordRuntimeRefreshDecision,
    reportBlockedEdit,
    requestDynamicRuntimeRefresh,
    synchronizeStablePreview,
  ]);

  const clearNativeEditCheckpointTimer = useCallback(() => {
    const timer = nativeEditCheckpointTimerRef.current;
    if (timer !== null) window.clearTimeout(timer);
    nativeEditCheckpointTimerRef.current = null;
  }, []);

  const discardPendingNativeCommands = useCallback((
    reason: NativeDeferredCommandDiscardReason,
  ) => {
    nativeCommandQueueRef.current.discardPendingNativeCommands(reason);
  }, []);

  const deferNativeCommand = useCallback((
    kind: string,
    run: () => void,
    payload?: unknown,
    options: NativeDeferredCommandOptions = {},
  ): boolean => {
    const active = activeNativeEditRef.current;
    return nativeCommandQueueRef.current.deferNativeCommand(
      kind,
      run,
      payload,
      options,
      active ? { session: active.session, lease: active.lease } : null,
    );
  }, []);
  deferNativeCommandRef.current = deferNativeCommand;

  drainPendingNativeCommandRef.current = (session) => {
    nativeCommandQueueRef.current.drainPendingNativeCommand(session, {
      getActive: () => {
        const active = activeNativeEditRef.current;
        return active ? { session: active.session, lease: active.lease } : null;
      },
      getCurrentLease: () => currentNativeEditLeaseRef.current,
      schedule: (run) => window.queueMicrotask(run),
    });
  };

  const refreshNativeEditRangeState = useCallback((
    active: ActiveNativeEdit,
    nextSelection: NativeEditSelection,
  ) => {
    const retained = retainNativeEditFocusRef.current;
    const retainedIsCurrent = Boolean(
      retained
      && retained.session === active.session
      && retained.targetId === active.target.id
      && nativeEditLeasesMatch(retained.lease, active.lease)
    );
    active.selection = nextSelection;
    const startOffset = Math.min(nextSelection.anchor, nextSelection.focus);
    const endOffset = Math.max(nextSelection.anchor, nextSelection.focus);
    if (startOffset === endOffset) {
      const retainedTextRange = retainedIsCurrent
        ? retained?.textRange ?? activeTextRangeRef.current
        : null;
      if (
        retained
        && retainedTextRange
        && retained.selection.anchor !== retained.selection.focus
      ) {
        activeTextRangeRef.current = cloneActiveTextRange(
          retainedTextRange,
          active.target,
        );
        setHasTextRange(true);
        updateSelectedStyle();
        return;
      }
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      updateSelectedStyle();
      return;
    }
    try {
      const segments = textRangeToSourceSegments(
        active.projection,
        startOffset,
        endOffset,
      );
      activeTextRangeRef.current = {
        target: active.target,
        segments,
        text: active.projection.text.slice(startOffset, endOffset),
        styleElements: active.session.getStyleElementsForSelection(),
        direction: nextSelection.anchor <= nextSelection.focus
          ? "forward"
          : "backward",
      };
      setHasTextRange(true);
    } catch {
      activeTextRangeRef.current = null;
      setHasTextRange(false);
    }
    updateSelectedStyle();
  }, [updateSelectedStyle]);

  const nativeEditAuthorityIsCurrent = useCallback((active: ActiveNativeEdit) => {
    const currentDocument = iframeRef.current?.contentDocument;
    const selectedTarget = selectedSourceSelectionRef.current;
    return Boolean(
      activeNativeEditRef.current === active
      && active.rootElement.isConnected
      && active.selectionElement.isConnected
      && active.rootElement.ownerDocument === currentDocument
      && selectedElementRef.current === active.selectionElement
      && selectedTarget
      && selectedTarget.id === active.target.id
      && active.lease.domGeneration === nativeDomGenerationRef.current
      && nativeEditLeasesMatch(currentNativeEditLeaseRef.current, active.lease)
    );
  }, []);

  const restoreNativeEditSelectionForCommand = useCallback((
    active: ActiveNativeEdit,
  ): NativeEditSelection | null => {
    if (!nativeEditAuthorityIsCurrent(active)) {
      retainNativeEditFocusRef.current = null;
      return null;
    }
    const retained = retainNativeEditFocusRef.current;
    if (retained && (
      retained.session !== active.session
      || retained.targetId !== active.target.id
      || !nativeEditLeasesMatch(retained.lease, active.lease)
    )) {
      retainNativeEditFocusRef.current = null;
      return null;
    }
    const documentSelection = active.rootElement.ownerDocument.getSelection();
    const liveSelectionIsInside = Boolean(
      documentSelection?.anchorNode
      && documentSelection.focusNode
      && (
        documentSelection.anchorNode === active.rootElement
        || active.rootElement.contains(documentSelection.anchorNode)
      )
      && (
        documentSelection.focusNode === active.rootElement
        || active.rootElement.contains(documentSelection.focusNode)
      )
    );
    const selection = retained?.selection
      ?? (liveSelectionIsInside
        ? active.session.getSelection()
        : active.selection);
    active.session.restoreSelection(selection);
    refreshNativeEditRangeState(active, selection);
    return selection;
  }, [nativeEditAuthorityIsCurrent, refreshNativeEditRangeState]);

  const rememberNativeEditSelection = useCallback((active: ActiveNativeEdit) => {
    if (!nativeEditAuthorityIsCurrent(active)) {
      retainNativeEditFocusRef.current = null;
      return;
    }
    retainNativeEditFocusRef.current = {
      session: active.session,
      lease: { ...active.lease },
      targetId: active.target.id,
      selection: { ...active.selection },
      textRange: cloneActiveTextRange(activeTextRangeRef.current, active.target),
    };
  }, [nativeEditAuthorityIsCurrent]);

  const reloadCommittedNativeEditFromSource = useCallback((
    active: ActiveNativeEdit,
    source: string,
    selection: NativeEditSelection,
  ) => {
    clearNativeEditCheckpointTimer();
    const target = active.target;
    const rootElement = active.rootElement;
    const documentNode = rootElement.ownerDocument;
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    endRuntimeNativeEdit();
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuardRef.current(documentNode);
    rootElement.removeAttribute("data-html-canvas-editing");
    active.session.fenceDispose();
    nativeEditNeedsReloadRef.current = false;
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    documentNode.getSelection()?.removeAllRanges();
    queueNativeFenceReloadRef.current(
      source,
      {
        fenceId: nativeEditFenceSequenceRef.current,
        target,
        selection,
        focus: true,
        toolbarVisible: true,
      },
      target,
    );
  }, [clearNativeEditCheckpointTimer, discardPendingNativeCommands, endRuntimeNativeEdit]);

  const restoreRejectedNativeCheckpoint = useCallback((
    active: ActiveNativeEdit,
    selection: NativeEditSelection,
  ) => {
    if (activeNativeEditRef.current !== active) return;
    const sourceIndex = sourceIndexRef.current;
    active.session.rollback();
    if (
      sourceIndex
      && sourceIndex.source === frameSourceHtmlRef.current
      && restartCanonicalNativeEditRef.current(
        active,
        active.target,
        selection,
        sourceIndex,
        sourceIndex,
      )
    ) return;
    if (activeNativeEditRef.current === active) {
      reloadCommittedNativeEditFromSource(
        active,
        frameSourceHtmlRef.current,
        selection,
      );
    }
  }, [reloadCommittedNativeEditFromSource]);

  const checkpointNativeEdit = useCallback((
    trigger: NativeEditCheckpointTrigger = "automatic",
    options: { deferPreviewReconcile?: boolean } = {},
  ): NativeEditCommitResult => {
    const active = activeNativeEditRef.current;
    if (!active) return { ok: true, mutation: null };
    clearNativeEditCheckpointTimer();
    const captured = active.session.captureCheckpoint(trigger);
    if (!captured.ok) {
      const reason = captured.reason === "composing"
        ? "中文输入法正在组词，请先完成当前输入。"
        : captured.reason === "dom-drift"
          ? "这次输入没有完整完成，已恢复到上一次安全内容；请重新点选后再试。"
          : "文字编辑会话尚未准备完成。";
      reportBlockedEdit(new Error(reason));
      return { ok: false, mutation: null, reason };
    }
    refreshNativeEditRangeState(active, captured.selection);
    if (!captured.checkpoint) return { ok: true, mutation: null };

    const sourceIndex = sourceIndexRef.current;
    if (
      !sourceIndex
      || sourceIndex.sourceSha256 !== active.projection.sourceSha256
      || sourceIndex.source !== frameSourceHtmlRef.current
    ) {
      const reason = "文字编辑期间源码地图发生变化，已恢复当前源码，本次没有写入。";
      reloadCommittedNativeEditFromSource(
        active,
        frameSourceHtmlRef.current,
        captured.selection,
      );
      reportBlockedEdit(new Error(reason));
      return { ok: false, mutation: null, reason };
    }

    let sourceCommitted = false;
    try {
      const {
        previousInnerHtml,
        nextInnerHtml,
        previousText,
        nextText,
        beforeSelection,
        selection: nextSelection,
      } = captured.checkpoint;
      const mutation: HtmlCanvasMutation = {
        kind: "text",
        target: active.target,
        property: "editableIslandHtml",
        before: {
          innerHtml: previousInnerHtml,
          text: previousText,
          selection: beforeSelection,
        },
        after: {
          innerHtml: nextInnerHtml,
          text: nextText,
          selection: nextSelection,
          inputType: captured.checkpoint.inputType,
        },
      };
      let validatedSourceInnerHtml: string | null = null;
      let validationSucceeded = false;
      const operation = editableIslandTextOperation(sourceIndex, {
        elementId: active.liveElementId ?? active.rootTargetRef.elementId ?? "",
        baseRevision: semanticRevisionRef.current,
        text: nextText,
        contentHtml: nextInnerHtml,
      });
      const command: CanvasSourceCommand = {
        type: "direct-semantic-operation",
        operation,
      };
      const result = applySourceCommand(command, mutation, {
        islandTextCommit: {
          selection: nextSelection,
          deferPreviewReconcile: options.deferPreviewReconcile,
        },
        validateResult: (candidate) => {
          const operationTargetRef = candidate.refreshedTargetRefs.find(
            (targetRef: SourceTargetRef) => (
              targetRef.targetId === active.rootTargetRef.targetId
            ),
          );
          if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
            throw new Error("V2 可编辑岛无法在 Patch 后精确重绑。");
          }
          const projection = buildSourceTextMap(
            candidate.sourceIndex,
            operationTargetRef,
            { allowEmpty: true, ignoreComments: true },
          );
          const island = editableIslandForTarget(
            candidate.sourceIndex,
            operationTargetRef,
          );
          if (
            editableIslandDraftHtml(island.innerHtml, {
              baselineInnerHtml: previousInnerHtml,
            }) !== nextInnerHtml
            || projection.text !== nextText
          ) {
            throw new Error("V2 可编辑岛源码结果与当前草稿不一致。");
          }
          validatedSourceInnerHtml = island.innerHtml;
          validationSucceeded = true;
        },
      });
      if (!result || !validationSucceeded || validatedSourceInnerHtml === null) {
        const reason = "V2 文字草稿无法安全写入当前可编辑岛。";
        restoreRejectedNativeCheckpoint(active, beforeSelection);
        return { ok: false, mutation: null, reason };
      }
      sourceCommitted = true;
      const currentActive = activeNativeEditRef.current;
      if (
        !currentActive
        || currentActive.session !== active.session
        || currentActive.projection.sourceSha256 !== result.sourceSha256
        || currentActive.sourceInnerHtml !== validatedSourceInnerHtml
      ) {
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          "v2-island-checkpoint-reload",
        );
        if (activeNativeEditRef.current === active) {
          reloadCommittedNativeEditFromSource(active, result.html, nextSelection);
        }
        return { ok: true, mutation, frameReloading: true };
      }
      containerRef.current?.setAttribute(
        "data-native-commit-path",
        options.deferPreviewReconcile
          ? "v2-island-checkpoint-fence"
          : "v2-island-checkpoint-preserved",
      );
      refreshNativeEditRangeState(currentActive, nextSelection);
      return { ok: true, mutation };
    } catch (cause) {
      if (!sourceCommitted) {
        restoreRejectedNativeCheckpoint(active, captured.checkpoint.beforeSelection);
      }
      reportBlockedEdit(cause);
      return {
        ok: false,
        mutation: null,
        reason: cause instanceof Error ? cause.message : "文字检查点失败。",
      };
    }
  }, [
    applySourceCommand,
    clearNativeEditCheckpointTimer,
    refreshNativeEditRangeState,
    reloadCommittedNativeEditFromSource,
    reportBlockedEdit,
    restoreRejectedNativeCheckpoint,
  ]);

  nativeEditCheckpointRef.current = () => {
    checkpointNativeEdit();
  };

  const finishNativeEditing = useCallback((
    shouldApply: boolean,
    trigger: NativeEditCheckpointTrigger = "manual",
    {
      replayQueuedUserCommand = false,
      deferRuntimeRefresh = false,
    }: FinishNativeEditingOptions = {},
  ): NativeEditCommitResult => {
    const active = activeNativeEditRef.current;
    if (!active) return { ok: true, mutation: null };
    if (nativeEditFinishingRef.current) {
      return { ok: false, mutation: null, reason: "文字编辑正在提交。" };
    }
    nativeEditFinishingRef.current = true;
    clearNativeEditCheckpointTimer();
    try {
      const committed = shouldApply
        ? checkpointNativeEdit(trigger)
        : { ok: true, mutation: null };
      if (!committed.ok) return committed;
      const completedUserCommand = replayQueuedUserCommand
        ? nativeCommandQueueRef.current.takeReplayableNativeCommandForCompletedSession(
          { session: active.session, lease: active.lease },
          currentNativeEditLeaseRef.current,
        )
        : null;
      const replayCompletedUserCommand = () => {
        if (!completedUserCommand) return;
        nativeCommandQueueRef.current.scheduleReplay(
          completedUserCommand,
          (run) => window.queueMicrotask(run),
        );
      };
      const source = frameSourceHtmlRef.current;
      const target = active.target;
      const rootElement = active.rootElement;
      const selectionElement = active.selectionElement;
      const settledRuntimeFrame = (
        runtimeFrameRef.current?.settled
        && runtimeFrameRef.current.elementGeneration === frameLoadGenerationRef.current
      ) ? runtimeFrameRef.current : null;
      const frameReloadRequired = (
        nativeEditNeedsReloadRef.current
        || !rootElement.isConnected
        || renderedSourceHtmlRef.current !== source
      );
      currentNativeEditLeaseRef.current = null;
      activeNativeEditRef.current = null;
      endRuntimeNativeEdit();
      discardPendingNativeCommands("session-ended");
      retainNativeEditFocusRef.current = null;
      rootElement.removeAttribute("data-html-canvas-editing");
      active.session.dispose();
      nativeEditNeedsReloadRef.current = false;
      activeTextRangeRef.current = null;
      setIsEditing(false);
      setHasTextRange(false);
      rootElement.ownerDocument.getSelection()?.removeAllRanges();
      if (
        settledRuntimeFrame
        && runtimeRefreshPendingRef.current
        && !deferRuntimeRefresh
      ) {
        // Keep the current runtime document authoritative while the replacement
        // candidate is prepared. The native session has already ended, but its
        // selection host is still the managed visual target in the old frame.
        if (
          !selectedElementRef.current?.isConnected
          && selectionElement.isConnected
        ) selectedElementRef.current = selectionElement;
        selectedSourceSelectionRef.current = target;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        requestDynamicRuntimeRefresh(source);
        replayCompletedUserCommand();
        return { ...committed, frameReloading: true };
      }
      if (frameReloadRequired && !settledRuntimeFrame) {
        // An explicit finish never resumes native editing after the new frame
      // is connected.
      selectedElementRef.current = null;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        renderedSourceHtmlRef.current = null;
        loadFrameSource(source, { preserveViewport: true });
        replayCompletedUserCommand();
        return { ...committed, frameReloading: true };
      }
      if (settledRuntimeFrame) {
        // No source change remains: keep the current disposable frame and drop
        // only the transient native-input guard.
        nativeSessionNeedsCanonicalFenceRef.current = false;
        fencedDocumentCleanupRef.current();
        renderedSourceHtmlRef.current = source;
        renderedProjectionSha256Ref.current = sourceIndexRef.current?.sourceSha256 ?? "";
      }
      const previewHostStillMounted = (
        rootElement.isConnected && selectionElement.isConnected
      );
      if (!previewHostStillMounted) {
        selectedElementRef.current = null;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        replayCompletedUserCommand();
        return { ...committed, frameReloading: false };
      }

      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      pendingFrameRestoreEpochRef.current += 1;
      selectedElementRef.current = rootElement;
      selectedSourceSelectionRef.current = target;
      selectionElement.setAttribute("data-html-canvas-selected", target.level);
      renderedSourceHtmlRef.current = source;
      renderedProjectionSha256Ref.current = sourceIndexRef.current?.sourceSha256 ?? "";
      containerRef.current?.setAttribute("data-render-verified", "true");
      setSelection(target);
      setToolbarVisible(true);
      onSelectRef.current?.(target);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(selectionElement);
      requestAnimationFrame(() => updateOverlayPosition());
      replayCompletedUserCommand();
      return { ...committed, frameReloading: false };
    } finally {
      nativeEditFinishingRef.current = false;
    }
  }, [
    checkpointNativeEdit,
    clearNativeEditCheckpointTimer,
    discardPendingNativeCommands,
    endRuntimeNativeEdit,
    loadFrameSource,
    observeSelectedElement,
    requestDynamicRuntimeRefresh,
    updateMoveAvailability,
    updateOverlayPosition,
    updateSelectedStyle,
  ]);
  finishNativeEditingRef.current = finishNativeEditing;

  const requestPendingRuntimeRefresh = useCallback((reason: string): boolean => {
    const currentRuntime = runtimeFrameRef.current;
    const source = frameSourceHtmlRef.current;
    if (
      activeNativeEditRef.current
      || !runtimeRefreshPendingRef.current
      || !currentRuntime?.settled
      || currentRuntime.elementGeneration !== frameLoadGenerationRef.current
    ) return false;
    const currentCandidate = runtimeCandidateRef.current;
    if (currentCandidate?.source === source) return true;
    recordRuntimeRefreshDecision({
      action: "candidate-now",
      reason,
      synchronizeCurrentFrame: false,
      markRuntimeRefreshPending: true,
    });
    requestDynamicRuntimeRefresh(source);
    return true;
  }, [recordRuntimeRefreshDecision, requestDynamicRuntimeRefresh]);

  const resetSelection = useCallback((
    commitNativeText: boolean,
    fromQueuedCommand = false,
    deferRuntimeRefresh = false,
  ) => {
    if (
      commitNativeText
      && !fromQueuedCommand
      && deferNativeCommandRef.current(
        "target-switch",
        () => resetSelection(commitNativeText, true, deferRuntimeRefresh),
      )
    ) return;
    const committed = finishNativeEditing(commitNativeText, "manual", {
      deferRuntimeRefresh,
    });
    if (!committed.ok) return;
    pendingFrameRestoreEpochRef.current += 1;
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
    selectedElementRef.current = null;
    selectedSourceSelectionRef.current = null;
    selectedCommentAnchorRef.current = null;
    selectedVisualHintRef.current = null;
    activeTextRangeRef.current = null;
    resizeObserverRef.current?.disconnect();
    setSelection(null);
    runtimeGeneratedSelectionRef.current = false;
    setRuntimeGeneratedSelection(false);
    setToolbarVisible(false);
    setHasTextRange(false);
    setOverlayPosition(null);
    setSpacingMenuOpen(false);
    setMoveAvailability({ up: false, down: false });
    onSelectRef.current?.(null);
  }, [finishNativeEditing]);

  const clearSelection = useCallback((refreshRuntime = false) => {
    resetSelection(true, false, !refreshRuntime);
    if (refreshRuntime) requestPendingRuntimeRefresh("selection-cleared");
  }, [requestPendingRuntimeRefresh, resetSelection]);

  useEffect(() => {
    const container = containerRef.current;
    const documentNode = container?.ownerDocument;
    if (!container || !documentNode) return undefined;
    const clearOnOutsidePointer = (event: PointerEvent) => {
      if (!selectedElementRef.current) return;
      const sharedScrollElement = container.closest<HTMLElement>(
        ".review-scroll-stage",
      );
      // Scrolling the shared stage is not an outside selection gesture. In
      // particular, a native scrollbar pointerdown must leave the selected
      // target and its handoff anchor available while the drag is in flight.
      if (
        sharedScrollElement
        && sharedScrollbarPointerDown(sharedScrollElement, event)
      ) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target)) return;
      const targetElement = target instanceof Element ? target : target.parentElement;
      if (targetElement?.closest('[data-html-canvas-preserve-selection="true"]')) return;
      // App controls own their semantic checkpoint boundary. Running the
      // generic outside-click fence on pointerdown would rebuild the Runtime
      // before Save, Export, Preview, navigation or Run handlers can choose a
      // source-only checkpoint or a no-refresh leave.
      if (targetElement?.closest(
        'a, button, input, select, textarea, [role="button"], [role="menuitem"], [role="tab"]',
      )) return;
      clearSelection(true);
    };
    documentNode.addEventListener("pointerdown", clearOnOutsidePointer, true);
    return () => documentNode.removeEventListener("pointerdown", clearOnOutsidePointer, true);
  }, [clearSelection]);

  const selectElement = useCallback(
    (
      element: HTMLElement,
      levelOverride?: HtmlCanvasSelectionLevel,
      options: {
        preserveTextSelection?: boolean;
        showToolbar?: boolean;
        fromQueuedCommand?: boolean;
        runtimeGenerated?: boolean;
        selectionOverride?: HtmlCanvasSelection;
        commentAnchor?: HtmlCanvasSelection | null;
        visualHint?: HtmlCanvasRuntimeVisualHint | null;
      } = {},
    ): HtmlCanvasSelection => {
      pendingFrameRestoreEpochRef.current += 1;
      const previousSelectionId = selectedSourceSelectionRef.current?.id ?? null;
      const activeNativeEdit = activeNativeEditRef.current;
      if (activeNativeEdit && !activeNativeEdit.rootElement.contains(element)) {
        if (
          !options.fromQueuedCommand
          && deferNativeCommandRef.current(
            "target-switch",
            () => selectElement(element, levelOverride, {
              ...options,
              fromQueuedCommand: true,
            }),
            { targetId: sourceElementId(element) },
          )
        ) return activeNativeEdit.target;
        const requestedTarget = options.selectionOverride
          ?? (options.runtimeGenerated
            ? selectionForElement(
              element,
              null,
              undefined,
              "ambiguous",
              levelOverride,
            )
            : selectionForElement(
              element,
              sourceIndexRef.current,
              undefined,
              undefined,
              levelOverride,
            ));
        const committed = finishNativeEditing(true, "manual", {
        });
        if (!committed.ok) return activeNativeEdit.target;
        if (committed.frameReloading) {
          pendingSelectionRef.current = requestedTarget;
          pendingToolbarVisibleRef.current = options.showToolbar ?? true;
          return requestedTarget;
        }
      }
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
      const nextSelection = options.selectionOverride
        ?? (options.runtimeGenerated
          ? selectionForElement(
            element,
            null,
            undefined,
            "ambiguous",
            levelOverride,
          )
          : selectionForElement(
            element,
            sourceIndexRef.current,
            undefined,
            undefined,
            levelOverride,
          ));
      const nextSelectionWithContext = {
        ...nextSelection,
        ...(options.commentAnchor ? { commentAnchor: options.commentAnchor } : {}),
        ...(options.visualHint ? { visualHint: options.visualHint } : {}),
      };
      selectedElementRef.current = element;
      setSpacingMenuOpen(false);
      if (!options.preserveTextSelection) {
        activeTextRangeRef.current = null;
        setHasTextRange(false);
        element.ownerDocument.getSelection()?.removeAllRanges();
      }
      element.setAttribute("data-html-canvas-selected", nextSelection.level);
      const isGlobalPage = !options.runtimeGenerated
        && isPageRootElement(element)
        && nextSelection.level === "module";
      element.toggleAttribute(GLOBAL_SELECTION_ATTRIBUTE, isGlobalPage);
      selectedSourceSelectionRef.current = nextSelectionWithContext;
      selectedCommentAnchorRef.current = options.commentAnchor
        ?? (!options.runtimeGenerated
          && (nextSelection.resolution === "exact" || nextSelection.resolution === "rebound")
          ? nextSelection
          : null);
      selectedVisualHintRef.current = options.visualHint
        ?? nextSelection.visualHint
        ?? null;
      setSelection(nextSelectionWithContext);
      runtimeGeneratedSelectionRef.current = options.runtimeGenerated === true;
      setRuntimeGeneratedSelection(options.runtimeGenerated === true);
      setToolbarVisible(options.showToolbar ?? true);
      onSelectRef.current?.(nextSelectionWithContext);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(element, options.runtimeGenerated === true);
      if (isGlobalPage) {
        const scrollingElement = element.ownerDocument.scrollingElement;
        if (scrollingElement) scrollingElement.scrollTop = 0;
        element.ownerDocument.documentElement.scrollTop = 0;
        element.ownerDocument.body.scrollTop = 0;
        element.ownerDocument.defaultView?.scrollTo({
          top: 0,
          left: 0,
          behavior: "auto",
        });
      }
      requestAnimationFrame(() => updateOverlayPosition());
      if (
        previousSelectionId !== null
        && previousSelectionId !== nextSelectionWithContext.id
      ) {
        requestPendingRuntimeRefresh("selection-changed");
      }
      return nextSelectionWithContext;
    },
    [
      finishNativeEditing,
      observeSelectedElement,
      requestPendingRuntimeRefresh,
      updateMoveAvailability,
      updateOverlayPosition,
      updateSelectedStyle,
    ],
  );

  const selectResolvedTarget = useCallback((
    resolvedTarget: ResolvedCanvasTarget,
    options: {
      preserveTextSelection?: boolean;
      showToolbar?: boolean;
      fromQueuedCommand?: boolean;
    } = {},
  ): HtmlCanvasSelection => (
    selectElement(resolvedTarget.operationTarget, undefined, {
      ...options,
      selectionOverride: resolvedTarget.selection,
      runtimeGenerated: resolvedTarget.runtimeGenerated,
      commentAnchor: resolvedTarget.commentAnchorSelection,
      visualHint: resolvedTarget.selection.visualHint ?? null,
    })
  ), [selectElement]);

  const requestCommentForTarget = useCallback((target: HtmlCanvasSelection): boolean => {
    const commentAnchor = target.commentAnchor
      ?? selectedCommentAnchorRef.current
      ?? (!runtimeGeneratedSelectionRef.current ? target : null);
    const validPageAnchor = Boolean(
      commentAnchor
      && commentAnchor.level === "module"
      && commentAnchor.selector.trim().toLowerCase() === "body",
    );
    const validStableAnchor = Boolean(
      commentAnchor
      && commentAnchor.resolution === "exact"
      && isValidPagerootElementId(commentAnchor.elementId),
    );
    const sourceIndex = sourceIndexRef.current;
    let resolvedAnchorElement: HTMLElement | null = null;
    if (commentAnchor && sourceIndex) {
      try {
        const resolved = resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(commentAnchor),
          { surface: "comments" },
        );
        const sourceElementIdValue = resolved.target?.type === "element"
          ? resolved.target.pagerootId
          : commentAnchor.elementId;
        if (sourceElementIdValue) {
          resolvedAnchorElement = iframeRef.current?.contentDocument
            ? uniqueSourceElement(
              iframeRef.current.contentDocument,
              sourceElementIdValue,
            )
            : null;
        }
      } catch {
        resolvedAnchorElement = null;
      }
    }
    const runtimeProof = currentRuntimeSourceProof();
    const authorityVerified = !runtimeFrameRef.current
      ? Boolean(resolvedAnchorElement || validPageAnchor)
      : Boolean(resolvedAnchorElement && runtimeProof?.(resolvedAnchorElement));
    if (
      !commentAnchor
      || commentAnchor.resolution !== "exact"
      || (!validPageAnchor && !validStableAnchor)
      || !authorityVerified
    ) {
      setEditFeedback({
        code: "canvas_c13_comment_target_not_exact",
        title: "暂时无法建立评论位置",
        message: "当前内容暂时无法建立安全的评论位置，请稍后重试。",
        tone: "warning",
        sticky: false,
        recovery: "none",
      });
      return false;
    }
    const activeRange = activeTextRangeRef.current;
    const sameElement = Boolean(
      activeRange && textRangeMatchesTarget(activeRange, commentAnchor),
    );
    const textLocator = target.textLocator
      ?? (sameElement
        ? textLocatorForActiveRange(activeRange, sourceIndexRef.current)
        : null);
    onRequestCommentRef.current?.({
      ...target,
      commentAnchor,
      ...(target.visualHint || selectedVisualHintRef.current
        ? {
            visualHint: target.visualHint || selectedVisualHintRef.current || undefined,
          }
        : {}),
      ...(textLocator ? { textLocator } : {}),
    });
    return true;
  }, [currentRuntimeSourceProof]);

  const startEditing = useCallback((
    caretPoint?: TextCaretPoint,
    restoredSelection?: NativeEditSelection,
  ): boolean => {
    hoverControllerRef.current?.hide();
    containerRef.current?.setAttribute("data-native-start-status", "starting");
    containerRef.current?.removeAttribute("data-native-stale-range-discarded");
    containerRef.current?.removeAttribute("data-native-host-mode");
    containerRef.current?.removeAttribute("data-native-event-delivery-mode");
    if (readOnlyRef.current) {
      containerRef.current?.setAttribute("data-native-start-status", "read-only");
      return false;
    }
    // Only the one-shot commit window sets this ref, after beginPositioning.
    // Candidate preparation and hidden positioning must not refuse Native Edit.
    const runtimePromotion = runtimePromotionRef.current;
    if (runtimePromotion) {
      containerRef.current?.setAttribute(
        "data-native-start-status",
        "runtime-handoff-positioning",
      );
      return false;
    }
    const existing = activeNativeEditRef.current;
    if (existing) {
      existing.session.focusAtPoint(caretPoint);
      containerRef.current?.setAttribute("data-native-start-status", "existing");
      return true;
    }
    const sourceIndex = sourceIndexRef.current;
    const selectedElement = selectedElementRef.current;
    if (!sourceIndex || !selectedElement) {
      containerRef.current?.setAttribute(
        "data-native-start-status",
        `missing:${sourceIndex ? "" : "source"}:${selectedElement ? "" : "selection"}`,
      );
      return false;
    }
    if (!selectedElementHasSourceMutationAuthority()) {
      containerRef.current?.setAttribute("data-native-start-status", "runtime-display-only");
      return false;
    }
    let priorRange = activeTextRangeRef.current;
    if (
      priorRange
      && !textRangeMatchesTarget(priorRange, selectedSourceSelectionRef.current)
    ) {
      // Text Selection is disposable presentation. A selection retained from
      // the previous runtime frame must not block entry into a newly selected
      // source target after that frame is replaced.
      priorRange = null;
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      containerRef.current?.setAttribute(
        "data-native-stale-range-discarded",
        "target",
      );
    }
    const islandHostElement = nativeEditHostForElement(selectedElement, sourceIndex);
    if (!islandHostElement) {
      let blockedCause: Error = new Error(
        "这段可见内容不是当前源码中的唯一静态文字，无法安全进入原位编辑。",
      );
      const selectedSource = sourceElementId(selectedElement)
        ? sourceIndex.byPagerootId.get(sourceElementId(selectedElement)!)
        : null;
      if (selectedSource?.type === "element") {
        try {
          const selectedTargetRef = createTargetRef(
            sourceIndex,
            selectedSource,
            { level: "subregion" },
          ) as SourceTargetRef;
          const islandCapability = isEditableIslandTarget(
            sourceIndex,
            selectedTargetRef,
          );
          if (!islandCapability.editable) {
            containerRef.current?.setAttribute(
              "data-native-start-status",
              `island:${islandCapability.code}`,
            );
            containerRef.current?.setAttribute(
              "data-native-capability-detail",
              `${islandCapability.code}:${JSON.stringify(
                islandCapability.details,
              )}`.slice(0, 2400),
            );
            blockedCause = new Error(
              islandCapability.message
              || "这处内容包含不能由文字编辑器改写的网页结构。",
            );
          }
        } catch {
          // The existing no-host path below remains the fail-closed fallback.
        }
      }
      containerRef.current?.setAttribute(
        "data-native-start-status",
        containerRef.current.getAttribute("data-native-start-status") || "no-host",
      );
      reportBlockedEdit(blockedCause);
      return false;
    }
    const selectionElement = islandHostElement;
    const target = selectElement(selectionElement, "part", {
      preserveTextSelection: Boolean(priorRange),
      showToolbar: true,
    });
    let createdSession: IslandEditingController | null = null;
    let runtimeNativeEditStarted = false;
    try {
      const rootTargetRef = sourceTargetRefForSelection(target);
      const projection = buildSourceTextMap(
        sourceIndex,
        rootTargetRef,
        { allowEmpty: true, ignoreComments: true },
      );
      let activationLogicalRange = null;
      if (priorRange) {
        try {
          activationLogicalRange = sourceSegmentsToTextRange(
            projection,
            priorRange.segments,
          );
        } catch {
          // A handoff can preserve a logical target while source offsets and
          // text-node IDs advance. Discard only that stale range; the current
          // source target remains eligible for a fresh native edit session.
          priorRange = null;
          activeTextRangeRef.current = null;
          setHasTextRange(false);
          containerRef.current?.setAttribute(
            "data-native-stale-range-discarded",
            "segments",
          );
        }
      }
      const islandCapability = isEditableIslandTarget(
        sourceIndex,
        rootTargetRef,
      );
      if (!islandCapability.editable) {
        containerRef.current?.setAttribute(
          "data-native-start-status",
          `island:${islandCapability.code}`,
        );
        containerRef.current?.setAttribute(
          "data-native-capability-detail",
          `${islandCapability.code}:${JSON.stringify(
            islandCapability.details,
          )}`.slice(0, 2400),
        );
        reportBlockedEdit(new Error(
          islandCapability.message
          || "这处内容包含不能由文字编辑器改写的网页结构。",
        ));
        return false;
      }
      const sourceInnerHtml = islandCapability.island.innerHtml;
      let liveText = nativeLogicalText(islandHostElement);
      if (liveText !== projection.text) {
        containerRef.current?.setAttribute(
          "data-native-start-status",
          "text-mismatch-remount",
        );
        const hostElementId = sourceElementId(islandHostElement);
        if (
          !hostElementId
          || !remountNativeHostFromSource(
            islandHostElement,
            hostElementId,
            sourceIndex,
            (elements) => registerRestoredRuntimeElements(islandHostElement, elements),
          )
        ) {
          containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
          reportBlockedEdit(new Error(
            "画布文字与源码节点已经漂移，已阻止直接编辑。",
          ));
          return false;
        }
        liveText = nativeLogicalText(islandHostElement);
        if (liveText !== projection.text) {
          containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
          reportBlockedEdit(new Error(
            "画布文字与源码节点已经漂移，已阻止直接编辑。",
          ));
          return false;
        }
      }
      const layoutBeforeEditing = nativeLayoutFingerprint(islandHostElement);
      let initialSelection = boundedHistorySelection(
        restoredSelection,
        projection.text,
      );
      if (!initialSelection && priorRange && activationLogicalRange && !caretPoint) {
        initialSelection = {
          anchor: priorRange.direction === "backward"
            ? activationLogicalRange.endOffset
            : activationLogicalRange.startOffset,
          focus: priorRange.direction === "backward"
            ? activationLogicalRange.startOffset
            : activationLogicalRange.endOffset,
          affinity: "right",
        };
      }
      const baseline: NativeEditBaseline = {
        revision: projection.sourceSha256,
        text: projection.text,
        ...(initialSelection ? { selection: initialSelection } : {}),
      };
      const hostElement = islandHostElement;
      nativeEditSessionSequenceRef.current += 1;
      // Entering contenteditable gives Chromium a document-local mutation
      // owner even when the user later blurs before typing. Keep that
      // generation marked until a canonical frame replacement cuts it off.
      nativeSessionNeedsCanonicalFenceRef.current = true;
      const lease: ActiveNativeEdit["lease"] = {
        sessionId: `native_${nativeEditSessionSequenceRef.current.toString(36)}`,
        domGeneration: nativeDomGenerationRef.current,
        sourceRevision: projection.sourceSha256,
        hostId: rootTargetRef.targetId,
      };
      currentNativeEditLeaseRef.current = lease;
      const handleSessionState = (state: NativeEditSessionState) => {
        const active = activeNativeEditRef.current;
        if (
          !active
          || active.session !== session
          || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, active.lease)
        ) return;
        refreshNativeEditRangeState(active, state.selection);
        clearNativeEditCheckpointTimer();
        if (state.dirty && !state.composing) {
          const scheduledLease = { ...active.lease };
          nativeEditCheckpointTimerRef.current = window.setTimeout(() => {
            nativeEditCheckpointTimerRef.current = null;
            if (!nativeEditLeasesMatch(currentNativeEditLeaseRef.current, scheduledLease)) return;
            nativeEditCheckpointRef.current();
          }, state.requiresCanonicalReconcile
            ? 0
            : NATIVE_EDIT_CHECKPOINT_DELAY_MS);
        }
      };
      const session = new IslandEditingController({
        onCloneElement: transferRuntimeSourceElement,
        onSourceChildrenRestored: (elements) => registerRestoredRuntimeElements(islandHostElement, elements),
        hostElement,
        baseline,
        sourceInnerHtml,
        lease: {
          stamp: lease,
          isCurrent: (stamp) => nativeEditLeasesMatch(
            currentNativeEditLeaseRef.current,
            stamp,
          ),
          advance: (expected, next) => {
            const active = activeNativeEditRef.current;
            if (
              !active
              || active.session !== session
              || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, expected)
              || !nativeEditLeasesMatch(active.lease, expected)
            ) return false;
            const advancedLease = { ...next };
            active.lease = advancedLease;
            currentNativeEditLeaseRef.current = advancedLease;
            return true;
          },
        },
        ariaLabel: `编辑${target.label}`,
        onStateChange: handleSessionState,
        onPendingCommandReady: () => {
          drainPendingNativeCommandRef.current(session);
        },
        // V2 does not use blur as a commit boundary. Explicit target switches,
        // Escape, save/export and mode changes own that lifecycle; transient
        // iframe or toolbar focus movement must not retire the text island.
        onBlur: () => undefined,
        onEscape: () => finishNativeEditing(true, "manual"),
        onError: reportBlockedEdit,
      });
      createdSession = session;
      const layoutAfterEditing = nativeLayoutFingerprint(islandHostElement);
      const layoutDrifted = !sameNativeLayout(layoutBeforeEditing, layoutAfterEditing)
        || !sameNativeTextStyle(layoutBeforeEditing, layoutAfterEditing);
      // Layout/style fingerprints observe post-entry drift only. They must
      // not refuse to enter; MutationObserver rollback and checkpoint scope
      // remain the fail-closed safety net.
      if (layoutDrifted) {
        containerRef.current?.setAttribute("data-native-layout-drift", "true");
        hostElement.setAttribute("data-native-layout-drift", "true");
      } else {
        containerRef.current?.removeAttribute("data-native-layout-drift");
        hostElement.removeAttribute("data-native-layout-drift");
      }
      const active: ActiveNativeEdit = {
        rootElement: hostElement,
        selectionElement,
        target,
        projection,
        rootTargetRef,
        sourceInnerHtml,
        liveElementId: sourceElementId(islandHostElement) ?? target.elementId ?? null,
        session,
        lease,
        selection: initialSelection ?? {
          anchor: projection.textLength,
          focus: projection.textLength,
          affinity: "right",
        },
      };
      if (!runtimeFrameCoordinatorRef.current!.beginNativeEdit()) {
        throw new Error("Runtime handoff is not ready for this native edit transaction.");
      }
      runtimeNativeEditStarted = true;
      syncRuntimeCandidateDiagnostics();
      activeNativeEditRef.current = active;
      retainNativeEditFocusRef.current = null;
      containerRef.current?.removeAttribute("data-edit-block-detail");
      containerRef.current?.removeAttribute("data-native-capability-detail");
      containerRef.current?.setAttribute(
        "data-native-host-mode",
        "v2-editable-island",
      );
      containerRef.current?.setAttribute(
        "data-native-event-delivery-mode",
        "native-editable-island",
      );
      hostElement.setAttribute("data-html-canvas-editing", "true");
      activeTextRangeRef.current = priorRange
        ? { ...priorRange, target }
        : null;
      setIsEditing(true);
      setHasTextRange(Boolean(priorRange));
      setToolbarVisible(true);
      refreshNativeEditRangeState(active, active.selection);
      // Establish the native focus/caret before startEditing returns. Deferring
      // this to the next animation frame lets a fast mouse drag, keyboard
      // command, or test-set Selection win briefly and then get overwritten by
      // the stale activation point. Only overlay measurement needs a frame.
      if (caretPoint && !restoredSelection) session.focusAtPoint(caretPoint);
      else session.focusSelection();
      requestAnimationFrame(() => {
        if (
          activeNativeEditRef.current?.session !== session
          || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, lease)
        ) return;
        updateOverlayPosition();
      });
      containerRef.current?.setAttribute("data-native-start-status", "started");
      return true;
    } catch (cause) {
      if (runtimeNativeEditStarted) endRuntimeNativeEdit();
      createdSession?.dispose();
      containerRef.current?.setAttribute(
        "data-native-start-status",
        `error:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 500),
      );
      currentNativeEditLeaseRef.current = null;
      reportBlockedEdit(cause);
      return false;
    }
  }, [
    clearNativeEditCheckpointTimer,
    endRuntimeNativeEdit,
    finishNativeEditing,
    refreshNativeEditRangeState,
    reportBlockedEdit,
    registerRestoredRuntimeElements,
    transferRuntimeSourceElement,
    selectElement,
    selectedElementHasSourceMutationAuthority,
    syncRuntimeCandidateDiagnostics,
    updateOverlayPosition,
  ]);

  restartCanonicalNativeEditRef.current = (
    active,
    target,
    logicalSelection,
    previousIndex,
    nextIndex,
  ) => {
    if (
      activeNativeEditRef.current !== active
      || !target.elementId
      || !active.rootElement.isConnected
    ) return false;
    const canonicalTarget = canonicalNativeHostPreview(
      active.rootElement,
      target.elementId,
      nextIndex,
    );
    const parentNode = active.rootElement.parentNode;
    if (!canonicalTarget || !parentNode) return false;
    const nextRoot = active.rootElement.ownerDocument.importNode(
      canonicalTarget,
      true,
    );
    if (!(nextRoot instanceof active.rootElement.ownerDocument.defaultView!.HTMLElement)) {
      return false;
    }

    clearNativeEditCheckpointTimer();
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    endRuntimeNativeEdit();
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    // Retire the old lease and all native listeners before removing the
    // focused host. replaceChild can synchronously dispatch focusout/blur;
    // those events must not enqueue work against the new canonical island.
    active.session.fenceDispose();
    active.rootElement.removeAttribute("data-html-canvas-editing");
    active.rootElement.ownerDocument.getSelection()?.removeAllRanges();
    nativeDomGenerationRef.current += 1;
    parentNode.replaceChild(nextRoot, active.rootElement);
    registerRestoredRuntimeElements(active.rootElement, [nextRoot, ...Array.from(nextRoot.querySelectorAll("*"))], nextIndex);

    nativeEditNeedsReloadRef.current = false;
    selectedElementRef.current = nextRoot;
    selectedSourceSelectionRef.current = target;
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    selectElement(nextRoot, "part", {
      preserveTextSelection: true,
      showToolbar: true,
    });
    return startEditing(undefined, logicalSelection);
  };

  const moveSelected = useCallback(
    (direction: "up" | "down"): boolean => {
      if (activeNativeEditRef.current) {
        if (deferNativeCommandRef.current(
          "target-switch",
          () => {
            const committed = finishNativeEditing(true, "manual", {
              deferRuntimeRefresh: true,
            });
            if (committed.ok) window.queueMicrotask(() => moveSelected(direction));
          },
          { direction },
        )) return true;
        const committed = finishNativeEditing(true, "manual", {
          deferRuntimeRefresh: true,
        });
        if (!committed.ok || committed.frameReloading) return false;
      }
      const element = selectedElementRef.current;
      if (
        readOnlyRef.current
        || !selectedElementHasSourceMutationAuthority()
        || !enableReorderRef.current
      ) {
        return false;
      }

      const sourceIndex = sourceIndexRef.current;
      const logicalSelection = element?.isConnected
        ? selectionForElement(
          element,
          sourceIndex,
          selectedSourceSelectionRef.current ?? undefined,
        )
        : selectedSourceSelectionRef.current;
      if (!sourceIndex || !logicalSelection) return false;
      if (
        logicalSelection.level === "insertion"
        || logicalSelection.resolution === "ambiguous"
        || logicalSelection.resolution === "orphaned"
      ) {
        reportBlockedEdit(new Error("选中内容在画布刷新期间无法安全定位。"));
        return false;
      }

      let resolution: ReturnType<typeof resolveTargetRef>;
      try {
        resolution = resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(logicalSelection),
        );
      } catch (cause) {
        reportBlockedEdit(cause);
        return false;
      }
      const sourceElement = resolution.target;
      const sourceParent = sourceElement?.type === "element" && sourceElement.parentId
        ? sourceIndex.byNodeId.get(sourceElement.parentId)
        : null;
      if (
        !sourceElement
        || sourceElement.type !== "element"
        || sourceParent?.type !== "element"
        || ["body", "html"].includes(sourceElement.tagName)
        || ["html", "head"].includes(sourceParent.tagName)
      ) {
        reportBlockedEdit(new Error("无法确认同级内容的源码顺序。"));
        return false;
      }

      const beforeIndex = sourceParent.childElementIds.indexOf(sourceElement.nodeId);
      const nextIndex = beforeIndex + (direction === "up" ? -1 : 1);
      const siblingId = sourceParent.childElementIds[nextIndex];
      const sourceSibling = siblingId ? sourceIndex.byNodeId.get(siblingId) : null;
      if (
        beforeIndex < 0
        || sourceSibling?.type !== "element"
      ) {
        setMoveAvailability(sourceMoveAvailability(sourceIndex, logicalSelection));
        return false;
      }

      const refreshedTargetRef = createTargetRef(sourceIndex, sourceElement, {
        targetId: logicalSelection.id,
        label: logicalSelection.label,
        level: logicalSelection.level === "module" ? "module" : "subregion",
      }) as SourceTargetRef;
      const targetBeforeMove = selectionFromRefreshedTarget(
        logicalSelection,
        refreshedTargetRef,
        sourceElement.nodeId,
      );
      selectedSourceSelectionRef.current = targetBeforeMove;
      const nextSelection: HtmlCanvasSelection = {
        ...targetBeforeMove,
        resolution: "rebound",
      };
      const mutation: HtmlCanvasMutation = {
        kind: "reorder",
        target: nextSelection,
        property: "siblingIndex",
        before: {
          parentSelector: sourceParent.selector,
          index: beforeIndex,
          elementSelector: targetBeforeMove.selector,
          elementTargetId: targetBeforeMove.id,
        },
        after: {
          parentSelector: sourceParent.selector,
          index: nextIndex,
          elementSelector: targetBeforeMove.selector,
          elementTargetId: targetBeforeMove.id,
        },
      };
      try {
        return Boolean(applySourceCommand({
          type: "direct-semantic-operation",
          operation: siblingReorderOperation(sourceIndex, {
            elementId: sourceElement.pagerootId,
            toIndex: nextIndex,
            baseRevision: semanticRevisionRef.current,
          }),
        }, mutation));
      } catch (cause) {
        reportBlockedEdit(cause);
        return false;
      }
    },
    [
      applySourceCommand,
      finishNativeEditing,
      reportBlockedEdit,
      selectedElementHasSourceMutationAuthority,
    ],
  );

  const applySelectedStructureOperation = useCallback((
    action: SelectedStructureAction,
    destination?: StructureDestination,
  ): boolean => {
    if (activeNativeEditRef.current) {
      if (deferNativeCommandRef.current(
        "target-switch",
        () => {
          const committed = finishNativeEditing(true, "manual", {
            deferRuntimeRefresh: true,
          });
          if (committed.ok) {
            window.queueMicrotask(() => applySelectedStructureOperation(action, destination));
          }
        },
        { action, destination },
      )) return true;
      const committed = finishNativeEditing(true, "manual", {
        deferRuntimeRefresh: true,
      });
      if (!committed.ok || committed.frameReloading) return false;
    }
    if (
      readOnlyRef.current
      || !selectedElementHasSourceMutationAuthority()
      || !enableReorderRef.current
    ) return false;
    if (action === "duplicate") {
      const availability = elementCopyAvailabilityForTarget({
        element: selectedElementRef.current,
        sourceIndex: sourceIndexRef.current,
        runtimeGenerated: runtimeGeneratedSelectionRef.current,
        runtimeExpected: Boolean(runtimeFrameRef.current),
        transientBusy: Boolean(
          runtimePromotionRef.current || activeFrameConnectionPendingRef.current
        ),
        isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
        hasRuntimeShadowRoot: currentRuntimeShadowProof(),
      });
      containerRef.current?.setAttribute("data-element-copy-availability", availability);
      if (availability !== "available") return false;
    }
    const sourceIndex = sourceIndexRef.current;
    if (!sourceIndex) return false;
    const liveElement = selectedElementRef.current;
    const logicalSelection = liveElement?.isConnected
      ? selectionForElement(
        liveElement,
        sourceIndex,
        selectedSourceSelectionRef.current ?? undefined,
      )
      : selectedSourceSelectionRef.current;
    if (!logicalSelection) return false;
    try {
      const { operation, mutation } = selectedStructureCommand({
        sourceIndex,
        selection: logicalSelection,
        action,
        destination,
        baseRevision: semanticRevisionRef.current,
      });
      const result = applySourceCommand({
        type: "direct-semantic-operation",
        operation,
      }, mutation);
      if (!result) return false;
      if (action === "delete") clearSelection();
      return true;
    } catch (cause) {
      reportBlockedEdit(cause);
      return false;
    }
  }, [
    applySourceCommand,
    clearSelection,
    currentRuntimeSourceProof,
    currentRuntimeShadowProof,
    finishNativeEditing,
    reportBlockedEdit,
    selectedElementHasSourceMutationAuthority,
  ]);

  const duplicateSelected = useCallback(
    () => applySelectedStructureOperation("duplicate"),
    [applySelectedStructureOperation],
  );

  const deleteSelected = useCallback(
    () => applySelectedStructureOperation("delete"),
    [applySelectedStructureOperation],
  );

  const moveSelectedTo = useCallback((options: {
    parentElementId: string;
    beforeElementId?: string | null;
  }): boolean => applySelectedStructureOperation("move", options), [
    applySelectedStructureOperation,
  ]);

  const insertElement = useCallback((options: {
    parentElementId: string;
    beforeElementId?: string | null;
    html: string;
  }): boolean => {
    if (activeNativeEditRef.current) {
      if (deferNativeCommandRef.current(
        "target-switch",
        () => {
          const committed = finishNativeEditing(true, "manual", {
            deferRuntimeRefresh: true,
          });
          if (committed.ok) window.queueMicrotask(() => insertElement(options));
        },
        options,
      )) return true;
      const committed = finishNativeEditing(true, "manual", {
        deferRuntimeRefresh: true,
      });
      if (!committed.ok || committed.frameReloading) return false;
    }
    if (readOnlyRef.current || !enableReorderRef.current) return false;
    const sourceIndex = sourceIndexRef.current;
    if (!sourceIndex) return false;
    try {
      const { operation, mutation } = insertStructureCommand({
        sourceIndex,
        baseRevision: semanticRevisionRef.current,
        parentElementId: options.parentElementId,
        beforeElementId: options.beforeElementId ?? null,
        html: options.html,
        originalSelection: selectedSourceSelectionRef.current,
      });
      return Boolean(applySourceCommand({
        type: "direct-semantic-operation",
        operation,
      }, mutation));
    } catch (cause) {
      reportBlockedEdit(cause);
      return false;
    }
  }, [applySourceCommand, finishNativeEditing, reportBlockedEdit]);

  const selectInsertionPoint = useCallback(
    (
      point: InsertionPoint,
      requestComment = false,
      fromQueuedCommand = false,
    ): HtmlCanvasSelection => {
      pendingFrameRestoreEpochRef.current += 1;
      if (lockedRef.current) return point.selection;
      if (
        !fromQueuedCommand
        && deferNativeCommandRef.current(
          "target-switch",
          () => selectInsertionPoint(point, requestComment, true),
          { targetId: point.selection.id },
        )
      ) return activeNativeEditRef.current?.target ?? point.selection;
      const committed = finishNativeEditing(true, "manual", {
      });
      if (!committed.ok) return activeNativeEditRef.current?.target ?? point.selection;
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = null;
      selectedSourceSelectionRef.current = null;
      selectedCommentAnchorRef.current = null;
      selectedVisualHintRef.current = null;
      runtimeGeneratedSelectionRef.current = false;
      setRuntimeGeneratedSelection(false);
      activeTextRangeRef.current = null;
      resizeObserverRef.current?.disconnect();
      setOverlayPosition(null);
      setToolbarVisible(false);
      setHasTextRange(false);
      setMoveAvailability({ up: false, down: false });
      setSelection(point.selection);
      onSelectRef.current?.(point.selection);
      requestAnimationFrame(() => updateOverlayPosition());
      if (requestComment) requestCommentForTarget(point.selection);
      return point.selection;
    },
    [finishNativeEditing, requestCommentForTarget, updateOverlayPosition],
  );

  const selectTarget = useCallback(
    (
      target: HtmlCanvasSelection,
      options: {
        reveal?: boolean;
        showToolbar?: boolean;
        visualHint?: HtmlCanvasRuntimeVisualHint | null;
      } = {},
    ): HtmlCanvasSelection | null => {
      pendingFrameRestoreEpochRef.current += 1;
      if (lockedRef.current) return null;
      const documentNode = iframeRef.current?.contentDocument;
      const sourceIndex = sourceIndexRef.current;
      if (!documentNode || !sourceIndex) return null;
      const sourceTarget = target.commentAnchor ?? target;
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      setToolbarVisible(Boolean(options.showToolbar));
      try {
        const resolution = resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(sourceTarget),
        );
        if (sourceTarget.level === "insertion") {
          selectedSourceSelectionRef.current = null;
          if (!resolution.target || resolution.target.type !== "insertion-point") {
            const unresolved = {
              ...sourceTarget,
              resolution: resolution.resolution as HtmlCanvasTargetResolution,
            };
            setSelection(unresolved);
            onSelectRef.current?.(unresolved);
            return unresolved;
          }
          const insertionPoint = insertionPointsRef.current.find(
            (point) => (
              point.selection.sourceAnchor?.startOffset === resolution.target.offset
            ),
          );
          if (!insertionPoint) {
            return { ...sourceTarget, resolution: "orphaned" };
          }
          return selectInsertionPoint({
            ...insertionPoint,
            selection: {
              ...insertionPoint.selection,
              id: sourceTarget.id,
              resolution: resolution.resolution as HtmlCanvasTargetResolution,
            },
          });
        }
        if (!resolution.target || resolution.target.type !== "element") {
          const unresolved = {
            ...sourceTarget,
            resolution: resolution.resolution as HtmlCanvasTargetResolution,
          };
          selectedSourceSelectionRef.current = unresolved;
          setSelection(unresolved);
          onSelectRef.current?.(unresolved);
          return unresolved;
        }
        const elementId = String(resolution.target.pagerootId ?? "");
        const element = elementId
          ? uniqueSourceElement(documentNode, elementId)
          : null;
        if (!element) return {
          ...sourceTarget,
          resolution: "orphaned",
        };
        if (
          options.reveal !== false
          && !isRenderedCommentTarget(element)
        ) {
          activateContainingTab(element);
        }
        const selectedValue = selectionForElement(
          element,
          sourceIndex,
          sourceTarget,
          resolution.resolution as HtmlCanvasTargetResolution,
        );
        const visualHint = options.visualHint ?? target.visualHint ?? null;
        const runtimeFrame = runtimeFrameRef.current;
        const runtimeIsCurrent = Boolean(
          runtimeFrame?.settled
          && runtimeFrame.elementGeneration === frameLoadGenerationRef.current,
        );
        const runtimeVisualTarget = runtimeIsCurrent && visualHint
          ? runtimeVisualTargetForHint(element, visualHint, {
              isProvenSourceElement: currentRuntimeSourceProof(),
            })
          : null;
        if (runtimeVisualTarget && runtimeVisualTarget !== element && visualHint) {
          const runtimeSelection = {
            ...selectionForElement(
              runtimeVisualTarget,
              null,
              undefined,
              "ambiguous",
            ),
            label: visualHint.label,
            commentAnchor: selectedValue,
            visualHint,
          };
          if (options.reveal !== false) {
            element.scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "nearest",
            });
          }
          return selectElement(runtimeVisualTarget, undefined, {
            showToolbar: options.showToolbar,
            runtimeGenerated: true,
            selectionOverride: runtimeSelection,
            commentAnchor: selectedValue,
            visualHint,
          });
        }
        if (visualHint) {
          // A failed runtime match may only fall back to the proven source
          // host's geometry. Keep that selection comment-only so the visual
          // fallback can never grant the host's direct source permissions.
          const runtimeFallbackSelection = {
            ...selectionForElement(
              element,
              null,
              undefined,
              "ambiguous",
            ),
            label: visualHint.label,
            commentAnchor: selectedValue,
            visualHint,
          };
          return selectElement(element, undefined, {
            showToolbar: options.showToolbar,
            runtimeGenerated: true,
            selectionOverride: runtimeFallbackSelection,
            commentAnchor: selectedValue,
            visualHint,
          });
        }
        const sourceSelection = visualHint
          ? { ...selectedValue, visualHint }
          : selectedValue;
        selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
        selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
        selectedElementRef.current = element;
        selectedSourceSelectionRef.current = sourceSelection;
        selectedCommentAnchorRef.current = selectedValue;
        selectedVisualHintRef.current = visualHint;
        element.setAttribute("data-html-canvas-selected", sourceSelection.level);
        const isGlobalPage = isPageRootElement(element) && sourceSelection.level === "module";
        element.toggleAttribute(GLOBAL_SELECTION_ATTRIBUTE, isGlobalPage);
        setSpacingMenuOpen(false);
        runtimeGeneratedSelectionRef.current = false;
        setRuntimeGeneratedSelection(false);
        setSelection(sourceSelection);
        onSelectRef.current?.(sourceSelection);
        updateSelectedStyle();
        updateMoveAvailability();
        observeSelectedElement(element, false);
        if (options.reveal !== false) {
          if (isGlobalPage) {
            const scrollingElement = documentNode.scrollingElement;
            if (scrollingElement) scrollingElement.scrollTop = 0;
            documentNode.documentElement.scrollTop = 0;
            documentNode.body.scrollTop = 0;
            documentNode.defaultView?.scrollTo({
              top: 0,
              left: 0,
              behavior: "auto",
            });
          } else {
            element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          }
        }
        requestAnimationFrame(() => updateOverlayPosition());
        return sourceSelection;
      } catch (cause) {
        reportBlockedEdit(cause);
        return {
          ...sourceTarget,
          resolution: "orphaned",
        };
      }
    },
    [
      observeSelectedElement,
      currentRuntimeSourceProof,
      reportBlockedEdit,
      selectElement,
      selectInsertionPoint,
      updateMoveAvailability,
      updateOverlayPosition,
      updateSelectedStyle,
    ],
  );

  const captureTextRange = useCallback((): ActiveTextRange | null => {
    if (activeNativeEditRef.current) return activeTextRangeRef.current;
    const documentNode = iframeRef.current?.contentDocument;
    const activeRange = documentNode
      ? activeTextRangeFromDocument(documentNode, sourceIndexRef.current)
      : null;
    if (!documentNode || !activeRange?.target.elementId) return null;
    const targetElement = uniqueSourceElement(
      documentNode,
      activeRange.target.elementId,
    );
    if (!targetElement) return null;
    activeTextRangeRef.current = activeRange;
    setHasTextRange(true);
    const selectedValue = selectElement(targetElement, "part", {
      preserveTextSelection: true,
      showToolbar: true,
      selectionOverride: activeRange.target,
    });
    activeTextRangeRef.current = {
      ...activeRange,
      target: selectedValue,
    };
    updateSelectedStyle();
    return activeTextRangeRef.current;
  }, [selectElement, updateSelectedStyle]);

  const installFencedDocumentGuard = useCallback((documentNode: Document) => {
    fencedDocumentCleanupRef.current();
    const stopLateNativeDelivery = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const eventTypes = [
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ] as const;
    eventTypes.forEach((eventType) => {
      documentNode.addEventListener(eventType, stopLateNativeDelivery, true);
    });
    fencedDocumentCleanupRef.current = () => {
      eventTypes.forEach((eventType) => {
        documentNode.removeEventListener(eventType, stopLateNativeDelivery, true);
      });
      fencedDocumentCleanupRef.current = () => undefined;
    };
  }, []);
  installFencedDocumentGuardRef.current = installFencedDocumentGuard;

  const detachNativeEditForFence = useCallback((): NativeEditFenceBookmark | null => {
    const active = activeNativeEditRef.current;
    if (!active) return null;
    const documentNode = active.rootElement.ownerDocument;
    const activeElement = documentNode.activeElement;
    const currentTarget = active.selectionElement.isConnected
      && !nativeEditNeedsReloadRef.current
      ? selectionForElement(
          active.selectionElement,
          sourceIndexRef.current,
          active.target,
          undefined,
          "part",
        )
      : active.target;
    active.target = currentTarget;
    const liveElementId = sourceElementId(active.selectionElement);
    containerRef.current?.setAttribute(
      "data-native-fence-target",
      `${liveElementId ?? "none"}:${
        liveElementId && sourceIndexRef.current?.byPagerootId.has(liveElementId)
          ? "mapped"
          : "missing"
      }:${currentTarget.resolution}`,
    );
    nativeEditFenceSequenceRef.current += 1;
    const bookmark: NativeEditFenceBookmark = {
      fenceId: nativeEditFenceSequenceRef.current,
      target: currentTarget,
      selection: active.session.getSelection(),
      focus: Boolean(
        activeElement === active.rootElement
        || (activeElement && active.rootElement.contains(activeElement)),
      ),
      toolbarVisible: toolbarVisibleRef.current,
    };
    clearNativeEditCheckpointTimer();
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    endRuntimeNativeEdit();
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuard(documentNode);
    active.rootElement.removeAttribute("data-html-canvas-editing");
    active.session.fenceDispose();
    documentNode.getSelection()?.removeAllRanges();
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    return bookmark;
  }, [
    clearNativeEditCheckpointTimer,
    discardPendingNativeCommands,
    endRuntimeNativeEdit,
    installFencedDocumentGuard,
  ]);

  const queueNativeFenceReload = useCallback((
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
    options: { reuseDocument?: boolean } = {},
  ) => {
    nativeEditFenceSequenceRef.current += 1;
    const reuseDocument = options.reuseDocument === true;
    pendingSelectionRef.current = target;
    pendingToolbarVisibleRef.current = target
      ? bookmark?.toolbarVisible ?? toolbarVisibleRef.current
      : false;
    selectedSourceSelectionRef.current = target;
    const currentRuntime = runtimeFrameRef.current;
    const preserveRuntimeActiveFrame = Boolean(
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
    );
    if (!preserveRuntimeActiveFrame) {
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = null;
      resizeObserverRef.current?.disconnect();
      renderedSourceHtmlRef.current = null;
    }
    if (preserveRuntimeActiveFrame) {
      requestDynamicRuntimeRefresh(source);
      return;
    }
    loadFrameSource(source, {
      preserveViewport: true,
      immediate: !reuseDocument,
      reuseDocument,
    });
  }, [loadFrameSource, requestDynamicRuntimeRefresh]);
  queueNativeFenceReloadRef.current = queueNativeFenceReload;

  const currentProjectionHashes = useCallback(() => {
    const workingSourceSha256 = sourceIndexRef.current?.sourceSha256 || "";
    const renderedProjectionSha256 = renderedProjectionSha256Ref.current;
    const renderedProjectionStale = workingSourceSha256 !== renderedProjectionSha256;
    const root = containerRef.current;
    root?.setAttribute("data-working-source-sha256", workingSourceSha256);
    root?.setAttribute("data-rendered-projection-sha256", renderedProjectionSha256);
    root?.setAttribute(
      "data-rendered-projection-stale",
      renderedProjectionStale ? "true" : "false",
    );
    return {
      workingSourceSha256,
      renderedProjectionSha256,
      renderedProjectionStale,
      canvasRenderedSha256: renderedProjectionSha256,
    };
  }, []);

  const checkpointNativeTextIntent = useCallback((
    options: { trigger?: NativeEditCheckpointTrigger } = {},
  ): HtmlCanvasCommitResult => {
    const committed = checkpointNativeEdit(options.trigger ?? "manual");
    return {
      ok: committed.ok,
      html: frameSourceHtmlRef.current,
      ...currentProjectionHashes(),
      pendingMutation: committed.mutation,
      ...(committed.reason ? { reason: committed.reason } : {}),
    };
  }, [checkpointNativeEdit, currentProjectionHashes]);

  const freezeWorkingSource = useCallback((
    options: {
      resumeEditing?: boolean;
      preserveForHistory?: boolean;
      trigger?: NativeEditCheckpointTrigger;
      endBehavior?: "refresh-current-canvas" | "leave-canvas";
    } = {},
  ): HtmlCanvasCommitResult => {
    const resumeEditing = options.resumeEditing ?? false;
    const preserveForHistory = options.preserveForHistory ?? false;
    const endBehavior = options.endBehavior ?? "refresh-current-canvas";
    const committed = checkpointNativeEdit(options.trigger ?? "fence", {
      deferPreviewReconcile: true,
    });
    if (!committed.ok) {
      return {
        ok: false,
        html: frameSourceHtmlRef.current,
        ...currentProjectionHashes(),
        pendingMutation: null,
        ...(committed.reason ? { reason: committed.reason } : {}),
      };
    }

    const settledRuntimeFrameIsCurrent = (): RuntimeFrameContext | null => {
      const current = runtimeFrameRef.current;
      if (
        !current?.settled
        || current.elementGeneration !== frameLoadGenerationRef.current
        || runtimeRefreshPendingRef.current
        || nativeEditNeedsReloadRef.current
        || renderedSourceHtmlRef.current !== frameSourceHtmlRef.current
      ) return null;
      return current;
    };

    const activeRuntimeFrame = settledRuntimeFrameIsCurrent();
    if (
      resumeEditing
      && !preserveForHistory
      && activeNativeEditRef.current
      && activeRuntimeFrame
    ) {
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `retained-runtime:${activeRuntimeFrame.elementGeneration}`,
      );
      return {
        ok: true,
        html: frameSourceHtmlRef.current,
        ...currentProjectionHashes(),
        pendingMutation: committed.mutation,
      };
    }

    const bookmark = detachNativeEditForFence();
    const needsCanonicalFence = Boolean(bookmark)
      || nativeSessionNeedsCanonicalFenceRef.current;
    pendingHistoryBookmarkRef.current = preserveForHistory
      ? bookmark
      : null;
    pendingHistoryCanonicalFenceRef.current = preserveForHistory
      ? needsCanonicalFence
      : false;
    if (endBehavior === "leave-canvas" && !preserveForHistory) {
      pendingFrameRestoreEpochRef.current += 1;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      const sourceProjectionCurrent = Boolean(
        sourceIndexRef.current?.sourceSha256
        && renderedProjectionSha256Ref.current === sourceIndexRef.current.sourceSha256
        && !nativeEditNeedsReloadRef.current,
      );
      if (sourceProjectionCurrent) {
        nativeSessionNeedsCanonicalFenceRef.current = false;
        fencedDocumentCleanupRef.current();
      }
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `leave-canvas:${frameLoadGenerationRef.current}`,
      );
      return {
        ok: true,
        html: frameSourceHtmlRef.current,
        ...currentProjectionHashes(),
        pendingMutation: committed.mutation,
      };
    }
    const detachedRuntimeFrame = settledRuntimeFrameIsCurrent();
    if (detachedRuntimeFrame && !preserveForHistory) {
      // After the session ends, a canonical fence would rebuild before the
      // caller has decided whether source changed. Dispose the mutation-owner
      // guard in place when the current disposable document is still exact.
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      nativeSessionNeedsCanonicalFenceRef.current = false;
      fencedDocumentCleanupRef.current();
      if (!resumeEditing) {
        pendingFrameRestoreEpochRef.current += 1;
        pendingSelectionRef.current = null;
        pendingToolbarVisibleRef.current = false;
      }
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `retained-runtime:${detachedRuntimeFrame.elementGeneration}`,
      );
    } else if (needsCanonicalFence && !preserveForHistory) {
      const target = resumeEditing
        ? bookmark?.target ?? selectedSourceSelectionRef.current
        : null;
      queueNativeFenceReload(
        frameSourceHtmlRef.current,
        resumeEditing ? bookmark : null,
        target,
      );
    } else if (!resumeEditing && !preserveForHistory) {
      pendingFrameRestoreEpochRef.current += 1;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
    }
    return {
      ok: true,
      html: frameSourceHtmlRef.current,
      ...currentProjectionHashes(),
      pendingMutation: committed.mutation,
    };
  }, [
    checkpointNativeEdit,
    currentProjectionHashes,
    detachNativeEditForFence,
    queueNativeFenceReload,
  ]);

  const endNativeTextIntent = useCallback((): HtmlCanvasCommitResult => (
    freezeWorkingSource({ resumeEditing: false })
  ), [freezeWorkingSource]);

  const adoptEditableIslandHistoryInPlace = useCallback((
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
    logicalSelection?: NativeEditSelection,
  ): boolean => {
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const frameView = iframe?.contentWindow;
    const rootElement = selectedElementRef.current;
    const previousIndex = sourceIndexRef.current;
    const previousSource = frameSourceHtmlRef.current;
    if (
      !bookmark
      || !target
      || activeNativeEditRef.current
      || !iframe
      || !documentNode?.documentElement
      || !frameView
      || !rootElement?.isConnected
      || rootElement.ownerDocument !== documentNode
      || !previousIndex
      || previousIndex.source !== previousSource
      || renderedSourceHtmlRef.current !== previousSource
      || containerRef.current?.getAttribute("data-render-verified") !== "true"
    ) return false;

    const viewport = {
      left: frameView.scrollX,
      top: frameView.scrollY,
    };
    try {
      const previousTargetRef = sourceTargetRefForSelection(bookmark.target);
      const nextTargetRef = sourceTargetRefForSelection(target);
      const nextIndex = buildSourceIndex(source);
      if (!adoptCanonicalHistoryIslandInPlace({
        rootElement,
        previousIndex,
        nextIndex,
        previousTargetRef,
        nextTargetRef,
        onSourceChildrenRestored: (elements) => registerRestoredRuntimeElements(rootElement, elements, nextIndex),
      })) return false;

      // The Bridge-validated bytes remain authoritative. This only advances
      // the disposable mounted projection after proving that every byte
      // outside the active editable island is unchanged.
      sourceIndexRef.current = nextIndex;
      frameSourceHtmlRef.current = source;
      latestSourceProjectionRef.current = { source, sourceIndex: nextIndex };
      renderedSourceHtmlRef.current = source;
      renderedProjectionSha256Ref.current = nextIndex.sourceSha256;
      markRuntimeRefreshPending(
        nextIndex.sourceSha256,
        "history-editable-island",
      );
      pendingFrameRestoreEpochRef.current += 1;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      nativeDomGenerationRef.current += 1;
      nativeEditNeedsReloadRef.current = false;
      fencedDocumentCleanupRef.current();
      applyPageViewContextToDocument(
        documentNode,
        source,
        pageViewContextRef.current,
        appliedPageViewContextRef.current,
      );
      appliedPageViewContextRef.current = pageViewContextRef.current;
      const restoredTarget = selectTarget(target, {
        reveal: false,
        showToolbar: bookmark.toolbarVisible,
      });
      if (
        !restoredTarget
        || restoredTarget.resolution === "ambiguous"
        || restoredTarget.resolution === "orphaned"
        || selectedElementRef.current !== rootElement
        || !startEditing(undefined, logicalSelection ?? bookmark.selection)
      ) throw new Error("历史文字结果无法在当前画布恢复编辑目标。");

      frameView.scrollTo({
        left: viewport.left,
        top: viewport.top,
        behavior: "auto",
      });
      containerRef.current?.setAttribute(
        "data-history-adopt-path",
        "editable-island-in-place",
      );
      containerRef.current?.setAttribute("data-render-verified", "true");
      requestAnimationFrame(() => updateOverlayPosition());
      return true;
    } catch {
      containerRef.current?.setAttribute(
        "data-history-adopt-path",
        "frame-reload-fallback",
      );
      return false;
    }
  }, [
    registerRestoredRuntimeElements,
    markRuntimeRefreshPending,
    selectTarget,
    startEditing,
    updateOverlayPosition,
  ]);

  const adoptHistorySource = useCallback((
    source: string,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection | null,
  ): boolean => {
    if (activeNativeEditRef.current) detachNativeEditForFence();
    const abortInFlightCommit = abortInFlightRuntimeCommitRef.current;
    if (abortInFlightCommit) {
      abortInFlightCommit("superseded");
    } else {
      const runtimePromotion = runtimePromotionRef.current;
      if (runtimePromotion) {
        failRuntimeCandidateActivationRef.current(runtimePromotion, "superseded")
          || cancelRuntimeCandidateRef.current(runtimePromotion, "superseded");
      }
    }
    const runtimeCandidate = runtimeCandidateRef.current;
    if (runtimeCandidate) {
      cancelRuntimeCandidateRef.current(runtimeCandidate, "superseded");
    }
    const bookmark = pendingHistoryBookmarkRef.current;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    const resumeTarget = bookmark
      ? target ?? bookmark.target
      : target;
    if (adoptEditableIslandHistoryInPlace(
      source,
      bookmark,
      resumeTarget,
      selection ?? bookmark?.selection,
    )) return true;
    const activeRuntime = runtimeFrameRef.current;
    if (
      activeRuntime?.settled
      && activeRuntime.elementGeneration === frameLoadGenerationRef.current
    ) {
      try {
        const nextIndex = buildSourceIndex(source);
        advanceLastKnownGoodRuntimeProjection(source, nextIndex);
        pendingSelectionRef.current = resumeTarget;
        pendingToolbarVisibleRef.current = Boolean(resumeTarget);
        selectedSourceSelectionRef.current = resumeTarget;
        requestDynamicRuntimeRefresh(source);
        containerRef.current?.setAttribute(
          "data-history-adopt-path",
          "runtime-candidate",
        );
        return true;
      } catch {
        // Without a valid source index the existing fail-closed reload path
        // remains the only safe recovery.
      }
    }
    containerRef.current?.setAttribute(
      "data-history-adopt-path",
      "frame-reload-fallback",
    );
    queueNativeFenceReload(
      source,
      bookmark,
      resumeTarget,
      { reuseDocument: true },
    );
    return true;
  }, [
    advanceLastKnownGoodRuntimeProjection,
    adoptEditableIslandHistoryInPlace,
    detachNativeEditForFence,
    loadFrameSource,
    queueNativeFenceReload,
    requestDynamicRuntimeRefresh,
  ]);

  const cancelHistoryAction = useCallback((
    options: { restore?: boolean } = {},
  ): boolean => {
    const bookmark = pendingHistoryBookmarkRef.current;
    const needsCanonicalFence = pendingHistoryCanonicalFenceRef.current;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    if (!bookmark && !needsCanonicalFence) return false;
    if (options.restore === false) return true;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    queueNativeFenceReload(
      frameSourceHtmlRef.current,
      bookmark,
      bookmark?.target ?? selectedSourceSelectionRef.current,
    );
    return true;
  }, [queueNativeFenceReload]);

  const freezeNow = useCallback((): HtmlCanvasFreezeSnapshot => {
    const committed = freezeWorkingSource({
      resumeEditing: false,
      trigger: "fence",
      endBehavior: "leave-canvas",
    });
    if (!committed.ok) return committed;
    const frozenHtml = committed.html;
    imperativeLockRef.current = true;
    lockedRef.current = true;
    readOnlyRef.current = true;
    enableReorderRef.current = false;
    iframeRef.current?.contentDocument?.documentElement.setAttribute(
      "data-html-canvas-locked",
      "",
    );
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current = null;
    selectedSourceSelectionRef.current = null;
    selectedCommentAnchorRef.current = null;
    selectedVisualHintRef.current = null;
    resizeObserverRef.current?.disconnect();
    setSelection(null);
    setOverlayPosition(null);
    setCommentMarkers([]);
    insertionLayoutAuthorityRef.current = null;
    insertionPointsRef.current = [];
    setMoveAvailability({ up: false, down: false });
    setImperativeLocked(true);
    onSelectRef.current?.(null);
    return {
      ok: true,
      html: frozenHtml,
      workingSourceSha256: committed.workingSourceSha256,
      renderedProjectionSha256: committed.renderedProjectionSha256,
      renderedProjectionStale: committed.renderedProjectionStale,
      canvasRenderedSha256: committed.canvasRenderedSha256,
      pendingMutation: committed.pendingMutation,
    };
  }, [freezeWorkingSource]);

  const unlockNow = useCallback((): boolean => {
    imperativeLockRef.current = false;
    setImperativeLocked(false);
    if (controlledInteractionLocked) return false;
    lockedRef.current = false;
    readOnlyRef.current = effectiveReadOnly;
    enableReorderRef.current = enableReorder;
    iframeRef.current?.contentDocument?.documentElement.removeAttribute(
      "data-html-canvas-locked",
    );
    requestAnimationFrame(() => updateOverlayPosition());
    return true;
  }, [controlledInteractionLocked, effectiveReadOnly, enableReorder, updateOverlayPosition]);

  const showCommitBlocked = useCallback((reason?: string) => {
    setEditFeedback({
      code: "canvas_c12_edit_in_progress",
      title: "当前文字还在处理中",
      message: reason
        || "请点回文字完成输入；已输入的内容仍保留在画布中。",
      tone: "warning",
      sticky: false,
      recovery: "none",
    });
  }, []);

  const applyPageViewContextNow = useCallback((
    nextContext: PageViewContext | null,
  ): boolean => {
    pageViewContextRef.current = nextContext;
    const documentNode = iframeRef.current?.contentDocument;
    if (!documentNode?.documentElement) return false;
    applyPageViewContextToDocument(
      documentNode,
      frameSourceHtmlRef.current,
      nextContext,
      appliedPageViewContextRef.current,
    );
    const changed = appliedPageViewContextRef.current !== nextContext;
    appliedPageViewContextRef.current = nextContext;
    if (changed) documentNode.defaultView?.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => updateOverlayPosition());
    return true;
  }, [updateOverlayPosition]);

  const resolvePagePresentationAction = useCallback((
    target: HtmlCanvasSelection | null,
  ): PagePresentationAction | null => {
    const documentKey = pageViewDocumentKeyRef.current;
    const sourceIndex = sourceIndexRef.current;
    if (
      !target
      || target.level === "insertion"
      || !documentKey
      || !onPageViewContextChangeRef.current
      || lockedRef.current
      || readOnlyRef.current
      || !sourceIndex
      || sourceIndex.source !== frameSourceHtmlRef.current
    ) return null;
    const sourceHtml = frameSourceHtmlRef.current;
    const generation = frameLoadGenerationRef.current;
    const currentContext = pageViewContextRef.current;
    const cached = pagePresentationActionCacheRef.current;
    if (
      cached?.target === target
      && cached.sourceIndex === sourceIndex
      && cached.sourceHtml === sourceHtml
      && cached.documentKey === documentKey
      && cached.generation === generation
      && cached.currentContext === currentContext
    ) return cached.action;
    const action = createPagePresentationAction({
      html: sourceHtml,
      sourceIndex,
      documentKey,
      generation,
      currentContext,
      targetRef: sourceTargetRefForSelection(target),
    });
    pagePresentationActionCacheRef.current = {
      target,
      sourceIndex,
      sourceHtml,
      documentKey,
      generation,
      currentContext,
      action,
    };
    return action;
  }, []);

  const executePagePresentationAction = useCallback((
    target: HtmlCanvasSelection,
    options: { selectTargetAfter?: boolean } = {},
  ): boolean => {
    const perform = (): boolean => {
      if (lockedRef.current || readOnlyRef.current) return false;
      let frameReloading = false;
      if (activeNativeEditRef.current) {
        const committed = finishNativeEditing(true, "manual", {
        });
        if (!committed.ok) return false;
        frameReloading = Boolean(committed.frameReloading);
      }
      const action = resolvePagePresentationAction(target);
      if (!action) return false;
      if (options.selectTargetAfter) {
        if (frameReloading) {
          pendingSelectionRef.current = target;
          pendingToolbarVisibleRef.current = true;
        } else {
          selectTarget(target, { reveal: false, showToolbar: true });
        }
      }
      if (action.isCurrent) {
        requestAnimationFrame(() => updateOverlayPosition());
        return true;
      }
      const documentKey = pageViewDocumentKeyRef.current;
      let accepted = false;
      try {
        accepted = onPageViewContextChangeRef.current?.(
          action.nextContext,
          documentKey,
        ) === true;
      } catch {
        accepted = false;
      }
      if (!accepted) return false;
      applyPageViewContextNow(action.nextContext);
      return true;
    };
    if (
      deferNativeCommandRef.current(
        "presentation-action",
        () => {
          perform();
        },
        { targetId: target.id },
      )
    ) return true;
    return perform();
  }, [
    applyPageViewContextNow,
    finishNativeEditing,
    resolvePagePresentationAction,
    selectTarget,
    updateOverlayPosition,
  ]);

  const api = useMemo<HtmlCanvasEditorHandle>(
    () => ({
      getSourceHtml: () => frameSourceHtmlRef.current,
      getRenderedSourceHtml: () => renderedSourceHtmlRef.current,
      getRenderedFrameGeneration: () => containerRef.current?.getAttribute("data-render-verified") === "true"
        ? frameLoadGenerationRef.current
        : null,
      getRenderedFrameDocument: () => containerRef.current?.getAttribute("data-render-verified") === "true"
        ? iframeRef.current?.contentDocument || null
        : null,
      isCurrentProjectionEditable: () => !readOnlyRef.current
        && !lockedRef.current
        && renderedSourceHtmlRef.current === frameSourceHtmlRef.current
        && containerRef.current?.getAttribute("data-render-verified") === "true",
      rebuildActiveFrame: () => {
        loadFrameSource(frameSourceHtmlRef.current, {
          forceStatic: true,
          preserveViewport: true,
        });
      },
      getScrollTop,
      scrollToTop,
      checkpointNativeTextIntent,
      freezeWorkingSource,
      endNativeTextIntent,
      freezeNow,
      unlockNow,
      showCommitBlocked,
      hasPendingNativeEdit: () => Boolean(
        activeNativeEditRef.current?.session.isDirty()
        || activeNativeEditRef.current?.session.hasPendingDraft()
        || activeNativeEditRef.current?.session.isComposing()
      ),
      clearSelection,
      select: selectTarget,
      startEditing,
      moveSelected,
      duplicateSelected,
      deleteSelected,
      insertElement,
      moveSelectedTo,
      adoptHistorySource,
      cancelHistoryAction,
      deferNativeCommand,
      applyPageViewContext: applyPageViewContextNow,
    }),
    [
      applyPageViewContextNow,
      clearSelection,
      checkpointNativeTextIntent,
      freezeWorkingSource,
      endNativeTextIntent,
      deferNativeCommand,
      freezeNow,
      getScrollTop,
      loadFrameSource,
      deleteSelected,
      duplicateSelected,
      insertElement,
      moveSelected,
      moveSelectedTo,
      adoptHistorySource,
      cancelHistoryAction,
      selectTarget,
      showCommitBlocked,
      scrollToTop,
      startEditing,
      unlockNow,
    ],
  );

  useImperativeHandle(forwardedRef, () => api, [api]);

  useEffect(() => {
    applyPageViewContextNow(pageViewContext);
  }, [applyPageViewContextNow, pageViewContext]);

  useEffect(() => {
    onReady?.(api);
    return () => onReady?.(null);
  }, [api, onReady]);

  useEffect(() => {
    if (!previewAssetsReady) return;
    if (!frameInitializedRef.current) {
      frameInitializedRef.current = true;
      loadFrameSource(html);
      lastSourceReceiptRef.current = sourceReceipt;
      lastPropRef.current = {
        sessionIncarnation: sourceReceipt?.sessionIncarnation ?? null,
        receiptSequence: sourceReceipt?.sequence ?? null,
      };
      return;
    }

    const previous = lastPropRef.current;
    if (!isSourceReceipt(sourceReceipt)) {
      return;
    }
    const receiptSequence = sourceReceipt.sequence;
    const previousReceipt = lastSourceReceiptRef.current;
    const sameSessionIncarnation = Boolean(
      previousReceipt
      && sourceReceipt.sessionIncarnation === previousReceipt.sessionIncarnation,
    );
    if (
      previousReceipt
      && sourceReceipt.sessionIncarnation < previousReceipt.sessionIncarnation
    ) {
      // A rebuilt DocumentSession owns a newer incarnation even when its
      // per-session sequence starts lower. Never let a late prop from an old
      // incarnation replace the current physical frame.
      return;
    }
    if (
      sameSessionIncarnation
      && (
        (previous.receiptSequence !== null && receiptSequence < previous.receiptSequence)
        || (previousReceipt && receiptSequence < previousReceipt.sequence)
      )
    ) {
      // React may deliver an older controlled snapshot after a newer source
      // operation. Receipt order, not HTML bytes, is the source fence.
      return;
    }
    if (sameSessionIncarnation && previousReceipt && receiptSequence === previousReceipt.sequence) {
      if (!sameSourceReceipt(sourceReceipt, previousReceipt)) return;
      lastPropRef.current = {
        sessionIncarnation: sourceReceipt.sessionIncarnation,
        receiptSequence,
      };
      return;
    }
    if (sourceReceipt.origin !== "authority") {
      if (sameSessionIncarnation && previousReceipt && !sameSourceReceiptContext(sourceReceipt, previousReceipt)) return;
      lastSourceReceiptRef.current = sourceReceipt;
      lastPropRef.current = {
        sessionIncarnation: sourceReceipt.sessionIncarnation,
        receiptSequence,
      };
      return;
    }
    lastSourceReceiptRef.current = sourceReceipt;
    lastPropRef.current = {
      sessionIncarnation: sourceReceipt.sessionIncarnation,
      receiptSequence,
    };
    if (activeNativeEditRef.current) detachNativeEditForFence();
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    resetSelection(false);
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    // Workbench-owned authority receipts (adopted Version, disk reload or
    // recovery) retire the current frame. Write the new bytes into static
    // Active first so Canvas verify and edit unlock can finish
    // without waiting for author Script. Hidden Candidates only refresh
    // scripts after that static frame is proven. Same mounted editor keeps a
    // minimal viewport anchor; it must not restore Caret, Range or a native
    // editing session.
    // Any recovery obligation belongs to the replaced source revision. This
    // explicit authority transition supersedes it; unrelated local commands
    // still retain their exact-revision pending work until promotion.
    supersedeRuntimeRefreshPending();
    loadFrameSource(html, { forceStatic: true, preserveViewport: true });
  }, [
    detachNativeEditForFence,
    documentBaseHref,
    html,
    loadFrameSource,
    previewAssetsReady,
    resetSelection,
    supersedeRuntimeRefreshPending,
    sourceReceipt,
  ]);

  useEffect(() => {
    const previousGrant = lastEditRuntimeGrantRef.current;
    lastEditRuntimeGrantRef.current = editRuntimeGrant;
    if (!editRuntimeGrant) {
      if (deferredRuntimeCandidateRef.current?.kind === "dynamic") {
        deferredRuntimeCandidateRef.current = null;
      }
      return;
    }
    if (
      !previewAssetsReady
      || !frameInitializedRef.current
      || (
        previousGrant?.sessionId === editRuntimeGrant.sessionId
        && previousGrant.executionId === editRuntimeGrant.executionId
      )
      || sameRuntimeGrant(runtimeFrameRef.current?.grant, editRuntimeGrant)
    ) return;
    requestDynamicRuntimeRefresh(frameSourceHtmlRef.current);
  }, [editRuntimeGrant, previewAssetsReady, requestDynamicRuntimeRefresh]);

  useEffect(() => {
    const handleWindowResize = () => updateOverlayPosition();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [updateOverlayPosition]);

  useEffect(() => {
    const stage = containerRef.current?.closest(".review-scroll-stage");
    if (!stage) return undefined;
    const handleStageScroll = () => {
      rememberVisibleCanvasViewport({
        container: containerRef.current,
        iframe: iframeRef.current,
        sourceIndex: sourceIndexRef.current,
        destination: lastSameDocumentPresentationAnchorRef,
      });
    };
    stage.addEventListener("scroll", handleStageScroll, { passive: true });
    return () => stage.removeEventListener("scroll", handleStageScroll);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => updateOverlayPosition());
  }, [commentedTargets, updateOverlayPosition]);

  const selectedTargetId = selection?.id ?? null;
  const hasOverlayPosition = overlayPosition !== null;
  useEffect(() => {
    if (!selectedTargetId || !hasOverlayPosition) return;
    requestAnimationFrame(() => updateOverlayPosition());
  }, [hasOverlayPosition, selectedTargetId, updateOverlayPosition]);

  useEffect(() => {
    const documentNode = iframeRef.current?.contentDocument;
    if (!controlledInteractionLocked && imperativeLockRef.current) {
      unlockNow();
      return;
    }
    const shouldLock = controlledInteractionLocked || imperativeLockRef.current;
    lockedRef.current = shouldLock;
    readOnlyRef.current = effectiveReadOnly || shouldLock;
    enableReorderRef.current = enableReorder && !shouldLock;
    // During a frame navigation Chromium can expose a transient Document before
    // its root element exists. Lock synchronization must not abort the React
    // tree while that provisional document is being replaced.
    documentNode?.documentElement?.toggleAttribute("data-html-canvas-locked", shouldLock);
    if (shouldLock) clearSelection(false);
    requestAnimationFrame(() => updateOverlayPosition());
  }, [
    clearSelection,
    controlledInteractionLocked,
    enableReorder,
    effectiveReadOnly,
    unlockNow,
    updateOverlayPosition,
  ]);

  useEffect(() => {
    return () => {
      clearNativeEditCheckpointTimer();
      currentNativeEditLeaseRef.current = null;
      const activeNativeEdit = activeNativeEditRef.current;
      activeNativeEdit?.rootElement.removeAttribute("data-html-canvas-editing");
      activeNativeEdit?.session.fenceDispose();
      activeNativeEditRef.current = null;
      endRuntimeNativeEdit();
      discardPendingNativeCommands("unmounted");
      retainNativeEditFocusRef.current = null;
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      const runtimePromotion = runtimePromotionRef.current;
      runtimePromotionRef.current = null;
      const runtimeCandidate = runtimeCandidateRef.current;
      runtimeCandidateRef.current = null;
      deferredRuntimeCandidateRef.current = null;
      runtimeCandidate?.registrationCleanup();
      runtimeCandidateIframeRef.current = null;
      const previousCleanupFrame = runtimeInactiveCleanupFrameRef.current;
      if (previousCleanupFrame !== null) window.cancelAnimationFrame(previousCleanupFrame);
      runtimeInactiveCleanupFrameRef.current = null;
      runtimeInactiveGenerationRef.current = null;
      const runtimeFrame = runtimeFrameRef.current;
      runtimeFrameRef.current = null;
      runtimeSourceRegistrationCleanupRef.current();
      runtimeSourceElementsRef.current = null;
      if (runtimeFrame && !runtimeFrame.settled) {
        completeRuntimeAttempt(runtimeFrame, "superseded");
      }
      runtimeFrameCoordinatorRef.current!.reset();
      fencedDocumentCleanupRef.current();
      const activeCleanup = cleanupFrameRef.current;
      activeCleanup();
      if (
        runtimePromotion?.retiredSlot
        && runtimePromotion.retiredSlot.cleanupFrame !== activeCleanup
      ) runtimePromotion.retiredSlot.cleanupFrame();
      runtimePromotion?.retiredSlot?.registrationCleanup();
      disposeRuntimeVisualTargetIndex(
        canvasTargetIdentityScopeRef.current.runtimeVisualTargetIndex,
      );
      resizeObserverRef.current?.disconnect();
    };
  }, [
    clearNativeEditCheckpointTimer,
    completeRuntimeAttempt,
    discardPendingNativeCommands,
    endRuntimeNativeEdit,
  ]);

  const connectFrame = useCallback((
    iframe: HTMLIFrameElement,
    connectedFrameGeneration: number,
  ): boolean => {
    if (
      iframe !== iframeRef.current
      || connectedFrameGeneration !== frameLoadGenerationRef.current
    ) return false;
    if (
      connectedFrameRef.current?.iframe === iframe
      && connectedFrameRef.current.generation === connectedFrameGeneration
    ) return true;
    const documentNode = iframe.contentDocument;
    const expectedFrameHtml = expectedFrameHtmlRef.current;
    const expectedToken = expectedFrameTokenRef.current;
    if (!documentNode?.documentElement || !expectedFrameHtml || !expectedToken) {
      renderedSourceHtmlRef.current = null;
      containerRef.current?.setAttribute("data-render-verified", "false");
      return false;
    }
    const marker = documentNode.head.querySelector<HTMLMetaElement>(
      `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
    );
    if (
      !frameDocumentMatchesExpected(
        iframe,
        expectedFrameHtml,
        frameWrittenHtmlRef.current,
      )
      || marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) !== expectedToken
      || marker.getAttribute("content") !== expectedToken
    ) {
      renderedSourceHtmlRef.current = null;
      containerRef.current?.setAttribute("data-render-verified", "false");
      return false;
    }
    const runtimeFrame = runtimeFrameRef.current;
    if (runtimeFrame?.elementGeneration === connectedFrameGeneration) {
      if (runtimeFrame.verificationToken !== expectedToken) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
        return false;
      }
      const runtimeSourceElements = runtimeSourceElementsRef.current;
      if (
        !runtimeActivationUsable(runtimeFrame)
        || !runtimeSourceElements
        || runtimeSourceElements.elementGeneration !== runtimeFrame.elementGeneration
        || runtimeSourceElements.executionId !== runtimeFrame.grant.executionId
      ) return false;
    }
    const promotedCandidate = runtimePromotionRef.current;
    const isRuntimePromotion = Boolean(
      promotedCandidate
      && promotedCandidate.render.elementGeneration === connectedFrameGeneration
      && (
        !promotedCandidate.runtimeFrame
        || promotedCandidate.runtimeFrame === runtimeFrame
      ),
    );
    hoverControllerRef.current?.hide();
    if (!isRuntimePromotion) {
      renderedSourceHtmlRef.current = frameSourceHtmlRef.current;
      renderedProjectionSha256Ref.current = sourceIndexRef.current?.sourceSha256 ?? "";
      containerRef.current?.setAttribute("data-render-verified", "true");
      performance.mark("pageroot:canvas:render-verified", { detail: Object.freeze({ content: runtimeFrame ? "runtime-loaded" : "static-complete" }) });
      fencedDocumentCleanupRef.current();
      if (!runtimeFrame) {
        // A source reload may end in a verified static frame when author
        // preparation fails. Retire the previous frame's read-only fallback
        // here as well; waiting for a dynamic `ready` leaves editing locked.
        publishRuntimeDegradation("none");
        window.requestAnimationFrame(() => replayDeferredRuntimeCandidateRef.current());
      }
    }

    let editorStyle = documentNode.head.querySelector<HTMLStyleElement>(`style[${EDITOR_STYLE_ATTRIBUTE}]`);
    if (!editorStyle) {
      editorStyle = documentNode.createElement("style");
      editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
      editorStyle.textContent = EDITOR_DOCUMENT_STYLES;
      documentNode.head.appendChild(editorStyle);
    }
    documentNode.documentElement.toggleAttribute("data-html-canvas-locked", lockedRef.current);
    applyPageViewContextToDocument(
      documentNode,
      frameSourceHtmlRef.current,
      pageViewContextRef.current,
      null,
    );
    appliedPageViewContextRef.current = pageViewContextRef.current;
    const resolveTargetAtEvent = (event: MouseEvent) => resolveCanvasTarget({
      documentNode,
      eventTarget: event.target,
      point: caretPointFromMouseEvent(event),
      sourceIndex: sourceIndexRef.current,
      enabled: true,
      isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
      generation: nativeDomGenerationRef.current,
      identityScope: canvasTargetIdentityScopeForGeneration(
        nativeDomGenerationRef.current,
      ),
    });
    let pendingHoverPointer: {
      eventTarget: EventTarget | null;
      point: TextCaretPoint;
    } | null = null;
    let pendingHoverFrame: number | null = null;
    const cancelPendingHoverResolution = () => {
      pendingHoverPointer = null;
      if (pendingHoverFrame === null) return;
      documentNode.defaultView?.cancelAnimationFrame(pendingHoverFrame);
      pendingHoverFrame = null;
    };
    const flushPendingHoverResolution = () => {
      pendingHoverFrame = null;
      const pending = pendingHoverPointer;
      pendingHoverPointer = null;
      if (!pending) return;
      if (
        connectedFrameRef.current?.iframe !== iframe
        || connectedFrameRef.current.generation !== connectedFrameGeneration
      ) return;
      hoverControllerRef.current?.update(resolveCanvasTarget({
        documentNode,
        eventTarget: pending.eventTarget,
        point: pending.point,
        sourceIndex: sourceIndexRef.current,
        enabled: true,
        isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
        generation: nativeDomGenerationRef.current,
        identityScope: canvasTargetIdentityScopeForGeneration(
          nativeDomGenerationRef.current,
        ),
      }));
    };
    const scheduleHoverResolution = () => {
      if (pendingHoverFrame !== null) return;
      const frameView = documentNode.defaultView;
      if (!frameView?.requestAnimationFrame) {
        flushPendingHoverResolution();
        return;
      }
      pendingHoverFrame = frameView.requestAnimationFrame(
        flushPendingHoverResolution,
      );
    };
    const isAuthoritativeConnectedDocument = () => (
      iframe === iframeRef.current
      && iframe.contentDocument === documentNode
      && frameLoadGenerationRef.current === connectedFrameGeneration
    );
    const handleClick = (event: MouseEvent) => {
      if (!isAuthoritativeConnectedDocument()) return;
      cancelPendingHoverResolution();
      hoverControllerRef.current?.hide();
      // Authored controls remain selectable/editable content in the Canvas,
      // never live navigation or form controls. Suppress their browser action
      // before the active-edit fast path so a second click cannot navigate the
      // iframe away from the verified source document.
      const nativeActionTarget = findNativeActionTarget(event.target);
      if (nativeActionTarget) event.preventDefault();
      // Clicks always resolve the current DOM and permission proof. Hover is a
      // visual preview only and is never a selection or Option-click authority.
      const resolvedTarget = resolveTargetAtEvent(event);
      if (!resolvedTarget) {
        if (!lockedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection(true);
        }
        return;
      }
      const target = resolvedTarget.targetElement;
      if (lockedRef.current) {
        if (target.closest(
          "a, button, form, input, select, summary, textarea, [contenteditable], [role=\"tab\"], [aria-expanded][aria-controls]",
        )) {
          event.preventDefault();
        }
        return;
      }
      const actionSelection = resolvedTarget.runtimeGenerated
        || !sourceIndexRef.current
        ? null
        : selectionForElement(resolvedTarget.hitElement, sourceIndexRef.current);
      if (
        event.altKey
        && actionSelection
        && resolvePagePresentationAction(actionSelection)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 1) {
          executePagePresentationAction(actionSelection, {
            selectTargetAfter: true,
          });
        }
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
      if (captureTextRange()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectResolvedTarget(resolvedTarget);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (!isAuthoritativeConnectedDocument()) return;
      cancelPendingHoverResolution();
      hoverControllerRef.current?.hide();
      if (findNativeActionTarget(event.target)) event.preventDefault();
      const caretPoint = caretPointFromMouseEvent(event);
      const resolvedTarget = resolveTargetAtEvent(event);
      if (!resolvedTarget) return;
      const target = resolvedTarget.targetElement;
      const dedicatedSurface = findDedicatedSourceSurfaceAtPoint(
        documentNode,
        caretPoint,
      );
      if (resolvedTarget.runtimeGenerated) {
        event.preventDefault();
        event.stopPropagation();
        if (!lockedRef.current) {
          selectResolvedTarget(resolvedTarget);
        }
        return;
      }
      if (
        event.altKey
        && !resolvedTarget.runtimeGenerated
        && sourceIndexRef.current
        && resolvePagePresentationAction(selectionForElement(
          resolvedTarget.hitElement,
          sourceIndexRef.current,
        ))
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
      if (lockedRef.current) return;
      setSpacingMenuOpen(false);
      event.preventDefault();
      event.stopPropagation();
      const editTarget = dedicatedSurface ?? target;
      const sourceIndex = sourceIndexRef.current;
      const islandHostElement = sourceIndex
        ? nativeEditHostForElement(editTarget, sourceIndex)
        : null;
      if (!islandHostElement && !dedicatedSurface) {
        const identifyingRange = identifyingTextRangeAtPoint(
          documentNode,
          editTarget,
          caretPoint,
        );
        if (
          identifyingRange
          && identifyingRange.startContainer.isConnected
          && identifyingRange.endContainer.isConnected
        ) {
          const selection = documentNode.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(identifyingRange);
          captureTextRange();
        } else {
          containerRef.current?.setAttribute(
            "data-native-start-status",
            "direct-text-hit-required",
          );
        }
      }
      selectResolvedTarget(resolvedTarget, {
        preserveTextSelection: Boolean(activeTextRangeRef.current),
      });
      if (dedicatedSurface) return;
      const editingStarted = startEditing(caretPoint);
      if (!editingStarted) selectResolvedTarget(resolvedTarget);
    };

    let disabledButtonPointer:
      | { target: Element; timeStamp: number; x: number; y: number }
      | null = null;
    const handleDisabledButtonPointerDown = (event: PointerEvent) => {
      const eventElement = event.target as Element | null;
      const disabledButton = eventElement?.closest?.("button:disabled");
      if (!disabledButton) {
        disabledButtonPointer = null;
        return;
      }
      const previous = disabledButtonPointer;
      const isSecondPress = Boolean(
        previous
        && previous.target === disabledButton
        && event.timeStamp - previous.timeStamp <= 600
        && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6,
      );
      disabledButtonPointer = isSecondPress
        ? null
        : {
            target: disabledButton,
            timeStamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY,
          };
      if (!isSecondPress) return;
      // Chromium intentionally suppresses click/dblclick for disabled form
      // controls. In the Canvas the authored label is still page text, so the
      // second pointer press must enter the same V2 island path explicitly.
      handleDoubleClick(event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && event.key.toLowerCase() === "e"
      ) {
        event.preventDefault();
        event.stopPropagation();
        onRequestExportRef.current?.();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        // Workbench owns the single native-command deferral and the source-only
        // checkpoint. Deferring here as well would enqueue the same save twice
        // while the editing lease deliberately remains active.
        onRequestFlushRef.current?.();
        return;
      }
      if (!isAuthoritativeConnectedDocument()) return;
      const activeNativeEdit = activeNativeEditRef.current;
      if (activeNativeEdit?.rootElement.contains(event.target as Node)) {
        retainNativeEditFocusRef.current = null;
        const formatShortcut = (
          (event.metaKey || event.ctrlKey)
          && !event.altKey
        )
          ? ({
              b: "bold",
              i: "italic",
              u: "underline",
            } as const)[event.key.toLowerCase() as "b" | "i" | "u"]
          : null;
        if (formatShortcut) {
          event.preventDefault();
          event.stopPropagation();
          applyNativeFormatShortcutRef.current(formatShortcut);
          return;
        }
        const historyDirection = sourceHistoryDirectionForShortcut(event);
        if (historyDirection) {
          event.preventDefault();
          event.stopPropagation();
          onRequestHistoryRef.current?.(historyDirection);
          return;
        }
        if (event.key === "Escape") {
          const compositionWasActive = activeNativeEdit.session.isComposing();
          if (activeNativeEdit.session.consumeCompositionEscape()) {
            // This listener runs in document capture before the authored host.
            // Let a live IME keep the native default, but stop PageRoot from
            // interpreting either the live or trailing Escape as session exit.
            if (!compositionWasActive) event.preventDefault();
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          finishNativeEditing(true);
        }
        return;
      }
      if (
        (event.key === "Enter" || event.key === " ")
        && findNativeActionTarget(event.target)
      ) {
        event.preventDefault();
      }
      if (lockedRef.current) return;
      const historyDirection = sourceHistoryDirectionForShortcut(event);
      if (historyDirection) {
        event.preventDefault();
        event.stopPropagation();
        onRequestHistoryRef.current?.(historyDirection);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection(true);
        return;
      }
      if (
        event.key === "Enter"
        && selectedElementRef.current
        && selectedElementHasSourceMutationAuthority()
      ) {
        event.preventDefault();
        startEditing();
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveSelected("up");
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveSelected("down");
      }
    };

    const handleBeforeInput = (event: InputEvent) => {
      if (!isAuthoritativeConnectedDocument()) return;
      const eventElement = event.target instanceof documentNode.defaultView!.Element
        ? event.target
        : null;
      const insideNativeEdit = Boolean(
        activeNativeEditRef.current?.rootElement.contains(event.target as Node),
      );
      if (
        lockedRef.current
        || (
          !insideNativeEdit
          && Boolean(eventElement?.closest("[contenteditable]"))
        )
      ) event.preventDefault();
    };

    const handleMouseDown = (event: MouseEvent) => {
      cancelPendingHoverResolution();
      hoverControllerRef.current?.hide();
      onInteractionRef.current?.();
      setSpacingMenuOpen(false);
      const toolbarTarget = event.target instanceof Node
        && toolbarRef.current?.contains(event.target);
      if (toolbarTarget) {
        const activeNativeEdit = activeNativeEditRef.current;
        if (activeNativeEdit) {
          const documentSelection = activeNativeEdit.rootElement.ownerDocument.getSelection();
          const liveSelectionIsInside = Boolean(
            documentSelection?.anchorNode
            && documentSelection.focusNode
            && (
              documentSelection.anchorNode === activeNativeEdit.rootElement
              || activeNativeEdit.rootElement.contains(documentSelection.anchorNode)
            )
            && (
              documentSelection.focusNode === activeNativeEdit.rootElement
              || activeNativeEdit.rootElement.contains(documentSelection.focusNode)
            )
          );
          const retained = retainNativeEditFocusRef.current;
          const retainedIsCurrent = Boolean(
            retained
            && retained.session === activeNativeEdit.session
            && retained.targetId === activeNativeEdit.target.id
            && nativeEditLeasesMatch(retained.lease, activeNativeEdit.lease),
          );
          if (retained && !retainedIsCurrent) return;
          const selection = retained && retainedIsCurrent
            ? retained.selection
            : liveSelectionIsInside
              ? activeNativeEdit.session.getSelection()
              : activeNativeEdit.selection;
          retainNativeEditFocusRef.current = {
            session: activeNativeEdit.session,
            lease: { ...activeNativeEdit.lease },
            targetId: activeNativeEdit.target.id,
            selection: { ...selection },
            textRange: cloneActiveTextRange(
              activeTextRangeRef.current,
              activeNativeEdit.target,
            ),
          };
          const targetElement = event.target instanceof Element
            ? event.target
            : event.target instanceof Node
              ? event.target.parentElement
              : null;
          if (
            targetElement?.closest(
              "button[data-native-format-focus='preserve']",
            )
          ) event.preventDefault();
          const nativeActionTarget = findNativeActionTarget(event.target);
          if (
            nativeActionTarget
            && ["INPUT", "SELECT", "TEXTAREA"].includes(nativeActionTarget.tagName)
          ) event.preventDefault();
        }
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) {
        retainNativeEditFocusRef.current = null;
        return;
      }
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      const nativeActionTarget = findNativeActionTarget(event.target);
      if (nativeActionTarget && ["INPUT", "SELECT", "TEXTAREA"].includes(nativeActionTarget.tagName)) {
        event.preventDefault();
      }
    };

    const handleMouseUp = () => {
      if (!lockedRef.current) captureTextRange();
    };

    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleLockedTransfer = (event: ClipboardEvent | DragEvent) => {
      if (lockedRef.current) event.preventDefault();
    };

    const handleScroll = () => {
      cancelPendingHoverResolution();
      hoverControllerRef.current?.hide();
      updateOverlayPosition();
    };
    const handlePointerMove = (event: PointerEvent) => {
      hoverHintPointerInsideRef.current = false;
      if (
        event.buttons !== 0
        || lockedRef.current
        || readOnlyRef.current
        || !pointerCapabilityHoverEnabledRef.current
        || activeNativeEditRef.current
      ) {
        cancelPendingHoverResolution();
        hoverControllerRef.current?.hide();
        return;
      }
      pendingHoverPointer = {
        eventTarget: event.target,
        point: caretPointFromMouseEvent(event),
      };
      scheduleHoverResolution();
    };
    const handlePointerLeave = () => {
      cancelPendingHoverResolution();
      // The caption is rendered outside the iframe. Let its pointer-enter
      // event win the transition from the iframe before hiding the hover
      // chrome, otherwise an outside caption cannot be clicked.
      globalThis.setTimeout(() => {
        if (!hoverHintPointerInsideRef.current) hoverControllerRef.current?.hide();
      }, 0);
    };
    const LayoutResizeObserver = documentNode.defaultView?.ResizeObserver;
    const layoutObserver = LayoutResizeObserver
      ? new LayoutResizeObserver(() => updateOverlayPosition())
      : null;
    if (documentNode.body) layoutObserver?.observe(documentNode.body);
    documentNode.addEventListener("click", handleClick, true);
    documentNode.addEventListener("mousedown", handleMouseDown, true);
    documentNode.addEventListener("mouseup", handleMouseUp, true);
    documentNode.addEventListener(
      "pointerdown",
      handleDisabledButtonPointerDown,
      true,
    );
    documentNode.addEventListener("pointermove", handlePointerMove, true);
    documentNode.addEventListener("pointerleave", handlePointerLeave, true);
    documentNode.addEventListener("dblclick", handleDoubleClick, true);
    documentNode.addEventListener("beforeinput", handleBeforeInput, true);
    documentNode.addEventListener("paste", handleLockedTransfer, true);
    documentNode.addEventListener("drop", handleLockedTransfer, true);
    documentNode.addEventListener("submit", handleSubmit, true);
    documentNode.addEventListener("keydown", handleKeyDown, true);
    documentNode.addEventListener("scroll", handleScroll, true);
    iframe.addEventListener("pointerleave", handlePointerLeave);

    const pendingSelection = pendingSelectionRef.current;
    const pendingToolbarVisible = pendingToolbarVisibleRef.current;
    const pendingViewport = pendingFrameViewportRef.current;
    const pendingSharedViewport = pendingSharedViewportRef.current;
    const pendingStaticAnchor = pendingStaticPresentationAnchorRef.current;
    const pendingRestoreEpoch = pendingFrameRestoreEpochRef.current;
    const sharedScrollElementForHandoff = isRuntimePromotion
      ? pendingSharedViewport?.element ?? null
      : null;
    const handleSharedScroll = () => {
      updateOverlayPosition();
    };
    sharedScrollElementForHandoff?.addEventListener("scroll", handleSharedScroll);

    cleanupFrameRef.current = () => {
      cancelPendingHoverResolution();
      documentNode.removeEventListener("click", handleClick, true);
      documentNode.removeEventListener("mousedown", handleMouseDown, true);
      documentNode.removeEventListener("mouseup", handleMouseUp, true);
      documentNode.removeEventListener(
        "pointerdown",
        handleDisabledButtonPointerDown,
        true,
      );
      documentNode.removeEventListener("pointermove", handlePointerMove, true);
      documentNode.removeEventListener("pointerleave", handlePointerLeave, true);
      iframe.removeEventListener("pointerleave", handlePointerLeave);
      documentNode.removeEventListener("dblclick", handleDoubleClick, true);
      documentNode.removeEventListener("beforeinput", handleBeforeInput, true);
      documentNode.removeEventListener("paste", handleLockedTransfer, true);
      documentNode.removeEventListener("drop", handleLockedTransfer, true);
      documentNode.removeEventListener("submit", handleSubmit, true);
      documentNode.removeEventListener("keydown", handleKeyDown, true);
      documentNode.removeEventListener("scroll", handleScroll, true);
      layoutObserver?.disconnect();
      sharedScrollElementForHandoff?.removeEventListener("scroll", handleSharedScroll);
      if (
        connectedFrameRef.current?.iframe === iframe
        && connectedFrameRef.current.generation === connectedFrameGeneration
      ) connectedFrameRef.current = null;
    };
    connectedFrameRef.current = {
      iframe,
      generation: connectedFrameGeneration,
    };
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    pendingFrameViewportRef.current = null;
    pendingSharedViewportRef.current = null;
    pendingStaticPresentationAnchorRef.current = null;
    const positionRuntimeHandoff = (candidate: RuntimeCandidate) => {
      const anchor = candidate.handoffContext.presentationAnchor;
      const isCurrent = () => (
        runtimePromotionRef.current === candidate
        && runtimeFrameCoordinatorRef.current!.snapshot.latestCandidate?.candidateId
          === candidate.attempt.candidateId
        && iframe === iframeRef.current
        && iframe.contentDocument === documentNode
        && frameLoadGenerationRef.current === connectedFrameGeneration
        && expectedFrameTokenRef.current === expectedToken
        && containerRef.current?.getAttribute("data-runtime-handoff") === "positioning"
      );
      const restoreLogicalSelection = () => {
        if (!pendingSelection || lockedRef.current) return;
        selectTarget(pendingSelection, {
          reveal: false,
          showToolbar: pendingToolbarVisible,
        });
      };
      const readingAnchorElement = () => runtimeSourceElementForStableId(
        documentNode,
        sourceIndexRef.current,
        anchor.viewportAnchorStableId,
      );
      const restoreReadingLocation = () => {
        const outer = containerRef.current?.closest<HTMLElement>(".review-scroll-stage");
        applyReadingPosition({
          iframe,
          documentNode,
          outer,
          anchor,
          anchorElement: readingAnchorElement(),
          adjustOuter: true,
        });
      };
      const activateHandoff = () => {
        if (!isCurrent()) return;
        const connectedRuntimeFrame = runtimeFrameRef.current;
        let settlementAccepted = false;
        if (
          connectedRuntimeFrame?.elementGeneration === connectedFrameGeneration
          && runtimeActivationUsable(connectedRuntimeFrame)
        ) {
          if (!runtimeReadyReportedRef.current.has(connectedRuntimeFrame)) {
            const settlement = completeRuntimeAttempt(connectedRuntimeFrame, "ready");
            settlementAccepted = settlement.accepted;
            if (settlementAccepted) runtimeReadyReportedRef.current.add(connectedRuntimeFrame);
          }
        } else if (candidate.attempt.kind === "static-disabled") {
          const settlement = runtimeFrameCoordinatorRef.current!.settle(
            candidate.attempt,
            "ready",
          );
          settlementAccepted = settlement.accepted;
          if (settlementAccepted) publishRuntimeDegradation("static-visible");
        }
        if (!settlementAccepted) {
          abortInFlightRuntimeCommitRef.current?.("superseded");
          return;
        }
        restoreLogicalSelection();
        // Keyboard focus follows the accepted Canvas slot, never the hidden
        // Candidate. Do not steal focus from a comment/composer or recreate a
        // native caret, and never let focus itself scroll the shared stage.
        if (candidate.handoffContext.restoreCanvasFocus) {
          iframe.focus({ preventScroll: true });
        }
        flushSync(() => {
          renderedSourceHtmlRef.current = frameSourceHtmlRef.current;
          renderedProjectionSha256Ref.current = sourceIndexRef.current?.sourceSha256 ?? "";
          containerRef.current?.setAttribute("data-render-verified", "true");
          performance.mark("pageroot:canvas:render-verified", {
            detail: Object.freeze({ content: "runtime-loaded" }),
          });
          containerRef.current?.setAttribute(
            "data-runtime-bootstrap-count",
            String(documentNode.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length),
          );
          containerRef.current?.setAttribute("data-runtime-handoff", "active");
          updateOverlayPosition({ allowRuntimeHandoff: true });
        });
        // Selection/toolbars and the accepted Runtime's published height can
        // change the final outer geometry. Correct the same captured anchor
        // after those derived states flush, but before this task can paint the
        // new Active over the retained previous frame.
        const outer = containerRef.current?.closest<HTMLElement>(".review-scroll-stage");
        correctReadingPositionOnce({
          iframe,
          documentNode,
          outer,
          anchor,
          anchorElement: readingAnchorElement(),
          adjustOuter: true,
        });
        fencedDocumentCleanupRef.current();
        activeFrameConnectionPendingRef.current = false;
        finalizeRuntimePromotionRef.current(candidate);
      };
      scheduleWhenReady({
        isCurrent,
        isReady: () => {
          const outer = containerRef.current?.closest<HTMLElement>(".review-scroll-stage");
          return frameScrollMetricsReady(iframe, documentNode)
            && outerScrollMetricsReady(outer, anchor.outerScrollTop);
        },
        remainingFrames: 2,
        onReady: () => {
          restoreReadingLocation();
          requestAnimationFrame(() => {
            if (!isCurrent()) return;
            activateHandoff();
          });
        },
      });
    };
    const restoreConnectedFrame = () => {
      if (
        iframe.contentDocument !== documentNode
        || frameLoadGenerationRef.current !== connectedFrameGeneration
        || expectedFrameTokenRef.current !== expectedToken
        || pendingFrameRestoreEpochRef.current !== pendingRestoreEpoch
      ) return;
      const isRestoreCurrent = () => (
        iframe.contentDocument === documentNode
        && frameLoadGenerationRef.current === connectedFrameGeneration
        && expectedFrameTokenRef.current === expectedToken
        && pendingFrameRestoreEpochRef.current === pendingRestoreEpoch
      );
      if (pendingViewport) {
        documentNode.defaultView?.scrollTo({
          left: pendingViewport.left,
          top: pendingViewport.top,
          behavior: "auto",
        });
      }
      const staticAnchor = pendingStaticAnchor;
      const outer = pendingSharedViewport?.element
        ?? containerRef.current?.closest<HTMLElement>(".review-scroll-stage")
        ?? null;
      const readingAnchor = staticAnchor ?? (
        pendingSharedViewport
          ? {
              iframeScrollLeft: pendingViewport?.left ?? 0,
              iframeScrollTop: pendingViewport?.top ?? 0,
              viewportAnchorScreenOffsetY: null,
              outerScrollLeft: pendingSharedViewport.left,
              outerScrollTop: pendingSharedViewport.top,
            }
          : null
      );
      const restoreReadingLocation = () => {
        if (!isRestoreCurrent() || !readingAnchor) return;
        const anchorElement = staticAnchor
          ? runtimeSourceElementForStableId(
              documentNode,
              sourceIndexRef.current,
              staticAnchor.viewportAnchorStableId,
            )
          : null;
        applyReadingPosition({
          iframe,
          documentNode,
          outer,
          anchor: readingAnchor,
          anchorElement,
          adjustOuter: true,
        });
        correctReadingPositionOnce({
          iframe,
          documentNode,
          outer,
          anchor: readingAnchor,
          anchorElement,
          adjustOuter: true,
        });
        rememberVisibleCanvasViewport({
          container: containerRef.current,
          iframe,
          sourceIndex: sourceIndexRef.current,
          destination: lastSameDocumentPresentationAnchorRef,
        });
      };
      if (readingAnchor) {
        applyReadingPosition({
          iframe,
          documentNode,
          outer: null,
          anchor: readingAnchor,
          anchorElement: staticAnchor
            ? runtimeSourceElementForStableId(
                documentNode,
                sourceIndexRef.current,
                staticAnchor.viewportAnchorStableId,
              )
            : null,
          adjustOuter: false,
        });
        if (outerScrollMetricsReady(outer, readingAnchor.outerScrollTop)) {
          restoreReadingLocation();
        } else {
          scheduleWhenReady({
            isCurrent: isRestoreCurrent,
            isReady: () => outerScrollMetricsReady(outer, readingAnchor.outerScrollTop),
            onReady: restoreReadingLocation,
          });
        }
      } else {
        rememberVisibleCanvasViewport({
          container: containerRef.current,
          iframe,
          sourceIndex: sourceIndexRef.current,
          destination: lastSameDocumentPresentationAnchorRef,
        });
      }
      const connectedRuntimeFrame = runtimeFrameRef.current;
      const connectedRuntimeFrameIsCurrent = Boolean(
        connectedRuntimeFrame?.elementGeneration === connectedFrameGeneration
        && connectedRuntimeFrame.verificationToken === expectedToken,
      );
      if (connectedRuntimeFrameIsCurrent && connectedRuntimeFrame) {
        if (!runtimeActivationUsable(connectedRuntimeFrame)) return;
        connectedRuntimeFrame.settled = true;
        containerRef.current?.setAttribute(
          "data-runtime-bootstrap-count",
          String(documentNode.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length),
        );
      }
      if (pendingSelection && !lockedRef.current) {
        selectTarget(pendingSelection, {
          reveal: false,
          showToolbar: pendingToolbarVisible,
        });
      } else {
        updateOverlayPosition();
      }
      if (
        connectedRuntimeFrameIsCurrent
        && connectedRuntimeFrame
        && runtimeActivationUsable(connectedRuntimeFrame)
      ) {
        if (!runtimeReadyReportedRef.current.has(connectedRuntimeFrame)) {
          const settlement = completeRuntimeAttempt(connectedRuntimeFrame, "ready");
          if (settlement.accepted) {
            runtimeReadyReportedRef.current.add(connectedRuntimeFrame);
          }
        }
        activeFrameConnectionPendingRef.current = false;
      } else if (
        runtimeFrameRef.current?.elementGeneration !== connectedFrameGeneration
      ) {
        activeFrameConnectionPendingRef.current = false;
      }
    };
    if (isRuntimePromotion && promotedCandidate) {
      positionRuntimeHandoff(promotedCandidate);
    } else {
      requestAnimationFrame(restoreConnectedFrame);
    }
    return true;
  }, [
    canvasTargetIdentityScopeForGeneration,
    captureTextRange,
    clearSelection,
    completeRuntimeAttempt,
    currentRuntimeSourceProof,
    executePagePresentationAction,
    finishNativeEditing,
    moveSelected,
    publishRuntimeDegradation,
    resolvePagePresentationAction,
    selectResolvedTarget,
    selectTarget,
    selectedElementHasSourceMutationAuthority,
    startEditing,
    updateOverlayPosition,
    fallBackToStaticRuntimeFrame,
  ]);
  connectFrameRef.current = connectFrame;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const connectedFrameGeneration = frameRender.elementGeneration;
    let animationFrame = 0;
    let attempts = 0;
    const startedAt = performance.now();
    const connectParsedFrame = () => {
      if (
        iframe !== iframeRef.current
        || connectedFrameGeneration !== frameLoadGenerationRef.current
      ) return;
      const documentNode = iframe.contentDocument;
      const expectedFrameHtml = expectedFrameHtmlRef.current;
      const expectedToken = expectedFrameTokenRef.current;
      const marker = documentNode?.head?.querySelector<HTMLMetaElement>(
        `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
      );
      const runtimeFrame = runtimeFrameRef.current;
      if (
        (
          runtimeFrame?.elementGeneration !== connectedFrameGeneration
          || activeFrameConnectionPendingRef.current
        )
        &&
        documentNode?.documentElement
        && expectedFrameHtml
        && expectedToken
        && frameDocumentMatchesExpected(
          iframe,
          expectedFrameHtml,
          frameWrittenHtmlRef.current,
        )
        && marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) === expectedToken
        && marker.getAttribute("content") === expectedToken
      ) {
        // Static documents can connect after parsing. Runtime documents wait
        // for iframe load so native script ordering and deferred work settle
        // according to browser semantics rather than a PageRoot paint probe.
        if (connectFrame(iframe, connectedFrameGeneration)) {
          return;
        }
      }
      if (
        runtimeFrame?.elementGeneration === connectedFrameGeneration
        && !runtimeFrame.settled
        && performance.now() - startedAt >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
      ) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "failed");
        return;
      }
      attempts += 1;
      const retryLimit = runtimeFrame?.elementGeneration === connectedFrameGeneration
        && !runtimeFrame.settled
        ? Math.ceil(EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs / 16) + 30
        : 120;
      if (attempts < retryLimit) {
        animationFrame = requestAnimationFrame(connectParsedFrame);
      }
    };
    animationFrame = requestAnimationFrame(connectParsedFrame);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    connectFrame,
    fallBackToStaticRuntimeFrame,
    frameRender.elementGeneration,
    frameRender.html,
  ]);

  useEffect(() => {
    const candidate = runtimeCandidateRef.current;
    const candidateRender = runtimeCandidateRender;
    if (
      !candidate
      || !candidateRender
      || candidate.render.elementGeneration !== candidateRender.elementGeneration
      || candidate.render.html !== candidateRender.html
    ) return undefined;
    let animationFrame = 0;
    let staticAttempts = 0;
    let phaseStartedAt = performance.now();
    let observedActivation = candidate.runtimeFrame?.activation ?? null;
    const connectParsedCandidate = () => {
      const current = runtimeCandidateRef.current;
      const iframe = runtimeCandidateIframeRef.current;
      if (
        current !== candidate
        || !runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
        || !iframe
        || candidate.render.elementGeneration !== candidateRender.elementGeneration
      ) return;
      if (runtimeFrameCoordinatorRef.current!.snapshot.nativeEdit?.kind === "user") {
        // A browser-native edit transaction owns the active Document until its
        // checkpoint has produced complete source HTML. Candidate readiness is
        // allowed to wait, but its deadline must not charge time to the user.
        phaseStartedAt = performance.now();
        observedActivation = candidate.runtimeFrame?.activation ?? null;
        animationFrame = requestAnimationFrame(connectParsedCandidate);
        return;
      }
      const currentActivation = candidate.runtimeFrame?.activation ?? null;
      if (currentActivation !== observedActivation) {
        const activationSettledAt = candidate.runtimeFrame?.activationSettledAt
          ?? performance.now();
        if (
          candidate.runtimeFrame
          && observedActivation === "pending"
          && currentActivation !== "pending"
          && activationSettledAt - phaseStartedAt
            >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
        ) {
          containerRef.current?.setAttribute("data-runtime-activation-budget", "exceeded");
        }
        observedActivation = currentActivation;
        phaseStartedAt = activationSettledAt;
      }
      const runtimeDeadlineMs = currentActivation === "pending"
        ? EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
        : EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs;
      const waitExceededDeadline = Boolean(
        candidate.runtimeFrame
        && !candidate.runtimeFrame.settled
        && performance.now() - phaseStartedAt >= runtimeDeadlineMs
      );
      if (waitExceededDeadline) {
        containerRef.current?.setAttribute(
          currentActivation === "pending"
            ? "data-runtime-activation-budget"
            : "data-runtime-surface-budget",
          "exceeded",
        );
      }
      if (connectRuntimeCandidateRef.current(
        iframe,
        candidateRender.elementGeneration,
      )) return;
      if (waitExceededDeadline) {
        failRuntimeCandidate(candidate, "failed");
        return;
      }
      if (candidate.runtimeFrame) {
        animationFrame = requestAnimationFrame(connectParsedCandidate);
        return;
      }
      staticAttempts += 1;
      if (staticAttempts < 120) {
        animationFrame = requestAnimationFrame(connectParsedCandidate);
        return;
      }
      failRuntimeCandidate(candidate, "failed");
    };
    animationFrame = requestAnimationFrame(connectParsedCandidate);
    return () => cancelAnimationFrame(animationFrame);
  }, [failRuntimeCandidate, runtimeCandidateRender]);

  const applyInlineStyle = useCallback(
    (
      property: EditableStyleProperty,
      value: string,
      fromQueuedCommand = false,
    ) => {
      let element = selectedElementRef.current;
      if (readOnlyRef.current || !selectedElementHasSourceMutationAuthority() || !element) return;
      const config = STYLE_PROPERTY_CONFIGS.find((entry) => entry.property === property);
      if (!config) return;
      let activeNativeEdit = activeNativeEditRef.current;
      if (
        activeNativeEdit
        && !fromQueuedCommand
        && deferNativeCommandRef.current(
          "format",
          () => applyInlineStyle(property, value, true),
          { selection: activeNativeEdit.session.getSelection(), property, value },
        )
      ) return;
      if (activeNativeEdit) {
        if (!restoreNativeEditSelectionForCommand(activeNativeEdit)) {
          reportBlockedEdit(new Error(
            "当前文字选择已失效，请重新选择文字后再修改格式。",
          ));
          return;
        }
        const checkpoint = checkpointNativeEdit("style");
        if (!checkpoint.ok) return;
        activeNativeEdit = activeNativeEditRef.current;
        if (!activeNativeEdit) return;
        element = selectedElementRef.current;
        if (
          !element
          || !element.isConnected
          || element !== activeNativeEdit.selectionElement
        ) {
          reportBlockedEdit(new Error(
            "格式提交后的文字宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
        refreshNativeEditRangeState(
          activeNativeEdit,
          activeNativeEdit.session.getSelection(),
        );
      }
      const activeRange = activeTextRangeRef.current;
      let resumeNativeEditAfterStyle = false;
      let nativeSelectionAfterStyle: NativeEditSelection | undefined;
      if (
        activeNativeEdit
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
        && !activeRange
      ) {
        reportBlockedEdit(new Error("请先在编辑中的文字里选择具体范围，再修改文字格式。"));
        return;
      }
      if (
        activeNativeEdit
        && activeRange
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
      ) {
        if (!activeNativeEdit.session.canApplyInlineStyle()) {
          reportBlockedEdit(new Error("当前选区无法安全应用这个文字格式。"));
          return;
        }
        nativeSelectionAfterStyle = activeNativeEdit.session.getSelection();
        // Text-range formatting is a semantic source operation because it may
        // allocate persistent wrapper identities. Retire only the transient
        // native host, validate the Kernel result before publication in this
        // same iframe, then resume the exact range without running author Script.
        const committed = finishNativeEditing(true, "style", {
          deferRuntimeRefresh: true,
        });
        if (!committed.ok || committed.frameReloading) return;
        resumeNativeEditAfterStyle = true;
        activeNativeEdit = null;
        element = selectedElementRef.current;
        if (!element || !element.isConnected) {
          reportBlockedEdit(new Error(
            "文字提交后的宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
      }
      if (
        activeNativeEdit
        && !(activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property))
      ) {
        nativeSelectionAfterStyle = activeNativeEdit.session.getSelection();
        const committed = finishNativeEditing(true, "style", {
          deferRuntimeRefresh: true,
        });
        if (!committed.ok || committed.frameReloading) return;
        resumeNativeEditAfterStyle = true;
        activeNativeEdit = null;
        element = selectedElementRef.current;
        if (!element || !element.isConnected) {
          reportBlockedEdit(new Error(
            "文字提交后的宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
      }
      const resumeRejectedNativeStyle = () => {
        if (!resumeNativeEditAfterStyle) return false;
        const resumed = Boolean(startEditing(undefined, nativeSelectionAfterStyle));
        containerRef.current?.setAttribute(
          "data-native-format-resume",
          `rejected:requested:${resumed ? "resumed" : "not-resumed"}`,
        );
        if (resumed && activeNativeEditRef.current) {
          rememberNativeEditSelection(activeNativeEditRef.current);
        } else if (!resumed) {
          reportBlockedEdit(new Error(
            "格式修改已停止，但原文字选区无法恢复。",
          ));
        }
        return resumed;
      };
      if (activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)) {
        const sourceIndex = sourceIndexRef.current;
        if (!sourceIndex) {
          resumeRejectedNativeStyle();
          return;
        }
        const styleTargets = activeRange.styleElements.filter(
          (candidate) => candidate.isConnected,
        );
        const styleTarget = styleTargets[0] || element;
        const verifiedOverride = verifyInlineStyleOverrideForTargets(
          styleTargets.length > 0 ? styleTargets : [styleTarget],
          config.cssProperty,
          value,
          activeNativeEdit,
        );
        if (!verifiedOverride) {
          reportInlineStyleOverrideFailure();
          resumeRejectedNativeStyle();
          return;
        }
        const beforeFacts = inlineStyleFacts(styleTarget, config.cssProperty);
        let operation: SemanticOperation;
        try {
          operation = textRangeStyleOperation(sourceIndex, {
            elementId: activeRange.target.elementId || "",
            baseRevision: semanticRevisionRef.current,
            segments: activeRange.segments,
            property: config.cssProperty,
            value,
            important: verifiedOverride.priority === "important",
          });
        } catch (cause) {
          reportBlockedEdit(cause);
          resumeRejectedNativeStyle();
          return;
        }
        const mutation: HtmlCanvasMutation = {
          kind: "style",
          target: activeRange.target,
          property,
          before: beforeFacts,
          after: {
            inlineValue: value,
            inlinePriority: verifiedOverride.priority,
            computedValue: verifiedOverride.computedValue,
          },
        };
        let unchanged = false;
        const styled = applySourceCommand({
          type: "direct-semantic-operation",
          operation,
        }, mutation, {
          onUnchanged: () => { unchanged = true; },
          validateResult: (candidate) => {
            const createsRangeWrapper = textRangeStyleCreatesWrapper(candidate);
            const sourceTextParents = createsRangeWrapper
              ? sourceTextParentsForSegments(element, activeRange.segments, sourceIndex)
              : [];
            if (createsRangeWrapper && !sourceTextParents) {
              throw new Error(
                "当前文字的布局节点与源码映射不完整，本次格式修改已阻止。",
              );
            }
            const hasFlexOrGridTextParent = sourceTextParents?.some((parent) => (
              ["flex", "inline-flex", "grid", "inline-grid"].includes(
                parent.ownerDocument.defaultView?.getComputedStyle(parent).display || "",
              )
            ));
            if (createsRangeWrapper && hasFlexOrGridTextParent) {
              throw new Error(
                "选区的直接文字容器使用 flex/grid，新包装会改变间距；本次格式修改已阻止。请选择已有的完整样式片段。",
              );
            }
            if (createsRangeWrapper && property === "backgroundColor") {
              throw new Error(
                "局部填充色需要新增可见盒子，可能改变原页间距；本次修改已阻止。选中已有完整样式片段时仍可修改。",
              );
            }
            const expectedTargetId = activeNativeEdit?.rootTargetRef.targetId
              ?? activeRange.target.id;
            const operationTargetRef = [
              ...candidate.refreshedTargetRefs,
              ...candidate.refreshedTrackedTargetRefs,
            ].find(
              (targetRef: SourceTargetRef) => targetRef.targetId === expectedTargetId,
            );
            if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
              throw new Error("文字宿主无法在格式 Patch 后精确重绑，已停止提交。");
            }
            buildSourceTextMap(
              candidate.sourceIndex,
              operationTargetRef,
              { allowEmpty: true },
            );
          },
        });
        if (!styled && !unchanged) {
          resumeRejectedNativeStyle();
          return;
        }
        const resumed = Boolean(
          (styled || unchanged)
          && resumeNativeEditAfterStyle
          && startEditing(undefined, nativeSelectionAfterStyle)
        );
        containerRef.current?.setAttribute(
          "data-native-format-resume",
          `${styled ? "source" : unchanged ? "unchanged" : "rejected"}:${
            resumeNativeEditAfterStyle ? "requested" : "not-requested"
          }:${resumed ? "resumed" : "not-resumed"}`,
        );
        if (resumed && activeNativeEditRef.current) {
          rememberNativeEditSelection(activeNativeEditRef.current);
        }
        if (styled && resumeNativeEditAfterStyle && !resumed) {
          reportBlockedEdit(new Error(
            "文字格式已写入源码，但当前编辑选择无法在原画布继续。",
          ));
        }
        return;
      }
      const target = selectionForElement(element, sourceIndexRef.current);
      const beforeFacts = inlineStyleFacts(element, config.cssProperty);
      const verifiedOverride = verifyInlineStyleOverride(
        element,
        config.cssProperty,
        value,
        activeNativeEdit,
      );
      if (!verifiedOverride) {
        reportInlineStyleOverrideFailure();
        return;
      }
      const mutation: HtmlCanvasMutation = {
        kind: "style",
        target,
        property,
        before: beforeFacts,
        after: {
          inlineValue: value,
          inlinePriority: verifiedOverride.priority,
          computedValue: verifiedOverride.computedValue,
        },
      };
      let unchanged = false;
      let operation: SemanticOperation;
      try {
        operation = inlineStyleOperation(sourceIndexRef.current, {
          elementId: target.elementId || "",
          baseRevision: semanticRevisionRef.current,
          property: config.cssProperty,
          value,
          important: verifiedOverride.priority === "important",
        });
      } catch (cause) {
        reportBlockedEdit(cause);
        resumeRejectedNativeStyle();
        return;
      }
      const styled = applySourceCommand({
        type: "direct-semantic-operation",
        operation,
      }, mutation, { onUnchanged: () => { unchanged = true; } });
      const resumed = Boolean(
        (styled || unchanged)
        && resumeNativeEditAfterStyle
        && startEditing(undefined, nativeSelectionAfterStyle)
      );
      containerRef.current?.setAttribute(
        "data-native-format-resume",
        `${styled ? "source" : unchanged ? "unchanged" : "rejected"}:${
          resumeNativeEditAfterStyle ? "requested" : "not-requested"
        }:${resumed ? "resumed" : "not-resumed"}`,
      );
      if (resumed && activeNativeEditRef.current) {
        rememberNativeEditSelection(activeNativeEditRef.current);
      }
      if (styled && resumeNativeEditAfterStyle && !resumed) {
        reportBlockedEdit(new Error(
          "元素样式已写入源码，但当前编辑会话无法在原画布继续。",
        ));
      }
    },
    [
      applySourceCommand,
      checkpointNativeEdit,
      finishNativeEditing,
      rememberNativeEditSelection,
      refreshNativeEditRangeState,
      reportInlineStyleOverrideFailure,
      reportBlockedEdit,
      restoreNativeEditSelectionForCommand,
      selectedElementHasSourceMutationAuthority,
      startEditing,
    ],
  );

  const applyNativeFormatShortcut = useCallback((
    shortcut: NativeFormatShortcut,
  ): boolean => {
    const active = activeNativeEditRef.current;
    if (!active) return false;
    const nativeSelection = restoreNativeEditSelectionForCommand(active);
    if (!nativeSelection) {
      reportBlockedEdit(new Error(
        "当前文字选择已失效，请重新选择文字后再修改格式。",
      ));
      return true;
    }
    const activeRange = activeTextRangeRef.current;
    if (!activeRange) {
      reportBlockedEdit(new Error("请先选中要修改的文字，再使用格式快捷键。"));
      return true;
    }
    const view = active.rootElement.ownerDocument.defaultView;
    const styleElements = activeRange.styleElements.length > 0
      ? activeRange.styleElements
      : [active.rootElement];
    const computedStyles = styleElements.map((element) => (
      view!.getComputedStyle(element)
    ));
    if (shortcut === "bold") {
      const enabled = computedStyles.every((style) => (
        style.fontWeight === "bold"
        || Number.parseInt(style.fontWeight, 10) >= 600
      ));
      applyInlineStyle("fontWeight", enabled ? "normal" : "700");
      return true;
    }
    if (shortcut === "italic") {
      const enabled = computedStyles.every((style) => (
        style.fontStyle === "italic" || style.fontStyle === "oblique"
      ));
      applyInlineStyle("fontStyle", enabled ? "normal" : "italic");
      return true;
    }
    const enabled = computedStyles.every((style) => (
      style.textDecorationLine.split(/\s+/u).includes("underline")
    ));
    applyInlineStyle("textDecorationLine", enabled ? "none" : "underline");
    return true;
  }, [
    applyInlineStyle,
    reportBlockedEdit,
    restoreNativeEditSelectionForCommand,
  ]);
  applyNativeFormatShortcutRef.current = applyNativeFormatShortcut;

  const handleToolbarKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const historyDirection = sourceHistoryDirectionForShortcut(event);
    if (historyDirection) {
      event.preventDefault();
      event.stopPropagation();
      onRequestHistoryRef.current?.(historyDirection);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (spacingMenuOpen) {
        setSpacingMenuOpen(false);
        return;
      }
      if (activeNativeEditRef.current) {
        finishNativeEditing(true, "manual", {
        });
        return;
      }
      iframeRef.current?.focus();
      clearSelection(true);
    }
  }, [clearSelection, finishNativeEditing, spacingMenuOpen]);

  const editorHeight = typeof height === "number" ? `${height}px` : height;
  const containerStyle = { "--html-canvas-height": editorHeight } as CSSProperties;
  const toolbarStyle = overlayPosition
    ? ({ left: overlayPosition.toolbarLeft, top: overlayPosition.toolbarTop } satisfies CSSProperties)
    : undefined;
  const selectedNativeEditHost = selectedElementRef.current && sourceIndexRef.current
    ? nativeEditHostForElement(selectedElementRef.current, sourceIndexRef.current)
    : null;
  const selectedNativeEditAvailable = Boolean(
    !runtimeGeneratedSelection
    && (
      activeNativeEditRef.current
      || selectedNativeEditHost
    ),
  );
  const elementCopyAvailability = elementCopyAvailabilityForTarget({
    element: selectedElementRef.current,
    sourceIndex: sourceIndexRef.current,
    runtimeGenerated: runtimeGeneratedSelection,
    runtimeExpected: Boolean(runtimeFrameRef.current),
    transientBusy: canvasTransitionActive,
    isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
    hasRuntimeShadowRoot: currentRuntimeShadowProof(),
  });
  const selectionCapability = selection && !interactionLocked
    ? canvasPointerCapabilityFromProof({
      canStartTextEdit: selectedNativeEditAvailable,
      sourceResolution: selection.resolution,
    })
    : null;
  const selectedVisualTargetElement = canvasVisualTargetElement(
    selectedElementRef.current,
    sourceIndexRef.current,
    { runtimeGenerated: runtimeGeneratedSelection },
  );
  const hoverTargetIsSelected = Boolean(
    hoverChrome.capability
    && selection
    && hoverChrome.capability.visualElement === selectedVisualTargetElement,
  );
  const runtimeHandoffPositioning = containerRef.current?.getAttribute(
    "data-runtime-handoff",
  ) === "positioning";
  const selectedOutlineStyle = runtimeHandoffPositioning
    ? selectionChromeProjectionRef.current?.selectedOutlineStyle
    : canvasTargetOutlineStyle(
        containerRef.current,
        iframeRef.current,
        selectedVisualTargetElement,
        Boolean(selection && isPageRootSelection(selection)),
      );
  const showHoverOutline = Boolean(
    !runtimeHandoffPositioning
    &&
    pointerCapabilityHoverEnabled
    && hoverChrome.outline
    && hoverChrome.capability
    && !hoverTargetIsSelected
    && !isEditing
    && !interactionLocked
  );
  const showHoverHint = Boolean(
    !runtimeHandoffPositioning
    &&
    pointerCapabilityHoverEnabled
    && hoverChrome.outline
    && hoverChrome.hint
    && hoverChrome.capability
    && !hoverTargetIsSelected
    && !isEditing
    && !interactionLocked
  );
  let hoverOutlineStyle: CSSProperties | undefined;
  let hoverHintStyle: CSSProperties | undefined;
  let hoverHintPlacement: ReturnType<typeof placeCanvasHoverHint> | undefined;
  const hoverHintCopy = hoverChrome.capability?.hint;
  const hoverHintMeasuredWidth = hoverHintMeasurement
    && hoverHintMeasurement.copy === hoverHintCopy
    ? hoverHintMeasurement.width
    : undefined;
  if (
    (showHoverOutline || showHoverHint)
    && hoverChrome.capability?.visualElement?.isConnected
    && containerRef.current
    && iframeRef.current
  ) {
    const containerRect = containerRef.current.getBoundingClientRect();
    const outline = canvasTargetOutlineStyle(
      containerRef.current,
      iframeRef.current,
      hoverChrome.capability.visualElement,
    );
    if (outline) {
      hoverOutlineStyle = outline;
      hoverHintPlacement = placeCanvasHoverHint({
        containerWidth: containerRect.width,
        targetLeft: outline.left,
        targetTop: outline.top,
        targetHeight: outline.height,
        labelWidth: hoverHintMeasuredWidth,
      });
      hoverHintStyle = showHoverHint
        ? {
          left: hoverHintPlacement.left,
          top: hoverHintPlacement.top,
          maxWidth: hoverHintPlacement.width,
        }
        : undefined;
    }
  }
  useLayoutEffect(() => {
    const hint = hoverHintMeasureRef.current;
    if (!showHoverHint || !hoverHintCopy || !hint) return;
    const width = hint.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    setHoverHintMeasurement((current) => {
      if (current && current.copy === hoverHintCopy && Math.abs(current.width - width) < 0.5) {
        return current;
      }
      return { copy: hoverHintCopy, width };
    });
  }, [hoverHintCopy, hoverHintPlacement?.left, hoverHintPlacement?.top, showHoverHint]);
  const selectedPagePresentationAction = (
    !effectiveReadOnly
    && !interactionLocked
    && !runtimeGeneratedSelection
    && selection
  ) ? resolvePagePresentationAction(selection) : null;
  const selectionChromeProjection = stabilizeSelectionChromeProjection(
    selectionChromeProjectionRef.current,
    {
      toolbarStyle,
      selectedOutlineStyle,
      hoverOutlineStyle,
      hoverHintStyle,
      hoverHintPlacement,
      selectedPagePresentationAction,
    },
  );
  selectionChromeProjectionRef.current = selectionChromeProjection;
  const textFormatRequiresSelection = isEditing && !hasTextRange;
  const handleEditFeedbackAction = useCallback(() => {
    const recovery = editFeedback?.recovery;
    setEditFeedback(null);
    setEditFeedbackPaused(false);
    if (recovery === "reload") {
      onRequestReload?.();
    }
  }, [editFeedback?.recovery, onRequestReload]);
  const editFeedbackActionAvailable = editFeedback?.recovery === "reload"
    && Boolean(onRequestReload);
  const handleHoverHintPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    hoverHintPointerInsideRef.current = true;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const handleHoverHintPointerEnter = useCallback(() => {
    hoverHintPointerInsideRef.current = true;
  }, []);
  const handleHoverHintPointerLeave = useCallback(() => {
    hoverHintPointerInsideRef.current = false;
    hoverControllerRef.current?.hide();
  }, []);
  const handleHoverHintClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resolvedTarget = hoverChrome.capability;
    if (interactionLocked || !resolvedTarget) return;
    hoverControllerRef.current?.hide();
    const currentDocument = iframeRef.current?.contentDocument;
    const currentSourceHash = sourceIndexRef.current?.sourceSha256;
    const expectedSourceHash = resolvedTarget.sourceRef?.expectedSourceSha256
      || resolvedTarget.selection.expectedSourceSha256;
    if (
      resolvedTarget.generation !== nativeDomGenerationRef.current
      || resolvedTarget.targetElement.ownerDocument !== currentDocument
      || !resolvedTarget.targetElement.isConnected
      || !resolvedTarget.visualElement.isConnected
      || (expectedSourceHash && expectedSourceHash !== currentSourceHash)
    ) return;
    // The caption has no current pointer hit. Reuse the resolved operation,
    // source comment anchor and visual hint as one short-lived selection.
    selectResolvedTarget(resolvedTarget, {
      showToolbar: true,
    });
  }, [hoverChrome.capability, interactionLocked, selectResolvedTarget]);
  const dismissEditFeedback = useCallback(() => {
    setEditFeedback(null);
  }, []);
  const handleSelectCommentMarker = useCallback((markerSelection: HtmlCanvasSelection) => {
    if (lockedRef.current) return;
    // The marker was clicked at the user's current Canvas position. Keep that
    // viewport stable; rail navigation can still reveal the paired target.
    selectTarget(markerSelection, { reveal: false, showToolbar: true });
  }, [selectTarget]);
  const handleToolbarPointerDownCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const activeNativeEdit = activeNativeEditRef.current;
    if (!activeNativeEdit) return;
    if (activeNativeEdit.session.isComposing()) {
      // Moving focus from the authored iframe to this outer toolbar makes
      // Chromium/macOS expose intermediate IME text. Keep the editor focused.
      event.preventDefault();
      return;
    }
    const documentSelection = activeNativeEdit.rootElement.ownerDocument.getSelection();
    const liveSelectionIsInside = Boolean(
      documentSelection?.anchorNode
      && documentSelection.focusNode
      && (
        documentSelection.anchorNode === activeNativeEdit.rootElement
        || activeNativeEdit.rootElement.contains(documentSelection.anchorNode)
      )
      && (
        documentSelection.focusNode === activeNativeEdit.rootElement
        || activeNativeEdit.rootElement.contains(documentSelection.focusNode)
      )
    );
    const retained = retainNativeEditFocusRef.current;
    const retainedIsCurrent = Boolean(
      retained
      && retained.session === activeNativeEdit.session
      && retained.targetId === activeNativeEdit.target.id
      && nativeEditLeasesMatch(retained.lease, activeNativeEdit.lease),
    );
    if (retained && !retainedIsCurrent) return;
    const selection = retained && retainedIsCurrent
      ? retained.selection
      : liveSelectionIsInside
        ? activeNativeEdit.session.getSelection()
        : activeNativeEdit.selection;
    retainNativeEditFocusRef.current = {
      session: activeNativeEdit.session,
      lease: { ...activeNativeEdit.lease },
      targetId: activeNativeEdit.target.id,
      selection: { ...selection },
      textRange: cloneActiveTextRange(activeTextRangeRef.current, activeNativeEdit.target),
    };
    const target = event.target;
    if (
      target instanceof Element
      && target.closest("button[data-native-format-focus='preserve']")
    ) event.preventDefault();
  }, []);
  const handleToolbarMouseDownCapture = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (activeNativeEditRef.current?.session.isComposing()) {
      // Chromium attaches the focus default to mousedown as well.
      event.preventDefault();
    }
  }, []);
  const executeSelectedPresentationAction = useCallback(() => {
    if (selection) executePagePresentationAction(selection);
  }, [executePagePresentationAction, selection]);
  const commentOnSelection = useCallback(() => {
    if (lockedRef.current || !selection) return;
    const openComment = () => {
      const activeNativeEdit = activeNativeEditRef.current;
      if (!activeTextRangeRef.current && activeNativeEdit) {
        // A programmatic Selection (and a fast mouse selection) may reach the
        // toolbar before the controller's selectionchange frame publishes its
        // range. Read the live island selection once at the comment boundary
        // and prefer the toolbar's retained selection after focus leaves the
        // iframe, so a source comment does not silently lose its text locator.
        const retained = retainNativeEditFocusRef.current;
        const liveSelection = activeNativeEdit.session.getSelection();
        const selectionForRange = liveSelection.anchor !== liveSelection.focus
          ? liveSelection
          : retained
            && retained.session === activeNativeEdit.session
            && retained.targetId === activeNativeEdit.target.id
            && nativeEditLeasesMatch(retained.lease, activeNativeEdit.lease)
            ? retained.selection
            : liveSelection;
        refreshNativeEditRangeState(
          activeNativeEdit,
          selectionForRange,
        );
      }
      const activeRange = activeTextRangeRef.current;
      const capturedTextLocator = activeRange
        ? textLocatorForActiveRange(activeRange, sourceIndexRef.current)
        : null;
      const commentTarget = capturedTextLocator && activeRange
        ? {
            ...(
              textRangeMatchesTarget(activeRange, selection)
                ? selection
                : activeRange.target
            ),
            textLocator: capturedTextLocator,
          }
        : selection;
      if (activeNativeEditRef.current) {
        const committed = checkpointNativeEdit("comment");
        if (!committed.ok) return;
      }
      requestCommentForTarget(commentTarget);
    };
    if (deferNativeCommandRef.current("comment", openComment)) return;
    openComment();
  }, [checkpointNativeEdit, refreshNativeEditRangeState, requestCommentForTarget, selection]);
  const startEditingSelection = useCallback(() => {
    startEditing();
  }, [startEditing]);
  const toggleSpacingMenu = useCallback(() => {
    setSpacingMenuOpen((open) => !open);
  }, []);
  const deleteCommentCount = useMemo(() => {
    const removedElementIds = sourceSubtreeElementIds(
      sourceIndexRef.current,
      selection?.elementId,
    );
    if (removedElementIds.size === 0) return 0;
    return commentedTargets.reduce((count, entry) => {
      const sourceTarget = entry.target.commentAnchor ?? entry.target;
      return sourceTarget.elementId && removedElementIds.has(sourceTarget.elementId)
        ? count + Math.max(0, Number(entry.count || 0))
        : count;
    }, 0);
  }, [commentedTargets, selection?.elementId]);
  const deleteCommentDraftIncluded = useMemo(() => {
    const removedElementIds = sourceSubtreeElementIds(
      sourceIndexRef.current,
      selection?.elementId,
    );
    return removedElementIds.size > 0 && commentedTargets.some((entry) => {
      const sourceTarget = entry.target.commentAnchor ?? entry.target;
      return Boolean(
        entry.hasDraft
        && sourceTarget.elementId
        && removedElementIds.has(sourceTarget.elementId),
      );
    });
  }, [commentedTargets, selection?.elementId]);
  const selectionChromeModel = useMemo<SelectionChromeModel>(() => ({
    hover: deriveCapabilityHoverState({
      enabled: pointerCapabilityHoverEnabled,
      hoverChrome,
      hoverTargetIsSelected,
      isEditing,
      interactionLocked,
      outlineStyle: selectionChromeProjection.hoverOutlineStyle,
      hintStyle: selectionChromeProjection.hoverHintStyle,
      hintPlacement: selectionChromeProjection.hoverHintPlacement,
    }),
    overlay: deriveSelectionOverlay({
      selection,
      outlineStyle: selectionChromeProjection.selectedOutlineStyle,
    }),
    canvasTransitionActive,
    selectionCapabilitySpoken: selectionCapability ? selectionCapability.spoken : "",
    interactionLocked,
    hoverHintMeasureRef,
    editFeedback,
    reloadActionLabel,
    editFeedbackActionAvailable,
    renderedMode,
    commentMarkers,
    toolbarVisible,
    overlayPosition,
    toolbarRef,
    hasTextRange,
    isEditing,
    toolbarStyle: selectionChromeProjection.toolbarStyle,
    selectedPagePresentationAction: selectionChromeProjection.selectedPagePresentationAction,
    readOnly: effectiveReadOnly || runtimeGeneratedSelection,
    selectedNativeEditAvailable,
    selectedStyle,
    textFormatRequiresSelection,
    enableReorder: enableReorder && !runtimeGeneratedSelection,
    moveAvailability,
    elementCopyAvailability,
    deleteCommentCount,
    deleteCommentDraftIncluded,
    spacingMenuRef,
    spacingMenuOpen,
    usageProjectId,
    usageCapture,
  }), [
    canvasTransitionActive,
    commentMarkers,
    deleteCommentCount,
    deleteCommentDraftIncluded,
    editFeedback,
    editFeedbackActionAvailable,
    elementCopyAvailability,
    enableReorder,
    hasTextRange,
    hoverChrome,
    hoverTargetIsSelected,
    interactionLocked,
    isEditing,
    moveAvailability,
    overlayPosition,
    pointerCapabilityHoverEnabled,
    effectiveReadOnly,
    reloadActionLabel,
    renderedMode,
    runtimeGeneratedSelection,
    selectedNativeEditAvailable,
    selectionChromeProjection,
    selectedStyle,
    selection,
    selectionCapability,
    spacingMenuOpen,
    textFormatRequiresSelection,
    toolbarVisible,
    usageCapture,
    usageProjectId,
  ]);
  const selectionChromeActions = useMemo<SelectionChromeActions>(() => ({
    onHoverHintPointerDown: handleHoverHintPointerDown,
    onHoverHintPointerEnter: handleHoverHintPointerEnter,
    onHoverHintPointerLeave: handleHoverHintPointerLeave,
    onHoverHintClick: handleHoverHintClick,
    onEditFeedbackAction: handleEditFeedbackAction,
    onDismissEditFeedback: dismissEditFeedback,
    onPauseEditFeedback: setEditFeedbackPaused,
    onSelectCommentMarker: handleSelectCommentMarker,
    onToolbarKeyDown: handleToolbarKeyDown,
    onToolbarPointerDownCapture: handleToolbarPointerDownCapture,
    onToolbarMouseDownCapture: handleToolbarMouseDownCapture,
    onExecutePresentationAction: executeSelectedPresentationAction,
    onComment: commentOnSelection,
    onStartEditing: startEditingSelection,
    onApplyInlineStyle: applyInlineStyle,
    onMoveSelected: moveSelected,
    onDuplicateSelected: duplicateSelected,
    onDeleteSelected: deleteSelected,
    onToggleSpacingMenu: toggleSpacingMenu,
  }), [
    applyInlineStyle,
    commentOnSelection,
    dismissEditFeedback,
    deleteSelected,
    duplicateSelected,
    executeSelectedPresentationAction,
    handleEditFeedbackAction,
    handleHoverHintClick,
    handleHoverHintPointerDown,
    handleHoverHintPointerEnter,
    handleHoverHintPointerLeave,
    handleSelectCommentMarker,
    handleToolbarKeyDown,
    handleToolbarMouseDownCapture,
    handleToolbarPointerDownCapture,
    moveSelected,
    startEditingSelection,
    toggleSpacingMenu,
  ]);

  const candidateRuntimeSlotId = runtimeCandidateRef.current?.attempt.slotId ?? null;
  const renderRuntimeSlot = (slotId: RuntimeFrameSlotId) => {
    const isActive = slotId === activeRuntimeSlotId;
    const isCandidate = Boolean(
      runtimeCandidateRender
      && candidateRuntimeSlotId === slotId,
    );
    const isPrevious = Boolean(
      !isActive
      && !isCandidate
      && runtimeInactiveRender,
    );
    const slotRole = isActive
      ? "active"
      : isCandidate
        ? "candidate"
        : isPrevious
          ? "previous"
          : "inactive";
    const render = isActive
      ? frameRender
      : isCandidate
        ? runtimeCandidateRender
        : isPrevious
          ? runtimeInactiveRender
          : null;
    const generation = render?.elementGeneration ?? -1;
    const frameRole = slotRole === "active" ? undefined : `runtime-${slotRole}`;
    const activeTitle = renderedMode === "history"
      ? `${iframeTitle}（正在查看历史版本，只读）`
      : interactionLocked
        ? `${iframeTitle}（本轮已锁定，仅可浏览）`
        : iframeTitle;
    return (
      <iframe
        key={`runtime-slot-${slotId}`}
        ref={(node) => {
          if (slotId === "a") runtimeSlotARef.current = node;
          else runtimeSlotBRef.current = node;
          if (node && isActive) iframeRef.current = node;
          if (node && isCandidate) runtimeCandidateIframeRef.current = node;
        }}
        data-runtime-slot={slotId}
        data-runtime-slot-role={slotRole}
        data-frame-generation={generation >= 0 ? generation : undefined}
        data-frame-role={frameRole}
        data-runtime-candidate-id={isCandidate
          ? runtimeCandidateRef.current?.attempt.candidateId
          : undefined}
        className={styles.frame}
        title={isActive
          ? activeTitle
          : isCandidate
            ? "Canvas runtime candidate"
            : isPrevious
              ? "Canvas previous runtime slot"
              : "Canvas runtime inactive slot"}
        sandbox={isActive
          ? render?.runtime
            ? "allow-same-origin allow-scripts"
            : "allow-same-origin"
          : isCandidate && render && !render.runtime
            ? "allow-same-origin"
            : "allow-same-origin allow-scripts"}
        srcDoc={render?.html ?? EMPTY_RUNTIME_SLOT_DOCUMENT}
        aria-hidden={isActive ? undefined : true}
        tabIndex={isActive ? undefined : -1}
        onLoad={(event) => {
          if (isActive && render) {
            if (connectFrame(event.currentTarget, render.elementGeneration)) {
              restoreInitialScroll();
            }
            return;
          }
          if (!isCandidate || !render) return;
          const candidate = runtimeCandidateRef.current;
          if (
            candidate
            && candidate.attempt.slotId === slotId
            && runtimeFrameCoordinatorRef.current!.accepts(candidate.attempt)
            && candidate.render.elementGeneration === render.elementGeneration
          ) candidate.loaded = true;
          connectRuntimeCandidateRef.current(
            event.currentTarget,
            render.elementGeneration,
          );
        }}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className={[styles.editor, className].filter(Boolean).join(" ")}
      style={containerStyle}
      data-testid="html-canvas-editor"
      data-locked={interactionLocked ? "true" : undefined}
      data-runtime-degradation={runtimeDegradation === "none" ? undefined : runtimeDegradation}
      data-interaction-mode={renderedMode} data-runtime-library-origins={editRuntimeGrant?.libraryOrigins?.join(",") || undefined}
      data-runtime-libraries={editRuntimeGrant?.runtimeLibraries?.join(",") || undefined}
      aria-readonly={effectiveReadOnly || interactionLocked}
    >
      {renderRuntimeSlot("a")}
      {renderRuntimeSlot("b")}
      <HtmlCanvasSelectionChrome
        model={selectionChromeModel}
        actions={selectionChromeActions}
      />
    </div>
  );
});

export default HtmlCanvasEditor;
