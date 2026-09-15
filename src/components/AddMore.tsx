import { useEffect, useMemo, useRef, useState } from 'react';
import { everything } from '../agent/pi/packages';
import type { AddonSetup, CarriedExtension, ExtensionHere, Stopping } from '../lib/ipc';
import { COPY, useCopying } from '../lib/copying';
import Switch from './Switch';
import {
  alreadyReached,
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
  vouchedHeading: 'Ready to use (we have checked these)',
  vouchedNote: 'These come from us, and they work the moment you add them.',
  restHeading: 'Made by other people',
  add: 'Add',
  adding: 'Adding…',
  remove: 'Remove',
  removing: 'Taking it off…',
  added: 'Added',
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
  byHand: 'Add one of your own',
  handName: 'Name',
  handWhat: 'What it lets you do',
  handWhere: 'Where to find it',
  handWhereHint: 'The address it answers on, or the program that starts it.',
  handValues: 'Values it needs, one per line, as NAME=value',
  handAdd: 'Add it',
  carriedHeading: 'Came with this project',
  carriedNote:
    'You did not choose these. They came down with the project. Everything else Graphe does is checked as it goes; these run as part of Graphe itself, so they stay off until you turn one on.',
  carriedRestart: 'Turning one on starts a fresh conversation in this project, so it can be loaded.',
  stop: 'Stop',
  hereHeading: 'What is here',
  hereNote: 'Everything Graphe can load in this project, and what each one is doing.',
  inChats: 'Loaded in',
  getNode: 'Get Node',
  details: 'What it said',
} as const;

