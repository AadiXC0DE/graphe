import { Component, type ErrorInfo, type ReactNode } from 'react';

import './ErrorBoundary.css';

/** The card's words, in one place so a test and the window read the same ones. */
export const boundaryWords = {
  what: (where: string) => `Something went wrong in ${where}. Here is what to send me.`,
  copy: 'Copy diagnostics',
  copied: 'Copied',
  noMessage: 'No message came with it.',
};

/** What the Copy button puts on the clipboard: the same shape the Help menu's
 *  diagnostics bundle uses, so both can be read the same way. Never the words
 *  of the conversation — where it broke, and what it said. */
export function boundaryReport(
  where: string,
  message: string,
  componentStack: string,
  at: number,
): string {
  return [
    'Graphe: something went wrong',
    `when: ${new Date(at).toISOString()}`,
    `where: ${where}`,
    `what: ${message}`,
    componentStack.trim() === '' ? '' : `in:${componentStack.replace(/\n+$/, '')}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

type Props = {
  /** The part of the app this wraps, named as a person would name it: "the
   *  conversation", "the design view". */
  what: string;
  children: ReactNode;
  onCaught?: (e: Error, info: string) => void;
};

type State = { message: string | null; stack: string; at: number; copied: boolean };

/**
 * One thrown render, held here instead of turning the window white.
 *
 * A boundary goes around the app and around each large view, so a view that
 * falls over takes only itself down and everything else stays usable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null, stack: '', at: 0, copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : String(error);
    return { message: message.trim() === '' ? boundaryWords.noMessage : message, at: Date.now() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' });
    this.props.onCaught?.(error, info.componentStack ?? '');
  }

  private copy = (): void => {
    const text = boundaryReport(
      this.props.what,
      this.state.message ?? '',
      this.state.stack,
      this.state.at,
    );
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    this.setState({ copied: true });
  };

  render(): ReactNode {
    const { message, copied } = this.state;
    if (message === null) return this.props.children;

    return (
      <section className="boundary" role="alert">
        <p className="boundary__what">{boundaryWords.what(this.props.what)}</p>
        <pre className="boundary__message scroll--auto">{message}</pre>
        <button type="button" className="boundary__copy" onClick={this.copy}>
          {copied ? boundaryWords.copied : boundaryWords.copy}
        </button>
      </section>
    );
  }
}
