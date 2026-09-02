import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const ROOT = '/Users/ownpathdesign/Desktop/graphe/site'
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.svg':'image/svg+xml' }
const srv = createServer((req,res)=>{
  let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]))
  if (p.endsWith('/')) p += 'index.html'
  if (!existsSync(p)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, {'content-type': TYPES[extname(p)] ?? 'application/octet-stream'})
  res.end(readFileSync(p))
})
await new Promise(r => srv.listen(5288, r))
const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
await pg.goto('http://localhost:5288/', { waitUntil: 'networkidle' })
await pg.evaluate(() => document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-in')))
const out = '/private/tmp/claude-501/-Users-ownpathdesign-Desktop-graphe/d32e189e-7e19-400d-a308-1b72f5a660a7/scratchpad'
for (const [name, sel] of [['cards','#see'],['compares','#compares']]) {
  const el = await pg.$(sel)
  await el.scrollIntoViewIfNeeded()
  await pg.waitForTimeout(600)
  await el.screenshot({ path: `${out}/${name}.png` })
}
await b.close(); srv.close()
