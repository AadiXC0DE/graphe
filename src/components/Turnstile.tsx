/** One row of a conversation, drawn.
 *
 * Its own module because the window draws two transcripts — the column being
 * worked in and the pane beside it — and because a row is reached when there
 * is a conversation to draw rather than at launch. Keeping it out of App.tsx
 * also keeps it out of the main chunk, which the app's own budget test
 * measures: the project's remedy for being over is a dynamic import, not a
 * raised limit.
 *
 * Memoised on identity rather than deeply: every arm of the fold replaces the
 * slot rather than editing the turn, so a turn that is the same object is a
 * turn that has not changed. Without this a token landing in the last turn
 * redrew every row above it.
 */

import { memo, Suspense } from 'react';

import { type PlanDecision } from '../agent/plan';
import type { Answers } from '../agent/asking';
import type { ReviewVerdict } from '../agent/types';
import { busyService, longConversation } from '../cost/phrasing';
import { isAdvisor, lastSaid, opening } from '../lib/describe';
import type { Decision } from '../lib/ipc';
import { behind } from '../lib/showme';
import { type EstimateTurn, type Turn } from '../lib/thread';
import { threadWords } from '../lib/threadview';
import { wordsOf } from '../lib/transcript';
import { continuationWords } from '../work/continuing';
import { saysHowLong } from '../work/commands-ran';
import ActivityLine from './ActivityLine';
import AskFirst from './AskFirst';
import ConfirmChange from './ConfirmChange';
import { Drawn } from './Drawn';
import ErrorCard from './ErrorCard';
import Message from './Message';
import PlanCard from './PlanCard';
import ReviewCard from './ReviewCard';
import { Shown } from './Shown';

function saying(turn: Extract<Turn, { kind: "did" }>): string | undefined {
  if (turn.progress === undefined) return turn.detail;
  return isAdvisor(turn.label) ? opening(turn.progress) : lastSaid(turn.progress);
}

/**
 * One row of the conversation.
 *
 * Memoised, and on identity rather than a deep comparison: every arm of the
 * fold replaces the slot rather than editing the turn, so a turn that is the
 * same object is a turn that has not changed. Without this, a token landing in
 * the last turn redrew every row above it — three thousand of them, sixty times
 * a second, on a long conversation.
 *
 * The callbacks are rebuilt on every render of the window and never change what
 * a row draws, so comparing them would defeat the whole thing.
 */
