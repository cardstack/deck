# The demos: what each one must prove, and how

Written 2026-08-09. A brief for the nine examples in `examples/`, written
before rebuilding them. It uses ASD-STE100 Simplified Technical English.

---

## 1. What is wrong now

The demos are correct and they under-perform. Six faults, in the order they
cost the most.

**They tell instead of showing.** Most pages open with a paragraph that says
what you are about to see. A reader who believes the paragraph does not need
the demo, and a reader who does not believe it is not persuaded by more
prose. The map demo is the exception: two maps, one has different tiles, and
nobody has to be told.

**The difference is often invisible.** Several demos prove their point with
JSON keys in a table. `EUR` appearing in one column and not another is a true
statement about a merge and it produces no reaction. A demo must make the
change large enough to see from across the room.

**They are not genre-correct.** A currency codelist should look like a
reference-data tool. A field library should look like a form builder. A
language demo should look like a console. Most of them look like the same
grey document with a table in it, which hides what kind of thing each one is.

**They are read-only.** You watch a sequence that already happened. The one
capability this system has that others do not — edit, and the edit becomes an
addressable state immediately — is described rather than handed to you.

**Some are self-referential.** A demo about choosing between variations of a
page, where the page is a demo about choosing, teaches nothing about the
world. The subject should be something a person would plausibly build.

**The commentary is longer than the demo.** Comments in the source are good
and should stay. Paragraphs on the screen compete with the thing on the
screen.

---

## 2. The rules for the rebuild

1. **One claim per demo.** Write it in one sentence first. If the page cannot
   make that sentence obvious without prose, the scenario is wrong, not the
   copy.
2. **Show the change at a size you cannot miss.** Colour, shape, layout,
   count — not a key in a table.
3. **Genre first.** Decide what kind of application this is, then build that
   application. A convincing small tool beats an unconvincing large one.
4. **Interactive where interaction is the argument.** If the claim is "your
   edit becomes a Version", the reader must make an edit.
5. **Never about Deck.** The subject is a shop, a map, a form, a field guide.
   Deck is how it is built, not what it is about.
6. **Prose is a caption, not an essay.** One line above the thing. Everything
   else goes in the source comments, where it helps whoever reads the code.
7. **ASD-STE100 on screen.** One idea per sentence, active voice, and the
   same word for the same thing.

---

## 3. Per demo

### codelist — W2, shared reference data
**Claim:** two people amend one table at the same time, and both amendments
survive.

Now: four columns of currency keys. Change: make it a **live exchange-rate
board**. Each code is a row with a rate and a flag. When the merge lands, two
new rows appear with a highlight and the count at the top increases. An
absence is a gap in a list of rows, not a missing table cell.

### contribute-to-codelist — W2, the write side
**Claim:** you can run somebody's proposal before you accept it.

Now: a picker over proposals. Change: put the two proposals **side by side as
running boards**, and give the reviewer one control — `try this one` — that
swaps the running page with `?with=`. Accepting is a second button. The
conflict case must look like a stopped machine, not like an error message.

### fork-an-app — W3, adapters and forks
**Claim:** change one file in a vendored library and run your version beside
the original.

Now: already the best of the nine. Two maps, visibly different tiles. Keep
the scenario. Change only: cut the explanatory text, and print the cost — *2
objects out of 87* — beside the maps rather than above them.

### fork-a-language — W3, bespoke to generic
**Claim:** replace a parser, keep the evaluator byte-identical, and both
dialects run the same semantics.

Now: a viewer that prints results. Change: make it a **two-pane console**.
Type an expression on the left, see both dialects evaluate it on the right,
live. Byte-identical is proved by a hash printed under both panes, the same
hash twice. Interaction is the whole argument here: the reader writes an
expression the author never thought of, and both agree.

### field-library — W4, patterns and fields
**Claim:** small field decks compose, dedupe, and version independently.

Now: a static gallery of six fields. Change: **an editable field, and a
Version appears.** The reader edits one field's source in the page, saves,
and watches the auto-publish produce `-dev.N`. Then they switch the consumer
between the old and the new pin and see the form change. This is the demo the
whole system is for, and it is currently the one that shows the least.

### two-agents — W1, concurrent agents
**Claim:** a merge policy published as data resolves a real conflict, and
refuses where it does not apply.

Now: a token board. Change: keep it, make the tokens **visibly a theme** — a
small interface rendered from them, so an agent's change repaints something
recognisable. The refusal must be the loudest state on the page.

