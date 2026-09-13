import {
  domPointForLogicalOffset,
  logicalIndexForHost,
  logicalOffsetForDomPoint,
  nativeLogicalText,
} from "../lib/native-dom-logical-index.js";
import {
  normalizeEditableIslandHtml,
  isFrozenEditableIslandSubtree,
} from "../lib/editable-island.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  isValidPagerootElementId,
} from "../lib/pageroot-element-identity.js";
import {
  NATIVE_EDIT_CHECKPOINT_DELAY_MS,
} from "../lib/native-edit-policy.js";
import type {
  NativeEditBaseline,
  NativeEditCheckpointTrigger,
  NativeEditLease,
  NativeEditLeaseStamp,
  NativeEditPendingCommandRequest,
  NativeEditQueueCommandResult,
  NativeEditQueuedCommand,
  NativeEditSelection,
  NativeEditSessionState,
} from "./native-edit-types";

export { NATIVE_EDIT_CHECKPOINT_DELAY_MS };
export { nativeLogicalText };
export type {
  NativeEditBaseline,
  NativeEditCheckpointTrigger,
  NativeEditLeaseStamp,
  NativeEditSelection,
  NativeEditSessionState,
};

export type IslandEditCheckpoint =
  | {
      ok: false;
      reason: "composing" | "not-ready" | "disposed" | "dom-drift";
    }
  | {
      ok: true;
      checkpoint: null;
      selection: NativeEditSelection;
    }
  | {
      ok: true;
      checkpoint: {
        previousInnerHtml: string;
        nextInnerHtml: string;
        previousText: string;
        nextText: string;
        beforeSelection: NativeEditSelection;
        selection: NativeEditSelection;
        inputType: string | null;
      };
      selection: NativeEditSelection;
    };

export type IslandEditingControllerOptions = {
  hostElement: HTMLElement;
  baseline: NativeEditBaseline;
  sourceInnerHtml: string;
  normalizeInnerHtml?: (
    value: string,
    options: { baselineInnerHtml: string },
  ) => string;
  lease: NativeEditLease;
  ariaLabel?: string;
  onStateChange?: (state: NativeEditSessionState) => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onError?: (error: Error) => void;
  onPendingCommandReady?: () => void;
  /** Only controller-owned copies transfer private runtime identity. */
  onCloneElement?: (original: Element, clone: Element) => void;
  /** Newly parsed children originate in the authoritative source baseline. */
  onSourceChildrenRestored?: (elements: readonly Element[]) => void;
};

export type IslandExternalBaselineOptions = {
  preserveLiveSelection?: boolean;
  lease?: NativeEditLeaseStamp;
  reconcileDomBeforeRebase?: () => unknown;
};

type SavedAttribute = {
  present: boolean;
  value: string | null;
};

type PendingCommand = NativeEditQueuedCommand & {
  authority?: "user-explicit" | "system";
  payload?: unknown;
};

type CompositionSnapshot = {
  children: Node[];
  selection: NativeEditSelection;
};

const SESSION_ATTRIBUTES = [
  "aria-label",
  "contenteditable",
  "data-pageroot-v2-editing",
  "role",
  "spellcheck",
] as const;

function cloneLeaseStamp(stamp: NativeEditLeaseStamp): NativeEditLeaseStamp {
  return { ...stamp };
}

function leaseStampsMatch(
  left: NativeEditLeaseStamp,
  right: NativeEditLeaseStamp,
): boolean {
  return left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId;
}

