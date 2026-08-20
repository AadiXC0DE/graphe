/** Checking a change before it lands: a verdict, with findings ranked P0–P3.
 *
 * Pure functions over plain text — no agent, no Pi, no I/O. Two jobs:
 *
 *  - Turning a change into reviewer briefs. Each reviewer helper gets the same
 *    diff and one angle to look for, so three helpers cover correctness,
 *    tests and simplicity instead of three helpers covering the same thing.
 *  - Reading a verdict back. The agent's final message carries a fenced
 *    ```review block with the findings; this module parses it into the card
 *    the window draws. Text with no review block in it is an ordinary reply
 *    and is left alone.
 */

export type ReviewPriority = 0 | 1 | 2 | 3;

export type ReviewFinding = {
  /** P0 blocks shipping, P1 should be fixed before shipping, P2 can wait, P3
   *  is a note. */
  priority: ReviewPriority;
  /** Where the problem is, when it is in one place. */
  file?: string;
  line?: number;
  /** The problem itself, one or two sentences. */
  issue: string;
  /** What it breaks, when that is not obvious from the issue. */
  impact?: string;
  /** How sure the reviewer is, 0–100. */
  confidence: number;
};

/** The plain words a person reads for each verdict. Everything user-facing in
 *  this module lives here, so a sentence can be checked without reading code. */
export const REVIEW_WORDS = {
  ships: 'This change is ready to ship',
  'needs-work': 'This change needs work before it ships',
  'do-not-land': 'Do not land this change',
  /** The line above the findings, whichever way the verdict fell. */
  heading: 'The findings, in order of seriousness:',
  /** What the fix button does, in the person's own words. */
  fix: 'Fix the blocking ones',
  confidence: 'sure',
  /** Before the names of what the change was held up against. */
  against: 'Held up against',
  /** Sending the findings back to where the change came from. */
  post: 'Post this on the pull request',
  posting: 'Posting…',
  posted: 'Posted on the pull request.',
  postFailed: 'I could not post it. Check that github is set up on your terminal, and try again.',
} as const;

export type ReviewVerdict = {
  /** The overall call. */
  kind: 'ships' | 'needs-work' | 'do-not-land';
  /** One plain sentence of the reviewer's own before the list. */
  summary: string;
  findings: readonly ReviewFinding[];
  /** What the change was held up against, by name. */
  checks?: readonly string[];
  /** The pull request this verdict is about, when it is about one. Its
   *  presence is what lets the findings be posted back to it. */
  pull?: number;
};

/* -------------------------------------------------------------------------- */
/* Reading a verdict out of a reply                                           */
/* -------------------------------------------------------------------------- */

const REVIEW_BLOCK = /```review\s*\n([\s\S]*?)\s*```/i;

const KNOWN_KINDS = new Set(['ships', 'needs-work', 'do-not-land']);

/* Whatever the model wrote, the fields on the card have to hold. Numbers are
   clamped rather than trusted, and a malformed block is not a card. */
function findingOf(raw: Record<string, unknown>): ReviewFinding | null {
  if (typeof raw.issue !== 'string' || raw.issue.trim() === '') return null;
  const priority = clampInt(raw.priority, 0, 3);
  if (priority === null) return null;
  const confidence = clampInt(raw.confidence ?? 50, 0, 100) ?? 50;
  const file = typeof raw.file === 'string' && raw.file !== '' ? raw.file : undefined;
  const line = clampInt(raw.line ?? raw.startLine, 1, 1_000_000) ?? undefined;
  const impact = typeof raw.impact === 'string' && raw.impact !== '' ? raw.impact : undefined;
  return { priority: priority as ReviewPriority, file, line, issue: raw.issue.trim(), impact, confidence };
}

