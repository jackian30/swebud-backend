const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyLiveCors } = require('./smoke-live-cors');

function response(status, headers = {}, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
  });
}

function healthyFetch({ nativeStatus = 204, nativeHeaders = true } = {}) {
  return async (url, init = {}) => {
    if (url.endsWith('/health/ready')) {
      return response(200, {}, { ok: true, database: 'ok', version: '0.2.50-beta' });
    }
    assert.equal(init.method, 'OPTIONS');
    const origin = init.headers.Origin;
    if (origin === 'https://evil.example') {
      return response(403, {}, { message: 'Origin is not allowed', error: 'Forbidden', statusCode: 403 });
    }
    if (origin === 'https://localhost' && nativeStatus !== 204) {
      return response(nativeStatus, {}, { message: 'Origin is not allowed' });
    }
    return response(204, nativeHeaders ? {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,DELETE',
      'access-control-allow-headers': 'content-type,x-swebudd-client',
      vary: 'Origin, Access-Control-Request-Headers',
    } : {});
  };
}

test('passes only when native and web origins work and a hostile origin is rejected', async () => {
  const result = await verifyLiveCors({
    apiOrigin: 'https://api.swebudd.test/',
    expectedVersion: '0.2.50-beta',
    fetchImpl: healthyFetch(),
  });

  assert.deepEqual(result, { apiOrigin: 'https://api.swebudd.test', version: '0.2.50-beta' });
});

test('detects the production native-origin regression', async () => {
  await assert.rejects(
    verifyLiveCors({
      apiOrigin: 'https://api.swebudd.test',
      expectedVersion: '0.2.50-beta',
      fetchImpl: healthyFetch({ nativeStatus: 403 }),
    }),
    /https:\/\/localhost preflight returned 403/,
  );
});

test('requires browser-visible CORS headers, not only a 204 status', async () => {
  await assert.rejects(
    verifyLiveCors({
      apiOrigin: 'https://api.swebudd.test',
      expectedVersion: '0.2.50-beta',
      fetchImpl: healthyFetch({ nativeHeaders: false }),
    }),
  );
});
