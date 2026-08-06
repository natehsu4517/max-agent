import type { PipelineResult, TraceStep } from "@/lib/engine/types";

const LAYER_LABEL: Record<TraceStep["layer"], string> = {
  0: "intake",
  1: "model",
  2: "reconcile",
  3: "outcome",
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
      className={`font-mono text-[9px] uppercase tracking-[0.08em] border px-1.5 py-1 ${
        severe
          ? "border-signal-block/40 text-signal-block"
          : "border-border-light text-text-muted"
      }`}
    >
      {text}
    </span>
  );
}

export function TracePanel({ result }: { result: PipelineResult | null }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted">
          Decision trace
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted text-right">
          one model call, wrapped in code that can only narrow it
        </span>
      </div>
      <div className="h-px bg-text opacity-20 mb-1" />

      {!result ? (
        <p className="font-body text-[13px] leading-[1.85] text-text-muted py-10 max-w-xl">
          Run a case above, or type a message as the client. Every layer that touches it reports its
          verdict here, including the ones that decide before the model gets a turn.
        </p>
      ) : (
        <ol>
          {result.trace.map((step, i) => (
            <li
              key={i}
              className="border-b border-border-light last:border-b-0 py-5 grid grid-cols-[80px_1fr] gap-x-5 gap-y-2 md:grid-cols-[110px_1fr]"
            >
              <div className="pt-0.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted">
                  {LAYER_LABEL[step.layer]}
                </span>
                <span
                  className={`mt-1.5 block font-mono text-[9px] uppercase tracking-[0.08em] ${
                    step.kind === "model" ? "text-signal-hold" : "text-text-muted"
                  }`}
                >
                  {step.kind === "model" ? "simulated" : "code"}
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-mono text-[12px] tracking-[0.02em] text-text font-bold">
                    {step.title}
                  </h3>
                  {step.decisive && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text">
                      decided here
                    </span>
                  )}
                </div>

                <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-text-secondary">
                  {step.verdict}
                </p>

                <p className="mt-2 font-body text-[12.5px] leading-[1.8] text-text-secondary max-w-2xl">
                  {step.detail}
                </p>

                {step.flags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {step.flags.map((f) => (
                      <Flag key={f} text={f} />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
