// tests/utils/tree_aa.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatTreeWithCounts, buildFolderPageCounts } = require('../../scripts/tree_aa');

// ── buildFolderPageCounts ────────────────────────────────────────────────────
test('buildFolderPageCounts: 폴더별 직속 페이지 수 집계', () => {
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    { id: 'p3', title: 'C', parentId: 'f2', labels: [] },
    { id: 'p4', title: 'D', parentId: null, labels: [] }, // 최상위
  ];
  const counts = buildFolderPageCounts(pages);
  assert.strictEqual(counts.get('f1'), 2);
  assert.strictEqual(counts.get('f2'), 1);
  assert.strictEqual(counts.get(null), 1);
});

test('buildFolderPageCounts: is-folder/bot-report/auto-report 라벨 페이지 제외', () => {
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: '자동화 리포트', parentId: 'f1', labels: ['bot-report', 'auto-report'] },
    { id: 'p3', title: '하위폴더', parentId: 'f1', labels: ['is-folder'] },
    { id: 'p4', title: 'B', parentId: 'f1', labels: [] },
  ];
  const counts = buildFolderPageCounts(pages);
  assert.strictEqual(counts.get('f1'), 2); // bot-report, is-folder 제외
});

// ── formatTreeWithCounts ─────────────────────────────────────────────────────
test('formatTreeWithCounts: 단순 1단계 트리', () => {
  const tree = [
    { id: 'f1', title: '기술문서', children: [] },
    { id: 'f2', title: '회의록', children: [] },
  ];
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    { id: 'p3', title: 'C', parentId: 'f2', labels: [] },
  ];
  const text = formatTreeWithCounts(tree, pages);
  assert.ok(text.includes('기술문서 (2)'), '기술문서 폴더 페이지 수');
  assert.ok(text.includes('회의록 (1)'), '회의록 폴더 페이지 수');
});

test('formatTreeWithCounts: 중첩 폴더 — 자식 폴더 수 + 직속 페이지 수', () => {
  const tree = [
    {
      id: 'f1', title: '기술문서', children: [
        { id: 'f1a', title: 'MPS', children: [] },
        { id: 'f1b', title: '하드웨어', children: [] },
      ],
    },
  ];
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    { id: 'p3', title: 'C', parentId: 'f1a', labels: [] },
    { id: 'p4', title: 'D', parentId: 'f1a', labels: [] },
    { id: 'p5', title: 'E', parentId: 'f1a', labels: [] },
  ];
  const text = formatTreeWithCounts(tree, pages);
  // 기술문서: 직속 2 + 하위폴더 2개
  assert.ok(text.includes('기술문서'), '기술문서 포함');
  assert.ok(text.includes('MPS (3)'), 'MPS 3페이지');
  assert.ok(text.includes('하드웨어 (0)'), '하드웨어 0페이지');
});

test('formatTreeWithCounts: 빈 트리에서 빈 문자열', () => {
  assert.strictEqual(formatTreeWithCounts([], []), '');
});

test('formatTreeWithCounts: 최상위 고아 페이지 표시', () => {
  const tree = [
    { id: 'f1', title: '기술문서', children: [] },
  ];
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: '고아1', parentId: null, labels: [] },
    { id: 'p3', title: '고아2', parentId: null, labels: [] },
  ];
  const text = formatTreeWithCounts(tree, pages);
  assert.ok(text.includes('고아 페이지 (2)'), '최상위 고아 페이지 수');
});

test('formatTreeWithCounts: 3단계 중첩', () => {
  const tree = [
    {
      id: 'f1', title: 'L1', children: [
        {
          id: 'f2', title: 'L2', children: [
            { id: 'f3', title: 'L3', children: [] },
          ],
        },
      ],
    },
  ];
  const pages = [
    { id: 'p1', title: 'X', parentId: 'f3', labels: [] },
  ];
  const text = formatTreeWithCounts(tree, pages);
  assert.ok(text.includes('L3 (1)'), '3단계 폴더에 페이지 수');
  assert.ok(text.includes('L2'), '2단계 폴더 표시');
  assert.ok(text.includes('L1'), '1단계 폴더 표시');
});

test('formatTreeWithCounts: 총합 라인 포함', () => {
  const tree = [
    { id: 'f1', title: 'A', children: [] },
  ];
  const pages = [
    { id: 'p1', title: 'X', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'Y', parentId: 'f1', labels: [] },
  ];
  const text = formatTreeWithCounts(tree, pages);
  assert.ok(text.includes('총'), '총합 라인');
  assert.ok(text.includes('2'), '총 페이지 수');
});
