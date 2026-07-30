// tests/report/render_advisories.test.js
'use strict';
// 작업 9 (Phase 2-A) — §4 AI 권고판 섹션 렌더 TDD.
// 정책: reference/classification_rules.md §8 (사용자 결정 2026-07-30).
// renderAdvisoriesSection(advisories)는 §4 "AI 권고판"의 HTML 본문을 반환.
//   - 입력이 빈 배열 / undefined / null 이면 자리표시 문구만 반환.
//   - 문자열 항목은 <li> escapeHtml 처리.
//   - kind:'misplacement-suspect' 객체 항목은 표(table) 행으로 변환.
//   - 항목 혼합 시 문자열은 <li> 리스트, 구조화 항목은 표 — 순서 유지.
const test = require('node:test');
const assert = require('node:assert');
const { renderAdvisoriesSection } = require('../../scripts/report/render');

test('RED 1 — 입력이 undefined/null/빈 배열이면 자리표시 단락만 반환', () => {
  const a = renderAdvisoriesSection(undefined);
  const b = renderAdvisoriesSection(null);
  const c = renderAdvisoriesSection([]);
  for (const out of [a, b, c]) {
    assert.ok(out.includes('<h2>§4 AI 권고판</h2>'), '헤더 포함');
    assert.ok(out.includes('Phase 2'), '자리표시 문구 포함');
    assert.ok(!out.includes('<table'), '표 없음');
    assert.ok(!out.includes('<li>'), '리스트 없음');
  }
});

test('RED 2 — 문자열 권고 1건은 <ul><li>로 escapeHtml 처리되어 렌더', () => {
  const out = renderAdvisoriesSection(['룰 변경 감지: abc → def']);
  assert.ok(out.includes('<h2>§4 AI 권고판</h2>'));
  assert.ok(out.includes('<ul>'));
  assert.ok(out.includes('<li>룰 변경 감지: abc → def</li>'));
  // XSS 회귀: <script> 같은 게 들어가도 escapeHtml로 텍스트화
  const xssOut = renderAdvisoriesSection(['<script>alert(1)</script>']);
  assert.ok(xssOut.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!xssOut.includes('<script>alert(1)</script>'));
});

test('RED 3 — 문자열 권고 N건은 모두 <li>로 (순서 유지)', () => {
  const advisories = ['룰 변경 감지: a', 'audit 실행 실패: timeout', '정보: 정상'];
  const out = renderAdvisoriesSection(advisories);
  const liMatches = out.match(/<li>/g) || [];
  assert.strictEqual(liMatches.length, 3);
  assert.ok(out.indexOf('룰 변경 감지: a') < out.indexOf('audit 실행 실패: timeout'));
  assert.ok(out.indexOf('audit 실행 실패: timeout') < out.indexOf('정보: 정상'));
});

test('RED 4 — kind:"misplacement-suspect" 단일 항목은 표 1행으로 변환', () => {
  const advisories = [
    {
      kind: 'misplacement-suspect',
      pageId: 'p1',
      title: '캘리브레이션 회의록',
      currentFolderId: 'F-B',
      currentFolderTitle: 'MPS 회의록',
      suggestedFolderId: 'F-A',
      suggestedFolderTitle: '캘리브레이션',
      confidence: 0.85,
      confidenceReason: 'keywords: 정확히 일치',
      seenCount: 1,
      firstSeen: '2026-07-30',
      lastSeen: '2026-07-30',
    },
  ];
  const out = renderAdvisoriesSection(advisories);
  assert.ok(out.includes('<table>'), '표를 만든다');
  assert.ok(out.includes('캘리브레이션 회의록'));
  assert.ok(out.includes('F-B'));
  assert.ok(out.includes('F-A'));
  assert.ok(out.includes('0.85'));
  assert.ok(out.includes('1'), 'seenCount=1');
  assert.ok(out.includes('2026-07-30'));
  assert.ok(!out.includes('<li>'), '구조화 항목만 있을 땐 <li> 리스트 안 만든다');
});

test('RED 5 — misplacement-suspect 다건이면 모두 표 행으로', () => {
  const advisories = [
    {
      kind: 'misplacement-suspect',
      pageId: 'p1',
      title: 'A 회의록',
      currentFolderId: 'F-B',
      suggestedFolderId: 'F-A',
      confidence: 0.85,
      confidenceReason: 'keywords: 정확히',
      seenCount: 3,
      firstSeen: '2026-07-28',
      lastSeen: '2026-07-30',
    },
    {
      kind: 'misplacement-suspect',
      pageId: 'p2',
      title: 'B 회의록',
      currentFolderId: 'F-C',
      suggestedFolderId: 'F-A',
      confidence: 0.70,
      confidenceReason: 'keywords: 유사',
      seenCount: 1,
      firstSeen: '2026-07-30',
      lastSeen: '2026-07-30',
    },
  ];
  const out = renderAdvisoriesSection(advisories);
  const trMatches = out.match(/<tr>/g) || [];
  // header 1행 + 데이터 2행 = 3
  assert.ok(trMatches.length >= 3, `expect at least 3 <tr> (header + 2 data), got ${trMatches.length}`);
  assert.ok(out.includes('A 회의록'));
  assert.ok(out.includes('B 회의록'));
  assert.ok(out.includes('seen=3') || out.includes('>3<'), 'seenCount=3 노출');
});

test('RED 6 — 문자열 + misplacement-suspect 혼합: 문자열→<li>, 구조화→<table> (둘 다 렌더)', () => {
  const advisories = [
    '룰 변경 감지: a → b',
    {
      kind: 'misplacement-suspect',
      pageId: 'p1',
      title: 'X 회의록',
      currentFolderId: 'F-B',
      suggestedFolderId: 'F-A',
      confidence: 0.90,
      confidenceReason: 'keywords: 정확히',
      seenCount: 2,
      firstSeen: '2026-07-29',
      lastSeen: '2026-07-30',
    },
    'audit 실행 실패: timeout',
  ];
  const out = renderAdvisoriesSection(advisories);
  assert.ok(out.includes('<ul>') && out.includes('<li>룰 변경 감지: a → b</li>'));
  assert.ok(out.includes('<li>audit 실행 실패: timeout</li>'));
  assert.ok(out.includes('<table>'));
  assert.ok(out.includes('X 회의록'));
  // XSS 회귀: 구조화 항목의 title/currentFolderId도 escapeHtml
  const xssOut = renderAdvisoriesSection([
    {
      kind: 'misplacement-suspect',
      pageId: 'p1',
      title: '<script>alert(1)</script>',
      currentFolderId: 'F-B',
      suggestedFolderId: 'F-A',
      confidence: 0.85,
      confidenceReason: 'k',
      seenCount: 1,
      firstSeen: '2026-07-30',
      lastSeen: '2026-07-30',
    },
  ]);
  assert.ok(xssOut.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!xssOut.includes('<script>alert(1)</script>'));
});

test('RED 7 — §4 자리표시 <p><em>미실행 (Phase 2 예정)</em></p> 텍스트는 데이터가 있을 때 빠진다', () => {
  const out = renderAdvisoriesSection(['어떤 권고']);
  assert.ok(!out.includes('미실행 (Phase 2 예정)'), '자리표시 문구 미노출');
  const empty = renderAdvisoriesSection([]);
  assert.ok(empty.includes('미실행 (Phase 2 예정)'), '빈 배열에선 자리표시 노출');
});
