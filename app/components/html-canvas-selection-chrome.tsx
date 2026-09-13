"use client";

import { memo, type CSSProperties } from "react";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CopySimpleIcon } from "@phosphor-icons/react/dist/csr/CopySimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";

import {
  isPageRootSelection,
} from "./html-canvas-selection";
import {
  selectionChromeViewFields,
  type SelectionChromeActions,
  type SelectionChromeModel,
} from "./html-canvas-selection-chrome-contract";
import NoticeBar from "./NoticeBar";
import styles from "./HtmlCanvasEditor.module.css";

export type {
  HtmlCanvasCommentMarker,
  HtmlCanvasEditFeedback,
} from "./html-canvas-selection-chrome-contract";

export type HtmlCanvasSelectionChromeProps = {
  model: SelectionChromeModel;
  actions: SelectionChromeActions;
};

export const HtmlCanvasSelectionChrome = memo(function HtmlCanvasSelectionChrome({
  model,
  actions,
}: HtmlCanvasSelectionChromeProps) {
  const {
    canvasTransitionActive,
    selectionCapabilitySpoken,
    interactionLocked,
    hoverHintMeasureRef,
    editFeedback,
    reloadActionLabel,
    editFeedbackActionAvailable,
    renderedMode,
    commentMarkers,
    toolbarVisible,
    overlayPosition,
    toolbarRef,
    hasTextRange,
    isEditing,
    toolbarStyle,
    selectedPagePresentationAction,
    activeFrameGeneration,
    currentNativeDomGeneration,
    readOnly,
    selectedNativeEditAvailable,
    selectedStyle,
    textFormatRequiresSelection,
    enableReorder,
    moveAvailability,
    elementCopyAvailability,
    deleteCommentCount,
    deleteCommentDraftIncluded,
    spacingMenuRef,
    spacingMenuOpen,
    usageProjectId,
    usageCapture,
  } = model;
  const {
    showHoverOutline,
    showHoverHint,
    hoverOutlineStyle,
    hoverHintStyle,
    hoverHintPlacement,
    hoverCapability,
    selection,
    selectedOutlineStyle,
  } = selectionChromeViewFields(model);
  const {
    onHoverHintPointerDown,
    onHoverHintPointerEnter,
    onHoverHintPointerLeave,
    onHoverHintClick,
    onEditFeedbackAction,
    onDismissEditFeedback,
    onPauseEditFeedback,
    onSelectCommentMarker,
    onToolbarKeyDown,
    onToolbarPointerDownCapture,
    onToolbarMouseDownCapture,
    onExecutePresentationAction,
    onComment,
    onStartEditing,
    onApplyInlineStyle,
    onMoveSelected,
    onDuplicateSelected,
    onDeleteSelected,
    onToggleSpacingMenu,
  } = actions;
  return (
    <>
      <div
        className="canvas-transition-overlay"
        data-active={canvasTransitionActive ? "true" : undefined}
        aria-hidden="true"
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectionCapabilitySpoken}
      </div>
      {!interactionLocked && selection && selectedOutlineStyle ? (
        <div
          className={styles.targetOutline}
          data-testid="canvas-target-outline"
          data-tone="selected"
          style={selectedOutlineStyle}
          aria-hidden="true"
        />
      ) : null}
      {showHoverOutline && hoverOutlineStyle ? (
        <div
          className={styles.targetOutline}
          data-testid="canvas-capability-outline"
          data-tone="hover"
          style={hoverOutlineStyle}
          aria-hidden="true"
        />
      ) : null}
      {showHoverOutline && showHoverHint && hoverHintStyle && hoverCapability ? (
        <>
          <div
            ref={hoverHintMeasureRef}
            className={`${styles.hoverHint} ${styles.hoverHintMeasure}`}
            aria-hidden="true"
          >
            {hoverCapability.hint}
          </div>
          <div
            className={styles.hoverHint}
            data-testid="canvas-capability-hint"
            data-placement={hoverHintPlacement?.placement}
            data-capability-target-id={hoverCapability.selection.elementId}
            data-capability-target-key={hoverCapability.targetKey}
            data-capability-target-dom-generation={String(hoverCapability.generation)}
            data-capability-current-dom-generation={String(currentNativeDomGeneration)}
            data-capability-active-frame-generation={String(activeFrameGeneration)}
            data-html-canvas-preserve-selection="true"
            style={hoverHintStyle}
            role="button"
            aria-label={hoverCapability.hint}
            onPointerDown={onHoverHintPointerDown}
            onPointerEnter={onHoverHintPointerEnter}
            onPointerLeave={onHoverHintPointerLeave}
            onClick={onHoverHintClick}
          >
            {hoverCapability.hint}
          </div>
        </>
      ) : null}
      {editFeedback && !interactionLocked ? (
        <NoticeBar
          placement="viewport"
          title={editFeedback.title}
          message={editFeedback.message}
          tone={editFeedback.tone}
          actionLabel={editFeedback.recovery === "reload"
            ? reloadActionLabel
            : undefined}
          onAction={editFeedbackActionAvailable ? onEditFeedbackAction : undefined}
          onDismiss={onDismissEditFeedback}
          onPauseChange={onPauseEditFeedback}
          dismissLabel="关闭修改提示"
          usageCode={editFeedback.code}
          usageDisposition={editFeedback.recovery === "none"
            ? "inform-in-place"
            : "direct-action"}
          usageSurface="canvas"
          usageProjectId={usageProjectId}
          usageCapture={usageCapture}
        />
      ) : null}

      {interactionLocked ? (
        <div
          className={styles.lockNotice}
          data-mode={renderedMode}
          role="status"
          aria-label={
            renderedMode === "history"
              ? "正在查看历史版本，只读"
              : "本轮已锁定，仅可滚动浏览"
          }
        >
          <span className={styles.lockGlyph} aria-hidden="true"><span /></span>
          <span>
            {renderedMode === "history"
              ? "正在查看历史版本 · 只读"
              : "本轮已锁定 · 仅可浏览"}
          </span>
        </div>
      ) : null}

      {!interactionLocked ? commentMarkers.map((marker) => (
        <button
          key={marker.key}
          type="button"
          className={styles.commentMarker}
          data-global={isPageRootSelection(marker.selection) ? "true" : undefined}
          data-placement={marker.placement}
          style={{ left: marker.left, top: marker.top }}
          aria-label={marker.count && marker.count > 1
            ? `${marker.label || marker.selection.label}已有${marker.count}条评论`
            : marker.label || `${marker.selection.label}已有1条评论`}
          title={`查看${marker.label || marker.selection.label}的${marker.count || 1}条评论`}
          onClick={() => onSelectCommentMarker(marker.selection)}
        >
          <span className={styles.commentGlyph} aria-hidden="true">
            评{marker.count || 1}
          </span>
        </button>
      )) : null}

      {!interactionLocked
      && toolbarVisible
      && selection
      && !isPageRootSelection(selection)
      && overlayPosition ? (
        <div
          ref={toolbarRef}
          className={styles.toolbar}
          data-selection-level={selection.level}
          data-text-range={hasTextRange ? "true" : undefined}
          data-text-editing={isEditing ? "true" : undefined}
          style={toolbarStyle}
          role="toolbar"
          aria-label={`${selection.visualHint?.runtimeGenerated ? "评论" : "编辑"}${selection.label}`}
          onKeyDown={onToolbarKeyDown}
          onPointerDownCapture={onToolbarPointerDownCapture}
          onMouseDownCapture={onToolbarMouseDownCapture}
        >
          <div className={styles.toolbarRow}>
          {selectedPagePresentationAction ? (
            <>
              <button
                type="button"
                className={`${styles.toolButton} ${styles.presentationToolButton}`}
                data-presentation-kind={selectedPagePresentationAction.kind}
                data-current={selectedPagePresentationAction.isCurrent ? "true" : undefined}
                aria-label={selectedPagePresentationAction.label}
                aria-pressed={
                  selectedPagePresentationAction.kind === "activate-tab"
                    ? selectedPagePresentationAction.isCurrent
                    : undefined
                }
                title={
                  selectedPagePresentationAction.isCurrent
                    ? "当前页签"
                    : "快捷操作：按住 ⌥ 并单击页面中的这个控件"
                }
                onClick={onExecutePresentationAction}
              >
                {selectedPagePresentationAction.label}
              </button>
              <span className={styles.toolbarDivider} aria-hidden="true" />
            </>
          ) : null}

          <button
            type="button"
            className={styles.commentToolButton}
            aria-label={`给${selection.label}留评论`}
            onClick={onComment}
          >
            评论
          </button>

          {!readOnly && selection.level === "part" ? (
            <>
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={isEditing}
                disabled={!selectedNativeEditAvailable}
                title={!selectedNativeEditAvailable
                  ? "这段内容不是当前源码中的唯一静态文字"
                  : "像文档一样在原位置编辑文字"}
                onClick={onStartEditing}
              >
                {isEditing ? "编辑中" : "编辑"}
              </button>

              <div className={styles.formatGroup} aria-label="文字格式">
                <button
                  type="button"
                  className={styles.formatButton}
                  data-native-format-focus="preserve"
                  aria-pressed={selectedStyle.isBold}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "加粗"}
                  onClick={() => onApplyInlineStyle("fontWeight", selectedStyle.isBold ? "normal" : "700")}
                >
                  <strong aria-hidden="true">B</strong>
                  <span className={styles.visuallyHidden}>加粗</span>
                </button>
                <button
                  type="button"
                  className={styles.formatButton}
                  data-native-format-focus="preserve"
                  aria-pressed={selectedStyle.isItalic}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "斜体"}
                  onClick={() => onApplyInlineStyle("fontStyle", selectedStyle.isItalic ? "normal" : "italic")}
                >
                  <em aria-hidden="true">I</em>
                  <span className={styles.visuallyHidden}>斜体</span>
                </button>
                <button
                  type="button"
                  className={styles.formatButton}
                  data-native-format-focus="preserve"
                  aria-pressed={selectedStyle.isUnderline}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "下划线"}
                  onClick={() => onApplyInlineStyle(
                    "textDecorationLine",
                    selectedStyle.isUnderline ? "none" : "underline",
                  )}
                >
                  <span className={styles.underlineGlyph} aria-hidden="true">U</span>
                  <span className={styles.visuallyHidden}>下划线</span>
                </button>
              </div>

              <details
                ref={spacingMenuRef}
                className={styles.spacingMenu}
                open={spacingMenuOpen}
              >
                <summary
                  aria-expanded={spacingMenuOpen}
                  onClick={(event) => {
                    event.preventDefault();
                    onToggleSpacingMenu();
                  }}
                >样式与间距</summary>
                <div className={styles.spacingPanel} aria-label="样式与间距">
                  <div className={styles.popoverSection} aria-label="文字与颜色">
                    <span className={styles.popoverSectionLabel}>文字与颜色</span>
                    <label className={styles.controlRow}>
                      <span>字号</span>
                      <span className={styles.numberValue}>
                        <input
                          type="number"
                          min="8"
                          max="120"
                          step="1"
                          value={selectedStyle.fontSize}
                          disabled={textFormatRequiresSelection}
                          aria-label="字号（像素）"
                          onChange={(event) => {
                            const value = Math.max(8, Math.min(120, Number(event.currentTarget.value)));
                            if (Number.isFinite(value)) onApplyInlineStyle("fontSize", `${value}px`);
                          }}
                        />
                        <small>px</small>
                      </span>
                    </label>
                    <label className={styles.controlRow}>
                      <span>字色</span>
                      <span
                        className={styles.colorValue}
                        style={{ "--toolbar-swatch": selectedStyle.color } as CSSProperties}
                      >
                        <span className={styles.colorSwatch} aria-hidden="true" />
                        <span>{selectedStyle.color.toUpperCase()}</span>
                        <input
                          type="color"
                          value={selectedStyle.color}
                          disabled={textFormatRequiresSelection}
                          aria-label="文字颜色"
                          onChange={(event) => onApplyInlineStyle("color", event.currentTarget.value)}
                        />
                      </span>
                    </label>
                    <label className={styles.controlRow}>
                      <span>填充</span>
                      <span
                        className={styles.colorValue}
                        style={{ "--toolbar-swatch": selectedStyle.backgroundColor } as CSSProperties}
                      >
                        <span className={styles.colorSwatch} aria-hidden="true" />
                        <span>{selectedStyle.backgroundColor.toUpperCase()}</span>
                        <input
                          type="color"
                          value={selectedStyle.backgroundColor}
                          disabled={textFormatRequiresSelection}
                          aria-label="元素填充色"
                          onChange={(event) => onApplyInlineStyle("backgroundColor", event.currentTarget.value)}
                        />
                      </span>
                    </label>
                  </div>

                  <div className={styles.popoverSection} aria-label="间距">
                    <span className={styles.popoverSectionLabel}>间距</span>
                    <label className={styles.controlRow}>
                      <span>内边距</span>
                      <span className={styles.numberValue}>
                        <input
                          type="number"
                          min="0"
                          max="240"
                          step="1"
                          value={selectedStyle.padding}
                          aria-label="内边距（像素）"
                          onChange={(event) => {
                            const value = Math.max(0, Math.min(240, Number(event.currentTarget.value)));
                            if (Number.isFinite(value)) onApplyInlineStyle("padding", `${value}px`);
                          }}
                        />
                        <small>px</small>
                      </span>
                    </label>
                    <label className={styles.controlRow}>
                      <span>外间距</span>
                      <span className={styles.numberValue}>
                        <input
                          type="number"
                          min="-120"
                          max="240"
                          step="1"
                          value={selectedStyle.margin}
                          aria-label="外间距（像素）"
                          onChange={(event) => {
                            const value = Math.max(-120, Math.min(240, Number(event.currentTarget.value)));
                            if (Number.isFinite(value)) onApplyInlineStyle("margin", `${value}px`);
                          }}
                        />
                        <small>px</small>
                      </span>
                    </label>
                    <label className={styles.controlRow}>
                      <span>行距</span>
                      <span className={styles.numberValue}>
                        <input
                          type="number"
                          min="8"
                          max="240"
                          step="1"
                          value={selectedStyle.lineHeight}
                          aria-label="行距（像素）"
                          onChange={(event) => {
                            const value = Math.max(8, Math.min(240, Number(event.currentTarget.value)));
                            if (Number.isFinite(value)) onApplyInlineStyle("lineHeight", `${value}px`);
                          }}
                        />
                        <small>px</small>
                      </span>
                    </label>
                  </div>
                </div>
              </details>
            </>
          ) : null}
          {!readOnly && enableReorder ? (
            <div className={styles.moveGroup} aria-label="结构操作">
              <button
                type="button"
                className={styles.iconButton}
                aria-label="上移"
                data-tooltip="上移（Option + ↑）"
                data-tooltip-side="below"
                disabled={!moveAvailability.up}
                onClick={() => onMoveSelected("up")}
              >
                <ArrowUpIcon size={15} weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="下移"
                data-tooltip="下移（Option + ↓）"
                data-tooltip-side="below"
                disabled={!moveAvailability.down}
                onClick={() => onMoveSelected("down")}
              >
                <ArrowDownIcon size={15} weight="bold" aria-hidden="true" />
              </button>
              {elementCopyAvailability !== "unsupported" ? (
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="复制元素"
                  data-tooltip="复制元素"
                  data-tooltip-side="below"
                  disabled={elementCopyAvailability === "busy"}
                  onClick={onDuplicateSelected}
                >
                  <CopySimpleIcon size={15} weight="bold" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className={styles.iconButton}
                aria-label="删除元素"
                data-tooltip="删除元素"
                data-tooltip-side="below"
                onClick={() => {
                  const commentWarning = deleteCommentCount > 0
                    ? `\n\n关联的 ${deleteCommentCount} 条评论${deleteCommentDraftIncluded
                      ? "和未保存草稿"
                      : ""}也会一起删除。`
                    : deleteCommentDraftIncluded
                      ? "\n\n未保存的评论草稿也会一起删除。"
                      : "";
                  if (window.confirm(
                    `确定删除“${selection.label}”及其全部内容吗？${commentWarning}`,
                  )) {
                    onDeleteSelected();
                  }
                }}
              >
                <TrashIcon size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
});
