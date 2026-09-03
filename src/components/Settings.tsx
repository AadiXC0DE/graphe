import { useEffect, useMemo, useState } from 'react';
import Always from './Always';
import AppearanceBand from './AppearanceBand';
import Switch from './Switch';
import ColourPicker from './ColourPicker';
import ThinkingWith from './ThinkingWith';
import { advisorSwitchWords, advisorWords } from '../agent/advisor';
import { policyWords, saysPolicy, type Policy } from '../agent/pi/extension-policy';
import { PRESETS, appearanceWords, presetOf, type Appearance } from '../design/appearance';
import { hexOf, rgbFrom, surfacesFrom } from '../design/palette-oklch';
import { ACTIONS, ACTION_WORDS, chordFor, clashesIn, type Bindings, type Chord, type Where } from '../lib/actions';
import type {
  AddonHere,
  AlwaysDoes,
  AlwaysRow,
  ConnectionState,
  ModelChoice,
  ThinkingLevel,
} from '../lib/ipc';
import { chordOf, saysChord } from '../lib/keys';
import { THEME_WORDS, showing, type Theme } from '../lib/theme';
import { TELLINGS, type Telling } from '../work/notify';
import {
  OPEN_TO,
  PAGES,
  SAME_LANGUAGE,
  SHELF_AT_LAUNCH,
  pageFor,
  pageWords,
  rowAt,
  rowsOn,
  search,
  settingsWords,
  type OpenTo,
  type Page,
  type Row,
  type ShelfAtLaunch,
} from '../work/settingspages';
import './Settings.css';

export type SettingsLink =
  | 'skills'
  | 'connected'
  | 'add-more'
  | 'usage'
  | 'accounts'
  | 'palette'
  | 'show-me'
  | 'files'
  | 'folder'
  | 'editor'
  | 'always';

type Props = {
  open: boolean;
  onClose: () => void;
  /** The row somebody asked for by name in the palette, so the screen opens on
   *  the page holding it rather than on the first one. */
  startAt?: string | null;
  showMe: boolean;
  showFiles: boolean;
  /** Check new work before it lands, rather than as it happens. */
  holdBack: boolean;
  /** The browser this project drives keeps what it is signed in to. */
  keepLogins: boolean;
  /** What this project does without being asked, or null before it is read. */
  always: AlwaysDoes | null;
  /** The whole list, written back. Left off, the page is read only. */
  onAlwaysWrite?: (rows: readonly AlwaysRow[]) => void;
  /** Every editor and terminal installed on this machine, in the order they
   *  are preferred. Empty until the shell has answered. */
  editors?: readonly string[];
  terminals?: readonly string[];
  /** Which of them the two Open in rows go to, or null for the first found. */
  opensIn?: { editor: string | null; terminal: string | null };
  onOpensIn?: (which: 'editor' | 'terminal', name: string) => void;
  /** Which palette somebody has chosen, or to follow the computer. */
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onToggleShowMe: () => void;
  onToggleShowFiles: () => void;
  onToggleHoldBack: () => void;
  onToggleKeepLogins: () => void;
  onGo: (link: SettingsLink) => void;
  /** Which build this is, so a report can say. Nothing in the window said it
   *  before, and a friend on an old build had no way to find out. */
  version?: string;
  /** How much room this app is taking, and what could be cleared. Asked when
   *  the sheet opens — it walks folders, and this is open for seconds. */
  storage?: { says: string; couldClear: number; because: string } | null;
  onClearFinishedWork?: () => void;
  /** Everything worth sending when somebody says "it stopped", on the
   *  clipboard. Never a conversation, never a key. */
  onCopyDiagnostics?: () => void;
  /** What this machine will do at once, derived from the machine. */
  caps?: string;
  /** How the app looks. Five colour presets were the whole of it before, and a
   *  preset is somebody else's taste. */
  appearance?: Appearance;
  onAppearance?: (next: Appearance) => void;
  /** Which way the palette runs right now, so the preview is the real thing. */
  showingDark?: boolean;
  /** Where somebody's own stylesheet lives. The precise control behind the
   *  same row: every value the builder sets is a token, and this is where a
   *  token it does not offer gets written. */
  ownStyles?: string;
  onReloadStyles?: () => void;
  /** How a chord is drawn. The one thing on this screen that has to know which
   *  computer it is running on. */
  onMac?: boolean;
  /** The chords as somebody has changed them, and the way to change one. Left
   *  off, the list is drawn and cannot be edited. */
  bindings?: Bindings;
  onBind?: (id: string, chord: Chord | null) => void;

  /* --------------------------------------------------------------- models */
  /** Everything the model row needs: it draws the same chip the composer does,
   *  so the list, the thinking time and the advisor are one control in both
   *  places rather than two that can disagree. */
  connection?: ConnectionState | null;
  onSelectModel?: (choice: ModelChoice) => void;
  onThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  onConnect?: () => void;
  advisor?: ModelChoice | null;
  onAdvisor?: (choice: ModelChoice | null) => void;
  advisorThinking?: ThinkingLevel | null;
  onAdvisorThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  /** The two gates the advisor can hold, both off by default. */
  advisorGates?: { completionGate: boolean; loopGate: boolean };
  onAdvisorGate?: (which: 'completionGate' | 'loopGate', on: boolean) => void;

  /* ------------------------------------------------------------ behaviour */
  /** Where a launch lands, and how the shelf comes back. Both are habits of
   *  this window rather than anything the shell acts on. */
  openTo?: OpenTo;
  onOpenTo?: (choice: OpenTo) => void;
  shelfAtLaunch?: ShelfAtLaunch;
  onShelfAtLaunch?: (choice: ShelfAtLaunch) => void;
  nameConversations?: boolean;
  askBeforeClosing?: boolean;
  snapBeforeApply?: boolean;
  replyLanguage?: string;
  onReplyLanguage?: (says: string) => void;

  /* -------------------------------------------------------- notifications */
  whenRunFinishes?: Telling;
  whenSomethingNeedsYou?: Telling;
  notifySound?: boolean;
  badgeDock?: boolean;
  /** The switches on both new pages, written back by name. One road rather
   *  than eight, because the rows differ only in which preference they hold. */
  onBehaviour?: (
    which:
      | 'nameConversations'
      | 'askBeforeClosing'
      | 'snapBeforeApply'
      | 'notifySound'
      | 'badgeDock',
    on: boolean,
  ) => void;
  onTelling?: (which: 'whenRunFinishes' | 'whenSomethingNeedsYou', told: Telling) => void;

  /* -------------------------------------------------------------- add-ons */
  /** How much of an add-on that starts turns of its own runs here. */
  addons?: Policy;
  onAddons?: (choice: Policy) => void;
  /** Every add-on loaded here, with what its capability card said. Empty until
   *  a conversation has been opened, which is when they are read. */
  addonsHere?: readonly AddonHere[];
};

