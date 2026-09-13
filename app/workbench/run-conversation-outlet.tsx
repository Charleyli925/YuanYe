"use client";

import { memo, useMemo, useSyncExternalStore } from "react";

import type { RunControllerCapability, ConversationReaderCapability } from "../application/workspace-controller-capabilities.js";
import { deriveRunProgressPresentation } from "../domain/run-lifecycle.js";
import AiConversationSidebar, {
  type AiConversationSidebarProps,
} from "./AiConversationSidebar";
import { sidebarConversationPresentation, sidebarConversationGroups, sidebarStateFromRun } from "./ai-conversation-model.js";

export const RunConversationOutlet = memo(function RunConversationOutlet({
  capability,
  conversationCapability,
  conversationContext,
  sidebarProps,
  reviewing,
  deliveryMode,
}: {
  capability: RunControllerCapability;
  conversationCapability: ConversationReaderCapability;
  conversationContext: Readonly<{ projectId: string; documentId: string; draftReadOnly: boolean }>;
  sidebarProps: Omit<AiConversationSidebarProps, "state" | "title" | "messages">;
  reviewing: boolean;
  deliveryMode: "managed-agent" | "clipboard";
}) {
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const loadedConversation = useSyncExternalStore(
    conversationCapability.subscribe,
    conversationCapability.getSnapshot,
    conversationCapability.getSnapshot,
  );
  // A document switch can render before the parent's load effect runs. Never
  // present the previous document's draft or messages during that interval.
  const conversation = useMemo(() => sidebarConversationPresentation(
    loadedConversation, conversationContext,
  ), [loadedConversation, conversationContext]);
  const runSession = snapshot.session;
  const activeRun = runSession?.activeRun ?? null;
  const activeHandoff = runSession?.activeHandoff ?? null;
  const handoffMatchesRun = Boolean(
    activeRun
    && activeHandoff
    && activeRun.requestId === activeHandoff.requestId
    && activeRun.attemptId === activeHandoff.attemptId
  );
  const currentHandoff = handoffMatchesRun ? activeHandoff : null;
  const state = sidebarStateFromRun({
    activeRun,
    activeHandoff: currentHandoff,
    submissionPending: runSession?.submissionPending === true,
    reviewing,
  });
  const progress = deriveRunProgressPresentation(
    activeRun,
    currentHandoff || "idle",
  );

  const historyGroups = useMemo(() => sidebarConversationGroups({
    messages: conversation.messages,
    turns: conversation.turns,
    activeRun,
  }), [conversation, activeRun]);

  return (
    <AiConversationSidebar
      key={sidebarProps.documentKey}
      {...sidebarProps}
      title={conversation.title}
      messages={conversation.messages}
      draftText={conversation.draftText}
      draftAvailable={conversation.draftAvailable}
      loading={conversation.loading}
      historyGroups={historyGroups}
      state={state}
      runStatus={activeRun?.status ?? null}
      candidateVersionLabel={activeRun?.candidateVersionLabel ?? null}
      candidateStatus={activeRun?.candidateAssessment?.status ?? null}
      failureMessage={currentHandoff?.errorMessage || activeRun?.errorDetail || activeRun?.error || null}
      failureCode={currentHandoff?.errorCode || activeRun?.errorCode || null}
      failureRetryable={typeof currentHandoff?.safeToRetry === "boolean"
        ? currentHandoff.safeToRetry
        : currentHandoff?.retryable === true}
      failureRecoveryKind={currentHandoff?.recoveryKind || null}
      agentText={currentHandoff?.visibleText || ""}
      agentUpdates={currentHandoff?.visibleTextUpdates || []}
      agentTextTruncated={currentHandoff?.textTruncated === true}
      agentWorking={currentHandoff?.mode === "managed-agent"
        && ["starting", "running", "cancelling"].includes(currentHandoff.status)}
      agentStartedAt={currentHandoff?.startedAt || null}
      agentLastActivityAt={currentHandoff?.lastActivityAt || null}
      agentReceivedBytes={currentHandoff?.receivedBytes || 0}
      agentUpdatedAt={currentHandoff?.updatedAt || null}
      handoffStatus={currentHandoff?.status || null}
      runKey={activeRun
        ? `${activeRun.requestId}:${activeRun.attemptId}`
        : runSession?.submissionPending
          ? `pending:${runSession.activeSourcePath || "unknown"}`
          : null}
      runCommentCount={activeRun?.commentCount ?? sidebarProps.pendingCommentCount}
      runSteps={progress.steps}
      deliveryMode={deliveryMode}
    />
  );
});
