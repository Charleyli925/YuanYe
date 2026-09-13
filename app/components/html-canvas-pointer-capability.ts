import { sourceTargetRefForSelection } from "../lib/canvas-target-rebind.js";
import { EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE } from "../domain/edit-runtime-contract.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";
import type {
  HtmlCanvasSelection,
  HtmlCanvasTargetResolution,
} from "./HtmlCanvasEditor.types";
import type {
  SourceIndexValue,
  SourceTargetRef,
} from "./html-canvas-internal-types";
import {
  identifyingTextRangeAtPoint,
  findCanvasHitSourceElement,
  findCanvasSelectionElement,
  findDedicatedSourceSurfaceAtPoint,
  eventTargetsRuntimeGeneratedNode,
  isCanvasRootElement,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  nativeEditHostForElement,
} from "./html-canvas-preview-sync";
import {
  createRuntimeVisualTargetIndex,
  type RuntimeVisualTargetIndex,
  runtimeVisualTargetAtPoint,
  runtimeVisualHintForTarget,
  runtimeVisualTargetElement,
} from "./html-canvas-runtime-target";
import {
  inferSelectionLevel,
  selectionForElement,
} from "./html-canvas-selection";
import { moduleHasSubstance } from "./html-canvas-pointer-hit.js";
import {
  canvasPointerCapabilityFromProof,
  elementCopyAvailabilityFromProof,
  type ElementCopyAvailability,
} from "./html-canvas-pointer-proof.js";

export {
  CANVAS_POINTER_CAPABILITY_KINDS,
  CANVAS_POINTER_CAPABILITIES,
  canvasPointerCapabilityFromProof,
  elementCopyAvailabilityFromProof,
} from "./html-canvas-pointer-proof.js";
export { moduleHasSubstance } from "./html-canvas-pointer-hit.js";
export type {
  CanvasPointerCapability,
  CanvasPointerCapabilityKind,
  ElementCopyAvailability,
} from "./html-canvas-pointer-proof.js";

export type ElementCopyAvailabilityReason =
  | "available"
  | "runtime-generated-target"
  | "target-missing"
  | "trusted-inspection-unavailable"
  | "target-disconnected"
  | "source-index-missing"
  | "runtime-source-proof-pending"
  | "source-mutation-authority-missing"
  | "canonical-source-unavailable"
  | "canonical-target-unavailable"
  | "runtime-subtree-diverged"
  | "transition-busy";

export type ElementCopyAssessment = Readonly<{
  availability: ElementCopyAvailability;
  reason: ElementCopyAvailabilityReason;
  diagnostic?: string;
}>;

const OPAQUE_OR_PROGRAM_COPY_TAGS = new Set([
  "canvas",
  "embed",
  "iframe",
  "object",
  "script",
]);

type TrustedDomInspection = Readonly<{
  attributeNames: (element: Element) => string[];
  attributeValue: (element: Element, name: string) => string | null;
  child: (node: Node) => ChildNode | null;
  connected: (node: Node) => boolean;
  localName: (element: Element) => string;
  namespace: (element: Element) => string | null;
  next: (node: Node) => ChildNode | null;
  nodeType: (node: Node) => number;
  nodeValue: (node: Node) => string | null;
  parse: (source: string) => Document;
  query: (documentNode: Document, selector: string) => Element[];
  shadowRoot: (element: Element) => ShadowRoot | null;
}>;

