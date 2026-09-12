// Review analysis facade: source facts (parse → pair → diff) then
// comment-binding / session projection. The analysis cache stores only
// source facts; comments and Frame identity are applied afterwards.
import {
  appendTrustedReviewProjectionFact,
  ReviewProjectionFactOverflowError,
  normalizeReviewFocusGroupPlans,
  reviewProjectionFactKey,
  serializeReviewProjectionFacts,
} from "../lib/review-projection-facts.js";
import {
  prepareReviewCommentSourceProjection,
} from "../lib/review-comment-source-map.js";
import {
  annotateReviewComments,
  clearReviewCommentScopeAttributes,
  reviewCommentBootstrapBindings,
} from "./review/comment-binding";
import {
  REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE,
  REVIEW_PROJECTION_FACTS_ATTRIBUTE,
} from "./review/constants";
import {
  annotateActionPairs,
  annotatePanelPairs,
  candidateSections,
  changeLabel,
  clearReservedReviewMarkup,
  helperText,
  normalizedMarkup,
  regionGroupLabel,
  reviewProjectionFactsForElement,
} from "./review/parse";
import {
  reviewBootstrap,
} from "./review/runtime-projection";
import {
  buildReviewVisualEvidence,
} from "./review/review-visual-model.js";
import {
  buildReviewSemanticPairGraphSteps,
  pairSections,
} from "./review/semantic-pairing";
import {
  prepareDocument,
  serializeReviewMarkup,
} from "./review/serialize";
import {
  markStructureDifferenceSteps,
} from "./review/structure-diff";
import {
  markSemanticTextDifferences,
} from "./review/text-diff";
import {
  annotateStableSourceDifferences,
} from "./review/stable-source-diff";
import type {
  ReviewVisualSourceBinding,
  SourceEvidence,
} from "./review/review-visual-model.js";
import type {
  ReviewChange,
  ReviewAnnotationAvailability,
  ReviewChangeType,
  ReviewDiagnostic,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewDisplayScope,
  ReviewFocusGeometryMode,
  ReviewFocusOutlinePolicy,
  ReviewFocusGroup,
  ReviewOutlineItem,
  ReviewPresentation,
  ReviewRevealStep,
  ReviewSemanticPairGraph,
  SectionPair,
} from "./review/types";

export {
  REVIEW_STRUCTURE_TONE_COLOR,
} from "./review/tones";
export type {
  ReviewChange,
  ReviewChangeType,
  ReviewCommentGroup,
  ReviewCommentTarget,
  ReviewDiagnostic,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewImpact,
  ReviewPresentation,
  ReviewRevealStep,
  ReviewFilter,
  ReviewFocusGeometryMode,
  ReviewFocusOutlinePolicy,
  ReviewFocusGroup,
  ReviewFocusGroupPlan,
  ReviewFocusRegionPlan,
  ReviewOutlineItem,
  ReviewSide,
} from "./review/types";

export type ReviewSourceFacts = {
  annotationAvailability: ReviewAnnotationAvailability;
  annotatedBeforeHtml: string;
  annotatedAfterHtml: string;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
  focusGroups: ReviewFocusGroup[];
  diagnostics: ReviewDiagnostic[];
  visualBinding: ReviewVisualSourceBinding;
  visualEvidence: SourceEvidence[];
};

function* changeTypesForSemanticGraphSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const structureChanged = yield* markStructureDifferenceSteps(graph);
  const textMarking = markSemanticTextDifferences(graph);
  return [
    ...(textMarking.changed ? ["text" as const] : []),
    ...(structureChanged ? ["structure" as const] : []),
  ];
}

function* annotateChangePairSteps(
  pair: SectionPair,
  usePersistentIdentity: boolean,
  ambiguousPersistentIds: ReadonlySet<string>,
  ownerNamespace: string,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const graph = yield* buildReviewSemanticPairGraphSteps(pair, {
    usePersistentIdentity,
    ambiguousPersistentIds,
    ownerNamespace,
  });
  return yield* changeTypesForSemanticGraphSteps(graph);
}

function* annotateMovedStableSubtreeSteps(
  movedPairs: Array<{
    id: string;
    before: Element;
    after: Element;
    outermost: boolean;
  }>,
  ambiguousPersistentIds: ReadonlySet<string>,
): Generator<"semantic-row", void, void> {
  for (const movedPair of movedPairs) {
    const graph = yield* buildReviewSemanticPairGraphSteps({
      before: movedPair.before,
      after: movedPair.after,
      beforeIndex: -1,
      afterIndex: -1,
    }, {
      usePersistentIdentity: true,
      ambiguousPersistentIds,
      ownerNamespace: `moved-${movedPair.id}`,
    });
    if (movedPair.outermost) yield* markStructureDifferenceSteps(graph);
    markSemanticTextDifferences(graph);
    movedPair.before.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
    movedPair.after.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
  }
}

