import { useEffect, useMemo, useRef, useState } from 'react';
import { everything } from '../agent/pi/packages';
import {
  REACHABLE,
  describeStart,
  readReach,
  reachesMatching,
  type Reach,
  type Typed,
} from '../agent/pi/reach';
import './AddMore.css';

/** One thing that can be added. Declared here rather than imported so this
 *  screen can be drawn before anything exists to fetch it. */
export type Pack = {
  id: string;
  name: string;
  kind: 'extension' | 'skill' | 'prompts' | 'mixed';
  summary: string;
  downloads: number | null;
  version: string | null;
  installed: boolean;
  curated: boolean;
};

/** Every word on this screen, in one place, so the copy can be read without
 *  reading the markup. */
export const SAYS = {
  title: 'Add more to Graphe',
  sub: 'Small additions that give Graphe new things it can do for you. Add one now, take it back off whenever you like.',
  close: 'Close',
  searchLabel: 'Search everything else',
  searchPlaceholder: 'Search for something to add',
  vouchedHeading: 'Ready to use — we have checked these',
  vouchedNote: 'These come from us, and they work the moment you add them.',
  restHeading: 'Made by other people',
  add: 'Add',
  adding: 'Adding…',
  remove: 'Remove',
  removing: 'Taking it off…',
  added: 'Added',
  explain: 'What does this do?',
  explainWait: 'Reading it…',
  noMatches: 'Nothing here matches that. Try a shorter word.',
  emptyCatalogue: 'There is nothing to show yet. Search above and whatever turns up will appear here.',
  nothingElse: 'Nothing from anybody else right now.',
  perMonth: 'a month',
  hint: 'Anything you add here can be taken back off here.',
  kinds: {
    extension: 'Gives it a new thing it can do',
    skill: 'Teaches it a way of working',
    prompts: 'Ready-made things to ask for',
    mixed: 'A bit of each of those',
  },
  filterLabel: 'Show',
  filterAll: 'Everything',
  filterReach: 'Your other tools',
  filterAdditions: 'Ways of working',
  reachHeading: 'Your other tools',
  reachNote:
    'Let me look at the places your work already lives, so I build from the real thing.',
  noReaches: 'None of these matches that.',
  exact: 'Show me how it starts',
  byHand: 'Add one of your own',
  handName: 'Name',
  handWhat: 'What it lets you do',
  handWhere: 'Where to find it',
  handWhereHint: 'The address it answers on, or the program that starts it.',
  handValues: 'Values it needs, one per line, as NAME=value',
  handAdd: 'Add it',
} as const;

