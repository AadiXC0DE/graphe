/** Navigating the page beside the conversation.
 *
 * 9.5 asks that context isolation, sandbox and the node-integration
 * restrictions hold, and that navigation and open-window permissions are tested
 * against hostile local pages. The rules that decide a preview page's *address*
 * are pure and are checked here; the restrictions themselves live in
 * `electron/main.ts` and are not reachable from a node test:
 *
 * - `guardNavigation` (:859) cancels any navigation that is not ours, hands
 *   `http(s)` window-open requests to the OS browser and denies window.open;
 *   it is attached to every web contents through `web-contents-created` (:12025).
 * - `makePageView` (:1008) builds the page view with `contextIsolation: true`,
 *   `nodeIntegration: false`, `sandbox: true`, `webviewTag: false` and a preload
 *   that exposes nothing (`electron/pagepreload.ts`).
 * - `applyContentPolicy` (:886) and `applyPermissionPolicy` (:923) are installed
 *   on `session.defaultSession` only. The page view runs in
 *   `persist:graphe-page` (:983), which has no permission handler of its own, and
 *   `applyContentPolicy` returns early outside a packaged build.
 *
 * Those three need a real Electron process with a real page; the only harness
 * that boots the shipped shell is `tests/electron/smoke.test.ts`
 * (`npm run test:electron`), and it does not cover them today. What is provable
 * offline is the address rule below, and what a page can carry into the app.
 */

import { describe, expect, it } from 'vitest';

import { asAddress, shortAddress } from '../../src/preview/tabs';

/* ========================================================================== */

describe('what the pane will go to', () => {
  it('is a web address', () => {
    expect(asAddress('localhost:3000')).toBe('http://localhost:3000');
    expect(asAddress(':5173')).toBe('http://localhost:5173');
    expect(asAddress('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(asAddress('staging.example.com')).toBe('https://staging.example.com');
    expect(asAddress('https://example.test/a/b')).toBe('https://example.test/a/b');
  });

  it('is nothing when what was typed is not one', () => {
    for (const typed of ['javascript:alert(document.cookie)', 'vbscript:msgbox(1)', 'data:text/html,<script>1</script>', 'about:blank', 'look at my page', '']) {
      expect(asAddress(typed), typed).toBeNull();
    }
  });

  it('drops the scheme when it reads it back', () => {
    expect(shortAddress('https://example.test/')).toBe('example.test');
  });

  /* `asAddress` allows http and https and nothing else, and `pageAt`
     (electron/main.ts) asks the same rule at the one place that would hand an
     address to `loadURL` — the window's address bar hands over what somebody
     typed, so `file:///etc/passwd` is not a page the pane will open. */
  it('refuses a local file as a page', () => {
    expect(asAddress('file:///etc/passwd')).toBeNull();
    // The other schemes that look like addresses, for the same reason.
    expect(asAddress('chrome://settings')).toBeNull();
    expect(asAddress('ftp://example.test/pub')).toBeNull();
  });
});
