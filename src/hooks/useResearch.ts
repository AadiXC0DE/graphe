/**
 * The one message that was sent as research, per conversation.
 *
 * "Digs deep" is a one-message choice, not a mood the conversation stays in.
 * While that one reply is being written its words are kept — and only its
 * words — so an explicit IMPLEMENTATION PLAN section in it can become a
 * checklist to say yes to. Nothing else is read, and the person's next message
 * reaches the model unclassified.
 *
 * It lives here rather than in the window because two conversations can be
 * researching at once, and a reply landing in the background tab must not be
 * filed under the one in front.
 */

import { useRef } from 'react';

export type ResearchRuns = {
  /** This conversation's next reply is the research report. */
  begin(owner: string): void;
  /** Whether a report is being written for this conversation. */
  running(owner: string): boolean;
  /** Keep a piece of the report as it arrives. */
  gather(owner: string, text: string): void;
  /** The report so far, and the end of the run. */
  finish(owner: string): string;
};

export function useResearch(): ResearchRuns {
  const running = useRef(new Set<string>());
  const reports = useRef<Record<string, string>>({});
  const held = useRef<ResearchRuns | null>(null);

  held.current ??= {
    begin(owner) {
      running.current.add(owner);
      reports.current[owner] = '';
    },
    running(owner) {
      return running.current.has(owner);
    },
    gather(owner, text) {
      reports.current[owner] = (reports.current[owner] ?? '') + text;
    },
    finish(owner) {
      running.current.delete(owner);
      const report = reports.current[owner] ?? '';
      const rest = { ...reports.current };
      delete rest[owner];
      reports.current = rest;
      return report;
    },
  };

  return held.current;
}
