// tests/classifiers/rule.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ruleClassifier } = require('../../scripts/classifiers/rule');

test('rule matcher returns ok for known category', async () => {
  const ctx = {
    pageId: '1', title: 'MPS 2026-06 보고',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-06-15', existingLabels: [],
  };
  const aaTree = {
    flat: [{ id: 'f1', title: 'MPS 이력 (전사)', parentId: null, labels: ['is-folder'], ancestors: [] }],
    tree: {}, unsortedFolderId: 'f1', toText: () => '', hasFolder: () => true,
  };
  const result = await ruleClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'rule');
});

test('rule matcher returns ok:false for dailyScrum', async () => {
  const ctx = {
    pageId: '2', title: 'Daily Scrum 2026-06-01',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-06-01', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => false };
  const result = await ruleClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, false);
});