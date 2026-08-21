import {
  projectRRIImportMap,
  resolveRRI,
  rri,
  type RRIImportMap,
} from '@cardstack/deck/rri';
import { Checks, assertEqual, type CheckResult } from './laws.ts';

export async function runRRIChecks(): Promise<CheckResult[]> {
  let checks = new Checks();
  let lock: RRIImportMap = {
    imports: { three: rri('@catalog/three@0.169.0/build/three.module.js') },
    scopes: {
      '@acme/gallery/legacy/': {
        three: rri('@catalog/three@0.160.0/build/three.module.js'),
      },
    },
  };
  await checks.run('L7', 'RRI resolution selects by importer RRI before transport', () => {
    assertEqual(
      resolveRRI({ ...lock, specifier: 'three', fromRRI: '@acme/gallery/scene.gts' }),
      '@catalog/three@0.169.0/build/three.module.js',
      'default exact Version RRI',
    );
    assertEqual(
      resolveRRI({ ...lock, specifier: 'three', fromRRI: '@acme/gallery/legacy/scene.gts' }),
      '@catalog/three@0.160.0/build/three.module.js',
      'scoped exact Version RRI',
    );
  });
  await checks.run('L12', 'HTTP projection is separate from canonical RRI resolution', () => {
    let map = projectRRIImportMap(lock, (id) => `https://example.test/rri/${id}`);
    assertEqual(
      map.imports.three,
      'https://example.test/rri/@catalog/three@0.169.0/build/three.module.js',
      'projected browser URL',
    );
  });
  return checks.results;
}
