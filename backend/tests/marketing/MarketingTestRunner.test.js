const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runner = path.resolve(
  __dirname,
  '../../scripts/runMarketingTests.js'
);

function runFixture(source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-test-runner-'));
  const nested = path.join(directory, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'fixture.test.js'), source);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const execution = spawnSync(
    process.execPath,
    [runner, `--root=${directory}`],
    { encoding: 'utf8', env: environment }
  );
  fs.rmSync(directory, { recursive: true, force: true });
  return execution;
}

test('marketing test runner recursively executes nested tests', () => {
  const execution = runFixture([
    "const test = require('node:test');",
    "test('nested pass', () => {});",
    ''
  ].join('\n'));

  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /nested pass/);
});

test('a deliberately failing marketing test makes the runner exit non-zero', () => {
  const execution = runFixture([
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "test('nested failure', () => assert.fail('intentional canary failure'));",
    ''
  ].join('\n'));

  assert.notEqual(execution.status, 0);
  assert.match(execution.stdout + execution.stderr, /intentional canary failure/);
});
