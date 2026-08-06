"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/engine/types";
import { renderMrkdwn } from "./mrkdwn";

function timeLabel(at: number) {
  // Synthetic clock: minutes from a fixed 9:00 start, so server and client
  // never disagree and the page is deterministic.
  const total = 9 * 60 + at;
  const h24 = Math.floor((((total % 1440) + 1440) % 1440) / 60);
  const m = ((total % 60) + 60) % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

const AVATAR_BG: Record<ChatMessage["authorRole"], string> = {
  client: "bg-[#4a6fa5]",
  human: "bg-[#3d7a5c]",
  assistant: "bg-text",
  system: "bg-text-muted",
};

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function Message({ m, compact }: { m: ChatMessage; compact?: boolean }) {
  return (
    <div className={`group relative flex gap-2.5 px-5 ${compact ? "py-1" : "pt-2 pb-1"} hover:bg-surface/45`}>
      <div
        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold text-white ${AVATAR_BG[m.authorRole]}`}
        aria-hidden="true"
      >
        {initialsFor(m.author)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-sans text-[15px] font-bold leading-tight text-text">{m.author}</span>
          {m.authorRole === "assistant" && (
            <span className="rounded-[3px] bg-surface px-1 py-px font-sans text-[10px] font-bold uppercase leading-normal tracking-wide text-text-muted">
              App
            </span>
          )}
          <span className="font-sans text-[12px] text-text-muted">{timeLabel(m.at)}</span>
        </div>

        <p className="mt-0.5 whitespace-pre-wrap font-sans text-[15px] leading-[1.46] text-text">
          {renderMrkdwn(m.text)}
        </p>

        {m.wasRedacted && (
          <p className="mt-1 font-mono text-[11px] leading-snug text-signal-block">
            redacted on arrival, before anything downstream could read it
          </p>
        )}

        {m.reactions && m.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <span
                key={r.emoji}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] leading-normal ${
                  r.mine
                    ? "border-link/50 bg-link/10 text-link"
                    : "border-border-light bg-surface text-text-secondary"
                }`}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="font-sans text-[11px] font-bold tabular-nums">{r.count}</span>
              </span>
            ))}
          </div>
        )}

        {m.replies && m.replies.length > 0 && (
          <div className="mt-2 border-l-2 border-border-light pl-3">
            <p className="mb-1 font-sans text-[12px] font-bold text-link">
              {m.replies.length} {m.replies.length === 1 ? "reply" : "replies"}
            </p>
            {m.replies.map((r) => (
              <div key={r.id} className="flex gap-2 py-1">
                <div
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold text-white ${AVATAR_BG[r.authorRole]}`}
                  aria-hidden="true"
                >
                  {initialsFor(r.author)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-sans text-[13.5px] font-bold text-text">{r.author}</span>
                    {r.authorRole === "assistant" && (
                      <span className="rounded-[3px] bg-surface px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wide text-text-muted">
                        App
                      </span>
                    )}
                    <span className="font-sans text-[11.5px] text-text-muted">{timeLabel(r.at)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap font-sans text-[14px] leading-[1.46] text-text">
                    {renderMrkdwn(r.text)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChannelPane({
  channelName,
  members,
  topic,
  messages,
  onSend,
  placeholder,
}: {
  channelName: string;
  members: number;
  topic: string;
  messages: ChatMessage[];
  onSend?: (text: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit() {
    const text = draft.trim();
    if (!text || !onSend) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section
      aria-label={`Channel ${channelName}`}
      className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-border-light bg-surface-elevated"
    >
      <header className="shrink-0 border-b border-border-light px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-sans text-[15px] font-bold leading-tight text-text">
            <span className="text-text-muted">#</span>
            {channelName}
          </h2>
          <span className="flex items-center gap-1 rounded border border-border-light px-1.5 py-px font-sans text-[11px] text-text-secondary">
            <span aria-hidden="true">👤</span>
            <span className="tabular-nums">{members}</span>
          </span>
        </div>
        <p className="mt-1 font-sans text-[12.5px] leading-snug text-text-muted">{topic}</p>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-3" aria-live="polite">
        {messages.map((m, i) => (
          <Message key={m.id} m={m} compact={i > 0 && messages[i - 1].author === m.author && !m.replies} />
        ))}
      </div>

      {onSend && (
        <div className="shrink-0 px-4 pb-4 pt-1">
          <div className="rounded-[8px] border border-border focus-within:border-text-secondary">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder ?? `Message #${channelName}`}
              aria-label="Type a message as the client"
              className="w-full bg-transparent px-3 pt-2.5 pb-1 font-sans text-[15px] text-text placeholder:text-text-muted focus:outline-none"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-2 px-1 font-sans text-[13px] text-text-muted" aria-hidden="true">
                <span className="font-bold">B</span>
                <span className="italic">I</span>
                <span className="line-through">S</span>
                <span>🔗</span>
              </div>
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="rounded-[4px] bg-[#3d7a5c] px-3 py-1.5 font-sans text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:bg-surface disabled:text-text-muted"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