function captureAttribute(element: HTMLElement, name: string): SavedAttribute {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(
  element: HTMLElement,
  name: string,
  saved: SavedAttribute,
): void {
  if (saved.present) element.setAttribute(name, saved.value ?? "");
  else element.removeAttribute(name);
}

function selectionValue(hostElement: HTMLElement): NativeEditSelection {
  const fallback = nativeLogicalText(hostElement).length;
  const selection = hostElement.ownerDocument.getSelection();
  if (
    !selection
    || !selection.anchorNode
    || !selection.focusNode
    || (
      selection.anchorNode !== hostElement
      && !hostElement.contains(selection.anchorNode)
    )
    || (
      selection.focusNode !== hostElement
      && !hostElement.contains(selection.focusNode)
    )
  ) {
    return { anchor: fallback, focus: fallback, affinity: "right" };
  }
  const index = logicalIndexForHost(hostElement);
  const anchor = logicalOffsetForDomPoint(
    hostElement,
    selection.anchorNode,
    selection.anchorOffset,
    index,
  );
  const focus = logicalOffsetForDomPoint(
    hostElement,
    selection.focusNode,
    selection.focusOffset,
    index,
  );
  if (anchor === null || focus === null) {
    return { anchor: fallback, focus: fallback, affinity: "right" };
  }
  return {
    anchor,
    focus,
    affinity: anchor === focus && anchor > 0
      ? "left"
      : anchor < focus
        ? "left"
        : "right",
  };
}

function setSelectionValue(
  hostElement: HTMLElement,
  value: NativeEditSelection,
): void {
  const selection = hostElement.ownerDocument.getSelection();
  if (!selection) return;
  const index = logicalIndexForHost(hostElement);
  const anchor = domPointForLogicalOffset(
    hostElement,
    value.anchor,
    value.affinity,
    index,
  );
  const focus = domPointForLogicalOffset(
    hostElement,
    value.focus,
    value.affinity,
    index,
  );
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
    return;
  }
  const range = hostElement.ownerDocument.createRange();
  if (value.anchor <= value.focus) {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } else {
    range.setStart(focus.node, focus.offset);
    range.setEnd(anchor.node, anchor.offset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionRangeInsideHost(hostElement: HTMLElement): Range | null {
  const selection = hostElement.ownerDocument.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (
    (
      range.startContainer !== hostElement
      && !hostElement.contains(range.startContainer)
    )
    || (
      range.endContainer !== hostElement
      && !hostElement.contains(range.endContainer)
    )
  ) return null;
  return range;
}

function htmlForPlainText(documentNode: Document, value: string): DocumentFragment {
  const fragment = documentNode.createDocumentFragment();
  const normalized = String(value).replace(/\r\n?/gu, "\n");
  normalized.split("\n").forEach((line, index) => {
    if (index > 0) fragment.append(documentNode.createElement("br"));
    if (line) fragment.append(documentNode.createTextNode(line));
  });
  return fragment;
}

function insertFragmentAtSelection(
  hostElement: HTMLElement,
  fragment: DocumentFragment,
): boolean {
  const range = selectionRangeInsideHost(hostElement);
  if (!range) return false;
  if (
    !range.collapsed
    && selectionCrossesImmutableStructure(hostElement, range)
  ) return false;
  const insertedNodes = Array.from(fragment.childNodes);
  range.deleteContents();
  range.insertNode(fragment);
  const selection = hostElement.ownerDocument.getSelection();
  const lastNode = insertedNodes.at(-1);
  if (selection && lastNode) {
    const caret = hostElement.ownerDocument.createRange();
    caret.setStartAfter(lastNode);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  return true;
}

function insertTextAtSelection(
  hostElement: HTMLElement,
  value: string,
): boolean {
  const range = selectionRangeInsideHost(hostElement);
  if (!range) return false;
  if (!value) {
    if (
      !range.collapsed
      && selectionCrossesImmutableStructure(hostElement, range)
    ) return false;
    range.deleteContents();
    range.collapse(true);
    const selection = hostElement.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  if (
    range.startContainer === range.endContainer
    && range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    const text = range.startContainer as Text;
    const start = range.startOffset;
    const end = range.endOffset;
    if (end > start) text.deleteData(start, end - start);
    text.insertData(start, value);
    const caret = hostElement.ownerDocument.createRange();
    caret.setStart(text, start + value.length);
    caret.collapse(true);
    const selection = hostElement.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
    return true;
  }
  const fragment = hostElement.ownerDocument.createDocumentFragment();
  fragment.append(hostElement.ownerDocument.createTextNode(value));
  return insertFragmentAtSelection(hostElement, fragment);
}

function deleteSelection(
  hostElement: HTMLElement,
  inputType: string,
): boolean {
  const selection = hostElement.ownerDocument.getSelection();
  const range = selectionRangeInsideHost(hostElement);
  if (!selection || !range) return false;
  if (!range.collapsed) {
    if (selectionCrossesImmutableStructure(hostElement, range)) return false;
    range.deleteContents();
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  const logical = selectionValue(hostElement).focus;
  const text = nativeLogicalText(hostElement);
  const backward = inputType.includes("Backward");
  const deletesWord = inputType.includes("Word");
  if (!inputType.includes("Line")) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: deletesWord ? "word" : "grapheme",
    });
    const segments = Array.from(segmenter.segment(text));
    const meaningfulSegments = deletesWord
      ? segments.filter((segment) => segment.isWordLike || segment.segment.trim())
      : segments;
    const segment = backward
      ? [...meaningfulSegments].reverse().find((candidate) => (
          candidate.index < logical
          && candidate.index + candidate.segment.length >= logical
        ))
      : meaningfulSegments.find((candidate) => (
          candidate.index <= logical
          && candidate.index + candidate.segment.length > logical
        ));
    if (segment) {
      const startOffset = backward ? segment.index : logical;
      const endOffset = backward
        ? logical
        : segment.index + segment.segment.length;
      const index = logicalIndexForHost(hostElement);
      const startPoint = domPointForLogicalOffset(
        hostElement,
        startOffset,
        "right",
        index,
      );
      const endPoint = domPointForLogicalOffset(
        hostElement,
        endOffset,
        "left",
        index,
      );
      const deletionRange = hostElement.ownerDocument.createRange();
      deletionRange.setStart(startPoint.node, startPoint.offset);
      deletionRange.setEnd(endPoint.node, endPoint.offset);
      if (selectionCrossesImmutableStructure(hostElement, deletionRange)) {
        return false;
      }
      deletionRange.deleteContents();
      deletionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(deletionRange);
      return true;
    }
  }
  const granularity = inputType.includes("Word")
    ? "word"
    : inputType.includes("SoftLine")
      ? "lineboundary"
      : inputType.includes("HardLine")
        ? "line"
        : "character";
  if (typeof selection.modify === "function") {
    selection.modify("extend", backward ? "backward" : "forward", granularity);
    const deletionRange = selection.rangeCount === 1
      ? selection.getRangeAt(0)
      : null;
    if (
      deletionRange
      && (
        deletionRange.startContainer === hostElement
        || hostElement.contains(deletionRange.startContainer)
      )
      && (
        deletionRange.endContainer === hostElement
        || hostElement.contains(deletionRange.endContainer)
      )
    ) {
      if (selectionCrossesImmutableStructure(hostElement, deletionRange)) {
        setSelectionValue(hostElement, {
          anchor: logical,
          focus: logical,
          affinity: logical === 0 ? "right" : "left",
        });
        return false;
      }
      deletionRange.deleteContents();
      deletionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(deletionRange);
      return true;
    }
    setSelectionValue(hostElement, {
      anchor: logical,
      focus: logical,
      affinity: logical === 0 ? "right" : "left",
    });
  }

  if ((backward && logical === 0) || (!backward && logical === text.length)) {
    return true;
  }
  let start = logical;
  let end = logical;
  if (backward) {
    start -= 1;
    const prior = text.charCodeAt(start);
    if (
      prior >= 0xdc00
      && prior <= 0xdfff
      && start > 0
      && text.charCodeAt(start - 1) >= 0xd800
      && text.charCodeAt(start - 1) <= 0xdbff
    ) start -= 1;
  } else {
    const point = text.codePointAt(end);
    end += point !== undefined && point > 0xffff ? 2 : 1;
  }
  const index = logicalIndexForHost(hostElement);
  const startPoint = domPointForLogicalOffset(
    hostElement,
    Math.max(0, start),
    "left",
    index,
  );
  const endPoint = domPointForLogicalOffset(
    hostElement,
    Math.min(text.length, end),
    "right",
    index,
  );
  const deletionRange = hostElement.ownerDocument.createRange();
  deletionRange.setStart(startPoint.node, startPoint.offset);
  deletionRange.setEnd(endPoint.node, endPoint.offset);
  if (selectionCrossesImmutableStructure(hostElement, deletionRange)) {
    return false;
  }
  deletionRange.deleteContents();
  deletionRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(deletionRange);
  return true;
}

function cloneOwnedNode(node: Node, onClone?: IslandEditingControllerOptions["onCloneElement"]): Node {
  const clone = node.cloneNode(true);
  const visit = (original: Node, copy: Node) => {
    if (original.nodeType === 1 && copy.nodeType === 1) onClone?.(original as Element, copy as Element);
    Array.from(original.childNodes).forEach((child, index) => visit(child, copy.childNodes[index]));
  };
  if (onClone) visit(node, clone);
  return clone;
}

function restoreChildren(hostElement: HTMLElement, children: Node[], onClone?: IslandEditingControllerOptions["onCloneElement"]): void {
  hostElement.replaceChildren(
    ...children.map((node) => cloneOwnedNode(node, onClone)),
  );
}

function restoreSourceChildren(
  hostElement: HTMLElement,
  sourceInnerHtml: string,
): void {
  const range = hostElement.ownerDocument.createRange();
  range.selectNodeContents(hostElement);
  hostElement.replaceChildren(range.createContextualFragment(sourceInnerHtml));
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const IMMUTABLE_FORMATTING_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "object",
  "ol",
  "optgroup",
  "option",
  "select",
  "svg",
  "textarea",
  "ul",
  "video",
  "wbr",
]);

function isImmutableEditContainer(element: HTMLElement, hostElement: HTMLElement): boolean {
  return element !== hostElement
    && isFrozenEditableIslandSubtree(element.localName, element.namespaceURI || undefined);
}

function isFrozenSubtreeRoot(element: HTMLElement, hostElement: HTMLElement): boolean {
  if (!isImmutableEditContainer(element, hostElement)) return false;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== hostElement) {
    if (isImmutableEditContainer(ancestor, hostElement)) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

function isRuntimeAttributeName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "contenteditable"
    || normalized === "data-html-ai-source-node-id"
    || normalized === "role"
    || normalized === "spellcheck"
    || normalized.startsWith("data-html-canvas-")
    || normalized.startsWith("data-pageroot-");
}

function isImmutableFormattingNode(node: Node): boolean {
  if (node.nodeType === Node.COMMENT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  const tagName = element.localName.toLowerCase();
  if (
    element.namespaceURI !== HTML_NAMESPACE
    || IMMUTABLE_FORMATTING_TAGS.has(tagName)
  ) return true;
  if (tagName === "br") return false;
  const authoredAttributes = Array.from(element.attributes).filter(
    (attribute) => !isRuntimeAttributeName(attribute.name),
  );
  return element.childNodes.length === 0 && authoredAttributes.length > 0;
}

function selectionCrossesImmutableStructure(
  hostElement: HTMLElement,
  range: Range,
): boolean {
  const walker = hostElement.ownerDocument.createTreeWalker(
    hostElement,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isImmutableFormattingNode(node) && range.intersectsNode(node)) {
      return true;
    }
  }
  return false;
}

export class IslandEditingController {
  readonly hostElement: HTMLElement;

  private baseline: NativeEditBaseline;

  private baselineInnerHtml: string;

  private baselineCanonicalInnerHtml: string;

  private ownedCanonicalInnerHtml: string;

  private baselineChildren: Node[];

  private baselineSelection: NativeEditSelection;

  private lastValidatedChildren: Node[];

  private lastValidatedSelection: NativeEditSelection;

  private readonly lease: NativeEditLease;

  private readonly normalizeInnerHtml: (
    value: string,
    options: { baselineInnerHtml: string },
  ) => string;

  private leaseStamp: NativeEditLeaseStamp;

  private readonly callbacks: Pick<
    IslandEditingControllerOptions,
    "onStateChange" | "onBlur" | "onEscape" | "onError" | "onPendingCommandReady" | "onCloneElement" | "onSourceChildrenRestored"
  >;

  private readonly savedAttributes = new Map<string, SavedAttribute>();

  private readonly immutableContainerAttributes: Array<{
    index: number;
    saved: SavedAttribute;
  }> = [];

  private readonly cleanup: Array<() => void> = [];

  private observer: MutationObserver | null = null;

  private expectedMutationDepth = 0;

  private composing = false;

  private compositionEscapeRequested = false;

  private compositionSnapshot: CompositionSnapshot | null = null;

  private disposed = false;

  private ready = false;

  private lastInputType: string | null = null;

  private pendingCommand: PendingCommand | null = null;

  private pendingCommandSequence = 0;

  private stateFrame: number | null = null;

  private inputDeliveryExpected = false;

  private inputDeliveryTimer: number | null = null;

  constructor(options: IslandEditingControllerOptions) {
    this.hostElement = options.hostElement;
    this.baseline = { ...options.baseline };
    this.baselineInnerHtml = String(options.sourceInnerHtml);
    this.normalizeInnerHtml = options.normalizeInnerHtml
      ?? normalizeEditableIslandHtml;
    this.lease = options.lease;
    this.leaseStamp = cloneLeaseStamp(options.lease.stamp);
    this.callbacks = {
      onStateChange: options.onStateChange,
      onBlur: options.onBlur,
      onEscape: options.onEscape,
      onError: options.onError,
      onPendingCommandReady: options.onPendingCommandReady,
      onCloneElement: options.onCloneElement,
      onSourceChildrenRestored: options.onSourceChildrenRestored,
    };
    this.baselineCanonicalInnerHtml = this.normalizeInnerHtml(
      this.baselineInnerHtml,
      { baselineInnerHtml: this.baselineInnerHtml },
    );
    let liveDomMatchesSource = false;
    try {
      liveDomMatchesSource = this.serializeLiveCanonical()
        === this.baselineCanonicalInnerHtml;
    } catch {
      liveDomMatchesSource = false;
    }
    if (!liveDomMatchesSource) {
      restoreSourceChildren(this.hostElement, this.baselineInnerHtml);
      this.callbacks.onSourceChildrenRestored?.(Array.from(this.hostElement.querySelectorAll("*")));
      if (
        this.serializeLiveCanonical()
        !== this.baselineCanonicalInnerHtml
      ) {
        throw new Error(
          "源码可编辑岛无法建立一致的受控 DOM 基线。",
        );
      }
    }
    Array.from(this.hostElement.querySelectorAll<HTMLElement>("*"))
      .filter((element) => isFrozenSubtreeRoot(element, this.hostElement))
      .forEach((element, index) => {
        this.immutableContainerAttributes.push({
          index,
          saved: captureAttribute(element, "contenteditable"),
        });
        element.setAttribute("contenteditable", "false");
      });
    this.ownedCanonicalInnerHtml = this.baselineCanonicalInnerHtml;
    this.baselineChildren = Array.from(this.hostElement.childNodes).map(
      (node) => cloneOwnedNode(node, this.callbacks.onCloneElement),
    );
    this.baselineSelection = options.baseline.selection ?? {
      anchor: options.baseline.text.length,
      focus: options.baseline.text.length,
      affinity: "right",
    };
    this.lastValidatedChildren = this.baselineChildren.map(
      (node) => cloneOwnedNode(node, this.callbacks.onCloneElement),
    );
    this.lastValidatedSelection = { ...this.baselineSelection };

    for (const name of SESSION_ATTRIBUTES) {
      this.savedAttributes.set(name, captureAttribute(this.hostElement, name));
    }
    this.hostElement.setAttribute("contenteditable", "true");
    this.hostElement.setAttribute("spellcheck", "false");
    this.hostElement.setAttribute("role", "textbox");
    this.hostElement.setAttribute("data-pageroot-v2-editing", "true");
    if (options.ariaLabel) {
      this.hostElement.setAttribute("aria-label", options.ariaLabel);
    }

    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K,
      listener: EventListener,
      capture = false,
    ) => {
      target.addEventListener(type, listener, capture);
      this.cleanup.push(() => target.removeEventListener(type, listener, capture));
    };
    listen(this.hostElement, "beforeinput", this.handleBeforeInput as EventListener);
    listen(this.hostElement, "input", this.handleInput as EventListener);
    listen(this.hostElement, "paste", this.handlePaste as EventListener);
    listen(this.hostElement, "compositionstart", this.handleCompositionStart as EventListener);
    listen(this.hostElement, "compositionend", this.handleCompositionEnd as EventListener);
    listen(this.hostElement, "blur", this.handleBlur as EventListener);
    listen(this.hostElement, "keydown", this.handleKeyDown as EventListener);
    listen(
      this.hostElement.ownerDocument,
      "selectionchange",
      this.handleSelectionChange as EventListener,
    );

    this.observer = new MutationObserver((records) => {
      if (
        records.length === 0
        || this.expectedMutationDepth > 0
        || this.disposed
        || this.composing
      ) return;
      this.restoreLastValidatedDraft();
      this.reportError(new Error(
        "页面在编辑之外发生了变化，已恢复到上一次安全内容。",
      ));
    });
    this.observer.observe(this.hostElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.ready = true;
    this.emitState();
  }

  private hasCurrentLease(): boolean {
    return !this.disposed
      && this.lease.isCurrent(this.leaseStamp);
  }

  private reportError(error: unknown): void {
    if (!this.hasCurrentLease()) return;
    this.callbacks.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  private serializeLiveCanonical(): string {
    this.validatePersistentDescendantIdentities();
    return this.normalizeInnerHtml(this.hostElement.innerHTML, {
      baselineInnerHtml: this.baselineInnerHtml,
    });
  }

  private validatePersistentDescendantIdentities(): void {
    const hostId = this.hostElement.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (hostId === null) return;
    if (!isValidPagerootElementId(hostId)) {
      throw new Error("The editable source host has an invalid persistent element identity.");
    }
    const allocated = new Set([hostId]);
    const descendants = Array.from(this.hostElement.querySelectorAll("*"));
    for (const element of descendants) {
      const pagerootId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
      if (pagerootId === null) continue;
      if (!isValidPagerootElementId(pagerootId) || allocated.has(pagerootId)) {
        throw new Error("The editable source island has invalid persistent element identities.");
      }
      allocated.add(pagerootId);
    }
  }

  private armExpectedInputDelivery(): void {
    this.inputDeliveryExpected = true;
    const view = this.hostElement.ownerDocument.defaultView;
    if (!view) return;
    if (this.inputDeliveryTimer !== null) {
      view.clearTimeout(this.inputDeliveryTimer);
    }
    this.inputDeliveryTimer = view.setTimeout(() => {
      this.inputDeliveryTimer = null;
      this.inputDeliveryExpected = false;
    }, 0);
  }

  private clearExpectedInputDelivery(): void {
    this.inputDeliveryExpected = false;
    const view = this.hostElement.ownerDocument.defaultView;
    if (view && this.inputDeliveryTimer !== null) {
      view.clearTimeout(this.inputDeliveryTimer);
    }
    this.inputDeliveryTimer = null;
  }

  private validateDom(): boolean {
    try {
      this.ownedCanonicalInnerHtml = this.serializeLiveCanonical();
      this.refreshLastValidatedDraft();
      this.emitState();
      return true;
    } catch (cause) {
      this.restoreLastValidatedDraft();
      this.reportError(cause);
      return false;
    }
  }

  private ensureControlledDom(): boolean {
    try {
      if (this.serializeLiveCanonical() === this.ownedCanonicalInnerHtml) {
        return true;
      }
    } catch {
      // Fall through to the same source-backed recovery path.
    }
    this.restoreLastValidatedDraft();
    this.reportError(new Error(
      "页面在编辑之外发生了变化，已恢复到上一次安全内容。",
    ));
    return false;
  }

  private handleBeforeInput = (event: InputEvent): void => {
    if (!this.hasCurrentLease()) return;
    if (!this.composing && !this.ensureControlledDom()) {
      event.preventDefault();
      return;
    }
    this.lastInputType = event.inputType || null;
    if (
      !event.isComposing
      && (
        event.inputType === "insertText"
        || event.inputType === "insertReplacementText"
      )
    ) {
      this.normalizeCollapsedInsertionAffinity();
    }
    if (
      event.inputType === "historyUndo"
      || event.inputType === "historyRedo"
      || event.inputType.startsWith("format")
    ) {
      event.preventDefault();
      return;
    }
    if (!event.isComposing && event.inputType.startsWith("delete")) {
      event.preventDefault();
      this.runExpectedMutation(() => {
        if (!deleteSelection(this.hostElement, event.inputType)) {
          throw new Error("无法在当前光标位置删除文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (
      !event.isComposing
      && (
        event.inputType === "insertText"
        || event.inputType === "insertReplacementText"
      )
    ) {
      event.preventDefault();
      this.runExpectedMutation(() => {
        if (!insertTextAtSelection(this.hostElement, event.data ?? "")) {
          throw new Error("无法在当前光标位置插入文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (event.isComposing) {
      this.armExpectedInputDelivery();
      return;
    }
    if (
      event.inputType === "insertParagraph"
      || event.inputType === "insertLineBreak"
    ) {
      event.preventDefault();
      this.runExpectedMutation(() => {
        const fragment = this.hostElement.ownerDocument.createDocumentFragment();
        fragment.append(this.hostElement.ownerDocument.createElement("br"));
        if (!insertFragmentAtSelection(this.hostElement, fragment)) {
          throw new Error("无法在当前光标位置插入换行。");
        }
      });
      this.validateDom();
      return;
    }
    event.preventDefault();
    this.clearExpectedInputDelivery();
    this.reportError(new Error(
      `暂不支持 ${event.inputType || "unknown"} 类型的浏览器富文本输入。`,
    ));
  };

  private handleInput = (event: InputEvent): void => {
    if (!this.hasCurrentLease()) return;
    this.lastInputType = event.inputType || this.lastInputType;
    this.observer?.takeRecords();
    if (!this.composing && !this.inputDeliveryExpected) {
      this.restoreLastValidatedDraft();
      this.reportError(new Error(
        "页面在编辑之外发生了变化，已恢复到上一次安全内容。",
      ));
      return;
    }
    this.clearExpectedInputDelivery();
    if (
      !this.composing
      && this.lastInputType?.startsWith("delete")
      && this.hostElement.childNodes.length === 1
      && this.hostElement.firstElementChild?.localName === "br"
    ) {
      this.runExpectedMutation(() => this.hostElement.replaceChildren());
    }
    if (!this.composing) this.validateDom();
    else this.emitState();
  };

  private handlePaste = (event: ClipboardEvent): void => {
    if (!this.hasCurrentLease()) return;
    event.preventDefault();
    if (!this.ensureControlledDom()) return;
    this.clearExpectedInputDelivery();
    this.lastInputType = "insertFromPaste";
    this.normalizeCollapsedInsertionAffinity();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    this.runExpectedMutation(() => {
      if (!insertFragmentAtSelection(
        this.hostElement,
        htmlForPlainText(this.hostElement.ownerDocument, text),
      )) {
        throw new Error("无法在当前光标位置粘贴文字。");
      }
    });
    this.validateDom();
  };

  private handleCompositionStart = (): void => {
    if (!this.hasCurrentLease()) return;
    if (!this.ensureControlledDom()) return;
    this.normalizeCollapsedInsertionAffinity();
    this.compositionSnapshot = {
      children: Array.from(this.hostElement.childNodes).map(
        (node) => cloneOwnedNode(node, this.callbacks.onCloneElement),
      ),
      selection: this.getSelection(),
    };
    this.composing = true;
    this.clearExpectedInputDelivery();
    this.compositionEscapeRequested = false;
    this.emitState();
  };

  private handleCompositionEnd = (event: CompositionEvent): void => {
    if (!this.hasCurrentLease()) return;
    this.composing = false;
    this.clearExpectedInputDelivery();
    this.observer?.takeRecords();
    const snapshot = this.compositionSnapshot;
    this.compositionSnapshot = null;
    if (snapshot) {
      this.runExpectedMutation(() => {
        restoreChildren(this.hostElement, snapshot.children, this.callbacks.onCloneElement);
        setSelectionValue(this.hostElement, snapshot.selection);
        if (
          !this.compositionEscapeRequested
          && !insertTextAtSelection(this.hostElement, event.data ?? "")
        ) {
          throw new Error("输入法确认文字时无法恢复原光标位置。");
        }
      });
    }
    this.compositionEscapeRequested = false;
    this.validateDom();
    this.emitState();
    if (this.pendingCommand) {
      this.hostElement.ownerDocument.defaultView?.queueMicrotask(() => {
        if (this.hasCurrentLease() && this.pendingCommand) {
          this.callbacks.onPendingCommandReady?.();
        }
      });
    }
  };

  private handleBlur = (): void => {
    if (!this.hasCurrentLease()) return;
    if (this.composing) {
      const snapshot = this.compositionSnapshot;
      this.composing = false;
      this.compositionSnapshot = null;
      this.compositionEscapeRequested = false;
      this.clearExpectedInputDelivery();
      this.observer?.takeRecords();
      if (snapshot) {
        this.runExpectedMutation(() => {
          restoreChildren(this.hostElement, snapshot.children, this.callbacks.onCloneElement);
          setSelectionValue(this.hostElement, snapshot.selection);
        });
      }
      this.validateDom();
    }
    this.callbacks.onBlur?.();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.hasCurrentLease()) return;
    if (
      !this.composing
      && this.hostElement.localName === "summary"
      && event.key === " "
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
    ) {
      // A focused <summary> consumes Space as its native disclosure action
      // before Chromium emits beforeinput, even while it is contenteditable.
      // During a leased text session Space must remain text input and must not
      // toggle the surrounding <details> element.
      event.preventDefault();
      if (!this.ensureControlledDom()) return;
      this.normalizeCollapsedInsertionAffinity();
      this.lastInputType = "insertText";
      this.runExpectedMutation(() => {
        if (!insertTextAtSelection(this.hostElement, " ")) {
          throw new Error("无法在当前光标位置插入空格。");
        }
      });
      this.validateDom();
      return;
    }
    if (!this.composing && event.key === "Enter") {
      event.preventDefault();
      if (!this.ensureControlledDom()) return;
      this.lastInputType = event.shiftKey
        ? "insertLineBreak"
        : "insertParagraph";
      this.runExpectedMutation(() => {
        const fragment = this.hostElement.ownerDocument.createDocumentFragment();
        fragment.append(this.hostElement.ownerDocument.createElement("br"));
        if (!insertFragmentAtSelection(this.hostElement, fragment)) {
          throw new Error("无法在当前光标位置插入换行。");
        }
      });
      this.validateDom();
      return;
    }
    if (
      !this.composing
      && (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      if (!this.ensureControlledDom()) return;
      const direction = event.key === "Backspace" ? "Backward" : "Forward";
      const granularity = event.metaKey
        ? "SoftLine"
        : event.altKey
          ? "Word"
          : "Content";
      this.lastInputType = `delete${granularity}${direction}`;
      this.runExpectedMutation(() => {
        if (!deleteSelection(this.hostElement, this.lastInputType ?? "")) {
          throw new Error("无法在当前光标位置删除文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (event.key === "Escape") {
      if (this.composing) {
        this.compositionEscapeRequested = true;
        return;
      }
      event.preventDefault();
      this.callbacks.onEscape?.();
    }
  };

  private handleSelectionChange = (): void => {
    if (!this.hasCurrentLease()) return;
    const selection = this.hostElement.ownerDocument.getSelection();
    if (
      !selection?.anchorNode
      || (
        selection.anchorNode !== this.hostElement
        && !this.hostElement.contains(selection.anchorNode)
      )
    ) return;
    this.lastValidatedSelection = this.getSelection();
    this.emitState();
  };

  private emitState(): void {
    if (!this.hasCurrentLease() || this.stateFrame !== null) return;
    const view = this.hostElement.ownerDocument.defaultView;
    if (!view) return;
    this.stateFrame = view.requestAnimationFrame(() => {
      this.stateFrame = null;
      if (!this.hasCurrentLease()) return;
      let dirty = false;
      try {
        dirty = this.serializeLiveCanonical() !== this.ownedCanonicalInnerHtml
          || this.ownedCanonicalInnerHtml !== this.baselineCanonicalInnerHtml;
      } catch {
        dirty = true;
      }
      this.callbacks.onStateChange?.({
        dirty,
        draftPending: dirty || this.composing || Boolean(this.pendingCommand),
        composing: this.composing,
        requiresCanonicalReconcile: false,
        selection: this.getSelection(),
        inputType: this.lastInputType,
      });
    });
  }

  private refreshLastValidatedDraft(): void {
    this.lastValidatedChildren = Array.from(this.hostElement.childNodes).map(
      (node) => cloneOwnedNode(node, this.callbacks.onCloneElement),
    );
    this.lastValidatedSelection = this.getSelection();
  }

  private restoreLastValidatedDraft(): void {
    const selection = { ...this.lastValidatedSelection };
    this.runExpectedMutation(() => restoreChildren(
      this.hostElement,
      this.lastValidatedChildren,
      this.callbacks.onCloneElement,
    ));
    const length = nativeLogicalText(this.hostElement).length;
    setSelectionValue(this.hostElement, {
      anchor: Math.min(selection.anchor, length),
      focus: Math.min(selection.focus, length),
      affinity: selection.affinity,
    });
    this.emitState();
  }

  private normalizeCollapsedInsertionAffinity(): void {
    const selection = this.hostElement.ownerDocument.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    if (
      selection.anchorNode !== this.hostElement
      && !this.hostElement.contains(selection.anchorNode)
    ) return;
    const logical = selectionValue(this.hostElement);
    const prefix = this.hostElement.ownerDocument.createRange();
    prefix.selectNodeContents(this.hostElement);
    prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    const affinity = prefix.toString().trim().length === 0 ? "right" : "left";
    const point = domPointForLogicalOffset(
      this.hostElement,
      logical.focus,
      affinity,
    );
    const range = this.hostElement.ownerDocument.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  focusSelection(): void {
    if (!this.hasCurrentLease()) return;
    this.hostElement.focus({ preventScroll: true });
    setSelectionValue(this.hostElement, this.baseline.selection ?? this.baselineSelection);
    this.normalizeCollapsedInsertionAffinity();
    this.emitState();
  }

  focusAtPoint(point?: { clientX: number; clientY: number }): void {
    if (!this.hasCurrentLease()) return;
    const priorSelection = this.getSelection();
    this.hostElement.focus({ preventScroll: true });
    if (!point) {
      this.focusSelection();
      return;
    }
    const range = this.collapsedRangeAtPoint(point);
    if (range) {
      const selection = this.hostElement.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      setSelectionValue(this.hostElement, priorSelection);
    }
    this.normalizeCollapsedInsertionAffinity();
    this.emitState();
  }

  private collapsedRangeAtPoint(point: { clientX: number; clientY: number }): Range | null {
    const documentNode = this.hostElement.ownerDocument;
    const caretPosition = documentNode.caretPositionFromPoint?.(
      point.clientX,
      point.clientY,
    );
    const fallbackRange = documentNode.caretRangeFromPoint?.(
      point.clientX,
      point.clientY,
    );
    const offsetNode = caretPosition?.offsetNode
      ?? fallbackRange?.startContainer
      ?? null;
    const offset = caretPosition?.offset ?? fallbackRange?.startOffset ?? 0;
    if (
      offsetNode
      && (offsetNode === this.hostElement || this.hostElement.contains(offsetNode))
    ) {
      try {
        const range = documentNode.createRange();
        range.setStart(offsetNode, offset);
        range.collapse(true);
        return range;
      } catch {
        // Fall through to the nearest insertion point inside the island.
      }
    }
    return this.nearestCollapsedRangeInHost(point);
  }

  private nearestCollapsedRangeInHost(
    point: { clientX: number; clientY: number },
  ): Range | null {
    const documentNode = this.hostElement.ownerDocument;
    const showText = documentNode.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = documentNode.createTreeWalker(this.hostElement, showText);
    let bestRange: Range | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let current = walker.nextNode();
    const consider = (textNode: Text, offset: number) => {
      const range = documentNode.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0)) {
        return;
      }
      const dx = point.clientX < rect.left
        ? rect.left - point.clientX
        : point.clientX > rect.right
          ? point.clientX - rect.right
          : 0;
      const dy = point.clientY < rect.top
        ? rect.top - point.clientY
        : point.clientY > rect.bottom
          ? point.clientY - rect.bottom
          : 0;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestRange = range;
        bestDistance = distance;
      }
    };
    while (current) {
      const textNode = current as Text;
      const length = textNode.data.length;
      if (length > 0) {
        const step = length <= 48 ? 1 : Math.max(1, Math.floor(length / 24));
        for (let offset = 0; offset < length; offset += step) consider(textNode, offset);
        consider(textNode, length);
      }
      current = walker.nextNode();
    }
    const breaks = Array.from(this.hostElement.querySelectorAll<HTMLElement>("br"));
    for (const br of breaks) {
      const rect = br.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0)) {
        continue;
      }
      const considerBreak = (side: "before" | "after") => {
        const range = documentNode.createRange();
        if (side === "before") range.setStartBefore(br);
        else range.setStartAfter(br);
        range.collapse(true);
        const dx = point.clientX < rect.left
          ? rect.left - point.clientX
          : point.clientX > rect.right
            ? point.clientX - rect.right
            : 0;
        const dy = point.clientY < rect.top
          ? rect.top - point.clientY
          : point.clientY > rect.bottom
            ? point.clientY - rect.bottom
            : 0;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestRange = range;
          bestDistance = distance;
        }
      };
      considerBreak("before");
      considerBreak("after");
    }
    return bestRange;
  }

  getSelection(): NativeEditSelection {
    if (!this.hasCurrentLease()) return this.baselineSelection;
    return selectionValue(this.hostElement);
  }

  restoreSelection(selection: NativeEditSelection): void {
    if (!this.hasCurrentLease()) return;
    setSelectionValue(this.hostElement, selection);
    this.emitState();
  }

  getStyleElementsForSelection(): HTMLElement[] {
    if (!this.hasCurrentLease()) return [this.hostElement];
    const selection = this.hostElement.ownerDocument.getSelection();
    if (!selection || selection.rangeCount !== 1) return [this.hostElement];
    if (selection.isCollapsed) {
      const logical = this.getSelection();
      const point = domPointForLogicalOffset(
        this.hostElement,
        logical.focus,
        logical.focus === 0 ? "right" : "left",
      );
      const element = point.node.nodeType === Node.TEXT_NODE
        ? point.node.parentElement
        : point.node instanceof HTMLElement
          ? point.node
          : point.node.parentElement;
      return element ? [element] : [this.hostElement];
    }
    const range = selection.getRangeAt(0);
    const elements: HTMLElement[] = [];
    const walker = this.hostElement.ownerDocument.createTreeWalker(
      this.hostElement,
      NodeFilter.SHOW_TEXT,
    );
    let current = walker.nextNode();
    while (current) {
      // A range ending at offset zero in the next Text node visually selects
      // none of it, although intersectsNode includes that boundary. Its style
      // must not change the toolbar's state for the selected characters.
      const start = range.startContainer === current ? range.startOffset : 0;
      const end = range.endContainer === current ? range.endOffset : (current as Text).length;
      if (end > start && range.intersectsNode(current) && current.parentElement) {
        if (!elements.includes(current.parentElement)) {
          elements.push(current.parentElement);
        }
      }
      current = walker.nextNode();
    }
    return elements.length > 0 ? elements : [this.hostElement];
  }

  applyInlineStyle(property: string, value: string, important = false): boolean {
    if (!this.hasCurrentLease() || this.composing) return false;
    if (!this.ensureControlledDom()) return false;
    const range = selectionRangeInsideHost(this.hostElement);
    if (!range || range.collapsed) return false;
    if (selectionCrossesImmutableStructure(this.hostElement, range)) {
      this.reportError(new Error(
        "当前选区跨过图片、控件、媒体或源码注释，不能安全改变文字格式。",
      ));
      return false;
    }
    const beforeSelection = this.getSelection();
    try {
      this.runExpectedMutation(() => {
        const span = this.hostElement.ownerDocument.createElement("span");
        span.style.setProperty(property, value, important ? "important" : "");
        span.append(range.extractContents());
        range.insertNode(span);
        const selection = this.hostElement.ownerDocument.getSelection();
        const nextRange = this.hostElement.ownerDocument.createRange();
        nextRange.selectNodeContents(span);
        selection?.removeAllRanges();
        selection?.addRange(nextRange);
      });
      if (!this.validateDom()) return false;
      this.baselineSelection = beforeSelection;
      return true;
    } catch (cause) {
      this.rollback();
      this.reportError(cause);
      return false;
    }
  }

  canApplyInlineStyle(): boolean {
    if (!this.hasCurrentLease() || this.composing) return false;
    if (!this.ensureControlledDom()) return false;
    const range = selectionRangeInsideHost(this.hostElement);
    return Boolean(
      range
      && !range.collapsed
      && !selectionCrossesImmutableStructure(this.hostElement, range)
    );
  }

  queuePendingCommand(
    request: NativeEditPendingCommandRequest,
  ): NativeEditQueueCommandResult {
    if (!this.hasCurrentLease() || !this.composing) return { queued: false };
    this.pendingCommandSequence += 1;
    const replacedSequence = this.pendingCommand?.sequence ?? null;
    this.pendingCommand = {
      sequence: this.pendingCommandSequence,
      kind: request.kind,
      authority: request.authority ?? "user-explicit",
      payload: request.payload,
      compositionId: `island_${this.pendingCommandSequence.toString(36)}`,
    };
    this.emitState();
    return {
      queued: true,
      sequence: this.pendingCommandSequence,
      replacedSequence,
    };
  }

  takePendingCommand(): NativeEditQueuedCommand | null {
    if (!this.hasCurrentLease() || this.composing || !this.pendingCommand) return null;
    const command = this.pendingCommand;
    this.pendingCommand = null;
    this.emitState();
    return command;
  }

  captureCheckpoint(
    trigger: NativeEditCheckpointTrigger = "automatic",
  ): IslandEditCheckpoint {
    void trigger;
    if (!this.hasCurrentLease()) return { ok: false, reason: "disposed" };
    if (!this.ready) return { ok: false, reason: "not-ready" };
    if (this.composing) return { ok: false, reason: "composing" };
    const selection = this.getSelection();
    try {
      if (this.serializeLiveCanonical() !== this.ownedCanonicalInnerHtml) {
        throw new Error("可编辑 DOM 已偏离受控源码草稿。");
      }
    } catch (cause) {
      this.restoreLastValidatedDraft();
      this.reportError(cause);
      return { ok: false, reason: "dom-drift" };
    }
    const nextInnerHtml = this.ownedCanonicalInnerHtml;
    if (nextInnerHtml === this.baselineCanonicalInnerHtml) {
      return { ok: true, checkpoint: null, selection };
    }
    return {
      ok: true,
      checkpoint: {
        previousInnerHtml: this.baselineInnerHtml,
        nextInnerHtml,
        previousText: this.baseline.text,
        nextText: nativeLogicalText(this.hostElement),
        beforeSelection: this.baselineSelection,
        selection,
        inputType: this.lastInputType,
      },
      selection,
    };
  }

  applyExternalIslandBaseline(
    baseline: NativeEditBaseline & { innerHtml: string },
    options: IslandExternalBaselineOptions = {},
  ): boolean {
    const currentLease = this.leaseStamp;
    const nextLease = cloneLeaseStamp(options.lease ?? currentLease);
    if (
      !this.hasCurrentLease()
      || !leaseStampsMatch(
        { ...currentLease, sourceRevision: nextLease.sourceRevision },
        nextLease,
      )
      || baseline.revision !== nextLease.sourceRevision
    ) return false;
    let canonical: string;
    try {
      canonical = this.normalizeInnerHtml(baseline.innerHtml, {
        baselineInnerHtml: baseline.innerHtml,
      });
      if (options.reconcileDomBeforeRebase) {
        if (this.serializeLiveCanonical() !== this.ownedCanonicalInnerHtml) {
          return false;
        }
        this.runExpectedMutation(() => options.reconcileDomBeforeRebase?.());
        if (this.serializeLiveCanonical() !== canonical) return false;
      } else if (
        this.ownedCanonicalInnerHtml !== canonical
        || this.serializeLiveCanonical() !== canonical
      ) return false;
    } catch {
      return false;
    }
    if (
      !leaseStampsMatch(currentLease, nextLease)
      && !this.lease.advance(currentLease, nextLease)
    ) return false;
    this.leaseStamp = nextLease;
    this.baseline = { ...baseline };
    this.baselineInnerHtml = baseline.innerHtml;
    this.baselineCanonicalInnerHtml = canonical;
    this.ownedCanonicalInnerHtml = canonical;
    this.baselineChildren = Array.from(this.hostElement.childNodes).map(
      (node) => cloneOwnedNode(node, this.callbacks.onCloneElement),
    );
    this.baselineSelection = options.preserveLiveSelection
      ? this.getSelection()
      : baseline.selection ?? this.getSelection();
    if (!options.preserveLiveSelection && baseline.selection) {
      setSelectionValue(this.hostElement, baseline.selection);
    }
    this.lastInputType = null;
    this.clearExpectedInputDelivery();
    this.refreshLastValidatedDraft();
    this.emitState();
    return true;
  }

  applyExternalBaseline(
    baseline: NativeEditBaseline,
    options: IslandExternalBaselineOptions = {},
  ): boolean {
    return this.applyExternalIslandBaseline(
      { ...baseline, innerHtml: this.ownedCanonicalInnerHtml },
      options,
    );
  }

  runExpectedMutation<T>(operation: () => T): T {
    if (!this.hasCurrentLease()) return undefined as T;
    this.observer?.takeRecords();
    this.expectedMutationDepth += 1;
    try {
      return operation();
    } finally {
      this.observer?.takeRecords();
      this.expectedMutationDepth -= 1;
    }
  }

  rollback(): void {
    if (!this.hasCurrentLease()) return;
    const selection = this.getSelection();
    this.runExpectedMutation(() => restoreChildren(
      this.hostElement,
      this.baselineChildren,
      this.callbacks.onCloneElement,
    ));
    const length = nativeLogicalText(this.hostElement).length;
    setSelectionValue(this.hostElement, {
      anchor: Math.min(selection.anchor, length),
      focus: Math.min(selection.focus, length),
      affinity: selection.affinity,
    });
    this.lastInputType = null;
    this.ownedCanonicalInnerHtml = this.baselineCanonicalInnerHtml;
    this.clearExpectedInputDelivery();
    this.refreshLastValidatedDraft();
    this.emitState();
  }

  isComposing(): boolean {
    return this.hasCurrentLease() && this.composing;
  }

  consumeCompositionEscape(): boolean {
    if (!this.hasCurrentLease() || !this.composing) return false;
    this.compositionEscapeRequested = true;
    return true;
  }

  isDirty(): boolean {
    if (!this.hasCurrentLease()) return false;
    try {
      return this.serializeLiveCanonical() !== this.ownedCanonicalInnerHtml
        || this.ownedCanonicalInnerHtml !== this.baselineCanonicalInnerHtml;
    } catch {
      return true;
    }
  }

  hasPendingDraft(): boolean {
    return this.hasCurrentLease()
      && (this.isDirty() || this.composing || Boolean(this.pendingCommand));
  }

  private detach(): void {
    this.observer?.takeRecords();
    this.observer?.disconnect();
    this.observer = null;
    while (this.cleanup.length > 0) this.cleanup.pop()?.();
    const view = this.hostElement.ownerDocument.defaultView;
    if (this.stateFrame !== null) view?.cancelAnimationFrame(this.stateFrame);
    this.stateFrame = null;
  }

  fenceDispose(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    for (const [name, saved] of this.savedAttributes) {
      restoreAttribute(this.hostElement, name, saved);
    }
    const immutableContainers = Array.from(
      this.hostElement.querySelectorAll<HTMLElement>("*"),
    ).filter((element) => isImmutableEditContainer(element, this.hostElement));
    for (const item of this.immutableContainerAttributes) {
      const element = immutableContainers[item.index];
      if (element) restoreAttribute(element, "contenteditable", item.saved);
    }
    this.pendingCommand = null;
    this.compositionSnapshot = null;
    this.clearExpectedInputDelivery();
    this.disposed = true;
  }
}
