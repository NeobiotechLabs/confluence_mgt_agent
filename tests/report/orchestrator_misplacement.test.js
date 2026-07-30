// tests/report/orchestrator_misplacement.test.js
'use strict';
// 작업 9 (Phase 2-A) — 오케스트레이터 §4 와이어업 TDD.
// 정책: reference/classification_rules.md §8 (사용자 결정 2026-07-30).
//
// runMisplacementRecommend(opts) — 오케스트레이터가 §4 AI 권고판을 위해 호출하는 헬퍼.
//   opts:
//     pages:          listAAPages() 결과 (parentId 포함)
//     history:        직전 부록 items 중 kind:'misplacement-suspect' 만 추출한 배열
//     todayStr:       'YYYY-MM-DD' (KST)
//     kb:             config/analysis_rules.json 파싱 결과
//     llmResults:     { [pageId]: { folderId, source, reason } } — classifyWithChain 결과
//     unsortedFolderId: 'unsorted' 등 카테고리 룰 외 폴더 ID (있으면 의심 대상에서 제외)
//     confidenceThreshold?: 0.5 기본
//   동작:
//     각 page에 대해:
//       - page.parentId === unsortedFolderId → skip (unsorted는 매칭 영역 밖)
//       - KB categoryOf(page) === null → skip (KB가 모르는 페이지 = 카테고리 자체 제안 = Phase 3 자리표시)
//       - KB categoryOf(page) === page.parentId → skip (이미 일치)
//       - else: recommendMisplacements 호출 → confidence ≥ threshold 면 advisory로 push
//     advisories (mutable) 에 push된 misplacement-suspect 객체를 반환.
//   부수효과: advisories.push() 만 한다. 디스크/네트워크 호출 없음.
const test = require('node:test');
const assert = require('node:assert');
const { runMisplacementRecommend } = require('../../scripts/report_aa_daily');

test('RED — pages가 빈 배열이면 빈 배열 반환, advisory push 없음', async () => {
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages: [],
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A' }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB 카테고리 = 현재 parentId면 의심 없음', async () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-A', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'rule', reason: '정확히 일치' } },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — KB 카테고리 ≠ parentId + confidence ≥ 0.5면 misplacement-suspect 1건 advisory push', async () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'inline-llm', reason: '제목이 정확히 일치' } },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'misplacement-suspect');
  assert.strictEqual(out[0].pageId, 'p1');
  assert.strictEqual(out[0].currentFolderId, 'F-B');
  assert.strictEqual(out[0].suggestedFolderId, 'F-A');
  assert.strictEqual(out[0].confidence, 0.85); // 0.5 + 0.35 (정확히)
  assert.strictEqual(advisories.length, 1);
  assert.strictEqual(advisories[0].pageId, 'p1');
});

test('RED — confidence < 0.5면 잡음 제거 (advisory push 없음)', async () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'inline-llm', reason: '불확실, 분류 불가' } },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — 직전 history(prev)와 fingerprint 매칭 시 seenCount 승계, firstSeen 보존', async () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', labels: [] },
  ];
  const { fingerprint } = require('../../scripts/report/report_lib');
  const fp = fingerprint('misplacement-suspect', 'p1', 'F-B');
  const history = [
    { kind: 'misplacement-suspect', pageId: 'p1', fingerprint: fp, seenCount: 2, firstSeen: '2026-07-28', lastSeen: '2026-07-29' },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history,
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'inline-llm', reason: '정확히' } },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].seenCount, 3);
  assert.strictEqual(out[0].firstSeen, '2026-07-28');
});

test('RED — KB가 모르는 페이지(category=null)면 의심에서 제외 (Phase 3 자리표시 영역)', async () => {
  const pages = [
    { id: 'p1', title: '잡지식 페이지', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [] }, // 룰 없음 → catch_all도 없음
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — parentId가 unsortedFolderId면 skip (unsorted는 의심 영역 밖)', async () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-UNS', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'inline-llm', reason: '정확히' } },
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});

test('RED — page.id 없으면 skip (잘못된 입력 방어)', async () => {
  const pages = [
    { title: 'no-id', parentId: 'F-B', labels: [] },
    { id: '', title: 'empty-id', parentId: 'F-B', labels: [] },
  ];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['.*'] } }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
  });
  assert.deepStrictEqual(out, []);
  assert.strictEqual(advisories.length, 0);
});
