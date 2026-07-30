// tests/report/unmatched_wireup.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeUnmatchedItems } = require('../../scripts/report_aa_daily');

// ── computeUnmatchedItems ───────────────────────────────────────────────────
// pages 중 unsortedFolderId에 부모가 있는 페이지(=catch_all 흡수 후보)만 검사.
// matchAgainstKnowledgeBase 결과가 null이면 KB가 모르는 페이지 → unmatched.
// ancestors/title을 KB에 넘겨 매칭 시도.
//
// page shape: { id, title, parentId, ancestors: [string,...] }

const KB = {
  rules: [
    { id: 'dn_dynamic_nav', sourceSpace: 'Device', match: { title_patterns: ['^DN_'] } },
    { id: 'catch_all_known', sourceSpace: '*', is_catch_all: true, match: {} },
  ],
};

test('computeUnmatchedItems: KB가 비면 items=[], prevState mutate 없음', () => {
  const pages = [{ id: '1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] }];
  const out = computeUnmatchedItems(pages, { rules: [] }, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.deepStrictEqual(out, []);
});

test('computeUnmatchedItems: pages=[] → items=[]', () => {
  const out = computeUnmatchedItems([], KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.deepStrictEqual(out, []);
});

test('computeUnmatchedItems: unsortedFolderId 외 부모 → 검사 대상 아님 (재정렬 결과는 §3에서 다룸)', () => {
  const pages = [{ id: '1', title: 'DN_캘리브레이션', parentId: 'other', ancestors: [] }];
  const out = computeUnmatchedItems(pages, KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.deepStrictEqual(out, []);
});

test('computeUnmatchedItems: unsorted 부모 + KB 매칭 성공(DN_) → items에 안 들어감', () => {
  const pages = [{ id: '1', title: 'DN_캘리브레이션', parentId: 'u', ancestors: [] }];
  const out = computeUnmatchedItems(pages, KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.deepStrictEqual(out, []);
});

test('computeUnmatchedItems: unsorted 부모 + KB 매칭 실패 → items에 kind:unmatched', () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: ['Smile Design'] },
    { id: 'p2', title: '임의 제목', parentId: 'u', ancestors: [] },
  ];
  const out = computeUnmatchedItems(pages, KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].kind, 'unmatched');
  assert.strictEqual(out[0].fingerprint.length, 12);
  assert.strictEqual(out[0].titleSnapshot, '캘리브레이션 회의록');
  assert.strictEqual(out[0].sourceSpace, '*');
  assert.strictEqual(out[0].seenCount, 1);
  assert.strictEqual(out[0].firstSeen, '2026-07-30');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
});

test('computeUnmatchedItems: prevState와 fingerprint 일치하면 seenCount+1, lastSeen 갱신', () => {
  const pages = [{ id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] }];
  // 동일 fingerprint가 되도록 같은 pageId
  const { fingerprint } = require('../../scripts/report/report_lib');
  const fp = fingerprint('unmatched', 'p1', 'u');
  const prev = [{ fingerprint: fp, seenCount: 3, firstSeen: '2026-07-20', lastSeen: '2026-07-29' }];
  const out = computeUnmatchedItems(pages, KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: prev });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].seenCount, 4);
  assert.strictEqual(out[0].firstSeen, '2026-07-20');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
});

test('computeUnmatchedItems: prevState mutate 금지', () => {
  const pages = [{ id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] }];
  const prev = [{ fingerprint: 'abc', seenCount: 1, firstSeen: '2026-07-29' }];
  computeUnmatchedItems(pages, KB, '2026-07-30',
    { unsortedFolderId: 'u', prevState: prev });
  assert.strictEqual(prev[0].seenCount, 1);
  assert.strictEqual(prev[0].lastSeen, undefined);
});

test('computeUnmatchedItems: sourceSpace는 KB 매칭 결과 catch_all_known이 아닌 경우 → page의 ancestor 추론 불가하므로 unknown', () => {
  // catch_all이 없는 KB에서 매칭 실패 → sourceSpace='unknown'
  const KB_NO_CATCH = { rules: [{ id: 'dn', match: { title_patterns: ['^DN_'] } }] };
  const pages = [{ id: 'p1', title: '회의록', parentId: 'u', ancestors: [] }];
  const out = computeUnmatchedItems(pages, KB_NO_CATCH, '2026-07-30',
    { unsortedFolderId: 'u', prevState: null });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].sourceSpace, 'unknown');
});