const POLICIES: readonly { id: Policy; label: string }[] = [
  { id: 'on', label: policyWords.on },
  { id: 'tools-only', label: policyWords.toolsOnly },
  { id: 'off', label: policyWords.off },
];

/** Past this many the strip is wider than the row it sits in. */
const MOST_INLINE = 4;

const APP_WORDS = {
  none: 'None found here',
} as const;

const ADDON_WORDS = {
  none: 'Nothing is loaded here yet. Open a conversation and this fills in.',
  /** Above the list, so the three-way above it is read as the default it is. */
  each: 'What is loaded here',
} as const;

/** Rows whose control will not sit on the right-hand end of a row, so each one
 *  gets a card of its own. The model chip opens a menu over the card, which a
 *  card that clips its corners would cut in half. */
const BLOCKS = new Set(['theme', 'model', 'addons', 'new-model']);

/** The three answers to which way the palette runs, in the order a segmented
 *  control reads them. */
const BASES: readonly { id: Theme; says: string }[] = [
  { id: 'system', says: appearanceWords.base.system },
  { id: 'light', says: appearanceWords.base.light },
  { id: 'dark', says: appearanceWords.base.dark },
];

/** What a colour input shows. On Auto that is the colour the palette worked
 *  out, so an empty picker is never a lie about what is on screen. */
function swatchFor(
  one: Appearance,
  which: 'accent' | 'ground' | 'ink',
  computerIsDark: boolean,
): string {
  const said = which === 'accent' ? one.accent : one[which];
  const asked = said === null ? null : rgbFrom(said);
  if (asked !== null) return hexOf(asked);
  const on = one.base === 'system' ? (computerIsDark ? 'dark' : 'light') : one.base;
  const made = surfacesFrom(one.accent, one.tone, one.contrast, on, one.ground, one.ink);
  if (which === 'accent') return made.accent;
  return which === 'ink' ? made.text : made.bg;
}

/** The rows of a page cut into cards: a block row alone, everything else in the
 *  run it arrived in. */