function attachChangeMarkerMetadata(
  pair: SectionPair,
  changeId: string,
  helper: string,
  includeDescendants = true,
) {
  const structureSummary = (change: string) => ({
    added: "新增元素",
    removed: "删除元素",
    moved: "移动元素",
    reordered: "元素顺序调整",
    attribute: "属性调整",
    style: "样式调整",
  }[change] || "元素调整");
  const attachRoots = (roots: Array<Element | null>) => roots.forEach((root) => {
    if (!root) return;
    [root, ...(includeDescendants
      ? root.querySelectorAll("[data-pageroot-review-text-anchors]")
      : [])]
      .filter((element) => element.hasAttribute("data-pageroot-review-text-anchors"))
      .forEach((element) => {
        element.setAttribute("data-pageroot-review-anchor-change", changeId);
      });
    const markerElements = [root, ...(includeDescendants ? root.querySelectorAll("*") : [])]
      .filter((element) => (
      element.hasAttribute("data-pageroot-review-text")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE)
    ));
    markerElements.forEach((element, index) => {
      let facts = reviewProjectionFactsForElement(element);
      const textMarker = element.hasAttribute("data-pageroot-review-text");
      const textOperation = element.getAttribute("data-pageroot-review-text-operation");
      const normalizedTextOperation = textOperation === "none"
        || textOperation === "insert"
        || textOperation === "delete"
        || textOperation === "replace"
        ? textOperation
        : null;
      const textSummary = textMarker
        ? textOperation === "insert"
          ? "新增内容"
          : textOperation === "delete"
            ? "删除内容"
            : "文本调整"
        : "";
      if (textMarker) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-text-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const textGroup = element.getAttribute("data-pageroot-review-text-group")
          || `text-marker-${index + 1}`;
        const displayGroupId = element.getAttribute("data-pageroot-review-display-group")
          || `display-${semanticOwnerId}`;
        const displayOwnerId = element.getAttribute("data-pageroot-review-display-owner-ref")
          || element.getAttribute("data-pageroot-review-display-owner")
          ?.split(/\s+/u).find(Boolean)
          || `display-owner-${semanticOwnerId}`;
        const displayScope = element.getAttribute("data-pageroot-review-display-scope")
          || "paragraph";
        const geometryMode = element.getAttribute("data-pageroot-review-geometry-mode")
          || "text-content";
        facts = appendTrustedReviewProjectionFact(facts, {
          id: textGroup,
          type: "text",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "text",
          tone: element.getAttribute("data-pageroot-review-text") === "removed"
            ? "removed"
            : "added",
          textGroup,
          displayGroupId,
          displayOwnerId,
          displayScope,
          geometryMode,
          ...(normalizedTextOperation ? { operation: normalizedTextOperation } : {}),
          summary: textSummary,
        });
      }
      if (element.hasAttribute("data-pageroot-review-structure")) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-structure-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
        const displayGroupId = element.getAttribute("data-pageroot-review-display-group")
          || `display-${semanticOwnerId}`;
        const displayOwnerId = element.getAttribute("data-pageroot-review-display-owner-ref")
          || element.getAttribute("data-pageroot-review-display-owner")
          ?.split(/\s+/u).find(Boolean)
          || `display-owner-${semanticOwnerId}`;
        const displayScope = element.getAttribute("data-pageroot-review-display-scope")
          || "container";
        const geometryMode = element.getAttribute("data-pageroot-review-geometry-mode")
          || "element-box";
        if (!facts.some((fact) => (
          fact.type === "structure"
          && fact.semanticOwnerId === semanticOwnerId
          && fact.structureChange === structureChange
        ))) {
          facts = appendTrustedReviewProjectionFact(facts, {
            id: `structure-${semanticOwnerId}-${structureChange}`,
            type: "structure",
            semanticOwnerId,
            ...(geometryOwnerId ? { geometryOwnerId } : {}),
            scope: "element",
            displayGroupId,
            displayOwnerId,
            displayScope,
            geometryMode,
            structureChange,
            summary: structureSummary(structureChange),
          });
        }
      }
      const markerTypes = [...new Set(facts.map((fact) => fact.type))] as ReviewChangeType[];
      const textFact = facts.find((fact) => fact.type === "text");
      const structureFact = facts.find((fact) => fact.type === "structure");
      const summary = textFact?.summary
        || structureFact?.summary
        || helper;
      element.setAttribute("data-pageroot-review-marker", changeId);
      element.setAttribute("data-pageroot-review-marker-types", markerTypes.join(" "));
      element.setAttribute("data-pageroot-review-summary", summary);
      element.setAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE, serializeReviewProjectionFacts(facts));
      element.setAttribute("data-pageroot-review-active", "false");
      if (index === 0) element.setAttribute("data-pageroot-review-primary", "true");
    });
  });
  attachRoots([pair.before, pair.after]);
}

