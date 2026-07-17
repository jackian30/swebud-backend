const assert = require('node:assert/strict');

const DEFAULT_API_ORIGIN = 'https://api.swebudd.com';
const NATIVE_ORIGIN = 'https://localhost';
const WEB_ORIGIN = 'https://swebudd.com';
const HOSTILE_ORIGIN = 'https://evil.example';
const REQUESTED_HEADERS = ['content-type', 'x-swebudd-client'];

async function preflight(fetchImpl, apiOrigin, origin) {
  return fetchImpl(`${apiOrigin}/auth/login`, {
    method: 'OPTIONS',
    redirect: 'manual',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': REQUESTED_HEADERS.join(','),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

async function verifyAllowedOrigin(fetchImpl, apiOrigin, origin) {
  const response = await preflight(fetchImpl, apiOrigin, origin);
  assert.equal(response.status, 204, `${origin} preflight returned ${response.status}`);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /(?:^|,)\s*POST\s*(?:,|$)/i);
  assert.match(response.headers.get('vary') ?? '', /(?:^|,)\s*Origin\s*(?:,|$)/i);
  const allowedHeaders = (response.headers.get('access-control-allow-headers') ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim());
  for (const header of REQUESTED_HEADERS) {
    assert.ok(allowedHeaders.includes(header), `${origin} does not allow ${header}`);
  }
}

async function verifyLiveCors(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiOrigin = (options.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/$/, '');
  const expectedVersion = options.expectedVersion;

  const readyResponse = await fetchImpl(`${apiOrigin}/health/ready`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(readyResponse.status, 200, `readiness returned ${readyResponse.status}`);
  const ready = await readyResponse.json();
  assert.equal(ready.ok, true);
  assert.equal(ready.database, 'ok');
  if (expectedVersion) {
    assert.equal(ready.version, expectedVersion, `expected ${expectedVersion}, received ${ready.version}`);
  }

  await verifyAllowedOrigin(fetchImpl, apiOrigin, NATIVE_ORIGIN);
  await verifyAllowedOrigin(fetchImpl, apiOrigin, WEB_ORIGIN);

  const hostileResponse = await preflight(fetchImpl, apiOrigin, HOSTILE_ORIGIN);
  assert.equal(hostileResponse.status, 403, `hostile preflight returned ${hostileResponse.status}`);
  assert.equal(hostileResponse.headers.get('access-control-allow-origin'), null);
  const hostileBody = await hostileResponse.json();
  assert.equal(hostileBody.message, 'Origin is not allowed');

  return { apiOrigin, version: ready.version };
}

if (require.main === module) {
  verifyLiveCors({
    apiOrigin: process.env.API_ORIGIN || process.argv[2],
    expectedVersion: process.env.EXPECTED_VERSION || process.argv[3],
  }).then(({ apiOrigin, version }) => {
    console.log(`Live CORS smoke passed for ${apiOrigin} (${version}).`);
  }).catch((error) => {
    console.error(`Live CORS smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verifyLiveCors };
