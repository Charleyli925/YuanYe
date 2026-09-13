import type {
  ReviewSemanticAlignmentMatch,
} from "../../lib/review-semantic-alignment.js";
import type {
  ReviewTextChangeOperation,
} from "../../lib/review-text-diff.js";
import type { CommentItem } from "../types";
import type {
  ReviewVisualSourceBinding,
  SourceEvidence,
} from "./review-visual-model.js";
export type ReviewFilter = "all" | "text" | "structure";
export type ReviewChangeType = Exclude<ReviewFilter, "all">;
export type ReviewSide = "before" | "after";
export type ReviewRevealStep =
  | { kind: "panel"; key: string }
  | { kind: "details"; stableId: string };
export type ReviewPresentation = Record<ReviewSide, ReviewRevealStep[]>;
export type ReviewDiagnostic = {
  kind: "css-source" | "script-source";
  summary: string;
};

/** Disposable annotation outcome; never Candidate or adoption authority. */
export type ReviewAnnotationAvailability = "available" | "unavailable";

export type ReviewChange = {
  id: string;
  /** Stable-ID hosts that carry this source fact. One fact may span many hosts. */
  evidenceStableIds?: string[];
  label: string;
  helper: string;
  types: ReviewChangeType[];
  beforePresent: boolean;
  afterPresent: boolean;
  presentation: ReviewPresentation;
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  presentation?: ReviewPresentation;
  types: ReviewChangeType[];
};

export type ReviewDocuments = {
  annotationAvailability: ReviewAnnotationAvailability;
  before: string;
  after: string;
  bootstrapJavaScript: Record<ReviewSide, string>;
  bootstrapFallbackJavaScript: Record<ReviewSide, string>;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
  focusGroups: ReviewFocusGroup[];
  commentGroups: ReviewCommentGroup[];
  commentTargets: ReviewCommentTarget[];
  /** Pending source candidates are private input to the frame observer. */
  visualBinding: ReviewVisualSourceBinding;
  visualEvidence: SourceEvidence[];
  diagnostics: ReviewDiagnostic[];
  reviewImpact?: ReviewImpact;
};

export type ReviewDisplayScope =
  | "paragraph"
  | "list-item"
  | "cell"
  | "component"
  | "container";

export type ReviewFocusGeometryMode =
  | "text-content"
  | "element-box"
  | "container-box"
  | "numbered-line-range";

export type ReviewFocusOutlinePolicy =
  | "never"
  | "source-change"
  | "visual-change";

export type ReviewFocusGroupPlan = {
  id: string;
  kind: "text" | "style" | "structure";
  changeId: string;
  changeIds: string[];
  displayGroupId: string;
  displayScope: ReviewDisplayScope;
  /**
   * A source fact can remain visible and navigable without claiming that a
   * visible outline is useful. Runtime geometry never upgrades this policy.
   */
  focusOutlinePolicy: ReviewFocusOutlinePolicy;
  /** changeId-scoped references whose fact portion is reviewProjectionFactKey. */
  atomKeys: string[];
  presentation: ReviewPresentation;
  /** Analyzer-owned plans; Runtime may only measure these declared regions. */
  regions: Record<ReviewSide, ReviewFocusRegionPlan[]>;
  presence: Record<ReviewSide, boolean>;
};

/** Compatibility alias while the public contract adopts the explicit Plan name. */
export type ReviewFocusGroup = ReviewFocusGroupPlan;

export type ReviewFocusRegionPlan = {
  id: string;
  side: ReviewSide;
  /** Stable reading-block cue identity; several selectable regions may share it. */
  navigationClusterId: string;
  /** Short authored-content cue used to distinguish repeated localities in the directory. */
  contentCue: string;
  correlationKey: string;
  primaryChangeId: string;
  changeIds: string[];
  geometryMode: ReviewFocusGeometryMode;
  displayOwnerIds: string[];
  /** Stable visual candidates owned by this exact region; empty means no visual proof. */
  visualEvidenceStableIds: string[];
  atomKeys: string[];
  presentation: ReviewRevealStep[];
};

export type ReviewImpact = {
  requestedTargetCount: number;
  actualChangedElementCount: number;
  outsideRequestedTargetCount: number;
  changedElementIdSample: string[];
  outsideTargetElementIdSample: string[];
  truncated: boolean;
};

export type ReviewCommentGroup = {
  key: string;
  items: Array<{
    text: string;
    attachmentCount: number;
  }>;
};

export type ReviewCommentTarget = {
  key: string;
  global: boolean;
  stableId?: string;
  selector?: string;
  /** Private bootstrap identity key; always a Stable ID, never a parseKey. */
  sourceNodeId?: string;
};

export type ReviewDocumentBuildOptions = {
  sessionId: string;
  sourcePath?: string;
  externalBootstrap?: boolean;
  comments?: readonly CommentItem[];
  reviewImpact?: ReviewImpact;
};

export type ReviewCommentAnnotations = {
  groups: ReviewCommentGroup[];
  targets: ReviewCommentTarget[];
};

export type ReviewTextInventory = {
  text: string;
  nodes: Array<{ node: Text; start: number; end: number; nodeOffset: number }>;
  breakOffsets: number[];
};

export type ReviewAttributeRole = "stable-identity" | "structural" | "presentation" | "disposable";

export type ReviewSignatureCache = {
  stableIdentity: WeakMap<Element, string | null>;
  selfCompatibility: WeakMap<Element, string>;
  exactSubtree: WeakMap<Element, string>;
};

export type SectionPair = {
  before: Element | null;
  after: Element | null;
  beforeIndex: number;
  afterIndex: number;
};

export type ReviewBootstrapElementBinding = {
  path: number[];
  tagName: string;
  sourceBoxSignature: string;
  identityAttributes: Array<[string, string]>;
  identityText?: string;
};

export type ReviewCommentBootstrapBinding = ReviewBootstrapElementBinding & {
  sourceNodeId: string;
};

export type ReviewSemanticUnitKind =
  | "section"
  | "container"
  | "leaf-text-block"
  | "direct-flow"
  | "br-line"
  | "atomic-content"
  | "list"
  | "list-item"
  | "table"
  | "row-group"
  | "table-row"
  | "table-cell";

export type ReviewSemanticUnit = {
  kind: ReviewSemanticUnitKind;
  element: Element;
  inventory: ReviewTextInventory | null;
  children: ReviewSemanticUnit[];
  columnStart?: number;
  columnSpan?: number;
};

export type ReviewSemanticPairNode = {
  before: ReviewSemanticUnit | null;
  after: ReviewSemanticUnit | null;
  match: ReviewSemanticAlignmentMatch;
  semanticOwnerId: string;
  geometryOwnerId: string;
  structureFallback: boolean;
  children: ReviewSemanticPairNode[];
};

export type ReviewSemanticPairGraph = {
  root: ReviewSemanticPairNode;
  signatures: ReviewSignatureCache;
};

export type TextRange = { start: number; end: number };

export type ReviewTextEvidenceGroup = {
  id: string;
  ranges: TextRange[];
  operation: ReviewTextChangeOperation;
  semanticOwnerId: string;
  geometryOwnerId: string;
  displayGroupId: string;
  displayOwnerId: string;
  displayScope: ReviewDisplayScope;
  geometryMode: ReviewFocusGeometryMode;
};
