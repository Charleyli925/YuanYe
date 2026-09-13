export type EditRuntimeRefreshAction =
  | "in-place"
  | "candidate-now";

export type EditRuntimeRefreshDecision = Readonly<{
  action: EditRuntimeRefreshAction;
  reason: string;
  synchronizeCurrentFrame: boolean;
}>;

export function decideEditRuntimeRefresh(input?: Readonly<{
  hasRuntime?: boolean;
  mutationKind?: "text" | "style" | "reorder" | "structure";
  programIdentityChanged?: boolean;
}>): EditRuntimeRefreshDecision;
