import type { Scorecard } from "@/lib/engine/types";

/**
 * The written argument, below the working demo.
 *
 * The frame above answers "what does it do" in one screen. This answers the
 * three questions someone evaluating the work actually has: how do you know it
 * works, why is it shaped like that, and what did it cost. None of it is
 * collapsed behind an expander, because the reader who wants this is the reader
 * worth keeping.
 */

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="hidden md:block h-px w-8 bg-text-muted" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-text-muted">
          {eyebrow}
        </span>
      </div>
      <h2 className="mt-4 max-w-[24ch] font-cdg text-[clamp(1.5rem,3vw,2.125rem)] font-medium leading-[1.1] tracking-[-0.015em] text-text">
        {title}
      </h2>
    </>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 max-w-[68ch] font-body text-[15.5px] leading-[1.8] text-text-secondary">
      {children}
    </p>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[13.5px] text-text">{children}</span>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-border-light pt-3">
      <div className="font-cdg text-[26px] font-medium leading-none tracking-[-0.02em] text-text tabular-nums">
        {value}
      </div>
      <div className="mt-2 font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.14em] text-text-muted">
        {label}
      </div>
    </div>
  );
}

export function Argument({ tally }: { tally: Scorecard }) {
  const noPerson = tally.answeredAutomatically + tally.saidNothing + tally.pingsAvoided;

  return (
    <div className="mt-20 flex flex-col gap-20">
      {/* 1. Verification. The insight first, the count second: the number only
          reads as thoroughness once you know what was being hunted. */}
      <section>
        <SectionHead eyebrow="How I know it works" title="A keyword is not a meaning" />

        <P>
          Every rule in the middle layer is a word match, and a word match reads{" "}
          <Quote>nothing is broken</Quote> and <Quote>the upload is broken</Quote> as the same
          event. That is harmless right up until a real client writes one of them.
        </P>
        <P>
          So I stress-tested it the way people actually use it, typing sentences into the composer
          instead of clicking the cases. Then I swept the whole rule set five ways at once, one pass
          per way an English sentence can invert its own meaning: negation, hypotheticals, things
          already resolved, somebody else&rsquo;s meeting, and idiom. Every finding was re-run
          against the live pipeline and judged by a second pass whose only job was to refute it.
        </P>
        <P>
          Eighty-one misfires survived that. They had six root causes, so I fixed the six. What came
          out is a single gate every rule now passes before it fires: the trigger must not be negated
          inside its own clause, retracted anywhere in the message, hypothetical, or about a meeting
          that is not ours.
        </P>
        <P>
          The tests that matter most run in the other direction. A careless negation guard suppresses
          real reports, and a suppressed outage is a far worse bug than a clumsy reply, so a dozen
          genuine problems that each contain a negative word are pinned in the suite and must all
          still reach a person: <Quote>nothing is going through on the upload</Quote>,{" "}
          <Quote>I do not know why the site is down but it is</Quote>,{" "}
          <Quote>I am not sure if this is a bug, but the upload fails every time</Quote>.
        </P>

        <div className="mt-10 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
          <Stat value="5" label="Ways swept" />
          <Stat value="81" label="Misfires confirmed" />
          <Stat value="6" label="Root causes" />
          <Stat value="62" label="Tests pinning them" />
        </div>
      </section>

      {/* 2. Architecture. */}
      <section>
        <SectionHead
          eyebrow="Why it is shaped this way"
          title="The model is the middle step, never the last one"
        />

        <P>
          Plain code runs before the model and after it, and both can only ever make Max do{" "}
          <em className="not-italic font-semibold text-text">less</em> than the model asked for.
          There is no path where the model widens its own authority, so the worst case of a bad model
          call is a wasted draft rather than a message a client should never have seen.
        </P>
        <P>
          Every message waits ten minutes before Max may act, and the first thing checked after the
          hold is whether a teammate already replied. Most messages in an active client channel are
          answered by a person, which means most messages never reach the model at all. The hold is
          not latency, it is the cheapest safety feature in the system.
        </P>
        <P>
          The model is never allowed to write a web address. A scheduling reply sets an intent and a
          fixed template renders the message that carries the link, so a model that cannot type a
          link cannot invent one. Anything URL-shaped in generated prose is downgraded to a draft.
        </P>
        <P>
          A draft that trips the compliance filter is rendered with Dismiss only, with no send
          control on the card at all. Being one careless tap away from sending a non-compliant
          message is a different risk from being warned about it.
        </P>
        <P>
          And silence is a real outcome rather than a failure, so it is categorised and counted. A
          quiet day and a broken assistant never look the same in the daily summary.
        </P>
      </section>

      {/* 3. The operational picture, sourced only from this session. Nothing on
          this page is a production number: there is no client data here to
          round, and an unverifiable claim is worth less than a live tally. */}
      <section>
        <SectionHead eyebrow="What it cost" title="Counted from the cases you just ran" />

        <P>
          Nothing here comes from a production deployment. These count what happened in this browser
          tab, in the cases you clicked and the messages you typed, which is the only number a demo
          can honestly show you.
        </P>

        <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
          <Stat value={String(tally.messagesSeen)} label="Messages seen" />
          <Stat value={String(noPerson)} label="Closed without a person" />
          <Stat value={String(tally.neededAPerson)} label="Needed a person" />
          <Stat value={String(tally.answeredAutomatically)} label="Answered automatically" />
          <Stat value={String(tally.draftsSent)} label="Drafts a human sent" />
          <Stat value={String(tally.blockedByCompliance)} label="Blocked from sending" />
          <Stat value={String(tally.saidNothing)} label="Chose to say nothing" />
          <Stat value={String(tally.pingsAvoided)} label="Pings avoided" />
          <Stat value={String(tally.piiRedactions)} label="PII redactions" />
          <Stat value={String(tally.awaitingReview)} label="Still awaiting review" />
        </div>

        <P>
          The two that matter to whoever owns this channel are the last ones you would think to
          count. <em className="not-italic font-semibold text-text">Pings avoided</em> is every time a
          teammate had already answered, so the model never ran and nobody was interrupted.{" "}
          <em className="not-italic font-semibold text-text">Chose to say nothing</em> is every time
          the correct action was no action. An assistant that cannot do either of those is not
          cheaper than the person it replaced.
        </P>
      </section>
    </div>
  );
}