function captureTrustedDomInspection(): TrustedDomInspection | null {
  if (
    typeof Node === "undefined"
    || typeof Element === "undefined"
    || typeof Document === "undefined"
    || typeof DOMParser === "undefined"
    || typeof NodeList === "undefined"
  ) return null;
  const apply = Reflect.apply;
  const getter = (prototype: object, name: string) => (
    Object.getOwnPropertyDescriptor(prototype, name)?.get ?? null
  );
  const nodeType = getter(Node.prototype, "nodeType");
  const nodeValue = getter(Node.prototype, "nodeValue");
  const firstChild = getter(Node.prototype, "firstChild");
  const nextSibling = getter(Node.prototype, "nextSibling");
  const isConnected = getter(Node.prototype, "isConnected");
  const localName = getter(Element.prototype, "localName");
  const namespaceURI = getter(Element.prototype, "namespaceURI")
    ?? getter(Node.prototype, "namespaceURI");
  const shadowRoot = getter(Element.prototype, "shadowRoot");
  const nodeListLength = getter(NodeList.prototype, "length");
  const getAttributeNames = Element.prototype.getAttributeNames;
  const getAttribute = Element.prototype.getAttribute;
  const querySelectorAll = Document.prototype.querySelectorAll;
  const nodeListItem = NodeList.prototype.item;
  const parseFromString = DOMParser.prototype.parseFromString;
  const TrustedDOMParser = DOMParser;
  if (
    !nodeType
    || !nodeValue
    || !firstChild
    || !nextSibling
    || !isConnected
    || !localName
    || !namespaceURI
    || !shadowRoot
    || !nodeListLength
  ) return null;
  return Object.freeze({
    attributeNames: (element) => apply(getAttributeNames, element, []),
    attributeValue: (element, name) => apply(getAttribute, element, [name]),
    child: (node) => apply(firstChild, node, []),
    connected: (node) => apply(isConnected, node, []),
    localName: (element) => apply(localName, element, []),
    namespace: (element) => apply(namespaceURI, element, []),
    next: (node) => apply(nextSibling, node, []),
    nodeType: (node) => apply(nodeType, node, []),
    nodeValue: (node) => apply(nodeValue, node, []),
    parse: (source) => apply(
      parseFromString,
      new TrustedDOMParser(),
      [source, "text/html"],
    ),
    query: (documentNode, selector) => {
      const matches = apply(querySelectorAll, documentNode, [selector]);
      const length = apply(nodeListLength, matches, []);
      const elements: Element[] = [];
      for (let index = 0; index < length; index += 1) {
        const element = apply(nodeListItem, matches, [index]);
        if (element) elements.push(element as Element);
      }
      return elements;
    },
    shadowRoot: (element) => apply(shadowRoot, element, []),
  });
}

// Captured before any authored iframe runs. Copy authority must not depend on
// DOM getters or selector methods that the authored realm can replace.
const TRUSTED_DOM_INSPECTION = captureTrustedDomInspection();

type CanonicalCopySource = Readonly<{
  source: string;
  sourceSha256: string;
  rootsByPagerootId: ReadonlyMap<string, HTMLElement | null>;
}>;

// Exact SourceIndex objects are immutable revision snapshots. Cache only their
// detached canonical side; live Runtime objects and the final availability
// verdict are always checked again at the command boundary.
const CANONICAL_COPY_SOURCE_BY_INDEX = new WeakMap<
  SourceIndexValue,
  CanonicalCopySource | null
>();

function canonicalCopySource(
  sourceIndex: SourceIndexValue,
): CanonicalCopySource | null {
  if (CANONICAL_COPY_SOURCE_BY_INDEX.has(sourceIndex)) {
    const cached = CANONICAL_COPY_SOURCE_BY_INDEX.get(sourceIndex) ?? null;
    if (
      cached
      && (
        cached.source !== sourceIndex.source
        || cached.sourceSha256 !== sourceIndex.sourceSha256
      )
    ) return null;
    return cached;
  }
  const inspection = TRUSTED_DOM_INSPECTION;
  if (!inspection) return null;
  try {
    const canonicalDocument = inspection.parse(sourceIndex.source);
    const rootsByPagerootId = new Map<string, HTMLElement | null>();
    for (const candidate of inspection.query(
      canonicalDocument,
      `[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`,
    )) {
      const pagerootId = inspection.attributeValue(
        candidate,
        PAGEROOT_ELEMENT_ID_ATTRIBUTE,
      );
      if (!pagerootId || !isValidPagerootElementId(pagerootId)) continue;
      rootsByPagerootId.set(
        pagerootId,
        rootsByPagerootId.has(pagerootId) ? null : candidate as HTMLElement,
      );
    }
    const result = Object.freeze({
      source: sourceIndex.source,
      sourceSha256: sourceIndex.sourceSha256,
      rootsByPagerootId,
    });
    CANONICAL_COPY_SOURCE_BY_INDEX.set(sourceIndex, result);
    return result;
  } catch {
    CANONICAL_COPY_SOURCE_BY_INDEX.set(sourceIndex, null);
    return null;
  }
}

