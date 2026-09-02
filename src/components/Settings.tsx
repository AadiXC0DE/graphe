import { useEffect } from 'react';
import AppearanceBand from './AppearanceBand';
import type { Appearance } from '../design/appearance';
import type { AlwaysDoes } from '../lib/ipc';
import { THEMES, THEME_WORDS, showing, type Theme } from '../lib/theme';
import Switch from './Switch';
import './Settings.css';

export type SettingsLink =
  | 'skills'
  | 'connected'
  | 'add-more'
  | 'usage'
  | 'show-me'
  | 'files'
  | 'folder'
  | 'editor'
  | 'always';

type Props = {
  open: boolean;
  onClose: () => void;
  showMe: boolean;
  showFiles: boolean;
  /** Check new work before it lands, rather than as it happens. */
  holdBack: boolean;
  /** The browser this project drives keeps what it is signed in to. */
  keepLogins: boolean;
  /** What this project does without being asked, or null before it is read. */
  always: AlwaysDoes | null;
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
};

/** The screens this one leads to. Places rather than preferences, so they sit
 *  in their own band above the switches instead of among them. */
const PLACES: readonly { id: SettingsLink; name: string; note: string }[] = [
  {
    id: 'skills',
    name: 'Skills',
    note: 'Craft you can call up with @ in a message.',
  },
  {
    id: 'connected',
    name: 'Other tools',
    note: 'The design files, databases and services this project can reach.',
  },
  {
    id: 'add-more',
    name: 'Add more to Graphe',
    note: 'Give it new things it can do for you.',
  },
  {
    id: 'usage',
    name: 'What this cost',
    note: 'Spend, what was reused from earlier, and the work that needed another try.',
  },
];

/** Each row knows its own kind and its own id, so a switch row and a link row
 *  are told apart by the union, not by a string field that could disagree. */
type Row =
  | { id: 'show-me'; name: string; note: string; kind: 'show-me' }
  | { id: 'files'; name: string; note: string; kind: 'files' }
  | { id: 'hold-back'; name: string; note: string; kind: 'hold-back' }
  | { id: 'keep-logins'; name: string; note: string; kind: 'keep-logins' }
  | { id: 'always'; name: string; note: string; kind: 'always' }
  | { id: 'diagnostics'; name: string; note: string; kind: 'diagnostics' }
  | { id: 'storage'; name: string; note: string; kind: 'storage' }
  | { id: SettingsLink; name: string; note: string; kind: 'go' };

/** Named bands, so a wide window has something to lay out. The theme picker
 *  carries no rows: the group is the control. */
const GROUPS: readonly { id: string; title: string; rows: readonly Row[] }[] = [
  {
    id: 'project',
    title: 'This project',
    rows: [
      {
        id: 'hold-back',
        name: 'Check new work first',
        note: 'Where there is something to look at, changes are made in a copy and shown to you before anything reaches your files. Everywhere else a save point goes down before the work starts. Off, your files change as the work happens and every moment is one press from undone.',
        kind: 'hold-back',
      },
      {
        id: 'always',
        name: 'Things this project always does',
        note: 'Commands that run without being asked: format what was written, run the tests. One file, kept with the project.',
        kind: 'always',
      },
      {
        id: 'keep-logins',
        name: 'Stay signed in while I browse',
        note: 'The browser I open pages in keeps what it is signed in to, so a site you sign into once stays signed in for this project. Off, every page opens in a browser that has never been anywhere. Turning it off again forgets what was kept.',
        kind: 'keep-logins',
      },
    ],
  },
  {
    id: 'seeing',
    title: 'What you see',
    rows: [
      {
        id: 'show-me',
        name: 'Show me the real thing',
        note: 'Commands, paths and model names under the plain sentences.',
        kind: 'show-me',
      },
      {
        id: 'files',
        name: 'Everything in this project',
        note: 'The folder as a tree you can walk, beside the conversation.',
        kind: 'files',
      },
    ],
  },
  {
    id: 'elsewhere',
    title: 'Open elsewhere',
    rows: [
      {
        id: 'folder',
        name: 'Reveal the folder',
        note: 'Open it where this computer keeps files.',
        kind: 'go',
      },
      {
        id: 'editor',
        name: 'Open in your editor',
        note: 'Hand the project to the place you already write code.',
        kind: 'go',
      },
    ],
  },
  {
    id: 'app',
    title: 'This app',
    rows: [
      {
        id: 'diagnostics',
        name: 'Copy diagnostics',
        note: 'Everything worth sending when something goes wrong: the version, this machine, the add-ons, the last lines of the log and why the last job stopped. No conversations and no keys.',
        kind: 'diagnostics',
      },
      {
        id: 'storage',
        name: 'Clear finished work',
        note: 'Copies of finished conversations, board pieces already taken in, and old transcripts. Nothing holding work you have not taken in is ever cleared.',
        kind: 'storage',
      },
    ],
  },
  { id: 'theme', title: THEME_WORDS.name, rows: [] },
  { id: 'appearance', title: 'Make it yours', rows: [] },
];

