const assert = require('node:assert/strict');
const test = require('node:test');
const { requireDatabaseUrls, resolveCommand } = require('./docker-entrypoint');

test('uses the compiled API when Docker does not override CMD', () => {
  assert.deepEqual(resolveCommand([]), ['node', 'dist/src/main.js']);
});

test('preserves a dashboard-managed Docker command override', () => {
  assert.deepEqual(resolveCommand(['node', 'dist/src/main.js']), ['node', 'dist/src/main.js']);
});

test('requires both application and migration database URLs', () => {
  assert.throws(() => requireDatabaseUrls({}), /DATABASE_URL/);
  assert.throws(() => requireDatabaseUrls({ DATABASE_URL: 'postgresql:\/\/app' }), /DIRECT_URL/);
  assert.doesNotThrow(() => requireDatabaseUrls({
    DATABASE_URL: 'postgresql://app',
    DIRECT_URL: 'postgresql://direct',
  }));
});
