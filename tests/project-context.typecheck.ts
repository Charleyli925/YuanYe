import type {
  ManagedProjectContext,
  ProjectContext,
  ProjectLocator,
} from "../app/application/project-session.js";

const locator: ProjectLocator = { epoch: 1, sourcePath: "/synthetic/page.html" };
const registered: ProjectContext = {
  epoch: 1, sourcePath: "/synthetic/page.html", projectId: "project", documentId: "document",
};
const managed: ManagedProjectContext = {
  ...registered,
  projectRootPath: "/synthetic",
  targetKind: "working-copy",
  workingCopyId: "work_1",
  versionId: "ver_1",
  exactSourcePath: "/synthetic/page.html",
  sourceSha256: `sha256:${"0".repeat(64)}`,
  sessionEpoch: 1,
};

// @ts-expect-error a location alone is not registered identity
const locationAsAuthority: ProjectContext = locator;
// @ts-expect-error declaring a managed route requires its entire tuple
const partialManaged: ProjectContext = { ...registered, targetKind: "working-copy" };
// @ts-expect-error a partial source hash must not masquerade as a context
const hashOnly: ProjectContext = { ...registered, sourceSha256: "sha256:invalid" };

function inspect(context: ProjectContext) {
  if (context.targetKind) {
    const complete: ManagedProjectContext = context;
    const hash: string = complete.sourceSha256;
    void hash;
  }
}
void [managed, locationAsAuthority, partialManaged, hashOnly, inspect];
