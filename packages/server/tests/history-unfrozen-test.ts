import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { pack } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import type {
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@cardstack/deck-history/backend';
import { createDeckServer, type DeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';

// Timeline Step identity: a historical HTML page binds unfrozen edges from
// THAT Step's package.json, rewritten into /_history/<rev>/… — even with no
// depot lock. Live working-tree edits must not leak into the Step.

let root: string;
let depotDir: string;
let storeDir: string;
let server: DeckServer;
let origin: string;

const STEP = 'step0001';

const SEALS: Record<string, Record<string, string>> = {
  [STEP]: {
    'me/app/index.html':
      '<!doctype html><script type="module" src="./app.js"></script>\n',
    'me/app/app.js': "import 'acme/palette';\nimport 'confetti';\n",
    'me/app/package.json': JSON.stringify({
      name: 'app',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './app.js' },
      dependencies: {
        'acme/palette': 'workspace:*',
        confetti: 'latest',
      },
    }),
    'acme/palette/package.json': JSON.stringify({
      name: 'palette',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './palette.js' },
    }),
    'acme/palette/palette.js': 'export const hue = "step";\n',
  },
};

class StepHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  noteMutation(): void {}
  async flush(): Promise<string | undefined> {
    return undefined;
  }
  async seal(): Promise<string | undefined> {
    return undefined;
  }
  async head(): Promise<string | undefined> {
    return STEP;
  }
  async list(): Promise<HistoryEntry[]> {
    return [
      {
        changeId: STEP,
        commitId: 'ab12',
        timestamp: '2026-08-12T12:00:00+0000',
        description: 'step with unfrozen edges',
        filesSummary: ['A me/app', 'A acme/palette'],
      },
    ];
  }
  async fileAt(
    _dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    let content = SEALS[revisionId]?.[path];
    return content === undefined ? undefined : Buffer.from(content);
  }
  async fileListAt(
    _dir: string,
    revisionId: string,
  ): Promise<string[] | undefined> {
    let seal = SEALS[revisionId];
    return seal ? Object.keys(seal).sort() : undefined;
  }
  async restorePlan(): Promise<RestorePlan> {
    return { writes: [], deletes: [] };
  }
  close(): void {}
}

function injectedMap(html: string): {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
} {
  let match = html.match(
    /<script type="importmap">\s*(\{[\s\S]*?\})\s*<\/script>/,
  );
  if (!match) {
    throw new Error(`no import map injected into: ${html.slice(0, 200)}`);
  }
  return JSON.parse(match[1]);
}

module('timeline step: unfrozen edges without a lock', function (hooks) {
  hooks.before(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-step-unfrozen-'));
    depotDir = join(root, 'demo');
    storeDir = storeDirFor(depotDir);
    // Live tree deliberately disagrees with the Step — different entry,
    // different dependency set — so a leak would fail the assertions.
    await mkdir(join(depotDir, 'me', 'app'), { recursive: true });
    await mkdir(join(depotDir, 'acme', 'palette'), { recursive: true });
    await writeFile(
      join(depotDir, 'acme', 'palette', 'package.json'),
      JSON.stringify({
        name: 'palette',
        version: '9.9.9',
        type: 'module',
        exports: { '.': './live.js' },
      }) + '\n',
    );
    await writeFile(
      join(depotDir, 'acme', 'palette', 'live.js'),
      'export const hue = "live-leak";\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '9.9.9',
        type: 'module',
        exports: { '.': './app.js' },
        dependencies: { 'acme/palette': '^9.0.0' },
      }) + '\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'index.html'),
      '<!doctype html><title>live</title>\n',
    );
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.2.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'confetti',
              version: '1.2.0',
              type: 'module',
              exports: { '.': './confetti.js' },
            }),
          ),
        },
        {
          path: 'confetti.js',
          bytes: Buffer.from(`export const V = '1.2.0';\n`),
        },
      ]),
      { tag: 'latest' },
    );

    let depot: DepotMount = {
      name: 'demo',
      dir: depotDir,
      storeDir,
      history: new StepHistory(),
    };
    server = createDeckServer({ depots: [depot] });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  test('Step HTML injects workspace:* into /_history/<rev>/ without a lock', async function (assert) {
    let response = await fetch(
      `${origin}/demo/_history/${STEP}/me/app/index.html`,
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-deck-importmap'), 'injected');
    assert.strictEqual(response.headers.get('x-deck-seal'), STEP);
    let map = injectedMap(await response.text());
    assert.strictEqual(
      map.imports['acme/palette'],
      `/demo/_history/${STEP}/acme/palette/palette.js`,
      'sibling binds THIS Step — not the live live.js',
    );
    assert.strictEqual(
      map.imports.confetti,
      '/demo/acme/confetti@latest/confetti.js',
      'dist-tag stays store identity (floats)',
    );
    assert.false(
      Object.values(map.imports).some((url) => url.includes('live.js')),
      'live working-tree entry must not leak into the Step map',
    );
  });

  test('Step sibling bytes are served from the seal', async function (assert) {
    let response = await fetch(
      `${origin}/demo/_history/${STEP}/acme/palette/palette.js`,
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'export const hue = "step";\n');
  });

  test('live page still uses today\'s tree, not the Step', async function (assert) {
    // No lock and live package.json only has a range — no unfrozen inject
    // for ^9.0.0. Confirm the live palette file is the leak bait we planted.
    let live = await fetch(`${origin}/demo/acme/palette/live.js`);
    assert.strictEqual(live.status, 200);
    assert.strictEqual(
      await live.text(),
      'export const hue = "live-leak";\n',
    );
  });
});