function reviewFocusGroupsForDocuments(
  beforeDocument: Document,
  afterDocument: Document,
): ReviewFocusGroup[] {
  type MutableGroup = {
    changeIds: Set<string>;
    displayGroupId: string;
    displayScope: ReviewDisplayScope;
    kinds: Set<"text" | "style" | "structure">;
    focusOutlinePolicies: Set<ReviewFocusOutlinePolicy>;
    sideEntries: Record<"before" | "after", Array<{
      changeId: string;
      atomKey: string;
      ownerId: string;
      element: Element;
      geometryMode: ReviewFocusGeometryMode;
      locality: string;
      stableId: string;
      contentCue: string;
    }>>;
  };
  const shortHash = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  };
  const localPath = (element: Element | null) => {
    if (!element) return "root";
    const path: string[] = [];
    const stableElement = element.closest("[data-pageroot-id]");
    const stable = stableElement?.getAttribute("data-pageroot-id") || "";
    let candidate: Element | null = element;
    while (
      candidate?.parentElement
      && candidate !== candidate.ownerDocument.body
      && candidate !== stableElement
    ) {
      path.unshift(`${candidate.localName}-${[...candidate.parentElement.children].indexOf(candidate)}`);
      candidate = candidate.parentElement;
      if (path.length >= 12) break;
    }
    return stable
      ? `stable-${stable}-${shortHash(path.join("/") || "self")}`
      : `path-${shortHash(path.join("/"))}`;
  };
  const isRepeatedContainer = (element: Element) => {
    if (element.children.length < 2) return false;
    const roleCounts = new Map<string, number>();
    [...element.children].forEach((child) => {
      [...child.classList].forEach((className) => {
        if (!/(?:^|-)(?:card|tile|metric|kpi|stat)(?:-|$)/iu.test(className)) return;
        const role = className.toLowerCase();
        roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
      });
    });
    return [...roleCounts.values()].some((count) => count >= 2);
  };
  const stylesheetCollectionSelectors = new WeakMap<Document, string[]>();
  const collectionSelectorsForDocument = (document: Document) => {
    const cached = stylesheetCollectionSelectors.get(document);
    if (cached) return cached;
    const selectors: string[] = [];
    document.querySelectorAll("style").forEach((style) => {
      const source = (style.textContent || "").replace(/\/\*[\s\S]*?\*\//gu, "");
      const pattern = /([^{}]+)\{([^{}]*)\}/gu;
      let match = pattern.exec(source);
      while (match) {
        if (/(?:^|;)\s*display\s*:\s*(?:inline-)?(?:grid|flex)\b/iu.test(match[2])) {
          match[1].split(",").map((selector) => selector.trim()).forEach((selector) => {
            if (selector && !selector.startsWith("@")) selectors.push(selector);
          });
        }
        match = pattern.exec(source);
      }
    });
    stylesheetCollectionSelectors.set(document, selectors);
    return selectors;
  };
  const matchesStylesheetCollection = (element: Element) => collectionSelectorsForDocument(
    element.ownerDocument,
  ).some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
  const isStyleCollectionContainer = (element: Element) => {
    const authoredStyle = element.getAttribute("style") || "";
    return element.matches("ul, ol, [role='list']")
      || /(?:^|;)\s*display\s*:\s*(?:inline-)?(?:grid|flex)\b/iu.test(authoredStyle)
      || matchesStylesheetCollection(element)
      || isRepeatedContainer(element);
  };
  const styleLocality = (element: Element) => {
    let candidate = element.parentElement;
    while (
      candidate
      && candidate !== candidate.ownerDocument.body
      && candidate !== candidate.ownerDocument.documentElement
      && candidate.tagName !== "MAIN"
    ) {
      if (isStyleCollectionContainer(candidate)) return localPath(candidate);
      if (candidate.matches(
        "article, section, aside, nav, header, footer, form, fieldset, table, [role='group']",
      )) break;
      candidate = candidate.parentElement;
    }
    // Without a collection boundary, each CSS target is its own locality.
    // Runtime may only promote members already placed in one analyzer region.
    return localPath(element);
  };
  const groups = new Map<string, MutableGroup>();
  ([
    ["before", beforeDocument],
    ["after", afterDocument],
  ] as const).forEach(([side, document]) => {
    document.querySelectorAll(`[${REVIEW_PROJECTION_FACTS_ATTRIBUTE}][data-pageroot-review-marker]`)
      .forEach((element) => {
        const changeId = element.getAttribute("data-pageroot-review-marker") || "";
        reviewProjectionFactsForElement(element).forEach((fact) => {
          const displayGroupId = fact.displayGroupId || `display-fact-${fact.id}`;
          const displayOwnerId = fact.displayOwnerId
            || fact.geometryOwnerId
            || fact.semanticOwnerId;
          const displayScope = fact.displayScope || (fact.type === "text" ? "paragraph" : "container");
          const geometryMode = fact.geometryMode || (fact.type === "text"
            ? "text-content" as const
            : "element-box" as const);
          const sharedStyleGroup = fact.type === "structure" && fact.structureChange === "style";
          const key = sharedStyleGroup ? displayGroupId : `${changeId}-${displayGroupId}`;
          let group = groups.get(key);
          if (!group) {
            group = {
              changeIds: new Set(),
              displayGroupId,
              displayScope,
              kinds: new Set(),
              focusOutlinePolicies: new Set(),
              sideEntries: { before: [], after: [] },
            };
            groups.set(key, group);
          }
          group.changeIds.add(changeId);
          group.kinds.add(fact.type === "text"
            ? "text"
            : fact.structureChange === "style" ? "style" : "structure");
          group.focusOutlinePolicies.add(fact.type === "text"
            ? "never"
            : fact.structureChange === "style"
              ? "visual-change"
              : fact.structureChange === "attribute"
                ? "never"
                : "source-change");
          const factKey = reviewProjectionFactKey(fact);
          const atomKey = factKey ? `${changeId}\u001e${factKey}` : "";
          if (atomKey) group.sideEntries[side].push({
            changeId,
            atomKey,
            ownerId: displayOwnerId,
            element,
            geometryMode,
            locality: sharedStyleGroup ? styleLocality(element) : displayGroupId,
            stableId: element.closest("[data-pageroot-id]")
              ?.getAttribute("data-pageroot-id") || "",
            contentCue: (element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 80),
          });
        });
      });
  });
  return [...groups.values()].map((group) => {
    const changeIds = [...group.changeIds].sort();
    const changeId = changeIds[0] || "";
    const atomKeys = [...new Set(
      [...group.sideEntries.before, ...group.sideEntries.after].map((entry) => entry.atomKey),
    )].sort();
    const regions = (side: "before" | "after") => {
      const buckets = new Map<string, typeof group.sideEntries.before>();
      const sideEntries = group.sideEntries[side];
      sideEntries.forEach((entry) => {
        const regionLocality = `${entry.locality}\u001f${entry.ownerId}`;
        const bucket = buckets.get(regionLocality) || [];
        bucket.push(entry);
        buckets.set(regionLocality, bucket);
      });
      return [...buckets.entries()].map(([regionLocality, entries]) => {
        const locality = entries[0]?.locality || regionLocality;
        const ownerIds = [...new Set(entries.map((entry) => entry.ownerId))].sort();
        const regionAtomKeys = [...new Set(entries.map((entry) => entry.atomKey))].sort();
        const regionChangeIds = [...new Set(entries.map((entry) => entry.changeId))].sort();
        const visualEvidenceStableIds = [...new Set(
          entries.map((entry) => entry.stableId).filter(Boolean),
        )].sort();
        const presentationOwner = entries[0]?.element.ownerDocument.querySelector(
          `[data-pageroot-review-display-owner~="${entries[0]?.ownerId || ""}"]`,
        );
        return {
          id: `region-${side}-${shortHash(`${group.displayGroupId}\u001f${regionLocality}`)}`,
          side,
          navigationClusterId: `reading-${shortHash(locality)}`,
          contentCue: entries.find((entry) => entry.contentCue)?.contentCue || "",
          correlationKey: `locality-${shortHash(regionLocality)}`,
          primaryChangeId: regionChangeIds[0] || changeId,
          changeIds: regionChangeIds,
          geometryMode: entries[0]?.geometryMode || "element-box" as const,
          displayOwnerIds: ownerIds,
          visualEvidenceStableIds,
          atomKeys: regionAtomKeys,
          presentation: revealStepsForElement(presentationOwner || entries[0]?.element || null),
        };
      });
    };
    const beforeRegions = regions("before");
    const afterRegions = regions("after");
    return {
      id: `focus-${group.kinds.has("style") ? group.displayGroupId : `${changeId}-${group.displayGroupId}`}`,
      kind: group.kinds.has("text")
        ? "text" as const
        : group.kinds.has("style") ? "style" as const : "structure" as const,
      changeId,
      changeIds,
      displayGroupId: group.displayGroupId,
      displayScope: group.displayScope,
      focusOutlinePolicy: group.focusOutlinePolicies.has("source-change")
        ? "source-change" as const
        : group.focusOutlinePolicies.has("visual-change")
          ? "visual-change" as const
          : "never" as const,
      atomKeys,
      presentation: {
        before: beforeRegions[0]?.presentation || [],
        after: afterRegions[0]?.presentation || [],
      },
      regions: { before: beforeRegions, after: afterRegions },
      presence: { before: beforeRegions.length > 0, after: afterRegions.length > 0 },
    };
  }).sort((left, right) => left.changeId.localeCompare(right.changeId)
    || left.id.localeCompare(right.id));
}

