import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import type { PagePresentationAction } from "../lib/page-view-context.js";
import type { MoveAvailability } from "./html-canvas-selection";
import type {
  EditableStyleProperty,
  SelectedStyle,
} from "./html-canvas-computed-style";
import type {
  CanvasCapabilityHoverSnapshot,
  CanvasHoverHintPlacement,
} from "./html-canvas-capability-hover";
import type { NoticeUsageCapture } from "./NoticeBar";
import type {
  HtmlCanvasInteractionMode,
  HtmlCanvasSelection,
} from "./HtmlCanvasEditor.types";
import type { ElementCopyAvailability } from "./html-canvas-pointer-proof.js";

export type HtmlCanvasCommentMarker = {
  key: string;
  selection: HtmlCanvasSelection;
  count?: number;
  label?: string;
  placement?: "target-corner" | "tab-side";
  left: number;
  top: number;
};

export type HtmlCanvasEditFeedback = {
  code: string;
  title: string;
  message: string;
  tone: "warning" | "error";
  sticky: boolean;
  recovery: "reload" | "none";
};

export type CapabilityHoverState =
  | { kind: "off" }
  | {
    kind: "preview";
    capability: NonNullable<CanvasCapabilityHoverSnapshot["capability"]>;
    outlineStyle: CSSProperties;
    hint: {
      style: CSSProperties;
      placement: CanvasHoverHintPlacement;
    } | null;
  };

export type SelectionOverlayState =
  | { kind: "none" }
  | {
    kind: "target";
    selection: HtmlCanvasSelection;
    outlineStyle?: CSSProperties;
  };

export type SelectionChromeModel = {
  hover: CapabilityHoverState;
  overlay: SelectionOverlayState;
  canvasTransitionActive: boolean;
  selectionCapabilitySpoken: string;
  interactionLocked: boolean;
  hoverHintMeasureRef: RefObject<HTMLDivElement | null>;
  editFeedback: HtmlCanvasEditFeedback | null;
  reloadActionLabel: string;
  editFeedbackActionAvailable: boolean;
  renderedMode: HtmlCanvasInteractionMode;
  commentMarkers: readonly HtmlCanvasCommentMarker[];
  toolbarVisible: boolean;
  overlayPosition: { toolbarLeft: number; toolbarTop: number } | null;
  toolbarRef: RefObject<HTMLDivElement | null>;
  hasTextRange: boolean;
  isEditing: boolean;
  toolbarStyle: CSSProperties | undefined;
  selectedPagePresentationAction: PagePresentationAction | null;
  activeFrameGeneration: number;
  currentNativeDomGeneration: number;
  readOnly: boolean;
  selectedNativeEditAvailable: boolean;
  selectedStyle: SelectedStyle;
  textFormatRequiresSelection: boolean;
  enableReorder: boolean;
  moveAvailability: MoveAvailability;
  elementCopyAvailability: ElementCopyAvailability;
  deleteCommentCount: number;
  deleteCommentDraftIncluded: boolean;
  spacingMenuRef: RefObject<HTMLDetailsElement | null>;
  spacingMenuOpen: boolean;
  usageProjectId?: string;
  usageCapture?: NoticeUsageCapture;
};

export type SelectionChromeActions = {
  onHoverHintPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHoverHintPointerEnter: () => void;
  onHoverHintPointerLeave: () => void;
  onHoverHintClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onEditFeedbackAction: () => void;
  onDismissEditFeedback: () => void;
  onPauseEditFeedback: (paused: boolean) => void;
  onSelectCommentMarker: (selection: HtmlCanvasSelection) => void;
  onToolbarKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onToolbarPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarMouseDownCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onExecutePresentationAction: () => void;
  onComment: () => void;
  onStartEditing: () => void;
  onApplyInlineStyle: (property: EditableStyleProperty, value: string) => void;
  onMoveSelected: (direction: "up" | "down") => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onToggleSpacingMenu: () => void;
};

export type SelectionChromeProjection = Readonly<{
  toolbarStyle?: CSSProperties;
  selectedOutlineStyle?: CSSProperties;
  hoverOutlineStyle?: CSSProperties;
  hoverHintStyle?: CSSProperties;
  hoverHintPlacement?: CanvasHoverHintPlacement;
  selectedPagePresentationAction: PagePresentationAction | null;
}>;

export {
  deriveCapabilityHoverState,
  deriveSelectionOverlay,
  selectionChromeViewFields,
  stabilizeSelectionChromeProjection,
} from "./html-canvas-selection-chrome-state.js";
