// tests/utils/delete_aa_before.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  extractOriginalDate,
  filterDeleteCandidates,
  PROTECTED_LABELS,
} = require('../../scripts/delete_aa_before');

// ── extractOriginalDate ──────────────────────────────────────────────────────
test('extractOriginalDate: 배너 HTML에서 YYYY-MM-DD 추출', () => {
  const html = `
    <table>
      <tr><td><strong>원본 작성일</strong></td><td>2024-03-15</td></tr>
      <tr><td><strong>이관/동기화일</strong></td><td>2026-07-29</td></tr>
    </table>`;
  assert.strictEqual(extractOriginalDate(html), '2024-03-15');
});

test('extractOriginalDate: 배너 없으면 null', () => {
  assert.strictEqual(extractOriginalDate('<p>일반 페이지</p>'), null);
  assert.strictEqual(extractOriginalDate(''), null);
  assert.strictEqual(extractOriginalDate(null), null);
});

test('extractOriginalDate: 날짜 형식 아니면 null', () => {
  const html = '<tr><td><strong>원본 작성일</strong></td><td>(날짜 정보 없음)</td></tr>';
  assert.strictEqual(extractOriginalDate(html), null);
});

test('extractOriginalDate: HTML 엔티티 포함이어도 추출', () => {
  const html = '<tr><td><strong>원본 작성일</strong></td><td>2025-12-31</td></tr>';
  assert.strictEqual(extractOriginalDate(html), '2025-12-31');
});

test('extractOriginalDate: 원본 작성일 없으면 원본 최종수정일 추출 (공백 없음)', () => {
  const html = `
    <table>
      <tr><td><strong>원본 최종수정일</strong></td><td>2025-08-20</td></tr>
      <tr><td><strong>이관/동기화일</strong></td><td>2026-07-29</td></tr>
    </table>`;
  assert.strictEqual(extractOriginalDate(html), '2025-08-20');
});

test('extractOriginalDate: 원본 최종 수정일 (공백 있음)도 추출', () => {
  const html = '<tr><td><strong>원본 최종 수정일</strong></td><td>2025-08-20</td></tr>';
  assert.strictEqual(extractOriginalDate(html), '2025-08-20');
});

test('extractOriginalDate: 원본 작성일이 원본 최종수정일보다 우선', () => {
  const html = `
    <table>
      <tr><td><strong>원본 작성일</strong></td><td>2024-01-15</td></tr>
      <tr><td><strong>원본 최종수정일</strong></td><td>2025-08-20</td></tr>
    </table>`;
  assert.strictEqual(extractOriginalDate(html), '2024-01-15');
});

// ── filterDeleteCandidates ───────────────────────────────────────────────────
test('filterDeleteCandidates: 보호 라벨 있으면 제외', () => {
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: ['is-folder'] },
    { id: 'p3', title: 'C', parentId: 'f1', labels: ['bot-report'] },
    { id: 'p4', title: 'D', parentId: 'f1', labels: ['auto-report'] },
    { id: 'p5', title: 'E', parentId: 'f1', labels: ['human-classified'] },
  ];
  const result = filterDeleteCandidates(pages, new Map([
    ['p1', '2024-01-01'],
    ['p2', '2024-01-01'],
    ['p3', '2024-01-01'],
    ['p4', '2024-01-01'],
    ['p5', '2024-01-01'],
  ]), '2026-01-01');
  // p1만 보호 라벨 없음 → 삭제 후보
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'p1');
});

test('filterDeleteCandidates: 원본 작성일 < beforeDate만 삭제', () => {
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
    { id: 'p3', title: 'C', parentId: 'f1', labels: [] },
  ];
  const dateMap = new Map([
    ['p1', '2024-06-15'],
    ['p2', '2025-06-15'],
    ['p3', '2026-06-15'],
  ]);
  const result = filterDeleteCandidates(pages, dateMap, '2026-01-01');
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(r => r.id).sort(), ['p1', 'p2']);
});

test('filterDeleteCandidates: 날짜 추출 실패(null)면 제외', () => {
  const pages = [
    { id: 'p1', title: 'A', parentId: 'f1', labels: [] },
    { id: 'p2', title: 'B', parentId: 'f1', labels: [] },
  ];
  const dateMap = new Map([
    ['p1', '2024-01-01'],
    // p2는 dateMap에 없음 (날짜 추출 실패)
  ]);
  const result = filterDeleteCandidates(pages, dateMap, '2026-01-01');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'p1');
});

test('filterDeleteCandidates: 빈 페이지 → 빈 결과', () => {
  assert.deepStrictEqual(filterDeleteCandidates([], new Map(), '2026-01-01'), []);
});

test('PROTECTED_LABELS: 보호 라벨 목록 확인', () => {
  assert.ok(PROTECTED_LABELS.has('is-folder'));
  assert.ok(PROTECTED_LABELS.has('bot-report'));
  assert.ok(PROTECTED_LABELS.has('auto-report'));
  assert.ok(PROTECTED_LABELS.has('human-classified'));
});
