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
