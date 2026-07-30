// tests/report/stamp_last_parent.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { stampLastParent, detectMove } = require('../../scripts/audit_aa_space');

function makeDeps() {
  const calls = { deleted: [], posted: [] };
  return {
    calls,
    deps: {
      deleteLabel: async (pid, name) => { calls.deleted.push([pid, name]); },
      postLabel: async (pid, name) => { calls.posted.push([pid, name]); },
    },
  };
}

test('stampLastParent: removes stale last-parent-* then posts current', async () => {
  const { calls, deps } = makeDeps();
  await stampLastParent('p1', '222', ['last-parent-111', 'is-folder'], deps);
  assert.deepStrictEqual(calls.deleted, [['p1', 'last-parent-111']]);
  assert.deepStrictEqual(calls.posted, [['p1', 'last-parent-222']]);
});

test('stampLastParent: already correct → no delete, no post', async () => {
  const { calls, deps } = makeDeps();
  await stampLastParent('p1', '222', ['last-parent-222'], deps);
  assert.deepStrictEqual(calls.deleted, []);
  assert.deepStrictEqual(calls.posted, []);
});

test('stampLastParent: no label → posts only', async () => {
  const { calls, deps } = makeDeps();
  await stampLastParent('p1', '222', [], deps);
  assert.deepStrictEqual(calls.deleted, []);
  assert.deepStrictEqual(calls.posted, [['p1', 'last-parent-222']]);
});

test('stampLastParent: multiple stale labels all removed', async () => {
  const { calls, deps } = makeDeps();
  await stampLastParent('p1', '3', ['last-parent-1', 'last-parent-2', 'human-classified'], deps);
  assert.deepStrictEqual(calls.deleted.sort(), [['p1', 'last-parent-1'], ['p1', 'last-parent-2']]);
  assert.deepStrictEqual(calls.posted, [['p1', 'last-parent-3']]);
});

test('detectMove: label differs from parentId → move; same → null', () => {
  assert.deepStrictEqual(
    detectMove({ labels: ['last-parent-111'], parentId: '222' }),
    { from: '111', to: '222' });
  assert.strictEqual(detectMove({ labels: ['last-parent-222'], parentId: '222' }), null);
  assert.strictEqual(detectMove({ labels: [], parentId: '222' }), null);
});
