const assert = require('node:assert/strict');
const test = require('node:test');
const { withMaxSearchParam } = require('./render-start');

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
