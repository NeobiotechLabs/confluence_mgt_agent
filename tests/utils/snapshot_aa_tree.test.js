// tests/utils/snapshot_aa_tree.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeSnapshotDiff, buildSnapshot } = require('../../scripts/snapshot_aa_tree');

// ── buildSnapshot ────────────────────────────────────────────────────────────
test('buildSnapshot: folders + pages → snapshot 객체', () => {
  const folders = [
    { id: 'f1', title: '기술문서', parentId: null },
    { id: 'f2', title: '회의록', parentId: null },
  ];
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f2', labels: ['human-classified'] },
  ];
  const snap = buildSnapshot(folders, pages, '2026-07-30T09:00:00+09:00');
  assert.strictEqual(snap.capturedAt, '2026-07-30T09:00:00+09:00');
  assert.strictEqual(snap.folders.length, 2);
  assert.strictEqual(snap.pages.length, 2);
  // 폴더는 id/title/parentId만 보존
  assert.deepStrictEqual(snap.folders[0], { id: 'f1', title: '기술문서', parentId: null });
  // 페이지는 id/title/parentId/labels만 보존
  assert.deepStrictEqual(snap.pages[1], { id: 'p2', title: 'B', parentId: 'f2', labels: ['human-classified'] });
});

// ── computeSnapshotDiff ──────────────────────────────────────────────────────
test('computeSnapshotDiff: 신규 페이지 감지', () => {
  const prev = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [{ id: 'p1', title: 'A', parentId: 'f1', labels: [] }],
    '2026-07-29T09:00:00+09:00',
  );
  const curr = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [
      { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
      { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    ],
    '2026-07-30T09:00:00+09:00',
  );
  const diff = computeSnapshotDiff(prev, curr);
  assert.strictEqual(diff.pagesAdded.length, 1);
  assert.strictEqual(diff.pagesAdded[0].id, 'p2');
  assert.strictEqual(diff.pagesRemoved.length, 0);
  assert.strictEqual(diff.pagesMoved.length, 0);
});

test('computeSnapshotDiff: 삭제된 페이지 감지', () => {
  const prev = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [
      { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
      { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    ],
    '2026-07-29',
  );
  const curr = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [{ id: 'p1', title: 'A', parentId: 'f1', labels: [] }],
    '2026-07-30',
  );
  const diff = computeSnapshotDiff(prev, curr);
  assert.strictEqual(diff.pagesRemoved.length, 1);
  assert.strictEqual(diff.pagesRemoved[0].id, 'p2');
  assert.strictEqual(diff.pagesAdded.length, 0);
});

test('computeSnapshotDiff: 이동된 페이지 감지 (parentId 변경)', () => {
  const prev = buildSnapshot(
    [
      { id: 'f1', title: '기술문서', parentId: null },
      { id: 'f2', title: '회의록', parentId: null },
    ],
    [{ id: 'p1', title: 'A', parentId: 'f1', labels: [] }],
    '2026-07-29',
  );
  const curr = buildSnapshot(
    [
      { id: 'f1', title: '기술문서', parentId: null },
      { id: 'f2', title: '회의록', parentId: null },
    ],
    [{ id: 'p1', title: 'A', parentId: 'f2', labels: [] }],
    '2026-07-30',
  );
  const diff = computeSnapshotDiff(prev, curr);
  assert.strictEqual(diff.pagesMoved.length, 1);
  assert.strictEqual(diff.pagesMoved[0].id, 'p1');
  assert.strictEqual(diff.pagesMoved[0].from, 'f1');
  assert.strictEqual(diff.pagesMoved[0].to, 'f2');
});

test('computeSnapshotDiff: 신규/삭제 폴더 감지', () => {
  const prev = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [],
    '2026-07-29',
  );
  const curr = buildSnapshot(
    [
      { id: 'f1', title: '기술문서', parentId: null },
      { id: 'f2', title: '회의록', parentId: null },
    ],
    [],
    '2026-07-30',
  );
  const diff = computeSnapshotDiff(prev, curr);
  assert.strictEqual(diff.foldersAdded.length, 1);
  assert.strictEqual(diff.foldersAdded[0].id, 'f2');
  assert.strictEqual(diff.foldersRemoved.length, 0);
});

test('computeSnapshotDiff: prev null → 모든 항목이 신규', () => {
  const curr = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [{ id: 'p1', title: 'A', parentId: 'f1', labels: [] }],
    '2026-07-30',
  );
  const diff = computeSnapshotDiff(null, curr);
  assert.strictEqual(diff.pagesAdded.length, 1);
  assert.strictEqual(diff.foldersAdded.length, 1);
  assert.strictEqual(diff.pagesRemoved.length, 0);
  assert.strictEqual(diff.pagesMoved.length, 0);
});

test('computeSnapshotDiff: 변경 없으면 빈 diff', () => {
  const snap = buildSnapshot(
    [{ id: 'f1', title: '기술문서', parentId: null }],
    [{ id: 'p1', title: 'A', parentId: 'f1', labels: [] }],
    '2026-07-30',
  );
  const diff = computeSnapshotDiff(snap, snap);
  assert.strictEqual(diff.pagesAdded.length, 0);
  assert.strictEqual(diff.pagesRemoved.length, 0);
  assert.strictEqual(diff.pagesMoved.length, 0);
  assert.strictEqual(diff.foldersAdded.length, 0);
  assert.strictEqual(diff.foldersRemoved.length, 0);
});
