"use client";

import { useCallback, useMemo, useState } from "react";
import { ChannelPane } from "./ChannelPane";
import { ReviewPane } from "./ReviewPane";
import { TracePanel } from "./TracePanel";
import { runPipeline } from "@/lib/engine/pipeline";
import { legacyClassify, legacyWouldAutoSend } from "@/lib/engine/simulate";
import { ADVISOR, CHANNEL_HISTORY, CLIENT, SCENARIOS, type Scenario } from "@/lib/scenarios";
import type { ChatMessage, PipelineResult, ReviewCard, Scorecard } from "@/lib/engine/types";

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

const EMPTY_SCORECARD: Scorecard = {
  messagesSeen: 0,
  answeredAutomatically: 0,
  draftsSent: 0,
  draftsDismissed: 0,
  awaitingReview: 0,
  neededAPerson: 0,
  piiRedactions: 0,
  pingsAvoided: 0,
  blockedByCompliance: 0,
  saidNothing: 0,
};

export function MaxDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>(CHANNEL_HISTORY);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [tally, setTally] = useState<Scorecard>(EMPTY_SCORECARD);

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

      // The assistant answers in thread, so a shared client channel does not
      // fill up with bot chatter in the main view.
      const replies: ChatMessage[] = [];
      if ((run.status === "auto_sent" || run.status === "awaiting_human") && run.outboundText) {
        replies.push({
          id: nextId("m"),
          author: "Max",
          authorRole: "assistant",
          text: run.outboundText,
          at: t + 10,
        });
      }

      const inbound: ChatMessage = {
        id: nextId("m"),
        author: CLIENT.fullName,
        authorRole: "client",
        // The channel shows the redacted text, because that is what is stored.
        text: run.redactedMessage,
        at: t,
        wasRedacted: run.redacted,
        replies: replies.length ? replies : undefined,
      };

      const added: ChatMessage[] = [inbound];

      if (opts.humanRepliedDuringHold) {
        added.push({
          id: nextId("m"),
          author: ADVISOR.fullName,
          authorRole: "human",
          text: "On it, sending you a couple of times now.",
          at: t + 4,
        });
      }

      setMessages((prev) => [...prev, ...added]);

      // A sensitive divert produces an escalation bridge, not a draft card.
      const isEscalation = run.status === "awaiting_human";
      const needsCard =
        run.status === "pending" ||
        run.status === "blocked" ||
        run.status === "auto_sent" ||
        isEscalation;

      if (needsCard) {
        setCards((prev) => [
          ...prev,
          {
            id: nextId("c"),
            kind: isEscalation ? "escalation" : run.status === "auto_sent" ? "fyi" : "draft",
            clientMessage: run.redactedMessage,
            clientName: isEscalation ? `#${CLIENT.company.toLowerCase().replace(/\s+/g, "-")}` : CLIENT.fullName,
            // A template blocked by the outbound re-check carries its text on
            // outboundText, not plan.replyText.
            draftText: run.outboundText ?? run.plan.replyText ?? null,
            status: run.status,
            flags: run.plan.flags,
            reasoning: run.plan.reasoning,
            category: run.plan.sensitivityCategory ?? null,
            needsSilent: run.plan.needsSilent ?? false,
            sendable: run.status === "pending",
            at: t + 10,
            mention: isEscalation ? ADVISOR.mention : undefined,
          },
        ]);
      }

      setTally((prev) => ({
        ...prev,
        messagesSeen: prev.messagesSeen + 1,
        answeredAutomatically: prev.answeredAutomatically + (run.status === "auto_sent" ? 1 : 0),
        awaitingReview: prev.awaitingReview + (run.status === "pending" ? 1 : 0),
        neededAPerson: prev.neededAPerson + (isEscalation ? 1 : 0),
        blockedByCompliance: prev.blockedByCompliance + (run.status === "blocked" ? 1 : 0),
        piiRedactions: prev.piiRedactions + (run.redacted ? 1 : 0),
        pingsAvoided:
          prev.pingsAvoided + (run.plan.flags.includes("SKIPPED:reply_to_staff") ? 1 : 0),
        saidNothing:
          prev.saidNothing +
          (run.status === "skipped" && !run.plan.flags.includes("SKIPPED:reply_to_staff") ? 1 : 0),
      }));
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
      if (!card || !card.sendable || !card.draftText) return;

      const at = clock + 3;
      setClock(at);
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "sent", sendable: false } : c))
      );
      // A human-approved draft goes back in the same thread it came from.
      setMessages((prev) => {
        const idx = [...prev].reverse().findIndex((m) => m.text === card.clientMessage);
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const target = prev[realIdx];
        const reply: ChatMessage = {
          id: nextId("m"),
          author: "Max",
          authorRole: "assistant",
          text: card.draftText!,
          at,
        };
        const next = [...prev];
        next[realIdx] = { ...target, replies: [...(target.replies ?? []), reply] };
        return next;
      });
      setTally((prev) => ({ ...prev, draftsSent: prev.draftsSent + 1, awaitingReview: Math.max(0, prev.awaitingReview - 1) }));
    },
    [cards, clock]
  );

  const dismissCard = useCallback((id: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "dismissed", sendable: false } : c))
    );
    setTally((prev) => ({
      ...prev,
      draftsDismissed: prev.draftsDismissed + 1,
      awaitingReview: Math.max(0, prev.awaitingReview - 1),
    }));
  }, []);

  const acknowledgeCard = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, acknowledged: true } : c)));
  }, []);

  const postScorecard = useCallback(() => {
    const at = clock + 5;
    setClock(at);
    setCards((prev) => [
      ...prev,
      {
        id: nextId("c"),
        kind: "scorecard",
        clientMessage: "",
        clientName: "",
        draftText: null,
        status: "skipped",
        flags: [],
        reasoning: "",
        category: null,
        needsSilent: false,
        sendable: false,
        at,
        scorecard: tally,
      },
    ]);
  }, [clock, tally]);

  const reset = useCallback(() => {
    setMessages(CHANNEL_HISTORY);
    setCards([]);
    setResult(null);
    setActiveScenario(null);
    setClock(0);
    setTally(EMPTY_SCORECARD);
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
    <div className="mx-auto max-w-[1280px] px-[clamp(1.25rem,5vw,3.5rem)] py-[clamp(2.5rem,6vw,4.5rem)]">
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

        <p className="mt-6 font-body text-[15.5px] leading-[1.75] text-text-secondary max-w-[64ch]">
          Max sits in shared client Slack channels. It answers a narrow band of routine scheduling
          questions on its own, in thread, and turns everything else into a draft a person taps to
          send. The model is one layer in the middle: deterministic code on both sides can only
          narrow what it decided, never widen it.
        </p>
        <p className="mt-3 font-body text-[15.5px] leading-[1.75] text-text-secondary max-w-[64ch]">
          Run a case below, or just type into the channel as the client.
        </p>

        <div className="mt-9 h-px bg-text opacity-20" />
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2" aria-label="Scenarios">
        {SCENARIOS.map((s) => {
          const on = activeScenario === s.id;
          return (
            <button
              key={s.id}
              onClick={() => runScenario(s)}
              aria-pressed={on}
              className={`rounded-[4px] border px-3 py-2 font-body text-[13.5px] transition-colors ${
                on
                  ? "border-text bg-text text-bg"
                  : "border-border text-text-secondary hover:border-text hover:text-text"
              }`}
            >
              {s.label}
            </button>
          );
        })}
        <button
          onClick={reset}
          className="ml-auto rounded-[4px] border border-border-light px-3 py-2 font-body text-[13.5px] text-text-muted transition-colors hover:border-text hover:text-text"
        >
          Reset
        </button>
      </nav>

      {active && (
        <p className="mt-6 border-l-2 border-text/25 pl-4 font-body text-[14.5px] leading-[1.75] text-text-secondary max-w-[74ch]">
          {active.premise}
        </p>
      )}

      {legacyWarning && (
        <div className="mt-4 rounded-[4px] border border-signal-block/35 px-4 py-3.5 max-w-[74ch]">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-block">
            The classifier this replaced &middot; also simulated
          </p>
          <p className="mt-1.5 font-body text-[14px] leading-[1.75] text-text-secondary">
            Given the same message it returns one word,{" "}
            <span className="font-mono text-[12.5px] text-text">{legacyWarning}</span>, and that word
            auto-sends its template. A single token cannot represent a message saying two things at
            once, which is why the reply brain replaced it. This comparison is a reconstruction of the
            old classifier, not a recording of it.
          </p>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:h-[560px]">
        <ChannelPane
          channelName={CLIENT.company.toLowerCase().replace(/\s+/g, "-")}
          members={4}
          topic={`Shared channel with ${CLIENT.company}. ${ADVISOR.name} is the account lead.`}
          messages={messages}
          onSend={(text) => process(text)}
          placeholder={`Type as ${CLIENT.firstName}, the client`}
        />
        <ReviewPane
          cards={cards}
          onSend={sendCard}
          onDismiss={dismissCard}
          onAcknowledge={acknowledgeCard}
          onPostScorecard={postScorecard}
        />
      </div>

      <div className="mt-14">
        <TracePanel result={result} />
      </div>

      <footer className="mt-16 border-t border-border-light pt-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted">
          What is real here
        </span>
        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2 max-w-4xl">
          <p className="font-body text-[14px] leading-[1.8] text-text-secondary">
            The compliance filter, the PII redaction, the pre-filter and the reconciliation layer are
            the production logic, with the word lists retargeted to a generic services vocabulary.
            Type your own message and those are the regexes judging it.
          </p>
          <p className="font-body text-[14px] leading-[1.8] text-text-secondary">
            The model call in the middle is simulated, so this page runs with no API key and answers
            the same way every time. The client, the account lead, the firm and every message are
            invented for the demo.
          </p>
        </div>
      </footer>
    </div>
  );
}
