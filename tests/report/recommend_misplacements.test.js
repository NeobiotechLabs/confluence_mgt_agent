// tests/report/recommend_misplacements.test.js
'use strict';
// 작업 9 (Phase 2-A) — §4 AI 권고판.
// 3개 신규 함수: computeConfidenceScore / selectRepeatAmbiguous / recommendMisplacements.
// 정책 = reference/classification_rules.md §8 (사용자 결정 2026-07-30).
const test = require('node:test');
const assert = require('node:assert');
const {
  computeConfidenceScore,
  selectRepeatAmbiguous,
  recommendMisplacements,
} = require('../../scripts/report/report_lib');

// ── computeConfidenceScore — 키워드 가중치 (reference/classification_rules.md §8-2) ─
//   어휘: 정확히/일치/정확/매칭됨 → +0.35
//        유사/probably/likely → +0.20
//        maybe/could be/아마/모호 → +0.05
//        불확실/unknown/분류 불가 → -0.20
//   confidence = clamp(0, 1, base 0.5 + Σ가중치)
//   입력 reason이 빈 문자열/비문자열이어도 크래시 없이 점수만 반환.

test('RED 1 — reason에 "정확히"가 들어가면 high score(0.85)를 반환', () => {
  // 가장 작은 시나리오: 단일 어휘 1개만 매칭 → 0.5 + 0.35 = 0.85
  const score = computeConfidenceScore('이 폴더가 정확히 매칭되는 것 같습니다');
  assert.strictEqual(score, 0.85);
});

test('RED 2 — 여러 어휘 합산: "정확히" + "유사" → 0.5 + 0.35 + 0.20 = 1.05 → clamp(1.0)', () => {
  const score = computeConfidenceScore('제목이 정확히 일치, 내용도 유사합니다');
  assert.strictEqual(score, 1.0);
});

test('RED 3 — 음수 가산 + clamp: "불확실" → 0.5 - 0.20 = 0.30', () => {
  const score = computeConfidenceScore('카테고리 분류가 불확실합니다');
  assert.strictEqual(score, 0.30);
});

test('RED 4 — 모든 키워드 매칭 (positive): 정확히 + 일치 + 유사 = +0.90 → clamp(1.0)', () => {
  const score = computeConfidenceScore('제목이 정확히 일치하고 내용도 유사함');
  assert.strictEqual(score, 1.0);
});

test('RED 5 — negative 1회만 가산: "분류 불가" 또는 "불확실" 중 하나만 있어도 -0.20 → 0.30 (같은 그룹 중복 X)', () => {
  // 정책 결정(§8-2): 어휘 가중치는 "각 어휘"가 아니라 "어휘 그룹" 단위로 1회 가산.
  // '분류 불가' 또는 '불확실' 어느 하나만 잡혀도 -0.20, 둘 다 잡혀도 -0.20.
  const a = computeConfidenceScore('분류 불가, 불확실한 항목');
  const b = computeConfidenceScore('분류 불가');
  const c = computeConfidenceScore('불확실');
  assert.strictEqual(a, 0.30);
  assert.strictEqual(b, 0.30);
  assert.strictEqual(c, 0.30);
});

test('RED 6 — 키워드 없음 → base 0.5 (중립 의심)', () => {
  const score = computeConfidenceScore('그냥 카테고리에 넣어두면 어떨까요');
  assert.strictEqual(score, 0.5);
});

test('RED 7 — 영어 어휘 혼합: "probably" + "could be" → 0.5 + 0.20 + 0.05 = 0.75', () => {
  const score = computeConfidenceScore('This page probably belongs here, could be moved');
  assert.strictEqual(score, 0.75);
});

test('RED 8 — 빈 문자열/비문자열은 base 0.5로 안전 처리 (크래시 금지)', () => {
  assert.strictEqual(computeConfidenceScore(''), 0.5);
  assert.strictEqual(computeConfidenceScore(null), 0.5);
  assert.strictEqual(computeConfidenceScore(undefined), 0.5);
  assert.strictEqual(computeConfidenceScore(42), 0.5);
});

// ── selectRepeatAmbiguous — seenCount >= threshold 필터 ──────────────────────
//   입력 items 중 seenCount >= threshold 인 것만 반환.
//   threshold는 정수(기본 3, 사용자 결정 2026-07-30).

test('RED 9 — seenCount가 threshold 미만인 항목은 제외', () => {
  const items = [
    { fingerprint: 'a', seenCount: 1 },
    { fingerprint: 'b', seenCount: 2 },
  ];
  const out = selectRepeatAmbiguous(items, 3);
  assert.deepStrictEqual(out, []);
});