function runs(rows: readonly Row[]): readonly [Row, ...Row[]][] {
  const cut: [Row, ...Row[]][] = [];
  for (const row of rows) {
    const last = cut[cut.length - 1];
    if (last === undefined || BLOCKS.has(row.id) || BLOCKS.has(last[0].id)) cut.push([row]);
    else last.push(row);
  }
  return cut;
}

const KEY_WORDS = {
  reading: 'Press a row, then the keys you want. Escape leaves it alone; Backspace clears it.',
  listening: 'Press the keys…',
  clear: 'No key',
  reset: 'Put them all back',
  /** Two actions on one chord. Said where it happens rather than found later by
   *  pressing it and getting the wrong one. */
  clash: (says: readonly string[]): string => `Also ${says.join(' and ')}.`,
} as const;

/**
 * The quieter controls, as pages you can search.
 *
 * One sheet worked while there were eleven things on it. Past that the only way
 * anybody finds a preference is to read all of them, and the person who knows
 * exactly what they want reads the most. So the rows live in
 * `work/settingspages.ts`, which knows which page each one is on and what else
 * somebody might call it, and the same search answers this sidebar and the
 * command palette.
 */
export default function Settings({
  open,
  onClose,
  startAt = null,
  showMe,
  showFiles,
  holdBack,
  theme,
  onTheme,
  onToggleShowMe,
  onToggleShowFiles,
  onToggleHoldBack,
  keepLogins,
  onToggleKeepLogins,
  always,
  onAlwaysWrite,
  editors = [],
  terminals = [],
  opensIn,
  onOpensIn,
  onGo,
  version,
  storage = null,
  onClearFinishedWork,
  onCopyDiagnostics,
  caps,
  appearance,
  onAppearance,
  showingDark = false,
  ownStyles,
  onReloadStyles,
  onMac = false,
  bindings,
  onBind,
  connection = null,
  onSelectModel,
  onThinking,
  onConnect,
  advisor = null,
  onAdvisor,
  advisorThinking,
  onAdvisorThinking,
  advisorGates,
  onAdvisorGate,
  addons,
  onAddons,
  addonsHere = [],
  openTo = 'last',
  onOpenTo,
  shelfAtLaunch = 'remembered',
  onShelfAtLaunch,
  nameConversations = true,
  askBeforeClosing = true,
  snapBeforeApply = true,
  replyLanguage = '',
  onReplyLanguage,
  whenRunFinishes = 'system',
  whenSomethingNeedsYou = 'system',
  notifySound = false,
  badgeDock = true,
  onBehaviour,
  onTelling,
}: Props) {
  const [page, setPage] = useState<Page>('appearance');
  const [query, setQuery] = useState('');
  const [chords, setChords] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Every opening starts clean, and one asked for by name starts on the page
     holding it. */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setChords(false);
    setPage(rowAt(startAt ?? '')?.page ?? 'appearance');
  }, [open, startAt]);

  const typed = query.trim();
  const found = useMemo(() => (typed === '' ? null : search(typed)), [typed]);
  const bestPage = useMemo(() => (typed === '' ? null : pageFor(typed)), [typed]);

  if (!open) return null;

  /* Following the computer still lands somewhere; this is where. Read at the
     render of the sheet — it is open for seconds, not for ever. */
  const computerIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const onScreenName = THEME_WORDS[showing('system', computerIsDark)];

  const shown = found ?? rowsOn(page);
  /* Always is reached from a row on Advanced rather than the sidebar, so the
     sidebar keeps naming the page it was opened from. */
  const navPage: Page = page === 'always' ? 'advanced' : page;
  const highlighted = startAt === null || typed !== '' ? null : startAt;

  const words = (row: Row, note?: string) => (
    <span className="settings__text">
      <span className="settings__name">{row.name}</span>
      <span className="settings__note">{note ?? row.note}</span>
      {found === null ? null : (
        <span className="settings__from">{settingsWords.on(row.page)}</span>
      )}
    </span>
  );

  const goes = (row: Row, link: SettingsLink, meta?: string) => (
    <button
      type="button"
      className="settings__row"
      onClick={() => {
        onGo(link);
        onClose();
      }}
    >
      {words(row)}
      {meta === undefined ? null : <span className="settings__meta">{meta}</span>}
      <span className="settings__chev" aria-hidden="true">
        ›
      </span>
    </button>
  );

  const flip = (row: Row, on: boolean, change: () => void, off = false) => (
    <label className="settings__row settings__row--switch">
      {words(row)}
      <Switch on={on} onChange={change} label={row.name} disabled={off} />
    </label>
  );

  /** A row answered by one of a short list. The same strip the two Open in
   *  rows use, so every choice on these pages reads the same way. */
  const picks = <T extends string>(
    row: Row,
    all: readonly { id: T; says: string }[],
    chosen: T,
    pick: ((id: T) => void) | undefined,
  ) => (
    <div className="settings__row">
      {words(row)}
      <span
        className="settings__choices settings__choices--inline"
        role="radiogroup"
        aria-label={row.name}
      >
        {all.map((one) => (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={one.id === chosen}
            className={`settings__choice ${one.id === chosen ? 'settings__choice--on' : ''}`}
            disabled={pick === undefined}
            onClick={() => pick?.(one.id)}
          >
            {one.says}
          </button>
        ))}
      </span>
    </div>
  );

  /** A row answered by typing. Held in the window while somebody types and
   *  written on the way out, so a preference is not saved letter by letter. */
  const field = (row: Row, value: string, hint: string, write: ((says: string) => void) | undefined) => (
    <div className="settings__row">
      {words(row)}
      <input
        type="text"
        className="settings__field"
        aria-label={row.name}
        placeholder={hint}
        defaultValue={value}
        disabled={write === undefined}
        onBlur={(event) => write?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );

  /** Which app one of the two Open in rows goes to. A short list is a strip you
   *  can read at a glance; past four that strip is wider than the row. */
  const opens = (row: Row, which: 'editor' | 'terminal') => {
    const names = which === 'editor' ? editors : terminals;
    const chosen = opensIn?.[which] ?? names[0] ?? null;
    return (
      <div className="settings__row">
        {words(row)}
        {names.length === 0 ? (
          <span className="settings__meta">{APP_WORDS.none}</span>
        ) : names.length > MOST_INLINE ? (
          <select
            className="settings__pick"
            aria-label={row.name}
            value={chosen ?? ''}
            disabled={onOpensIn === undefined}
            onChange={(event) => onOpensIn?.(which, event.target.value)}
          >
            {names.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="settings__choices settings__choices--inline"
            role="radiogroup"
            aria-label={row.name}
          >
            {names.map((one) => (
              <button
                key={one}
                type="button"
                role="radio"
                aria-checked={one === chosen}
                className={`settings__choice ${one === chosen ? 'settings__choice--on' : ''}`}
                disabled={onOpensIn === undefined}
                onClick={() => onOpensIn?.(which, one)}
              >
                {one}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  };

  /** The two switches the advisor holds, drawn under the model row because that
   *  is the control they belong to. */
  const gates =
    advisorGates === undefined || onAdvisorGate === undefined
      ? null
      : (
          <section className="settings__sub" aria-label={advisorWords.name}>
            <h3 className="settings__subtitle">{advisorWords.name}</h3>
            <ul className="settings__rows">
              {(['completionGate', 'loopGate'] as const).map((which) => (
                <li key={which}>
                  <label className="settings__row settings__row--switch">
                    <span className="settings__text">
                      <span className="settings__name">{advisorSwitchWords[which].label}</span>
                      <span className="settings__note">{advisorSwitchWords[which].hint}</span>
                    </span>
                    <Switch
                      on={advisorGates[which]}
                      onChange={(on) => onAdvisorGate(which, on)}
                      label={advisorSwitchWords[which].label}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );

  const drawRow = (row: Row) => {
    const at = row.id === highlighted ? ' settings__at' : '';

    switch (row.id) {
      case 'theme':
        return (
          <li key={row.id} className={`settings__block${at}`}>
            <div className="settings__blockhead">{words(row)}</div>
            <div className="settings__theme-wrap">
              <div className="settings__theme-foot">
                <span className="settings__bases" role="group" aria-label={appearanceWords.base.name}>
                  {BASES.map((one) => (
                    <button
                      key={one.id}
                      type="button"
                      className={`settings__system ${theme === one.id ? 'settings__system--on' : ''}`}
                      aria-pressed={theme === one.id}
                      onClick={() => onTheme(one.id)}
                    >
                      {one.says}
                    </button>
                  ))}
                </span>
                {theme === 'system' ? (
                  /* Saying which palette the computer picked spares the reader
                     a guess about what they are actually looking at. */
                  <p className="settings__system-note">{onScreenName} right now.</p>
                ) : null}
              </div>

              {appearance === undefined || onAppearance === undefined ? null : (
                <>
                  <span className="settings__themes" role="group" aria-label={appearanceWords.presets.name}>
                    {PRESETS.map((preset) => {
                      const would = { ...appearance, ...preset.is };
                      const on = would.base === 'system' ? (computerIsDark ? 'dark' : 'light') : would.base;
                      const made = surfacesFrom(
                        would.accent,
                        would.tone,
                        would.contrast,
                        on,
                        would.ground,
                        would.ink,
                      );
                      const here = presetOf(appearance) === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`settings__theme ${here ? 'settings__theme--on' : ''}`}
                          aria-pressed={here}
                          /* The base travels with the appearance, so this is
                             one press and one write. */
                          onClick={() => onAppearance(would)}
                          title={preset.name}
                        >
                          <span
                            className="settings__thumb"
                            aria-hidden="true"
                            style={{ background: made.bg, borderColor: made.border }}
                          >
                            <span
                              className="settings__thumb-raised"
                              style={{ background: made.bgRaised, borderColor: made.border }}
                            />
                            <span className="settings__thumb-dot" style={{ background: made.accent }} />
                            <span className="settings__thumb-line" style={{ background: made.text }} />
                            <span
                              className="settings__thumb-line settings__thumb-line--muted"
                              style={{ background: made.text }}
                            />
                          </span>
                          <span className="settings__theme-label">{preset.name}</span>
                        </button>
                      );
                    })}
                  </span>

                  <div className="settings__pickers">
                    <ColourPicker
                      name={appearanceWords.accent.name}
                      value={swatchFor(appearance, 'accent', computerIsDark)}
                      chosen={appearance.accent}
                      onChange={(hex) => onAppearance({ ...appearance, accent: hex })}
                    />
                    {(['ground', 'ink'] as const).map((which) => (
                      <ColourPicker
                        key={which}
                        name={appearanceWords[which].name}
                        value={swatchFor(appearance, which, computerIsDark)}
                        chosen={appearance[which]}
                        onChange={(hex) => onAppearance({ ...appearance, [which]: hex })}
                        onAuto={() => onAppearance({ ...appearance, [which]: null })}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </li>
        );

      case 'show-me':
        return (
          <li key={row.id} className={at}>
            {flip(row, showMe, onToggleShowMe)}
          </li>
        );

      case 'files':
        return (
          <li key={row.id} className={at}>
            {flip(row, showFiles, onToggleShowFiles)}
          </li>
        );

      case 'hold-back':
        return (
          <li key={row.id} className={at}>
            {flip(row, holdBack, onToggleHoldBack)}
          </li>
        );

      case 'keep-logins':
        return (
          <li key={row.id} className={at}>
            {flip(row, keepLogins, onToggleKeepLogins)}
          </li>
        );

      case 'shortcuts':
        return (
          <li key={row.id} className={at}>
            <button
              type="button"
              className="settings__row"
              aria-expanded={chords}
              onClick={() => setChords((was) => !was)}
            >
              {words(row)}
              <span className="settings__meta">{ACTIONS.length}</span>
              <span className="settings__chev" aria-hidden="true">
                {chords ? '⌄' : '›'}
              </span>
            </button>
            {chords ? <Chords onMac={onMac} bindings={bindings} onBind={onBind} /> : null}
          </li>
        );

      case 'palette':
        return (
          <li key={row.id} className={at}>
            <button
              type="button"
              className="settings__row"
              onClick={() => {
                onGo('palette');
                onClose();
              }}
            >
              {words(row)}
              <span className="settings__meta">{saysChord(row.keys ?? null, onMac)}</span>
            </button>
          </li>
        );

      case 'model':
        return (
          <li key={row.id} className={`settings__block${at}`}>
            <div className="settings__blockhead">
              {words(row)}
              {onSelectModel === undefined || onConnect === undefined ? null : (
                <ThinkingWith
                  state={connection}
                  onSelect={onSelectModel}
                  onConnect={onConnect}
                  advisor={advisor}
                  {...(onThinking === undefined ? {} : { onThinking })}
                  {...(onAdvisor === undefined ? {} : { onAdvisor })}
                  {...(advisorThinking == null ? {} : { advisorThinking })}
                  {...(onAdvisorThinking === undefined ? {} : { onAdvisorThinking })}
                />
              )}
            </div>
            {gates}
          </li>
        );

      case 'accounts':
        return <li key={row.id} className={at}>{goes(row, 'accounts')}</li>;

      case 'usage':
        return <li key={row.id} className={at}>{goes(row, 'usage')}</li>;

      case 'skills':
        return <li key={row.id} className={at}>{goes(row, 'skills')}</li>;

      case 'connected':
        return <li key={row.id} className={at}>{goes(row, 'connected')}</li>;

      case 'add-more':
        return <li key={row.id} className={at}>{goes(row, 'add-more')}</li>;

      case 'folder':
        return <li key={row.id} className={at}>{goes(row, 'folder')}</li>;

      case 'editor':
        return <li key={row.id} className={at}>{opens(row, 'editor')}</li>;

      case 'terminal':
        return <li key={row.id} className={at}>{opens(row, 'terminal')}</li>;

      case 'open-to':
        return <li key={row.id} className={at}>{picks(row, OPEN_TO, openTo, onOpenTo)}</li>;

      case 'shelf-at-launch':
        return (
          <li key={row.id} className={at}>
            {picks(row, SHELF_AT_LAUNCH, shelfAtLaunch, onShelfAtLaunch)}
          </li>
        );

      case 'send-with': {
        /* The one list of chords, edited through the one mechanism. The other
           press starts a new line, which is why this is a choice of two
           rather than a field. */
        const now = chordFor('send', bindings) === 'mod+enter' ? 'mod+enter' : 'enter';
        const sends = [
          { id: 'enter', says: saysChord('enter', onMac) },
          { id: 'mod+enter', says: saysChord('mod+enter', onMac) },
        ] as const;
        return (
          <li key={row.id} className={at}>
            {picks(
              row,
              sends,
              now,
              onBind === undefined ? undefined : (chord) => onBind('send', chord),
            )}
          </li>
        );
      }

      case 'name-conversations':
        return (
          <li key={row.id} className={at}>
            {flip(
              row,
              nameConversations,
              () => onBehaviour?.('nameConversations', !nameConversations),
              onBehaviour === undefined,
            )}
          </li>
        );

      case 'ask-before-closing':
        return (
          <li key={row.id} className={at}>
            {flip(
              row,
              askBeforeClosing,
              () => onBehaviour?.('askBeforeClosing', !askBeforeClosing),
              onBehaviour === undefined,
            )}
          </li>
        );

      case 'snap-before-apply':
        return (
          <li key={row.id} className={at}>
            {flip(
              row,
              snapBeforeApply,
              () => onBehaviour?.('snapBeforeApply', !snapBeforeApply),
              onBehaviour === undefined,
            )}
          </li>
        );

      case 'new-model':
        return (
          <li key={row.id} className={`settings__block${at}`}>
            <div className="settings__blockhead">
              {words(row)}
              {onSelectModel === undefined || onConnect === undefined ? null : (
                <ThinkingWith
                  state={connection}
                  onSelect={onSelectModel}
                  onConnect={onConnect}
                  advisor={advisor}
                  {...(onThinking === undefined ? {} : { onThinking })}
                />
              )}
            </div>
          </li>
        );

      case 'reply-language':
        return (
          <li key={row.id} className={at}>
            {field(row, replyLanguage, SAME_LANGUAGE, onReplyLanguage)}
          </li>
        );

      case 'when-finished':
        return (
          <li key={row.id} className={at}>
            {picks(
              row,
              TELLINGS,
              whenRunFinishes,
              onTelling === undefined ? undefined : (told) => onTelling('whenRunFinishes', told),
            )}
          </li>
        );

      case 'when-needed':
        return (
          <li key={row.id} className={at}>
            {picks(
              row,
              TELLINGS,
              whenSomethingNeedsYou,
              onTelling === undefined
                ? undefined
                : (told) => onTelling('whenSomethingNeedsYou', told),
            )}
          </li>
        );

      case 'notify-sound':
        return (
          <li key={row.id} className={at}>
            {flip(
              row,
              notifySound,
              () => onBehaviour?.('notifySound', !notifySound),
              onBehaviour === undefined,
            )}
          </li>
        );

      case 'badge-dock':
        return (
          <li key={row.id} className={at}>
            {flip(row, badgeDock, () => onBehaviour?.('badgeDock', !badgeDock), onBehaviour === undefined)}
          </li>
        );

      case 'always':
        return (
          <li key={row.id} className={at}>
            <button type="button" className="settings__row" onClick={() => setPage('always')}>
              {words(row)}
              <span className="settings__meta">
                {always === null || always.rows.length === 0
                  ? 'None yet'
                  : `${String(always.rows.length)} of them`}
              </span>
              <span className="settings__chev" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        );

      case 'addons':
        return (
          <li key={row.id} className={`settings__block${at}`}>
            <div className="settings__blockhead">{words(row)}</div>
            {addons === undefined || onAddons === undefined ? null : (
              <div
                className="settings__choices"
                role="radiogroup"
                aria-label={row.name}
              >
                {POLICIES.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    role="radio"
                    aria-checked={addons === one.id}
                    className={`settings__choice ${addons === one.id ? 'settings__choice--on' : ''}`}
                    onClick={() => onAddons(one.id)}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
            )}
            {addons === undefined ? null : (
              <p className="settings__machine">{saysPolicy(addons)}</p>
            )}
            <section className="settings__sub" aria-label={ADDON_WORDS.each}>
              <h3 className="settings__subtitle">{ADDON_WORDS.each}</h3>
              {addonsHere.length === 0 ? (
                <p className="settings__machine">{ADDON_WORDS.none}</p>
              ) : (
                <ul className="settings__rows">
                  {addonsHere.map((one) => (
                    <li key={one.name}>
                      <div className="settings__row">
                        <span className="settings__text">
                          <span className="settings__name">{one.name}</span>
                          <span className="settings__note">{one.says}</span>
                        </span>
                        <span className="settings__meta">{saysPolicy(one.policy)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
        );

      case 'storage':
        return (
          <li key={row.id} className={at}>
            <button
              type="button"
              className="settings__row"
              onClick={() => onClearFinishedWork?.()}
              disabled={onClearFinishedWork === undefined || (storage?.couldClear ?? 0) === 0}
            >
              {words(row, storage === null ? row.note : `${storage.says} ${storage.because}`)}
              <span className="settings__meta">
                {storage === null || storage.couldClear === 0
                  ? 'Nothing to clear'
                  : `${String(storage.couldClear)} to clear`}
              </span>
            </button>
          </li>
        );

      case 'diagnostics':
        return (
          <li key={row.id} className={at}>
            <button
              type="button"
              className="settings__row"
              onClick={() => onCopyDiagnostics?.()}
              disabled={onCopyDiagnostics === undefined}
            >
              {words(row)}
              <span className="settings__meta">{version === undefined ? '' : version}</span>
            </button>
            {/* What this machine will do at once, worked out from the machine
                rather than written down. Quiet, under the row that sends it. */}
            {caps === undefined ? null : <p className="settings__machine">{caps}</p>}
          </li>
        );

      default:
        return null;
    }
  };

  return (
    <section className="settings" aria-label={settingsWords.title} role="dialog" aria-modal="true">
      <header className="settings__top">
        <div className="settings__topinner">
          <div>
            <p className="settings__eyebrow">Graphe</p>
            <h1>{settingsWords.title}</h1>
            <p>{settingsWords.note}</p>
          </div>
          <button type="button" className="settings__close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      {/* The scroller, and what the bands below measure themselves against —
          this surface rather than the window. */}
      <div className="settings__body scroll--auto">
        <div className="settings__inner">
          <nav className="settings__pages" aria-label={settingsWords.title}>
            <input
              className="settings__search"
              type="search"
              value={query}
              placeholder={settingsWords.search}
              aria-label={settingsWords.search}
              onChange={(event) => setQuery(event.target.value)}
            />
            {PAGES.map((one) => {
              /* While something is typed the sidebar follows the answer rather
                 than the last press, so searching never leaves somebody looking
                 at a page with no results on it. */
              const on = typed === '' ? one === navPage : one === bestPage;
              return (
                <button
                  key={one}
                  type="button"
                  className={`settings__page ${on ? 'settings__page--on' : ''}`}
                  aria-current={on}
                  title={pageWords[one].note}
                  onClick={() => {
                    setQuery('');
                    setPage(one);
                  }}
                >
                  {pageWords[one].name}
                </button>
              );
            })}
          </nav>

          <div className="settings__page-body">
            <h2 className="settings__pagetitle">
              {found === null ? pageWords[page].name : settingsWords.search}
            </h2>
            <p className="settings__pagenote">
              {found === null ? pageWords[page].note : ''}
            </p>

            {found !== null && found.length === 0 ? (
              <p className="settings__empty">{settingsWords.nothing}</p>
            ) : (
              runs(shown).map((run) => (
                <div
                  key={run[0].id}
                  className={`settings__group ${BLOCKS.has(run[0].id) ? 'settings__group--roomy' : ''}`}
                >
                  <ul className="settings__rows">{run.map(drawRow)}</ul>
                </div>
              ))
            )}

            {found === null && page === 'always' ? (
              <div className="settings__group">
                <Always
                  always={always}
                  {...(onAlwaysWrite === undefined ? {} : { onWrite: onAlwaysWrite })}
                  onOpenFile={() => onGo('always')}
                  onBack={() => setPage('advanced')}
                />
              </div>
            ) : null}

            {/* The band belongs to Appearance and to nothing else, so it is
                drawn under that page rather than as a row of its own. */}
            {found === null &&
            page === 'appearance' &&
            appearance !== undefined &&
            onAppearance !== undefined ? (
              <div className="settings__group">
                <h3 className="settings__subtitle">Make it yours</h3>
                <AppearanceBand
                  appearance={appearance}
                  onChange={onAppearance}
                  on={showingDark ? 'dark' : 'light'}
                />
                {ownStyles === undefined || ownStyles === '' ? null : (
                  <p className="settings__machine">
                    Write your own tokens in <code>{ownStyles}</code>. It loads last, so it wins.{' '}
                    {onReloadStyles === undefined ? null : (
                      <button type="button" className="settings__inline" onClick={onReloadStyles}>
                        Read it again
                      </button>
                    )}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Every action and the key it answers to, as this window is listening now.
 *
 * Read rather than set: the chords are one list in `lib/actions.ts`, and until
 * a saved binding reaches the key handler a field that took a new one would be
 * a control that changes nothing.
 */
function Chords({
  onMac,
  bindings = {},
  onBind,
}: {
  onMac: boolean;
  bindings?: Bindings;
  onBind?: (id: string, chord: Chord | null) => void;
}) {
  const wheres: readonly Where[] = ['anywhere', 'in a project', 'in a conversation'];
  /** Which row is listening. One at a time: two rows waiting for the same press
   *  is two rows that would both take it. */
  const [taking, setTaking] = useState<string | null>(null);
  const clashing = useMemo(() => clashesIn(bindings), [bindings]);

  /** The other actions already on one chord, by action id. */
  const alsoOn = (id: string): readonly string[] =>
    clashing
      .filter((one) => one.ids.includes(id))
      .flatMap((one) => one.ids.filter((other) => other !== id))
      .map((other) => ACTIONS.find((one) => one.id === other)?.says ?? other);

  return (
    <div className="settings__chords">
      <p className="settings__machine">{KEY_WORDS.reading}</p>
      {wheres.map((where) => (
        <section key={where}>
          <h3 className="settings__subtitle">{ACTION_WORDS.where[where]}</h3>
          <ul className="settings__chordlist">
            {ACTIONS.filter((one) => one.where === where).map((one) => {
              const chord = chordFor(one.id, bindings);
              const listening = taking === one.id;
              const also = alsoOn(one.id);
              return (
                <li key={one.id}>
                  <span>{one.says}</span>
                  {also.length === 0 ? null : (
                    <span className="settings__clash">{KEY_WORDS.clash(also)}</span>
                  )}
                  <button
                    type="button"
                    className={`settings__chordset ${listening ? 'settings__chordset--taking' : ''}`}
                    aria-pressed={listening}
                    disabled={onBind === undefined}
                    onClick={() => setTaking(listening ? null : one.id)}
                    /* The press itself is the value, so nothing else may act on
                       it while a row is listening. */
                    onKeyDown={(event) => {
                      if (!listening || onBind === undefined) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.key === 'Escape') {
                        setTaking(null);
                        return;
                      }
                      if (event.key === 'Backspace' || event.key === 'Delete') {
                        onBind(one.id, null);
                        setTaking(null);
                        return;
                      }
                      const pressed = chordOf(
                        {
                          key: event.key,
                          metaKey: event.metaKey,
                          ctrlKey: event.ctrlKey,
                          shiftKey: event.shiftKey,
                          altKey: event.altKey,
                        },
                        onMac,
                      );
                      // A modifier on its own is somebody still reaching.
                      if (pressed === '') return;
                      onBind(one.id, pressed);
                      setTaking(null);
                    }}
                  >
                    <kbd className={chord === null ? 'settings__unbound' : ''}>
                      {listening
                        ? KEY_WORDS.listening
                        : chord === null
                          ? ACTION_WORDS.unbound
                          : saysChord(chord, onMac)}
                    </kbd>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
