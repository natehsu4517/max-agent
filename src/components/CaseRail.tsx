"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenario, ScenarioGroup } from "@/lib/scenarios";

/**
 * The case list, as an accordion rather than a wall.
 *
 * The five group titles are always visible, because the grouping is the thing
 * worth understanding: the assistant answers a small boring set of messages by
 * itself and the whole rest of the design is about handing off well. A flat
 * list of nineteen buttons hides that, and at 723px tall it also pushed the
 * product itself off the first screen.
 */
export function CaseRail({
  groups,
  activeId,
  onPick,
  onReset,
}: {
  groups: ScenarioGroup[];
  activeId: string | null;
  onPick: (s: Scenario) => void;
  onReset: () => void;
}) {
  const groupOfActive = groups.find((g) => g.scenarios.some((s) => s.id === activeId))?.id;
  const [opened, setOpened] = useState<string | null>(null);
  const open = opened ?? groupOfActive ?? groups[0].id;

  // The page opens on a case in the LAST group, so without this the selected
  // row renders half-clipped behind the footer: the one row that has to look
  // deliberate is the one that looks broken.
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[6px] border border-border-light bg-surface-elevated">
      <header className="shrink-0 border-b border-border-light px-4 py-3">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-text-muted">
          Cases
        </h2>
        <p className="mt-1 font-sans text-[12px] leading-snug text-text-muted">
          Nineteen, grouped by what they show.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((g) => {
          const isOpen = g.id === open;
          return (
            <div key={g.id} className="border-b border-border-light/60 last:border-b-0">
              <button
                onClick={() => setOpened(isOpen ? null : g.id)}
                aria-expanded={isOpen}
                className="flex w-full items-baseline gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface/50"
              >
                <span
                  aria-hidden="true"
                  className={`font-mono text-[9px] text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  &#9654;
                </span>
                <span className="font-body text-[13px] font-semibold leading-tight text-text">
                  {g.title}
                </span>
              </button>

              {isOpen && (
                <div className="pb-2">
                  <p className="px-4 pb-2 font-body text-[11.5px] leading-[1.5] text-text-muted">
                    {g.blurb}
                  </p>
                  <ul>
                    {g.scenarios.map((s) => {
                      const on = s.id === activeId;
                      return (
                        <li key={s.id}>
                          <button
                            ref={on ? selectedRow : undefined}
                            onClick={() => onPick(s)}
                            aria-current={on ? "true" : undefined}
                            className={`block w-full border-l-2 px-4 py-1.5 text-left font-body text-[13px] leading-snug transition-colors ${
                              on
                                ? "border-text bg-surface/70 font-semibold text-text"
                                : "border-transparent text-text-secondary hover:border-border hover:text-text"
                            }`}
                          >
                            {s.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-border-light px-4 py-2.5">
        <button
          onClick={onReset}
          className="font-body text-[12.5px] text-text-muted transition-colors hover:text-text"
        >
          Reset the channel
        </button>
      </div>
    </div>
  );
}
