// tests/utils/find_unmigrated.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findUnmigratedPages, filterByDateRange } = require('../../scripts/find_unmigrated');

// ── filterByDateRange ────────────────────────────────────────────────────────
test('filterByDateRange: 생성일 기준 범위 필터', () => {
  const pages = [
    { id: '1', title: 'A', createdDate: '2025-03-15T10:00:00Z' },
    { id: '2', title: 'B', createdDate: '2025-06-01T10:00:00Z' },
    { id: '3', title: 'C', createdDate: '2024-12-01T10:00:00Z' },
    { id: '4', title: 'D', createdDate: '2026-01-15T10:00:00Z' },
  ];
  const result = filterByDateRange(pages, '2025-01-01', '2025-12-31');
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(r => r.id).sort(), ['1', '2']);
});

test('filterByDateRange: from만 지정 → from 이후 모두', () => {
  const pages = [
    { id: '1', title: 'A', createdDate: '2024-06-01T10:00:00Z' },
    { id: '2', title: 'B', createdDate: '2025-06-01T10:00:00Z' },
    { id: '3', title: 'C', createdDate: '2026-06-01T10:00:00Z' },
  ];
  const result = filterByDateRange(pages, '2025-01-01', null);
  assert.strictEqual(result.length, 2);
});

test('filterByDateRange: 빈 배열 → 빈 결과', () => {
  assert.deepStrictEqual(filterByDateRange([], '2025-01-01', '2025-12-31'), []);
});

// ── findUnmigratedPages ─────────────────────────────────────────────────────
test('findUnmigratedPages: 제목 기준 AA에 없는 페이지 탐색', () => {
  const sourcePages = [
    { id: 's1', title: '이관됨', createdDate: '2025-03-01T00:00:00Z' },
    { id: 's2', title: '누락됨', createdDate: '2025-04-01T00:00:00Z' },
    { id: 's3', title: '이관됨2', createdDate: '2025-05-01T00:00:00Z' },
  ];
  const aaTitles = new Set(['이관됨', '이관됨2', '다른AA페이지']);
  const result = findUnmigratedPages(sourcePages, aaTitles);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].title, '누락됨');
});

test('findUnmigratedPages: 모두 이관되면 빈 결과', () => {
  const sourcePages = [
    { id: 's1', title: 'A', createdDate: '2025-03-01T00:00:00Z' },
    { id: 's2', title: 'B', createdDate: '2025-04-01T00:00:00Z' },
  ];
  const aaTitles = new Set(['A', 'B']);
  assert.deepStrictEqual(findUnmigratedPages(sourcePages, aaTitles), []);
});

test('findUnmigratedPages: 빈 소스 → 빈 결과', () => {
  assert.deepStrictEqual(findUnmigratedPages([], new Set(['A'])), []);
});

test('findUnmigratedPages: 특수문자 제목도 매칭', () => {
  const sourcePages = [
    { id: 's1', title: 'MPS_v1.0 (최종)', createdDate: '2025-03-01T00:00:00Z' },
  ];
  const aaTitles = new Set(['MPS_v1.0 (최종)']);
  assert.deepStrictEqual(findUnmigratedPages(sourcePages, aaTitles), []);
});
