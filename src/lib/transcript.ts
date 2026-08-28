/** A conversation, ready to paste.
 *
 * Somewhere else — an issue, a message, a document — is where a conversation
 * usually ends up, and retyping it is how the useful part gets lost. What comes
 * out is Markdown, and nothing of ours survives into it: no ids, no call
 * numbers, no chrome.
 */

import type { Turn } from './thread';

export const COPY_WORDS = {
  whole: 'Copy the conversation',
  nothing: 'Nothing has been said here yet.',
} as const;

export type TranscriptOptions = {
  /** Include the steps it took — the tool lines. Off by default: somebody
   *  pasting a conversation wants the answer, not the machinery. */
  steps?: boolean;
  /** The heading over the whole thing, when there is one worth writing. */
  title?: string;
};

const WHO: Record<string, string> = { you: 'You', graphe: 'Graphe' };

/** One turn's own words — what the copy button on a message puts on the
 *  clipboard. Empty for anything that is not something somebody said. */
export function wordsOf(turn: Turn): string {
  switch (turn.kind) {
    case 'said':
      return turn.text.trim();
    case 'plan':
      return [...turn.steps.map((step, index) => `${String(index + 1)}. ${step}`), ...turn.caveats.map((one) => `- ${one}`)]
        .join('\n')
        .trim();
    case 'review':
      return [`${verdictWords(turn.verdict.kind)}: ${turn.verdict.summary}`, ...turn.verdict.findings.map(finding)]
        .join('\n')
        .trim();
    case 'trouble':
      return `${turn.trouble.what} ${turn.trouble.because}`.trim();
    default:
      return '';
  }
}

function verdictWords(kind: 'ships' | 'needs-work' | 'do-not-land'): string {
  if (kind === 'ships') return 'Ready to ship';
  if (kind === 'needs-work') return 'Needs work';
  return 'Do not land';
}

function finding(one: { file?: string; line?: number; issue: string }): string {
  const where = one.file === undefined ? '' : ` (${one.file}${one.line === undefined ? '' : `:${String(one.line)}`})`;
  return `- ${one.issue}${where}`;
}

/** Whether this turn has anything a reader would want pasted. */
export function worthCopying(turn: Turn): boolean {
  return wordsOf(turn) !== '';
}

/**
 * The whole conversation as Markdown.
 *
 * Speaker headings rather than a chat log's colons, so it reads as a document
 * once it lands somewhere else. Everything still running is included as it
 * stands — a half-finished answer is what was on the screen, and pretending it
 * was not there would be the surprising thing.
 */
export function asMarkdown(turns: readonly Turn[], options: TranscriptOptions = {}): string {
  const blocks: string[] = [];
  if (options.title !== undefined && options.title.trim() !== '') {
    blocks.push(`# ${options.title.trim()}`);
  }

  for (const turn of turns) {
    switch (turn.kind) {
      case 'said': {
        const text = turn.text.trim();
        if (text === '') break;
        blocks.push(`**${WHO[turn.from] ?? turn.from}**\n\n${text}`);
        break;
      }

      case 'did': {
        if (options.steps !== true) break;
        const detail = turn.detail === undefined ? '' : ` — ${turn.detail}`;
        blocks.push(`- ${turn.label}${detail}`);
        break;
      }

      case 'plan': {
        const lines = ['**Graphe** — the plan', ''];
        turn.steps.forEach((step, index) => lines.push(`${String(index + 1)}. ${step}`));
        if (turn.caveats.length > 0) lines.push('', ...turn.caveats.map((one) => `- ${one}`));
        if (turn.questions.length > 0) lines.push('', ...turn.questions.map((one) => `- ${one}`));
        if (turn.answered !== null) {
          lines.push('', turn.answered === 'went-ahead' ? '**You** went ahead.' : '**You** asked for changes.');
        }
        blocks.push(lines.join('\n'));
        break;
      }

      case 'asked': {
        const lines = [`**Graphe** asked`, '', turn.question];
        if (turn.detail !== undefined) lines.push('', turn.detail);
        if (turn.answered !== null) lines.push('', `**You** said ${turn.answered}.`);
        blocks.push(lines.join('\n'));
        break;
      }

      case 'asked-first': {
        const lines = ['**Graphe** asked first', ''];
        for (const question of turn.questions) {
          const picked = turn.answers[question.question] ?? [];
          lines.push(`- ${question.question}${picked.length === 0 ? '' : ` → ${picked.join(', ')}`}`);
        }
        blocks.push(lines.join('\n'));
        break;
      }

      case 'review': {
        const lines = [`**Graphe** — review`, '', `${verdictWords(turn.verdict.kind)}: ${turn.verdict.summary}`];
        if (turn.verdict.findings.length > 0) lines.push('', ...turn.verdict.findings.map(finding));
        blocks.push(lines.join('\n'));
        break;
      }

      case 'trouble':
        blocks.push(`**Graphe** — ${turn.trouble.what} ${turn.trouble.because}`.trim());
        break;

      // Machinery with nothing to read: an estimate nobody answered, the
      // tidying line, a wait on a service.
      default:
        break;
    }
  }

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

