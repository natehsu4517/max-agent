import type { ReactNode } from "react";

/**
 * Render the subset of Slack mrkdwn the templates emit. Today that is labeled
 * links, `<url|label>`, which is the form that stops a raw URL from ever being
 * shown to a client.
 */
export function renderMrkdwn(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /<(https?:\/\/[^|>]+)\|([^>]+)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={i++} className="text-link underline underline-offset-2">
        {m[2]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
