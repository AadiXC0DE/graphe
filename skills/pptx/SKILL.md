---
name: pptx
description: Build a slide deck as a real .pptx file that carries the project's own colours, spacing and type instead of default Office styling. Use whenever somebody asks for a deck, a presentation, slides, a pitch, a readout or a review — and when they ask to change one that already exists.
---

# Decks that look like the project

A deck is a design job that happens to end in a file. Anyone can produce forty-four-point Calibri on white; that is what the person is trying to get away from. The work here is to find what the project already looks like, put that on the slides, and then prove the file you made actually opens.

Three rules run through all of it:

- **Take the look from the project, never from the runtime's defaults.** A generated deck that does not match the product it is about has failed, however clean the code was.
- **Verify, do not announce.** "I've created your deck" with no check behind it is the failure mode. A `.pptx` is a zip of XML; it is entirely possible to write one that no application will open.
- **Everything stays inside the project folder.** The build script, the deck, the check — all of it lands in the project.

## 1. Find the look

Before writing a single slide, find the project's own values. In order:

1. A design tokens file — `**/tokens.css`, `styles/tokens.css`, `src/styles/tokens.css`, `theme.css`, `_variables.scss`, `tokens.json`, `theme.json`. In this project it is `src/styles/tokens.css`.
2. A Tailwind or framework theme — `tailwind.config.*`, `theme` in the app config.
3. Failing both, the largest stylesheet, and the brand colours it actually uses.

Read it and write down, in one short list you keep to: page background, raised surface, body text, muted text, one accent, the accent's text colour, the border colour, the spacing step, and the type family. Note the light values and the dark ones separately if the file has both — a deck is a light document unless the person says otherwise, so take the light set.

A worked example, from this project's own `src/styles/tokens.css`:

| what | token | value |
| --- | --- | --- |
| page | `--bg` | `#fbfbfa` |
| card | `--bg-raised` | `#ffffff` |
| heading and body | `--text` | `#1a1a19` |
| supporting line | `--text-muted` | `#6b6b66` |
| accent | `--accent` | `#b8492c` |
| on the accent | `--accent-text` | `#ffffff` |
| rules and edges | `--border` | `#cdcdc7` |
| spacing step | `--space-1` … `--space-8` | `4px` → `72px` |
| type | `--font-ui` | Satoshi, then the system stack |

Two conversions you will need:

- **Colour.** `python-pptx` wants `RGBColor(0xB8, 0x49, 0x2C)`. Hex is a direct read. If a value is `oklch()`, `hsl()` or a `color-mix()`, do not guess — look for a hex fallback in the same file, or take the nearest literal hex the project actually ships, and say in your final sentence which one you used.
- **Size.** CSS pixels are not slide units. `Pt(n)` and `Inches(n)` come from `pptx.util`. A slide is 13.333 × 7.5 inches at 16:9. Convert spacing at 96px to the inch: `Inches(px / 96)`. A `--space-8` of 72px is `Inches(0.75)`, which is a real margin rather than an invented one.
- **Type.** Set the font name on every run. A face the project ships as a web font will not be installed on the machine opening the deck, so name it *and* name the fallback the tokens file already lists — set the run's font to the project face, and accept that PowerPoint will substitute. If the deck must look identical everywhere, use the fallback family outright and say so.

Then design it. Take one accent and use it sparingly: a rule under the title, one filled shape, the page numbers. Left-align to a single margin taken from the spacing scale. Give the title slide room. Do not put a box round everything.

## 2. Get the tools, without touching the machine

`python-pptx` is the library. Install it **into the project**, never globally:

```
python3 -m venv .venv
.venv/bin/pip install python-pptx
```

Then run everything with `.venv/bin/python`. Add `.venv/` to the project's ignore file if it is not already there.

If `python3` is not available, or the project is JavaScript through and through, use **PptxGenJS** instead — `npm install pptxgenjs`, then a build script that runs under `node`. It takes hex colours directly and inches as numbers, so the reading of the tokens above is the same work; only the calls change. Everything below about verifying applies unchanged.

Asking to add a package is a question the person answers, and it is a fair one to ask once. Do not try to route around it.

## 3. Write the build script, not the deck

Put the build in a file the project keeps — `scripts/build_deck.py` or similar — with the values from step 1 named at the top as constants. Two reasons: the person can change one colour and rebuild, and you can run it again after they ask for an edit instead of starting over.

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

BG      = RGBColor(0xFB, 0xFB, 0xFA)
TEXT    = RGBColor(0x1A, 0x1A, 0x19)
MUTED   = RGBColor(0x6B, 0x6B, 0x66)
ACCENT  = RGBColor(0xB8, 0x49, 0x2C)
FACE    = "Satoshi"
MARGIN  = Inches(0.75)          # --space-8, 72px

deck = Presentation()
deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
blank = deck.slide_layouts[6]   # 6 is empty: build the slide, do not fill a template
```

Use layout 6 and place your own text boxes. The stock layouts carry Office's type and placeholder positions, which is the thing you are trying not to ship. Set the background per slide via `slide.background.fill.solid()`.

Keep the deck to what was asked for. If the person gave you content, use their words; do not pad to a round number of slides.

## 4. Prove it before you say anything

Run these in order. If one fails, fix it and run again — do not report a deck you have not opened.

**The file is there and is not empty.** `ls -l` the path. A `.pptx` under about 20KB is usually a deck with nothing in it.

**It opens, and holds what you meant.** Write the check as a file next to the build script — `scripts/check_deck.py`:

```python
from pptx import Presentation
deck = Presentation("out/deck.pptx")
print("slides:", len(deck.slides))
for n, slide in enumerate(deck.slides, 1):
    words = [s.text_frame.text for s in slide.shapes if s.has_text_frame]
    print(n, " | ".join(w.splitlines()[0] for w in words if w)[:80])
assert len(deck.slides) == 8, f"expected 8, got {len(deck.slides)}"
```

Run it with `.venv/bin/python scripts/check_deck.py`. Reading the file back through `Presentation()` is the real test: a malformed deck raises here rather than in front of the person.

Write the check as a file rather than handing the code to the runtime on the command line. Code typed straight into a `-c` cannot be read before it runs, so it is refused here — and a file is better anyway, because the person can run the same check tomorrow.

**Look at it.** If `libreoffice` or `soffice` is on the machine:

```
soffice --headless --convert-to pdf --outdir out out/deck.pptx
```

Then convert the first pages to images and actually view them — `pdftoppm -png -r 80 out/deck.pdf out/slide` — and open the images. You are checking for the things a slide count cannot: text running off the edge, a title colliding with the rule under it, the accent used on a background it has no contrast against, an empty slide you did not mean to leave. Fix what you see.

If neither is installed, say plainly in your final sentence that you checked the file's structure but could not look at the pages.

## 5. Say what you made

One or two sentences, in ordinary words:

> Made an eight-slide deck at `out/deck.pptx`, using the project's own colours and type. Rendered it to check the layout — the pages look right. Rebuild it any time with `.venv/bin/python scripts/build_deck.py`.

Name the file and where it is. Name anything you had to choose for them — a colour you approximated, a font that will substitute, a slide you left thin because there was nothing to put on it. Do not list every slide back to them; they can open it.

## When they ask for a change

Edit the build script and run it again. Rebuilding from a script that carries the project's values is the whole reason the script exists — never hand-patch the `.pptx`, and never start a fresh deck that quietly drops the earlier choices.
