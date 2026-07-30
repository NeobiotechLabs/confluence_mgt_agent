// tests/report/orchestrator_kb_unknown.test.js
'use strict';
// 작업 9 (Phase 3) — KB 모르는 페이지 자리표시 TDD.
// 정책: reference/classification_rules.md §8 (사용자 결정 2026-07-30).
//
// runKbUnknownTrack(opts) — 오케스트레이터가 §4 자리표시 + 부록 머지를 위해 호출.
//   opts:
//     pages:          listAAPages() 결과 (parentId 포함)
//     history:        직전 부록 items 중 kind:'kb-unknown'만 추출한 배열 (seenCount/firstSeen 승계)
//     todayStr:       'YYYY-MM-DD' (KST)
//     kb:             config/analysis_rules.json 파싱 결과
//     unsortedFolderId: 'unsorted' 등 카테고리 룰 외 폴더 ID
//     advisories:     mutable — 자리표시 있으면 advisory 1줄 push
//   동작:
//     각 page에 대해:
//       - page.id 없으면 skip
//       - page.parentId === unsortedFolderId → skip (자리표시 영역 밖)
//       - KB categoryOf(page) !== null → skip (Phase 2-A 의심 진입)
//       - else: kind:'kb-unknown' 항목 push (seenCount=1 or prev+1, firstSeen 보존)
//     out.length > 0 이면 advisories에 "ℹ️ KB 미분류 자리표시 N건 — 룰 추가 검토 필요" 1줄 push.
//   순수 함수 — 네트워크/디스크 호출 없음.

const test = require('node:test');
const assert = require('node:assert');
const { runKbUnknownTrack } = require('../../scripts/report_aa_daily');

test('RED — pages가 빈 배열이면 빈 배열 반환, advisory push 없음', () => {
  const advisories = [];
  const out = runKbUnknownTrack({
    pages: [],
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [] },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB가 카테고리 아는 페이지는 자리표시 안 함 (Phase 2-A 의심 진입)', () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB가 모르는 페이지 1건 + parentId가 unsortedFolderId면 자리표시도 안 함', () => {
  const pages = [
    { id: 'p1', title: '알수없는 페이지', parentId: 'F-UNS', labels: [] },
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [] }, // KB 없음
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  // unsorted 자체는 자리표시 영역 밖 (잡음 방지)
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB가 모르는 페이지 1건 → kind:"kb-unknown" 1건 + advisory 1줄', () => {
  const pages = [
    { id: 'p1', title: '잡지식 페이지', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [] }, // KB 없음 → 모두 모름
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'kb-unknown');
  assert.strictEqual(out[0].pageId, 'p1');
  assert.strictEqual(out[0].title, '잡지식 페이지');
  assert.strictEqual(out[0].currentFolderId, 'F-B');
  assert.strictEqual(out[0].seenCount, 1);
  assert.strictEqual(out[0].firstSeen, '2026-07-30');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
  assert.strictEqual(out[0].fingerprint.length, 12); // sha1 앞 12자
  assert.strictEqual(advisories.length, 1);
  assert.ok(advisories[0].includes('KB 미분류'));
  assert.ok(advisories[0].includes('1건'));
});

test('RED — 직전 history와 fingerprint 매칭 시 seenCount+1, firstSeen 보존', () => {
  const pages = [
    { id: 'p1', title: '잡지식 페이지', parentId: 'F-B', labels: [] },
  ];
  const { fingerprint } = require('../../scripts/report/report_lib');
  const fp = fingerprint('kb-unknown', 'p1', 'F-B');
  const history = [
    { kind: 'kb-unknown', pageId: 'p1', fingerprint: fp, seenCount: 2, firstSeen: '2026-07-28', lastSeen: '2026-07-29' },
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history,
    todayStr: '2026-07-30',
    kb: { rules: [] },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].seenCount, 3);
  assert.strictEqual(out[0].firstSeen, '2026-07-28');
});

test('RED — page.id 없으면 skip', () => {
  const pages = [
    { title: 'no-id', parentId: 'F-B', labels: [] },
    { id: '', title: 'empty-id', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [] },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB 모르는 페이지 N건 모두 자리표시 + advisory 1줄 (요약)', () => {
  const pages = [
    { id: 'p1', title: '잡1', parentId: 'F-B', labels: [] },
    { id: 'p2', title: '잡2', parentId: 'F-C', labels: [] },
    { id: 'p3', title: '캘리브 회의록', parentId: 'F-D', labels: [] }, // KB 매칭 → skip
  ];
  const advisories = [];
  const out = runKbUnknownTrack({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(advisories.length, 1);
  assert.ok(advisories[0].includes('2건'));
});