export default memo(function Turnstile({
  turn,
  onRespond,
  onAnswerAsked,
  onDismiss,
  onAnswerEstimate,
  onAnswerPlan,
  onAskForAPlanAgain,
  onFixReview,
  onPostReview,
  showMe,
  isLast,
  saidBy,
  onForkHere,
  forkWaits,
}: {
  turn: Turn;
  onRespond: (turnId: string, callId: string, decision: Decision) => void;
  onAnswerAsked: (turnId: string, answers: Answers | null) => void;
  onDismiss: (turnId: string) => void;
  onAnswerEstimate: (turn: EstimateTurn, go: boolean) => void;
  onAnswerPlan: (
    turnId: string,
    go: boolean,
    chosen?: {
      kept: readonly string[];
      dropped: readonly string[];
      decision?: PlanDecision;
    },
  ) => void;
  /** The model answered in prose rather than a list. Asks again, in the same
   *  words the look-around uses, rather than leaving the card as a dead end. */
  onAskForAPlanAgain: (turnId: string) => void;
  onFixReview: (turnId: string) => void;
  onPostReview: (verdict: ReviewVerdict) => Promise<boolean>;
  /** Name the real command, path or operation under each step (BACKLOG D1).
   *  The words themselves were recorded when the step happened, so turning this
   *  on explains the conversation you already had. */
  showMe: boolean;
  isLast?: boolean;
  /** How many things the person had said by this message, or null where the
   *  message is not a place to stop a copy of the conversation at. */
  saidBy?: number | null;
  /** Fork the conversation at this message. */
  onForkHere: (said: number) => void;
  /** True on the newest message of a turn still being written, where there is
   *  no finished exchange to stop at yet. */
  forkWaits?: boolean;
}) {
  switch (turn.kind) {
    case 'said':
      return (
        <Message
          from={turn.from}
          streaming={turn.streaming}
          isLast={isLast}
          pictures={turn.pictures}
          copy={wordsOf(turn)}
          {...(saidBy === null || saidBy === undefined
            ? {}
            : {
                action: {
                  label: continuationWords.forkHere,
                  hint: continuationWords.forkHereHint,
                  onPress: () => onForkHere(saidBy),
                  ...(forkWaits === true ? { waits: threadWords.forkWaits } : {}),
                },
              })}
        >
          {turn.text}
        </Message>
      );

    case 'did':
      return (
        <>
          <ActivityLine
            state={turn.state}
            label={turn.label}
            detail={saying(turn)}
            meta={turn.ms === undefined ? undefined : saysHowLong(turn.ms)}
            real={showMe ? turn.real : undefined}
          />
          {turn.drawn === undefined ? null : <Drawn lines={turn.drawn} />}
          {turn.shown === undefined ? null : (
            <Shown picture={turn.shown} label={turn.label} />
          )}
        </>
      );

    case 'asked':
      // Once it is answered the question stops being a control and becomes part
      // of the record — a live pair of buttons for a decision already taken is
      // how people learn to click without reading.
      return turn.answered === null ? (
        <Suspense fallback={null}>
          <ConfirmChange
            question={turn.question}
            detail={turn.detail}
            consequence={turn.consequence}
            technical={showMe ? turn.real : undefined}
            confirmLabel="Yes, go ahead"
            cancelLabel="No, leave it"
            onConfirm={() => onRespond(turn.id, turn.callId, "yes")}
            onCancel={() => onRespond(turn.id, turn.callId, "no")}
          />
        </Suspense>
      ) : (
        <ActivityLine
          state={turn.answered === 'yes' ? 'done' : 'failed'}
          label={turn.question}
          detail={
            turn.answered === 'yes'
              ? 'You said yes.'
              : 'You said no, so I left it alone.'
          }
          real={showMe ? turn.real : undefined}
        />
      );

    // Asked before a single file is touched, so that everything after it can
    // happen with nobody watching. The card holds the picking; the turn only
    // hears the answer.
    case 'asked-first':
      return (
        <Suspense fallback={null}>
          <AskFirst
            questions={turn.questions}
            answers={turn.answers}
            answered={turn.answered}
            onAnswer={(answers) => onAnswerAsked(turn.id, answers)}
          />
        </Suspense>
      );

    case 'plan':
      return (
        <Suspense fallback={null}>
          <PlanCard
            steps={turn.steps}
            caveats={turn.caveats}
            answered={turn.answered}
            questions={turn.questions}
            onGo={(kept, dropped, decision) =>
              onAnswerPlan(turn.id, true, { kept, dropped, decision })
            }
            onChange={() => onAnswerPlan(turn.id, false)}
            onAskAgain={() => onAskForAPlanAgain(turn.id)}
          />
        </Suspense>
      );

    case 'review':
      return (
        <Suspense fallback={null}>
          <ReviewCard
            verdict={turn.verdict}
            asked={turn.asked}
            onFix={() => onFixReview(turn.id)}
            onPost={() => onPostReview(turn.verdict)}
          />
        </Suspense>
      );

    case 'estimate':
      // Same shape as any other question, and the same grammar: the option that
      // spends less carries the visual weight. Every word of it is written by
      // src/cost/phrasing.ts and none of it by this file.
      return turn.answered === null ? (
        <Suspense fallback={null}>
          <ConfirmChange
            question={turn.prompt.title}
            detail={turn.prompt.body}
            consequence={turn.prompt.note}
            confirmLabel={turn.prompt.confirm}
            cancelLabel={turn.prompt.alternative}
            onConfirm={() => onAnswerEstimate(turn, true)}
            onCancel={() => onAnswerEstimate(turn, false)}
          />
        </Suspense>
      ) : (
        // Answered, it stops being a control and becomes part of the record —
        // the same shape the Guard's own questions take once they have been
        // answered, for the same reason: a live pair of buttons for a decision
        // already taken is how people learn to click without reading.
        <ActivityLine
          state="done"
          label={turn.prompt.title}
          detail={
            turn.answered === 'went-ahead'
              ? 'You said go ahead.'
              : 'You said you would rather start smaller.'
          }
        />
      );

    case 'tidying':
      // Behind this is Pi's own tidying of a long conversation. In front of it
      // is one plain sentence, from src/cost/phrasing.ts — and, for anyone who
      // asked, its real name underneath.
      return (
        <ActivityLine
          state={turn.state}
          label={turn.state === 'failed' ? longConversation.stayedAsIs : longConversation.tidying}
          real={showMe ? behind.tidying : undefined}
        />
      );

    case 'holding':
      // A service that could not answer, and the wait before asking again.
      // Nothing to look at for up to half an hour, so the line says how long.
      return (
        <ActivityLine
          state={turn.state}
          label={
            turn.state === 'failed'
              ? busyService.gaveUp
              : turn.state === 'done'
                ? busyService.carriedOn
                : busyService.waiting(turn.seconds)
          }
        />
      );

    case 'trouble':
      return (
        <ErrorCard
          what={turn.trouble.what}
          because={turn.trouble.because}
          actionLabel={turn.trouble.actionLabel}
          onAction={() => onDismiss(turn.id)}
          technicalDetails={turn.trouble.details}
        />
      );
  }
}, (before, after) =>
  before.turn === after.turn &&
  before.showMe === after.showMe &&
  before.isLast === after.isLast &&
  before.saidBy === after.saidBy &&
  before.forkWaits === after.forkWaits &&
  before.onForkHere === after.onForkHere);
