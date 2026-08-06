import { plainFlag } from "@/lib/engine/pipeline";
import type { PipelineResult, TraceStep } from "@/lib/engine/types";

const STAGE_LABEL: Record<TraceStep["layer"], string> = {
  0: "before the AI",
  1: "the AI",
  2: "after the AI",
  3: "result",
};

function Flag({ text }: { text: string }) {
  const severe =
    text.startsWith("COMPLIANCE:") ||
    text.startsWith("PREFILTER:") ||
    text.startsWith("BANNED_PHRASE:") ||
    text === "AUTO_BLOCKED" ||
    text === "GENERATED_LINK";
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-[3px] border px-2 py-1 ${
        severe ? "border-signal-block/40" : "border-border-light"
      }`}
    >
      <span
        className={`font-body text-[12px] ${severe ? "text-signal-block" : "text-text-secondary"}`}
      >
        {plainFlag(text)}
      </span>
      <span className="font-mono text-[9.5px] text-text-muted">{text}</span>
    </span>
  );
}

export function TracePanel({ result }: { result: PipelineResult | null }) {
  return (
    <section aria-labelledby="trace-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="trace-heading" className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted">
          How it decided
        </h2>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-muted">
          one AI call, wrapped in checks that can only narrow it
        </span>
      </div>
      <div className="mt-3 h-px bg-text opacity-20" />

      {!result ? (
        <p className="max-w-2xl py-10 font-body text-[14.5px] leading-[1.8] text-text-muted">
          Pick a case above, or type a message into the channel as the client. Every step that
          touches it will explain itself here, including the ones that decide before the AI is
          asked anything.
        </p>
      ) : (
        <>
          <p className="mt-6 max-w-[68ch] font-cdg text-[22px] font-medium leading-snug tracking-[-0.01em] text-text">
            {result.headline}
          </p>

          <ol className="mt-6">
            {result.trace.map((step, i) => (
              <li
                key={i}
                className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-border-light py-6 last:border-b-0 md:grid-cols-[132px_1fr]"
              >
                <div>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-text-muted">
                    {STAGE_LABEL[step.layer]}
                  </span>
                  <span
                    className={`mt-1.5 block font-mono text-[9.5px] uppercase tracking-[0.08em] ${
                      step.kind === "model" ? "text-signal-hold" : "text-text-muted"
                    }`}
                  >
                    {step.kind === "model" ? "the AI" : "plain code"}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-body text-[15px] font-semibold text-text">{step.title}</h3>
                    {step.decisive && (
                      <span className="rounded-[3px] bg-text px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-bg">
                        settled it here
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 font-body text-[15px] leading-snug text-text-secondary">
                    <span className="font-semibold text-text">{step.verdict}</span>
                  </p>

                  <p className="mt-2 max-w-[74ch] font-body text-[14px] leading-[1.8] text-text-secondary">
                    {step.detail}
                  </p>

                  {step.flags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {step.flags.map((f) => (
                        <Flag key={f} text={f} />
                      ))}
                    </div>
                  )}

                  <p className="mt-2.5 font-mono text-[10px] text-text-muted">{step.technical}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
