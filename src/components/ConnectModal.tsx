import { useEffect, useMemo, useState } from 'react';
import type {
  ConnectStep,
  ConnectionState,
  FoundAccount,
  ModelChoice,
  ProviderMethod,
} from '../lib/ipc';
import { connectBilling } from '../cost/phrasing';
import './ConnectModal.css';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Look for models added since this opened. Left off, the control is not
   *  shown at all — the picker can be looked at on its own. */
  onRefresh?: () => void | Promise<void>;
  /** The whole state of "who can think for me", or null while the first
   *  answer is on its way. */
  state: ConnectionState | null;
  /** The step the connection in progress is on, or null when it is not. */
  step: ConnectStep | null;
  /** True while a connection is happening. */
  busy: boolean;
  /** What the last attempt said when it failed, or null. */
  failure: string | null;
  /** The accounts opencode and Codex have saved on this computer, offered at
   *  the top so nothing has to be pasted twice. */
  discovered: readonly FoundAccount[];
  /** The account being brought over right now, or null. */
  importing: FoundAccount | null;
  onConnect: (providerId: string, method: ProviderMethod) => void;
  onAnswer: (promptId: string, value: string | null) => void;
  onCancel: () => void;
  onImport: (account: FoundAccount) => void;
  onSelect: (choice: ModelChoice) => void;
  onDisconnect: (providerId: string) => void;
};

/**
 * The connect screen: who can think for this computer.
 *
 * It used to draw every provider with every one of its models open, which is
 * some sixty rows before the one you wanted — so the screen that exists to make
 * connecting easy was mostly scrolling. Now it is a list of accounts: one row
 * each, searchable, connected ones first, and the models folded away under the
 * provider they belong to. Day to day the models are not reached from here at
 * all — the chip beside the composer does that — so this screen is free to be
 * about the thing it is named after.
 *
 * Connecting is a conversation of its own. A provider can ask for a key, a
 * pasted redirect address, or the code it printed on its own site; each of
 * those arrives as a `step`, and each answer goes back through `onAnswer`.
 */