type Props = {
  open: boolean;
  packs: readonly Pack[];
  /** Ours, with a plain sentence saying what it lets you do. */
  vouchedFor: Readonly<Record<string, string>>;
  busy: string | null;
  warning: string;
  explaining: string | null;
  explanations: Readonly<Record<string, string>>;
  onClose: () => void;
  onSearch: (term: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onExplain: (id: string) => void;
  /** The other half of the shelf: the places somebody's work already lives.
   *  Ours by default, ticked and extended by whatever has been added. */
  reaches?: readonly Reach[];
  /** Which of those is being turned on or off this moment. */
  connecting?: string | null;
  /** Given one of ours by name. Without it that half of the shelf stays down,
   *  because a row nobody can press is worse than a row that is not there. */
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  /** A form somebody filled in themselves. Checked here first, so the sentence
   *  saying what is wrong arrives before anything is asked to keep it. */
  onConnectByHand?: (typed: Typed) => void;
};

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const NOTHING_TYPED = { name: '', what: '', where: '', values: '' };

type Showing = 'all' | 'reach' | 'additions';

/** How long a typed word waits before it becomes a search. */
const SETTLE = 250;

/**
 * The screen where somebody adds more to Graphe.
 *
 * The ones we vouch for are first and say plainly what they let you do; the
 * rest are somebody else's work and are labelled as that. Every row carries a
 * "what does this do?" so nobody has to go and find a readme to answer the only
 * question they have.
 */
export default function AddMore({
  open,
  packs,
  vouchedFor,
  busy,
  warning,
  explaining,
  explanations,
  onClose,
  onSearch,
  onAdd,
  onRemove,
  onExplain,
  reaches = REACHABLE,
  connecting = null,
  onConnect,
  onDisconnect,
  onConnectByHand,
}: Props) {
  const [term, setTerm] = useState('');
  const [showing, setShowing] = useState<Showing>('all');
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setTerm('');
      setShowing('all');
    }
  }, [open]);

  // Focus goes into the panel and comes back to wherever it was.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => returnTo.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Typing is a search only once it stops.
  const typed = useRef(false);
  useEffect(() => {
    if (!open || !typed.current) return;
    const timer = setTimeout(() => onSearch(term), SETTLE);
    return () => clearTimeout(timer);
  }, [open, term, onSearch]);

  // One ordering for both kinds, then split into the bands they are drawn in.
  const [found, vouched, rest] = useMemo(() => {
    const shelf = everything(packs, reachesMatching(reaches, term));
    const ours: Pack[] = [];
    const theirs: Pack[] = [];
    const outward: Reach[] = [];
    for (const one of shelf) {
      if (one.sort === 'reach') outward.push(one.reach);
      else if (one.addition.curated) ours.push(one.addition);
      else theirs.push(one.addition);
    }
    return [outward, ours, theirs] as const;
  }, [packs, reaches, term]);

  if (!open) return null;

  const searching = term.trim() !== '';
  const canReach = onConnect !== undefined;
  const showReach = canReach && showing !== 'additions';
  const showAdditions = showing !== 'reach';

  return (
    <div
      className="addmore"
      role="dialog"
      aria-modal="true"
      aria-label={SAYS.title}
      onKeyDown={(event) => trapTab(event, panel.current)}
    >
      <button
        type="button"
        className="addmore__backdrop"
        onClick={onClose}
        aria-label={SAYS.close}
        tabIndex={-1}
      />

      <div className="addmore__panel" ref={panel}>
        <header className="addmore__head">
          <div className="addmore__titlewrap">
            <h2 className="addmore__title">{SAYS.title}</h2>
            <p className="addmore__sub">{SAYS.sub}</p>
          </div>
          <button type="button" className="addmore__close" onClick={onClose} aria-label={SAYS.close}>
            <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
              <path
                d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="addmore__search">
          <input
            className="addmore__field"
            type="text"
            value={term}
            placeholder={SAYS.searchPlaceholder}
            aria-label={SAYS.searchLabel}
            onChange={(event) => {
              typed.current = true;
              setTerm(event.target.value);
            }}
          />
        </div>

        {canReach ? (
          <div className="addmore__filters" role="group" aria-label={SAYS.filterLabel}>
            {(
              [
                ['all', SAYS.filterAll],
                ['reach', SAYS.filterReach],
                ['additions', SAYS.filterAdditions],
              ] as const
            ).map(([which, label]) => (
              <button
                key={which}
                type="button"
                className={`addmore__chip ${showing === which ? 'addmore__chip--on' : ''}`}
                aria-pressed={showing === which}
                onClick={() => setShowing(which)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="addmore__body">
          {showReach ? (
            <section className="addmore__group" aria-label={SAYS.reachHeading}>
              <h3 className="addmore__grouphead">{SAYS.reachHeading}</h3>
              <p className="addmore__groupnote">{SAYS.reachNote}</p>
              <p className="addmore__groupnote">{warning}</p>
              {found.length === 0 ? (
                <p className="addmore__quiet">{SAYS.noReaches}</p>
              ) : (
                found.map((reach) => (
                  <ReachRow
                    key={reach.id}
                    reach={reach}
                    busy={connecting}
                    onConnect={onConnect}
                    onDisconnect={onDisconnect}
                  />
                ))
              )}
              {onConnectByHand === undefined ? null : (
                <ByHand known={reaches} onAdd={onConnectByHand} />
              )}
            </section>
          ) : null}

          {!showAdditions ? null : packs.length === 0 ? (
            <p className="addmore__quiet">{searching ? SAYS.noMatches : SAYS.emptyCatalogue}</p>
          ) : (
            <>
              {vouched.length === 0 ? null : (
                <section className="addmore__group" aria-label={SAYS.vouchedHeading}>
                  <h3 className="addmore__grouphead">{SAYS.vouchedHeading}</h3>
                  <p className="addmore__groupnote">{SAYS.vouchedNote}</p>
                  {vouched.map((pack) => (
                    <Row
                      key={pack.id}
                      pack={pack}
                      sentence={vouchedFor[pack.id] ?? pack.summary}
                      busy={busy}
                      explaining={explaining}
                      explanation={explanations[pack.id]}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      onExplain={onExplain}
                    />
                  ))}
                </section>
              )}

              <section className="addmore__group" aria-label={SAYS.restHeading}>
                <h3 className="addmore__grouphead">{SAYS.restHeading}</h3>
                <p className="addmore__groupnote">{warning}</p>
                {rest.length === 0 ? (
                  <p className="addmore__quiet">
                    {searching ? SAYS.noMatches : SAYS.nothingElse}
                  </p>
                ) : (
                  rest.map((pack) => (
                    <Row
                      key={pack.id}
                      pack={pack}
                      sentence={vouchedFor[pack.id] ?? pack.summary}
                      busy={busy}
                      explaining={explaining}
                      explanation={explanations[pack.id]}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      onExplain={onExplain}
                    />
                  ))
                )}
              </section>
            </>
          )}
        </div>

        <footer className="addmore__foot">
          <span className="addmore__hint">{SAYS.hint}</span>
        </footer>
      </div>
    </div>
  );
}

/** One thing you can add: what it is called, what it lets you do, and the single
 *  thing to do about it. */
function Row({
  pack,
  sentence,
  busy,
  explaining,
  explanation,
  onAdd,
  onRemove,
  onExplain,
}: {
  pack: Pack;
  sentence: string;
  busy: string | null;
  explaining: string | null;
  explanation: string | undefined;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onExplain: (id: string) => void;
}) {
  const working = busy === pack.id;
  const waiting = explaining === pack.id && explanation === undefined;

  return (
    <div className="addmore__row">
      <div className="addmore__rowtop">
        <div className="addmore__text">
          <span className="addmore__name">{pack.name}</span>
          <span className="addmore__summary">{sentence}</span>
        </div>
        <button
          type="button"
          className={`addmore__action ${pack.installed ? 'addmore__action--off' : ''}`}
          onClick={() => (pack.installed ? onRemove(pack.id) : onAdd(pack.id))}
          disabled={busy !== null}
        >
          {working
            ? pack.installed
              ? SAYS.removing
              : SAYS.adding
            : pack.installed
              ? SAYS.remove
              : SAYS.add}
        </button>
      </div>

      <div className="addmore__meta">
        <span className="addmore__kind">{SAYS.kinds[pack.kind]}</span>
        {pack.downloads === null ? null : (
          <span className="addmore__uses">{`${people(pack.downloads)} ${SAYS.perMonth}`}</span>
        )}
        {pack.installed ? <span className="addmore__on">{SAYS.added}</span> : null}
      </div>

      {/* The answer to the only question most people have, without leaving the
          screen to find a readme. */}
      {explanation === undefined ? (
        waiting ? (
          <span className="addmore__waiting">
            <span className="addmore__spin" aria-hidden="true" />
            <span>{SAYS.explainWait}</span>
          </span>
        ) : (
          <button type="button" className="addmore__explain" onClick={() => onExplain(pack.id)}>
            {SAYS.explain}
          </button>
        )
      ) : (
        <p className="addmore__explanation">{explanation}</p>
      )}
    </div>
  );
}

/** One place Graphe can reach: what it lets you do, one press, and the exact
 *  thing that starts it one click under that. */
function ReachRow({
  reach,
  busy,
  onConnect,
  onDisconnect,
}: {
  reach: Reach;
  busy: string | null;
  onConnect: (id: string) => void;
  onDisconnect: ((id: string) => void) | undefined;
}) {
  const working = busy === reach.id;

  return (
    <div className="addmore__row">
      <div className="addmore__rowtop">
        <div className="addmore__text">
          <span className="addmore__name">{reach.name}</span>
          <span className="addmore__summary">{reach.what}</span>
        </div>
        <button
          type="button"
          className={`addmore__action ${reach.added ? 'addmore__action--off' : ''}`}
          onClick={() => (reach.added ? onDisconnect?.(reach.id) : onConnect(reach.id))}
          disabled={busy !== null || (reach.added && onDisconnect === undefined)}
        >
          {working
            ? reach.added
              ? SAYS.removing
              : SAYS.adding
            : reach.added
              ? SAYS.remove
              : SAYS.add}
        </button>
      </div>

      <div className="addmore__meta">
        {reach.needs === null ? null : <span className="addmore__needs">{reach.needs}</span>}
        {reach.added ? <span className="addmore__on">{SAYS.added}</span> : null}
      </div>

      {/* The technical truth, one click away and never in the way. */}
      <details className="addmore__exact">
        <summary className="addmore__exactsummary">{SAYS.exact}</summary>
        <dl className="addmore__exactlist">
          {describeStart(reach.start).map((line) => (
            <div className="addmore__exactrow" key={line.label}>
              <dt className="addmore__exactlabel">{line.label}</dt>
              <dd className="addmore__exactvalue">{line.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

/** For somebody who has one of their own. Everything typed is read here first,
 *  so a mistake comes back as a sentence rather than as a failure later. */
function ByHand({ known, onAdd }: { known: readonly Reach[]; onAdd: (typed: Typed) => void }) {
  const [form, setForm] = useState(NOTHING_TYPED);
  const [why, setWhy] = useState<string | null>(null);

  const field = (key: keyof typeof NOTHING_TYPED) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: event.target.value });

  return (
    <details className="addmore__hand">
      <summary className="addmore__exactsummary">{SAYS.byHand}</summary>

      <label className="addmore__label">
        {SAYS.handName}
        <input className="addmore__field" type="text" value={form.name} onChange={field('name')} />
      </label>

      <label className="addmore__label">
        {SAYS.handWhat}
        <input className="addmore__field" type="text" value={form.what} onChange={field('what')} />
      </label>

      <label className="addmore__label">
        {SAYS.handWhere}
        <input className="addmore__field" type="text" value={form.where} onChange={field('where')} />
        <span className="addmore__hint">{SAYS.handWhereHint}</span>
      </label>

      <label className="addmore__label">
        {SAYS.handValues}
        <textarea
          className="addmore__field addmore__field--tall"
          rows={2}
          value={form.values}
          onChange={field('values')}
        />
      </label>

      {why === null ? null : <p className="addmore__trouble">{why}</p>}

      <button
        type="button"
        className="addmore__action"
        onClick={() => {
          const read = readReach(form, known);
          if (!read.ok) {
            setWhy(read.why);
            return;
          }
          setWhy(null);
          setForm(NOTHING_TYPED);
          onAdd(form);
        }}
      >
        {SAYS.handAdd}
      </button>
    </details>
  );
}

/** A count of people, not an integer nobody reads. */
function people(count: number): string {
  if (count >= 1_000_000) return `${trim(count / 1_000_000)}m`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${trim(count / 1000)}k`;
  return String(Math.round(count));
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/** Tab stays inside the panel while it is up. */
function trapTab(event: React.KeyboardEvent, panel: HTMLElement | null) {
  if (event.key !== 'Tab' || panel === null) return;
  const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (stops.length === 0) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.contains(active))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}
