export const GLOBAL_INTERRUPTION_KINDS: readonly [
  "import-trash-failed",
  "external-agent-may-still-run",
  "external-open-unavailable",
  "project-open-failed",
  "attachment-rejected",
  "attachment-batch-partial",
  "show-in-folder-failed",
  "open-in-browser-failed",
  "export-failed",
  "handoff-recopy",
];

export type GlobalInterruptionKind = (typeof GLOBAL_INTERRUPTION_KINDS)[number];

export type GlobalInterruptionTarget = {
  kind: "composer" | "comment";
  commentId: string;
};

export type GlobalInterruption =
  | {
      kind: "import-trash-failed";
      fileName?: string;
      sourcePath?: string | null;
    }
  | {
      kind: "external-agent-may-still-run";
      current?: boolean;
      sourcePath?: string;
    }
  | { kind: "external-open-unavailable"; detail?: string }
  | {
      kind: "project-open-failed";
      detail?: string;
      recent?: boolean;
      requestId?: string;
    }
  | {
      kind: "attachment-rejected";
      detail: string;
      needsRemoval?: boolean;
      target: GlobalInterruptionTarget;
    }
  | {
      kind: "attachment-batch-partial";
      detail: string;
      added?: boolean;
      failed?: boolean;
      composerOpen?: boolean;
      needsRemoval?: boolean;
      target: GlobalInterruptionTarget;
    }
  | { kind: "show-in-folder-failed"; detail?: string }
  | { kind: "open-in-browser-failed"; detail?: string }
  | { kind: "export-failed"; detail: string }
  | { kind: "handoff-recopy"; succeeded: boolean };

export type GlobalInterruptionPresentation = {
  kind: GlobalInterruptionKind;
  title: string;
  message: string;
  tone: "success" | "info" | "warning" | "error";
  dismissMs: number | null;
  actionId:
    | "reveal-imported-project"
    | "retry-project-open"
    | "open-attachment-picker"
    | "review-comment-attachments"
    | "retry-export"
    | null;
  actionLabel: string | null;
  actionRequestId?: string;
  usageKey: string;
};

export function globalInterruptionPresentation(
  interruption: GlobalInterruption | null | undefined,
): GlobalInterruptionPresentation | null;
