export type OpenTarget = Readonly<{
  projectId: string;
  documentId: string;
  projectRootPath: string;
  targetKind: "working-copy" | "version";
  workingCopyId: string | null;
  versionId: string | null;
  exactSourcePath: string;
  sourceSha256: string;
  sessionEpoch: number;
}>;

/** A location can exist before the first durable project registration. */
export type ProjectLocator = Readonly<{
  epoch: number;
  sourcePath: string | null;
}>;

type RegisteredIdentity = Readonly<{
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
}>;

/** Registered source without a managed Version/Working Copy route. */
export type RegisteredSourceContext = RegisteredIdentity & Readonly<{
  [Key in Exclude<keyof OpenTarget, "projectId" | "documentId">]?: never;
}>;

/** Managed routes always carry the complete, validated OpenTarget tuple. */
export type ManagedProjectContext = RegisteredIdentity & OpenTarget;
export type ProjectContext = RegisteredSourceContext | ManagedProjectContext;

/** Display snapshot only; use a validated context for registered operations. */
export type ProjectSessionSnapshot = ProjectLocator & Readonly<{
  projectId: string;
  documentId: string;
  registered: boolean;
  openTarget?: OpenTarget;
}>;

/** Input is validated by ProjectSession; it is not an established context. */
export type ProjectRegistrationInput = RegisteredIdentity & Partial<OpenTarget> & {
  openTarget?: Omit<OpenTarget, "sessionEpoch"> | null;
};

export class ProjectSession {
  setObserver(
    observer: ((snapshot: ProjectSessionSnapshot) => void) | null,
  ): void;
  openLocator(sourcePath: string | null): ProjectLocator;
  register(value: ProjectRegistrationInput): ProjectContext | null;
  transitionSource(value: {
    previousSourcePath?: string | null;
    sourcePath: string;
    projectId?: string;
    documentId?: string;
    openTarget?: Omit<OpenTarget, "sessionEpoch"> | null;
  }): ProjectContext | ProjectLocator | null;
  adoptOpenTarget(value: {
    previousSourcePath?: string | null;
    target: Omit<OpenTarget, "sessionEpoch">;
  }): ProjectContext | ProjectLocator | null;
  refreshOpenTarget(
    target: Omit<OpenTarget, "sessionEpoch">,
  ): ProjectContext | null;
  matches(context: ProjectContext): boolean;
  matchesLocator(locator: ProjectLocator): boolean;
  beginQuery(
    name: string,
    options?: { sourcePath?: string | null },
  ): unknown;
  isQueryCurrent(query: unknown): boolean;
  readonly locator: ProjectLocator;
  readonly context: ProjectContext | null;
  readonly snapshot: ProjectSessionSnapshot;
  readonly epoch: number;
  readonly sourcePath: string | null;
  readonly projectId: string;
  readonly documentId: string;
  readonly openTarget: OpenTarget | null;
}