function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * A verdict out of a reply, or null when the reply is not a review.
 *
 * The model writes its findings in a fenced ```review block; anything else —
 * a malformed block, no block at all — is an ordinary reply and is ignored.
 */
export function parseReview(text: string): ReviewVerdict | null {
  const block = REVIEW_BLOCK.exec(text);
  if (block === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1] ?? '');
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const body = parsed as Record<string, unknown>;
  const kind = body.verdict ?? body.kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) return null;

  const findings: ReviewFinding[] = [];
  if (Array.isArray(body.findings)) {
    for (const raw of body.findings) {
      if (raw === null || typeof raw !== 'object') continue;
      const finding = findingOf(raw as Record<string, unknown>);
      if (finding !== null) findings.push(finding);
    }
  }
  // A clean review is a real result: it is exactly what `ships` means. Other
  // verdicts need at least one actionable reason or there is nothing to show.
  if (findings.length === 0 && kind !== 'ships') return null;

  const checks = Array.isArray(body.checks)
    ? body.checks.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map((one) => one.trim())
    : [];

  const pull = clampInt(body.pull ?? body.number, 1, 1_000_000);

  return {
    kind: kind as ReviewVerdict['kind'],
    checks: checks.length === 0 ? undefined : checks,
    pull: pull ?? undefined,
    summary:
      typeof body.summary === 'string' && body.summary !== ''
        ? body.summary
        : REVIEW_WORDS[kind as ReviewVerdict['kind']],
    findings,
  };
}

/* -------------------------------------------------------------------------- */
/* Briefs for the reviewers                                                   */
/* -------------------------------------------------------------------------- */

/** One angle per reviewer. Three helpers, three different searches, so the
 *  findings union instead of overlapping. */
export const REVIEW_ANGLES: readonly { key: string; line: string }[] = [
  {
    key: 'correctness',
    line: 'Correctness: bugs, dead ends, errors that would actually break, security holes, and missing edge cases.',
  },
  {
    key: 'tests',
    line: 'Tests and confidence: what is not covered that should be, and whether the change would be caught if it broke.',
  },
  {
    key: 'simplicity',
    line: 'Simplicity and fit: needless complexity, duplication, names that mislead, and parts that do not fit the rest of the codebase.',
  },
];

/** The brief one reviewer helper is handed: the diff, one angle, and the
 *  finding format the main agent can read back. */
export function reviewRequestFor(diff: string, angle: string): string {
  return `Review the change below from one angle: ${angle}

Nothing here is invented — every finding must point at a file and line that are in the diff or in the project. For each genuine problem, write exactly one line in this shape:

P<priority> <file>:<line> — the problem — what it breaks — how sure you are (0-100)

where priority is 0 (blocks shipping), 1 (should be fixed first), 2 (can wait) or 3 (a note). Do not report style preferences or problems that would not matter. If you find nothing genuine in your angle, say so plainly — an empty finding list is a good finding.

THE CHANGE:
${diff}`;
}

/** Keep a diff short enough for a fresh context window to hold, and say so
 *  when it was cut. */
export function trimDiff(diff: string, cap = 60_000): string {
  if (diff.length <= cap) return diff;
  return `${diff.slice(0, cap)}\n\n(Only the first part of the change is here — it was longer than one review can hold. The reviewers read what they can and the rest is noted.)`;
}
/* -------------------------------------------------------------------------- */
/* Sending it back                                                            */
/* -------------------------------------------------------------------------- */

const PRIORITY_WORDS: Readonly<Record<ReviewPriority, string>> = {
  0: 'Blocks shipping',
  1: 'Fix before shipping',
  2: 'Can wait',
  3: 'A note',
};

/**
 * The verdict as the text posted where the change came from.
 *
 * The card and the comment say the same things in the same order, so nobody
 * has to hold two versions of one review in their head. Written as ordinary
 * markdown because it is read by people who never open this app.
 */
export function reviewAsMarkdown(verdict: ReviewVerdict): string {
  const lines: string[] = [`**${REVIEW_WORDS[verdict.kind]}**`, ''];
  if (verdict.summary !== '') lines.push(verdict.summary, '');
  if (verdict.checks !== undefined && verdict.checks.length > 0) {
    lines.push(`${REVIEW_WORDS.against} ${verdict.checks.join(', ')}.`, '');
  }
  lines.push(REVIEW_WORDS.heading, '');
  for (const finding of verdict.findings) {
    const place =
      finding.file === undefined
        ? ''
        : ` \`${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}\``;
    const impact = finding.impact === undefined ? '' : ` ${finding.impact}`;
    lines.push(
      `- **${PRIORITY_WORDS[finding.priority]}**${place} — ${finding.issue}${impact} (${REVIEW_WORDS.confidence} ${String(finding.confidence)}%)`,
    );
  }
  return `${lines.join('\n')}\n`;
}