function visualStableIdsForChange(pair: SectionPair, changeId: string) {
  const stableIds = new Set<string>();
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    [root, ...root.querySelectorAll(`[data-pageroot-review-marker="${changeId}"]`)]
      .filter((element) => element.getAttribute("data-pageroot-review-marker") === changeId)
      .forEach((element) => {
        const stableHost = element.closest("[data-pageroot-id]");
        const stableId = stableHost?.getAttribute("data-pageroot-id") || "";
        if (stableId) stableIds.add(stableId);
      });
  });
  if (!stableIds.size) {
    const rootStableId = (pair.after || pair.before)?.getAttribute("data-pageroot-id") || "";
    if (rootStableId) stableIds.add(rootStableId);
  }
  return [...stableIds];
}

function revealStepsForElement(element: Element | null): ReviewRevealStep[] {
  if (!element) return [];
  const steps: ReviewRevealStep[] = [];
  let candidate: Element | null = element;
  while (candidate && candidate !== element.ownerDocument.body) {
    if (candidate.getAttribute("data-pageroot-review-panel-container") === "true") {
      const key = candidate.getAttribute("data-pageroot-review-panel-key") || "";
      if (key) steps.unshift({ kind: "panel", key });
    }
    if (candidate.tagName === "DETAILS") {
      const stableId = candidate.getAttribute("data-pageroot-id") || "";
      if (stableId) steps.unshift({ kind: "details", stableId });
    }
    candidate = candidate.parentElement;
  }
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = step.kind === "panel" ? `panel:${step.key}` : `details:${step.stableId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presentationElement(
  root: Element | null,
  changeId: string,
  evidenceStableIds: readonly string[],
): Element | null {
  if (!root) return null;
  const selector = `[data-pageroot-review-marker="${changeId}"]`;
  const markers = [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
  const preciseMarker = markers.find((element) => (
    element.matches("[data-pageroot-review-text],[data-pageroot-review-structure]")
  ));
  if (preciseMarker) return preciseMarker;
  const stableHost = [
    ...(root.hasAttribute("data-pageroot-id") ? [root] : []),
    ...root.querySelectorAll("[data-pageroot-id]"),
  ].find((element) => evidenceStableIds.includes(
    element.getAttribute("data-pageroot-id") || "",
  ));
  if (stableHost) return stableHost;
  return markers.find((element) => {
      const stableId = element.closest("[data-pageroot-id]")?.getAttribute("data-pageroot-id") || "";
      return evidenceStableIds.includes(stableId);
    })
    || markers.find((element) => element.getAttribute("data-pageroot-review-primary") === "true")
    || markers[0]
    || root;
}

function reviewPresentationForChange(
  pair: SectionPair,
  changeId: string,
  evidenceStableIds: readonly string[],
): ReviewPresentation {
  const preciseStableIds = [...new Set([pair.before, pair.after].flatMap((root) => {
    if (!root) return [];
    const selector = `[data-pageroot-review-marker="${changeId}"]`;
    return [
      ...(root.matches(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ].flatMap((element) => {
      if (!element.matches("[data-pageroot-review-text],[data-pageroot-review-structure]")) {
        return [];
      }
      const stableId = element.closest("[data-pageroot-id]")
        ?.getAttribute("data-pageroot-id") || "";
      return stableId ? [stableId] : [];
    });
  }))];
  const presentationStableIds = preciseStableIds.length
    ? preciseStableIds
    : evidenceStableIds;
  return {
    before: revealStepsForElement(presentationElement(
      pair.before,
      changeId,
      presentationStableIds,
    )),
    after: revealStepsForElement(presentationElement(
      pair.after,
      changeId,
      presentationStableIds,
    )),
  };
}

function hasPreannotatedStableDifference(pair: SectionPair): boolean {
  const selector = "[data-pageroot-review-text],[data-pageroot-review-structure]";
  return [pair.before, pair.after].some((root) => Boolean(
    root && (root.matches(selector) || root.querySelector(selector)),
  ));
}

function emptySourceFacts(
  beforeHtml: string,
  afterHtml: string,
  visual: ReturnType<typeof buildReviewVisualEvidence>,
  diagnostics: ReviewDiagnostic[] = [],
): ReviewSourceFacts {
  return {
    annotationAvailability: "available",
    annotatedBeforeHtml: beforeHtml,
    annotatedAfterHtml: afterHtml,
    changes: [],
    outline: [],
    focusGroups: [],
    diagnostics,
    visualBinding: visual.binding,
    visualEvidence: visual.evidence,
  };
}

function sourceFactsFromDocuments(
  beforeDocument: Document,
  afterDocument: Document,
  visual: ReturnType<typeof buildReviewVisualEvidence>,
  extras: Pick<ReviewSourceFacts, "annotationAvailability" | "changes" | "outline" | "focusGroups" | "diagnostics">,
): ReviewSourceFacts {
  return {
    annotatedBeforeHtml: serializeReviewMarkup(beforeDocument),
    annotatedAfterHtml: serializeReviewMarkup(afterDocument),
    visualBinding: visual.binding,
    visualEvidence: visual.evidence,
    ...extras,
  };
}

function* prepareReviewSourcePairSteps(
  beforeHtml: string,
  afterHtml: string,
): Generator<string, { beforeDocument: Document; afterDocument: Document }, void> {
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(beforeHtml, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  clearReservedReviewMarkup(beforeDocument);
  clearReservedReviewMarkup(afterDocument);
  yield "parse";
  annotatePanelPairs(beforeDocument, afterDocument);
  yield "panels";
  annotateActionPairs(beforeDocument, afterDocument);
  yield "actions";
  return { beforeDocument, afterDocument };
}

function* annotateReviewSourceFactSteps(
  beforeDocument: Document,
  afterDocument: Document,
  visual: ReturnType<typeof buildReviewVisualEvidence>,
): Generator<string, Pick<ReviewSourceFacts, "changes" | "outline" | "focusGroups" | "diagnostics">, void> {
  const stableSourceAnalysis = annotateStableSourceDifferences(beforeDocument, afterDocument);
  const ambiguousPersistentIds = new Set(stableSourceAnalysis.ambiguousPersistentIds);
  yield "stable-source";
  if (
    visual.binding.identity === "supported"
    && visual.evidence.length === 0
    && stableSourceAnalysis.sourceKinds.length > 0
    && !beforeDocument.querySelector("[data-pageroot-review-structure]")
    && !afterDocument.querySelector("[data-pageroot-review-structure]")
  ) {
    const diagnostics: ReviewDiagnostic[] = stableSourceAnalysis.sourceKinds.map((kind) => ({
      kind,
      summary: kind === "css-source" ? "CSS 源码发生变化" : "Script 源码发生变化",
    }));
    return {
      changes: [],
      outline: [],
      focusGroups: [],
      diagnostics,
    };
  }
  // Freeze authored candidate regions and their pairing before moved-text
  // annotation inserts disposable review spans. The pre-pass may mutate text
  // nodes, but it must never redefine which authored element owns a movement.
  const beforeSections = candidateSections(beforeDocument);
  yield "candidate-sections-before";
  const afterSections = candidateSections(afterDocument);
  yield "candidate-sections-after";
  const pairs = pairSections(beforeSections, afterSections, {
    usePersistentIdentity: stableSourceAnalysis.hasPersistentContinuity,
    ambiguousPersistentIds,
  });
  yield* annotateMovedStableSubtreeSteps(
    stableSourceAnalysis.movedPairs,
    ambiguousPersistentIds,
  );
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];
  yield "section-pairing";

  for (const [pairIndex, pair] of pairs.entries()) {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const exactStablePair = Boolean(
      pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after)
      && !hasPreannotatedStableDifference(pair)
    );
    let types: ReviewChangeType[] = [];
    if (!exactStablePair) {
      const annotationSteps = annotateChangePairSteps(
        pair,
        stableSourceAnalysis.hasPersistentContinuity,
        ambiguousPersistentIds,
        `section-${pairIndex + 1}`,
      );
      let annotationStep = annotationSteps.next();
      while (!annotationStep.done) {
        yield annotationStep.value;
        annotationStep = annotationSteps.next();
      }
      types = annotationStep.value;
    }
    const changeId = types.length ? `change-${changes.length + 1}` : undefined;
    const helper = types.length
      ? helperText(types, Boolean(pair.before), Boolean(pair.after), pair)
      : "本轮未修改";
    if (changeId) attachChangeMarkerMetadata(pair, changeId, helper);
    const evidenceStableIds = changeId ? visualStableIdsForChange(pair, changeId) : [];
    const presentation = changeId
      ? reviewPresentationForChange(pair, changeId, evidenceStableIds)
      : undefined;
    [pair.before, pair.after].forEach((element) => {
      if (!element) return;
      element.setAttribute("data-pageroot-outline-id", outlineId);
      element.setAttribute("data-pageroot-review-active", "false");
      if (changeId) {
        element.setAttribute("data-pageroot-review-id", changeId);
        element.setAttribute("data-pageroot-review-types", types.join(" "));
        element.setAttribute("data-pageroot-review-summary", helper);
      }
    });
    if (changeId) {
      changes.push({
        id: changeId,
        ...(evidenceStableIds.length ? { evidenceStableIds } : {}),
        label,
        helper,
        types,
        beforePresent: Boolean(pair.before),
        afterPresent: Boolean(pair.after),
        presentation: presentation!,
      });
    }
    const preferredElement = pair.after || pair.before;
    const preferredDocument = pair.after ? afterDocument : beforeDocument;
    outline.push({
      id: outlineId,
      group: regionGroupLabel(preferredElement, preferredDocument),
      label,
      helper,
      types,
      ...(changeId ? { changeId } : {}),
      ...(presentation ? { presentation } : {}),
    });
    if ((pairIndex + 1) % 24 === 0) yield "change-annotation";
  }

  const diagnostics: ReviewDiagnostic[] = stableSourceAnalysis.sourceKinds.map((kind) => ({
    kind,
    summary: kind === "css-source" ? "CSS 源码发生变化" : "Script 源码发生变化",
  }));
  const focusGroups = normalizeReviewFocusGroupPlans(
    reviewFocusGroupsForDocuments(beforeDocument, afterDocument),
  ) as ReviewFocusGroup[];
  return {
    changes,
    outline,
    focusGroups,
    diagnostics,
  };
}

function* buildReviewSourceFactSteps(
  beforeHtml: string,
  afterHtml: string,
): Generator<string, ReviewSourceFacts, void> {
  const visual = buildReviewVisualEvidence(beforeHtml, afterHtml, "source-facts");
  if (typeof DOMParser === "undefined") return emptySourceFacts(beforeHtml, afterHtml, visual);
  let pair = yield* prepareReviewSourcePairSteps(beforeHtml, afterHtml);
  let annotations;
  let annotationAvailability: ReviewAnnotationAvailability = "available";
  try {
    annotations = yield* annotateReviewSourceFactSteps(pair.beforeDocument, pair.afterDocument, visual);
  } catch (cause) {
    if (!(cause instanceof ReviewProjectionFactOverflowError)) throw cause;
    // Yield before recovery so cancellation can discard the failed analysis.
    // Never serialize the partially annotated DOM or reuse its inserted spans.
    yield "annotation-unavailable";
    pair = yield* prepareReviewSourcePairSteps(beforeHtml, afterHtml);
    annotationAvailability = "unavailable";
    annotations = { changes: [], outline: [], focusGroups: [], diagnostics: [] };
  }
  // Parsing, pairing and the formal serializer remain outside the annotation catch.
  return sourceFactsFromDocuments(pair.beforeDocument, pair.afterDocument, visual, {
    annotationAvailability,
    ...annotations,
  });
}

function visualStableIdsForFacts(
  facts: ReviewSourceFacts,
  side: "before" | "after",
): string[] {
  return facts.visualEvidence
    .filter((evidence) => side === "before" ? evidence.beforePresent : evidence.afterPresent)
    .map((evidence) => evidence.stableId);
}

function bindReviewComments(
  annotatedBefore: Document,
  sourceBeforeHtml: string,
  comments: NonNullable<ReviewDocumentBuildOptions["comments"]>,
) {
  if (!comments.length) {
    return { groups: [] as ReviewDocuments["commentGroups"], targets: [] as ReviewDocuments["commentTargets"], bindings: [] };
  }
  const projection = prepareReviewCommentSourceProjection(sourceBeforeHtml, true);
  const annotations = annotateReviewComments(
    annotatedBefore,
    sourceBeforeHtml,
    comments,
    projection.sourceIndex,
  );
  const bindings = reviewCommentBootstrapBindings(annotatedBefore, annotations.targets);
  clearReviewCommentScopeAttributes(annotatedBefore);
  return {
    groups: annotations.groups,
    targets: annotations.targets,
    bindings,
  };
}

export function projectReviewDocuments(
  beforeHtml: string,
  facts: ReviewSourceFacts,
  options: ReviewDocumentBuildOptions,
): ReviewDocuments {
  const visualBinding = {
    ...facts.visualBinding,
    sessionId: options.sessionId,
  };
  const comments = options.comments || [];
  if (typeof DOMParser === "undefined") {
    return {
      annotationAvailability: facts.annotationAvailability,
      before: facts.annotatedBeforeHtml,
      after: facts.annotatedAfterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(options.sessionId, "before", [], visualStableIdsForFacts(facts, "before")),
        after: reviewBootstrap(options.sessionId, "after", [], visualStableIdsForFacts(facts, "after")),
      },
      bootstrapFallbackJavaScript: {
        before: reviewBootstrap(options.sessionId, "before", [], visualStableIdsForFacts(facts, "before")),
        after: reviewBootstrap(options.sessionId, "after", [], visualStableIdsForFacts(facts, "after")),
      },
      changes: facts.changes,
      outline: facts.outline,
      focusGroups: facts.focusGroups,
      commentGroups: [],
      commentTargets: [],
      visualBinding,
      visualEvidence: facts.visualEvidence,
      diagnostics: facts.diagnostics,
      ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
    };
  }
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(facts.annotatedBeforeHtml, "text/html");
  const afterDocument = parser.parseFromString(facts.annotatedAfterHtml, "text/html");
  const commentBinding = bindReviewComments(beforeDocument, beforeHtml, comments);
  const visualStableIds = (side: "before" | "after") => [...new Set([
    ...visualStableIdsForFacts(facts, side),
    ...commentBinding.targets.flatMap((target) => target.stableId ? [target.stableId] : []),
  ])];
  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    commentBinding.bindings,
    visualStableIds("before"),
    facts.focusGroups,
  );
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    [],
    visualStableIds("after"),
    facts.focusGroups,
  );
  return {
    annotationAvailability: facts.annotationAvailability,
    before: preparedBefore.html,
    after: preparedAfter.html,
    bootstrapJavaScript: {
      before: preparedBefore.bootstrapJavaScript,
      after: preparedAfter.bootstrapJavaScript,
    },
    bootstrapFallbackJavaScript: {
      before: preparedBefore.bootstrapFallbackJavaScript,
      after: preparedAfter.bootstrapFallbackJavaScript,
    },
    changes: facts.changes,
    outline: facts.outline,
    focusGroups: facts.focusGroups,
    commentGroups: commentBinding.groups,
    commentTargets: commentBinding.targets,
    visualBinding,
    visualEvidence: facts.visualEvidence,
    diagnostics: facts.diagnostics,
    ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
  };
}

function* buildReviewDocumentSteps(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): Generator<string, ReviewDocuments, void> {
  const facts = yield* buildReviewSourceFactSteps(beforeHtml, afterHtml);
  yield "comments";
  const documents = projectReviewDocuments(beforeHtml, facts, options);
  yield "prepare-before";
  yield "prepare-after";
  return documents;
}

export function buildReviewDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): ReviewDocuments {
  const steps = buildReviewDocumentSteps(beforeHtml, afterHtml, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function yieldReviewAnalysisTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function measureReviewAnalysisPhase(
  phase: string,
  startedAt: number,
  endedAt: number,
) {
  try {
    globalThis.performance?.measure?.(
      `pageroot:review-analysis:${phase}`,
      { start: startedAt, end: endedAt },
    );
  } catch {
    // Performance diagnostics cannot own review availability.
  }
}

const REVIEW_ANALYSIS_PHASES = [
  "parse",
  "comments",
  "panels",
  "actions",
  "stable-source",
  "candidate-sections-before",
  "candidate-sections-after",
  "section-pairing",
  "semantic-row",
  "change-annotation",
  "annotation-unavailable",
  "prepare-before",
  "prepare-after",
  "complete",
] as const;

async function runYieldingAnalysis<T>(
  steps: Generator<string, T, void>,
  control: { isCancelled?: () => boolean } = {},
): Promise<T> {
  REVIEW_ANALYSIS_PHASES.forEach((phase) => {
    try {
      globalThis.performance?.clearMeasures?.(`pageroot:review-analysis:${phase}`);
    } catch {
      // Diagnostics cannot own review analysis.
    }
  });
  const assertCurrent = () => {
    if (control.isCancelled?.()) {
      throw new Error("Review document analysis was superseded.");
    }
  };
  assertCurrent();
  let segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
  let step = steps.next();
  let segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
  measureReviewAnalysisPhase(
    step.done ? "complete" : step.value,
    segmentStartedAt,
    segmentEndedAt,
  );
  while (!step.done) {
    await yieldReviewAnalysisTask();
    assertCurrent();
    segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
    step = steps.next();
    segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
    measureReviewAnalysisPhase(
      step.done ? "complete" : step.value,
      segmentStartedAt,
      segmentEndedAt,
    );
  }
  assertCurrent();
  return step.value;
}

export async function buildReviewSourceFactsAsync(
  beforeHtml: string,
  afterHtml: string,
  control: { isCancelled?: () => boolean } = {},
): Promise<ReviewSourceFacts> {
  return runYieldingAnalysis(
    buildReviewSourceFactSteps(beforeHtml, afterHtml),
    control,
  );
}

export async function buildReviewDocumentsAsync(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
  control: { isCancelled?: () => boolean } = {},
): Promise<ReviewDocuments> {
  return runYieldingAnalysis(
    buildReviewDocumentSteps(beforeHtml, afterHtml, options),
    control,
  );
}
