import type { WorkspaceControllerSnapshot, WorkspaceShellSnapshot } from "./workspace-controller-capabilities.js";
export function workspaceShellSnapshot(
  source: WorkspaceControllerSnapshot,
  previous?: WorkspaceShellSnapshot | null,
): WorkspaceShellSnapshot;
