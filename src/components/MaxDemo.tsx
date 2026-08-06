"use client";

import { useCallback, useMemo, useState } from "react";
import { ChannelPane } from "./ChannelPane";
import { ReviewPane } from "./ReviewPane";
import { TracePanel } from "./TracePanel";
import { runPipeline } from "@/lib/engine/pipeline";
import { legacyClassify, legacyWouldAutoSend } from "@/lib/engine/simulate";
import { ADVISOR, CHANNEL_HISTORY, CLIENT, SCENARIOS, type Scenario } from "@/lib/scenarios";
import type { ChatMessage, PipelineResult, ReviewCard } from "@/lib/engine/types";

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function MaxDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>(CHANNEL_HISTORY);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [clock, setClock] = useState(0);

  const process = useCallback(
    (
      text: string,
      opts: {
        humanRepliedDuringHold?: boolean;
        scenarioId?: string | null;
        modelOverride?: Scenario["modelOverride"];
      } = {}
    ) => {
      const t = clock + 12;
      setClock(t);
      setActiveScenario(opts.scenarioId ?? null);

      const run = runPipeline(text, {
        clientFirstName: CLIENT.firstName,
        advisorName: ADVISOR.name,
        advisorMention: ADVISOR.mention,
        humanRepliedDuringHold: opts.humanRepliedDuringHold,
        modelOverride: opts.modelOverride,
        slots: ["Tue 10:00 AM", "Wed 2:30 PM"],
      });
      setResult(run);

      const added: ChatMessage[] = [
        {
          id: nextId("m"),
          author: CLIENT.firstName,
          authorRole: "client",
          // The channel shows the redacted text, because that is what is stored.
          text: run.redactedMessage,
          at: t,
          wasRedacted: run.redacted,
        },
      ];

      if (opts.humanRepliedDuringHold) {
        added.push({
          id: nextId("m"),
          author: ADVISOR.name,
          authorRole: "human",
          text: "On it, sending you a couple of times now.",
          at: t + 4,
        });
      }

      // Only auto-sends and non-silent hand-off acks reach the client channel.
      if ((run.status === "auto_sent" || run.status === "awaiting_human") && run.outboundText) {
        added.push({
          id: nextId("m"),
          author: "Max",
          authorRole: "assistant",
          text: run.outboundText,
          at: t + 10,
        });
      }

      setMessages((prev) => [...prev, ...added]);

      const needsCard =
        run.status === "pending" ||
        run.status === "blocked" ||
        run.status === "awaiting_human" ||
        run.status === "auto_sent";

      if (needsCard) {
        setCards((prev) => [
          ...prev,
          {
            id: nextId("c"),
            clientMessage: run.redactedMessage,
            clientName: CLIENT.fullName,
            // A template that tripped the outbound re-check lands here as
            // `blocked` with its text on outboundText, not plan.replyText, so
            // the card must read both or it renders with nothing in it.
            draftText: run.outboundText ?? run.plan.replyText ?? null,
            status: run.status,
            flags: run.plan.flags,
            reasoning: run.plan.reasoning,
            category: run.plan.sensitivityCategory ?? null,
            needsSilent: run.plan.needsSilent ?? false,
            sendable: run.status === "pending",
            at: t + 10,
          },
        ]);
      }
    },
    [clock]
  );

  const runScenario = useCallback(
    (s: Scenario) => {
      process(s.message, {
        humanRepliedDuringHold: s.humanRepliedDuringHold,
        modelOverride: s.modelOverride,
        scenarioId: s.id,
      });
    },
    [process]
  );

  const sendCard = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (!card || !card.sendable) return;

      const at = clock + 3;
      setClock(at);
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "sent", sendable: false } : c))
      );
      if (card.draftText) {
        setMessages((prev) => [
          ...prev,
          { id: nextId("m"), author: "Max", authorRole: "assistant", text: card.draftText!, at },
        ]);
      }
    },
    [cards, clock]
  );

  const dismissCard = useCallback((id: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "dismissed", sendable: false } : c))
    );
  }, []);

  const reset = useCallback(() => {
    setMessages(CHANNEL_HISTORY);
    setCards([]);
    setResult(null);
    setActiveScenario(null);
    setClock(0);
  }, []);

  // The comparison that motivated the rewrite: would the one-word classifier
  // have auto-fired a link at this message, where the current system did not?
  const legacyWarning = useMemo(() => {
    if (!result) return null;
    if (result.status === "auto_sent") return null;
    if (!legacyWouldAutoSend(result.rawMessage)) return null;
    return legacyClassify(result.rawMessage);
  }, [result]);

  const active = SCENARIOS.find((s) => s.id === activeScenario);

  return (
    <div className="mx-auto max-w-[1240px] px-[clamp(1.25rem,5vw,3.5rem)] py-[clamp(2.5rem,6vw,4.5rem)]">
      <header>
        <div className="flex items-center gap-3">
          <span className="hidden md:block h-px w-8 bg-text-muted" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-text-muted">
            Draft-first Slack assistant
          </span>
        </div>

        <h1 className="mt-5 font-cdg text-[clamp(2rem,5.5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.02em] text-text max-w-[19ch]">
          The model never gets the last word.
        </h1>

        <p className="mt-6 font-body text-[14px] leading-[1.85] text-text-secondary max-w-[62ch]">
          An assistant that sits in client Slack channels. It answers a narrow band of routine
          scheduling questions with fixed templates, and everything else becomes a draft a person taps
          to send. The model is one layer in the middle. Deterministic code on both sides can only
          narrow what it decided, never widen it, so no sentence it writes reaches a client unread.
        </p>

        <div className="mt-9 h-px bg-text opacity-20" />
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Scenarios">
        {SCENARIOS.map((s) => {
          const on = activeScenario === s.id;
          return (
            <button
              key={s.id}
              onClick={() => runScenario(s)}
              aria-pressed={on}
              className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                on
                  ? "border-text bg-text text-bg"
                  : "border-border-light text-text-secondary hover:border-text"
              }`}
            >
              {s.label}
              {s.fromProduction && (
                <span className={`ml-2 ${on ? "opacity-60" : "text-text-muted"}`}>shipped</span>
              )}
            </button>
          );
        })}
        <button
          onClick={reset}
          className="ml-auto border border-border-light px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted transition-colors hover:border-text hover:text-text"
        >
          Reset
        </button>
      </nav>

      {active && (
        <p className="mt-6 border-l border-text/25 pl-4 font-body text-[13px] leading-[1.85] text-text-secondary max-w-[70ch]">
          {active.premise}
        </p>
      )}

      {legacyWarning && (
        <p className="mt-4 border border-signal-block/35 px-4 py-3 font-body text-[12.5px] leading-[1.8] text-text-secondary max-w-[70ch]">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-block block mb-1.5">
            the classifier this replaced &middot; also simulated
          </span>
          Given the same message it returns one word,{" "}
          <span className="font-mono text-[11px] text-text">{legacyWarning}</span>, and that word auto-sends
          its template. A single token cannot represent a message saying two things at once, which is
          why the reply brain replaced it. This comparison is a reconstruction of the old classifier,
          not a recording of it.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:h-[520px]">
        <ChannelPane
          channelName={`#${CLIENT.company.toLowerCase().replace(/\s+/g, "-")}`}
          subtitle={`shared with the client · ${ADVISOR.name} is the advisor`}
          messages={messages}
          onSend={(text) => process(text)}
          placeholder={`Type as ${CLIENT.firstName}, the client`}
        />
        <ReviewPane cards={cards} onSend={sendCard} onDismiss={dismissCard} />
      </div>

      <div className="mt-14">
        <TracePanel result={result} />
      </div>

      <footer className="mt-16 border-t border-border-light pt-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted">
          What is real here
        </span>
        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2 max-w-4xl">
          <p className="font-body text-[12.5px] leading-[1.85] text-text-secondary">
            The compliance filter, the PII redaction, the pre-filter and the reconciliation layer are
            the same code I run in production, rule for rule. Type your own message and those are the
            regexes judging it.
          </p>
          <p className="font-body text-[12.5px] leading-[1.85] text-text-secondary">
            The model call in the middle is simulated, so this page runs with no API key and answers
            the same way every time. The client, the advisor, the firm and every message are
            invented for the demo.
          </p>
        </div>
      </footer>
    </div>
  );
}
