// Standing a depot up.
//
// This is the half of Deck that runs. The server is READ-ONLY — every write
// in this CLI happens on disk, and the server distributes what it finds — so
// what `serve` adds is the watcher: a settled save is hashed, and if the
// tree changed it auto-publishes an immutable <base>-dev.N and (with a
// history backend attached) seals the save itself. Nothing about that loop
// asks you to name anything, and nothing about it can lose a save.

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDeckServer } from '@deck/server/server';
import {
  discoverDecks,
  storeDirFor,
  watchDepot,
  type DepotMount,
} from '@deck/server/depot';
import { startRebaseDaemon } from '@deck/server/rebase-daemon';
import { createHistory, isValidHistoryKind } from '@deck/history/create';
import { defineCommand, type Command } from '../command.ts';
import { DEFAULT_PORT, fail, listenNear } from '../support.ts';

const hello = defineCommand({
  name: 'hello',
  group: 'start',
  summary: 'scaffold a live depot and serve it — start here',
  usage: ['hello [dir] [--port <p>] [--publisher <p>]'],
  detail: `The runme: a working depot and a running server in one command.
No install, no build, no config. Open the printed URL, edit app.js, reload.

Everything else in this CLI is a step you take later.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: 'string', default: DEFAULT_PORT },
        publisher: { type: 'string', default: 'you' },
      },
    });
    // The layout IS the addressing: <root>/<depot>/<publisher>/<package>
    let root = resolve(positionals[0] ?? 'hello-deck');
    let depotName = 'hello';
    let publisher = values.publisher!;
    let name = 'app';
    let depotDir = join(root, depotName);
    let appDir = join(depotDir, publisher, name);
    let exists = await stat(join(appDir, 'app.js')).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(appDir, 'importmap.json'),
        JSON.stringify(
          {
            imports: {},
            deck: {
              packages: {
                [name]: { version: '0.1.0', entry: '$DECK/app.js' },
              },
            },
          },
          null,
          2,
        ) + '\n',
      );
      await writeFile(
        join(appDir, 'index.html'),
        `<!doctype html>
<meta charset="utf-8" />
<title>${depotName}/${publisher}/${name}</title>
<script type="module" src="/_live/hmr.js"></script>
<body style="font-family: system-ui; display: grid; place-items: center; height: 100vh; margin: 0">
  <canvas id="c" width="360" height="360"></canvas>
  <script type="module" src="./app.js"></script>
</body>
`,
      );
      await writeFile(
        join(appDir, 'app.js'),
        `// Edit this file and reload the page. That is the whole loop.
const c = document.getElementById('c').getContext('2d');
let t = 0;
setInterval(() => {
  t += 0.02;
  c.fillStyle = '#0b1021';
  c.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 90; i++) {
    const a = i * 0.4 + t;
    const r = 20 + i * 1.6;
    c.fillStyle = \`hsl(\${(i * 4 + t * 60) % 360} 90% 65%)\`;
    c.beginPath();
    c.arc(180 + Math.cos(a) * r, 180 + Math.sin(a) * r, 4, 0, 7);
    c.fill();
  }
}, 16);
`,
      );
    }
    // History is on when the machine can do it: "you cannot lose work" is
    // the promise, and seals are what make it true between publishes.
    let attachment = await createHistory({
      dir: depotDir,
      onError: (error) => console.error(`  history: ${error}`),
    });
    let depot: DepotMount = {
      name: depotName,
      dir: depotDir,
      storeDir: storeDirFor(depotDir),
      history: attachment.backend,
    };
    let server = createDeckServer({ depots: [depot] });
    watchDepot({
      depot,
      onLiveChange: (event) => server.liveBus.emit(event),
      onPublish: ({ name: deck, version }) =>
        console.log(`  saved → ${deck}@${version}`),
      onError: (error) => console.error(`  watch: ${error}`),
    });
    let port = await listenNear(
      server,
      Number(values.port),
      values.port === DEFAULT_PORT ? 10 : 1,
    );
    let url = `http://localhost:${port}/${depotName}/${publisher}/${name}/index.html`;
    console.log(`
  ${exists ? 'Serving' : 'Created'} ${root}

      ${url}

  Open that, then edit ${join(appDir, 'app.js')} — it hot-reloads.

  The URL is the directory: /${depotName}/${publisher}/${name}/app.js IS
  ${depotName}/${publisher}/${name}/app.js on disk. Add @<version> to the
  package segment and you get the sealed copy instead of the live one.

  No npm. No GitHub. No deploy. No PR. Instant feedback.
  Every save is auto-saved as an immutable version — you cannot lose work,
  and you can go back to any of them.

  ${attachment.detail}${
    attachment.backend
      ? `
    deck history ${depotDir}            # every state this depot has been in
    deck restore ${depotDir} <changeId> # go back to any of them`
      : ''
  }

  Next, when you want it:
    deck vendor https://esm.sh/three@0.160.0 --name three --version 0.160.0 \\
      --depot ${depotDir} --publisher ${publisher} --tag latest
    deck release --depot ${depotDir} --publisher ${publisher} --name ${name} \\
      --version 1.0.0 --from dev --tag latest
    deck pack ${appDir}                 # the whole deck as one shareable file
`);
  },
});

const serve = defineCommand({
  name: 'serve',
  group: 'start',
  summary: 'serve depots live, auto-publishing and sealing every save',
  usage: [
    'serve --root <dir> | --depot <dir> --as <name> ...',
    '      [--port <p>] [--history auto|jj|historyd|none] [--rebase] [--onto <spec>]',
  ],
  detail: `--root is a directory OF depots: every child directory is one,
named after itself, exactly as it is addressed.

Every deck under a depot is served live at its version-less URL
(Cache-Control: no-store, so the browser cannot show you a stale file), and
a settled save auto-publishes as <base>-dev.N with the dev dist-tag. A save
that does not change the tree hash publishes nothing.

--history seals every save (tier 2), including the states between
publishes — that is what \`deck history\` lists and \`deck restore\` returns
to. auto attaches jj or historyd if the machine has one and prints why if
it does not; the live loop keeps working either way.

--rebase keeps every open proposal merged against upstream, continuously.

The server never writes to a depot. Writes come from this CLI and from your
editor; the server distributes what it finds.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        root: { type: 'string' },
        depot: { type: 'string', multiple: true, default: [] },
        as: { type: 'string', multiple: true, default: [] },
        port: { type: 'string', default: DEFAULT_PORT },
        history: { type: 'string', default: 'auto' },
        rebase: { type: 'boolean', default: false },
        onto: { type: 'string' },
      },
    });
    if (!values.root && values.depot!.length === 0) {
      fail(
        'usage: deck serve --root <dir> | --depot <dir> --as <name> [--port <p>] [--history <kind>]',
      );
    }
    if (values.depot!.length !== values.as!.length) {
      fail('each --depot <dir> needs a matching --as <name>');
    }
    if (!isValidHistoryKind(values.history!)) {
      fail('--history must be auto, jj, historyd, or none');
    }
    // A root is a directory OF depots — every child directory is one,
    // named after itself, exactly as it is addressed.
    let mounts: { name: string; dir: string }[] = [];
    if (values.root) {
      let rootDir = resolve(values.root);
      for (let entry of await readdir(rootDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          mounts.push({ name: entry.name, dir: join(rootDir, entry.name) });
        }
      }
    }
    for (let [i, dir] of values.depot!.entries()) {
      mounts.push({ name: values.as![i], dir: resolve(dir) });
    }
    let depots: DepotMount[] = [];
    for (let mount of mounts) {
      let attachment = await createHistory({
        dir: mount.dir,
        kind: values.history,
        onError: (error) => console.error(`history ${mount.name}: ${error}`),
      });
      console.log(`  ${mount.name}: ${attachment.detail}`);
      depots.push({
        name: mount.name,
        dir: mount.dir,
        storeDir: storeDirFor(mount.dir),
        history: attachment.backend,
      });
    }
    let server = createDeckServer({ depots });
    if (values.rebase) {
      for (let depot of depots) {
        startRebaseDaemon({
          depot,
          onto: values.onto,
          onPass: ({ rebased, conflicted }) => {
            if (rebased > 0 || conflicted > 0) {
              console.log(
                `rebase ${depot.name}: ${rebased} moved, ${conflicted} need a person`,
              );
            }
          },
          onError: (error) => console.error(`rebase ${depot.name}: ${error}`),
        });
      }
    }
    for (let depot of depots) {
      let controller = watchDepot({
        depot,
        onLiveChange: (event) => server.liveBus.emit(event),
        onPublish: ({ name, version, treeHash, sealChangeId }) =>
          console.log(
            `auto-published ${depot.name}/${name}@${version} (${treeHash.slice(0, 12)})${
              sealChangeId ? ` sealed ${sealChangeId.slice(0, 12)}` : ''
            }`,
          ),
        onDeck: (deck) => console.log(`  watching ${depot.name}/${deck.name}`),
        onError: (error) => console.error(`watch ${depot.name}: ${error}`),
      });
      await controller.rescan();
    }
    let port = Number(values.port);
    server.listen(port, async () => {
      console.log(`deck server on http://localhost:${port} (read-only)`);
      console.log(
        `  browse: http://localhost:${port}/  — depots, packages, versions`,
      );
      console.log(
        `  hmr:  http://localhost:${port}/_live/hmr.js → SSE /_live/events`,
      );
      for (let depot of depots) {
        for (let deck of await discoverDecks(depot.dir)) {
          console.log(
            `  live: http://localhost:${port}/${depot.name}/${deck.name}/ ` +
              `— auto-publishes @<base>-dev.N (tag: dev)`,
          );
        }
        if (depot.history) {
          console.log(
            `  seals: http://localhost:${port}/${depot.name}/_history — every save, published or not`,
          );
        }
      }
    });
  },
});

export const START_COMMANDS: Command[] = [hello, serve];