export default function ConnectModal({
  open,
  onClose,
  state,
  step,
  busy,
  failure,
  discovered,
  importing,
  onConnect,
  onAnswer,
  onCancel,
  onImport,
  onSelect,
  onDisconnect,
  onRefresh,
}: Props) {
  /** Whether a look-again is in flight. Only ever this screen's own state. */
  const [refreshing, setRefreshing] = useState(false);
  // A connection that was on its way out of this screen — the last answer the
  // window got back from the shell — is a thing to mention, not to hide: the
  // sentence below the providers says whether it worked or why it stopped.
  const [outcome, setOutcome] = useState<string | null>(null);
  /** What has been typed into the filter, and which providers have been opened
   *  by hand. Both are cleared each time the screen opens. */
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setQuery('');
    setOpened(new Set());
  }, [open]);

  const connected = (state?.providers ?? []).some((one) => one.connected);

  /* Connected first — the accounts you have are what this screen is usually
     about, and hunting for them in an alphabetical list of forty is the thing
     that made it unusable. Otherwise the shell's own order is kept. */
  const providers = useMemo(() => {
    const all = [...(state?.providers ?? [])];
    const needle = query.trim().toLowerCase();
    const matching =
      needle === ''
        ? all
        : all.filter(
            (one) =>
              one.name.toLowerCase().includes(needle) ||
              one.models.some((model) => model.label.toLowerCase().includes(needle)),
          );
    return matching.sort((a, b) => Number(b.connected) - Number(a.connected));
  }, [state, query]);

  if (!open) return null;

  const showFailure = failure ?? outcome;
  const searching = query.trim() !== '';

  return (
    <div className="connectmodal" role="dialog" aria-modal="true" aria-label="Connect a model">
      <button type="button" className="connectmodal__backdrop" onClick={() => (busy ? onCancel() : onClose())} aria-label="Close" tabIndex={-1} />

      <div className="connectmodal__panel">
        <header className="connectmodal__head">
          <div className="connectmodal__titlewrap">
            <h2 className="connectmodal__title">Choose a model</h2>
            <p className="connectmodal__sub">
              One account, or a key from a service you already pay for. Open any
              of them to see its models, or change model later from the chip
              beside the box you type in.
            </p>
          </div>
          {/* Models arrive from outside this app — pi's own catalogue refresh,
              another tool writing the same list. Without this the app has to be
              restarted before a new one appears, and nobody would guess that. */}
          {onRefresh === undefined ? null : (
            <button
              type="button"
              className="connectmodal__refresh"
              onClick={() => {
                if (refreshing) return;
                setRefreshing(true);
                void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
              title="Look for models added since this opened"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          <button type="button" className="connectmodal__close" onClick={() => (busy ? onCancel() : onClose())} aria-label="Close">
            <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Before the click, not after the first bill. Losing a few sign-ups
            here is enormously cheaper than losing trust later. */}
        <section className="connectmodal__billing">
          <h3 className="connectmodal__billingtitle">{connectBilling.title}</h3>
          <p className="connectmodal__billingbody">{connectBilling.body}</p>
          <p className="connectmodal__billingnote">{connectBilling.reassurance}</p>
        </section>

        {busy ? <StepLine step={step ?? null} onAnswer={onAnswer} /> : null}

        {state === null || state.providers.length <= 6 ? null : (
          <div className="connectmodal__filter">
            <input
              className="connectmodal__filterfield"
              type="text"
              value={query}
              placeholder="Search providers and models"
              aria-label="Search providers and models"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}

        <div className="connectmodal__body scroll--auto">
          {discovered.length > 0 ? (
            <section className="connectmodal__found" aria-label="Accounts already saved by other tools">
              <h3 className="connectmodal__foundsub">Already on this computer</h3>
              {discovered.map((account) => {
                const isImporting =
                  importing !== null &&
                  importing.providerId === account.providerId &&
                  importing.source === account.source &&
                  importing.kind === account.kind;
                return (
                  <div className="connectmodal__foundrow" key={`${account.providerId}-${account.source}-${account.kind}`}>
                    <div className="connectmodal__foundtext">
                      <span className="connectmodal__foundname">{account.name}</span>
                      <span className="connectmodal__foundsource">{foundSentence(account)}</span>
                    </div>
                    <button
                      type="button"
                      className="connectmodal__action"
                      onClick={() => onImport(account)}
                      disabled={busy || importing !== null}
                    >
                      {isImporting ? 'Bringing it over…' : 'Use this one'}
                    </button>
                  </div>
                );
              })}
            </section>
          ) : null}

          {state === null ? (
            <p className="connectmodal__loading">Looking at what’s already on this computer…</p>
          ) : providers.length === 0 ? (
            <p className="connectmodal__loading">Nothing here matches that.</p>
          ) : (
            providers.map((provider) => {
              /* Open when you are searching (you are looking for a model, and a
                 fold you have to click is a fold in the way), when you opened it
                 yourself, or when it is connected and nothing is chosen from it
                 yet — that last one being the first-run moment where picking a
                 model is the whole point. */
              const isOpen =
                searching ||
                opened.has(provider.providerId) ||
                (provider.connected && state.chosen?.providerId !== provider.providerId);
              const usable = provider.models.filter((model) => model.available).length;
              return (
                <section className="connectmodal__provider" key={provider.providerId}>
                  <button
                    type="button"
                    className="connectmodal__providerhead"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpened((was) => {
                        const next = new Set(was);
                        if (isOpen) next.delete(provider.providerId);
                        else next.add(provider.providerId);
                        return next;
                      })
                    }
                  >
                    <span className={`connectmodal__chevron ${isOpen ? 'connectmodal__chevron--open' : ''}`} aria-hidden="true">
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <h3 className="connectmodal__providername">{provider.name}</h3>
                    <span className={`connectmodal__state ${provider.connected ? 'connectmodal__state--on' : ''}`}>
                      {provider.connected
                        ? `connected · ${usable} ready`
                        : `${provider.models.length} models`}
                    </span>
                  </button>

                  {provider.connected ? (
                    <div className="connectmodal__connectrow">
                      <span className="connectmodal__check" aria-hidden="true">
                        <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                          <path d="M2 6l3 3 5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="connectmodal__checklabel">Working on this machine</span>
                      <button
                        type="button"
                        className="connectmodal__disconnect"
                        onClick={() => onDisconnect(provider.providerId)}
                        disabled={busy}
                      >
                        Forget
                      </button>
                    </div>
                  ) : (
                    <div className="connectmodal__connectrow">
                      {provider.methods.map((method) => (
                        <span key={method} className="connectmodal__way">
                          <button
                            type="button"
                            className="connectmodal__action"
                            onClick={() => onConnect(provider.providerId, method)}
                            disabled={busy}
                          >
                            {method === 'oauth'
                              ? (provider.oauthLabel ?? `Sign in with ${provider.name}`)
                              : /* The provider's own wording when it has one — the
                                   thing you go and fetch is called an API key on
                                   their site, and renaming it here would only make
                                   it harder to find. Ours is the fallback, and it
                                   says what you do rather than what it is. */
                                (provider.apiKeyLabel ?? `Paste a key from ${provider.name}`)}
                          </button>
                          {/* The difference between the two, where the choice is
                              actually made. */}
                          <span className="connectmodal__how">
                            {method === 'oauth' ? connectBilling.signIn : connectBilling.apiKey}
                          </span>
                        </span>
                      ))}
                      {provider.methods.length === 0 ? (
                        <span className="connectmodal__emptymethods">
                          This provider cannot be signed in to from here.
                        </span>
                      ) : null}
                    </div>
                  )}

                  {!isOpen ? null : (
                  <ul className="connectmodal__models">
                    {modelsToShow(provider.models, query).map((model) => {
                      const isChosen =
                        state.chosen !== null &&
                        state.chosen.providerId === provider.providerId &&
                        state.chosen.modelId === model.id;
                      return (
                        <li key={model.id}>
                          <button
                            type="button"
                            className={`connectmodal__model ${isChosen ? 'connectmodal__model--chosen' : ''} ${model.available || isChosen ? '' : 'connectmodal__model--off'}`}
                            onClick={() => onSelect({ providerId: provider.providerId, modelId: model.id })}
                            disabled={!model.available && !isChosen}
                            aria-checked={isChosen}
                          >
                            <span className="connectmodal__dot" aria-hidden="true" />
                            <span className="connectmodal__modellabel">{model.label}</span>
                            {isChosen ? (
                              <span className="connectmodal__now">now working with this</span>
                            ) : model.available ? (
                              <span className="connectmodal__ready">available</span>
                            ) : (
                              <span className="connectmodal__locked">
                                {provider.connected ? 'needs this account' : 'connect to unlock'}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                </section>
              );
            })
          )}
        </div>

        {showFailure === null ? null : (
          <p className="connectmodal__failure" role="alert">
            {showFailure}
          </p>
        )}

        <footer className="connectmodal__foot">
          {busy ? (
            <button type="button" className="connectmodal__cancel" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <span className="connectmodal__hint">
              You can get back here from the menu under your project’s name.
            </span>
          )}
          {connected ? null : (
            <span className="connectmodal__fineprint">
              Nothing connected yet. This window stays up until one is.
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

/** One moment of connecting, drawn the way the shell reported it. A progress
 *  sentence, a browser it has opened, a code it printed, or a question that
 *  needs an answer in the box below it. */
function StepLine({
  step,
  onAnswer,
}: {
  step: ConnectStep | null;
  onAnswer: (promptId: string, value: string | null) => void;
}) {
  if (step === null) {
    return (
      <div className="connectmodal__step">
        <span className="connectmodal__spin" aria-hidden="true" />
        <span className="connectmodal__stepmessage">Talking to the provider…</span>
      </div>
    );
  }

  if (step.type === 'progress') {
    return (
      <div className="connectmodal__step">
        <span className="connectmodal__spin" aria-hidden="true" />
        <span className="connectmodal__stepmessage">{step.message}</span>
      </div>
    );
  }

  if (step.type === 'auth-url') {
    const host = hostOf(step.url);
    return (
      <div className="connectmodal__step">
        <p className="connectmodal__stepmessage">
          I opened your browser{host === null ? '' : <> for <span className="connectmodal__host">{host}</span></>}. Sign in
          there. This window will notice when you’re done. If it doesn’t, paste
          the address you end up on into the box that appears.
        </p>
      </div>
    );
  }

  if (step.type === 'device-code') {
    return (
      <div className="connectmodal__step">
        <p className="connectmodal__stepmessage">
          This provider wants a code. It should have opened its site. Enter
          this there:
        </p>
        <code className="connectmodal__usercode">{step.userCode}</code>
      </div>
    );
  }

  // A question. The one answer that can come back as a paste is the address a
  // login redirect landed on; the one that must never show itself is a key.
  return (
    <div className="connectmodal__prompt">
      <p className="connectmodal__stepmessage">{step.message}</p>
      {step.kind === 'select' ? (
        <div className="connectmodal__select">
          {(step.options ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              className="connectmodal__selectoption"
              onClick={() => onAnswer(step.promptId, option.id)}
            >
              {option.label}
            </button>
          ))}
          <button type="button" className="connectmodal__selectoption connectmodal__selectoption--bare" onClick={() => onAnswer(step.promptId, null)}>
            Cancel
          </button>
        </div>
      ) : (
        <PromptField step={step} onAnswer={onAnswer} />
      )}
    </div>
  );
}

function PromptField({
  step,
  onAnswer,
}: {
  step: Extract<ConnectStep, { type: 'prompt' }>;
  onAnswer: (promptId: string, value: string | null) => void;
}) {
  const [value, setValue] = useState('');
  useEffect(() => setValue(''), [step.promptId]);

  return (
    <form
      className="connectmodal__promptform"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() === '') return;
        onAnswer(step.promptId, value);
      }}
    >
      <input
        key={step.promptId}
        className="connectmodal__input"
        type={step.kind === 'secret' ? 'password' : 'text'}
        placeholder={step.placeholder}
        value={value}
        autoFocus
        autoComplete={step.kind === 'secret' ? 'off' : 'url'}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="connectmodal__promptrow">
        <button type="submit" className="connectmodal__send" disabled={value.trim() === ''}>
          {step.kind === 'manual_code' ? 'Take me back' : 'Connect'}
        </button>
        <button type="button" className="connectmodal__bare" onClick={() => onAnswer(step.promptId, null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** While searching, only the models that match — otherwise a provider matched by
 *  name opens onto sixty rows and the search has bought nothing. */
function modelsToShow(
  models: readonly { id: string; label: string; available: boolean }[],
  query: string,
): readonly { id: string; label: string; available: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return models;
  const matching = models.filter((model) => model.label.toLowerCase().includes(needle));
  return matching.length === 0 ? models : matching;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** The one sentence that says where an account came from, and what kind of
 *  promise it is: a key somebody pasted, or a sign-in another tool made. */
function foundSentence(account: FoundAccount): string {
  const tool = account.source === 'codex' ? 'Codex' : 'opencode';
  return account.kind === 'api-key'
    ? `The ${account.name} key you saved in ${tool}.`
    : `Your ${account.name} sign-in, saved by ${tool}.`;
}