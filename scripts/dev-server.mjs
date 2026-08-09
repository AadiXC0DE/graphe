// Starts Vite, unless one is already running.
//
//   node scripts/dev-server.mjs
//
// This exists for one reason: `npm run app` starts the dev server and the
// desktop shell together, and the dev server is pinned to port 5273 with
// strictPort, so a second one refuses to start. If you already have `npm run
// dev` open in another terminal — which is the normal way to work on the
// interface — `npm run app` would kill itself on startup and take the shell
// down with it. That is a confusing failure for something whose whole job is to
// open a window.
//
// So: if something is already answering on the port, use it and stay out of the
// way. The process stays alive doing nothing, because it is one half of a
// `concurrently` pair and exiting would end the other half.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const PORT = 5273;

/** Both loopback addresses, because Vite binds to whichever `localhost` resolves
 *  to on the machine — on macOS that is ::1, and a check that only tries
 *  127.0.0.1 cheerfully reports the port free and then fails to bind it. */
const LOOPBACK = ['::1', '127.0.0.1'];

/** Is anything listening? A connection that opens is enough — we do not care
 *  what it is, only that the port is not ours to take. */
function listening(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const answer = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => answer(true));
    socket.once('error', () => answer(false));
    socket.setTimeout(1000, () => answer(false));
  });
}

async function alreadyServing(port) {
  const answers = await Promise.all(LOOPBACK.map((host) => listening(host, port)));
  return answers.includes(true);
}

if (await alreadyServing(PORT)) {
  console.log(`something is already serving http://localhost:${PORT} — using that one`);
  // Hold the slot open for concurrently. Nothing to do until it stops us.
  process.stdin.resume();
} else {
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [vite], { stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    process.exit(signal === null ? (code ?? 0) : 0);
  });
}
