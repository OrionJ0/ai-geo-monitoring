import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const systemdDirectory = path.join(projectRoot, 'deploy', 'systemd');

function readUnit(name) {
  return fs.readFileSync(path.join(systemdDirectory, name), 'utf8');
}

function assertSharedServiceContract(unit) {
  assert.match(unit, /^User=ubuntu$/m);
  assert.match(unit, /^Group=ubuntu$/m);
  assert.doesNotMatch(unit, /^User=root$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^RestartSec=3s$/m);
  assert.match(unit, /^KillSignal=SIGTERM$/m);
  assert.match(unit, /^KillMode=control-group$/m);
  assert.match(unit, /^TimeoutStopSec=60s$/m);
  assert.match(unit, /^StandardOutput=journal$/m);
  assert.match(unit, /^StandardError=journal$/m);
  assert.match(unit, /^UMask=0077$/m);
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
}

test('systemd units run the production backend and loopback-only frontend as ubuntu', () => {
  const backend = readUnit('ai-geo-backend.service');
  const frontend = readUnit('ai-geo-frontend.service');

  assertSharedServiceContract(backend);
  assertSharedServiceContract(frontend);

  assert.match(
    backend,
    /^WorkingDirectory=\/opt\/ai-geo-monitoring\/backend$/m
  );
  assert.match(
    backend,
    /^ExecStart=\/usr\/bin\/node \/opt\/ai-geo-monitoring\/backend\/app\.js$/m
  );
  assert.match(backend, /^Environment=HOME=\/home\/ubuntu$/m);
  assert.match(backend, /^Environment=XDG_RUNTIME_DIR=\/run\/user\/1000$/m);
  assert.match(
    backend,
    /^Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=\/run\/user\/1000\/bus$/m
  );

  assert.match(
    frontend,
    /^WorkingDirectory=\/opt\/ai-geo-monitoring\/nextjs-frontend$/m
  );
  assert.match(
    frontend,
    /^ExecStart=\/usr\/bin\/node \/opt\/ai-geo-monitoring\/nextjs-frontend\/node_modules\/next\/dist\/bin\/next start -H 127\.0\.0\.1 -p 3001$/m
  );
  assert.doesNotMatch(frontend, /0\.0\.0\.0/);
});