module('timeline step: lock pins merge with step unfrozen edges', function (
  hooks,
) {
  let server: DeckServer;
  let origin: string;
  let root: string;

  const REV = 'locked001';
  const files: Record<string, string> = {
    'importmap.json': JSON.stringify({
      imports: {
        locked: '/demo/acme/confetti@1.2.0/confetti.js',
        'locked/': '/demo/acme/confetti@1.2.0/',
      },
    }),
    'me/app/index.html':
      '<!doctype html><script type="module" src="./app.js"></script>\n',
    'me/app/app.js': "import 'acme/palette';\nimport 'locked';\n",
    'me/app/package.json': JSON.stringify({
      name: 'app',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './app.js' },
      dependencies: {
        'acme/palette': 'workspace:*',
        locked: '^1.0.0',
      },
    }),
    'acme/palette/package.json': JSON.stringify({
      name: 'palette',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './palette.js' },
    }),
    'acme/palette/palette.js': 'export const hue = "from-lock-step";\n',
  };

  class LockedStepHistory implements HistoryBackend {
    readonly kind = 'deckd' as const;
    noteMutation(): void {}
    async flush(): Promise<string | undefined> {
      return undefined;
    }
    async seal(): Promise<string | undefined> {
      return undefined;
    }
    async head(): Promise<string | undefined> {
      return REV;
    }
    async list(): Promise<HistoryEntry[]> {
      return [
        {
          changeId: REV,
          commitId: 'cd34',
          timestamp: '2026-08-12T13:00:00+0000',
          description: 'lock + unfrozen',
          filesSummary: [],
        },
      ];
    }
    async fileAt(
      _dir: string,
      revisionId: string,
      path: string,
    ): Promise<Buffer | undefined> {
      if (revisionId !== REV) {
        return undefined;
      }
      let content = files[path];
      return content === undefined ? undefined : Buffer.from(content);
    }
    async fileListAt(
      _dir: string,
      revisionId: string,
    ): Promise<string[] | undefined> {
      return revisionId === REV ? Object.keys(files).sort() : undefined;
    }
    async restorePlan(): Promise<RestorePlan> {
      return { writes: [], deletes: [] };
    }
    close(): void {}
  }

  hooks.before(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-step-lock-merge-'));
    let depotDir = join(root, 'demo');
    let storeDir = storeDirFor(depotDir);
    await mkdir(depotDir, { recursive: true });
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.2.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'confetti',
              version: '1.2.0',
              type: 'module',
              exports: { '.': './confetti.js' },
            }),
          ),
        },
        {
          path: 'confetti.js',
          bytes: Buffer.from(`export const V = '1.2.0';\n`),
        },
      ]),
      { tag: 'latest' },
    );
    server = createDeckServer({
      depots: [
        {
          name: 'demo',
          dir: depotDir,
          storeDir,
          history: new LockedStepHistory(),
        },
      ],
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  test('exact lock pins survive; workspace:* is added from Step package.json', async function (assert) {
    let response = await fetch(
      `${origin}/demo/_history/${REV}/me/app/index.html`,
    );
    assert.strictEqual(response.status, 200);
    let map = injectedMap(await response.text());
    assert.strictEqual(
      map.imports.locked,
      '/demo/acme/confetti@1.2.0/confetti.js',
      'exact pin from the Step lock is unchanged',
    );
    assert.strictEqual(
      map.imports['acme/palette'],
      `/demo/_history/${REV}/acme/palette/palette.js`,
      'unfrozen sibling overlays the lock',
    );
  });
});
