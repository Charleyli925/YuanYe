import type { ActiveRun } from "../domain/run-lifecycle.js";

export type RunOperationKind = "activate" | "cancel" | "resolve" | "poll";

export type RunSubmissionPhase = "preparing" | "frozen" | "uncertain";

export type RunSubmission = {
  token: number;
  sourcePath: string;
  phase: RunSubmissionPhase;
};

export type RunVisibleTextUpdate = Readonly<{
  id: string;
  sequence: number;
  text: string;
}>;

export type RunHandoffState = {
  sourcePath: string;
  requestId: string;
  attemptId: string;
  mode?: "clipboard" | "managed-agent";
  status:
    | "copying"
    | "copied"
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "interrupted"
    | "cancelling"
    | "cancelled";
  phase?: string;
  providerId?: string | null;
  runtimeId?: string | null;
  agentName?: string | null;
  /** What the Agent said while working (ADR 0037); narration with no authority. */
  visibleText?: string;
  /** Stable public message rows. Hidden reasoning and tool events never enter this list. */
  visibleTextUpdates?: readonly RunVisibleTextUpdate[];
  textTruncated?: boolean;
  agentVersion?: string | null;
  startedAt?: string | null;
  lastActivityAt?: string | null;
  receivedBytes?: number;
  updatedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  safeToRetry?: boolean;
  recoveryKind?: "retry" | "wait" | "reauthenticate" | "change-model" | "change-provider" | "repair-installation" | "end";
};

export type RunBackgroundResult = {
  state: "processing" | "ready" | "conflict" | "no-change" | "error";
  label: string;
  updatedAt: number;
};

export type RunSessionSnapshot = {
  activeSourcePath: string | null;
  activeRun: ActiveRun | null;
  activeHandoff: RunHandoffState | null;
  activeHandoffMayBeRunning: boolean;
  activeHandoffManaged: boolean;
  activeSubmission: RunSubmission | null;
  submissionPending: boolean;
  activeLocked: boolean;
  operationKeys: ReadonlyArray<readonly [RunOperationKind, string]>;
  recentOutcome: ActiveRun | null;
  backgroundResults: ReadonlyArray<readonly [string, RunBackgroundResult]>;
};

export class RunSession {
  constructor(options?: { sourcePath?: string | null });
  setObserver(observer: ((snapshot: RunSessionSnapshot) => void) | null): void;
  subscribe(listener: (snapshot: RunSessionSnapshot) => void): () => void;
  activate(sourcePath: string | null): RunSessionSnapshot;
  beginSubmission(value: {
    sourcePath: string;
  }): RunSubmission | null;
  freezeSubmission(submission: RunSubmission): boolean;
  markSubmissionUncertain(submission: RunSubmission): boolean;
  releaseSubmission(submission: RunSubmission): boolean;
  clearActiveSubmission(): boolean;
  setActiveRun(run: ActiveRun | null): ActiveRun | null;
  trackRun(
    run: ActiveRun,
    options?: {
      activate?: "if-current" | "never" | "always";
      recovered?: boolean;
    },
  ): ActiveRun | null;
  runForSource(sourcePath: string | null | undefined): ActiveRun | null;
  hasRun(run: ActiveRun | null | undefined): boolean;
  removeRun(
    run: ActiveRun,
    options?: { clearActive?: boolean },
  ): boolean;
  clearActiveRun(): boolean;
  publishHandoff(state: RunHandoffState): boolean;
  handoffForSource(
    sourcePath: string | null | undefined,
  ): RunHandoffState | null;
  clearHandoff(sourcePath: string | null | undefined): boolean;
  clearActiveHandoff(): boolean;
  rememberOutcome(run: ActiveRun): ActiveRun | null;
  forgetOutcome(sourcePath: string | null | undefined): boolean;
  outcomeForSource(
    sourcePath: string | null | undefined,
  ): ActiveRun | null;
  markResult(
    sourcePath: string,
    result: RunBackgroundResult,
  ): boolean;
  clearResult(sourcePath: string | null | undefined): boolean;
  resultForSource(
    sourcePath: string | null | undefined,
  ): RunBackgroundResult | null;
  rebaseSource(value: {
    /** Exact old locator. Never selects all runs of a project. Request origin stays unchanged. */
    previousSourcePath: string;
    sourcePath: string;
    projectId?: string;
    documentId?: string;
  }): boolean;
  beginOperation(kind: RunOperationKind, key: string): boolean;
  endOperation(kind: RunOperationKind, key: string): boolean;
  isOperationBusy(kind: RunOperationKind, key: string): boolean;
  readonly activeRun: ActiveRun | null;
  readonly activeHandoff: RunHandoffState | null;
  readonly activeHandoffMayBeRunning: boolean;
  readonly activeHandoffManaged: boolean;
  readonly activeSubmission: RunSubmission | null;
  readonly submissionPending: boolean;
  readonly activeLocked: boolean;
  readonly runs: ReadonlyArray<ActiveRun>;
  readonly snapshot: RunSessionSnapshot;
}
