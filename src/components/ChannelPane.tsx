"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/engine/types";

function Clock({ at }: { at: number }) {
  // Synthetic clock: minutes relative to a fixed 9:00 start, so the page is
  // deterministic and never disagrees with itself between server and client.
  const total = 9 * 60 + at;
  const h24 = Math.floor((((total % 1440) + 1440) % 1440) / 60);
  const m = ((total % 60) + 60) % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return (
    <span className="font-mono text-[9px] text-text-muted tabular-nums tracking-[0.02em]">
      {h}:{String(m).padStart(2, "0")}
      {h24 < 12 ? "am" : "pm"}
    </span>
  );
}

export function ChannelPane({
  channelName,
  subtitle,
  messages,
  onSend,
  placeholder,
}: {
  channelName: string;
  subtitle: string;
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
      className="flex min-h-0 flex-col border border-border-light bg-surface-elevated"
    >
      <header className="shrink-0 border-b border-border-light px-5 py-3.5">
        <h2 className="font-mono text-[11px] tracking-[0.06em] text-text font-bold">{channelName}</h2>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted">
          {subtitle}
        </p>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        <ul className="flex flex-col">
          {messages.map((m) => (
            <li key={m.id} className="rise-in pb-4 last:pb-0">
              <div className="flex items-baseline gap-2.5">
                <span
                  className={`font-mono text-[11px] tracking-[0.02em] ${
                    m.authorRole === "assistant"
                      ? "text-text-secondary"
                      : "text-text font-bold"
                  }`}
                >
                  {m.author}
                </span>
                {m.authorRole === "assistant" && (
                  <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-text-muted border border-border-light px-1 py-px">
                    app
                  </span>
                )}
                <Clock at={m.at} />
              </div>
              <p className="mt-1.5 font-body text-[13px] leading-[1.8] text-text-secondary whitespace-pre-wrap">
                {m.text}
              </p>
              {m.wasRedacted && (
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-signal-block">
                  redacted on arrival, before anything downstream could read it
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {onSend && (
        <div className="shrink-0 border-t border-border-light p-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder ?? "Message the channel"}
              aria-label="Type a message as the client"
              className="min-w-0 flex-1 border border-border-light bg-bg px-3 py-2.5 font-body text-[13px] text-text placeholder:text-text-muted focus:border-text focus:outline-none"
            />
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="shrink-0 bg-text px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-bg transition-opacity hover:opacity-80 disabled:opacity-25"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
