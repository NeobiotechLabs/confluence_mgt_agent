'use strict';
// migrator.js의 runMigrate export 단위 테스트.
// 모든 외부 의존(deps)을 주입하여 네트워크 없이 밀폐 검증한다.
const test = require('node:test');
const assert = require('node:assert');

const { runMigrate } = require('../../scripts/migrator');

// ── 헬퍼: 최소 deps 객체 생성 ──────────────────────────────────────────────
function makeDeps(overrides = {}) {
  return {
    confluenceRequest: overrides.confluenceRequest || (async () => ({})),
    fetchPageDetail: overrides.fetchPageDetail || (async (id) => ({
      id, title: 'Test Page', body: '<p>body</p>', url: 'https://x',
      authorDisplayName: 'Author', createdAt: '2026-07-01T00:00:00Z',
    })),
    fetchPageLabels: overrides.fetchPageLabels || (async () => []),
    classifyWithChain: overrides.classifyWithChain || (async () => ({
      ok: true, source: 'inline-llm', folderId: '100', folderTitle: 'Target',
      labels: ['label-a'], reason: 'test reason',
    })),
    assessMigrationValue: overrides.assessMigrationValue || (async () => ({
      ok: true, verdict: 'create', reason: 'test value', source: 'inline-llm-value',
    })),
    loadDroppedCache: overrides.loadDroppedCache || (async () => []),
    saveDroppedCache: overrides.saveDroppedCache || (async () => {}),
    consultDroppedCache: overrides.consultDroppedCache || (() => ({ cached: false, reevaluate: false })),
    mergeDroppedCache: overrides.mergeDroppedCache || ((cache, updates) => cache.concat(updates)),
    hashFor: overrides.hashFor || (() => 'h1'),
    today: overrides.today || '2026-08-02',
    createPage: overrides.createPage || (async () => ({
      id: '999', title: 'New Page', webUrl: 'https://new',
    })),
    updatePageBody: overrides.updatePageBody || (async () => {}),
    addLabels: overrides.addLabels || (async () => {}),
    copyAttachments: overrides.copyAttachments || (async () => ({ skippedVideos: [] })),
    buildBanner: overrides.buildBanner || (() => '<p>banner</p>'),
    fixBodyReferences: overrides.fixBodyReferences || ((body) => body),
    findPageByTitleInAA: overrides.findPageByTitleInAA || (async () => null),
    fetchAATree: overrides.fetchAATree || (async () => ({
      toText: () => 'tree text',
      unsortedFolderId: '9999',
    })),
    spacesConfig: overrides.spacesConfig || {
      SD: { active: true },
      GLOBAL_RULE_VERSION: '1.0',
      LOOKBACK_DAYS: 7,
    },
  };
}

test('runMigrate: dryRun=true — 후보 탐색만, create/update 없음', async () => {
  const candidates = [
    { id: '10', title: 'Page A', body: { storage: { value: '<p>A</p>' } }, _links: { webui: '/x' } },
  ];
  let createCalled = false;
  let updateCalled = false;

  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      return {};
    },
    createPage: async () => { createCalled = true; return { id: '999', title: 'x', webUrl: '' }; },
    updatePageBody: async () => { updateCalled = true; },
  });

  const result = await runMigrate({ dryRun: true, deps });
  assert.ok(result, 'runMigrate should return a result object');
  assert.ok(Array.isArray(result.items), 'result.items should be an array');
  assert.strictEqual(createCalled, false, 'dryRun should not create pages');
  assert.strictEqual(updateCalled, false, 'dryRun should not update pages');
});

test('runMigrate: 정상 이관 — status=created 반환', async () => {
  const candidates = [
    { id: '10', title: 'Page A', body: { storage: { value: '<p>A</p>' } }, _links: { webui: '/x' } },
  ];
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      if (url.includes('/label')) return { results: [] };
      return {};
    },
    classifyWithChain: async () => ({
      ok: true, source: 'inline-llm', folderId: '100', folderTitle: 'Target',
      labels: ['test-label'], reason: '본문 분석 결과',
    }),
    createPage: async () => ({ id: '999', title: 'Page A', webUrl: 'https://new' }),
  });

  const result = await runMigrate({ dryRun: false, deps });
  assert.strictEqual(result.items.length, 1);
  const item = result.items[0];
  assert.strictEqual(item.kind, 'migrate-a');
  assert.strictEqual(item.status, 'created');
  assert.strictEqual(item.pageId, '10');
  assert.strictEqual(item.title, 'Page A');
  assert.strictEqual(item.targetFolderId, '100');
  assert.strictEqual(item.classifierSource, 'inline-llm');
});

