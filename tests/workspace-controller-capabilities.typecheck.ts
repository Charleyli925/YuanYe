import type {
  AiConversationControllerCapability,
  CommentControllerCapability,
  DocumentSurfaceControllerCapability,
  NavigationControllerCapability,
  NavigationWorkflowControllerCapability,
  ProjectCatalogControllerCapability,
  ReviewPreparationControllerCapability,
  RunControllerCapability,
  RunSubmissionControllerCapability,
  WorkspaceController,
  WorkspaceSnapshotReader,
} from "../app/application/workspace-controller.js";

declare const controller: WorkspaceController;
declare const conversation: AiConversationControllerCapability;
declare const comments: CommentControllerCapability;
declare const documentSurface: DocumentSurfaceControllerCapability;
declare const navigationFacet: NavigationControllerCapability;
declare const navigation: NavigationWorkflowControllerCapability;
declare const projectCatalog: ProjectCatalogControllerCapability;
declare const review: ReviewPreparationControllerCapability;
declare const runs: RunControllerCapability;
declare const runSubmission: RunSubmissionControllerCapability;
declare const snapshotReader: WorkspaceSnapshotReader;

const conversationView: AiConversationControllerCapability = controller;
const commentsView: CommentControllerCapability = controller.comments;
const documentSurfaceView: DocumentSurfaceControllerCapability = controller;
const navigationFacetView: NavigationControllerCapability = controller.navigation;
const navigationView: NavigationWorkflowControllerCapability = controller;
const projectCatalogView: ProjectCatalogControllerCapability = controller.projectCatalog;
const reviewView: ReviewPreparationControllerCapability = controller;
const runsView: RunControllerCapability = controller.runs;
const runSubmissionView: RunSubmissionControllerCapability = controller;
const snapshotView: WorkspaceSnapshotReader = controller;

void conversation.openConversation(null);
conversation.closeConversation();
void comments.getSnapshot();
void comments.subscribe(() => undefined);
comments.commands.updateDraft("draft");
void documentSurface.getSnapshot();
void documentSurface.updateDocumentSurfacePresentation("tab-1");
void navigationFacet.getSnapshot();
void navigationFacet.commands.createStartTab();
void navigation.subscribe(() => undefined);
void projectCatalog.commands.refreshRecents();
void review.prepareReviewCandidate({ run: null });
void runs.getSnapshot();
void runs.commands.cancel({ run: null });
void runSubmission.planRunSubmission();
void snapshotReader.getSnapshot();

// @ts-expect-error conversation views cannot mutate Document surface state.
conversation.updateDocumentSurfacePresentation("tab-1");
// @ts-expect-error comment capability does not expose workflow reset authority.
comments.commands.resetCommentWorkflow();
// @ts-expect-error comment capability cannot choose an Agent.
comments.commands.selectAgent({ providerId: "qoder", runtimeId: "acp" });
// @ts-expect-error review preparation cannot choose an Agent.
review.selectAgent({ providerId: "qoder", runtimeId: "acp" });
// @ts-expect-error submission planning cannot mutate comment drafts.
runSubmission.updateCommentDraft("draft");
// @ts-expect-error navigation cannot reach low-level document persistence.
navigation.flushDocument();
// @ts-expect-error the navigation facet cannot cancel a run.
navigationFacet.commands.cancel({ run: null });
// @ts-expect-error the run facet cannot edit PROJECT.md.
runs.commands.updateRules("# rules");
// @ts-expect-error snapshot readers cannot subscribe to controller changes.
snapshotReader.subscribe(() => undefined);

void conversationView;
void commentsView;
void documentSurfaceView;
void navigationFacetView;
void navigationView;
void projectCatalogView;
void reviewView;
void runsView;
void runSubmissionView;
void snapshotView;


// Local draft/message facts do not exist in the shell projection.
// @ts-expect-error conversation is owned by its own reader facet.
controller.shell.getSnapshot().conversation;
// @ts-expect-error shell cannot supply stale full composer text.
controller.shell.getSnapshot().commentSession?.composerDraft;
// @ts-expect-error shell cannot supply stale full edit draft text.
controller.shell.getSnapshot().commentSession?.editSession?.draftText;
// @ts-expect-error shell cannot supply stale PROJECT.md text.
controller.shell.getSnapshot().projectRules?.content;
// @ts-expect-error streaming narration belongs to the runs facet.
controller.shell.getSnapshot().runSession?.activeHandoff?.visibleText;
// @ts-expect-error reader facets cannot mutate source or other capabilities.
controller.conversation.flushDocument();
void controller.conversation.getSnapshot()?.draftText;
void controller.projectRules.getSnapshot()?.content;
