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
  assert.ok(html.includes('이관 결과 없음'), '마이그레이션 결과 없으면 문구');
});

test('§2: migrate-a items 있으면 상태별 그룹 표시', () => {
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
  assert.ok(html.includes('신규 이관'), 'created 그룹 헤더');
  assert.ok(html.includes('동기화'), 'synced 그룹 헤더');
  assert.ok(html.includes('Research'), '대상 폴더 표시');
  assert.ok(html.includes('inline-llm'), '분류 소스 표시');
});

test('§2: unclassified status — 미분류 그룹 + 추천 폴더', () => {
  // 작업 15: 4-group의 skipped는 unclassified/dropped로 분리됨.
  const items = [
    { kind: 'migrate-a', pageId: '30', title: 'Unclassified Page', sourceSpace: 'SD',
      status: 'unclassified', classifierSource: 'inline-llm', reason: '둘 다 가능',
      suggestedFolderId: '102' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Unclassified Page'), 'Unclassified 페이지 표시');
  assert.ok(html.includes('미분류 폴더 이관'), 'unclassified 그룹 헤더');
  assert.ok(html.includes('102'), '추천 폴더 ID 표시');
});

test('§2: failed status — 실패 그룹', () => {
  const items = [
    { kind: 'migrate-a', pageId: '40', title: 'Failed Page', sourceSpace: 'SD',
      targetFolderId: null, targetFolderTitle: null, status: 'failed',
      classifierSource: null, reason: null, error: 'fetch timeout' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Failed Page'), 'Failed 페이지 표시');
  assert.ok(html.includes('실패'), 'failed 그룹 헤더');
  assert.ok(html.includes('fetch timeout'), '에러 메시지 표시');
});

test('§2: 페이지 제목에 Confluence 링크 포함 (destPageId 우선)', () => {
  const items = [
    { kind: 'migrate-a', pageId: '10', title: 'Linked Page', sourceSpace: 'SD',
      targetFolderId: '100', targetFolderTitle: 'T', status: 'created',
      classifierSource: 'llm', reason: 'ok', destPageId: '500' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('pageId=500'), 'destPageId로 링크 생성');
  assert.ok(html.includes('<a href='), '링크 태그 존재');
  assert.ok(html.includes('Linked Page'), '제목 텍스트');
});

test('§2: destPageId 없으면 pageId로 링크 (소스 페이지)', () => {
  // 작업 15: dropped status는 pageId fallback 링크가 필요 (created/synced/dropped 모두 pageLink 사용)
  const items = [
    { kind: 'migrate-a', pageId: '10', title: 'No Dest', sourceSpace: 'SD',
      targetFolderId: null, targetFolderTitle: null, status: 'dropped',
      classifierSource: 'miss', reason: 'no value', reevalDueAt: '2026-08-09' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('pageId=10'), 'pageId로 fallback 링크');
});

test('§2: move-b items와 migrate-a items 공존', () => {
  const items = [
    { kind: 'move-b', pageId: '1', title: 'Moved', fromFolderId: 'A',
      toFolderId: 'B', source: 'reorg', reason: 'moved', fingerprint: 'x',
      seenCount: 1 },
    { kind: 'migrate-a', pageId: '2', title: 'Migrated', sourceSpace: 'SD',
      targetFolderId: '100', targetFolderTitle: 'T', status: 'created',
      classifierSource: 'llm', reason: 'ok' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(html.includes('Migrated'), '§2에 마이그레이션 페이지');
  assert.ok(html.includes('Moved'), '§3에 이동 페이지');
});

test('§2: 빈 그룹은 렌더 안 함', () => {
  const items = [
    { kind: 'migrate-a', pageId: '1', title: 'A', sourceSpace: 'SD',
      targetFolderId: '100', targetFolderTitle: 'T', status: 'created',
      classifierSource: 'llm', reason: 'ok' },
  ];
  const html = renderReportStorage({ appendix: makeAppendix({ items }) });
  assert.ok(!html.includes('동기화'), 'synced 그룹 없음');
  assert.ok(!html.includes('이관 제외'), 'skipped 그룹 없음');
  assert.ok(!html.includes('>실패<'), 'failed 그룹 없음');
});
