// tests/report/match_kb.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  matchAgainstKnowledgeBase,
  findUnmatchedPages,
} = require('../../scripts/report/report_lib');

// ── matchAgainstKnowledgeBase ───────────────────────────────────────────────
// KB의 §0 common rule + §N 섹션 룰 layer를 따라 페이지 매칭.
// 카테고리 매칭 결과({categoryId, sourceSpace, labelsTemplate, doctype}) 또는 null.
test('matchAgainstKnowledgeBase: empty rules / empty page → null', () => {
  assert.strictEqual(
    matchAgainstKnowledgeBase({ title: 't', ancestors: [] }, { rules: [] }),
    null
  );
  assert.strictEqual(
    matchAgainstKnowledgeBase(null, { rules: [{ id: 'a' }] }),
    null
  );
});

test('matchAgainstKnowledgeBase: title_patterns (DN_) → dn_dynamic_nav 카테고리 매칭', () => {
  const rules = {
    rules: [
      {
        id: 'dn_dynamic_nav',
        sourceSpace: 'Device',
        match: { title_patterns: ['DN_'] },
        exclude: null,
      },
    ],
  };
  const hit = matchAgainstKnowledgeBase(
    { title: 'DN_캘리브레이션 시나리오', ancestors: [] },
    rules
  );
  assert.ok(hit, 'expected a match');
  assert.strictEqual(hit.categoryId, 'dn_dynamic_nav');
  assert.strictEqual(hit.sourceSpace, 'Device');
});

test('matchAgainstKnowledgeBase: catch_all은 명시적 카테고리 매칭이 실패한 페이지에만 적용', () => {
  const rules = {
    rules: [
      {
        id: 'dn_dynamic_nav',
        sourceSpace: 'Device',
        match: { title_patterns: ['^DN_'] },
      },
      {
        id: 'catch_all_known',
        is_catch_all: true,
        sourceSpace: '*',
        match: {},
      },
    ],
  };
  // 카테고리 매칭 실패 → catch_all 흡수
  const a = matchAgainstKnowledgeBase(
    { title: '개별 치아 세그멘테이션 파이프라인', ancestors: [] },
    rules
  );
  assert.ok(a);
  assert.strictEqual(a.categoryId, 'catch_all_known');

  // 카테고리 매칭 성공 → catch_all 적용 안 됨
  const b = matchAgainstKnowledgeBase(
    { title: 'DN_캘리브레이션', ancestors: [] },
    rules
  );
  assert.ok(b);
  assert.strictEqual(b.categoryId, 'dn_dynamic_nav');
});

test('matchAgainstKnowledgeBase: exclude(title_patterns) → 매칭 거부 → catch_all 흡수', () => {
  const rules = {
    rules: [
      {
        id: 'org_ai_strategy',
        sourceSpace: 'SD',
        match: { title_patterns: ['RAG', 'Fine-tuning'] },
        exclude: { title_patterns: ['회의록'] },
      },
      {
        id: 'catch_all_known',
        is_catch_all: true,
        sourceSpace: '*',
        match: {},
      },
    ],
  };
  // "회의록"은 exclude → 카테고리 매칭 실패 → catch_all
  const a = matchAgainstKnowledgeBase(
    { title: 'RAG 전략 회의록', ancestors: [] }, rules);
  assert.strictEqual(a.categoryId, 'catch_all_known');

  // exclude에 안 걸리면 카테고리 매칭 성공
  const b = matchAgainstKnowledgeBase(
    { title: 'RAG 운영 가이드', ancestors: [] }, rules);
  assert.strictEqual(b.categoryId, 'org_ai_strategy');
});

test('matchAgainstKnowledgeBase: ancestor_contains → 매칭', () => {
  const rules = {
    rules: [
      {
        id: 'dn_dynamic_nav',
        sourceSpace: 'Device',
        match: {
          any: [
            { ancestor_contains: 'DN_Dynamic Navigation' },
            { title_patterns: ['^DN_'] },
          ],
        },
      },
    ],
  };
  const hit = matchAgainstKnowledgeBase(
    { title: '아무거나', ancestors: ['DN_Dynamic Navigation', 'WND', '캘리브레이션'] },
    rules
  );
  assert.ok(hit);
  assert.strictEqual(hit.categoryId, 'dn_dynamic_nav');
});

// ── findUnmatchedPages ──────────────────────────────────────────────────────
// fingerprint 기준 prev 머지. seenCount·firstSeen·lastSeen 보존.
test('findUnmatchedPages: prev null → 모두 신규 (seenCount=1, firstSeen=todayStr)', () => {
  const cur = [
    { fingerprint: 'fp1', title: 'A' },
    { fingerprint: 'fp2', title: 'B' },
  ];
  const out = findUnmatchedPages(cur, null, '2026-07-30');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].seenCount, 1);
  assert.strictEqual(out[0].firstSeen, '2026-07-30');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
  assert.strictEqual(out[1].fingerprint, 'fp2');
});

test('findUnmatchedPages: prev와 일치하는 fp는 seenCount + 1, lastSeen 갱신', () => {
  const cur = [{ fingerprint: 'fp1', title: 'A' }];
  const prev = [{ fingerprint: 'fp1', seenCount: 4, firstSeen: '2026-07-20' }];
  const out = findUnmatchedPages(cur, prev, '2026-07-30');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].seenCount, 5);
  assert.strictEqual(out[0].firstSeen, '2026-07-20');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
});

test('findUnmatchedPages: prev에만 있는 fingerprint는 제거 (append-only 머지이지만 out은 cur 한정)', () => {
  const cur = [{ fingerprint: 'fp1', title: 'A' }];
  const prev = [
    { fingerprint: 'fp1', seenCount: 2 },
    { fingerprint: 'orphan', seenCount: 7 }, // 오늘 매칭 안 됨 → out에서 빠짐
  ];
  const out = findUnmatchedPages(cur, prev, '2026-07-30');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].fingerprint, 'fp1');
});

test('findUnmatchedPages: 입력 비변형 (cur/prev mutate 금지)', () => {
  const cur = [{ fingerprint: 'fp1', title: 'A' }];
  const prev = [{ fingerprint: 'fp1', seenCount: 2, firstSeen: '2026-07-20' }];
  findUnmatchedPages(cur, prev, '2026-07-30');
  assert.strictEqual(cur[0].seenCount, undefined);
  assert.strictEqual(prev[0].seenCount, 2);
});
