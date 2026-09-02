import { useCallback, useEffect, useMemo, useState } from 'react';

import { parseDiff } from '../diff/hunks';
import { bridge } from '../lib/bridge';
import type { Result, WorkspaceFacts } from '../lib/ipc';
import {
  canLand,
  cardsFrom,
  needingYou,
  saysCard,
  workspaceWords,
  type Workspace,
} from '../work/workspaces';
import DiffView from './DiffView';
import './Checkouts.css';
import './Sheet.css';

/**
 * One card per conversation working in its own copy of the project.
 *
 * A copy is invisible otherwise: a folder somewhere and a branch name, and the
 * only way to learn what is in one is to open the conversation and then open
 * the diff. The ordering is the point as much as the cards are, and it belongs
 * to `work/workspaces` — what wants a person is at the top.
 *
 * The band reads the shell itself. Everything on a card is a reading of disk
 * taken just now, so it is asked for again after every press.
 */

type Props = {
  /** The line of work the project folder is on, so the card already on it does
   *  not offer to move onto it again. */
  branch?: string | null;
  /** Something else is changing the files; every press waits. */
  busy?: boolean;
  /** Which project. Left out, the one in front, which is what the panel is
   *  about every ordinary day. */
  project?: string;
};

const CHECKOUTS = {
  heading: 'Checkouts',
  /** The press that opens the change. Not "Review": that names a whole other
   *  view in this app, and two things called Review is one too many. */
  compare: 'Compare',
  comparing: 'Reading the change…',
  refresh: 'Refresh',
  close: 'Close',
  /** On the heading, when some of them want a person. */
  count: (waiting: number): string => `${String(waiting)} for you`,
  changed: (branch: string): string => `What ${branch} changed`,
  nothingInIt: 'Nothing changed on this branch yet.',
} as const;

/** The state words a card is drawn by, as class names. */
function stateClass(one: Workspace): string {
  return one.state.replace(/ /g, '-');
}

