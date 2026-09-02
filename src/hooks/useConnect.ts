/**
 * Who can think for you, and the screen where that is settled.
 *
 * The shell owns the truth about accounts and models; the window's job is to
 * draw it and never to remember it, so every one of these answers with the
 * whole state and nothing here works out what its own press did.
 *
 * It also holds the folder somebody asked for and could not have because
 * nothing was connected yet. Without that, connecting an account left the
 * folder shut and the next sentence went to a window with no session behind it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { bridge } from '../lib/bridge';
import type {
  ConnectStep,
  ConnectionState,
  FoundAccount,
  ProviderMethod,
} from '../lib/ipc';

export type Connect = {
  /** Whether the screen is up. */
  open: boolean;
  state: ConnectionState | null;
  /** The step the connection in progress is on, or null when it is not. */
  step: ConnectStep | null;
  busy: boolean;
  /** What the last attempt said when it failed, or null. */
  failure: string | null;
  /** The accounts opencode and Codex have saved on this computer. */
  discovered: readonly FoundAccount[];
  /** The account being brought over right now, or null. */
  importing: FoundAccount | null;
  /** The current `open`, reachable from the callbacks declared above it. */
  opens: MutableRefObject<((path: string) => Promise<void>) | null>;
  setState: Dispatch<SetStateAction<ConnectionState | null>>;
  refresh(fresh?: boolean): Promise<void>;
  show(): void;
  close(): void;
  start(providerId: string, method: ProviderMethod): void;
  answer(promptId: string, value: string | null): void;
  cancel(): void;
  bringOver(account: FoundAccount): void;
  forget(providerId: string): void;
  /** A connect failure belongs on this screen rather than in whatever
   *  conversation the window happened to be having. */
  troubled(because: string): void;
  /** Hold the folder that could not open, and finish it once an account is in. */
  waitFor(path: string): void;
  /** The screen has done its job for this folder, so it gets out of the way. */
  arrived(path: string): void;
  resume(): void;
};

export function useConnect(): Connect {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [step, setStep] = useState<ConnectStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<readonly FoundAccount[]>([]);
  const [importing, setImporting] = useState<FoundAccount | null>(null);

  const waiting = useRef<string | null>(null);
  const opens = useRef<((path: string) => Promise<void>) | null>(null);

  /** Connecting finished, so finish what the person was actually doing. */
  const resume = useCallback(() => {
    const path = waiting.current;
    if (path === null) return;
    void opens.current?.(path);
  }, []);

  /** Ask the shell for the whole state of "who can think for me". Rebuilt
   *  after every connect, disconnect and model choice — the shell owns the
   *  truth, and the window's job is to draw it, not to remember it. */
  const refresh = useCallback((fresh = false) => {
    return bridge.connection(fresh).then((answer) => {
      if (answer.ok) setState(answer.value);
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Follow along while a connection happens. Each step is one moment of the
   *  provider's sign-in — a browser it opened, a question it asked. The step
   *  is kept for as long as the modal is up and then let go. */
  useEffect(() => bridge.onConnectStep((next) => { setStep(next); }), []);

  const show = useCallback(() => {
    setFailure(null);
    setStep(null);
    setOpen(true);
    void refresh();
    void bridge.discoveredAccounts().then((answer) => {
      if (answer.ok) setDiscovered(answer.value);
    });
  }, [refresh]);

  /** Bring an account opencode or Codex saved over into this app's own store.
   *  The shell does the moving; here is only the waiting and the telling. */
  const bringOver = useCallback(
    (account: FoundAccount) => {
      setImporting(account);
      void bridge.importAccount(account).then((answer) => {
        setImporting(null);
        if (!answer.ok) {
          setFailure(answer.trouble.because);
          return;
        }
        setFailure(null);
        void refresh();
        void bridge.discoveredAccounts().then((found) => {
          if (found.ok) setDiscovered(found.value);
        });
        resume();
      });
    },
    [refresh, resume],
  );

  const close = useCallback(() => {
    if (busy) {
      void bridge.cancelConnect();
      setBusy(false);
    }
    setOpen(false);
    // Closing this screen is somebody saying they are done here. If they came
    // to it because a folder would not open, that folder is what they were
    // actually trying to do — so it opens now, without being asked for twice.
    resume();
  }, [busy, resume]);

  const start = useCallback(
    (providerId: string, method: ProviderMethod) => {
      setFailure(null);
      setStep(null);
      setBusy(true);
      void bridge.connect(providerId, method).then((answer) => {
        setBusy(false);
        if (!answer.ok) {
          setFailure(answer.trouble.because);
          return;
        }
        if (answer.value.kind === 'failed') {
          setFailure(answer.value.because);
          return;
        }
        setStep(null);
        void refresh();
        resume();
      });
    },
    [refresh, resume],
  );

  const answer = useCallback((promptId: string, value: string | null) => {
    void bridge.connectAnswer(promptId, value);
  }, []);

  const cancel = useCallback(() => {
    void bridge.cancelConnect();
    setBusy(false);
    setStep(null);
  }, []);

  const forget = useCallback(
    (providerId: string) => {
      void bridge.disconnect(providerId).then(() => {
        void refresh();
        // An account that was carried over and then forgotten is an account
        // the other tool still has — it belongs back in the found list.
        void bridge.discoveredAccounts().then((found) => {
          if (found.ok) setDiscovered(found.value);
        });
        setState((current) => {
          if (current === null) return current;
          return {
            ...current,
            providers: current.providers.map((provider) =>
              provider.providerId === providerId
                ? { ...provider, connected: false, available: false }
                : provider,
            ),
          };
        });
      });
    },
    [refresh],
  );

  const troubled = useCallback(
    (because: string) => {
      setOpen(true);
      setBusy(false);
      setStep(null);
      setFailure(because);
      void refresh();
    },
    [refresh],
  );

  const waitFor = useCallback((path: string) => {
    waiting.current = path;
  }, []);

  const arrived = useCallback((path: string) => {
    if (waiting.current !== path) return;
    waiting.current = null;
    setOpen(false);
  }, []);

  // Held still between renders: `troubleHere` lists it, and the whole window
  // hangs off that.
  return useMemo(() => ({
    open,
    state,
    step,
    busy,
    failure,
    discovered,
    importing,
    opens,
    setState,
    refresh,
    show,
    close,
    start,
    answer,
    cancel,
    bringOver,
    forget,
    troubled,
    waitFor,
    arrived,
    resume,
  }), [
    open, state, step, busy, failure, discovered, importing, refresh, show, close,
    start, answer, cancel, bringOver, forget, troubled, waitFor, arrived, resume,
  ]);
}