/**
 * The quieter controls, in one place.
 *
 * Things somebody reaches for a few times a week, not every message — skills,
 * spend, whether the machinery is named. They used to be buttons competing
 * with the work; here they sit behind one word and leave the shelf alone.
 */
export default function Settings({
  open,
  onClose,
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
}: Props) {
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

  if (!open) return null;

  /* Following the computer still lands somewhere; this is where. Read at the
     render of the sheet — it is open for seconds, not for ever. */
  const onScreen = showing('system', window.matchMedia('(prefers-color-scheme: dark)').matches);
  const onScreenName = onScreen === 'dark' ? THEME_WORDS.graphe : THEME_WORDS[onScreen];

  const row = (one: Row) => {
    const text = (
      <span className="settings__text">
        <span className="settings__name">{one.name}</span>
        <span className="settings__note">{one.note}</span>
      </span>
    );

    if (one.kind === 'diagnostics') {
      return (
        <li key={one.id}>
          <button
            type="button"
            className="settings__row"
            onClick={() => onCopyDiagnostics?.()}
            disabled={onCopyDiagnostics === undefined}
          >
            {text}
            <span className="settings__meta">{version === undefined ? '' : version}</span>
          </button>
        </li>
      );
    }

    if (one.kind === 'storage') {
      return (
        <li key={one.id}>
          <button
            type="button"
            className="settings__row"
            onClick={() => onClearFinishedWork?.()}
            disabled={onClearFinishedWork === undefined || (storage?.couldClear ?? 0) === 0}
          >
            <span className="settings__text">
              <span className="settings__name">{one.name}</span>
              <span className="settings__note">
                {storage === null ? one.note : `${storage.says} ${storage.because}`}
              </span>
            </span>
            <span className="settings__meta">
              {storage === null || storage.couldClear === 0
                ? 'Nothing to clear'
                : `${String(storage.couldClear)} to clear`}
            </span>
          </button>
        </li>
      );
    }

    if (one.kind === 'always') {
      return (
        <li key={one.id}>
          <button type="button" className="settings__row" onClick={() => onGo('always')}>
            {text}
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
    }

    if (one.kind === 'go') {
      return (
        <li key={one.id}>
          <button
            type="button"
            className="settings__row"
            onClick={() => {
              onGo(one.id);
              onClose();
            }}
          >
            {text}
            <span className="settings__chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      );
    }

    const switches = {
      'show-me': { on: showMe, change: onToggleShowMe },
      files: { on: showFiles, change: onToggleShowFiles },
      'hold-back': { on: holdBack, change: onToggleHoldBack },
      'keep-logins': { on: keepLogins, change: onToggleKeepLogins },
    } as const;
    const flip = switches[one.kind];
    return (
      <li key={one.id}>
        <label className="settings__row settings__row--switch">
          {text}
          <Switch on={flip.on} onChange={flip.change} label={one.name} />
        </label>
      </li>
    );
  };

  return (
    <section className="settings" aria-label="Settings" role="dialog" aria-modal="true">
      <header className="settings__top">
        <div className="settings__topinner">
          <div>
            <p className="settings__eyebrow">Graphe</p>
            <h1>Settings</h1>
            <p>Things you change once in a while, not every message.</p>
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
          <nav className="settings__places" aria-label="Screens">
            {PLACES.map((one) => (
              <button
                key={one.id}
                type="button"
                className="settings__place"
                onClick={() => {
                  onGo(one.id);
                  onClose();
                }}
              >
                <span className="settings__placetop">
                  <span className="settings__name">{one.name}</span>
                  <span className="settings__chev" aria-hidden="true">
                    ›
                  </span>
                </span>
                <span className="settings__note">{one.note}</span>
              </button>
            ))}
          </nav>

          <div className="settings__grid">
            {GROUPS.map((group) =>
              group.id === 'theme' ? (
                <section key={group.id} className="settings__group settings__group--theme">
                  <h2 className="settings__grouptitle">{group.title}</h2>
                  <div className="settings__theme-wrap">
                    <p className="settings__note">{THEME_WORDS.note}</p>
                    <span className="settings__themes" role="group" aria-label={group.title}>
                      {THEMES.map((pick) => (
                        <button
                          key={pick.id}
                          type="button"
                          className={`settings__theme ${theme === pick.id ? 'settings__theme--on' : ''}`}
                          aria-pressed={theme === pick.id}
                          onClick={() => onTheme(pick.id)}
                          title={pick.label}
                        >
                          <span
                            className="settings__thumb"
                            aria-hidden="true"
                            style={
                              {
                                background: pick.preview.bg,
                                borderColor: pick.preview.border,
                                ['--thumb-accent' as string]: pick.preview.accent,
                                ['--thumb-text' as string]: pick.preview.text,
                              } as React.CSSProperties
                            }
                          >
                            <span className="settings__thumb-raised" style={{ background: pick.preview.raised, borderColor: pick.preview.border }} />
                            <span className="settings__thumb-dot" style={{ background: pick.preview.accent }} />
                            <span className="settings__thumb-line" style={{ background: pick.preview.text }} />
                            <span className="settings__thumb-line settings__thumb-line--muted" style={{ background: pick.preview.text }} />
                          </span>
                          <span className="settings__theme-label">{pick.label}</span>
                        </button>
                      ))}
                    </span>
                    <div className="settings__theme-foot">
                      <button
                        type="button"
                        className={`settings__system ${theme === 'system' ? 'settings__system--on' : ''}`}
                        aria-pressed={theme === 'system'}
                        onClick={() => onTheme('system')}
                      >
                        {THEME_WORDS.system}
                      </button>
                      {theme === 'system' ? (
                        /* Saying which palette the computer picked spares the
                           reader five thumbnails and a guess about what they
                           are actually looking at. */
                        <p className="settings__system-note">{onScreenName} right now.</p>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : (
                <section key={group.id} className={`settings__group settings__group--${group.id}`}>
                  <h2 className="settings__grouptitle">{group.title}</h2>
                  <ul className="settings__rows">{group.rows.map(row)}</ul>
                  {/* What this machine will do at once, worked out from the
                      machine rather than written down. Quiet, under the rows it
                      explains — a technical user goes looking for it, and
                      nobody else has to read it. */}
                  {group.id === 'app' && caps !== undefined ? (
                    <p className="settings__machine">{caps}</p>
                  ) : null}
                  {group.id === 'appearance' && appearance !== undefined && onAppearance !== undefined ? (
                    <>
                      <AppearanceBand
                        appearance={appearance}
                        onChange={onAppearance}
                        on={showingDark ? 'dark' : 'light'}
                      />
                      {ownStyles === undefined || ownStyles === '' ? null : (
                        <p className="settings__machine">
                          Write your own tokens in <code>{ownStyles}</code>. It loads last, so it
                          wins.{' '}
                          {onReloadStyles === undefined ? null : (
                            <button
                              type="button"
                              className="settings__inline"
                              onClick={onReloadStyles}
                            >
                              Read it again
                            </button>
                          )}
                        </p>
                      )}
                    </>
                  ) : null}
                </section>
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
