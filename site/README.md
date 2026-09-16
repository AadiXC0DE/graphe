# site

The landing page. Plain HTML, CSS and one module of JavaScript: no build step, no
dependencies, no framework. Open `index.html` and it works.

```
site/
  index.html        the page
  styles.css        the whole design
  main.js           reveals, the window's tabs, the show-me switch, copy
  assets/
    fonts/          Satoshi, the same face the app wears
    shots/          2x captures, kept
    web/            what the page actually loads (WebP, resized)
  serve.mjs         a static server, for looking at it locally
  scripts/
    shots.mjs       captures the pictures from the running app
    optimise.mjs    turns the captures into what the page loads
    og.mjs          draws the 1200x630 card a share renders
```

## Looking at it

```
node site/serve.mjs
```

Then <http://localhost:4321>. Any static server will do; there is nothing to
compile, and nothing to install. `serve.mjs` is forty lines of `node:http`.

## The pictures

Every picture on the page is the real interface, never a mock-up. That is deliberate:
a landing page that draws its own version of the product is a landing page that can
lie about it.

```
node site/scripts/shots.mjs      # drives the app and captures each screen at 2x
node site/scripts/optimise.mjs   # resizes and encodes them as WebP (needs `brew install webp`)
node site/scripts/og.mjs         # draws the share card from the hero capture
```

`shots.mjs` starts the dev server if nothing is serving, walks the app the way a
person would (opens a project, asks for something, opens each view) and captures
both themes. A server you are already running is used as-is and left alone.

`optimise.mjs` encodes everything it finds in `shots/`, which is more than the page
uses, and writes a 1440-wide variant beside every whole-window shot so a phone is
never sent the 2880 file. Only what `index.html` names is kept in `web/`. Delete
the rest after a run.

`og.mjs` is the one picture that is drawn rather than captured: the 1200x630 card
in `og:image`, built from the hero capture and the wordmark. Run it after
`shots.mjs` when the hero changes.

Some shots are hand-cropped from a whole-window capture (`crop-*.png`) with `sips`,
because a detail reads better than a whole screen. Re-crop those by hand if the
interface moves under them.

## Putting it somewhere

Static hosting, any of it. The page has no server side.

- **Vercel / Netlify**: point the project at this folder, no build command, output
  directory `.`
- **GitHub Pages**: publish from `/site` on the default branch
- **Anything else**: copy the folder up

## One thing to change before launch

The download button points at the repository's releases page. Point it at the real
download once there is one, or name the Homebrew cask here once the tap is live.
