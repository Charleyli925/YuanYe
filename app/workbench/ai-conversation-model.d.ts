export type SidebarState =
  | "preview-ready"
  | "preparing-delivery"
  | "processing"
  | "validating"
  | "ready-to-open"
  | "review-view"
  | "promoting"
  | "adoption-unknown"
  | "run-error"
  | "no-change";

export type SidebarIntent = "modify" | "continue";

export type SidebarModePresentation = {
  label: string;
};

export type SidebarMessage = {
  messageId: string;
  actor: string;
  actorLabel: string;
  kind: string;
  status: string;
  text: string;
  truncated: boolean;
  sequence: number;
  createdAt: string;
  modelDisplayName: string | null;
  turnId: string | null;
  requestId: string | null;
  attemptId: string | null;
};

export type SidebarHistoryGroup = {
  key: string;
  label: string;
  kind: "current" | "history";
  messageIndices: readonly number[];
  messageIds: readonly string[];
};

export type SidebarAction = {
  id: string;
  label: string;
  tone: "primary" | "quiet";
  disabled?: boolean;
};

export type SidebarActionBar = {
  kind: "decision" | "progress" | "blocked";
  title: string;
  detail: string;
  actions: SidebarAction[];
};

export type SidebarSendState = {
  kind: "send" | "open-agent-settings" | "status";
  canSend: boolean;
  label: string;
  reason: string | null;
};

export type SidebarCopyTaskState = {
  canCopy: boolean;
  reason: string | null;
};

export type SidebarCatalogStatus =
  | "checking"
  | "ready"
  | "auth-required"
  | "not-installed"
  | "unavailable";

export function sidebarModePresentation(
  state: string,
): SidebarModePresentation;

export function sidebarActorInitial(actor: string): string;

export function sidebarActorLabel(actor: string): string;

export function sidebarMessageStream(
  messages: readonly unknown[],
): SidebarMessage[];

export function sidebarConversationGroups(options?: {
  messages?: readonly unknown[];
  turns?: readonly unknown[];
  activeRun?: { requestId?: string | null; attemptId?: string | null } | null;
  activeRequestId?: string | null;
  activeAttemptId?: string | null;
  now?: number;
}): readonly SidebarHistoryGroup[];

export function sidebarResolvedIntent(
  state: string,
): SidebarIntent;

export function sidebarFailureRetryable(
  activeRun?: { requestId?: string | null; attemptId?: string | null } | null,
  activeHandoff?: { requestId?: string | null; attemptId?: string | null; retryable?: boolean; safeToRetry?: boolean } | null,
): boolean;

export type SidebarExecutionStatus = {
  title: string;
  detail: string;
  elapsedMs: number;
  receivedBytes: number;
};

export function sidebarExecutionStatus(options?: {
  state?: string;
  providerName?: string;
  startedAt?: string | null;
  receivedBytes?: number;
  now?: number;
}): SidebarExecutionStatus | null;

export function conversationReadyForDocument(
  conversation: {
    status?: string;
    context?: {
      projectId?: string;
      documentId?: string;
    } | null;
  } | null,
  projectId: string,
  documentId: string,
): boolean;

export function conversationLoadedForView(conversation: {
  status?: string;
  context?: {
    projectId?: string;
    documentId?: string;
  } | null;
} | null): boolean;

export function sidebarActionBar(options?: {
  state?: string;
  runStatus?: string | null;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  failureMessage?: string | null;
  failureCode?: string | null;
  failureRetryable?: boolean;
  failureRecoveryKind?: "retry" | "wait" | "reauthenticate" | "change-model" | "change-provider" | "repair-installation" | "end" | null;
  credentialKind?: "api-token" | null;
  deliveryMode?: "managed-agent" | "clipboard";
  handoffStatus?: string | null;
}): SidebarActionBar | null;

export type SidebarRunProgressStep = {
  key: string;
  label: string;
  detail: string | null;
  state: string;
};

export type SidebarRunProgress = {
  steps: readonly SidebarRunProgressStep[];
  headline: string | null;
  /** What the Agent is saying while it works; null when it has said nothing. */
  narration: string | null;
  /** Stable public message rows under one Agent identity. */
  narrationUpdates: readonly Readonly<{ id: string; text: string }>[] | null;
  /** Whether an upstream public-text boundary omitted a suffix. */
  narrationTruncated: boolean;
  /** The stage actually running, for callers that need to name it. */
  liveLabel: string | null;
  tone: "attention" | "quiet";
};

export function sidebarRunProgress(options?: {
  state?: string;
  steps?: readonly unknown[];
  agentText?: string;
  agentUpdates?: readonly unknown[];
  agentTextTruncated?: boolean;
}): SidebarRunProgress | null;

export function sidebarTimestampLabel(
  value: unknown,
  options?: { now?: number },
): string | null;

export function sidebarSendState(options?: {
  state?: string;
  catalogStatus?: SidebarCatalogStatus;
  catalogReason?: string | null;
  queued?: boolean;
  intent?: SidebarIntent;
  pendingCommentCount?: number;
  agentName?: string;
  agentSettingsName?: string;
  agentSettingsSupported?: boolean;
  credentialKind?: "api-token" | null;
}): SidebarSendState;

export function sidebarCopyTaskState(options?: {
  state?: string;
  queued?: boolean;
  pendingCommentCount?: number;
  agentName?: string;
}): SidebarCopyTaskState;

export function sidebarStateFromRun(options?: {
  activeRun?: { status?: string } | null;
  activeHandoff?: {
    requestId?: string | null;
    attemptId?: string | null;
    status?: string | null;
  } | null;
  submissionPending?: boolean;
  reviewing?: boolean;
}): string;

export type SidebarAgentLine = {
  kind: "checking" | "name";
  text: string;
  choosable: boolean;
};

export function sidebarAgentLine(options?: {
  catalogStatus?: SidebarCatalogStatus;
  modelDisplayName?: string | null;
  modelChoiceCount?: number;
}): SidebarAgentLine | null;

export type SidebarReasoningLine = {
  text: string;
  selectedId: string | null;
  choosable: boolean;
};

export function sidebarReasoningLine(options?: {
  choices?: readonly Readonly<{ id: string; label: string }>[];
  selectedId?: string | null;
  defaultId?: string;
}): SidebarReasoningLine | null;

export const SIDEBAR_STATES: ReadonlySet<string>;
export const INTENT_MODIFY: "modify";
export const INTENT_CONTINUE: "continue";
export const FORBIDDEN_MESSAGE_KEYS: readonly string[];

export function sidebarTurnPresentation(messages?: readonly SidebarMessage[]): { primary: SidebarMessage[]; process: SidebarMessage[]; timeline: { process: boolean; messages: SidebarMessage[] }[] };

export function sidebarNarrationParagraphs(text: unknown): string[];

export function sidebarProcessRows(messages: readonly SidebarMessage[]): { message: SidebarMessage; count: number }[];

export function sidebarConversationPresentation(
  snapshot: import("../application/conversation-session.js").ConversationSessionSnapshot | null,
  context: Readonly<{ projectId: string; documentId: string; draftReadOnly: boolean }>,
): Readonly<{
  title: string;
  messages: readonly unknown[];
  draftText: string;
  draftAvailable: boolean;
  loading: boolean;
  turns: readonly unknown[];
}>;
