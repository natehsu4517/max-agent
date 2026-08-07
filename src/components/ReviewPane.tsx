"use client";

import { useEffect, useRef } from "react";
import type { ReviewCard, Scorecard } from "@/lib/engine/types";
import { renderMrkdwn } from "./mrkdwn";

const STATUS_LABEL: Record<string, { label: string; tone: "live" | "hold" | "block" | "muted" }> = {
  pending: { label: "Awaiting review", tone: "hold" },
  blocked: { label: "Blocked, dismiss only", tone: "block" },
  awaiting_human: { label: "Needs a person", tone: "block" },
  sent: { label: "Sent by a human", tone: "live" },
  dismissed: { label: "Dismissed", tone: "muted" },
  auto_sent: { label: "Sent automatically", tone: "muted" },
};

const TONE_TEXT = {
  live: "text-signal-live",
  hold: "text-signal-hold",
  block: "text-signal-block",
  muted: "text-text-muted",
} as const;

const TONE_BAR = {
  live: "bg-signal-live",
  hold: "bg-signal-hold",
  block: "bg-signal-block",
  muted: "bg-border",
} as const;

function toneFor(card: ReviewCard) {
  if (card.kind === "escalation") return card.acknowledged ? "live" : "block";
  if (card.kind === "scorecard") return "muted";
  return STATUS_LABEL[card.status]?.tone ?? "muted";
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-[11px] font-bold uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

function AppHeader({ at }: { at: number }) {
  const total = 9 * 60 + at;
  const h24 = Math.floor((((total % 1440) + 1440) % 1440) / 60);
  const m = ((total % 60) + 60) % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return (
    <div className="flex items-center gap-2 px-3.5 pt-3">
      <span className="flex size-5 items-center justify-center rounded-[4px] bg-text text-[9px] font-bold text-bg">
        M
      </span>
      <span className="font-sans text-[13.5px] font-bold text-text">Max</span>
      <span className="rounded-[3px] bg-surface px-1 py-px font-sans text-[9.5px] font-bold uppercase tracking-wide text-text-muted">
        App
      </span>
      <span className="font-sans text-[11.5px] text-text-muted">
        {h}:{String(m).padStart(2, "0")} {h24 < 12 ? "AM" : "PM"}
      </span>
    </div>
  );
}

function ScorecardBody({ s }: { s: Scorecard }) {
  const rows: Array<[string, number]> = [
    ["Messages seen", s.messagesSeen],
    ["Answered automatically", s.answeredAutomatically],
    ["Drafts a human sent", s.draftsSent],
    ["Drafts dismissed", s.draftsDismissed],
    ["Still awaiting review", s.awaitingReview],
    ["Needed a person", s.neededAPerson],
    ["Blocked by compliance", s.blockedByCompliance],
    ["PII redactions", s.piiRedactions],
    ["Pings avoided (human first)", s.pingsAvoided],
    ["Chose to say nothing", s.saidNothing],
  ];
  return (
    <div className="px-3.5 pb-3.5 pt-2">
      <p className="font-sans text-[14px] font-bold text-text">Daily scorecard</p>
      <p className="mt-0.5 font-sans text-[13px] leading-snug text-text-secondary">
        Tallied from this session. A quiet day still posts, so a broken assistant and a calm one
        never look the same.
      </p>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-border-light pt-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt
              className={`font-sans text-[13px] ${v > 0 ? "text-text-secondary" : "text-text-muted"}`}
            >
              {k}
            </dt>
            <dd
              className={`text-right font-sans text-[13px] tabular-nums ${
                v > 0 ? "font-bold text-text" : "text-text-muted"
              }`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ReviewPane({
  cards,
  onSend,
  onDismiss,
  onAcknowledge,
  onPostScorecard,
}: {
  cards: ReviewCard[];
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onPostScorecard: () => void;
}) {
  // Follow the newest card, exactly as the client channel follows its newest
  // message. Without this the payoff of the case the page opens on, a draft
  // rendered with no send control at all, sits below this pane's fold.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cards]);

  return (
    <section
      aria-labelledby="review-heading"
      className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-border-light bg-surface-elevated"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border-light px-5 py-3">
        <div className="min-w-0">
          <h2 id="review-heading" className="font-sans text-[15px] font-bold leading-tight text-text">
            <span className="text-text-muted">#</span>assistant-review
          </h2>
          <p className="mt-1 font-sans text-[12.5px] leading-snug text-text-muted">
            Internal. The client is not in this channel.
          </p>
        </div>
        <button
          onClick={onPostScorecard}
          className="shrink-0 rounded-[4px] border border-border px-2.5 py-1.5 font-sans text-[12px] font-bold text-text-secondary transition-colors hover:bg-surface"
        >
          Post scorecard
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {cards.length === 0 && (
          <p className="px-1 py-4 font-sans text-[13.5px] leading-relaxed text-text-muted">
            Nothing waiting. Drafts, escalations and the daily digest land here, where a person sees
            them before a client can.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {cards.map((card) => {
            const tone = toneFor(card);
            const meta = STATUS_LABEL[card.status];
            return (
              <li key={card.id} className="flex overflow-hidden rounded-[6px] bg-surface/40">
                {/* Slack attachment colour bar */}
                <span className={`w-1 shrink-0 ${TONE_BAR[tone]}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 border border-l-0 border-border-light">
                  <AppHeader at={card.at} />

                  {card.kind === "scorecard" && card.scorecard ? (
                    <ScorecardBody s={card.scorecard} />
                  ) : card.kind === "escalation" ? (
                    <div className="px-3.5 pb-3.5 pt-2">
                      <p className="font-sans text-[14px] leading-snug text-text">
                        <span className="rounded-[3px] bg-link/10 px-1 font-bold text-link">
                          {card.mention}
                        </span>{" "}
                        {card.acknowledged
                          ? "picked this up."
                          : "this one needs you."}{" "}
                        {/* What the client actually heard. Saying "not left waiting in
                            silence" on a card where nothing was sent is the kind of
                            small lie that costs the whole page its credibility. */}
                        <span className="text-text-secondary">
                          {card.needsSilent
                            ? "The client got no automated reply at all, which is deliberate for this category."
                            : card.draftText
                              ? "The client has a short holding note, nothing more."
                              : "Max had nothing safe to say, so the client is waiting on you."}
                        </span>
                      </p>
                      <p className="mt-2 border-l-2 border-border pl-2.5 font-sans text-[13.5px] leading-relaxed text-text-secondary">
                        {card.clientMessage}
                      </p>
                      {!card.needsSilent && card.draftText && (
                        <>
                          <div className="mt-3">
                            <Label>Already sent to the client</Label>
                          </div>
                          <p className="mt-1 border-l-2 border-border pl-2.5 font-sans text-[13.5px] leading-relaxed text-text">
                            {renderMrkdwn(card.draftText)}
                          </p>
                        </>
                      )}
                      <p className="mt-2 font-sans text-[12.5px] leading-snug text-text-muted">
                        {card.reasoning}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-[4px] border border-border px-2.5 py-1.5 font-sans text-[12.5px] font-bold text-text-secondary">
                          Jump to {card.clientName}
                        </span>
                        {card.acknowledged ? (
                          <span className="flex items-center gap-1 rounded-full border border-signal-live/40 bg-signal-live/10 px-2 py-0.5 font-sans text-[12px] text-signal-live">
                            <span aria-hidden="true">✅</span> handled
                          </span>
                        ) : (
                          <button
                            onClick={() => onAcknowledge(card.id)}
                            className="flex items-center gap-1.5 rounded-full border border-border-light px-2.5 py-1 font-sans text-[12px] text-text-secondary transition-colors hover:bg-surface"
                          >
                            <span aria-hidden="true">✅</span> mark handled
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="px-3.5 pb-3.5 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-sans text-[13.5px] font-bold text-text">
                          {card.clientName}
                        </span>
                        {meta && (
                          <span className={`font-sans text-[12px] font-bold ${TONE_TEXT[tone]}`}>
                            {meta.label}
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5">
                        <Label>Client said</Label>
                      </div>
                      <p className="mt-1 font-sans text-[13.5px] leading-relaxed text-text-secondary">
                        {card.clientMessage}
                      </p>

                      {card.draftText ? (
                        <>
                          <div className="mt-3">
                            <Label>
                              {card.status === "auto_sent" ? "What was sent" : "Suggested reply"}
                            </Label>
                          </div>
                          <p className="mt-1 border-l-2 border-border pl-2.5 font-sans text-[13.5px] leading-relaxed text-text">
                            {renderMrkdwn(card.draftText)}
                          </p>
                        </>
                      ) : (
                        <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-muted">
                          {card.needsSilent
                            ? "No draft, and no acknowledgement to the client. This category is handled quietly by a person."
                            : "No draft written. A person replies to this one for real."}
                        </p>
                      )}

                      <p className="mt-2.5 font-sans text-[12.5px] leading-snug text-text-muted">
                        {card.reasoning}
                      </p>

                      {card.flags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {card.flags.map((f) => (
                            <span
                              key={f}
                              className="rounded-[3px] border border-signal-block/40 px-1.5 py-0.5 font-mono text-[10.5px] text-signal-block"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}

                      {(card.status === "pending" || card.status === "blocked") && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-light pt-3">
                          {card.sendable ? (
                            <button
                              onClick={() => onSend(card.id)}
                              className="rounded-[4px] bg-[#3d7a5c] px-3 py-1.5 font-sans text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
                            >
                              Send to client
                            </button>
                          ) : (
                            // Deliberately not a disabled button: there is no
                            // send control on this card at all.
                            <span
                              role="note"
                              className="rounded-[4px] border border-dashed border-border px-3 py-1.5 font-sans text-[12.5px] font-bold text-text-muted"
                            >
                              No send button
                            </span>
                          )}
                          <button
                            onClick={() => onDismiss(card.id)}
                            className="rounded-[4px] border border-border px-3 py-1.5 font-sans text-[12.5px] font-bold text-text-secondary transition-colors hover:bg-surface"
                          >
                            Dismiss
                          </button>
                          {!card.sendable && (
                            <span className="ml-auto font-sans text-[12px] text-signal-block">
                              never one tap from a client
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
