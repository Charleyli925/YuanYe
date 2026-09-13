import type { ProjectContext, ProjectSession } from "./project-session.js";

export function copyProjectContext(context: unknown): ProjectContext | null;

export function verifyProjectContext(
  candidate: unknown,
  live: Pick<ProjectSession, "matches" | "epoch" | "sourcePath"> | null | undefined,
  options?: {
    disposed?: boolean;
    sameSourcePath?(left: string | null | undefined, right: string | null | undefined): boolean;
  },
): ProjectContext | null;

export function verifyOpenTarget(
  target: unknown,
  options?: {
    projectId?: string | null;
    documentId?: string | null;
    sourcePath?: string | null;
    sourceSha256?: string | null;
    sameSourcePath?(left: string | null | undefined, right: string | null | undefined): boolean;
    targetKind?: "working-copy" | "version" | null;
  },
): Readonly<Record<string, unknown>> | null;
