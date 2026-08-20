/** What a command that starts a server looks like.
 *
 * Its own file with nothing imported, because two very different places need
 * the same answer: the boundary, which cannot let one listen inside a sandbox,
 * and the Guard, which should not interrogate somebody about `npm run dev`.
 * The Guard is reached from the window, so it cannot import anything that
 * touches a disk — which is the whole reason this is not in `shell.ts`.
 */

const ENDS = '(?![\\w-])';

const SERVER_COMMANDS = [
  // Whatever the project calls its own.
  new RegExp(`^(?:npm|pnpm)\\s+run\\s+(?:dev|serve|start|preview)${ENDS}`),
  new RegExp(`^(?:npm|pnpm|yarn|bun)\\s+(?:dev|serve|start|preview)${ENDS}`),
  // A folder of files, served as they are.
  new RegExp(`^(?:python3?|py)\\s+-m\\s+(?:http\\.server|SimpleHTTPServer)${ENDS}`),
  new RegExp(`^php\\s+-S${ENDS}`),
  new RegExp(`^ruby\\s+-run\\s+-e\\s+httpd${ENDS}`),
  new RegExp(`^busybox\\s+httpd${ENDS}`),
  // The usual ones, run directly or fetched by npx.
  new RegExp(
    `^(?:npx\\s+(?:-y\\s+)?)?(?:serve|http-server|live-server|vite|nodemon|browser-sync|miniserve|caddy)${ENDS}`,
  ),
  new RegExp(
    `^(?:npx\\s+(?:-y\\s+)?)?(?:next|nuxt|astro|remix|svelte-kit|gatsby|ng|expo)\\s+(?:dev|start|serve)${ENDS}`,
  ),
  new RegExp(`^(?:npx\\s+(?:-y\\s+)?)?webpack(?:-dev-server)?\\s+serve${ENDS}`),
] as const;

/** One command out of a line of them, with the wrappers people put round a
 *  server taken off: the brackets, the `nohup`, the trailing `&`. */
function bare(piece: string): string {
  return piece
    .trim()
    .replace(/^\(\s*/, '')
    .replace(/^nohup\s+/, '')
    .replace(/\s*&\s*$/, '')
    .trim();
}

/**
 * Does any part of this line start something that waits to be reached?
 *
 * Any part, not the first: `cd site && python3 -m http.server` is how anybody
 * would write it, and reading only the front of the line meant the one shape
 * people actually type was the one shape that went unrecognised.
 */
function startsAServer(line: string): boolean {
  for (const raw of line.split(/&&|\|\||;|\n/)) {
    // The head of a pipeline is the thing that runs; `| tee log` is not.
    const head = bare(raw.split('|')[0] ?? '');
    if (SERVER_COMMANDS.some((shape) => shape.test(head))) return true;
  }
  return false;
}

/** A foreground development server does useful work only after it has returned
 * its URL. Letting one occupy the agent's one command slot makes it look as if
 * the agent has frozen, and it prevents the next check from ever running. */
export function developmentServerCommand(command: string): string | null {
  const trimmed = command.trim();
  const grouped = /^\(\s*([\s\S]+?)\s*&\s*(?:echo\s+\$!|disown)?\s*\)$/.exec(trimmed)?.[1]?.trim();
  const whole = grouped ?? trimmed;
  const candidate =
    /^nohup\s+([\s\S]*?)\s*&?\s*$/.exec(whole)?.[1]?.trim() ?? whole.replace(/\s*&\s*$/, '');
  return startsAServer(candidate) ? candidate : null;
}
