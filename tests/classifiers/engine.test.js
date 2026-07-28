// tests/classifiers/engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyWithChain } = require('../../scripts/classifiers/engine');

test('chain returns human result when matched', async () => {
  const ctx = { title: '임플란트 로봇', sourceSpace: 'Device', ancestors: [], existingLabels: [] };
  const aaTree = { unsortedFolderId: 'u', flat: [], tree: {}, toText: () => '', hasFolder: () => true };
  const result = await classifyWithChain(ctx, aaTree);
  assert.strictEqual(result.source, 'human');
});

test('chain falls back to unsorted folder when no classifier matches', async () => {
  const ctx = { title: '무관한 페이지', sourceSpace: '?', ancestors: [], existingLabels: [] };
  const aaTree = { unsortedFolderId: 'u', flat: [], tree: {}, toText: () => '', hasFolder: () => true };
  // Mark human + rule as miss (skip claude by env)
  delete process.env.ANTHROPIC_API_KEY;
  const result = await classifyWithChain(ctx, aaTree);
  assert.strictEqual(result.source, 'fallback');
  assert.strictEqual(result.folderId, 'u');
  assert.deepStrictEqual(result.labels, ['needs-review']);
});