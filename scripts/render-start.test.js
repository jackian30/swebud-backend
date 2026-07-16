const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizedRenderBrowserOrigins } = require('./render-start');

test('leaves non-Render environments unchanged', () => {
  const env = { FRONTEND_ORIGIN: 'https://localhost' };
  assert.deepEqual(normalizedRenderBrowserOrigins(env), env);
});

test('leaves valid Render browser origins unchanged', () => {
  const env = {
    RENDER: 'true',
    FRONTEND_ORIGIN: 'https://preview.swebudd.com',
    ADMIN_ORIGIN: 'https://admin.swebudd.com',
  };
  assert.deepEqual(normalizedRenderBrowserOrigins(env), env);
});

test('migrates only the known legacy Render localhost browser origins', () => {
  const env = {
    RENDER: 'true',
    FRONTEND_ORIGIN: 'https://localhost',
    ADMIN_ORIGIN: 'https://localhost',
    NATIVE_APP_ORIGIN: 'https://localhost',
  };

  assert.deepEqual(normalizedRenderBrowserOrigins(env), {
    ...env,
    FRONTEND_ORIGIN: 'https://swebudd.com',
    ADMIN_ORIGIN: '',
  });
  assert.equal(env.FRONTEND_ORIGIN, 'https://localhost');
  assert.equal(env.ADMIN_ORIGIN, 'https://localhost');
});
