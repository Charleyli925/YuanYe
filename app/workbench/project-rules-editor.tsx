"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { ListBulletsIcon } from "@phosphor-icons/react/dist/csr/ListBullets";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { TextBIcon } from "@phosphor-icons/react/dist/csr/TextB";
import { TextHIcon } from "@phosphor-icons/react/dist/csr/TextH";
import { TextItalicIcon } from "@phosphor-icons/react/dist/csr/TextItalic";
import type { ProjectRulesReaderCapability } from "../application/workspace-controller-capabilities.js";
import type { ProjectRulesSnapshot } from "../application/project-rules-session.js";

type MarkdownFormat = "heading" | "bold" | "italic" | "list" | "quote" | "code";

export type ProjectRulesEditorPageProps = Readonly<{
  activeTabId: string;
  capability: ProjectRulesReaderCapability;
  runLocked: boolean;
  onChange(content: string): void;
  onBeginComposition(input: { target: HTMLTextAreaElement; baselineValue: string }): void;
  onFinishComposition(input: { target: HTMLTextAreaElement }): void;
  onRestore(): void;
  onSave(): void;
  onRetry(): void;
}>;

function formatSelection(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
) {
  if (format === "heading" || format === "list" || format === "quote") {
    const blockStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const newline = value.indexOf("\n", Math.max(start, end));
    const blockEnd = newline < 0 ? value.length : newline;
    const block = value.slice(blockStart, blockEnd);
    const prefix = format === "heading" ? "## " : format === "list" ? "- " : "> ";
    const lines = block.split("\n");
    const nextLines = lines.map((line) => (
      line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`
    ));
    const replacement = nextLines.join("\n");
    return {
      value: `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`,
      start: blockStart,
      end: blockStart + replacement.length,
    };
  }

  const wrappers: Record<Exclude<MarkdownFormat, "heading" | "list" | "quote">, [string, string]> = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    code: ["`", "`"],
  };
  const [before, after] = wrappers[format];
  const selected = value.slice(start, end);
  const body = selected || "文本";
  return {
    value: `${value.slice(0, start)}${before}${body}${after}${value.slice(end)}`,
    start: start + before.length,
    end: start + before.length + body.length,
  };
}

function statusLabel(snapshot: ProjectRulesSnapshot, runLocked: boolean, dirty: boolean) {
  if (snapshot.loading) return "正在读取…";
  if (snapshot.error) return "读取失败";
  if (runLocked) return "AI 处理中，暂时只读";
  if (snapshot.saving) return "自动保存中…";
  if (snapshot.saveError) return "保存失败";
  if (dirty) return "待自动保存";
  return "已保存";
}

const EMPTY_RULES: ProjectRulesSnapshot = Object.freeze({
  open: false, path: "PROJECT.md", content: "", savedContent: "", loading: false,
  error: "", saving: false, saveError: "", compositionActive: false, editorGeneration: 0,
});

export default function ProjectRulesEditorPage({
  activeTabId,
  capability,
  runLocked,
  onChange,
  onBeginComposition,
  onFinishComposition,
  onRestore,
  onSave,
  onRetry,
}: ProjectRulesEditorPageProps) {
  const snapshot = useSyncExternalStore(
    capability.subscribe, capability.getSnapshot, capability.getSnapshot,
  ) ?? EMPTY_RULES;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousGenerationRef = useRef(snapshot.editorGeneration);
  const [editorContent, setEditorContent] = useState(snapshot.content);
  const previousContextKeyRef = useRef(
    `${snapshot.editorGeneration}:${snapshot.open ? "open" : "closed"}:${snapshot.savedContent}`,
  );
  const contextKey = `${snapshot.editorGeneration}:${snapshot.open ? "open" : "closed"}:${snapshot.savedContent}`;
  const disabled = runLocked || snapshot.loading || Boolean(snapshot.error) || !snapshot.open;
  const dirty = editorContent !== snapshot.savedContent;

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) return;
    previousContextKeyRef.current = contextKey;
    setEditorContent(snapshot.content);
  }, [contextKey, snapshot.content]);

  useEffect(() => {
    if (previousGenerationRef.current === snapshot.editorGeneration) return;
    previousGenerationRef.current = snapshot.editorGeneration;
    textareaRef.current?.focus({ preventScroll: true });
    const end = textareaRef.current?.value.length || 0;
    textareaRef.current?.setSelectionRange(end, end);
  }, [snapshot.editorGeneration]);

  const applyFormat = useCallback((format: MarkdownFormat) => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const result = formatSelection(
      editorContent,
      textarea.selectionStart,
      textarea.selectionEnd,
      format,
    );
    setEditorContent(result.value);
    onChange(result.value);
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus({ preventScroll: true });
      textareaRef.current.setSelectionRange(result.start, result.end);
    });
  }, [disabled, editorContent, onChange]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!disabled) onSave();
    }
  }, [disabled, onSave]);

  return (
    <section
      id="workbench-project-rules-outlet"
      className="workbench-project-rules-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
      data-rules-state={snapshot.error ? "error" : snapshot.loading ? "loading" : "ready"}
    >
      <div className="project-rules-editor-inner">
        <header className="project-rules-editor-header">
          <div className="project-rules-editor-title-row">
            <div>
              <p className="project-rules-editor-eyebrow">长期规则</p>
              <h1>长期规则</h1>
            </div>
          </div>
          <p className="project-rules-editor-description">
            每次 AI 修改开始时自动读取；本轮处理中的编辑从下一次任务生效。
          </p>
          <div className="project-rules-editor-status" role="status" aria-live="polite">
            <span className="project-rules-save-dot" data-state={
              snapshot.error ? "error" : snapshot.saving ? "saving" : dirty ? "dirty" : "saved"
            } />
            <span>{statusLabel(snapshot, runLocked, dirty)}</span>
            {dirty && !snapshot.saving && !snapshot.error && !runLocked ? (
              <button type="button" onClick={onSave}>
                <FloppyDiskIcon aria-hidden="true" size={14} weight="regular" />
                立即保存
              </button>
            ) : null}
          </div>
        </header>

        {snapshot.error ? (
          <div className="project-rules-editor-error" role="alert">
            <strong>长期规则暂时无法读取</strong>
            <span>{snapshot.error}</span>
            <button type="button" onClick={onRetry}>重试读取</button>
          </div>
        ) : (
          <>
            <div className="project-rules-editor-toolbar" role="toolbar" aria-label="Markdown 基础格式">
              <button type="button" disabled={disabled} onClick={() => applyFormat("heading")} aria-label="插入二级标题">
                <TextHIcon aria-hidden="true" size={16} weight="bold" />
                <span>标题</span>
              </button>
              <button type="button" disabled={disabled} onClick={() => applyFormat("bold")} aria-label="加粗">
                <TextBIcon aria-hidden="true" size={16} weight="bold" />
                <span>粗体</span>
              </button>
              <button type="button" disabled={disabled} onClick={() => applyFormat("italic")} aria-label="斜体">
                <TextItalicIcon aria-hidden="true" size={16} weight="bold" />
                <span>斜体</span>
              </button>
              <span className="project-rules-editor-toolbar-divider" aria-hidden="true" />
              <button type="button" disabled={disabled} onClick={() => applyFormat("list")} aria-label="插入列表">
                <ListBulletsIcon aria-hidden="true" size={16} weight="regular" />
                <span>列表</span>
              </button>
              <button type="button" disabled={disabled} onClick={() => applyFormat("quote")} aria-label="插入引用">
                <QuotesIcon aria-hidden="true" size={16} weight="regular" />
                <span>引用</span>
              </button>
              <button type="button" disabled={disabled} onClick={() => applyFormat("code")} aria-label="插入代码格式">
                <CodeIcon aria-hidden="true" size={16} weight="regular" />
                <span>代码</span>
              </button>
            </div>
            <textarea
              ref={textareaRef}
              key={`${snapshot.editorGeneration}:${snapshot.open ? "open" : "closed"}`}
              className="project-rules-editor-textarea"
              aria-label="长期规则内容"
              value={editorContent}
              disabled={disabled}
              spellCheck
              onChange={(event) => {
                setEditorContent(event.target.value);
                onChange(event.target.value);
              }}
              onCompositionStart={(event) => {
                onBeginComposition({
                  target: event.currentTarget,
                  baselineValue: event.currentTarget.value,
                });
              }}
              onCompositionEnd={(event) => {
                onFinishComposition({ target: event.currentTarget });
              }}
              onKeyDown={onKeyDown}
            />
            <footer className="project-rules-editor-footer">
              <span>长期规则会自动保存，也可以按 ⌘S 立即保存</span>
              {dirty && !runLocked ? (
                <button type="button" className="project-rules-restore" onClick={onRestore}>
                  <ArrowCounterClockwiseIcon aria-hidden="true" size={14} weight="regular" />
                  还原未保存修改
                </button>
              ) : null}
            </footer>
            {snapshot.saveError ? (
              <div className="project-rules-save-error" role="alert">
                <span>{snapshot.saveError}</span>
                <button type="button" onClick={onSave} disabled={runLocked}>再次保存</button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
