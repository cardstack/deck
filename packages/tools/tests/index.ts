// Test entry: mirrors the monorepo pattern of running qunit files directly
// under node (`node tests/index.ts`), TAP output, nonzero exit on failure.
import QUnitDefault from 'qunit';

// @types/qunit lags the Node API surface (reporters, on); narrow locally.
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

await import('./vendor-npm-test.ts');
await import('./vendor-map-test.ts');
await import('./derive-test.ts');
await import('./rebase-daemon-test.ts');

QUnit.start();