function isOpaqueOrProgramCopyElement(localName: string): boolean {
  return OPAQUE_OR_PROGRAM_COPY_TAGS.has(localName) || localName.includes("-");
}

function isProjectionOnlyAttribute(name: string, sourceHasAttribute: boolean): boolean {
  const normalized = name.toLowerCase();
  return normalized === EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE
    || normalized.startsWith("data-html-canvas-")
    || normalized.startsWith("data-pageroot-edit-runtime-")
    || (
      !sourceHasAttribute
      && (
        // Native Edit owns the first two. Page runtime readiness/diagnostic
        // markers do not become part of the canonical source subtree copied.
        normalized === "aria-label"
        || normalized === "data-pageroot-v2-editing"
        || normalized.startsWith("data-runtime-")
      )
    )
    || (
      ["contenteditable", "role", "spellcheck"].includes(normalized)
      && !sourceHasAttribute
    );
}

function normalizedAttributes(
  inspection: TrustedDomInspection,
  element: Element,
): Array<readonly [string, string]> {
  const names = inspection.attributeNames(element);
  const result: Array<readonly [string, string]> = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    result.push([name.toLowerCase(), inspection.attributeValue(element, name) ?? ""]);
  }
  return result;
}

function attributesMatch(
  inspection: TrustedDomInspection,
  liveElement: Element,
  canonicalElement: Element,
): boolean {
  return attributeMismatchDiagnostic(
    inspection,
    liveElement,
    canonicalElement,
  ) === null;
}

function attributeMismatchDiagnostic(
  inspection: TrustedDomInspection,
  liveElement: Element,
  canonicalElement: Element,
): string | null {
  const canonical = normalizedAttributes(inspection, canonicalElement);
  const live = normalizedAttributes(inspection, liveElement);
  let authoredCount = 0;
  for (const [name, value] of live) {
    const sourceAttribute = canonical.find(([candidate]) => candidate === name);
    if (isProjectionOnlyAttribute(name, Boolean(sourceAttribute))) continue;
    // CSSStyleDeclaration keeps an empty style attribute after some reversible
    // browser-side probes. With no declaration it contributes no copied source
    // content; every non-empty runtime style still fails the subtree proof.
    if (name === "style" && value === "" && !sourceAttribute) continue;
    authoredCount += 1;
    if (!sourceAttribute) return `attribute-extra:${name}`;
    if (sourceAttribute[1] !== value) return `attribute-value:${name}`;
  }
  return authoredCount === canonical.length ? null : "attribute-missing";
}

function comparableChild(
  inspection: TrustedDomInspection,
  node: ChildNode | null,
): ChildNode | null {
  // Range.deleteContents()/insertNode() can leave zero-length Text objects
  // that have no source bytes or rendered content. All non-empty nodes still
  // participate in the exact subtree proof.
  let candidate = node;
  while (
    candidate
    && inspection.nodeType(candidate) === Node.TEXT_NODE
    && inspection.nodeValue(candidate) === ""
  ) {
    candidate = inspection.next(candidate);
  }
  return candidate;
}

function adjacentTextRun(
  inspection: TrustedDomInspection,
  node: ChildNode | null,
): Readonly<{ value: string; next: ChildNode | null }> | null {
  if (!node || inspection.nodeType(node) !== Node.TEXT_NODE) return null;
  let value = "";
  let candidate: ChildNode | null = node;
  while (candidate && inspection.nodeType(candidate) === Node.TEXT_NODE) {
    value += inspection.nodeValue(candidate) ?? "";
    candidate = inspection.next(candidate);
  }
  return Object.freeze({
    value,
    next: comparableChild(inspection, candidate),
  });
}

