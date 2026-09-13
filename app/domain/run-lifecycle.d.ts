export type LifecycleState =
  | "editing"
  | "submitting"
  | "processing"
  | "validating"
  | "committing"
  | "ready-to-open"
  | "awaiting-conflict-resolution"
  | "recovering-transaction"
  | "ready"
  | "no-change"
  | "complete"
  | "cancelled"
  | "error";

export const CANONICAL_LIFECYCLE_STATES: readonly LifecycleState[];
export function canonicalLifecycleState(
  value: unknown,
  options?: {
    readyVersion?: boolean;
    fallback?: LifecycleState;
  },
): LifecycleState;
export function isLockedLifecycleState(value: unknown): boolean;
export function hasObservedCompletion(
  run: Pick<ActiveRun, "status" | "completionObserved"> | null | undefined,
): boolean;

export type RunProgressStepState =
  | "done"
  | "current"
  | "pending"
  | "error"
  | "attention"
  | "neutral";

export type RunProgressStep = {
  key: "handoff" | "ai" | "validation" | "result";
  label: string;
  detail: string;
  state: RunProgressStepState;
};

export type RunProgressHeader = {
  eyebrow: string;
  title: string;
};

export type RunProgressPresentation = {
  header: RunProgressHeader | null;
  statusLabel: string;
  summaryTitle: string;
  summaryDetail: string;
  steps: RunProgressStep[];
};

export function deriveRunProgressPresentation(
  run: Pick<
    ActiveRun,
    | "requestId"
    | "status"
    | "error"
    | "completionObserved"
    | "candidateAssessment"
  > | null | undefined,
  handoffStatus?:
    | "idle"
    | "copying"
    | "copied"
    | "failed"
    | "starting"
    | "running"
    | "completed"
    | "interrupted"
    | "cancelling"
    | "cancelled"
    | Readonly<{
        mode?: "clipboard" | "managed-agent";
        status: string;
        phase?: string;
        agentName?: string | null;
        errorMessage?: string | null;
        retryable?: boolean;
      }>,
): RunProgressPresentation;

export function deriveRunProgressSteps(
  run: Pick<
    ActiveRun,
    | "requestId"
    | "status"
    | "error"
    | "completionObserved"
    | "candidateAssessment"
  > | null | undefined,
  handoffStatus?:
    | "idle"
    | "copying"
    | "copied"
    | "failed"
    | "starting"
    | "running"
    | "completed"
    | "interrupted"
    | "cancelling"
    | "cancelled"
    | Readonly<{
        mode?: "clipboard" | "managed-agent";
        status: string;
        phase?: string;
        agentName?: string | null;
        errorMessage?: string | null;
        retryable?: boolean;
      }>,
): RunProgressStep[];

export type ValidationReview = {
  status: "observed" | "pending";
  hardViolationCodes: string[];
  softViolationCodes: string[];
};

export type CandidateAssessment = {
  status: "ready" | "attention" | "blocked";
  issueCodes: string[];
  health: {
    completeDocument: boolean;
    bodyHasContent: boolean;
  };
  continuity: {
    status: "related" | "uncertain";
  };
  changedElementCount?: number;
  outsideTargetCount?: number;
  changedElementIdSample?: string[];
  outsideTargetElementIdSample?: string[];
  truncated?: boolean;
  requestedTargetCount?: number;
};

export function candidateAssessmentFromRecord(
  value: unknown,
): CandidateAssessment | null;

export function validationReviewFromRecord(
  value: unknown,
): ValidationReview | null;

export type ActiveRun = {
  adoptionPhase?: "applying" | "unknown";
  projectId: string;
  documentId: string;
  /** Immutable Request origin; null/absent on legacy projections, never inferred from the current route. */
  sourceWorkingCopyId?: string | null;
  /** In-memory submission identity while requestId is the pending placeholder. */
  submissionToken?: number;
  requestId: string;
  attemptId: string;
  requestPath: string;
  attemptPath: string;
  handoffMessage: string;
  agentDelivery?: {
    mode: "clipboard" | "managed-agent";
    selection?: {
      providerId: string;
      runtimeId: string;
      requestedModelId: string | null;
      resolvedModelId: string | null;
      reasoning: {
        requested: string | null;
        applied: string | null;
        resolution: "exact" | "provider-default" | "unsupported";
      };
    };
    trustPolicyVersion?: string;
  };
  status: LifecycleState;
  sourcePath: string;
  baseSnapshotSha256: string;
  previousVersionId: string | null;
  basedOnVersionId: string | null;
  freezeCutoffRevision: number;
  candidateVersionId: string;
  candidateVersionLabel: string;
  submittedAt: string;
  summary?: string;
  commentCount?: number;
  changeEventCount?: number;
  error?: string;
  errorCode?: string;
  errorDetail?: string;
  recoveryHint?: string;
  errorPreview?: string;
  completionObserved?: boolean;
  conflictId?: string;
  externalSourceSha256?: string;
  candidateOutputSha256?: string;
  conflictDetectedAt?: string;
  readyPayload?: Record<string, unknown>;
  validationReview?: ValidationReview;
  scopeReport?: Record<string, unknown>;
  candidateAssessment?: CandidateAssessment;
};

export function activeRunFromRecord(value: unknown): ActiveRun | null;
