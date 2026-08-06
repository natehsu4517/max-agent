"use client";

import type { ReviewCard } from "@/lib/engine/types";

const STATUS_LABEL: Record<string, { label: string; tone: "live" | "hold" | "block" | "muted" }> = {
  pending: { label: "awaiting review", tone: "hold" },
  blocked: { label: "blocked / dismiss only", tone: "block" },
  awaiting_human: { label: "needs a person", tone: "block" },
  sent: { label: "sent by a human", tone: "live" },
  dismissed: { label: "dismissed", tone: "muted" },
  auto_sent: { label: "sent automatically", tone: "muted" },
};

const TONE_TEXT = {
  live: "text-signal-live",
  hold: "text-signal-hold",
  block: "text-signal-block",
  muted: "text-text-muted",
} as const;

const TONE_DOT = {
  live: "bg-signal-live",
  hold: "bg-signal-hold",
  block: "bg-signal-block",
  muted: "bg-text-muted",
} as const;

function StatusLine({ status }: { status: string }) {
  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.dismissed;
  return (
    <span className="flex items-center gap-2 shrink-0">
      <span className={`h-[5px] w-[5px] rounded-full ${TONE_DOT[meta.tone]}`} aria-hidden="true" />
      <span
        className={`font-mono text-[9px] uppercase tracking-[0.15em] ${TONE_TEXT[meta.tone]}`}
      >
        {meta.label}
      </span>
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted">
      {children}
    </span>
  );
}

export function ReviewPane({
  cards,
  onSend,
  onDismiss,
}: {
  cards: ReviewCard[];
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="review-heading"
      className="flex min-h-0 flex-col border border-border-light bg-surface-elevated"
    >
      <header className="shrink-0 border-b border-border-light px-5 py-3.5">
        <h2
          id="review-heading"
          className="font-mono text-[11px] tracking-[0.06em] text-text font-bold"
        >
          #assistant-review
        </h2>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted">
          internal, the client cannot see this
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {cards.length === 0 && (
          <p className="font-body text-[12.5px] leading-[1.85] text-text-muted py-6">
            Nothing waiting. Drafts land here for a person before they can reach anyone.
          </p>
        )}

        <ul className="flex flex-col gap-5">
          {cards.map((card) => (
            <li key={card.id} className="rise-in border border-border-light">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light bg-surface px-3.5 py-2.5">
                <span className="font-mono text-[11px] tracking-[0.02em] text-text font-bold">
                  {card.clientName}
                </span>
                <StatusLine status={card.status} />
              </div>

              <div className="px-3.5 py-3.5">
                <Label>client said</Label>
                <p className="mt-1.5 font-body text-[12.5px] leading-[1.8] text-text-secondary">
                  {card.clientMessage}
                </p>

                {card.draftText ? (
                  <>
                    <div className="mt-4">
                      <Label>{card.status === "auto_sent" ? "what was sent" : "suggested reply"}</Label>
                    </div>
                    <p className="mt-1.5 border-l border-text/25 pl-3 font-body text-[12.5px] leading-[1.8] text-text">
                      {card.draftText}
                    </p>
                  </>
                ) : (
                  <p className="mt-4 font-body text-[12px] leading-[1.8] text-text-muted">
                    {card.needsSilent
                      ? "No draft, and no acknowledgement to the client. This category is handled quietly by a person."
                      : "No draft written. A person replies to this one for real."}
                  </p>
                )}

                <p className="mt-3 font-mono text-[10px] leading-[1.7] tracking-[0.01em] text-text-muted">
                  {card.reasoning}
                </p>

                {card.flags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {card.flags.map((f) => (
                      <span
                        key={f}
                        className="border border-signal-block/40 px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-signal-block"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {(card.status === "pending" || card.status === "blocked") && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border-light px-3.5 py-3">
                  {card.sendable ? (
                    <button
                      onClick={() => onSend(card.id)}
                      className="bg-text px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-bg transition-opacity hover:opacity-80"
                    >
                      Send to client
                    </button>
                  ) : (
                    // Deliberately not a disabled button: there is no send
                    // control on this card at all, which is the whole point.
                    <span
                      role="note"
                      className="border border-dashed border-border px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted"
                    >
                      no send button
                    </span>
                  )}
                  <button
                    onClick={() => onDismiss(card.id)}
                    className="border border-border-light px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-secondary transition-colors hover:bg-surface"
                  >
                    Dismiss
                  </button>
                  {!card.sendable && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-signal-block ml-auto">
                      never one tap from a client
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