function runtimeNodeMatchesSource(
  liveNode: Node,
  canonicalNode: Node,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
  hasRuntimeShadowRoot: ((element: HTMLElement) => boolean) | null,
  mismatch: { diagnostic: string | null } | null = null,
  path = "root",
): boolean {
  const inspection = TRUSTED_DOM_INSPECTION;
  const fail = (diagnostic: string) => {
    if (mismatch && !mismatch.diagnostic) mismatch.diagnostic = `${path}:${diagnostic}`;
    return false;
  };
  if (!inspection) return fail("trusted-inspection-unavailable");
  const liveNodeType = inspection.nodeType(liveNode);
  if (liveNodeType !== inspection.nodeType(canonicalNode)) return fail("node-type");
  if (liveNodeType !== Node.ELEMENT_NODE) {
    return inspection.nodeValue(liveNode) === inspection.nodeValue(canonicalNode)
      || fail("node-value");
  }
  const liveElement = liveNode as HTMLElement;
  const canonicalElement = canonicalNode as HTMLElement;
  const liveLocalName = inspection.localName(liveElement);
  if (liveLocalName !== inspection.localName(canonicalElement)) return fail("tag-name");
  if (inspection.namespace(liveElement) !== inspection.namespace(canonicalElement)) {
    return fail("namespace");
  }
  if (inspection.shadowRoot(liveElement) || hasRuntimeShadowRoot?.(liveElement)) {
    return fail("shadow-root");
  }
  if (isOpaqueOrProgramCopyElement(liveLocalName)) return fail("opaque-or-program");
  if (isProvenRuntimeSourceElement && !isProvenRuntimeSourceElement(liveElement)) {
    return fail("runtime-source-proof");
  }
  if (!attributesMatch(inspection, liveElement, canonicalElement)) {
    return fail(attributeMismatchDiagnostic(inspection, liveElement, canonicalElement) ?? "attributes");
  }
  let liveChild = comparableChild(inspection, inspection.child(liveElement));
  let canonicalChild = comparableChild(inspection, inspection.child(canonicalElement));
  let childIndex = 0;
  while (liveChild && canonicalChild) {
    const liveText = adjacentTextRun(inspection, liveChild);
    const canonicalText = adjacentTextRun(inspection, canonicalChild);
    if (liveText || canonicalText) {
      if (!liveText || !canonicalText || liveText.value !== canonicalText.value) {
        return fail("adjacent-text-run");
      }
      liveChild = liveText.next;
      canonicalChild = canonicalText.next;
      childIndex += 1;
      continue;
    }
    if (!runtimeNodeMatchesSource(
      liveChild,
      canonicalChild,
      isProvenRuntimeSourceElement,
      hasRuntimeShadowRoot,
      mismatch,
      `${path}/${liveLocalName}[${childIndex}]`,
    )) return false;
    liveChild = comparableChild(inspection, inspection.next(liveChild));
    canonicalChild = comparableChild(inspection, inspection.next(canonicalChild));
    childIndex += 1;
  }
  return (liveChild === null && canonicalChild === null) || fail("child-count");
}

type RuntimeSubtreeAssessment =
  | "match"
  | "canonical-source-unavailable"
  | "canonical-target-unavailable"
  | `runtime-subtree-diverged:${string}`;