export default function Checkouts({ branch = null, busy = false, project }: Props) {
  const [facts, setFacts] = useState<readonly WorkspaceFacts[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [looking, setLooking] = useState<{ address: string; branch: string } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const where = useMemo(() => (project === undefined ? undefined : { project }), [project]);

  const read = useCallback(() => {
    void bridge.checkouts(where).then((answer) => {
      if (answer.ok) setFacts(answer.value);
    });
  }, [where]);

  /* Again whenever the project moves onto another line of work: landing one
     copy changes what every other card is measured against. */
  useEffect(() => {
    read();
  }, [read, branch]);

  const cards = useMemo(() => cardsFrom(facts), [facts]);
  /* Whether the folder is still spread out is a fact the card does not carry:
     a copy given back while it was landed reads as landed, and rightly. */
  const spreadOut = useMemo(
    () => new Set(facts.filter((one) => !one.away).map((one) => one.address)),
    [facts],
  );
  const waiting = useMemo(() => needingYou(cards), [cards]);

  const press = (
    address: string,
    run: () => Promise<Result<readonly WorkspaceFacts[]>>,
  ): void => {
    if (working !== null) return;
    setWorking(address);
    setTrouble(null);
    void run()
      .then((answer) => {
        if (answer.ok) setFacts(answer.value);
        else setTrouble(`${answer.trouble.what} ${answer.trouble.because}`);
      })
      .finally(() => setWorking(null));
  };

  const compare = (card: Workspace): void => {
    setLooking({ address: card.address, branch: card.branch });
    setDiff(null);
    void bridge.checkoutLook(card.address, where).then((answer) => {
      setDiff(answer.ok ? answer.value : '');
      if (!answer.ok) setTrouble(`${answer.trouble.what} ${answer.trouble.because}`);
    });
  };

  const files = useMemo(() => (diff === null ? [] : parseDiff(diff)), [diff]);

  /* The sheet closes on Escape the way every other sheet here does, and stops
     the key there so it does not also close whatever is behind it. */
  useEffect(() => {
    if (looking === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setLooking(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [looking]);

  return (
    <section className="overview__block">
      <div className="copies__top">
        <h2 className="overview__title">{CHECKOUTS.heading}</h2>
        {waiting === 0 ? null : <span className="copies__waiting">{CHECKOUTS.count(waiting)}</span>}
        <button type="button" className="copies__refresh" onClick={read} disabled={working !== null}>
          {CHECKOUTS.refresh}
        </button>
      </div>

      {cards.length === 0 ? (
        <p className="overview__quiet">{workspaceWords.nothing}</p>
      ) : (
        <ul className="copies">
          {cards.map((card) => {
            const says = saysCard(card);
            const onIt = branch !== null && branch === card.branch;
            const here = spreadOut.has(card.address);
            return (
              <li
                key={card.address}
                className={`copies__one copies__one--${stateClass(card)}`}
              >
                <div className="copies__head">
                  <span className="copies__name">{says.head}</span>
                  <code className="copies__branch">{card.branch}</code>
                </div>
                <p className="copies__sub">{says.sub}</p>
                {here ? null : <p className="copies__note">{workspaceWords.awayDetail}</p>}

                <div className="copies__acts">
                  {card.state === 'landed' || onIt ? null : (
                    <button
                      type="button"
                      className="copies__act"
                      disabled={busy || working !== null}
                      aria-busy={working === card.address}
                      title={`The project folder moves onto ${card.branch}. Its copy is given back first.`}
                      onClick={() =>
                        press(card.address, () => bridge.checkoutFront(card.address, where))
                      }
                    >
                      {workspaceWords.bringForward}
                    </button>
                  )}
                  {card.changed === 0 ? null : (
                    <button
                      type="button"
                      className="copies__act"
                      disabled={busy}
                      title={`Read what ${card.branch} changed, against ${card.base}.`}
                      onClick={() => compare(card)}
                    >
                      {CHECKOUTS.compare}
                    </button>
                  )}
                  {canLand(card) ? (
                    <button
                      type="button"
                      className="copies__act copies__act--land"
                      disabled={busy || working !== null}
                      aria-busy={working === card.address}
                      title={`Bring this copy's work into ${card.base} and give the copy back.`}
                      onClick={() =>
                        press(card.address, () => bridge.checkoutLand(card.address, where))
                      }
                    >
                      {workspaceWords.land}
                    </button>
                  ) : null}
                  {/* Never "throw away": what this removes is the folder, and
                      the branch keeps the work. A copy holding writing the
                      branch has not got says so instead of offering the press
                      that would lose it. */}
                  {!here ? null : (
                    <button
                      type="button"
                      className="copies__act"
                      disabled={busy || working !== null || card.holdsWork}
                      aria-busy={working === card.address}
                      title={card.holdsWork ? workspaceWords.holds : workspaceWords.awayDetail}
                      onClick={() =>
                        press(card.address, () => bridge.checkoutPutAway(card.address, where))
                      }
                    >
                      {workspaceWords.putAway}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {trouble === null ? null : <p className="copies__trouble">{trouble}</p>}

      {looking === null ? null : (
        <section className="sheet" aria-label={CHECKOUTS.changed(looking.branch)}>
          <header className="sheet__top">
            <div className="sheet__titles">
              <h1 className="sheet__title">{CHECKOUTS.changed(looking.branch)}</h1>
              <p className="copies__sheetsub">
                {diff === null ? CHECKOUTS.comparing : workspaceWords.files(files.length)}
              </p>
            </div>
            <button type="button" className="sheet__close" onClick={() => setLooking(null)}>
              {CHECKOUTS.close}
              <kbd className="sheet__key">Esc</kbd>
            </button>
          </header>
          <div className="sheet__body scroll--auto">
            {diff !== null && files.length === 0 ? (
              <p className="copies__empty">{CHECKOUTS.nothingInIt}</p>
            ) : (
              <DiffView files={files} busy={busy} />
            )}
          </div>
        </section>
      )}
    </section>
  );
}