type Props = {
  open: boolean;
  packs: readonly Pack[];
  /** Ours, with a plain sentence saying what it lets you do. */
  vouchedFor: Readonly<Record<string, string>>;
  busy: string | null;
  warning: string;
  onClose: () => void;
  onSearch: (term: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /**
   * What each installed add-on will actually do, by add-on id.
   *
   * Worked out by asking the add-on rather than from a list of names, so one
   * published tomorrow is described on the same evidence as one installed
   * today. Absent for an add-on nothing has looked at.
   */
  capabilities?: Readonly<Record<string, string>>;
  /** How many processes add-ons have running right now. Information, not a
   *  control: nothing here kills anything. */
  addonProcesses?: number | null;
  /** The other half of the shelf: the places somebody's work already lives,
   *  as the ids of whichever ones this project has. Names rather than the shelf
   *  itself, so what we offer is this screen's own and a launch does not carry
   *  the whole list. */
  reaches?: readonly string[];
  /** Which of those is being turned on or off this moment. */
  connecting?: string | null;
  /** Given one of ours by name. Without it that half of the shelf stays down,
   *  because a row nobody can press is worse than a row that is not there. */
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  /** A form somebody filled in themselves. Checked here first, so the sentence
   *  saying what is wrong arrives before anything is asked to keep it. */
  onConnectByHand?: (typed: Typed) => void;
  /** What the open project brought with it. Nobody went looking for these, so
   *  they are a decision rather than a shelf, and they are not searched. */
  carried?: readonly CarriedExtension[];
  onTrustCarried?: (id: string, trust: boolean) => void;
  /** Every add-on this project can see, and what each one is doing here. Read
   *  when the screen opens: it changes when a session is built or trusted. */
  here?: readonly ExtensionHere[];
  /** Whether a change in flight can be ended here, and the line to draw where
   *  it cannot — the shelf's own sentence, so the screen and a press agree. */
  stopping?: Stopping;
  onStop?: () => void;
  /** What the last stop left on disk, in the shelf's own words. Cleared when
   *  the next change starts, so it is never read as news about that one. */
  stoppedSays?: string | null;
  /** What installing one needs from this computer: nothing at all, or a line
   *  and a way to install Node. Drawn before anybody presses Add. */
  setup?: AddonSetup;
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
 * rest are somebody else's work and are labelled as that.
 */
export default function AddMore({
  open,
  packs,
  vouchedFor,
  busy,
  warning,
  onClose,
  onSearch,
  onAdd,
  onRemove,
  capabilities = {},
  addonProcesses = null,
  reaches = [],
  connecting = null,
  onConnect,
  onDisconnect,
  onConnectByHand,
  carried = [],
  onTrustCarried,
  here = [],
  stopping,
  onStop,
  stoppedSays = null,
  setup,
}: Props) {
  const [term, setTerm] = useState('');
  const [showing, setShowing] = useState<Showing>('all');
  const copy = useCopying();
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
      if (event.key !== 'Escape') return;
      // Said out loud, so nothing behind this reads the same press as its own.
      event.preventDefault();
      onClose();
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

  // Ours, with whichever of them this project already has ticked.
  const places = useMemo(() => alreadyReached(reaches), [reaches]);

  // One ordering for both kinds, then split into the bands they are drawn in.
  const [found, vouched, rest] = useMemo(() => {
    const shelf = everything(packs, reachesMatching(places, term));
    const ours: Pack[] = [];
    const theirs: Pack[] = [];
    const outward: Reach[] = [];
    for (const one of shelf) {
      if (one.sort === 'reach') outward.push(one.reach);
      else if (one.addition.curated) ours.push(one.addition);
      else theirs.push(one.addition);
    }
    return [outward, ours, theirs] as const;
  }, [packs, places, term]);

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

        {/* What installing one needs before anybody presses Add. A line and a
            way to act on it, because the press without npm ends in the
            installer's own words. */}
        {setup?.needed !== true ? null : (
          <p className="addmore__setup">
            <span className="addmore__setupso">{setup.line}</span>
            <a
              className="addmore__setuplink"
              href={setup.download}
              target="_blank"
              rel="noreferrer"
            >
              {SAYS.getNode}
            </a>
            {setup.command === null ? null : (
              <button
                type="button"
                className="addmore__setuplink"
                onClick={() => copy.copy(setup.command ?? '')}
              >
                {copy.copied ? COPY.done : `Copy ${setup.command}`}
              </button>
            )}
          </p>
        )}

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

        <div className="addmore__body scroll--auto">
          {/* First, because it is about the project in front of you — searching
              for something to add is a general errand and can wait. */}
          {carried.length === 0 ? null : (
            <section className="addmore__carried" aria-label={SAYS.carriedHeading}>
              <h3 className="addmore__grouphead">{SAYS.carriedHeading}</h3>
              <p className="addmore__groupnote">{SAYS.carriedNote}</p>
              <p className="addmore__carriedhint">{SAYS.carriedRestart}</p>
              {carried.map((one) => (
                <label className="addmore__switch" key={one.id}>
                  <Switch
                    on={one.trusted}
                    onChange={(next) => onTrustCarried?.(one.id, next)}
                    label={one.name}
                  />
                  <span className="addmore__switchtext">
                    <span className="addmore__switchlabel">{one.name}</span>
                    <span className="addmore__where">{one.where}</span>
                  </span>
                </label>
              ))}
            </section>
          )}

          {!showAdditions || here.length === 0 ? null : (
            <section className="addmore__group" aria-label={SAYS.hereHeading}>
              <h3 className="addmore__grouphead">{SAYS.hereHeading}</h3>
              <p className="addmore__groupnote">{SAYS.hereNote}</p>
              {here.map((one) => (
                <HereRow key={one.where} one={one} />
              ))}
            </section>
          )}

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
                <ByHand known={places} onAdd={onConnectByHand} />
              )}
            </section>
          ) : null}

          {!showAdditions ? null : packs.length === 0 ? (
            <p className="addmore__quiet">{searching ? SAYS.noMatches : SAYS.emptyCatalogue}</p>
          ) : (
            <>
              {/* What the last stop left on disk, in the shelf's own words —
                  said here rather than left to be inferred from a row. */}
              {stoppedSays === null ? null : (
                <p className="addmore__stopped">{stoppedSays}</p>
              )}
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
                      onAdd={onAdd}
                      onRemove={onRemove}
                      {...(stopping === undefined ? {} : { stopping })}
                      {...(onStop === undefined ? {} : { onStop })}
                      {...(capabilities[pack.id] === undefined
                        ? {}
                        : { capability: capabilities[pack.id] })}
                    />
                  ))}
                </section>
              )}

              {/* What add-ons have running right now. Information: nothing on
                  this page kills anything, and a number nobody can act on is
                  still the difference between a slow machine and a mystery. */}
              {addonProcesses !== null && addonProcesses > 0 ? (
                <p className="addmore__quiet">
                  {addonProcesses === 1
                    ? '1 process started by an add-on is running right now.'
                    : `${String(addonProcesses)} processes started by add-ons are running right now.`}
                </p>
              ) : null}

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
                      onAdd={onAdd}
                      onRemove={onRemove}
                      {...(stopping === undefined ? {} : { stopping })}
                      {...(onStop === undefined ? {} : { onStop })}
                      {...(capabilities[pack.id] === undefined
                        ? {}
                        : { capability: capabilities[pack.id] })}
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
  stopping,
  onAdd,
  onRemove,
  onStop,
  capability,
}: {
  pack: Pack;
  sentence: string;
  busy: string | null;
  stopping?: Stopping;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onStop?: () => void;
  capability?: string;
}) {
  const working = busy === pack.id;

  return (
    <div className="addmore__row">
      <div className="addmore__rowtop">
        <div className="addmore__text">
          <span className="addmore__name">{pack.name}</span>
          <span className="addmore__summary">{sentence}</span>
        </div>
        {/* Only while this row's own change is running, and only where this
            copy of the app can end one. */}
        {working && stopping?.canStop === true && onStop !== undefined ? (
          <button type="button" className="addmore__action" onClick={onStop}>
            {SAYS.stop}
          </button>
        ) : null}
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

      {/* Where it cannot be ended, the shelf's own sentence says so. A Stop that
          only ever answered "I cannot" would be worse than no press at all. */}
      {working && stopping !== undefined && !stopping.canStop ? (
        <span className="addmore__does">{stopping.says}</span>
      ) : null}

      <div className="addmore__meta">
        <span className="addmore__kind">{SAYS.kinds[pack.kind]}</span>
        {pack.downloads === null ? null : (
          <span className="addmore__uses">{`${people(pack.downloads)} ${SAYS.perMonth}`}</span>
        )}
        {pack.installed ? <span className="addmore__on">{SAYS.added}</span> : null}
      </div>

      {/* What it will do, in its own terms. A line derived from what the add-on
          registers, never from knowing its name. */}
      {capability === undefined ? null : (
        <span className="addmore__does">{capability}</span>
      )}
    </div>
  );
}