test('RED 10 — seenCount가 threshold 이상인 항목만 보존 (seenCount 그대로)', () => {
  const items = [
    { fingerprint: 'a', seenCount: 1 },
    { fingerprint: 'b', seenCount: 3 },
    { fingerprint: 'c', seenCount: 5 },
  ];
  const out = selectRepeatAmbiguous(items, 3);
  assert.deepStrictEqual(out.map(x => x.fingerprint), ['b', 'c']);
  assert.strictEqual(out[0].seenCount, 3);
  assert.strictEqual(out[1].seenCount, 5);
});

test('RED 11 — 빈 배열 입력은 빈 배열 반환', () => {
  assert.deepStrictEqual(selectRepeatAmbiguous([], 3), []);
});

// ── recommendMisplacements — 오배치 의심 항목 구성 ───────────────────────────
//   입력: pages = [{id, title, parentId, ancestors}], history = 직전 advisories 중 misplacement-suspect 배열
//   출력: kind:'misplacement-suspect' 항목 배열
//   각 항목에 confidence, confidenceReason, seenCount(firstSeen/lastSeen), firstSeen, lastSeen
//   "추천 폴더"는 입력의 parentId ≠ KB 매칭 카테고리 폴더일 때만 생성.
//   이 테스트 단계에서는 "어떤 폴더를 추천할지"의 입력(예: categoryId)이 명시되지 않은 기본 케이스만 검증.

test('RED 12 — pages 비어있으면 빈 배열 반환', () => {
  const out = recommendMisplacements([], [], { todayStr: '2026-07-30' });
  assert.deepStrictEqual(out, []);
});

test('RED 13 — 페이지가 KB 카테고리 매칭과 동일 폴더에 있으면 권고 안 함', () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-A', ancestors: [] },
  ];
  // history/추천 폴더: p1이 F-A에 있고 카테고리도 F-A → 불일치 아님
  const out = recommendMisplacements(pages, [], {
    todayStr: '2026-07-30',
    categoryOf: (page) => page.parentId, // 카테고리 = 현재 폴더 → 일치
    suggestedFolderFor: () => 'F-A',
    reasonFor: () => '정확히',
  });
  assert.deepStrictEqual(out, []);
});

test('RED 14 — 카테고리와 현재 폴더가 다르면 권고 항목 생성 (kind, confidence, seenCount=1)', () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', ancestors: [] },
  ];
  const out = recommendMisplacements(pages, [], {
    todayStr: '2026-07-30',
    categoryOf: () => 'F-A',
    suggestedFolderFor: () => 'F-A',
    reasonFor: () => '제목이 정확히 일치, 내용도 유사함',
  });
  assert.strictEqual(out.length, 1);
  const r = out[0];
  assert.strictEqual(r.kind, 'misplacement-suspect');
  assert.strictEqual(r.pageId, 'p1');
  assert.strictEqual(r.title, '캘리브레이션 회의록');
  assert.strictEqual(r.currentFolderId, 'F-B');
  assert.strictEqual(r.suggestedFolderId, 'F-A');
  assert.strictEqual(r.confidence, 1.0); // 정확히 + 유사 = +0.55 → clamp 1.0
  assert.strictEqual(r.seenCount, 1);
  assert.strictEqual(r.firstSeen, '2026-07-30');
  assert.strictEqual(r.lastSeen, '2026-07-30');
  assert.ok(typeof r.confidenceReason === 'string' && r.confidenceReason.length > 0);
});

test('RED 15 — 동일 fingerprint(prev에 있음)는 seenCount=이전+1, firstSeen 보존', () => {
  const { fingerprint } = require('../../scripts/report/report_lib');
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', ancestors: [] },
  ];
  // history의 fingerprint을 실제 함수 호출로 생성 → 같은 입력이면 같은 fp
  const fp = fingerprint('misplacement-suspect', 'p1', 'F-B');
  const history = [
    {
      kind: 'misplacement-suspect',
      pageId: 'p1',
      fingerprint: fp,
      seenCount: 2,
      firstSeen: '2026-07-28',
      lastSeen: '2026-07-29',
    },
  ];
  const out = recommendMisplacements(pages, history, {
    todayStr: '2026-07-30',
    categoryOf: () => 'F-A',
    suggestedFolderFor: () => 'F-A',
    reasonFor: () => '정확히 일치',
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].seenCount, 3);
  assert.strictEqual(out[0].firstSeen, '2026-07-28');
  assert.strictEqual(out[0].lastSeen, '2026-07-30');
});

test('RED 16 — confidence < 0.5면 부록 진입 안 함 (잡음 제거)', () => {
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'F-B', ancestors: [] },
  ];
  const out = recommendMisplacements(pages, [], {
    todayStr: '2026-07-30',
    categoryOf: () => 'F-A',
    suggestedFolderFor: () => 'F-A',
    reasonFor: () => '불확실, 분류 불가',
  });
  assert.deepStrictEqual(out, []); // 0.5 - 0.40 = 0.10 < 0.5 → 제외
});