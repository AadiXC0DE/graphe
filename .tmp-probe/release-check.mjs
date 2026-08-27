import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const app = process.argv[2], port = process.argv[3];
const prof = `/tmp/rel-${port}`;
await rm(prof, { recursive: true, force: true }); await mkdir(prof, { recursive: true });
await writeFile(`${prof}/projects.json`, JSON.stringify({ version: 1, projects: [
  { path: '/Users/ownpathdesign/Desktop/graphe', name: 'graphe', lastOpened: 1756300000000 }] }) + '\n');
const t0 = Date.now();
const child = spawn(`${app}/Contents/MacOS/Graphe`, [`--user-data-dir=${prof}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
const ok = async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some((t) => t.url.includes('index.html')); } catch { return false; } };
while (!(await ok())) await new Promise((r) => setTimeout(r, 15));
const drawn = Date.now() - t0;
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const p = b.contexts()[0].pages().find((x) => x.url().includes('index.html'));
await p.waitForSelector('#root *'); await p.waitForTimeout(3500);
const r = await p.evaluate(() => ({
  chromium: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
  bridgeMethods: Object.keys(window.graphe ?? {}).length,
  copyConversationGone: typeof window.graphe?.copyConversation !== 'function',
  styleRules: [...document.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length } catch { return n } }, 0),
  firstScreen: /graphe/.test(document.getElementById('root').innerText) && !/What do you want to make/.test(document.getElementById('root').innerText) ? 'PROJECT PICKER' : 'other',
  theme: getComputedStyle(document.body).backgroundColor,
}));
console.log('launch -> window drawn:', drawn, 'ms');
console.log(JSON.stringify(r, null, 2));
await p.screenshot({ path: '/tmp/release-060.png' });
await b.close(); child.kill();
