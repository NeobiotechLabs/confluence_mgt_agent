'use strict';
// render.js §2 루프 A 마이그레이션 표 렌더링 테스트.
const test = require('node:test');
const assert = require('node:assert');

const { renderReportStorage } = require('../../scripts/report/render');

function makeAppendix(extra = {}) {
  return {
    v: 1, runAt: '2026-07-31 09:00', runId: 'test', mode: 'EXEC',
    policyHash: 'abc12345', model: 'test', gitSha: 'deadbeef',
    metrics: { aaPageCount: 10, topLevelOrphans: 0, unclassifiedCount: 2,
      movesB: 0, advisories: 0, actionRequiredCount: 0 },
    items: [], advisories: [],
    ...extra,
  };
}

test('§2: migrate-a items 없으면 미신행 문구', () => {
  const html = renderReportStorage({ appendix: makeAppendix() });
  assert.ok(html.includes('§2 루프 A'), '§2 헤더 존재');
  assert.ok(html.includes('미실행') || html.includes('이관 결과 없음'),
    '마이그레이션 결과 없으면 미신행 문구');
});

test('§2: migrate-a items 있으면 표 렌더', () => {
  const items = [
    { kind: 'migrate-a', pageId: '10', title: 'Page A', sourceSpace: 'SD',
      targetFolderId: '100', targetFolderTitle: 'Research', status: 'created',
      classifierSource: 'inline-llm', reason: '본문 분류' },
    { kind: 'migrate-a', pageId: '20', title: 'Page B', sourceSpace: 'SD',
      targetFolderId: '200', targetFolderTitle: 'Tech', status: 'synced',
      classifierSource: 'structural', reason: '구조 매칭' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Page A'), 'Page A 표시');
  assert.ok(html.includes('Page B'), 'Page B 표시');
  assert.ok(html.includes('created'), 'created 상태 표시');
  assert.ok(html.includes('synced'), 'synced 상태 표시');
  assert.ok(html.includes('Research'), '대상 폴더 표시');
  assert.ok(html.includes('inline-llm'), '분류 소스 표시');
});

test('§2: skipped status도 표시', () => {
  const items = [
    { kind: 'migrate-a', pageId: '30', title: 'Skipped Page', sourceSpace: 'SD',
      targetFolderId: null, targetFolderTitle: null, status: 'skipped',
      classifierSource: 'miss', reason: 'no match' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Skipped Page'), 'Skipped 페이지 표시');
  assert.ok(html.includes('skipped'), 'skipped 상태 표시');
});

test('§2: failed status와 에러 표시', () => {
  const items = [
    { kind: 'migrate-a', pageId: '40', title: 'Failed Page', sourceSpace: 'SD',
      targetFolderId: null, targetFolderTitle: null, status: 'failed',
      classifierSource: null, reason: null, error: 'fetch timeout' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Failed Page'), 'Failed 페이지 표시');
  assert.ok(html.includes('failed'), 'failed 상태 표시');
  assert.ok(html.includes('fetch timeout'), '에러 메시지 표시');
});

test('§2: move-b items와 migrate-a items 공존 — §3 move-b, §2 migrate-a', () => {
  const items = [
    { kind: 'move-b', pageId: '1', title: 'Moved', fromFolderId: 'A',
      toFolderId: 'B', source: 'reorg', reason: 'moved', fingerprint: 'x',
      seenCount: 1 },
    { kind: 'migrate-a', pageId: '2', title: 'Migrated', sourceSpace: 'SD',
      targetFolderId: '100', targetFolderTitle: 'T', status: 'created',
      classifierSource: 'llm', reason: 'ok' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  // §2에 migrate-a
  assert.ok(html.includes('Migrated'), '§2에 마이그레이션 페이지');
  // §3에 move-b
  assert.ok(html.includes('Moved'), '§3에 이동 페이지');
});
