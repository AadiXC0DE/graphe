/** What an add-on asks a person, and what the person answers.
 *
 * Dependency-free and Pi-free on purpose: the main process, the window and the
 * preload all pass these across the seam, and the renderer is not allowed to
 * know that Pi exists.
 */

/** Something an add-on wants a person to answer. */
export type ExtensionAsk =
  | {
      kind: 'select';
      title: string;
      options: readonly { label: string; value: string }[];
      /** What the extension said about expected delay, when it said anything. */
      timeoutMs: number | null;
    }
  | { kind: 'confirm'; title: string; message: string; timeoutMs: number | null }
  | { kind: 'input'; title: string; placeholder: string | null; timeoutMs: number | null }
  | { kind: 'editor'; title: string; prefill: string };

/** What came back. Cancelled is a real answer, and the only one that lets an
 *  add-on tell "nobody wanted this" from "the person said no". */
export type ExtensionAnswer =
  | { kind: 'select'; value: string | null }
  | { kind: 'confirm'; value: boolean }
  | { kind: 'input'; value: string | null }
  | { kind: 'editor'; value: string | null };
