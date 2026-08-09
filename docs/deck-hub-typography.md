# Typography for Deck documentation

Written 2026-08-09. Governs `/start`, the Deckbook, and any future long-form
page in the Hub. It does **not** govern the three lens apps — `/browse`,
`/run` and `/track` are instruments, and their monospace lattice is correct
for what they do.

The audience is the same one O'Reilly writes for: technical readers who will
skim first, then read one section closely, then come back later to look
something up. All three of those need different things from a page, and the
job of the type system is to serve all three without three layouts.

---

## 1. Two faces, and the rule for choosing

| | face | used for |
| --- | --- | --- |
| **prose** | system UI sans | sentences, headings, table prose, list items |
| **mono** | Commit Mono | anything that IS a byte: code, addresses, commands, keys, versions, hashes |

The rule is not "code gets mono". It is: **if a reader could type it into a
terminal or a URL bar, it is mono.** A version number is mono. A file path is
mono. The word "vendoring" is not, even in a sentence about vendoring.

Monospace exists to make every character the same width, which matters when
characters are data and columns must align. In prose it works against you —
word shapes stop being distinctive, so the eye assembles words from letters
instead of recognising them whole. That is measurably slower and it is why
nobody sets a book in Courier.

No webfont for the prose face. L6 applies to this page too: a sealed deck
reaches nothing at runtime, and a font request is a third party learning
every reader's IP. The system stack is already on the machine.

---

## 2. The scale

A modular scale at **1.25** (the major third), on a **16px** base, rounded to
whole or half pixels so nothing lands on a fractional device pixel.

| token | size | line-height | job |
| --- | --- | --- | --- |
| `--t-title` | 31px | 1.2 | the page's one-sentence description |
| `--t-h2` | 25px | 1.25 | a numbered section |
| `--t-h3` | 20px | 1.3 | a subsection |
| `--t-body` | 16px | 1.65 | sentences |
| `--t-small` | 14px | 1.5 | table cells, code, captions |
| `--t-micro` | 12.5px | 1.4 | column headers, labels |

Four rules about the scale:

1. **Leading is inverse to size.** Big text needs less; body text needs
   1.6–1.7 or the eye loses the line return. A single line-height everywhere
   is the most common way a page ends up feeling cramped at the top and loose
   at the bottom.
2. **Never two adjacent steps.** If a heading and its body are one step
   apart, the hierarchy reads as an accident. Skip a step, or distinguish
   with weight and space instead of size.
3. **Weight before size.** Prefer 600 at the same size over 500 at a larger
   size. Size changes cost vertical rhythm; weight does not.
4. **The mono is set one step smaller than the prose beside it.** Monospace
   at a matched point size always looks larger — the character widths are
   uniform, so the line is denser. 14px mono sits correctly next to 16px
   prose.

---

## 3. Rhythm

One spacing unit: **8px**. Every vertical gap is a multiple: 4, 8, 16, 24,
32, 48, 64. Nothing between.

The rule that does most of the work is **proximity**: a heading belongs to
what comes *after* it, so the space above a heading is always larger than the
space below it — typically 3:1. A heading floating equidistant between two
blocks belongs to neither, and the reader has to work out which. That is the
single most common failure in generated documentation.

| relationship | gap |
| --- | --- |
| section → next section | 48px, plus a hairline rule |
| heading → its own body | 8px |
| paragraph → paragraph | 16px |
| body → next subsection heading | 32px |
| block (table, code) → surrounding prose | 24px |

---

## 4. Measure

**66 characters** is the target line length for the prose face; 68ch is the
practical cap. Longer and the eye loses its place on the return sweep;
shorter and it returns too often.

This is a constraint on **paragraphs**, not on the page. Tables, code blocks
and diagrams take the full column — they are scanned in two dimensions, not
read in one, and cramping them to a prose measure helps nobody.

---

## 5. Tables

Tables are the main reason a technical reader opens a reference page at all,
so they get treated as a first-class element rather than as prose in a grid.

- **Horizontal rules only.** Vertical rules add ink without adding
  information; alignment already separates the columns. One rule under the
  header, hairlines between rows.
- **Header row** is `--t-micro`, uppercase, letterspaced, and does not repeat
  the obvious. `depot` not `Depot Name`.
- **Row padding is generous** — 8px vertical minimum. Rows that touch are
  rows that get misread across.
- **Numbers right-align and use tabular figures**, so digits stack into
  columns you can compare down.
- **The first column is the key** and takes 600 weight; it is what the reader
  scans, and everything else is what they read once they have found the row.
- **Prose cells wrap; identifier cells do not.** A path broken across two
  lines is worse than one you scroll to; a sentence that will not wrap is
  worse than anything.
- **Wide tables scroll inside their own container**, never the page. See the
  note beside `.scrollx` in `theme.css` for why this is a wrapper and not
  `overflow` on the table or on `main`.
- **Zebra striping is not used.** With rules and adequate padding it is
  redundant, and it fights the activity decoration, which uses background
  colour to mean something.

---

## 6. Contrast

Body text meets **WCAG AA (4.5:1)** against its background. Non-negotiable
and worth stating because the obvious shortcut breaks it: the Hub's `--dim`
is around 3:1, which is correct for a timestamp beside a filename and wrong
for a paragraph.

Dim is for things that are **glanced at**: counts, labels, ages, hints. If a
reader is meant to *read* it, it is full-strength foreground.

Colour never carries meaning alone. The address palette (depot cyan,
publisher violet, package blue) is a learning aid layered on top of position
and label, not a substitute for either.

---

## 7. Headings say what the section is

A heading is a promise about content, read out of context in a contents list
by someone deciding whether to click. So:

- **Describe, do not label.** "What Deck gives any system" over "Benefits".
  "What is built and what is not" over "Status".
- **No cleverness in a heading.** Wordplay is invisible to a skimmer and
  costs a reader who is scanning for a keyword.
- **Front-load the distinguishing word.** Contents lists are scanned down the
  left edge, so "Command reference" beats "A reference for the commands".
- **The contents list is derived from the headings**, never written beside
  them — two copies of a structure disagree the first time someone adds a
  section.
