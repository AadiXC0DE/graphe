// Starts Vite in the background, fully detached, and returns immediately.
//
//   node scripts/dev-daemon.mjs [--gallery]
//
// `npm run dev` starts a server that never exits, which is fine in a terminal
// you own but fatal under an agent's shell: the tool waits for the command to
// finish, the command never does, and the whole run hangs until somebody kills
// it. This is the version that knows it is being run _to_ do something — it
// starts the server, writes a pid file, then hands control straight back so a
// script can take screenshots or curl a page and finish for real.
//
// If something is already answering on the port, it uses that instead of
// starting a second Vite (strictPort would refuse anyway). A server somebody
// is already running is never taken down by whoever happened to need it.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const PORT = 5273;
const PID_FILE = fileURLToPath(new URL('../dist/.dev-server.pid', import.meta.url));
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Both loopback addresses, because Vite binds to whichever `localhost`
 *  resolves to on the machine — on macOS that is ::1, and a check that only
 *  tries 127.0.0.1 reports the port free and then fails to bind it. */
const LOOPBACK = ['::1', '127.0.0.1'];

function listening(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const answer = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => answer(true));
    socket.once('error', () => answer(false));
    socket.setTimeout(800, () => answer(false));
  });
}

async function alreadyServing() {
  const answers = await Promise.all(LOOPBACK.map((host) => listening(host, PORT)));
  return answers.includes(true);
}

if (await alreadyServing()) {
  console.log(`something is already serving http://localhost:${PORT} — using that`);
} else {
  const args = [VITE, '--port', String(PORT), '--strictPort'];
  if (process.argv.includes('--gallery')) args.push('--open');
  // detached + ignore: the launch command returns the moment the child is up,
  // and closing this shell cannot take the server down with it.
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  writeFileSync(PID_FILE, `${child.pid}\n`);
  console.log(`dev server starting — pid ${child.pid}`);
}

process.exit(0);
