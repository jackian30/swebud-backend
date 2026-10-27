const assert = require('node:assert/strict');
const test = require('node:test');
const { boundedInteger, withMaxSearchParam } = require('./render-start');

test('caps a missing database connection limit', () => {
  assert.equal(
    withMaxSearchParam('postgresql://user:pass@db.example.com/swebud', 'connection_limit', 3),
    'postgresql://user:pass@db.example.com/swebud?connection_limit=3',
  );
});

test('caps an excessive database connection limit', () => {
  assert.equal(
    withMaxSearchParam('postgresql://user:pass@db.example.com/swebud?connection_limit=20', 'connection_limit', 3),
    'postgresql://user:pass@db.example.com/swebud?connection_limit=3',
  );
});

test('preserves a safe database connection limit', () => {
  assert.equal(
    withMaxSearchParam('postgresql://user:pass@db.example.com/swebud?connection_limit=2', 'connection_limit', 3),
    'postgresql://user:pass@db.example.com/swebud?connection_limit=2',
  );
});

test('uses the bounded integer fallback only when a setting is absent', () => {
  assert.equal(boundedInteger({}, 'PRISMA_MIGRATE_ATTEMPTS', 3, 1, 10), 3);
  assert.equal(boundedInteger({ PRISMA_MIGRATE_ATTEMPTS: '' }, 'PRISMA_MIGRATE_ATTEMPTS', 3, 1, 10), 3);
});

test('accepts bounded integer settings', () => {
  assert.equal(boundedInteger({ PRISMA_MIGRATE_ATTEMPTS: '1' }, 'PRISMA_MIGRATE_ATTEMPTS', 3, 1, 10), 1);
  assert.equal(boundedInteger({ PRISMA_MIGRATE_RETRY_SECONDS: '0' }, 'PRISMA_MIGRATE_RETRY_SECONDS', 20, 0, 300), 0);
});

test('rejects migration settings that could skip or unbound deployment', () => {
  const invalidSettings = [
    ['PRISMA_MIGRATE_ATTEMPTS', 3, 1, 10, ['0', '-1', '1.5', '3attempts', 'NaN', '11']],
    ['PRISMA_MIGRATE_RETRY_SECONDS', 20, 0, 300, ['-1', '1.5', '20seconds', 'NaN', '301']],
  ];

  for (const [key, fallback, minimum, maximum, values] of invalidSettings) {
    for (const value of values) {
      assert.throws(
        () => boundedInteger({ [key]: value }, key, fallback, minimum, maximum),
        new RegExp(`${key} must be an integer from ${minimum} to ${maximum}`),
      );
    }
  }
});
