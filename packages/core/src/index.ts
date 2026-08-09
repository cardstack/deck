// `@cardstack/deck` — the browser-safe surface.
//
// WHY THE ROOT ENTRY IS THE PURE ONE. This package has two audiences with
// different runtimes: a host that resolves modules in the page, and a server
// that reads trees off a disk. Only one of them can have the default.
//
// It goes to the browser, because of how the two mistakes fail. A host
// developer who writes `from '@cardstack/deck'` and gets a module reaching
// `node:fs` finds out at bundle time, in someone else's build, as an error
// about a polyfill. A server developer who writes the same thing and wants
// `pack` gets "not exported" immediately, looks, and finds `./node` one line
// down. A missing export is a signpost; an accidental `node:fs` is a
// morning.
//
// So: `@cardstack/deck` is what runs anywhere, `@cardstack/deck/node` is the
// rest. The `no-restricted-imports` rule in `.eslintrc.cjs` keeps that true
// rather than merely intended.

export * from './resolve.ts';
