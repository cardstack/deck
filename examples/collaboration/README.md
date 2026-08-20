# Collaboration validation depot

Every mutable package in this depot is implicitly a repository. In addition,
the depot declares the multi-package group `acme/dashboard` in
`depot/repository.json`. It is not seeded by Hub code. Branches, commits,
reviews, merges, and their history are created through the public Deck CLI and
stored under `depot/.deck/store`.

The Repository contains three independently addressable packages:

- `app/dashboard`
- `acme/editor`
- `acme/theme`

The current delivery-exceptions change touches all three: the app introduces a
risk-ranked fulfillment view, the editor package supplies the exception queue,
and the theme adds operational alert tokens. Landing only one package would
break the runnable result, which makes this a concrete atomic Review rather
than an example about Deck itself.

Start the real services:

```sh
./scripts/run-hub-with-deckd.sh
```

Then inspect Browse and Review:

- `http://localhost:8788/browse?at=/collaboration/app/dashboard`
- `http://localhost:8788/review?repository=acme/dashboard`

Follow `docs/deck-repository-tour.md` to perform the workflow yourself or ask
an agent to run it.
