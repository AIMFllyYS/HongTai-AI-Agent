import { useEffect, useRef, useState, type RefObject } from "react";
import type { DiagnosisMessage } from "@hongtai/core";

import { Icon } from "../../components/Icon";
import { MarkdownText } from "../../components/MarkdownText";
import { Overlay, OverlayDragRegion } from "../../components/Overlay";
import {
  OBSERVATION_FOLLOW_UP_SHEET_INPUT_ID,
  ObservationFollowUpComposer,
} from "./observation-follow-up-composer";

export interface ObservationFollowUpSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly messages: readonly DiagnosisMessage[];
  readonly pendingQuestion: string | undefined;
  readonly streamedAnswer: string;
  readonly suggestions: readonly string[];
  readonly question: string;
  readonly diagnosisAvailable: boolean;
  readonly chatPending: boolean;
  readonly avatarUri: string | null | undefined;
  readonly displayInitial: string | undefined;
  readonly onQuestionChange: (value: string) => void;
  readonly onAsk: () => void;
  readonly onUseQuestion: (value: string) => void;
}

export function ObservationFollowUpSheet({
  open,
  onClose,
  messages,
  pendingQuestion,
  streamedAnswer,
  suggestions,
  question,
  diagnosisAvailable,
  chatPending,
  avatarUri,
  displayInitial,
  onQuestionChange,
  onAsk,
  onUseQuestion,
}: ObservationFollowUpSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, messages, pendingQuestion, streamedAnswer]);

  useEffect(() => {
    if (!copiedId) return undefined;
    const timer = window.setTimeout(() => setCopiedId(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const copyAnswer = async (messageId: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
    } catch {
      setCopiedId(undefined);
    }
  };

  return (
    <Overlay
      initialFocusRef={inputRef as RefObject<HTMLElement | null>}
      labelledBy="observation-follow-up-title"
      onClose={onClose}
      open={open}
      panelClassName="observation-follow-up-sheet"
      placement="rise"
    >
      <div className="observation-follow-up-sheet__head">
        <OverlayDragRegion className="observation-follow-up-sheet__grab" label="向下拖动收起">
          <div aria-hidden="true" className="observation-follow-up-sheet__handle" />
          <div className="observation-follow-up-sheet__title">
            <Icon name="message_circle" size={18} />
            <h2 id="observation-follow-up-title">AI 追问</h2>
          </div>
        </OverlayDragRegion>
        <button aria-label="关闭追问" className="icon-button observation-follow-up-sheet__close" onClick={onClose} onPointerDown={(event) => event.stopPropagation()} type="button">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="observation-follow-up-sheet__messages" ref={listRef}>
        {messages.map((message) => (
          <FollowUpMessage
            avatarUri={avatarUri}
            copied={copiedId === message.id}
            displayInitial={displayInitial}
            key={message.id}
            message={message}
            onCopy={() => void copyAnswer(message.id, message.content)}
          />
        ))}
        {pendingQuestion ? (
          <>
            <FollowUpMessage
              avatarUri={avatarUri}
              displayInitial={displayInitial}
              message={{
                id: "pending-user",
                sessionId: "",
                role: "user",
                content: pendingQuestion,
                status: "completed",
                createdAt: "",
                updatedAt: "",
              }}
            />
            <FollowUpMessage
              copied={copiedId === "streaming-assistant"}
              message={{
                id: "streaming-assistant",
                sessionId: "",
                role: "assistant",
                content: streamedAnswer,
                status: "streaming",
                createdAt: "",
                updatedAt: "",
              }}
              onCopy={streamedAnswer.trim() ? () => void copyAnswer("streaming-assistant", streamedAnswer) : undefined}
            />
          </>
        ) : null}
      </div>

      {suggestions.length ? (
        <div className="observation-follow-up-sheet__suggest">
          <p>追问推荐：</p>
          <div className="chip-row chip-row--scroll">
            {suggestions.map((item) => (
              <button className="chip" disabled={!diagnosisAvailable || chatPending} key={item} onClick={() => onUseQuestion(item)} type="button">
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ObservationFollowUpComposer
        disabled={!diagnosisAvailable}
        id={OBSERVATION_FOLLOW_UP_SHEET_INPUT_ID}
        inputRef={inputRef}
        onChange={onQuestionChange}
        onSubmit={onAsk}
        pending={chatPending}
        placeholder="继续针对本次记录追问..."
        value={question}
      />
    </Overlay>
  );
}

function FollowUpMessage({
  message,
  avatarUri,
  displayInitial,
  copied,
  onCopy,
}: {
  readonly message: DiagnosisMessage;
  readonly avatarUri?: string | null;
  readonly displayInitial?: string;
  readonly copied?: boolean;
  readonly onCopy?: () => void;
}) {
  const isUser = message.role === "user";
  const body = message.content || (message.status === "streaming" ? "正在生成回复…" : "");
  return (
    <article className={`observation-message is-${message.role} is-${message.status}`.trim()}>
      <div className="observation-message__bubble">
        <div className="observation-message__body">
          {isUser ? <p>{body}</p> : <MarkdownText value={body} />}
        </div>
        {!isUser && onCopy ? (
          <button className="observation-message__copy" onClick={onCopy} type="button">
            <Icon name="copy" size={14} />
            {copied ? "已复制" : "复制"}
          </button>
        ) : null}
      </div>
      {isUser ? <UserMark avatarUri={avatarUri} initial={displayInitial} /> : null}
    </article>
  );
}

function UserMark({ avatarUri, initial }: { readonly avatarUri?: string | null; readonly initial?: string }) {
  if (avatarUri) return <img alt="" className="observation-message__avatar" src={avatarUri} />;
  if (initial) return <span className="observation-message__avatar">{initial}</span>;
  return (
    <span className="observation-message__avatar">
      <Icon name="user" size={14} />
    </span>
  );
}
