import QUnitDefault from 'qunit';

const QUnit = QUnitDefault as typeof QUnitDefault & {
  reporters: { tap: { init(qunit: unknown): void } };
  on(
    event: 'runEnd',
    callback: (runEnd: { testCounts: { failed: number } }) => void,
  ): void;
};

QUnit.config.autostart = false;
QUnit.reporters.tap.init(QUnit);
QUnit.on('runEnd', (runEnd) => {
  if (runEnd.testCounts.failed > 0) {
    process.exitCode = 1;
  }
});

await import('./server-test.ts');
await import('./live-autopublish-test.ts');
await import('./live-hmr-test.ts');
await import('./browse-test.ts');
await import('./history-test.ts');
await import('./inject-importmap-test.ts');
await import('./offers-test.ts');
await import('./inherit-serve-test.ts');
await import('./delivery-test.ts');
await import('./http2-test.ts');

QUnit.start();
