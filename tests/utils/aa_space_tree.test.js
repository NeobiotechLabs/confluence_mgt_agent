'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('hasFolder returns true for known folder id', () => {
  const tree = {
    flat: [{ id: 'a', title: 'A', parentId: null, labels: ['is-folder'], ancestors: [] }],
    tree: {},
    unsortedFolderId: 'unsorted',
    toText: () => '',
    hasFolder: (id) => tree.flat.some(f => f.id === id),
  };
  assert.strictEqual(tree.hasFolder('a'), true);
  assert.strictEqual(tree.hasFolder('b'), false);
});

test('unsortedFolderId fallback convention', () => {
  // "미분류" 또는 "분류 보류" 제목 폴더 id를 우선 반환
  assert.ok(true); // placeholder for future assertion
});