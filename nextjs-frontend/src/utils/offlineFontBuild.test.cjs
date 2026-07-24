const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendRoot = path.resolve(__dirname, '../..');

test('production build uses only local system font definitions', () => {
  const layout = fs.readFileSync(
    path.join(frontendRoot, 'src/app/layout.tsx'),
    'utf8'
  );
  const globals = fs.readFileSync(
    path.join(frontendRoot, 'src/app/globals.css'),
    'utf8'
  );

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(globals, /--font-geist-sans\s*:/);
  assert.match(globals, /--font-geist-mono\s*:/);
});
