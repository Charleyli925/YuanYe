import type { ReviewAnalysisSession } from "../application/review-analysis-session.js";
import type { VersionReviewCandidate } from "../application/version-workflow.js";
import { commentHasContent } from "./comment-relink-model.js";
import {
  buildReviewSourceFactsAsync,
  projectReviewDocuments,
  type ReviewDocuments,
  type ReviewImpact,
  type ReviewSourceFacts,
} from "./review-document";
import type { CommentItem } from "./types";

export type { ReviewSourceFacts };

const REVIEW_IMPACT_SAMPLE_LIMIT = 100;

export type PreparedReviewDocuments = {
  operationKey: string;
  beforeHtml: string;
  afterHtml: string;
  sourcePath: string;
  commentsKey: string;
  sessionId: string;
  documents: ReviewDocuments;
};

export function reviewSourceFactsByteSize(facts: ReviewSourceFacts): number {
  return 2 * (
    facts.annotatedBeforeHtml.length
    + facts.annotatedAfterHtml.length
    + JSON.stringify(facts.changes).length
    + JSON.stringify(facts.outline).length
    + JSON.stringify(facts.focusGroups).length
    + JSON.stringify(facts.diagnostics).length
    + JSON.stringify(facts.visualBinding).length
    + JSON.stringify(facts.visualEvidence).length
  );
}

function reviewImpactFromCandidate(
  candidate: VersionReviewCandidate,
): ReviewImpact | undefined {
  const assessment = candidate.candidateAssessment;
  if (!assessment) return undefined;
  const changedElementCount = assessment.changedElementCount;
  const outsideTargetCount = assessment.outsideTargetCount;
  const requestedTargetCount = assessment.requestedTargetCount;
  if (
    typeof changedElementCount !== "number"
    || !Number.isSafeInteger(changedElementCount)
    || changedElementCount < 0
    || typeof outsideTargetCount !== "number"
    || !Number.isSafeInteger(outsideTargetCount)
    || outsideTargetCount < 0
    || typeof requestedTargetCount !== "number"
    || !Number.isSafeInteger(requestedTargetCount)
    || requestedTargetCount < 0
    || !Array.isArray(assessment.changedElementIdSample)
    || !Array.isArray(assessment.outsideTargetElementIdSample)
    || typeof assessment.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    requestedTargetCount,
    actualChangedElementCount: changedElementCount,
    outsideRequestedTargetCount: outsideTargetCount,
    changedElementIdSample: assessment.changedElementIdSample
      .slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
    outsideTargetElementIdSample: assessment.outsideTargetElementIdSample
      .slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
    truncated: assessment.truncated,
  };
}

export function reviewCommentsForAnalysis(comments: readonly CommentItem[]): CommentItem[] {
  return comments.filter(commentHasContent).map((comment) => {
    const sourceTarget = comment.sourceAnchor;
    return {
      ...comment,
      sourceAnchor: {
        ...sourceTarget,
        ...(sourceTarget.sourceAnchor
          ? { sourceAnchor: { ...sourceTarget.sourceAnchor } }
          : {}),
        ...(sourceTarget.fingerprint
          ? {
              fingerprint: {
                ...sourceTarget.fingerprint,
                stableAttributes: { ...sourceTarget.fingerprint.stableAttributes },
                ancestorFingerprint: [...sourceTarget.fingerprint.ancestorFingerprint],
              },
            }
          : {}),
        ...(sourceTarget.boundingBox
          ? { boundingBox: { ...sourceTarget.boundingBox } }
          : {}),
      },
      ...(comment.attachments?.length
        ? { attachments: comment.attachments.map((item) => ({ ...item })) }
        : {}),
    };
  });
}

export async function prepareReviewAnalysis({
  session,
  candidate,
  beforeHtml,
  comments,
  externalBootstrap,
  sessionId,
}: {
  session: ReviewAnalysisSession<ReviewSourceFacts>;
  candidate: VersionReviewCandidate;
  beforeHtml: string;
  comments: readonly CommentItem[];
  externalBootstrap: boolean;
  sessionId: string;
}): Promise<PreparedReviewDocuments> {
  const reviewComments = reviewCommentsForAnalysis(comments);
  const reviewImpact = reviewImpactFromCandidate(candidate);
  const commentsKey = JSON.stringify(reviewComments);
  const sourceKey = [
    candidate.baseSnapshotSha256,
    candidate.sha256,
    candidate.sourcePath,
    externalBootstrap ? "external" : "inline",
  ].join("\u0000");
  const facts = await session.analyze({
    key: sourceKey,
    compute: async ({ isCancelled }) => buildReviewSourceFactsAsync(
      beforeHtml,
      candidate.content,
      { isCancelled },
    ),
  });
  return {
    operationKey: candidate.operationKey,
    beforeHtml,
    afterHtml: candidate.content,
    sourcePath: candidate.sourcePath,
    commentsKey,
    sessionId,
    documents: projectReviewDocuments(beforeHtml, facts, {
      sessionId,
      sourcePath: candidate.sourcePath,
      externalBootstrap,
      comments: reviewComments,
      ...(reviewImpact ? { reviewImpact } : {}),
    }),
  };
}