test('runMigrate: 동기화(동명 페이지 존재) — status=synced 반환', async () => {
  const candidates = [
    { id: '10', title: 'Sync Page', body: { storage: { value: '<p>sync</p>' } }, _links: { webui: '/x' } },
  ];
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      if (url.includes('/label')) return { results: [] };
      if (url.includes('/pages/')) return { parentId: '200' }; // destMeta
      return {};
    },
    findPageByTitleInAA: async () => ({ id: '500', title: 'Sync Page' }),
    classifyWithChain: async () => ({
      ok: true, source: 'structural', folderId: '100', folderTitle: 'Target',
      labels: [], reason: 'structural match',
    }),
  });

  const result = await runMigrate({ dryRun: false, deps });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].status, 'synced');
  assert.strictEqual(result.items[0].destPageId, '500');
});

test('runMigrate: 분류 실패(is_valid=false) + value verdict=create — status=unclassified (chain-fail 강제)', async () => {
  const candidates = [
    { id: '10', title: 'Skip Page', body: { storage: { value: '<p>skip</p>' } }, _links: { webui: '/x' } },
  ];
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      if (url.includes('/label')) return { results: [] };
      return {};
    },
    classifyWithChain: async () => ({
      ok: false, source: 'miss', folderId: null, reason: 'no match',
    }),
    assessMigrationValue: async () => ({ ok: true, verdict: 'create', reason: '값짐', source: 'inline-llm-value' }),
    createPage: async () => ({ id: '999', title: 'Skip Page', webUrl: '' }),
    fetchAATree: async () => ({ toText: () => 'tree', unsortedFolderId: '9999' }),
  });

  const result = await runMigrate({ dryRun: false, deps });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].status, 'unclassified');
  assert.strictEqual(result.items[0].targetFolderId, '9999');
});

test('runMigrate: needs_new_category — status=skipped 반환', async () => {
  const candidates = [
    { id: '10', title: 'New Cat Page', body: { storage: { value: '<p>nc</p>' } }, _links: { webui: '/x' } },
  ];
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      return {};
    },
    classifyWithChain: async () => ({
      ok: true, source: 'inline-llm', folderId: null, folderTitle: null,
      reason: 'need new category',
    }),
  });

  const result = await runMigrate({ dryRun: false, deps });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].status, 'skipped');
});

test('runMigrate: per-page 오류 — status=failed, 다음 페이지 계속', async () => {
  const candidates = [
    { id: '10', title: 'Fail Page', body: { storage: { value: '<p>f</p>' } }, _links: { webui: '/x' } },
    { id: '20', title: 'Good Page', body: { storage: { value: '<p>g</p>' } }, _links: { webui: '/y' } },
  ];
  let callCount = 0;
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: candidates };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      if (url.includes('/label')) return { results: [] };
      return {};
    },
    fetchPageDetail: async (id) => {
      if (id === '10') throw new Error('fetch failed');
      return { id, title: 'Good Page', body: '<p>g</p>', url: 'https://x',
        authorDisplayName: 'A', createdAt: '2026-07-01T00:00:00Z' };
    },
    classifyWithChain: async () => ({
      ok: true, source: 'inline-llm', folderId: '100', folderTitle: 'T',
      labels: [], reason: 'ok',
    }),
    createPage: async () => ({ id: '999', title: 'Good Page', webUrl: '' }),
  });

  const result = await runMigrate({ dryRun: false, deps });
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].status, 'failed');
  assert.ok(result.items[0].error);
  assert.strictEqual(result.items[1].status, 'created');
});

test('runMigrate: 활성 스페이스 없으면 빈 items 반환', async () => {
  const deps = makeDeps({
    spacesConfig: { GLOBAL_RULE_VERSION: '1.0', LOOKBACK_DAYS: 7 },
  });
  const result = await runMigrate({ dryRun: false, deps });
  assert.deepStrictEqual(result.items, []);
});

test('runMigrate: 후보 없으면 빈 items 반환', async () => {
  const deps = makeDeps({
    confluenceRequest: async (method, url) => {
      if (url.includes('content/search')) return { results: [] };
      if (url.includes('spaces?keys')) return { results: [{ id: '1' }] };
      return {};
    },
  });
  const result = await runMigrate({ dryRun: false, deps });
  assert.deepStrictEqual(result.items, []);
});
