"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChannelPane } from "./ChannelPane";
import { ReviewPane } from "./ReviewPane";
import { TracePanel } from "./TracePanel";
import { CaseRail } from "./CaseRail";
import { Argument } from "./Argument";
import { runPipeline } from "@/lib/engine/pipeline";
import { legacyClassify, legacyWouldAutoSend } from "@/lib/engine/simulate";
import { ADVISOR, CHANNEL_HISTORY, CLIENT, GROUPS, SCENARIOS, type Scenario } from "@/lib/scenarios";
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

/**
 * The case the page opens on.
 *
 * A one-screen layout cannot afford an empty first impression, and this is the
 * beat worth leading with: the model ignores its prompt, writes a confident
 * reply quoting a price and promising a date, and the layer underneath renders
 * the card with no send button at all.
 */
const OPENING_CASE = "model-misbehaves";

const DOT: Record<string, string> = {
  auto_sent: "bg-signal-live",
  pending: "bg-signal-hold",
  awaiting_human: "bg-signal-hold",
  blocked: "bg-signal-block",
  skipped: "bg-border",
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
        afterHours?: boolean;
        modelFailed?: boolean;
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
        afterHours: opts.afterHours,
        modelFailed: opts.modelFailed,
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
        afterHours: s.afterHours,
        modelFailed: s.modelFailed,
        modelOverride: s.modelOverride,
        scenarioId: s.id,
      });
    },
    [process]
  );

  // Open on a case already run. Done in an effect rather than in initial state
  // so the server-rendered markup and the first client render agree.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const s = SCENARIOS.find((x) => x.id === OPENING_CASE);
    if (s) runScenario(s);
  }, [runScenario]);

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
    <div className="mx-auto max-w-[1280px] px-[clamp(1.25rem,5vw,3.5rem)] pb-[clamp(3rem,7vw,5rem)] pt-[clamp(1.5rem,3.5vw,2rem)]">
      <header>
        <div className="flex items-center gap-3">
          <span className="hidden md:block h-px w-8 bg-text-muted" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-text-muted">
            Draft-first Slack assistant
          </span>
        </div>

        <h1 className="mt-4 max-w-[19ch] font-cdg text-[clamp(1.625rem,3.6vw,2.375rem)] font-medium leading-[1.04] tracking-[-0.02em] text-text">
          The model never gets the last word.
        </h1>

        <p className="mt-3.5 max-w-[84ch] font-body text-[15.5px] leading-[1.65] text-text-secondary">
          Max sits in the Slack channels a company shares with its clients. It answers a short list
          of routine scheduling questions alone, and drafts everything else for a person.
        </p>
      </header>

      {/* The working demo, sized to the first screen. Everything that changes
          when you click is inside this frame or in the line above it. */}
      <div className="mt-6">
        <div className="rounded-[6px] border border-border-light bg-surface-elevated px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
            <p className="min-w-0 font-cdg text-[clamp(1.0625rem,1.9vw,1.375rem)] font-medium leading-snug tracking-[-0.01em] text-text">
              {result ? result.headline : "Pick a case, or type a message as the client."}
            </p>
            {result && (
              <span className="flex shrink-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${DOT[result.status] ?? "bg-border"}`}
                />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-text-muted">
                  {result.handledBy === "max"
                    ? "handled by Max"
                    : result.handledBy === "human"
                      ? "handled by a person"
                      : "nobody needed"}
                </span>
              </span>
            )}
          </div>
          {active && (
            <p className="mt-1.5 max-w-[96ch] font-body text-[12.5px] leading-[1.55] text-text-muted">
              {active.premise}
            </p>
          )}
        </div>

        <div className="mt-3 grid grid-rows-[auto_440px_440px] gap-3 lg:h-[clamp(360px,50vh,520px)] lg:grid-cols-[212px_1fr_1fr] lg:grid-rows-1">
          <CaseRail groups={GROUPS} activeId={activeScenario} onPick={runScenario} onReset={reset} />
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
      </div>

      {legacyWarning && (
        <div className="mt-5 max-w-[74ch] rounded-[4px] border border-signal-block/35 px-4 py-3.5">
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

      <div className="mt-12">
        <TracePanel result={result} />
      </div>

      <Argument tally={tally} />

      <footer className="mt-20 border-t border-border-light pt-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted">
          What is real here
        </span>
        <div className="mt-4 grid max-w-4xl grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
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
