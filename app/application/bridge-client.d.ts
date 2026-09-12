export type BridgeOutcome = "rejected" | "unknown";
export type BridgeJson = Record<string, unknown>;

export class BridgeRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: BridgeJson;
  readonly outcome: BridgeOutcome;
}

export function isBridgeRequestError(value: unknown): value is BridgeRequestError;

export type BridgeClient = {
  workspace(
    sourcePath: string,
    options?: { operationId?: string },
  ): Promise<BridgeJson>;
  workspaceEnvelope(
    sourcePath: string,
    options?: { operationId?: string },
  ): Promise<BridgeJson>;
  source(
    sourcePath: string,
    options?: { timeoutMs?: number },
  ): Promise<BridgeJson>;
  sourcePreview(sourcePath: string): Promise<BridgeJson>;
  sourceStat(sourcePath: string): Promise<BridgeJson>;
  conflictCandidate(sourcePath: string): Promise<BridgeJson>;
  conversation(sourcePath: string): Promise<BridgeJson>;
  conversationList(sourcePath: string): Promise<BridgeJson>;
  saveConversationDraft(body: BridgeJson): Promise<BridgeJson>;
  status(
    sourcePath: string,
    requestId: string,
    attemptId?: string | null,
  ): Promise<BridgeJson>;
  versionFile(sourcePath: string, versionId: string): Promise<BridgeJson>;
  projectFile(sourcePath: string, path: string): Promise<BridgeJson>;
  ensureProject(body: BridgeJson): Promise<BridgeJson>;
  reconcileManagedWorkingCopy(body: BridgeJson): Promise<BridgeJson>;
  autosave(body: BridgeJson): Promise<BridgeJson>;
  saveDraft(body: BridgeJson): Promise<BridgeJson>;
  saveAttachment(body: BridgeJson): Promise<BridgeJson>;
  deleteAttachment(body: BridgeJson): Promise<BridgeJson>;
  recordSubmission(body: BridgeJson): Promise<BridgeJson>;
  finishSubmission(body: BridgeJson): Promise<BridgeJson>;
  createRequest(body: BridgeJson): Promise<BridgeJson>;
  agentAvailability(input?: BridgeJson): Promise<BridgeJson>;
  agentDiagnose(input?: BridgeJson): Promise<BridgeJson>;
  qoderAvailability(input?: BridgeJson): Promise<BridgeJson>;
  agentProviders(): Promise<BridgeJson>;
  preflightAgent(body: BridgeJson): Promise<BridgeJson>;
  installAgent(body: BridgeJson): Promise<BridgeJson>;
  cancelAgentInstall(body: BridgeJson): Promise<BridgeJson>;
  loginAgent(body: BridgeJson): Promise<BridgeJson>;
  cancelAgentLogin(body: BridgeJson): Promise<BridgeJson>;
  logoutAgent(body: BridgeJson): Promise<BridgeJson>;
  setAgentSessionCredential(body: BridgeJson): Promise<BridgeJson>;
  updateAgentConfiguration(body: BridgeJson): Promise<BridgeJson>;
  cancelAgentConfiguration(body: BridgeJson): Promise<BridgeJson>;
  startAgent(body: BridgeJson): Promise<BridgeJson>;
  agentStatus(
    sourcePath: string,
    requestId: string,
    attemptId?: string | null,
  ): Promise<BridgeJson>;
  cancelAgent(body: BridgeJson): Promise<BridgeJson>;
  resolveConflict(body: BridgeJson): Promise<BridgeJson>;
  activateReadyVersion(body: BridgeJson): Promise<BridgeJson>;
  createVersionFromHistory(body: BridgeJson): Promise<BridgeJson>;
  queryHistoryCreation(body: BridgeJson): Promise<BridgeJson>;
  confirmHistoryCreationOpened(body: BridgeJson): Promise<BridgeJson>;
  cancelActiveRun(body: BridgeJson): Promise<BridgeJson>;
  updateProjectFile(body: BridgeJson): Promise<BridgeJson>;
  openFolder(body: BridgeJson): Promise<BridgeJson>;
  attachment(sourcePath: string, relativePath: string): Promise<Blob>;
};

export function createBridgeClient(options: {
  baseUrl: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}): BridgeClient;
export function createRuntimeBridgeClient(): BridgeClient;
