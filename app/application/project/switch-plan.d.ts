export type ProjectSwitchPlan =
  | Readonly<{ kind: "ready"; action?: "reset-failed" | "drain-run-lock" | "continue" }>
  | Readonly<{ kind: "wait"; reason?: string }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planProjectSwitchEntry(input?: {
  disposed?: boolean;
  drainBlockedReason?: string | null;
  projectLoadError?: boolean;
  runLocked?: boolean;
  hasHistoryAction?: boolean;
}): ProjectSwitchPlan;

export function planProjectSwitchFence(input?: {
  needsCanvasCommit?: boolean;
  fenceOk?: boolean;
  fenceReason?: string;
}): ProjectSwitchPlan;
