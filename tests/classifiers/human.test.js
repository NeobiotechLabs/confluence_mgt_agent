// tests/classifiers/human.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { humanClassifier } = require('../../scripts/classifiers/human');

test('human policy matches by titleRegex', async () => {
  const ctx = {
    pageId: '1', title: '임플란트 로봇 spec',
    body: '', ancestors: [], sourceSpace: 'Device', sourceUrl: '',
    pageDate: '2026-07-28', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => true };
  const result = await humanClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'human');
  assert.strictEqual(result.folderId, 'target-folder');
});

test('human policy returns miss when no match', async () => {
  const ctx = {
    pageId: '2', title: '완전히 무관한 페이지',
    body: '', ancestors: [], sourceSpace: 'SD', sourceUrl: '',
    pageDate: '2026-07-28', existingLabels: [],
  };
  const aaTree = { flat: [], tree: {}, unsortedFolderId: null, toText: () => '', hasFolder: () => true };
  const result = await humanClassifier.classify(ctx, aaTree);
  assert.strictEqual(result.ok, false);
});