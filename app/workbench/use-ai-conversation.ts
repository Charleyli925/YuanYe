"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AiConversationControllerCapability } from "../application/workspace-controller-capabilities.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { SidebarCatalogStatus } from "./ai-conversation-model.js";

// Owns the sidebar visibility and document lifecycle. Its outlet subscribes local facts.
//
// This hook holds no conversation facts or durable state. It publishes intent
// to the existing Controller; the local outlet reads messages and draft text.
// This surface still creates modification Requests only.
//
// A conversation belongs to one Document. Opening the sidebar loads that
// Document's conversation; leaving preview, hiding the sidebar, or switching
// Document closes it so one Document's messages never linger under another.

export type UseAiConversationOptions = {
  controllerRef: { current: AiConversationControllerCapability | null };
  qoderAvailability: QoderAvailabilitySnapshot | null;
  agentDisplayName?: string | null;
  executionDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  credentialKind?: "api-token" | null;
  agentPresentation?: Readonly<{
    providerId: string;
    displayName: string;
    agentName: string;
    logoSrc: string | null;
  }> | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
  }>[];
  selectedModelId?: string | null;
  reasoningChoices?: readonly Readonly<{
    id: string;
    label: string;
  }>[];
  selectedReasoningId?: string | null;
  reviewing?: boolean;
  commentComposerOpen?: boolean;
  draftReadOnly?: boolean;
  canvasMode: "edit" | "preview";
  /** False while a Start/Settings/project-rules tab owns the window. */
  documentPresented?: boolean;
  projectId: string;
  documentId: string;
  sourcePath: string;
  sourceFileName?: string | null;
  pendingCommentCount: number;
  /**
   * Hands this round of comments to the Agent or to the clipboard. Owned by the
   * workbench because a modification is a Request, not a conversation turn.
   */
  onDeliverModification?: (mode: "managed-agent" | "clipboard") => void;
  /**
   * Acts on the decision bar. Without this the bar renders buttons that do
   * nothing, which is why the conversation sidebar must remain the owner of the
   * visible decision actions.
   */
  onDecision?: (actionId: string) => void;
  /** Opens Settings' Agent section without sending or clearing the draft. */
  onOpenAgentSettings?: () => void;
};

export function useAiConversation({
  controllerRef,
  qoderAvailability,
  agentDisplayName = null,
  executionDisplayName = null,
  agentActionName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  credentialKind = null,
  agentPresentation = null,
  models = [],
  selectedModelId = null,
  reasoningChoices = [],
  selectedReasoningId = null,
  reviewing = false,
  commentComposerOpen = false,
  draftReadOnly = false,
  canvasMode,
  documentPresented = true,
  projectId,
  documentId,
  sourcePath,
  sourceFileName = null,
  pendingCommentCount,
  onDeliverModification,
  onDecision,
  onOpenAgentSettings,
}: UseAiConversationOptions) {
  const [openDocuments, setOpenDocuments] = useState<ReadonlySet<string>>(() => new Set());
  const documentKey = `${projectId}:${documentId}`;
  const open = openDocuments.has(documentKey);
  // The Document owns its history, but the conversation is only presented
  // beside Preview or Review. Returning to Edit restores the comment rail and
  // closes the presentation without deleting the Document's durable thread.
  const active = documentPresented
    && Boolean(sourcePath)
    && (canvasMode === "preview" || reviewing);
  const visible = active && open && !commentComposerOpen;
  // Edit, Start, Settings and comment composition temporarily hide the dock.
  // They do not rewrite the Document's presentation preference: an explicit
  // hide/toggle owns that decision, and a restored Review can reopen in place.

  // Load when the sidebar becomes visible for a Document and close it on any
  // identity change or when it stops being visible.
  //
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    let cancelled = false;
    void (async () => {
      await controller.openConversation({ projectId, documentId, sourcePath });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
      controller.closeConversation();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef]);

  const toggle = useCallback(() => setOpenDocuments((current) => {
    const next = new Set(current);
    if (next.has(documentKey)) next.delete(documentKey);
    else next.add(documentKey);
    return next;
  }), [documentKey]);
  // Submitting a round makes this the surface that reports it, so the workbench
  // keeps the conversation thread visible beside the page.
  //
  const reveal = useCallback(() => {
    setOpenDocuments((current) => current.has(documentKey)
      ? current
      : new Set(current).add(documentKey));
  }, [documentKey]);
  const hide = useCallback(() => {
    setOpenDocuments((current) => {
      if (!current.has(documentKey)) return current;
      const next = new Set(current);
      next.delete(documentKey);
      return next;
    });
  }, [documentKey]);

  const onSend = useCallback(() => {
    onDeliverModification?.("managed-agent");
  }, [onDeliverModification]);

  const onDraftTextChange = useCallback((text: string) => {
    controllerRef.current?.updateConversationDraftText(text);
  }, [controllerRef]);

  const onCopyTask = useCallback(() => {
    onDeliverModification?.("clipboard");
  }, [onDeliverModification]);

  const sidebarProps = useMemo(() => ({
    documentKey: `${projectId}:${documentId}`,
    onDraftTextChange,
    // The selected Agent's availability is the model catalog's readiness: one owner supplies
    // both, so the Composer can never claim ready while the Agent is not.
    catalogStatus: (qoderAvailability?.status ?? "unavailable") as SidebarCatalogStatus,
    catalogReason: qoderAvailability?.reason ?? null,
    agentDisplayName,
    executionDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    credentialKind,
    agentPresentation,
    models,
    selectedModelId,
    reasoningChoices,
    selectedReasoningId,
    pendingCommentCount,
    sourceFileName,
    onSend,
    onCopyTask,
    onAction: onDecision,
    onClose: hide,
    onOpenAgentSettings,
  }), [
    qoderAvailability,
    agentDisplayName,
    executionDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    credentialKind,
    agentPresentation,
    models,
    selectedModelId,
    reasoningChoices,
    selectedReasoningId,
    projectId,
    documentId,
    sourceFileName,
    pendingCommentCount,
    onSend,
    onDraftTextChange,
    onCopyTask,
    onDecision,
    hide,
    onOpenAgentSettings,
  ]);

  const context = useMemo(() => ({ projectId, documentId, draftReadOnly }), [projectId, documentId, draftReadOnly]);
  return { open, visible, toggle, reveal, hide, sidebarProps, context };
}
