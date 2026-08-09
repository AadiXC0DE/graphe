/** Which code editor is on this Mac, if any.
 *
 * BACKLOG D2, the escape hatch: **one click, always present.** A designer who
 * grows into this — or who has a developer beside them for ten minutes — must be
 * able to open the real folder in the real editor without asking us for
 * permission. The project is an ordinary folder in ordinary git
 * (notes/strategy/ARCHITECTURE.md), and a product that makes that hard is a
 * product that has quietly become a walled garden.
 *
 * ## Why bundles and not the PATH
 *
 * The obvious implementation is to look for `code` on the PATH. It is also
 * wrong here. An app launched from the Dock inherits `launchd`'s environment,
 * not the shell's — no `/usr/local/bin`, no `~/.local/bin`, none of what a
 * terminal would have. So `code` is missing on machines that plainly have VS
 * Code installed, and present on machines where the user removed the app and
 * left the shim behind.
 *
 * Looking for the application bundle answers the question actually being asked:
 * is this editor installed, and where. `open -a <bundle> <folder>` then works
 * whether or not the person ever ran "Install 'code' command in PATH".
 *
 * ## The order
 *
 * VS Code first because it is what the button is called in every conversation
 * about this feature, and because it is what most of this audience has if they
 * have anything. After that, the editors a designer is realistically handed by
 * a developer sitting next to them. Whatever is found first wins, and the button
 * takes that editor's name — "Open in Cursor" is a better button than "Open in
 * your editor", which sounds like we could not be bothered to look.
 */

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Editor = {
  /** What the button says. The editor's own name, spelled its own way. */
  name: string;
  /** Absolute path to the application bundle. */
  bundle: string;
};

/** Bundle names, in the order they are preferred. */
const KNOWN: readonly { name: string; bundle: string }[] = [
  { name: 'VS Code', bundle: 'Visual Studio Code.app' },
  { name: 'Cursor', bundle: 'Cursor.app' },
  { name: 'Windsurf', bundle: 'Windsurf.app' },
  { name: 'Zed', bundle: 'Zed.app' },
  { name: 'Sublime Text', bundle: 'Sublime Text.app' },
  { name: 'Nova', bundle: 'Nova.app' },
  { name: 'WebStorm', bundle: 'WebStorm.app' },
  { name: 'VSCodium', bundle: 'VSCodium.app' },
  { name: 'BBEdit', bundle: 'BBEdit.app' },
  { name: 'TextMate', bundle: 'TextMate.app' },
];

/** Everywhere macOS puts applications, including the two places people forget:
 *  a per-user Applications folder, and Setapp's. */
export function applicationFolders(home: string = homedir()): readonly string[] {
  return [
    '/Applications',
    join(home, 'Applications'),
    '/Applications/Setapp',
    join(home, 'Applications', 'Setapp'),
    '/System/Applications',
  ];
}

async function isThere(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first known editor installed on this machine, or null.
 *
 * `exists` is injectable so the search order can be tested without installing
 * ten editors, which is the only part of this with any logic in it.
 */
export async function findEditor(options: {
  folders?: readonly string[];
  exists?: (path: string) => Promise<boolean>;
} = {}): Promise<Editor | null> {
  const folders = options.folders ?? applicationFolders();
  const exists = options.exists ?? isThere;

  for (const editor of KNOWN) {
    for (const folder of folders) {
      const bundle = join(folder, editor.bundle);
      if (await exists(bundle)) return { name: editor.name, bundle };
    }
  }
  return null;
}

/** What the button says. Null means there is no editor to offer, and the
 *  interface shows only "Show the folder" — an honest absence rather than a
 *  button that opens nothing. */
export function openInLabel(editor: Editor | null): string | null {
  return editor === null ? null : `Open in ${editor.name}`;
}
