"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import AiReviewWorkspace, { type ReviewConfirmationAction } from "./AiReviewWorkspace";
import type { ReviewDocuments } from "./review-document";
import type { ReviewPresentationSnapshot } from "./review-state";
type WorkbenchReviewSession = Readonly<{
  sessionId: string;
  documents: ReviewDocuments;
  sourceContentEqual: boolean;
  sourcePath: string;
  beforeLabel: string;
  afterLabel: string;
}>;

export type WorkbenchReviewOverlayProps = Readonly<{
  session: WorkbenchReviewSession;
  accepting: boolean;
  activeRunError?: string;
  onAbout: () => void;
  onCancelBefore: (options: { reason: string }) => Promise<boolean>;
  onAccept: () => void;
  onRevealAiTask: () => void;
  assistantEntry: ReactNode;
  sidebar: ReactNode;
  fileName: string;
  changeContextVisibility: number;
  commentContextVisibility: number;
  initialPresentation?: ReviewPresentationSnapshot | null;
  onPresentationChange?: (presentation: ReviewPresentationSnapshot) => void;
  registerDecisionRequest: (
    request: (action: ReviewConfirmationAction) => void,
  ) => () => void;
  registerReload: (reload: () => void) => () => void;
}>;

export function WorkbenchReviewOverlay({
  session,
  accepting,
  activeRunError,
  onAbout,
  onCancelBefore,
  onAccept,
  onRevealAiTask,
  assistantEntry,
  sidebar,
  fileName,
  changeContextVisibility,
  commentContextVisibility,
  initialPresentation,
  onPresentationChange,
  registerDecisionRequest,
  registerReload,
}: WorkbenchReviewOverlayProps) {
  const [reloadRevision, setReloadRevision] = useState(0);
  const reload = useCallback(() => {
    setReloadRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    return registerReload(reload);
  }, [registerReload, reload]);

  const onReturnBefore = useCallback(() => {
    void (async () => {
      const restored = await onCancelBefore({
        reason: "declined-ai-candidate-after-review",
      });
      if (!restored) return;
    })();
  }, [onCancelBefore]);

  return (
    <AiReviewWorkspace
      key={session.sessionId}
      embedded
      fileName={fileName}
      beforeLabel={session.beforeLabel}
      afterLabel={session.afterLabel}
      sessionId={session.sessionId}
      documents={session.documents}
      sourceContentEqual={session.sourceContentEqual}
      sourcePath={session.sourcePath || undefined}
      accepting={accepting}
      error={activeRunError}
      onAbout={onAbout}
      onReturnBefore={onReturnBefore}
      onAccept={onAccept}
      onRevealAiTask={onRevealAiTask}
      assistantEntry={assistantEntry}
      sidebar={sidebar}
      changeContextVisibility={changeContextVisibility}
      commentContextVisibility={commentContextVisibility}
      initialPresentation={initialPresentation}
      onPresentationChange={onPresentationChange}
      registerDecisionRequest={registerDecisionRequest}
      reloadRevision={reloadRevision}
    />
  );
}
