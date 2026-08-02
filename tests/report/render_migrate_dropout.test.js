'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { renderReportStorage } = require('../../scripts/report/render');

function makeAppendix(extraItems) {
  return {
    runAt: '2026-08-02T09:00:00+09:00',
    runId: 'r1',
    mode: 'prod',
    policyHash: 'abc12345',
    gitSha: 'sha',
    model: 'claude-haiku-4-5-20251001',
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 0, movesB: 0, advisories: 0, actionRequiredCount: 0 },
    items: extraItems,
  };
}

test('render: dropped 그룹은 status 5종 중 하나, "이관 가치 없음" 라벨', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: '개인 메모', reevalDueAt: '2026-08-09' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(html.includes('이관 가치 없음 (드롭)'));
  assert.ok(html.includes('개인 메모'));
  assert.ok(html.includes('재평가'));
});

test('render: unclassified 그룹 — "미분류 폴더 이관" + 추천 폴더 컬럼', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'unclassified', reason: '둘 다 가능', suggestedFolderId: '102' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(html.includes('미분류 폴더 이관 (분류 애매)'));
  assert.ok(html.includes('102'));
});

test('render: 5그룹 모두 있을 때 헤더 순서 = created → synced → unclassified → dropped → failed', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'A', sourceSpace: 'SD', status: 'created', targetFolderId: '100', targetFolderTitle: 'T', classifierSource: 'inline-llm', reason: 'r' },
    { kind: 'migrate-a', pageId: '2', title: 'B', sourceSpace: 'SD', status: 'synced', targetFolderId: '100', classifierSource: 'inline-llm', reason: 'r', destPageId: '99' },
    { kind: 'migrate-a', pageId: '3', title: 'C', sourceSpace: 'SD', status: 'unclassified', reason: 'r', suggestedFolderId: '102' },
    { kind: 'migrate-a', pageId: '4', title: 'D', sourceSpace: 'SD', status: 'dropped', reason: 'r', reevalDueAt: '2026-08-09' },
    { kind: 'migrate-a', pageId: '5', title: 'E', sourceSpace: 'SD', status: 'failed', error: 'oops' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  const idxCreated = html.indexOf('신규 이관');
  const idxSynced = html.indexOf('동기화 (기존 페이지 갱신)');
  const idxUnc = html.indexOf('미분류 폴더 이관 (분류 애매)');
  const idxDrop = html.indexOf('이관 가치 없음 (드롭)');
  const idxFailed = html.indexOf('실패');
  assert.ok(idxCreated >= 0);
  assert.ok(idxSynced > idxCreated);
  assert.ok(idxUnc > idxSynced);
  assert.ok(idxDrop > idxUnc);
  assert.ok(idxFailed > idxDrop);
});

test('render: 빈 그룹은 헤더 생략', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'A', sourceSpace: 'SD', status: 'created', targetFolderId: '100', classifierSource: 'inline-llm', reason: 'r' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(!html.includes('이관 가치 없음 (드롭)'));
  assert.ok(!html.includes('미분류 폴더 이관'));
});

test('render: dropped 재평가 D-N 포맷', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: 'r', reevalDueAt: '2026-08-09', cacheHit: true },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  // today=2026-08-02, nextReevalAt=2026-08-09 → D-7
  assert.ok(html.includes('D-7'));
});

test('render: escapeHtml 회귀 — "<" 포함 reason도 이스케이프', () => {
  const appendix = makeAppendix([
    { kind: 'migrate-a', pageId: '1', title: 'P', sourceSpace: 'SD', status: 'dropped', reason: '<script>x</script>', reevalDueAt: '2026-08-09' },
  ]);
  const html = renderReportStorage({ appendix, deltas: {}, failedMoves: [], advisories: [] });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
