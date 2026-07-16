const assert = require('node:assert/strict');
const test = require('node:test');
const { resolutionActions } = require('./prepare-compatible-migrations');

test('marks an unapplied compatibility migration as applied without running its contract SQL', () => {
  assert.deepEqual(resolutionActions(undefined), ['applied']);
});

test('leaves a completed compatibility migration unchanged so the forward repair can run', () => {
  assert.deepEqual(resolutionActions({ finished_at: new Date(), rolled_back_at: null }), []);
});

test('repairs a failed compatibility migration record before marking it applied', () => {
  assert.deepEqual(
    resolutionActions({ finished_at: null, rolled_back_at: null }),
    ['rolled-back', 'applied'],
  );
});

test('re-applies a previously rolled-back compatibility migration record logically', () => {
  assert.deepEqual(
    resolutionActions({ finished_at: null, rolled_back_at: new Date() }),
    ['applied'],
  );
});
