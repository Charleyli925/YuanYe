export type RuntimeFrameSlotId = "a" | "b";

export type RuntimeFrameIdentity = Readonly<{
  candidateId: string;
  kind: "dynamic" | "static-disabled";
  generation: number;
  sourceRevision: string;
  slotId: RuntimeFrameSlotId;
  slotLease: number;
}>;

export type RuntimeFrameSlotSnapshot = Readonly<{
  slotId: RuntimeFrameSlotId;
  slotLease: number;
  phase: "empty" | "active" | "preparing" | "positioning";
  identity: RuntimeFrameIdentity | null;
}>;

export type RuntimeFrameCoordinatorSnapshot = Readonly<{
  slots: Readonly<Record<RuntimeFrameSlotId, RuntimeFrameSlotSnapshot>>;
  activeSlotId: RuntimeFrameSlotId | null;
  candidateSlotId: RuntimeFrameSlotId | null;
  latestCandidate: RuntimeFrameIdentity | null;
  latestPhase: "preparing" | "positioning" | null;
  lastKnownGood: RuntimeFrameIdentity | null;
  nativeEdit: Readonly<{
    kind: "user";
    candidateId: string | null;
  }> | null;
  ignoredCallbackCount: number;
}>;

export type RuntimeFrameSettlement = Readonly<{
  accepted: boolean;
  preserveLastKnownGood: boolean;
  shouldUseStaticFallback: boolean;
}>;

export function runtimeCandidateAlreadyActive(input: {
  request: Pick<RuntimeFrameIdentity, "kind" | "sourceRevision">;
  runtimeFrame: Readonly<{
    attempt: RuntimeFrameIdentity;
    elementGeneration: number;
    activation: "pending" | "ready" | "partial" | "failed";
    settled: boolean;
  }> | null;
  frameLoadGeneration: number;
  snapshot: RuntimeFrameCoordinatorSnapshot;
}): boolean;

export class RuntimeFrameCoordinator {
  readonly snapshot: RuntimeFrameCoordinatorSnapshot;
  beginCandidate(input: {
    generation: number;
    sourceRevision: string;
    kind?: "dynamic" | "static-disabled";
  }): Readonly<{
    identity: RuntimeFrameIdentity;
    supersededCandidate: RuntimeFrameIdentity | null;
  }>;
  accepts(candidate: RuntimeFrameIdentity): boolean;
  canPromote(candidate: RuntimeFrameIdentity): boolean;
  beginPositioning(candidate: RuntimeFrameIdentity): boolean;
  canFinalize(candidate: RuntimeFrameIdentity): boolean;
  beginNativeEdit(): boolean;
  endNativeEdit(): boolean;
  settle(
    candidate: RuntimeFrameIdentity,
    outcome: "ready" | "rejected" | "failed" | "superseded",
  ): RuntimeFrameSettlement;
  reset(): void;
}
