/**
 * npm can unpack node-pty's prebuilt helper without its executable bit. The
 * packaged hook repairs the copy inside the app bundle, while the unpackaged
 * Electron smoke job uses node_modules directly and needs the same repair.
 */

import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
if (!existsSync(root)) {
  console.log('node-pty prebuilds are not installed; terminal helper repair not needed');
  process.exit(0);
}

let repaired = 0;
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const helper = join(root, entry.name, 'spawn-helper');
  if (!existsSync(helper)) continue;
  chmodSync(helper, 0o755);
  repaired += 1;
}
console.log(`node-pty helper permissions restored (${String(repaired)} helper${repaired === 1 ? '' : 's'})`);