### variations — W4, choosing agent output
**Claim:** choosing is a tag move, and the rejected options stay addressable.

Now: three variations of a card. Change the subject away from anything
Deck-shaped: three variations of a **product page hero**. Four frames, real
differences a person would argue about. Choosing moves `latest`; the page
then shows that the two rejected ones still serve at their own addresses.

### potluck — forms from field decks
**Claim:** a real form is assembled from independently versioned fields.

Now: already genre-correct. Change: reduce the commentary, and show which
field deck drew each control on hover rather than in a permanent legend.

### three-js and prosemirror — vendoring at scale
**Claim:** a 374-module library and a recovered bundle both serve per file.

Keep both. They exist to prove that the corpus is real. Change only the copy
and the framing: three.js should look like a **studio**, prosemirror should
state its rebuild gap as a fact in one line, not a paragraph.

---

## 4. Order of work

1. `field-library` — the largest gain, and the one the reader is asked to
   touch.
2. `fork-a-language` — an interactive console is a big improvement.
3. `codelist` and `contribute-to-codelist` — the pair that carries W2.
4. `variations` — change the subject, keep the mechanism.
5. `two-agents` — make the theme visible.
6. `potluck`, `three-js`, `prosemirror`, `fork-an-app` — copy and framing
   only.

---

## 5. What was done, 2026-08-09

Against section 4's order. Written after the work, not before it.

**Rebuilt.**

- **`field-library`** — the largest change. A shipment form over seven field
  decks, one of which the reader edits in the page. The save goes through a
  separate process (`examples/shared/editor-bridge.mjs`), because the deck
  server answers `GET` and `HEAD` and nothing else; the watcher publishes
  `1.0.0-dev.N`, and the page reloads at `?with=` and redraws. The dedupe and
  two-chroma evidence is one click down instead of three sections up.
- **`fork-a-language`** — a two-pane console. Type an expression on either
  side and both dialects evaluate it live. Each pane prints the SHA-256 of the
  `eval.js` bytes it fetched, so byte-identical is measured on the page rather
  than asserted beside it.
- **`codelist`** — one board with a state switcher. Rows grow in and out as
  you move between the four sealed states, the count moves with them, and the
  rows that arrive flash once.
- **`two-agents`** — each token set is drawn as the small interface it
  describes, so an agent's edit repaints something recognisable. The refusal
  is a banner above the sets rather than a closing paragraph.
- **`fork-an-app`** — copy only, as planned. Four paragraphs cut to one line;
  the cost sits under the map it is about.

**Fixed along the way.** Five of the eleven demos crashed on start. Each
referenced a binding from inside `if (buildMode !== 'serve')` in code that
runs after it, so the process printed its whole transcript, printed
"serving", and then died. All eleven now boot and serve.

- **`contribute-to-codelist`** — both proposals are boards at the top, side
  by side, each with one control: `try this one`. The conflicted one looks
  like a stopped machine and says the thing the old copy buried — it still
  runs; what stopped is the merge into upstream.
- **`variations`** — the subject is a plant shop, and the three answers stop
  looking alike: A tightens and squares every token, B changes what a card
  *is*, C doubles the columns. One axis each.
- **`potluck`, `three-js`, `prosemirror`** — copy and framing. potluck no
  longer mentions Deck to a reader signing up for lunch, and names the deck
  behind each control on hover; three.js leads with the canvases; prosemirror
  states its gap in two sentences.

**Two bugs the rebuild found, both invisible before it.**

Five demos crashed on start — each referenced a binding from inside
`if (buildMode !== 'serve')` in code that runs after it, so the process
printed its whole transcript, printed "serving", and died. All eleven boot
now.

And `?with=` disagreed with itself. A trial resolves each substitute's own
scopes, which is what lets a substitute bring its dependencies along; but a
substitute that declares a *range* had that range re-resolved against the
store, quietly reinstating whatever `latest` names. The variations page
pinned `ui/card@1.0.0` for its "before" frame and rendered variation B. A
version the caller named now wins inside those scopes too.

**Still open.** The Hub only runs a watcher over depots that declare editable
files, so an edit made anywhere else in a demo depot does not auto-publish
while the Hub is what is serving it. That is deliberate — nine watchers over
trees nobody is editing costs descriptors for no signal — but it means the
live loop is only demonstrable where an editor is offered.