/** One add-on this computer has: what it is, where it came from, how far it
 *  reaches, and what it is doing here — or why it is not. */
function HereRow({ one }: { one: ExtensionHere }) {
  const state = one.state.charAt(0).toUpperCase() + one.state.slice(1);
  return (
    <div className="addmore__row">
      <div className="addmore__rowtop">
        <div className="addmore__text">
          <span className="addmore__name">
            {/* An add-on nothing could fingerprint has no name of its own, and
                the file it would load is the honest thing to call it. */}
            {one.id === '' ? one.where : one.id}
            {one.version === null ? null : ` ${one.version}`}
          </span>
          <span className="addmore__summary">{one.says}</span>
        </div>
        <span className="addmore__state">{state}</span>
      </div>

      <div className="addmore__meta">
        <span className="addmore__kind">{`${one.origin} · ${one.scope}`}</span>
        {one.commands.length === 0 ? null : (
          <span className="addmore__uses">{one.commands.map((name) => `/${name}`).join(' ')}</span>
        )}
      </div>

      {/* Which conversations have it loaded right now, by the name each one is
          known by. "Running in 2 chats" is a count; a person deciding whether
          to remove something wants to know which two. */}
      {one.activeIn.length === 0 ? null : (
        <span className="addmore__chats">{`${SAYS.inChats} ${one.activeIn.join(', ')}`}</span>
      )}

      {/* What it cannot do, in its own terms — the advisor keeping one setting
          for the whole computer is the one this exists for. */}
      {one.limits.map((limit) => (
        <span className="addmore__limit" key={limit}>
          {limit}
        </span>
      ))}

      <span className="addmore__where">{one.where}</span>

      {/* The loader's own words, kept behind a press: "it did not load" without
          the reason is a shrug, and the reason is several lines long. */}
      {one.problem === null ? null : (
        <details className="addmore__hand">
          <summary className="addmore__exactsummary">{`${SAYS.details}: ${one.problem}`}</summary>
          <pre className="addmore__logtext">{one.logs.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

/** One place Graphe can reach: what it lets you do, and one press. */
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
