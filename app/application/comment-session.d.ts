export type CommentSessionSnapshot<
  TComment = unknown,
  TEvent = unknown,
  TAttachment = unknown,
  TTarget = unknown,
  TEditSession = unknown,
> = {
  /** Decoded comments have one writable sourceAnchor; legacy target belongs to the codec only. */
  comments: TComment[];
  changeEvents: TEvent[];
  deletedCommentIds: string[];
  composerDraft: string;
  composerCommentId: string | null;
  composerAttachments: TAttachment[];
  composerTarget: TTarget | null;
  editSession: TEditSession | null;
};

export class CommentSession<
  TComment = unknown,
  TEvent = unknown,
  TAttachment = unknown,
  TTarget = unknown,
  TEditSession = unknown,
> {
  setObserver(
    observer: ((
      snapshot: CommentSessionSnapshot<
        TComment,
        TEvent,
        TAttachment,
        TTarget,
        TEditSession
      >,
    ) => void) | null,
  ): void;
  subscribe(
    listener: (
      snapshot: CommentSessionSnapshot<
        TComment,
        TEvent,
        TAttachment,
        TTarget,
        TEditSession
      >,
    ) => void,
  ): () => void;
  reset(): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  update(value: {
    comments?: TComment[];
    changeEvents?: TEvent[];
    deletedCommentIds?: Iterable<string>;
    composerDraft?: string;
    composerCommentId?: string | null;
    composerAttachments?: TAttachment[];
    composerTarget?: TTarget | null;
    editSession?: TEditSession | null;
  }): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setComments(comments: TComment[]): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setChangeEvents(changeEvents: TEvent[]): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setComposerDraft(composerDraft: string): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setComposerCommentId(composerCommentId: string | null): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setComposerAttachments(composerAttachments: TAttachment[]): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setComposerTarget(composerTarget: TTarget | null): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  setEditSession(editSession: TEditSession | null): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  clearComposer(): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  replaceDeletedCommentIds(commentIds: Iterable<string>): CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
  markDeleted(commentId: string): boolean;
  unmarkDeleted(commentId: string): boolean;
  clearDeletedCommentIds(): boolean;
  readonly comments: TComment[];
  readonly changeEvents: TEvent[];
  readonly deletedCommentIds: Set<string>;
  readonly composerDraft: string;
  readonly composerCommentId: string | null;
  readonly composerAttachments: TAttachment[];
  readonly composerTarget: TTarget | null;
  readonly editSession: TEditSession | null;
  readonly snapshot: CommentSessionSnapshot<
    TComment,
    TEvent,
    TAttachment,
    TTarget,
    TEditSession
  >;
}