function assessRuntimeSubtreeAgainstSource(
  root: HTMLElement,
  sourceIndex: SourceIndexValue,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
  hasRuntimeShadowRoot: ((element: HTMLElement) => boolean) | null,
): RuntimeSubtreeAssessment {
  const inspection = TRUSTED_DOM_INSPECTION;
  if (!inspection) return "canonical-source-unavailable";
  try {
    const pagerootId = inspection.attributeValue(root, PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (!pagerootId) return "canonical-target-unavailable";
    const canonicalSource = canonicalCopySource(sourceIndex);
    if (!canonicalSource) return "canonical-source-unavailable";
    const canonicalRoot = canonicalSource?.rootsByPagerootId.get(pagerootId) ?? null;
    if (!canonicalRoot) return "canonical-target-unavailable";
    const mismatch = { diagnostic: null as string | null };
    const matches = runtimeNodeMatchesSource(
      root,
      canonicalRoot,
      isProvenRuntimeSourceElement,
      hasRuntimeShadowRoot,
      mismatch,
    );
    return matches ? "match" : `runtime-subtree-diverged:${mismatch.diagnostic ?? "unknown"}`;
  } catch {
    return "runtime-subtree-diverged:exception";
  }
}

export function elementCopyAssessmentForTarget({
  element,
  sourceIndex,
  runtimeGenerated = false,
  runtimeExpected = false,
  transientBusy = false,
  isProvenRuntimeSourceElement = null,
  hasRuntimeShadowRoot = null,
}: {
  element: HTMLElement | null;
  sourceIndex: SourceIndexValue | null;
  runtimeGenerated?: boolean;
  runtimeExpected?: boolean;
  transientBusy?: boolean;
  isProvenRuntimeSourceElement?: ((element: HTMLElement) => boolean) | null;
  hasRuntimeShadowRoot?: ((element: HTMLElement) => boolean) | null;
}): ElementCopyAssessment {
  const inspection = TRUSTED_DOM_INSPECTION;
  if (runtimeGenerated) {
    return Object.freeze({ availability: "unsupported", reason: "runtime-generated-target" });
  }
  if (!element) return Object.freeze({ availability: "unsupported", reason: "target-missing" });
  if (!inspection) {
    return Object.freeze({
      availability: "unsupported",
      reason: "trusted-inspection-unavailable",
    });
  }
  if (!inspection.connected(element)) {
    return Object.freeze({ availability: "unsupported", reason: "target-disconnected" });
  }
  if (!sourceIndex) {
    return Object.freeze({ availability: "unsupported", reason: "source-index-missing" });
  }
  if (runtimeExpected && !isProvenRuntimeSourceElement) {
    return Object.freeze({ availability: "busy", reason: "runtime-source-proof-pending" });
  }
  const sourceMutationAuthority = runtimeExpected
    ? Boolean(isProvenRuntimeSourceElement?.(element))
    : Boolean(inspection.attributeValue(element, PAGEROOT_ELEMENT_ID_ATTRIBUTE));
  if (!sourceMutationAuthority) {
    return Object.freeze({
      availability: "unsupported",
      reason: "source-mutation-authority-missing",
    });
  }
  const subtreeAssessment = assessRuntimeSubtreeAgainstSource(
    element,
    sourceIndex,
    runtimeExpected ? isProvenRuntimeSourceElement : null,
    runtimeExpected ? hasRuntimeShadowRoot : null,
  );
  if (subtreeAssessment !== "match") {
    const runtimeDivergence = subtreeAssessment.startsWith("runtime-subtree-diverged:");
    const reason: ElementCopyAvailabilityReason = runtimeDivergence
      ? "runtime-subtree-diverged"
      : subtreeAssessment as "canonical-source-unavailable" | "canonical-target-unavailable";
    return Object.freeze({
      availability: "unsupported",
      reason,
      diagnostic: runtimeDivergence
        ? subtreeAssessment.slice("runtime-subtree-diverged:".length)
        : undefined,
    });
  }
  if (transientBusy) {
    return Object.freeze({ availability: "busy", reason: "transition-busy" });
  }
  return Object.freeze({ availability: "available", reason: "available" });
}

export function elementCopyAvailabilityForTarget(
  input: Parameters<typeof elementCopyAssessmentForTarget>[0],
): ElementCopyAvailability {
  return elementCopyAssessmentForTarget(input).availability;
}

export function canStartNativeTextEditAtTarget({
  documentNode,
  element,
  point,
  sourceIndex,
}: {
  documentNode: Document;
  element: HTMLElement | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
}): boolean {
  if (!element || !sourceIndex || !documentNode) return false;
  const islandHost = nativeEditHostForElement(element, sourceIndex);
  if (!islandHost) return false;
  // Hovering a module box, including its padding and gap, selects that module.
  // Nested text hosts still advertise in-place editing.
  if (inferSelectionLevel(element) === "module") return false;
  if (!point) return true;
  return Boolean(identifyingTextRangeAtPoint(documentNode, islandHost, point));
}

export type ResolvedCanvasTarget = Readonly<{
  /** The precise runtime/source DOM object under the pointer. */
  hitElement: HTMLElement;
  /** Runtime targets remain comment-only and ambiguous. */
  operationTarget: HTMLElement;
  /** The object whose geometry owns hover, selected chrome and the toolbar. */
  visualTarget: HTMLElement;
  /** The nearest privately proven exact source host used only for comments. */
  commentAnchor: SourceTargetRef | null;
  /** UI selection form of commentAnchor; never used as an operation target. */
  commentAnchorSelection: HtmlCanvasSelection | null;
  /** Compatibility alias for operationTarget. */
  targetElement: HTMLElement;
  /** Compatibility alias for visualTarget. */
  visualElement: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  targetKey: string;
  /** The visual continuity identity. It is intentionally not a persistence key. */
  visualKey: string;
  generation: number;
  runtimeGenerated: boolean;
}> & ReturnType<typeof canvasPointerCapabilityFromProof>;

export type CanvasTargetIdentityScope = {
  readonly generation: number;
  readonly targetObjectKeys: WeakMap<HTMLElement, string>;
  readonly visualObjectKeys: WeakMap<HTMLElement, string>;
  runtimeVisualTargetIndex: RuntimeVisualTargetIndex | null;
};

/** @deprecated Use ResolvedCanvasTarget. Kept as a narrow compatibility name. */
export type ResolvedCanvasPointerCapability = ResolvedCanvasTarget;

export type CanvasPointerHit =
  | Readonly<{ action: "clear" }>
  | Readonly<{
    action: "select";
    target: ResolvedCanvasTarget;
    /** @deprecated Use target. This alias keeps the pointer-hit envelope stable. */
    capability: ResolvedCanvasTarget;
  }>;

export type CanvasPointerHitInput = {
  documentNode: Document | null;
  eventTarget: EventTarget | null;
  point?: TextCaretPoint | null;
  sourceIndex: SourceIndexValue | null;
  enabled?: boolean;
  isProvenRuntimeSourceElement?: ((element: HTMLElement) => boolean) | null;
  /** Ephemeral DOM generation. It is never persisted with a selection. */
  generation?: number;
  /** Per-Canvas identity scope. A missing scope is compatibility-only. */
  identityScope?: CanvasTargetIdentityScope | null;
};

function normalizedGeneration(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

export function createCanvasTargetIdentityScope(
  generation = 0,
): CanvasTargetIdentityScope {
  return {
    generation: normalizedGeneration(generation),
    targetObjectKeys: new WeakMap<HTMLElement, string>(),
    visualObjectKeys: new WeakMap<HTMLElement, string>(),
    runtimeVisualTargetIndex: null,
  };
}

function transientTargetKeyForElement(
  element: HTMLElement,
  generation: number,
  objectKeys: WeakMap<HTMLElement, string>,
): string {
  const existing = objectKeys.get(element);
  if (existing) return existing;
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const key = `object:${generation}:${suffix}`;
  objectKeys.set(element, key);
  return key;
}

export function canvasTargetKeyFor({
  element,
  selection,
  sourceRef,
  generation = 0,
  identityScope,
  runtimeGenerated = false,
}: {
  element: HTMLElement;
  selection: HtmlCanvasSelection;
  sourceRef: SourceTargetRef | null;
  generation?: number;
  identityScope?: CanvasTargetIdentityScope | null;
  runtimeGenerated?: boolean;
}): string {
  const normalized = normalizedGeneration(generation);
  const scope = identityScope?.generation === normalized
    ? identityScope
    : createCanvasTargetIdentityScope(normalized);
  if (!runtimeGenerated) {
    const elementId = [sourceRef?.elementId, selection.elementId]
      .find((candidate) => isValidPagerootElementId(candidate));
    if (elementId) return `element:${elementId}`;
    if (sourceRef?.targetId) return `target:${sourceRef.targetId}`;
  }
  return transientTargetKeyForElement(
    element,
    normalized,
    scope.targetObjectKeys,
  );
}

function canvasVisualKeyFor({
  element,
  generation,
  identityScope,
  runtimeGenerated,
}: {
  element: HTMLElement;
  generation: number;
  identityScope?: CanvasTargetIdentityScope | null;
  runtimeGenerated: boolean;
}): string {
  const normalized = normalizedGeneration(generation);
  const scope = identityScope?.generation === normalized
    ? identityScope
    : createCanvasTargetIdentityScope(normalized);
  if (!runtimeGenerated) {
    const elementId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (isValidPagerootElementId(elementId)) return `element:${elementId}`;
  }
  return transientTargetKeyForElement(
    element,
    normalized,
    scope.visualObjectKeys,
  );
}

export function canvasVisualTargetElement(
  element: HTMLElement | null,
  sourceIndex: SourceIndexValue | null,
  options: { runtimeGenerated?: boolean } = {},
): HTMLElement | null {
  if (!element || !sourceIndex) return element;
  if (options.runtimeGenerated) {
    return runtimeVisualTargetElement(element) ?? element;
  }
  const dedicatedSurface = element.closest("svg, math") as HTMLElement | null;
  if (dedicatedSurface?.hasAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)) return dedicatedSurface;
  return nativeEditHostForElement(element, sourceIndex) ?? element;
}

function sourceRefForSelection(
  selection: HtmlCanvasSelection,
  runtimeGenerated: boolean,
): SourceTargetRef | null {
  if (
    runtimeGenerated
    || (selection.resolution !== "exact" && selection.resolution !== "rebound")
  ) return null;
  try {
    return sourceTargetRefForSelection(selection) as SourceTargetRef;
  } catch {
    return null;
  }
}

function canonicalTargetElement(
  hitElement: HTMLElement,
  dedicatedSurface: HTMLElement | null,
  sourceIndex: SourceIndexValue,
  runtimeGenerated: boolean,
): HTMLElement {
  // Dedicated surfaces own their own target semantics. SVG/MathML children
  // remain exact source targets while canvas/form/media roots stay atomic.
  if (dedicatedSurface || runtimeGenerated) return hitElement;
  return nativeEditHostForElement(hitElement, sourceIndex) ?? hitElement;
}

export function resolveCanvasTarget({
  documentNode,
  eventTarget,
  point,
  sourceIndex,
  enabled = true,
  isProvenRuntimeSourceElement = null,
  generation: rawGeneration = 0,
  identityScope: rawIdentityScope = null,
}: CanvasPointerHitInput): ResolvedCanvasTarget | null {
  if (!enabled || !documentNode || !sourceIndex) return null;
  if (isCanvasRootElement(eventTarget)) return null;
  const generation = normalizedGeneration(rawGeneration);
  const identityScope = rawIdentityScope?.generation === generation
    ? rawIdentityScope
    : createCanvasTargetIdentityScope(generation);
  if (
    isProvenRuntimeSourceElement
    && point
    && (
      !identityScope.runtimeVisualTargetIndex
      || identityScope.runtimeVisualTargetIndex.disposed
    )
  ) {
    identityScope.runtimeVisualTargetIndex = createRuntimeVisualTargetIndex(documentNode);
  }
  const dedicatedSurface = point
    ? findDedicatedSourceSurfaceAtPoint(documentNode, point)
    : null;
  const directSelection = findCanvasSelectionElement(eventTarget);
  const runtimeDirectSelection = findCanvasSelectionElement(eventTarget, {
    preserveRuntimeSurface: true,
  });
  const runtimePointTarget = point
    ? runtimeVisualTargetAtPoint({
        documentNode,
        point,
        isProvenSourceElement: isProvenRuntimeSourceElement,
        runtimeVisualTargetIndex: identityScope.runtimeVisualTargetIndex,
      })
    : null;
  // A dedicated surface such as <canvas> needs point-based selection so its
  // wrapping module is never selected. For a concrete child inside an SVG,
  // however, keep that child as the exact comment target instead of widening
  // the selection to the SVG root.
  const directSurfaceChild = dedicatedSurface
    && directSelection
    && directSelection !== dedicatedSurface
    && dedicatedSurface.contains(directSelection)
    ? directSelection
    : null;
  // In a Runtime frame, public source/stable-ID attributes are locators only.
  // The exact selected object must belong to the generation's sealed private
  // authority set; otherwise even a perfectly copied identity remains
  // display/comment-only.
  const runtimeGenerated = Boolean(
    runtimePointTarget
    || (
    isProvenRuntimeSourceElement
    && directSelection
    && !isProvenRuntimeSourceElement(directSelection)
    )
  ) || eventTargetsRuntimeGeneratedNode(
    eventTarget,
    isProvenRuntimeSourceElement,
  );
  const hit = runtimeGenerated
    ? directSurfaceChild
      ?? runtimePointTarget
      ?? runtimeDirectSelection
      ?? dedicatedSurface
      ?? directSelection
      ?? findCanvasHitSourceElement(eventTarget)
    : directSurfaceChild
      ?? dedicatedSurface
      ?? findCanvasHitSourceElement(eventTarget)
      ?? directSelection;
  if (
    !hit
    || (
      !runtimeGenerated
      && (hit === documentNode.body || hit === documentNode.documentElement)
    )
  ) {
    return null;
  }
  if (inferSelectionLevel(hit) === "module" && !moduleHasSubstance(hit)) return null;
  const canStartTextEdit = !dedicatedSurface
    && !runtimeGenerated
    && canStartNativeTextEditAtTarget({
      documentNode,
      element: hit,
      point,
      sourceIndex,
    });
  const targetElement = canonicalTargetElement(
    hit,
    dedicatedSurface,
    sourceIndex,
    runtimeGenerated,
  );
  const selection = runtimeGenerated
    ? selectionForElement(targetElement, null, undefined, "ambiguous")
    : selectionForElement(targetElement, sourceIndex);
  const sourceRef = sourceRefForSelection(selection, runtimeGenerated);
  const commentAnchorData = runtimeGenerated
    ? runtimeCommentAnchorForTarget(
        targetElement,
        documentNode,
        sourceIndex,
        isProvenRuntimeSourceElement,
      )
    : {
        element: targetElement,
        selection,
        ref: sourceRef,
      };
  const visualElement = runtimeGenerated
    ? runtimeVisualTargetElement(targetElement) ?? targetElement
    : canvasVisualTargetElement(
      targetElement,
      sourceIndex,
      { runtimeGenerated },
    ) ?? targetElement;
  const visualHint = runtimeGenerated && commentAnchorData?.element
    ? runtimeVisualHintForTarget({
        sourceHost: commentAnchorData.element,
        visualTarget: visualElement,
        cache: identityScope.runtimeVisualTargetIndex?.hintCache,
      })
    : null;
  const selectionWithVisualHint = visualHint
    ? {
        ...selection,
        label: visualHint.label,
        visualHint,
      }
    : selection;
  const capability = canvasPointerCapabilityFromProof({
    canStartTextEdit,
    sourceResolution: selectionWithVisualHint.resolution as HtmlCanvasTargetResolution,
  });
  return Object.freeze({
    ...capability,
    hitElement: hit,
    targetElement,
    operationTarget: targetElement,
    visualTarget: visualElement,
    commentAnchor: commentAnchorData?.ref ?? null,
    commentAnchorSelection: commentAnchorData?.selection ?? null,
    visualElement,
    selection: selectionWithVisualHint,
    sourceRef,
    targetKey: canvasTargetKeyFor({
      element: targetElement,
      selection: selectionWithVisualHint,
      sourceRef,
      generation,
      identityScope,
      runtimeGenerated,
    }),
    visualKey: canvasVisualKeyFor({
      element: visualElement,
      generation,
      identityScope,
      runtimeGenerated,
    }),
    generation,
    runtimeGenerated,
  });
}

function runtimeCommentAnchorForTarget(
  targetElement: HTMLElement,
  documentNode: Document,
  sourceIndex: SourceIndexValue,
  isProvenRuntimeSourceElement: ((element: HTMLElement) => boolean) | null,
): {
  element: HTMLElement;
  selection: HtmlCanvasSelection;
  ref: SourceTargetRef;
} | null {
  if (!isProvenRuntimeSourceElement) return null;
  let current: HTMLElement | null = targetElement;
  while (current) {
    if (isProvenRuntimeSourceElement(current)) {
      const rawSelection = selectionForElement(
        current,
        sourceIndex,
        undefined,
        "exact",
      );
      const isPageRoot = current === documentNode.body
        || current === documentNode.documentElement;
      const selection = isPageRoot
        ? {
            ...rawSelection,
            label: "整个页面",
            selector: "body",
            level: "module" as const,
            tagName: "body",
            text: "",
            resolution: "exact" as const,
          }
        : rawSelection;
      const ref = sourceTargetRefForSelection(selection) as SourceTargetRef;
      if (isValidPagerootElementId(selection.elementId)) {
        return { element: current, selection, ref };
      }
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveCanvasPointerHit(input: CanvasPointerHitInput): CanvasPointerHit {
  const target = resolveCanvasTarget(input);
  if (!target) return { action: "clear" };
  return {
    action: "select",
    target,
    capability: target,
  };
}

export function resolveCanvasPointerCapability(
  input: CanvasPointerHitInput,
): ResolvedCanvasPointerCapability | null {
  // Compatibility callers receive the canonical result directly. There is
  // deliberately no second visual/selection resolution in this exit.
  return resolveCanvasTarget(input);
}
