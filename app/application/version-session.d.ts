export type VersionViewMode = "current" | "history";

export type HistoryPreview = Readonly<{
  projectId: string;
  documentId: string;
  sourcePath: string;
  versionId: string;
  content: string;
  sha256: string;
}>;

export type VersionViewSnapshot = {
  historyPreview: HistoryPreview | null;
  viewMode: VersionViewMode;
  viewingVersionId: string | null;
};

export type VersionSessionSnapshot<TVersion = unknown> = VersionViewSnapshot & {
  versions: ReadonlyArray<TVersion>;
  latestVersionId: string | null;
  currentBasedOnVersionId: string | null;
  currentExactVersionId: string | null;
  restoredFromVersionId: string | null;
};

export function validateVersionSessionVersions<TVersion = unknown>(
  versions: ReadonlyArray<TVersion> | unknown,
): ReadonlyArray<TVersion>;

export class VersionSession<TVersion = unknown> {
  setObserver(
    observer: ((snapshot: VersionSessionSnapshot<TVersion>) => void) | null,
  ): void;
  reset(): void;
  hydrate(value: {
    versions: ReadonlyArray<TVersion>;
    latestVersionId?: unknown;
    currentBasedOnVersionId?: unknown;
    currentExactVersionId?: unknown;
    restoredFromVersionId?: unknown;
  }): VersionSessionSnapshot<TVersion>;
  updateAuthority(value: {
    versions?: ReadonlyArray<TVersion>;
    latestVersionId?: unknown;
    currentBasedOnVersionId?: unknown;
    currentExactVersionId?: unknown;
    restoredFromVersionId?: unknown;
  }): VersionSessionSnapshot<TVersion>;
  markSourceEdited(): boolean;
  adoptCommitted(versionId: string): boolean;
  enterHistory(versionId: string, preview?: HistoryPreview): boolean;
  returnCurrent(value?: {
    currentBasedOnVersionId?: unknown;
    currentExactVersionId?: unknown;
    restoredFromVersionId?: unknown;
  }): VersionSessionSnapshot<TVersion>;
  captureView(): VersionViewSnapshot;
  restoreView(view: VersionViewSnapshot): boolean;
  captureSnapshot(): VersionSessionSnapshot<TVersion>;
  restoreSnapshot(snapshot: VersionSessionSnapshot<TVersion>): boolean;
  readonly snapshot: VersionSessionSnapshot<TVersion>;
}
